import { Line, Point2, Wall, WallIntersection, WallMiterData } from './types';
import { getWallCurveFrameAt, isCurvedWall } from './curve';
import { DEFAULT_WALL_THICKNESS } from './thickness';

/** Pascal wall-mitering.ts: TOLERANCE, pointToKey, findJunctions, calculateLevelMiters. */
export const TOLERANCE = 0.001;
export const MITER_LIMIT = 10;

export const pointToKey = (point: Point2, tolerance = TOLERANCE) =>
  `${Math.round(point.x / tolerance)},${Math.round(point.y / tolerance)}`;

const line = (point: Point2, vector: Point2): Line => ({
  a: -vector.y,
  b: vector.x,
  c: -((-vector.y) * point.x + vector.x * point.y),
});

// This deliberately uses the straight chord, as Pascal's wall-mitering.ts does.
const pointOnWallSegment = (point: Point2, wall: Wall) => {
  const start = { x: wall.start[0], y: wall.start[1] };
  const end = { x: wall.end[0], y: wall.end[1] };
  if (pointToKey(point) === pointToKey(start) || pointToKey(point) === pointToKey(end)) return false;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-9) return false;
  const progress = (dx * (point.x - start.x) + dy * (point.y - start.y)) / lengthSquared;
  if (progress < TOLERANCE || progress > 1 - TOLERANCE) return false;
  return Math.hypot(point.x - (start.x + progress * dx), point.y - (start.y + progress * dy)) < TOLERANCE;
};

type ConnectedWall = { wall: Wall; endType: 'start' | 'end' | 'passthrough' };
type Junction = { meetingPoint: Point2; connectedWalls: ConnectedWall[] };

export function calculateLevelMiters(walls: Wall[]): WallMiterData {
  const allJunctions = new Map<string, Junction>();
  for (const wall of walls) {
    const ends: Array<['start' | 'end', Point2]> = [
      ['start', { x: wall.start[0], y: wall.start[1] }],
      ['end', { x: wall.end[0], y: wall.end[1] }],
    ];
    for (const [endType, point] of ends) {
      const key = pointToKey(point);
      const junction = allJunctions.get(key) ?? { meetingPoint: point, connectedWalls: [] };
      junction.connectedWalls.push({ wall, endType });
      allJunctions.set(key, junction);
    }
  }

  for (const junction of allJunctions.values()) {
    for (const wall of walls) {
      if (!junction.connectedWalls.some((connected) => connected.wall.id === wall.id) && pointOnWallSegment(junction.meetingPoint, wall)) {
        junction.connectedWalls.push({ wall, endType: 'passthrough' });
      }
    }
  }

  const junctions = new Map([...allJunctions].filter(([, junction]) => junction.connectedWalls.length >= 2));
  const junctionData = new Map<string, Map<string, WallIntersection>>();

  for (const [key, junction] of junctions) {
    const processed: Array<{ wallId: string; angle: number; edgeA: Line; edgeB: Line; isPassthrough: boolean; half: number }> = [];
    for (const connected of junction.connectedWalls) {
      const half = (connected.wall.thickness ?? DEFAULT_WALL_THICKNESS) / 2;
      const directions = connected.endType === 'passthrough'
        ? [
            { x: connected.wall.end[0] - connected.wall.start[0], y: connected.wall.end[1] - connected.wall.start[1] },
            { x: connected.wall.start[0] - connected.wall.end[0], y: connected.wall.start[1] - connected.wall.end[1] },
          ]
        : [direction(connected.wall, connected.endType)];
      for (const vector of directions) {
        const length = Math.hypot(vector.x, vector.y);
        if (length < 1e-9) continue;
        const normal = { x: -vector.y / length, y: vector.x / length };
        processed.push({
          wallId: connected.wall.id,
          angle: Math.atan2(vector.y, vector.x),
          edgeA: line({ x: junction.meetingPoint.x + normal.x * half, y: junction.meetingPoint.y + normal.y * half }, vector),
          edgeB: line({ x: junction.meetingPoint.x - normal.x * half, y: junction.meetingPoint.y - normal.y * half }, vector),
          isPassthrough: connected.endType === 'passthrough',
          half,
        });
      }
    }

    processed.sort((left, right) => left.angle - right.angle);
    const hits = new Map<string, WallIntersection>();
    for (let index = 0; index < processed.length; index += 1) {
      const left = processed[index];
      const right = processed[(index + 1) % processed.length];
      if (!left || !right) continue;
      const determinant = left.edgeA.a * right.edgeB.b - right.edgeB.a * left.edgeA.b;
      if (Math.abs(determinant) < 1e-9) continue;
      const point = {
        x: (left.edgeA.b * right.edgeB.c - right.edgeB.b * left.edgeA.c) / determinant,
        y: (right.edgeB.a * left.edgeA.c - left.edgeA.a * right.edgeB.c) / determinant,
      };
      const maxDistance = MITER_LIMIT * Math.max(left.half, right.half);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.hypot(point.x - junction.meetingPoint.x, point.y - junction.meetingPoint.y) > maxDistance) continue;
      if (!left.isPassthrough) hits.set(left.wallId, { ...(hits.get(left.wallId) ?? {}), left: point });
      if (!right.isPassthrough) hits.set(right.wallId, { ...(hits.get(right.wallId) ?? {}), right: point });
    }
    junctionData.set(key, hits);
  }

  return { junctionData, junctions };
}

function direction(wall: Wall, end: 'start' | 'end'): Point2 {
  if (isCurvedWall(wall)) {
    const frame = getWallCurveFrameAt(wall, end === 'start' ? 0 : 1);
    return end === 'start' ? frame.tangent : { x: -frame.tangent.x, y: -frame.tangent.y };
  }
  return end === 'start'
    ? { x: wall.end[0] - wall.start[0], y: wall.end[1] - wall.start[1] }
    : { x: wall.start[0] - wall.end[0], y: wall.start[1] - wall.end[1] };
}

export function getWallMiterBoundaryPoints(wall: Wall, data: WallMiterData) {
  const half = (wall.thickness ?? DEFAULT_WALL_THICKNESS) / 2;
  const frameAt = (end: 'start' | 'end') => {
    const point = end === 'start' ? { x: wall.start[0], y: wall.start[1] } : { x: wall.end[0], y: wall.end[1] };
    if (isCurvedWall(wall)) {
      const frame = getWallCurveFrameAt(wall, end === 'start' ? 0 : 1);
      return { point: frame.point, normal: frame.normal };
    }
    const vector = direction(wall, end);
    const length = Math.hypot(vector.x, vector.y) || 1;
    return { point, normal: { x: -vector.y / length, y: vector.x / length } };
  };

  const start = frameAt('start');
  const end = frameAt('end');
  const startJunction = data.junctionData.get(pointToKey(start.point))?.get(wall.id);
  const endJunction = data.junctionData.get(pointToKey(end.point))?.get(wall.id);
  return {
    startLeft: startJunction?.left ?? { x: start.point.x + start.normal.x * half, y: start.point.y + start.normal.y * half },
    startRight: startJunction?.right ?? { x: start.point.x - start.normal.x * half, y: start.point.y - start.normal.y * half },
    endLeft: endJunction?.right ?? { x: end.point.x + end.normal.x * half, y: end.point.y + end.normal.y * half },
    endRight: endJunction?.left ?? { x: end.point.x - end.normal.x * half, y: end.point.y - end.normal.y * half },
  };
}
