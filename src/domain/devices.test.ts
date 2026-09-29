import { describe, expect, it } from "vitest";
import { commitDeviceRoute, commitEndpointRoute, commitFireSignalRoute, commitFreeRouteToDevice, commitFreeSprinklerRouteToDeviceBranch, commitSprinklerDeviceRoute, createNetworkDevice, createSmokeDetector, deviceDiagnostics, deviceStartPorts, deviceTargetPorts, insertDeviceOnSegment, nearestDeviceTargetPort, openRouteEndpoints, placeDeviceAtEndpoint, placeNetworkDevice, portCanStart, resetDeviceIdsForTests, resizeSmokeDetectorDepth, resizeSmokeDetectorDiameter, rootLegacyNetwork, setSprinklerDirection, startRouteFromDevice, SPRINKLER_BRANCH_MIN_LENGTH_METERS, SPRINKLER_CONTINUATION_STUB_METERS, SPRINKLER_TEE_SOCKET_METERS } from "./devices";
import { createEmptyOverlay, DEVICE_TYPES, parseOverlay, type HostKind, type RoutePoint, type RoutingSystem } from "./overlay";
import { commitBranchRoute, commitJunctionBoxRoute, commitPlannedRoute, deleteNetworkObject, deleteNetworkObjects, junctionBoxPortCanStart, junctionBoxStartPorts, planRoute, startRouteFromJunctionBox } from "./routing";
import { withCollisionDiagnostics } from "./routing-collision";
import { circuitRouteElementIds } from "./route-selection";

const point = (x: number, y: number, z: number, hostKind: HostKind = "wall"): RoutePoint => ({ position: [x, y, z], attachment: { hostId: `${hostKind}-a`, hostKind, surface: hostKind === "wall" ? "interior" : "top", normal: hostKind === "wall" ? [0, 0, 1] : [0, 1, 0], levelId: "L0" } });
const subtractVector = (a: [number, number, number], b: [number, number, number]): [number, number, number] => a.map((value, axis) => value - b[axis]!) as [number, number, number];
const addVector = (a: [number, number, number], b: [number, number, number]): [number, number, number] => a.map((value, axis) => value + b[axis]!) as [number, number, number];
const scaleVector = (value: [number, number, number], amount: number): [number, number, number] => value.map((item) => item * amount) as [number, number, number];
const normalizeVector = (value: [number, number, number]): [number, number, number] => scaleVector(value, 1 / Math.hypot(...value));
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
  it("continues a connected sprinkler head through the same port at most once and releases the reference on deletion", () => {
    const head = createNetworkDevice("sprinkler-head", point(2, 2.7, 1, "ceiling")), port = head.ports[0]!;
    const incomingPlan = planRoute("sprinkler", 50, "suspended", [{ position: [0, 2.7, 1] }, port.position]);
    const incoming = commitFreeRouteToDevice({ ...createEmptyOverlay("sprinkler.json", "sha"), devices: [head] }, incomingPlan, head.id, port.id);
    const start = { deviceId: head.id, portId: port.id, connectedSegmentId: incomingPlan.segments[0]!.id };
    const connectedHead = incoming.devices[0]!;
    expect(deviceStartPorts(incoming, connectedHead, "sprinkler").map((item) => item.id)).toEqual([port.id]);
    const outgoingPlan = planRoute("sprinkler", 50, "suspended", [port.position, { position: [2, 2.7, 3] }]);
    const endpointChecked = withCollisionDiagnostics(incoming, outgoingPlan, undefined, new Set([head.id]), { segmentId: incomingPlan.segments[0]!.id, point: port.position.position });
    expect(endpointChecked.canCommit).toBe(true);
    const crossing = { ...incomingPlan.segments[0]!, id: "unrelated-crossing", start: { position: [1, 2.7, 2] as [number, number, number] }, end: { position: [3, 2.7, 2] as [number, number, number] }, startPortId: undefined, endPortId: undefined };
    const blocked = withCollisionDiagnostics({ ...incoming, segments: [...incoming.segments, crossing] }, outgoingPlan, undefined, new Set([head.id]), { segmentId: incomingPlan.segments[0]!.id, point: port.position.position });
    expect(blocked.canCommit).toBe(false);
    const connected = commitSprinklerDeviceRoute(incoming, outgoingPlan, start);
    const connectedPort = connected.devices[0]!.ports[0]!;
    expect(connectedPort.connectedSegmentIds).toEqual([incomingPlan.segments[0]!.id, outgoingPlan.segments[0]!.id]);
    expect(connected.segments.find((segment) => segment.id === outgoingPlan.segments[0]!.id)?.startPortId).toBe(port.id);
    expect(deviceStartPorts(connected, connected.devices[0]!, "sprinkler")).toEqual([]);
    expect(deviceDiagnostics(connected)).toEqual([]);
    expect(circuitRouteElementIds(connected, incomingPlan.segments[0]!.id)).toEqual(expect.arrayContaining([incomingPlan.segments[0]!.id, outgoingPlan.segments[0]!.id]));
    expect(parseOverlay(connected).devices[0]!.ports[0]!.connectedSegmentIds).toEqual(connectedPort.connectedSegmentIds);
    expect(deviceStartPorts({ ...createEmptyOverlay("sprinkler.json", "sha"), devices: [head] }, head, "sprinkler")).toEqual([]);

    const removedOutgoing = deleteNetworkObject(connected, outgoingPlan.segments[0]!.id);
    expect(removedOutgoing.devices[0]!.ports[0]!.connectedSegmentIds).toEqual([incomingPlan.segments[0]!.id]);
    expect(deviceStartPorts(removedOutgoing, removedOutgoing.devices[0]!, "sprinkler")).toHaveLength(1);
    const removedIncoming = deleteNetworkObject(removedOutgoing, incomingPlan.segments[0]!.id);
    expect(removedIncoming.devices[0]!.ports[0]!.connectedSegmentIds).toEqual([]);
    expect(deviceStartPorts(removedIncoming, removedIncoming.devices[0]!, "sprinkler")).toEqual([]);
  });

  it("branches from a connected sprinkler head directly to the next head while preserving the source port link", () => {
    const source = createNetworkDevice("sprinkler-head", point(0, 2.7, 0, "ceiling"));
    const target = createNetworkDevice("sprinkler-head", point(1, 2.7, 1, "ceiling"));
    const sourcePort = source.ports[0]!, targetPort = target.ports[0]!;
    const incomingPlan = planRoute("sprinkler", 50, "suspended", [{ position: [-2, 2.7, 0] }, sourcePort.position]);
    const incoming = commitFreeRouteToDevice({ ...createEmptyOverlay("sprinkler-branch.json", "sha"), devices: [source, target] }, incomingPlan, source.id, sourcePort.id);
    const mainPlan = planRoute("sprinkler", 50, "suspended", [sourcePort.position, { position: [1, 2.7, 0] }]);
    const branchPlan = planRoute("sprinkler", 50, "suspended", [{ position: [1, 2.7, SPRINKLER_TEE_SOCKET_METERS] }, targetPort.position]);
    const stubStart = { position: [1 + SPRINKLER_TEE_SOCKET_METERS, 2.7, 0] as [number, number, number] };
    const stubEnd = { position: [stubStart.position[0] + SPRINKLER_CONTINUATION_STUB_METERS, 2.7, 0] as [number, number, number] };
    const continuationPlan = planRoute("sprinkler", 50, "suspended", [stubStart, stubEnd]);
    const connected = commitFreeSprinklerRouteToDeviceBranch(incoming, mainPlan, branchPlan, continuationPlan, target.id, targetPort.id, undefined, { deviceId: source.id, portId: sourcePort.id, connectedSegmentId: incomingPlan.segments[0]!.id });
    expect(connected.segments.find((segment) => segment.id === mainPlan.segments[0]!.id)?.startPortId).toBe(sourcePort.id);
    expect(connected.devices.find((device) => device.id === source.id)?.ports[0]?.connectedSegmentIds).toEqual([incomingPlan.segments[0]!.id, mainPlan.segments[0]!.id]);
    expect(connected.devices.find((device) => device.id === target.id)?.ports[0]?.connectedSegmentIds).toEqual([branchPlan.segments[0]!.id]);
    expect(deviceDiagnostics(connected)).toEqual([]);
  });

  it("creates smoke detectors with four fire-signal ports and locks their diameter after a connection", () => {
    const position = point(0, 2.7, 0, "ceiling"), detector = createSmokeDetector(position);
    expect(detector).toMatchObject({ deviceType: "smoke-detector", sizeMm: [60, 60, 30], systems: ["fire-signal"] });
    expect(detector.ports).toHaveLength(4);
    expect(detector.ports.every((port) => port.system === "fire-signal" && port.role === "bidirectional")).toBe(true);
    const overlay = { ...createEmptyOverlay("a.json", "sha"), devices: [detector] };
    const resized = resizeSmokeDetectorDiameter(overlay, detector.id, 80), resizedDevice = resized.devices[0]!;
    expect(resizedDevice.id).toBe(detector.id);
    expect(resizedDevice.ports.map((port) => port.id)).toEqual(detector.ports.map((port) => port.id));
    expect(resizedDevice.ports[0].position.position).toEqual([.04, 2.7, 0]);
    expect(deviceStartPorts(overlay, detector, "fire-signal")).toHaveLength(4);
    expect(deviceStartPorts(overlay, detector, "network")).toHaveLength(0);
  });

  it("commits signal routes to a detector, an open free endpoint, or a sealed wall without a Circuit", () => {
    const start = createSmokeDetector(point(0, 2.7, 0, "ceiling")), end = createSmokeDetector(point(2, 2.7, 0, "ceiling"));
    const base = { ...createEmptyOverlay("a.json", "sha"), devices: [start, end] };
    const endPort = end.ports[1]!;
    const betweenPlan = planRoute("fire-signal", 20, "surface", [start.ports[0]!.position, endPort.position]);
    const between = commitFireSignalRoute(base, betweenPlan, start.id, start.ports[0]!.id, end.id, endPort.id);
    expect(between.circuits).toHaveLength(0);
    expect(between.devices.find((device) => device.id === start.id)?.ports[0]?.connectedSegmentIds).toHaveLength(1);
    expect(between.devices.find((device) => device.id === end.id)?.ports[1]?.connectedSegmentIds).toHaveLength(1);
    expect(openRouteEndpoints(between)).toHaveLength(0);

    const freeEnd = point(3, 2.7, 0, "ceiling"), freePlan = planRoute("fire-signal", 20, "surface", [end.ports[2]!.position, freeEnd]);
    const openRoute = commitFireSignalRoute(between, freePlan, end.id, end.ports[2]!.id);
    const openSegment = openRoute.segments[openRoute.segments.length - 1]!;
    expect(openSegment).toMatchObject({ system: "fire-signal", end: freeEnd });
    expect(openSegment.endTermination).toBeUndefined();
    expect(openSegment.endPortId).toBeUndefined();
    expect(openRouteEndpoints(openRoute).some((endpoint) => endpoint.segmentId === openSegment.id)).toBe(true);
    const freeEndpoint = openRouteEndpoints(openRoute).find((endpoint) => endpoint.segmentId === openSegment.id)!;
    const wallContinuation = planRoute("fire-signal", 20, "surface", [freeEndpoint.point, point(4, 2.7, 0, "wall")]);
    const continuedToWall = commitEndpointRoute(openRoute, freeEndpoint, wallContinuation, undefined, undefined, true);
    expect(continuedToWall.segments.some((segment) => segment.endTermination === "wall")).toBe(true);
    expect(openRouteEndpoints(continuedToWall).some((endpoint) => endpoint.segmentId === openSegment.id)).toBe(false);

    const third = createSmokeDetector(point(5, 2.7, 0, "ceiling")), withThird = { ...openRoute, devices: [...openRoute.devices, third] };
    const detectorContinuation = planRoute("fire-signal", 20, "surface", [freeEndpoint.point, third.ports[0]!.position]);
    const continuedToDetector = commitEndpointRoute(withThird, freeEndpoint, detectorContinuation, third.id, third.ports[0]!.id);
    expect(continuedToDetector.devices.find((device) => device.id === third.id)?.ports[0]?.connectedSegmentIds).toHaveLength(1);

    const wallEnd = point(3, 2.7, 0, "wall"), wallPlan = planRoute("fire-signal", 20, "surface", [end.ports[2]!.position, wallEnd]);
    expect(wallPlan.canCommit).toBe(true);
    const terminated = commitFireSignalRoute(between, wallPlan, end.id, end.ports[2]!.id, undefined, undefined, true);
    const terminalSegment = terminated.segments.find((segment) => segment.endTermination === "wall");
    expect(terminalSegment).toMatchObject({ system: "fire-signal", end: wallEnd, endTermination: "wall" });
    expect(terminalSegment?.endPortId).toBeUndefined();
    expect(openRouteEndpoints(terminated).some((endpoint) => endpoint.segmentId === terminalSegment?.id)).toBe(false);
    expect(resizeSmokeDetectorDiameter(terminated, end.id, 80)).toBe(terminated);
    const depthEdited = resizeSmokeDetectorDepth(terminated, end.id, 45), depthDevice = depthEdited.devices.find((device) => device.id === end.id)!;
    expect(depthDevice.sizeMm).toEqual([60, 60, 45]);
    expect(depthDevice.ports.map((port) => port.position.position)).toEqual(terminated.devices.find((device) => device.id === end.id)?.ports.map((port) => port.position.position));
  });

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

  it("uses a 60 mm diameter and 30 mm depth for newly placed lighting junction boxes", () => {
    const device = createNetworkDevice("luminaire", point(0, 2.7, 0, "ceiling"));

    expect(device.sizeMm).toEqual([60, 60, 30]);
    expect(device.ports.map((port) => port.position.position)).toEqual([
      [0.03, 2.7, 0], [-0.03, 2.7, 0], [0, 2.7, -0.03], [0, 2.7, 0.03],
    ]);
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

  it("offers only source ports belonging to the selected route system while retaining the shared strong-panel ports", () => {
    const overlay = createEmptyOverlay("a.json", "sha"), panel = createNetworkDevice("strong-panel", point(0, 1, 0)), socket = createNetworkDevice("socket", point(2, 1, 0));

    const lightingSources = deviceStartPorts(overlay, panel, "lighting");
    expect(lightingSources.length).toBeGreaterThan(0);
    expect(lightingSources.every((port) => port.system === "lighting")).toBe(true);
    expect(deviceStartPorts(overlay, panel, "receptacle").every((port) => port.system === "receptacle")).toBe(true);
    expect(deviceStartPorts(overlay, socket, "lighting")).toEqual([]);
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

  it("branches a free sprinkler main through a tee and open stub, then continues to another head", () => {
    const base = createEmptyOverlay("a.json", "sha");
    const firstHead = createNetworkDevice("sprinkler-head", point(2, 1, 1, "ceiling"));
    const firstPort = firstHead.ports[0]!;
    const mainPlan = planRoute("sprinkler", 50, "suspended", [point(0, 1, 0, "slab"), point(2, 1, 0, "slab")]);
    const tee = mainPlan.points[mainPlan.points.length - 1]!;
    const firstBranchDirection = normalizeVector(subtractVector(firstPort.position.position, tee.position));
    const firstBranchPort = { position: addVector(tee.position, scaleVector(firstBranchDirection, .05)) };
    const firstBranchPlan = planRoute("sprinkler", 50, "suspended", [firstBranchPort, firstPort.position]);
    const stubStart = { position: addVector(tee.position, [SPRINKLER_TEE_SOCKET_METERS, 0, 0]) as [number, number, number] };
    const stubEnd = { position: addVector(stubStart.position, [SPRINKLER_CONTINUATION_STUB_METERS, 0, 0]) as [number, number, number] };
    const firstStubPlan = planRoute("sprinkler", 50, "suspended", [stubStart, stubEnd]);
    const firstBase = { ...base, devices: [firstHead] };
    const firstCommit = commitFreeSprinklerRouteToDeviceBranch(firstBase, mainPlan, firstBranchPlan, firstStubPlan, firstHead.id, firstPort.id);

    expect(firstCommit).not.toBe(firstBase);
    expect(firstCommit.fittings).toHaveLength(1);
    const firstFitting = firstCommit.fittings[0]!;
    expect(firstFitting).toMatchObject({ fitting: "tee", system: "sprinkler" });
    expect(firstFitting.segmentIds).toHaveLength(3);
    expect(firstFitting.ports.every((port) => port.connectedSegmentIds.length === 1)).toBe(true);
    expect(firstCommit.devices.find((device) => device.id === firstHead.id)?.ports[0]?.connectedSegmentIds).toEqual([firstBranchPlan.segments[firstBranchPlan.segments.length - 1]!.id]);
    expect(firstCommit.circuits).toEqual([]);
    const firstOpen = openRouteEndpoints(firstCommit).find((endpoint) => endpoint.segmentId === firstStubPlan.segments[0]!.id && endpoint.end === "end")!;
    expect(firstOpen.point.position[0]).toBeCloseTo(2.2);
    expect(firstOpen.point.position.slice(1)).toEqual([1, 0]);

    const secondHead = createNetworkDevice("sprinkler-head", point(4, 1, 1, "ceiling"));
    const secondMainPlan = planRoute("sprinkler", 50, "suspended", [firstOpen.point, point(4, 1, 0, "slab")]);
    const secondTee = secondMainPlan.points[secondMainPlan.points.length - 1]!;
    const secondPort = secondHead.ports[0]!;
    const secondBranchDirection = normalizeVector(subtractVector(secondPort.position.position, secondTee.position));
    const secondBranchPlan = planRoute("sprinkler", 50, "suspended", [{ position: addVector(secondTee.position, scaleVector(secondBranchDirection, .05)) }, secondPort.position]);
    const secondStubStart = { position: addVector(secondTee.position, [SPRINKLER_TEE_SOCKET_METERS, 0, 0]) as [number, number, number] };
    const secondStubEnd = { position: addVector(secondStubStart.position, [SPRINKLER_CONTINUATION_STUB_METERS, 0, 0]) as [number, number, number] };
    const secondStubPlan = planRoute("sprinkler", 50, "suspended", [secondStubStart, secondStubEnd]);
    const connectedMain = commitFreeSprinklerRouteToDeviceBranch({ ...firstCommit, devices: [...firstCommit.devices, secondHead] }, secondMainPlan, secondBranchPlan, secondStubPlan, secondHead.id, secondPort.id, firstOpen);

    expect(connectedMain.fittings.filter((fitting) => fitting.fitting === "tee")).toHaveLength(2);
    expect(connectedMain.devices.find((device) => device.id === secondHead.id)?.ports[0]?.connectedSegmentIds).toEqual([secondBranchPlan.segments[secondBranchPlan.segments.length - 1]!.id]);
    expect(openRouteEndpoints(connectedMain)).toHaveLength(2);
    expect(parseOverlay(connectedMain).fittings.map((fitting) => fitting.segmentIds)).toEqual(connectedMain.fittings.map((fitting) => fitting.segmentIds));

    const removed = deleteNetworkObjects(connectedMain, [...connectedMain.fittings.map((fitting) => fitting.id), ...connectedMain.segments.map((segment) => segment.id)]);
    expect(removed.segments).toHaveLength(0);
    expect(removed.fittings).toHaveLength(0);
    expect(removed.devices.every((device) => device.ports.every((port) => port.connectedSegmentIds.length === 0))).toBe(true);
    expect(openRouteEndpoints(removed)).toHaveLength(0);
  });

  it("rejects a sprinkler branch that is too short or overlaps the main direction", () => {
    const base = createEmptyOverlay("a.json", "sha"), head = createNetworkDevice("sprinkler-head", point(2, 1, .1, "ceiling"));
    const main = planRoute("sprinkler", 50, "suspended", [point(0, 1, 0, "slab"), point(2, 1, 0, "slab")]);
    const target = head.ports[0]!;
    const tee = main.points[main.points.length - 1]!;
    const shortBranchDirection = normalizeVector(subtractVector(target.position.position, tee.position));
    const shortPlan = planRoute("sprinkler", 50, "suspended", [{ position: addVector(tee.position, scaleVector(shortBranchDirection, SPRINKLER_TEE_SOCKET_METERS)) }, target.position]);
    const mainDirection: [number, number, number] = [1, 0, 0];
    const shortStubPlan = planRoute("sprinkler", 50, "suspended", [{ position: addVector(tee.position, scaleVector(mainDirection, SPRINKLER_TEE_SOCKET_METERS)) }, { position: addVector(tee.position, scaleVector(mainDirection, SPRINKLER_TEE_SOCKET_METERS + SPRINKLER_CONTINUATION_STUB_METERS)) }]);
    const shortBase = { ...base, devices: [head] };
    expect(commitFreeSprinklerRouteToDeviceBranch(shortBase, main, shortPlan, shortStubPlan, head.id, target.id)).toBe(shortBase);

    const inlineHead = createNetworkDevice("sprinkler-head", point(3, 1, 0, "ceiling")), inlinePort = inlineHead.ports[0]!;
    const inlineDirection = normalizeVector(subtractVector(inlinePort.position.position, tee.position));
    const inlinePlan = planRoute("sprinkler", 50, "suspended", [{ position: addVector(tee.position, scaleVector(inlineDirection, SPRINKLER_TEE_SOCKET_METERS)) }, inlinePort.position]);
    const inlineBase = { ...base, devices: [inlineHead] };
    expect(commitFreeSprinklerRouteToDeviceBranch(inlineBase, main, inlinePlan, shortStubPlan, inlineHead.id, inlinePort.id)).toBe(inlineBase);
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
    for (const panel of [strong, weak]) {
      const sourcePort = panel.ports[0]!, normal = panel.frame!.front;
      const normalOffset = sourcePort.position.position.reduce((sum, value, axis) => sum + (value - panel.position.position[axis]!) * normal[axis]!, 0);
      expect(normalOffset).toBeCloseTo(0);
      expect(sourcePort.position.attachment).toEqual(panel.position.attachment);
    }
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

  it("keeps shared panel ports on the mounting surface and separates only overflow rows", () => {
    const panel = createNetworkDevice("strong-panel", point(0, 1, 0));
    const receptacle = panel.ports.filter((port) => port.system === "receptacle"), lighting = panel.ports.filter((port) => port.system === "lighting");
    expect(receptacle).toHaveLength(20);
    expect(lighting).toHaveLength(20);
    expect(receptacle.map((port) => port.position.position)).toEqual(lighting.map((port) => port.position.position));
    expect(receptacle.filter((port) => port.direction[1] < -.99)).toHaveLength(10);
    expect(receptacle.filter((port) => port.direction[1] > .99)).toHaveLength(10);
    expect(receptacle.every((port) => port.position.position[2] === panel.position.position[2])).toBe(true);
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
    expect(junctionBoxStartPorts(branched, box, "receptacle").length).toBeGreaterThan(0);
    expect(junctionBoxStartPorts(branched, box, "lighting")).toEqual([]);
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

  it("connects a free-start fire-water route to a sprinkler head without creating a circuit", () => {
    const base = createEmptyOverlay("a.json", "sha"), head = createNetworkDevice("sprinkler-head", point(2, 2, 0, "ceiling"));
    const overlay = { ...base, devices: [head] }, port = head.ports[0]!;
    const plan = planRoute("sprinkler", 50, "suspended", [{ position: [0, 2, 0] }, port.position]);

    const connected = commitFreeRouteToDevice(overlay, plan, head.id, port.id);
    const end = connected.segments[connected.segments.length - 1]!;

    expect(end.endPortId).toBe(port.id);
    expect(connected.devices[0]!.ports[0]!.connectedSegmentIds).toEqual([end.id]);
    expect(connected.circuits).toEqual([]);
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

  it("keeps the surviving 86-box ports usable after deleting an adjacent conduit segment", () => {
    const base = rooted("receptacle");
    const inserted = insertDeviceOnSegment(base, base.segments[0].id, "socket", [1, 1, 0]);
    const socket = inserted.devices.find((device) => device.deviceType === "socket")!;
    const downstream = socket.ports.flatMap((port) => port.connectedSegmentIds)
      .map((id) => inserted.segments.find((segment) => segment.id === id)!)
      .find((segment) => segment.end.position[0] > 1.5 || segment.start.position[0] > 1.5)!;
    const afterDelete = deleteNetworkObject(inserted, downstream.id);
    const remainingSocket = afterDelete.devices.find((device) => device.id === socket.id)!;
    const usablePorts = remainingSocket.ports.filter((port) => portCanStart(afterDelete, remainingSocket, port, "receptacle"));

    expect(afterDelete.circuits[0].status).toBe("broken");
    expect(usablePorts.length).toBeGreaterThan(0);
    const started = startRouteFromDevice(afterDelete, remainingSocket.id, "receptacle", usablePorts[0].id);
    const continuation = planRoute("receptacle", 20, "surface", [started.port.position, point(1, 2, 0)]);
    expect(commitDeviceRoute(started.overlay, continuation, started.circuit, started.port).segments.length)
      .toBeGreaterThan(afterDelete.segments.length);

    const allGone = afterDelete.segments.reduce((current, segment) => deleteNetworkObject(current, segment.id), afterDelete);
    const disconnectedSocket = allGone.devices.find((device) => device.id === socket.id)!;
    expect(disconnectedSocket.ports.every((port) => !portCanStart(allGone, disconnectedSocket, port, "receptacle"))).toBe(true);
    expect(() => startRouteFromDevice(allGone, disconnectedSocket.id, "receptacle")).toThrow();
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
