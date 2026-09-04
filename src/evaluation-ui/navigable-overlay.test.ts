import { describe, expect, it } from "vitest";
import { buildReachableAreaRects } from "./navigable-overlay";

describe("reachable-area overlay", () => {
  it("merges adjacent room-local grid cells without using the global origin", () => {
    const points: Array<[number, number]> = [
      [0.045, 0.075], [0.145, 0.075],
      [0.045, 0.175], [0.145, 0.175],
    ];
    expect(buildReachableAreaRects(points, 0.1)).toEqual([
      { x: -0.0050000000000000044, z: 0.024999999999999994, width: 0.2, height: 0.2 },
    ]);
  });

  it("keeps a genuine disconnected cell separate", () => {
    const rectangles = buildReachableAreaRects([[0, 0], [0.1, 0], [0.3, 0]], 0.1);
    expect(rectangles).toHaveLength(2);
    expect(rectangles.map((rectangle) => rectangle.width)).toEqual([0.2, 0.1]);
  });

  it("returns no display geometry for invalid input", () => {
    expect(buildReachableAreaRects([], 0.1)).toEqual([]);
    expect(buildReachableAreaRects([[0, 0]], 0)).toEqual([]);
  });
});
