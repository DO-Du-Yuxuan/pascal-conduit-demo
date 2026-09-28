import { DEFAULT_BEND_RADIUS_MM, type BendArc, type ConduitOverlayDocument, type NetworkPort, type RouteFitting, type RoutePoint, type RouteSegment, type Vec3 } from "./overlay";
import type { PlannedRoute, RouteDiagnostic } from "./routing";

type Primitive = { id: string; a: Vec3; b: Vec3; radius: number; segmentId?: string; relatedSegmentIds?: string[]; portIds?: string[] };
type OverlayCollisionIndex = { primitives: Primitive[]; candidatesFor: ReturnType<typeof spatialIndex> };
const overlayIndexCache = new WeakMap<ConduitOverlayDocument, OverlayCollisionIndex>();
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (v: Vec3, n: number): Vec3 => [v[0] * n, v[1] * n, v[2] * n];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (v: Vec3) => Math.hypot(...v);
const normalize = (v: Vec3): Vec3 => { const size = length(v); return size < 1e-9 ? [1, 0, 0] : scale(v, 1 / size); };
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function closestSegmentPoints(first: Primitive, second: Primitive) {
  const u = subtract(first.b, first.a), v = subtract(second.b, second.a), w = subtract(first.a, second.a);
  const a = dot(u, u), b = dot(u, v), c = dot(v, v), d = dot(u, w), e = dot(v, w), denominator = a * c - b * b;
  let s = denominator < 1e-10 ? 0 : clamp((b * e - c * d) / denominator);
  let t = c < 1e-10 ? 0 : clamp((b * s + e) / c);
  s = a < 1e-10 ? 0 : clamp((b * t - d) / a);
  const p = add(first.a, scale(u, s)), q = add(second.a, scale(v, t));
  return { distance: length(subtract(p, q)), point: scale(add(p, q), .5) as Vec3 };
}

function arcPoints(arc: BendArc, maxStep = Math.PI / 18) {
  const startVector = subtract(arc.start, arc.center), radius = length(startVector), normal = normalize(arc.normal), tangent = normalize([
    normal[1] * startVector[2] - normal[2] * startVector[1],
    normal[2] * startVector[0] - normal[0] * startVector[2],
    normal[0] * startVector[1] - normal[1] * startVector[0],
  ]);
  const steps = Math.max(6, Math.ceil(Math.abs(arc.sweepRadians) / maxStep));
  return Array.from({ length: steps + 1 }, (_, index): Vec3 => {
    const angle = arc.sweepRadians * index / steps;
    return add(arc.center, add(scale(startVector, Math.cos(angle)), scale(tangent, radius * Math.sin(angle))));
  });
}

function segmentPrimitive(segment: RouteSegment): Primitive {
  return { id: segment.id, segmentId: segment.id, a: segment.start.position, b: segment.end.position, radius: segment.diameterMm / 2000, portIds: [segment.startPortId, segment.endPortId].filter((value): value is string => Boolean(value)) };
}
const samePoint = (a: Vec3, b: Vec3) => length(subtract(a, b)) < 1e-7;
const shareEndpoint = (a: Primitive, b: Primitive) => samePoint(a.a, b.a) || samePoint(a.a, b.b) || samePoint(a.b, b.a) || samePoint(a.b, b.b);

function primitivesForPlan(plan: PlannedRoute): Primitive[] {
  const result = plan.segments.map(segmentPrimitive);
  for (const fitting of plan.fittings) {
    if (fitting.arc) {
      const points = arcPoints(fitting.arc);
      for (let index = 0; index < points.length - 1; index += 1) result.push({ id: fitting.id, a: points[index], b: points[index + 1], radius: fitting.diameterMm / 2000, relatedSegmentIds: fitting.segmentIds });
    } else if (fitting.bridge) {
      const points = [fitting.bridge.entry, fitting.bridge.crestStart, fitting.bridge.crestEnd, fitting.bridge.exit];
      for (let index = 0; index < points.length - 1; index += 1) result.push({ id: fitting.id, a: points[index], b: points[index + 1], radius: fitting.diameterMm / 2000, relatedSegmentIds: fitting.segmentIds });
    } else result.push({ id: fitting.id, a: fitting.position.position, b: fitting.position.position, radius: fitting.diameterMm / 1800, relatedSegmentIds: fitting.segmentIds });
  }
  return result;
}

function primitivesForOverlay(overlay: ConduitOverlayDocument, ignoredSegmentId?: string): Primitive[] {
  const result = overlay.segments.filter((segment) => segment.id !== ignoredSegmentId).map(segmentPrimitive);
  for (const route of overlay.hvac.controlConduits ?? []) for (const [index, segmentId] of route.segmentIds.entries()) {
    const segment = overlay.hvac.controlSegments.find((item) => item.id === segmentId);
    if (!segment || segmentId === ignoredSegmentId) continue;
    result.push({ id: segment.id, segmentId: segment.id, a: segment.start.position, b: segment.end.position, radius: route.diameterMm / 2000, portIds: [index === 0 ? route.thermostatPortId : undefined, index === route.segmentIds.length - 1 ? route.indoorUnitPortId : undefined].filter((value): value is string => Boolean(value)) });
  }
  for (const fitting of overlay.hvac.controlFittings ?? []) if (!fitting.segmentIds.some((id) => id === ignoredSegmentId)) {
    if (fitting.arc) {
      const points = arcPoints(fitting.arc);
      for (let index = 0; index < points.length - 1; index += 1) result.push({ id: fitting.id, a: points[index], b: points[index + 1], radius: fitting.diameterMm / 2000, relatedSegmentIds: fitting.segmentIds });
    } else if (fitting.bridge) {
      const points = [fitting.bridge.entry, fitting.bridge.crestStart, fitting.bridge.crestEnd, fitting.bridge.exit];
      for (let index = 0; index < points.length - 1; index += 1) result.push({ id: fitting.id, a: points[index], b: points[index + 1], radius: fitting.diameterMm / 2000, relatedSegmentIds: fitting.segmentIds });
    } else result.push({ id: fitting.id, a: fitting.position.position, b: fitting.position.position, radius: fitting.diameterMm / 1800, relatedSegmentIds: fitting.segmentIds });
  }
  for (const fitting of overlay.fittings) if (!fitting.segmentIds.includes(ignoredSegmentId ?? "")) {
    if (fitting.arc) {
      const points = arcPoints(fitting.arc);
      for (let index = 0; index < points.length - 1; index += 1) result.push({ id: fitting.id, a: points[index], b: points[index + 1], radius: fitting.diameterMm / 2000, relatedSegmentIds: fitting.segmentIds });
    } else if (fitting.bridge) {
      const points = [fitting.bridge.entry, fitting.bridge.crestStart, fitting.bridge.crestEnd, fitting.bridge.exit];
      for (let index = 0; index < points.length - 1; index += 1) result.push({ id: fitting.id, a: points[index], b: points[index + 1], radius: fitting.diameterMm / 2000, relatedSegmentIds: fitting.segmentIds });
    } else result.push({ id: fitting.id, a: fitting.position.position, b: fitting.position.position, radius: fitting.diameterMm / 1800, relatedSegmentIds: fitting.segmentIds });
  }
  for (const box of overlay.junctionBoxes) if (!box.segmentIds.includes(ignoredSegmentId ?? "")) result.push({ id: box.id, a: box.position.position, b: box.position.position, radius: Math.hypot(...box.sizeMm) / 2000, relatedSegmentIds: box.segmentIds });
  for (const device of overlay.devices) {
    const relatedSegmentIds = device.ports.flatMap((port) => port.connectedSegmentIds);
    if (!relatedSegmentIds.includes(ignoredSegmentId ?? "")) result.push({ id: device.id, a: device.position.position, b: device.position.position, radius: Math.hypot(...device.sizeMm) / 2000, relatedSegmentIds });
  }
  return result;
}

function collisionIndexFor(overlay: ConduitOverlayDocument): OverlayCollisionIndex {
  const cached = overlayIndexCache.get(overlay);
  if (cached) return cached;
  const primitives = primitivesForOverlay(overlay), result = { primitives, candidatesFor: spatialIndex(primitives) };
  overlayIndexCache.set(overlay, result);
  return result;
}

function primitiveBounds(value: Primitive) {
  return { minX: Math.min(value.a[0], value.b[0]) - value.radius, maxX: Math.max(value.a[0], value.b[0]) + value.radius, minY: Math.min(value.a[1], value.b[1]) - value.radius, maxY: Math.max(value.a[1], value.b[1]) + value.radius, minZ: Math.min(value.a[2], value.b[2]) - value.radius, maxZ: Math.max(value.a[2], value.b[2]) + value.radius };
}
const cellKey = (x: number, y: number, z: number) => `${x}:${y}:${z}`;
function spatialIndex(primitives: Primitive[], cellSize = 1) {
  const cells = new Map<string, Primitive[]>();
  for (const primitive of primitives) {
    const bounds = primitiveBounds(primitive);
    for (let x = Math.floor(bounds.minX / cellSize); x <= Math.floor(bounds.maxX / cellSize); x += 1) for (let y = Math.floor(bounds.minY / cellSize); y <= Math.floor(bounds.maxY / cellSize); y += 1) for (let z = Math.floor(bounds.minZ / cellSize); z <= Math.floor(bounds.maxZ / cellSize); z += 1) {
      const key = cellKey(x, y, z), values = cells.get(key) ?? []; values.push(primitive); cells.set(key, values);
    }
  }
  return (primitive: Primitive) => {
    const bounds = primitiveBounds(primitive), found = new Map<string, Primitive>();
    for (let x = Math.floor(bounds.minX / cellSize); x <= Math.floor(bounds.maxX / cellSize); x += 1) for (let y = Math.floor(bounds.minY / cellSize); y <= Math.floor(bounds.maxY / cellSize); y += 1) for (let z = Math.floor(bounds.minZ / cellSize); z <= Math.floor(bounds.maxZ / cellSize); z += 1) for (const value of cells.get(cellKey(x, y, z)) ?? []) found.set(`${value.id}:${value.a.join(",")}:${value.b.join(",")}`, value);
    return [...found.values()];
  };
}

/** Exact narrow phase over a lightweight primitive list; no meshes or CSG. */
export type AllowedEndpointContact = { segmentId: string; point: Vec3 };

export function validatePlannedRoute(overlay: ConduitOverlayDocument, plan: PlannedRoute, ignoredSegmentId?: string, ignoredObjectIds: ReadonlySet<string> = new Set(), allowedEndpointContact?: AllowedEndpointContact): RouteDiagnostic[] {
  const diagnostics = [...plan.diagnostics], proposed = primitivesForPlan(plan), { candidatesFor } = collisionIndexFor(overlay), tolerance = .001;
  const linked = new Set(plan.fittings.flatMap((fitting) => fitting.segmentIds.flatMap((first) => fitting.segmentIds.filter((second) => first < second).map((second) => `${first}|${second}`))));
  for (const candidate of proposed) for (const obstacle of candidatesFor(candidate)) {
    if (
      ignoredObjectIds.has(obstacle.id) ||
      (ignoredSegmentId !== undefined &&
        (obstacle.segmentId === ignoredSegmentId || obstacle.relatedSegmentIds?.includes(ignoredSegmentId)))
    ) continue;
    if (candidate.portIds?.some((id) => obstacle.portIds?.includes(id))) continue;
    const hit = closestSegmentPoints(candidate, obstacle);
    const allowed = allowedEndpointContact;
    const isAllowedEndpointContact = Boolean(allowed)
      && allowed!.segmentId === obstacle.segmentId
      && samePoint(hit.point, allowed!.point)
      && [candidate.a, candidate.b].some((point) => samePoint(point, allowed!.point))
      && [obstacle.a, obstacle.b].some((point) => samePoint(point, allowed!.point));
    if (isAllowedEndpointContact) continue;
    if (hit.distance < candidate.radius + obstacle.radius + tolerance) diagnostics.push({ code: "route_collision", message: `预览管线与 ${obstacle.id} 发生实体交叉。`, objectIds: [obstacle.id], point: hit.point });
  }
  for (let first = 0; first < proposed.length; first += 1) for (let second = first + 1; second < proposed.length; second += 1) {
    const a = proposed[first], b = proposed[second];
    if (a.id === b.id || shareEndpoint(a, b) && Boolean(a.relatedSegmentIds?.some((id) => b.relatedSegmentIds?.includes(id))) || a.segmentId && b.segmentId && shareEndpoint(a, b) || a.segmentId && b.relatedSegmentIds?.includes(a.segmentId) || b.segmentId && a.relatedSegmentIds?.includes(b.segmentId) || a.segmentId && b.segmentId && linked.has(a.segmentId < b.segmentId ? `${a.segmentId}|${b.segmentId}` : `${b.segmentId}|${a.segmentId}`)) continue;
    const hit = closestSegmentPoints(a, b);
    if (hit.distance < a.radius + b.radius + tolerance) diagnostics.push({ code: "self_collision", message: "当前草稿发生自交。", objectIds: [a.id, b.id], point: hit.point });
  }
  return diagnostics.filter((item, index, all) => index === all.findIndex((candidate) => candidate.code === item.code && candidate.objectIds?.join() === item.objectIds?.join()));
}

export function validateBranchCandidate(overlay: ConduitOverlayDocument, ignoredSegmentId: string, point: Vec3, radius: number): RouteDiagnostic[] {
  const candidate: Primitive = { id: "branch-node-preview", a: point, b: point, radius };
  return collisionIndexFor(overlay).primitives.filter((obstacle) => obstacle.segmentId !== ignoredSegmentId && !obstacle.relatedSegmentIds?.includes(ignoredSegmentId)).flatMap((obstacle) => {
    const hit = closestSegmentPoints(candidate, obstacle);
    return hit.distance < candidate.radius + obstacle.radius + .001 ? [{ code: "branch_clearance" as const, message: `分支节点与 ${obstacle.id} 空间冲突。`, objectIds: [obstacle.id], point: hit.point }] : [];
  });
}

const electrical = (system: RouteSegment["system"]) => system === "receptacle" || system === "lighting" || system === "network";
export type BridgeSlabContext = { levelId: string; slabs: readonly { id: string; parentId?: string; type?: string; elevation?: unknown; polygon?: unknown; holes?: unknown }[]; levelBaseY?: Readonly<Record<string, number>> };
const isGroundSegment = (segment: RouteSegment) => Boolean(segment.start.attachment && segment.end.attachment && segment.start.attachment.hostKind === "slab" && segment.end.attachment.hostKind === "slab" && segment.start.attachment.hostId === segment.end.attachment.hostId && segment.start.attachment.surface === "top" && segment.end.attachment.surface === "top");
const planar = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length < 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) return null;
  const result: [number, number] = [Number(value[0]), Number(value.length >= 3 ? value[2] : value[1])];
  return result.every(Number.isFinite) ? result : null;
};
const cross2 = (a: [number, number], b: [number, number]) => a[0] * b[1] - a[1] * b[0];
function pointInRing(point: [number, number], ring: [number, number][]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index]!, b = ring[previous]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function segmentDistanceXZ(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const route: [number, number] = [b[0] - a[0], b[1] - a[1]], edge: [number, number] = [d[0] - c[0], d[1] - c[1]], offset: [number, number] = [c[0] - a[0], c[1] - a[1]];
  const denominator = cross2(route, edge);
  if (Math.abs(denominator) > 1e-12) {
    const t = cross2(offset, edge) / denominator, u = cross2(offset, route) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  const distancePointToSegment = (point: [number, number], start: [number, number], end: [number, number]) => {
    const dx = end[0] - start[0], dz = end[1] - start[1], lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared < 1e-12 ? 0 : clamp(((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared);
    return Math.hypot(point[0] - start[0] - dx * t, point[1] - start[1] - dz * t);
  };
  return Math.min(distancePointToSegment(a, c, d), distancePointToSegment(b, c, d), distancePointToSegment(c, a, b), distancePointToSegment(d, a, b));
}
function coveredByRing(a: [number, number], b: [number, number], ring: [number, number][], radius: number) {
  if (ring.length < 3 || !pointInRing(a, ring) || !pointInRing(b, ring) || !pointInRing([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ring)) return false;
  for (let index = 0; index < ring.length; index += 1) {
    if (segmentDistanceXZ(a, b, ring[index]!, ring[(index + 1) % ring.length]!) < radius - 1e-7) return false;
  }
  return true;
}
function derivedSlabHost(segment: RouteSegment, context?: BridgeSlabContext, expectedLevelId?: string) {
  if (!context || Math.abs(segment.start.position[1] - segment.end.position[1]) > .001) return undefined;
  const a = planar(segment.start.position), b = planar(segment.end.position);
  if (!a || !b) return undefined;
  const radius = segment.diameterMm / 2000, explicitAttachments = [segment.start.attachment, segment.end.attachment].filter(Boolean);
  const candidates = context.slabs.filter((slab) => {
    const slabTopY = slab.parentId ? (context.levelBaseY?.[slab.parentId] ?? 0) + Number(slab.elevation) : Number.NaN;
    if (slab.type !== "slab" || !slab.parentId || (expectedLevelId && slab.parentId !== expectedLevelId) || !Number.isFinite(slab.elevation) || Math.abs(slabTopY - segment.start.position[1]) > .001) return false;
    if (explicitAttachments.some((attachment) => attachment!.hostKind !== "slab" || attachment!.surface !== "top" || attachment!.hostId !== slab.id || (attachment!.levelId && attachment!.levelId !== slab.parentId))) return false;
    const ring = Array.isArray(slab.polygon) ? slab.polygon.map(planar) : [];
    if (ring.length < 3 || ring.some((point) => !point) || !coveredByRing(a, b, ring as [number, number][], radius)) return false;
    const holes = slab.holes ?? [];
    if (!Array.isArray(holes)) return false;
    for (const rawHole of holes) {
      if (!Array.isArray(rawHole)) return false;
      const hole = rawHole.map(planar);
      if (hole.length < 3 || hole.some((point) => !point)) return false;
      const holeRing = hole as [number, number][];
      const midpoint: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (pointInRing(a, holeRing) || pointInRing(b, holeRing) || pointInRing(midpoint, holeRing) || holeRing.some((point, index) => segmentDistanceXZ(a, b, point, holeRing[(index + 1) % holeRing.length]!) < radius - 1e-7)) return false;
    }
    return true;
  });
  return candidates.length === 1 ? candidates[0]!.id : undefined;
}
function groundHostId(segment: RouteSegment, context?: BridgeSlabContext, expectedLevelId?: string) {
  if (!context) return isGroundSegment(segment) ? segment.start.attachment!.hostId : undefined;
  if (isGroundSegment(segment)) {
    const explicitHostId = segment.start.attachment!.hostId;
    const host = context.slabs.find((slab) => slab.id === explicitHostId);
    const hostPolygon = Array.isArray(host?.polygon) ? host.polygon.map(planar) : [];
    // Keep established explicit attachments usable if the scene omitted the
    // supporting slab geometry; strict checks apply whenever that evidence exists.
    if (!host || host.type !== "slab" || hostPolygon.length < 3 || hostPolygon.some((point) => !point) || !Number.isFinite(host.elevation)) return expectedLevelId && segment.start.attachment!.levelId !== expectedLevelId ? undefined : explicitHostId;
  }
  const hostId = derivedSlabHost(segment, context, expectedLevelId);
  return isGroundSegment(segment) && segment.start.attachment!.hostId !== hostId ? undefined : hostId;
}
function groundArcHostId(fitting: RouteFitting, context?: BridgeSlabContext, expectedLevelId?: string) {
  if (!fitting.arc || !electrical(fitting.system) || !context) return undefined;
  const points = arcPoints(fitting.arc, Math.PI / 90);
  if (points.some((point) => Math.abs(point[1] - points[0]![1]) > .001)) return undefined;
  let hostId: string | undefined;
  for (let index = 0; index < points.length - 1; index += 1) {
    const segment: RouteSegment = {
      id: `${fitting.id}:host-check:${index}`, type: "conduit-segment", system: fitting.system,
      diameterMm: fitting.diameterMm + 1,
      start: { position: points[index]!, ...(fitting.position.attachment ? { attachment: fitting.position.attachment } : {}) },
      end: { position: points[index + 1]!, ...(fitting.position.attachment ? { attachment: fitting.position.attachment } : {}) }, createdAt: "",
    };
    const pieceHost = groundHostId(segment, context, expectedLevelId);
    if (!pieceHost || hostId && pieceHost !== hostId) return undefined;
    hostId = pieceHost;
  }
  return hostId;
}
export function preserveSlabHostForWorldAxisPoint(start: RoutePoint, position: Vec3, axis: "x" | "y" | "z", diameterMm: number, context?: BridgeSlabContext): RoutePoint {
  const attachment = start.attachment;
  if (axis === "y" || !context || Math.abs(position[1] - start.position[1]) > .001) return { position };
  const candidate: RouteSegment = { id: "world-axis-slab-probe", type: "conduit-segment", system: "receptacle", diameterMm, start: { position }, end: { position }, createdAt: "" };
  const hostId = groundHostId(candidate, context, attachment?.levelId ?? context.levelId);
  if (!hostId) return { position };
  const slab = context.slabs.find((item) => item.id === hostId);
  if (!slab?.parentId) return { position };
  const reusingSlabAttachment = attachment?.hostKind === "slab" && attachment.hostId === hostId && attachment.surface === "top";
  const nextAttachment = reusingSlabAttachment
    ? structuredClone(attachment)
    : { hostId, hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as Vec3, levelId: slab.parentId, localPosition: [position[0], position[1] - (context.levelBaseY?.[slab.parentId] ?? 0), position[2]] as Vec3, basis: { u: [1, 0, 0] as Vec3, v: [0, 0, 1] as Vec3 } };
  if (reusingSlabAttachment && nextAttachment.localPosition && nextAttachment.basis) {
    const delta = subtract(position, start.position), alongU = dot(delta, nextAttachment.basis.u), alongV = dot(delta, nextAttachment.basis.v);
    nextAttachment.localPosition = [nextAttachment.localPosition[0] + alongU, nextAttachment.localPosition[1], nextAttachment.localPosition[2] + alongV];
  }
  return { position, attachment: nextAttachment };
}
const pointAt = (segment: RouteSegment, factor: number): RoutePoint => ({ position: add(segment.start.position, scale(subtract(segment.end.position, segment.start.position), factor)), attachment: segment.start.attachment ? structuredClone(segment.start.attachment) : undefined });
const segmentLength = (segment: RouteSegment) => length(subtract(segment.end.position, segment.start.position));

/** Replaces a newly planned straight floor crossing with a raised double-45 bridge. */
function bridgeCandidate(overlay: ConduitOverlayDocument, plan: PlannedRoute, slabContext?: BridgeSlabContext): PlannedRoute | null {
  for (const proposed of plan.segments) {
    if (!electrical(proposed.system) || !groundHostId(proposed, slabContext, slabContext?.levelId)) continue;
    const proposedHostId = groundHostId(proposed, slabContext, slabContext?.levelId);
    const direction = normalize(subtract(proposed.end.position, proposed.start.position)), proposedLength = segmentLength(proposed);
    const crossings: Array<{ obstacleId: string; segmentId?: string; fittingId?: string; relatedSegmentIds?: string[]; along: number; rise: number; topHalf: number; spanStart: number; spanEnd: number }> = [];
    const addObstacleCrossings = (obstacle: Primitive, obstacleSystem: RouteSegment["system"], obstacleHostId: string | undefined, fittingId?: string, relatedSegmentIds?: string[]) => {
      if (!electrical(obstacleSystem) || obstacleHostId !== proposedHostId) return;
      const obstacleDirection = normalize(subtract(obstacle.b, obstacle.a));
      if (Math.abs(dot(direction, obstacleDirection)) > .98) return;
      const first = segmentPrimitive(proposed), hit = closestSegmentPoints(first, obstacle);
      if (hit.distance > first.radius + obstacle.radius + .001) return;
      const along = dot(subtract(hit.point, proposed.start.position), direction), rise = first.radius + obstacle.radius + .01, topHalf = obstacle.radius + .01, halfSpan = rise + topHalf;
      // Keep the old single-obstacle profile, and merge only when its occupied
      // ramp/crest interval overlaps the next crossing's interval.
      if (along < halfSpan + .02 || proposedLength - along < halfSpan + .02) return;
      crossings.push({ obstacleId: obstacle.id, segmentId: obstacle.segmentId, fittingId, relatedSegmentIds, along, rise, topHalf, spanStart: along - halfSpan, spanEnd: along + halfSpan });
    };
    for (const obstacle of overlay.segments) {
      const obstacleHostId = groundHostId(obstacle, slabContext);
      addObstacleCrossings(segmentPrimitive(obstacle), obstacle.system, obstacleHostId, undefined, [obstacle.id]);
    }
    for (const fitting of overlay.fittings) {
      if (!fitting.arc) continue;
      const hostId = groundArcHostId(fitting, slabContext);
      if (!hostId) continue;
      const points = arcPoints(fitting.arc, Math.PI / 90);
      for (let index = 0; index < points.length - 1; index += 1) {
        addObstacleCrossings({ id: fitting.id, a: points[index]!, b: points[index + 1]!, radius: fitting.diameterMm / 2000, relatedSegmentIds: fitting.segmentIds }, fitting.system, hostId, fitting.id, fitting.segmentIds);
      }
    }
    crossings.sort((left, right) => left.spanStart - right.spanStart || left.spanEnd - right.spanEnd || left.obstacleId.localeCompare(right.obstacleId));
    const firstCrossing = crossings[0];
    if (!firstCrossing) continue;
    const group = [firstCrossing];
    let groupEnd = firstCrossing.spanEnd;
    for (const crossing of crossings.slice(1)) {
      if (crossing.spanStart > groupEnd + 1e-7) break;
      group.push(crossing);
      groupEnd = Math.max(groupEnd, crossing.spanEnd);
    }
    const rise = Math.max(...group.map((crossing) => crossing.rise));
    const crestStartAlong = Math.min(...group.map((crossing) => crossing.along - crossing.topHalf));
    const crestEndAlong = Math.max(...group.map((crossing) => crossing.along + crossing.topHalf));
    const entryAlong = crestStartAlong - rise, exitAlong = crestEndAlong + rise;
    if (entryAlong < .02 || proposedLength - exitAlong < .02) continue;
    const routePointAt = (along: number) => pointAt(proposed, along / proposedLength);
    const entry = routePointAt(entryAlong).position, crestStart = add(routePointAt(crestStartAlong).position, [0, rise, 0]), crestEnd = add(routePointAt(crestEndAlong).position, [0, rise, 0]), exit = routePointAt(exitAlong).position;
    const entryFactor = entryAlong / proposedLength, exitFactor = exitAlong / proposedLength;
    const hit = routePointAt(group.reduce((sum, crossing) => sum + crossing.along, 0) / group.length).position;
    const before: RouteSegment = { ...proposed, id: `${proposed.id}:bridge-a`, end: pointAt(proposed, entryFactor), endPortId: undefined }, after: RouteSegment = { ...proposed, id: `${proposed.id}:bridge-b`, start: pointAt(proposed, exitFactor), startPortId: undefined };
    const bridgeId = `${proposed.id}:bridge`, bridgePorts: NetworkPort[] = [
      { id: `${bridgeId}:port:0`, owner: { kind: "fitting", id: bridgeId }, position: clonePoint(before.end), direction: scale(direction, -1), role: "bidirectional", system: proposed.system, connectedSegmentIds: [before.id], segmentId: before.id },
      { id: `${bridgeId}:port:1`, owner: { kind: "fitting", id: bridgeId }, position: clonePoint(after.start), direction, role: "bidirectional", system: proposed.system, connectedSegmentIds: [after.id], segmentId: after.id },
    ];
    before.endPortId = bridgePorts[0].id; after.startPortId = bridgePorts[1].id;
    const obstacleSegmentIds = [...new Set(group.flatMap((crossing) => crossing.segmentId ? [crossing.segmentId] : []))];
    const obstacleFittingIds = [...new Set(group.flatMap((crossing) => crossing.fittingId ? [crossing.fittingId] : []))];
    // The legacy singular field is required by older Project 4.0 readers. For
    // an arc-only crossing, anchor it to an actual adjacent segment while the
    // new fitting ID records the precise obstacle.
    const compatibilitySegmentId = obstacleSegmentIds[0] ?? group.flatMap((crossing) => crossing.relatedSegmentIds ?? [])[0];
    if (!compatibilitySegmentId) continue;
    const fitting: RouteFitting = { id: bridgeId, type: "conduit-fitting", fitting: "bridge-bend", bendStyle: "sweep", radiusMm: DEFAULT_BEND_RADIUS_MM, system: proposed.system, diameterMm: proposed.diameterMm, position: { position: hit, attachment: proposed.start.attachment ? structuredClone(proposed.start.attachment) : undefined }, segmentIds: [before.id, after.id], ports: bridgePorts, bridge: { obstacleSegmentId: compatibilitySegmentId, obstacleSegmentIds, ...(obstacleFittingIds.length ? { obstacleFittingIds } : {}), entry, crestStart, crestEnd, exit, riseMm: rise * 1000, clearanceMm: 10 } };
    const replacementFor = (position: Vec3) => samePoint(position, proposed.start.position) ? before.id : after.id;
    const fittings = plan.fittings.map((item) => {
      if (!item.segmentIds.includes(proposed.id)) return item;
      const ports = item.ports.map((port) => port.segmentId !== proposed.id ? port : { ...port, segmentId: replacementFor(port.position.position), connectedSegmentIds: port.connectedSegmentIds.map((id) => id === proposed.id ? replacementFor(port.position.position) : id) });
      return { ...item, ports, segmentIds: item.segmentIds.flatMap((id) => id !== proposed.id ? [id] : [...new Set(ports.filter((port) => port.segmentId === before.id || port.segmentId === after.id).map((port) => port.segmentId!))]) };
    });
    const surfaceChases = plan.surfaceChases.flatMap((chase) => chase.routeElementId !== proposed.id || chase.path.kind !== "line" ? [chase] : [{ ...chase, id: `${chase.id}:bridge-a`, routeElementId: before.id, path: { kind: "line" as const, start: clonePoint(before.start), end: clonePoint(before.end) } }, { ...chase, id: `${chase.id}:bridge-b`, routeElementId: after.id, path: { kind: "line" as const, start: clonePoint(after.start), end: clonePoint(after.end) } }]);
    return { ...plan, segments: plan.segments.flatMap((segment) => segment.id === proposed.id ? [before, after] : [segment]), fittings: [...fittings, fitting], surfaceChases };
  }
  return null;
}

function clonePoint(point: RoutePoint): RoutePoint { return { position: [...point.position] as Vec3, attachment: point.attachment ? structuredClone(point.attachment) : undefined }; }

export function withCollisionDiagnostics(overlay: ConduitOverlayDocument, plan: PlannedRoute, ignoredSegmentId?: string, ignoredObjectIds?: ReadonlySet<string>, allowedEndpointContact?: AllowedEndpointContact, slabContext?: BridgeSlabContext): PlannedRoute {
  let bridged = plan, next = bridgeCandidate(overlay, bridged, slabContext), count = 0;
  while (next && count < 8) { bridged = next; next = bridgeCandidate(overlay, bridged, slabContext); count += 1; }
  const diagnostics = validatePlannedRoute(overlay, bridged, ignoredSegmentId, ignoredObjectIds, allowedEndpointContact);
  return { ...bridged, diagnostics, canCommit: diagnostics.length === 0 };
}
