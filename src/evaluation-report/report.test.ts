import { describe, expect, it } from "vitest";
import bellevueDemoProject from "../../sample-data/Bellevue demo.json";
import { evaluateAll } from "../evaluation/evaluate";
import type { EvaluationReport, RuleResult } from "../evaluation/types";
import { BELLEVUE_DETACHED_DWELLING_G2_CONTEXT } from "../evaluation/g2-rules";
import { buildEvaluationHandoff } from "../parser/evaluation-handoff";
import { parseProject } from "../parser/parse";
import { buildUnifiedEvaluationReport, compareFindingsForDisplay, visibleReportFindings } from "./report";

const rule = (ruleId: string, status: RuleResult["status"], objectId = "room-a", extra: Partial<RuleResult> = {}): RuleResult => ({ ruleId, ruleName: `${ruleId} 名称`, status, severity: status === "issue" ? "error" : "warning", summary: `${ruleId} 摘要`, details: ["技术依据"], normalizedObjectIds: [objectId], pascalSourceIds: [objectId], measurements: [], thresholds: [], missingData: [], confidence: { level: "high", score: .9, reasons: [] }, diagnostics: [], ...extra });
const source = (rules: RuleResult[]): EvaluationReport => ({ reportVersion: "1.0", handoffSchemaVersion: "1", generatedAt: "2026-01-01T00:00:00.000Z", scope: "G1-G2-G3-foundation", overallStatus: "issue", counts: { pass: 0, issue: 0, unable_to_determine: 0, not_applicable: 0 }, tolerances: {} as EvaluationReport["tolerances"], rules, diagnostics: [] });

describe("unified evaluation report", () => {
  it("normalizes G1, G2 and G3 issues without mutating source results", () => { const input = source([rule("G1-001", "issue"), rule("G2-011", "issue"), rule("G3-001", "issue")]), report = buildUnifiedEvaluationReport(input); expect(report.findings.map((finding) => finding.sourceGroup)).toEqual(["G1", "G2", "G3"]); expect(report.findings[1]?.rawRuleResult).toBe(input.rules[1]); });
  it("carries unable evidence, missing data and recommendations", () => { const report = buildUnifiedEvaluationReport(source([rule("G2-020", "unable_to_determine", "shower", { missingData: ["shower.innerBoundary"], measurements: [{ name: "height", value: 70, unit: "in", margin: 0, measurementBasis: "derived", assumptions: ["完成面未知"], confidence: "medium" }], diagnostics: [{ severity: "warning", code: "missing", message: "缺少轮廓", normalizedObjectIds: ["shower"], recommendation: "补充内边界。" }] })])); expect(report.findings[0]).toMatchObject({ priority: "P3", missingData: ["shower.innerBoundary"], recommendation: "补充内边界。", measuredValue: 70, margin: 0 }); });
  it("counts pass and not applicable as P4", () => { const report = buildUnifiedEvaluationReport(source([rule("G1-001", "pass"), rule("G2-001", "not_applicable")])); expect(report.summary.priorityCounts.P4).toBe(2); expect(report.summary.counts.pass).toBe(1); });
  it("keeps blocked G2-008 evidence but removes its duplicate card", () => { const report = buildUnifiedEvaluationReport(source([rule("G2-007", "unable_to_determine"), rule("G2-008", "unable_to_determine", "room-a", { measurements: [{ name: "blockedRoomCount", value: 2 }, { name: "dependencyRuleId", value: "G2-007" }] })])); expect(report.findings[1]?.status).toBe("blocked_by_dependency"); expect(visibleReportFindings(report).map((finding) => finding.ruleId)).toEqual(["G2-007"]); });
  it("does not merge same-object rules with distinct technical meaning", () => { const report = buildUnifiedEvaluationReport(source([rule("G2-004", "issue", "room-a"), rule("G2-016", "issue", "room-a")])); expect(report.groups).toHaveLength(2); });
  it("elevates a G1 issue only when it blocks a downstream unable result", () => { const report = buildUnifiedEvaluationReport(source([rule("G1-001", "issue", "room-a"), rule("G1-002", "issue", "room-b"), rule("G2-019", "unable_to_determine", "room-a")])); expect(report.findings.map((finding) => finding.priority)).toEqual(["P0", "P2", "P3"]); });
  it("filters by level-ready source group, status and priority", () => { const report = buildUnifiedEvaluationReport(source([rule("G1-001", "issue"), rule("G2-011", "issue"), rule("G3-001", "unable_to_determine")])); expect(visibleReportFindings(report, { groups: ["G2"], priorities: ["P1"] }).map((finding) => finding.ruleId)).toEqual(["G2-011"]); expect(visibleReportFindings(report, { statuses: ["unable_to_determine"] }).map((finding) => finding.ruleId)).toEqual(["G3-001"]); });
  it("places mandatory G4 blockers before later technical findings", () => { const report = buildUnifiedEvaluationReport(source([rule("G2-011", "issue"), rule("G4-REQ-001", "unable_to_determine"), rule("G4-REQ-002", "issue")])); expect(report.findings.sort(compareFindingsForDisplay).map((finding) => finding.ruleId)).toEqual(["G4-REQ-002", "G4-REQ-001", "G2-011"]); });
  it("keeps the Bellevue consolidated report stable", () => {
    const report = buildUnifiedEvaluationReport(evaluateAll(buildEvaluationHandoff(parseProject(bellevueDemoProject)), BELLEVUE_DETACHED_DWELLING_G2_CONTEXT, "2026-07-28T00:00:00.000Z"));
    const byRule = new Map(report.findings.map((finding) => [finding.ruleId, finding]));
    expect(byRule.get("G2-011")).toMatchObject({ status: "issue", priority: "P1" });
    expect(byRule.get("G2-007")).toMatchObject({ status: "unable_to_determine", priority: "P3" });
    expect(byRule.get("G2-008")?.status).toBe("blocked_by_dependency");
    expect(byRule.get("G2-020")).toMatchObject({ status: "unable_to_determine", priority: "P3" });
    expect(report.groups.length).toBe(30);
  }, 20_000);
});
