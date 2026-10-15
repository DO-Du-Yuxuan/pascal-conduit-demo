import { describe, expect, it } from "vitest";
import type { DevicePositionDescription } from "../domain/device-positioning";
import type { NetworkDevice } from "../domain/overlay";
import { describeGroundPositionReferences, groundWallBaselineChunks } from "./ground-positioning-guides";
import { nearestWallDimensionFrame, wallOpeningEdgeLabel, wallVerticalReferenceSegments, type WallDimensionFace } from "./wall-dimension-placement";

const wall = (id: string, start: [number, number, number], end: [number, number, number], extra: Partial<WallDimensionFace> = {}): WallDimensionFace => ({ id, start, end, halfThickness: .1, levelId: "L0", bottomY: 0, topY: 3, ...extra });
const floorDevice = (id: string, x: number, z: number): NetworkDevice => ({
  id,
  type: "network-device",
  deviceType: "socket",
  name: "地插",
  position: { position: [x, -.03, z] },
  sizeMm: [86, 50, 86],
  orientation: [0, 1, 0],
  mount: { kind: "finished-floor", levelId: "L0", datumId: "H01", sourceSlabId: "slab", topOffsetMm: 0 },
  systems: ["receptacle"],
  ports: [],
  createdAt: "",
});
const description: DevicePositionDescription = { planar: [
  { key: "u+", millimeters: 800, wallId: "u+", direction: [1, 0, 0], witness: { objectId: "wall-a", objectKind: "wall", point: [1, 0, .1] } },
  { key: "u-", millimeters: 600, wallId: "u-", direction: [-1, 0, 0], witness: { objectId: "wall-b", objectKind: "wall", point: [-1, 0, .1] } },
] };

describe("ground positioning display references", () => {
  it("assigns a stable wall-side code across devices and shares its panel wording", () => {
    const faces = [wall("wall-a", [0, 0, 0], [4, 0, 0]), wall("wall-b", [-2, 0, 0], [2, 0, 0])];
    const first = describeGroundPositionReferences(floorDevice("one", 2, 2), description, faces);
    const second = describeGroundPositionReferences(floorDevice("two", 2.5, 1), description, faces);
    expect(first.map(reference => [reference.key, reference.code, reference.panelLabel, reference.millimeters])).toEqual([
      ["u+", "G01", "中心至 G01 基准线", 800],
      ["u-", "G03", "中心至 G03 基准线", 600],
    ]);
    expect(second.map(reference => reference.code)).toEqual(["G01", "G03"]);
  });

  it("keeps a legacy top-of-slab socket in the floor reference set", () => {
    const legacy = floorDevice("legacy", 2, 2);
    delete legacy.mount;
    legacy.position.attachment = { hostId: "slab", hostKind: "slab", surface: "top", normal: [0, 1, 0], levelId: "L0" };
    const references = describeGroundPositionReferences(legacy, description, [wall("wall-a", [0, 0, 0], [4, 0, 0]), wall("wall-b", [-2, 0, 0], [2, 0, 0])]);
    expect(references.map(reference => reference.code)).toEqual(["G01", "G03"]);
  });

  it("draws floor seam chunks on the actual face and cuts a door opening at the plane", () => {
    const face = wall("wall-a", [0, 0, 0], [4, 0, 0], { openings: [{ id: "door-a", start: 1, end: 1.9, bottomY: 0, topY: 2.1, type: "door" }] });
    const reference = describeGroundPositionReferences(floorDevice("one", 2, 2), description, [face])[0]!;
    const chunks = groundWallBaselineChunks(reference, [face], 0);
    expect(chunks).toHaveLength(2);
    expect(chunks.map(chunk => [chunk.start, chunk.end])).toEqual([
      [[0, 0, .101], [1, 0, .101]],
      [[1.9, 0, .101], [4, 0, .101]],
    ]);
    expect(chunks.every(chunk => chunk.wallId === "wall-a" && chunk.code === "G01")).toBe(true);
    expect(wallOpeningEdgeLabel({ objectId: "door-a", objectKind: "opening" }, [face], "右")).toBe("右门洞口边");
  });

  it("miter-trims a ground seam at the joined physical wall faces", () => {
    const faces = [
      wall("wall-a", [0, 0, 0], [2, 0, 0]),
      wall("wall-b", [2, 0, 0], [2, 0, 2]),
    ];
    const reference = describeGroundPositionReferences(floorDevice("one", 1, 1), { planar: [description.planar![0]!] }, faces)[0]!;
    const chunks = groundWallBaselineChunks(reference, faces, 0);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.start).toEqual([0, 0, .101]);
    expect(chunks[0]!.end[0]).toBeCloseTo(1.8995);
    expect(chunks[0]!.end[2]).toBeCloseTo(.101);
  });

  it("uses the full rendered wall span and clips a vertical opening void", () => {
    const face = wall("wall-a", [0, 0, 0], [4, 0, 0], { openings: [{ id: "window-a", start: 1, end: 1.8, bottomY: .9, topY: 2.2 }] });
    const frame = nearestWallDimensionFrame("wall-a", [1, 1, .1], [0, 0, 1], [face])!;
    const segments = wallVerticalReferenceSegments([1, 1, .1], frame, undefined, [face], "window-a");
    expect(segments).toEqual([
      { start: [1, 0, .1005], end: [1, .9, .1005] },
      { start: [1, 2.2, .1005], end: [1, 3, .1005] },
    ]);
  });

  it("limits a corner mark to the overlapping height of both joined walls", () => {
    const faces = [
      wall("host", [0, 0, 0], [2, 0, 0], { bottomY: 1, topY: 2.4 }),
      wall("left-wall", [0, 0, -1], [0, 0, 0], { bottomY: .5, topY: 3 }),
    ];
    const target = nearestWallDimensionFrame("left-wall", [.05, 1, .05], [1, 0, 0], faces)!;
    const host = nearestWallDimensionFrame("host", [1, 1, .05], [0, 0, 1], faces)!;
    const segments = wallVerticalReferenceSegments([.05, 1, .05], target, host, faces);
    expect(segments).toEqual([{ start: [.1, 1, .1005], end: [.1, 2.4, .1005] }]);
  });
});
