import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import type { RoomConnectivityGraph } from "./connectivity";
import { resolveZoneFunctionalSemantics } from "./space-semantics";
import type { S1FunctionalRelationshipMeasurement } from "./s1";
import { S1_FUNCTIONAL_RELATION_METRIC_ID, S1_FUNCTIONAL_RELATION_METRIC_NAME, S1_FUNCTIONAL_RELATION_SCORING_RULE_STATUS, S1_FUNCTIONAL_RELATION_SCORING_RULE_VERSION } from "./s1-functional-relation-scoring-config";

export type S1FunctionalRelationScoringStatus = "scored" | "excluded" | "not_applicable" | "unable_to_determine";
export type S1FunctionalRelationScore = { metricId: typeof S1_FUNCTIONAL_RELATION_METRIC_ID; pairId: string; scoringStatus: S1FunctionalRelationScoringStatus; score: number | null; matchedRuleId: string | null; scoreExplanation: string; excludedFromScoring: boolean; exclusionReason: string | null; ruleVersion: typeof S1_FUNCTIONAL_RELATION_SCORING_RULE_VERSION };
export type S1FunctionalRelationScoreSummary = { metricId: typeof S1_FUNCTIONAL_RELATION_METRIC_ID; metricName: typeof S1_FUNCTIONAL_RELATION_METRIC_NAME; scoringStatus: "scored" | "not_applicable" | "unable_to_determine"; score: number | null; ruleVersion: typeof S1_FUNCTIONAL_RELATION_SCORING_RULE_VERSION; ruleStatus: typeof S1_FUNCTIONAL_RELATION_SCORING_RULE_STATUS; pairScores: S1FunctionalRelationScore[]; counts: Record<S1FunctionalRelationScoringStatus, number> };

const scored = (pairId: string, ruleId: string, score: number, explanation: string): S1FunctionalRelationScore => ({ metricId: S1_FUNCTIONAL_RELATION_METRIC_ID, pairId, scoringStatus: "scored", score, matchedRuleId: ruleId, scoreExplanation: explanation, excludedFromScoring: false, exclusionReason: null, ruleVersion: S1_FUNCTIONAL_RELATION_SCORING_RULE_VERSION });
const unresolved = (pairId: string, explanation: string): S1FunctionalRelationScore => ({ metricId: S1_FUNCTIONAL_RELATION_METRIC_ID, pairId, scoringStatus: "unable_to_determine", score: null, matchedRuleId: null, scoreExplanation: explanation, excludedFromScoring: false, exclusionReason: null, ruleVersion: S1_FUNCTIONAL_RELATION_SCORING_RULE_VERSION });

type IntermediateKind = "service" | "circulation" | "closet" | "major" | "unknown";
const intermediateKind = (measurement: S1FunctionalRelationshipMeasurement, handoff: EvaluationHandoff, graph: RoomConnectivityGraph): IntermediateKind => {
  if (measurement.intermediateRoomRegionIds.length !== 1) return "unknown";
  const zoneIds = graph.roomAnalysis.roomToZoneIds[measurement.intermediateRoomRegionIds[0]!] ?? [], zones = new Map(handoff.zones.map((zone) => [zone.id, zone]));
  const resolutions = zoneIds.flatMap((id) => { const zone = zones.get(id); return zone ? [resolveZoneFunctionalSemantics(zone)] : []; });
  if (!resolutions.length) return "unknown";
  const semantics = new Set(resolutions.flatMap((resolution) => [...resolution.semantics]));
  if (!semantics.size) return "unknown";
  const has = (values: string[]) => values.some((value) => semantics.has(value));
  const service = has(["pantry"]), circulation = has(["circulation"]), closet = has(["walk_in_closet"]), major = has(["bathroom", "bedroom", "dining", "kitchen", "laundry", "living_room", "office", "recreation", "study"]);
  return [service, circulation, closet, major].filter(Boolean).length === 1 ? closet ? "closet" : service ? "service" : circulation ? "circulation" : "major" : "unknown";
};

function scoreKitchenDining(measurement: S1FunctionalRelationshipMeasurement, handoff: EvaluationHandoff, graph: RoomConnectivityGraph): S1FunctionalRelationScore {
  const id = measurement.measurementId;
  if (measurement.relationType === "same_open_space") return scored(id, "S1-FR-001-R01", 100, "厨房与餐厅位于同一开放空间。");
  if (measurement.relationType === "direct_connection") return scored(id, "S1-FR-001-R02", 100, "厨房与餐厅通过门或开放连接直接相连，且不跨楼层。");
  if (measurement.relationType === "different_level") return scored(id, "S1-FR-001-R07", 0, "厨房与餐厅位于不同楼层。");
  if (measurement.relationType === "multiple_intermediate_spaces") return scored(id, "S1-FR-001-R06", 20, "厨房与餐厅之间需要经过两个及以上空间。");
  if (measurement.relationType === "one_intermediate_space") { const kind = intermediateKind(measurement, handoff, graph); if (kind === "service") return scored(id, "S1-FR-001-R03", 90, "一个可靠识别的餐厨服务空间位于厨房与餐厅之间。"); if (kind === "circulation") return scored(id, "S1-FR-001-R04", 70, "一个可靠识别的交通空间位于厨房与餐厅之间。"); if (kind === "major") return scored(id, "S1-FR-001-R05", 40, "一个其他主要功能空间位于厨房与餐厅之间。"); return unresolved(id, "中间空间的功能语义不足，无法可靠判定其属于服务、交通或主要功能空间。"); }
  return scored(id, "S1-FR-001-R08", 0, "可靠数据表明厨房与餐厅不连通。");
}

function scorePrimarySuite(measurement: S1FunctionalRelationshipMeasurement, handoff: EvaluationHandoff, graph: RoomConnectivityGraph): S1FunctionalRelationScore {
  const id = measurement.measurementId;
  if (measurement.relationType === "different_level") return scored(id, "S1-FR-002-R08", 0, "主卧与主卫位于不同楼层。");
  if (measurement.relationType === "same_open_space") return scored(id, "S1-FR-002-R04", 30, "主卧与主卫处于同一无隔断 Room Region。");
  if (measurement.relationType === "direct_connection") return measurement.connectionDoorIds.length ? scored(id, "S1-FR-002-R01", 100, "主卧与主卫通过门直接连接，且不跨楼层。") : scored(id, "S1-FR-002-R05", 30, "主卧与主卫仅通过开放连接相邻，缺少门形成隐私分隔。");
  if (measurement.relationType === "multiple_intermediate_spaces") return scored(id, "S1-FR-002-R07", 10, "主卧与主卫之间需要经过两个及以上空间。");
  if (measurement.relationType === "one_intermediate_space") { const kind = intermediateKind(measurement, handoff, graph); if (kind === "closet") return scored(id, "S1-FR-002-R02", 95, "一个可靠识别的步入式衣帽间或更衣区位于主卧与主卫之间。"); if (kind === "circulation") return scored(id, "S1-FR-002-R03", 60, "一个可靠识别的交通空间位于主卧与主卫之间。"); if (kind === "major") return scored(id, "S1-FR-002-R06", 30, "一个其他主要功能空间位于主卧与主卫之间。"); return unresolved(id, "中间空间的功能语义不足，无法可靠判定其属于衣帽、更衣、交通或主要功能空间。"); }
  return scored(id, "S1-FR-002-R09", 0, "可靠数据表明主卧与主卫不连通。");
}

export function scoreS1FunctionalRelationships(measurements: S1FunctionalRelationshipMeasurement[], handoff: EvaluationHandoff, graph: RoomConnectivityGraph): S1FunctionalRelationScoreSummary {
  const pairScores = measurements.map((measurement): S1FunctionalRelationScore => {
    if (measurement.coveredByG4Requirement) return { metricId: S1_FUNCTIONAL_RELATION_METRIC_ID, pairId: measurement.measurementId, scoringStatus: "excluded", score: null, matchedRuleId: null, scoreExplanation: "该空间关系已由客户需求 G4 检查，本项不重复计入 S1 评分。", excludedFromScoring: true, exclusionReason: "G4 space_adjacency 或 space_separation 已覆盖该关系对", ruleVersion: S1_FUNCTIONAL_RELATION_SCORING_RULE_VERSION };
    if (measurement.status === "not_applicable") return { metricId: S1_FUNCTIONAL_RELATION_METRIC_ID, pairId: measurement.measurementId, scoringStatus: "not_applicable", score: null, matchedRuleId: null, scoreExplanation: "该关系对不适用，未进入评分分母。", excludedFromScoring: false, exclusionReason: null, ruleVersion: S1_FUNCTIONAL_RELATION_SCORING_RULE_VERSION };
    if (measurement.source?.semanticSource !== "sdi_code" || measurement.target?.semanticSource !== "sdi_code") return unresolved(measurement.measurementId, "相关空间尚未绑定SDI空间功能编码，当前名称识别仅用于旧数据兼容，不能生成正式S1分数");
    const reliablyDisconnected = Boolean(measurement.source && measurement.target && measurement.source.confidence !== "low" && measurement.target.confidence !== "low" && measurement.diagnostics.some((item) => item.includes("不存在可靠的 Room Connectivity Graph 路径")));
    if (measurement.status === "unable_to_determine" && !reliablyDisconnected) return unresolved(measurement.measurementId, "现有拓扑测量无法可靠确定，不能伪造局部分数。");
    return measurement.measurementId === "S1-REL-001" ? scoreKitchenDining(measurement, handoff, graph) : scorePrimarySuite(measurement, handoff, graph);
  });
  const counts = Object.fromEntries((["scored", "excluded", "not_applicable", "unable_to_determine"] as const).map((status) => [status, pairScores.filter((pair) => pair.scoringStatus === status).length])) as Record<S1FunctionalRelationScoringStatus, number>;
  const unresolvedPairs = counts.unable_to_determine > 0, values = pairScores.flatMap((pair) => pair.scoringStatus === "scored" && pair.score !== null ? [pair.score] : []);
  const score = unresolvedPairs || !values.length ? null : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
  return { metricId: S1_FUNCTIONAL_RELATION_METRIC_ID, metricName: S1_FUNCTIONAL_RELATION_METRIC_NAME, scoringStatus: unresolvedPairs ? "unable_to_determine" : values.length ? "scored" : "not_applicable", score, ruleVersion: S1_FUNCTIONAL_RELATION_SCORING_RULE_VERSION, ruleStatus: S1_FUNCTIONAL_RELATION_SCORING_RULE_STATUS, pairScores, counts };
}
