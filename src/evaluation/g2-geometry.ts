import polygonClipping from "polygon-clipping";
import { polygonArea, type MultiPolygon, type Point, type Ring } from "./envelope";

const EPSILON = 1e-7;
const close = (ring: Ring): Ring => ring.length && (ring[0]![0] !== ring[ring.length - 1]![0] || ring[0]![1] !== ring[ring.length - 1]![1]) ? [...ring, ring[0]!] : ring;
const netArea = (multi: MultiPolygon) => multi.reduce((sum, polygon) => sum + Math.max(0, polygonArea(polygon[0] ?? []) - polygon.slice(1).reduce((holes, hole) => holes + polygonArea(hole), 0)), 0);

export const pointInRing = (point: Point, ring: Ring) => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index]!, b = ring[previous]!;
    const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
    if (Math.abs(cross) <= EPSILON && point[0] >= Math.min(a[0], b[0]) - EPSILON && point[0] <= Math.max(a[0], b[0]) + EPSILON && point[1] >= Math.min(a[1], b[1]) - EPSILON && point[1] <= Math.max(a[1], b[1]) + EPSILON) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};

export const pointInMultiPolygon = (point: Point, multi: MultiPolygon) => multi.some((polygon) => Boolean(polygon[0] && pointInRing(point, polygon[0]) && !polygon.slice(1).some((hole) => pointInRing(point, hole))));

const raySegmentDistance = (origin: Point, direction: Point, a: Point, b: Point) => {
  const sx = b[0] - a[0], sz = b[1] - a[1], denominator = direction[0] * sz - direction[1] * sx;
  if (Math.abs(denominator) <= EPSILON) return null;
  const ax = a[0] - origin[0], az = a[1] - origin[1], ray = (ax * sz - az * sx) / denominator, segment = (ax * direction[1] - az * direction[0]) / denominator;
  return ray >= -EPSILON && segment >= -EPSILON && segment <= 1 + EPSILON ? Math.max(0, ray) : null;
};

export function rayDistanceToRings(origin: Point, direction: Point, rings: Ring[]) {
  const length = Math.hypot(direction[0], direction[1]);
  if (length <= EPSILON) return null;
  const unit: Point = [direction[0] / length, direction[1] / length], distances = rings.flatMap((ring) => close(ring).slice(0, -1).map((point, index) => raySegmentDistance(origin, unit, point, close(ring)[index + 1]!)).filter((value): value is number => value !== null && value > EPSILON));
  return distances.length ? Math.min(...distances) : null;
}

export function clearanceAlongRay(origin: Point, direction: Point, room: MultiPolygon, obstacleRings: Ring[] = []) {
  const roomDistance = rayDistanceToRings(origin, direction, room.flatMap((polygon) => polygon));
  const obstacleDistances = obstacleRings.map((ring) => rayDistanceToRings(origin, direction, [ring])).filter((value): value is number => value !== null);
  return roomDistance === null && !obstacleDistances.length ? null : Math.min(roomDistance ?? Infinity, ...obstacleDistances);
}

const square = (center: Point, size: number, angle: number): Ring => {
  const c = Math.cos(angle), s = Math.sin(angle), half = size / 2;
  return [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, z]) => [center[0] + x * c + z * s, center[1] - x * s + z * c]);
};

const intersectionArea = (ring: Ring, multi: MultiPolygon) => {
  try { return netArea(polygonClipping.intersection([[close(ring)]] as any, multi as any) as MultiPolygon); }
  catch { return 0; }
};

export function intersectedAreaSquareMeters(subject: MultiPolygon, clips: MultiPolygon) {
  if (!subject.length || !clips.length) return 0;
  try { return netArea(polygonClipping.intersection(subject as any, clips as any) as MultiPolygon); }
  catch { return 0; }
}

export function unionMultiPolygons(polygons: MultiPolygon[]) {
  const nonEmpty = polygons.filter((polygon) => polygon.length);
  if (!nonEmpty.length) return [] as MultiPolygon;
  try {
    const [first, ...rest] = nonEmpty;
    return polygonClipping.union(first as any, ...rest.map((item) => item as any)) as MultiPolygon;
  } catch {
    return [] as MultiPolygon;
  }
}

const bounds = (multi: MultiPolygon) => {
  const points = multi.flatMap((polygon) => polygon.flatMap((ring) => ring));
  return { minX: Math.min(...points.map((point) => point[0])), maxX: Math.max(...points.map((point) => point[0])), minZ: Math.min(...points.map((point) => point[1])), maxZ: Math.max(...points.map((point) => point[1])) };
};

const candidateAngles = (multi: MultiPolygon) => {
  const values = new Set<number>([0]);
  multi.flatMap((polygon) => polygon).forEach((ring) => close(ring).slice(0, -1).forEach((point, index) => {
    const next = close(ring)[index + 1]!, angle = Math.atan2(next[1] - point[1], next[0] - point[0]), normalized = ((angle % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    values.add(Math.round(normalized * 1e6) / 1e6);
  }));
  return [...values].slice(0, 12);
};

function candidateCenters(multi: MultiPolygon, step: number) {
  const box = bounds(multi), result: Point[] = [];
  const boundary = multi.flatMap((polygon) => polygon.flatMap((ring) => ring)), average: Point = [boundary.reduce((sum, point) => sum + point[0], 0) / boundary.length, boundary.reduce((sum, point) => sum + point[1], 0) / boundary.length];
  result.push(average, ...boundary);
  for (let x = box.minX; x <= box.maxX + EPSILON; x += step) for (let z = box.minZ; z <= box.maxZ + EPSILON; z += step) if (pointInMultiPolygon([x, z], multi)) result.push([x, z]);
  return result;
}

export function canFitEffectiveSquare(room: MultiPolygon, sizeMeters: number, fixedObstacles: Ring[] = [], samplingStepMeters = 0.1) {
  const centers = candidateCenters(room, Math.min(samplingStepMeters, Math.max(0.04, sizeMeters / 8)));
  for (const center of centers) for (const angle of candidateAngles(room)) {
    const candidate = square(center, sizeMeters, angle), closed = close(candidate), samples = [
      center,
      ...closed.slice(0, -1),
      ...closed.slice(0, -1).flatMap((point, index) => {
        const next = closed[index + 1]!;
        return [.25, .5, .75].map((fraction) => [point[0] + (next[0] - point[0]) * fraction, point[1] + (next[1] - point[1]) * fraction] as Point);
      }),
    ];
    if (!samples.every((point) => pointInMultiPolygon(point, room))) continue;
    if (fixedObstacles.some((obstacle) => intersectionArea(candidate, [[close(obstacle)]]) > 1e-6)) continue;
    return { fits: true, center, angle };
  }
  return { fits: false, center: null, angle: null };
}

export function maximumEffectiveSquareSize(room: MultiPolygon, fixedObstacles: Ring[] = []) {
  const box = bounds(room);
  let low = 0, high = Math.min(box.maxX - box.minX, box.maxZ - box.minZ);
  for (let index = 0; index < 10; index++) {
    const mid = (low + high) / 2;
    if (canFitEffectiveSquare(room, mid, fixedObstacles).fits) low = mid; else high = mid;
  }
  return low;
}

const circle = (center: Point, diameter: number, segments = 48): Ring => Array.from({ length: segments }, (_, index) => {
  const angle = Math.PI * 2 * index / segments, radius = diameter / 2;
  return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius] as Point;
});

/** Finds a witness circle against the true finished polygon, never its bounding box. */
export function findInscribedCircle(room: MultiPolygon, diameterMeters: number, fixedObstacles: Ring[] = [], samplingStepMeters = .025) {
  if (!room.length || diameterMeters < 0) return { fits: false, center: null as Point | null, polygon: null as Ring | null };
  const centers = candidateCenters(room, Math.min(samplingStepMeters, Math.max(.01, diameterMeters / 20)));
  for (const center of centers) {
    const candidate = circle(center, diameterMeters);
    const samples = [center, ...candidate, ...candidate.map((point, index) => {
      const next = candidate[(index + 1) % candidate.length]!;
      return [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2] as Point;
    })];
    if (!samples.every((point) => pointInMultiPolygon(point, room))) continue;
    if (fixedObstacles.some((obstacle) => intersectionArea(candidate, [[close(obstacle)]]) > 1e-7)) continue;
    return { fits: true, center, polygon: candidate };
  }
  return { fits: false, center: null as Point | null, polygon: null as Ring | null };
}

export function maximumInscribedCircleDiameter(room: MultiPolygon, fixedObstacles: Ring[] = []) {
  if (!room.length) return 0;
  const box = bounds(room); let low = 0, high = Math.min(box.maxX - box.minX, box.maxZ - box.minZ);
  for (let index = 0; index < 12; index++) { const mid = (low + high) / 2; if (findInscribedCircle(room, mid, fixedObstacles).fits) low = mid; else high = mid; }
  return low;
}

export function subtractFixedObstacles(room: MultiPolygon, fixedObstacles: Ring[]) {
  if (!fixedObstacles.length) return room;
  try {
    const [first, ...rest] = fixedObstacles.map((ring) => [[close(ring)]] as any), union = polygonClipping.union(first, ...rest);
    return polygonClipping.difference(room as any, union as any) as MultiPolygon;
  } catch {
    return room;
  }
}

const lineIntersections = (ring: Ring, axis: Point, normal: Point, offset: number) => {
  const intersections: number[] = [], closed = close(ring);
  for (let index = 0; index < closed.length - 1; index++) {
    const a = closed[index]!, b = closed[index + 1]!, da = a[0] * axis[0] + a[1] * axis[1] - offset, db = b[0] * axis[0] + b[1] * axis[1] - offset;
    if ((da > EPSILON) === (db > EPSILON) || Math.abs(da - db) <= EPSILON) continue;
    const t = da / (da - db), point: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    intersections.push(point[0] * normal[0] + point[1] * normal[1]);
  }
  return intersections.sort((a, b) => a - b);
};

/**
 * Samples true polygon cross-sections along the longest oriented extent.
 * End slices are excluded so tapered numerical tips do not become the legal width.
 */
export function minimumReliableCrossSection(room: MultiPolygon) {
  const outer = room[0]?.[0] ?? [];
  if (outer.length < 3) return null;
  const angles = candidateAngles(room), candidates = angles.map((angle) => {
    const axis: Point = [Math.cos(angle), Math.sin(angle)], normal: Point = [-axis[1], axis[0]], projections = outer.map((point) => point[0] * axis[0] + point[1] * axis[1]);
    return { axis, normal, span: Math.max(...projections) - Math.min(...projections), min: Math.min(...projections), max: Math.max(...projections) };
  }).sort((a, b) => b.span - a.span);
  const chosen = candidates[0]!, widths: number[] = [], slices = 61;
  for (let index = 6; index < slices - 6; index++) {
    const offset = chosen.min + (chosen.max - chosen.min) * index / (slices - 1), intersections = room.flatMap((polygon) => lineIntersections(polygon[0] ?? [], chosen.axis, chosen.normal, offset));
    const sliceWidths: number[] = [];
    for (let pair = 0; pair + 1 < intersections.length; pair += 2) sliceWidths.push(intersections[pair + 1]! - intersections[pair]!);
    if (sliceWidths.length) widths.push(Math.max(...sliceWidths));
  }
  const reliable = widths.filter((width) => width > EPSILON).sort((a, b) => a - b);
  return reliable.length ? reliable[Math.floor((reliable.length - 1) * .1)]! : null;
}

/**
 * Measures branched and concave corridors from actual boundary faces.
 * Each sufficiently long boundary segment casts perpendicular samples inward;
 * the median for that face suppresses corner artifacts, while the minimum
 * across faces preserves a genuine narrow branch.
 */
export function minimumBranchedCorridorCrossSection(room: MultiPolygon) {
  const rings = room.flatMap((polygon) => polygon), faceWidths: number[] = [], inset = .002;
  for (const ring of rings) {
    const closedRing = close(ring);
    for (let index = 0; index < closedRing.length - 1; index++) {
      const start = closedRing[index]!, end = closedRing[index + 1]!, dx = end[0] - start[0], dz = end[1] - start[1], length = Math.hypot(dx, dz);
      if (length < .25) continue;
      const left: Point = [-dz / length, dx / length], right: Point = [-left[0], -left[1]], samples: number[] = [];
      for (const fraction of [.2, .35, .5, .65, .8]) {
        const boundary: Point = [start[0] + dx * fraction, start[1] + dz * fraction];
        const leftInside = pointInMultiPolygon([boundary[0] + left[0] * inset, boundary[1] + left[1] * inset], room);
        const rightInside = pointInMultiPolygon([boundary[0] + right[0] * inset, boundary[1] + right[1] * inset], room);
        if (leftInside === rightInside) continue;
        const inward = leftInside ? left : right, origin: Point = [boundary[0] + inward[0] * inset, boundary[1] + inward[1] * inset];
        const distance = rayDistanceToRings(origin, inward, rings);
        if (distance !== null && distance + inset > .1) samples.push(distance + inset);
      }
      if (samples.length >= 3) {
        samples.sort((a, b) => a - b);
        faceWidths.push(samples[Math.floor(samples.length / 2)]!);
      }
    }
  }
  const reliable = faceWidths.filter((width) => Number.isFinite(width) && width > EPSILON).sort((a, b) => a - b);
  return reliable.length ? reliable[0]! : null;
}
