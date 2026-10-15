import { describe, expect, it } from "vitest";
import { beamTopElevationMeters, constrainBeamEnd, createBeam, createSupportedBeam, DERIVED_CEILING_ELEVATION_METERS, editBeam, nudgeBeamLaterally, quantizeBeamMeters, resizeBeamLength, translateBeam, validateBeam } from "./beams";

const nodes: any = { level: { id: "level", type: "level" }, explicit: { id: "explicit", type: "ceiling", parentId: "level", height: 3, polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] }, derived: { id: "derived", type: "ceiling", parentId: "level", polygon: [[4, 0], [8, 0], [8, 4], [4, 4]] } };
describe("Demo Beam", () => {
  const supportedNodes: any = {
    level: { id: "level", type: "level", height: 2.7 },
    wallStart: { id: "wallStart", type: "wall", parentId: "level", start: [0, -1], end: [0, 4], height: 2.5, thickness: .1 },
    wallEnd: { id: "wallEnd", type: "wall", parentId: "level", start: [4, -1], end: [4, 4], height: 2.5, thickness: .1 },
    lowerCeiling: { id: "lowerCeiling", type: "ceiling", parentId: "level", height: 2.49, polygon: [[-2, -2], [5, -2], [5, 5], [-2, 5]] },
  };
  const supportedSnap = (point: [number, number], id: string, face: "side-a" | "side-b" | "end-a" | "end-b" = "side-a", kind: "wall" | "column" | "beam" = "wall") => ({ point, distance: 0, target: { id, kind, face, start: point, end: point } });
  it("creates supported Beams without Ceiling geometry and stores wall-top evidence", () => {
    const { lowerCeiling: _ceiling, ...withoutCeiling } = supportedNodes;
    const result = createSupportedBeam(withoutCeiling, { id: "supported", name: "梁", levelId: "level", start: supportedSnap([.05, 1], "wallStart"), end: supportedSnap([3.95, 1], "wallEnd", "side-b"), width: .1 });
    expect(result).toMatchObject({ valid: true, beam: { width: .1, height: .5, ceilingIds: [], topElevation: { meters: 2.5, basis: "wall-top", sourceWallId: "wallStart", measurementBasis: "explicit" }, supports: { start: { objectId: "wallStart", kind: "wall", face: "side-a" }, end: { objectId: "wallEnd", kind: "wall", face: "side-b" } } } });
    expect(result.beam).not.toHaveProperty("effectiveCeilingElevation");
  });
  it("uses resolved wall height with explicit or derived evidence, independently of Ceiling height", () => {
    const derived = { ...supportedNodes, wallStart: { ...supportedNodes.wallStart, height: undefined }, wallEnd: { ...supportedNodes.wallEnd, height: 2.7 } };
    const result = createSupportedBeam(derived, { id: "derived", name: "梁", levelId: "level", start: supportedSnap([.05, 1], "wallStart"), end: supportedSnap([3.95, 1], "wallEnd", "side-b") });
    expect(result).toMatchObject({ valid: true, beam: { topElevation: { meters: 2.7, measurementBasis: "derived" } } });
    expect(beamTopElevationMeters(result.beam!)).toBe(2.7);
  });
  it("accepts an endpoint on a simple rectangular Column whose physical top matches the Wall", () => {
    const column = { id: "column", type: "column", parentId: "level", position: [4.2, 0, 1], width: .44, depth: .44, height: 2.5, baseStyle: "none", capitalStyle: "none", crossSection: "square", shaftProfile: "straight", shaftStartScale: 1, shaftEndScale: 1, shaftCornerRadius: .01, ringCount: 0, latheRingCount: 0 };
    const result = createSupportedBeam({ ...supportedNodes, column }, { id: "column-supported", name: "梁", levelId: "level", start: supportedSnap([.05, 1], "wallStart"), end: supportedSnap([3.98, 1], "column", "end-b", "column") });
    expect(result).toMatchObject({ valid: true, beam: { supports: { end: { objectId: "column", kind: "column", face: "end-b" } }, topElevation: { meters: 2.5 } } });
  });
  it("rejects free or Ceiling-only ends, unequal tops, and cross-Level supports", () => {
    const freeEnd: any = { point: [2, 2], distance: 0, target: { id: "free", kind: "ceiling-edge", face: "side-a", start: [2, 2], end: [2, 2] } };
    expect(createSupportedBeam(supportedNodes, { id: "free", name: "梁", levelId: "level", start: supportedSnap([.05, 1], "wallStart"), end: freeEnd }).valid).toBe(false);
    const unequal = { ...supportedNodes, wallEnd: { ...supportedNodes.wallEnd, height: 2.49 } };
    expect(createSupportedBeam(unequal, { id: "unequal", name: "梁", levelId: "level", start: supportedSnap([.05, 1], "wallStart"), end: supportedSnap([3.95, 1], "wallEnd", "side-b") }).diagnostics).toContain("Beam 两端支承的有效顶标高必须相同。");
    const crossLevel = { ...supportedNodes, other: { id: "other", type: "level" }, wallEnd: { ...supportedNodes.wallEnd, parentId: "other" } };
    expect(createSupportedBeam(crossLevel, { id: "cross-level", name: "梁", levelId: "level", start: supportedSnap([.05, 1], "wallStart"), end: supportedSnap([3.95, 1], "wallEnd", "side-b") }).valid).toBe(false);
  });
  it("preserves supported evidence and unknown fields when editing, rejecting endpoints off their support", () => {
    const created = createSupportedBeam(supportedNodes, { id: "edit", name: "梁", levelId: "level", start: supportedSnap([.05, 1], "wallStart"), end: supportedSnap([3.95, 1], "wallEnd", "side-b") }).beam!;
    const withUnknown = { ...created, futureField: { retained: true } } as any;
    expect(editBeam({ ...supportedNodes, edit: withUnknown }, withUnknown, { width: .2 })).toMatchObject({ valid: true, beam: { width: .2, futureField: { retained: true }, supports: withUnknown.supports, topElevation: withUnknown.topElevation } });
    expect(editBeam({ ...supportedNodes, edit: withUnknown }, withUnknown, { end: [2, 2] })).toMatchObject({ valid: false });
  });
  it("creates a valid angled Beam from same-elevation Ceiling hosts", () => { const result = createBeam(nodes, { id: "beam-1", name: "梁 1", levelId: "level", start: [0, 1], end: [3, 3] }); expect(result).toMatchObject({ valid: true, beam: { width: .3, height: .5, effectiveCeilingElevation: { meters: 3, basis: "explicit-ceiling-height" } } }); });
  it("retains derived elevation evidence", () => { const result = createBeam(nodes, { id: "beam-1", name: "梁 1", levelId: "level", start: [5, 1], end: [7, 3] }); expect(result.beam?.effectiveCeilingElevation).toEqual({ meters: DERIVED_CEILING_ELEVATION_METERS, basis: "derived-default-2700mm" }); });
  it("rejects hostless and conflicting-height spans without creating a Beam", () => { expect(createBeam(nodes, { id: "none", name: "梁", levelId: "level", start: [10, 0], end: [11, 0] }).valid).toBe(false); expect(createBeam(nodes, { id: "mixed", name: "梁", levelId: "level", start: [1, 1], end: [7, 1] }).diagnostics).toContain("Beam 不能跨越不同有效标高的 Ceiling。"); });
  it("permits only an explicit elevation crossing and retains the start Ceiling elevation", () => {
    const result = createBeam(nodes, { id: "cross", name: "跨越梁", levelId: "level", start: [1, 1], end: [7, 1], explicitCeilingCrossing: true });
    expect(result).toMatchObject({ valid: true, beam: { explicitCeilingCrossing: true, effectiveCeilingElevation: { meters: 3, basis: "explicit-ceiling-height" } } });
    expect(editBeam({ ...nodes, cross: result.beam! }, result.beam!, { width: .45 })).toMatchObject({ valid: true, beam: { width: .45, explicitCeilingCrossing: true } });
  });
  it("edits the section of an imported explicit-crossing Beam without reclassifying its Ceiling evidence", () => {
    const result = createBeam(nodes, { id: "cross", name: "跨越梁", levelId: "level", start: [1, 1], end: [7, 1], explicitCeilingCrossing: true });
    expect(editBeam({ ...nodes, cross: result.beam! }, result.beam!, { width: .9, height: .8 })).toMatchObject({ valid: true, beam: { width: .9, height: .8, explicitCeilingCrossing: true, ceilingIds: ["explicit", "derived"] } });
  });
  it("permits gaps but rejects mixed elevation evidence and incomplete imported host identities", () => {
    const { derived: _derived, ...gapBase } = nodes, gapNodes = { ...gapBase, same: { id: "same", type: "ceiling", parentId: "level", height: 3, polygon: [[6, 0], [8, 0], [8, 4], [6, 4]] } };
    const result = createBeam(gapNodes, { id: "gap", name: "梁", levelId: "level", start: [1, 1], end: [7, 1] });
    expect(result).toMatchObject({ valid: true, beam: { ceilingIds: ["explicit", "same"] } });
    expect(validateBeam({ ...result.beam!, ceilingIds: ["explicit"] }, gapNodes).valid).toBe(false);
    expect(createBeam({ ...nodes, explicit: { ...nodes.explicit, height: 2.7 } }, { id: "basis", name: "梁", levelId: "level", start: [1, 1], end: [7, 1] }).diagnostics).toContain("Beam 不能混用明确和推导的 Ceiling 标高依据。");
  });
  it("keeps invalid imported Beam records outside the valid model", () => { expect(validateBeam({ id: "bad", type: "beam", parentId: "level", start: [0, 0], end: [0, 0], width: 0, height: 0, ceilingIds: [], effectiveCeilingElevation: { meters: 0, basis: "derived-default-2700mm" } }, nodes)).toMatchObject({ valid: false, beam: null }); });
  it("keeps free angles and applies Shift horizontal orthogonality without mutating a Beam", () => { expect(constrainBeamEnd([1, 1], [4, 3], false)).toEqual([4, 3]); expect(constrainBeamEnd([1, 1], [4, 3], true)).toEqual([4, 1]); expect(constrainBeamEnd([1, 1], [2, 5], true)).toEqual([1, 5]); });
  it("edits one Beam at 5 mm precision while recomputing its Ceiling evidence", () => {
    const beam = createBeam(nodes, { id: "beam", name: "梁 1", levelId: "level", start: [.002, 1.002], end: [3.003, 1.002] }).beam!;
    expect(quantizeBeamMeters(-.0026)).toBe(-.005);
    expect(editBeam({ ...nodes, beam }, beam, { name: "入口梁", width: .3026, height: .4976 })).toMatchObject({ valid: true, beam: { name: "入口梁", width: .305, height: .5 } });
    expect(resizeBeamLength({ ...nodes, beam }, beam, 2.9976).beam?.end).toEqual([3, 1]);
    expect(nudgeBeamLaterally({ ...nodes, beam }, beam, .1026).beam).toMatchObject({ start: [0, 1.105], end: [3.005, 1.105] });
  });

  it("keeps a whole-Beam translation rigid and rejects an invalid preview candidate without changing the source", () => {
    const beam = createBeam(nodes, { id: "beam", name: "梁 1", levelId: "level", start: [.5, .5], end: [2.5, 2.5] }).beam!;
    const translated = translateBeam({ ...nodes, beam }, beam, [.1026, -.1026]);
    expect(translated.beam).toMatchObject({ start: [.605, .395], end: [2.605, 2.395], width: .3, height: .5 });
    expect(Math.hypot(translated.beam!.end[0] - translated.beam!.start[0], translated.beam!.end[1] - translated.beam!.start[1])).toBeCloseTo(Math.hypot(2, 2));
    expect(editBeam({ ...nodes, beam }, beam, { start: [10, 10] })).toMatchObject({ valid: false, beam: null });
    expect(beam).toMatchObject({ start: [.5, .5], end: [2.5, 2.5], ceilingIds: ["explicit"] });
  });
});
