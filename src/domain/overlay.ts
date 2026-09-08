import { z } from "zod";
import { boxFrame, eightBoxPorts } from "./box-ports";

export type Vec3 = [number, number, number];

export const SYSTEMS = ["receptacle", "lighting", "network", "sprinkler"] as const;
export type RoutingSystem = typeof SYSTEMS[number];
export const LEGACY_SYSTEMS = ["power", "low-voltage", "signal", "sprinkler"] as const;
export type LegacyRoutingSystem = typeof LEGACY_SYSTEMS[number];
export type HostKind = "wall" | "slab" | "ceiling";
export type SurfaceMode = "surface" | "penetrate" | "suspended";

/**
 * A route stays attached to the read-only Pascal scene through this compact
 * anchor.  `localPosition` and `basis` make the relationship stable enough to
 * explain/edit a route without ever changing the source JSON.
 */
export type HostAttachment = {
  hostId: string;
  hostKind: HostKind;
  surface: string;
  normal: Vec3;
  levelId: string | null;
  localPosition?: Vec3;
  basis?: { u: Vec3; v: Vec3 };
  curveT?: number;
  wallSide?: "interior" | "exterior";
};
export type RoutePoint = { position: Vec3; attachment?: HostAttachment };
/** A device may live on a read-only building surface or ride a conduit in free space. */
export type DeviceMount = { kind: "host"; attachment: HostAttachment } | { kind: "segment"; segmentId: string; t: number; tangent: Vec3; circuitId?: string } | { kind: "reference-plane"; levelId: string; elevationMm: number };
export type DevicePositionReference = { horizontal?: { kind: "device" | "wall-end" | "opening"; referenceId: string; direction: -1 | 1 }; planarWallIds?: string[] };
export type DeviceFrame = { front: Vec3; up: Vec3; right: Vec3 };
export type NetworkOwnerKind = "device" | "fitting" | "junction-box";
export type NetworkPortRole = "source" | "bidirectional" | "sink" | "branch";
export type NetworkPort = { id: string; owner: { kind: NetworkOwnerKind; id: string }; position: RoutePoint; direction: Vec3; role: NetworkPortRole; system: RoutingSystem; connectedSegmentIds: string[]; segmentId?: string; connectedPortId?: string; face?: "top" | "bottom" | "left" | "right"; slot?: 0 | 1; flow?: "in" | "out" | "unknown" };
export type BendArc = { start: Vec3; end: Vec3; center: Vec3; normal: Vec3; sweepRadians: number };
export type RouteSegment = { id: string; type: "conduit-segment" | "sprinkler-segment"; system: RoutingSystem; diameterMm: number; start: RoutePoint; end: RoutePoint; startPortId?: string; endPortId?: string; circuitId?: string; legacyUnrooted?: boolean; createdAt: string };
export type BridgeBend = { obstacleSegmentId: string; entry: Vec3; crestStart: Vec3; crestEnd: Vec3; exit: Vec3; riseMm: number; clearanceMm: number };
export type RouteFitting = { id: string; type: "conduit-fitting" | "sprinkler-fitting"; fitting: "elbow" | "tee" | "coupling" | "bridge-bend"; bendStyle?: "sweep" | "right-angle" | "standard"; radiusMm?: number; arc?: BendArc; bridge?: BridgeBend; system: RoutingSystem; diameterMm: number; position: RoutePoint; segmentIds: string[]; ports: NetworkPort[] };
export type JunctionBox = { id: string; type: "junction-box"; system: Exclude<RoutingSystem, "sprinkler">; position: RoutePoint; sizeMm: [number, number, number]; frame?: DeviceFrame; segmentIds: string[]; ports: NetworkPort[] };
export const DEVICE_TYPES = ["strong-panel", "weak-panel", "fire-inlet", "socket", "switch", "luminaire", "network-outlet", "sprinkler-head"] as const;
export type NetworkDeviceType = typeof DEVICE_TYPES[number];
export type NetworkDevice = { id: string; type: "network-device"; deviceType: NetworkDeviceType; name: string; position: RoutePoint; sizeMm: [number, number, number]; orientation: Vec3; frame?: DeviceFrame; mount?: DeviceMount; positioning?: DevicePositionReference; systems: RoutingSystem[]; ports: NetworkPort[]; createdAt: string };
export type InstallationReferencePlane = { levelId: string; elevationMm: number; basis: "finished-floor"; derived?: boolean };
export type Circuit = { id: string; system: RoutingSystem; sourceDeviceId: string | null; rootPortId: string | null; segmentIds: string[]; status: "rooted" | "legacy-unrooted" | "broken"; createdAt: string };
export type LightingControlGroup = { id: string; switchDeviceId: string; luminaireDeviceIds: string[]; createdAt: string };
export type WallChase = { id: string; type: "wall-chase"; wallId: string; segmentId: string; start: RoutePoint; end: RoutePoint; widthMm: number; depthMm: number };
export type SurfaceChasePath = { kind: "line"; start: RoutePoint; end: RoutePoint } | { kind: "arc"; arc: BendArc };
export type SurfaceChase = { id: string; type: "surface-chase"; hostId: string; hostKind: "wall" | "slab"; surfaceNormal: Vec3; routeElementId: string; path: SurfaceChasePath; widthMm: number; depthMm: number };
export type Penetration = { id: string; type: "penetration"; hostId: string; hostKind: HostKind; segmentId: string; entry: RoutePoint; exit: RoutePoint; direction: Vec3; diameterMm: number; derived?: boolean };

export type ConduitOverlayDocument = {
  schemaVersion: "2.2";
  source: { fileName: string; sha256: string };
  settings: { colors: Record<RoutingSystem, string>; visibleSystems: Record<RoutingSystem, boolean>; bendRadiusMm: number; stockLengthMm: number; junctionBoxSizeMm: [number, number, number] };
  segments: RouteSegment[];
  fittings: RouteFitting[];
  junctionBoxes: JunctionBox[];
  devices: NetworkDevice[];
  circuits: Circuit[];
  lightingControlGroups: LightingControlGroup[];
  surfaceChases: SurfaceChase[];
  penetrations: Penetration[];
  installationReferencePlanes: InstallationReferencePlane[];
};

export type OverlayHostAssessment = { referencedHostIds: string[]; missingHostIds: string[] };

export const SYSTEM_DEFAULTS: Record<RoutingSystem, { label: string; color: string; diameterMm: number; mode: SurfaceMode }> = {
  receptacle: { label: "插座线路", color: "#ef4444", diameterMm: 20, mode: "surface" },
  lighting: { label: "照明线路", color: "#3b82f6", diameterMm: 20, mode: "surface" },
  network: { label: "网络线路", color: "#ffffff", diameterMm: 20, mode: "surface" },
  sprinkler: { label: "消防喷淋", color: "#22c55e", diameterMm: 50, mode: "suspended" },
};

export const migrateSystem = (system: RoutingSystem | LegacyRoutingSystem): RoutingSystem => ({ power: "receptacle", "low-voltage": "lighting", signal: "network", sprinkler: "sprinkler", receptacle: "receptacle", lighting: "lighting", network: "network" } as const)[system];

const normalizeVec = (value: Vec3): Vec3 => {
  const length = Math.hypot(...value);
  return length < 1e-9 ? [0, 1, 0] : value.map((item) => item / length) as Vec3;
};
const addVec = (a: Vec3, b: Vec3): Vec3 => a.map((value, axis) => value + b[axis]) as Vec3;
const scaleVec = (value: Vec3, amount: number): Vec3 => value.map((item) => item * amount) as Vec3;
const dotVec = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crossVec = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const attachmentSchema = z.object({ hostId: z.string(), hostKind: z.enum(["wall", "slab", "ceiling"]), surface: z.string(), normal: vec3Schema, levelId: z.string().nullable(), localPosition: vec3Schema.optional(), basis: z.object({ u: vec3Schema, v: vec3Schema }).optional(), curveT: z.number().min(0).max(1).optional(), wallSide: z.enum(["interior", "exterior"]).optional() });
const pointSchema = z.object({ position: vec3Schema, attachment: attachmentSchema.optional() });
const inputSystemSchema = z.enum([...SYSTEMS, ...LEGACY_SYSTEMS] as [string, ...string[]]);
const deviceMountSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("host"), attachment: attachmentSchema }), z.object({ kind: z.literal("segment"), segmentId: z.string(), t: z.number().min(0).max(1), tangent: vec3Schema, circuitId: z.string().optional() }), z.object({ kind: z.literal("reference-plane"), levelId: z.string(), elevationMm: z.number() })]);
const positioningSchema = z.object({ horizontal: z.object({ kind: z.enum(["device", "wall-end", "opening"]), referenceId: z.string(), direction: z.union([z.literal(-1), z.literal(1)]) }).optional(), planarWallIds: z.array(z.string()).optional() });
const deviceFrameSchema = z.object({ front: vec3Schema, up: vec3Schema, right: vec3Schema });
const portSchema = z.object({ id: z.string(), owner: z.object({ kind: z.enum(["device", "fitting", "junction-box"]), id: z.string() }).optional(), position: pointSchema, direction: vec3Schema, role: z.enum(["source", "bidirectional", "sink", "branch"]).optional(), system: inputSystemSchema.optional(), connectedSegmentIds: z.array(z.string()).optional(), segmentId: z.string().optional(), connectedPortId: z.string().optional(), face: z.enum(["top", "bottom", "left", "right"]).optional(), slot: z.union([z.literal(0), z.literal(1)]).optional(), flow: z.enum(["in", "out", "unknown"]).optional() });
const arcSchema = z.object({ start: vec3Schema, end: vec3Schema, center: vec3Schema, normal: vec3Schema, sweepRadians: z.number() });
const segmentSchema = z.object({ id: z.string(), type: z.enum(["conduit-segment", "sprinkler-segment"]), system: inputSystemSchema, diameterMm: z.number().positive(), start: pointSchema, end: pointSchema, startPortId: z.string().optional(), endPortId: z.string().optional(), circuitId: z.string().optional(), legacyUnrooted: z.boolean().optional(), createdAt: z.string() });
const bridgeSchema = z.object({ obstacleSegmentId: z.string(), entry: vec3Schema, crestStart: vec3Schema, crestEnd: vec3Schema, exit: vec3Schema, riseMm: z.number().positive(), clearanceMm: z.number().positive() });
const fittingSchema = z.object({ id: z.string(), type: z.enum(["conduit-fitting", "sprinkler-fitting"]), fitting: z.enum(["elbow", "tee", "coupling", "bridge-bend"]), bendStyle: z.enum(["sweep", "right-angle", "standard"]).optional(), radiusMm: z.number().positive().optional(), arc: arcSchema.optional(), bridge: bridgeSchema.optional(), system: inputSystemSchema, diameterMm: z.number().positive(), position: pointSchema, segmentIds: z.array(z.string()), ports: z.array(portSchema).optional() });
const junctionBoxSchema = z.object({ id: z.string(), type: z.literal("junction-box"), system: inputSystemSchema, position: pointSchema, sizeMm: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]), frame: deviceFrameSchema.optional(), segmentIds: z.array(z.string()), ports: z.array(portSchema) });
const deviceSchema = z.object({ id: z.string(), type: z.literal("network-device"), deviceType: z.enum(DEVICE_TYPES), name: z.string(), position: pointSchema, sizeMm: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]), orientation: vec3Schema, frame: deviceFrameSchema.optional(), mount: deviceMountSchema.optional(), positioning: positioningSchema.optional(), systems: z.array(inputSystemSchema), ports: z.array(portSchema), createdAt: z.string() });
const installationReferencePlaneSchema = z.object({ levelId: z.string(), elevationMm: z.number(), basis: z.literal("finished-floor"), derived: z.boolean().optional() });
const circuitSchema = z.object({ id: z.string(), system: inputSystemSchema, sourceDeviceId: z.string().nullable(), rootPortId: z.string().nullable(), segmentIds: z.array(z.string()), status: z.enum(["rooted", "legacy-unrooted", "broken"]), createdAt: z.string() });
const lightingControlGroupSchema = z.object({ id: z.string(), switchDeviceId: z.string(), luminaireDeviceIds: z.array(z.string()), createdAt: z.string() });
const wallChaseSchema = z.object({ id: z.string(), type: z.literal("wall-chase"), wallId: z.string(), segmentId: z.string(), start: pointSchema, end: pointSchema, widthMm: z.number().positive(), depthMm: z.number().positive() });
const surfaceChaseSchema = z.object({ id: z.string(), type: z.literal("surface-chase"), hostId: z.string(), hostKind: z.enum(["wall", "slab"]), surfaceNormal: vec3Schema, routeElementId: z.string(), path: z.discriminatedUnion("kind", [z.object({ kind: z.literal("line"), start: pointSchema, end: pointSchema }), z.object({ kind: z.literal("arc"), arc: arcSchema })]), widthMm: z.number().positive(), depthMm: z.number().positive() });
const penetrationSchema = z.object({ id: z.string(), type: z.literal("penetration"), hostId: z.string(), hostKind: z.enum(["wall", "slab", "ceiling"]), segmentId: z.string(), point: pointSchema.optional(), entry: pointSchema.optional(), exit: pointSchema.optional(), direction: vec3Schema.optional(), diameterMm: z.number().positive(), derived: z.boolean().optional() }).refine((feature) => Boolean(feature.entry || feature.point), { message: "穿孔必须包含入口点或旧版 point。" });
const overlaySchema = z.object({ schemaVersion: z.enum(["1.0", "1.1", "1.2", "2.0", "2.1", "2.2"]), source: z.object({ fileName: z.string(), sha256: z.string() }), settings: z.object({ colors: z.record(z.string(), z.string()), visibleSystems: z.record(z.string(), z.boolean()).optional(), bendRadiusMm: z.number().positive().optional(), stockLengthMm: z.number().positive().optional(), junctionBoxSizeMm: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional() }), segments: z.array(segmentSchema), fittings: z.array(fittingSchema), junctionBoxes: z.array(junctionBoxSchema).optional(), devices: z.array(deviceSchema).optional(), circuits: z.array(circuitSchema).optional(), lightingControlGroups: z.array(lightingControlGroupSchema).optional(), wallChases: z.array(wallChaseSchema).optional(), surfaceChases: z.array(surfaceChaseSchema).optional(), penetrations: z.array(penetrationSchema), installationReferencePlanes: z.array(installationReferencePlaneSchema).optional() });

type ParsedDevice = z.infer<typeof deviceSchema>;

/** Converts pre-2.1 centre ports to the eight physical holes without changing their IDs. */
function migrateBoxPorts(device: ParsedDevice, frame: DeviceFrame, ports: NetworkPort[], sourceVersion: string): NetworkPort[] {
  if (sourceVersion === "2.1" || sourceVersion === "2.2" || !["socket", "switch", "network-outlet"].includes(device.deviceType) || ports.some((port) => port.face)) return ports;
  const width = device.sizeMm[0] / 1000, height = device.sizeMm[1] / 1000;
  const faces: Array<{ face: NonNullable<NetworkPort["face"]>; direction: Vec3; lateral: Vec3; extent: number }> = [
    { face: "top", direction: frame.up, lateral: frame.right, extent: height / 2 },
    { face: "bottom", direction: scaleVec(frame.up, -1), lateral: frame.right, extent: height / 2 },
    { face: "left", direction: scaleVec(frame.right, -1), lateral: frame.up, extent: width / 2 },
    { face: "right", direction: frame.right, lateral: frame.up, extent: width / 2 },
  ];
  const templates = faces.flatMap((entry, faceIndex) => ([0, 1] as const).map((slot) => {
    const across = (slot === 0 ? -.22 : .22) * (entry.face === "top" || entry.face === "bottom" ? width : height);
    return { face: entry.face, slot, direction: entry.direction, position: addVec(addVec(device.position.position, scaleVec(entry.direction, entry.extent)), scaleVec(entry.lateral, across)), index: faceIndex * 2 + slot };
  }));
  const unused = new Set(templates.map((template) => template.index));
  const migrated = ports.map((port) => {
    const chosen = templates.filter((template) => unused.has(template.index)).sort((a, b) => dotVec(b.direction, port.direction) - dotVec(a.direction, port.direction))[0] ?? templates[0];
    unused.delete(chosen.index);
    return { ...port, face: chosen.face, slot: chosen.slot, direction: chosen.direction, position: { position: chosen.position, attachment: port.position.attachment ?? device.position.attachment } };
  });
  const defaultSystem = migrated[0]?.system ?? migrateSystem(device.systems[0] as RoutingSystem | LegacyRoutingSystem);
  for (const template of templates) if (unused.has(template.index)) {
    migrated.push({ id: `${device.id}:port:migrated:${template.index}`, owner: { kind: "device", id: device.id }, position: { position: template.position, attachment: device.position.attachment }, direction: template.direction, role: device.deviceType === "network-outlet" ? "sink" : "bidirectional", system: defaultSystem, connectedSegmentIds: [], face: template.face, slot: template.slot, flow: "unknown" });
  }
  return migrated;
}

export function createEmptyOverlay(fileName: string, sha256: string): ConduitOverlayDocument {
  return { schemaVersion: "2.2", source: { fileName, sha256 }, settings: { colors: Object.fromEntries(SYSTEMS.map((system) => [system, SYSTEM_DEFAULTS[system].color])) as Record<RoutingSystem, string>, visibleSystems: Object.fromEntries(SYSTEMS.map((system) => [system, true])) as Record<RoutingSystem, boolean>, bendRadiusMm: 200, stockLengthMm: 4000, junctionBoxSizeMm: [86, 86, 50] }, segments: [], fittings: [], junctionBoxes: [], devices: [], circuits: [], lightingControlGroups: [], surfaceChases: [], penetrations: [], installationReferencePlanes: [] };
}

export function parseOverlay(raw: unknown): ConduitOverlayDocument {
  const parsed = overlaySchema.parse(raw);
  const legacy = parsed.schemaVersion !== "2.0" && parsed.schemaVersion !== "2.1" && parsed.schemaVersion !== "2.2";
  const segments: RouteSegment[] = parsed.segments.map((segment) => ({ ...segment, system: migrateSystem(segment.system as RoutingSystem | LegacyRoutingSystem), circuitId: segment.circuitId, legacyUnrooted: segment.legacyUnrooted ?? legacy }));
  const normalizePort = (value: z.infer<typeof portSchema>, owner: NetworkPort["owner"], system: RoutingSystem, segmentId?: string): NetworkPort => ({
    ...value,
    owner: value.owner ?? owner,
    role: value.role ?? "bidirectional",
    system: value.system ? migrateSystem(value.system as RoutingSystem | LegacyRoutingSystem) : system,
    connectedSegmentIds: value.connectedSegmentIds ?? [value.segmentId ?? segmentId].filter((id): id is string => Boolean(id)),
    segmentId: value.segmentId ?? segmentId,
  });
  const portsFor = (fitting: typeof parsed.fittings[number]) => fitting.ports ?? fitting.segmentIds.flatMap((segmentId, index) => {
    const segment = segments.find((candidate) => candidate.id === segmentId);
    if (!segment) return [];
    const startDistance = Math.hypot(...segment.start.position.map((value, axis) => value - fitting.position.position[axis]));
    const point = startDistance < Math.hypot(...segment.end.position.map((value, axis) => value - fitting.position.position[axis])) ? segment.start : segment.end;
    const other = point === segment.start ? segment.end : segment.start;
    const length = Math.max(1e-9, Math.hypot(...other.position.map((value, axis) => value - point.position[axis])));
    const direction = other.position.map((value, axis) => (value - point.position[axis]) / length) as Vec3;
    return [{ id: `${fitting.id}:port:${index}`, owner: { kind: "fitting", id: fitting.id }, position: point, direction, role: "bidirectional", system: migrateSystem(fitting.system as RoutingSystem | LegacyRoutingSystem), connectedSegmentIds: [segmentId], segmentId }];
  });
  const fittings: RouteFitting[] = parsed.fittings.map((fitting) => {
    const system = migrateSystem(fitting.system as RoutingSystem | LegacyRoutingSystem);
    return { ...fitting, system, bendStyle: fitting.bendStyle ?? (fitting.fitting === "elbow" ? "right-angle" : undefined), ports: portsFor(fitting).map((value) => normalizePort(value, { kind: "fitting", id: fitting.id }, system, value.segmentId)) };
  });
  for (const fitting of fittings) for (const port of fitting.ports) {
    const segment = segments.find((candidate) => candidate.id === port.segmentId);
    if (!segment) continue;
    const startDistance = Math.hypot(...segment.start.position.map((value, axis) => value - port.position.position[axis]));
    if (startDistance < Math.hypot(...segment.end.position.map((value, axis) => value - port.position.position[axis]))) segment.startPortId ??= port.id; else segment.endPortId ??= port.id;
  }
  const junctionBoxes: JunctionBox[] = (parsed.junctionBoxes ?? []).map((box) => {
    const system = migrateSystem(box.system as RoutingSystem | LegacyRoutingSystem);
    const ports = box.ports.map((value) => normalizePort(value, { kind: "junction-box", id: box.id }, system, value.segmentId));
    const frame = box.frame ?? boxFrame(box.position, ports[0]?.direction);
    if (ports.length >= 8) return { ...box, system: system as Exclude<RoutingSystem, "sprinkler">, frame, ports };
    const templates = eightBoxPorts("junction-box", box.id, box.position, frame, box.sizeMm, system, "branch"), unused = new Set(templates.map((template) => template.id));
    const migrated: NetworkPort[] = ports.map((port) => {
      const target = templates.filter((template) => unused.has(template.id)).sort((left, right) => dotVec(right.direction, port.direction) - dotVec(left.direction, port.direction))[0] ?? templates[0];
      unused.delete(target.id);
      return { ...port, face: target.face, slot: target.slot, direction: target.direction, position: target.position };
    });
    for (const template of templates) if (unused.has(template.id)) migrated.push(template);
    return { ...box, system: system as Exclude<RoutingSystem, "sprinkler">, frame, ports: migrated };
  });
  const devices: NetworkDevice[] = (parsed.devices ?? []).map((device) => {
    const systems = device.systems.map((system) => migrateSystem(system as RoutingSystem | LegacyRoutingSystem));
    const front = normalizeVec(device.frame?.front ?? device.orientation);
    const candidateUp: Vec3 = device.frame?.up ?? (Math.abs(front[1]) < .9 ? [0, 1, 0] : [1, 0, 0]);
    const up = normalizeVec(candidateUp.map((value, axis) => value - front[axis] * dotVec(candidateUp, front)) as Vec3);
    const right = normalizeVec(device.frame?.right ?? crossVec(up, front));
    const normalizedPorts = device.ports.map((value) => normalizePort(value, { kind: "device", id: device.id }, value.system ? migrateSystem(value.system as RoutingSystem | LegacyRoutingSystem) : systems[0] ?? "receptacle", value.segmentId));
    return { ...device, systems, frame: { front, up, right }, mount: device.mount ?? (device.position.attachment ? { kind: "host", attachment: device.position.attachment } : undefined), ports: migrateBoxPorts(device, { front, up, right }, normalizedPorts, parsed.schemaVersion) };
  });
  const lightingControlGroups = parsed.lightingControlGroups ?? [];
  const devicesById = new Map(devices.map((device) => [device.id, device]));
  const groupIds = new Set<string>(), boundLuminaireIds = new Set<string>();
  for (const group of lightingControlGroups) {
    if (groupIds.has(group.id)) throw new Error(`照明控制组 ID 重复：${group.id}`);
    groupIds.add(group.id);
    if (devicesById.get(group.switchDeviceId)?.deviceType !== "switch") throw new Error(`照明控制组 ${group.id} 引用了无效开关。`);
    if (!group.luminaireDeviceIds.length) throw new Error(`照明控制组 ${group.id} 不能为空。`);
    const members = new Set<string>();
    for (const id of group.luminaireDeviceIds) {
      if (members.has(id)) throw new Error(`照明控制组 ${group.id} 重复引用灯具 ${id}。`);
      members.add(id);
      if (devicesById.get(id)?.deviceType !== "luminaire") throw new Error(`照明控制组 ${group.id} 引用了无效灯具 ${id}。`);
      if (boundLuminaireIds.has(id)) throw new Error(`灯具 ${id} 同时属于多个照明控制组。`);
      boundLuminaireIds.add(id);
    }
  }
  const circuits: Circuit[] = (parsed.circuits ?? []).map((circuit) => ({ ...circuit, system: migrateSystem(circuit.system as RoutingSystem | LegacyRoutingSystem) }));
  if (legacy && segments.length) {
    for (const system of SYSTEMS) {
      const ids = segments.filter((segment) => segment.system === system).map((segment) => segment.id);
      if (ids.length) circuits.push({ id: `legacy-${system}`, system, sourceDeviceId: null, rootPortId: null, segmentIds: ids, status: "legacy-unrooted", createdAt: new Date(0).toISOString() });
      for (const segment of segments.filter((item) => item.system === system)) segment.circuitId = ids.length ? `legacy-${system}` : undefined;
    }
  }
  const migratedChases: SurfaceChase[] = (parsed.wallChases ?? []).map((chase) => ({ id: chase.id, type: "surface-chase", hostId: chase.wallId, hostKind: "wall", surfaceNormal: chase.start.attachment?.normal ?? [0, 0, 1], routeElementId: chase.segmentId, path: { kind: "line", start: chase.start, end: chase.end }, widthMm: chase.widthMm, depthMm: chase.depthMm }));
  const penetrations: Penetration[] = parsed.penetrations.map((feature) => {
    const entry = feature.entry ?? feature.point!;
    const exit = feature.exit ?? entry;
    const delta = exit.position.map((value, axis) => value - entry.position[axis]) as Vec3;
    const size = Math.hypot(...delta), fallback = entry.attachment?.normal ?? [0, 0, 1] as Vec3;
    return { id: feature.id, type: "penetration", hostId: feature.hostId, hostKind: feature.hostKind, segmentId: feature.segmentId, entry, exit, direction: feature.direction ?? (size > 1e-9 ? delta.map((value) => value / size) as Vec3 : fallback), diameterMm: feature.diameterMm, derived: feature.derived ?? !feature.entry };
  });
  const colors = Object.fromEntries(SYSTEMS.map((system) => [system, parsed.settings.colors[system] ?? parsed.settings.colors[({ receptacle: "power", lighting: "low-voltage", network: "signal", sprinkler: "sprinkler" } as const)[system]] ?? SYSTEM_DEFAULTS[system].color])) as Record<RoutingSystem, string>;
  const visibleSystems = Object.fromEntries(SYSTEMS.map((system) => [system, parsed.settings.visibleSystems?.[system] ?? parsed.settings.visibleSystems?.[({ receptacle: "power", lighting: "low-voltage", network: "signal", sprinkler: "sprinkler" } as const)[system]] ?? true])) as Record<RoutingSystem, boolean>;
  return { schemaVersion: "2.2", source: parsed.source, segments, fittings, junctionBoxes, devices, circuits, lightingControlGroups, surfaceChases: [...migratedChases, ...(parsed.surfaceChases ?? [])], penetrations, installationReferencePlanes: parsed.installationReferencePlanes ?? [], settings: { colors, visibleSystems, bendRadiusMm: parsed.settings.bendRadiusMm ?? 200, stockLengthMm: parsed.settings.stockLengthMm ?? 4000, junctionBoxSizeMm: parsed.settings.junctionBoxSizeMm ?? [86, 86, 50] } };
}

/**
 * Checks sidecar references without mutating either document. Missing hosts do
 * not invalidate route coordinates, but callers must not recreate their cuts.
 */
export function assessOverlayHosts(overlay: ConduitOverlayDocument, hostIds: Iterable<string>): OverlayHostAssessment {
  const available = new Set(hostIds), referenced = new Set<string>();
  for (const segment of overlay.segments) for (const point of [segment.start, segment.end]) if (point.attachment) referenced.add(point.attachment.hostId);
  for (const chase of overlay.surfaceChases) referenced.add(chase.hostId);
  for (const penetration of overlay.penetrations) referenced.add(penetration.hostId);
  for (const box of overlay.junctionBoxes) if (box.position.attachment) referenced.add(box.position.attachment.hostId);
  for (const device of overlay.devices) if (device.position.attachment) referenced.add(device.position.attachment.hostId);
  const referencedHostIds = [...referenced].sort();
  return { referencedHostIds, missingHostIds: referencedHostIds.filter((id) => !available.has(id)) };
}
