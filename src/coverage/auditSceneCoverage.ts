import { Diagnostic, NodeData } from "../types";
import { resolveAncestorLevelId } from "../geometry/transform";
import { finalDimensions } from "../geometry/transform";
import { hasValidShelfFootprint } from "../geometry/shelf";
import { hasStairPlanGeometry } from "../geometry/stairs";
import { OverallStatus } from "./coverageTypes";
import { currentVariantSupport } from "./currentDemoMatrix";
import { BUILTIN_KINDS, pascalCoreManifest } from "./pascalCoreManifest";
import { collectCurrentRenderRegistry } from "./renderedNodeRegistry";

const variantOf = (node: NodeData) =>
  node.type === "stair"
    ? node.stairType
    : node.type === "door"
      ? (node.doorType ?? "hinged")
      : node.type === "window"
        ? (node.windowType ?? "fixed")
        : node.type === "shelf"
          ? (node.style ?? "wall-shelf")
          : undefined;

const invalidReason = (node: NodeData, nodes: Record<string, NodeData>) => {
  if (node.type === "item" && !finalDimensions(node))
    return "item dimensions/scale 无效";
  if (node.type === "shelf" && !hasValidShelfFootprint(node))
    return "shelf dimensions 无效";
  if (node.type === "wall") {
    if (!Array.isArray(node.start) || !Array.isArray(node.end))
      return "wall endpoints 缺失";
    if (
      Math.hypot(node.end[0] - node.start[0], node.end[1] - node.start[1]) <
      1e-9
    )
      return "wall 长度为零";
  }
  if (
    node.type === "stair" &&
    !hasStairPlanGeometry(node, nodes)
  )
    return "stair 关键几何无效";
  if (
    (node.type === "door" || node.type === "window") &&
    node.width !== undefined &&
    (!Number.isFinite(node.width) || node.width <= 0)
  )
    return `${node.type} width 无效`;
  return undefined;
};

export function auditSceneCoverage(
  nodes: Record<string, NodeData>,
  installedPlugins: unknown[] = [],
  visibility: { slabs?: boolean; stairs?: boolean } = {},
) {
  const builtin = new Set<string>(BUILTIN_KINDS),
    registry = collectCurrentRenderRegistry(nodes, visibility);
  const entries = Object.values(nodes).map((node) => {
    const manifest = pascalCoreManifest.find(
        (entry) => entry.kind === node.type,
      ),
      variant = variantOf(node),
      ancestor = resolveAncestorLevelId(node.id, nodes),
      render = registry.get(node.id),
      invalid = invalidReason(node, nodes);
    let overallStatus: OverallStatus, reason: string;
    if (!manifest) {
      overallStatus = "unknown-plugin-node";
      reason = "不属于固定 Pascal Core 43-kind；缺少对应插件 Schema";
    } else if (invalid) {
      overallStatus = "invalid-data";
      reason = invalid;
    } else if (render?.renderStrategy === "intentionally-hidden") {
      overallStatus =
        manifest.classification.expectedVisibilityStrategy.includes("container")
          ? "parsed-container"
          : "parsed-intentionally-hidden";
      reason = node.type === "ceiling" ? "Ceiling数据用于顶面/天花视图，不在当前平面布置图默认渲染。" : "按当前视图策略正常不独立绘制";
    } else if (render?.renderStrategy === "hidden-by-layer-toggle") {
      overallStatus = "parsed-intentionally-hidden";
      reason = "图层被用户关闭，未参与当前画布绘制";
    } else if (render?.renderStrategy === "parent-emitted") {
      overallStatus = "parsed-parent-emitted";
      reason = `由父节点 ${render.emittedByNodeId} 输出`;
    } else if (render) {
      const configured =
        variant && node.type in currentVariantSupport
          ? (currentVariantSupport as any)[node.type]?.[variant]
          : undefined;
      overallStatus = (configured ??
        manifest.currentDemoStatus.overallStatus) as OverallStatus;
      reason = `实际登记为 ${render.renderStrategy} 渲染`;
    } else if (
      manifest.classification.expectedVisibilityStrategy.includes("container")
    ) {
      overallStatus = "parsed-container";
      reason = "容器节点正常不独立绘制";
    } else if (
      manifest.classification.expectedVisibilityStrategy.includes(
        "parent-emitted",
      )
    ) {
      overallStatus = "parsed-not-rendered";
      reason = "期望由父节点输出，但当前没有父级渲染登记";
    } else {
      overallStatus =
        variant && node.type in currentVariantSupport
          ? ((currentVariantSupport as any)[node.type]?.[variant] ??
            "parsed-not-rendered")
          : "parsed-not-rendered";
      reason =
        overallStatus === "partially-supported"
          ? "当前 variant 仅有简化表达且本节点未满足渲染条件"
          : `${node.type}${variant ? "." + variant : ""} 已解析但没有实际渲染登记`;
    }
    return {
      nodeId: node.id,
      kind: node.type,
      variant,
      ancestorLevelId: ancestor.levelId,
      parentChain: ancestor.sourceNodeIds,
      sourcePath: `nodes.${node.id}`,
      schemaStatus: manifest?.currentDemoStatus.schemaRecognition ?? "none",
      transformStatus: ancestor.error
        ? "none"
        : (manifest?.currentDemoStatus.transformResolution ?? "none"),
      expectedVisibility: manifest?.classification
        .expectedVisibilityStrategy ?? ["unknown-plugin"],
      actualRenderStatus: render?.renderStrategy ?? "none",
      overallStatus,
      reason,
      evidence: manifest?.currentDemoStatus.evidence ?? {
        files: [],
        functions: [],
        tests: [],
      },
    };
  });
  const count = (...statuses: OverallStatus[]) =>
    entries.filter((entry) => statuses.includes(entry.overallStatus)).length;
  const byKind = entries.reduce<Record<string, typeof entries>>(
    (groups, entry) => {
      (groups[entry.kind] ??= []).push(entry);
      return groups;
    },
    {},
  );
  const byVariant = entries.reduce<Record<string, number>>((groups, entry) => {
    const key = `${entry.kind}.${entry.variant ?? "(none)"}`;
    groups[key] = (groups[key] ?? 0) + 1;
    return groups;
  }, {});
  const diagnostics = entries.reduce<Diagnostic[]>((result, entry) => {
    if (entry.overallStatus === "parsed-not-rendered")
      result.push({
        severity: "error",
        code: "parsed-not-rendered",
        message: entry.reason,
        nodeId: entry.nodeId,
        sourcePath: entry.sourcePath,
      });
    else if (entry.overallStatus === "invalid-data")
      result.push({
        severity: "error",
        code: "invalid-data",
        message: entry.reason,
        nodeId: entry.nodeId,
        sourcePath: entry.sourcePath,
      });
    else if (entry.overallStatus === "partially-supported")
      result.push({
        severity: "warning",
        code: "partially-supported",
        message: entry.reason,
        nodeId: entry.nodeId,
        sourcePath: entry.sourcePath,
      });
    else if (entry.overallStatus === "unknown-plugin-node")
      result.push({
        severity: "warning",
        code: "unknown-plugin-node",
        message: `${entry.reason}; installedPlugins=${JSON.stringify(installedPlugins)}`,
        nodeId: entry.nodeId,
        sourcePath: entry.sourcePath,
      });
    return result;
  }, []);
  return {
    summary: {
      totalNodes: entries.length,
      builtInNodes: entries.filter((entry) => builtin.has(entry.kind)).length,
      unknownPluginNodes: count("unknown-plugin-node"),
      fullySupportedNodes: count(
        "supported-exact",
        "supported-pascal-equivalent",
        "supported-demo-symbol",
      ),
      partiallySupportedNodes: count("partially-supported"),
      parsedNotRenderedNodes: count("parsed-not-rendered"),
      invalidNodes: count("invalid-data"),
    },
    entries,
    byKind,
    byVariant,
    missingRenderers: entries.filter(
      (entry) => entry.overallStatus === "parsed-not-rendered",
    ),
    unknownKinds: [
      ...new Set(
        entries
          .filter((entry) => entry.overallStatus === "unknown-plugin-node")
          .map((entry) => entry.kind),
      ),
    ],
    installedPlugins,
    renderedRegistry: registry.all(),
    diagnostics,
  };
}
