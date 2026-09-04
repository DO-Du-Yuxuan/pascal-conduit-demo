import { getWallCurveFrameAt, isCurvedWall } from "../geometry/walls/curve";
import type { RoutePoint, Vec3 } from "../domain/overlay";
import type { NodeData } from "../types";

const EPSILON = 1e-7;
const numeric = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (value: Vec3, amount: number): Vec3 => [value[0] * amount, value[1] * amount, value[2] * amount];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const normalize = (value: Vec3): Vec3 => { const length = Math.hypot(...value); return length < EPSILON ? [0, 0, 1] : scale(value, 1 / length); };

function rayPlane(origin: Vec3, direction: Vec3, planePoint: Vec3, planeNormal: Vec3): Vec3 | null {
  const denominator = dot(direction, planeNormal);
  if (Math.abs(denominator) < EPSILON) return null;
  const distance = dot(subtract(planePoint, origin), planeNormal) / denominator;
  if (distance < 0) return null;
  return add(origin, scale(direction, distance));
}

function wallBaseY(point: RoutePoint) {
  return point.position[1] - (point.attachment?.localPosition?.[1] ?? 0);
}

/**
 * Keeps pointer movement on the wall that owns the last confirmed route point.
 * Openings are intentionally ignored here: they are render holes, not permission
 * for a floor behind the wall to steal the active drawing host.
 */
export function projectRayToActiveWall(node: NodeData | undefined, active: RoutePoint, origin: Vec3, direction: Vec3): RoutePoint | null {
  const attachment = active.attachment;
  if (!node || node.type !== "wall" || attachment?.hostKind !== "wall") return null;
  const start = Array.isArray(node.start) ? [numeric(node.start[0]), numeric(node.start[1])] as const : null;
  const end = Array.isArray(node.end) ? [numeric(node.end[0]), numeric(node.end[1])] as const : null;
  if (!start || !end) return null;
  const height = Math.max(.1, numeric(node.height, 2.7)), baseY = wallBaseY(active);
  const sideNormal = normalize(attachment.normal);

  if (!isCurvedWall(node as any)) {
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (length < EPSILON) return null;
    const tangent: Vec3 = [(end[0] - start[0]) / length, 0, (end[1] - start[1]) / length];
    const point = rayPlane(origin, direction, active.position, sideNormal);
    if (!point) return null;
    const along = (point[0] - start[0]) * tangent[0] + (point[2] - start[1]) * tangent[2];
    const vertical = point[1] - baseY;
    if (along < -.04 || along > length + .04 || vertical < -.04 || vertical > height + .04) return null;
    const clamped: Vec3 = [point[0], Math.max(baseY, Math.min(baseY + height, point[1])), point[2]];
    return { position: clamped, attachment: { ...attachment, normal: sideNormal, localPosition: [Math.max(0, Math.min(length, along)), clamped[1] - baseY, attachment.localPosition?.[2] ?? 0], basis: { u: tangent, v: [0, 1, 0] } } };
  }

  const segments = 32;
  let best: { point: Vec3; t: number; distance: number; tangent: Vec3; normal: Vec3 } | null = null;
  const activeFrame = getWallCurveFrameAt(node as any, attachment.curveT ?? .5);
  const sideSign = sideNormal[0] * activeFrame.normal.x + sideNormal[2] * activeFrame.normal.y < 0 ? -1 : 1;
  const sideOffset = attachment.localPosition?.[2] ?? 0;
  for (let index = 0; index < segments; index += 1) {
    const t0 = index / segments, t1 = (index + 1) / segments, midT = (t0 + t1) / 2;
    const a = getWallCurveFrameAt(node as any, t0), b = getWallCurveFrameAt(node as any, t1), frame = getWallCurveFrameAt(node as any, midT);
    const tangent: Vec3 = normalize([b.point.x - a.point.x, 0, b.point.y - a.point.y]);
    const normal: Vec3 = [frame.normal.x * sideSign, 0, frame.normal.y * sideSign];
    const planePoint: Vec3 = [frame.point.x + normal[0] * sideOffset, active.position[1], frame.point.y + normal[2] * sideOffset];
    const point = rayPlane(origin, direction, planePoint, normal);
    if (!point || point[1] < baseY - .04 || point[1] > baseY + height + .04) continue;
    const segmentLength = Math.hypot(b.point.x - a.point.x, b.point.y - a.point.y);
    const along = (point[0] - a.point.x) * tangent[0] + (point[2] - a.point.y) * tangent[2];
    if (along < -.04 || along > segmentLength + .04) continue;
    const rayDistance = Math.hypot(point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]);
    if (!best || rayDistance < best.distance) best = { point, t: t0 + Math.max(0, Math.min(1, along / Math.max(segmentLength, EPSILON))) / segments, distance: rayDistance, tangent, normal };
  }
  if (!best) return null;
  const clamped: Vec3 = [best.point[0], Math.max(baseY, Math.min(baseY + height, best.point[1])), best.point[2]];
  return { position: clamped, attachment: { ...attachment, normal: best.normal, localPosition: [best.t, clamped[1] - baseY, sideOffset], basis: { u: best.tangent, v: [0, 1, 0] }, curveT: best.t } };
}
