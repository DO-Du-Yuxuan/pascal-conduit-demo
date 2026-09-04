import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { polygonArea, type MultiPolygon, type Point, type Ring } from "./envelope";
import { buildDoorOperations, buildObstacles, intersectionArea, type DoorOperation } from "./door-operations";
import { clearanceAlongRay, pointInMultiPolygon } from "./g2-geometry";
import { buildRoomRegionAnalysis, type RoomRegionAnalysis } from "./room-regions";
import type { ConfidenceLevel } from "./types";

export type StairLandingEndpoint = "top" | "bottom";
export type StairLandingEvidence = {
  stairId: string;
  stairType: string;
  endpoint: StairLandingEndpoint;
  endpointLevelId: string | null;
  travelDirection: Point | null;
  stairWidthMeters: number | null;
  lastTreadEdgeCenter: Point | null;
  roomRegionId: string | null;
  platformCandidate: MultiPolygon;
  platformEffective: MultiPolygon;
  platformWidthMeters: number | null;
  platformDepthMeters: number | null;
  platformSource: "room_region_derived" | "unresolved";
  landingPolygon: MultiPolygon;
  effectiveLandingPolygon: MultiPolygon;
  innerBoundary: Ring | null;
  outerBoundary: Ring | null;
  walkingLine: [Point, Point] | null;
  walkingLineRadiusMeters: number | null;
  walkingLineIntersection: Point | null;
  walkingLineDepthMeters: number | null;
  effectiveAreaSquareMeters: number | null;
  quarterCircleWitness: Ring | null;
  quarterCircleWitnessFits: boolean | null;
  requiredLandingWidthMeters: number | null;
  requiredLandingAreaSquareMeters: number | null;
  widthMarginMeters: number | null;
  depthMarginMeters: number | null;
  areaMarginSquareMeters: number | null;
  nearbyDoorIds: string[];
  doorOperations: DoorOperation[];
  fixedObstacleIds: string[];
  measurementBasis: "explicit" | "derived";
  confidence: ConfidenceLevel;
  assumptions: string[];
  missingData: string[];
  lowerBound: { widthMeters: number | null; depthMeters: number | null };
  upperBound: { widthMeters: number | null; depthMeters: number | null };
  locatableObjectIds: string[];
};

const EPS = 1e-7;
const finitePositive = (value: unknown): value is number => Number.isFinite(value) && Number(value) > EPS;
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const add = (a: Point, b: Point, factor = 1): Point => [a[0] + b[0] * factor, a[1] + b[1] * factor];
const normalize = (point: Point | null): Point | null => {
  if (!point) return null;
  const length = Math.hypot(point[0], point[1]);
  return length > EPS ? [point[0] / length, point[1] / length] : null;
};
const rectangle = (origin: Point, outward: Point, width: number, depth: number): Ring => {
  const lateral: Point = [-outward[1], outward[0]], half = width / 2;
  const a = add(add(origin, lateral, -half), outward, EPS * 10);
  const b = add(add(origin, lateral, half), outward, EPS * 10);
  return [a, b, add(b, outward, depth), add(a, outward, depth)];
};
const sector = (origin: Point, outward: Point, radius: number): Ring => {
  const axis = Math.atan2(outward[1], outward[0]);
  return [origin, ...Array.from({ length: 129 }, (_, index) => {
    const angle = axis - Math.PI / 4 + Math.PI / 2 * index / 128;
    return [origin[0] + Math.cos(angle) * radius, origin[1] + Math.sin(angle) * radius] as Point;
  })];
};
const multiArea = (multi: MultiPolygon) => multi.reduce((sum, polygon) => sum + Math.max(0, polygonArea(polygon[0] ?? []) - polygon.slice(1).reduce((holes, hole) => holes + polygonArea(hole), 0)), 0);
const allInside = (ring: Ring, polygons: MultiPolygon) => ring.every((point) => pointInMultiPolygon(point, polygons));
const pointSegmentDistance = (point: Point, a: Point, b: Point) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], length2 = dx * dx + dz * dz;
  if (length2 <= EPS) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / length2));
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz);
};

/**
 * Establishes only a local, continuous standing rectangle at each stair end.
 * A large Room is evidence only when that exact rectangle is inside its real polygon;
 * the algorithm never treats the whole Room as a landing.
 */
export function analyzeStairLandings(handoff: EvaluationHandoff, roomAnalysis: RoomRegionAnalysis = buildRoomRegionAnalysis(handoff), minimumDepthMeters = 36 * .0254, spiralRequiredLandingWidthMeters = 26 * .0254): StairLandingEvidence[] {
  const operations = buildDoorOperations(handoff);
  const fixed = buildObstacles(handoff).filter((item) => item.usableForCollision && item.mobility === "fixed");
  return handoff.stairs.flatMap((stair) => (["bottom", "top"] as const).map((endpoint) => {
    const isBottom = endpoint === "bottom";
    const levelId = isBottom ? stair.fromLevelId : stair.toLevelId;
    const endpointCenter = isBottom ? stair.fromLandingCenter : stair.toLandingCenter;
    const outward = normalize(isBottom ? stair.fromLandingOutward : stair.toLandingOutward);
    const width = finitePositive(stair.landingWidthMeters) ? stair.landingWidthMeters : finitePositive(stair.widthMeters) ? stair.widthMeters : null;
    const missingData: string[] = [], assumptions: string[] = [];
    if (!levelId) missingData.push(`${stair.id}.${endpoint}.levelId`);
    if (!endpointCenter) missingData.push(`${stair.id}.${endpoint}.lastTreadEdge`);
    if (!outward) missingData.push(`${stair.id}.${endpoint}.travelDirection`);
    if (!width) missingData.push(`${stair.id}.${endpoint}.stairWidthMeters`);
    const rooms = roomAnalysis.rooms.filter((room) => room.levelId === levelId && room.usableForEvaluation);
    let roomRegionId: string | null = null, matchedRoom: typeof rooms[number] | null = null, candidate: MultiPolygon = [], effective: MultiPolygon = [];
    if (endpointCenter && outward && width) {
      const local = rectangle(endpointCenter as Point, outward, width, minimumDepthMeters);
      candidate = [[local]];
      const containing = rooms.filter((room) => allInside(local, room.polygons));
      if (containing.length === 1) {
        matchedRoom = containing[0]!; roomRegionId = matchedRoom.roomRegionId;
        const overlappingFixed = fixed.filter((item) => item.levelId === levelId && intersectionArea(local, item.footprint)! > EPS);
        if (!overlappingFixed.length) {
          effective = candidate;
          assumptions.push("以最后一级踏步边缘为起点，沿楼梯端部外向方向截取宽度等于梯段宽度、深度36 in的局部连续Room Region；不把整个Room当作平台");
        } else missingData.push(`${stair.id}.${endpoint}.fixedObstacleClearsLanding`);
      } else if (containing.length > 1) missingData.push(`${stair.id}.${endpoint}.landingRoomAmbiguous`);
      else missingData.push(`${stair.id}.${endpoint}.continuousLandingPolygon`);
    }
    const nonrectangular = /spiral|curved|winder|non.?rect/i.test(stair.stairType);
    let landingPolygon: MultiPolygon = [], effectiveLandingPolygon: MultiPolygon = [], innerBoundary: Ring | null = null, outerBoundary: Ring | null = null, walkingLine: [Point, Point] | null = null, walkingLineRadiusMeters: number | null = null, walkingLineIntersection: Point | null = null, walkingLineDepthMeters: number | null = null, effectiveAreaSquareMeters: number | null = null, quarterCircleWitness: Ring | null = null, quarterCircleWitnessFits: boolean | null = null;
    if (nonrectangular && endpointCenter && outward && width && matchedRoom) {
      const innerRadius = finitePositive(stair.innerRadiusMeters) ? stair.innerRadiusMeters : null;
      const sweep = Number.isFinite(stair.sweepAngleRadians) ? stair.sweepAngleRadians! : null;
      if (innerRadius === null || sweep === null) missingData.push(`${stair.id}.${endpoint}.spiralInnerBoundaryOrSweep`);
      else {
        const radial: Point = endpoint === "bottom" ? [outward[1], -outward[0]] : [-outward[1], outward[0]];
        const center = add(endpointCenter as Point, radial, -(innerRadius + width / 2));
        const legalRadius = innerRadius + 12 * .0254;
        const legalPoint = add(center, radial, legalRadius);
        const witness = sector(legalPoint, outward, spiralRequiredLandingWidthMeters);
        const overlappingFixed = fixed.filter((item) => item.levelId === levelId && intersectionArea(witness, item.footprint)! > EPS);
        landingPolygon = [[witness]];
        innerBoundary = [center, legalPoint];
        outerBoundary = [add(center, radial, innerRadius + width)];
        walkingLineRadiusMeters = legalRadius;
        walkingLineIntersection = legalPoint;
        const depth = clearanceAlongRay(legalPoint, outward, matchedRoom.polygons, overlappingFixed.map((item) => item.footprint));
        walkingLineDepthMeters = depth;
        walkingLine = depth === null ? null : [legalPoint, add(legalPoint, outward, depth)];
        quarterCircleWitness = witness;
        quarterCircleWitnessFits = !overlappingFixed.length && allInside(witness, matchedRoom.polygons);
        if (quarterCircleWitnessFits) {
          effectiveLandingPolygon = landingPolygon;
          effectiveAreaSquareMeters = multiArea(effectiveLandingPolygon);
          assumptions.push("螺旋楼梯行走线复用innerRadius踏步内侧窄端边缘外12 in；以该行走线与端部外向方向构造requiredLandingWidth半径的四分之一圆局部见证区域，不使用整个Room面积");
        }
      }
    }
    const nearby = operations.filter((operation) => operation.levelId === levelId && operation.portalSegment && endpointCenter && Math.min(...operation.portalSegment.map((point) => Math.hypot(point[0] - endpointCenter[0], point[1] - endpointCenter[1]))) <= Math.max(width ?? 0, minimumDepthMeters) + .05);
    const confidence: ConfidenceLevel = effective.length ? "medium" : missingData.some((item) => item.includes("lastTread") || item.includes("Direction")) ? "low" : "medium";
    return {
      stairId: stair.id, stairType: stair.stairType, endpoint, endpointLevelId: levelId ?? null,
      travelDirection: outward, stairWidthMeters: width, lastTreadEdgeCenter: endpointCenter ?? null,
      roomRegionId, platformCandidate: candidate, platformEffective: effective,
      platformWidthMeters: effective.length ? width : null, platformDepthMeters: effective.length ? minimumDepthMeters : null,
      platformSource: effective.length ? "room_region_derived" : "unresolved", nearbyDoorIds: nearby.map((item) => item.doorId), doorOperations: nearby,
      landingPolygon: nonrectangular ? landingPolygon : candidate, effectiveLandingPolygon: nonrectangular ? effectiveLandingPolygon : effective,
      innerBoundary, outerBoundary, walkingLine, walkingLineRadiusMeters, walkingLineIntersection, walkingLineDepthMeters, effectiveAreaSquareMeters, quarterCircleWitness, quarterCircleWitnessFits,
      requiredLandingWidthMeters: null, requiredLandingAreaSquareMeters: null, widthMarginMeters: null, depthMarginMeters: null, areaMarginSquareMeters: null,
      fixedObstacleIds: fixed.filter((item) => item.levelId === levelId && candidate.length && intersectionArea(candidate[0]![0]!, item.footprint)! > EPS).map((item) => item.objectId),
      measurementBasis: "derived", confidence, assumptions, missingData,
      lowerBound: { widthMeters: effective.length ? width : null, depthMeters: effective.length ? minimumDepthMeters : null },
      upperBound: { widthMeters: effective.length ? width : null, depthMeters: effective.length ? minimumDepthMeters : null },
      locatableObjectIds: [...new Set([stair.id, ...(roomRegionId ? [roomRegionId] : []), ...nearby.map((item) => item.doorId)])],
    };
  }));
}

export function doorSweepsPlatform(operation: DoorOperation, platform: MultiPolygon) {
  if (!platform.length) return false;
  return operation.leaves.some((leaf) => platform.some((polygon) => intersectionArea(leaf.swingPolygon, polygon[0] ?? [])! > EPS));
}
