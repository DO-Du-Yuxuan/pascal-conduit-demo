import { describe, expect, it } from "vitest";
import { constrainToHostAxes, previewRoutePoints } from "./drawing";
import type { RoutePoint } from "./overlay";

const wall = (position: [number, number, number]): RoutePoint => ({ position, attachment: { hostId: "wall", hostKind: "wall", surface: "interior", normal: [0, 0, 1], levelId: "L0", basis: { u: [1, 0, 0], v: [0, 1, 0] }, localPosition: position } });
const slab = (position: [number, number, number]): RoutePoint => ({ position, attachment: { hostId: "slab", hostKind: "slab", surface: "top", normal: [0, 1, 0], levelId: "L0", basis: { u: [1, 0, 0], v: [0, 0, 1] }, localPosition: position } });

describe("surface drawing preview", () => {
  it("uses the wall's local horizontal or vertical axis, never a world dominant axis", () => {
    expect(constrainToHostAxes(wall([0, 1, 0]), wall([3, 2, 0]), "orthogonal").position).toEqual([3, 1, 0]);
    expect(constrainToHostAxes(wall([0, 1, 0]), wall([1, 4, 0]), "orthogonal").position).toEqual([0, 4, 0]);
  });

  it("uses local floor axes and keeps free mode untouched", () => {
    expect(constrainToHostAxes(slab([0, 0, 0]), slab([3, 0, 1]), "orthogonal").position).toEqual([3, 0, 0]);
    expect(constrainToHostAxes(slab([0, 0, 0]), slab([3, 0, 1]), "free").position).toEqual([3, 0, 1]);
  });

  it("adds a cursor-only preview without mutating confirmed route points", () => {
    const confirmed = [slab([0, 0, 0])];
    const preview = previewRoutePoints(confirmed, slab([2, 0, 1]), "orthogonal");
    expect(preview).toHaveLength(2);
    expect(preview[1].position).toEqual([2, 0, 0]);
    expect(confirmed).toHaveLength(1);
  });

  it("uses Shift as a temporary inverse of the chosen direction mode", () => {
    expect(previewRoutePoints([slab([0, 0, 0])], slab([2, 0, 1]), "free", true)[1].position).toEqual([2, 0, 0]);
    expect(previewRoutePoints([slab([0, 0, 0])], slab([2, 0, 1]), "orthogonal", true)[1].position).toEqual([2, 0, 1]);
  });
});
