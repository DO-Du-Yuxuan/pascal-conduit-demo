import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { isSdiSpaceFunctionCode } from "../space-functions/sdi-space-functions";
import type { Point } from "./envelope";
import { type ConnectivityConfidence, type RoomConnectivityGraph } from "./connectivity";
import { bedItemsForS1Bedroom, resolveS1BathroomEntranceAnchors, resolveS1BedEdgeAnchors, resolveS1GarageResidenceAnchors, resolveS1KitchenRegionAnchors, resolveS1PrimaryEntranceAnchors, type S1AnchorSet } from "./pathfinding/s1-behavior-anchors";
import { findS1GlobalShortestPath, type S1BehaviorAnchorType } from "./pathfinding/s1-global-path";
import { S1_PATHFINDING_PROVIDER } from "./pathfinding/s1-pathfinding-config";
import { buildRoomNavigationAnalysis, type RoomNavigableSpace, type RoomNavigationAnalysis } from "./navigation";
import { resolveZoneFunctionalSemantics } from "./space-semantics";
import { S1_HIGH_FREQUENCY_PATH_EQUAL_LENGTH_TOLERANCE_METERS, S1_HIGH_FREQUENCY_PATH_METRIC_ID, S1_HIGH_FREQUENCY_PATH_METRIC_NAME, S1_HIGH_FREQUENCY_PATH_POINT_EPSILON_METERS, S1_HIGH_FREQUENCY_PATH_ROUTE_GROUPS, S1_HIGH_FREQUENCY_PATH_STATUS, S1_HIGH_FREQUENCY_PATH_TURN_ANGLE_RADIANS, S1_HIGH_FREQUENCY_PATH_VERSION } from "./s1-high-frequency-path-config";

export type S1HighFrequencyPathRouteGroup = typeof S1_HIGH_FREQUENCY_PATH_ROUTE_GROUPS[number]["routeGroup"];
export type S1HighFrequencyPathRouteStatus = "measured" | "baseline_unreachable" | "unable_to_determine" | "not_applicable";
export type S1HighFrequencyPathPoint = { levelId: string; point: Point };
/** Development-only trace: it exposes each transformation without changing the production route. */
export type S1HighFrequencyPathDebugTrace = {
  roomTopology: Array<{ roomRegionId: string; levelId: string }>;
  /** Legacy shadow-only grid path. It is never a production measurement source. */
  rawGridSegments: Array<{ roomRegionId: string; levelId: string; points: Point[] }>;
  /** Production Polygon Visibility Graph room segments. */
  smoothedSegments: Array<{ roomRegionId: string; levelId: string; points: Point[] }>;
  portalPoints: Array<{ doorId?: string; stairId?: string; levelId: string; point: Point }>;
};
export type S1HighFrequencyPathSpaceRef = { roomRegionId: string; levelId: string; zoneIds: string[]; zoneNames: string[]; spaceFunctionCodes: string[]; confidence: ConnectivityConfidence };
export type S1HighFrequencyPathMeasurement = {
  metricId: typeof S1_HIGH_FREQUENCY_PATH_METRIC_ID;
  routeId: string;
  routeGroup: S1HighFrequencyPathRouteGroup;
  routeLabel: string;
  source: S1HighFrequencyPathSpaceRef | null;
  target: S1HighFrequencyPathSpaceRef | null;
  sourceRoomRegionId: string | null;
  targetRoomRegionId: string | null;
  sourceZoneIds: string[];
  targetZoneIds: string[];
  sourceSpaceFunctionCodes: string[];
  targetSpaceFunctionCodes: string[];
  roomPathIds: string[];
  doorIds: string[];
  stairIds: string[];
  pathPoints: S1HighFrequencyPathPoint[];
  actualPathLengthMeters: number | null;
  straightLineDistanceMeters: number | null;
  detourRatio: number | null;
  topologicalSteps: number | null;
  intermediateRoomCount: number | null;
  turnCount: number | null;
  sourceLevelId: string | null;
  targetLevelId: string | null;
  sourceAnchorPoint: Point | null;
  targetAnchorPoint: Point | null;
  sourceAnchorType: S1BehaviorAnchorType | null;
  targetAnchorType: S1BehaviorAnchorType | null;
  sourceBehaviorObjectIds: string[];
  targetBehaviorObjectIds: string[];
  behaviorSources: Array<"primary_entry" | "garage_return" | "bedroom">;
  selectedTargetZoneId: string | null;
  selectedTargetSpaceFunctionCode: string | null;
  pathProvider: typeof S1_PATHFINDING_PROVIDER;
  independentGeometryValidated: boolean;
  sourceZoneAnchorPoints: Array<{ zoneId: string; point: Point }>;
  targetZoneAnchorPoints: Array<{ zoneId: string; point: Point }>;
  pathSmoothed: boolean;
  rawPathPointCount: number;
  debugTrace: S1HighFrequencyPathDebugTrace | null;
  fallbackTargetUsed: boolean;
  tiedCandidateTargetRoomIds: string[];
  status: S1HighFrequencyPathRouteStatus;
  confidence: ConnectivityConfidence;
  diagnostics: string[];
  missingData: string[];
};
export type S1HighFrequencyPathGroupSummary = { routeGroup: S1HighFrequencyPathRouteGroup; label: string; status: "measured" | "unable_to_determine" | "not_applicable"; routeCount: number; diagnostics: string[] };
export type S1HighFrequencyPathReport = {
  metricId: typeof S1_HIGH_FREQUENCY_PATH_METRIC_ID;
  metricName: typeof S1_HIGH_FREQUENCY_PATH_METRIC_NAME;
  measurementVersion: typeof S1_HIGH_FREQUENCY_PATH_VERSION;
  measurementStatus: typeof S1_HIGH_FREQUENCY_PATH_STATUS;
  measurements: S1HighFrequencyPathMeasurement[];
  groups: S1HighFrequencyPathGroupSummary[];
  counts: { measured: number; baselineUnreachable: number; unableToDetermine: number; notApplicableRouteGroups: number };
  averages: { actualPathLengthMeters: number | null; topologicalSteps: number | null; turnCount: number | null };
};

const reliableZoneMatch = (relationship: string | undefined) => relationship === "one-to-one" || relationship === "room-with-multiple-zones";
const confidenceRank = { low: 0, medium: 1, high: 2 } as const;
const lowerConfidence = (values: ConnectivityConfidence[]) => values.reduce<ConnectivityConfidence>((lowest, value) => confidenceRank[value] < confidenceRank[lowest] ? value : lowest, "high");
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round = (value: number) => Math.round(value * 1000) / 1000;
const pointSegmentDistance = (point: Point, start: Point, end: Point) => { const dx = end[0] - start[0], dz = end[1] - start[1], length2 = dx * dx + dz * dz; if (!length2) return distance(point, start); const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / length2)); return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dz); };
const pointOnRing = (point: Point, ring: Point[]) => ring.some((start, index) => pointSegmentDistance(point, start, ring[(index + 1) % ring.length]!) <= S1_HIGH_FREQUENCY_PATH_POINT_EPSILON_METERS);
const pointInRing = (point: Point, ring: Point[]) => { if (ring.length < 3) return false; if (pointOnRing(point, ring)) return true; let inside = false; for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) { const a = ring[index]!, b = ring[previous]!; if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; };
const polygonRepresentativePoint = (ring: Point[]): Point => {
  let twiceArea = 0, x = 0, z = 0;
  ring.forEach((point, index) => { const next = ring[(index + 1) % ring.length]!, cross = point[0] * next[1] - next[0] * point[1]; twiceArea += cross; x += (point[0] + next[0]) * cross; z += (point[1] + next[1]) * cross; });
  return Math.abs(twiceArea) > S1_HIGH_FREQUENCY_PATH_POINT_EPSILON_METERS ? [x / (3 * twiceArea), z / (3 * twiceArea)] : [ring.reduce((sum, point) => sum + point[0], 0) / ring.length, ring.reduce((sum, point) => sum + point[1], 0) / ring.length];
};

type ZoneAnchorResolution = { anchorPoint: Point; zoneAnchors: Array<{ zoneId: string; point: Point }>; candidates: Point[]; representativePoint: Point; diagnostics: string[] };

function resolveZoneAnchors(space: S1HighFrequencyPathSpaceRef, handoff: EvaluationHandoff, room: RoomNavigableSpace): { resolution: ZoneAnchorResolution | null; missingData: string[] } {
  const zoneResults = space.zoneIds.map((zoneId) => {
    const zone = handoff.zones.find((item) => item.id === zoneId), outline = zone?.outline ?? [];
    if (outline.length < 3) return { zoneId, representative: null, candidates: [] as Point[] };
    const representative = polygonRepresentativePoint(outline), candidates = room.navigableFreeCells.filter((point) => pointInRing(point, outline)).sort((a, b) => distance(a, representative) - distance(b, representative) || a[0] - b[0] || a[1] - b[1]);
    return { zoneId, representative, candidates };
  });
  const missing = zoneResults.filter((item) => !item.representative || !item.candidates.length);
  if (missing.length) return { resolution: null, missingData: missing.map((item) => `${item.zoneId}: Zone 与 RoomRegion 有效重合区内的可通行自由网格锚点`) };
  const representatives = zoneResults.map((item) => item.representative!), representativePoint: Point = [representatives.reduce((sum, point) => sum + point[0], 0) / representatives.length, representatives.reduce((sum, point) => sum + point[1], 0) / representatives.length];
  const candidates = [...new Map(zoneResults.flatMap((item) => item.candidates).map((point) => [`${point[0]}:${point[1]}`, point])).values()].sort((a, b) => distance(a, representativePoint) - distance(b, representativePoint) || a[0] - b[0] || a[1] - b[1]);
  return { resolution: { anchorPoint: candidates[0]!, zoneAnchors: zoneResults.map((item) => ({ zoneId: item.zoneId, point: item.candidates[0]! })), candidates, representativePoint, diagnostics: [] }, missingData: [] };
}

function separateCoincidentAnchors(source: ZoneAnchorResolution, target: ZoneAnchorResolution) {
  if (distance(source.anchorPoint, target.anchorPoint) > S1_HIGH_FREQUENCY_PATH_POINT_EPSILON_METERS) return { sourcePoint: source.anchorPoint, targetPoint: target.anchorPoint, diagnostic: null };
  const alternatives = source.candidates.flatMap((sourcePoint) => target.candidates.map((targetPoint) => ({ sourcePoint, targetPoint, cost: distance(sourcePoint, source.representativePoint) + distance(targetPoint, target.representativePoint) }))).filter((pair) => distance(pair.sourcePoint, pair.targetPoint) > S1_HIGH_FREQUENCY_PATH_POINT_EPSILON_METERS).sort((a, b) => a.cost - b.cost || a.sourcePoint[0] - b.sourcePoint[0] || a.sourcePoint[1] - b.sourcePoint[1] || a.targetPoint[0] - b.targetPoint[0] || a.targetPoint[1] - b.targetPoint[1]);
  const selected = alternatives[0];
  return selected ? { sourcePoint: selected.sourcePoint, targetPoint: selected.targetPoint, diagnostic: "同一 RoomRegion 的 Zone 首选锚点重合，已选择各自 Zone 内不同的稳定自由网格点。" } : { sourcePoint: source.anchorPoint, targetPoint: target.anchorPoint, diagnostic: "两个 Zone 的有效自由网格锚点确实重合，无法在各自 Zone 范围内找到不同锚点。" };
}

export function simplifyPathPoints(points: Point[], angleThresholdRadians = S1_HIGH_FREQUENCY_PATH_TURN_ANGLE_RADIANS): Point[] {
  const deduped = points.filter((point, index) => index === 0 || distance(point, points[index - 1]!) > S1_HIGH_FREQUENCY_PATH_POINT_EPSILON_METERS);
  if (deduped.length <= 2) return deduped;
  const simplified: Point[] = [deduped[0]!];
  for (let index = 1; index < deduped.length - 1; index++) {
    const previous = simplified[simplified.length - 1]!, current = deduped[index]!, next = deduped[index + 1]!, a = Math.atan2(current[1] - previous[1], current[0] - previous[0]), b = Math.atan2(next[1] - current[1], next[0] - current[0]);
    const change = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
    if (change > angleThresholdRadians) simplified.push(current);
  }
  simplified.push(deduped[deduped.length - 1]!);
  return simplified;
}

export function countPathTurns(points: S1HighFrequencyPathPoint[]) {
  let turns = 0, chunk: Point[] = [], previousLevelId: string | null = null;
  for (const item of points) {
    if (chunk.length && item.levelId !== previousLevelId) { turns += Math.max(0, simplifyPathPoints(chunk).length - 2); chunk = []; }
    chunk.push(item.point); previousLevelId = item.levelId;
  }
  return turns + Math.max(0, simplifyPathPoints(chunk).length - 2);
}

function freeCellPath(room: RoomNavigableSpace, from: Point, to: Point): Point[] | null {
  const cells = room.navigableFreeCells, grid = room.gridMeters;
  if (!cells.length) return null;
  const nearest = (target: Point) => cells.reduce((best, point) => distance(point, target) < distance(best, target) ? point : best, cells[0]!);
  const start = nearest(from), end = nearest(to), minX = Math.min(...cells.map((point) => point[0])), minZ = Math.min(...cells.map((point) => point[1])), key = (point: Point) => `${Math.round((point[0] - minX) / grid)}:${Math.round((point[1] - minZ) / grid)}`;
  const byKey = new Map(cells.map((point) => [key(point), point])), startKey = key(start), endKey = key(end), queue = [startKey], previous = new Map<string, string | null>([[startKey, null]]);
  while (queue.length) { const currentKey = queue.shift()!; if (currentKey === endKey) break; const current = byKey.get(currentKey)!; for (const nextPoint of [[current[0] + grid, current[1]], [current[0] - grid, current[1]], [current[0], current[1] + grid], [current[0], current[1] - grid]] as Point[]) { const nextKey = key(nextPoint); if (byKey.has(nextKey) && !previous.has(nextKey)) { previous.set(nextKey, currentKey); queue.push(nextKey); } } }
  if (!previous.has(endKey)) return null;
  const result: Point[] = []; let cursor: string | null = endKey;
  while (cursor) { result.unshift(byKey.get(cursor)!); cursor = previous.get(cursor) ?? null; }
  return result;
}

const freeGridIndexCache = new WeakMap<object, { origin: Point; keys: Set<string> }>();

export function segmentIsNavigable(room: Pick<RoomNavigableSpace, "navigableFreeCells" | "gridMeters">, start: Point, end: Point) {
  if (!room.navigableFreeCells.length || room.gridMeters <= 0) return false;
  let index = freeGridIndexCache.get(room as object);
  if (!index) { const origin: Point = [Math.min(...room.navigableFreeCells.map((point) => point[0])), Math.min(...room.navigableFreeCells.map((point) => point[1]))], key = (point: Point) => `${Math.round((point[0] - origin[0]) / room.gridMeters)}:${Math.round((point[1] - origin[1]) / room.gridMeters)}`; index = { origin, keys: new Set(room.navigableFreeCells.map(key)) }; freeGridIndexCache.set(room as object, index); }
  const pointCovered = (point: Point) => { const coordinates: Point = [(point[0] - index!.origin[0]) / room.gridMeters, (point[1] - index!.origin[1]) / room.gridMeters], candidates = coordinates.map((value) => [...new Set([Math.floor(value), Math.ceil(value), Math.round(value)])].filter((candidate) => Math.abs(value - candidate) <= .5 + S1_HIGH_FREQUENCY_PATH_POINT_EPSILON_METERS)); return candidates[0]!.some((x) => candidates[1]!.some((z) => index!.keys.has(`${x}:${z}`))); };
  if (!pointCovered(start) || !pointCovered(end)) return false;
  const delta: Point = [end[0] - start[0], end[1] - start[1]], breakpoints = [0, 1];
  for (let axis = 0; axis < 2; axis++) {
    const movement = delta[axis]!; if (Math.abs(movement) <= S1_HIGH_FREQUENCY_PATH_POINT_EPSILON_METERS) continue;
    const low = Math.min(start[axis]!, end[axis]!), high = Math.max(start[axis]!, end[axis]!), origin = index.origin[axis]!, first = Math.ceil((low - origin) / room.gridMeters - .5), last = Math.floor((high - origin) / room.gridMeters - .5);
    for (let boundaryIndex = first; boundaryIndex <= last; boundaryIndex++) { const boundary = origin + (boundaryIndex + .5) * room.gridMeters, t = (boundary - start[axis]!) / movement; if (t > S1_HIGH_FREQUENCY_PATH_POINT_EPSILON_METERS && t < 1 - S1_HIGH_FREQUENCY_PATH_POINT_EPSILON_METERS) breakpoints.push(t); }
  }
  const ordered = [...new Set(breakpoints.map((value) => Math.round(value * 1e12) / 1e12))].sort((a, b) => a - b);
  return ordered.slice(1).every((endT, intervalIndex) => { const startT = ordered[intervalIndex]!, middle = (startT + endT) / 2; return pointCovered([start[0] + delta[0] * middle, start[1] + delta[1] * middle]); });
}

export function smoothNavigablePath(room: Pick<RoomNavigableSpace, "navigableFreeCells" | "gridMeters">, points: Point[]) {
  if (points.length <= 2) return [...points];
  const result: Point[] = [points[0]!]; let startIndex = 0;
  while (startIndex < points.length - 1) {
    let nextIndex = points.length - 1;
    while (nextIndex > startIndex + 1 && !segmentIsNavigable(room, points[startIndex]!, points[nextIndex]!)) nextIndex--;
    result.push(points[nextIndex]!); startIndex = nextIndex;
  }
  return result;
}

function codedSpaces(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, codes: readonly string[]) {
  const codeSet = new Set(codes), roomById = new Map(graph.roomAnalysis.rooms.map((room) => [room.roomRegionId, room])), matchByZone = new Map(graph.roomAnalysis.zoneMatches.map((match) => [match.zoneId, match])), relevant = handoff.zones.filter((zone) => isSdiSpaceFunctionCode(zone.spaceFunctionCode) && codeSet.has(zone.spaceFunctionCode));
  const invalid = relevant.filter((zone) => { const match = matchByZone.get(zone.id), roomId = match?.matchedRoomRegionIds.length === 1 ? match.matchedRoomRegionIds[0] : null; return !roomId || !roomById.get(roomId)?.usableForEvaluation || !reliableZoneMatch(match?.relationship); });
  const byRoom = new Map<string, typeof relevant>();
  relevant.filter((zone) => !invalid.includes(zone)).forEach((zone) => { const roomId = matchByZone.get(zone.id)!.matchedRoomRegionIds[0]!; byRoom.set(roomId, [...(byRoom.get(roomId) ?? []), zone]); });
  return { spaces: [...byRoom.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([roomRegionId, zones]): S1HighFrequencyPathSpaceRef => { const room = roomById.get(roomRegionId)!; return { roomRegionId, levelId: room.levelId, zoneIds: zones.map((zone) => zone.id).sort(), zoneNames: zones.map((zone) => zone.name?.trim() || zone.id), spaceFunctionCodes: [...new Set(zones.map((zone) => zone.spaceFunctionCode!))].sort(), confidence: lowerConfidence([room.confidence, ...zones.map((zone) => matchByZone.get(zone.id)!.confidence)]) }; }), invalid };
}

function roomSpaceRef(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, roomRegionId: string): S1HighFrequencyPathSpaceRef {
  const room = graph.roomAnalysis.rooms.find((candidate) => candidate.roomRegionId === roomRegionId), zoneIds = graph.roomAnalysis.roomToZoneIds[roomRegionId] ?? [], zones = zoneIds.map((id) => handoff.zones.find((zone) => zone.id === id)).filter((zone): zone is EvaluationHandoff["zones"][number] => Boolean(zone));
  return { roomRegionId, levelId: room?.levelId ?? "", zoneIds: zones.map((zone) => zone.id).sort(), zoneNames: zones.map((zone) => zone.name?.trim() || zone.id), spaceFunctionCodes: [...new Set(zones.flatMap((zone) => isSdiSpaceFunctionCode(zone.spaceFunctionCode) ? [zone.spaceFunctionCode] : []))].sort(), confidence: room?.confidence ?? "low" };
}

function shortestRoute(candidates: S1HighFrequencyPathMeasurement[]) {
  return [...candidates].sort((a, b) => {
    if (a.status === "measured" && b.status !== "measured") return -1;
    if (a.status !== "measured" && b.status === "measured") return 1;
    if (a.actualPathLengthMeters !== null && b.actualPathLengthMeters !== null && Math.abs(a.actualPathLengthMeters - b.actualPathLengthMeters) > S1_HIGH_FREQUENCY_PATH_EQUAL_LENGTH_TOLERANCE_METERS) return a.actualPathLengthMeters - b.actualPathLengthMeters;
    return (a.selectedTargetZoneId ?? "").localeCompare(b.selectedTargetZoneId ?? "") || a.routeId.localeCompare(b.routeId);
  })[0] ?? null;
}

function fallbackNameExists(handoff: EvaluationHandoff, semantics: string[]) { const wanted = new Set(semantics); return handoff.zones.some((zone) => { const resolution = resolveZoneFunctionalSemantics(zone); return resolution.semanticSource === "name_fallback" && [...resolution.semantics].some((semantic) => wanted.has(semantic)); }); }
function unresolvedRoute(group: S1HighFrequencyPathRouteGroup, label: string, status: "unable_to_determine" | "not_applicable", diagnostics: string[], routeSuffix: string = status, behaviorSources: S1HighFrequencyPathMeasurement["behaviorSources"] = []): S1HighFrequencyPathMeasurement {
  return { metricId: S1_HIGH_FREQUENCY_PATH_METRIC_ID, routeId: `${S1_HIGH_FREQUENCY_PATH_METRIC_ID}-${group}-${routeSuffix}`, routeGroup: group, routeLabel: label, source: null, target: null, sourceRoomRegionId: null, targetRoomRegionId: null, sourceZoneIds: [], targetZoneIds: [], sourceSpaceFunctionCodes: [], targetSpaceFunctionCodes: [], roomPathIds: [], doorIds: [], stairIds: [], pathPoints: [], actualPathLengthMeters: null, straightLineDistanceMeters: null, detourRatio: null, topologicalSteps: null, intermediateRoomCount: null, turnCount: null, sourceLevelId: null, targetLevelId: null, sourceAnchorPoint: null, targetAnchorPoint: null, sourceAnchorType: null, targetAnchorType: null, sourceBehaviorObjectIds: [], targetBehaviorObjectIds: [], behaviorSources, selectedTargetZoneId: null, selectedTargetSpaceFunctionCode: null, pathProvider: S1_PATHFINDING_PROVIDER, independentGeometryValidated: false, sourceZoneAnchorPoints: [], targetZoneAnchorPoints: [], pathSmoothed: false, rawPathPointCount: 0, debugTrace: null, fallbackTargetUsed: false, tiedCandidateTargetRoomIds: [], status, confidence: "low", diagnostics, missingData: status === "unable_to_determine" ? diagnostics : [] };
}

function measureCandidate(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, navigation: RoomNavigationAnalysis, group: S1HighFrequencyPathRouteGroup, label: string, source: S1HighFrequencyPathSpaceRef, target: S1HighFrequencyPathSpaceRef, sourceSet: S1AnchorSet, targetSet: S1AnchorSet, routeSuffix = "", behaviorSources: S1HighFrequencyPathMeasurement["behaviorSources"] = []): S1HighFrequencyPathMeasurement {
  const suffix = routeSuffix ? `-${routeSuffix}` : "";
  const base = { metricId: S1_HIGH_FREQUENCY_PATH_METRIC_ID, routeId: `${S1_HIGH_FREQUENCY_PATH_METRIC_ID}-${group}-${source.roomRegionId}-${target.roomRegionId}${suffix}`, routeGroup: group, routeLabel: label, source, target, sourceRoomRegionId: source.roomRegionId, targetRoomRegionId: target.roomRegionId, sourceZoneIds: source.zoneIds, targetZoneIds: target.zoneIds, sourceSpaceFunctionCodes: source.spaceFunctionCodes, targetSpaceFunctionCodes: target.spaceFunctionCodes, sourceLevelId: source.levelId, targetLevelId: target.levelId, fallbackTargetUsed: false, tiedCandidateTargetRoomIds: [] as string[], behaviorSources, selectedTargetZoneId: null as string | null, selectedTargetSpaceFunctionCode: null as string | null, pathProvider: S1_PATHFINDING_PROVIDER };
  if (!sourceSet.anchors.length || !targetSet.anchors.length) return { ...base, roomPathIds: [], doorIds: [], stairIds: [], pathPoints: [], actualPathLengthMeters: null, straightLineDistanceMeters: null, detourRatio: null, topologicalSteps: null, intermediateRoomCount: null, turnCount: null, sourceAnchorPoint: null, targetAnchorPoint: null, sourceAnchorType: null, targetAnchorType: null, sourceBehaviorObjectIds: sourceSet.itemIds, targetBehaviorObjectIds: targetSet.itemIds, independentGeometryValidated: false, sourceZoneAnchorPoints: sourceSet.zoneAnchors, targetZoneAnchorPoints: targetSet.zoneAnchors, pathSmoothed: false, rawPathPointCount: 0, debugTrace: null, status: "unable_to_determine", confidence: "low", diagnostics: [...sourceSet.diagnostics, ...targetSet.diagnostics], missingData: [...sourceSet.missingData, ...targetSet.missingData] };
  const outcome = findS1GlobalShortestPath(handoff, graph, navigation, sourceSet.anchors, targetSet.anchors), measured = outcome.status === "measured" && outcome.sourceAnchor && outcome.targetAnchor && outcome.lengthMeters !== null;
  const legacyGridSegments = measured ? outcome.roomSegments.flatMap((segment) => { const room = navigation.rooms.find((item) => item.roomRegionId === segment.roomRegionId), start = segment.points[0], end = segment.points[segment.points.length - 1]; if (!room || !start || !end) return []; const points = freeCellPath(room, start, end); return points?.length ? [{ roomRegionId: segment.roomRegionId, levelId: segment.levelId, points }] : []; }) : [];
  const debugTrace = measured ? { roomTopology: outcome.roomPathIds.map((roomRegionId) => ({ roomRegionId, levelId: graph.roomAnalysis.rooms.find((room) => room.roomRegionId === roomRegionId)?.levelId ?? "" })), rawGridSegments: legacyGridSegments, smoothedSegments: outcome.roomSegments.map((segment) => ({ roomRegionId: segment.roomRegionId, levelId: segment.levelId, points: segment.points })), portalPoints: outcome.edges.flatMap((edge) => {
    const before = outcome.roomSegments.find((segment) => segment.roomRegionId === edge.fromNodeId), after = outcome.roomSegments.find((segment) => segment.roomRegionId === edge.toNodeId);
    return [{ [edge.connectionType === "door" ? "doorId" : "stairId"]: edge.sourceObjectId, levelId: before?.levelId ?? edge.levelId ?? "", point: before?.points[before.points.length - 1] ?? outcome.sourceAnchor!.point }, { [edge.connectionType === "door" ? "doorId" : "stairId"]: edge.sourceObjectId, levelId: after?.levelId ?? edge.levelId ?? "", point: after?.points[0] ?? outcome.targetAnchor!.point }];
  }) } satisfies S1HighFrequencyPathDebugTrace : null;
  if (!measured) return { ...base, roomPathIds: outcome.roomPathIds, doorIds: outcome.doorIds, stairIds: outcome.stairIds, pathPoints: [], actualPathLengthMeters: null, straightLineDistanceMeters: null, detourRatio: null, topologicalSteps: outcome.edges.length || null, intermediateRoomCount: outcome.roomPathIds.length ? Math.max(0, outcome.roomPathIds.length - 2) : null, turnCount: null, sourceAnchorPoint: null, targetAnchorPoint: null, sourceAnchorType: null, targetAnchorType: null, sourceBehaviorObjectIds: sourceSet.itemIds, targetBehaviorObjectIds: targetSet.itemIds, independentGeometryValidated: false, sourceZoneAnchorPoints: sourceSet.zoneAnchors, targetZoneAnchorPoints: targetSet.zoneAnchors, pathSmoothed: false, rawPathPointCount: 0, debugTrace, status: outcome.status, confidence: outcome.confidence, diagnostics: [...sourceSet.diagnostics, ...targetSet.diagnostics, ...outcome.diagnostics], missingData: outcome.missingData };
  const sourceAnchor = outcome.sourceAnchor!, targetAnchor = outcome.targetAnchor!, actualLength = outcome.lengthMeters!, straight = sourceAnchor.levelId === targetAnchor.levelId ? distance(sourceAnchor.point, targetAnchor.point) : null;
  const selectedZone = targetAnchor.zoneId ? handoff.zones.find((zone) => zone.id === targetAnchor.zoneId) : null;
  return { ...base, sourceRoomRegionId: sourceAnchor.roomRegionId, targetRoomRegionId: targetAnchor.roomRegionId, sourceLevelId: sourceAnchor.levelId, targetLevelId: targetAnchor.levelId, selectedTargetZoneId: targetAnchor.zoneId ?? target.zoneIds[0] ?? null, selectedTargetSpaceFunctionCode: selectedZone?.spaceFunctionCode ?? target.spaceFunctionCodes[0] ?? null, roomPathIds: outcome.roomPathIds, doorIds: outcome.doorIds, stairIds: outcome.stairIds, pathPoints: outcome.pathPoints, actualPathLengthMeters: round(actualLength), straightLineDistanceMeters: straight === null ? null : round(straight), detourRatio: straight !== null && straight > S1_HIGH_FREQUENCY_PATH_POINT_EPSILON_METERS ? round(actualLength / straight) : null, topologicalSteps: outcome.edges.length, intermediateRoomCount: Math.max(0, outcome.roomPathIds.length - 2), turnCount: countPathTurns(outcome.pathPoints), sourceAnchorPoint: sourceAnchor.point, targetAnchorPoint: targetAnchor.point, sourceAnchorType: sourceAnchor.anchorType, targetAnchorType: targetAnchor.anchorType, sourceBehaviorObjectIds: sourceAnchor.sourceObjectId ? [sourceAnchor.sourceObjectId] : sourceSet.itemIds, targetBehaviorObjectIds: targetAnchor.sourceObjectId ? [targetAnchor.sourceObjectId] : targetSet.itemIds, independentGeometryValidated: true, sourceZoneAnchorPoints: sourceSet.zoneAnchors, targetZoneAnchorPoints: targetSet.zoneAnchors, pathSmoothed: false, rawPathPointCount: 0, debugTrace, status: "measured", confidence: lowerConfidence([source.confidence, target.confidence, outcome.confidence]), diagnostics: [...sourceSet.diagnostics, ...targetSet.diagnostics, ...outcome.diagnostics, "正式路径由 Polygon Visibility Graph + deterministic Dijkstra 生成；未使用旧网格 BFS。"], missingData: outcome.missingData };
}

function chooseBathroom(candidates: S1HighFrequencyPathMeasurement[], primary: boolean) {
  const primaryCandidates = primary ? candidates.filter((route) => route.targetSpaceFunctionCodes.includes("SF03")) : [], preferred = primaryCandidates.some((route) => route.status === "measured") ? primaryCandidates : candidates.filter((route) => !route.targetSpaceFunctionCodes.includes("SF03"));
  const measured = preferred.filter((route) => route.status === "measured" && route.actualPathLengthMeters !== null).sort((a, b) => a.actualPathLengthMeters! - b.actualPathLengthMeters! || a.targetRoomRegionId!.localeCompare(b.targetRoomRegionId!));
  const selected = measured[0] ?? preferred.sort((a, b) => a.routeId.localeCompare(b.routeId))[0] ?? candidates.sort((a, b) => a.routeId.localeCompare(b.routeId))[0];
  if (!selected) return null;
  const ties = measured.filter((route) => Math.abs(route.actualPathLengthMeters! - measured[0]!.actualPathLengthMeters!) <= S1_HIGH_FREQUENCY_PATH_EQUAL_LENGTH_TOLERANCE_METERS).map((route) => route.targetRoomRegionId!).sort();
  return { ...selected, fallbackTargetUsed: primary && !selected.targetSpaceFunctionCodes.includes("SF03"), tiedCandidateTargetRoomIds: ties.length > 1 ? ties : [], diagnostics: [...selected.diagnostics, ...(primary && !selected.targetSpaceFunctionCodes.includes("SF03") ? ["主卫不可达或不存在，已回退到其他可用卫生间。"] : []), ...(ties.length > 1 ? [`${ties.length} 个卫生间路径等长，按稳定 RoomRegion ID 排序选择。`] : [])] };
}

export function measureS1HighFrequencyPaths(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, navigation?: RoomNavigationAnalysis): S1HighFrequencyPathReport {
  let resolvedNavigation = navigation, navigationResolved = Boolean(navigation);
  const getNavigation = () => {
    if (!navigationResolved) {
      navigationResolved = true;
      try {
        resolvedNavigation = buildRoomNavigationAnalysis(handoff);
      } catch {
        resolvedNavigation = { graph, obstacles: [], rooms: [], diagnostics: [] };
      }
    }
    return resolvedNavigation!;
  };
  const measurements: S1HighFrequencyPathMeasurement[] = [], groups: S1HighFrequencyPathGroupSummary[] = [];
  for (const config of S1_HIGH_FREQUENCY_PATH_ROUTE_GROUPS) {
    const group = config.routeGroup, groupMeasurements: S1HighFrequencyPathMeasurement[] = []; let invalid: EvaluationHandoff["zones"] = [];
    if (group === "entry_to_kitchen") {
      const kitchen = codedSpaces(handoff, graph, config.targetCodes), sourceSet = resolveS1PrimaryEntranceAnchors(handoff, graph, getNavigation()); invalid = kitchen.invalid;
      if (!sourceSet.anchors.length) groupMeasurements.push(unresolvedRoute(group, config.label, "unable_to_determine", sourceSet.diagnostics, "primary-entry", ["primary_entry"]));
      else if (!kitchen.spaces.length) {
        const fallback = fallbackNameExists(handoff, ["kitchen"]);
        if (fallback) groupMeasurements.push(unresolvedRoute(group, config.label, "unable_to_determine", ["厨房只有名称回退语义，不能形成正式 S1-HPE 测量。"], "primary-entry", ["primary_entry"]));
      } else {
        const source = roomSpaceRef(handoff, graph, sourceSet.anchors[0]!.roomRegionId), candidates = kitchen.spaces.map((target) => measureCandidate(handoff, graph, getNavigation(), group, config.label, source, target, sourceSet, resolveS1KitchenRegionAnchors(handoff, graph, getNavigation(), target), "primary-entry", ["primary_entry"])), selected = shortestRoute(candidates);
        if (selected) groupMeasurements.push({ ...selected, diagnostics: [...selected.diagnostics, ...(candidates.length > 1 ? [`${candidates.length} 个正式 Kitchen Zone/Room 候选按完整二维路径选择最短者。`] : [])] });
      }
    } else if (group === "garage_to_kitchen") {
      const garage = codedSpaces(handoff, graph, config.sourceCodePriority[0]), kitchen = codedSpaces(handoff, graph, config.targetCodes); invalid = [...garage.invalid, ...kitchen.invalid];
      if (garage.spaces.length && kitchen.spaces.length) {
        const candidates = garage.spaces.flatMap((garageSpace) => {
          const sourceSet = resolveS1GarageResidenceAnchors(handoff, graph, getNavigation(), garageSpace);
          if (!sourceSet.anchors.length) return [];
          const source = roomSpaceRef(handoff, graph, sourceSet.anchors[0]!.roomRegionId);
          return kitchen.spaces.map((target) => measureCandidate(handoff, graph, getNavigation(), group, config.label, source, target, sourceSet, resolveS1KitchenRegionAnchors(handoff, graph, getNavigation(), target), `garage-${garageSpace.roomRegionId}`, ["garage_return"]));
        }), selected = shortestRoute(candidates);
        if (selected) groupMeasurements.push({ ...selected, diagnostics: [...selected.diagnostics, ...(candidates.length > 1 ? [`${candidates.length} 个 Garage Door→Kitchen 候选按完整二维路径选择最短者。`] : [])] });
      } else if (fallbackNameExists(handoff, ["garage", "kitchen"])) groupMeasurements.push(unresolvedRoute(group, config.label, "unable_to_determine", ["关键空间只有名称回退语义，不能形成正式 S1-HPE 测量。"], "garage", ["garage_return"]));
    } else {
      const bedroom = codedSpaces(handoff, graph, config.sourceCodePriority[0]), bathroom = codedSpaces(handoff, graph, config.targetCodes);
      invalid = [...bedroom.invalid, ...bathroom.invalid];
      bedroom.spaces.forEach((source) => {
        const beds = bedItemsForS1Bedroom(handoff, source), primary = source.spaceFunctionCodes.includes("SF11"), targets = bathroom.spaces.filter((target) => primary || !target.spaceFunctionCodes.includes("SF03"));
        if (!beds.length) { groupMeasurements.push(unresolvedRoute(group, config.label, "unable_to_determine", [`${source.zoneNames.join("/")} 没有可由正式 functionTags 识别的床。`], `bed-missing-${source.roomRegionId}`, ["bedroom"])); return; }
        beds.forEach((bed) => {
          const sourceSet = resolveS1BedEdgeAnchors(handoff, graph, getNavigation(), source, bed.id);
          if (!sourceSet.anchors.length) { const unresolved = unresolvedRoute(group, config.label, "unable_to_determine", sourceSet.diagnostics, `bed-${bed.id}`, ["bedroom"]); unresolved.sourceBehaviorObjectIds = [bed.id]; groupMeasurements.push(unresolved); return; }
          const selected = chooseBathroom(targets.map((target) => measureCandidate(handoff, graph, getNavigation(), group, config.label, source, target, sourceSet, resolveS1BathroomEntranceAnchors(handoff, graph, getNavigation(), target), `bed-${bed.id}`, ["bedroom"])), primary);
          if (selected) groupMeasurements.push(selected);
        });
      });
      if (!groupMeasurements.length && fallbackNameExists(handoff, ["bedroom", "bathroom", "primary_bedroom", "primary_bathroom"])) groupMeasurements.push(unresolvedRoute(group, config.label, "unable_to_determine", ["关键空间只有名称回退语义，不能形成正式 S1-HPE 测量。"]));
    }
    if (invalid.length) groupMeasurements.splice(0, groupMeasurements.length, unresolvedRoute(group, config.label, "unable_to_determine", [`${invalid.map((zone) => zone.name ?? zone.id).join("、")} 无法可靠映射到 RoomRegion。`]));
    if (!groupMeasurements.length) { groups.push({ routeGroup: group, label: config.label, status: "not_applicable", routeCount: 0, diagnostics: [group === "garage_to_kitchen" ? "缺少具有可靠住宅内部连接的车库或厨房。" : "缺少该路线组所需的正式编码空间。"] }); continue; }
    measurements.push(...groupMeasurements); const unable = groupMeasurements.some((route) => route.status === "unable_to_determine"); groups.push({ routeGroup: group, label: config.label, status: unable ? "unable_to_determine" : "measured", routeCount: groupMeasurements.length, diagnostics: unable ? groupMeasurements.flatMap((route) => route.diagnostics) : [] });
  }
  const primaryRoutes = measurements.filter((route) => route.behaviorSources.includes("primary_entry") && route.status === "measured"), garageRoutes = measurements.filter((route) => route.behaviorSources.includes("garage_return") && route.status === "measured");
  for (const garageRoute of garageRoutes) {
    const duplicate = primaryRoutes.find((primaryRoute) => primaryRoute.sourceBehaviorObjectIds[0] && primaryRoute.sourceBehaviorObjectIds[0] === garageRoute.sourceBehaviorObjectIds[0] && primaryRoute.selectedTargetZoneId === garageRoute.selectedTargetZoneId && primaryRoute.sourceAnchorPoint && garageRoute.sourceAnchorPoint && distance(primaryRoute.sourceAnchorPoint, garageRoute.sourceAnchorPoint) <= S1_HIGH_FREQUENCY_PATH_POINT_EPSILON_METERS);
    if (!duplicate) continue;
    duplicate.behaviorSources = ["primary_entry", "garage_return"];
    duplicate.diagnostics.push("该 Door 同时是主要入口与 Garage→Residence 入口；重复归家行为已合并为一条正式测量。");
    measurements.splice(measurements.indexOf(garageRoute), 1);
    const garageGroup = groups.find((item) => item.routeGroup === "garage_to_kitchen");
    if (garageGroup) { garageGroup.routeCount = 0; garageGroup.status = "measured"; garageGroup.diagnostics = [`由路线 ${duplicate.routeId} 同时覆盖 garage_return 行为，未重复生成权重。`]; }
  }
  const measured = measurements.filter((route) => route.status === "measured"), average = (values: number[]) => values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  return { metricId: S1_HIGH_FREQUENCY_PATH_METRIC_ID, metricName: S1_HIGH_FREQUENCY_PATH_METRIC_NAME, measurementVersion: S1_HIGH_FREQUENCY_PATH_VERSION, measurementStatus: S1_HIGH_FREQUENCY_PATH_STATUS, measurements, groups, counts: { measured: measured.length, baselineUnreachable: measurements.filter((route) => route.status === "baseline_unreachable").length, unableToDetermine: measurements.filter((route) => route.status === "unable_to_determine").length, notApplicableRouteGroups: groups.filter((group) => group.status === "not_applicable").length }, averages: { actualPathLengthMeters: average(measured.flatMap((route) => route.actualPathLengthMeters === null ? [] : [route.actualPathLengthMeters])), topologicalSteps: average(measured.flatMap((route) => route.topologicalSteps === null ? [] : [route.topologicalSteps])), turnCount: average(measured.flatMap((route) => route.turnCount === null ? [] : [route.turnCount])) } };
}
