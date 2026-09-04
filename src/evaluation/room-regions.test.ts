import { describe, expect, it } from "vitest";
import { buildRoomRegionAnalysis } from "./room-regions";

const base = (walls: any[] = [], zones: any[] = [], holes: number[][][] = []) => ({
  levels: [{ id: "L1", rawPascalId: "L1", levelId: "L1", visible: true, name: "一层" }],
  slabs: [{ id: "S1", rawPascalId: "S1", levelId: "L1", visible: true, name: "Floor", outline: [[0, 0], [10, 0], [10, 6], [0, 6]], holes, areaSquareMeters: 60, autoFromWalls: false }],
  walls, zones, spaces: zones.map((zone) => ({ ...zone, sourceZoneId: zone.id, source: "derived-from-zone" })), doors: [], windows: [], furniture: [], equipment: [], columns: [], shelves: [], stairs: [], shafts: [], diagnostics: [], units: {}, relationships: {}, source: {}, schemaVersion: "1.0",
}) as any;
const wall = (id: string, x: number, z0 = 0, z1 = 6, valid = true) => ({ id, rawPascalId: id, levelId: "L1", start: [x, z0], end: [x, z1], footprintValidation: { valid, codes: valid ? [] : ["invalid"], areaSquareMeters: valid ? (z1 - z0) * .1 : 0, footprint: valid ? [[x - .05, z0], [x + .05, z0], [x + .05, z1], [x - .05, z1]] : [] } });
const zone = (id: string, outline: number[][], name = id) => ({ id, rawPascalId: id, levelId: "L1", parentId: "L1", visible: true, name, outline, areaSquareMeters: Math.abs((outline[1]![0] - outline[0]![0]) * (outline[2]![1] - outline[1]![1])) });

describe("Room Region recognition and Zone matching", () => {
  it("recognizes one open room and allows two functional Zones in it", () => {
    const analysis = buildRoomRegionAnalysis(base([], [zone("living", [[0, 0], [5, 0], [5, 6], [0, 6]]), zone("dining", [[5, 0], [10, 0], [10, 6], [5, 6]])]));
    expect(analysis.rooms.filter((room) => room.usableForEvaluation)).toHaveLength(1);
    expect(analysis.zoneMatches.map((match) => match.relationship)).toEqual(["room-with-multiple-zones", "room-with-multiple-zones"]);
  });

  it("recognizes two adjacent rooms and flags one Zone crossing both", () => {
    const analysis = buildRoomRegionAnalysis(base([wall("divider", 5)], [zone("cross", [[3, 0], [7, 0], [7, 6], [3, 6]])]));
    expect(analysis.rooms.filter((room) => room.usableForEvaluation)).toHaveLength(2);
    expect(analysis.zoneMatches[0]).toMatchObject({ relationship: "zone-crosses-rooms" });
  });

  it("reports unmatched rooms and unmatched Zones independently", () => {
    const noZones = buildRoomRegionAnalysis(base([wall("divider", 5)]));
    expect(noZones.unmatchedRoomRegionIds).toHaveLength(2);
    const outside = buildRoomRegionAnalysis(base([], [zone("outside", [[20, 0], [21, 0], [21, 1], [20, 1]])]));
    expect(outside.zoneMatches[0]?.relationship).toBe("unmatched-zone");
  });

  it("does not force-close either small or large wall-end gaps", () => {
    expect(buildRoomRegionAnalysis(base([wall("small-gap", 5, 0, 5.99)])).rooms.filter((room) => room.usableForEvaluation)).toHaveLength(1);
    expect(buildRoomRegionAnalysis(base([wall("large-gap", 5, 0, 5.5)])).rooms.filter((room) => room.usableForEvaluation)).toHaveLength(1);
  });

  it("preserves building holes, detects tiny fragments, and survives invalid walls", () => {
    const withHole = buildRoomRegionAnalysis(base([], [], [[[4, 2], [6, 2], [6, 4], [4, 4]]]));
    expect(withHole.rooms[0]?.holes).toHaveLength(1);
    const fragment = buildRoomRegionAnalysis(base([wall("near-edge", .08)]));
    expect(fragment.rooms.some((room) => !room.usableForEvaluation)).toBe(true);
    expect(() => buildRoomRegionAnalysis(base([wall("invalid", 5, 0, 6, false)]))).not.toThrow();
  });

  it("accepts a valid curved-wall footprint as a physical separator", () => {
    const curved = wall("curved", 5) as any; curved.curveOffsetMeters = 1;
    expect(buildRoomRegionAnalysis(base([curved])).rooms.filter((room) => room.usableForEvaluation)).toHaveLength(2);
  });
});
