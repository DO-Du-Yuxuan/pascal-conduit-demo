import { describe, expect, it } from "vitest";
import { commitDeviceRoute, commitEndpointRoute, createNetworkDevice, deviceDiagnostics, deviceTargetPorts, insertDeviceOnSegment, nearestDeviceTargetPort, openRouteEndpoints, placeDeviceAtEndpoint, placeNetworkDevice, portCanStart, resetDeviceIdsForTests, rootLegacyNetwork, setSprinklerDirection, startRouteFromDevice } from "./devices";
import { createEmptyOverlay, DEVICE_TYPES, parseOverlay, type HostKind, type RoutePoint, type RoutingSystem } from "./overlay";
import { commitBranchRoute, commitJunctionBoxRoute, commitPlannedRoute, deleteNetworkObject, junctionBoxPortCanStart, planRoute, startRouteFromJunctionBox } from "./routing";
import { withCollisionDiagnostics } from "./routing-collision";

const point = (x: number, y: number, z: number, hostKind: HostKind = "wall"): RoutePoint => ({ position: [x, y, z], attachment: { hostId: `${hostKind}-a`, hostKind, surface: hostKind === "wall" ? "interior" : "top", normal: hostKind === "wall" ? [0, 0, 1] : [0, 1, 0], levelId: "L0" } });
function rooted(system: RoutingSystem) {
  if (system === "sprinkler") return commitPlannedRoute(createEmptyOverlay("a.json", "sha"), planRoute("sprinkler", 50, "suspended", [point(0, 1, 0, "slab"), point(2, 1, 0, "slab")]));
  const sourceType = system === "network" ? "weak-panel" : "strong-panel";
  const host: HostKind = "wall";
  let overlay = placeNetworkDevice(createEmptyOverlay("a.json", "sha"), sourceType, point(0, 1, 0, host));
  const start = startRouteFromDevice(overlay, overlay.devices[0].id, system); overlay = start.overlay;
  const end = point(2, 1, 0);
  return commitDeviceRoute(overlay, planRoute(system, 20, "surface", [start.port.position, end]), start.circuit, start.port);
}

describe("network devices and rooted circuits", () => {
  it("creates a unique device and its physical ports after importing legacy sequential device IDs", () => {
    resetDeviceIdsForTests();
    const importedSocket = createNetworkDevice("socket", point(0, 1, 0));
    const importedLuminaire = createNetworkDevice("luminaire", point(0, 2.7, 0, "ceiling"));
    const imported = { ...createEmptyOverlay("imported.json", "sha"), devices: [importedSocket, importedLuminaire] };

    resetDeviceIdsForTests();
    const addedSocket = createNetworkDevice("socket", point(2, 1, 0));
    const addedLuminaire = createNetworkDevice("luminaire", point(2, 2.7, 0, "ceiling"));
    const allDeviceIds = [...imported.devices, addedSocket, addedLuminaire].map((device) => device.id);
    const allPortIds = [...imported.devices, addedSocket, addedLuminaire].flatMap((device) => device.ports.map((port) => port.id));

    expect(new Set(allDeviceIds)).toHaveLength(allDeviceIds.length);
    expect(new Set(allPortIds)).toHaveLength(allPortIds.length);
  });

  it("offers compatible open physical ports and selects the one nearest the pointer", () => {
    const socket = createNetworkDevice("socket", point(0, 1, 0));
    const occupiedId = socket.ports[0].id;
    const withOccupiedPort = { ...socket, ports: socket.ports.map((port) => port.id === occupiedId ? { ...port, connectedSegmentIds: ["existing"] } : port) };
    const targets = deviceTargetPorts(withOccupiedPort, "receptacle");
    const expected = targets[3];

    expect(targets).toHaveLength(7);
    expect(targets.some((port) => port.id === occupiedId)).toBe(false);
    expect(deviceTargetPorts(withOccupiedPort, "lighting")).toEqual([]);
    expect(nearestDeviceTargetPort(withOccupiedPort, "receptacle", expected.position.position)?.id).toBe(expected.id);
  });

  it("keeps a bridge bend when a routed endpoint connects to a target device port", () => {
    let overlay = placeNetworkDevice(createEmptyOverlay("a.json", "sha"), "strong-panel", point(-2, 0, 0));
    overlay = placeNetworkDevice(overlay, "socket", point(2, 0, 1));
    const started = startRouteFromDevice(overlay, overlay.devices[0].id, "receptacle"), target = overlay.devices[1].ports.find((port) => port.system === "receptacle")!;
    const existing = planRoute("lighting", 20, "surface", [point(0, 0, -1, "slab"), point(0, 0, 1, "slab")]);
    overlay = { ...started.overlay, segments: existing.segments, fittings: existing.fittings };
    const planned = withCollisionDiagnostics(overlay, planRoute("receptacle", 20, "surface", [started.port.position, point(-1, 0, 0, "slab"), point(1, 0, 0, "slab"), target.position]), undefined, new Set([overlay.devices[0].id, overlay.devices[1].id]));
    const committed = commitDeviceRoute(overlay, planned, started.circuit, started.port, overlay.devices[1].id, target.id);
    expect(planned.fittings.some((fitting) => fitting.fitting === "bridge-bend")).toBe(true);
    expect(committed.devices[1].ports.find((port) => port.id === target.id)?.connectedSegmentIds).toHaveLength(1);
    expect(committed.fittings.some((fitting) => fitting.fitting === "bridge-bend")).toBe(true);
  });

  it.each(["receptacle", "lighting", "network"] as const)("commits an open %s route from its legal source", (system) => {
    const overlay = rooted(system);
    expect(overlay.segments.some((segment) => segment.system === system && segment.legacyUnrooted === false)).toBe(true);
    expect(overlay.circuits.some((circuit) => circuit.system === system && circuit.status === "rooted")).toBe(true);
  });

  it("commits a free-start fire-water route without a Circuit", () => {
    const overlay = rooted("sprinkler");
    expect(overlay.segments[0]?.system).toBe("sprinkler");
    expect(overlay.segments[0]?.circuitId).toBeUndefined();
    expect(overlay.circuits).toEqual([]);
    expect(deviceDiagnostics(overlay)).toEqual([]);
  });

  it("enforces device hosts and source system capabilities", () => {
    expect(() => createNetworkDevice("strong-panel", point(0, 0, 0, "slab"))).toThrow();
    const strong = createNetworkDevice("strong-panel", point(0, 1, 0));
    expect(strong.systems).toEqual(["receptacle", "lighting"]);
    expect(strong.ports.filter((port) => port.system === "receptacle")).toHaveLength(20);
    expect(strong.ports.filter((port) => port.system === "lighting")).toHaveLength(20);
    expect(strong.ports.map((port) => port.id)).toContain(`${strong.id}:port:0`);
    expect(strong.ports.map((port) => port.id)).toContain(`${strong.id}:port:1`);
    const weak = createNetworkDevice("weak-panel", point(1, 1, 0));
    expect(weak.systems).toEqual(["network"]);
    expect(weak.ports).toHaveLength(20);
    expect(weak.ports.filter((port) => port.position.position[1] < weak.position.position[1])).toHaveLength(10);
    expect(weak.ports.filter((port) => port.position.position[1] > weak.position.position[1])).toHaveLength(10);
    expect(weak.ports.slice(0, 10).every((port) => port.direction[1] < -.99)).toBe(true);
    expect(weak.ports.slice(10).every((port) => port.direction[1] > .99)).toBe(true);
    const head = createNetworkDevice("sprinkler-head", point(1, 2, 0, "ceiling"));
    expect(head.orientation).toEqual([0, 1, 0]);
    expect(head.sprinklerDirection).toBe("upright");
  });

  it("mounts every compatible device type on exposed Beam faces with face-derived frames and ports", () => {
    const faces = [
      { surface: "bottom", normal: [0, -1, 0] as [number, number, number], u: [0, 0, 1] as [number, number, number], v: [1, 0, 0] as [number, number, number] },
      { surface: "side-a", normal: [0, 0, -1] as [number, number, number], u: [1, 0, 0] as [number, number, number], v: [0, 1, 0] as [number, number, number] },
      { surface: "end-a", normal: [-1, 0, 0] as [number, number, number], u: [0, 0, 1] as [number, number, number], v: [0, 1, 0] as [number, number, number] },
    ];
    for (const face of faces) for (const type of DEVICE_TYPES.filter((type) => type !== "rfid-reader" || face.surface !== "bottom")) {
      const position: RoutePoint = { position: [1, 2, 3], attachment: { hostId: "beam-a", hostKind: "beam", surface: face.surface, normal: face.normal, levelId: "L0", basis: { u: face.u, v: face.v } } };
      const device = createNetworkDevice(type, position);
      expect(device.position.attachment).toMatchObject({ hostId: "beam-a", hostKind: "beam", surface: face.surface });
      expect(device.frame?.front).toEqual(face.normal);
      expect(device.frame?.right).toEqual(position.attachment?.basis?.u);
      expect(device.frame?.up).toEqual(position.attachment?.basis?.v);
      expect(device.orientation).toEqual(face.normal);
      expect(device.ports.every((port) => port.position.attachment?.hostId === "beam-a")).toBe(true);
      expect(parseOverlay({ ...createEmptyOverlay("a", "b"), devices: [device] }).devices[0]).toMatchObject({ position: { attachment: { hostKind: "beam", surface: face.surface } } });
    }
    const top: RoutePoint = { position: [1, 2, 3], attachment: { hostId: "beam-a", hostKind: "beam", surface: "top", normal: [0, 1, 0], levelId: "L0" } };
    for (const type of DEVICE_TYPES) expect(() => createNetworkDevice(type, top)).toThrow();
  });

  it("allows RFID readers on a wall or Beam side, but rejects Beam top and bottom faces", () => {
    const wall: RoutePoint = { position: [1, 2, 3], attachment: { hostId: "wall-a", hostKind: "wall", surface: "interior", normal: [0, 0, 1], levelId: "L0" } };
    const side: RoutePoint = { position: [1, 2, 3], attachment: { hostId: "beam-a", hostKind: "beam", surface: "side-a", normal: [0, 0, -1], levelId: "L0" } };
    const bottom: RoutePoint = { position: [1, 2, 3], attachment: { hostId: "beam-a", hostKind: "beam", surface: "bottom", normal: [0, -1, 0], levelId: "L0" } };
    const top: RoutePoint = { position: [1, 2, 3], attachment: { hostId: "beam-a", hostKind: "beam", surface: "top", normal: [0, 1, 0], levelId: "L0" } };
    const reader = createNetworkDevice("rfid-reader", wall);
    expect(reader.position.attachment?.hostKind).toBe("wall");
    expect(reader.sizeMm).toEqual([86, 130, 25]);
    expect(reader.ports).toEqual([]);
    expect(createNetworkDevice("rfid-reader", side).position.attachment?.surface).toBe("side-a");
    expect(() => createNetworkDevice("rfid-reader", bottom)).toThrow(/RFID/);
    expect(() => createNetworkDevice("rfid-reader", top)).toThrow(/RFID/);
  });

  it("creates a sensor point without conduit ports or systems", () => {
    const sensor = createNetworkDevice("sensor", point(1, 2, 0, "ceiling"));
    expect(sensor.name).toBe("温湿度传感器");
    expect(sensor.systems).toEqual([]);
    expect(sensor.ports).toEqual([]);
  });

  it("changes a selected sprinkler between upright and pendent without moving its pipe port", () => {
    const head = createNetworkDevice("sprinkler-head", point(1, 2, 0, "ceiling"));
    const connected = { ...head, ports: [{ ...head.ports[0], connectedSegmentIds: ["sprinkler-run"] }] };
    const overlay = { ...createEmptyOverlay("a.json", "sha"), devices: [connected] };
    const updated = setSprinklerDirection(overlay, head.id, "pendent");

    expect(updated.devices[0]).toMatchObject({ sprinklerDirection: "pendent", position: connected.position, orientation: connected.orientation });
    expect(updated.devices[0]?.ports).toEqual(connected.ports);
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

  it("places ten conduits side-by-side along the lower edge of a strong-panel", () => {
    let overlay = placeNetworkDevice(createEmptyOverlay("a.json", "sha"), "strong-panel", point(0, 1, 0));
    const outputXs: number[] = [], outputYs: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      const started = startRouteFromDevice(overlay, overlay.devices[0].id, "receptacle");
      outputXs.push(started.port.position.position[0]);
      outputYs.push(started.port.position.position[1]);
      overlay = commitDeviceRoute(started.overlay, planRoute("receptacle", 20, "surface", [started.port.position, point(index + 1, 1, 0)]), started.circuit, started.port);
    }
    expect(new Set(outputXs.map((value) => value.toFixed(6))).size).toBe(10);
    expect(Math.max(...outputXs) - Math.min(...outputXs)).toBeGreaterThan(.3);
    expect(new Set(outputYs.map((value) => value.toFixed(6))).size).toBe(1);
    expect(outputYs[0]).toBeLessThan(.7);
  });

  it("gives both strong-panel systems the same twenty room-facing physical holes", () => {
    const panel = createNetworkDevice("strong-panel", point(0, 1, 0));
    const receptacle = panel.ports.filter((port) => port.system === "receptacle"), lighting = panel.ports.filter((port) => port.system === "lighting");
    expect(receptacle).toHaveLength(20);
    expect(lighting).toHaveLength(20);
    expect(receptacle.map((port) => port.position.position)).toEqual(lighting.map((port) => port.position.position));
    expect(receptacle.filter((port) => port.direction[1] < -.99)).toHaveLength(10);
    expect(receptacle.filter((port) => port.direction[1] > .99)).toHaveLength(10);
    expect(receptacle.every((port) => port.position.position[2] > panel.position.position[2] + panel.sizeMm[2] / 2000)).toBe(true);
  });

  it("prevents two systems from occupying the same shared panel hole", () => {
    let overlay = placeNetworkDevice(createEmptyOverlay("a.json", "sha"), "strong-panel", point(0, 1, 0));
    const panel = overlay.devices[0], redPort = panel.ports.find((port) => port.system === "receptacle")!;
    const bluePort = panel.ports.find((port) => port.system === "lighting" && port.position.position.every((value, axis) => value === redPort.position.position[axis]))!;
    const started = startRouteFromDevice(overlay, panel.id, "receptacle", redPort.id); overlay = started.overlay;
    overlay = commitDeviceRoute(overlay, planRoute("receptacle", 20, "surface", [started.port.position, point(1, .5, .1)]), started.circuit, started.port);
    expect(portCanStart(overlay, overlay.devices[0], overlay.devices[0].ports.find((port) => port.id === bluePort.id)!, "lighting")).toBe(false);
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
    const socketPortsById = new Map(socket.ports.map((port) => [port.id, port.position.position]));
    const socketEndpoints = inserted.segments.flatMap((segment) => [
      segment.startPortId && socketPortsById.has(segment.startPortId) ? { point: segment.start.position, port: socketPortsById.get(segment.startPortId)! } : null,
      segment.endPortId && socketPortsById.has(segment.endPortId) ? { point: segment.end.position, port: socketPortsById.get(segment.endPortId)! } : null,
    ]).filter((entry): entry is { point: [number, number, number]; port: [number, number, number] } => Boolean(entry));
    expect(socketEndpoints).toHaveLength(2);
    expect(socketEndpoints.every(({ point, port }) => point.every((value, axis) => Math.abs(value - port[axis]) < 1e-8))).toBe(true);
    expect(inserted.segments.some((segment) => segment.startPortId === original.startPortId && segment.start.position.every((value, axis) => Math.abs(value - original.start.position[axis]) < 1e-8))).toBe(true);
    expect(portCanStart(inserted, socket, socket.ports[2], "receptacle")).toBe(true);
    expect(inserted.devices[0].ports.flatMap((port) => port.connectedSegmentIds)).not.toContain(original.id);
  });

  it("lets a clicked occupied 86-box hole start a route by shifting its existing conduit to the peer hole", () => {
    const overlay = rooted("receptacle"), inserted = insertDeviceOnSegment(overlay, overlay.segments[0].id, "socket", [1, 1, 0]);
    const socket = inserted.devices.find((device) => device.deviceType === "socket")!, occupied = socket.ports.find((port) => port.connectedSegmentIds.length > 0)!;
    const peer = socket.ports.find((port) => port.face === occupied.face && port.id !== occupied.id && port.connectedSegmentIds.length === 0)!;
    const originalSegments = inserted.segments.map((segment) => ({ id: segment.id, start: [...segment.start.position], end: [...segment.end.position] }));
    expect(portCanStart(inserted, socket, occupied, "receptacle")).toBe(true);
    const started = startRouteFromDevice(inserted, socket.id, "receptacle", occupied.id);
    const shifted = started.overlay.devices.find((device) => device.id === socket.id)!;
    expect(started.port.id).toBe(occupied.id);
    expect(shifted.ports.find((port) => port.id === occupied.id)?.connectedSegmentIds).toEqual([]);
    expect(shifted.ports.find((port) => port.id === peer.id)?.connectedSegmentIds).toEqual(occupied.connectedSegmentIds);
    expect(started.overlay.segments.some((segment) => segment.startPortId === peer.id || segment.endPortId === peer.id)).toBe(true);
    expect(started.overlay.segments.map((segment) => ({ id: segment.id, start: [...segment.start.position], end: [...segment.end.position] }))).toEqual(originalSegments);
    expect(shifted.position.position).not.toEqual(socket.position.position);
  });

  it("uses the same eight-hole continuation model for a red or blue branch 86 box", () => {
    const base = rooted("receptacle"), branched = commitBranchRoute(base, base.segments[0].id, [point(1, 1, 0), point(1, 1, 1)], { chaseWidthMm: 30, chaseDepthMm: 25, penetrationDiameterMm: 30 });
    const box = branched.junctionBoxes[0], occupied = box.ports.find((port) => port.connectedSegmentIds.length > 0)!;
    expect(box.ports).toHaveLength(8);
    expect(junctionBoxPortCanStart(branched, box, occupied)).toBe(true);
    const before = branched.segments.map((segment) => ({ id: segment.id, start: [...segment.start.position], end: [...segment.end.position] }));
    const started = startRouteFromJunctionBox(branched, box.id, occupied.id);
    expect(started.port.id).toBe(occupied.id);
    expect(started.overlay.segments.map((segment) => ({ id: segment.id, start: [...segment.start.position], end: [...segment.end.position] }))).toEqual(before);
    const continuation = planRoute("receptacle", 20, "surface", [started.port.position, point(1, 2, 1)]);
    const committed = commitJunctionBoxRoute(started.overlay, started, continuation);
    expect(committed.segments.length).toBeGreaterThan(started.overlay.segments.length);
  });

  it("connects a route started at an 86 box to the clicked device port", () => {
    const base = rooted("receptacle");
    const branched = commitBranchRoute(base, base.segments[0].id, [point(1, 1, 0), point(1, 1, 1)], { chaseWidthMm: 30, chaseDepthMm: 25, penetrationDiameterMm: 30 });
    const target = createNetworkDevice("socket", point(1, 1, 2));
    const withTarget = { ...branched, devices: [...branched.devices, target] };
    const box = withTarget.junctionBoxes[0];
    const startPort = box.ports.find((port) => junctionBoxPortCanStart(withTarget, box, port))!;
    const started = startRouteFromJunctionBox(withTarget, box.id, startPort.id);
    const endPort = deviceTargetPorts(target, "receptacle")[0];
    const plan = planRoute("receptacle", 20, "surface", [started.port.position, endPort.position]);
    const connected = commitJunctionBoxRoute(started.overlay, started, plan, target.id, endPort.id);
    const lastSegment = connected.segments[connected.segments.length - 1]!;
    expect(connected).not.toBe(started.overlay);
    expect(lastSegment.endPortId).toBe(endPort.id);
    expect(connected.devices.find((device) => device.id === target.id)?.ports.find((port) => port.id === endPort.id)?.connectedSegmentIds).toEqual([lastSegment.id]);
  });

  it("allows every 86 box on floor and ceiling faces while keeping panels wall-only", () => {
    const original = rooted("receptacle"), segment = original.segments[0], routed = { ...original, segments: [{ ...segment, start: point(0, 0, 0, "slab"), end: point(2, 0, 0, "slab") }] };
    const inserted = insertDeviceOnSegment(routed, segment.id, "socket", [1, 0, 0]);
    expect(inserted.devices.some((device) => device.deviceType === "socket" && device.position.attachment?.hostKind === "slab")).toBe(true);
    for (const deviceType of ["socket", "switch", "network-outlet"] as const) {
      expect(createNetworkDevice(deviceType, point(1, 0, 0, "slab")).position.attachment?.hostKind).toBe("slab");
      const ceiling = createNetworkDevice(deviceType, { ...point(1, 2.7, 0, "ceiling"), attachment: { ...point(1, 2.7, 0, "ceiling").attachment!, normal: [0, -1, 0], surface: "ceiling-face" } });
      const ceilingBack = createNetworkDevice(deviceType, { ...point(1, 2.7, 0, "ceiling"), attachment: { ...point(1, 2.7, 0, "ceiling").attachment!, normal: [0, 1, 0], surface: "ceiling-back" } });
      expect(ceiling.frame?.front).toEqual([0, -1, 0]);
      expect(ceilingBack.frame?.front).toEqual([0, 1, 0]);
    }
    expect(() => createNetworkDevice("strong-panel", point(1, 0, 0, "slab"))).toThrow();
  });

  it("supports floating point devices, stable 86-box holes and a terminal network outlet on an open end", () => {
    const red = rooted("receptacle"), blue = rooted("lighting"), white = rooted("network");
    const floatingRed = { ...red, segments: red.segments.map((segment) => ({ ...segment, start: { position: [0, 2, 0] as [number, number, number] }, end: { position: [2, 2, 0] as [number, number, number] } })) };
    const socket = insertDeviceOnSegment(floatingRed, floatingRed.segments[0].id, "socket", [1, 2, 0]);
    expect(socket.devices.find((device) => device.deviceType === "socket")?.mount).toMatchObject({ kind: "segment" });
    expect(socket.devices.find((device) => device.deviceType === "socket")?.mount).toMatchObject({ levelId: "L0" });
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

  it("keeps the latest unconnected conduit end available for repeated continuation", () => {
    const base = rooted("receptacle"), endpoint = openRouteEndpoints(base)[0]!;
    const plan = planRoute(endpoint.system, 20, "surface", [endpoint.point, point(3, 1, 1)]);
    const extended = commitEndpointRoute(base, endpoint, plan);
    expect(extended.segments.length).toBeGreaterThan(base.segments.length);
    expect(extended.fittings.some((fitting) => fitting.segmentIds.includes(endpoint.segmentId))).toBe(true);
    const nextEndpoint = openRouteEndpoints(extended).find((candidate) => candidate.segmentId !== endpoint.segmentId);
    expect(nextEndpoint).toBeDefined();
    const twiceExtended = commitEndpointRoute(extended, nextEndpoint!, planRoute(nextEndpoint!.system, 20, "surface", [nextEndpoint!.point, point(4, 1, 1)]));
    expect(openRouteEndpoints(twiceExtended).some((candidate) => candidate.segmentId !== endpoint.segmentId)).toBe(true);
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
    const first = overlay.segments[0]!;
    overlay = { ...overlay, segments: [{ ...first, start: { position: [0, 2, 0] }, end: { position: [1, 2, 0] } }] };
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
