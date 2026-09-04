import { describe, expect, it } from "vitest";
import { buildSlabPlanGeometry } from "./slab";

describe("slab plan geometry", () => {
  it("creates one evenodd path and subtracts all valid hole rings", () => {
    const geometry = buildSlabPlanGeometry({ id: "slab", type: "slab", polygon: [[0, 0], [5, 0], [5, 4], [0, 4]], holes: [[[1, 1], [3, 1], [3, 2], [1, 2]]] } as any)!;
    expect(geometry.path.match(/M /g)).toHaveLength(2);
    expect(geometry.outerArea).toBe(20);
    expect(geometry.holeArea).toBe(2);
    expect(geometry.netArea).toBe(18);
  });
  it("does not fabricate geometry for a malformed outer ring", () => {
    expect(buildSlabPlanGeometry({ id: "slab", type: "slab", polygon: [[0, 0], [1, 0]] } as any)).toBeNull();
  });
});
