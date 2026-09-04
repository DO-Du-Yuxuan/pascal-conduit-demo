import { describe, expect, it } from "vitest";
import bellevueDemoProject from "../../sample-data/Bellevue demo.json";
import { evaluateFoundation } from "../evaluation/evaluate";
import { CONFIRMED_G1_RULE_IDS, CONFIRMED_G3_RULE_IDS } from "../evaluation/product-rule-scope";
import { buildRoomRegionAnalysis } from "../evaluation/room-regions";
import { buildEvaluationHandoff } from "../parser/evaluation-handoff";
import { parseProject } from "../parser/parse";
import { evaluationHighlightFor, evaluationHighlightRole, resolveEvaluationFocus } from "./focus";
import { designerRulePresentation, evaluationIssueTargets, orderEvaluationRulesForDisplay } from "./presentation";

const parsed = parseProject(bellevueDemoProject), handoff = buildEvaluationHandoff(parsed), report = evaluateFoundation(handoff), nodes = parsed.nodes, roomAnalysis = buildRoomRegionAnalysis(handoff);
const rule = (id: string) => report.rules.find((item) => item.ruleId === id)!;

describe("confirmed G1/G3 evaluation UI", () => {
  it("exposes only product-confirmed G1 and G3 cards", () => {
    expect(report.rules.filter((item) => item.ruleId.startsWith("G1-")).map((item) => item.ruleId)).toEqual(CONFIRMED_G1_RULE_IDS);
    expect(report.rules.filter((item) => item.ruleId.startsWith("G3-")).map((item) => item.ruleId)).toEqual(CONFIRMED_G3_RULE_IDS);
    expect(report.rules.some((item) => ["G1-004", "G1-005", "G3-010", "G3-015", "G3-044"].includes(item.ruleId))).toBe(false);
    const counts = report.g3Summary!.counts;
    expect(counts.pass + counts.issue + counts.unable_to_determine + counts.not_applicable).toBe(6);
  });

  it("distinguishes an opening from its host wall", () => {
    const window = nodes.window_u6yp3z754ya6gqkq!, base = rule("G1-013"), synthetic = { ...base, status: "issue" as const, normalizedObjectIds: [window.id, window.wallId], diagnostics: [{ severity: "error" as const, code: "opening_outside_host_wall", message: "测试定位", normalizedObjectIds: [window.id, window.wallId] }] }, target = designerRulePresentation(synthetic, nodes).targets[0]!, highlight = evaluationHighlightFor("G1-013", target, 0);
    expect(target).toMatchObject({ primaryId: window.id, relatedIds: ["wall_twjrbha7gdx24q8c"] });
    expect(evaluationHighlightRole(highlight, target.primaryId)).toBe("primary");
    expect(evaluationHighlightRole(highlight, target.relatedIds[0]!)).toBe("related");
  });

  it("locates every confirmed G1-023 outside object without adding collision targets", () => {
    const placement = rule("G1-023"), presentation = designerRulePresentation(placement, nodes, roomAnalysis), expected = placement.diagnostics.filter((item) => item.code === "item_outside_building_envelope").map((item) => item.normalizedObjectIds[0]);
    expect(presentation.targets.map((target) => target.primaryId)).toEqual(expected);
    expect(placement.diagnostics.some((item) => ["item_penetrates_wall", "item_physical_collision"].includes(item.code))).toBe(false);
  });

  it("turns overlapping Zones into canvas targets", () => {
    const targets = designerRulePresentation(rule("G1-009"), nodes, roomAnalysis).targets;
    expect(targets).toHaveLength(2);
    expect(targets.every((target) => nodes[target.primaryId]?.type === "zone")).toBe(true);
  });

  it("indexes current issues and safely handles a missing render mapping", () => {
    const targets = evaluationIssueTargets(report.rules, nodes, roomAnalysis);
    expect(targets.some((target) => target.ruleId === "G1-009")).toBe(true);
    expect(targets.some((target) => target.ruleId === "G1-023")).toBe(true);
    expect(resolveEvaluationFocus(nodes, "missing-object")).toMatchObject({ renderable: false, viewBox: null });
  });

  it("replaces a prior highlight when another issue is selected", () => {
    const placementTarget = designerRulePresentation(rule("G1-023"), nodes, roomAnalysis).targets[0]!, zoneTarget = designerRulePresentation(rule("G1-009"), nodes, roomAnalysis).targets[0]!, oldHighlight = evaluationHighlightFor("G1-023", placementTarget, 0), nextHighlight = evaluationHighlightFor("G1-009", zoneTarget, 0);
    expect(nextHighlight.primaryId).not.toBe(oldHighlight.primaryId);
    expect(nextHighlight.ruleId).toBe("G1-009");
  });

  it("orders issues before unable, pass and not-applicable cards", () => {
    const ordered = orderEvaluationRulesForDisplay(report.rules), rank = (status: string) => status === "issue" ? 0 : status === "unable_to_determine" ? 1 : status === "pass" ? 2 : 3;
    expect(ordered.map((item) => rank(item.status))).toEqual([...ordered.map((item) => rank(item.status))].sort((a, b) => a - b));
  });
});
