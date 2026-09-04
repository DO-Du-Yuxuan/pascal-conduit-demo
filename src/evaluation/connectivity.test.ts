import { describe, expect, it } from "vitest";
import { buildDoorPortals, buildRoomConnectivityGraph } from "./connectivity";
import { ruleG3001, ruleG3005 } from "./g3-rules";

const level = (id: string) => ({ id, rawPascalId: id, levelId: id, parentId: null, visible: true, name: id });
const slab = (id: string, levelId: string) => ({ id, rawPascalId: id, levelId, parentId: levelId, visible: true, name: "Floor", outline: [[0, 0], [10, 0], [10, 6], [0, 6]], holes: [], areaSquareMeters: 60, autoFromWalls: false });
const wall = (id: string, levelId: string, start: number[], end: number[], extra: any = {}) => {
  const dx = end[0]! - start[0]!, dz = end[1]! - start[1]!, length = Math.hypot(dx, dz), nx = -dz / length * .05, nz = dx / length * .05;
  return { id, rawPascalId: id, name: id, parentId: levelId, levelId, visible: true, start, end, thicknessMeters: .1, heightMeters: 3, curveOffsetMeters: 0, footprintValidation: { valid: true, codes: [], areaSquareMeters: length * .1, footprint: [[start[0]! + nx, start[1]! + nz], [end[0]! + nx, end[1]! + nz], [end[0]! - nx, end[1]! - nz], [start[0]! - nx, start[1]! - nz]] }, ...extra };
};
const door = (id: string, levelId: string, hostWallId: string | null, center: number[] | null, tangent: number | null, local: number, name = id) => ({ id, rawPascalId: id, name, parentId: hostWallId, levelId, visible: true, hostWallId, rawWallLocalPosition: [local, 1, 0], resolvedWorldPosition: center, resolvedTangentRadians: tangent, widthMeters: .9, heightMeters: 2.1, openingKind: "door", doorType: "hinged" });
const zone = (id: string, levelId: string, outline: number[][], name: string) => ({ id, rawPascalId: id, levelId, parentId: levelId, visible: true, name, outline, areaSquareMeters: Math.abs((outline[1]![0]! - outline[0]![0]!) * (outline[2]![1]! - outline[1]![1]!)) });
const base = (options: { levels?: any[]; slabs?: any[]; walls?: any[]; doors?: any[]; zones?: any[]; stairs?: any[] } = {}) => {
  const levels = options.levels ?? [level("L1")], slabs = options.slabs ?? levels.map((item) => slab(`S-${item.id}`, item.id)), zones = options.zones ?? [];
  return { schemaVersion: "1.0", source: {}, units: { length: "meter", area: "square-meter", angles: "radian" }, levels, slabs, walls: options.walls ?? [], doors: options.doors ?? [], windows: [], zones, spaces: zones.map((item) => ({ ...item, sourceZoneId: item.id, source: "derived-from-zone" })), furniture: [], equipment: [], columns: [], shelves: [], stairs: options.stairs ?? [], shafts: [], relationships: {}, unclassifiedNodes: [], diagnostics: [] } as any;
};

describe("Door Portal recognition", () => {
  const divider = wall("W-mid", "L1", [5, 0], [5, 6]), exterior = wall("W-ext", "L1", [0, 0], [0, 6]);

  it("connects two Rooms using samples on both sides of the opening", () => {
    const portals = buildDoorPortals(base({ walls: [divider], doors: [door("D-mid", "L1", divider.id, [5, 3], Math.PI / 2, 3)] }));
    expect(portals[0]).toMatchObject({ usableForConnectivity: true, connectsExterior: false, confidence: "high" });
    expect(portals[0]?.roomRegionAId).not.toBe(portals[0]?.roomRegionBId);
  });

  it("connects one Room to Exterior", () => {
    expect(buildDoorPortals(base({ walls: [exterior], doors: [door("D-ext", "L1", exterior.id, [0, 3], Math.PI / 2, 3)] }))[0]).toMatchObject({ usableForConnectivity: true, connectsExterior: true });
  });

  it("rejects a same-Room portal, missing host wall, and curved-wall door", () => {
    const short = wall("W-short", "L1", [5, 2], [5, 4]), curved = wall("W-curve", "L1", [2, 0], [2, 6], { curveOffsetMeters: 1 });
    const portals = buildDoorPortals(base({ walls: [short, curved], doors: [door("D-same", "L1", short.id, [5, 3], Math.PI / 2, 1), door("D-missing", "L1", null, null, null, 0), door("D-curve", "L1", curved.id, [2, 3], Math.PI / 2, 3)] }));
    expect(portals[0]?.diagnostics.map((item) => item.code)).toContain("door_sides_same_room");
    expect(portals[1]?.diagnostics[0]?.code).toBe("door_host_wall_missing");
    expect(portals[2]?.diagnostics[0]?.code).toBe("curved_door_portal_unsupported");
    expect(portals.every((portal) => !portal.usableForConnectivity)).toBe(true);
  });

  it("keeps a wall-end door usable but lowers confidence", () => {
    const portal = buildDoorPortals(base({ walls: [divider], doors: [door("D-end", "L1", divider.id, [5, .45], Math.PI / 2, .45)] }))[0]!;
    expect(portal.usableForConnectivity).toBe(true);
    expect(portal.confidence).toBe("medium");
    expect(portal.diagnostics.map((item) => item.code)).toContain("door_near_wall_end");
  });
});

describe("Room connectivity graph and G3 rules", () => {
  const divider = wall("W-mid", "L1", [5, 0], [5, 6]), exterior = wall("W-ext", "L1", [0, 0], [0, 6]), zones = [zone("Z-left", "L1", [[0, 0], [5, 0], [5, 6], [0, 6]], "LIVING"), zone("Z-right", "L1", [[5, 0], [10, 0], [10, 6], [5, 6]], "BEDROOM")];
  const interiorDoor = door("D-mid", "L1", divider.id, [5, 3], Math.PI / 2, 3), exteriorDoor = door("D-ext", "L1", exterior.id, [0, 3], Math.PI / 2, 3, "Front Entrance");

  it("passes an entrance-connected chain and detects isolated usable Rooms", () => {
    const connected = base({ walls: [divider, exterior], doors: [interiorDoor, exteriorDoor], zones });
    expect(ruleG3005(connected).status).toBe("pass");
    expect(ruleG3001(connected).status).toBe("pass");
    const isolated = base({ walls: [divider, exterior], doors: [exteriorDoor], zones });
    expect(ruleG3005(isolated)).toMatchObject({ status: "issue", summary: expect.stringContaining("1 个") });
    expect(ruleG3001(isolated)).toMatchObject({ status: "issue", summary: expect.stringContaining("1 个") });
  });

  it("passes when any reliable exterior door reaches every main space", () => {
    const opposite = wall("W-ext-2", "L1", [10, 0], [10, 6]), secondDoor = door("D-ext-2", "L1", opposite.id, [10, 3], Math.PI / 2, 3);
    const handoff = base({ walls: [exterior, opposite], doors: [door("D-ext", "L1", exterior.id, [0, 3], Math.PI / 2, 3), secondDoor], zones: [zone("Z", "L1", [[0, 0], [10, 0], [10, 6], [0, 6]], "LIVING")] });
    expect(buildRoomConnectivityGraph(handoff).entrance.candidateDoorIds).toHaveLength(2);
    expect(ruleG3001(handoff).status).toBe("pass");
  });

  it("returns unable_to_determine when no reliable exterior door is available", () => {
    const handoff = base({ walls: [divider], doors: [interiorDoor], zones });
    expect(ruleG3001(handoff)).toMatchObject({ status: "unable_to_determine", summary: expect.stringContaining("可靠外门") });
  });

  it("rejects invalid stair references and accepts a reliable cross-level landing connection", () => {
    const levels = [level("L1"), level("L2")], slabs = levels.map((item) => slab(`S-${item.id}`, item.id)), zones = [zone("Z1", "L1", [[0, 0], [10, 0], [10, 6], [0, 6]], "LIVING"), zone("Z2", "L2", [[0, 0], [10, 0], [10, 6], [0, 6]], "BEDROOM")], footprint = [[4, 2], [6, 2], [6, 4], [4, 4]];
    const stairBase = { id: "ST", rawPascalId: "ST", name: "Stair", parentId: "L1", levelId: "L1", visible: true, footprint };
    const common = { levels, slabs, walls: [exterior], doors: [exteriorDoor], zones };
    const invalid = base({ ...common, stairs: [{ ...stairBase, fromLevelId: "missing-1", toLevelId: "missing-2" }] });
    expect(buildRoomConnectivityGraph(invalid).stairConnections[0]?.diagnostics[0]?.code).toBe("stair_connection_unresolved");
    expect(ruleG3001(invalid).status).toBe("unable_to_determine");
    const valid = base({ ...common, stairs: [{ ...stairBase, fromLevelId: "L1", toLevelId: "L2" }] });
    expect(buildRoomConnectivityGraph(valid).stairConnections[0]?.usableForConnectivity).toBe(true);
    expect(ruleG3001(valid).status).toBe("pass");
  });
});
