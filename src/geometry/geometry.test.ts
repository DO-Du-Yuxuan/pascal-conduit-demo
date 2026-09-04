import { describe, it, expect } from "vitest";
import {
  composePascalTransformWithWorldToSvg,
  finalDimensions,
  resolveAncestorLevelId,
  resolveItemPlanTransform,
  rotatePascalPlanVector,
  rotatedPanDelta,
  zoomViewBoxAtPoint,
  zoomExtents,
} from "./transform";
import { buildPascalMatrixReport } from "./audit";
import referenceProject from "../../sample-data/Bellevue demo.json";

const item = (id: string, overrides: any = {}) => ({
  id,
  type: "item",
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  asset: { dimensions: [2, 1, 4] },
  ...overrides,
});

describe("Pascal world geometry", () => {
  it("locks five direct-Level furniture transforms from the current demo", () => {
    const nodes: any = referenceProject.nodes;
    const direct = Object.values(nodes).filter((node: any) => node.type === "item" && nodes[node.parentId]?.type === "level" && finalDimensions(node) && Array.isArray(node.position)).slice(0, 5) as any[];
    expect(direct).toHaveLength(5);
    for (const node of direct) {
      const t = resolveItemPlanTransform(node.id, nodes), d = finalDimensions(node);
      expect(t.x).toBeCloseTo(node.position[0]);
      expect(t.z).toBeCloseTo(node.position[2]);
      expect(t.rotationY).toBeCloseTo(node.rotation?.[1] ?? 0);
      expect(d?.width).toBeGreaterThan(0);
      expect(d?.depth).toBeGreaterThan(0);
      expect(composePascalTransformWithWorldToSvg(t).e).toBeCloseTo(node.position[0]);
    }
  });
  it("uses only asset.dimensions × item.scale", () =>
    expect(
      finalDimensions(
        item("a", {
          scale: [2, 3, 4],
          asset: { dimensions: [2, 1, 4], scale: [99, 99, 99] },
        }),
      ),
    ).toEqual({ width: 4, height: 3, depth: 16 }));
  it("never makes a 1 × 1 footprint for invalid dimensions or scale", () => {
    expect(
      finalDimensions(item("a", { asset: { dimensions: [0, 1, 1] } })),
    ).toBeNull();
    expect(finalDimensions(item("b", { scale: [1, 0, 1] }))).toBeNull();
  });
  it("uses Pascal clockwise plan rotation at cardinal angles", () => {
    expect(rotatePascalPlanVector(1, 0, 0)).toEqual({ x: 1, z: 0 });
    expect(rotatePascalPlanVector(0, 1, 0)).toEqual({ x: 0, z: 1 });
    expect(rotatePascalPlanVector(1, 0, Math.PI / 2).z).toBeCloseTo(-1);
    expect(rotatePascalPlanVector(0, 1, Math.PI / 2).x).toBeCloseTo(1);
    expect(rotatePascalPlanVector(1, 0, Math.PI).x).toBeCloseTo(-1);
    expect(rotatePascalPlanVector(0, 1, Math.PI * 1.5).x).toBeCloseTo(-1);
  });
  it("resolves nested item and shelf coordinates in the Pascal parent frame", () => {
    const nodes: any = {
      l: { id: "l", type: "level" },
      p: item("p", {
        parentId: "l",
        position: [10, 0, 20],
        rotation: [0, Math.PI / 2, 0],
      }),
      c: item("c", { parentId: "p", position: [1, 0, 0] }),
      s: {
        id: "s",
        type: "shelf",
        parentId: "l",
        position: [5, 0, 2],
        rotation: [0, Math.PI / 2, 0],
      },
      q: item("q", { parentId: "s", position: [1, 0, 0] }),
    };
    expect(resolveItemPlanTransform("c", nodes)).toMatchObject({
      x: 10,
      z: 19,
      rotationY: Math.PI / 2,
      ancestorLevelId: "l",
    });
    expect(resolveItemPlanTransform("q", nodes)).toMatchObject({
      x: 5,
      z: 1,
      rotationY: Math.PI / 2,
      ancestorLevelId: "l",
    });
  });
  it("resolves wall-side item and its ancestor level", () => {
    const nodes: any = {
      l: { id: "l", type: "level" },
      w: {
        id: "w",
        type: "wall",
        parentId: "l",
        start: [10, 20],
        end: [20, 20],
        thickness: 0.2,
      },
      a: item("a", {
        parentId: "w",
        position: [2, 0, 0],
        side: "front",
        asset: { dimensions: [2, 1, 4], attachTo: "wall-side" },
      }),
    };
    expect(resolveAncestorLevelId("a", nodes).levelId).toBe("l");
    expect(resolveItemPlanTransform("a", nodes)).toMatchObject({
      x: 12,
      z: 22.1,
      ancestorLevelId: "l",
    });
  });
  it("keeps foreign-level items out of the selected level", () => {
    const nodes: any = {
      l1: { id: "l1", type: "level" },
      l2: { id: "l2", type: "level" },
      a: item("a", { parentId: "l1" }),
      b: item("b", { parentId: "l2" }),
    };
    expect(resolveAncestorLevelId("a", nodes).levelId).toBe("l1");
    expect(resolveAncestorLevelId("b", nodes).levelId).toBe("l2");
  });
  it("does not assign cyclic parents to any level", () => {
    const nodes: any = {
      a: item("a", { parentId: "b" }),
      b: item("b", { parentId: "a" }),
    };
    expect(resolveAncestorLevelId("a", nodes).error).toBe("parent_cycle");
    expect(resolveItemPlanTransform("a", nodes).status).toBe("error");
  });
  it("zoom extents changes only viewBox data, never world dimensions or transforms", () => {
    const n = item("a", {
      parentId: "l",
      position: [4, 0, 7],
      scale: [2, 1, 3],
    });
    const nodes: any = { l: { id: "l", type: "level" }, a: n };
    const before = JSON.stringify(n);
    const small = zoomExtents([
      { x: 0, z: 0 },
      { x: 10, z: 10 },
    ]);
    const large = zoomExtents([
      { x: -20, z: -20 },
      { x: 20, z: 20 },
    ]);
    expect(finalDimensions(n)).toEqual({ width: 4, height: 1, depth: 12 });
    expect(resolveItemPlanTransform("a", nodes)).toMatchObject({ x: 4, z: 7 });
    expect(small).not.toEqual(large);
    expect(JSON.stringify(n)).toBe(before);
  });
  it("image load state cannot affect the geometry inputs", () => {
    const n = item("a", { parentId: "l" });
    const nodes: any = { l: { id: "l", type: "level" }, a: n };
    const before = {
      dimensions: finalDimensions(n),
      transform: resolveItemPlanTransform("a", nodes),
    };
    n.asset.floorPlanUrl = "https://example.test/failed.png";
    expect({
      dimensions: finalDimensions(n),
      transform: resolveItemPlanTransform("a", nodes),
    }).toEqual(before);
  });
  it("uses one Pascal-to-SVG matrix for PNG, footprint and local +Z", () => {
    const t: any = {
      x: 3,
      z: 4,
      rotationY: Math.PI / 2,
      status: "ok",
      sourceNodeIds: [],
    };
    const m = composePascalTransformWithWorldToSvg(t);
    expect(m.a).toBeCloseTo(0);
    expect(m.b).toBeCloseTo(-1);
    expect(m.c).toBeCloseTo(1);
    expect(m.d).toBeCloseTo(0);
    expect(m.e).toBe(3);
    expect(m.f).toBe(4);
    expect(m.c).toBeCloseTo(1);
    expect(m.d).toBeCloseTo(0);
  });
  it("does not apply asset corrective transforms to floorplan rotation", () => {
    const nodes: any = {
      l: { id: "l", type: "level" },
      a: item("a", {
        parentId: "l",
        rotation: [0, 0.3, 0],
        asset: {
          dimensions: [2, 1, 4],
          rotation: [0, 1.2, 0],
          offset: [3, 0, 2],
          scale: [9, 9, 9],
        },
      }),
    };
    expect(resolveItemPlanTransform("a", nodes).rotationY).toBeCloseTo(0.3);
  });
  it("exports a per-item Pascal reference matrix table", () => {
    const nodes: any = {
      l: { id: "l", type: "level" },
      a: item("a", {
        parentId: "l",
        position: [3, 0, 4],
        rotation: [0, Math.PI / 2, 0],
      }),
    };
    const row = buildPascalMatrixReport(nodes)[0];
    expect(row).toMatchObject({
      itemId: "a",
      ancestorLevelId: "l",
      assetSpecificCorrection: "none",
      resolvedWorldX: 3,
      resolvedWorldZ: 4,
    });
    expect(row.finalSvgMatrix?.c).toBeCloseTo(1);
  });
  it("maps drag movement through the inverse canvas rotation", () => {
    const zero = rotatedPanDelta(2, 0, 0);
    expect(zero.x).toBeCloseTo(-2);
    expect(zero.z).toBeCloseTo(0);
    expect(rotatedPanDelta(2, 0, 90).x).toBeCloseTo(0);
    expect(rotatedPanDelta(2, 0, 90).z).toBeCloseTo(2);
    expect(rotatedPanDelta(2, 0, 180).x).toBeCloseTo(2);
    expect(rotatedPanDelta(2, 0, 270).z).toBeCloseTo(-2);
  });
  it("keeps the world point beneath the cursor fixed while zooming", () => {
    const before = { minX: -4, minZ: -2, width: 12, height: 8 };
    const anchor = { x: 3, z: 1 };
    const after = zoomViewBoxAtPoint(before, anchor, 0.8);
    expect((anchor.x - after.minX) / after.width).toBeCloseTo((anchor.x - before.minX) / before.width);
    expect((anchor.z - after.minZ) / after.height).toBeCloseTo((anchor.z - before.minZ) / before.height);
  });
});
