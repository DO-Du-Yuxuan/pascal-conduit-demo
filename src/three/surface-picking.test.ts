import { describe, expect, it } from "vitest";
import { isFrontmostSurfaceEvent } from "./surface-picking";

describe("3D host surface picking", () => {
  it("accepts only the nearest visible intersection", () => {
    const front = {}, rear = {};
    const intersections = [{ object: front }, { object: rear }];
    expect(isFrontmostSurfaceEvent({ object: front, intersections })).toBe(true);
    expect(isFrontmostSurfaceEvent({ object: rear, intersections })).toBe(false);
  });

  it("does not select a rear wall through a door or window mesh", () => {
    const opening = {}, rearWall = {};
    expect(isFrontmostSurfaceEvent({ object: rearWall, intersections: [{ object: opening }, { object: rearWall }] })).toBe(false);
  });
});
