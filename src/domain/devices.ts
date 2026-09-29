import type { Circuit, ConduitOverlayDocument, DeviceFrame, DeviceMount, HostKind, NetworkDevice, NetworkDeviceType, NetworkPort, RouteFitting, RoutePoint, RouteSegment, RoutingSystem, SprinklerDirection, Vec3 } from "./overlay";
import type { PlannedRoute } from "./routing";
import { commitBranchRoute, commitPlannedRoute } from "./routing";
import { SOURCE_PORTS_PER_EDGE, sourcePortTemplate } from "./source-ports";

// Overlay files are imported into a fresh browser session.  An in-memory
// counter would restart at one and can therefore reuse an imported device ID.
// The device ID is also the prefix for every physical port, so reuse makes two
// otherwise independent points indistinguishable to selection and editing.
const nextId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const normalize = (value: Vec3): Vec3 => { const size = Math.hypot(...value); return size < 1e-9 ? [0, 1, 0] : value.map((item) => item / size) as Vec3; };
const clonePoint = (point: RoutePoint): RoutePoint => structuredClone(point);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: Vec3, b: Vec3): Vec3 => a.map((value, axis) => value + b[axis]) as Vec3;
const scale = (a: Vec3, amount: number): Vec3 => a.map((value) => value * amount) as Vec3;
const subtract = (a: Vec3, b: Vec3): Vec3 => a.map((value, axis) => value - b[axis]) as Vec3;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export type DeviceDefinition = {
  label: string;
  systems: RoutingSystem[];
  hostKinds: HostKind[];
  sizeMm: [number, number, number];
  portRole: NetworkPort["role"];
  source: boolean;
  canInsertMidSegment: boolean;
};

export const DEVICE_DEFAULTS: Record<NetworkDeviceType, DeviceDefinition> = {
  "strong-panel": { label: "强电箱", systems: ["receptacle", "lighting"], hostKinds: ["wall", "beam"], sizeMm: [500, 600, 120], portRole: "source", source: true, canInsertMidSegment: false },
  "weak-panel": { label: "弱电箱", systems: ["network"], hostKinds: ["wall", "beam"], sizeMm: [350, 400, 100], portRole: "source", source: true, canInsertMidSegment: false },
  socket: { label: "插座", systems: ["receptacle"], hostKinds: ["wall", "slab", "ceiling", "beam"], sizeMm: [86, 86, 50], portRole: "bidirectional", source: false, canInsertMidSegment: true },
  switch: { label: "开关", systems: ["lighting"], hostKinds: ["wall", "slab", "ceiling", "beam"], sizeMm: [86, 86, 50], portRole: "bidirectional", source: false, canInsertMidSegment: true },
  luminaire: { label: "灯位接线盒", systems: ["lighting"], hostKinds: ["ceiling", "beam"], sizeMm: [60, 60, 30], portRole: "bidirectional", source: false, canInsertMidSegment: true },
  "network-outlet": { label: "网络插座", systems: ["network"], hostKinds: ["wall", "slab", "ceiling", "beam"], sizeMm: [86, 86, 50], portRole: "sink", source: false, canInsertMidSegment: false },
  "sprinkler-head": { label: "喷淋头", systems: ["sprinkler"], hostKinds: ["ceiling", "slab", "wall", "beam"], sizeMm: [80, 80, 100], portRole: "sink", source: false, canInsertMidSegment: true },
  "smoke-detector": { label: "烟雾传感器", systems: ["fire-signal"], hostKinds: ["ceiling", "beam"], sizeMm: [60, 60, 30], portRole: "bidirectional", source: false, canInsertMidSegment: true },
  sensor: { label: "温湿度传感器", systems: [], hostKinds: ["wall", "slab", "ceiling", "beam"], sizeMm: [80, 80, 30], portRole: "sink", source: false, canInsertMidSegment: false },
  "rfid-reader": { label: "RFID 读写器", systems: [], hostKinds: ["wall", "beam"], sizeMm: [86, 130, 25], portRole: "sink", source: false, canInsertMidSegment: false },
};

export const systemCanBranch = (system: RoutingSystem) => system !== "network" && system !== "fire-signal";
export const deviceSupportsSystem = (device: NetworkDevice, system: RoutingSystem) => device.systems.includes(system);
export const isSourceDevice = (device: NetworkDevice) => DEVICE_DEFAULTS[device.deviceType].source;
export const sprinklerDirectionOf = (device: NetworkDevice): SprinklerDirection => device.deviceType === "sprinkler-head" && device.sprinklerDirection === "pendent" ? "pendent" : "upright";

/** Changes only the sprinkler's presentation/installation direction. Pipe topology and ports stay intact. */
export function setSprinklerDirection(overlay: ConduitOverlayDocument, deviceId: string, direction: SprinklerDirection): ConduitOverlayDocument {
  const device = overlay.devices.find((item) => item.id === deviceId);
  if (!device || device.deviceType !== "sprinkler-head" || sprinklerDirectionOf(device) === direction) return overlay;
  return { ...overlay, devices: overlay.devices.map((item) => item.id === deviceId ? { ...item, sprinklerDirection: direction } : item) };
}

function devicePort(deviceId: string, index: number, point: RoutePoint, direction: Vec3, system: RoutingSystem, role: NetworkPort["role"], face?: NetworkPort["face"], slot?: NetworkPort["slot"]): NetworkPort {
  return { id: `${deviceId}:port:${index}`, owner: { kind: "device", id: deviceId }, position: clonePoint(point), direction: normalize(direction), role, system, connectedSegmentIds: [], face, slot, flow: "unknown" };
}

export function deviceFrame(position: RoutePoint, tangent?: Vec3, frontOverride?: Vec3): DeviceFrame {
  const hostFront = position.attachment?.hostKind === "wall" ? position.attachment.normal : undefined;
  const fallbackFront = tangent && Math.abs(tangent[1]) < .96 ? normalize(cross(tangent, [0, 1, 0])) : [0, 0, 1] as Vec3;
  const front = normalize(frontOverride ?? hostFront ?? position.attachment?.normal ?? fallbackFront);
  const basis = position.attachment?.hostKind === "beam" ? position.attachment.basis : undefined;
  if (basis) {
    const upCandidate = subtract(basis.v, scale(front, dot(basis.v, front)));
    const rightCandidate = subtract(basis.u, scale(front, dot(basis.u, front)));
    if (Math.hypot(...upCandidate) > 1e-6 && Math.hypot(...rightCandidate) > 1e-6) return { front, up: normalize(upCandidate), right: normalize(rightCandidate) };
  }
  const preferredUp: Vec3 = [0, 1, 0];
  const projectedUp = subtract(preferredUp, scale(front, dot(preferredUp, front)));
  const up = Math.hypot(...projectedUp) > 1e-6 ? normalize(projectedUp) : normalize(cross(front, [1, 0, 0]));
  return { front, up, right: normalize(cross(up, front)) };
}

function mountFor(position: RoutePoint, segmentMount?: DeviceMount): DeviceMount | undefined {
  return segmentMount ?? (position.attachment ? { kind: "host", attachment: structuredClone(position.attachment) } : undefined);
}

function boxPorts(id: string, position: RoutePoint, frame: DeviceFrame, sizeMm: [number, number, number], system: RoutingSystem, role: NetworkPort["role"]): NetworkPort[] {
  const width = sizeMm[0] / 1000, height = sizeMm[1] / 1000;
  const faceData: Array<{ face: NonNullable<NetworkPort["face"]>; direction: Vec3; lateral: Vec3; extent: number }> = [
    { face: "top", direction: frame.up, lateral: frame.right, extent: height / 2 },
    { face: "bottom", direction: scale(frame.up, -1), lateral: frame.right, extent: height / 2 },
    { face: "left", direction: scale(frame.right, -1), lateral: frame.up, extent: width / 2 },
    { face: "right", direction: frame.right, lateral: frame.up, extent: width / 2 },
  ];
  return faceData.flatMap((entry, faceIndex) => ([0, 1] as const).map((slot) => {
    const lane = slot === 0 ? -.22 : .22;
    const world = add(add(position.position, scale(entry.direction, entry.extent)), scale(entry.lateral, (entry.face === "top" || entry.face === "bottom" ? width : height) * lane));
    return devicePort(id, faceIndex * 2 + slot, { position: world, attachment: position.attachment ? structuredClone(position.attachment) : undefined }, entry.direction, system, role, entry.face, slot);
  }));
}

function luminairePorts(id: string, position: RoutePoint, frame: DeviceFrame, sizeMm: [number, number, number], system: RoutingSystem): NetworkPort[] {
  const radius = sizeMm[0] / 2000;
  // A floating or Ceiling luminaire remains a horizontal disk. On a Beam it
  // instead follows the selected exposed face's frame, including side/end faces.
  const directions = position.attachment?.hostKind === "beam"
    ? [frame.right, scale(frame.right, -1), frame.up, scale(frame.up, -1)]
    : (() => { const horizontalRight = normalize([frame.right[0], 0, frame.right[2]]), horizontalForward = normalize(cross([0, 1, 0], horizontalRight)); return [horizontalRight, scale(horizontalRight, -1), horizontalForward, scale(horizontalForward, -1)]; })();
  return directions.map((direction, index) => devicePort(id, index, { position: add(position.position, scale(direction, radius)), attachment: position.attachment ? structuredClone(position.attachment) : undefined }, direction, system, "bidirectional", index < 2 ? (index === 0 ? "right" : "left") : (index === 2 ? "top" : "bottom"), index % 2 as 0 | 1));
}

function buildNetworkDevice(deviceType: NetworkDeviceType, position: RoutePoint, name: string | undefined, enforceDefaultHost: boolean, options: { id?: string; tangent?: Vec3; mount?: DeviceMount; sizeMm?: [number, number, number]; frameFront?: Vec3 } = {}): NetworkDevice {
  const definition = DEVICE_DEFAULTS[deviceType], hostKind = position.attachment?.hostKind, sizeMm = options.sizeMm ?? definition.sizeMm;
  if (enforceDefaultHost && (!hostKind || !definition.hostKinds.includes(hostKind) || hostKind === "beam" && (position.attachment?.surface === "top" || deviceType === "rfid-reader" && (!position.attachment?.surface || position.attachment.surface === "bottom")))) throw new Error(`${definition.label}不能放置在${hostKind ?? "悬空位置"}。`);
  const id = options.id ?? nextId(deviceType), frame = deviceFrame(position, options.tangent, options.frameFront), orientation = frame.front;
  const ports = definition.systems.flatMap((system, systemIndex) => {
    if (definition.source) {
      const dualSided = deviceType === "strong-panel" || deviceType === "weak-panel", sourcePortCount = dualSided ? SOURCE_PORTS_PER_EDGE * 2 : SOURCE_PORTS_PER_EDGE;
      return Array.from({ length: sourcePortCount }, (_, sourceIndex) => sourcePortTemplate(id, position, orientation, system, sourceIndex, systemIndex, definition.systems.length, sizeMm, frame, dualSided));
    }
    if (deviceType === "socket" || deviceType === "switch" || deviceType === "network-outlet") return boxPorts(id, position, frame, sizeMm, system, definition.portRole);
    if (deviceType === "luminaire" || deviceType === "smoke-detector") return luminairePorts(id, position, frame, sizeMm, system);
    return [devicePort(id, systemIndex, position, orientation, system, definition.portRole)];
  });
  return { id, type: "network-device", deviceType, name: name ?? definition.label, position: clonePoint(position), sizeMm: [...sizeMm], orientation, frame, mount: mountFor(position, options.mount), ...(deviceType === "sprinkler-head" ? { sprinklerDirection: "upright" as const } : {}), systems: [...definition.systems], ports, createdAt: new Date().toISOString() };
}

export function createNetworkDevice(deviceType: NetworkDeviceType, position: RoutePoint, name?: string): NetworkDevice {
  return buildNetworkDevice(deviceType, position, name, true);
}

export function isReferencePlaneEligibleDeviceType(deviceType: NetworkDeviceType) {
  return DEVICE_DEFAULTS[deviceType].hostKinds.includes("ceiling");
}

export function createReferencePlaneDevice(deviceType: NetworkDeviceType, position: Vec3, levelId: string, elevationMm: number, name?: string): NetworkDevice {
  if (!isReferencePlaneEligibleDeviceType(deviceType)) throw new Error(`${DEVICE_DEFAULTS[deviceType].label}不能放置在悬空参考面。`);
  return buildNetworkDevice(deviceType, { position }, name, false, { mount: { kind: "reference-plane", levelId, elevationMm }, frameFront: [0, -1, 0] });
}

export function rebuildNetworkDevice(device: NetworkDevice, sizeMm = device.sizeMm): NetworkDevice {
  const rebuilt = buildNetworkDevice(device.deviceType, device.position, device.name, false, { id: device.id, mount: device.mount, tangent: device.mount?.kind === "segment" ? device.mount.tangent : undefined, sizeMm, frameFront: device.frame?.front ?? device.orientation });
  const used = new Set<string>();
  const ports = rebuilt.ports.map((port, index) => {
    const previous = device.ports.find((candidate) => !used.has(candidate.id) && candidate.system === port.system && candidate.face === port.face && candidate.slot === port.slot)
      ?? device.ports.find((candidate) => !used.has(candidate.id) && candidate.system === port.system && candidate.role === port.role)
      ?? device.ports[index];
    if (!previous) return { ...port, id: `${device.id}:port:${index}`, owner: { kind: "device" as const, id: device.id } };
    used.add(previous.id);
    return { ...port, ...previous, id: previous.id, owner: { ...previous.owner, kind: "device" as const, id: device.id }, position: port.position, connectedSegmentIds: [...previous.connectedSegmentIds] };
  });
  return { ...device, ...rebuilt, id: device.id, createdAt: device.createdAt, positioning: device.positioning, ...(device.deviceType === "sprinkler-head" ? { sprinklerDirection: sprinklerDirectionOf(device) } : {}), ports };
}

export function placeNetworkDevice(overlay: ConduitOverlayDocument, deviceType: NetworkDeviceType, position: RoutePoint, name?: string): ConduitOverlayDocument {
  return { ...overlay, devices: [...overlay.devices, createNetworkDevice(deviceType, position, name)] };
}

export function createSmokeDetector(position: RoutePoint, name?: string): NetworkDevice {
  return createNetworkDevice("smoke-detector", position, name);
}

export function placeSmokeDetector(overlay: ConduitOverlayDocument, position: RoutePoint, name?: string): ConduitOverlayDocument {
  return { ...overlay, devices: [...overlay.devices, createSmokeDetector(position, name)] };
}

/** Diameter changes move the four signal ports on the circular base and preserve port identities. */
export function resizeSmokeDetectorDiameter(overlay: ConduitOverlayDocument, deviceId: string, diameterMm: number): ConduitOverlayDocument {
  const device = overlay.devices.find((item) => item.id === deviceId && item.deviceType === "smoke-detector");
  if (!device || !Number.isFinite(diameterMm) || diameterMm <= 0 || device.ports.some((port) => port.connectedSegmentIds.length)) return overlay;
  const resized = rebuildNetworkDevice(device, [diameterMm, diameterMm, device.sizeMm[2]]);
  return { ...overlay, devices: overlay.devices.map((item) => item.id === deviceId ? resized : item) };
}

/** Depth does not move the perimeter ports and remains editable after connection. */
export function resizeSmokeDetectorDepth(overlay: ConduitOverlayDocument, deviceId: string, depthMm: number): ConduitOverlayDocument {
  const device = overlay.devices.find((item) => item.id === deviceId && item.deviceType === "smoke-detector");
  if (!device || !Number.isFinite(depthMm) || depthMm <= 0) return overlay;
  const resized = rebuildNetworkDevice(device, [device.sizeMm[0], device.sizeMm[1], depthMm]);
  return { ...overlay, devices: overlay.devices.map((item) => item.id === deviceId ? resized : item) };
}

const isReassignableBox = (device: NetworkDevice) => device.deviceType === "socket" || device.deviceType === "switch";
const reassignablePeer = (device: NetworkDevice, port: NetworkPort, system: RoutingSystem): NetworkPort | undefined => isReassignableBox(device) && port.face ? device.ports.find((candidate) => candidate.id !== port.id && candidate.system === system && candidate.face === port.face && candidate.connectedSegmentIds.length === 0) : undefined;

export function deviceTargetPorts(device: NetworkDevice, system: RoutingSystem): NetworkPort[] {
  return device.ports.filter((port) => port.system === system && port.role !== "source" && port.connectedSegmentIds.length === 0);
}

export function nearestDeviceTargetPort(device: NetworkDevice, system: RoutingSystem, pointer: Vec3): NetworkPort | undefined {
  return deviceTargetPorts(device, system).sort((left, right) => Math.hypot(...subtract(left.position.position, pointer)) - Math.hypot(...subtract(right.position.position, pointer)) || left.id.localeCompare(right.id))[0];
}

export function portCanStart(overlay: ConduitOverlayDocument, device: NetworkDevice, port: NetworkPort, system: RoutingSystem): boolean {
  if (device.deviceType === "smoke-detector" && system === "fire-signal") return port.system === system && port.role === "bidirectional" && port.connectedSegmentIds.length === 0;
  if (device.deviceType === "sprinkler-head" && system === "sprinkler") {
    if (port.system !== system || port.role !== "sink" || port.connectedSegmentIds.length !== 1) return false;
    const segment = overlay.segments.find((item) => item.id === port.connectedSegmentIds[0]);
    return Boolean(segment && segment.system === system && segment.endPortId === port.id);
  }
  if (port.role === "sink" || port.system !== system || port.connectedSegmentIds.length > 0 && !reassignablePeer(device, port, system)) return false;
  if (isSourceDevice(device)) {
    const sharedHoleOccupied = device.ports.some((candidate) => candidate.id !== port.id
      && candidate.role === "source"
      && candidate.connectedSegmentIds.length > 0
      && Math.hypot(...subtract(candidate.position.position, port.position.position)) < 1e-6);
    return deviceSupportsSystem(device, system) && !sharedHoleOccupied;
  }
  const deviceSegments = device.ports.flatMap((candidate) => candidate.connectedSegmentIds);
  return overlay.circuits.some((circuit) => (circuit.status === "rooted" || circuit.status === "broken") && circuit.system === system && circuit.segmentIds.some((id) => deviceSegments.includes(id)));
}

/** Physical source ports that can start a route in the currently selected system. */
export function deviceStartPorts(overlay: ConduitOverlayDocument, device: NetworkDevice, system: RoutingSystem): NetworkPort[] {
  if (!device.systems.includes(system)) return [];
  if (device.deviceType === "smoke-detector" && system === "fire-signal") return device.ports.filter((port) => port.system === system && port.connectedSegmentIds.length === 0);
  if (device.deviceType === "sprinkler-head" && system === "sprinkler") return device.ports.filter((port) => portCanStart(overlay, device, port, system));
  return device.ports.filter((port) => port.system === system && portCanStart(overlay, device, port, system));
}

export type SprinklerRouteStart = { deviceId: string; portId: string; connectedSegmentId: string };

function attachSprinklerRouteStart(overlay: ConduitOverlayDocument, plan: PlannedRoute, start?: SprinklerRouteStart): ConduitOverlayDocument | null {
  if (!start) return overlay;
  const device = overlay.devices.find((item) => item.id === start.deviceId && item.deviceType === "sprinkler-head");
  const port = device?.ports.find((item) => item.id === start.portId && item.system === "sprinkler" && item.role === "sink");
  const connected = port?.connectedSegmentIds.length === 1 && port.connectedSegmentIds[0] === start.connectedSegmentId;
  const adjacent = overlay.segments.find((segment) => segment.id === start.connectedSegmentId);
  const first = plan.segments[0];
  if (!device || !port || !connected || !adjacent || adjacent.system !== "sprinkler" || !first || !overlay.segments.some((segment) => segment.id === first.id) || plan.system !== "sprinkler" || !samePosition(plan.points[0]!.position, port.position.position) || !samePosition(first.start.position, port.position.position) || adjacent.endPortId !== port.id) return null;
  const segments = overlay.segments.map((segment) => segment.id === first.id ? { ...segment, startPortId: port.id } : segment);
  const devices = overlay.devices.map((item) => item.id === device.id ? { ...item, ports: item.ports.map((candidate) => candidate.id === port.id ? { ...candidate, connectedSegmentIds: [...candidate.connectedSegmentIds, first.id] } : candidate) } : item);
  return { ...overlay, segments, devices };
}

/** Adds a real outgoing pipe to a sprinkler head that already has one connected inlet segment. */
export function commitSprinklerDeviceRoute(overlay: ConduitOverlayDocument, plan: PlannedRoute, start: SprinklerRouteStart): ConduitOverlayDocument {
  if (!plan.canCommit || plan.system !== "sprinkler" || !plan.segments.length) return overlay;
  const routed = commitPlannedRoute(overlay, plan);
  const connected = attachSprinklerRouteStart(routed, plan, start);
  return connected ?? overlay;
}

/** Frees a clicked occupied 86-box hole by moving its existing connection to the other hole on the same side. */
function releaseBoxPortForRoute(overlay: ConduitOverlayDocument, device: NetworkDevice, port: NetworkPort, system: RoutingSystem): { overlay: ConduitOverlayDocument; releasedPort: NetworkPort } | null {
  if (!port.connectedSegmentIds.length) return { overlay, releasedPort: port };
  const peer = reassignablePeer(device, port, system);
  if (!peer) return null;
  const movedIds = new Set(port.connectedSegmentIds);
  // Keep the already-built conduit exactly where it is.  Shift the box until
  // its peer hole occupies the old hole's world coordinate, then release the
  // clicked hole for the new route.
  const shift = subtract(port.position.position, peer.position.position);
  const translatePoint = (point: RoutePoint): RoutePoint => ({ position: add(point.position, shift), attachment: point.attachment ? structuredClone(point.attachment) : undefined });
  const segments = overlay.segments.map((segment) => {
    if (!movedIds.has(segment.id)) return segment;
    return {
      ...segment,
      startPortId: segment.startPortId === port.id ? peer.id : segment.startPortId,
      endPortId: segment.endPortId === port.id ? peer.id : segment.endPortId,
    };
  });
  const devices = overlay.devices.map((item) => item.id !== device.id ? item : {
    ...item,
    position: translatePoint(item.position),
    ports: item.ports.map((candidate) => candidate.id === port.id
      ? { ...candidate, position: translatePoint(candidate.position), connectedSegmentIds: [] }
      : candidate.id === peer.id ? { ...candidate, position: translatePoint(candidate.position), connectedSegmentIds: [...new Set([...candidate.connectedSegmentIds, ...port.connectedSegmentIds])] }
        : { ...candidate, position: translatePoint(candidate.position) }),
  });
  const next = { ...overlay, segments, devices };
  const releasedPort = next.devices.find((item) => item.id === device.id)?.ports.find((candidate) => candidate.id === port.id);
  return releasedPort ? { overlay: next, releasedPort } : null;
}

export function startRouteFromDevice(overlay: ConduitOverlayDocument, deviceId: string, system: RoutingSystem, requestedPortId?: string): { overlay: ConduitOverlayDocument; circuit: Circuit; port: NetworkPort } {
  let workingOverlay = overlay;
  let device = workingOverlay.devices.find((item) => item.id === deviceId);
  if (!device || !deviceSupportsSystem(device, system)) throw new Error("设备与当前线路系统不兼容。");
  const requested = requestedPortId ? device.ports.find((port) => port.id === requestedPortId) : undefined;
  if (requested?.connectedSegmentIds.length) {
    const released = releaseBoxPortForRoute(workingOverlay, device, requested, system);
    if (released) { workingOverlay = released.overlay; device = workingOverlay.devices.find((item) => item.id === deviceId)!; }
  }
  const existing = requestedPortId
    ? device.ports.find((port) => port.id === requestedPortId && portCanStart(workingOverlay, device, port, system))
    : device.ports.find((port) => port.connectedSegmentIds.length === 0 && portCanStart(workingOverlay, device, port, system)) ?? device.ports.find((port) => portCanStart(workingOverlay, device, port, system));
  let port = existing;
  let devices = workingOverlay.devices;
  if (!port && isSourceDevice(device) && !requestedPortId) {
    const systemIndex = device.systems.indexOf(system), sourcePortIndex = device.ports.filter((candidate) => candidate.system === system).length;
    port = sourcePortTemplate(device.id, device.position, device.orientation, system, sourcePortIndex, systemIndex < 0 ? 0 : systemIndex, device.systems.length, device.sizeMm, device.frame, device.deviceType === "strong-panel" || device.deviceType === "weak-panel");
    devices = workingOverlay.devices.map((item) => item.id === device.id ? { ...item, ports: [...item.ports, port!] } : item);
  }
  if (!port) throw new Error("该设备没有可用的输出端口。");
  const deviceSegments = device.ports.flatMap((candidate) => candidate.connectedSegmentIds);
  const inheritedCircuit = !isSourceDevice(device) ? workingOverlay.circuits.find((circuit) => (circuit.status === "rooted" || circuit.status === "broken") && circuit.system === system && circuit.segmentIds.some((id) => deviceSegments.includes(id))) : undefined;
  if (!isSourceDevice(device) && !inheritedCircuit) throw new Error("设备尚未接入合法来源。");
  const circuit: Circuit = inheritedCircuit ?? { id: nextId("circuit"), system, sourceDeviceId: device.id, rootPortId: port.id, segmentIds: [], status: "rooted", createdAt: new Date().toISOString() };
  return { overlay: inheritedCircuit ? { ...workingOverlay, devices } : { ...workingOverlay, devices, circuits: [...workingOverlay.circuits, circuit] }, circuit, port };
}

export function commitDeviceRoute(overlay: ConduitOverlayDocument, plan: PlannedRoute, circuit: Circuit, startPort: NetworkPort, endDeviceId?: string, endPortId?: string): ConduitOverlayDocument {
  if (!plan.canCommit || !plan.segments.length) return overlay;
  const activeCircuit = overlay.circuits.find((item) => item.id === circuit.id && (item.status === "rooted" || item.status === "broken") && item.system === plan.system);
  const startDevice = overlay.devices.find((device) => device.id === startPort.owner.id), storedStartPort = startDevice?.ports.find((port) => port.id === startPort.id);
  const sourceDevice = activeCircuit?.sourceDeviceId ? overlay.devices.find((device) => device.id === activeCircuit.sourceDeviceId) : undefined;
  if (!activeCircuit || !startDevice || !storedStartPort || !sourceDevice || !isSourceDevice(sourceDevice) || !sourceDevice.systems.includes(plan.system) || !portCanStart(overlay, startDevice, storedStartPort, plan.system)) return overlay;
  const segments = plan.segments.map((segment) => ({ ...segment, circuitId: circuit.id, legacyUnrooted: false }));
  segments[0].startPortId = startPort.id;
  let devices = overlay.devices.map((device) => device.id === startPort.owner.id ? { ...device, ports: device.ports.map((port) => port.id === startPort.id ? { ...port, connectedSegmentIds: [...new Set([...port.connectedSegmentIds, segments[0].id])] } : port) } : device);
  let indoorUnits = overlay.hvac.indoorUnits;
  if (endDeviceId) {
    const hvacUnit = indoorUnits.find((unit) => unit.id === endDeviceId);
    if (hvacUnit) {
      const port = hvacUnit.powerPort;
      if (plan.system !== "receptacle" || !port || port.id !== endPortId || port.system !== "receptacle" || port.role !== "sink" || port.connectedSegmentIds.length) return overlay;
      segments[segments.length - 1].endPortId = port.id;
      indoorUnits = indoorUnits.map((unit) => unit.id === endDeviceId ? { ...unit, powerPort: { ...port, connectedSegmentIds: [segments[segments.length - 1].id] } } : unit);
    } else {
      const endDevice = devices.find((device) => device.id === endDeviceId), terminalOccupied = endDevice?.deviceType === "network-outlet" && endDevice.ports.some((port) => port.connectedSegmentIds.length > 0), endPort = terminalOccupied ? undefined : endDevice?.ports.find((port) => port.id === endPortId && port.system === plan.system && port.role !== "source" && port.connectedSegmentIds.length === 0) ?? endDevice?.ports.find((port) => port.system === plan.system && port.role !== "source" && port.connectedSegmentIds.length === 0);
      if (!endDevice || !endPort) return overlay;
      segments[segments.length - 1].endPortId = endPort.id;
      devices = devices.map((device) => device.id === endDeviceId ? { ...device, ports: device.ports.map((port) => port.id === endPort.id ? { ...port, connectedSegmentIds: [segments[segments.length - 1].id] } : port) } : device);
    }
  }
  const nextCircuit = { ...activeCircuit, segmentIds: [...new Set([...activeCircuit.segmentIds, ...segments.map((segment) => segment.id)])] };
  return { ...overlay, devices, hvac: { ...overlay.hvac, indoorUnits }, circuits: overlay.circuits.map((item) => item.id === circuit.id ? nextCircuit : item), segments: [...overlay.segments, ...segments], fittings: [...overlay.fittings, ...plan.fittings], junctionBoxes: [...overlay.junctionBoxes, ...plan.junctionBoxes], surfaceChases: [...overlay.surfaceChases, ...plan.surfaceChases], penetrations: [...overlay.penetrations, ...plan.penetrations] };
}

/** Connects a free-start FireWaterPipe route to an open sprinkler-head port without creating a Circuit. */
export function commitFreeRouteToDevice(overlay: ConduitOverlayDocument, plan: PlannedRoute, endDeviceId: string, endPortId: string): ConduitOverlayDocument {
  if (plan.system !== "sprinkler" || !plan.canCommit || !plan.segments.length) return overlay;
  const endDevice = overlay.devices.find((device) => device.id === endDeviceId);
  const endPort = endDevice?.ports.find((port) => port.id === endPortId && port.system === "sprinkler" && port.role !== "source" && port.connectedSegmentIds.length === 0);
  const lastSegment = plan.segments[plan.segments.length - 1];
  if (!endDevice || endDevice.deviceType !== "sprinkler-head" || !endPort || !lastSegment) return overlay;
  const connectedPlan = { ...plan, segments: plan.segments.map((segment) => segment.id === lastSegment.id ? { ...segment, endPortId: endPort.id } : segment) };
  const routed = commitPlannedRoute(overlay, connectedPlan);
  if (routed === overlay) return overlay;
  return {
    ...routed,
    devices: routed.devices.map((device) => device.id === endDevice.id
      ? { ...device, ports: device.ports.map((port) => port.id === endPort.id ? { ...port, connectedSegmentIds: [lastSegment.id] } : port) }
      : device),
  };
}

export const SPRINKLER_TEE_SOCKET_METERS = .05;
export const SPRINKLER_BRANCH_MIN_LENGTH_METERS = .12;
export const SPRINKLER_CONTINUATION_STUB_METERS = .15;
const samePosition = (a: Vec3, b: Vec3) => Math.hypot(...subtract(a, b)) < 1e-6;

/**
 * Commits a sprinkler main to a tee, branches to a sprinkler head, and leaves
 * a short real mainline stub so the third tee port can use normal continuation.
 */
export function commitFreeSprinklerRouteToDeviceBranch(
  overlay: ConduitOverlayDocument,
  mainPlan: PlannedRoute,
  branchPlan: PlannedRoute,
  continuationPlan: PlannedRoute,
  endDeviceId: string,
  endPortId: string,
  continuationStart?: OpenRouteEndpoint,
  sprinklerStart?: SprinklerRouteStart,
): ConduitOverlayDocument {
  if (!mainPlan.canCommit || mainPlan.system !== "sprinkler" || mainPlan.segments.length === 0 || mainPlan.points.length < 2 || !branchPlan.canCommit || branchPlan.system !== "sprinkler" || branchPlan.diameterMm !== mainPlan.diameterMm || branchPlan.segments.length === 0 || !continuationPlan.canCommit || continuationPlan.system !== "sprinkler" || continuationPlan.diameterMm !== mainPlan.diameterMm || continuationPlan.segments.length !== 1) return overlay;
  if (continuationStart && (continuationStart.system !== "sprinkler" || !openRouteEndpoints(overlay).some((endpoint) => endpoint.segmentId === continuationStart.segmentId && endpoint.end === continuationStart.end && samePosition(endpoint.point.position, continuationStart.point.position)) || !samePosition(mainPlan.points[0]!.position, continuationStart.point.position))) return overlay;
  const head = overlay.devices.find((device) => device.id === endDeviceId), headPort = head?.ports.find((port) => port.id === endPortId);
  if (!head || head.deviceType !== "sprinkler-head" || !headPort || headPort.system !== "sprinkler" || headPort.role === "source" || headPort.connectedSegmentIds.length) return overlay;

  const plannedEnd = mainPlan.points[mainPlan.points.length - 1]?.position, lastMain = mainPlan.segments[mainPlan.segments.length - 1];
  if (!plannedEnd || !lastMain || !samePosition(plannedEnd, lastMain.end.position)) return overlay;
  const mainDirection = normalize(subtract(lastMain.end.position, lastMain.start.position));
  const teeCenter = clonePoint(mainPlan.points[mainPlan.points.length - 1]!);
  const branchVector = subtract(headPort.position.position, teeCenter.position), branchLength = Math.hypot(...branchVector);
  if (branchLength < SPRINKLER_TEE_SOCKET_METERS + SPRINKLER_BRANCH_MIN_LENGTH_METERS) return overlay;
  const branchDirection = normalize(branchVector), forwardAlignment = dot(branchDirection, mainDirection);
  // A branch may turn across the main, but it cannot aim into its incoming
  // barrel or run nearly inline with either main port.
  if (forwardAlignment < -1e-6 || Math.abs(forwardAlignment) > .92) return overlay;
  const branchPortPosition = add(teeCenter.position, scale(branchDirection, SPRINKLER_TEE_SOCKET_METERS));
  const branchStart = branchPlan.segments[0]!.start.position, branchEnd = branchPlan.segments[branchPlan.segments.length - 1]!.end.position;
  if (!samePosition(branchStart, branchPortPosition) || !samePosition(branchEnd, headPort.position.position)) return overlay;

  const routedBase = continuationStart ? commitEndpointRoute(overlay, continuationStart, mainPlan) : commitPlannedRoute(overlay, mainPlan);
  const routed = attachSprinklerRouteStart(routedBase, mainPlan, sprinklerStart) ?? (sprinklerStart ? overlay : routedBase);
  if (routed === overlay) return overlay;
  const committedMain = routed.segments.find((segment) => segment.id === lastMain.id);
  if (!committedMain || committedMain.endPortId) return overlay;

  const fittingId = nextId("tee");
  const stubStart: RoutePoint = { position: add(teeCenter.position, scale(mainDirection, SPRINKLER_TEE_SOCKET_METERS)) };
  const stubEnd: RoutePoint = { position: add(stubStart.position, scale(mainDirection, SPRINKLER_CONTINUATION_STUB_METERS)) };
  if (!samePosition(continuationPlan.points[0]!.position, stubStart.position) || !samePosition(continuationPlan.points[continuationPlan.points.length - 1]!.position, stubEnd.position)) return overlay;
  const branchFirst = branchPlan.segments[0]!, branchLast = branchPlan.segments[branchPlan.segments.length - 1]!;
  const stubSegment = continuationPlan.segments[0]!;
  if (!samePosition(stubSegment.start.position, stubStart.position) || !samePosition(stubSegment.end.position, stubEnd.position)) return overlay;
  const teePort = (index: number, position: RoutePoint, direction: Vec3, segmentId: string): NetworkPort => ({
    id: `${fittingId}:port:${index}`, owner: { kind: "fitting", id: fittingId }, position: clonePoint(position), direction: normalize(direction), role: "bidirectional", system: "sprinkler", connectedSegmentIds: [segmentId], segmentId,
  });
  const ports = [
    teePort(0, teeCenter, scale(mainDirection, -1), committedMain.id),
    teePort(1, stubStart, mainDirection, stubSegment.id),
    teePort(2, { position: branchPortPosition }, branchDirection, branchFirst.id),
  ];
  committedMain.endPortId = ports[0]!.id;
  const stub: RouteSegment = { ...stubSegment, startPortId: ports[1]!.id };
  const branchSegments = branchPlan.segments.map((segment, index) => ({ ...segment, ...(index === 0 ? { startPortId: ports[2]!.id } : {}), ...(index === branchPlan.segments.length - 1 ? { endPortId: headPort.id } : {}) }));
  const fitting: RouteFitting = { id: fittingId, type: "sprinkler-fitting", fitting: "tee", system: "sprinkler", diameterMm: mainPlan.diameterMm, position: teeCenter, segmentIds: [committedMain.id, stub.id, branchFirst.id], ports };
  const devices = routed.devices.map((device) => device.id === head.id ? { ...device, ports: device.ports.map((port) => port.id === headPort.id ? { ...port, connectedSegmentIds: [branchLast.id] } : port) } : device);
  return {
    ...routed,
    devices,
    segments: [...routed.segments.map((segment) => segment.id === committedMain.id ? committedMain : segment), stub, ...branchSegments],
    fittings: [...routed.fittings, fitting, ...branchPlan.fittings, ...continuationPlan.fittings],
    junctionBoxes: [...routed.junctionBoxes, ...branchPlan.junctionBoxes, ...continuationPlan.junctionBoxes],
    surfaceChases: [...routed.surfaceChases, ...branchPlan.surfaceChases, ...continuationPlan.surfaceChases],
    penetrations: [...routed.penetrations, ...branchPlan.penetrations, ...continuationPlan.penetrations],
  };
}

/** Commits a white fire-signal route between smoke-detector ports or to a sealed wall termination. */
export function commitFireSignalRoute(overlay: ConduitOverlayDocument, plan: PlannedRoute, startDeviceId: string, startPortId: string, endDeviceId?: string, endPortId?: string, wallTerminal = false): ConduitOverlayDocument {
  // New routes may end at any confirmed point and remain open. Keep the
  // explicit wall-terminal option for callers migrating legacy sealed routes.
  if (plan.system !== "fire-signal" || !plan.canCommit || !plan.segments.length || endDeviceId && wallTerminal) return overlay;
  const startDevice = overlay.devices.find((device) => device.id === startDeviceId && device.deviceType === "smoke-detector");
  const startPort = startDevice?.ports.find((port) => port.id === startPortId && port.system === "fire-signal" && port.role === "bidirectional" && !port.connectedSegmentIds.length);
  if (!startDevice || !startPort) return overlay;
  if (Math.hypot(...plan.points[0]!.position.map((value, axis) => value - startPort.position.position[axis])) > 1e-6) return overlay;
  let endDevice: NetworkDevice | undefined, endPort: NetworkPort | undefined;
  if (endDeviceId) {
    endDevice = overlay.devices.find((device) => device.id === endDeviceId && device.deviceType === "smoke-detector");
    endPort = endDevice?.ports.find((port) => port.id === endPortId && port.system === "fire-signal" && port.role === "bidirectional" && !port.connectedSegmentIds.length);
    if (!endDevice || !endPort || endDevice.id === startDevice.id) return overlay;
    if (Math.hypot(...plan.points[plan.points.length - 1]!.position.map((value, axis) => value - endPort!.position.position[axis])) > 1e-6) return overlay;
  }
  const lastPlanSegment = plan.segments[plan.segments.length - 1]!;
  if (wallTerminal && plan.points[plan.points.length - 1]?.attachment?.hostKind !== "wall") return overlay;
  const segments = plan.segments.map((segment) => ({ ...segment, circuitId: undefined, legacyUnrooted: false }));
  segments[segments.length - 1]!.end = clonePoint(plan.points[plan.points.length - 1]!);
  segments[0]!.startPortId = startPort.id;
  if (endPort) segments[segments.length - 1]!.endPortId = endPort.id;
  if (wallTerminal) segments[segments.length - 1]!.endTermination = "wall";
  const routed = commitPlannedRoute(overlay, { ...plan, segments });
  if (routed === overlay) return overlay;
  return {
    ...routed,
    devices: routed.devices.map((device) => device.id === startDevice.id
      ? { ...device, ports: device.ports.map((port) => port.id === startPort.id ? { ...port, connectedSegmentIds: [segments[0]!.id] } : port) }
      : endDevice && endPort && device.id === endDevice.id
        ? { ...device, ports: device.ports.map((port) => port.id === endPort!.id ? { ...port, connectedSegmentIds: [segments[segments.length - 1]!.id] } : port) }
        : device),
  };
}

/** Reassigns a compatible legacy-unrooted connected component after a new rooted route reaches one of its open ends. */
export function rootLegacyNetwork(overlay: ConduitOverlayDocument, legacySegmentId: string, rootedCircuitId: string): ConduitOverlayDocument {
  const segment = overlay.segments.find((item) => item.id === legacySegmentId), rooted = overlay.circuits.find((item) => item.id === rootedCircuitId && item.status === "rooted");
  if (!segment || !segment.legacyUnrooted || !segment.circuitId || !rooted || rooted.system !== segment.system) return overlay;
  const legacy = overlay.circuits.find((item) => item.id === segment.circuitId && item.status === "legacy-unrooted");
  if (!legacy || legacy.system !== rooted.system) return overlay;
  const legacyIds = new Set(legacy.segmentIds), merged = { ...rooted, segmentIds: [...new Set([...rooted.segmentIds, ...legacy.segmentIds])] };
  return {
    ...overlay,
    segments: overlay.segments.map((item) => legacyIds.has(item.id) ? { ...item, circuitId: rooted.id, legacyUnrooted: false } : item),
    circuits: overlay.circuits.filter((item) => item.id !== legacy.id).map((item) => item.id === rooted.id ? merged : item),
  };
}

export function deviceDiagnostics(overlay: ConduitOverlayDocument): string[] {
  const devicesById = new Map(overlay.devices.map((device) => [device.id, device])), segmentsById = new Map(overlay.segments.map((segment) => [segment.id, segment])), circuitIds = new Set(overlay.circuits.map((circuit) => circuit.id));
  const diagnostics: string[] = [];
  for (const circuit of overlay.circuits) {
    if (circuit.status === "legacy-unrooted") diagnostics.push(`${circuit.id}: 未接源旧线路`);
    else if (circuit.status === "broken") diagnostics.push(`${circuit.id}: 设备移动后存在待重连开放管端`);
    else if (!circuit.sourceDeviceId || !devicesById.has(circuit.sourceDeviceId)) diagnostics.push(`${circuit.id}: 源设备缺失`);
    else {
      const source = devicesById.get(circuit.sourceDeviceId);
      if (!source || !isSourceDevice(source) || !source.systems.includes(circuit.system)) diagnostics.push(`${circuit.id}: 来源设备与系统不兼容`);
    }
    if (circuit.segmentIds.some((id) => !segmentsById.has(id))) diagnostics.push(`${circuit.id}: 管段引用断裂`);
    if (circuit.segmentIds.some((id) => { const segment = segmentsById.get(id); return Boolean(segment && segment.system !== circuit.system); })) diagnostics.push(`${circuit.id}: 管段系统不一致`);
  }
  for (const segment of overlay.segments) if (segment.system !== "sprinkler" && (!segment.circuitId || !circuitIds.has(segment.circuitId))) diagnostics.push(`${segment.id}: 未接源`);
  for (const device of overlay.devices) for (const port of device.ports) if (port.role === "sink" && port.connectedSegmentIds.length > 1) {
    const sprinklerPassThrough = device.deviceType === "sprinkler-head" && port.system === "sprinkler" && port.connectedSegmentIds.length === 2
      && port.connectedSegmentIds.filter((id) => segmentsById.get(id)?.endPortId === port.id && segmentsById.get(id)?.system === "sprinkler").length === 1
      && port.connectedSegmentIds.filter((id) => segmentsById.get(id)?.startPortId === port.id && segmentsById.get(id)?.system === "sprinkler").length === 1;
    if (!sprinklerPassThrough) diagnostics.push(`${device.id}: 终端端口重复连接`);
  }
  if (overlay.junctionBoxes.some((box) => box.system === "network") || overlay.fittings.some((fitting) => fitting.system === "network" && fitting.fitting === "tee")) diagnostics.push("网络线路存在禁止的分支节点");
  return [...new Set(diagnostics)];
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const interpolateAttachment = (segment: RouteSegment, t: number) => {
  const start = segment.start.attachment, end = segment.end.attachment;
  if (!start || !end || start.hostId !== end.hostId) return undefined;
  return { ...start, localPosition: start.localPosition && end.localPosition ? start.localPosition.map((value, axis) => value + (end.localPosition![axis] - value) * t) as Vec3 : start.localPosition };
};

/** Inserts a physical point device without allowing the conduit to pass through its body. */
export function insertDeviceOnSegment(overlay: ConduitOverlayDocument, segmentId: string, deviceType: NetworkDeviceType, world: Vec3, requestedLevelId?: string | null): ConduitOverlayDocument {
  const segment = overlay.segments.find((item) => item.id === segmentId), definition = DEVICE_DEFAULTS[deviceType];
  if (!segment || !definition.canInsertMidSegment || !definition.systems.includes(segment.system) || segment.legacyUnrooted) return overlay;
  if (deviceType === "network-outlet") return overlay;
  const delta = segment.end.position.map((value, axis) => value - segment.start.position[axis]) as Vec3, lengthSquared = delta.reduce((sum, value) => sum + value * value, 0);
  const t = lengthSquared < 1e-9 ? 0 : Math.max(0, Math.min(1, world.map((value, axis) => value - segment.start.position[axis]).reduce((sum, value, axis) => sum + value * delta[axis], 0) / lengthSquared));
  if (t < .03 || t > .97) return overlay;
  const position: Vec3 = segment.start.position.map((value, axis) => value + delta[axis] * t) as Vec3, attachment = interpolateAttachment(segment, t), point: RoutePoint = attachment ? { position, attachment } : { position }, tangent = normalize(delta), inheritedLevels = new Set([segment.start.attachment?.levelId, segment.end.attachment?.levelId].filter((levelId): levelId is string => Boolean(levelId))), circuit = segment.circuitId ? overlay.circuits.find((candidate) => candidate.id === segment.circuitId) : undefined, source = circuit?.sourceDeviceId ? overlay.devices.find((device) => device.id === circuit.sourceDeviceId) : undefined, circuitLevels = new Set([source?.position.attachment?.levelId, source?.mount?.kind === "host" ? source.mount.attachment.levelId : undefined, source?.mount?.kind === "reference-plane" ? source.mount.levelId : undefined, ...overlay.segments.filter((candidate) => candidate.circuitId === segment.circuitId).flatMap((candidate) => [candidate.start.attachment?.levelId, candidate.end.attachment?.levelId])].filter((levelId): levelId is string => Boolean(levelId))), resolvedLevelId = attachment?.levelId ?? (inheritedLevels.size === 1 ? [...inheritedLevels][0] : null) ?? (circuitLevels.size === 1 ? [...circuitLevels][0] : null) ?? requestedLevelId ?? null, mount: DeviceMount = { kind: "segment", segmentId, t, tangent, circuitId: segment.circuitId, ...(resolvedLevelId ? { levelId: resolvedLevelId } : {}) };
  if (deviceType === "sprinkler-head") {
    const branchEnd: RoutePoint = { position: [position[0], position[1] + .12, position[2]], attachment };
    const branched = commitBranchRoute(overlay, segment.id, [point, branchEnd], { chaseWidthMm: 60, chaseDepthMm: 55, penetrationDiameterMm: 60 });
    if (branched === overlay) return overlay;
    const branchSegment = branched.segments.filter((item) => !overlay.segments.some((old) => old.id === item.id)).find((item) => distance(item.end.position, branchEnd.position) < .02 || distance(item.start.position, branchEnd.position) < .02);
    if (!branchSegment) return overlay;
    const device = buildNetworkDevice(deviceType, branchEnd, undefined, false, { tangent: [0, 1, 0], mount: { kind: "segment", segmentId: branchSegment.id, t: 1, tangent: [0, 1, 0], circuitId: segment.circuitId, ...(resolvedLevelId ? { levelId: resolvedLevelId } : {}) } });
    const port = { ...device.ports[0], connectedSegmentIds: [branchSegment.id] };
    branchSegment.endPortId = port.id;
    return { ...branched, devices: [...branched.devices, { ...device, ports: [port] }] };
  }
  const direction = normalize(delta);
  const provisional = buildNetworkDevice(deviceType, point, undefined, false, { tangent: direction, mount });
  const pickProvisionalPort = (wanted: Vec3, reserved = new Set<string>()) => [...provisional.ports].filter((port) => !reserved.has(port.id)).sort((a, b) => dot(b.direction, wanted) - dot(a.direction, wanted))[0];
  const provisionalLeft = pickProvisionalPort(scale(direction, -1));
  const provisionalRight = provisionalLeft && isReassignableBox(provisional)
    ? provisional.ports.filter((port) => port.id !== provisionalLeft.id && port.slot === provisionalLeft.slot).sort((a, b) => dot(b.direction, direction) - dot(a.direction, direction))[0]
    : pickProvisionalPort(direction, new Set(provisionalLeft ? [provisionalLeft.id] : []));
  if (!provisionalLeft || !provisionalRight) return overlay;
  // Centre the box so its selected edge holes lie on the existing centreline.
  // The conduit stays straight; only the box slides sideways to meet it.
  const perpendicular = (port: NetworkPort) => {
    const offset = subtract(port.position.position, point.position);
    return subtract(offset, scale(direction, dot(offset, direction)));
  };
  const averagePerpendicular = scale(add(perpendicular(provisionalLeft), perpendicular(provisionalRight)), .5);
  const centeredPoint: RoutePoint = isReassignableBox(provisional) ? { position: subtract(point.position, averagePerpendicular), attachment: point.attachment ? structuredClone(point.attachment) : undefined } : point;
  const device = buildNetworkDevice(deviceType, centeredPoint, undefined, false, { tangent: direction, mount });
  const pickPort = (wanted: Vec3, reserved = new Set<string>()) => [...device.ports].filter((port) => !reserved.has(port.id)).sort((a, b) => dot(b.direction, wanted) - dot(a.direction, wanted))[0];
  const leftPort = device.ports.find((port) => port.face === provisionalLeft.face && port.slot === provisionalLeft.slot)
    ?? pickPort(scale(direction, -1));
  const rightPort = device.ports.find((port) => port.id !== leftPort?.id && port.face === provisionalRight.face && port.slot === provisionalRight.slot)
    ?? pickPort(direction, new Set(leftPort ? [leftPort.id] : []));
  if (!leftPort || !rightPort) return overlay;
  const left: RouteSegment = { ...segment, id: nextId("split"), end: clonePoint(leftPort.position), endPortId: undefined, endTermination: undefined }, right: RouteSegment = { ...segment, id: nextId("split"), start: clonePoint(rightPort.position), startPortId: undefined };
  const ports = [
    { ...leftPort, connectedSegmentIds: [left.id] },
    { ...rightPort, connectedSegmentIds: [right.id] },
    ...device.ports.filter((port) => port.id !== leftPort.id && port.id !== rightPort.id),
  ];
  left.endPortId = ports[0].id; right.startPortId = ports[1].id;
  const remapId = (routePoint: RoutePoint) => distance(routePoint.position, segment.start.position) < distance(routePoint.position, segment.end.position) ? left.id : right.id;
  const circuits = overlay.circuits.map((circuit) => circuit.id === segment.circuitId ? { ...circuit, segmentIds: circuit.segmentIds.flatMap((id) => id === segment.id ? [left.id, right.id] : [id]) } : circuit);
  const remappedDevices = overlay.devices.map((item) => ({ ...item, ports: item.ports.map((port) => port.connectedSegmentIds.includes(segment.id) ? { ...port, connectedSegmentIds: port.connectedSegmentIds.map((id) => id === segment.id ? remapId(port.position) : id) } : port) }));
  const remappedBoxes = overlay.junctionBoxes.map((box) => ({ ...box, segmentIds: box.segmentIds.map((id) => id === segment.id ? remapId(box.position) : id), ports: box.ports.map((port) => port.connectedSegmentIds.includes(segment.id) ? { ...port, segmentId: port.segmentId === segment.id ? remapId(port.position) : port.segmentId, connectedSegmentIds: port.connectedSegmentIds.map((id) => id === segment.id ? remapId(port.position) : id) } : port) }));
  return { ...overlay, segments: overlay.segments.flatMap((item) => item.id === segment.id ? [left, right] : [item]), devices: [...remappedDevices, { ...device, ports }], junctionBoxes: remappedBoxes, circuits, surfaceChases: overlay.surfaceChases.flatMap((chase) => chase.routeElementId !== segment.id || chase.path.kind !== "line" ? [chase] : [{ ...chase, id: nextId("chase"), routeElementId: left.id, path: { kind: "line" as const, start: chase.path.start, end: left.end } }, { ...chase, id: nextId("chase"), routeElementId: right.id, path: { kind: "line" as const, start: right.start, end: chase.path.end } }]), fittings: overlay.fittings.map((fitting) => ({ ...fitting, segmentIds: fitting.segmentIds.map((id) => id === segment.id ? remapId(fitting.position) : id), ports: fitting.ports.map((port) => port.segmentId === segment.id ? { ...port, segmentId: remapId(port.position), connectedSegmentIds: port.connectedSegmentIds.map((id) => id === segment.id ? remapId(port.position) : id) } : port) })) };
}

export type OpenRouteEndpoint = { segmentId: string; end: "start" | "end"; point: RoutePoint; direction: Vec3; system: RoutingSystem; circuit?: Circuit };

export function openRouteEndpoints(overlay: ConduitOverlayDocument): OpenRouteEndpoint[] {
  const circuits = new Map(overlay.circuits.filter((circuit) => circuit.status === "rooted" || circuit.status === "broken").map((circuit) => [circuit.id, circuit]));
  return overlay.segments.flatMap((segment) => {
    const circuit = segment.circuitId ? circuits.get(segment.circuitId) : undefined;
    if (segment.legacyUnrooted || (!circuit && segment.system !== "sprinkler" && segment.system !== "fire-signal")) return [];
    const tangent = normalize(subtract(segment.end.position, segment.start.position));
    const endpoints: OpenRouteEndpoint[] = [];
    if (!segment.startPortId) endpoints.push({ segmentId: segment.id, end: "start", point: clonePoint(segment.start), direction: scale(tangent, -1), system: segment.system, circuit });
    if (!segment.endPortId && segment.endTermination !== "wall") endpoints.push({ segmentId: segment.id, end: "end", point: clonePoint(segment.end), direction: tangent, system: segment.system, circuit });
    return endpoints;
  });
}

/** Places a terminal or box at a true conduit end. The existing conduit stops at the selected physical hole. */
export function placeDeviceAtEndpoint(overlay: ConduitOverlayDocument, endpoint: OpenRouteEndpoint, deviceType: NetworkDeviceType): ConduitOverlayDocument {
  const segment = overlay.segments.find((item) => item.id === endpoint.segmentId), definition = DEVICE_DEFAULTS[deviceType];
  if (!segment || !definition.systems.includes(endpoint.system) || definition.source || deviceType === "sprinkler-head") return overlay;
  if (deviceType === "network-outlet" && endpoint.system !== "network") return overlay;
  const baseMount: DeviceMount = { kind: "segment", segmentId: segment.id, t: endpoint.end === "start" ? 0 : 1, tangent: endpoint.direction, ...(endpoint.circuit ? { circuitId: endpoint.circuit.id } : {}) };
  const provisional = buildNetworkDevice(deviceType, endpoint.point, undefined, false, { tangent: endpoint.direction, mount: baseMount });
  const wanted = scale(endpoint.direction, -1);
  const port = [...provisional.ports].sort((a, b) => dot(b.direction, wanted) - dot(a.direction, wanted))[0];
  if (!port) return overlay;
  const offset = subtract(port.position.position, provisional.position.position), center: RoutePoint = { position: subtract(endpoint.point.position, offset), attachment: endpoint.point.attachment ? structuredClone(endpoint.point.attachment) : undefined };
  const device = buildNetworkDevice(deviceType, center, undefined, false, { tangent: endpoint.direction, mount: baseMount });
  const selected = device.ports.find((candidate) => candidate.face === port.face && candidate.slot === port.slot && candidate.system === endpoint.system) ?? device.ports[0];
  if (!selected) return overlay;
  const connected = { ...selected, position: clonePoint(endpoint.point), connectedSegmentIds: [segment.id] };
  const devices = [...overlay.devices, { ...device, ports: device.ports.map((candidate) => candidate.id === selected.id ? connected : candidate) }];
  const updatedSegment = endpoint.end === "start" ? { ...segment, startPortId: connected.id } : { ...segment, endPortId: connected.id };
  return { ...overlay, segments: overlay.segments.map((item) => item.id === segment.id ? updatedSegment : item), devices };
}

/** Connects a new planned route to a rooted, physically open conduit end. */
export function commitEndpointRoute(overlay: ConduitOverlayDocument, endpoint: OpenRouteEndpoint, plan: PlannedRoute, endDeviceId?: string, endPortId?: string, wallTerminal = false): ConduitOverlayDocument {
  const target = overlay.segments.find((segment) => segment.id === endpoint.segmentId), first = plan.segments[0];
  if (!target || !first || !plan.canCommit || target.system !== plan.system || (target.system !== "sprinkler" && target.circuitId !== endpoint.circuit?.id) || wallTerminal && (target.system !== "fire-signal" || endDeviceId || plan.points[plan.points.length - 1]?.attachment?.hostKind !== "wall")) return overlay;
  const firstDirection = normalize(subtract(first.end.position, first.start.position)), sameDirection = dot(endpoint.direction, firstDirection) > .995;
  const id = nextId(sameDirection ? "coupling" : "elbow"), ports: NetworkPort[] = [
    { id: `${id}:port:0`, owner: { kind: "fitting", id }, position: clonePoint(endpoint.point), direction: scale(endpoint.direction, -1), role: "bidirectional", system: target.system, connectedSegmentIds: [target.id], segmentId: target.id },
    { id: `${id}:port:1`, owner: { kind: "fitting", id }, position: clonePoint(endpoint.point), direction: firstDirection, role: "bidirectional", system: target.system, connectedSegmentIds: [first.id], segmentId: first.id },
  ];
  const updatedTarget = endpoint.end === "start" ? { ...target, startPortId: ports[0].id } : { ...target, endPortId: ports[0].id };
  const updatedFirst = { ...first, startPortId: ports[1].id };
  const fitting: RouteFitting = { id, type: target.system === "sprinkler" ? "sprinkler-fitting" : "conduit-fitting", fitting: sameDirection ? "coupling" : "elbow", bendStyle: sameDirection ? undefined : (target.system === "sprinkler" ? "standard" : "right-angle"), system: target.system, diameterMm: target.diameterMm, position: clonePoint(endpoint.point), segmentIds: [target.id, first.id], ports };
  const segments = plan.segments.map((segment, index) => ({ ...(index === 0 ? updatedFirst : segment), ...(endpoint.circuit ? { circuitId: endpoint.circuit.id } : {}) }));
  let devices = overlay.devices;
  if (endDeviceId) {
    const endDevice = devices.find((device) => device.id === endDeviceId), endPort = endDevice?.ports.find((port) => port.id === endPortId && port.system === plan.system && port.role !== "source" && port.connectedSegmentIds.length === 0) ?? endDevice?.ports.find((port) => port.system === plan.system && port.role !== "source" && port.connectedSegmentIds.length === 0);
    if (!endDevice || !endPort) return overlay;
    segments[segments.length - 1] = { ...segments[segments.length - 1], endPortId: endPort.id };
    devices = devices.map((device) => device.id === endDeviceId ? { ...device, ports: device.ports.map((port) => port.id === endPort.id ? { ...port, connectedSegmentIds: [segments[segments.length - 1].id] } : port) } : device);
  }
  if (wallTerminal) segments[segments.length - 1] = { ...segments[segments.length - 1], endTermination: "wall" };
  const nextSegments = overlay.segments.map((segment) => segment.id === target.id ? updatedTarget : segment).concat(segments);
  const stillOpen = endpoint.circuit && nextSegments.some((segment) => segment.circuitId === endpoint.circuit!.id && (!segment.startPortId || !segment.endPortId));
  return { ...overlay, devices, segments: nextSegments, fittings: [...overlay.fittings, fitting, ...plan.fittings], junctionBoxes: [...overlay.junctionBoxes, ...plan.junctionBoxes], surfaceChases: [...overlay.surfaceChases, ...plan.surfaceChases], penetrations: [...overlay.penetrations, ...plan.penetrations], circuits: endpoint.circuit ? overlay.circuits.map((circuit) => circuit.id === endpoint.circuit!.id ? { ...circuit, status: stillOpen ? "broken" as const : "rooted" as const, segmentIds: [...new Set([...circuit.segmentIds, ...segments.map((segment) => segment.id)])] } : circuit) : overlay.circuits };
}

/** Kept as a test seam for callers from the former sequential-ID implementation. */
export function resetDeviceIdsForTests() { /* UUID-backed IDs have no mutable sequence to reset. */ }
