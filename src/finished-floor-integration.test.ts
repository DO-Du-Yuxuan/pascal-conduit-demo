import { describe, expect, it } from "vitest";
import type { NodeData } from "./types";
import { decodeUnifiedProject, encodeUnifiedProject } from "./domain/unified-project";
import { createFinishedFloorDevice } from "./domain/devices";
import { buildFinishedFloorSurfaces, finishedFloorAt } from "./domain/finished-floor";
import { describeDevicePosition } from "./domain/device-positioning";
import { buildPhysicalPositioningSurfaces } from "./domain/physical-positioning-surfaces";
import { describeGroundPositionReferences, groundWallBaselineChunks } from "./components/ground-positioning-guides";
import type { WallDimensionFace } from "./components/wall-dimension-placement";
import { buildInstallationSchedule } from "./plan/construction-drawings";
import { createPlanContext } from "./plan/model";
import { manualCalloutTargetAnchor } from "./plan/manual-callout-model";

function fixture() {
  const systems = ["ElectricalSystem", "PlumbingSystem", "LightingSystem", "HVACSystem", "SmartSystem", "WaterPurificationSystem", "BathroomSystem", "FireProtectionSystem", "IrrigationSystem", "GasSystem"];
  const wallData = [
    { id: "south", start: [0, 0], end: [4, 0] },
    { id: "east", start: [4, 0], end: [4, 4] },
    { id: "north", start: [4, 4], end: [0, 4] },
    { id: "west", start: [0, 4], end: [0, 0] },
  ];
  const nodes: Record<string, any> = {
    site: { id: "site", type: "Site", parentId: null, children: ["building", ...systems] },
    building: { id: "building", type: "Building", parentId: "site", children: ["level"] },
    level: { id: "level", type: "Level", level: 0, parentId: "building", children: ["slab", ...wallData.map(wall => wall.id)], constructionDatums: [{ id: "datum", label: "H01", levelId: "level", rawReference: { kind: "slab-top", sourceObjectId: "slab", elevationMm: 50, basis: "explicit" }, heightAboveRawMm: 1300, elevationMm: 1350, finishedFloorOffsetMm: 300, localRegionFinishOffsets: [] }] },
    slab: { id: "slab", type: "Slab", parentId: "level", elevation: .05, polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], futureField: { retained: true } },
  };
  for (const type of systems) nodes[type] = { id: type, type, parentId: "site", children: [] };
  for (const wall of wallData) nodes[wall.id] = { ...wall, type: "Wall", parentId: "level", height: 3, thickness: .1 };
  const normalized = Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, { ...node, type: node.type.toLowerCase() }])) as Record<string, NodeData>;
  const faces: WallDimensionFace[] = wallData.map(wall => ({ id: wall.id, levelId: "level", start: [wall.start[0]!, 0, wall.start[1]!], end: [wall.end[0]!, 0, wall.end[1]!], halfThickness: .05, bottomY: 0, topY: 3 }));
  return { source: { schemaVersion: "4.0", rootNodeIds: ["site"], pascalConduitProjectId: "finished-floor-integration", nodes }, normalized, faces };
}

describe("finished-floor authoring integration", () => {
  it("places at the 300 mm completion, shares four codes with physical dimensions, and round-trips floor identity", () => {
    const { source, normalized, faces } = fixture();
    const loaded = decodeUnifiedProject(source, "floor.json", "sha");
    const resolved = finishedFloorAt(loaded.overlay.constructionDatums, normalized, "level", 2, 2)!;
    expect(resolved.y).toBeCloseTo(.35);
    expect(buildFinishedFloorSurfaces(loaded.overlay.constructionDatums, normalized).every(surface => Math.abs(surface.y - .35) < 1e-9)).toBe(true);
    const device = createFinishedFloorDevice("socket", 2, 2, { ...resolved, levelId: "level" }, 0);
    const overlay = { ...loaded.overlay, devices: [device] };
    const context = { levelFloorY: { level: 0 }, wallSpans: {}, physicalSurfaces: buildPhysicalPositioningSurfaces(normalized), finishedFloorAt: (levelId: string, x: number, z: number) => finishedFloorAt(overlay.constructionDatums, normalized, levelId, x, z) };
    const description = describeDevicePosition(overlay, device.id, context);
    const references = describeGroundPositionReferences(device, description, faces);
    expect(references).toHaveLength(4);
    expect(new Set(references.map(reference => reference.code)).size).toBe(4);
    expect(references.every(reference => reference.panelLabel === `中心至 ${reference.code} 基准线`)).toBe(true);
    expect(references.every(reference => Math.abs(reference.witness.point[1] - .35) < 1e-9)).toBe(true);
    expect(references.every(reference => reference.millimeters === 1950)).toBe(true);
    expect(references.every(reference => groundWallBaselineChunks(reference, faces).length > 0)).toBe(true);
    const encoded = encodeUnifiedProject(loaded.projectRaw, overlay);
    const restored = decodeUnifiedProject(encoded, "saved.json", "sha2");
    expect(restored.overlay.devices[0]!.id).toBe(device.id);
    expect(restored.overlay.devices[0]!.mount).toEqual(device.mount);
    expect(encoded.nodes.slab).toEqual(source.nodes.slab);
    const plan = createPlanContext(normalized, restored.overlay);
    const row = buildInstallationSchedule(normalized, restored.overlay, "level", "millimeters", plan)[0]!.rows[0]!;
    expect(row).toMatchObject({ mounting: "完成面 · 上口", heightMeters: 0, floorSocket: true, quantity: 1 });
    expect(row.evidenceSourceIds).toEqual(expect.arrayContaining([device.id, "datum", "slab"]));
    expect(manualCalloutTargetAnchor(normalized, restored.overlay, device.id)).toEqual({ levelId: "level", anchor: [2, 2] });
    const raised = { ...restored.overlay, constructionDatums: restored.overlay.constructionDatums.map(datum => ({ ...datum, finishedFloorOffsetMm: 400 })) };
    const raisedRow = buildInstallationSchedule(normalized, raised, "level", "millimeters", createPlanContext(normalized, raised))[0]!.rows[0]!;
    expect(raised.devices[0]!.position).toEqual(device.position);
    expect(raisedRow.heightMeters).toBeCloseTo(-.1);
    const undefinedFinish = { ...overlay, constructionDatums: overlay.constructionDatums.map(({ finishedFloorOffsetMm: _removed, ...datum }) => datum) };
    // The read-only node snapshot still has the imported old finish. Current
    // overlay metadata must govern whether finish-relative readings exist.
    const noFinishNodes = { ...normalized, level: { ...normalized.level!, constructionDatums: source.nodes.level.constructionDatums } };
    const pendingRow = buildInstallationSchedule(noFinishNodes, undefinedFinish, "level", "millimeters", createPlanContext(noFinishNodes, undefinedFinish))[0]!.rows[0]!;
    expect(pendingRow.heightMeters).toBeCloseTo(.3);
    expect(pendingRow.confidence).toBe("limited");
    expect(pendingRow.assumptions[0]).toContain("完成面未定义");
  });
});
