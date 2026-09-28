import { describe, expect, it } from "vitest";
import type { RoutePoint } from "./overlay";
import { decodeUnifiedProject, encodeUnifiedProject } from "./unified-project";

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
  nodes.light.ports = [{ id: "light:port:3", owner: { kind: "device", id: "light" }, position: point(1), direction: [1, 0, 0], role: "bidirectional", system: "lighting", connectedSegmentIds: ["light-segment"], face: "right", slot: 1, customPortField: "preserve" }];
  nodes.light2 = device("light2", "Spotlight", "LightingSystem", "luminaire", "lighting");
  nodes["light-segment"] = { id: "light-segment", type: "Conduit", parentId: "LightingSystem", system: "lighting", diameterMm: 20, start: point(0), end: point(1), startPortId: "shared-port", endPortId: "light:port:3", circuitId: "light-circuit", createdAt: "now", plugin: { preserve: true } };
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
    expect(saved.nodes.light).toMatchObject({ id: "light", type: "LightingJunctionBox", ports: [{ id: "light:port:3", connectedSegmentIds: ["light-segment"], customPortField: "preserve" }] });
    expect(saved.nodes["light-segment"]).toMatchObject({ id: "light-segment", startPortId: "shared-port", endPortId: "light:port:3" });
    expect(saved.nodes.strong.parentId).toBe("ElectricalSystem");
    expect(Object.values(saved.nodes).filter((node) => node.id === "strong")).toHaveLength(1);
    expect(saved.nodes.strong.ports[0]).toMatchObject({ id: "shared-port", custom: { retain: true } });
    expect(saved.nodes.LightingSystem.children).toEqual(expect.arrayContaining(["light-segment", "light-fitting", "light-box"]));
    expect(saved.nodes.FireProtectionSystem.children).toEqual(expect.arrayContaining(["fire-segment", "fire-fitting"]));
    expect(saved.nodes["fire-fitting"]).toMatchObject({ type: "FireWaterPipeTee", fitting: "tee" });
    expect(saved.nodes.wall).toEqual(raw.nodes.wall);
    const reopened = decodeUnifiedProject(saved, "saved.json", "sha2");
    expect(reopened.overlay.circuits.find((item) => item.id === "light-circuit")?.rootPortId).toBe("shared-port");
    expect(loaded.overlay.lightingControlGroups).toEqual([]);
    expect(saved.nodes.LightingSystem.lightingControlGroups).toBeUndefined();
    expect(reopened.overlay.lightingControlGroups).toEqual([]);
    expect(reopened.overlay.surfaceChases).toHaveLength(1);
    expect(reopened.overlay.penetrations).toHaveLength(1);
  });

  it("drops legacy lighting control groups during import and export", () => {
    const loaded = decodeUnifiedProject(project(), "combined.json", "sha");
    expect(loaded.overlay.lightingControlGroups).toEqual([]);
    const staleOverlay = { ...loaded.overlay, lightingControlGroups: [{ id: "control", switchDeviceId: "switch", luminaireDeviceIds: ["light"], createdAt: "now" }] };
    const saved = encodeUnifiedProject(loaded.projectRaw, staleOverlay);
    expect(saved.nodes.LightingSystem.lightingControlGroups).toBeUndefined();
    expect(saved.nodes.light).toMatchObject({ id: "light", type: "LightingJunctionBox" });
    expect(saved.nodes["light-segment"]).toMatchObject({ id: "light-segment", type: "Conduit" });
    expect(saved.nodes.strong.ports[0].connectedSegmentIds).toEqual(["light-segment"]);
    expect(saved.nodes.wall).toEqual(project().nodes.wall);
    expect(decodeUnifiedProject(saved, "saved.json", "sha2").overlay.lightingControlGroups).toEqual([]);
  });

  it("continues lighting routes without saving logical control groups", () => {
    const loaded = decodeUnifiedProject(project(), "combined.json", "sha");
    const made = loaded.overlay;
    const routeId = "new-light-segment";
    const added = {
      ...made,
      segments: [...made.segments, { id: routeId, type: "conduit-segment" as const, system: "lighting" as const, diameterMm: 20, start: point(1), end: point(2), startPortId: "shared-port", circuitId: "light-circuit", createdAt: "now" }],
      circuits: made.circuits.map((circuit) => circuit.id === "light-circuit" ? { ...circuit, segmentIds: [...circuit.segmentIds, routeId] } : circuit),
      devices: made.devices.map((item) => item.id === "strong" ? { ...item, ports: item.ports.map((port) => port.id === "shared-port" ? { ...port, connectedSegmentIds: [...port.connectedSegmentIds, routeId] } : port) } : item),
      surfaceChases: [...made.surfaceChases, { ...made.surfaceChases[0], id: "fire-fitting-chase", routeElementId: "fire-fitting" }],
    };
    const saved = encodeUnifiedProject(loaded.projectRaw, added);
    expect(saved.nodes[routeId]).toMatchObject({ type: "Conduit", parentId: "LightingSystem", startPortId: "shared-port" });
    expect(saved.nodes.LightingSystem.circuits[0].segmentIds).toEqual(["light-segment", routeId]);
    expect(saved.nodes.LightingSystem.lightingControlGroups).toBeUndefined();
    expect(saved.nodes.FireProtectionSystem.surfaceChases).toMatchObject([{ id: "fire-fitting-chase", routeElementId: "fire-fitting" }]);
    expect(saved.nodes.strong.parentId).toBe("ElectricalSystem");
    expect(saved.nodes.strong.ports[0].connectedSegmentIds).toEqual(["light-segment", routeId]);
    const reopened = decodeUnifiedProject(saved, "saved.json", "sha2");
    expect(reopened.overlay.segments.find((item) => item.id === routeId)?.system).toBe("lighting");
    expect(reopened.overlay.lightingControlGroups).toHaveLength(0);
  });
});
