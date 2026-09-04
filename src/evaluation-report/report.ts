import type { EvaluationReport as SourceEvaluationReport, RuleMeasurement, RuleResult, RuleStatus } from "../evaluation/types";
import type { RequirementType } from "../requirements/requirement-handoff";

export type FindingPriority = "P0" | "P1" | "P2" | "P3" | "P4";
export type FindingStatus = RuleStatus | "merged" | "cancelled" | "blocked_by_dependency";
export type FindingLocation = { levelId?: string; levelName?: string; roomOrZoneIds: string[] };
export type FindingFocusTarget = { primaryId?: string; relatedIds: string[] };
export type FindingDependency = { ruleId: string; reason: string };

export type FindingEvidence = {
  measurements: RuleMeasurement[];
  thresholds: RuleResult["thresholds"];
  diagnostics: RuleResult["diagnostics"];
  details: string[];
};

export type Finding = {
  findingId: string;
  sourceGroup: "G1" | "G2" | "G3" | "G4";
  ruleId: string;
  ruleName: string;
  status: FindingStatus;
  priority: FindingPriority;
  title: string;
  userSummary: string;
  recommendation: string;
  location: FindingLocation;
  primaryObjectIds: string[];
  relatedObjectIds: string[];
  measuredValue: RuleMeasurement["value"] | null;
  threshold: RuleResult["thresholds"][number] | null;
  margin: number | null;
  measurementBasis?: RuleMeasurement["measurementBasis"];
  confidence: RuleResult["confidence"];
  assumptions: string[];
  missingData: string[];
  dependencyRuleIds: string[];
  relatedFindingIds: string[];
  focusTarget: FindingFocusTarget;
  technicalDetails: FindingEvidence;
  rawRuleResult: RuleResult;
  customerRequirement?: {
    requirementId: string;
    requirementType: RequirementType;
    targetDescription: string;
    actualResult: string;
    reason: string;
    originalDescription?: string;
  };
};

export type FindingGroup = {
  groupId: string;
  primaryFindingId: string;
  findingIds: string[];
  selectionReason: string;
  dependencies: FindingDependency[];
};

export type ReportSummary = {
  counts: Record<FindingStatus, number>;
  priorityCounts: Record<FindingPriority, number>;
  groupCounts: Record<"G1" | "G2" | "G3" | "G4", Record<RuleStatus, number>>;
};

export type UnifiedEvaluationReport = {
  reportVersion: "0.1";
  generatedAt: string;
  sourceReport: SourceEvaluationReport;
  findings: Finding[];
  groups: FindingGroup[];
  summary: ReportSummary;
};

const groups = ["G1", "G2", "G3", "G4"] as const;
const statuses = ["pass", "issue", "unable_to_determine", "not_applicable", "merged", "cancelled", "blocked_by_dependency"] as const;
const priorities = ["P0", "P1", "P2", "P3", "P4"] as const;
const groupOf = (ruleId: string): "G1" | "G2" | "G3" | "G4" => ruleId.startsWith("G2-") ? "G2" : ruleId.startsWith("G3-") ? "G3" : ruleId.startsWith("G4-") ? "G4" : "G1";
const dependencyIds = (rule: RuleResult) => [...new Set(rule.measurements.filter((measurement) => /dependencyRuleId|DependencyRuleId/.test(measurement.name) && typeof measurement.value === "string").map((measurement) => measurement.value as string))];
const objectIds = (rule: RuleResult) => [...new Set([...rule.normalizedObjectIds, ...rule.diagnostics.flatMap((diagnostic) => diagnostic.normalizedObjectIds)])];
const recommended = (rule: RuleResult) => rule.diagnostics.find((diagnostic) => diagnostic.recommendation)?.recommendation ?? (rule.status === "unable_to_determine" ? "补充缺失数据后重新评价。" : rule.status === "issue" ? "根据技术详情修正方案。" : "无需处理。");
const isBlockedEeroSill = (rule: RuleResult) => rule.ruleId === "G2-008" && rule.status === "unable_to_determine" && rule.measurements.some((measurement) => measurement.name === "blockedRoomCount" && Number(measurement.value) > 0) && !rule.diagnostics.some((diagnostic) => diagnostic.origin === "insufficient_information");

function priorityFor(rule: RuleResult, blockedRuleIds: Set<string>): FindingPriority {
  if (rule.status === "pass" || rule.status === "not_applicable") return "P4";
  if (rule.status === "unable_to_determine") return "P3";
  if (groupOf(rule.ruleId) === "G2") return "P1";
  if (groupOf(rule.ruleId) === "G1" && blockedRuleIds.has(rule.ruleId)) return "P0";
  return "P2";
}

function normalize(rule: RuleResult, blockedRuleIds: Set<string>): Finding {
  const ids = objectIds(rule), primaryIds = rule.diagnostics.filter((diagnostic) => diagnostic.severity === "error" || diagnostic.severity === "warning").flatMap((diagnostic) => diagnostic.normalizedObjectIds.slice(0, 1));
  const primaryObjectIds = [...new Set(primaryIds.length ? primaryIds : ids.slice(0, 1))], measured = rule.measurements[0];
  return {
    findingId: `finding:${rule.ruleId}`, sourceGroup: groupOf(rule.ruleId), ruleId: rule.ruleId, ruleName: rule.ruleName,
    status: isBlockedEeroSill(rule) ? "blocked_by_dependency" : rule.status, priority: priorityFor(rule, blockedRuleIds), title: rule.ruleName,
    userSummary: rule.summary, recommendation: recommended(rule), location: { roomOrZoneIds: ids.filter((id) => id.includes("-room-") || id.startsWith("room-region-") || id.startsWith("zone_")) },
    primaryObjectIds, relatedObjectIds: ids.filter((id) => !primaryObjectIds.includes(id)), measuredValue: measured?.value ?? null, threshold: rule.thresholds[0] ?? null, margin: measured?.margin ?? null,
    measurementBasis: measured?.measurementBasis, confidence: rule.confidence, assumptions: [...new Set(rule.measurements.flatMap((measurement) => measurement.assumptions ?? []))], missingData: rule.missingData,
    dependencyRuleIds: dependencyIds(rule), relatedFindingIds: [], focusTarget: { primaryId: primaryObjectIds[0], relatedIds: ids.filter((id) => !primaryObjectIds.includes(id)) },
    technicalDetails: { measurements: rule.measurements, thresholds: rule.thresholds, diagnostics: rule.diagnostics, details: rule.details }, rawRuleResult: rule,
    customerRequirement: rule.customerRequirement,
  };
}

/** Builds a presentation-only report. It never changes source RuleResult objects. */
export function buildUnifiedEvaluationReport(sourceReport: SourceEvaluationReport): UnifiedEvaluationReport {
  const blockedRuleIds = new Set<string>();
  sourceReport.rules.filter((rule) => groupOf(rule.ruleId) === "G1" && rule.status === "issue").forEach((g1) => {
    const ids = new Set(objectIds(g1));
    if (sourceReport.rules.some((other) => (groupOf(other.ruleId) === "G2" || groupOf(other.ruleId) === "G3") && other.status === "unable_to_determine" && objectIds(other).some((id) => ids.has(id)))) blockedRuleIds.add(g1.ruleId);
  });
  const findings = sourceReport.rules.map((rule) => normalize(rule, blockedRuleIds));
  const byRule = new Map(findings.map((finding) => [finding.ruleId, finding]));
  findings.forEach((finding) => { finding.relatedFindingIds = finding.dependencyRuleIds.map((id) => byRule.get(id)?.findingId).filter((id): id is string => Boolean(id)); });
  const groupsOut = findings.filter((finding) => finding.status !== "blocked_by_dependency" && finding.status !== "merged" && finding.status !== "cancelled").map((finding) => ({ groupId: `group:${finding.ruleId}`, primaryFindingId: finding.findingId, findingIds: [finding.findingId, ...finding.relatedFindingIds], selectionReason: finding.relatedFindingIds.length ? "主规则保留，依赖规则仅作为技术证据。" : "该规则是独立的用户问题。", dependencies: finding.dependencyRuleIds.map((ruleId) => ({ ruleId, reason: "底层规则显式声明的依赖。" })) }));
  const counts = Object.fromEntries(statuses.map((status) => [status, findings.filter((finding) => finding.status === status).length])) as Record<FindingStatus, number>;
  const priorityCounts = Object.fromEntries(priorities.map((priority) => [priority, findings.filter((finding) => finding.priority === priority && finding.status !== "blocked_by_dependency").length])) as Record<FindingPriority, number>;
  const groupCounts = Object.fromEntries(groups.map((group) => [group, Object.fromEntries((statuses.slice(0, 4) as readonly RuleStatus[]).map((status) => [status, findings.filter((finding) => finding.sourceGroup === group && finding.status === status).length]))])) as ReportSummary["groupCounts"];
  return { reportVersion: "0.1", generatedAt: sourceReport.generatedAt, sourceReport, findings, groups: groupsOut, summary: { counts, priorityCounts, groupCounts } };
}

export function visibleReportFindings(report: UnifiedEvaluationReport, filters: { groups?: Array<"G1" | "G2" | "G3" | "G4">; statuses?: FindingStatus[]; priorities?: FindingPriority[] } = {}) {
  return report.findings.filter((finding) => finding.status !== "merged" && finding.status !== "cancelled" && finding.status !== "blocked_by_dependency" && (!filters.groups?.length || filters.groups.includes(finding.sourceGroup)) && (!filters.statuses?.length || filters.statuses.includes(finding.status)) && (!filters.priorities?.length || filters.priorities.includes(finding.priority)));
}

export function reportHasSourceGroup(report: UnifiedEvaluationReport | null, group: "G1" | "G2" | "G3" | "G4"): boolean {
  return Boolean(report?.findings.some((finding) => finding.sourceGroup === group));
}

/** Preserves existing G1–G3 priority behavior while placing mandatory customer mismatches deliberately. */
export function compareFindingsForDisplay(a: Finding, b: Finding): number {
  const rank = (finding: Finding) => {
    if (finding.sourceGroup === "G4" && finding.status === "issue") return 0;
    if (finding.sourceGroup === "G4" && finding.status === "unable_to_determine") return 1;
    if (finding.status === "issue") {
      if (finding.priority === "P0") return 10;
      if (finding.sourceGroup === "G2") return 20;
      return 30 + Number(finding.priority.slice(1));
    }
    if (finding.status === "unable_to_determine") {
      return 50;
    }
    if (finding.status === "pass") return 60;
    return 70;
  };
  return rank(a) - rank(b) || a.ruleId.localeCompare(b.ruleId);
}
