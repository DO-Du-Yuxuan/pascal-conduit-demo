import type { Circuit, ConduitOverlayDocument, HostKind, NetworkDevice, NetworkDeviceType, NetworkPort, RoutePoint, RouteSegment, RoutingSystem, Vec3 } from "./overlay";
import type { PlannedRoute } from "./routing";
import { commitBranchRoute } from "./routing";

let sequence = 0;
const nextId = (prefix: string) => `${prefix}_${(++sequence).toString(36)}`;
const normalize = (value: Vec3): Vec3 => { const size = Math.hypot(...value); return size < 1e-9 ? [0, 1, 0] : value.map((item) => item / size) as Vec3; };
const clonePoint = (point: RoutePoint): RoutePoint => structuredClone(point);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

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
  "strong-panel": { label: "强电箱", systems: ["receptacle", "lighting"], hostKinds: ["wall"], sizeMm: [500, 600, 120], portRole: "source", source: true, canInsertMidSegment: false },
  "weak-panel": { label: "弱电箱", systems: ["network"], hostKinds: ["wall"], sizeMm: [350, 400, 100], portRole: "source", source: true, canInsertMidSegment: false },
  "fire-inlet": { label: "入户消防水点", systems: ["sprinkler"], hostKinds: ["wall", "slab", "ceiling"], sizeMm: [120, 120, 120], portRole: "source", source: true, canInsertMidSegment: false },
  socket: { label: "插座", systems: ["receptacle"], hostKinds: ["wall"], sizeMm: [86, 86, 50], portRole: "bidirectional", source: false, canInsertMidSegment: true },
  switch: { label: "开关", systems: ["lighting"], hostKinds: ["wall"], sizeMm: [86, 86, 50], portRole: "bidirectional", source: false, canInsertMidSegment: true },
  luminaire: { label: "灯具", systems: ["lighting"], hostKinds: ["ceiling"], sizeMm: [300, 300, 40], portRole: "bidirectional", source: false, canInsertMidSegment: true },
  "network-outlet": { label: "网络面板", systems: ["network"], hostKinds: ["wall"], sizeMm: [86, 86, 50], portRole: "sink", source: false, canInsertMidSegment: false },
  "sprinkler-head": { label: "向上喷淋头", systems: ["sprinkler"], hostKinds: ["ceiling", "slab", "wall"], sizeMm: [80, 80, 100], portRole: "sink", source: false, canInsertMidSegment: true },
};

export const systemCanBranch = (system: RoutingSystem) => system !== "network";
export const deviceSupportsSystem = (device: NetworkDevice, system: RoutingSystem) => device.systems.includes(system);
export const isSourceDevice = (device: NetworkDevice) => DEVICE_DEFAULTS[device.deviceType].source;

function devicePort(deviceId: string, index: number, point: RoutePoint, direction: Vec3, system: RoutingSystem, role: NetworkPort["role"]): NetworkPort {
  return { id: `${deviceId}:port:${index}`, owner: { kind: "device", id: deviceId }, position: clonePoint(point), direction: normalize(direction), role, system, connectedSegmentIds: [] };
}

function sourcePortPosition(position: RoutePoint, index: number): RoutePoint {
  const normal = normalize(position.attachment?.normal ?? [0, 0, 1]), fallbackU = Math.abs(normal[1]) < .9 ? normalize(cross([0, 1, 0], normal)) : [1, 0, 0] as Vec3;
  const u = normalize(position.attachment?.basis?.u ?? fallbackU), v = normalize(position.attachment?.basis?.v ?? cross(normal, u));
  const column = index % 6, row = Math.floor(index / 6), offsetU = (column - 2.5) * .035, offsetV = row * .035;
  return { ...clonePoint(position), position: position.position.map((value, axis) => value + u[axis] * offsetU + v[axis] * offsetV) as Vec3 };
}

function buildNetworkDevice(deviceType: NetworkDeviceType, position: RoutePoint, name: string | undefined, enforceDefaultHost: boolean): NetworkDevice {
  const definition = DEVICE_DEFAULTS[deviceType], hostKind = position.attachment?.hostKind;
  if (!hostKind || enforceDefaultHost && !definition.hostKinds.includes(hostKind)) throw new Error(`${definition.label}不能放置在${hostKind ?? "悬空位置"}。`);
  const id = nextId(deviceType), orientation = deviceType === "sprinkler-head" ? [0, 1, 0] as Vec3 : normalize(position.attachment?.normal ?? [0, 1, 0]);
  const roles = definition.portRole === "bidirectional" ? ["bidirectional", "bidirectional", "bidirectional"] as const : [definition.portRole];
  const ports = definition.systems.flatMap((system, systemIndex) => roles.map((role, index) => { const portIndex = systemIndex * roles.length + index; return devicePort(id, portIndex, definition.source ? sourcePortPosition(position, portIndex) : position, orientation, system, role); }));
  return { id, type: "network-device", deviceType, name: name ?? definition.label, position: clonePoint(position), sizeMm: [...definition.sizeMm], orientation, systems: [...definition.systems], ports, createdAt: new Date().toISOString() };
}

export function createNetworkDevice(deviceType: NetworkDeviceType, position: RoutePoint, name?: string): NetworkDevice {
  return buildNetworkDevice(deviceType, position, name, true);
}

export function placeNetworkDevice(overlay: ConduitOverlayDocument, deviceType: NetworkDeviceType, position: RoutePoint, name?: string): ConduitOverlayDocument {
  return { ...overlay, devices: [...overlay.devices, createNetworkDevice(deviceType, position, name)] };
}

export function portCanStart(overlay: ConduitOverlayDocument, device: NetworkDevice, port: NetworkPort, system: RoutingSystem): boolean {
  if (port.role === "sink" || port.system !== system || port.connectedSegmentIds.length > 0) return false;
  if (isSourceDevice(device)) return deviceSupportsSystem(device, system);
  const deviceSegments = device.ports.flatMap((candidate) => candidate.connectedSegmentIds);
  return overlay.circuits.some((circuit) => circuit.status === "rooted" && circuit.system === system && circuit.segmentIds.some((id) => deviceSegments.includes(id)));
}

export function startRouteFromDevice(overlay: ConduitOverlayDocument, deviceId: string, system: RoutingSystem): { overlay: ConduitOverlayDocument; circuit: Circuit; port: NetworkPort } {
  const device = overlay.devices.find((item) => item.id === deviceId);
  if (!device || !deviceSupportsSystem(device, system)) throw new Error("设备与当前线路系统不兼容。");
  const existing = device.ports.find((port) => portCanStart(overlay, device, port, system));
  let port = existing;
  let devices = overlay.devices;
  if (!port && isSourceDevice(device)) {
    port = devicePort(device.id, device.ports.length, sourcePortPosition(device.position, device.ports.length), device.orientation, system, "source");
    devices = overlay.devices.map((item) => item.id === device.id ? { ...item, ports: [...item.ports, port!] } : item);
  }
  if (!port) throw new Error("该设备没有可用的输出端口。");
  const deviceSegments = device.ports.flatMap((candidate) => candidate.connectedSegmentIds);
  const inheritedCircuit = !isSourceDevice(device) ? overlay.circuits.find((circuit) => circuit.status === "rooted" && circuit.system === system && circuit.segmentIds.some((id) => deviceSegments.includes(id))) : undefined;
  if (!isSourceDevice(device) && !inheritedCircuit) throw new Error("设备尚未接入合法来源。");
  const circuit: Circuit = inheritedCircuit ?? { id: nextId("circuit"), system, sourceDeviceId: device.id, rootPortId: port.id, segmentIds: [], status: "rooted", createdAt: new Date().toISOString() };
  return { overlay: inheritedCircuit ? { ...overlay, devices } : { ...overlay, devices, circuits: [...overlay.circuits, circuit] }, circuit, port };
}

export function commitDeviceRoute(overlay: ConduitOverlayDocument, plan: PlannedRoute, circuit: Circuit, startPort: NetworkPort, endDeviceId?: string): ConduitOverlayDocument {
  if (!plan.canCommit || !plan.segments.length) return overlay;
  const activeCircuit = overlay.circuits.find((item) => item.id === circuit.id && item.status === "rooted" && item.system === plan.system);
  const startDevice = overlay.devices.find((device) => device.id === startPort.owner.id), storedStartPort = startDevice?.ports.find((port) => port.id === startPort.id);
  const sourceDevice = activeCircuit?.sourceDeviceId ? overlay.devices.find((device) => device.id === activeCircuit.sourceDeviceId) : undefined;
  if (!activeCircuit || !startDevice || !storedStartPort || !sourceDevice || !isSourceDevice(sourceDevice) || !sourceDevice.systems.includes(plan.system) || !portCanStart(overlay, startDevice, storedStartPort, plan.system)) return overlay;
  const segments = plan.segments.map((segment) => ({ ...segment, circuitId: circuit.id, legacyUnrooted: false }));
  segments[0].startPortId = startPort.id;
  let devices = overlay.devices.map((device) => device.id === startPort.owner.id ? { ...device, ports: device.ports.map((port) => port.id === startPort.id ? { ...port, connectedSegmentIds: [...new Set([...port.connectedSegmentIds, segments[0].id])] } : port) } : device);
  if (endDeviceId) {
    const endDevice = devices.find((device) => device.id === endDeviceId), endPort = endDevice?.ports.find((port) => port.system === plan.system && port.role !== "source" && port.connectedSegmentIds.length === 0);
    if (!endDevice || !endPort) return overlay;
    segments[segments.length - 1].endPortId = endPort.id;
    devices = devices.map((device) => device.id === endDeviceId ? { ...device, ports: device.ports.map((port) => port.id === endPort.id ? { ...port, connectedSegmentIds: [segments[segments.length - 1].id] } : port) } : device);
  }
  const nextCircuit = { ...activeCircuit, segmentIds: [...new Set([...activeCircuit.segmentIds, ...segments.map((segment) => segment.id)])] };
  return { ...overlay, devices, circuits: overlay.circuits.map((item) => item.id === circuit.id ? nextCircuit : item), segments: [...overlay.segments, ...segments], fittings: [...overlay.fittings, ...plan.fittings], junctionBoxes: [...overlay.junctionBoxes, ...plan.junctionBoxes], surfaceChases: [...overlay.surfaceChases, ...plan.surfaceChases], penetrations: [...overlay.penetrations, ...plan.penetrations] };
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
  const deviceIds = new Set(overlay.devices.map((device) => device.id)), segmentIds = new Set(overlay.segments.map((segment) => segment.id));
  const diagnostics: string[] = [];
  for (const circuit of overlay.circuits) {
    if (circuit.status === "legacy-unrooted") diagnostics.push(`${circuit.id}: 未接源旧线路`);
    else if (!circuit.sourceDeviceId || !deviceIds.has(circuit.sourceDeviceId)) diagnostics.push(`${circuit.id}: 源设备缺失`);
    else {
      const source = overlay.devices.find((device) => device.id === circuit.sourceDeviceId);
      if (!source || !isSourceDevice(source) || !source.systems.includes(circuit.system)) diagnostics.push(`${circuit.id}: 来源设备与系统不兼容`);
    }
    if (circuit.segmentIds.some((id) => !segmentIds.has(id))) diagnostics.push(`${circuit.id}: 管段引用断裂`);
    if (overlay.segments.some((segment) => circuit.segmentIds.includes(segment.id) && segment.system !== circuit.system)) diagnostics.push(`${circuit.id}: 管段系统不一致`);
  }
  for (const segment of overlay.segments) if (!segment.circuitId || !overlay.circuits.some((circuit) => circuit.id === segment.circuitId)) diagnostics.push(`${segment.id}: 未接源`);
  for (const device of overlay.devices) for (const port of device.ports) if (port.role === "sink" && port.connectedSegmentIds.length > 1) diagnostics.push(`${device.id}: 终端端口重复连接`);
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
export function insertDeviceOnSegment(overlay: ConduitOverlayDocument, segmentId: string, deviceType: NetworkDeviceType, world: Vec3): ConduitOverlayDocument {
  const segment = overlay.segments.find((item) => item.id === segmentId), definition = DEVICE_DEFAULTS[deviceType];
  if (!segment || !definition.canInsertMidSegment || !definition.systems.includes(segment.system) || segment.legacyUnrooted) return overlay;
  const hostKind = segment.start.attachment?.hostKind ?? segment.end.attachment?.hostKind;
  if (!hostKind) return overlay;
  if (deviceType === "network-outlet") return overlay;
  const delta = segment.end.position.map((value, axis) => value - segment.start.position[axis]) as Vec3, lengthSquared = delta.reduce((sum, value) => sum + value * value, 0);
  const t = lengthSquared < 1e-9 ? 0 : Math.max(0, Math.min(1, world.map((value, axis) => value - segment.start.position[axis]).reduce((sum, value, axis) => sum + value * delta[axis], 0) / lengthSquared));
  if (t < .03 || t > .97) return overlay;
  const position: Vec3 = segment.start.position.map((value, axis) => value + delta[axis] * t) as Vec3, attachment = interpolateAttachment(segment, t), point: RoutePoint = attachment ? { position, attachment } : { position };
  if (deviceType === "sprinkler-head") {
    const branchEnd: RoutePoint = { position: [position[0], position[1] + .12, position[2]], attachment };
    const branched = commitBranchRoute(overlay, segment.id, [point, branchEnd], { chaseWidthMm: 60, chaseDepthMm: 55, penetrationDiameterMm: 60 });
    if (branched === overlay) return overlay;
    const device = buildNetworkDevice(deviceType, branchEnd, undefined, false), branchSegment = branched.segments.filter((item) => !overlay.segments.some((old) => old.id === item.id)).find((item) => distance(item.end.position, branchEnd.position) < .02 || distance(item.start.position, branchEnd.position) < .02);
    if (!branchSegment) return overlay;
    const port = { ...device.ports[0], connectedSegmentIds: [branchSegment.id] };
    branchSegment.endPortId = port.id;
    return { ...branched, devices: [...branched.devices, { ...device, ports: [port] }] };
  }
  const half = definition.sizeMm[0] / 2000, direction = normalize(delta), leftPosition = position.map((value, axis) => value - direction[axis] * half) as Vec3, rightPosition = position.map((value, axis) => value + direction[axis] * half) as Vec3;
  const left: RouteSegment = { ...segment, id: nextId("split"), end: { position: leftPosition, attachment }, endPortId: undefined }, right: RouteSegment = { ...segment, id: nextId("split"), start: { position: rightPosition, attachment }, startPortId: undefined };
  const device = buildNetworkDevice(deviceType, point, undefined, false), ports = [
    { ...device.ports[0], position: { position: leftPosition, attachment }, direction: direction.map((value) => -value) as Vec3, connectedSegmentIds: [left.id] },
    { ...(device.ports[1] ?? device.ports[0]), id: `${device.id}:port:1`, position: { position: rightPosition, attachment }, direction, connectedSegmentIds: [right.id] },
    ...device.ports.slice(2),
  ];
  left.endPortId = ports[0].id; right.startPortId = ports[1].id;
  const remapId = (routePoint: RoutePoint) => distance(routePoint.position, segment.start.position) < distance(routePoint.position, segment.end.position) ? left.id : right.id;
  const circuits = overlay.circuits.map((circuit) => circuit.id === segment.circuitId ? { ...circuit, segmentIds: circuit.segmentIds.flatMap((id) => id === segment.id ? [left.id, right.id] : [id]) } : circuit);
  const remappedDevices = overlay.devices.map((item) => ({ ...item, ports: item.ports.map((port) => port.connectedSegmentIds.includes(segment.id) ? { ...port, connectedSegmentIds: port.connectedSegmentIds.map((id) => id === segment.id ? remapId(port.position) : id) } : port) }));
  const remappedBoxes = overlay.junctionBoxes.map((box) => ({ ...box, segmentIds: box.segmentIds.map((id) => id === segment.id ? remapId(box.position) : id), ports: box.ports.map((port) => port.connectedSegmentIds.includes(segment.id) ? { ...port, segmentId: port.segmentId === segment.id ? remapId(port.position) : port.segmentId, connectedSegmentIds: port.connectedSegmentIds.map((id) => id === segment.id ? remapId(port.position) : id) } : port) }));
  return { ...overlay, segments: overlay.segments.flatMap((item) => item.id === segment.id ? [left, right] : [item]), devices: [...remappedDevices, { ...device, ports }], junctionBoxes: remappedBoxes, circuits, surfaceChases: overlay.surfaceChases.flatMap((chase) => chase.routeElementId !== segment.id || chase.path.kind !== "line" ? [chase] : [{ ...chase, id: nextId("chase"), routeElementId: left.id, path: { kind: "line" as const, start: chase.path.start, end: left.end } }, { ...chase, id: nextId("chase"), routeElementId: right.id, path: { kind: "line" as const, start: right.start, end: chase.path.end } }]), fittings: overlay.fittings.map((fitting) => ({ ...fitting, segmentIds: fitting.segmentIds.map((id) => id === segment.id ? remapId(fitting.position) : id), ports: fitting.ports.map((port) => port.segmentId === segment.id ? { ...port, segmentId: remapId(port.position), connectedSegmentIds: port.connectedSegmentIds.map((id) => id === segment.id ? remapId(port.position) : id) } : port) })) };
}

export function resetDeviceIdsForTests() { sequence = 0; }
