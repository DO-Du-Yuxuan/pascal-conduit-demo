import type { Point } from "./envelope";
import type { ConnectivityConfidence } from "./connectivity";
import type { S1HighFrequencyPathMeasurement, S1HighFrequencyPathReport, S1HighFrequencyPathRouteGroup } from "./s1-high-frequency-path";
import { S1_PATH_CONFLICT_EPSILON, S1_PATH_CONFLICT_METRIC_ID, S1_PATH_CONFLICT_METRIC_NAME, S1_PATH_CONFLICT_MINIMUM_OVERLAP_METERS, S1_PATH_CONFLICT_OVERLAP_DIRECTION_TOLERANCE_RADIANS, S1_PATH_CONFLICT_OVERLAP_DISTANCE_TOLERANCE_METERS, S1_PATH_CONFLICT_OVERLAP_MERGE_GAP_METERS, S1_PATH_CONFLICT_POINT_TOLERANCE_METERS, S1_PATH_CONFLICT_STATUS, S1_PATH_CONFLICT_VERSION } from "./s1-path-conflict-config";

export type S1PathConflictInteractionType = "no_interaction" | "shared_endpoint" | "path_crossing" | "path_overlap_same_direction" | "path_overlap_opposite_direction" | "path_overlap_mixed_direction" | "shared_door" | "shared_stair" | "unable_to_determine";
export type S1PathConflictOverlapDirection = "same_direction" | "opposite_direction" | "mixed" | "unable_to_determine";
export type S1PathConflictPoint = { levelId: string; point: Point };
export type S1PathConflictOverlapSegment = { levelId: string; start: Point; end: Point; lengthMeters: number; direction: Exclude<S1PathConflictOverlapDirection, "unable_to_determine"> };
export type S1PathConflictPairMeasurement = {
  metricId: typeof S1_PATH_CONFLICT_METRIC_ID;
  routePairId: string;
  routeAId: string; routeBId: string;
  routeAGroup: S1HighFrequencyPathRouteGroup; routeBGroup: S1HighFrequencyPathRouteGroup;
  routeASourceZoneIds: string[]; routeATargetZoneIds: string[]; routeBSourceZoneIds: string[]; routeBTargetZoneIds: string[];
  comparedLevelIds: string[];
  interactionTypes: S1PathConflictInteractionType[];
  crossingCount: number; crossingPointsByLevel: S1PathConflictPoint[];
  sharedPathLengthMeters: number; routeASharedRatio: number | null; routeBSharedRatio: number | null;
  overlapSegmentCount: number; overlapSegmentsByLevel: S1PathConflictOverlapSegment[]; overlapDirection: S1PathConflictOverlapDirection;
  sharedDoorIds: string[]; sharedDoorCount: number; sharedStairIds: string[]; sharedStairCount: number; sharedRoomRegionIds: string[]; sharedRoomRegionCount: number;
  status: "measured" | "unable_to_determine"; confidence: ConnectivityConfidence; diagnostics: string[]; missingData: string[]; ruleVersion: typeof S1_PATH_CONFLICT_VERSION;
};
export type S1PathConflictUsageHotspot = { objectId: string; routeIds: string[]; routeCount: number };
export type S1PathConflictCrossingHotspot = { hotspotId: string; levelId: string; point: Point; routeIds: string[]; routeCount: number };
export type S1PathConflictReport = {
  metricId: typeof S1_PATH_CONFLICT_METRIC_ID; metricName: typeof S1_PATH_CONFLICT_METRIC_NAME; ruleVersion: typeof S1_PATH_CONFLICT_VERSION; measurementStatus: typeof S1_PATH_CONFLICT_STATUS;
  status: "measured" | "not_applicable"; eligibleRouteIds: string[]; routePairs: S1PathConflictPairMeasurement[];
  counts: { eligibleRoutes: number; routePairs: number; noInteractionPairs: number; crossingPairs: number; overlapPairs: number; oppositeOverlapPairs: number; sharedDoorPairs: number; sharedStairPairs: number; unablePairs: number };
  hotspots: { doors: S1PathConflictUsageHotspot[]; stairs: S1PathConflictUsageHotspot[]; roomRegions: S1PathConflictUsageHotspot[]; crossingPoints: S1PathConflictCrossingHotspot[] };
  diagnostics: string[];
};

type PathSegment = { levelId: string; start: Point; end: Point; length: number; routeStart: number };
type RawOverlap = { levelId: string; routeStart: number; routeEnd: number; start: Point; end: Point; direction: "same_direction" | "opposite_direction" };
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const interpolate = (start: Point, end: Point, t: number): Point => [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
const round = (value: number) => Math.round(value * 1000) / 1000;
const sortedIntersection = (a: string[], b: string[]) => [...new Set(a.filter((value) => b.includes(value)))].sort();
const confidenceRank = { low: 0, medium: 1, high: 2 } as const;
const lowerConfidence = (values: ConnectivityConfidence[]) => values.reduce<ConnectivityConfidence>((lowest, value) => confidenceRank[value] < confidenceRank[lowest] ? value : lowest, "high");

function routeSegments(route: S1HighFrequencyPathMeasurement) {
  const segments: PathSegment[] = []; let routeStart = 0;
  for (let index = 1; index < route.pathPoints.length; index++) {
    const previous = route.pathPoints[index - 1]!, current = route.pathPoints[index]!;
    if (previous.levelId !== current.levelId) continue;
    const length = distance(previous.point, current.point); if (length <= S1_PATH_CONFLICT_EPSILON) continue;
    segments.push({ levelId: current.levelId, start: previous.point, end: current.point, length, routeStart }); routeStart += length;
  }
  return segments;
}

function sharedEndpoints(routeA: S1HighFrequencyPathMeasurement, routeB: S1HighFrequencyPathMeasurement) {
  const endpointsA = routeA.pathPoints.length ? [routeA.pathPoints[0]!, routeA.pathPoints[routeA.pathPoints.length - 1]!] : [], endpointsB = routeB.pathPoints.length ? [routeB.pathPoints[0]!, routeB.pathPoints[routeB.pathPoints.length - 1]!] : [];
  return endpointsA.flatMap((a) => endpointsB.flatMap((b) => a.levelId === b.levelId && distance(a.point, b.point) <= S1_PATH_CONFLICT_POINT_TOLERANCE_METERS ? [{ levelId: a.levelId, point: a.point }] : [])).sort((a, b) => a.levelId.localeCompare(b.levelId) || a.point[0] - b.point[0] || a.point[1] - b.point[1]);
}

function overlapOf(a: PathSegment, b: PathSegment): RawOverlap | null {
  if (a.levelId !== b.levelId) return null;
  const av = subtract(a.end, a.start), bv = subtract(b.end, b.start), dot = (av[0] * bv[0] + av[1] * bv[1]) / (a.length * b.length), angle = Math.acos(Math.min(1, Math.max(-1, Math.abs(dot))));
  if (angle > S1_PATH_CONFLICT_OVERLAP_DIRECTION_TOLERANCE_RADIANS) return null;
  const unit: Point = [av[0] / a.length, av[1] / a.length], normal: Point = [-unit[1], unit[0]], lineDistance = (point: Point) => Math.abs((point[0] - a.start[0]) * normal[0] + (point[1] - a.start[1]) * normal[1]);
  if (lineDistance(b.start) > S1_PATH_CONFLICT_OVERLAP_DISTANCE_TOLERANCE_METERS || lineDistance(b.end) > S1_PATH_CONFLICT_OVERLAP_DISTANCE_TOLERANCE_METERS) return null;
  const project = (point: Point) => (point[0] - a.start[0]) * unit[0] + (point[1] - a.start[1]) * unit[1], b0 = project(b.start), b1 = project(b.end), start = Math.max(0, Math.min(b0, b1)), end = Math.min(a.length, Math.max(b0, b1));
  if (end - start < S1_PATH_CONFLICT_MINIMUM_OVERLAP_METERS) return null;
  return { levelId: a.levelId, routeStart: a.routeStart + start, routeEnd: a.routeStart + end, start: interpolate(a.start, a.end, start / a.length), end: interpolate(a.start, a.end, end / a.length), direction: dot >= 0 ? "same_direction" : "opposite_direction" };
}

function segmentIntersection(a: PathSegment, b: PathSegment): Point | null {
  if (a.levelId !== b.levelId) return null;
  const r = subtract(a.end, a.start), s = subtract(b.end, b.start), denominator = cross(r, s); if (Math.abs(denominator) <= S1_PATH_CONFLICT_EPSILON) return null;
  const qmp = subtract(b.start, a.start), t = cross(qmp, s) / denominator, u = cross(qmp, r) / denominator, toleranceA = S1_PATH_CONFLICT_POINT_TOLERANCE_METERS / a.length, toleranceB = S1_PATH_CONFLICT_POINT_TOLERANCE_METERS / b.length;
  return t >= -toleranceA && t <= 1 + toleranceA && u >= -toleranceB && u <= 1 + toleranceB ? interpolate(a.start, a.end, Math.max(0, Math.min(1, t))) : null;
}

function deduplicatePoints(points: S1PathConflictPoint[]) {
  const sorted = [...points].sort((a, b) => a.levelId.localeCompare(b.levelId) || a.point[0] - b.point[0] || a.point[1] - b.point[1]), result: S1PathConflictPoint[] = [];
  for (const point of sorted) if (!result.some((existing) => existing.levelId === point.levelId && distance(existing.point, point.point) <= S1_PATH_CONFLICT_POINT_TOLERANCE_METERS)) result.push(point);
  return result;
}

function mergeOverlaps(overlaps: RawOverlap[]) {
  const sorted = [...overlaps].sort((a, b) => a.levelId.localeCompare(b.levelId) || a.routeStart - b.routeStart || a.routeEnd - b.routeEnd), merged: Array<RawOverlap & { directions: Set<RawOverlap["direction"]> }> = [];
  for (const overlap of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && previous.levelId === overlap.levelId && overlap.routeStart <= previous.routeEnd + S1_PATH_CONFLICT_OVERLAP_MERGE_GAP_METERS) { if (overlap.routeEnd > previous.routeEnd) { previous.routeEnd = overlap.routeEnd; previous.end = overlap.end; } previous.directions.add(overlap.direction); }
    else merged.push({ ...overlap, directions: new Set([overlap.direction]) });
  }
  return merged.map((item): S1PathConflictOverlapSegment => ({ levelId: item.levelId, start: item.start, end: item.end, lengthMeters: round(item.routeEnd - item.routeStart), direction: item.directions.size > 1 ? "mixed" : [...item.directions][0]! }));
}

function measurePair(routeA: S1HighFrequencyPathMeasurement, routeB: S1HighFrequencyPathMeasurement): S1PathConflictPairMeasurement {
  const segmentsA = routeSegments(routeA), segmentsB = routeSegments(routeB), comparedLevelIds = [...new Set(segmentsA.map((item) => item.levelId).filter((levelId) => segmentsB.some((item) => item.levelId === levelId)))].sort(), endpointPoints = sharedEndpoints(routeA, routeB), rawOverlaps: RawOverlap[] = [], rawCrossings: S1PathConflictPoint[] = [];
  for (const a of segmentsA) for (const b of segmentsB) { const overlap = overlapOf(a, b); if (overlap) rawOverlaps.push(overlap); else { const point = segmentIntersection(a, b); if (point && !endpointPoints.some((endpoint) => endpoint.levelId === a.levelId && distance(endpoint.point, point) <= S1_PATH_CONFLICT_POINT_TOLERANCE_METERS)) rawCrossings.push({ levelId: a.levelId, point }); } }
  const overlapSegmentsByLevel = mergeOverlaps(rawOverlaps), directionSet = new Set(overlapSegmentsByLevel.map((item) => item.direction)), overlapDirection: S1PathConflictOverlapDirection = !overlapSegmentsByLevel.length ? "unable_to_determine" : directionSet.has("mixed") || directionSet.size > 1 ? "mixed" : [...directionSet][0]!, crossingPointsByLevel = deduplicatePoints(rawCrossings), sharedPathLengthMeters = round(overlapSegmentsByLevel.reduce((sum, item) => sum + item.lengthMeters, 0)), sharedDoorIds = sortedIntersection(routeA.doorIds, routeB.doorIds), sharedStairIds = sortedIntersection(routeA.stairIds, routeB.stairIds), sharedRoomRegionIds = sortedIntersection(routeA.roomPathIds, routeB.roomPathIds), interactionTypes: S1PathConflictInteractionType[] = [];
  if (endpointPoints.length) interactionTypes.push("shared_endpoint"); if (crossingPointsByLevel.length) interactionTypes.push("path_crossing"); if (overlapSegmentsByLevel.length) interactionTypes.push(overlapDirection === "same_direction" ? "path_overlap_same_direction" : overlapDirection === "opposite_direction" ? "path_overlap_opposite_direction" : "path_overlap_mixed_direction"); if (sharedDoorIds.length) interactionTypes.push("shared_door"); if (sharedStairIds.length) interactionTypes.push("shared_stair"); if (!interactionTypes.length) interactionTypes.push("no_interaction");
  const missingData = [...(!segmentsA.length ? [`${routeA.routeId}: 平滑路径片段`] : []), ...(!segmentsB.length ? [`${routeB.routeId}: 平滑路径片段`] : [])], status = missingData.length ? "unable_to_determine" as const : "measured" as const;
  if (status === "unable_to_determine") { interactionTypes.splice(0, interactionTypes.length, "unable_to_determine"); }
  return { metricId: S1_PATH_CONFLICT_METRIC_ID, routePairId: `${S1_PATH_CONFLICT_METRIC_ID}-${[routeA.routeId, routeB.routeId].sort().join("__")}`, routeAId: routeA.routeId, routeBId: routeB.routeId, routeAGroup: routeA.routeGroup, routeBGroup: routeB.routeGroup, routeASourceZoneIds: [...routeA.sourceZoneIds], routeATargetZoneIds: [...routeA.targetZoneIds], routeBSourceZoneIds: [...routeB.sourceZoneIds], routeBTargetZoneIds: [...routeB.targetZoneIds], comparedLevelIds, interactionTypes, crossingCount: crossingPointsByLevel.length, crossingPointsByLevel, sharedPathLengthMeters, routeASharedRatio: routeA.actualPathLengthMeters && routeA.actualPathLengthMeters > 0 ? round(Math.min(1, sharedPathLengthMeters / routeA.actualPathLengthMeters)) : null, routeBSharedRatio: routeB.actualPathLengthMeters && routeB.actualPathLengthMeters > 0 ? round(Math.min(1, sharedPathLengthMeters / routeB.actualPathLengthMeters)) : null, overlapSegmentCount: overlapSegmentsByLevel.length, overlapSegmentsByLevel, overlapDirection, sharedDoorIds, sharedDoorCount: sharedDoorIds.length, sharedStairIds, sharedStairCount: sharedStairIds.length, sharedRoomRegionIds, sharedRoomRegionCount: sharedRoomRegionIds.length, status, confidence: lowerConfidence([routeA.confidence, routeB.confidence]), diagnostics: [], missingData, ruleVersion: S1_PATH_CONFLICT_VERSION };
}

function usageHotspots(routes: S1HighFrequencyPathMeasurement[], values: (route: S1HighFrequencyPathMeasurement) => string[]) {
  const usage = new Map<string, Set<string>>(); routes.forEach((route) => values(route).forEach((id) => { const routeIds = usage.get(id) ?? new Set<string>(); routeIds.add(route.routeId); usage.set(id, routeIds); }));
  return [...usage.entries()].map(([objectId, routeIds]) => ({ objectId, routeIds: [...routeIds].sort(), routeCount: routeIds.size })).sort((a, b) => b.routeCount - a.routeCount || a.objectId.localeCompare(b.objectId));
}

function crossingHotspots(pairs: S1PathConflictPairMeasurement[]) {
  const hotspots: Array<{ levelId: string; point: Point; routeIds: Set<string> }> = [];
  pairs.forEach((pair) => pair.crossingPointsByLevel.forEach((crossing) => { let hotspot = hotspots.find((item) => item.levelId === crossing.levelId && distance(item.point, crossing.point) <= S1_PATH_CONFLICT_POINT_TOLERANCE_METERS); if (!hotspot) { hotspot = { levelId: crossing.levelId, point: crossing.point, routeIds: new Set() }; hotspots.push(hotspot); } hotspot.routeIds.add(pair.routeAId); hotspot.routeIds.add(pair.routeBId); }));
  return hotspots.sort((a, b) => a.levelId.localeCompare(b.levelId) || a.point[0] - b.point[0] || a.point[1] - b.point[1]).map((item, index) => ({ hotspotId: `${S1_PATH_CONFLICT_METRIC_ID}-X-${index + 1}`, levelId: item.levelId, point: item.point, routeIds: [...item.routeIds].sort(), routeCount: item.routeIds.size }));
}

export function measureS1PathConflicts(hpe: S1HighFrequencyPathReport): S1PathConflictReport {
  const routes = hpe.measurements.filter((route) => route.status === "measured").sort((a, b) => a.routeId.localeCompare(b.routeId)), routePairs: S1PathConflictPairMeasurement[] = [];
  for (let a = 0; a < routes.length; a++) for (let b = a + 1; b < routes.length; b++) routePairs.push(measurePair(routes[a]!, routes[b]!));
  const status = routes.length < 2 ? "not_applicable" as const : "measured" as const;
  return { metricId: S1_PATH_CONFLICT_METRIC_ID, metricName: S1_PATH_CONFLICT_METRIC_NAME, ruleVersion: S1_PATH_CONFLICT_VERSION, measurementStatus: S1_PATH_CONFLICT_STATUS, status, eligibleRouteIds: routes.map((route) => route.routeId), routePairs, counts: { eligibleRoutes: routes.length, routePairs: routePairs.length, noInteractionPairs: routePairs.filter((pair) => pair.interactionTypes.includes("no_interaction")).length, crossingPairs: routePairs.filter((pair) => pair.interactionTypes.includes("path_crossing")).length, overlapPairs: routePairs.filter((pair) => pair.overlapSegmentCount > 0).length, oppositeOverlapPairs: routePairs.filter((pair) => pair.overlapDirection === "opposite_direction" || pair.overlapDirection === "mixed").length, sharedDoorPairs: routePairs.filter((pair) => pair.sharedDoorCount > 0).length, sharedStairPairs: routePairs.filter((pair) => pair.sharedStairCount > 0).length, unablePairs: routePairs.filter((pair) => pair.status === "unable_to_determine").length }, hotspots: { doors: usageHotspots(routes, (route) => route.doorIds), stairs: usageHotspots(routes, (route) => route.stairIds), roomRegions: usageHotspots(routes, (route) => route.roomPathIds), crossingPoints: crossingHotspots(routePairs) }, diagnostics: status === "not_applicable" ? ["可参与比较的 S1-HPE measured 路线少于 2 条。"] : [] };
}
