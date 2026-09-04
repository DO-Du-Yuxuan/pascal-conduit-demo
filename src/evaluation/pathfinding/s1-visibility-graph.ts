import type { MultiPolygon, Point } from "../envelope";
import { S1_PATHFINDING_GEOMETRY_EPSILON_METERS, S1_PATHFINDING_SNAP_TOLERANCE_METERS } from "./s1-pathfinding-config";
import { s1PathPointKey, s1PointInMultiPolygon, s1PointSegmentDistance, s1SegmentInMultiPolygon } from "./s1-walkable-geometry";

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pathLength = (points: Point[]) => points.slice(1).reduce((sum, point, index) => sum + distance(points[index]!, point), 0);

export type S1ResolvedAnchor = { requestedPoint: Point; point: Point; snappedDistanceMeters: number };
export type S1VisibilityPath = { points: Point[]; lengthMeters: number; nodeCount: number };

export function resolveS1Anchor(point: Point, polygons: MultiPolygon, snapToleranceMeters = S1_PATHFINDING_SNAP_TOLERANCE_METERS): S1ResolvedAnchor | null {
  if (s1PointInMultiPolygon(point, polygons)) return { requestedPoint: point, point, snappedDistanceMeters: 0 };
  const candidates = polygons.flatMap((polygon) => polygon.flatMap((ring) => ring.flatMap((a, index) => {
    const b = ring[(index + 1) % ring.length]!, dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2)) : 0;
    return [[a[0] + dx * t, a[1] + dy * t] as Point, a];
  })));
  const selected = candidates.sort((a, b) => distance(a, point) - distance(b, point) || a[0] - b[0] || a[1] - b[1])[0];
  const snappedDistanceMeters = selected ? distance(point, selected) : Infinity;
  return selected && snappedDistanceMeters <= snapToleranceMeters + S1_PATHFINDING_GEOMETRY_EPSILON_METERS ? { requestedPoint: point, point: selected, snappedDistanceMeters } : null;
}

export function closestS1WalkablePointWithinRings(representative: Point, rings: Point[][], polygons: MultiPolygon): Point | null {
  const candidates: Point[] = [];
  if (rings.some((ring) => pointInRingLocal(representative, ring)) && s1PointInMultiPolygon(representative, polygons)) candidates.push(representative);
  for (const ring of rings) {
    for (const point of ring) if (s1PointInMultiPolygon(point, polygons)) candidates.push(point);
    for (const polygon of polygons) for (const boundary of polygon) for (const point of boundary) if (pointInRingLocal(point, ring)) candidates.push(point);
  }
  return [...new Map(candidates.map((point) => [s1PathPointKey(point), point])).values()].sort((a, b) => distance(a, representative) - distance(b, representative) || a[0] - b[0] || a[1] - b[1])[0] ?? null;
}

function pointInRingLocal(point: Point, ring: Point[]) {
  if (ring.length < 3) return false;
  if (ring.some((start, index) => s1PointSegmentDistance(point, start, ring[(index + 1) % ring.length]!) <= S1_PATHFINDING_GEOMETRY_EPSILON_METERS)) return true;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index]!, b = ring[previous]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export class S1VisibilityGraph {
  private readonly vertices: Point[];
  private readonly baseAdjacency: Array<Array<{ next: number; weight: number }>>;
  private readonly cache = new Map<string, S1VisibilityPath | null>();
  constructor(readonly polygons: MultiPolygon) {
    this.vertices = [...new Map(polygons.flatMap((polygon) => polygon.flatMap((ring) => ring)).map((point) => [s1PathPointKey(point), point])).values()]
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    this.baseAdjacency = this.vertices.map(() => []);
    for (let first = 0; first < this.vertices.length; first++) for (let second = first + 1; second < this.vertices.length; second++) {
      if (!s1SegmentInMultiPolygon(this.vertices[first]!, this.vertices[second]!, polygons)) continue;
      const weight = distance(this.vertices[first]!, this.vertices[second]!);
      this.baseAdjacency[first]!.push({ next: second, weight }); this.baseAdjacency[second]!.push({ next: first, weight });
    }
  }

  findPath(start: Point, end: Point): S1VisibilityPath | null {
    const cacheKey = [s1PathPointKey(start), s1PathPointKey(end)].sort().join("|");
    if (this.cache.has(cacheKey)) { const cached = this.cache.get(cacheKey); return cached ? { ...cached, points: s1PathPointKey(start) === s1PathPointKey(cached.points[0]!) ? cached.points : [...cached.points].reverse() } : null; }
    if (!s1PointInMultiPolygon(start, this.polygons) || !s1PointInMultiPolygon(end, this.polygons)) return null;
    const nodes = [start, end, ...this.vertices], count = nodes.length, adjacency = nodes.map(() => [] as Array<{ next: number; weight: number }>);
    for (let index = 0; index < this.baseAdjacency.length; index++) for (const edge of this.baseAdjacency[index]!) adjacency[index + 2]!.push({ next: edge.next + 2, weight: edge.weight });
    if (s1SegmentInMultiPolygon(start, end, this.polygons)) { const weight = distance(start, end); adjacency[0]!.push({ next: 1, weight }); adjacency[1]!.push({ next: 0, weight }); }
    for (let index = 0; index < this.vertices.length; index++) {
      const vertex = this.vertices[index]!, vertexIndex = index + 2;
      if (s1SegmentInMultiPolygon(start, vertex, this.polygons)) { const weight = distance(start, vertex); adjacency[0]!.push({ next: vertexIndex, weight }); adjacency[vertexIndex]!.push({ next: 0, weight }); }
      if (s1SegmentInMultiPolygon(end, vertex, this.polygons)) { const weight = distance(end, vertex); adjacency[1]!.push({ next: vertexIndex, weight }); adjacency[vertexIndex]!.push({ next: 1, weight }); }
    }
    const distances = Array<number>(count).fill(Infinity), signatures = Array<string>(count).fill(""), previous = Array<number>(count).fill(-1), visited = Array<boolean>(count).fill(false);
    distances[0] = 0; signatures[0] = s1PathPointKey(start);
    for (let iteration = 0; iteration < count; iteration++) {
      let current = -1;
      for (let index = 0; index < count; index++) if (!visited[index] && (current < 0 || distances[index]! < distances[current]! - 1e-9 || Math.abs(distances[index]! - distances[current]!) <= 1e-9 && signatures[index]!.localeCompare(signatures[current]!) < 0)) current = index;
      if (current < 0 || !Number.isFinite(distances[current]) || current === 1) break;
      visited[current] = true;
      for (const edge of adjacency[current]!) {
        const next = edge.next;
        if (visited[next]) continue;
        const candidate = distances[current]! + edge.weight, signature = `${signatures[current]}>${s1PathPointKey(nodes[next]!)}`;
        if (candidate < distances[next]! - 1e-9 || Math.abs(candidate - distances[next]!) <= 1e-9 && (!signatures[next] || signature.localeCompare(signatures[next]!) < 0)) { distances[next] = candidate; signatures[next] = signature; previous[next] = current; }
      }
    }
    if (!Number.isFinite(distances[1])) { this.cache.set(cacheKey, null); return null; }
    const points: Point[] = [];
    for (let cursor = 1; cursor >= 0; cursor = previous[cursor]!) { points.unshift(nodes[cursor]!); if (cursor === 0) break; }
    const result = { points, lengthMeters: pathLength(points), nodeCount: count };
    this.cache.set(cacheKey, result);
    return result;
  }
}
