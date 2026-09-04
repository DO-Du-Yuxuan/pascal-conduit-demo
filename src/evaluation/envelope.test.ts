import { describe, expect, it } from "vitest";
import { buildBuildingEnvelopes, outsideFootprintArea, rectangularFootprint } from "./envelope";
import { ruleG1023 } from "./g1-rules";

const slab = (id: string, outline: number[][], holes: number[][][] = []) => ({ id, rawPascalId: id, levelId: "L1", visible: true, outline, holes, name: id });
const handoff = (slabs: any[], furniture: any[] = [], shelves: any[] = [], columns: any[] = []) => ({ levels: [{ id: "L1", rawPascalId: "L1", levelId: "L1" }], slabs, furniture, equipment: [], zones: [], spaces: [], walls: [], doors: [], windows: [], columns, shelves, stairs: [], shafts: [], relationships: {}, units: {}, diagnostics: [] }) as any;
const item = (id: string, x: number, z: number, width = 1, depth = 1) => ({ id, rawPascalId: id, name: id, levelId: "L1", category: "chairs", functionTags: ["chairs"], dimensionsMeters: [width, 1, depth], resolvedWorldPosition: [x, z], resolvedRotationRadians: 0 });
const shelf = (id: string, x: number, z: number) => ({ id, rawPascalId: id, name: "Shelf", parentId: "L1", levelId: "L1", visible: true, style: "open-rack", functionTags: ["open-rack"], dimensionsMeters: [1, 2, 1], footprint: [[x - .5, z - .5], [x + .5, z - .5], [x + .5, z + .5], [x - .5, z + .5]], rawPosition: [x, 0, z], rawRotation: [0, 0, 0], resolvedWorldPosition: [x, z], resolvedRotationRadians: 0, resolvedVerticalRangeMeters: [0, 2], transformStatus: "ok", transformError: null, rows: 4, columns: 2, withBack: false, withSides: true, withBottom: true, childItemIds: [] });

describe("building envelope and containment", () => {
  it("forms a single reliable boundary, preserves holes, and supports multiple components", () => {
    const envelope = buildBuildingEnvelopes(handoff([slab("a", [[0, 0], [10, 0], [10, 10], [0, 10]], [[[4, 4], [6, 4], [6, 6], [4, 6]]]), slab("b", [[20, 0], [22, 0], [22, 2], [20, 2]])]))[0]!;
    expect(envelope).toMatchObject({ usableForEvaluation: true, sourceType: "slab-union" });
    expect(envelope.polygons).toHaveLength(2);
    expect(envelope.holes).toHaveLength(1);
  });

  it("rejects self-intersecting and absent slab boundaries without fabricating a polygon", () => {
    expect(buildBuildingEnvelopes(handoff([slab("bow", [[0, 0], [2, 2], [0, 2], [2, 0]])]))[0]!.usableForEvaluation).toBe(false);
    expect(buildBuildingEnvelopes(handoff([]))[0]!).toMatchObject({ usableForEvaluation: false, sourceType: "none", polygons: [] });
  });

  it("distinguishes inside, edge contact, partial outside, and fully outside footprints", () => {
    const envelope = buildBuildingEnvelopes(handoff([slab("a", [[0, 0], [10, 0], [10, 10], [0, 10]])]))[0]!;
    expect(outsideFootprintArea(rectangularFootprint(item("inside", 5, 5))!, envelope)).toBe(0);
    expect(outsideFootprintArea(rectangularFootprint(item("edge", .5, 5))!, envelope)).toBe(0);
    expect(outsideFootprintArea(rectangularFootprint(item("partial", 0, 5))!, envelope)).toBeCloseTo(.5);
    expect(outsideFootprintArea(rectangularFootprint(item("outside", -3, 5))!, envelope)).toBeCloseTo(1);
  });

  it("uses the same clockwise Pascal rotation as the canvas furniture direction", () => {
    const rotated = { ...item("rotated", 0, 0, 2, 1), resolvedRotationRadians: Math.PI / 2 };
    const footprint = rectangularFootprint(rotated)!;
    expect(footprint[0]).toEqual([expect.closeTo(-.5), expect.closeTo(1)]);
    expect(footprint[1]).toEqual([expect.closeTo(-.5), expect.closeTo(-1)]);
    expect(footprint[2]).toEqual([expect.closeTo(.5), expect.closeTo(-1)]);
    expect(footprint[3]).toEqual([expect.closeTo(.5), expect.closeTo(1)]);
  });

  it("reports missing footprints and missing boundaries as unable to determine, while excluding vehicles", () => {
    const noFootprint = { ...item("unknown", 2, 2), dimensionsMeters: null }, vehicle = { ...item("car", -20, 0), category: "vehicles", functionTags: ["vehicles"] };
    expect(ruleG1023(handoff([], [noFootprint])).status).toBe("unable_to_determine");
    expect(ruleG1023(handoff([slab("a", [[0, 0], [10, 0], [10, 10], [0, 10]])], [vehicle])).status).toBe("not_applicable");
  });

  it("includes Shelf cabinet footprints in G1-023 containment", () => {
    const found = ruleG1023(handoff([slab("a", [[0, 0], [10, 0], [10, 10], [0, 10]])], [], [shelf("outside-shelf", 9.8, 5)]));
    expect(found).toMatchObject({ status: "issue", normalizedObjectIds: expect.arrayContaining(["outside-shelf"]), diagnostics: expect.arrayContaining([expect.objectContaining({ code: "item_outside_building_envelope" })]) });
    expect(found.measurements).toEqual(expect.arrayContaining([expect.objectContaining({ name: "participatingShelfCount", value: 1 })]));
  });

  it("does not let a fixture misclassified as columns bypass G1-023", () => {
    const misclassifiedSink = { ...item("sink-as-column", 9.8, 5), name: "Sink", category: "columns", functionTags: ["columns", "sinks"] };
    const found = ruleG1023(handoff([slab("a", [[0, 0], [10, 0], [10, 10], [0, 10]])], [], [], [misclassifiedSink]));
    expect(found).toMatchObject({ status: "issue", normalizedObjectIds: expect.arrayContaining(["sink-as-column"]) });
    expect(found.measurements).toEqual(expect.arrayContaining([expect.objectContaining({ name: "participatingItemCount", value: 1 })]));
  });
});
