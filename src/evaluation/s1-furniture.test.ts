import { describe, expect, it } from "vitest";
import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import type { Point, Ring } from "./envelope";
import { furnitureSemanticOf } from "./object-semantics";
import type { OperationUseAnalysis } from "./operation-use";
import { measureS1Furniture, polygonBoundaryDistance } from "./s1-furniture";

const rectangle = (x: number, z: number, width: number, depth: number): Ring => [[x - width / 2, z - depth / 2], [x + width / 2, z - depth / 2], [x + width / 2, z + depth / 2], [x - width / 2, z + depth / 2]];
const item = (id: string, tags: string[], x: number, z: number, category = "wrong-category") => ({ id, rawPascalId: id, parentId: "L1", levelId: "L1", visible: true, name: id, assetId: id, assetName: id, assetTags: [], assetSource: "test", category, functionTags: tags, attachTo: null, dimensionsMeters: [1, 1, 1], itemScale: [1,1,1], openingDirections: [], rawMaxOpeningDepthMeters: null, rawMinOpeningUseClearanceMeters: null, rawPosition: [x,0,z], rawRotation: [0,0,0], resolvedWorldPosition: [x,z], resolvedRotationRadians: 0, resolvedVerticalRangeMeters: [0,1], verticalTransformError: null, floorPlanUrl: null, doorLeafCount: null, doorLeafWidthMeters: null, hingeSide: null, openingDirection: null, openingAngleRadians: null, drawerDirection: null, drawerExtensionDepthMeters: null, plannedSeatCount: null, finishedInteriorPolygon: null, transformStatus: "ok", transformError: null });

function relationFixture(items: ReturnType<typeof item>[], zones: Array<{ id: string; room: string; outline: Ring }> = [{ id: "Z", room: "R", outline: rectangle(0,0,40,40) }]) {
  const roomToZoneIds = Object.fromEntries([...new Set(zones.map((zone) => zone.room))].map((room) => [room, zones.filter((zone) => zone.room === room).map((zone) => zone.id)]));
  const handoff = { items, furniture: items, equipment: [], columns: [], walls: [], shelves: [], shafts: [], levels: [], slabs: [], zones: zones.map((zone) => ({ id: zone.id, name: zone.id, levelId: "L1", outline: zone.outline })) } as unknown as EvaluationHandoff;
  const roomFor = (candidate: ReturnType<typeof item>) => zones.find((zone) => candidate.resolvedWorldPosition && candidate.resolvedWorldPosition[0] >= Math.min(...zone.outline.map((point) => point[0])) && candidate.resolvedWorldPosition[0] <= Math.max(...zone.outline.map((point) => point[0])) && candidate.resolvedWorldPosition[1] >= Math.min(...zone.outline.map((point) => point[1])) && candidate.resolvedWorldPosition[1] <= Math.max(...zone.outline.map((point) => point[1])))?.room ?? null;
  const operation = { items: items.map((candidate) => ({ item: candidate, capabilities: [], confidence: candidate.functionTags.length ? "high" : "low", reason: "test", footprint: rectangle(candidate.resolvedWorldPosition![0]!, candidate.resolvedWorldPosition![1]!, 1, 1), roomRegionId: roomFor(candidate), zoneIds: [], explicitlyOpenable: false, operationGeometryReliable: false, operationGeometryBasis: "unavailable", operationMissingFields: [] })), assessments: [], zones: [], windows: [], laundryRooms: [], storageRooms: [], diagnostics: [], navigation: { graph: { roomAnalysis: { roomToZoneIds } }, rooms: [] } } as unknown as OperationUseAnalysis;
  return { handoff, operation };
}

describe("S1-FUR functionTags and stable pairing", () => {
  it("uses functionTags as authority, supports multiple tags, and ignores a wrong asset.category", () => {
    expect(furnitureSemanticOf(item("bed", ["double-beds", "benches"], 0, 0, "dining-tables"))).toBe("bed");
    expect(furnitureSemanticOf(item("category-only", [], 0, 0, "dining-tables"))).toBe("other");
  });

  it("pairs one dining table with multiple dining chairs", () => {
    const f = relationFixture([item("table", ["dining-tables"], 0,0), item("chair-a", ["dining-chairs"], 1,0), item("chair-b", ["dining-chairs"], -1,0)]), report = measureS1Furniture(f.handoff, f.operation);
    expect(report.relationMeasurements.filter((entry) => entry.pairType === "dining_table_dining_chair")).toHaveLength(2);
    expect(report.relationMeasurements.filter((entry) => entry.pairType === "dining_table_dining_chair").every((entry) => entry.itemAId === "table" && entry.status === "measured")).toBe(true);
  });

  it("groups multiple dining sets by functional Zone before geometry", () => {
    const zones = [{ id: "ZA", room: "R", outline: rectangle(-5,0,8,8) }, { id: "ZB", room: "R", outline: rectangle(5,0,8,8) }], f = relationFixture([item("table-a", ["dining-tables"], -5,0), item("chair-a", ["dining-chairs"], -4,0), item("table-b", ["dining-tables"], 5,0), item("chair-b", ["dining-chairs"], 4,0)], zones), report = measureS1Furniture(f.handoff, f.operation);
    expect(report.relationMeasurements.filter((entry) => entry.pairType === "dining_table_dining_chair").map((entry) => [entry.itemBId, entry.itemAId])).toEqual([["chair-a","table-a"],["chair-b","table-b"]]);
  });

  it("allows a bed to own multiple bedside tables and measures sofa/coffee-table and desk/office-chair", () => {
    const f = relationFixture([item("bed", ["double-beds"], 0,0), item("night-a", ["bedside-tables"], -1,0), item("night-b", ["bedside-tables"], 1,0), item("sofa", ["sofas"], 5,0), item("coffee", ["coffee-tables"], 6,0), item("desk", ["desks"], 10,0), item("office-chair", ["office-chairs"], 11,0)]), report = measureS1Furniture(f.handoff, f.operation);
    expect(report.relationMeasurements.filter((entry) => entry.pairType === "bed_bedside_table").map((entry) => entry.itemAId)).toEqual(["bed","bed"]);
    expect(report.relationMeasurements.find((entry) => entry.pairType === "sofa_coffee_table")).toMatchObject({ itemAId: "sofa", itemBId: "coffee", status: "measured" });
    expect(report.relationMeasurements.find((entry) => entry.pairType === "desk_office_chair")).toMatchObject({ itemAId: "desk", itemBId: "office-chair", status: "measured" });
  });

  it("selects by geometry rather than array order and returns stable ambiguous results for ties", () => {
    const nearest = relationFixture([item("table-far", ["dining-tables"], 10,0), item("table-near", ["dining-tables"], 1,0), item("chair", ["dining-chairs"], 2,0)]), selected = measureS1Furniture(nearest.handoff, nearest.operation).relationMeasurements.find((entry) => entry.pairType === "dining_table_dining_chair");
    expect(selected?.itemAId).toBe("table-near");
    const tied = relationFixture([item("table-b", ["dining-tables"], 1,0), item("table-a", ["dining-tables"], -1,0), item("chair", ["dining-chairs"], 0,0)]), first = measureS1Furniture(tied.handoff, tied.operation).relationMeasurements.find((entry) => entry.pairType === "dining_table_dining_chair")!, second = measureS1Furniture(tied.handoff, tied.operation).relationMeasurements.find((entry) => entry.pairType === "dining_table_dining_chair")!;
    expect(first).toMatchObject({ status: "unable_to_determine", pairingStatus: "ambiguous", itemAId: null, candidateItemAIds: ["table-a","table-b"] });
    expect(second).toEqual(first);
  });

  it("does not create a formal relation from category or names when functionTags are missing", () => {
    const f = relationFixture([item("table", [], 0,0,"dining-tables"), item("chair", ["dining-chairs"], 1,0)]), group = measureS1Furniture(f.handoff, f.operation).relationGroups.find((entry) => entry.pairType === "dining_table_dining_chair");
    expect(group).toMatchObject({ status: "not_applicable", measurementCount: 0 });
  });

  it("records furniture without explicit opening geometry as not applicable", () => {
    const f = relationFixture([item("sofa", ["sofas"], 0,0)]), use = measureS1Furniture(f.handoff, f.operation).itemMeasurements[0];
    expect(use).toMatchObject({ itemId: "sofa", status: "not_applicable", minimumUseSpaceAvailable: null, maximumOpeningAvailable: null });
  });

  it("computes stable footprint boundary distances", () => {
    expect(polygonBoundaryDistance(rectangle(0,0,1,1), rectangle(2,0,1,1))).toBe(1);
    expect(polygonBoundaryDistance(rectangle(0,0,2,2), rectangle(.5,0,1,1))).toBe(0);
  });
});

describe("S1-FUR explicit use and opening spaces", () => {
  function useFixture(blocker: "none" | "wall" | "item") {
    const owner = { ...item("cabinet", ["cabinets"], 0,0), openingDirections: ["front"], rawMaxOpeningDepthMeters: .5, rawMinOpeningUseClearanceMeters: .5 }, polygon = rectangle(0,1,1,.5), blockerId = blocker === "wall" ? "wall" : "other", handoff = { items: blocker === "item" ? [owner, item("other", ["cabinets"], 0,1)] : [owner], furniture: blocker === "item" ? [owner, item("other", ["cabinets"], 0,1)] : [owner], equipment: [], columns: [], shelves: [], shafts: [], walls: blocker === "wall" ? [{ id: "wall", rawPascalId: "wall", levelId: "L1", footprintValidation: { valid: true, footprint: polygon } }] : [], levels: [{ id: "L1" }], slabs: [{ id: "slab", rawPascalId: "slab", levelId: "L1", visible: true, outline: rectangle(0,0,20,20), holes: [] }], zones: [] } as unknown as EvaluationHandoff, assessment = { zone: { operationZoneId: "cabinet:generic-operation:front", ownerObjectId: "cabinet", levelId: "L1", roomRegionId: "R", kind: "generic-operation", polygon, openingPolygon: polygon, openedUsePolygon: polygon, minimumUsePolygon: polygon, maximumOpeningDepthMeters: .5, minimumUseClearanceMeters: .5, geometryReliable: true, diagnostics: [] }, clearRatio: blocker === "none" ? 1 : 0, insideRoomRatio: 1, blockerIds: blocker === "none" ? [] : [blockerId], reachableFromEntry: true, openingBlockedAreaSquareMeters: blocker === "none" ? 0 : .5, openingBlockerIds: blocker === "none" ? [] : [blockerId], openingUsable: blocker === "none", openedUseClearRatio: blocker === "none" ? 1 : 0, openedUseBlockerIds: blocker === "none" ? [] : [blockerId], openedUseReachableFromEntry: true, minimumUseAreaSquareMeters: .5, minimumUseBlockedAreaSquareMeters: blocker === "none" ? 0 : .5, minimumUseInsideRoomRatio: 1, minimumUseClearRatio: blocker === "none" ? 1 : 0, minimumUseBlockerIds: blocker === "none" ? [] : [blockerId], minimumUseReachableFromEntry: true, minimumUseUsable: blocker === "none", usable: blocker === "none" }, operation = { items: [{ item: owner, capabilities: ["fixed-cabinet"], confidence: "high", reason: "test", footprint: rectangle(0,0,1,1), roomRegionId: "R", zoneIds: [], explicitlyOpenable: true, operationGeometryReliable: true, operationGeometryBasis: "explicit", operationMissingFields: [] }], zones: [assessment.zone], assessments: [assessment], windows: [], laundryRooms: [], storageRooms: [], diagnostics: [], navigation: { graph: { roomAnalysis: { roomToZoneIds: { R: [] } } }, rooms: [] } } as unknown as OperationUseAnalysis;
    return measureS1Furniture(handoff, operation).itemMeasurements[0]!;
  }

  it("records available minimum-use and maximum-opening spaces without conflict", () => {
    expect(useFixture("none")).toMatchObject({ status: "measured", minimumUseSpaceAvailable: true, minimumUseSpaceConflictAreaSquareMeters: 0, maximumOpeningAvailable: true, maximumOpeningConflictAreaSquareMeters: 0 });
  });
  it("separates wall conflicts from Item conflicts for both explicit geometries", () => {
    expect(useFixture("wall")).toMatchObject({ minimumUseSpaceAvailable: false, minimumUseSpaceConflictBuildingElementIds: ["wall"], maximumOpeningAvailable: false, maximumOpeningConflictBuildingElementIds: ["wall"] });
    expect(useFixture("item")).toMatchObject({ minimumUseSpaceAvailable: false, minimumUseSpaceConflictItemIds: ["other"], maximumOpeningAvailable: false, maximumOpeningConflictItemIds: ["other"] });
  });
});
