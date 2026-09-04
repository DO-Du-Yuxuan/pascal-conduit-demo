import type { EvaluationHandoff } from "../../parser/evaluation-handoff";
import type { ConnectivityConfidence, ConnectivityEdge, DoorPortal, RoomConnectivityGraph } from "../connectivity";
import type { Point } from "../envelope";
import type { RoomNavigationAnalysis } from "../navigation";
import type { RoomRegion } from "../room-regions";
import { S1_PATHFINDING_AGENT_RADIUS_METERS, S1_PATHFINDING_GEOMETRY_EPSILON_METERS } from "./s1-pathfinding-config";
import { validateS1RoomPath } from "./s1-path-validation";
import { closestS1WalkablePointWithinRings, resolveS1Anchor, S1VisibilityGraph } from "./s1-visibility-graph";
import { buildS1RoomWalkableGeometry, s1PathPointKey, type S1RoomWalkableGeometry } from "./s1-walkable-geometry";

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const centroid = (points: Point[]): Point => [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
const confidenceRank = { low: 0, medium: 1, high: 2 } as const;
const lowerConfidence = (values: ConnectivityConfidence[]) => values.reduce<ConnectivityConfidence>((lowest, value) => confidenceRank[value] < confidenceRank[lowest] ? value : lowest, "high");

export type S1BehaviorAnchorType = "zone_representative" | "kitchen_zone_entry" | "bed_edge" | "bathroom_entrance" | "primary_entrance_landing" | "garage_residence_landing" | "door_portal" | "stair_landing";
export type S1GlobalPathAnchor = { id: string; roomRegionId: string; levelId: string; point: Point; anchorType: S1BehaviorAnchorType; sourceObjectId?: string; zoneId?: string };
export type S1GlobalRoomSegment = { roomRegionId: string; levelId: string; points: Point[]; validationDiagnostics: string[] };
export type S1GlobalPathResult = {
  status: "measured" | "baseline_unreachable" | "unable_to_determine";
  sourceAnchor: S1GlobalPathAnchor | null;
  targetAnchor: S1GlobalPathAnchor | null;
  pathPoints: Array<{ levelId: string; point: Point }>;
  roomPathIds: string[];
  edges: ConnectivityEdge[];
  doorIds: string[];
  stairIds: string[];
  roomSegments: S1GlobalRoomSegment[];
  lengthMeters: number | null;
  confidence: ConnectivityConfidence;
  diagnostics: string[];
  missingData: string[];
};

type GlobalNode = S1GlobalPathAnchor & { kind: "behavior" | "portal" | "stair" };
type GlobalEdge = { id: string; from: string; to: string; weight: number; points: Array<{ levelId: string; point: Point }>; roomSegment?: S1GlobalRoomSegment; connection?: ConnectivityEdge };
export type S1PathRoomProvider = { room: RoomRegion; geometry: S1RoomWalkableGeometry; visibility: S1VisibilityGraph };

export function resolveS1DoorPortalLanding(portal: DoorPortal, roomId: string, handoff: EvaluationHandoff, geometry: S1RoomWalkableGeometry): Point | null {
  if (!portal.openingCenter || !portal.openingWidthMeters || portal.openingWidthMeters + S1_PATHFINDING_GEOMETRY_EPSILON_METERS < S1_PATHFINDING_AGENT_RADIUS_METERS * 2) return null;
  const samples = portal.roomRegionAId === roomId ? portal.samplePointsA : portal.roomRegionBId === roomId ? portal.samplePointsB : [];
  if (!samples.length) return null;
  const sampleCenter = centroid(samples), vector: Point = [sampleCenter[0] - portal.openingCenter[0], sampleCenter[1] - portal.openingCenter[1]], length = Math.hypot(vector[0], vector[1]);
  const wall = portal.hostWallId ? handoff.walls.find((item) => item.id === portal.hostWallId) : null;
  if (length <= S1_PATHFINDING_GEOMETRY_EPSILON_METERS || !wall) return null;
  const landingDistance = wall.thicknessMeters / 2 + S1_PATHFINDING_AGENT_RADIUS_METERS + 0.002;
  const requested: Point = [portal.openingCenter[0] + vector[0] / length * landingDistance, portal.openingCenter[1] + vector[1] / length * landingDistance];
  return resolveS1Anchor(requested, geometry.walkablePolygons)?.point ?? null;
}

function stairLanding(edge: ConnectivityEdge, roomId: string, handoff: EvaluationHandoff, graph: RoomConnectivityGraph, geometry: S1RoomWalkableGeometry): Point | null {
  const connection = graph.stairConnections.find((item) => item.stairId === edge.sourceObjectId), stair = handoff.stairs.find((item) => item.id === edge.sourceObjectId);
  if (!connection || !stair) return null;
  const from = connection.fromRoomRegionId === roomId, center = from ? stair.fromLandingCenter : connection.toRoomRegionId === roomId ? stair.toLandingCenter : null, outward = from ? stair.fromLandingOutward : stair.toLandingOutward;
  if (!center) return null;
  const requested: Point = outward ? [center[0] + outward[0] * (S1_PATHFINDING_AGENT_RADIUS_METERS + 0.002), center[1] + outward[1] * (S1_PATHFINDING_AGENT_RADIUS_METERS + 0.002)] : center;
  return resolveS1Anchor(requested, geometry.walkablePolygons)?.point ?? null;
}

function stairLength(edge: ConnectivityEdge, handoff: EvaluationHandoff) {
  const stair = handoff.stairs.find((item) => item.id === edge.sourceObjectId);
  if (!stair) return null;
  const run = stair.treadDepthsAtWalklineMeters?.reduce((sum, value) => sum + value, 0) ?? (stair.fromLandingCenter && stair.toLandingCenter ? distance(stair.fromLandingCenter, stair.toLandingCenter) : null), rise = stair.totalRiseMeters;
  return run !== null && typeof rise === "number" && Number.isFinite(rise) ? Math.hypot(run, rise) : null;
}

export function resolveS1ZoneAnchor(room: RoomRegion, geometry: S1RoomWalkableGeometry, zones: Array<{ id: string; outline: Point[] }>, representative: Point): S1GlobalPathAnchor | null {
  const point = closestS1WalkablePointWithinRings(representative, zones.map((zone) => zone.outline), geometry.walkablePolygons);
  return point ? { id: `zone:${zones.map((zone) => zone.id).sort().join("+")}`, roomRegionId: room.roomRegionId, levelId: room.levelId, point, anchorType: "zone_representative", zoneId: zones.map((zone) => zone.id).sort().join("+") } : null;
}

const providerCache = new WeakMap<object, Map<string, S1PathRoomProvider>>();
export function buildS1PathRoomProviders(graph: RoomConnectivityGraph, navigation: RoomNavigationAnalysis) {
  const cached = providerCache.get(navigation as object);
  if (cached) return cached;
  const providers = new Map<string, S1PathRoomProvider>();
  for (const room of graph.roomAnalysis.rooms.filter((item) => item.usableForEvaluation)) {
    const geometry = buildS1RoomWalkableGeometry(room, navigation.obstacles);
    if (geometry.walkablePolygons.length) providers.set(room.roomRegionId, { room, geometry, visibility: new S1VisibilityGraph(geometry.walkablePolygons) });
  }
  providerCache.set(navigation as object, providers);
  return providers;
}

export function findS1GlobalShortestPath(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, navigation: RoomNavigationAnalysis, sourceAnchors: S1GlobalPathAnchor[], targetAnchors: S1GlobalPathAnchor[]): S1GlobalPathResult {
  const roomIds = new Set(graph.nodes.filter((node) => node.nodeType === "room").map((node) => node.nodeId)), topologyReachable = (() => {
    const targetRooms = new Set(targetAnchors.map((item) => item.roomRegionId)), queue = [...new Set(sourceAnchors.map((item) => item.roomRegionId))], visited = new Set(queue);
    while (queue.length) { const current = queue.shift()!; for (const edge of graph.edges) { const next = edge.fromNodeId === current ? edge.toNodeId : edge.toNodeId === current ? edge.fromNodeId : null; if (next && roomIds.has(next) && !visited.has(next)) { visited.add(next); queue.push(next); } } }
    return [...targetRooms].some((id) => visited.has(id));
  })();
  if (!topologyReachable) return { status: "baseline_unreachable", sourceAnchor: null, targetAnchor: null, pathPoints: [], roomPathIds: [], edges: [], doorIds: [], stairIds: [], roomSegments: [], lengthMeters: null, confidence: "low", diagnostics: ["起点与目的空间在 RoomConnectivityGraph 中不可达。"], missingData: [] };
  const providers = buildS1PathRoomProviders(graph, navigation), nodes = new Map<string, GlobalNode>(), globalEdges: GlobalEdge[] = [], diagnostics: string[] = [], missingData: string[] = [];
  const addNode = (node: GlobalNode) => { if (providers.has(node.roomRegionId)) nodes.set(node.id, node); else missingData.push(`${node.roomRegionId}: clearance 后可通行多边形`); };
  sourceAnchors.forEach((anchor) => addNode({ ...anchor, kind: "behavior" }));
  targetAnchors.forEach((anchor) => addNode({ ...anchor, kind: "behavior" }));
  const legalConnections = graph.edges.filter((edge) => roomIds.has(edge.fromNodeId) && roomIds.has(edge.toNodeId)).sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  for (const edge of legalConnections) {
    const fromProvider = providers.get(edge.fromNodeId), toProvider = providers.get(edge.toNodeId);
    if (!fromProvider || !toProvider) continue;
    let fromPoint: Point | null = null, toPoint: Point | null = null, weight: number | null = null;
    if (edge.connectionType === "door") {
      const portal = graph.portals.find((item) => item.doorId === edge.sourceObjectId);
      if (portal) { fromPoint = resolveS1DoorPortalLanding(portal, edge.fromNodeId, handoff, fromProvider.geometry); toPoint = resolveS1DoorPortalLanding(portal, edge.toNodeId, handoff, toProvider.geometry); weight = fromPoint && toPoint ? distance(fromPoint, toPoint) : null; }
    } else if (edge.connectionType === "stair") {
      fromPoint = stairLanding(edge, edge.fromNodeId, handoff, graph, fromProvider.geometry); toPoint = stairLanding(edge, edge.toNodeId, handoff, graph, toProvider.geometry); weight = stairLength(edge, handoff);
    }
    if (!fromPoint || !toPoint || weight === null) continue;
    const fromId = `${edge.edgeId}:${edge.fromNodeId}`, toId = `${edge.edgeId}:${edge.toNodeId}`;
    addNode({ id: fromId, roomRegionId: edge.fromNodeId, levelId: fromProvider.room.levelId, point: fromPoint, anchorType: edge.connectionType === "door" ? "door_portal" : "stair_landing", sourceObjectId: edge.sourceObjectId, kind: edge.connectionType === "door" ? "portal" : "stair" });
    addNode({ id: toId, roomRegionId: edge.toNodeId, levelId: toProvider.room.levelId, point: toPoint, anchorType: edge.connectionType === "door" ? "door_portal" : "stair_landing", sourceObjectId: edge.sourceObjectId, kind: edge.connectionType === "door" ? "portal" : "stair" });
    globalEdges.push({ id: `cross:${edge.edgeId}`, from: fromId, to: toId, weight, points: [{ levelId: fromProvider.room.levelId, point: fromPoint }, { levelId: toProvider.room.levelId, point: toPoint }], connection: edge });
  }
  const nodesByRoom = new Map<string, GlobalNode[]>();
  [...nodes.values()].forEach((node) => nodesByRoom.set(node.roomRegionId, [...(nodesByRoom.get(node.roomRegionId) ?? []), node]));
  const adjacency = new Map<string, Array<{ edge: GlobalEdge; next: string; reversed: boolean }>>();
  for (const edge of globalEdges) { adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), { edge, next: edge.to, reversed: false }]); adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), { edge, next: edge.from, reversed: true }]); }
  adjacency.forEach((items) => items.sort((a, b) => a.edge.id.localeCompare(b.edge.id) || a.next.localeCompare(b.next)));
  const sourceIds = sourceAnchors.map((item) => item.id).filter((id) => nodes.has(id)).sort(), targetIds = new Set(targetAnchors.map((item) => item.id).filter((id) => nodes.has(id)));
  const distances = new Map<string, number>(), signatures = new Map<string, string>(), previous = new Map<string, { nodeId: string; edge: GlobalEdge; reversed: boolean }>(), visited = new Set<string>();
  sourceIds.forEach((id) => { distances.set(id, 0); signatures.set(id, id); });
  let selectedTarget: string | null = null;
  while (true) {
    const current = [...nodes.keys()].filter((id) => !visited.has(id) && Number.isFinite(distances.get(id))).sort((a, b) => (distances.get(a)! - distances.get(b)!) || (signatures.get(a) ?? a).localeCompare(signatures.get(b) ?? b))[0];
    if (!current) break;
    if (targetIds.has(current)) { selectedTarget = current; break; }
    visited.add(current);
    const currentNode = nodes.get(current)!, provider = providers.get(currentNode.roomRegionId)!;
    const roomSteps: Array<{ edge: GlobalEdge; next: string; reversed: boolean }> = [];
    for (const nextNode of (nodesByRoom.get(currentNode.roomRegionId) ?? []).filter((item) => item.id !== current).sort((a, b) => a.id.localeCompare(b.id))) {
      const path = provider.visibility.findPath(currentNode.point, nextNode.point);
      if (!path) continue;
      const validation = validateS1RoomPath(path.points, provider.geometry, S1_PATHFINDING_AGENT_RADIUS_METERS);
      if (!validation.valid) continue;
      const edge: GlobalEdge = { id: `room:${currentNode.roomRegionId}:${current}:${nextNode.id}`, from: current, to: nextNode.id, weight: path.lengthMeters, points: path.points.map((point) => ({ levelId: provider.room.levelId, point })), roomSegment: { roomRegionId: currentNode.roomRegionId, levelId: provider.room.levelId, points: path.points, validationDiagnostics: validation.diagnostics } };
      roomSteps.push({ edge, next: nextNode.id, reversed: false });
    }
    for (const step of [...(adjacency.get(current) ?? []), ...roomSteps].sort((a, b) => a.edge.id.localeCompare(b.edge.id) || a.next.localeCompare(b.next))) {
      const candidate = distances.get(current)! + step.edge.weight, signature = `${signatures.get(current)}>${step.edge.id}>${step.next}`, existing = distances.get(step.next) ?? Infinity;
      if (candidate < existing - 1e-9 || Math.abs(candidate - existing) <= 1e-9 && signature.localeCompare(signatures.get(step.next) ?? "~") < 0) { distances.set(step.next, candidate); signatures.set(step.next, signature); previous.set(step.next, { nodeId: current, edge: step.edge, reversed: step.reversed }); }
    }
  }
  if (!selectedTarget) return { status: "unable_to_determine", sourceAnchor: null, targetAnchor: null, pathPoints: [], roomPathIds: [], edges: [], doorIds: [], stairIds: [], roomSegments: [], lengthMeters: null, confidence: "low", diagnostics: ["RoomConnectivityGraph 可达，但合法 Portal landing 与通过独立几何复核的房内 Visibility Graph 无法组成完整路线。"], missingData: [...new Set(missingData)].sort() };
  const traversed: Array<{ edge: GlobalEdge; reversed: boolean }> = []; let cursor = selectedTarget;
  while (!sourceIds.includes(cursor)) { const step = previous.get(cursor); if (!step) break; traversed.unshift({ edge: step.edge, reversed: step.reversed }); cursor = step.nodeId; }
  const selectedSource = nodes.get(cursor)!, selectedTargetNode = nodes.get(selectedTarget)!, pathPoints: Array<{ levelId: string; point: Point }> = [], roomSegments: S1GlobalRoomSegment[] = [], connections: ConnectivityEdge[] = [];
  for (const step of traversed) {
    const points = step.reversed ? [...step.edge.points].reverse() : step.edge.points;
    for (const point of points) { const previousPoint = pathPoints[pathPoints.length - 1]; if (!previousPoint || previousPoint.levelId !== point.levelId || distance(previousPoint.point, point.point) > S1_PATHFINDING_GEOMETRY_EPSILON_METERS) pathPoints.push(point); }
    if (step.edge.roomSegment) roomSegments.push({ ...step.edge.roomSegment, points: step.reversed ? [...step.edge.roomSegment.points].reverse() : step.edge.roomSegment.points });
    if (step.edge.connection) connections.push(step.edge.connection);
  }
  const roomPathIds: string[] = [];
  const addRoom = (id: string) => { if (roomPathIds[roomPathIds.length - 1] !== id) roomPathIds.push(id); };
  addRoom(selectedSource.roomRegionId); connections.forEach((edge) => addRoom(edge.fromNodeId === roomPathIds[roomPathIds.length - 1] ? edge.toNodeId : edge.fromNodeId));
  return { status: "measured", sourceAnchor: selectedSource, targetAnchor: selectedTargetNode, pathPoints, roomPathIds, edges: connections, doorIds: connections.filter((edge) => edge.connectionType === "door").map((edge) => edge.sourceObjectId), stairIds: connections.filter((edge) => edge.connectionType === "stair").map((edge) => edge.sourceObjectId), roomSegments, lengthMeters: distances.get(selectedTarget)!, confidence: lowerConfidence([selectedSource.anchorType === "zone_representative" ? "high" : "high", ...connections.map((edge) => edge.confidence)]), diagnostics: [...new Set([...diagnostics, ...roomSegments.flatMap((segment) => segment.validationDiagnostics)])], missingData: [...new Set(missingData)].sort() };
}
