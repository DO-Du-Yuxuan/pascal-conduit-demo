import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { CONFIRMED_G1_RULES, CONFIRMED_G3_RULES } from "./product-rule-scope";
import { evaluateG2TechnicalRules, type G2EvaluationContext } from "./g2-rules";
import { G1_GEOMETRY_TOLERANCES } from "./tolerances";
import type { EvaluationReport, G2EvaluationSummary, G3EvaluationSummary, RuleResult, RuleStatus } from "./types";
import type { RequirementHandoff } from "../requirements/requirement-handoff";
import { evaluateG4RequirementRules } from "./g4-requirements";
import type { RoomRegionAnalysis } from "./room-regions";
import type { RoomConnectivityGraph } from "./connectivity";

const emptyCounts = (): Record<RuleStatus, number> => ({ pass: 0, issue: 0, unable_to_determine: 0, not_applicable: 0 });
const statusFromCounts = (counts: Record<RuleStatus, number>): RuleStatus => counts.issue ? "issue" : counts.unable_to_determine ? "unable_to_determine" : counts.pass ? "pass" : "not_applicable";
const addStatus = (counts: Record<RuleStatus, number>, rule: RuleResult) => { counts[rule.status]++; };

function summarizeG3(rules: RuleResult[]): G3EvaluationSummary {
  const g3 = rules.filter((rule) => rule.ruleId.startsWith("G3-")), counts = emptyCounts(), sameFloorUsability = emptyCounts(), crossFloorUsability = emptyCounts(), specialistChecks = emptyCounts();
  g3.forEach((rule) => {
    addStatus(counts, rule);
    addStatus(rule.ruleId === "G3-001" ? crossFloorUsability : Number(rule.ruleId.slice(3)) <= 13 ? sameFloorUsability : specialistChecks, rule);
  });
  const severeIds = new Set(["G3-001", "G3-002", "G3-003", "G3-005", "G3-007", "G3-033", "G3-037"]), issueRules = g3.filter((rule) => rule.status === "issue");
  const ids = new Set(g3.flatMap((rule) => [...rule.normalizedObjectIds, ...rule.diagnostics.flatMap((diagnostic) => diagnostic.normalizedObjectIds)]));
  const roomIds = [...ids].filter((id) => id.includes("-room-") || id.startsWith("room-region-"));
  return {
    overallStatus: statusFromCounts(counts), counts,
    severityCounts: { severe: issueRules.filter((rule) => severeIds.has(rule.ruleId)).length, major: issueRules.filter((rule) => !severeIds.has(rule.ruleId) && rule.severity === "error").length, general: issueRules.filter((rule) => rule.severity !== "error").length },
    involvedRoomCount: new Set(roomIds).size,
    involvedObjectCount: new Set([...ids].filter((id) => !roomIds.includes(id))).size,
    sections: { sameFloorUsability, crossFloorUsability, specialistChecks, dataGaps: counts.unable_to_determine },
  };
}

function summarizeG2(rules: RuleResult[]): G2EvaluationSummary {
  const g2 = rules.filter((rule) => rule.ruleId.startsWith("G2-")), counts = emptyCounts();
  g2.forEach((rule) => addStatus(counts, rule));
  return {
    overallStatus: statusFromCounts(counts),
    counts,
    checkedObjectCount: new Set(g2.flatMap((rule) => [...rule.normalizedObjectIds, ...rule.measurements.map((measurement) => measurement.normalizedObjectId).filter((id): id is string => Boolean(id))])).size,
    issueObjectCount: new Set(g2.filter((rule) => rule.status === "issue").flatMap((rule) => rule.diagnostics.filter((diagnostic) => diagnostic.severity === "error").flatMap((diagnostic) => diagnostic.normalizedObjectIds.slice(0, 1)))).size,
    unableReasonCount: g2.reduce((sum, rule) => sum + rule.missingData.length, 0),
    jurisdiction: "美国华盛顿州 Bellevue",
    codeVersion: "2021 Bellevue Construction Codes / Ordinance 6781",
  };
}

export function evaluateG1Foundation(handoff: EvaluationHandoff, generatedAt = new Date().toISOString()): EvaluationReport {
  const rules = CONFIRMED_G1_RULES.map((rule) => rule(handoff));
  const counts: Record<RuleStatus, number> = { pass: 0, issue: 0, unable_to_determine: 0, not_applicable: 0 };
  rules.forEach((rule) => counts[rule.status]++);
  const overallStatus: RuleStatus = counts.issue ? "issue" : counts.unable_to_determine ? "unable_to_determine" : counts.pass ? "pass" : "not_applicable";
  return { reportVersion: "1.0", handoffSchemaVersion: handoff.schemaVersion, generatedAt, scope: "G1-foundation", overallStatus, counts, tolerances: G1_GEOMETRY_TOLERANCES, rules, diagnostics: handoff.diagnostics };
}

export function evaluateFoundation(handoff: EvaluationHandoff, generatedAt = new Date().toISOString()): EvaluationReport {
  const rules = [...CONFIRMED_G1_RULES, ...CONFIRMED_G3_RULES].map((rule) => rule(handoff));
  const counts: Record<RuleStatus, number> = { pass: 0, issue: 0, unable_to_determine: 0, not_applicable: 0 };
  rules.forEach((rule) => counts[rule.status]++);
  const overallStatus: RuleStatus = counts.issue ? "issue" : counts.unable_to_determine ? "unable_to_determine" : counts.pass ? "pass" : "not_applicable";
  return { reportVersion: "1.0", handoffSchemaVersion: handoff.schemaVersion, generatedAt, scope: "G1-G3-foundation", overallStatus, counts, g3Summary: summarizeG3(rules), tolerances: G1_GEOMETRY_TOLERANCES, rules, diagnostics: handoff.diagnostics };
}

export function evaluateG2Technical(handoff: EvaluationHandoff, context: G2EvaluationContext, generatedAt = new Date().toISOString()): EvaluationReport {
  const rules = evaluateG2TechnicalRules(handoff, context), counts = emptyCounts();
  rules.forEach((rule) => addStatus(counts, rule));
  return { reportVersion: "1.0", handoffSchemaVersion: handoff.schemaVersion, generatedAt, scope: "G2-technical", overallStatus: statusFromCounts(counts), counts, g2Summary: summarizeG2(rules), tolerances: G1_GEOMETRY_TOLERANCES, rules, diagnostics: handoff.diagnostics };
}

export function evaluateG4RequirementsOnly(handoff: EvaluationHandoff, requirements: RequirementHandoff, generatedAt = new Date().toISOString(), analysis?: RoomRegionAnalysis, graph?: RoomConnectivityGraph): EvaluationReport {
  const rules = evaluateG4RequirementRules(handoff, requirements, analysis, graph), counts = emptyCounts();
  rules.forEach((rule) => addStatus(counts, rule));
  return { reportVersion: "1.0", handoffSchemaVersion: handoff.schemaVersion, generatedAt, scope: "G4-requirements", overallStatus: statusFromCounts(counts), counts, tolerances: G1_GEOMETRY_TOLERANCES, rules, diagnostics: handoff.diagnostics };
}

export function requirementGateBlocks(rules: ReadonlyArray<Pick<RuleResult, "ruleId" | "status">>): boolean {
  const g4Rules = rules.filter((rule) => rule.ruleId.startsWith("G4-"));
  return g4Rules.length > 0 && g4Rules.some((rule) => rule.status !== "pass");
}

export function evaluateAll(handoff: EvaluationHandoff, context: G2EvaluationContext, generatedAt = new Date().toISOString(), requirements?: RequirementHandoff | null): EvaluationReport {
  const g1g3 = evaluateFoundation(handoff, generatedAt), g2 = evaluateG2TechnicalRules(handoff, context), g4 = requirements ? evaluateG4RequirementRules(handoff, requirements) : [], rules = [...g1g3.rules.filter((rule) => rule.ruleId.startsWith("G1-")), ...g2, ...g1g3.rules.filter((rule) => rule.ruleId.startsWith("G3-")), ...g4], counts = emptyCounts();
  rules.forEach((rule) => addStatus(counts, rule));
  return { ...g1g3, scope: requirements ? "G1-G2-G3-G4-foundation" : "G1-G2-G3-foundation", overallStatus: statusFromCounts(counts), counts, g2Summary: summarizeG2(rules), rules };
}

export type { EvaluationReport, RuleResult, RuleStatus } from "./types";
export type { G2EvaluationContext } from "./g2-rules";
