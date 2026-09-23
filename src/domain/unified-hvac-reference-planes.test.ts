import { describe, expect, it } from "vitest";
import { addHvacOutlet, addHvacWallPenetration, bindThermostat, createHvacDuct, deleteHvacObject, editHvacOutlet, editIndoorUnit, placeIndoorUnit, placeThermostat, resizeHvacTerminalSegment } from "./hvac";
import { replaceLayoutReferencePlane } from "./layout-reference-plane";
import type { RoutePoint } from "./overlay";
import { decodeUnifiedProject, encodeUnifiedProject } from "./unified-project";
import { commitWorkspaceTransaction, createWorkspace, projectDocument, redoWorkspaceTransaction, undoWorkspaceTransaction } from "./workspace";

const systems = ["ElectricalSystem", "PlumbingSystem", "LightingSystem", "HVACSystem", "SmartSystem", "WaterPurificationSystem", "BathroomSystem", "FireProtectionSystem", "IrrigationSystem", "GasSystem"];
const point = (x: number, y = 2, z = 0): RoutePoint => ({ position: [x, y, z] });

function project() {
  const nodes: Record<string, any> = {
    site: { id: "site", type: "Site", parentId: null, children: ["building", ...systems], settings: { hvacVisible: false } },
    building: { id: "building", type: "Building", parentId: "site", children: ["level"] },
    level: {
      id: "level", type: "Level", parentId: "building", children: ["wall"],
      installationReferencePlanes: [{ levelId: "level", elevationMm: 2700, basis: "finished-floor", derived: true, future: { source: "survey" } }],
      layoutReferencePlanes: [{ levelId: "level", visible: true, elevationMm: 2650, basis: "largest-area-ceiling", sourceCeilingId: "ceiling", future: { source: "plugin" } }],
    },
    wall: { id: "wall", type: "Wall", parentId: "level", future: { keep: true } },
  };
  for (const type of systems) nodes[type] = { id: type, type, parentId: "site", children: [] };
  nodes.HVACSystem.children = ["unit", "duct", "outlet", "thermostat", "future-unit"];
  nodes.unit = { id: "unit", type: "FanCoilUnit", parentId: "HVACSystem", name: "FCU 空调内机", position: point(0), sizeMm: [1000, 600, 300], sectionMm: [500, 200], rotationYDegrees: 0, createdAt: "now", future: { casing: "keep" } };
  nodes.duct = { id: "duct", type: "GalvanizedSheetMetalDuct", parentId: "HVACSystem", indoorUnitId: "unit", system: "supply", segmentIds: ["seg-1", "seg-2"], createdAt: "now", future: { insulation: "keep" }, segments: [
    { id: "seg-1", start: point(0), end: point(2), future: { drawingCode: "A" } },
    { id: "seg-2", start: point(2), end: point(2, 2, 2), future: { drawingCode: "B" } },
  ] };
  nodes.outlet = { id: "outlet", type: "AirOutlet", parentId: "HVACSystem", ductId: "duct", segmentId: "seg-2", face: "top", offsetMm: 300, sizeMm: [200, 100], createdAt: "now", future: { finish: "white" } };
  nodes.thermostat = { id: "thermostat", type: "FCUThermostat", parentId: "HVACSystem", name: "FCU 温控器", position: point(1), sizeMm: [86, 86, 50], createdAt: "now", future: { protocol: "keep" } };
  nodes["future-unit"] = { id: "future-unit", type: "FutureHvacDevice", parentId: "HVACSystem", payload: { keep: true } };
  nodes.HVACSystem.controls = [{ id: "control", thermostatId: "thermostat", indoorUnitId: "unit", createdAt: "now", future: { protocol: "keep" } }];
  nodes.HVACSystem.wallPenetrations = [{ id: "opening", type: "hvac-wall-penetration", wallId: "wall", segmentId: "seg-2", entry: point(2, 2, .4), exit: point(2, 2, .7), openingMm: [1050, 350], createdAt: "now", future: { permit: "pending" } }];
  return { schemaVersion: "4.0", pascalConduitProjectId: "hvac-test", rootNodeIds: ["site"], nodes };
}

describe("unified HVAC and reference planes", () => {
  it("saves newly authored HVAC objects and a new per-Level plane in the one project file", () => {
    const raw = project();
    for (const id of [...raw.nodes.HVACSystem.children]) delete raw.nodes[id];
    raw.nodes.HVACSystem.children = [];
    raw.nodes.HVACSystem.controls = [];
    raw.nodes.HVACSystem.wallPenetrations = [];
    raw.nodes.level.layoutReferencePlanes = [];
    const loaded = decodeUnifiedProject(raw, "empty-hvac.json", "sha");
    const placed = placeIndoorUnit(loaded.overlay, point(0));
    const thermostat = placeThermostat(placed.overlay, { ...point(1), attachment: { hostId: "wall", hostKind: "wall", surface: "interior", normal: [0, 0, 1], levelId: "level" } });
    expect(thermostat).not.toHaveProperty("reason");
    if (!("thermostat" in thermostat)) return;
    const duct = createHvacDuct(thermostat.overlay, placed.unit.id, "supply", point(0), point(2));
    expect(duct).not.toHaveProperty("reason");
    if (!("duct" in duct)) return;
    const segmentId = duct.duct.segmentIds[0];
    const outlet = addHvacOutlet(duct.overlay, duct.duct.id, segmentId, "top", 100);
    expect(outlet).not.toHaveProperty("reason");
    if (!("outlet" in outlet)) return;
    const control = bindThermostat(outlet.overlay, thermostat.thermostat.id, placed.unit.id);
    expect(control).not.toHaveProperty("reason");
    if (!("control" in control)) return;
    const opening = addHvacWallPenetration(control.overlay, "wall", segmentId, point(1, 2, .3), point(1, 2, .5));
    expect(opening).not.toHaveProperty("reason");
    const withPlane = { ...opening.overlay, layoutReferencePlanes: [{ levelId: "level", visible: true, elevationMm: 2800, basis: "explicit" as const }] };
    const saved = encodeUnifiedProject(loaded.projectRaw, withPlane);
    expect(saved.nodes[placed.unit.id]).toMatchObject({ type: "FanCoilUnit", parentId: "HVACSystem" });
    expect(saved.nodes[duct.duct.id]).toMatchObject({ type: "GalvanizedSheetMetalDuct", parentId: "HVACSystem", segments: [{ id: segmentId }] });
    expect(saved.nodes[outlet.outlet.id]).toMatchObject({ type: "AirOutlet", ductId: duct.duct.id, segmentId });
    expect(saved.nodes[thermostat.thermostat.id]).toMatchObject({ type: "FCUThermostat", parentId: "HVACSystem" });
    expect(saved.nodes.HVACSystem.controls[0]).toMatchObject({ thermostatId: thermostat.thermostat.id, indoorUnitId: placed.unit.id });
    expect(saved.nodes.HVACSystem.wallPenetrations[0]).toMatchObject({ wallId: "wall", segmentId });
    expect(saved.nodes.level.layoutReferencePlanes).toMatchObject([{ levelId: "level", basis: "explicit", elevationMm: 2800 }]);
    expect(decodeUnifiedProject(saved, "saved.json", "sha2").overlay.hvac.ducts[0].segmentIds).toEqual([segmentId]);
  });

  it("round trips HVAC relationships, nested duct segments, reference basis, and unknown fields", () => {
    const raw = project();
    const loaded = decodeUnifiedProject(raw, "hvac.json", "sha");
    expect(loaded.overlay.hvac.visible).toBe(false);
    expect(loaded.overlay.hvac.ducts[0].segmentIds).toEqual(["seg-1", "seg-2"]);
    expect(loaded.overlay.hvac.outlets[0]).toMatchObject({ ductId: "duct", segmentId: "seg-2" });
    expect(loaded.overlay.hvac.controls[0]).toMatchObject({ thermostatId: "thermostat", indoorUnitId: "unit" });
    expect(loaded.overlay.hvac.wallPenetrations[0]).toMatchObject({ wallId: "wall", segmentId: "seg-2" });
    const saved = encodeUnifiedProject(loaded.projectRaw, loaded.overlay);
    expect(saved.nodes.duct.segments).toEqual(raw.nodes.duct.segments);
    expect(saved.nodes.duct.future).toEqual({ insulation: "keep" });
    expect(saved.nodes.HVACSystem.controls).toEqual(raw.nodes.HVACSystem.controls);
    expect(saved.nodes.HVACSystem.wallPenetrations).toEqual(raw.nodes.HVACSystem.wallPenetrations);
    expect(saved.nodes.level.installationReferencePlanes).toEqual(raw.nodes.level.installationReferencePlanes);
    expect(saved.nodes.level.layoutReferencePlanes).toEqual(raw.nodes.level.layoutReferencePlanes);
    expect(saved.nodes["future-unit"]).toEqual(raw.nodes["future-unit"]);
    expect(saved.nodes.wall).toEqual(raw.nodes.wall);
    expect(decodeUnifiedProject(saved, "again.json", "sha2").overlay.hvac.segments.map((segment) => segment.id)).toEqual(["seg-1", "seg-2"]);
  });

  it("persists HVAC and plane edits through undo and redo while retaining nested segment fields", () => {
    const loaded = decodeUnifiedProject(project(), "hvac.json", "sha");
    const initial = createWorkspace(projectDocument(loaded.projectRaw, "hvac.json", "sha"), loaded.overlay);
    const resized = resizeHvacTerminalSegment(initial.overlay!, "duct", 2500);
    expect(resized).not.toHaveProperty("reason");
    const unitEdited = editIndoorUnit(resized.overlay, "unit", { sectionMm: [900, 250] });
    expect(unitEdited).not.toHaveProperty("reason");
    const outletEdited = editHvacOutlet(unitEdited.overlay, "outlet", { offsetMm: 500 });
    expect(outletEdited).not.toHaveProperty("reason");
    const planeEdited = { ...outletEdited.overlay, layoutReferencePlanes: replaceLayoutReferencePlane(outletEdited.overlay.layoutReferencePlanes, { levelId: "level", visible: false, elevationMm: 2800, basis: "explicit" }) };
    const changed = commitWorkspaceTransaction(initial, { overlay: planeEdited });
    expect(changed.status).toBe("committed");
    const saved = encodeUnifiedProject(changed.state.project!.raw, changed.state.overlay!);
    expect(saved.nodes.duct.segments[1]).toMatchObject({ id: "seg-2", end: point(2, 2, 2.5), future: { drawingCode: "B" } });
    expect(saved.nodes.unit).toMatchObject({ sectionMm: [900, 250], future: { casing: "keep" } });
    expect(saved.nodes.outlet).toMatchObject({ offsetMm: 500, future: { finish: "white" } });
    expect(saved.nodes.level.layoutReferencePlanes[0]).toMatchObject({ visible: false, elevationMm: 2800, basis: "explicit", future: { source: "plugin" } });
    expect(saved.nodes.HVACSystem.controls[0].future).toEqual({ protocol: "keep" });
    expect(saved.nodes.HVACSystem.wallPenetrations[0].future).toEqual({ permit: "pending" });
    expect(saved.nodes.wall).toEqual(project().nodes.wall);
    const reopened = decodeUnifiedProject(saved, "saved.json", "sha2");
    expect(reopened.overlay.hvac.segments[1].end.position).toEqual([2, 2, 2.5]);
    expect(reopened.overlay.layoutReferencePlanes[0]).toMatchObject({ visible: false, elevationMm: 2800, basis: "explicit" });
    const undone = undoWorkspaceTransaction(changed.state);
    expect(encodeUnifiedProject(undone.project!.raw, undone.overlay!).nodes.duct.segments[1].end.position).toEqual([2, 2, 2]);
    expect(encodeUnifiedProject(undone.project!.raw, undone.overlay!).nodes.level.layoutReferencePlanes[0].basis).toBe("largest-area-ceiling");
    const redone = redoWorkspaceTransaction(undone);
    expect(encodeUnifiedProject(redone.project!.raw, redone.overlay!).nodes.duct.segments[1].end.position).toEqual([2, 2, 2.5]);
  });

  it("removes deleted terminal segments and their linked outlets and openings from export", () => {
    const loaded = decodeUnifiedProject(project(), "hvac.json", "sha");
    const deleted = deleteHvacObject(loaded.overlay, "seg-2");
    expect(deleted).not.toHaveProperty("reason");
    const saved = encodeUnifiedProject(loaded.projectRaw, deleted.overlay);
    expect(saved.nodes.duct.segmentIds).toEqual(["seg-1"]);
    expect(saved.nodes.duct.segments).toMatchObject([{ id: "seg-1", future: { drawingCode: "A" } }]);
    expect(saved.nodes.outlet).toBeUndefined();
    expect(saved.nodes.HVACSystem.wallPenetrations).toEqual([]);
    expect(decodeUnifiedProject(saved, "again.json", "sha2").overlay.hvac.segments.map((segment) => segment.id)).toEqual(["seg-1"]);
  });
});
