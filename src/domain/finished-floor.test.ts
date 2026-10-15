import { describe, expect, it } from "vitest";
import { createEmptyOverlay, parseOverlay } from "./overlay";
import { buildFinishedFloorSurfaces, finishedFloorAt } from "./finished-floor";
import { alignDeviceToFinishedFloor, createFinishedFloorDevice, isFloorMountedDevice } from "./devices";
import { resizeDevicePoint } from "./device-positioning";
import { deviceConstructionHeight, isFloorSocket } from "../plan/model";
import { describeDevicePosition, editDevicePosition } from "./device-positioning";

const nodes: Record<string, any> = {
  site: { id: "site", type: "site", children: ["building"] },
  building: { id: "building", type: "building", parentId: "site", children: ["L0"] },
  L0: { id: "L0", type: "level", level: 0, parentId: "building", children: ["slab", "zone"] },
  slab: { id: "slab", type: "slab", parentId: "L0", elevation: .05, polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], holes: [[[1, 1], [1, 2], [2, 2], [2, 1]]] },
  zone: { id: "zone", type: "zone", parentId: "L0", polygon: [[2, 0], [4, 0], [4, 4], [2, 4]] },
};
const datum = { id: "H01", levelId: "L0", label: "H01", rawReference: { kind: "slab-top" as const, sourceObjectId: "slab", elevationMm: 50, basis: "explicit" as const }, heightAboveRawMm: 1500, elevationMm: 1550, finishedFloorOffsetMm: 0, localRegionFinishOffsets: [{ regionId: "zone", offsetMm: 30 }] };

describe("derived finished-floor placement surfaces", () => {
  it("clips to the source slab, leaves slab holes empty, and splits unique Zone finish offsets", () => {
    const surfaces = buildFinishedFloorSurfaces([datum], nodes);
    expect(surfaces.some(surface => surface.regionId === "zone" && Math.abs(surface.y - .08) < 1e-8)).toBe(true);
    expect(surfaces.some(surface => !surface.regionId && Math.abs(surface.y - .05) < 1e-8)).toBe(true);
    expect(finishedFloorAt([datum], nodes, "L0", .5, .5)).toMatchObject({ y: .05, sourceSlabId: "slab", datumId: "H01" });
    expect(finishedFloorAt([datum], nodes, "L0", 3, 1)).toMatchObject({ y: .08, regionId: "zone" });
    expect(finishedFloorAt([datum], nodes, "L0", 1.5, 1.5)).toBeUndefined();
    expect(finishedFloorAt([datum], nodes, "L9", .5, .5)).toBeUndefined();
    const extraLevelNodes = { ...nodes, L1: { id: "L1", type: "level", level: 1 }, slab2: { id: "slab2", type: "slab", parentId: "L1", polygon: [[10, 10], [12, 10], [12, 12], [10, 12]] } };
    const extraDatum = { ...datum, id: "H02", levelId: "L1", rawReference: { ...datum.rawReference, sourceObjectId: "slab2" }, localRegionFinishOffsets: [] };
    expect(buildFinishedFloorSurfaces([extraDatum, datum], extraLevelNodes).filter(surface => surface.datumId === "H01").map(surface => surface.id)).toEqual(surfaces.map(surface => surface.id));
  });

  it("requires an explicitly completed finish and a unique same-level slab", () => {
    expect(buildFinishedFloorSurfaces([{ ...datum, finishedFloorOffsetMm: undefined }], nodes)).toEqual([]);
    expect(finishedFloorAt([{ ...datum, finishedFloorOffsetMm: undefined }], nodes, "L0", .5, .5)).toBeUndefined();
    const other = { ...nodes, slab2: { ...nodes.slab, id: "slab2" } };
    expect(finishedFloorAt([datum], other, "L0", .5, .5)).toBeUndefined();
    expect(finishedFloorAt([datum], { ...nodes, slab: { ...nodes.slab, parentId: "other-level" } }, "L0", .5, .5)).toBeUndefined();
    const multiSlab = { ...nodes, slab2: { id: "slab2", type: "slab", parentId: "L0", elevation: .1, polygon: [[5, 0], [7, 0], [7, 2], [5, 2]] } };
    expect(finishedFloorAt([datum], multiSlab, "L0", 6, 1)).toMatchObject({ y: .05, rawReferenceSourceId: "slab", sourceSlabId: "slab2" });
    expect(buildFinishedFloorSurfaces([datum], multiSlab).some(surface => surface.sourceSlabId === "slab2" && surface.rawReferenceSourceId === "slab")).toBe(true);
    const levelBaseDatum = { ...datum, rawReference: { kind: "level-base" as const, sourceObjectId: "L0", elevationMm: 0, basis: "explicit" as const }, finishedFloorOffsetMm: 80 };
    expect(finishedFloorAt([levelBaseDatum], multiSlab, "L0", 6, 1)).toMatchObject({ y: .08, sourceSlabId: "slab2", rawReferenceSourceId: "L0" });
  });

  it("recognizes all top-mounted floor points while keeping the 2D floor-socket label socket-specific", () => {
    const floor = createFinishedFloorDevice("network-outlet", 1, 1, { y: .05, levelId: "L0", datumId: "H01", sourceSlabId: "slab" });
    const legacyTop = { ...floor, mount: { kind: "host" as const, attachment: { hostId: "slab", hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId: "L0" } }, position: { position: [1, .05, 1] as [number, number, number], attachment: { hostId: "slab", hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId: "L0" } } };
    const legacyBottom = { ...legacyTop, position: { ...legacyTop.position, attachment: { ...legacyTop.position.attachment, surface: "bottom", normal: [0, -1, 0] as [number, number, number] } } };
    expect(isFloorMountedDevice(floor)).toBe(true);
    expect(isFloorSocket(floor)).toBe(false);
    expect(isFloorMountedDevice(legacyTop)).toBe(true);
    expect(isFloorMountedDevice(legacyBottom)).toBe(false);
  });

  it("keeps a floor device's top face anchored, preserves explicit zero, and records semantic identity", () => {
    const surface = { y: .08, levelId: "L0", datumId: "H01", sourceSlabId: "slab", regionId: "zone" };
    const device = createFinishedFloorDevice("socket", 3, 1, surface, 0);
    expect(device.mount).toEqual({ kind: "finished-floor", levelId: "L0", datumId: "H01", sourceSlabId: "slab", regionId: "zone", topOffsetMm: 0 });
    expect(device.frame?.front).toEqual([0, 1, 0]);
    expect(device.position.position[1] + device.sizeMm[2] / 2000).toBeCloseTo(surface.y);
    const restored = parseOverlay({ ...createEmptyOverlay("project.json", "sha"), devices: [device] });
    expect(restored.devices[0]?.mount).toEqual(device.mount);
    const resized = resizeDevicePoint({ ...createEmptyOverlay("project.json", "sha"), devices: [device] }, device.id, [100, 100, 80]).devices[0]!;
    expect(resized.position.position[1] + resized.sizeMm[2] / 2000).toBeCloseTo(surface.y);
    expect(alignDeviceToFinishedFloor(resized, { ...surface, y: .05 }, 0).position.position[1] + resized.sizeMm[2] / 2000).toBeCloseTo(.05);
    expect(deviceConstructionHeight(device, nodes, { ...createEmptyOverlay("project.json", "sha"), constructionDatums: [datum] }, "L0")).toMatchObject({ heightMeters: 0, evidenceSourceIds: [device.id, "H01", "slab", "zone"] });
    const changedDatum = { ...datum, finishedFloorOffsetMm: 20 };
    expect(deviceConstructionHeight(device, nodes, { ...createEmptyOverlay("project.json", "sha"), constructionDatums: [changedDatum] }, "L0").heightMeters).toBeCloseTo(-.02);
  });

  it("measures floor references at configured finish height and keeps explicit moves mounted across a Zone", () => {
    const start = { y: .05, levelId: "L0", datumId: "H01", sourceSlabId: "slab" };
    const device = createFinishedFloorDevice("socket", 1, .5, start, 0);
    const tri = (objectId: string, vertices: [[number, number, number], [number, number, number], [number, number, number]]) => ({ objectId, objectKind: "wall", vertices: vertices.map(vertex => vertex as [number, number, number]) as [[number, number, number], [number, number, number], [number, number, number]] });
    const surfaces = [
      tri("east", [[4, -1, -4], [4, 2, -4], [4, 2, 4]]), tri("east", [[4, -1, -4], [4, 2, 4], [4, -1, 4]]),
      tri("west", [[-4, -1, -4], [-4, 2, 4], [-4, 2, -4]]), tri("west", [[-4, -1, -4], [-4, -1, 4], [-4, 2, 4]]),
      tri("north", [[-4, -1, 4], [4, 2, 4], [-4, 2, 4]]), tri("north", [[-4, -1, 4], [4, -1, 4], [4, 2, 4]]),
      tri("south", [[-4, -1, -4], [-4, 2, -4], [4, 2, -4]]), tri("south", [[-4, -1, -4], [4, 2, -4], [4, -1, -4]]),
    ];
    const context = { levelFloorY: { L0: 0 }, wallSpans: {}, physicalSurfaces: surfaces, finishedFloorAt: (levelId: string, x: number, z: number) => finishedFloorAt([datum], nodes, levelId, x, z) };
    const overlay = { ...createEmptyOverlay("project.json", "sha"), devices: [device] };
    expect(describeDevicePosition(overlay, device.id, context)).toMatchObject({ vertical: { millimeters: 0, witness: { point: [1, .05, .5] } }, planar: expect.arrayContaining([expect.objectContaining({ key: "u+", millimeters: 3000 })]) });
    const moved = editDevicePosition(overlay, { deviceIds: [device.id], planarClearanceMm: { "u+": 1000 } }, context, "preview");
    const movedDevice = moved.overlay.devices[0]!;
    expect(moved.status).toBe("preview");
    expect(movedDevice.position.position).toMatchObject([3, .08 - movedDevice.sizeMm[2] / 2000, .5]);
    expect(movedDevice.mount).toMatchObject({ kind: "finished-floor", datumId: "H01", sourceSlabId: "slab", regionId: "zone", topOffsetMm: 0 });
  });
});
