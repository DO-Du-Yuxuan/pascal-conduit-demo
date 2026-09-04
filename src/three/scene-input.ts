import { BUILTIN_KINDS } from "../coverage/pascalCoreManifest";
import { finalDimensions, resolveItemPlanTransform } from "../geometry/transform";
import type { NodeData, Parsed } from "../types";

export type ThreeDSceneDiagnostic = {
  severity: "error" | "warning" | "info";
  code: "missing_scene_root" | "derived_scene_root" | "missing_roof_data" | "unknown_node_kind";
  message: string;
  nodeIds?: string[];
};

export type ThreeDBounds = {
  center: [number, number, number];
  span: number;
};

export type ThreeDSceneInput = {
  sceneKey: string;
  nodes: Record<string, NodeData>;
  rootNodeIds: string[];
  collections: Record<string, unknown>;
  materials: Record<string, unknown>;
  installedPlugins: string[];
  diagnostics: ThreeDSceneDiagnostic[];
  bounds: ThreeDBounds;
  hasRoofData: boolean;
  itemCount: number;
};

const builtinKinds = new Set<string>(BUILTIN_KINDS);

/** JSON imported by the Auditor is data, so a JSON clone is deliberate and avoids
 * handing the viewer store a mutable reference to Parser output. */
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function rootNodeIds(raw: unknown, nodes: Record<string, NodeData>, diagnostics: ThreeDSceneDiagnostic[]) {
  const declared = (raw as { rootNodeIds?: unknown })?.rootNodeIds;
  if (Array.isArray(declared)) {
    const valid = declared.filter((id): id is string => typeof id === "string" && Boolean(nodes[id]));
    if (valid.length === declared.length && valid.length > 0) return valid;
  }
  const derived = Object.values(nodes).filter((node) => !node.parentId).map((node) => node.id);
  if (derived.length) {
    diagnostics.push({ severity: "warning", code: "derived_scene_root", message: "源文件未提供可用 rootNodeIds；3D 视图按 parentId 为空的节点建立展示根。", nodeIds: derived });
    return derived;
  }
  diagnostics.push({ severity: "error", code: "missing_scene_root", message: "无法建立 3D 场景根节点；2D 与评价功能不受影响。" });
  return [];
}

function extendPoint(bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }, x: number, y: number, z: number) {
  bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
  bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
  bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
}

function sceneBounds(nodes: Record<string, NodeData>): ThreeDBounds {
  const raw = { minX: Infinity, maxX: -Infinity, minY: 0, maxY: 0, minZ: Infinity, maxZ: -Infinity };
  for (const node of Object.values(nodes)) {
    if (node.type === "wall") {
      for (const point of [node.start, node.end]) if (Array.isArray(point) && finite(point[0]) && finite(point[1])) extendPoint(raw, point[0], 0, point[1]);
      const height = finite(node.height) && node.height > 0 ? node.height : 2.5;
      raw.maxY = Math.max(raw.maxY, height);
    }
    if (["slab", "ceiling", "zone"].includes(node.type) && Array.isArray(node.polygon)) {
      for (const point of node.polygon) if (Array.isArray(point) && finite(point[0]) && finite(point[1])) extendPoint(raw, point[0], node.type === "ceiling" && finite(node.height) ? node.height : 0, point[2] ?? point[1]);
    }
    if (node.type === "item") {
      const transform = resolveItemPlanTransform(node.id, nodes), dimensions = finalDimensions(node);
      if (transform.status === "ok") {
        const halfWidth = dimensions?.width ?? 0, halfDepth = dimensions?.depth ?? 0, height = dimensions?.height ?? 0;
        extendPoint(raw, transform.x - halfWidth / 2, 0, transform.z - halfDepth / 2);
        extendPoint(raw, transform.x + halfWidth / 2, height, transform.z + halfDepth / 2);
      }
    }
  }
  if (!Number.isFinite(raw.minX) || !Number.isFinite(raw.minZ)) return { center: [0, 0, 0], span: 10 };
  const center: [number, number, number] = [(raw.minX + raw.maxX) / 2, (raw.minY + raw.maxY) / 2, (raw.minZ + raw.maxZ) / 2];
  return { center, span: Math.max(6, raw.maxX - raw.minX, raw.maxY - raw.minY, raw.maxZ - raw.minZ) };
}

export function buildThreeDSceneInput(parsed: Parsed): ThreeDSceneInput {
  const nodes = clone(parsed.nodes), diagnostics: ThreeDSceneDiagnostic[] = [], roots = rootNodeIds(parsed.raw, nodes, diagnostics);
  const unknownKinds = [...new Set(Object.values(nodes).filter((node) => !builtinKinds.has(node.type)).map((node) => node.type))];
  if (unknownKinds.length) diagnostics.push({ severity: "info", code: "unknown_node_kind", message: `3D 查看器未承诺渲染第三方节点：${unknownKinds.join(", ")}。` });
  const hasRoofData = Object.values(nodes).some((node) => node.type === "roof" || node.type === "roof-segment");
  if (!hasRoofData) diagnostics.push({ severity: "info", code: "missing_roof_data", message: "当前文件没有 roof 或 roof-segment 数据，因此 3D 视图不会虚构屋顶。" });
  const raw = parsed.raw as { collections?: unknown; materials?: unknown; installedPlugins?: unknown } | null;
  return {
    sceneKey: `${roots.join(":")}:${Object.keys(nodes).length}`,
    nodes,
    rootNodeIds: roots,
    collections: raw && typeof raw.collections === "object" && raw.collections ? clone(raw.collections as Record<string, unknown>) : {},
    materials: raw && typeof raw.materials === "object" && raw.materials ? clone(raw.materials as Record<string, unknown>) : {},
    installedPlugins: Array.isArray(raw?.installedPlugins) ? raw.installedPlugins.filter((item): item is string => typeof item === "string") : [],
    diagnostics,
    bounds: sceneBounds(nodes),
    hasRoofData,
    itemCount: Object.values(nodes).filter((node) => node.type === "item").length,
  };
}
