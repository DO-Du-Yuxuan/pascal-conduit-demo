import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { isSdiSpaceFunctionCode, sdiSpaceFunctionName, type SdiSpaceFunctionCode } from "../space-functions/sdi-space-functions";
import { findShortestRoomPath, type ConnectivityConfidence, type ConnectivityEdge, type RoomConnectivityGraph } from "./connectivity";
import { findPrivacySafeRoomPath } from "./s1-public-circulation-privacy";
import { S1_ACTIVITY_PUBLIC_CORE_CODES, S1_ACTIVITY_ZONING_DZ01_SCORE_RULES, S1_ACTIVITY_ZONING_DZ02_SCORES, S1_ACTIVITY_ZONING_RULE_STATUS, S1_ACTIVITY_ZONING_RULE_VERSION, s1ActivityZoneClass, type S1ActivityZoneClass } from "./s1-activity-zoning-config";

export type S1ActivityZoningStatus = "scored" | "not_applicable" | "unable_to_determine";
export type S1ActivitySpace = { roomRegionId: string; levelId: string; zoneIds: string[]; zoneNames: string[]; spaceFunctionCodes: SdiSpaceFunctionCode[]; classifications: S1ActivityZoneClass[]; confidence: ConnectivityConfidence };
export type S1Dz01Result = "safe" | "quiet_mandatory" | "baseline_unreachable" | "unable_to_determine" | "not_applicable";
export type S1Dz01Measurement = { measurementId: string; status: S1ActivityZoningStatus; result: S1Dz01Result; space: S1ActivitySpace | null; publicCoreRoomRegionIds: string[]; baselinePathRoomRegionIds: string[]; quietSafePathRoomRegionIds: string[]; witnessPathRoomRegionIds: string[]; quietIntermediateRoomRegionIds: string[]; doorIds: string[]; stairIds: string[]; diagnostics: string[]; missingData: string[] };
export type S1Dz02BufferType = keyof typeof S1_ACTIVITY_ZONING_DZ02_SCORES | "unresolved" | "not_applicable";
export type S1Dz02Measurement = { measurementId: string; status: S1ActivityZoningStatus; bufferType: S1Dz02BufferType; score: number | null; space: S1ActivitySpace | null; neighborRoomRegionIds: string[]; neighborClassifications: S1ActivityZoneClass[]; doorIds: string[]; activeMandatoryForCore: boolean | null; diagnostics: string[]; missingData: string[] };
export type S1ActivityZoningRuleSummary = { ruleId: "DZ-01" | "DZ-02"; ruleName: string; status: S1ActivityZoningStatus; score: number | null; evaluableCount: number; unableCount: number; notApplicableCount: number; affectedCount: number; diagnostics: string[] };
export type S1ActivityZoningReport = { metricId: "S1-DZ"; metricName: "动静分区"; status: S1ActivityZoningStatus; score: number | null; ruleVersion: typeof S1_ACTIVITY_ZONING_RULE_VERSION; ruleStatus: typeof S1_ACTIVITY_ZONING_RULE_STATUS; dz01: S1ActivityZoningRuleSummary & { measurements: S1Dz01Measurement[] }; dz02: S1ActivityZoningRuleSummary & { measurements: S1Dz02Measurement[] } };

const reliableMatch = (relationship: string | undefined) => relationship === "one-to-one" || relationship === "room-with-multiple-zones";
const confidenceRank = { low: 0, medium: 1, high: 2 } as const;
const lowerConfidence = (values: ConnectivityConfidence[]) => values.reduce<ConnectivityConfidence>((lowest, value) => confidenceRank[value] < confidenceRank[lowest] ? value : lowest, "high");
const publicCore = new Set<string>(S1_ACTIVITY_PUBLIC_CORE_CODES);
const pathEvidence = (path: { edges: ConnectivityEdge[] } | null) => ({ doorIds: path?.edges.filter((edge) => edge.connectionType === "door").map((edge) => edge.sourceObjectId) ?? [], stairIds: path?.edges.filter((edge) => edge.connectionType === "stair").map((edge) => edge.sourceObjectId) ?? [] });

function resolveSpaces(handoff: EvaluationHandoff, graph: RoomConnectivityGraph) {
  const zones = new Map(handoff.zones.map((zone) => [zone.id, zone])), rooms = new Map(graph.roomAnalysis.rooms.map((room) => [room.roomRegionId, room])), matches = new Map(graph.roomAnalysis.zoneMatches.map((match) => [match.zoneId, match]));
  const byRoom = new Map<string, typeof handoff.zones>(); const invalid: Array<{ zoneId: string; name: string }> = [];
  for (const zone of handoff.zones) {
    if (!isSdiSpaceFunctionCode(zone.spaceFunctionCode) || Number(zone.spaceFunctionCode.slice(2)) >= 50) continue;
    const match = matches.get(zone.id), roomId = match?.matchedRoomRegionIds.length === 1 ? match.matchedRoomRegionIds[0] : null, room = roomId ? rooms.get(roomId) : null;
    if (!roomId || !room?.usableForEvaluation || !reliableMatch(match?.relationship)) { invalid.push({ zoneId: zone.id, name: zone.name ?? zone.id }); continue; }
    byRoom.set(roomId, [...(byRoom.get(roomId) ?? []), zone]);
  }
  const spaces = [...byRoom.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([roomRegionId, roomZones]): S1ActivitySpace => {
    const room = rooms.get(roomRegionId)!;
    const codes = [...new Set(roomZones.map((zone) => zone.spaceFunctionCode!).filter(isSdiSpaceFunctionCode))].sort();
    return { roomRegionId, levelId: room.levelId, zoneIds: roomZones.map((zone) => zone.id).sort(), zoneNames: roomZones.map((zone) => zone.name?.trim() || zone.id).sort(), spaceFunctionCodes: codes, classifications: [...new Set(codes.map((code) => s1ActivityZoneClass(code)).filter((value): value is S1ActivityZoneClass => Boolean(value)))].sort(), confidence: lowerConfidence([room.confidence, ...roomZones.map((zone) => matches.get(zone.id)!.confidence)]) };
  });
  const activeSpaces = spaces.flatMap((space) => space.zoneIds.flatMap((zoneId) => {
    const zone = zones.get(zoneId), code = zone?.spaceFunctionCode;
    return code && isSdiSpaceFunctionCode(code) && s1ActivityZoneClass(code) === "active" ? [{ ...space, zoneIds: [zoneId], zoneNames: [zone.name?.trim() || zoneId], spaceFunctionCodes: [code], classifications: ["active"] as S1ActivityZoneClass[] }] : [];
  })).sort((a, b) => a.roomRegionId.localeCompare(b.roomRegionId) || a.zoneIds[0]!.localeCompare(b.zoneIds[0]!));
  return { spaces, activeSpaces, invalid };
}

function bestPathToTargets(graph: RoomConnectivityGraph, sourceRoomId: string, targetRoomIds: string[], excluded: ReadonlySet<string>) {
  const candidates = targetRoomIds.map((target) => ({ target, paths: findPrivacySafeRoomPath(graph, sourceRoomId, target, excluded) })).filter((candidate) => candidate.paths.baselinePath).sort((a, b) => (a.paths.privacySafePath ? 0 : 1) - (b.paths.privacySafePath ? 0 : 1) || a.paths.baselinePath!.edges.length - b.paths.baselinePath!.edges.length || a.target.localeCompare(b.target));
  return candidates[0] ?? null;
}

function dz01(spaces: S1ActivitySpace[], active: S1ActivitySpace[], invalid: Array<{ zoneId: string; name: string }>, graph: RoomConnectivityGraph): S1ActivityZoningRuleSummary & { measurements: S1Dz01Measurement[] } {
  const cores = spaces.filter((space) => space.spaceFunctionCodes.some((code) => publicCore.has(code))).map((space) => space.roomRegionId).sort(); const quiet = new Set(spaces.filter((space) => space.classifications.includes("quiet")).map((space) => space.roomRegionId));
  if (!active.length) return { ruleId: "DZ-01", ruleName: "动线扰静", status: "not_applicable", score: null, evaluableCount: 0, unableCount: 0, notApplicableCount: 1, affectedCount: 0, diagnostics: ["不存在正式分类为动区的室内空间。"], measurements: [] };
  if (!cores.length || invalid.length) {
    const reason = !cores.length ? "缺少可靠 SF06 客厅或 SF07 餐厅公共核心。" : `以下室内 Zone 无法可靠映射到 RoomRegion：${invalid.map((item) => item.name).join("、")}`;
    const measurements = active.map((space) => ({ measurementId: `DZ-01-${space.roomRegionId}`, status: "unable_to_determine" as const, result: "unable_to_determine" as const, space, publicCoreRoomRegionIds: cores, baselinePathRoomRegionIds: [], quietSafePathRoomRegionIds: [], witnessPathRoomRegionIds: [], quietIntermediateRoomRegionIds: [], doorIds: [], stairIds: [], diagnostics: [reason], missingData: [!cores.length ? "可靠公共核心" : "可靠 Zone–RoomRegion 映射"] }));
    return { ruleId: "DZ-01", ruleName: "动线扰静", status: "unable_to_determine", score: null, evaluableCount: 0, unableCount: measurements.length, notApplicableCount: 0, affectedCount: 0, diagnostics: [reason], measurements };
  }
  const measurements = active.map((space): S1Dz01Measurement => {
    const result = bestPathToTargets(graph, space.roomRegionId, cores, quiet);
    if (!result) return { measurementId: `DZ-01-${space.roomRegionId}`, status: "unable_to_determine", result: "baseline_unreachable", space, publicCoreRoomRegionIds: cores, baselinePathRoomRegionIds: [], quietSafePathRoomRegionIds: [], witnessPathRoomRegionIds: [], quietIntermediateRoomRegionIds: [], doorIds: [], stairIds: [], diagnostics: ["动区与公共核心在原始空间图中不可达，本规则不重复评价基本可达性。"], missingData: [] };
    const baseline = result.paths.baselinePath!, safe = result.paths.privacySafePath, selected = safe ?? baseline, evidence = pathEvidence(selected);
    if (safe) return { measurementId: `DZ-01-${space.roomRegionId}`, status: "scored", result: "safe", space, publicCoreRoomRegionIds: cores, baselinePathRoomRegionIds: baseline.roomRegionIds, quietSafePathRoomRegionIds: safe.roomRegionIds, witnessPathRoomRegionIds: [], quietIntermediateRoomRegionIds: [], ...evidence, diagnostics: ["存在避免将静区作为中间通道的连接路径。"], missingData: [] };
    const affected = baseline.roomRegionIds.slice(1, -1).filter((roomId) => quiet.has(roomId));
    return { measurementId: `DZ-01-${space.roomRegionId}`, status: "scored", result: "quiet_mandatory", space, publicCoreRoomRegionIds: cores, baselinePathRoomRegionIds: baseline.roomRegionIds, quietSafePathRoomRegionIds: [], witnessPathRoomRegionIds: baseline.roomRegionIds, quietIntermediateRoomRegionIds: affected, ...evidence, diagnostics: ["连接公共核心时必须将静区作为中间通道。"], missingData: [] };
  });
  const unable = measurements.filter((item) => item.status === "unable_to_determine"), evaluable = measurements.filter((item) => item.status === "scored"), affected = evaluable.filter((item) => item.result === "quiet_mandatory"), ratio = evaluable.length ? affected.length / evaluable.length : 0, score = S1_ACTIVITY_ZONING_DZ01_SCORE_RULES.find((rule) => ratio <= rule.maximumAffectedRatio)!.score;
  return { ruleId: "DZ-01", ruleName: "动线扰静", status: unable.length ? "unable_to_determine" : "scored", score: unable.length ? null : score, evaluableCount: evaluable.length, unableCount: unable.length, notApplicableCount: 0, affectedCount: affected.length, diagnostics: unable.length ? ["存在无法判断的动区连接，暂不生成完整 DZ-01 分数。"] : [`${affected.length} / ${evaluable.length} 个动区连接公共核心时必须经过静区。`], measurements };
}

function dz02(spaces: S1ActivitySpace[], invalid: Array<{ zoneId: string; name: string }>, graph: RoomConnectivityGraph): S1ActivityZoningRuleSummary & { measurements: S1Dz02Measurement[] } {
  const quiet = spaces.filter((space) => space.classifications.includes("quiet")); const byRoom = new Map(spaces.map((space) => [space.roomRegionId, space])); const cores = spaces.filter((space) => space.spaceFunctionCodes.some((code) => publicCore.has(code))).map((space) => space.roomRegionId).sort();
  if (!quiet.length) return { ruleId: "DZ-02", ruleName: "静区缓冲", status: "not_applicable", score: null, evaluableCount: 0, unableCount: 0, notApplicableCount: 1, affectedCount: 0, diagnostics: ["不存在正式分类为静区的室内空间。"], measurements: [] };
  const measurements = quiet.map((space): S1Dz02Measurement => {
    if (invalid.length) return { measurementId: `DZ-02-${space.roomRegionId}`, status: "unable_to_determine", bufferType: "unresolved", score: null, space, neighborRoomRegionIds: [], neighborClassifications: [], doorIds: [], activeMandatoryForCore: null, diagnostics: [`以下室内 Zone 无法可靠映射到 RoomRegion：${invalid.map((item) => item.name).join("、")}`], missingData: ["可靠 Zone–RoomRegion 映射"] };
    const edges = graph.edges.filter((edge) => edge.connectionType === "door" && (edge.fromNodeId === space.roomRegionId || edge.toNodeId === space.roomRegionId)).sort((a, b) => a.edgeId.localeCompare(b.edgeId));
    const neighborIds = [...new Set(edges.map((edge) => edge.fromNodeId === space.roomRegionId ? edge.toNodeId : edge.fromNodeId).filter((id) => byRoom.has(id)))].sort();
    if (!edges.length || !neighborIds.length) return { measurementId: `DZ-02-${space.roomRegionId}`, status: "unable_to_determine", bufferType: "unresolved", score: null, space, neighborRoomRegionIds: neighborIds, neighborClassifications: [], doorIds: edges.map((edge) => edge.sourceObjectId), activeMandatoryForCore: null, diagnostics: ["静区没有可用于评价的真实室内 DoorPortal 直接连接。"], missingData: ["可靠 DoorPortal 邻接"] };
    const neighbors = neighborIds.map((id) => byRoom.get(id)!), classifications = [...new Set(neighbors.flatMap((neighbor) => neighbor.classifications))].sort(), hasActive = classifications.includes("active"), hasNeutral = classifications.includes("neutral"), hasQuiet = classifications.includes("quiet");
    let bufferType: S1Dz02BufferType, score: number, mandatory: boolean | null = null;
    if (hasNeutral && !hasActive) { bufferType = "neutral_only"; score = S1_ACTIVITY_ZONING_DZ02_SCORES.neutral_only; }
    else if (hasNeutral && hasActive) { bufferType = "neutral_and_active"; score = S1_ACTIVITY_ZONING_DZ02_SCORES.neutral_and_active; }
    else if (!hasActive && hasQuiet) { bufferType = "quiet_only"; score = S1_ACTIVITY_ZONING_DZ02_SCORES.quiet_only; }
    else if (hasActive) {
      const baseline = cores.map((core) => findShortestRoomPath(graph, space.roomRegionId, core)).filter((path): path is NonNullable<typeof path> => Boolean(path)).sort((a, b) => a.edges.length - b.edges.length || a.roomRegionIds.join("|").localeCompare(b.roomRegionIds.join("|")))[0];
      const activeRooms = new Set(spaces.filter((item) => item.classifications.includes("active")).map((item) => item.roomRegionId));
      const safe = baseline && cores.some((core) => Boolean(findPrivacySafeRoomPath(graph, space.roomRegionId, core, activeRooms).privacySafePath));
      mandatory = Boolean(baseline && !safe && cores.length);
      bufferType = mandatory ? "active_mandatory" : "active_direct"; score = mandatory ? S1_ACTIVITY_ZONING_DZ02_SCORES.active_mandatory : S1_ACTIVITY_ZONING_DZ02_SCORES.active_direct;
    } else return { measurementId: `DZ-02-${space.roomRegionId}`, status: "unable_to_determine", bufferType: "unresolved", score: null, space, neighborRoomRegionIds: neighborIds, neighborClassifications: classifications, doorIds: edges.map((edge) => edge.sourceObjectId), activeMandatoryForCore: null, diagnostics: ["直接相邻 RoomRegion 缺少可用于动静分类的正式 SF 编码。"], missingData: ["相邻空间 SDI 编码"] };
    return { measurementId: `DZ-02-${space.roomRegionId}`, status: "scored", bufferType, score, space, neighborRoomRegionIds: neighborIds, neighborClassifications: classifications, doorIds: edges.map((edge) => edge.sourceObjectId), activeMandatoryForCore: mandatory, diagnostics: [`直接相邻空间分类：${classifications.join(" / ")}。`], missingData: [] };
  });
  const unable = measurements.filter((item) => item.status === "unable_to_determine"), evaluable = measurements.filter((item) => item.status === "scored"), values = evaluable.map((item) => item.score!), average = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null;
  return { ruleId: "DZ-02", ruleName: "静区缓冲", status: unable.length ? "unable_to_determine" : values.length ? "scored" : "not_applicable", score: unable.length ? null : average, evaluableCount: evaluable.length, unableCount: unable.length, notApplicableCount: 0, affectedCount: evaluable.filter((item) => item.score !== 100).length, diagnostics: unable.length ? ["存在无法判断的静区入口，暂不生成完整 DZ-02 分数。"] : [], measurements };
}

export function scoreS1ActivityZoning(handoff: EvaluationHandoff, graph: RoomConnectivityGraph): S1ActivityZoningReport {
  const resolved = resolveSpaces(handoff, graph), circulation = dz01(resolved.spaces, resolved.activeSpaces, resolved.invalid, graph), buffering = dz02(resolved.spaces, resolved.invalid, graph);
  const applicable = [circulation, buffering].filter((rule) => rule.status === "scored"), unable = [circulation, buffering].filter((rule) => rule.status === "unable_to_determine");
  return { metricId: "S1-DZ", metricName: "动静分区", status: unable.length ? "unable_to_determine" : applicable.length ? "scored" : "not_applicable", score: unable.length || !applicable.length ? null : Math.round(applicable.reduce((sum, rule) => sum + rule.score!, 0) / applicable.length * 10) / 10, ruleVersion: S1_ACTIVITY_ZONING_RULE_VERSION, ruleStatus: S1_ACTIVITY_ZONING_RULE_STATUS, dz01: circulation, dz02: buffering };
}

export const s1ActivityZoneName = (code: SdiSpaceFunctionCode) => `${code} ${sdiSpaceFunctionName(code)}`;
