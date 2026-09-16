import { describe, expect, it } from "vitest";
import { getWallCurveFrameAt } from "../geometry/walls/curve";
import { beamClearances, editBeamClearance, snapBeamPoint } from "./beam-positioning";
import { createBeam, editBeam } from "./beams";

const nodes: any = { level: { id: "level", type: "level" }, ceiling: { id: "ceiling", type: "ceiling", parentId: "level", polygon: [[-2, -2], [12, -2], [12, 12], [-2, 12]] }, left: { id: "left", type: "wall", parentId: "level", start: [0, 0], end: [10, 0], thickness: .2 }, right: { id: "right", type: "wall", parentId: "level", start: [0, 4], end: [10, 4], thickness: .2 }, start: { id: "start", type: "wall", parentId: "level", start: [0, 0], end: [0, 4], thickness: .2 }, end: { id: "end", type: "wall", parentId: "level", start: [8, 0], end: [8, 4], thickness: .2 }, column: { id: "column", type: "column", parentId: "level", position: [6, 0, 2], width: .4, depth: .4 } };
describe("Beam physical positioning", () => {
  it("snaps only to physical Wall, Column, and Beam faces with a deterministic identity", () => {
    expect(snapBeamPoint(nodes, "level", [3, .13])?.target).toMatchObject({ id: "left", kind: "wall" });
    expect(snapBeamPoint(nodes, "level", [6.15, 2])?.target).toMatchObject({ id: "column", kind: "column" });
    expect(snapBeamPoint(nodes, "level", [3, 1], .05)).toBeNull();
  });
  it("uses tessellated physical curved-Wall faces and existing angled Beam faces, never their centrelines", () => {
    const curved = { ...nodes, curve: { id: "curve", type: "wall", parentId: "level", start: [0, 6], end: [4, 6], curveOffset: 1, thickness: .2 } };
    const angled = createBeam(curved, { id: "angled", name: "斜梁", levelId: "level", start: [7, 1], end: [9, 3], width: .4 }).beam!;
    const frame = getWallCurveFrameAt(curved.curve as any, .5), surface: [number, number] = [frame.point.x + frame.normal.x * .1, frame.point.y + frame.normal.y * .1];
    expect(snapBeamPoint({ ...curved, angled }, "level", surface, .03)?.target).toMatchObject({ id: "curve", kind: "wall" });
    const snapped = snapBeamPoint({ ...curved, angled }, "level", [7.14, .86], .1)!;
    expect(snapped.target).toMatchObject({ id: "angled", kind: "beam" });
    const axis = [snapped.target.end[0] - snapped.target.start[0], snapped.target.end[1] - snapped.target.start[1]], offset = [snapped.point[0] - snapped.target.start[0], snapped.point[1] - snapped.target.start[1]];
    expect(axis[0] * offset[1] - axis[1] * offset[0]).toBeCloseTo(0, 9);
  });
  it("uses nearest parallel physical faces as side and end witnesses and edits them at 5 mm", () => {
    const beam = createBeam(nodes, { id: "beam", name: "梁", levelId: "level", start: [1, 1], end: [5, 1], width: .3 }).beam!;
    const clearances = beamClearances({ ...nodes, beam }, beam);
    expect(clearances).toMatchObject([{ edge: "left", meters: 2.75, witness: { id: "right" } }, { edge: "right", meters: .75, witness: { id: "left" } }, { edge: "start", meters: .9, witness: { id: "start" } }, { edge: "end", meters: 2.9, witness: { id: "end" } }]);
    expect(editBeamClearance({ ...nodes, beam }, beam, "left", 2.9026).beam).toMatchObject({ start: [1, .845], end: [5, .845] });
    expect(editBeamClearance({ ...nodes, beam }, beam, "end", 2.0026).beam?.end).toEqual([5.8950000000000005, 1]);
  });
  it("omits unreliable source geometry and never uses a Column as a clearance witness", () => {
    const incomplete = { ...nodes, left: { ...nodes.left, thickness: undefined }, column: { ...nodes.column, width: undefined, depth: undefined } };
    expect(snapBeamPoint(incomplete, "level", [3, 0], .2)).toBeNull();
    const beam = createBeam(nodes, { id: "beam", name: "梁", levelId: "level", start: [1, 2], end: [5, 2], width: .3 }).beam!;
    expect(beamClearances({ ...nodes, beam }, beam).some((item) => item.witness.kind === "column")).toBe(false);
    expect(snapBeamPoint({ ...nodes, column: { ...nodes.column, position: undefined } }, "level", [6, 2], .3)).toBeNull();
    expect(snapBeamPoint({ ...nodes, column: { ...nodes.column, position: undefined }, left: { ...nodes.left, thickness: undefined }, start: { ...nodes.start, thickness: undefined } }, "level", [0, 0], .3)).toBeNull();
  });
  it("preserves an endpoint resolved along an angled physical face through the Beam edit constructor", () => {
    const obstacle = createBeam(nodes, { id: "obstacle", name: "障碍梁", levelId: "level", start: [6, 1], end: [8, 3], width: .4 }).beam!;
    const beam = createBeam({ ...nodes, obstacle }, { id: "beam", name: "梁", levelId: "level", start: [1, 1], end: [5, 1] }).beam!;
    const snap = snapBeamPoint({ ...nodes, obstacle, beam }, "level", [5.86, 1.14], .25, beam.id)!;
    const edited = editBeam({ ...nodes, obstacle, beam }, beam, { end: snap.point, surfaceResolved: true }).beam!;
    const face = snap.target, axis = [face.end[0] - face.start[0], face.end[1] - face.start[1]], offset = [edited.end[0] - face.start[0], edited.end[1] - face.start[1]];
    expect(axis[0] * offset[1] - axis[1] * offset[0]).toBeCloseTo(0, 9);
  });
});
