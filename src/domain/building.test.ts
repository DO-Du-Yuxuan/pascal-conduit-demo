import { describe, expect, it } from "vitest";
import { parseBuilding } from "./building";

describe("building import", () => {
  it("derives roots when source roots are absent", () => {
    const building = parseBuilding({ nodes: { site: { id: "site", type: "site" }, wall: { id: "wall", type: "wall", parentId: "site" } } });
    expect(building.rootNodeIds).toEqual(["site"]);
    expect(building.diagnostics).toHaveLength(1);
  });
});
