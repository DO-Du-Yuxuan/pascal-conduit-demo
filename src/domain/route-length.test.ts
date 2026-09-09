import { describe, expect, it } from "vitest";
import { formatRouteLengthMm, routeSegmentLengthMm, routeSweepLengthMm } from "./route-length";

describe("route segment length", () => {
  it("measures the true three-dimensional centreline in millimetres", () => {
    expect(routeSegmentLengthMm({ start: { position: [0, 0, 0] }, end: { position: [3, 4, 12] } })).toBe(13_000);
  });

  it("formats displayed lengths as rounded millimetres", () => {
    expect(formatRouteLengthMm(1234.6)).toBe("1,235 mm");
  });

  it("counts a tangent sweep by its centreline arc length", () => {
    expect(routeSweepLengthMm({ arc: { start: [1, 0, 0], end: [0, 1, 0], center: [0, 0, 0], normal: [0, 0, 1], sweepRadians: Math.PI / 2 } })).toBeCloseTo(1570.8, 1);
  });
});
