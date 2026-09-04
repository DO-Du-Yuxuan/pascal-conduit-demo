import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { buildRoomConnectivityGraph, reachableNodeIds, type RoomConnectivityGraph } from "./connectivity";
import type { G3Rule, RuleDiagnostic, RuleResult, RuleStatus } from "./types";

const graphCache = new WeakMap<object, RoomConnectivityGraph>();
export const connectivityGraph = (handoff: EvaluationHandoff) => {
  const cached = graphCache.get(handoff);
  if (cached) return cached;
  const graph = buildRoomConnectivityGraph(handoff);
  graphCache.set(handoff, graph);
  return graph;
};
const confidence = (level: "high" | "medium" | "low", reasons: string[] = []) => ({ level, score: level === "high" ? 1 : level === "medium" ? .75 : .4, reasons });
const result = (ruleId: string, ruleName: string, status: RuleStatus, summary: string, partial: Partial<RuleResult> = {}): RuleResult => ({ ruleId, ruleName, status, severity: status === "issue" ? "error" : status === "unable_to_determine" ? "warning" : "info", summary, details: [], normalizedObjectIds: [], pascalSourceIds: [], measurements: [], thresholds: [], missingData: [], confidence: confidence("high"), diagnostics: [], ...partial });
const nonUsablePattern = /\b(SHAFT|VOID|OPEN TO BELOW|DUCT|CHASE|CAVITY)\b|井道|管井|挑空|构造空腔/i;
const mainSpacePattern = /\b(LIVING|FAMILY|DINING|KITCHEN|BED(?:ROOM)?|BATH|TOILET|WC|OFFICE|STUDY|ENTRY|FOYER|HALL|GARAGE|LAUNDRY)\b|客厅|起居|餐厅|厨房|卧室|卫生间|书房|入口|门厅|走廊|车库|洗衣/i;

function roomSemantics(handoff: EvaluationHandoff, graph: RoomConnectivityGraph) {
  const zoneById = new Map(handoff.zones.map((zone) => [zone.id, zone]));
  return graph.roomAnalysis.rooms.filter((room) => room.usableForEvaluation).map((room) => {
    const zoneIds = graph.roomAnalysis.roomToZoneIds[room.roomRegionId] ?? [], names = zoneIds.map((id) => zoneById.get(id)?.name?.trim()).filter((name): name is string => Boolean(name));
    const excluded = names.length > 0 && names.every((name) => nonUsablePattern.test(name));
    return { room, zoneIds, names, excluded, usable: names.length > 0 && !excluded, semanticsKnown: names.length > 0, main: names.some((name) => mainSpacePattern.test(name)) && !excluded };
  });
}

function levelConnectivityMeasurements(handoff: EvaluationHandoff, graph: RoomConnectivityGraph): RuleResult["measurements"] {
  return handoff.levels.flatMap((level) => {
    const roomIds = graph.nodes.filter((node) => node.nodeType === "room" && node.levelId === level.id).map((node) => node.nodeId), roomSet = new Set(roomIds), adjacency = new Map<string, string[]>();
    graph.edges.filter((edge) => edge.connectionType !== "stair" && edge.levelId === level.id).forEach((edge) => { if (roomSet.has(edge.fromNodeId) && roomSet.has(edge.toNodeId)) { adjacency.set(edge.fromNodeId, [...(adjacency.get(edge.fromNodeId) ?? []), edge.toNodeId]); adjacency.set(edge.toNodeId, [...(adjacency.get(edge.toNodeId) ?? []), edge.fromNodeId]); } });
    const seen = new Set<string>(); let components = 0;
    roomIds.forEach((roomId) => { if (seen.has(roomId)) return; components++; const queue = [roomId]; while (queue.length) { const current = queue.shift()!; if (seen.has(current)) continue; seen.add(current); (adjacency.get(current) ?? []).forEach((next) => queue.push(next)); } });
    return [{ name: "levelRoomCount", value: roomIds.length, normalizedObjectId: level.id }, { name: "levelConnectivityComponentCount", value: components, normalizedObjectId: level.id }, { name: "levelSameFloorConnected", value: roomIds.length > 0 && components === 1, normalizedObjectId: level.id }];
  });
}

export const ruleG3005: G3Rule = (handoff) => {
  const graph = connectivityGraph(handoff), semantics = roomSemantics(handoff, graph), degree = new Map<string, number>();
  graph.edges.forEach((edge) => { degree.set(edge.fromNodeId, (degree.get(edge.fromNodeId) ?? 0) + 1); degree.set(edge.toNodeId, (degree.get(edge.toNodeId) ?? 0) + 1); });
  const unresolvedPortals = graph.portals.filter((portal) => !portal.usableForConnectivity);
  const unknownSemantics = semantics.filter((item) => !item.semanticsKnown), candidates = semantics.filter((item) => item.usable), unresolvedConnections = candidates.filter((item) => !(degree.get(item.room.roomRegionId) ?? 0) && unresolvedPortals.some((portal) => portal.hostWallId && item.room.boundaryWallIds.includes(portal.hostWallId))), isolated = candidates.filter((item) => !(degree.get(item.room.roomRegionId) ?? 0) && !unresolvedConnections.includes(item));
  const status: RuleStatus = isolated.length ? "issue" : unresolvedConnections.length || unknownSemantics.length ? "unable_to_determine" : candidates.length ? "pass" : "not_applicable";
  const diagnostics: RuleDiagnostic[] = [
    ...isolated.map((item) => ({ severity: "error" as const, code: "usable_room_without_entrance", message: `${item.names.join(" / ")} 所在空间没有任何有效门洞、开放连接或楼梯连接`, normalizedObjectIds: [item.room.roomRegionId, ...item.zoneIds], origin: "source_data" as const, recommendation: "检查是否遗漏房门、门的宿主关系，或该区域是否属于不需要进入的建筑构造空间。" })),
    ...unresolvedConnections.map((item) => ({ severity: "warning" as const, code: "room_entrance_unresolved", message: `${item.names.join(" / ")} 所在空间邻近未解析门洞，不能确认是否无入口`, normalizedObjectIds: [item.room.roomRegionId, ...item.zoneIds], origin: "insufficient_information" as const, recommendation: "先修复邻近门的宿主墙、位置或曲墙门定位。" })),
    ...unknownSemantics.map((item) => ({ severity: "warning" as const, code: "room_use_semantics_unresolved", message: `${item.room.roomRegionId} 没有可靠 Zone 用途，不能判断是否要求人员进入`, normalizedObjectIds: [item.room.roomRegionId], origin: "insufficient_information" as const })),
  ];
  return result("G3-005", "已定义的使用空间不能成为无入口封闭空间", status, isolated.length ? `发现 ${isolated.length} 个已定义使用空间没有有效入口` : unresolvedConnections.length ? `${unresolvedConnections.length} 个使用空间因邻近门连接未解析而无法确认入口` : unknownSemantics.length ? `${unknownSemantics.length} 个 Room Region 缺少可靠用途语义` : `${candidates.length} 个可使用 Room Region 均具有至少一个有效入口`, {
    details: diagnostics.map((diagnostic) => diagnostic.message), normalizedObjectIds: isolated.map((item) => item.room.roomRegionId), pascalSourceIds: [...new Set(isolated.flatMap((item) => item.room.pascalSourceIds))],
    measurements: [{ name: "usableRoomCount", value: candidates.length }, { name: "roomWithoutEntranceCount", value: isolated.length }, { name: "roomWithUnresolvedEntranceCount", value: unresolvedConnections.length }, { name: "roomUseUnknownCount", value: unknownSemantics.length }, ...candidates.map((item) => ({ name: "entranceCount", value: degree.get(item.room.roomRegionId) ?? 0, normalizedObjectId: item.room.roomRegionId }))],
    missingData: [...unresolvedConnections.map((item) => `${item.room.roomRegionId}: 可靠门连接`), ...unknownSemantics.map((item) => `${item.room.roomRegionId}: 使用空间语义`)], confidence: confidence(status === "pass" ? "medium" : isolated.length ? "high" : "low", ["只检查拓扑入口，不检查家具阻挡、门扇碰撞或净宽"]), diagnostics,
  });
};

export const ruleG3001: G3Rule = (handoff) => {
  const graph = connectivityGraph(handoff), semantics = roomSemantics(handoff, graph), mainRooms = semantics.filter((item) => item.main), unresolvedStairs = graph.stairConnections.filter((connection) => !connection.usableForConnectivity), validStairs = graph.stairConnections.filter((connection) => connection.usableForConnectivity), levelMeasurements = levelConnectivityMeasurements(handoff, graph);
  if (!mainRooms.length) return result("G3-001", "主要空间均可正常到达", "unable_to_determine", "没有足够的主要空间用途语义用于可达性检查", { missingData: ["主要空间用途分类"], confidence: confidence("low"), diagnostics: [{ severity: "warning", code: "main_space_semantics_unresolved", message: "没有通过结构化用途或严格名称语义识别到主要空间", normalizedObjectIds: [], origin: "insufficient_information" }] });
  const candidates = graph.portals.flatMap((portal) => {
    const roomRegionId = portal.roomRegionAId ?? portal.roomRegionBId;
    return portal.usableForConnectivity && portal.connectsExterior && portal.levelId && roomRegionId ? [{ portal, roomRegionId, reached: reachableNodeIds(graph, roomRegionId) }] : [];
  });
  if (!candidates.length) return result("G3-001", "主要空间均可正常到达", "unable_to_determine", "没有识别到可作为起点的可靠外门", { measurements: [{ name: "mainRoomCount", value: mainRooms.length }, { name: "entranceCandidateCount", value: 0 }, { name: "resolvedDoorPortalCount", value: graph.portals.filter((portal) => portal.usableForConnectivity).length }, { name: "unresolvedStairCount", value: unresolvedStairs.length }, ...levelMeasurements], missingData: ["至少一个可靠的 Room–Exterior 门连接"], confidence: confidence("low"), diagnostics: [{ severity: "warning", code: "reliable_exterior_portal_unavailable", message: "没有可确认连接室内 Room 与 Exterior 的门洞，无法开始可达性检查", normalizedObjectIds: [], origin: "insufficient_information" }] });

  const coverage = candidates.map((candidate) => ({ ...candidate, sameLevel: mainRooms.filter((item) => item.room.levelId === candidate.portal.levelId), reachableMainRooms: mainRooms.filter((item) => candidate.reached.has(item.room.roomRegionId)) }));
  const best = [...coverage].sort((a, b) => b.reachableMainRooms.length - a.reachableMainRooms.length)[0]!;
  const sameLevelCandidate = coverage.find((candidate) => candidate.sameLevel.every((item) => candidate.reached.has(item.room.roomRegionId)));
  const allMainRoomsCandidate = coverage.find((candidate) => candidate.reachableMainRooms.length === mainRooms.length);
  const otherLevels = mainRooms.filter((item) => item.room.levelId !== best.portal.levelId), unreachableSameLevel = best.sameLevel.filter((item) => !best.reached.has(item.room.roomRegionId)), unreachableOtherLevels = otherLevels.filter((item) => !best.reached.has(item.room.roomRegionId));
  const crossLevelUnresolved = otherLevels.length > 0 && (unresolvedStairs.length > 0 || validStairs.length === 0), reportableOther = crossLevelUnresolved ? [] : unreachableOtherLevels;
  const status: RuleStatus = !sameLevelCandidate || (!crossLevelUnresolved && !allMainRoomsCandidate) ? "issue" : crossLevelUnresolved ? "unable_to_determine" : "pass";
  const affected = [...unreachableSameLevel, ...reportableOther], diagnostics: RuleDiagnostic[] = [
    ...affected.map((item) => ({ severity: "error" as const, code: "main_room_unreachable", message: `${item.names.join(" / ")} 无法从选出的外门通过连续空间连接到达`, normalizedObjectIds: [item.room.roomRegionId, ...item.zoneIds], origin: "source_data" as const, recommendation: "检查沿途房门、开放连接和楼梯连接是否完整。" })),
    ...unresolvedStairs.map((connection) => ({ severity: "warning" as const, code: "stair_connection_unresolved", message: connection.diagnostics.map((diagnostic) => diagnostic.message).join("；"), normalizedObjectIds: [connection.stairId], field: "stair level references / landing Room Regions", actualValue: `${connection.fromLevelId ?? "null"}/${connection.toLevelId ?? "null"}`, expectedValue: "两个现有 Level ID 与两端各一个可靠落地区域", origin: "source_data" as const, recommendation: "检查楼梯上下层引用、楼梯口位置以及两层 Room Region 后再评价跨层可达性。" })),
    ...(crossLevelUnresolved ? otherLevels.map((item) => ({ severity: "warning" as const, code: "cross_level_room_reachability_unresolved", message: `${item.names.join(" / ")} 位于 ${handoff.levels.find((level) => level.id === item.room.levelId)?.name ?? item.room.levelId}；同层门网已连通，但楼梯连接尚未可靠建立，无法确认能否从其他楼层到达`, normalizedObjectIds: [item.room.roomRegionId, ...item.zoneIds], origin: "insufficient_information" as const, recommendation: "先定位楼梯并核对上下层引用与两端落地区域；这不代表该空间已经不可达。" })) : []),
  ];
  return result("G3-001", "主要空间均可正常到达", status, status === "pass" ? `${mainRooms.length} 个主要空间均可从至少一个可靠外门通过空间连接图到达` : status === "issue" ? `${affected.length} 个主要空间无法由同一外门通过拓扑连接完整到达` : `至少一个外门可覆盖入口层同层主要空间，但 ${otherLevels.length} 个跨层主要空间因楼梯连接不可靠而无法判断`, {
    details: diagnostics.map((diagnostic) => diagnostic.message), normalizedObjectIds: affected.map((item) => item.room.roomRegionId), pascalSourceIds: [...new Set(affected.flatMap((item) => item.room.pascalSourceIds))], measurements: [{ name: "mainRoomCount", value: mainRooms.length }, { name: "entranceCandidateCount", value: candidates.length }, { name: "externalDoorCanReachAllMainSpaces", value: Boolean(allMainRoomsCandidate) }, { name: "sameLevelMainRoomCount", value: best.sameLevel.length, normalizedObjectId: best.portal.levelId ?? undefined }, { name: "sameLevelReachableCount", value: best.sameLevel.length - unreachableSameLevel.length, normalizedObjectId: best.portal.levelId ?? undefined }, { name: "sameLevelUnreachableCount", value: unreachableSameLevel.length, normalizedObjectId: best.portal.levelId ?? undefined }, { name: "crossLevelMainRoomCount", value: otherLevels.length }, { name: "crossLevelUnreachableCount", value: crossLevelUnresolved ? "unable_to_determine" : unreachableOtherLevels.length }, { name: "validStairConnectionCount", value: validStairs.length }, { name: "unresolvedStairCount", value: unresolvedStairs.length }, ...levelMeasurements], missingData: crossLevelUnresolved ? unresolvedStairs.flatMap((connection) => connection.diagnostics.map((diagnostic) => diagnostic.message)) : [], confidence: confidence(status === "pass" ? "medium" : crossLevelUnresolved ? "low" : "high", ["只做拓扑可达，不检查家具避障、门扇碰撞或通道净宽；不要求定义唯一主入口"]), diagnostics,
  });
};

export const FIRST_G3_RULES: G3Rule[] = [ruleG3001, ruleG3005];
