import type { Point } from "./envelope";
import type { RoomNavigationAnalysis, RoomNavigableSpace } from "./navigation";
import { countPathTurns, segmentIsNavigable, type S1HighFrequencyPathMeasurement, type S1HighFrequencyPathPoint } from "./s1-high-frequency-path";

/**
 * Non-production calibration experiment.  It polygonises the existing furnished
 * free grid, then searches visible boundary vertices.  Keeping the free grid as
 * the authority makes a comparison fair: only the within-room search changes.
 */
export type S1VisibilityGraphComparison = {
  routeId: string;
  status: "measured" | "unable_to_determine";
  currentLengthMeters: number;
  visibilityLengthMeters: number | null;
  lengthDifferenceMeters: number | null;
  currentTurnCount: number;
  visibilityTurnCount: number | null;
  pathPoints: S1HighFrequencyPathPoint[];
  geometryValid: boolean;
  diagnostics: string[];
};

const EPS = 1e-7;
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const key = (p: Point) => `${Math.round(p[0] * 1e6)}:${Math.round(p[1] * 1e6)}`;
const rounded = (value: number) => Math.round(value * 1000) / 1000;

function candidateVertices(room: RoomNavigableSpace) {
  const cells = room.navigableFreeCells, grid = room.gridMeters, index = new Set(cells.map((p) => key(p)));
  const result = new Map<string, Point>();
  for (const cell of cells) {
    for (const dx of [-.5, .5]) for (const dz of [-.5, .5]) {
      const corner: Point = [cell[0] + dx * grid, cell[1] + dz * grid];
      const adjacent = [[-1, -1], [-1, 1], [1, -1], [1, 1]].filter(([x, z]) => index.has(key([corner[0] + x * grid / 2, corner[1] + z * grid / 2] as Point)));
      if (adjacent.length !== 1 && adjacent.length !== 3) continue;
      // Inset from a grid boundary toward free cells, avoiding zero-clearance routes.
      const center: Point = adjacent.reduce<Point>((sum, [x, z]) => [sum[0] + corner[0] + x * grid / 2, sum[1] + corner[1] + z * grid / 2], [0, 0]);
      const point: Point = [corner[0] + (center[0] / adjacent.length - corner[0]) * .35, corner[1] + (center[1] / adjacent.length - corner[1]) * .35];
      if (segmentIsNavigable(room, point, point)) result.set(key(point), point);
    }
  }
  return [...result.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function shortestVisibilityPath(room: RoomNavigableSpace, start: Point, end: Point): Point[] | null {
  if (segmentIsNavigable(room, start, end)) return [start, end];
  const nodes = [start, end, ...candidateVertices(room)], count = nodes.length;
  const distances = Array<number>(count).fill(Infinity), previous = Array<number>(count).fill(-1), used = Array<boolean>(count).fill(false);
  distances[0] = 0;
  for (let iteration = 0; iteration < count; iteration++) {
    let current = -1;
    for (let i = 0; i < count; i++) if (!used[i] && (current < 0 || distances[i]! < distances[current]! - EPS || Math.abs(distances[i]! - distances[current]!) <= EPS && i < current)) current = i;
    if (current < 0 || !Number.isFinite(distances[current])) break;
    if (current === 1) break;
    used[current] = true;
    for (let next = 0; next < count; next++) {
      if (used[next] || next === current || !segmentIsNavigable(room, nodes[current]!, nodes[next]!)) continue;
      const candidate = distances[current]! + distance(nodes[current]!, nodes[next]!);
      if (candidate < distances[next]! - EPS || Math.abs(candidate - distances[next]!) <= EPS && current < previous[next]!) { distances[next] = candidate; previous[next] = current; }
    }
  }
  if (!Number.isFinite(distances[1])) return null;
  const path: Point[] = []; for (let current = 1; current >= 0; current = previous[current]!) { path.unshift(nodes[current]!); if (current === 0) break; }
  return path;
}

export function compareHpeRouteWithVisibilityGraph(route: S1HighFrequencyPathMeasurement, navigation: RoomNavigationAnalysis): S1VisibilityGraphComparison {
  if (route.status !== "measured" || !route.debugTrace || route.actualPathLengthMeters === null || route.stairIds.length) return { routeId: route.routeId, status: "unable_to_determine", currentLengthMeters: route.actualPathLengthMeters ?? 0, visibilityLengthMeters: null, lengthDifferenceMeters: null, currentTurnCount: route.turnCount ?? 0, visibilityTurnCount: null, pathPoints: [], geometryValid: false, diagnostics: [route.stairIds.length ? "当前实验仅校准同层二维房内路径，不比较楼梯段。" : "HPE 路径未完成，无法进行 Visibility Graph 对照。"] };
  const rooms = new Map(navigation.rooms.map((room) => [room.roomRegionId, room]));
  const segments: S1HighFrequencyPathPoint[][] = [];
  for (const trace of route.debugTrace.smoothedSegments) {
    const room = rooms.get(trace.roomRegionId), start = trace.points[0], end = trace.points[trace.points.length - 1];
    if (!room || !start || !end) return { routeId: route.routeId, status: "unable_to_determine", currentLengthMeters: route.actualPathLengthMeters, visibilityLengthMeters: null, lengthDifferenceMeters: null, currentTurnCount: route.turnCount ?? 0, visibilityTurnCount: null, pathPoints: [], geometryValid: false, diagnostics: ["缺少用于实验的房内导航段。"] };
    const path = shortestVisibilityPath(room, start, end);
    if (!path) return { routeId: route.routeId, status: "unable_to_determine", currentLengthMeters: route.actualPathLengthMeters, visibilityLengthMeters: null, lengthDifferenceMeters: null, currentTurnCount: route.turnCount ?? 0, visibilityTurnCount: null, pathPoints: [], geometryValid: false, diagnostics: [`${trace.roomRegionId} 在当前自由网格中没有可见图路径。`] };
    segments.push(path.map((point) => ({ levelId: trace.levelId, point })));
  }
  const points = segments.flat();
  const within = segments.reduce((sum, segment) => sum + segment.slice(1).reduce((length, point, index) => length + distance(segment[index]!.point, point.point), 0), 0);
  const bridges = segments.slice(1).reduce((sum, segment, index) => segments[index]![0]!.levelId === segment[0]!.levelId ? sum + distance(segments[index]![segments[index]!.length - 1]!.point, segment[0]!.point) : sum, 0);
  const length = within + bridges, geometryValid = segments.every((segment, i) => { const room = rooms.get(route.debugTrace!.smoothedSegments[i]!.roomRegionId)!; return segment.slice(1).every((point, index) => segmentIsNavigable(room, segment[index]!.point, point.point)); });
  return { routeId: route.routeId, status: "measured", currentLengthMeters: route.actualPathLengthMeters, visibilityLengthMeters: rounded(length), lengthDifferenceMeters: rounded(length - route.actualPathLengthMeters), currentTurnCount: route.turnCount ?? 0, visibilityTurnCount: countPathTurns(points), pathPoints: points, geometryValid, diagnostics: ["实验使用当前 furnished 自由网格的边界顶点可见图；未替换生产 HPE。"] };
}
