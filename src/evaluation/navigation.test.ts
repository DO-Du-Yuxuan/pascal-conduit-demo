import { describe, expect, it } from "vitest";
import { buildRoomNavigationAnalysis } from "./navigation";
import { ruleG3003, ruleG3004, ruleG3006 } from "./g3-navigation-rules";

const level = { id: "L1", rawPascalId: "L1", levelId: "L1", parentId: null, visible: true, name: "Level 1" };
const slab = { id: "S", rawPascalId: "S", levelId: "L1", parentId: "L1", visible: true, name: "Floor", outline: [[0,0],[10,0],[10,6],[0,6]], holes: [], areaSquareMeters: 60, autoFromWalls: false };
const wall = (id: string, x: number) => ({ id, rawPascalId: id, levelId: "L1", parentId: "L1", visible: true, name: id, start: [x,0], end: [x,6], thicknessMeters: .1, heightMeters: 3, curveOffsetMeters: 0, footprintValidation: { valid: true, codes: [], areaSquareMeters: .6, footprint: [[x-.05,0],[x+.05,0],[x+.05,6],[x-.05,6]] } });
const door = (id: string, hostWallId: string, x: number) => ({ id, rawPascalId: id, levelId: "L1", parentId: hostWallId, visible: true, name: id, hostWallId, rawWallLocalPosition: [3,1,0], resolvedWorldPosition: [x,3], resolvedTangentRadians: Math.PI/2, widthMeters: 1, heightMeters: 2.1, openingKind: "door", doorType: "hinged", hingesSide: "left", swingDirection: "inward", swingAngleRadians: Math.PI/2 });
const item = (id: string, name: string, category: string | null, x: number, z: number, width: number, depth: number) => ({ id, rawPascalId: id, levelId: "L1", parentId: "L1", visible: true, name, assetId: id, category, functionTags: category ? [category] : [], dimensionsMeters: [width,1,depth], resolvedWorldPosition: [x,z], resolvedRotationRadians: 0, transformStatus: "ok" });
const zone = { id: "Z", rawPascalId: "Z", levelId: "L1", parentId: "L1", visible: true, name: "LIVING ROOM", outline: [[0,0],[10,0],[10,6],[0,6]], areaSquareMeters: 60 };
const base = (options: any = {}) => ({ schemaVersion: "1.0", source: {}, units: {}, levels: [level], slabs: [slab], walls: [wall("WL",0), wall("WR",10)], doors: [door("DL","WL",0), door("DR","WR",10)], windows: [], zones: [zone], spaces: [{ ...zone, sourceZoneId: "Z", source: "derived-from-zone" }], furniture: [], equipment: [], columns: [], shelves: [], stairs: [], shafts: [], relationships: {}, unclassifiedNodes: [], diagnostics: [], ...options } as any);

describe("Room navigable space and path attribution", () => {
  it("connects portals through an empty room and ignores furniture against a wall", () => {
    const empty = buildRoomNavigationAnalysis(base()).rooms[0]!;
    expect(empty).toMatchObject({
      gridMeters: .1,
      clearanceRadiusMeters: .2,
      fixedConnected: true,
      furnishedConnected: true,
      portalNodes: [expect.anything(), expect.anything()],
      portalConnections: [expect.objectContaining({ fromDoorId: "DL", toDoorId: "DR", fixedConnected: true, furnishedConnected: true })],
    });
    expect(ruleG3003(base()).thresholds).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "basicPassageWidth", value: .4 }),
      expect.objectContaining({ name: "personRadius", value: .2 }),
    ]));
    const againstWall = base({ furniture: [item("bed", "Bed", "beds", 5, .55, 3, 1)] });
    expect(ruleG3003(againstWall).status).toBe("pass");
    expect(ruleG3004(againstWall).status).toBe("pass");
  });

  it("attributes a path lost only after adding a large sofa to G3-004", () => {
    const handoff = base({ furniture: [item("sofa", "Sofa", "sofas", 5, 3, 1, 6)] }), room = buildRoomNavigationAnalysis(handoff).rooms[0]!;
    expect(room.fixedConnected).toBe(true);
    expect(room.furnishedConnected).toBe(false);
    expect(room.furnishedComponentCount).toBeGreaterThan(1);
    expect(ruleG3003(handoff).status).toBe("issue");
    expect(ruleG3004(handoff)).toMatchObject({ status: "issue", diagnostics: [expect.objectContaining({ code: "large_furniture_blocks_navigation", normalizedObjectIds: expect.arrayContaining(["sofa"]) })] });
    expect(ruleG3006(handoff).status).toBe("pass");
  });

  it("detects a bed that completely blocks the doorway and a dining table that cuts the portal path", () => {
    for (const obstacle of [
      item("bed", "Double Bed", "beds", .55, 3, 1.1, 3),
      item("table", "Dining Table", "dining-tables", 5, 3, 1, 6),
    ]) {
      const handoff = base({ furniture: [obstacle] });
      expect(ruleG3004(handoff)).toMatchObject({ status: "issue", diagnostics: [expect.objectContaining({ normalizedObjectIds: expect.arrayContaining([obstacle.id]) })] });
      expect(ruleG3006(handoff).status).toBe("pass");
    }
  });

  it("attributes fixed equipment and sanitary fixtures to G3-006 without duplicating G3-004", () => {
    for (const obstacle of [item("counter", "Kitchen Counter", "counters", 5, 3, 1, 6), item("toilet", "Toilet", "toilets", 5, 3, 1, 6)]) {
      const handoff = obstacle.id === "counter" ? base({ equipment: [obstacle] }) : base({ furniture: [obstacle] });
      expect(ruleG3006(handoff)).toMatchObject({ status: "issue", diagnostics: [expect.objectContaining({ code: "fixed_object_blocks_navigation", normalizedObjectIds: expect.arrayContaining([obstacle.id]) })] });
      expect(ruleG3004(handoff).status).toBe("not_applicable");
    }
  });

  it("attributes a fixed cabinet that divides the room to G3-006", () => {
    const cabinet = { id: "cabinet", rawPascalId: "cabinet", levelId: "L1", parentId: "L1", visible: true, name: "Fixed Cabinet", style: "built-in", functionTags: ["bookshelf"], footprint: [[4.5,0],[5.5,0],[5.5,6],[4.5,6]] };
    const handoff = base({ shelves: [cabinet] });
    expect(ruleG3006(handoff)).toMatchObject({ status: "issue", diagnostics: [expect.objectContaining({ normalizedObjectIds: expect.arrayContaining(["cabinet"]) })] });
    expect(ruleG3004(handoff).status).toBe("not_applicable");
  });

  it("does not hard-fail for small objects and returns unable for blocking unknown classification", () => {
    expect(ruleG3003(base({ furniture: [item("stool", "Stool", "stools", 5,3,.3,.3)] })).status).toBe("pass");
    expect(ruleG3004(base({ furniture: [item("chair", "Office Chair", "office-chairs", 5,3,.7,.7)] })).status).toBe("pass");
    expect(ruleG3004(base({ furniture: [item("armchair", "Armchair", "armchairs", 5,3,1,6)] })).status).toBe("pass");
    const uncertain = base({ furniture: [item("unknown", "Unknown", null, 5,3,1,6)] });
    expect(ruleG3003(uncertain).status).toBe("unable_to_determine");
    expect(ruleG3004(uncertain).status).toBe("unable_to_determine");
    expect(ruleG3006(uncertain).status).toBe("pass");
  });
});
