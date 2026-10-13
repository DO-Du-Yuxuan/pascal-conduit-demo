import { describe, expect, it } from "vitest";
import { createBeam } from "../domain/beams";
import type { NodeData } from "../types";
import { resolveEffectiveBuildingParameters, resolveSlabVerticalRange } from "./effective-building";

const polygon: [number, number][] = [[0, 0], [4, 0], [4, 3], [0, 3]];

describe("effective building read model", () => {
  it("uses explicit slab thickness without rewriting legacy elevation semantics", () => {
    expect(resolveSlabVerticalRange({ id: "modern", type: "slab", elevation: .35, thickness: .05 })).toMatchObject({ top: .35, thickness: .05 });
    expect(resolveSlabVerticalRange({ id: "modern", type: "slab", elevation: .35, thickness: .05 }).bottom).toBeCloseTo(.3);
    expect(resolveSlabVerticalRange({ id: "legacy", type: "slab", elevation: -.2 })).toEqual({ bottom: -.2, top: 0, thickness: .2 });
  });

  it("resolves Builder opening defaults while preserving explicit values and raw nodes", () => {
    const nodes: Record<string, NodeData> = {
      level: { id: "level", type: "Level", height: 4.2, baseElevation: 0 },
      door: { id: "door", type: "Door", parentId: "wall" },
      window: { id: "window", type: "Window", parentId: "wall", width: 1.8, height: 1.2 },
      wall: { id: "wall", type: "Wall", parentId: "level", start: [0, 0], end: [4, 0] },
    };
    const before = structuredClone(nodes);
    const effective = resolveEffectiveBuildingParameters(nodes);

    expect(effective.door).toMatchObject({
      width: { raw: null, value: 0.9, source: "builder-default" },
      height: { raw: null, value: 2.1, source: "builder-default" },
    });
    expect(effective.window).toMatchObject({
      width: { raw: 1.8, value: 1.8, source: "explicit" },
      height: { raw: 1.2, value: 1.2, source: "explicit" },
    });
    expect(effective.wall).toMatchObject({
      height: { raw: null, value: 4.2, source: "level-plane" },
      thickness: { raw: null, value: 0.1, source: "builder-default" },
    });
    expect(nodes).toEqual(before);
  });

  it("follows authored Level height for a missing Ceiling while keeping Beam's raw 2.7m basis", () => {
    const nodes: Record<string, NodeData> = {
      level: { id: "level", type: "level", height: 4.2, baseElevation: 0 },
      ceiling: { id: "ceiling", type: "ceiling", parentId: "level", polygon },
      slab: { id: "slab", type: "slab", parentId: "level", polygon, elevation: 0.05, thickness: 0.05, recessed: false },
      wall: { id: "wall", type: "wall", parentId: "level", start: [0, 0], end: [4, 0] },
    };
    const before = structuredClone(nodes);
    const effective = resolveEffectiveBuildingParameters(nodes);

    expect(effective.ceiling).toMatchObject({
      height: { raw: null, value: 4.19, source: "level-plane" },
      editorFollowHeight: { raw: null, value: 4.19, source: "level-plane" },
    });
    expect(effective.wall?.height?.value).toBe(4.2);
    const beam = createBeam(nodes, { id: "beam", name: "梁", levelId: "level", start: [0.5, 1], end: [3.5, 1] });
    expect(beam.beam?.effectiveCeilingElevation).toEqual({ meters: 2.7, basis: "derived-default-2700mm" });
    expect(nodes).toEqual(before);
    expect(nodes.ceiling).not.toHaveProperty("height");
  });

  it("uses 2.5m for legacy Levels without stored height and separates slab thickness from elevation", () => {
    const nodes: Record<string, NodeData> = {
      level: { id: "level", type: "level" },
      ceiling: { id: "ceiling", type: "ceiling", parentId: "level", polygon },
      legacy: { id: "legacy", type: "slab", parentId: "level", polygon, elevation: -0.08 },
      explicit: { id: "explicit", type: "slab", parentId: "level", polygon, elevation: 0.05, thickness: 0.12 },
    };
    const effective = resolveEffectiveBuildingParameters(nodes);
    expect(effective.ceiling?.height).toEqual({ raw: null, value: 2.5, source: "builder-default" });
    expect(effective.legacy).toMatchObject({
      height: { raw: -0.08, value: -0.08, source: "explicit" },
      thickness: { raw: null, value: 0.08, source: "legacy-elevation" },
    });
    expect(effective.explicit?.thickness).toEqual({ raw: 0.12, value: 0.12, source: "explicit" });
  });
});
