import { describe, expect, it } from "vitest";
import bellevueDemoProject from "../../sample-data/Bellevue demo.json";
import { buildEvaluationHandoff } from "../parser/evaluation-handoff";
import { parseProject } from "../parser/parse";
import { buildRoomConnectivityGraph } from "./connectivity";
import { evaluateFoundation, evaluateG1Foundation } from "./evaluate";
import { ruleG1004, ruleG1005 } from "./g1-rules";
import { relateOpeningToHostBoundary } from "./geometry";
import { CONFIRMED_G1_RULE_IDS, CONFIRMED_G3_RULE_IDS } from "./product-rule-scope";

const bellevueProject = structuredClone(bellevueDemoProject) as any;
bellevueProject.nodes.stair_dyp7dqxtm1mg9fxb.fromLevelId = "level_fkoejbpxrc8pfko1";
bellevueProject.nodes.stair_dyp7dqxtm1mg9fxb.toLevelId = "level_3xsbeo3c6y50zj52";

describe("Bellevue source trace and confirmed product rules", () => {
  it("preserves zero-length wall evidence in the retired import preflight", () => {
    const parsed = parseProject(bellevueProject), handoff = buildEvaluationHandoff(parsed), wall = handoff.walls.find((item) => item.id === "wall_obbuari0p7ilw3lz")!;
    expect(parsed.nodes[wall.id].start).toEqual(parsed.nodes[wall.id].end);
    expect(wall).toMatchObject({ rawPascalId: wall.id, footprintValidation: { valid: false } });
    expect(ruleG1004(handoff)).toMatchObject({ status: "issue", diagnostics: expect.arrayContaining([expect.objectContaining({ field: "wall.lengthMeters", actualValue: 0 })]) });
    expect(evaluateG1Foundation(handoff).rules.some((rule) => rule.ruleId === "G1-004")).toBe(false);
  });

  it("preserves stale stair IDs in the retired reference preflight", () => {
    const parsed = parseProject(bellevueProject), handoff = buildEvaluationHandoff(parsed), stair = handoff.stairs.find((item) => item.id === "stair_dyp7dqxtm1mg9fxb")!;
    expect(stair.fromLevelId).toBe(parsed.nodes[stair.id].fromLevelId);
    expect(stair.toLevelId).toBe(parsed.nodes[stair.id].toLevelId);
    expect(ruleG1005(handoff).diagnostics.filter((item) => item.normalizedObjectIds.includes(stair.id)).every((item) => item.origin === "source_data")).toBe(true);
    expect(evaluateG1Foundation(handoff).rules.some((rule) => rule.ruleId === "G1-005")).toBe(false);
  });

  it("uses Pascal opening centre and width rather than frame dimensions", () => {
    const parsed = parseProject(bellevueProject), handoff = buildEvaluationHandoff(parsed), window = handoff.windows.find((item) => item.id === "window_u6yp3z754ya6gqkq")!, wall = handoff.walls.find((item) => item.id === window.hostWallId)!, relation = relateOpeningToHostBoundary(window, wall), found = evaluateG1Foundation(handoff).rules.find((rule) => rule.ruleId === "G1-013")!;
    expect(parsed.nodes[window.id].width).toBe(window.widthMeters);
    expect(parsed.nodes[window.id].frameThickness).toBe(.05);
    expect(relation).toMatchObject({ status: "inside", openingCenterMeters: 0.9003166435429053, openingStartMeters: 0.3406715838381247, openingEndMeters: 1.459961703247686 });
    expect(found.status).toBe("pass");
  });

  it("keeps Bellevue Room and Zone checks stable inside the confirmed G1 scope", () => {
    const report = evaluateG1Foundation(buildEvaluationHandoff(parseProject(bellevueDemoProject)));
    expect(report.rules.map((rule) => rule.ruleId)).toEqual(CONFIRMED_G1_RULE_IDS);
    expect(Object.fromEntries(report.rules.map((rule) => [rule.ruleId, rule.status]))).toMatchObject({ "G1-007": "pass", "G1-009": "issue", "G1-012": "pass", "G1-019": "pass" });
  });

  it("runs only confirmed G3 rules while retaining the shared connectivity graph", () => {
    const handoff = buildEvaluationHandoff(parseProject(bellevueDemoProject)), graph = buildRoomConnectivityGraph(handoff), report = evaluateFoundation(handoff), g3 = report.rules.filter((rule) => rule.ruleId.startsWith("G3-"));
    expect(graph.portals).toHaveLength(26);
    expect(graph.portals.filter((portal) => portal.usableForConnectivity)).toHaveLength(26);
    expect(graph.portals.filter((portal) => portal.connectsExterior)).toHaveLength(4);
    expect(graph.stairConnections[0]).toMatchObject({ usableForConnectivity: true, fromRoomRegionId: "level_jwi4ovhyra2ayxa5-room-1", toRoomRegionId: "level_tf1ug5dswkkzfhqa-room-2" });
    expect(g3.map((rule) => rule.ruleId)).toEqual(CONFIRMED_G3_RULE_IDS);
    expect(Object.fromEntries(g3.map((rule) => [rule.ruleId, rule.status]))).toMatchObject({ "G3-001": "pass", "G3-002": "pass", "G3-003": "pass", "G3-025": "unable_to_determine", "G3-027": "pass", "G3-031": "pass" });
    expect(g3.some((rule) => rule.ruleId === "G3-013")).toBe(false);
  }, 10_000);
});
