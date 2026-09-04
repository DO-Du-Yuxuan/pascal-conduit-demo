import { z } from "zod";

export type Vec3 = [number, number, number];

export const SYSTEMS = ["power", "low-voltage", "signal", "sprinkler"] as const;
export type RoutingSystem = typeof SYSTEMS[number];
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
export type NetworkPort = { id: string; position: RoutePoint; direction: Vec3; segmentId: string; connectedPortId?: string };
export type BendArc = { start: Vec3; end: Vec3; center: Vec3; normal: Vec3; sweepRadians: number };
export type RouteSegment = { id: string; type: "conduit-segment" | "sprinkler-segment"; system: RoutingSystem; diameterMm: number; start: RoutePoint; end: RoutePoint; startPortId?: string; endPortId?: string; createdAt: string };
export type RouteFitting = { id: string; type: "conduit-fitting" | "sprinkler-fitting"; fitting: "elbow" | "tee" | "coupling"; bendStyle?: "sweep" | "right-angle" | "standard"; radiusMm?: number; arc?: BendArc; system: RoutingSystem; diameterMm: number; position: RoutePoint; segmentIds: string[]; ports: NetworkPort[] };
export type JunctionBox = { id: string; type: "junction-box"; system: Exclude<RoutingSystem, "sprinkler">; position: RoutePoint; sizeMm: [number, number, number]; segmentIds: string[]; ports: NetworkPort[] };
export type WallChase = { id: string; type: "wall-chase"; wallId: string; segmentId: string; start: RoutePoint; end: RoutePoint; widthMm: number; depthMm: number };
export type Penetration = { id: string; type: "penetration"; hostId: string; hostKind: HostKind; segmentId: string; point: RoutePoint; diameterMm: number };

export type ConduitOverlayDocument = {
  schemaVersion: "1.1";
  source: { fileName: string; sha256: string };
  settings: { colors: Record<RoutingSystem, string>; visibleSystems: Record<RoutingSystem, boolean>; bendRadiusMm: number; stockLengthMm: number; junctionBoxSizeMm: [number, number, number] };
  segments: RouteSegment[];
  fittings: RouteFitting[];
  junctionBoxes: JunctionBox[];
  wallChases: WallChase[];
  penetrations: Penetration[];
};

export type OverlayHostAssessment = { referencedHostIds: string[]; missingHostIds: string[] };

export const SYSTEM_DEFAULTS: Record<RoutingSystem, { label: string; color: string; diameterMm: number; mode: SurfaceMode }> = {
  power: { label: "强电线管", color: "#ef4444", diameterMm: 20, mode: "surface" },
  "low-voltage": { label: "弱电线管", color: "#3b82f6", diameterMm: 20, mode: "surface" },
  signal: { label: "信号线管", color: "#ffffff", diameterMm: 20, mode: "surface" },
  sprinkler: { label: "消防喷淋", color: "#22c55e", diameterMm: 50, mode: "suspended" },
};

const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const attachmentSchema = z.object({ hostId: z.string(), hostKind: z.enum(["wall", "slab", "ceiling"]), surface: z.string(), normal: vec3Schema, levelId: z.string().nullable(), localPosition: vec3Schema.optional(), basis: z.object({ u: vec3Schema, v: vec3Schema }).optional(), curveT: z.number().min(0).max(1).optional(), wallSide: z.enum(["interior", "exterior"]).optional() });
const pointSchema = z.object({ position: vec3Schema, attachment: attachmentSchema.optional() });
const systemSchema = z.enum(SYSTEMS);
const portSchema = z.object({ id: z.string(), position: pointSchema, direction: vec3Schema, segmentId: z.string(), connectedPortId: z.string().optional() });
const arcSchema = z.object({ start: vec3Schema, end: vec3Schema, center: vec3Schema, normal: vec3Schema, sweepRadians: z.number() });
const segmentSchema = z.object({ id: z.string(), type: z.enum(["conduit-segment", "sprinkler-segment"]), system: systemSchema, diameterMm: z.number().positive(), start: pointSchema, end: pointSchema, startPortId: z.string().optional(), endPortId: z.string().optional(), createdAt: z.string() });
const fittingSchema = z.object({ id: z.string(), type: z.enum(["conduit-fitting", "sprinkler-fitting"]), fitting: z.enum(["elbow", "tee", "coupling"]), bendStyle: z.enum(["sweep", "right-angle", "standard"]).optional(), radiusMm: z.number().positive().optional(), arc: arcSchema.optional(), system: systemSchema, diameterMm: z.number().positive(), position: pointSchema, segmentIds: z.array(z.string()), ports: z.array(portSchema).optional() });
const junctionBoxSchema = z.object({ id: z.string(), type: z.literal("junction-box"), system: z.enum(["power", "low-voltage", "signal"]), position: pointSchema, sizeMm: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]), segmentIds: z.array(z.string()), ports: z.array(portSchema) });
const wallChaseSchema = z.object({ id: z.string(), type: z.literal("wall-chase"), wallId: z.string(), segmentId: z.string(), start: pointSchema, end: pointSchema, widthMm: z.number().positive(), depthMm: z.number().positive() });
const penetrationSchema = z.object({ id: z.string(), type: z.literal("penetration"), hostId: z.string(), hostKind: z.enum(["wall", "slab", "ceiling"]), segmentId: z.string(), point: pointSchema, diameterMm: z.number().positive() });
const overlaySchema = z.object({ schemaVersion: z.enum(["1.0", "1.1"]), source: z.object({ fileName: z.string(), sha256: z.string() }), settings: z.object({ colors: z.record(systemSchema, z.string()), visibleSystems: z.record(systemSchema, z.boolean()).optional(), bendRadiusMm: z.number().positive().optional(), stockLengthMm: z.number().positive().optional(), junctionBoxSizeMm: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional() }), segments: z.array(segmentSchema), fittings: z.array(fittingSchema), junctionBoxes: z.array(junctionBoxSchema).optional(), wallChases: z.array(wallChaseSchema), penetrations: z.array(penetrationSchema) });

export function createEmptyOverlay(fileName: string, sha256: string): ConduitOverlayDocument {
  return { schemaVersion: "1.1", source: { fileName, sha256 }, settings: { colors: Object.fromEntries(SYSTEMS.map((system) => [system, SYSTEM_DEFAULTS[system].color])) as Record<RoutingSystem, string>, visibleSystems: Object.fromEntries(SYSTEMS.map((system) => [system, true])) as Record<RoutingSystem, boolean>, bendRadiusMm: 200, stockLengthMm: 4000, junctionBoxSizeMm: [86, 86, 50] }, segments: [], fittings: [], junctionBoxes: [], wallChases: [], penetrations: [] };
}

export function parseOverlay(raw: unknown): ConduitOverlayDocument {
  const parsed = overlaySchema.parse(raw);
  const segments = parsed.segments.map((segment) => ({ ...segment }));
  const portsFor = (fitting: typeof parsed.fittings[number]): NetworkPort[] => fitting.ports ?? fitting.segmentIds.flatMap((segmentId, index) => {
    const segment = segments.find((candidate) => candidate.id === segmentId);
    if (!segment) return [];
    const startDistance = Math.hypot(...segment.start.position.map((value, axis) => value - fitting.position.position[axis]));
    const point = startDistance < Math.hypot(...segment.end.position.map((value, axis) => value - fitting.position.position[axis])) ? segment.start : segment.end;
    const other = point === segment.start ? segment.end : segment.start;
    const length = Math.max(1e-9, Math.hypot(...other.position.map((value, axis) => value - point.position[axis])));
    const direction = other.position.map((value, axis) => (value - point.position[axis]) / length) as Vec3;
    return [{ id: `${fitting.id}:port:${index}`, position: point, direction, segmentId }];
  });
  const fittings = parsed.fittings.map((fitting) => ({ ...fitting, bendStyle: fitting.bendStyle ?? (fitting.fitting === "elbow" ? "right-angle" : undefined), ports: portsFor(fitting) }));
  for (const fitting of fittings) for (const port of fitting.ports) {
    const segment = segments.find((candidate) => candidate.id === port.segmentId);
    if (!segment) continue;
    const startDistance = Math.hypot(...segment.start.position.map((value, axis) => value - port.position.position[axis]));
    if (startDistance < Math.hypot(...segment.end.position.map((value, axis) => value - port.position.position[axis]))) segment.startPortId ??= port.id; else segment.endPortId ??= port.id;
  }
  return { ...parsed, schemaVersion: "1.1", segments, fittings, junctionBoxes: parsed.junctionBoxes ?? [], settings: { ...parsed.settings, visibleSystems: parsed.settings.visibleSystems ?? Object.fromEntries(SYSTEMS.map((system) => [system, true])) as Record<RoutingSystem, boolean>, bendRadiusMm: parsed.settings.bendRadiusMm ?? 200, stockLengthMm: parsed.settings.stockLengthMm ?? 4000, junctionBoxSizeMm: parsed.settings.junctionBoxSizeMm ?? [86, 86, 50] } };
}

/**
 * Checks sidecar references without mutating either document. Missing hosts do
 * not invalidate route coordinates, but callers must not recreate their cuts.
 */
export function assessOverlayHosts(overlay: ConduitOverlayDocument, hostIds: Iterable<string>): OverlayHostAssessment {
  const available = new Set(hostIds), referenced = new Set<string>();
  for (const segment of overlay.segments) for (const point of [segment.start, segment.end]) if (point.attachment) referenced.add(point.attachment.hostId);
  for (const chase of overlay.wallChases) referenced.add(chase.wallId);
  for (const penetration of overlay.penetrations) referenced.add(penetration.hostId);
  for (const box of overlay.junctionBoxes) if (box.position.attachment) referenced.add(box.position.attachment.hostId);
  const referencedHostIds = [...referenced].sort();
  return { referencedHostIds, missingHostIds: referencedHostIds.filter((id) => !available.has(id)) };
}
