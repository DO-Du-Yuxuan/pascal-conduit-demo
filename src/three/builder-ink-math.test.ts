import { describe, expect, it } from "vitest";
import { builderDepthEdge, builderInkMask, builderNormalEdge } from "./builder-ink-math";

describe("Builder screen-space ink signals", () => {
  it("leaves flat depth fields and coplanar normals uninked", () => {
    expect(builderDepthEdge(0.4, 0.4, 0.4, 0.4, 0.4)).toBe(0);
    expect(builderNormalEdge([0, 0, 1], [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]])).toBe(0);
  });

  it("detects both a depth discontinuity and a sharp normal crease", () => {
    expect(builderDepthEdge(0.5, 0.2, 0.5, 0.5, 0.5)).toBeGreaterThan(0.2);
    expect(builderNormalEdge([0, 0, 1], [[1, 0, 0], [0, 0, 1], [0, 0, 1], [0, 0, 1]])).toBe(1);
  });

  it("uses the requested half-opacity for soft ink and clamps its mask", () => {
    expect(builderInkMask(0.8, 0, 0.5)).toBeCloseTo(0.4);
    expect(builderInkMask(1, 1, 2)).toBe(1);
  });
});
