import ClipperLib from "clipper-lib";
import earcut, { flatten } from "earcut";
import { NavMesh, Polygon, Vector3 } from "yuka";
import polygonClipping from "polygon-clipping";
import type { Point, Ring, MultiPolygon } from "./envelope";
import type { NavigationObstacle, RoomNavigationAnalysis } from "./navigation";
import type { RoomRegion } from "./room-regions";
import { countPathTurns, type S1HighFrequencyPathMeasurement, type S1HighFrequencyPathPoint } from "./s1-high-frequency-path";

export const S1_PATHFINDING_POC_VERSION = "v0.1" as const;
export const S1_PATHFINDING_POC_AGENT_RADIUS_METERS = 0.2;
export const S1_PATHFINDING_POC_EPSILON_METERS = 1e-6;

export type S1PathProviderId = "current" | "yuka" | "visibility_graph";
export type S1PocRoomInput = {
  roomRegionId: string;
  levelId: string;
  roomPolygons: MultiPolygon;
  obstaclePolygons: Ring[];
  start: Point;
  end: Point;
  agentRadiusMeters: number;
};
export type S1PocPathResult = {
  providerId: S1PathProviderId;
  status: "measured" | "unable_to_determine";
  pathPoints: Point[];
  lengthMeters: number | null;
  cornerCount: number | null;
  buildTimeMs: number;
  queryTimeMs: number;
  nodeCount: number;
  geometryValid: boolean;
  clearanceValid: boolean;
  diagnostics: string[];
};
export interface S1PocPathProvider { readonly id: S1PathProviderId; findPath(input: S1PocRoomInput): S1PocPathResult; }
export type S1HpePocRouteComparison = {
  routeId: string;
  routeLabel: string;
  roomRegionIds: string[];
  doorIds: string[];
  stairIds: string[];
  current: S1PocRouteCandidate;
  yuka: S1PocRouteCandidate;
  visibilityGraph: S1PocRouteCandidate;
};
export type S1PocRouteCandidate = {
  providerId: S1PathProviderId;
  status: "measured" | "unable_to_determine";
  pathPoints: S1HighFrequencyPathPoint[];
  lengthMeters: number | null;
  cornerCount: number | null;
  buildTimeMs: number;
  queryTimeMs: number;
  nodeCount: number;
  geometryValid: boolean;
  clearanceValid: boolean;
  portalValid: boolean;
  deterministic: boolean;
  diagnostics: string[];
};

const SCALE = 1_000_000;
const rounded = (value: number) => Math.round(value * 1e6) / 1e6;
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pathLength = (points: Point[]) => points.slice(1).reduce((sum, point, index) => sum + distance(points[index]!, point), 0);
const samePoint = (a: Point, b: Point, epsilon = S1_PATHFINDING_POC_EPSILON_METERS) => distance(a, b) <= epsilon;
const samePortalLanding = (a: Point, b: Point) => samePoint(a, b, .051);
const pointKey = (point: Point) => `${rounded(point[0])}:${rounded(point[1])}`;
const cleanRing = (ring: Ring): Ring => ring.filter((point, index) => index === 0 || !samePoint(point, ring[index - 1]!)).filter((point, index, all) => index !== all.length - 1 || !samePoint(point, all[0]!));
const pointSegmentDistance = (point: Point, start: Point, end: Point) => { const dx = end[0] - start[0], dy = end[1] - start[1], length2 = dx * dx + dy * dy; if (length2 <= 1e-18) return distance(point, start); const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length2)); return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy); };
const pointOnRing = (point: Point, ring: Ring, epsilon = S1_PATHFINDING_POC_EPSILON_METERS) => ring.some((start, index) => pointSegmentDistance(point, start, ring[(index + 1) % ring.length]!) <= epsilon);
const pointInRing = (point: Point, ring: Ring) => { if (ring.length < 3) return false; if (pointOnRing(point, ring)) return true; let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i]!, b = ring[j]!; if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; };
const pointInPolygon = (point: Point, polygon: Ring[]) => Boolean(polygon[0] && pointInRing(point, polygon[0]) && !polygon.slice(1).some((hole) => pointInRing(point, hole) && !pointOnRing(point, hole)));
export const pointInWalkablePolygons = (point: Point, polygons: MultiPolygon) => polygons.some((polygon) => pointInPolygon(point, polygon));

function segmentIntersectionParameters(a: Point, b: Point, c: Point, d: Point) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) <= 1e-12) return [];
  const qx = c[0] - a[0], qy = c[1] - a[1], t = (qx * sy - qy * sx) / denominator, u = (qx * ry - qy * rx) / denominator;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? [Math.max(0, Math.min(1, t))] : [];
}
export function segmentInWalkablePolygons(start: Point, end: Point, polygons: MultiPolygon) {
  if (!pointInWalkablePolygons(start, polygons) || !pointInWalkablePolygons(end, polygons)) return false;
  const parameters = [0, 1, ...polygons.flatMap((polygon) => polygon.flatMap((ring) => ring.flatMap((point, index) => segmentIntersectionParameters(start, end, point, ring[(index + 1) % ring.length]!))))].sort((a, b) => a - b);
  const unique = parameters.filter((value, index) => index === 0 || Math.abs(value - parameters[index - 1]!) > 1e-9), dx = end[0] - start[0], dy = end[1] - start[1];
  return unique.slice(1).every((value, index) => { const t = (unique[index]! + value) / 2; return pointInWalkablePolygons([start[0] + dx * t, start[1] + dy * t], polygons); });
}

function offsetRing(ring: Ring, deltaMeters: number): Ring[] {
  const path = cleanRing(ring).map(([X, Y]) => ({ X: Math.round(X * SCALE), Y: Math.round(Y * SCALE) })), solution: ClipperLib.Paths = [];
  if (path.length < 3) return [];
  const offset = new ClipperLib.ClipperOffset(2, .01 * SCALE);
  offset.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  offset.Execute(solution, deltaMeters * SCALE);
  return solution.map((result) => cleanRing(result.map(({ X, Y }) => [X / SCALE, Y / SCALE] as Point))).filter((result) => result.length >= 3);
}

/** Builds the explicit clearance polygon used by both experimental candidates. */
export function buildS1PocWalkablePolygons(input: Pick<S1PocRoomInput, "roomPolygons" | "obstaclePolygons" | "agentRadiusMeters">): MultiPolygon {
  try {
    const insetRoomParts: MultiPolygon = [];
    for (const polygon of input.roomPolygons) for (const outer of offsetRing(polygon[0] ?? [], -input.agentRadiusMeters)) insetRoomParts.push([outer]);
    if (!insetRoomParts.length) return [];
    const exclusions = [
      ...input.roomPolygons.flatMap((polygon) => polygon.slice(1)),
      ...input.obstaclePolygons,
    ].flatMap((ring) => offsetRing(ring, input.agentRadiusMeters)).map((ring) => [ring] as Ring[]);
    const walkable = exclusions.length ? polygonClipping.difference(insetRoomParts as any, ...exclusions as any) as MultiPolygon : insetRoomParts;
    return walkable.map((polygon) => polygon.map(cleanRing).filter((ring) => ring.length >= 3)).filter((polygon) => polygon[0]?.length >= 3).sort((a, b) => pointKey(a[0]![0]!).localeCompare(pointKey(b[0]![0]!)));
  } catch { return []; }
}

function nearestWalkablePoint(point: Point, polygons: MultiPolygon) {
  if (pointInWalkablePolygons(point, polygons)) return point;
  const candidates = polygons.flatMap((polygon) => polygon.flatMap((ring) => ring.flatMap((a, index) => { const b = ring[(index + 1) % ring.length]!, dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy, t = length2 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2)) : 0; return [[a[0] + dx * t, a[1] + dy * t] as Point, a]; })));
  return candidates.sort((a, b) => distance(a, point) - distance(b, point) || a[0] - b[0] || a[1] - b[1])[0] ?? null;
}

function result(providerId: S1PathProviderId, pathPoints: Point[] | null, walkable: MultiPolygon, buildTimeMs: number, queryTimeMs: number, nodeCount: number, diagnostics: string[]): S1PocPathResult {
  const geometryValid = Boolean(pathPoints?.length && pathPoints.slice(1).every((point, index) => segmentInWalkablePolygons(pathPoints[index]!, point, walkable)));
  return { providerId, status: pathPoints && geometryValid ? "measured" : "unable_to_determine", pathPoints: pathPoints && geometryValid ? pathPoints : [], lengthMeters: pathPoints && geometryValid ? rounded(pathLength(pathPoints)) : null, cornerCount: pathPoints && geometryValid ? Math.max(0, pathPoints.length - 2) : null, buildTimeMs, queryTimeMs, nodeCount, geometryValid, clearanceValid: geometryValid, diagnostics: geometryValid ? diagnostics : [...diagnostics, "候选路径未通过显式可通行多边形与 clearance 自动验证。"] };
}

export class CurrentGridPocProvider implements S1PocPathProvider {
  readonly id = "current" as const;
  constructor(private readonly gridMeters = .1) {}
  findPath(input: S1PocRoomInput) {
    const buildStarted = performance.now(), walkable = buildS1PocWalkablePolygons(input), all = walkable.flatMap((polygon) => polygon.flatMap((ring) => ring));
    if (!all.length) return result(this.id, null, walkable, performance.now() - buildStarted, 0, 0, ["clearance 后没有可通行多边形。"]);
    const minX = Math.min(...all.map((point) => point[0])), maxX = Math.max(...all.map((point) => point[0])), minY = Math.min(...all.map((point) => point[1])), maxY = Math.max(...all.map((point) => point[1])), cells: Point[] = [];
    for (let x = minX; x <= maxX + 1e-9; x += this.gridMeters) for (let y = minY; y <= maxY + 1e-9; y += this.gridMeters) { const point: Point = [rounded(x), rounded(y)]; if (pointInWalkablePolygons(point, walkable)) cells.push(point); }
    const byKey = new Map(cells.map((point) => [pointKey(point), point])), nearest = (target: Point) => [...cells].sort((a, b) => distance(a, target) - distance(b, target) || a[0] - b[0] || a[1] - b[1])[0] ?? null, start = nearest(input.start), end = nearest(input.end), buildTimeMs = performance.now() - buildStarted;
    if (!start || !end) return result(this.id, null, walkable, buildTimeMs, 0, cells.length, ["自由网格无法建立端点。"]);
    const queryStarted = performance.now(), queue = [start], previous = new Map([[pointKey(start), ""]]);
    while (queue.length) { const current = queue.shift()!; if (samePoint(current, end)) break; for (const next of [[current[0] + this.gridMeters, current[1]], [current[0] - this.gridMeters, current[1]], [current[0], current[1] + this.gridMeters], [current[0], current[1] - this.gridMeters]] as Point[]) { const key = pointKey(next), resolved = byKey.get(key); if (resolved && !previous.has(key)) { previous.set(key, pointKey(current)); queue.push(resolved); } } }
    if (!previous.has(pointKey(end))) return result(this.id, null, walkable, buildTimeMs, performance.now() - queryStarted, cells.length, ["四邻接自由网格中不可达。"]);
    const raw: Point[] = []; for (let cursor = pointKey(end); cursor;) { raw.unshift(byKey.get(cursor)!); cursor = previous.get(cursor) ?? ""; }
    const smoothed: Point[] = [raw[0]!]; let cursor = 0; while (cursor < raw.length - 1) { let next = raw.length - 1; while (next > cursor + 1 && !segmentInWalkablePolygons(raw[cursor]!, raw[next]!, walkable)) next--; smoothed.push(raw[next]!); cursor = next; }
    return result(this.id, smoothed, walkable, buildTimeMs, performance.now() - queryStarted, cells.length, ["POC 基准复现 0.1m 四邻接网格 BFS + 视线平滑。"]);
  }
}

function visibilityShortestPath(start: Point, end: Point, polygons: MultiPolygon) {
  const vertices = polygons.flatMap((polygon) => polygon.flatMap((ring) => ring)).sort((a, b) => a[0] - b[0] || a[1] - b[1]), nodes = [start, end, ...new Map(vertices.map((point) => [pointKey(point), point])).values()], count = nodes.length;
  const distances = Array<number>(count).fill(Infinity), previous = Array<number>(count).fill(-1), visited = Array<boolean>(count).fill(false); distances[0] = 0;
  for (let iteration = 0; iteration < count; iteration++) {
    let current = -1;
    for (let index = 0; index < count; index++) if (!visited[index] && (current < 0 || distances[index]! < distances[current]! - 1e-9 || Math.abs(distances[index]! - distances[current]!) <= 1e-9 && index < current)) current = index;
    if (current < 0 || !Number.isFinite(distances[current]) || current === 1) break;
    visited[current] = true;
    for (let next = 0; next < count; next++) {
      if (next === current || visited[next] || !segmentInWalkablePolygons(nodes[current]!, nodes[next]!, polygons)) continue;
      const candidate = distances[current]! + distance(nodes[current]!, nodes[next]!);
      if (candidate < distances[next]! - 1e-9 || Math.abs(candidate - distances[next]!) <= 1e-9 && current < previous[next]!) { distances[next] = candidate; previous[next] = current; }
    }
  }
  if (!Number.isFinite(distances[1])) return { points: null, nodeCount: count };
  const points: Point[] = []; for (let cursor = 1; cursor >= 0; cursor = previous[cursor]!) { points.unshift(nodes[cursor]!); if (cursor === 0) break; }
  return { points, nodeCount: count };
}

export class VisibilityGraphPocProvider implements S1PocPathProvider {
  readonly id = "visibility_graph" as const;
  findPath(input: S1PocRoomInput) {
    const buildStarted = performance.now(), walkable = buildS1PocWalkablePolygons(input), start = nearestWalkablePoint(input.start, walkable), end = nearestWalkablePoint(input.end, walkable), buildTimeMs = performance.now() - buildStarted;
    if (!start || !end) return result(this.id, null, walkable, buildTimeMs, 0, 0, ["起点或终点无法投影到 clearance 后可通行多边形。"]) ;
    const queryStarted = performance.now(), path = visibilityShortestPath(start, end, walkable), queryTimeMs = performance.now() - queryStarted;
    return result(this.id, path.points, walkable, buildTimeMs, queryTimeMs, path.nodeCount, ["直接使用 RoomRegion、hole 与家具 footprint 的 clearance polygon visibility graph + Dijkstra；未使用自由网格。"]) ;
  }
}

function triangulate(polygons: MultiPolygon) {
  const triangles: Point[][] = [];
  for (const polygon of polygons) {
    const data = flatten(polygon), indices = earcut(data.vertices, data.holes, data.dimensions);
    for (let index = 0; index < indices.length; index += 3) {
      const points = indices.slice(index, index + 3).map((vertexIndex) => [data.vertices[vertexIndex! * 2]!, data.vertices[vertexIndex! * 2 + 1]!] as Point);
      const signed = points.reduce((sum, point, pointIndex) => { const next = points[(pointIndex + 1) % points.length]!; return sum + point[0] * next[1] - next[0] * point[1]; }, 0);
      triangles.push(signed >= 0 ? points : [points[0]!, points[2]!, points[1]!]);
    }
  }
  return triangles;
}

export class YukaNavMeshPocProvider implements S1PocPathProvider {
  readonly id = "yuka" as const;
  findPath(input: S1PocRoomInput) {
    const buildStarted = performance.now(), walkable = buildS1PocWalkablePolygons(input), triangles = triangulate(walkable), polygons = triangles.map((triangle) => new Polygon().fromContour(triangle.map(([x, z]) => new Vector3(x, 0, z)))), navMesh = new NavMesh();
    navMesh.mergeConvexRegions = true; navMesh.fromPolygons(polygons); const start = nearestWalkablePoint(input.start, walkable), end = nearestWalkablePoint(input.end, walkable), buildTimeMs = performance.now() - buildStarted;
    if (!start || !end || !triangles.length) return result(this.id, null, walkable, buildTimeMs, 0, triangles.length, ["无法构造 Yuka NavMesh 或投影端点。"]) ;
    const queryStarted = performance.now(), yukaPath = navMesh.findPath(new Vector3(start[0], 0, start[1]), new Vector3(end[0], 0, end[1])), queryTimeMs = performance.now() - queryStarted, points = yukaPath.map((point) => [point.x, point.z] as Point);
    return result(this.id, points.length ? points : null, walkable, buildTimeMs, queryTimeMs, triangles.length, ["使用 Yuka 0.7.8 NavMesh.findPath 的真实 corridor/funnel；NavMesh 由 clearance polygon 经 earcut 三角化构造。"]) ;
  }
}

function obstacleIntersectsRoom(obstacle: NavigationObstacle, room: RoomRegion) {
  if (obstacle.levelId !== room.levelId || obstacle.footprint.length < 3 || obstacle.role === "excluded" || obstacle.role === "small" || obstacle.role === "uncertain" || obstacle.objectType === "wall") return false;
  try { return (polygonClipping.intersection([[obstacle.footprint]] as any, room.polygons as any) as MultiPolygon).length > 0; } catch { return false; }
}
export function roomInputForHpeSegment(room: RoomRegion, navigation: RoomNavigationAnalysis, start: Point, end: Point, agentRadiusMeters = S1_PATHFINDING_POC_AGENT_RADIUS_METERS): S1PocRoomInput {
  return { roomRegionId: room.roomRegionId, levelId: room.levelId, roomPolygons: room.polygons, obstaclePolygons: navigation.obstacles.filter((obstacle) => obstacleIntersectsRoom(obstacle, room)).map((obstacle) => obstacle.footprint), start, end, agentRadiusMeters };
}

function routeCandidate(provider: S1PocPathProvider, route: S1HighFrequencyPathMeasurement, navigation: RoomNavigationAnalysis): S1PocRouteCandidate {
  if (route.status !== "measured" || !route.debugTrace) return { providerId: provider.id, status: "unable_to_determine", pathPoints: [], lengthMeters: null, cornerCount: null, buildTimeMs: 0, queryTimeMs: 0, nodeCount: 0, geometryValid: false, clearanceValid: false, portalValid: false, deterministic: false, diagnostics: ["HPE 正式路线或调试分段不可用。"] };
  const rooms = new Map(navigation.graph.roomAnalysis.rooms.map((room) => [room.roomRegionId, room])), segments: S1HighFrequencyPathPoint[][] = [], diagnostics: string[] = []; let buildTimeMs = 0, queryTimeMs = 0, nodeCount = 0, valid = true;
  for (const trace of route.debugTrace.smoothedSegments) {
    const room = rooms.get(trace.roomRegionId), start = trace.points[0], end = trace.points[trace.points.length - 1];
    if (!room || !start || !end) { valid = false; diagnostics.push(`${trace.roomRegionId}: 缺少 Room 或固定分段端点。`); continue; }
    const outcome = provider.findPath(roomInputForHpeSegment(room, navigation, start, end)); buildTimeMs += outcome.buildTimeMs; queryTimeMs += outcome.queryTimeMs; nodeCount += outcome.nodeCount; diagnostics.push(...outcome.diagnostics.map((item) => `${trace.roomRegionId}: ${item}`));
    if (outcome.status !== "measured") { valid = false; continue; }
    segments.push(outcome.pathPoints.map((point) => ({ levelId: trace.levelId, point })));
  }
  const pathPoints = valid ? segments.flat() : [], lengthMeters = valid ? rounded(segments.reduce((sum, segment) => sum + pathLength(segment.map((item) => item.point)), 0) + segments.slice(1).reduce((sum, segment, index) => segment[0]!.levelId === segments[index]![0]!.levelId ? sum + distance(segments[index]![segments[index]!.length - 1]!.point, segment[0]!.point) : sum, 0)) : null;
  const rerun = valid ? route.debugTrace.smoothedSegments.map((trace) => { const room = rooms.get(trace.roomRegionId)!; return provider.findPath(roomInputForHpeSegment(room, navigation, trace.points[0]!, trace.points[trace.points.length - 1]!)).pathPoints.map(pointKey).join("|"); }).join("/") : "", first = valid ? segments.map((segment) => segment.map((item) => pointKey(item.point)).join("|")).join("/") : "";
  return { providerId: provider.id, status: valid ? "measured" : "unable_to_determine", pathPoints, lengthMeters, cornerCount: valid ? countPathTurns(pathPoints) : null, buildTimeMs: rounded(buildTimeMs), queryTimeMs: rounded(queryTimeMs), nodeCount, geometryValid: valid, clearanceValid: valid, portalValid: valid && route.debugTrace.smoothedSegments.every((trace, index) => samePortalLanding(segments[index]![0]!.point, trace.points[0]!) && samePortalLanding(segments[index]![segments[index]!.length - 1]!.point, trace.points[trace.points.length - 1]!)), deterministic: valid && first === rerun, diagnostics };
}

export function compareHpeRoutePathfindingPoc(route: S1HighFrequencyPathMeasurement, navigation: RoomNavigationAnalysis): S1HpePocRouteComparison {
  const currentPoints = route.pathPoints, rooms = new Map(navigation.graph.roomAnalysis.rooms.map((room) => [room.roomRegionId, room])), exactCurrentValid = route.status === "measured" && Boolean(route.debugTrace?.smoothedSegments.every((trace) => { const room = rooms.get(trace.roomRegionId); if (!room) return false; const walkable = buildS1PocWalkablePolygons(roomInputForHpeSegment(room, navigation, trace.points[0]!, trace.points[trace.points.length - 1]!)); return trace.points.slice(1).every((point, index) => segmentInWalkablePolygons(trace.points[index]!, point, walkable)); })), current: S1PocRouteCandidate = { providerId: "current", status: route.status === "measured" ? "measured" : "unable_to_determine", pathPoints: currentPoints, lengthMeters: route.actualPathLengthMeters, cornerCount: route.turnCount, buildTimeMs: 0, queryTimeMs: 0, nodeCount: route.rawPathPointCount, geometryValid: exactCurrentValid, clearanceValid: exactCurrentValid, portalValid: route.status === "measured", deterministic: true, diagnostics: ["生产基线：Room 拓扑 + 0.1m 四邻接自由网格 BFS + 视线平滑；未被 POC 修改。", exactCurrentValid ? "同时通过 POC 的显式 clearance polygon 复核。" : "未通过 POC 的显式 clearance polygon 复核；生产算法原本只以自由网格覆盖区为几何权威。"] };
  return { routeId: route.routeId, routeLabel: route.routeLabel, roomRegionIds: route.roomPathIds, doorIds: route.doorIds, stairIds: route.stairIds, current, yuka: routeCandidate(new YukaNavMeshPocProvider(), route, navigation), visibilityGraph: routeCandidate(new VisibilityGraphPocProvider(), route, navigation) };
}
