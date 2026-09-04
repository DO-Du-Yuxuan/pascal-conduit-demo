import { describe, expect, it } from "vitest";
import { buildFurnitureUseAnalysis } from "./furniture-use";
import { ruleG3014, ruleG3015, ruleG3016, ruleG3018, ruleG3019, ruleG3020, ruleG3022, ruleG3023 } from "./g3-furniture-rules";

const level = { id: "L1", rawPascalId: "L1", levelId: "L1", parentId: null, visible: true, name: "Level 1" };
const slab = { id: "S", rawPascalId: "S", levelId: "L1", parentId: "L1", visible: true, name: "Floor", outline: [[0,0],[10,0],[10,6],[0,6]], holes: [], areaSquareMeters: 60, autoFromWalls: false };
const wall = (id: string, x: number) => ({ id, rawPascalId: id, levelId: "L1", parentId: "L1", visible: true, name: id, start: [x,0], end: [x,6], thicknessMeters: .1, heightMeters: 3, curveOffsetMeters: 0, footprintValidation: { valid: true, codes: [], areaSquareMeters: .6, footprint: [[x-.05,0],[x+.05,0],[x+.05,6],[x-.05,6]] } });
const door = (id: string, hostWallId: string, x: number) => ({ id, rawPascalId: id, levelId: "L1", parentId: hostWallId, visible: true, name: id, hostWallId, rawWallLocalPosition: [3,1,0], resolvedWorldPosition: [x,3], resolvedTangentRadians: Math.PI/2, widthMeters: 1, heightMeters: 2.1, openingKind: "door", doorType: "hinged", hingesSide: "left", swingDirection: "inward", swingAngleRadians: Math.PI/2 });
const item = (id: string, name: string, category: string, x: number, z: number, width: number, depth: number, functionTags = [category]) => ({ id, rawPascalId: id, levelId: "L1", parentId: "L1", visible: true, name, assetId: id, assetName: name, assetTags: functionTags, assetSource: "test", category, functionTags, attachTo: null, dimensionsMeters: [width,1,depth], rawPosition: [x,0,z], rawRotation: [0,0,0], resolvedWorldPosition: [x,z], resolvedRotationRadians: 0, resolvedVerticalRangeMeters: [0,1], verticalTransformError: null, floorPlanUrl: null, transformStatus: "ok", transformError: null });
const zone = { id: "Z", rawPascalId: "Z", levelId: "L1", parentId: "L1", visible: true, name: "BEDROOM / LIVING / DINING", outline: [[0,0],[10,0],[10,6],[0,6]], areaSquareMeters: 60 };
const base = (furniture: any[] = [], columns: any[] = []) => ({ schemaVersion: "1.0", source: {}, units: {}, levels: [level], slabs: [slab], walls: [wall("WL",0), wall("WR",10)], doors: [door("DL","WL",0), door("DR","WR",10)], windows: [], zones: [zone], spaces: [{ ...zone, sourceZoneId: "Z", source: "derived-from-zone" }], furniture, equipment: [], columns, shelves: [], stairs: [], shafts: [], relationships: {}, unclassifiedNodes: [], diagnostics: [] } as any);

describe("Furniture use zones and specialist G3 rules", () => {
  it("recognizes a reliable double bed and accepts one usable side", () => {
    const bed = item("bed", "Double Bed", "double-beds", 5, 3, 2, 2);
    const handoff = base([bed, item("left", "Cabinet", "cabinets", 3.7, 3, .6, 2)]);
    expect(ruleG3014(handoff).status).toBe("pass");
    expect(ruleG3015(handoff).status).toBe("pass");
    expect(ruleG3016(handoff)).toMatchObject({ status: "pass", diagnostics: [expect.objectContaining({ code: "double_bed_one_side_only" })] });
  });

  it("reports a bed with both access sides fully blocked", () => {
    const handoff = base([item("bed", "Double Bed", "double-beds", 5, 3, 2, 2), item("left", "Cabinet", "cabinets", 3.7, 3, .6, 2), item("right", "Cabinet", "cabinets", 6.3, 3, .6, 2)]);
    expect(ruleG3015(handoff)).toMatchObject({ status: "issue", normalizedObjectIds: ["bed"], diagnostics: [expect.objectContaining({ code: "bed_has_no_usable_access_side", normalizedObjectIds: expect.arrayContaining(["bed", "left", "right"]) })] });
  });

  it("uses explicit double-bed tags while preserving a source-category conflict", () => {
    const conflicted = item("bed", "master Bed", "columns", 5, 3, 2, 2, ["columns", "double-beds"]);
    const analysis = buildFurnitureUseAnalysis(base([], [conflicted]));
    expect(analysis.items.find((candidate) => candidate.item.id === "bed")).toMatchObject({ semantic: "bed", semanticConfidence: "medium", bedType: "double" });
    expect(analysis.diagnostics).toContain("bed: 源 category=columns 与 bed 语义冲突；functionTags仍明确支持该语义");
    expect(ruleG3014(base([], [conflicted])).status).toBe("pass");
    expect(ruleG3015(base([], [conflicted])).status).toBe("pass");
    expect(ruleG3016(base([], [conflicted])).status).toBe("pass");
  });

  it("checks bedroom doors and established paths without requiring window-use semantics", () => {
    const handoff = base([item("bed", "Double Bed", "double-beds", 5, 3, 2, 2)]);
    expect(ruleG3019(handoff)).toMatchObject({ status: "pass", summary: "1 张床未阻断卧室房门、相邻入口或已建立主要路径", missingData: [] });
  });

  it("treats a wardrobe without opening values as explicitly non-openable", () => {
    const handoff = base([item("wardrobe", "Closet", "wardrobes", 3, 3, 2, .6), item("sofa", "Sofa", "sofas", 7, 3, 2, 1)]);
    expect(ruleG3018(handoff)).toMatchObject({ status: "not_applicable", normalizedObjectIds: [] });
    expect(ruleG3018(base())).toMatchObject({ status: "not_applicable", normalizedObjectIds: [] });
    expect(ruleG3020(handoff)).toMatchObject({ status: "pass", measurements: expect.arrayContaining([expect.objectContaining({ name: "seatingFrontClearRatio", value: 1, normalizedObjectId: "sofa" })]) });
  });

  it("uses the direction opposite each dining chair's red arrow without needing a table", () => {
    const clear = base([item("chair", "Dining Chair", "dining-chairs", 5, 1.8, .5, .5)]);
    expect(ruleG3023(clear).status).toBe("pass");
    const blocked = base([...(clear.furniture as any[]), item("blocker", "Cabinet", "cabinets", 5, 1.45, .6, .6)]);
    expect(ruleG3023(blocked)).toMatchObject({ status: "issue", normalizedObjectIds: ["chair"], diagnostics: [expect.objectContaining({ code: "dining_chair_pullout_blocked", normalizedObjectIds: expect.arrayContaining(["chair", "blocker"]) })] });
  });

  it("uses the dining table only for planned-seat capacity, not chair direction", () => {
    const handoff = base([item("table", "Dining Table", "dining-tables", 5, 3, 1.5, 1.5), item("chair", "Dining Chair", "dining-chairs", 5, 1.8, .5, .5)]);
    expect(ruleG3022(handoff)).toMatchObject({ status: "unable_to_determine", diagnostics: [expect.objectContaining({ code: "planned_dining_capacity_unavailable" })] });
    expect(ruleG3023(handoff).status).toBe("pass");
  });

  it("does not draw a fixed lounge-chair front zone for a movable office chair", () => {
    const chair = item("office-chair", "Office Chair", "office-chairs", 5, 2, .7, .7);
    const analysis = buildFurnitureUseAnalysis(base([chair]));
    expect(analysis.items.find((candidate) => candidate.item.id === "office-chair")?.semantic).toBe("office-chair");
    expect(analysis.useZones.filter((zone) => zone.ownerObjectId === "office-chair")).toEqual([]);
    expect(ruleG3020(base([chair])).status).toBe("not_applicable");
  });
});
