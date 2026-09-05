import { z } from "zod";

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
export type NetworkOwnerKind = "device" | "fitting" | "junction-box";
export type NetworkPortRole = "source" | "bidirectional" | "sink" | "branch";
export type NetworkPort = { id: string; owner: { kind: NetworkOwnerKind; id: string }; position: RoutePoint; direction: Vec3; role: NetworkPortRole; system: RoutingSystem; connectedSegmentIds: string[]; segmentId?: string; connectedPortId?: string };
export type BendArc = { start: Vec3; end: Vec3; center: Vec3; normal: Vec3; sweepRadians: number };
export type RouteSegment = { id: string; type: "conduit-segment" | "sprinkler-segment"; system: RoutingSystem; diameterMm: number; start: RoutePoint; end: RoutePoint; startPortId?: string; endPortId?: string; circuitId?: string; legacyUnrooted?: boolean; createdAt: string };
export type RouteFitting = { id: string; type: "conduit-fitting" | "sprinkler-fitting"; fitting: "elbow" | "tee" | "coupling"; bendStyle?: "sweep" | "right-angle" | "standard"; radiusMm?: number; arc?: BendArc; system: RoutingSystem; diameterMm: number; position: RoutePoint; segmentIds: string[]; ports: NetworkPort[] };
export type JunctionBox = { id: string; type: "junction-box"; system: Exclude<RoutingSystem, "sprinkler">; position: RoutePoint; sizeMm: [number, number, number]; segmentIds: string[]; ports: NetworkPort[] };
export const DEVICE_TYPES = ["strong-panel", "weak-panel", "fire-inlet", "socket", "switch", "luminaire", "network-outlet", "sprinkler-head"] as const;
export type NetworkDeviceType = typeof DEVICE_TYPES[number];
export type NetworkDevice = { id: string; type: "network-device"; deviceType: NetworkDeviceType; name: string; position: RoutePoint; sizeMm: [number, number, number]; orientation: Vec3; systems: RoutingSystem[]; ports: NetworkPort[]; createdAt: string };
export type Circuit = { id: string; system: RoutingSystem; sourceDeviceId: string | null; rootPortId: string | null; segmentIds: string[]; status: "rooted" | "legacy-unrooted" | "broken"; createdAt: string };
export type WallChase = { id: string; type: "wall-chase"; wallId: string; segmentId: string; start: RoutePoint; end: RoutePoint; widthMm: number; depthMm: number };
export type SurfaceChasePath = { kind: "line"; start: RoutePoint; end: RoutePoint } | { kind: "arc"; arc: BendArc };
export type SurfaceChase = { id: string; type: "surface-chase"; hostId: string; hostKind: "wall" | "slab"; surfaceNormal: Vec3; routeElementId: string; path: SurfaceChasePath; widthMm: number; depthMm: number };
export type Penetration = { id: string; type: "penetration"; hostId: string; hostKind: HostKind; segmentId: string; entry: RoutePoint; exit: RoutePoint; direction: Vec3; diameterMm: number; derived?: boolean };

export type ConduitOverlayDocument = {
  schemaVersion: "2.0";
  source: { fileName: string; sha256: string };
  settings: { colors: Record<RoutingSystem, string>; visibleSystems: Record<RoutingSystem, boolean>; bendRadiusMm: number; stockLengthMm: number; junctionBoxSizeMm: [number, number, number] };
  segments: RouteSegment[];
  fittings: RouteFitting[];
  junctionBoxes: JunctionBox[];
  devices: NetworkDevice[];
  circuits: Circuit[];
  surfaceChases: SurfaceChase[];
  penetrations: Penetration[];
};

export type OverlayHostAssessment = { referencedHostIds: string[]; missingHostIds: string[] };

export const SYSTEM_DEFAULTS: Record<RoutingSystem, { label: string; color: string; diameterMm: number; mode: SurfaceMode }> = {
  receptacle: { label: "插座线路", color: "#ef4444", diameterMm: 20, mode: "surface" },
  lighting: { label: "照明线路", color: "#3b82f6", diameterMm: 20, mode: "surface" },
  network: { label: "网络线路", color: "#ffffff", diameterMm: 20, mode: "surface" },
  sprinkler: { label: "消防喷淋", color: "#22c55e", diameterMm: 50, mode: "suspended" },
};

export const migrateSystem = (system: RoutingSystem | LegacyRoutingSystem): RoutingSystem => ({ power: "receptacle", "low-voltage": "lighting", signal: "network", sprinkler: "sprinkler", receptacle: "receptacle", lighting: "lighting", network: "network" } as const)[system];

const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const attachmentSchema = z.object({ hostId: z.string(), hostKind: z.enum(["wall", "slab", "ceiling"]), surface: z.string(), normal: vec3Schema, levelId: z.string().nullable(), localPosition: vec3Schema.optional(), basis: z.object({ u: vec3Schema, v: vec3Schema }).optional(), curveT: z.number().min(0).max(1).optional(), wallSide: z.enum(["interior", "exterior"]).optional() });
const pointSchema = z.object({ position: vec3Schema, attachment: attachmentSchema.optional() });
const inputSystemSchema = z.enum([...SYSTEMS, ...LEGACY_SYSTEMS] as [string, ...string[]]);
const portSchema = z.object({ id: z.string(), owner: z.object({ kind: z.enum(["device", "fitting", "junction-box"]), id: z.string() }).optional(), position: pointSchema, direction: vec3Schema, role: z.enum(["source", "bidirectional", "sink", "branch"]).optional(), system: inputSystemSchema.optional(), connectedSegmentIds: z.array(z.string()).optional(), segmentId: z.string().optional(), connectedPortId: z.string().optional() });
const arcSchema = z.object({ start: vec3Schema, end: vec3Schema, center: vec3Schema, normal: vec3Schema, sweepRadians: z.number() });
const segmentSchema = z.object({ id: z.string(), type: z.enum(["conduit-segment", "sprinkler-segment"]), system: inputSystemSchema, diameterMm: z.number().positive(), start: pointSchema, end: pointSchema, startPortId: z.string().optional(), endPortId: z.string().optional(), circuitId: z.string().optional(), legacyUnrooted: z.boolean().optional(), createdAt: z.string() });
const fittingSchema = z.object({ id: z.string(), type: z.enum(["conduit-fitting", "sprinkler-fitting"]), fitting: z.enum(["elbow", "tee", "coupling"]), bendStyle: z.enum(["sweep", "right-angle", "standard"]).optional(), radiusMm: z.number().positive().optional(), arc: arcSchema.optional(), system: inputSystemSchema, diameterMm: z.number().positive(), position: pointSchema, segmentIds: z.array(z.string()), ports: z.array(portSchema).optional() });
const junctionBoxSchema = z.object({ id: z.string(), type: z.literal("junction-box"), system: inputSystemSchema, position: pointSchema, sizeMm: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]), segmentIds: z.array(z.string()), ports: z.array(portSchema) });
const deviceSchema = z.object({ id: z.string(), type: z.literal("network-device"), deviceType: z.enum(DEVICE_TYPES), name: z.string(), position: pointSchema, sizeMm: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]), orientation: vec3Schema, systems: z.array(inputSystemSchema), ports: z.array(portSchema), createdAt: z.string() });
const circuitSchema = z.object({ id: z.string(), system: inputSystemSchema, sourceDeviceId: z.string().nullable(), rootPortId: z.string().nullable(), segmentIds: z.array(z.string()), status: z.enum(["rooted", "legacy-unrooted", "broken"]), createdAt: z.string() });
const wallChaseSchema = z.object({ id: z.string(), type: z.literal("wall-chase"), wallId: z.string(), segmentId: z.string(), start: pointSchema, end: pointSchema, widthMm: z.number().positive(), depthMm: z.number().positive() });
const surfaceChaseSchema = z.object({ id: z.string(), type: z.literal("surface-chase"), hostId: z.string(), hostKind: z.enum(["wall", "slab"]), surfaceNormal: vec3Schema, routeElementId: z.string(), path: z.discriminatedUnion("kind", [z.object({ kind: z.literal("line"), start: pointSchema, end: pointSchema }), z.object({ kind: z.literal("arc"), arc: arcSchema })]), widthMm: z.number().positive(), depthMm: z.number().positive() });
const penetrationSchema = z.object({ id: z.string(), type: z.literal("penetration"), hostId: z.string(), hostKind: z.enum(["wall", "slab", "ceiling"]), segmentId: z.string(), point: pointSchema.optional(), entry: pointSchema.optional(), exit: pointSchema.optional(), direction: vec3Schema.optional(), diameterMm: z.number().positive(), derived: z.boolean().optional() }).refine((feature) => Boolean(feature.entry || feature.point), { message: "穿孔必须包含入口点或旧版 point。" });
const overlaySchema = z.object({ schemaVersion: z.enum(["1.0", "1.1", "1.2", "2.0"]), source: z.object({ fileName: z.string(), sha256: z.string() }), settings: z.object({ colors: z.record(z.string(), z.string()), visibleSystems: z.record(z.string(), z.boolean()).optional(), bendRadiusMm: z.number().positive().optional(), stockLengthMm: z.number().positive().optional(), junctionBoxSizeMm: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional() }), segments: z.array(segmentSchema), fittings: z.array(fittingSchema), junctionBoxes: z.array(junctionBoxSchema).optional(), devices: z.array(deviceSchema).optional(), circuits: z.array(circuitSchema).optional(), wallChases: z.array(wallChaseSchema).optional(), surfaceChases: z.array(surfaceChaseSchema).optional(), penetrations: z.array(penetrationSchema) });

export function createEmptyOverlay(fileName: string, sha256: string): ConduitOverlayDocument {
  return { schemaVersion: "2.0", source: { fileName, sha256 }, settings: { colors: Object.fromEntries(SYSTEMS.map((system) => [system, SYSTEM_DEFAULTS[system].color])) as Record<RoutingSystem, string>, visibleSystems: Object.fromEntries(SYSTEMS.map((system) => [system, true])) as Record<RoutingSystem, boolean>, bendRadiusMm: 200, stockLengthMm: 4000, junctionBoxSizeMm: [86, 86, 50] }, segments: [], fittings: [], junctionBoxes: [], devices: [], circuits: [], surfaceChases: [], penetrations: [] };
}

export function parseOverlay(raw: unknown): ConduitOverlayDocument {
  const parsed = overlaySchema.parse(raw);
  const legacy = parsed.schemaVersion !== "2.0";
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
    return { ...box, system: system as Exclude<RoutingSystem, "sprinkler">, ports: box.ports.map((value) => normalizePort(value, { kind: "junction-box", id: box.id }, system, value.segmentId)) };
  });
  const devices: NetworkDevice[] = (parsed.devices ?? []).map((device) => {
    const systems = device.systems.map((system) => migrateSystem(system as RoutingSystem | LegacyRoutingSystem));
    return { ...device, systems, ports: device.ports.map((value) => normalizePort(value, { kind: "device", id: device.id }, value.system ? migrateSystem(value.system as RoutingSystem | LegacyRoutingSystem) : systems[0] ?? "receptacle", value.segmentId)) };
  });
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
  return { schemaVersion: "2.0", source: parsed.source, segments, fittings, junctionBoxes, devices, circuits, surfaceChases: [...migratedChases, ...(parsed.surfaceChases ?? [])], penetrations, settings: { colors, visibleSystems, bendRadiusMm: parsed.settings.bendRadiusMm ?? 200, stockLengthMm: parsed.settings.stockLengthMm ?? 4000, junctionBoxSizeMm: parsed.settings.junctionBoxSizeMm ?? [86, 86, 50] } };
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
