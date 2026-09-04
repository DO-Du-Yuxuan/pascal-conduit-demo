import ClipperLib from "clipper-lib";
import polygonClipping from "polygon-clipping";
import type { MultiPolygon, Point, Ring } from "../envelope";
import type { NavigationObstacle } from "../navigation";
import type { RoomRegion } from "../room-regions";
import {
  S1_PATHFINDING_AGENT_RADIUS_METERS,
  S1_PATHFINDING_GEOMETRY_EPSILON_METERS,
  S1_PATHFINDING_OFFSET_ARC_TOLERANCE_METERS,
} from "./s1-pathfinding-config";

const SCALE = 1_000_000;
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const s1PathPointKey = (point: Point) => `${Math.round(point[0] * SCALE) / SCALE}:${Math.round(point[1] * SCALE) / SCALE}`;
export const cleanS1PathRing = (ring: Ring): Ring => ring
  .filter((point, index) => index === 0 || distance(point, ring[index - 1]!) > S1_PATHFINDING_GEOMETRY_EPSILON_METERS)
  .filter((point, index, all) => index !== all.length - 1 || distance(point, all[0]!) > S1_PATHFINDING_GEOMETRY_EPSILON_METERS);

export const s1PointSegmentDistance = (point: Point, start: Point, end: Point) => {
  const dx = end[0] - start[0], dy = end[1] - start[1], length2 = dx * dx + dy * dy;
  if (length2 <= 1e-18) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length2));
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy);
};
const pointOnRing = (point: Point, ring: Ring, epsilon = S1_PATHFINDING_GEOMETRY_EPSILON_METERS) => ring.some((start, index) => s1PointSegmentDistance(point, start, ring[(index + 1) % ring.length]!) <= epsilon);
export const s1PointInRing = (point: Point, ring: Ring) => {
  if (ring.length < 3) return false;
  if (pointOnRing(point, ring)) return true;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index]!, b = ring[previous]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
const pointInPolygon = (point: Point, polygon: Ring[]) => Boolean(polygon[0] && s1PointInRing(point, polygon[0]) && !polygon.slice(1).some((hole) => s1PointInRing(point, hole) && !pointOnRing(point, hole)));
export const s1PointInMultiPolygon = (point: Point, polygons: MultiPolygon) => polygons.some((polygon) => pointInPolygon(point, polygon));

function segmentIntersectionParameters(a: Point, b: Point, c: Point, d: Point) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) <= 1e-12) return [];
  const qx = c[0] - a[0], qy = c[1] - a[1], t = (qx * sy - qy * sx) / denominator, u = (qx * ry - qy * rx) / denominator;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? [Math.max(0, Math.min(1, t))] : [];
}
export function s1SegmentInMultiPolygon(start: Point, end: Point, polygons: MultiPolygon) {
  if (!s1PointInMultiPolygon(start, polygons) || !s1PointInMultiPolygon(end, polygons)) return false;
  const parameters = [0, 1];
  for (const polygon of polygons) for (const ring of polygon) for (let index = 0; index < ring.length; index++) {
    const values = segmentIntersectionParameters(start, end, ring[index]!, ring[(index + 1) % ring.length]!);
    if (values.length) parameters.push(values[0]!);
  }
  parameters.sort((a, b) => a - b);
  const unique = parameters.filter((value, index) => index === 0 || Math.abs(value - parameters[index - 1]!) > 1e-9), dx = end[0] - start[0], dy = end[1] - start[1];
  return unique.slice(1).every((value, index) => { const t = (unique[index]! + value) / 2; return s1PointInMultiPolygon([start[0] + dx * t, start[1] + dy * t], polygons); });
}

function offsetRingRound(ring: Ring, deltaMeters: number): Ring[] {
  const path = cleanS1PathRing(ring).map(([X, Y]) => ({ X: Math.round(X * SCALE), Y: Math.round(Y * SCALE) }));
  const solution: ClipperLib.Paths = [];
  if (path.length < 3) return [];
  const offset = new ClipperLib.ClipperOffset(2, S1_PATHFINDING_OFFSET_ARC_TOLERANCE_METERS * SCALE);
  offset.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  offset.Execute(solution, deltaMeters * SCALE);
  return solution.map((result) => cleanS1PathRing(result.map(({ X, Y }) => [X / SCALE, Y / SCALE] as Point))).filter((result) => result.length >= 3);
}

export type S1RoomWalkableGeometry = {
  roomRegionId: string;
  levelId: string;
  rawRoomPolygons: MultiPolygon;
  rawObstaclePolygons: Ring[];
  walkablePolygons: MultiPolygon;
  includedObstacleIds: string[];
  uncertainObstacleIds: string[];
  diagnostics: string[];
};

function intersectsRoom(footprint: Ring, room: RoomRegion) {
  try { return (polygonClipping.intersection([[footprint]] as any, room.polygons as any) as MultiPolygon).length > 0; }
  catch { return false; }
}

/** HPE uses reliable floor footprints, including light movable seats, but never operation/use envelopes. */
export function hpeObstacleSelection(room: RoomRegion, obstacles: NavigationObstacle[]) {
  const relevant = obstacles.filter((obstacle) => obstacle.levelId === room.levelId && obstacle.objectType !== "wall" && obstacle.footprint.length >= 3 && intersectsRoom(obstacle.footprint, room));
  const included = relevant.filter((obstacle) => ["fixed", "large-movable", "small"].includes(obstacle.role));
  const uncertain = relevant.filter((obstacle) => obstacle.role === "uncertain");
  return { included, uncertain };
}

export function buildS1RoomWalkableGeometry(room: RoomRegion, obstacles: NavigationObstacle[], agentRadiusMeters = S1_PATHFINDING_AGENT_RADIUS_METERS): S1RoomWalkableGeometry {
  const { included, uncertain } = hpeObstacleSelection(room, obstacles), diagnostics: string[] = [];
  try {
    const insetRoomParts: MultiPolygon = [];
    for (const polygon of room.polygons) for (const outer of offsetRingRound(polygon[0] ?? [], -agentRadiusMeters)) insetRoomParts.push([outer]);
    if (!insetRoomParts.length) return { roomRegionId: room.roomRegionId, levelId: room.levelId, rawRoomPolygons: room.polygons, rawObstaclePolygons: included.map((item) => item.footprint), walkablePolygons: [], includedObstacleIds: included.map((item) => item.objectId), uncertainObstacleIds: uncertain.map((item) => item.objectId), diagnostics: ["clearance 后没有可通行 RoomRegion 多边形。"] };
    const exclusions = [...room.polygons.flatMap((polygon) => polygon.slice(1)), ...included.map((item) => item.footprint)]
      .flatMap((ring) => offsetRingRound(ring, agentRadiusMeters)).map((ring) => [ring] as Ring[]);
    const difference = exclusions.length ? polygonClipping.difference(insetRoomParts as any, ...exclusions as any) as MultiPolygon : insetRoomParts;
    const walkablePolygons = difference.map((polygon) => polygon.map(cleanS1PathRing).filter((ring) => ring.length >= 3)).filter((polygon) => polygon[0]?.length >= 3).sort((a, b) => s1PathPointKey(a[0]![0]!).localeCompare(s1PathPointKey(b[0]![0]!)));
    if (uncertain.length) diagnostics.push(`${uncertain.length} 个对象缺少可靠落地占用语义，未作为正式二维障碍：${uncertain.map((item) => item.objectId).sort().join(", ")}`);
    return { roomRegionId: room.roomRegionId, levelId: room.levelId, rawRoomPolygons: room.polygons, rawObstaclePolygons: included.map((item) => item.footprint), walkablePolygons, includedObstacleIds: included.map((item) => item.objectId).sort(), uncertainObstacleIds: uncertain.map((item) => item.objectId).sort(), diagnostics };
  } catch {
    return { roomRegionId: room.roomRegionId, levelId: room.levelId, rawRoomPolygons: room.polygons, rawObstaclePolygons: included.map((item) => item.footprint), walkablePolygons: [], includedObstacleIds: included.map((item) => item.objectId).sort(), uncertainObstacleIds: uncertain.map((item) => item.objectId).sort(), diagnostics: ["clearance polygon 布尔运算失败。"] };
  }
}
