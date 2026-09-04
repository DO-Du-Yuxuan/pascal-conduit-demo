import type { BendArc, ConduitOverlayDocument, RouteSegment, Vec3 } from "./overlay";
import type { PlannedRoute, RouteDiagnostic } from "./routing";

type Primitive = { id: string; a: Vec3; b: Vec3; radius: number; segmentId?: string; relatedSegmentIds?: string[]; portIds?: string[] };
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

function arcPoints(arc: BendArc) {
  const startVector = subtract(arc.start, arc.center), radius = length(startVector), normal = normalize(arc.normal), tangent = normalize([
    normal[1] * startVector[2] - normal[2] * startVector[1],
    normal[2] * startVector[0] - normal[0] * startVector[2],
    normal[0] * startVector[1] - normal[1] * startVector[0],
  ]);
  const steps = Math.max(6, Math.ceil(Math.abs(arc.sweepRadians) / (Math.PI / 18)));
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
    } else result.push({ id: fitting.id, a: fitting.position.position, b: fitting.position.position, radius: fitting.diameterMm / 1800, relatedSegmentIds: fitting.segmentIds });
  }
  return result;
}

function primitivesForOverlay(overlay: ConduitOverlayDocument, ignoredSegmentId?: string): Primitive[] {
  const result = overlay.segments.filter((segment) => segment.id !== ignoredSegmentId).map(segmentPrimitive);
  for (const fitting of overlay.fittings) if (!fitting.segmentIds.includes(ignoredSegmentId ?? "")) {
    if (fitting.arc) {
      const points = arcPoints(fitting.arc);
      for (let index = 0; index < points.length - 1; index += 1) result.push({ id: fitting.id, a: points[index], b: points[index + 1], radius: fitting.diameterMm / 2000, relatedSegmentIds: fitting.segmentIds });
    } else result.push({ id: fitting.id, a: fitting.position.position, b: fitting.position.position, radius: fitting.diameterMm / 1800, relatedSegmentIds: fitting.segmentIds });
  }
  for (const box of overlay.junctionBoxes) if (!box.segmentIds.includes(ignoredSegmentId ?? "")) result.push({ id: box.id, a: box.position.position, b: box.position.position, radius: Math.hypot(...box.sizeMm) / 2000, relatedSegmentIds: box.segmentIds });
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
export function validatePlannedRoute(overlay: ConduitOverlayDocument, plan: PlannedRoute, ignoredSegmentId?: string): RouteDiagnostic[] {
  const diagnostics = [...plan.diagnostics], proposed = primitivesForPlan(plan), existing = primitivesForOverlay(overlay, ignoredSegmentId), candidatesFor = spatialIndex(existing), tolerance = .001;
  const linked = new Set(plan.fittings.flatMap((fitting) => fitting.segmentIds.flatMap((first) => fitting.segmentIds.filter((second) => first < second).map((second) => `${first}|${second}`))));
  for (const candidate of proposed) for (const obstacle of candidatesFor(candidate)) {
    if (candidate.portIds?.some((id) => obstacle.portIds?.includes(id))) continue;
    const hit = closestSegmentPoints(candidate, obstacle);
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
  return primitivesForOverlay(overlay, ignoredSegmentId).flatMap((obstacle) => {
    const hit = closestSegmentPoints(candidate, obstacle);
    return hit.distance < candidate.radius + obstacle.radius + .001 ? [{ code: "branch_clearance" as const, message: `分支节点与 ${obstacle.id} 空间冲突。`, objectIds: [obstacle.id], point: hit.point }] : [];
  });
}

export function withCollisionDiagnostics(overlay: ConduitOverlayDocument, plan: PlannedRoute, ignoredSegmentId?: string): PlannedRoute {
  const diagnostics = validatePlannedRoute(overlay, plan, ignoredSegmentId);
  return { ...plan, diagnostics, canCommit: diagnostics.length === 0 };
}
