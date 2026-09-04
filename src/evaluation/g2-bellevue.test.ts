import { describe, expect, it } from "vitest";
import bellevue from "../../sample-data/Bellevue demo.json";
import { buildEvaluationHandoff } from "../parser/evaluation-handoff";
import { parseProject } from "../parser/parse";
import { evaluateG2Technical } from "./evaluate";
import { BELLEVUE_DETACHED_DWELLING_G2_CONTEXT } from "./g2-rules";
import { buildRoomRegionAnalysis } from "./room-regions";
import { resolveEvaluationFocus } from "../evaluation-ui/focus";
import { designerRulePresentation, isDependencyOnlyTechnicalRule } from "../evaluation-ui/presentation";

describe("Bellevue G2 acceptance", () => {
  it("runs the frozen first batch and the stair/EERO batch without guessing missing source fields", () => {
    const handoff = buildEvaluationHandoff(parseProject(bellevue)), report = evaluateG2Technical(handoff, BELLEVUE_DETACHED_DWELLING_G2_CONTEXT, "2026-07-27T00:00:00.000Z");
    expect(report.rules.map((rule) => rule.ruleId)).toEqual(["G2-001", "G2-002", "G2-003", "G2-004", "G2-005", "G2-006", "G2-007", "G2-008", "G2-009", "G2-010", "G2-011", "G2-012", "G2-013", "G2-014", "G2-015", "G2-016", "G2-017", "G2-019", "G2-020"]);
    expect(Object.fromEntries(report.rules.map((rule) => [rule.ruleId, rule.status]))).toEqual({
      "G2-001": "pass",
      "G2-002": "not_applicable",
      "G2-003": "pass",
      "G2-004": "pass",
      "G2-005": "pass",
      "G2-006": "pass",
      "G2-007": "unable_to_determine",
      "G2-008": "unable_to_determine",
      "G2-009": "pass",
      "G2-010": "pass",
      "G2-011": "issue",
      "G2-012": "not_applicable",
      "G2-013": "pass",
      "G2-014": "pass",
      "G2-015": "not_applicable",
      "G2-016": "pass",
      "G2-017": "pass",
      "G2-019": "issue",
      "G2-020": "unable_to_determine",
    });
    expect(report.g2Summary?.counts).toEqual({ pass: 11, issue: 2, unable_to_determine: 3, not_applicable: 3 });
    expect(report.rules.find((rule) => rule.ruleId === "G2-001")?.measurements).toEqual(expect.arrayContaining([expect.objectContaining({ name: "exteriorDoorCandidateCount", value: 4 }), expect.objectContaining({ name: "nominalOpeningDimensionCount", value: 4 }), expect.objectContaining({ name: "reliableActualClearOpeningCount", value: 0 }), expect.objectContaining({ name: "reliablePlanDerivedClearOpeningCount", value: 1 })]));
    expect(report.rules.find((rule) => rule.ruleId === "G2-004")?.measurements.filter((item) => item.name === "planAreaInitialCheck" && item.value === "pass")).toHaveLength(8);
    expect(report.rules.find((rule) => rule.ruleId === "G2-005")?.measurements.filter((item) => item.name === "effectiveHorizontalDimensionAtLeastMeters")).toHaveLength(8);
    expect(report.rules.find((rule) => rule.ruleId === "G2-006")?.measurements.filter((item) => item.name === "frontClearanceMeters")).toHaveLength(4);
    expect(report.rules.find((rule) => rule.ruleId === "G2-006")?.measurements.filter((item) => item.name.startsWith("centerDistanceTo:"))).toHaveLength(0);
    expect(report.rules.find((rule) => rule.ruleId === "G2-006")?.measurements.filter((item) => item.name === "sameFixtureCenterSpacingSubitemStatus").map((item) => item.value)).toEqual(["not_applicable", "not_applicable", "not_applicable", "not_applicable"]);
    expect(report.rules.find((rule) => rule.ruleId === "G2-006")?.thresholds.map((item) => item.originalValue)).toEqual([15, 30, 21]);
    expect(report.rules.find((rule) => rule.ruleId === "G2-006")?.diagnostics.filter((item) => item.code === "toilet_rotation_multiple_turns_normalized")).toHaveLength(3);
    expect(report.rules.find((rule) => rule.ruleId === "G2-002")?.measurements).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "stairType", value: "spiral", normalizedObjectId: "stair_dyp7dqxtm1mg9fxb" }),
      expect.objectContaining({ name: "averageRiserHeightMeters", value: 2.5 / 18, measurementBasis: "derived" }),
    ]));
    const g2007 = report.rules.find((rule) => rule.ruleId === "G2-007")!;
    expect(g2007.measurements.filter((item) => item.name === "eeroCandidateCount").map((item) => item.value)).toEqual([1, 4, 2, 2]);
    expect(g2007.measurements.filter((item) => item.name === "eeroSizeSubitemStatus" && item.value === "pass").map((item) => item.normalizedObjectId)).toEqual(expect.arrayContaining(["window_yuxpgu9qeqh7ez55", "window_m461uk60zudupisc", "window_v5cxsufjyca99a13"]));
    expect(g2007.diagnostics.filter((item) => item.code === "eero_candidate_clear_opening_bounds_cross_threshold").map((item) => item.normalizedObjectIds[0])).toEqual(expect.arrayContaining(["window_a1wqnv1lywps5vl8", "window_yar8hjnszpqjqlk2"]));
    const g2008 = report.rules.find((rule) => rule.ruleId === "G2-008")!;
    const levelOneSill = g2008.measurements.find((item) => item.name === "eeroOpeningBottomAboveFinishedFloorMeters" && item.normalizedObjectId === "window_yuxpgu9qeqh7ez55")!;
    expect(levelOneSill).toMatchObject({ measurementBasis: "derived" });
    expect(levelOneSill.value).toBeCloseTo(.7);
    expect(g2008.measurements).toEqual(expect.arrayContaining([expect.objectContaining({ name: "applicableRoomCount", value: 4 }), expect.objectContaining({ name: "evaluatedRoomCount", value: 2 }), expect.objectContaining({ name: "blockedRoomCount", value: 2 }), expect.objectContaining({ name: "dependencyRuleId", value: "G2-007" })]));
    expect(g2008.measurements.filter((item) => item.name === "eeroSillSubitemStatus" && item.value === "blocked_by_G2_007")).toHaveLength(2);
    expect(isDependencyOnlyTechnicalRule(g2008)).toBe(true);
    expect(g2008.diagnostics.filter((item) => item.code === "eero_sill_candidate_qualification_unresolved")).toHaveLength(0);
    expect(g2008.diagnostics.filter((item) => item.code === "eero_sill_not_applicable_due_to_size_qualification_unresolved")).toHaveLength(2);
    expect(report.rules.find((rule) => rule.ruleId === "G2-009")?.measurements).toEqual(expect.arrayContaining([expect.objectContaining({ name: "garageRoomCount", value: 1 }), expect.objectContaining({ name: "sleepingRoomCount", value: 4 }), expect.objectContaining({ name: "directOpeningCount", value: 0 })]));
    expect(report.rules.find((rule) => rule.ruleId === "G2-010")?.measurements).toEqual(expect.arrayContaining([expect.objectContaining({ name: "checkedDwellingRoomCount", value: 21 }), expect.objectContaining({ name: "exteriorExitCandidateCount", value: 4 }), expect.objectContaining({ name: "onlyThroughGarageCount", value: 0 })]));
    const g2011 = report.rules.find((rule) => rule.ruleId === "G2-011")!;
    expect(g2011.measurements).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "spiralNominalWidthMeters", value: 1.1, normalizedObjectId: "stair_dyp7dqxtm1mg9fxb" }),
      expect.objectContaining({ name: "spiralInnerRadiusMeters", value: .4 }),
      expect.objectContaining({ name: "spiralOuterRadiusMeters", value: 1.5 }),
      expect.objectContaining({ name: "spiral_riser_height_status", value: "pass" }),
      expect.objectContaining({ name: "spiral_tread_consistency_status", value: "pass" }),
      expect.objectContaining({ name: "spiral_walkline_radius_status", value: "issue" }),
      expect.objectContaining({ name: "spiral_walkline_tread_depth_status", value: "pass" }),
      expect.objectContaining({ name: "spiral_headroom_status", value: "unable_to_determine" }),
    ]));
    expect(report.rules.find((rule) => rule.ruleId === "G2-012")).toMatchObject({ status: "not_applicable", normalizedObjectIds: ["stair_dyp7dqxtm1mg9fxb"] });
    const g2016 = report.rules.find((rule) => rule.ruleId === "G2-016")!;
    expect(g2016.measurements.filter((item) => item.name === "headroomRoomAreaSquareMeters")).toHaveLength(8);
    expect(g2016.measurements.filter((item) => item.name === "headroomCeilingCoverageRatio").map((item) => item.value)).toEqual(Array(8).fill(1));
    const g2017 = report.rules.find((rule) => rule.ruleId === "G2-017")!;
    expect(g2017.measurements.filter((item) => item.name === "nonhabitableHeadroomApplicableThresholdMeters")).toHaveLength(7);
    expect(g2017.measurements.filter((item) => item.name === "showerLocalHeadroomMeters" && item.measurementBasis === "derived")).toHaveLength(4);
    const g2019 = report.rules.find((rule) => rule.ruleId === "G2-019")!;
    expect(g2019.measurements).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "water_closetCount", value: 4 }),
      expect.objectContaining({ name: "lavatoryCount", value: 4 }),
      expect.objectContaining({ name: "bathing_fixtureCount", value: 7 }),
      expect.objectContaining({ name: "kitchen_sinkCount", value: 2 }),
      expect.objectContaining({ name: "kitchen_sinkObject", normalizedObjectId: "item_gedhhy4u9sotya5v" }),
      expect.objectContaining({ name: "kitchenAreaCount", value: 2 }),
      expect.objectContaining({ name: "kitchenAreaSubitemStatus", value: "issue" }),
    ]));
    const g2020 = report.rules.find((rule) => rule.ruleId === "G2-020")!;
    expect(g2020).toMatchObject({ status: "unable_to_determine" });
    expect(g2020.measurements.filter((item) => item.name === "showerCompartment")).toHaveLength(4);
    expect(g2020.measurements.filter((item) => item.name === "showerCompartmentMaintainedHeightStatus").map((item) => item.value)).toEqual(["pass", "pass", "pass", "pass"]);
    expect(g2020.diagnostics.filter((item) => item.code === "shower_compartment_finished_interior_unresolved")).toHaveLength(4);
    expect(g2020.diagnostics.every((item) => item.recommendation?.includes("finishedInteriorPolygon"))).toBe(true);
    const analysis = buildRoomRegionAnalysis(handoff), nodes = parseProject(bellevue).nodes;
    expect(resolveEvaluationFocus(nodes, "level_tf1ug5dswkkzfhqa-room-2", analysis)).toMatchObject({ renderable: true, levelId: "level_tf1ug5dswkkzfhqa" });
    const eeroTargets = designerRulePresentation(g2007, nodes, analysis).targets;
    expect(eeroTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ primaryId: "window_a1wqnv1lywps5vl8", levelName: "Level 2" }),
      expect.objectContaining({ primaryId: "level_tf1ug5dswkkzfhqa-room-3", levelName: "Level 2" }),
    ]));
    expect(eeroTargets.every((target) => resolveEvaluationFocus(nodes, target.primaryId, analysis).renderable)).toBe(true);
    expect(designerRulePresentation(g2011, nodes, analysis).targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ primaryId: "stair_dyp7dqxtm1mg9fxb" }),
    ]));
    expect(designerRulePresentation(g2017, nodes, analysis).targets).toEqual([]);
    const g2020Targets = designerRulePresentation(g2020, nodes, analysis).targets;
    expect(g2020Targets).toHaveLength(5); // one merged compartment has two fixed enclosure assets to show together
    expect(g2020Targets.every((target) => resolveEvaluationFocus(nodes, target.primaryId, analysis).renderable)).toBe(true);
    const g2019Targets = designerRulePresentation(g2019, nodes, analysis).targets;
    expect(g2019Targets).toHaveLength(2);
    expect(g2019Targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ primaryId: "zone_wga04d9rsvtht7r8", relatedIds: expect.arrayContaining(["item_gedhhy4u9sotya5v", "item_tltmggpxo9dfg2e2"]) }),
      expect.objectContaining({ primaryId: "zone_33vruxnjc7gyhsix", relatedIds: expect.arrayContaining(["item_gedhhy4u9sotya5v", "item_tltmggpxo9dfg2e2"]) }),
    ]));
    expect(g2019Targets.some((target) => ["item_a720h5x84l8enxab", "item_1hdkr5ppq6qmxf3i", "item_3f5hxyhjs5lzu10g"].includes(target.primaryId))).toBe(false);
  }, 15000);
});
