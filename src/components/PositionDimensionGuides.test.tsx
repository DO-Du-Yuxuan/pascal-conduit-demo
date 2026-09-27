import { describe, expect, it } from "vitest";
import { dimensionLabelStackOffset, dimensionLinePoints } from "./PositionDimensionGuides";

describe("position dimension line geometry", () => {
  it("uses the same ray as a selected point's physical hit", () => {
    const guide = { key: "up", start: [1, 1, 0] as [number, number, number], end: [1, 1.407, 0] as [number, number, number], label: "407 mm", offset: [0, 0, 0] as [number, number, number] };
    const line = dimensionLinePoints(guide);
    expect(line.start).toEqual(guide.start);
    expect(line.end).toEqual(guide.end);
    expect(Math.round(Math.hypot(...line.end.map((value, axis) => value - line.start[axis]!) as [number, number, number]) * 1000)).toBe(407);
  });

  it("keeps the existing offset for other construction dimension guides", () => {
    const line = dimensionLinePoints({ key: "duct", start: [0, 1, 0], end: [2, 1, 0], label: "2 m" });
    expect(line.start).toEqual([0, 0.94, 0]);
    expect(line.end).toEqual([2, 0.94, 0]);
  });

  it("lifts a floor dimension for display without changing its measured length", () => {
    const guide = { key: "v+", start: [1, .05, 0] as [number, number, number], end: [1, .05, .55] as [number, number, number], label: "551 mm", offset: [0, .025, 0] as [number, number, number] };
    const line = dimensionLinePoints(guide);
    expect(line.start[0]).toBe(1);
    expect(line.start[1]).toBeCloseTo(.075);
    expect(line.start[2]).toBe(0);
    expect(line.end[0]).toBe(1);
    expect(line.end[1]).toBeCloseTo(.075);
    expect(line.end[2]).toBe(.55);
    expect(Math.hypot(line.end[0] - line.start[0], line.end[1] - line.start[1], line.end[2] - line.start[2])).toBeCloseTo(.55);
  });

  it("assigns symmetric, distinct stable label lanes", () => {
    const offsets = Array.from({ length: 4 }, (_, index) => dimensionLabelStackOffset(index, 4));
    expect(offsets).toEqual([-33, -11, 11, 33]);
    expect(new Set(offsets).size).toBe(offsets.length);
  });
});
