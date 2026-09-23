import { describe, expect, it } from "vitest";
import { createLightingControlGroup, removeLightingControlGroup, replaceLightingControlGroup } from "./lighting-controls";
import type { RoutePoint } from "./overlay";
import { deleteNetworkObject } from "./routing";
import { decodeUnifiedProject, encodeUnifiedProject } from "./unified-project";
import { commitWorkspaceTransaction, createWorkspace, projectDocument, redoWorkspaceTransaction, undoWorkspaceTransaction } from "./workspace";

const systemTypes = ["ElectricalSystem", "PlumbingSystem", "LightingSystem", "HVACSystem", "SmartSystem", "WaterPurificationSystem", "BathroomSystem", "FireProtectionSystem", "IrrigationSystem", "GasSystem"];
const point = (x: number, y = 1, z = 0): RoutePoint => ({ position: [x, y, z] });
const device = (id: string, type: string, parentId: string, deviceType: string, system: string): Record<string, any> => ({
  id, type, parentId, deviceType, name: id, position: point(1), sizeMm: [86, 86, 50], orientation: [0, 0, 1], systems: [system], ports: [], createdAt: "now",
});

function project() {
  const nodes: Record<string, any> = {
    site: { id: "site", type: "Site", parentId: null, children: ["building", ...systemTypes], settings: { plugin: "retain" } },
    building: { id: "building", type: "Building", parentId: "site", children: ["level"] },
    level: { id: "level", type: "Level", parentId: "building", children: ["wall"] },
    wall: { id: "wall", type: "Wall", parentId: "level", metadata: { untouched: true } },
  };
  for (const type of systemTypes) nodes[type] = { id: type, type, parentId: "site", children: [] };
  const strong = device("strong", "StrongCurrentBox", "ElectricalSystem", "strong-panel", "receptacle");
  strong.systems.push("lighting");
  strong.ports = [{ id: "shared-port", owner: { kind: "device", id: "strong" }, position: point(0), direction: [1, 0, 0], role: "source", system: "lighting", connectedSegmentIds: ["light-segment"], custom: { retain: true } }];
  nodes.strong = strong;
  nodes.ElectricalSystem.children.push("strong");
  nodes.switch = device("switch", "SwitchPanel", "LightingSystem", "switch", "lighting");
  nodes.light = device("light", "Spotlight", "LightingSystem", "luminaire", "lighting");
  nodes.light2 = device("light2", "Spotlight", "LightingSystem", "luminaire", "lighting");
  nodes["light-segment"] = { id: "light-segment", type: "Conduit", parentId: "LightingSystem", system: "lighting", diameterMm: 20, start: point(0), end: point(1), startPortId: "shared-port", circuitId: "light-circuit", createdAt: "now", plugin: { preserve: true } };
  nodes["light-fitting"] = { id: "light-fitting", type: "ConduitElbow", parentId: "LightingSystem", fitting: "elbow", system: "lighting", diameterMm: 20, position: point(1), segmentIds: ["light-segment"], ports: [{ id: "fitting-port", position: point(1), direction: [-1, 0, 0], system: "lighting", connectedSegmentIds: ["light-segment"] }] };
  nodes["light-box"] = { id: "light-box", type: "JunctionBox", parentId: "LightingSystem", system: "lighting", position: point(1), sizeMm: [86, 86, 50], segmentIds: [], ports: [] };
  nodes.LightingSystem.children.push("switch", "light", "light2", "light-segment", "light-fitting", "light-box");
  nodes.LightingSystem.circuits = [{ id: "light-circuit", system: "lighting", sourceDeviceId: "strong", rootPortId: "shared-port", segmentIds: ["light-segment"], status: "rooted", createdAt: "now" }];
  nodes.LightingSystem.lightingControlGroups = [{ id: "control", switchDeviceId: "switch", luminaireDeviceIds: ["light"], createdAt: "now" }];
  nodes.LightingSystem.surfaceChases = [{ id: "chase", type: "surface-chase", hostId: "wall", hostKind: "wall", surfaceNormal: [0, 0, 1], routeElementId: "light-segment", path: { kind: "line", start: point(0), end: point(1) }, widthMm: 30, depthMm: 20 }];
  nodes.LightingSystem.penetrations = [{ id: "hole", type: "penetration", hostId: "wall", hostKind: "wall", segmentId: "light-segment", entry: point(0), exit: point(0, 1, .2), direction: [0, 0, 1], diameterMm: 30 }];
  nodes.sprinkler = device("sprinkler", "SprinklerHead", "FireProtectionSystem", "sprinkler-head", "sprinkler");
  nodes["fire-segment"] = { id: "fire-segment", type: "FireWaterPipe", parentId: "FireProtectionSystem", system: "sprinkler", diameterMm: 50, start: point(0), end: point(2), createdAt: "now" };
  nodes["fire-fitting"] = { id: "fire-fitting", type: "FireWaterPipeTee", parentId: "FireProtectionSystem", system: "sprinkler", fitting: "tee", diameterMm: 50, position: point(2), segmentIds: ["fire-segment"], ports: [] };
  nodes.FireProtectionSystem.children.push("sprinkler", "fire-segment", "fire-fitting");
  return { schemaVersion: "4.0", pascalConduitProjectId: "combined", rootNodeIds: ["site"], nodes, installedPlugins: [], materials: {}, collections: {} };
}

describe("unified lighting and fire ownership", () => {
  it("round trips one shared electrical source without duplicating it", () => {
    const raw = project();
    const loaded = decodeUnifiedProject(raw, "combined.json", "sha");
    expect(loaded.overlay.circuits).toMatchObject([
      { id: "light-circuit", sourceDeviceId: "strong", rootPortId: "shared-port", segmentIds: ["light-segment"] },
    ]);
    expect(loaded.overlay.devices.find((item) => item.id === "strong")?.ports[0].connectedSegmentIds).toEqual(["light-segment"]);
    const saved = encodeUnifiedProject(loaded.projectRaw, loaded.overlay);
    expect(saved.nodes.strong.parentId).toBe("ElectricalSystem");
    expect(Object.values(saved.nodes).filter((node) => node.id === "strong")).toHaveLength(1);
    expect(saved.nodes.strong.ports[0]).toMatchObject({ id: "shared-port", custom: { retain: true } });
    expect(saved.nodes.LightingSystem.children).toEqual(expect.arrayContaining(["light-segment", "light-fitting", "light-box"]));
    expect(saved.nodes.FireProtectionSystem.children).toEqual(expect.arrayContaining(["fire-segment", "fire-fitting"]));
    expect(saved.nodes["fire-fitting"]).toMatchObject({ type: "FireWaterPipeTee", fitting: "tee" });
    expect(saved.nodes.wall).toEqual(raw.nodes.wall);
    const reopened = decodeUnifiedProject(saved, "saved.json", "sha2");
    expect(reopened.overlay.circuits.find((item) => item.id === "light-circuit")?.rootPortId).toBe("shared-port");
    expect(reopened.overlay.lightingControlGroups).toMatchObject([{ id: "control", switchDeviceId: "switch", luminaireDeviceIds: ["light"] }]);
    expect(reopened.overlay.surfaceChases).toHaveLength(1);
    expect(reopened.overlay.penetrations).toHaveLength(1);
  });

  it("persists edits, deletes related construction records, and restores them with undo", () => {
    const loaded = decodeUnifiedProject(project(), "combined.json", "sha");
    const edited = replaceLightingControlGroup(loaded.overlay, "control", ["light", "light2"]);
    expect(edited.status).toBe("committed");
    if (edited.status !== "committed") return;
    const created = createLightingControlGroup(edited.overlay, "switch", ["light"]);
    expect(created).toMatchObject({ status: "rejected", reason: "luminaire-already-bound" });
    const initial = createWorkspace(projectDocument(loaded.projectRaw, "combined.json", "sha"), loaded.overlay);
    const changed = commitWorkspaceTransaction(initial, { overlay: edited.overlay });
    expect(changed.status).toBe("committed");
    const deletedOverlay = deleteNetworkObject(changed.state.overlay!, "light-segment");
    const deleted = commitWorkspaceTransaction(changed.state, { overlay: deletedOverlay });
    expect(deleted.status).toBe("committed");
    const saved = encodeUnifiedProject(deleted.state.project!.raw, deleted.state.overlay!);
    expect(saved.nodes.LightingSystem.children).not.toContain("light-segment");
    expect(saved.nodes.LightingSystem.surfaceChases).toEqual([]);
    expect(saved.nodes.LightingSystem.penetrations).toEqual([]);
    expect(saved.nodes.LightingSystem.circuits[0]).toMatchObject({ id: "light-circuit", status: "broken", segmentIds: [] });
    expect(saved.nodes.strong.ports[0].connectedSegmentIds).toEqual([]);
    expect(saved.nodes.wall).toEqual(project().nodes.wall);
    expect(saved.nodes.LightingSystem.lightingControlGroups[0].luminaireDeviceIds).toEqual(["light", "light2"]);
    const restored = undoWorkspaceTransaction(deleted.state);
    const redo = redoWorkspaceTransaction(restored);
    expect(encodeUnifiedProject(restored.project!.raw, restored.overlay!).nodes.LightingSystem.children).toContain("light-segment");
    expect(encodeUnifiedProject(redo.project!.raw, redo.overlay!).nodes.LightingSystem.children).not.toContain("light-segment");
  });

  it("creates and removes a control group and a lighting route without changing the shared source", () => {
    const loaded = decodeUnifiedProject(project(), "combined.json", "sha");
    const withoutGroup = removeLightingControlGroup(loaded.overlay, "control");
    const made = createLightingControlGroup(withoutGroup, "switch", ["light2"]);
    expect(made.status).toBe("committed");
    if (made.status !== "committed") return;
    const routeId = "new-light-segment";
    const added = {
      ...made.overlay,
      segments: [...made.overlay.segments, { id: routeId, type: "conduit-segment" as const, system: "lighting" as const, diameterMm: 20, start: point(1), end: point(2), startPortId: "shared-port", circuitId: "light-circuit", createdAt: "now" }],
      circuits: made.overlay.circuits.map((circuit) => circuit.id === "light-circuit" ? { ...circuit, segmentIds: [...circuit.segmentIds, routeId] } : circuit),
      devices: made.overlay.devices.map((item) => item.id === "strong" ? { ...item, ports: item.ports.map((port) => port.id === "shared-port" ? { ...port, connectedSegmentIds: [...port.connectedSegmentIds, routeId] } : port) } : item),
      surfaceChases: [...made.overlay.surfaceChases, { ...made.overlay.surfaceChases[0], id: "fire-fitting-chase", routeElementId: "fire-fitting" }],
    };
    const saved = encodeUnifiedProject(loaded.projectRaw, added);
    expect(saved.nodes[routeId]).toMatchObject({ type: "Conduit", parentId: "LightingSystem", startPortId: "shared-port" });
    expect(saved.nodes.LightingSystem.circuits[0].segmentIds).toEqual(["light-segment", routeId]);
    expect(saved.nodes.LightingSystem.lightingControlGroups).toMatchObject([{ switchDeviceId: "switch", luminaireDeviceIds: ["light2"] }]);
    expect(saved.nodes.FireProtectionSystem.surfaceChases).toMatchObject([{ id: "fire-fitting-chase", routeElementId: "fire-fitting" }]);
    expect(saved.nodes.strong.parentId).toBe("ElectricalSystem");
    expect(saved.nodes.strong.ports[0].connectedSegmentIds).toEqual(["light-segment", routeId]);
    const reopened = decodeUnifiedProject(saved, "saved.json", "sha2");
    expect(reopened.overlay.segments.find((item) => item.id === routeId)?.system).toBe("lighting");
    expect(reopened.overlay.lightingControlGroups).toHaveLength(1);
  });
});
