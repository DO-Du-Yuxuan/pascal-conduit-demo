import { describe, expect, it } from "vitest";
import { parseProject } from "../parser/parse";
import { auditSceneCoverage } from "./auditSceneCoverage";
import { BUILTIN_KINDS, pascalCoreManifest } from "./pascalCoreManifest";
import { RenderedNodeRegistry } from "./renderedNodeRegistry";
import { currentVariantSupport } from "./currentDemoMatrix";

const reviewedKinds = [
  "site",
  "building",
  "elevator",
  "level",
  "column",
  "wall",
  "fence",
  "cabinet",
  "cabinet-module",
  "item",
  "zone",
  "slab",
  "ceiling",
  "roof",
  "roof-segment",
  "shelf",
  "stair",
  "stair-segment",
  "scan",
  "guide",
  "spawn",
  "window",
  "door",
  "box-vent",
  "ridge-vent",
  "turbine-vent",
  "cupola",
  "eyebrow-vent",
  "gutter",
  "chimney",
  "solar-panel",
  "skylight",
  "dormer",
  "downspout",
  "duct-segment",
  "duct-fitting",
  "duct-terminal",
  "hvac-equipment",
  "lineset",
  "liquid-line",
  "pipe-segment",
  "pipe-fitting",
  "pipe-trap",
];
const level = { id: "level", type: "level" };
describe("Pascal Core coverage audit", () => {
  it("matches the fixed AnyNode and builtinPlugin set exactly", () => {
    expect(BUILTIN_KINDS).toHaveLength(43);
    expect(new Set(BUILTIN_KINDS).size).toBe(43);
    expect([...BUILTIN_KINDS]).toEqual(reviewedKinds);
    expect(pascalCoreManifest.map((entry) => entry.kind)).toEqual(
      reviewedKinds,
    );
  });
  it("gives every kind source paths, visibility strategy, current status and reviewed evidence", () => {
    for (const entry of pascalCoreManifest) {
      expect(entry.upstream.schemaPath).toMatch(
        /^packages\/core\/src\/schema\/nodes\//,
      );
      expect(entry.upstream.definitionPath).toMatch(/^packages\/nodes\/src\//);
      expect(
        entry.classification.expectedVisibilityStrategy.length,
      ).toBeGreaterThan(0);
      expect(entry.currentDemoStatus.overallStatus).toBeTruthy();
      expect(entry.reviewEvidence).toContain(entry.upstream.schemaPath);
    }
  });
  it("never claims complete support without code evidence", () => {
    for (const entry of pascalCoreManifest) {
      const status = entry.currentDemoStatus;
      for (const value of [
        status.schemaRecognition,
        status.rawDataPreservation,
        status.levelResolution,
        status.transformResolution,
        status.inspectorSupport,
        status.diagnosticSupport,
        status.testCoverage,
      ])
        if (value === "complete")
          expect(
            status.evidence.files.length +
              status.evidence.functions.length +
              status.evidence.tests.length,
          ).toBeGreaterThan(0);
    }
  });
  it("registers curved stair as supported and preserves its data", () => {
    const curved = {
      id: "curved",
      type: "stair",
      parentId: "level",
      stairType: "curved",
      position: [1, 0, 2],
      rotation: 0.2,
      width: 0.9,
      innerRadius: 1,
      sweepAngle: Math.PI,
      stepCount: 12,
    };
    const parsed = parseProject({ nodes: { level, curved } });
    expect(parsed.nodes.curved).toMatchObject(curved);
    const report = auditSceneCoverage(parsed.nodes);
    expect(report.byVariant["stair.curved"]).toBe(1);
    expect(
      report.entries.find((entry) => entry.nodeId === "curved"),
    ).toMatchObject({
      ancestorLevelId: "level",
      overallStatus: "supported-pascal-equivalent",
      actualRenderStatus: "self",
    });
    expect(report.diagnostics.some((diagnostic) => diagnostic.nodeId === "curved")).toBe(false);
  });
  it("reports stair-segment as emitted by its normal parent stair", () => {
    const spiral = {
      id: "spiral",
      type: "stair",
      parentId: "level",
      stairType: "spiral",
      position: [0, 0, 0],
      width: 1,
      innerRadius: 0.4,
      sweepAngle: Math.PI,
      stepCount: 10,
    };
    const segment = {
      id: "segment",
      type: "stair-segment",
      parentId: "spiral",
    };
    const report = auditSceneCoverage({ level, spiral, segment } as any);
    expect(
      report.entries.find((entry) => entry.nodeId === "level")?.overallStatus,
    ).toBe("parsed-container");
    expect(
      report.entries.find((entry) => entry.nodeId === "segment")?.overallStatus,
    ).toBe("parsed-parent-emitted");
    expect(
      report.diagnostics.some((diagnostic) => diagnostic.nodeId === "segment"),
    ).toBe(false);
  });
  it("supports explicit parent-emitted registry records", () => {
    const registry = new RenderedNodeRegistry();
    registry.register({
      nodeId: "child",
      kind: "stair-segment",
      emittedByNodeId: "parent",
      renderStrategy: "parent-emitted",
    });
    expect(registry.get("child")).toMatchObject({
      emittedByNodeId: "parent",
      renderStrategy: "parent-emitted",
    });
  });
  it("preserves and reports unknown plugin nodes without import failure", () => {
    const pluginNode = {
      id: "plugin-1",
      type: "acme-widget",
      parentId: "level",
      custom: { answer: 42 },
    };
    const parsed = parseProject({
      nodes: { level, "plugin-1": pluginNode },
      installedPlugins: [{ id: "acme" }],
    });
    expect(parsed.nodes["plugin-1"]).toEqual(pluginNode);
    const report = auditSceneCoverage(parsed.nodes, [{ id: "acme" }]);
    expect(report.summary.unknownPluginNodes).toBe(1);
    expect(report.unknownKinds).toEqual(["acme-widget"]);
    expect(
      report.entries.find((entry) => entry.nodeId === "plugin-1")
        ?.overallStatus,
    ).toBe("unknown-plugin-node");
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "unknown-plugin-node",
      }),
    );
  });
  it("emits warnings for partially supported door variants", () => {
    const wall = {
      id: "wall",
      type: "wall",
      parentId: "level",
      start: [0, 0],
      end: [3, 0],
    };
    const door = {
      id: "door",
      type: "door",
      parentId: "wall",
      wallId: "wall",
      doorType: "sliding",
      position: [1, 0, 0],
      width: 0.9,
    };
    const report = auditSceneCoverage({ level, wall, door } as any);
    expect(
      report.entries.find((entry) => entry.nodeId === "door")?.overallStatus,
    ).toBe("partially-supported");
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "partially-supported",
        nodeId: "door",
      }),
    );
  });
  it("locks accepted item, wall, shelf, slab and stair statuses to their evidence", () => {
    const byKind = Object.fromEntries(
      pascalCoreManifest.map((entry) => [entry.kind, entry.currentDemoStatus]),
    );
    expect(byKind.item.overallStatus).toBe("supported-exact");
    expect(byKind.wall.overallStatus).toBe("supported-pascal-equivalent");
    expect(byKind.shelf.overallStatus).toBe("supported-pascal-equivalent");
    expect(byKind.slab.overallStatus).toBe("supported-pascal-equivalent");
    expect(byKind.stair.overallStatus).toBe("partially-supported");
    expect(currentVariantSupport.stair.spiral).toBe("supported-demo-symbol");
    expect(currentVariantSupport.stair.curved).toBe("supported-pascal-equivalent");
    expect(currentVariantSupport.stair.straight).toBe("supported-pascal-equivalent");
    expect(byKind.item.testCoverage).toBe("complete");
    expect(byKind.wall.testCoverage).toBe("complete");
    expect(byKind.shelf.testCoverage).toBe("complete");
  });
  it("keeps ceiling intentionally hidden and treats a disabled slab layer as non-error", () => {
    const slab = { id: "slab", type: "slab", parentId: "level", polygon: [[0, 0], [3, 0], [3, 2], [0, 2]] };
    const ceiling = { id: "ceiling", type: "ceiling", parentId: "level", polygon: [[0, 0], [3, 0], [3, 2], [0, 2]] };
    const report = auditSceneCoverage({ level, slab, ceiling } as any, [], { slabs: false });
    expect(report.entries.find((entry) => entry.nodeId === "slab")).toMatchObject({ overallStatus: "parsed-intentionally-hidden", actualRenderStatus: "hidden-by-layer-toggle" });
    expect(report.entries.find((entry) => entry.nodeId === "ceiling")).toMatchObject({ overallStatus: "parsed-intentionally-hidden", actualRenderStatus: "intentionally-hidden", reason: "Ceiling数据用于顶面/天花视图，不在当前平面布置图默认渲染。" });
    expect(report.diagnostics.some((diagnostic) => diagnostic.nodeId === "slab" || diagnostic.nodeId === "ceiling")).toBe(false);
  });
  it("counts invalid built-in geometry instead of claiming renderer support", () => {
    const badShelf = {
      id: "bad-shelf",
      type: "shelf",
      parentId: "level",
      width: 0,
      depth: 0.3,
    };
    const report = auditSceneCoverage({ level, "bad-shelf": badShelf } as any);
    expect(report.summary.invalidNodes).toBe(1);
    expect(
      report.entries.find((entry) => entry.nodeId === "bad-shelf")
        ?.overallStatus,
    ).toBe("invalid-data");
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "invalid-data",
        nodeId: "bad-shelf",
      }),
    );
  });
});
