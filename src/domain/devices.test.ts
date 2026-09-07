import { describe, expect, it } from "vitest";
import { commitDeviceRoute, commitEndpointRoute, createNetworkDevice, deviceDiagnostics, insertDeviceOnSegment, openRouteEndpoints, placeDeviceAtEndpoint, placeNetworkDevice, portCanStart, rootLegacyNetwork, startRouteFromDevice } from "./devices";
import { createEmptyOverlay, type HostKind, type RoutePoint, type RoutingSystem } from "./overlay";
import { commitBranchRoute, deleteNetworkObject, planRoute } from "./routing";

const point = (x: number, y: number, z: number, hostKind: HostKind = "wall"): RoutePoint => ({ position: [x, y, z], attachment: { hostId: `${hostKind}-a`, hostKind, surface: hostKind === "wall" ? "interior" : "top", normal: hostKind === "wall" ? [0, 0, 1] : [0, 1, 0], levelId: "L0" } });
function rooted(system: RoutingSystem) {
  const sourceType = system === "network" ? "weak-panel" : system === "sprinkler" ? "fire-inlet" : "strong-panel";
  const host: HostKind = sourceType === "fire-inlet" ? "slab" : "wall";
  let overlay = placeNetworkDevice(createEmptyOverlay("a.json", "sha"), sourceType, point(0, 1, 0, host));
  const start = startRouteFromDevice(overlay, overlay.devices[0].id, system); overlay = start.overlay;
  const end = system === "sprinkler" ? point(2, 1, 0, "slab") : point(2, 1, 0);
  return commitDeviceRoute(overlay, planRoute(system, system === "sprinkler" ? 50 : 20, system === "sprinkler" ? "suspended" : "surface", [start.port.position, end]), start.circuit, start.port);
}

describe("network devices and rooted circuits", () => {
  it.each(["receptacle", "lighting", "network", "sprinkler"] as const)("commits an open %s route from its legal source", (system) => {
    const overlay = rooted(system);
    expect(overlay.segments.some((segment) => segment.system === system && segment.legacyUnrooted === false)).toBe(true);
    expect(overlay.circuits.some((circuit) => circuit.system === system && circuit.status === "rooted")).toBe(true);
  });

  it("enforces device hosts and source system capabilities", () => {
    expect(() => createNetworkDevice("strong-panel", point(0, 0, 0, "slab"))).toThrow();
    const strong = createNetworkDevice("strong-panel", point(0, 1, 0));
    expect(strong.systems).toEqual(["receptacle", "lighting"]);
    expect(strong.ports.map((port) => port.id)).toEqual([`${strong.id}:port:0`, `${strong.id}:port:1`]);
    const weak = createNetworkDevice("weak-panel", point(1, 1, 0));
    expect(weak.systems).toEqual(["network"]);
    const head = createNetworkDevice("sprinkler-head", point(1, 2, 0, "ceiling"));
    expect(head.orientation).toEqual([0, 1, 0]);
  });

  it("creates rooted circuits from the correct source and dynamic source ports", () => {
    let overlay = placeNetworkDevice(createEmptyOverlay("a.json", "sha"), "strong-panel", point(0, 1, 0));
    const first = startRouteFromDevice(overlay, overlay.devices[0].id, "receptacle");
    expect(first.circuit).toMatchObject({ status: "rooted", sourceDeviceId: overlay.devices[0].id, system: "receptacle" });
    expect(() => startRouteFromDevice(overlay, overlay.devices[0].id, "network")).toThrow();
    const used = commitDeviceRoute(first.overlay, planRoute("receptacle", 20, "surface", [first.port.position, point(1, 1, 0)]), first.circuit, first.port);
    const second = startRouteFromDevice(used, used.devices[0].id, "receptacle");
    expect(second.port.id).not.toBe(first.port.id);
    expect(second.port.position.position).not.toEqual(first.port.position.position);
  });

  it("rejects a route commit when the supplied circuit has no valid matching source", () => {
    const overlay = createEmptyOverlay("a.json", "sha"), device = createNetworkDevice("socket", point(0, 1, 0));
    const fakeCircuit = { id: "fake", system: "receptacle" as const, sourceDeviceId: device.id, rootPortId: device.ports[0].id, segmentIds: [], status: "rooted" as const, createdAt: new Date(0).toISOString() };
    const invalid = { ...overlay, devices: [device], circuits: [fakeCircuit] };
    const plan = planRoute("receptacle", 20, "surface", [device.ports[0].position, point(1, 1, 0)]);
    expect(commitDeviceRoute(invalid, plan, fakeCircuit, device.ports[0])).toBe(invalid);
  });

  it("splits a rooted receptacle route at a socket and terminates both conduits at ports", () => {
    const overlay = rooted("receptacle"), original = overlay.segments[0];
    const inserted = insertDeviceOnSegment(overlay, original.id, "socket", [1, 1, 0]), socket = inserted.devices.find((device) => device.deviceType === "socket")!;
    expect(inserted.segments).toHaveLength(2);
    expect(socket.ports).toHaveLength(8);
    expect(new Set(inserted.segments.flatMap((segment) => [segment.startPortId, segment.endPortId]).filter((id): id is string => Boolean(id?.startsWith(socket.id))))).toHaveLength(2);
    expect(inserted.segments.some((segment) => segment.start.position[0] < 1 && segment.end.position[0] > 1)).toBe(false);
    expect(portCanStart(inserted, socket, socket.ports[2], "receptacle")).toBe(true);
    expect(inserted.devices[0].ports.flatMap((port) => port.connectedSegmentIds)).not.toContain(original.id);
  });

  it("lets a clicked occupied 86-box hole start a route by shifting its existing conduit to the peer hole", () => {
    const overlay = rooted("receptacle"), inserted = insertDeviceOnSegment(overlay, overlay.segments[0].id, "socket", [1, 1, 0]);
    const socket = inserted.devices.find((device) => device.deviceType === "socket")!, occupied = socket.ports.find((port) => port.connectedSegmentIds.length > 0)!;
    const peer = socket.ports.find((port) => port.face === occupied.face && port.id !== occupied.id && port.connectedSegmentIds.length === 0)!;
    expect(portCanStart(inserted, socket, occupied, "receptacle")).toBe(true);
    const started = startRouteFromDevice(inserted, socket.id, "receptacle", occupied.id);
    const shifted = started.overlay.devices.find((device) => device.id === socket.id)!;
    expect(started.port.id).toBe(occupied.id);
    expect(shifted.ports.find((port) => port.id === occupied.id)?.connectedSegmentIds).toEqual([]);
    expect(shifted.ports.find((port) => port.id === peer.id)?.connectedSegmentIds).toEqual(occupied.connectedSegmentIds);
    expect(started.overlay.segments.some((segment) => segment.startPortId === peer.id || segment.endPortId === peer.id)).toBe(true);
  });

  it("allows an inline socket on a rooted floor route while keeping manual placement wall-only", () => {
    const original = rooted("receptacle"), segment = original.segments[0], routed = { ...original, segments: [{ ...segment, start: point(0, 0, 0, "slab"), end: point(2, 0, 0, "slab") }] };
    const inserted = insertDeviceOnSegment(routed, segment.id, "socket", [1, 0, 0]);
    expect(inserted.devices.some((device) => device.deviceType === "socket" && device.position.attachment?.hostKind === "slab")).toBe(true);
    expect(() => createNetworkDevice("socket", point(1, 0, 0, "slab"))).toThrow();
  });

  it("supports floating point devices, stable 86-box holes and a terminal network outlet on an open end", () => {
    const red = rooted("receptacle"), blue = rooted("lighting"), white = rooted("network");
    const floatingRed = { ...red, segments: red.segments.map((segment) => ({ ...segment, start: { position: [0, 2, 0] as [number, number, number] }, end: { position: [2, 2, 0] as [number, number, number] } })) };
    const socket = insertDeviceOnSegment(floatingRed, floatingRed.segments[0].id, "socket", [1, 2, 0]);
    expect(socket.devices.find((device) => device.deviceType === "socket")?.mount).toMatchObject({ kind: "segment" });
    expect(socket.devices.find((device) => device.deviceType === "socket")?.ports.filter((port) => port.face === "left" || port.face === "right")).toHaveLength(4);
    const floatingBlue = { ...blue, segments: blue.segments.map((segment) => ({ ...segment, start: { position: [0, 2, 0] as [number, number, number] }, end: { position: [0, 2, 2] as [number, number, number] } })) };
    const light = insertDeviceOnSegment(floatingBlue, floatingBlue.segments[0].id, "luminaire", [0, 2, 1]);
    const luminaire = light.devices.find((device) => device.deviceType === "luminaire")!;
    expect(luminaire.frame?.up).toEqual([0, 1, 0]);
    expect(luminaire.ports.every((port) => Math.abs(port.direction[1]) < 1e-8 && Math.abs(port.position.position[1] - luminaire.position.position[1]) < 1e-8)).toBe(true);
    const floatingWhite = { ...white, segments: white.segments.map((segment) => ({ ...segment, start: { position: [0, 2, 0] as [number, number, number] }, end: { position: [2, 2, 0] as [number, number, number] } })) }, endpoints = openRouteEndpoints(floatingWhite);
    const outlet = placeDeviceAtEndpoint(floatingWhite, endpoints[0], "network-outlet");
    expect(outlet.devices.find((device) => device.deviceType === "network-outlet")?.ports.some((port) => port.connectedSegmentIds.length === 1)).toBe(true);
    expect(openRouteEndpoints(outlet).some((endpoint) => endpoint.segmentId === endpoints[0].segmentId && endpoint.end === endpoints[0].end)).toBe(false);
  });

  it("continues a rooted route from an open conduit end without a device", () => {
    const base = rooted("receptacle"), endpoint = openRouteEndpoints(base)[0]!;
    const plan = planRoute(endpoint.system, 20, "surface", [endpoint.point, point(3, 1, 1)]);
    const extended = commitEndpointRoute(base, endpoint, plan);
    expect(extended.segments.length).toBeGreaterThan(base.segments.length);
    expect(extended.fittings.some((fitting) => fitting.segmentIds.includes(endpoint.segmentId))).toBe(true);
  });

  it("connects to a terminal device and continues the same circuit from a socket", () => {
    let overlay = placeNetworkDevice(createEmptyOverlay("a.json", "sha"), "strong-panel", point(0, 1, 0));
    overlay = placeNetworkDevice(overlay, "socket", point(1, 1, 0));
    const source = startRouteFromDevice(overlay, overlay.devices[0].id, "receptacle");
    const connected = commitDeviceRoute(source.overlay, planRoute("receptacle", 20, "surface", [source.port.position, overlay.devices[1].position]), source.circuit, source.port, overlay.devices[1].id);
    const continuation = startRouteFromDevice(connected, connected.devices[1].id, "receptacle");
    expect(continuation.circuit.id).toBe(source.circuit.id);
    expect(continuation.port.connectedSegmentIds).toEqual([]);
  });

  it("terminates a network circuit at one network panel", () => {
    let overlay = placeNetworkDevice(createEmptyOverlay("a.json", "sha"), "weak-panel", point(0, 1, 0));
    overlay = placeNetworkDevice(overlay, "network-outlet", point(1, 1, 0));
    const source = startRouteFromDevice(overlay, overlay.devices[0].id, "network");
    const connected = commitDeviceRoute(source.overlay, planRoute("network", 20, "surface", [source.port.position, overlay.devices[1].position]), source.circuit, source.port, overlay.devices[1].id);
    expect(connected.devices[1].ports[0].connectedSegmentIds).toHaveLength(1);
    expect(() => startRouteFromDevice(connected, connected.devices[1].id, "network")).toThrow();
  });

  it("forbids network branching and makes the network outlet a terminal sink", () => {
    const overlay = rooted("network"), segment = overlay.segments[0];
    expect(commitBranchRoute(overlay, segment.id, [point(1, 1, 0), point(1, 1, 1)], { chaseWidthMm: 30, chaseDepthMm: 25, penetrationDiameterMm: 30 })).toBe(overlay);
    expect(insertDeviceOnSegment(overlay, segment.id, "network-outlet", [1, 1, 0])).toBe(overlay);
    const outlet = createNetworkDevice("network-outlet", point(2, 1, 0));
    expect(outlet.ports.every((port) => port.role === "sink")).toBe(true);
    expect(() => startRouteFromDevice({ ...overlay, devices: [...overlay.devices, outlet] }, outlet.id, "network")).toThrow();
  });

  it("inserts an upward sprinkler head using a tee and a short branch", () => {
    const overlay = rooted("sprinkler"), segment = overlay.segments[0], inserted = insertDeviceOnSegment(overlay, segment.id, "sprinkler-head", [1, 1, 0]);
    const head = inserted.devices.find((device) => device.deviceType === "sprinkler-head")!;
    expect(inserted.fittings).toEqual(expect.arrayContaining([expect.objectContaining({ fitting: "tee", system: "sprinkler" })]));
    expect(head.orientation).toEqual([0, 1, 0]);
    expect(head.ports[0].connectedSegmentIds).toHaveLength(1);
  });

  it("inserts a sprinkler head on a floating segment after a standard elbow", () => {
    let overlay = rooted("sprinkler");
    const circuit = overlay.circuits[0], first = overlay.segments[0];
    overlay = { ...overlay, segments: [{ ...first, start: { position: [0, 2, 0] }, end: { position: [1, 2, 0] }, circuitId: circuit.id }] };
    const extension = planRoute("sprinkler", 50, "suspended", [{ position: [1, 2, 0] }, { position: [1, 2, 1] }]);
    const endpoint = openRouteEndpoints(overlay).find((candidate) => candidate.end === "end")!;
    overlay = commitEndpointRoute(overlay, endpoint, extension);
    const afterElbow = overlay.segments.find((segment) => segment.id !== first.id && Math.abs(segment.end.position[2] - 1) < .01)!;
    const withHead = insertDeviceOnSegment(overlay, afterElbow.id, "sprinkler-head", [1, 2, .5]);
    expect(withHead.devices.some((device) => device.deviceType === "sprinkler-head")).toBe(true);
    expect(withHead.fittings.filter((fitting) => fitting.fitting === "tee").length).toBeGreaterThan(0);
  });

  it("deletes a source, its circuit and connected network atomically", () => {
    const overlay = rooted("lighting"), sourceId = overlay.devices[0].id, removed = deleteNetworkObject(overlay, sourceId);
    expect(removed.devices).toHaveLength(0); expect(removed.circuits).toHaveLength(0); expect(removed.segments).toHaveLength(0);
    expect(deviceDiagnostics(removed)).toEqual([]);
  });

  it("roots an entire compatible legacy component after reaching its open end", () => {
    const base = rooted("receptacle"), sourceCircuit = base.circuits[0], legacyId = "legacy-receptacle";
    const legacySegments = [
      { ...base.segments[0], id: "legacy-a", start: point(3, 1, 0), end: point(4, 1, 0), circuitId: legacyId, legacyUnrooted: true },
      { ...base.segments[0], id: "legacy-b", start: point(4, 1, 0), end: point(5, 1, 0), circuitId: legacyId, legacyUnrooted: true },
    ];
    const withLegacy = { ...base, segments: [...base.segments, ...legacySegments], circuits: [...base.circuits, { id: legacyId, system: "receptacle" as const, sourceDeviceId: null, rootPortId: null, segmentIds: legacySegments.map((segment) => segment.id), status: "legacy-unrooted" as const, createdAt: new Date(0).toISOString() }] };
    const connected = rootLegacyNetwork(withLegacy, "legacy-a", sourceCircuit.id);
    expect(connected.circuits.some((circuit) => circuit.id === legacyId)).toBe(false);
    expect(connected.circuits.find((circuit) => circuit.id === sourceCircuit.id)?.segmentIds).toEqual(expect.arrayContaining(["legacy-a", "legacy-b"]));
    expect(connected.segments.filter((segment) => segment.id.startsWith("legacy-"))).toEqual(expect.arrayContaining([expect.objectContaining({ circuitId: sourceCircuit.id, legacyUnrooted: false })]));
    expect(rootLegacyNetwork(withLegacy, "legacy-a", "missing")).toBe(withLegacy);
  });
});
