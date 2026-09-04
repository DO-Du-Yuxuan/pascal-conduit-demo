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
export type RouteSegment = { id: string; type: "conduit-segment" | "sprinkler-segment"; system: RoutingSystem; diameterMm: number; start: RoutePoint; end: RoutePoint; createdAt: string };
export type RouteFitting = { id: string; type: "conduit-fitting" | "sprinkler-fitting"; fitting: "elbow" | "tee"; system: RoutingSystem; diameterMm: number; position: RoutePoint; segmentIds: string[] };
export type WallChase = { id: string; type: "wall-chase"; wallId: string; segmentId: string; start: RoutePoint; end: RoutePoint; widthMm: number; depthMm: number };
export type Penetration = { id: string; type: "penetration"; hostId: string; hostKind: HostKind; segmentId: string; point: RoutePoint; diameterMm: number };

export type ConduitOverlayDocument = {
  schemaVersion: "1.0";
  source: { fileName: string; sha256: string };
  settings: { colors: Record<RoutingSystem, string>; visibleSystems: Record<RoutingSystem, boolean> };
  segments: RouteSegment[];
  fittings: RouteFitting[];
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
const segmentSchema = z.object({ id: z.string(), type: z.enum(["conduit-segment", "sprinkler-segment"]), system: systemSchema, diameterMm: z.number().positive(), start: pointSchema, end: pointSchema, createdAt: z.string() });
const fittingSchema = z.object({ id: z.string(), type: z.enum(["conduit-fitting", "sprinkler-fitting"]), fitting: z.enum(["elbow", "tee"]), system: systemSchema, diameterMm: z.number().positive(), position: pointSchema, segmentIds: z.array(z.string()) });
const wallChaseSchema = z.object({ id: z.string(), type: z.literal("wall-chase"), wallId: z.string(), segmentId: z.string(), start: pointSchema, end: pointSchema, widthMm: z.number().positive(), depthMm: z.number().positive() });
const penetrationSchema = z.object({ id: z.string(), type: z.literal("penetration"), hostId: z.string(), hostKind: z.enum(["wall", "slab", "ceiling"]), segmentId: z.string(), point: pointSchema, diameterMm: z.number().positive() });
const overlaySchema = z.object({ schemaVersion: z.literal("1.0"), source: z.object({ fileName: z.string(), sha256: z.string() }), settings: z.object({ colors: z.record(systemSchema, z.string()), visibleSystems: z.record(systemSchema, z.boolean()).optional() }), segments: z.array(segmentSchema), fittings: z.array(fittingSchema), wallChases: z.array(wallChaseSchema), penetrations: z.array(penetrationSchema) });

export function createEmptyOverlay(fileName: string, sha256: string): ConduitOverlayDocument {
  return { schemaVersion: "1.0", source: { fileName, sha256 }, settings: { colors: Object.fromEntries(SYSTEMS.map((system) => [system, SYSTEM_DEFAULTS[system].color])) as Record<RoutingSystem, string>, visibleSystems: Object.fromEntries(SYSTEMS.map((system) => [system, true])) as Record<RoutingSystem, boolean> }, segments: [], fittings: [], wallChases: [], penetrations: [] };
}

export function parseOverlay(raw: unknown): ConduitOverlayDocument {
  const parsed = overlaySchema.parse(raw);
  return { ...parsed, settings: { ...parsed.settings, visibleSystems: parsed.settings.visibleSystems ?? Object.fromEntries(SYSTEMS.map((system) => [system, true])) as Record<RoutingSystem, boolean> } };
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
  const referencedHostIds = [...referenced].sort();
  return { referencedHostIds, missingHostIds: referencedHostIds.filter((id) => !available.has(id)) };
}
