import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import polygonClipping from "polygon-clipping";
import { relateOpeningToHostBoundary } from "./geometry";
import type { BuildingEnvelope, Point, Ring } from "./envelope";
import { buildRoomRegionAnalysis, type RoomRegion, type RoomRegionAnalysis } from "./room-regions";
import { G1_GEOMETRY_TOLERANCES as T } from "./tolerances";

export type ConnectivityConfidence = "high" | "medium" | "low";
export type PortalDiagnostic = { code: string; message: string };
export type DoorPortal = {
  doorId: string;
  pascalSourceId: string;
  levelId: string | null;
  hostWallId: string | null;
  openingCenter: Point | null;
  openingWidthMeters: number | null;
  openingSegment: [Point, Point] | null;
  roomRegionAId: string | null;
  roomRegionBId: string | null;
  connectsExterior: boolean;
  sideAExterior: boolean;
  sideBExterior: boolean;
  samplePointsA: Point[];
  samplePointsB: Point[];
  confidence: ConnectivityConfidence;
  diagnostics: PortalDiagnostic[];
  usableForConnectivity: boolean;
  isPrimaryEntrance: boolean;
};

export type ConnectivityNode = { nodeId: string; nodeType: "room" | "exterior"; levelId: string; roomRegionId?: string };
export type ConnectivityEdge = {
  edgeId: string;
  sourceObjectId: string;
  connectionType: "door" | "stair" | "open-connection";
  fromNodeId: string;
  toNodeId: string;
  levelId: string | null;
  confidence: ConnectivityConfidence;
  diagnostics: string[];
};
export type StairConnection = {
  stairId: string;
  pascalSourceId: string;
  fromLevelId: string | null;
  toLevelId: string | null;
  fromRoomRegionId: string | null;
  toRoomRegionId: string | null;
  confidence: ConnectivityConfidence;
  diagnostics: PortalDiagnostic[];
  usableForConnectivity: boolean;
};
export type EntranceSelection = {
  candidateDoorIds: string[];
  selectedDoorId: string | null;
  selectedRoomRegionId: string | null;
  confidence: ConnectivityConfidence;
  diagnostics: PortalDiagnostic[];
};
export type RoomConnectivityGraph = {
  roomAnalysis: RoomRegionAnalysis;
  portals: DoorPortal[];
  stairConnections: StairConnection[];
  nodes: ConnectivityNode[];
  edges: ConnectivityEdge[];
  entrance: EntranceSelection;
  diagnostics: PortalDiagnostic[];
};
const connectivityCache = new WeakMap<object, { roomAnalysis: RoomRegionAnalysis; graph: RoomConnectivityGraph }>();

const exteriorNodeId = (levelId: string) => `exterior:${levelId}`;
const pointOnSegment = (point: Point, start: Point, end: Point, tolerance = 1e-7) => {
  const length2 = (end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2;
  if (length2 <= tolerance ** 2) return Math.hypot(point[0] - start[0], point[1] - start[1]) <= tolerance;
  const cross = (point[0] - start[0]) * (end[1] - start[1]) - (point[1] - start[1]) * (end[0] - start[0]);
  if (Math.abs(cross) > tolerance) return false;
  const dot = (point[0] - start[0]) * (end[0] - start[0]) + (point[1] - start[1]) * (end[1] - start[1]);
  return dot >= -tolerance && dot <= length2 + tolerance;
};
const pointInRing = (point: Point, ring: Ring) => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index]!, b = ring[previous]!;
    if (pointOnSegment(point, a, b)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
const pointInPolygon = (point: Point, polygon: Ring[]) => Boolean(polygon[0] && pointInRing(point, polygon[0]) && !polygon.slice(1).some((hole) => pointInRing(point, hole)));
const pointInRoom = (point: Point, room: RoomRegion) => room.polygons.some((polygon) => pointInPolygon(point, polygon));
const pointInEnvelope = (point: Point, envelope: BuildingEnvelope | undefined) => Boolean(envelope?.usableForEvaluation && envelope.polygons.some((polygon) => pointInPolygon(point, polygon)));

type SideClassification = { roomRegionId: string | null; exterior: boolean; diagnostic?: string };
function classifyPortalSide(points: Point[], rooms: RoomRegion[], envelope: BuildingEnvelope | undefined): SideClassification {
  const roomVotes = new Map<string, number>();
  let exteriorVotes = 0, unresolvedVotes = 0;
  for (const point of points) {
    const matches = rooms.filter((room) => pointInRoom(point, room));
    if (matches.length === 1) roomVotes.set(matches[0]!.roomRegionId, (roomVotes.get(matches[0]!.roomRegionId) ?? 0) + 1);
    else if (matches.length > 1) unresolvedVotes++;
    else if (!pointInEnvelope(point, envelope)) exteriorVotes++;
    else unresolvedVotes++;
  }
  const ranked = [...roomVotes.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 1 && ranked[0]![1] > exteriorVotes && ranked[0]![1] >= Math.ceil(points.length / 2)) return { roomRegionId: ranked[0]![0], exterior: false };
  if (!ranked.length && exteriorVotes >= Math.ceil(points.length / 2)) return { roomRegionId: null, exterior: true };
  return { roomRegionId: null, exterior: false, diagnostic: `采样结果不一致：Room=${ranked.map(([id, count]) => `${id}:${count}`).join(",") || "0"}，Exterior=${exteriorVotes}，未解析=${unresolvedVotes}` };
}

export function buildDoorPortals(handoff: EvaluationHandoff, roomAnalysis = buildRoomRegionAnalysis(handoff)): DoorPortal[] {
  const wallById = new Map(handoff.walls.map((wall) => [wall.id, wall]));
  const envelopeByLevel = new Map(roomAnalysis.envelopes.map((envelope) => [envelope.levelId, envelope]));
  return handoff.doors.map((door) => {
    const diagnostics: PortalDiagnostic[] = [], wall = door.hostWallId ? wallById.get(door.hostWallId) : undefined;
    const empty = (code: string, message: string): DoorPortal => ({ doorId: door.id, pascalSourceId: door.rawPascalId, levelId: door.levelId, hostWallId: door.hostWallId, openingCenter: door.resolvedWorldPosition as Point | null, openingWidthMeters: door.widthMeters, openingSegment: null, roomRegionAId: null, roomRegionBId: null, connectsExterior: false, sideAExterior: false, sideBExterior: false, samplePointsA: [], samplePointsB: [], confidence: "low", diagnostics: [{ code, message }], usableForConnectivity: false, isPrimaryEntrance: door.isPrimaryEntrance });
    if (!wall) return empty("door_host_wall_missing", "门缺少可解析的宿主墙");
    if (!door.levelId || !door.resolvedWorldPosition || !Number.isFinite(door.resolvedTangentRadians) || !Number.isFinite(door.widthMeters) || door.widthMeters! <= T.lengthMeters) return empty("door_portal_geometry_invalid", "门洞中心、宽度、方向或楼层信息无效");
    if (!wall.footprintValidation.valid) return empty("door_host_wall_geometry_invalid", "宿主墙 footprint 无效，不能识别门两侧空间");
    if (Math.abs(wall.curveOffsetMeters) > T.lengthMeters) return empty("curved_door_portal_unsupported", "曲墙门缺少可靠的局部弧线法向与弧长定位，暂不建立连接");
    const boundary = relateOpeningToHostBoundary(door, wall);
    if (boundary.status === "outside") return empty("door_outside_host_wall", "门洞超出宿主墙有效区间，不建立空间连接");
    if (boundary.status !== "inside") return empty("door_host_relation_unresolved", boundary.reason ?? "门洞与宿主墙关系无法确认");

    const center = door.resolvedWorldPosition as Point, tangent: Point = [Math.cos(door.resolvedTangentRadians!), Math.sin(door.resolvedTangentRadians!)], normal: Point = [-tangent[1], tangent[0]], width = door.widthMeters!;
    const openingSegment: [Point, Point] = [[center[0] - tangent[0] * width / 2, center[1] - tangent[1] * width / 2], [center[0] + tangent[0] * width / 2, center[1] + tangent[1] * width / 2]];
    const offset = wall.thicknessMeters / 2 + T.doorPortalSampleClearanceMeters, along = [-.25, 0, .25], distances = [offset, offset + T.doorPortalSampleClearanceMeters];
    const samples = (sign: number) => distances.flatMap((distance) => along.map((fraction) => [center[0] + tangent[0] * width * fraction + normal[0] * distance * sign, center[1] + tangent[1] * width * fraction + normal[1] * distance * sign] as Point));
    const samplePointsA = samples(1), samplePointsB = samples(-1), rooms = roomAnalysis.rooms.filter((room) => room.levelId === door.levelId && room.usableForEvaluation), envelope = envelopeByLevel.get(door.levelId), sideA = classifyPortalSide(samplePointsA, rooms, envelope), sideB = classifyPortalSide(samplePointsB, rooms, envelope);
    if (sideA.diagnostic) diagnostics.push({ code: "door_side_a_unresolved", message: sideA.diagnostic });
    if (sideB.diagnostic) diagnostics.push({ code: "door_side_b_unresolved", message: sideB.diagnostic });
    if (sideA.roomRegionId && sideA.roomRegionId === sideB.roomRegionId) diagnostics.push({ code: "door_sides_same_room", message: "门两侧采样均落入同一 Room Region，不将其作为房间连接边" });
    const nearEnd = Math.min(boundary.openingStartMeters ?? Infinity, (boundary.wallLengthMeters ?? 0) - (boundary.openingEndMeters ?? 0)) <= T.doorPortalEndClearanceMeters;
    if (nearEnd) diagnostics.push({ code: "door_near_wall_end", message: `门洞距离墙端不超过 ${T.doorPortalEndClearanceMeters} m，连接置信度降低` });
    const connectsExterior = (Boolean(sideA.roomRegionId) && sideB.exterior) || (Boolean(sideB.roomRegionId) && sideA.exterior), connectsRooms = Boolean(sideA.roomRegionId && sideB.roomRegionId && sideA.roomRegionId !== sideB.roomRegionId), usableForConnectivity = connectsExterior || connectsRooms;
    if (!usableForConnectivity && !diagnostics.length) diagnostics.push({ code: "door_portal_unresolved", message: "门两侧未形成可靠的 Room–Room 或 Room–Exterior 关系" });
    return { doorId: door.id, pascalSourceId: door.rawPascalId, levelId: door.levelId, hostWallId: wall.id, openingCenter: center, openingWidthMeters: width, openingSegment, roomRegionAId: sideA.roomRegionId, roomRegionBId: sideB.roomRegionId, connectsExterior, sideAExterior: sideA.exterior, sideBExterior: sideB.exterior, samplePointsA, samplePointsB, confidence: usableForConnectivity ? nearEnd ? "medium" : "high" : "low", diagnostics, usableForConnectivity, isPrimaryEntrance: door.isPrimaryEntrance };
  });
}

function roomAtStairFootprint(stair: EvaluationHandoff["stairs"][number], levelId: string, rooms: RoomRegion[]) {
  if (!stair.footprint?.length) return null;
  const close = (ring: Ring): Ring => ring.length && (ring[0]![0] !== ring[ring.length - 1]![0] || ring[0]![1] !== ring[ring.length - 1]![1]) ? [...ring, ring[0]!] : ring;
  const area = (ring: Ring) => Math.abs(ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]!; return sum + point[0] * next[1] - next[0] * point[1]; }, 0) / 2), footprint = close(stair.footprint as Ring), footprintArea = area(footprint);
  if (footprintArea <= T.areaSquareMeters) return null;
  const overlaps = rooms.filter((room) => room.levelId === levelId && room.usableForEvaluation).map((room) => {
    try { const intersection = polygonClipping.intersection([footprint] as any, room.polygons as any) as Ring[][]; return { roomId: room.roomRegionId, area: intersection.reduce((sum, polygon) => sum + Math.max(0, area(polygon[0] ?? []) - polygon.slice(1).reduce((holes, hole) => holes + area(hole), 0)), 0) }; }
    catch { return { roomId: room.roomRegionId, area: 0 }; }
  }).sort((a, b) => b.area - a.area);
  return overlaps[0] && overlaps[0].area / footprintArea >= .5 && (!overlaps[1] || overlaps[1].area <= T.overlapAreaSquareMeters) ? overlaps[0].roomId : null;
}

function roomAtStairLanding(stair: EvaluationHandoff["stairs"][number], levelId: string, rooms: RoomRegion[], side: "from" | "to") {
  const center = side === "from" ? stair.fromLandingCenter : stair.toLandingCenter, outward = side === "from" ? stair.fromLandingOutward : stair.toLandingOutward, width = stair.landingWidthMeters;
  if (!center || !outward || !Number.isFinite(width) || width! <= T.lengthMeters) return roomAtStairFootprint(stair, levelId, rooms);
  const relevant = rooms.filter((room) => room.levelId === levelId && room.usableForEvaluation), lateral: Point = [-outward[1], outward[0]], distances = [T.stairLandingSampleClearanceMeters, T.stairLandingSampleClearanceMeters + T.stairLandingSampleDepthMeters / 2, T.stairLandingSampleClearanceMeters + T.stairLandingSampleDepthMeters], samples = distances.flatMap((distance) => [-.25, 0, .25].map((fraction) => [center[0] + outward[0] * distance + lateral[0] * width! * fraction, center[1] + outward[1] * distance + lateral[1] * width! * fraction] as Point)), votes = new Map<string, number>();
  samples.forEach((point) => { const matches = relevant.filter((room) => pointInRoom(point, room)); if (matches.length === 1) votes.set(matches[0]!.roomRegionId, (votes.get(matches[0]!.roomRegionId) ?? 0) + 1); });
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0] && ranked[0][1] >= Math.ceil(samples.length / 2) && (!ranked[1] || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
}

function selectEntrance(portals: DoorPortal[]): EntranceSelection {
  const candidates = portals.filter((portal) => portal.usableForConnectivity && portal.connectsExterior);
  const semantic = candidates.filter((portal) => portal.isPrimaryEntrance);
  const selected = semantic.length === 1 ? semantic[0] : semantic.length === 0 && candidates.length === 1 ? candidates[0] : null;
  const diagnostics: PortalDiagnostic[] = [];
  if (!candidates.length) diagnostics.push({ code: "residential_entrance_unresolved", message: "没有识别到可靠的 Room–Exterior 门连接" });
  else if (!selected) diagnostics.push({ code: "multiple_exterior_doors_ambiguous", message: `识别到 ${candidates.length} 个外门，但没有唯一可靠的主要入口语义` });
  const selectedRoomRegionId = selected?.roomRegionAId ?? selected?.roomRegionBId ?? null;
  return { candidateDoorIds: candidates.map((portal) => portal.doorId), selectedDoorId: selected?.doorId ?? null, selectedRoomRegionId, confidence: selected ? semantic.length === 1 ? "high" : "medium" : "low", diagnostics };
}

export function buildRoomConnectivityGraph(handoff: EvaluationHandoff, roomAnalysis = buildRoomRegionAnalysis(handoff)): RoomConnectivityGraph {
  const cached = connectivityCache.get(handoff);
  if (cached?.roomAnalysis === roomAnalysis) return cached.graph;
  const portals = buildDoorPortals(handoff, roomAnalysis), nodes: ConnectivityNode[] = roomAnalysis.rooms.filter((room) => room.usableForEvaluation).map((room) => ({ nodeId: room.roomRegionId, nodeType: "room", levelId: room.levelId, roomRegionId: room.roomRegionId }));
  roomAnalysis.envelopes.filter((envelope) => envelope.usableForEvaluation).forEach((envelope) => nodes.push({ nodeId: exteriorNodeId(envelope.levelId), nodeType: "exterior", levelId: envelope.levelId }));
  const edges: ConnectivityEdge[] = portals.filter((portal) => portal.usableForConnectivity).map((portal) => {
    const fromNodeId = portal.roomRegionAId ?? exteriorNodeId(portal.levelId!), toNodeId = portal.roomRegionBId ?? exteriorNodeId(portal.levelId!);
    return { edgeId: `door-edge:${portal.doorId}`, sourceObjectId: portal.doorId, connectionType: "door", fromNodeId, toNodeId, levelId: portal.levelId, confidence: portal.confidence, diagnostics: portal.diagnostics.map((item) => item.message) };
  });
  const levelIds = new Set(handoff.levels.map((level) => level.id));
  const stairConnections: StairConnection[] = handoff.stairs.map((stair) => {
    const diagnostics: PortalDiagnostic[] = [], validReferences = Boolean(stair.fromLevelId && stair.toLevelId && levelIds.has(stair.fromLevelId) && levelIds.has(stair.toLevelId));
    if (!validReferences) diagnostics.push({ code: "stair_connection_unresolved", message: `楼梯楼层引用无效：fromLevelId=${stair.fromLevelId ?? "null"}，toLevelId=${stair.toLevelId ?? "null"}` });
    const fromRoomRegionId = validReferences ? roomAtStairLanding(stair, stair.fromLevelId!, roomAnalysis.rooms, "from") : null, toRoomRegionId = validReferences ? roomAtStairLanding(stair, stair.toLevelId!, roomAnalysis.rooms, "to") : null;
    if (validReferences && (!fromRoomRegionId || !toRoomRegionId)) diagnostics.push({ code: "stair_landing_room_unresolved", message: `楼层引用有效，但无法在${!fromRoomRegionId && !toRoomRegionId ? "上下层" : !fromRoomRegionId ? "起始层" : "到达层"}楼梯口确定唯一 Room Region` });
    const usableForConnectivity = Boolean(validReferences && fromRoomRegionId && toRoomRegionId);
    return { stairId: stair.id, pascalSourceId: stair.rawPascalId, fromLevelId: stair.fromLevelId, toLevelId: stair.toLevelId, fromRoomRegionId, toRoomRegionId, confidence: usableForConnectivity ? "medium" : "low", diagnostics, usableForConnectivity };
  });
  stairConnections.filter((connection) => connection.usableForConnectivity).forEach((connection) => edges.push({ edgeId: `stair-edge:${connection.stairId}`, sourceObjectId: connection.stairId, connectionType: "stair", fromNodeId: connection.fromRoomRegionId!, toNodeId: connection.toRoomRegionId!, levelId: null, confidence: connection.confidence, diagnostics: connection.diagnostics.map((item) => item.message) }));
  const entrance = selectEntrance(portals), diagnostics = [...portals.flatMap((portal) => portal.diagnostics), ...stairConnections.flatMap((connection) => connection.diagnostics), ...entrance.diagnostics];
  const graph = { roomAnalysis, portals, stairConnections, nodes, edges, entrance, diagnostics };
  connectivityCache.set(handoff, { roomAnalysis, graph });
  return graph;
}

export function reachableNodeIds(graph: RoomConnectivityGraph, startNodeId: string) {
  const adjacency = new Map<string, string[]>();
  graph.edges.forEach((edge) => { adjacency.set(edge.fromNodeId, [...(adjacency.get(edge.fromNodeId) ?? []), edge.toNodeId]); adjacency.set(edge.toNodeId, [...(adjacency.get(edge.toNodeId) ?? []), edge.fromNodeId]); });
  const visited = new Set<string>(), queue = [startNodeId];
  while (queue.length) { const current = queue.shift()!; if (visited.has(current)) continue; visited.add(current); (adjacency.get(current) ?? []).forEach((next) => { if (!visited.has(next)) queue.push(next); }); }
  return visited;
}

export type ShortestRoomPath = { roomRegionIds: string[]; edges: ConnectivityEdge[] };

/**
 * Stable, unweighted BFS across Room Region nodes only. Exterior nodes are
 * intentionally excluded: leaving the dwelling must not become a shortcut
 * between two interior functional spaces.
 */
export function findShortestRoomPath(graph: RoomConnectivityGraph, startRoomId: string, targetRoomId: string): ShortestRoomPath | null {
  const roomIds = new Set(graph.nodes.filter((node) => node.nodeType === "room").map((node) => node.nodeId));
  if (!roomIds.has(startRoomId) || !roomIds.has(targetRoomId)) return null;
  if (startRoomId === targetRoomId) return { roomRegionIds: [startRoomId], edges: [] };
  const adjacency = new Map<string, Array<{ nextRoomId: string; edge: ConnectivityEdge }>>();
  for (const edge of graph.edges) {
    if (!roomIds.has(edge.fromNodeId) || !roomIds.has(edge.toNodeId)) continue;
    adjacency.set(edge.fromNodeId, [...(adjacency.get(edge.fromNodeId) ?? []), { nextRoomId: edge.toNodeId, edge }]);
    adjacency.set(edge.toNodeId, [...(adjacency.get(edge.toNodeId) ?? []), { nextRoomId: edge.fromNodeId, edge }]);
  }
  adjacency.forEach((entries) => entries.sort((a, b) => a.edge.sourceObjectId.localeCompare(b.edge.sourceObjectId) || a.edge.edgeId.localeCompare(b.edge.edgeId) || a.nextRoomId.localeCompare(b.nextRoomId)));
  const previous = new Map<string, { roomId: string; edge: ConnectivityEdge }>(), visited = new Set([startRoomId]), queue = [startRoomId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const { nextRoomId, edge } of adjacency.get(current) ?? []) {
      if (visited.has(nextRoomId)) continue;
      visited.add(nextRoomId);
      previous.set(nextRoomId, { roomId: current, edge });
      if (nextRoomId === targetRoomId) {
        const roomRegionIds = [targetRoomId], edges: ConnectivityEdge[] = [];
        let cursor = targetRoomId;
        while (cursor !== startRoomId) { const step = previous.get(cursor)!; edges.unshift(step.edge); roomRegionIds.unshift(step.roomId); cursor = step.roomId; }
        return { roomRegionIds, edges };
      }
      queue.push(nextRoomId);
    }
  }
  return null;
}
