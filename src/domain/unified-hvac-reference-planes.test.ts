import { describe, expect, it } from "vitest";
import { addHvacOutlet, addHvacWallPenetration, createHvacControlConduit, createHvacDuct, deleteHvacObject, editHvacOutlet, editIndoorUnit, placeIndoorUnit, placeThermostat, resizeHvacTerminalSegment, selectHvacThermostatPort } from "./hvac";
import { replaceLayoutReferencePlane } from "./layout-reference-plane";
import type { RoutePoint } from "./overlay";
import { decodeUnifiedProject, encodeUnifiedProject } from "./unified-project";
import { commitWorkspaceTransaction, createWorkspace, projectDocument, redoWorkspaceTransaction, undoWorkspaceTransaction } from "./workspace";
import { commitDeviceRoute, placeNetworkDevice, startRouteFromDevice } from "./devices";
import { deleteNetworkObject, planRoute } from "./routing";

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
  it("round trips the red FCU power conduit and releases its endpoint when that route is deleted", () => {
    const raw = project();
    for (const id of [...raw.nodes.HVACSystem.children]) delete raw.nodes[id];
    raw.nodes.HVACSystem.children = [];
    raw.nodes.HVACSystem.controls = [];
    const loaded = decodeUnifiedProject(raw, "empty.json", "sha");
    const unit = placeIndoorUnit(loaded.overlay, point(2));
    const sourceOverlay = placeNetworkDevice(unit.overlay, "strong-panel", { ...point(0), attachment: { hostId: "wall", hostKind: "wall", surface: "interior", normal: [0, 0, 1], levelId: "level" } });
    const started = startRouteFromDevice(sourceOverlay, sourceOverlay.devices[0]!.id, "receptacle");
    const route = planRoute("receptacle", 20, "surface", [started.port.position, unit.unit.powerPort!.position]);
    const connected = commitDeviceRoute(started.overlay, route, started.circuit, started.port, unit.unit.id, unit.unit.powerPort!.id);
    const redSegment = connected.segments[connected.segments.length - 1]!;
    expect(redSegment).toMatchObject({ system: "receptacle", endPortId: unit.unit.powerPort!.id });
    expect(connected.hvac.indoorUnits[0]?.powerPort?.connectedSegmentIds).toEqual([redSegment.id]);
    const saved = encodeUnifiedProject(loaded.projectRaw, connected);
    expect(saved.nodes[redSegment.id]).toMatchObject({ type: "Conduit", parentId: "ElectricalSystem", endPortId: unit.unit.powerPort!.id });
    expect(decodeUnifiedProject(saved, "roundtrip.json", "sha2").overlay.hvac.indoorUnits[0]?.powerPort?.connectedSegmentIds).toEqual([redSegment.id]);
    const freed = deleteNetworkObject(connected, redSegment.id);
    expect(freed.hvac.indoorUnits[0]?.powerPort?.connectedSegmentIds).toEqual([]);
  });

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
    const control = createHvacControlConduit(outlet.overlay, thermostat.thermostat.id, placed.unit.id, [point(.5, 2, .4)]);
    expect(control).not.toHaveProperty("reason");
    if (!("conduit" in control)) return;
    const opening = addHvacWallPenetration(control.overlay, "wall", segmentId, point(1, 2, .3), point(1, 2, .5));
    expect(opening).not.toHaveProperty("reason");
    const withPlane = { ...opening.overlay, layoutReferencePlanes: [{ levelId: "level", visible: true, elevationMm: 2800, basis: "explicit" as const }] };
    const saved = encodeUnifiedProject(loaded.projectRaw, withPlane);
    expect(saved.nodes[placed.unit.id]).toMatchObject({ type: "FanCoilUnit", parentId: "HVACSystem" });
    expect(saved.nodes[duct.duct.id]).toMatchObject({ type: "GalvanizedSheetMetalDuct", parentId: "HVACSystem", segments: [{ id: segmentId }] });
    expect(saved.nodes[outlet.outlet.id]).toMatchObject({ type: "AirOutlet", ductId: duct.duct.id, segmentId });
    expect(saved.nodes[thermostat.thermostat.id]).toMatchObject({ type: "FCUThermostat", parentId: "HVACSystem" });
    expect(saved.nodes[control.conduit.id]).toMatchObject({ type: "HVACControlConduit", parentId: "HVACSystem", system: "control", thermostatId: thermostat.thermostat.id, indoorUnitId: placed.unit.id, segmentIds: control.conduit.segmentIds, fittingIds: control.conduit.fittingIds });
    expect(saved.nodes[control.conduit.id].segments.map((item: any) => item.id)).toEqual(control.conduit.segmentIds);
    expect(saved.nodes[control.conduit.id].fittings.map((item: any) => item.id)).toEqual(control.conduit.fittingIds);
    expect(saved.nodes.HVACSystem.controls).toBeUndefined();
    expect(saved.nodes[placed.unit.id].ports.map((port: any) => port.id)).toEqual([`${placed.unit.id}:power-port`, `${placed.unit.id}:control-port`]);
    expect(saved.nodes.HVACSystem.wallPenetrations[0]).toMatchObject({ wallId: "wall", segmentId });
    expect(saved.nodes.level.layoutReferencePlanes).toMatchObject([{ levelId: "level", basis: "explicit", elevationMm: 2800 }]);
    expect(decodeUnifiedProject(saved, "saved.json", "sha2").overlay.hvac.ducts[0].segmentIds).toEqual([segmentId]);
    expect(decodeUnifiedProject(saved, "saved.json", "sha2").overlay.hvac.controlFittings.map((item) => item.id)).toEqual(control.conduit.fittingIds);
  });

  it("round trips HVAC relationships, nested duct segments, reference basis, and unknown fields", () => {
    const raw = project();
    const loaded = decodeUnifiedProject(raw, "hvac.json", "sha");
    expect(loaded.overlay.hvac.visible).toBe(false);
    expect(loaded.overlay.hvac.indoorUnits[0]).toMatchObject({ powerPort: { id: "unit:power-port", ownerId: "unit", connectedSegmentIds: [] }, controlPort: { id: "unit:control-port", ownerId: "unit", connectedSegmentIds: [] } });
    expect(loaded.overlay.hvac.thermostats[0]).toMatchObject({ controlPort: { id: "thermostat:control-port", ownerId: "thermostat", connectedSegmentIds: [] } });
    expect(loaded.overlay.hvac.ducts[0].segmentIds).toEqual(["seg-1", "seg-2"]);
    expect(loaded.overlay.hvac.outlets[0]).toMatchObject({ ductId: "duct", segmentId: "seg-2" });
    expect(loaded.overlay.hvac.controls).toEqual([]);
    expect(loaded.overlay.hvac.wallPenetrations[0]).toMatchObject({ wallId: "wall", segmentId: "seg-2" });
    const saved = encodeUnifiedProject(loaded.projectRaw, loaded.overlay);
    expect(saved.nodes.duct.segments).toEqual(raw.nodes.duct.segments);
    expect(saved.nodes.duct.future).toEqual({ insulation: "keep" });
    expect(saved.nodes.HVACSystem.controls).toBeUndefined();
    expect(saved.nodes.HVACSystem.wallPenetrations).toEqual(raw.nodes.HVACSystem.wallPenetrations);
    expect(saved.nodes.level.installationReferencePlanes).toEqual(raw.nodes.level.installationReferencePlanes);
    expect(saved.nodes.level.layoutReferencePlanes).toEqual(raw.nodes.level.layoutReferencePlanes);
    expect(saved.nodes["future-unit"]).toEqual(raw.nodes["future-unit"]);
    expect(saved.nodes.wall).toEqual(raw.nodes.wall);
    expect(decodeUnifiedProject(saved, "again.json", "sha2").overlay.hvac.segments.map((segment) => segment.id)).toEqual(["seg-1", "seg-2"]);
  });

  it("fills only a missing legacy FCU port and preserves the existing connected port record", () => {
    const raw = project();
    const retainedPowerPort = { id: "unit:power-port", ownerId: "unit", position: point(.3), direction: [1, 0, 0], role: "sink", system: "receptacle", connectedSegmentIds: ["existing-red-segment"], plugin: { crimp: "preserve" } };
    raw.nodes.unit.ports = [retainedPowerPort];
    raw.nodes.ElectricalSystem.children = ["existing-red-segment"];
    raw.nodes["existing-red-segment"] = { id: "existing-red-segment", type: "Conduit", parentId: "ElectricalSystem", system: "receptacle", diameterMm: 20, start: point(0), end: point(.3), startPortId: "source-port", endPortId: retainedPowerPort.id, createdAt: "now" };
    const loaded = decodeUnifiedProject(raw, "partial-port.json", "sha");
    expect(loaded.overlay.hvac.indoorUnits[0]?.powerPort).toEqual(retainedPowerPort);
    expect(loaded.overlay.hvac.indoorUnits[0]?.controlPort).toMatchObject({ id: "unit:control-port", ownerId: "unit", system: "hvac-control", connectedSegmentIds: [] });
  });

  it("moves only the generated 25 mm thermostat port and linked route start on import", () => {
    const raw = project(), host = { hostId: "wall", hostKind: "wall", surface: "interior", normal: [0, 0, 1], levelId: "level" };
    const thermostatPosition = { ...point(1, 1.3, 0), attachment: host }, oldPortPosition = { ...point(1, 1.3, .025), attachment: host };
    raw.nodes.thermostat.position = thermostatPosition;
    raw.nodes.thermostat.ports = [{ id: "thermostat:control-port", ownerId: "thermostat", position: oldPortPosition, direction: [0, 0, 1], role: "source", system: "hvac-control", connectedSegmentIds: ["legacy-control-seg"], plugin: { insert: "preserve" } }];
    raw.nodes.unit.ports = [{ id: "unit:power-port", ownerId: "unit", position: point(.5), direction: [1, 0, 0], role: "sink", system: "receptacle", connectedSegmentIds: [] }, { id: "unit:control-port", ownerId: "unit", position: point(0, 2, .5), direction: [-1, 0, 0], role: "sink", system: "hvac-control", connectedSegmentIds: ["legacy-control-seg"] }];
    raw.nodes.HVACSystem.children.push("legacy-control");
    raw.nodes["legacy-control"] = { id: "legacy-control", type: "HVACControlConduit", parentId: "HVACSystem", system: "control", thermostatId: "thermostat", thermostatPortId: "thermostat:control-port", indoorUnitId: "unit", indoorUnitPortId: "unit:control-port", segmentIds: ["legacy-control-seg"], fittingIds: [], diameterMm: 20, createdAt: "now", segments: [{ id: "legacy-control-seg", start: oldPortPosition, end: point(0, 2, .5), future: { preserve: true } }], fittings: [] };
    const loaded = decodeUnifiedProject(raw, "legacy-hvac-route.json", "sha"), migratedPort = loaded.overlay.hvac.thermostats[0]?.controlPort, migratedSegment = loaded.overlay.hvac.controlSegments[0];
    expect(migratedPort).toMatchObject({ id: "thermostat:control-port", direction: [0, -1, 0], connectedSegmentIds: ["legacy-control-seg"], plugin: { insert: "preserve" } });
    expect(migratedPort?.position).toEqual({ ...point(0.98108, 1.2570000000000001, 0), attachment: host });
    expect(migratedSegment).toMatchObject({ id: "legacy-control-seg", start: { position: [0.98108, 1.2570000000000001, 0] }, end: point(0, 2, .5) });
    const saved = encodeUnifiedProject(loaded.projectRaw, loaded.overlay);
    expect(saved.nodes.thermostat.ports[0]).toMatchObject({ id: "thermostat:control-port", position: { position: [0.98108, 1.2570000000000001, 0] }, plugin: { insert: "preserve" } });
    expect(saved.nodes["legacy-control"].segments[0]).toMatchObject({ id: "legacy-control-seg", start: { position: [0.98108, 1.2570000000000001, 0] }, end: point(0, 2, .5), future: { preserve: true } });
    expect(decodeUnifiedProject(saved, "migrated-again.json", "sha2").overlay.hvac.controlSegments[0]).toEqual(migratedSegment);
  });

  it("leaves custom thermostat port placement untouched during legacy import", () => {
    const raw = project(), host = { hostId: "wall", hostKind: "wall", surface: "interior", normal: [0, 0, 1], levelId: "level" };
    const customPort = { id: "thermostat:control-port", ownerId: "thermostat", position: { ...point(1.02, 1.3, 0), attachment: host }, direction: [1, 0, 0], role: "source", system: "hvac-control", connectedSegmentIds: [], futurePositionRule: "custom" };
    raw.nodes.thermostat.position = { ...point(1, 1.3, 0), attachment: host };
    raw.nodes.thermostat.ports = [customPort];
    expect(decodeUnifiedProject(raw, "custom-port.json", "sha").overlay.hvac.thermostats[0]?.controlPort).toEqual(customPort);
  });

  it("uses the clicked thermostat hole for the saved port and route start", () => {
    const raw = project();
    for (const id of [...raw.nodes.HVACSystem.children]) delete raw.nodes[id];
    raw.nodes.HVACSystem.children = [];
    raw.nodes.HVACSystem.controls = [];
    const loaded = decodeUnifiedProject(raw, "empty-hvac.json", "sha"), unit = placeIndoorUnit(loaded.overlay, point(0, 2, 0));
    const placedThermostat = placeThermostat(unit.overlay, { ...point(1, 1.3, 0), attachment: { hostId: "wall", hostKind: "wall", surface: "interior", normal: [0, 0, 1], levelId: "level" } });
    if (!("thermostat" in placedThermostat)) throw new Error("fixture");
    const selected = selectHvacThermostatPort(placedThermostat.overlay, placedThermostat.thermostat.id, "right:1");
    if ("reason" in selected) throw new Error(selected.reason);
    const selectedPort = selected.overlay.hvac.thermostats[0]!.controlPort!;
    const route = createHvacControlConduit(selected.overlay, placedThermostat.thermostat.id, unit.unit.id);
    if (!("conduit" in route)) throw new Error(route.reason);
    const firstSegment = route.overlay.hvac.controlSegments.find(segment => segment.id === route.conduit.segmentIds[0])!;
    expect(firstSegment.start).toEqual(selectedPort.position);
    expect(route.overlay.hvac.thermostats[0]?.controlPort?.position).toEqual(selectedPort.position);
    const saved = encodeUnifiedProject(loaded.projectRaw, route.overlay);
    expect(saved.nodes[placedThermostat.thermostat.id].ports[0].position).toEqual(selectedPort.position);
    expect(saved.nodes[route.conduit.id].segments[0].start).toEqual(selectedPort.position);
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
    expect(saved.nodes.HVACSystem.controls).toBeUndefined();
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
