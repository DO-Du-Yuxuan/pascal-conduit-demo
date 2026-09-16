import { describe, expect, it } from "vitest";
import { constrainBeamEnd, createBeam, DERIVED_CEILING_ELEVATION_METERS, editBeam, nudgeBeamLaterally, quantizeBeamMeters, resizeBeamLength, translateBeam, validateBeam } from "./beams";

const nodes: any = { level: { id: "level", type: "level" }, explicit: { id: "explicit", type: "ceiling", parentId: "level", height: 3, polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] }, derived: { id: "derived", type: "ceiling", parentId: "level", polygon: [[4, 0], [8, 0], [8, 4], [4, 4]] } };
describe("Demo Beam", () => {
  it("creates a valid angled Beam from same-elevation Ceiling hosts", () => { const result = createBeam(nodes, { id: "beam-1", name: "梁 1", levelId: "level", start: [0, 1], end: [3, 3] }); expect(result).toMatchObject({ valid: true, beam: { width: .3, height: .5, effectiveCeilingElevation: { meters: 3, basis: "explicit-ceiling-height" } } }); });
  it("retains derived elevation evidence", () => { const result = createBeam(nodes, { id: "beam-1", name: "梁 1", levelId: "level", start: [5, 1], end: [7, 3] }); expect(result.beam?.effectiveCeilingElevation).toEqual({ meters: DERIVED_CEILING_ELEVATION_METERS, basis: "derived-default-2700mm" }); });
  it("rejects hostless and conflicting-height spans without creating a Beam", () => { expect(createBeam(nodes, { id: "none", name: "梁", levelId: "level", start: [10, 0], end: [11, 0] }).valid).toBe(false); expect(createBeam(nodes, { id: "mixed", name: "梁", levelId: "level", start: [1, 1], end: [7, 1] }).diagnostics).toContain("Beam 不能跨越不同有效标高的 Ceiling。"); });
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
