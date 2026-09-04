import { describe, expect, it } from "vitest";
import defaultLayout from "../../sample-data/default-layout.json";
import { parseBuilding } from "./building";

describe("default Pascal base drawing", () => {
  it("keeps the supplied single-level layout as the empty demo base", () => {
    const building = parseBuilding(defaultLayout);
    const counts = Object.values(building.nodes).reduce<Record<string, number>>((result, node) => {
      result[node.type] = (result[node.type] ?? 0) + 1;
      return result;
    }, {});
    expect(building.rootNodeIds).not.toHaveLength(0);
    expect(building.levelIds).toHaveLength(1);
    expect(counts.wall).toBe(48);
    expect(counts.curvedWall ?? 0).toBe(0);
    expect(Object.values(building.nodes).filter((node) => node.type === "wall" && typeof node.curveOffset === "number" && Math.abs(node.curveOffset) > 1e-9)).toHaveLength(6);
    expect(counts.slab).toBe(6);
    expect(counts.ceiling).toBe(6);
    expect(counts.item).toBe(44);
  });
});
