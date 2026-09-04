import type { Point, Ring } from "../envelope";
import { S1_PATHFINDING_CLEARANCE_VALIDATION_TOLERANCE_METERS, S1_PATHFINDING_GEOMETRY_EPSILON_METERS } from "./s1-pathfinding-config";
import { s1PointInMultiPolygon, s1PointInRing, s1PointSegmentDistance, type S1RoomWalkableGeometry } from "./s1-walkable-geometry";

const orientation = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (a: Point, b: Point, p: Point) => Math.abs(orientation(a, b, p)) <= S1_PATHFINDING_GEOMETRY_EPSILON_METERS && p[0] >= Math.min(a[0], b[0]) - S1_PATHFINDING_GEOMETRY_EPSILON_METERS && p[0] <= Math.max(a[0], b[0]) + S1_PATHFINDING_GEOMETRY_EPSILON_METERS && p[1] >= Math.min(a[1], b[1]) - S1_PATHFINDING_GEOMETRY_EPSILON_METERS && p[1] <= Math.max(a[1], b[1]) + S1_PATHFINDING_GEOMETRY_EPSILON_METERS;
const segmentsIntersect = (a: Point, b: Point, c: Point, d: Point) => {
  const abC = orientation(a, b, c), abD = orientation(a, b, d), cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  if ((abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0)) return true;
  return Math.abs(abC) <= S1_PATHFINDING_GEOMETRY_EPSILON_METERS && onSegment(a, b, c) || Math.abs(abD) <= S1_PATHFINDING_GEOMETRY_EPSILON_METERS && onSegment(a, b, d) || Math.abs(cdA) <= S1_PATHFINDING_GEOMETRY_EPSILON_METERS && onSegment(c, d, a) || Math.abs(cdB) <= S1_PATHFINDING_GEOMETRY_EPSILON_METERS && onSegment(c, d, b);
};
const segmentDistance = (a: Point, b: Point, c: Point, d: Point) => segmentsIntersect(a, b, c, d) ? 0 : Math.min(s1PointSegmentDistance(a, c, d), s1PointSegmentDistance(b, c, d), s1PointSegmentDistance(c, a, b), s1PointSegmentDistance(d, a, b));
const minDistanceToRings = (a: Point, b: Point, rings: Ring[]) => Math.min(...rings.flatMap((ring) => ring.map((start, index) => segmentDistance(a, b, start, ring[(index + 1) % ring.length]!))));

export type S1PathValidation = { valid: boolean; diagnostics: string[] };

/** Independent validation uses raw Room and obstacle geometry, not the clearance polygon used by the search. */
export function validateS1RoomPath(points: Point[], geometry: S1RoomWalkableGeometry, clearanceMeters: number): S1PathValidation {
  const diagnostics: string[] = [];
  if (points.length < 1) return { valid: false, diagnostics: ["路径没有可验证点。"] };
  const roomBoundaryRings = geometry.rawRoomPolygons.flatMap((polygon) => polygon), minimum = clearanceMeters - S1_PATHFINDING_CLEARANCE_VALIDATION_TOLERANCE_METERS;
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    if (!s1PointInMultiPolygon(point, geometry.rawRoomPolygons)) diagnostics.push(`点 ${index} 位于 RoomRegion 外。`);
    if (geometry.rawObstaclePolygons.some((ring) => s1PointInRing(point, ring))) diagnostics.push(`点 ${index} 位于家具或固定障碍 footprint 内。`);
  }
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!, b = points[index]!, midpoint: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!s1PointInMultiPolygon(midpoint, geometry.rawRoomPolygons)) diagnostics.push(`线段 ${index - 1} 穿出 RoomRegion。`);
    const roomDistance = minDistanceToRings(a, b, roomBoundaryRings);
    if (roomDistance < minimum) diagnostics.push(`线段 ${index - 1} 与 RoomRegion 边界 clearance 不足（${roomDistance.toFixed(4)}m）。`);
    if (geometry.rawObstaclePolygons.length) {
      const obstacleDistance = minDistanceToRings(a, b, geometry.rawObstaclePolygons);
      if (obstacleDistance < minimum || geometry.rawObstaclePolygons.some((ring) => s1PointInRing(midpoint, ring))) diagnostics.push(`线段 ${index - 1} 与障碍 footprint clearance 不足（${obstacleDistance.toFixed(4)}m）。`);
    }
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

