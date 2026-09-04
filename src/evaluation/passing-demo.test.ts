import { describe, expect, it } from "vitest";
import passingDemo from "../../sample-data/Bellevue passing demo.json";
import { buildEvaluationHandoff } from "../parser/evaluation-handoff";
import { parseProject } from "../parser/parse";
import { measureS1FunctionalRelationships } from "./s1";
import { measureS1FunctionalRelationshipPairs } from "./s1";
import { buildRoomConnectivityGraph } from "./connectivity";
import { scoreS1FunctionalRelationships } from "./s1-functional-relation-scoring";
import { measureS1EntrySequence, scoreS1SpaceOrganization } from "./s1-space-organization";
import { scoreS1ActivityZoning } from "./s1-activity-zoning";
import { scoreS1SpaceUtilization } from "./s1-space-utilization";
import { scoreS1StorageConfiguration } from "./s1-storage-configuration";
import { aggregateS1V01 } from "./s1-aggregate";
import { BELLEVUE_DETACHED_DWELLING_G2_CONTEXT } from "./g2-rules";
import { evaluateAll } from "./evaluate";
import { CONFIRMED_G1_RULE_IDS, CONFIRMED_G3_RULE_IDS } from "./product-rule-scope";

describe("Bellevue passing demo", () => {
  it("emits only product-confirmed G1 and G3 rules", () => {
    const report = evaluateAll(
      buildEvaluationHandoff(parseProject(passingDemo)),
      BELLEVUE_DETACHED_DWELLING_G2_CONTEXT,
      "2026-07-31T00:00:00.000Z",
    );
    expect(report.rules.filter((rule) => rule.ruleId.startsWith("G1-")).map((rule) => rule.ruleId)).toEqual(CONFIRMED_G1_RULE_IDS);
    expect(report.rules.filter((rule) => rule.ruleId.startsWith("G3-")).map((rule) => rule.ruleId)).toEqual(CONFIRMED_G3_RULE_IDS);
    expect(report.rules.some((rule) => ["G3-010", "G3-015", "G3-018", "G3-029", "G3-044"].includes(rule.ruleId))).toBe(false);
  }, 15_000);

  it("reads the checked-in SF codes and produces the formal S1-FR score", () => {
    const handoff = buildEvaluationHandoff(parseProject(passingDemo)), gate = { allowed: true, evaluatedRuleCount: 74, allowedStatuses: ["pass", "not_applicable"] as const, blockingResults: [] };
    const s1 = measureS1FunctionalRelationships(handoff, gate, null, "2026-08-03T00:00:00.000Z");
    expect(s1.measurements.map((measurement) => [measurement.measurementId, measurement.source?.semanticSource, measurement.target?.semanticSource])).toEqual([["S1-REL-001", "sdi_code", "sdi_code"], ["S1-REL-002", "sdi_code", "sdi_code"]]);
    expect(s1.functionalRelationScoring).toMatchObject({ scoringStatus: "scored", score: 100, counts: { scored: 2 } });
    expect(s1.publicCirculationPrivacy.counts).toEqual({ generatedRoutes: 4, privacySafeRoutes: 4, privateMandatoryRoutes: 0, baselineUnreachableRoutes: 0, unableToDetermineRoutes: 1, notApplicableRouteGroups: 1 });
    expect(s1.publicCirculationPrivacy.groups.map((group) => [group.routeGroup, group.status, group.routeCount])).toEqual([["entry_to_public", "unable_to_determine", 0], ["visitor_to_public_bathroom", "measured", 2], ["public_to_public_outdoor", "not_applicable", 0], ["garage_return", "measured", 2]]);
    expect(s1.publicCirculationPrivacyScoring).toMatchObject({ status: "unable_to_determine", score: null, applicableGroupCount: 2, notApplicableGroupCount: 1, unableGroupCount: 1, safeRouteCount: 4, mandatoryPrivateRouteCount: 0, ruleVersion: "v0.1" });
    expect(s1.highFrequencyPathEfficiency.groups.map((group) => [group.routeGroup, group.status, group.routeCount])).toEqual([["entry_to_kitchen", "measured", 1], ["garage_to_kitchen", "measured", 0], ["bedroom_to_bathroom", "measured", 4]]);
    expect(s1.highFrequencyPathEfficiency.counts).toEqual({ measured: 5, baselineUnreachable: 0, unableToDetermine: 0, notApplicableRouteGroups: 0 });
    expect(s1.highFrequencyPathEfficiency.measurements.map((route) => ({ source: route.source?.zoneNames.join(" / "), target: route.target?.zoneNames.join(" / "), length: route.actualPathLengthMeters, steps: route.topologicalSteps, turns: route.turnCount }))).toEqual([
      { source: "MUD", target: "OPEN KITCHEN", length: 4.807, steps: 1, turns: 3 },
      { source: "BEDROOM 1", target: "BATH 1", length: 3.283, steps: 2, turns: 3 },
      { source: "MASTER BEDROOM", target: "MASTER BATH", length: 4.331, steps: 1, turns: 3 },
      { source: "BEDROOM 3", target: "BATH 3", length: 1.914, steps: 1, turns: 1 },
      { source: "BEDROOM 2", target: "BATH 2", length: 2.785, steps: 1, turns: 0 },
    ]);
    expect(s1.highFrequencyPathEfficiency.measurements[0]).toMatchObject({ behaviorSources: ["primary_entry", "garage_return"], sourceBehaviorObjectIds: ["door_235p9ofj5w88jxbh"], selectedTargetZoneId: "zone_33vruxnjc7gyhsix", selectedTargetSpaceFunctionCode: "SF01" });
    expect(s1.highFrequencyPathEfficiency.measurements.find((route) => route.sourceBehaviorObjectIds.includes("item_qmhod8evoai6fg1z"))).toMatchObject({ status: "measured", actualPathLengthMeters: 4.331 });
    expect(s1.highFrequencyPathEfficiency.measurements.filter((route) => route.status === "measured").every((route) => route.pathProvider === "polygon_visibility_graph" && route.independentGeometryValidated && route.sourceAnchorPoint && route.targetAnchorPoint)).toBe(true);
    expect(s1.highFrequencyPathEfficiencyScoring).toMatchObject({ status: "scored", score: 97.6, effectiveResidentialIndoorArea: { status: "measured", squareMeters: expect.closeTo(398.6765852248, 8) } });
    expect(s1.highFrequencyPathEfficiencyScoring.sceneScores.map((scene) => [scene.scene, scene.score, scene.evaluableRouteCount])).toEqual([["bedroom_to_bathroom", 95.1, 4], ["return_to_kitchen", 100, 1]]);
    expect(s1.highFrequencyPathEfficiencyScoring.routeScores.map((score) => Math.round((score.routeScore ?? 0) * 100) / 100)).toEqual([100, 98.28, 86.48, 95.48, 100]);
    expect(s1.pathConflictInteraction.counts).toEqual({ eligibleRoutes: 5, routePairs: 10, noInteractionPairs: 10, crossingPairs: 0, overlapPairs: 0, oppositeOverlapPairs: 0, sharedDoorPairs: 0, sharedStairPairs: 0, unablePairs: 0 });
    expect(s1.pathConflictInteraction.hotspots.roomRegions[0]).toMatchObject({ objectId: "level_jwi4ovhyra2ayxa5-room-1", routeCount: 2 });
    expect(s1.pathConflictInteraction.hotspots.crossingPoints).toHaveLength(0);
    expect(s1.pathConflictInteraction.hotspots.doors.every((item) => item.routeCount === 1)).toBe(true);
    expect(s1.pathConflictInteraction.hotspots.stairs).toEqual([]);
    expect(s1.spaceFragmentShape.counts).toEqual({ measured: 24, unableToDetermine: 0, notApplicable: 0, multipleNavigableComponents: 5 });
    expect(s1.spaceFragmentShape.totals.fragmentAreaSquareMeters).toBeCloseTo(2.42, 8);
    expect(s1.spaceFragmentShape.averages).toEqual({ compactness: expect.closeTo(.6837781921, 8), convexityRatio: expect.closeTo(.9553072546, 8), largestNavigableComponentRatio: expect.closeTo(.9476360930, 8) });
    expect(s1.spaceFragmentShape.measurements.filter((item) => (item.fragmentComponentCount ?? 0) > 0).map((item) => ({ name: item.zoneNames.join(" / "), components: item.navigableComponentCount, fragments: item.fragmentComponentCount, area: item.fragmentAreaSquareMeters, ratio: item.fragmentAreaRatio }))).toEqual([
      { name: "OPEN KITCHEN", components: 2, fragments: 1, area: expect.closeTo(.04, 8), ratio: expect.closeTo(.0026845638, 8) },
      { name: "BATH 1", components: 2, fragments: 1, area: expect.closeTo(.55, 8), ratio: expect.closeTo(.2235772358, 8) },
      { name: "BATH 2", components: 2, fragments: 1, area: expect.closeTo(.50, 8), ratio: expect.closeTo(.3164556962, 8) },
      { name: "BATH 3", components: 2, fragments: 1, area: expect.closeTo(.32, 8), ratio: expect.closeTo(.3047619048, 8) },
      { name: "MASTER BATH", components: 3, fragments: 2, area: expect.closeTo(1.01, 8), ratio: expect.closeTo(.3568904594, 8) },
    ]);
    expect(s1.spaceFragmentShape.measurements.filter((item) => ["OPEN KITCHEN", "LIVING ROOM", "DINNING"].includes(item.zoneNames[0] ?? "")).map((item) => [item.zoneNames[0], item.roomRegionId])).toEqual([["OPEN KITCHEN", "level_jwi4ovhyra2ayxa5-room-1"], ["LIVING ROOM", "level_jwi4ovhyra2ayxa5-room-1"], ["DINNING", "level_jwi4ovhyra2ayxa5-room-1"]]);
    expect(s1.furnitureRelationshipAndUseSpace.counts).toEqual({ participatingItems: 64, itemsWithMinimumUseSpace: 31, itemsWithMaximumOpening: 31, minimumUseConflictItems: 4, maximumOpeningConflictItems: 4, measuredRelations: 17, unableToDetermine: 1, notApplicable: 0 });
    expect(s1.furnitureRelationshipAndUseSpace.relationGroups.map((group) => [group.pairType, group.status, group.measurementCount, group.unableToDetermineCount])).toEqual([
      ["dining_table_dining_chair", "measured", 8, 0],
      ["bed_bedside_table", "measured", 3, 0],
      ["sofa_coffee_table", "unable_to_determine", 1, 1],
      ["desk_office_chair", "measured", 5, 0],
    ]);
    expect(s1.furnitureRelationshipAndUseSpace.itemMeasurements.every((item) => !("score" in item || "weight" in item || "deduction" in item))).toBe(true);
  }, 30_000);

  it("scores the checked-in garage arrival sequence as the formal SO-03 and space-organization demo", () => {
    const handoff = buildEvaluationHandoff(parseProject(passingDemo)), graph = buildRoomConnectivityGraph(handoff);
    const relationships = scoreS1FunctionalRelationships(measureS1FunctionalRelationshipPairs(handoff, graph), handoff, graph);
    const entry = measureS1EntrySequence(handoff, graph), organization = scoreS1SpaceOrganization(relationships, entry);
    expect(entry).toMatchObject({ primaryEntranceDoorId: "door_235p9ofj5w88jxbh", entranceKind: "garage_origin", status: "scored", score: 100, spaceFunctionCodesByRoom: [["SF30"], ["SF35"], expect.arrayContaining(["SF06", "SF07"])] });
    expect(organization.rules.map((rule) => [rule.ruleId, rule.score])).toEqual([["SO-01", 100], ["SO-02", 100], ["SO-03", 100]]);
    expect(organization).toMatchObject({ status: "scored", score: 100 });
  }, 15_000);

  it("aggregates the five formal S1 axes into the Bellevue v0.1 total", () => {
    const handoff = buildEvaluationHandoff(parseProject(passingDemo)), graph = buildRoomConnectivityGraph(handoff), gate = { allowed: true, evaluatedRuleCount: 74, allowedStatuses: ["pass", "not_applicable"] as const, blockingResults: [] };
    const legacy = measureS1FunctionalRelationships(handoff, gate, null, "2026-08-14T00:00:00.000Z");
    const organization = scoreS1SpaceOrganization(legacy.functionalRelationScoring, measureS1EntrySequence(handoff, graph));
    const aggregate = aggregateS1V01(gate, { spaceOrganization: organization, highFrequencyPathEfficiency: legacy.highFrequencyPathEfficiencyScoring, activityZoning: scoreS1ActivityZoning(handoff, graph), spaceUtilization: scoreS1SpaceUtilization(handoff, graph), storageConfiguration: scoreS1StorageConfiguration(handoff, graph) });
    expect(aggregate.axes.map((axis) => [axis.name, axis.score])).toEqual([["空间组织", 100], ["动线效率", 97.6], ["动静分区", 96.7], ["空间利用", 83.2], ["收纳配置", 81.4]]);
    expect(aggregate).toMatchObject({ status: "scored", score: 91.8, coverage: { applicableAxisCount: 5, notApplicableAxisCount: 0, unableAxisCount: 0 } });
  }, 30_000);
});
