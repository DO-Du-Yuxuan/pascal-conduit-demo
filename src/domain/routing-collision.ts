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
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function closestSegmentPoints(first: Primitive, second: Primitive) {
  const u = subtract(first.b, first.a), v = subtract(second.b, second.a), w = subtract(first.a, second.a);
  const a = dot(u, u), b = dot(u, v), c = dot(v, v), d = dot(u, w), e = dot(v, w), denominator = a * c - b * b;
  let s = 0, t = 0;
  if (a < 1e-12) t = c < 1e-12 ? 0 : clamp(e / c);
  else if (c < 1e-12) s = clamp(-d / a);
  else {
    s = denominator > 1e-12 * a * c ? clamp((b * e - c * d) / denominator) : 0;
    t = (b * s + e) / c;
    // Re-solve on the finite obstacle endpoint only when its unbounded
    // parameter falls outside the segment. Updating s while retaining an old
    // interior t produces an approximate, sometimes too-large distance.
    if (t < 0) { t = 0; s = clamp(-d / a); }
    else if (t > 1) { t = 1; s = clamp((b - d) / a); }
  }
  const p = add(first.a, scale(u, s)), q = add(second.a, scale(v, t));
  return { distance: length(subtract(p, q)), point: scale(add(p, q), .5) as Vec3, firstPoint: p, secondPoint: q };
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
const segmentLength = (segment: RouteSegment) => length(subtract(segment.end.position, segment.start.position));

type BridgeCrossing = { obstacleId: string; obstaclePrimitive: Primitive; segmentId?: string; fittingId?: string; relatedSegmentIds?: string[]; along: number; rise: number; topHalf: number; spanStart: number; spanEnd: number; lift: Vec3; target: number; separation: number; sine: number };
type RouteRun = { segments: RouteSegment[]; start: Vec3; end: Vec3; direction: Vec3; length: number };

const pointOnRun = (run: RouteRun, along: number): Vec3 => add(run.start, scale(run.direction, along));
function routeRuns(plan: PlannedRoute): RouteRun[] {
  const runs: RouteRun[] = [];
  for (let index = 0; index < plan.segments.length;) {
    const first = plan.segments[index]!;
    if (!electrical(first.system)) { index += 1; continue; }
    const segments = [first];
    let cursor = index;
    while (cursor + 1 < plan.segments.length) {
      const current = segments[segments.length - 1]!, next = plan.segments[cursor + 1]!;
      const a = normalize(subtract(current.end.position, current.start.position)), b = normalize(subtract(next.end.position, next.start.position));
      const hasBlockingFitting = plan.fittings.some((fitting) => fitting.fitting !== "coupling" && fitting.segmentIds.includes(current.id) && fitting.segmentIds.includes(next.id));
      if (!samePoint(current.end.position, next.start.position) || dot(a, b) < 1 - 1e-8 || current.system !== next.system || current.diameterMm !== next.diameterMm || hasBlockingFitting) break;
      // Route points can divide a straight leg without a fitting; stock joints
      // are explicitly connected with a coupling. Both are safe to coalesce.
      segments.push(next); cursor += 1;
    }
    const start = first.start.position, last = segments[segments.length - 1]!, end = last.end.position, span = subtract(end, start), size = length(span);
    if (size > 1e-9) runs.push({ segments, start, end, direction: scale(span, 1 / size), length: size });
    index = cursor + 1;
  }
  return runs;
}

function preferredLift(run: RouteRun, obstacleNormal?: Vec3): Vec3 | null {
  const first = run.segments[0]!;
  const attachmentNormal = first.start.attachment?.normal ?? first.end.attachment?.normal ?? obstacleNormal;
  const direction = run.direction;
  let reference = attachmentNormal && length(attachmentNormal) > 1e-8 ? attachmentNormal : [0, 1, 0] as Vec3;
  // A route on a vertical host still needs an out-of-plane bridge. World up
  // supplies that direction when the host normal is parallel to the route.
  reference = subtract(reference, scale(direction, dot(reference, direction)));
  if (length(reference) < 1e-7) reference = subtract([0, 1, 0], scale(direction, direction[1]));
  return length(reference) < 1e-7 ? null : normalize(reference);
}

function minimumRampDistance(rampRise: number, topHalf: number, sine: number, baseOffset: number) {
  const start: [number, number] = [(topHalf + rampRise) * sine, baseOffset];
  const end: [number, number] = [topHalf * sine, baseOffset + rampRise];
  const dx = end[0] - start[0], dy = end[1] - start[1], denominator = dx * dx + dy * dy;
  const t = denominator < 1e-12 ? 0 : clamp(-(start[0] * dx + start[1] * dy) / denominator);
  return Math.hypot(start[0] + dx * t, start[1] + dy * t);
}

function topHalfForClearance(rampRise: number, target: number, sine: number, baseOffset: number) {
  let low = 0, high = Math.max(target, rampRise, .001);
  for (let index = 0; index < 32 && minimumRampDistance(rampRise, high, sine, baseOffset) < target - 1e-9; index += 1) high = high * 2 + .001;
  if (!Number.isFinite(high) || minimumRampDistance(rampRise, high, sine, baseOffset) < target - 1e-8) return Number.POSITIVE_INFINITY;
  for (let index = 0; index < 32; index += 1) {
    const middle = (low + high) / 2;
    if (minimumRampDistance(rampRise, middle, sine, baseOffset) >= target - 1e-9) high = middle;
    else low = middle;
  }
  // Leave 0.2mm for segment clipping and saved-coordinate roundoff so the
  // rendered three-piece bridge never falls just below its 10mm target.
  return high + .0002;
}

function pointAtPosition(source: RoutePoint, position: Vec3): RoutePoint {
  const attachment = source.attachment ? structuredClone(source.attachment) : undefined;
  if (attachment && length(attachment.normal) > 1e-8 && Math.abs(dot(subtract(position, source.position), normalize(attachment.normal))) > .001) return { position: [...position] as Vec3 };
  if (attachment?.localPosition && attachment.basis) {
    const delta = subtract(position, source.position);
    attachment.localPosition = [attachment.localPosition[0] + dot(delta, attachment.basis.u), attachment.localPosition[1], attachment.localPosition[2] + dot(delta, attachment.basis.v)];
  }
  return { position: [...position] as Vec3, ...(attachment ? { attachment } : {}) };
}

function segmentPart(segment: RouteSegment, id: string, start: Vec3, end: Vec3, preserveStart: boolean, preserveEnd: boolean): RouteSegment | null {
  if (length(subtract(end, start)) < 1e-7) return null;
  return { ...segment, id, start: preserveStart ? clonePoint(segment.start) : pointAtPosition(segment.start, start), end: preserveEnd ? clonePoint(segment.end) : pointAtPosition(segment.end, end), ...(preserveStart ? {} : { startPortId: undefined }), ...(preserveEnd ? {} : { endPortId: undefined }) };
}

/**
 * Makes one bridge over a group of real 3D clashes. Collinear planned pieces
 * form a run so the bridge may span a stock coupling without moving any
 * already committed route.
 */
function bridgeCandidate(overlay: ConduitOverlayDocument, plan: PlannedRoute, ignoredSegmentId?: string, ignoredObjectIds: ReadonlySet<string> = new Set()): PlannedRoute | null {
  for (const run of routeRuns(plan)) {
    const system = run.segments[0]!.system, diameterMm = run.segments[0]!.diameterMm;
    const crossings: BridgeCrossing[] = [];
    const addObstacleCrossings = (obstacle: Primitive, obstacleSystem: RouteSegment["system"], obstacleNormal?: Vec3, fittingId?: string, relatedSegmentIds?: string[]) => {
      if (!electrical(obstacleSystem) || ignoredObjectIds.has(obstacle.id) || ignoredSegmentId !== undefined && (obstacle.segmentId === ignoredSegmentId || obstacle.relatedSegmentIds?.includes(ignoredSegmentId))) return;
      const obstacleVector = subtract(obstacle.b, obstacle.a), obstacleLength = length(obstacleVector);
      if (obstacleLength < 1e-8) return;
      const obstacleDirection = scale(obstacleVector, 1 / obstacleLength), crossDirection = cross(run.direction, obstacleDirection), sine = length(crossDirection);
      // True parallelism has no crossing plane to bridge. Shallow but real
      // crossings remain eligible and receive a wider ramp below.
      if (sine < 1e-7) return;
      const hit = closestSegmentPoints({ id: run.segments[0]!.id, a: run.start, b: run.end, radius: diameterMm / 2000 }, obstacle);
      const clearance = .01, newRadius = diameterMm / 2000, target = newRadius + obstacle.radius + clearance;
      if (hit.distance > newRadius + obstacle.radius + .001) return;
      let along = dot(subtract(hit.firstPoint, run.start), run.direction);
      if (along < -newRadius || along > run.length + newRadius) return;
      along = clamp(along / run.length) * run.length;
      const normal = scale(crossDirection, 1 / sine), reference = preferredLift(run, obstacleNormal);
      if (!reference) return;
      let lift = dot(normal, reference) < 0 ? scale(normal, -1) : normal;
      const routeAttachment = run.segments[0]!.start.attachment ?? run.segments[0]!.end.attachment;
      const validLiftNormal = (value?: Vec3) => Boolean(value && length(value) > 1e-8 && length(subtract(value, scale(run.direction, dot(value, run.direction))) ) > 1e-7);
      const obstacleHasHostNormal = validLiftNormal(obstacleNormal);
      const routeHasHostNormal = Boolean(routeAttachment?.hostId && validLiftNormal(routeAttachment.normal));
      const hasHostNormal = routeHasHostNormal || obstacleHasHostNormal;
      const initialSeparation = dot(subtract(hit.firstPoint, hit.secondPoint), lift);
      if (!hasHostNormal && initialSeparation < 0) lift = scale(lift, -1);
      const signedSeparation = dot(subtract(hit.firstPoint, hit.secondPoint), lift);
      const rise = Math.max(.001, target - signedSeparation);
      const topHalf = topHalfForClearance(rise, target, sine, signedSeparation);
      if (!Number.isFinite(topHalf)) return;
      const halfSpan = rise + topHalf;
      if (along < halfSpan + .001 || run.length - along < halfSpan + .001) return;
      crossings.push({ obstacleId: obstacle.id, obstaclePrimitive: obstacle, segmentId: obstacle.segmentId, fittingId, relatedSegmentIds, along, rise, topHalf, spanStart: along - halfSpan, spanEnd: along + halfSpan, lift, target, separation: signedSeparation, sine });
    };
    const runSegmentIds = new Set(run.segments.map((segment) => segment.id));
    for (const obstacle of overlay.segments) {
      if (runSegmentIds.has(obstacle.id)) continue;
      addObstacleCrossings(segmentPrimitive(obstacle), obstacle.system, obstacle.start.attachment?.normal);
    }
    for (const fitting of overlay.fittings) if ((fitting.arc || fitting.bridge) && electrical(fitting.system) && !ignoredObjectIds.has(fitting.id) && !fitting.segmentIds.includes(ignoredSegmentId ?? "")) {
      const points = fitting.bridge ? [fitting.bridge.entry, fitting.bridge.crestStart, fitting.bridge.crestEnd, fitting.bridge.exit] : arcPoints(fitting.arc!, Math.PI / 90);
      for (let index = 0; index < points.length - 1; index += 1) {
        addObstacleCrossings({ id: fitting.id, a: points[index]!, b: points[index + 1]!, radius: fitting.diameterMm / 2000, relatedSegmentIds: fitting.segmentIds }, fitting.system, fitting.position.attachment?.normal, fitting.id, fitting.segmentIds);
      }
    }
    crossings.sort((left, right) => left.spanStart - right.spanStart || left.spanEnd - right.spanEnd || left.obstacleId.localeCompare(right.obstacleId));
    const first = crossings[0];
    if (!first) continue;
    const group = [first]; let groupEnd = first.spanEnd, groupRise = first.rise;
    for (const crossing of crossings.slice(1)) {
      if (crossing.spanStart > groupEnd + 1e-7) break;
      if (dot(first.lift, crossing.lift) < .999) continue;
      group.push(crossing);
      groupRise = Math.max(groupRise, crossing.rise);
      const halfSpan = Math.max(...group.map((item) => item.along + topHalfForClearance(groupRise, item.target, item.sine, item.separation)));
      const startSpan = Math.min(...group.map((item) => item.along - topHalfForClearance(groupRise, item.target, item.sine, item.separation)));
      groupEnd = Math.max(groupEnd, halfSpan + groupRise);
      if (Number.isFinite(startSpan)) group[0]!.spanStart = Math.min(group[0]!.spanStart, startSpan - groupRise);
    }
    const lift = first.lift, rise = groupRise;
    const crestStartAlong = Math.min(...group.map((item) => item.along - topHalfForClearance(rise, item.target, item.sine, item.separation)));
    const crestEndAlong = Math.max(...group.map((item) => item.along + topHalfForClearance(rise, item.target, item.sine, item.separation)));
    const entryAlong = crestStartAlong - rise, exitAlong = crestEndAlong + rise;
    if (entryAlong < .001 || run.length - exitAlong < .001) continue;
    const penetrationsConflict = plan.penetrations.some((penetration) => {
      if (!run.segments.some((segment) => segment.id === penetration.segmentId)) return false;
      const first = dot(subtract(penetration.entry.position, run.start), run.direction), second = dot(subtract(penetration.exit.position, run.start), run.direction);
      return Math.min(first, second) < exitAlong - 1e-7 && Math.max(first, second) > entryAlong + 1e-7;
    });
    if (penetrationsConflict) continue;
    const entry = pointOnRun(run, entryAlong), crestStart = add(pointOnRun(run, crestStartAlong), scale(lift, rise)), crestEnd = add(pointOnRun(run, crestEndAlong), scale(lift, rise)), exit = pointOnRun(run, exitAlong);
    const bridgePrimitives: Primitive[] = [[entry, crestStart], [crestStart, crestEnd], [crestEnd, exit]].map(([a, b], index) => ({ id: `bridge-clearance:${index}`, a: a!, b: b!, radius: diameterMm / 2000 }));
    const bridgeClearanceValid = bridgePrimitives.every((candidate) => crossings.every((crossing) => closestSegmentPoints(candidate, crossing.obstaclePrimitive).distance >= candidate.radius + crossing.obstaclePrimitive.radius + .01 - 1e-6));
    if (!bridgeClearanceValid) continue;
    const bridgeId = `${run.segments[0]!.id}:bridge:${crypto.randomUUID()}`;
    const compatibilitySegmentId = group.find((item) => item.segmentId)?.segmentId ?? group.flatMap((item) => item.relatedSegmentIds ?? [])[0];
    if (!compatibilitySegmentId) continue;

    const mapped: Array<{ oldId: string; segment: RouteSegment; min: number; max: number }> = [];
    const replacements = new Map<string, RouteSegment[]>();
    for (const segment of run.segments) {
      const localStart = dot(subtract(segment.start.position, run.start), run.direction), localEnd = dot(subtract(segment.end.position, run.start), run.direction);
      const pieces: RouteSegment[] = [];
      if (localStart < entryAlong - 1e-7) {
        const endAlong = Math.min(localEnd, entryAlong), endPoint = pointOnRun(run, endAlong);
        const piece = segmentPart(segment, segment.id, segment.start.position, endPoint, true, endAlong >= localEnd - 1e-7);
        if (piece) { pieces.push(piece); mapped.push({ oldId: segment.id, segment: piece, min: localStart, max: endAlong }); }
      }
      if (localEnd > exitAlong + 1e-7) {
        const startAlong = Math.max(localStart, exitAlong), startPoint = pointOnRun(run, startAlong);
        const id = pieces.length ? `${segment.id}:bridge-after` : segment.id;
        const piece = segmentPart(segment, id, startPoint, segment.end.position, startAlong <= localStart + 1e-7, true);
        if (piece) { pieces.push(piece); mapped.push({ oldId: segment.id, segment: piece, min: startAlong, max: localEnd }); }
      }
      replacements.set(segment.id, pieces);
    }
    const mappedPenetrations: PlannedRoute["penetrations"] = [];
    let penetrationMappingFailed = false;
    for (const penetration of plan.penetrations) {
      if (!runSegmentIds.has(penetration.segmentId)) { mappedPenetrations.push(penetration); continue; }
      const fits = mapped.filter((item) => item.oldId === penetration.segmentId && [penetration.entry.position, penetration.exit.position].every((position) => {
        const along = dot(subtract(position, run.start), run.direction);
        return along >= item.min - 1e-6 && along <= item.max + 1e-6 && length(subtract(position, pointOnRun(run, along))) < .002;
      }));
      if (fits.length !== 1) { penetrationMappingFailed = true; break; }
      mappedPenetrations.push({ ...penetration, segmentId: fits[0]!.segment.id });
    }
    if (penetrationMappingFailed) continue;
    const before = mapped.find((item) => Math.abs(item.max - entryAlong) < 1e-6)?.segment;
    const after = mapped.find((item) => Math.abs(item.min - exitAlong) < 1e-6)?.segment;
    if (!before || !after) continue;
    const direction = run.direction, bridgePorts: NetworkPort[] = [
      { id: `${bridgeId}:port:0`, owner: { kind: "fitting", id: bridgeId }, position: clonePoint(before.end), direction: scale(direction, -1), role: "bidirectional", system, connectedSegmentIds: [before.id], segmentId: before.id },
      { id: `${bridgeId}:port:1`, owner: { kind: "fitting", id: bridgeId }, position: clonePoint(after.start), direction, role: "bidirectional", system, connectedSegmentIds: [after.id], segmentId: after.id },
    ];
    before.endPortId = bridgePorts[0]!.id; after.startPortId = bridgePorts[1]!.id;
    const obstacleSegmentIds = [...new Set(group.flatMap((item) => item.segmentId ? [item.segmentId] : []))];
    const obstacleFittingIds = [...new Set(group.flatMap((item) => item.fittingId ? [item.fittingId] : []))];
    const centerAlong = group.reduce((sum, item) => sum + item.along, 0) / group.length, center = pointOnRun(run, centerAlong);
    const centerSegment = run.segments.find((segment) => {
      const startAlong = dot(subtract(segment.start.position, run.start), run.direction), endAlong = dot(subtract(segment.end.position, run.start), run.direction);
      return centerAlong >= startAlong - 1e-7 && centerAlong <= endAlong + 1e-7;
    }) ?? run.segments[0]!;
    const fitting: RouteFitting = { id: bridgeId, type: "conduit-fitting", fitting: "bridge-bend", bendStyle: "sweep", radiusMm: DEFAULT_BEND_RADIUS_MM, system, diameterMm, position: pointAtPosition(centerSegment.start, center), segmentIds: [before.id, after.id], ports: bridgePorts, bridge: { obstacleSegmentId: compatibilitySegmentId, obstacleSegmentIds, ...(obstacleFittingIds.length ? { obstacleFittingIds } : {}), entry, crestStart, crestEnd, exit, riseMm: rise * 1000, clearanceMm: 10 } };

    const pointDistance = (a: Vec3, b: Vec3) => length(subtract(a, b));
    const remapId = (oldId: string, position: Vec3) => {
      const candidates = mapped.filter((item) => item.oldId === oldId);
      if (!candidates.length) return undefined;
      return candidates.reduce((best, item) => Math.min(pointDistance(position, item.segment.start.position), pointDistance(position, item.segment.end.position)) < Math.min(pointDistance(position, best.segment.start.position), pointDistance(position, best.segment.end.position)) ? item : best).segment.id;
    };
    const removeCouplings = new Set(plan.fittings.filter((item) => item.fitting === "coupling" && item.segmentIds.filter((id) => runSegmentIds.has(id)).length === 2 && dot(subtract(item.position.position, run.start), direction) > entryAlong - 1e-7 && dot(subtract(item.position.position, run.start), direction) < exitAlong + 1e-7).map((item) => item.id));
    const fittings = plan.fittings.filter((item) => !removeCouplings.has(item.id)).map((item) => {
      if (!item.segmentIds.some((id) => runSegmentIds.has(id))) return item;
      const ports = item.ports.map((port) => {
        if (!port.segmentId || !runSegmentIds.has(port.segmentId)) return port;
        const nextId = remapId(port.segmentId, port.position.position);
        return nextId ? { ...port, segmentId: nextId, connectedSegmentIds: port.connectedSegmentIds.map((id) => id === port.segmentId ? nextId : id) } : port;
      });
      const segmentIds = item.segmentIds.flatMap((id) => {
        if (!runSegmentIds.has(id)) return [id];
        const replacement = [...new Set(ports.filter((port) => port.segmentId && (port.connectedSegmentIds.includes(id) || mapped.some((entry) => entry.oldId === id && entry.segment.id === port.segmentId))).map((port) => port.segmentId!))];
        return replacement.length ? replacement : (replacements.get(id) ?? []).map((segment) => segment.id);
      });
      return { ...item, ports, segmentIds: [...new Set(segmentIds)] };
    });
    const runChases = plan.surfaceChases.filter((chase) => runSegmentIds.has(chase.routeElementId) && chase.path.kind === "line");
    const surfaceChases = plan.surfaceChases.filter((chase) => !runSegmentIds.has(chase.routeElementId));
    for (const item of mapped) {
      const templates = runChases.filter((chase) => chase.routeElementId === item.oldId);
      for (const chase of templates) {
        surfaceChases.push({ ...chase, id: `${chase.id}:bridge:${item.segment.id}`, routeElementId: item.segment.id, path: { kind: "line", start: clonePoint(item.segment.start), end: clonePoint(item.segment.end) } });
      }
    }
    return {
      ...plan,
      segments: plan.segments.flatMap((segment) => replacements.has(segment.id) ? replacements.get(segment.id)! : [segment]),
      fittings: [...fittings, fitting], surfaceChases, penetrations: mappedPenetrations,
    };
  }
  return null;
}

function clonePoint(point: RoutePoint): RoutePoint { return { position: [...point.position] as Vec3, attachment: point.attachment ? structuredClone(point.attachment) : undefined }; }

export function withCollisionDiagnostics(overlay: ConduitOverlayDocument, plan: PlannedRoute, ignoredSegmentId?: string, ignoredObjectIds?: ReadonlySet<string>, allowedEndpointContact?: AllowedEndpointContact, slabContext?: BridgeSlabContext): PlannedRoute {
  let bridged = plan;
  const obstacleCount = overlay.segments.length + overlay.fittings.reduce((sum, fitting) => sum + (fitting.arc ? Math.ceil(Math.abs(fitting.arc.sweepRadians) / (Math.PI / 90)) : 1), 0);
  const progressLimit = Math.max(1, (plan.segments.length + 1) * (obstacleCount + 1));
  const bridgeSignatures = new Set<string>();
  for (let iteration = 0; iteration < progressLimit; iteration += 1) {
    const next = bridgeCandidate(overlay, bridged, ignoredSegmentId, ignoredObjectIds);
    if (!next) break;
    const added = next.fittings.find((fitting) => fitting.fitting === "bridge-bend" && !bridged.fittings.some((current) => current.id === fitting.id));
    if (!added?.bridge) break;
    const signature = `${added.bridge.obstacleSegmentId}:${added.bridge.entry.join(",")}:${added.bridge.exit.join(",")}`;
    if (bridgeSignatures.has(signature)) break;
    bridgeSignatures.add(signature);
    bridged = next;
  }
  const diagnostics = validatePlannedRoute(overlay, bridged, ignoredSegmentId, ignoredObjectIds, allowedEndpointContact);
  return { ...bridged, diagnostics, canCommit: diagnostics.length === 0 };
}
