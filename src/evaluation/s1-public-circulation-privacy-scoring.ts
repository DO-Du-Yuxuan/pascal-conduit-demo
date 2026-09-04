import type { S1PublicCirculationPrivacyReport, S1PublicCirculationRouteMeasurement, S1PublicRouteGroupId } from "./s1-public-circulation-privacy";
import { S1_PUBLIC_CIRCULATION_PRIVACY_METRIC_ID, S1_PUBLIC_CIRCULATION_PRIVACY_METRIC_NAME, S1_PUBLIC_CIRCULATION_PRIVACY_SCORING_RULE_STATUS, S1_PUBLIC_CIRCULATION_PRIVACY_SCORING_RULE_VERSION } from "./s1-public-circulation-privacy-scoring-config";

export type S1PublicCirculationPrivacyScoringStatus = "scored" | "not_applicable" | "unable_to_determine";
export type S1PublicCirculationPrivacyRouteScore = {
  metricId: typeof S1_PUBLIC_CIRCULATION_PRIVACY_METRIC_ID;
  routeId: string;
  routeGroup: S1PublicRouteGroupId;
  scoringStatus: S1PublicCirculationPrivacyScoringStatus;
  score: number | null;
  matchedRuleId: string | null;
  scoreExplanation: string;
  ruleVersion: typeof S1_PUBLIC_CIRCULATION_PRIVACY_SCORING_RULE_VERSION;
};
export type S1PublicCirculationPrivacyGroupScore = {
  routeGroup: S1PublicRouteGroupId;
  label: string;
  status: S1PublicCirculationPrivacyScoringStatus;
  score: number | null;
  evaluableRouteCount: number;
  safeRouteCount: number;
  mandatoryPrivateRouteCount: number;
  unableRouteCount: number;
  notApplicableCount: number;
  diagnostics: string[];
};
export type S1PublicCirculationPrivacyScoreSummary = {
  metricId: typeof S1_PUBLIC_CIRCULATION_PRIVACY_METRIC_ID;
  metricName: typeof S1_PUBLIC_CIRCULATION_PRIVACY_METRIC_NAME;
  status: S1PublicCirculationPrivacyScoringStatus;
  score: number | null;
  applicableGroupCount: number;
  notApplicableGroupCount: number;
  unableGroupCount: number;
  safeRouteCount: number;
  mandatoryPrivateRouteCount: number;
  ruleVersion: typeof S1_PUBLIC_CIRCULATION_PRIVACY_SCORING_RULE_VERSION;
  ruleStatus: typeof S1_PUBLIC_CIRCULATION_PRIVACY_SCORING_RULE_STATUS;
  routeScores: S1PublicCirculationPrivacyRouteScore[];
  groupScores: S1PublicCirculationPrivacyGroupScore[];
};

const roundOne = (value: number) => Math.round(value * 10) / 10;

function scoreRoute(route: S1PublicCirculationRouteMeasurement): S1PublicCirculationPrivacyRouteScore {
  const base = { metricId: S1_PUBLIC_CIRCULATION_PRIVACY_METRIC_ID, routeId: route.routeId, routeGroup: route.routeGroup, ruleVersion: S1_PUBLIC_CIRCULATION_PRIVACY_SCORING_RULE_VERSION };
  if (route.resultType === "privacy_safe_route_available") return { ...base, scoringStatus: "scored", score: 100, matchedRuleId: "S1-PCP-R01", scoreExplanation: "存在不穿越私密空间的可行路线。" };
  if (route.resultType === "private_space_mandatory") return { ...base, scoringStatus: "scored", score: 0, matchedRuleId: "S1-PCP-R02", scoreExplanation: "前往该公共空间的所有可行路线都必须经过私密空间。" };
  if (route.resultType === "baseline_unreachable") return { ...base, scoringStatus: "unable_to_determine", score: null, matchedRuleId: "S1-PCP-R03", scoreExplanation: "起点与目的空间在原始空间图中不可达，无法评价其隐私穿越表现，也不在本项重复处罚。" };
  if (route.resultType === "not_applicable") return { ...base, scoringStatus: "not_applicable", score: null, matchedRuleId: "S1-PCP-R05", scoreExplanation: "该路线不适用，未进入评分分母。" };
  return { ...base, scoringStatus: "unable_to_determine", score: null, matchedRuleId: "S1-PCP-R04", scoreExplanation: "空间语义或拓扑数据不足，无法完成正式评分。" };
}

export function scoreS1PublicCirculationPrivacy(measurement: S1PublicCirculationPrivacyReport): S1PublicCirculationPrivacyScoreSummary {
  const routeScores = measurement.measurements.map(scoreRoute), scoreByRouteId = new Map(routeScores.map((score) => [score.routeId, score]));
  const groupScores = measurement.groups.map((group): S1PublicCirculationPrivacyGroupScore => {
    const routes = measurement.measurements.filter((route) => route.routeGroup === group.routeGroup), scores = routes.map((route) => scoreByRouteId.get(route.routeId)!);
    const safeRouteCount = routes.filter((route) => route.resultType === "privacy_safe_route_available").length, mandatoryPrivateRouteCount = routes.filter((route) => route.resultType === "private_space_mandatory").length, unableRouteCount = scores.filter((score) => score.scoringStatus === "unable_to_determine").length, notApplicableCount = scores.filter((score) => score.scoringStatus === "not_applicable").length, evaluable = scores.filter((score) => score.scoringStatus === "scored" && score.score !== null);
    if (group.status === "not_applicable" || (!routes.length && group.status !== "unable_to_determine")) return { routeGroup: group.routeGroup, label: group.label, status: "not_applicable", score: null, evaluableRouteCount: 0, safeRouteCount, mandatoryPrivateRouteCount, unableRouteCount: 0, notApplicableCount, diagnostics: group.diagnostics };
    if (group.status === "unable_to_determine" || unableRouteCount > 0) return { routeGroup: group.routeGroup, label: group.label, status: "unable_to_determine", score: null, evaluableRouteCount: evaluable.length, safeRouteCount, mandatoryPrivateRouteCount, unableRouteCount, notApplicableCount, diagnostics: group.diagnostics };
    return { routeGroup: group.routeGroup, label: group.label, status: "scored", score: roundOne(evaluable.reduce((sum, score) => sum + score.score!, 0) / evaluable.length), evaluableRouteCount: evaluable.length, safeRouteCount, mandatoryPrivateRouteCount, unableRouteCount, notApplicableCount, diagnostics: group.diagnostics };
  });
  const applicable = groupScores.filter((group) => group.status === "scored"), unable = groupScores.filter((group) => group.status === "unable_to_determine"), status: S1PublicCirculationPrivacyScoringStatus = unable.length ? "unable_to_determine" : applicable.length ? "scored" : "not_applicable";
  return { metricId: S1_PUBLIC_CIRCULATION_PRIVACY_METRIC_ID, metricName: S1_PUBLIC_CIRCULATION_PRIVACY_METRIC_NAME, status, score: status === "scored" ? roundOne(applicable.reduce((sum, group) => sum + group.score!, 0) / applicable.length) : null, applicableGroupCount: applicable.length, notApplicableGroupCount: groupScores.filter((group) => group.status === "not_applicable").length, unableGroupCount: unable.length, safeRouteCount: routeScores.filter((score) => score.matchedRuleId === "S1-PCP-R01").length, mandatoryPrivateRouteCount: routeScores.filter((score) => score.matchedRuleId === "S1-PCP-R02").length, ruleVersion: S1_PUBLIC_CIRCULATION_PRIVACY_SCORING_RULE_VERSION, ruleStatus: S1_PUBLIC_CIRCULATION_PRIVACY_SCORING_RULE_STATUS, routeScores, groupScores };
}
