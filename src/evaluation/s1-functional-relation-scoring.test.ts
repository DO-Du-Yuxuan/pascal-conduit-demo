import { describe, expect, it } from "vitest";
import { scoreS1FunctionalRelationships } from "./s1-functional-relation-scoring";
import type { S1FunctionalRelationshipMeasurement } from "./s1";

const graph = (rooms: Record<string, string> = {}) => ({ roomAnalysis: { roomToZoneIds: Object.fromEntries(Object.keys(rooms).map((roomId) => [roomId, [roomId]])) } }) as any;
const handoff = (rooms: Record<string, string> = {}) => ({ zones: Object.entries(rooms).map(([id, name]) => ({ id, name })) }) as any;
const measured = (pairId: "S1-REL-001" | "S1-REL-002", relationType: S1FunctionalRelationshipMeasurement["relationType"], intermediateRoomRegionIds: string[] = [], connectionDoorIds: string[] = []): S1FunctionalRelationshipMeasurement => ({ metricId: "functional_space_relationship", measurementId: pairId, label: pairId, sourceSemantic: "source", targetSemantic: "target", source: { semantic: "source", semanticSource: "sdi_code", spaceFunctionCodes: ["SF01"], spaceFunctionNames: ["开放厨房"], zoneIds: ["source"], zoneNames: ["source"], roomRegionId: "source", levelId: "L1", confidence: "high" }, target: { semantic: "target", semanticSource: "sdi_code", spaceFunctionCodes: ["SF07"], spaceFunctionNames: ["餐厅"], zoneIds: ["target"], zoneNames: ["target"], roomRegionId: "target", levelId: relationType === "different_level" ? "L2" : "L1", confidence: "high" }, status: "measured", relationType, topologicalSteps: relationType === "same_open_space" ? 0 : relationType === "direct_connection" || relationType === "different_level" ? 1 : intermediateRoomRegionIds.length + 1, pathRoomRegionIds: ["source", ...intermediateRoomRegionIds, "target"], intermediateRoomRegionIds, connectionDoorIds, connectionStairIds: [], confidence: "high", diagnostics: [], missingData: [], coveredByG4Requirement: false, coveredByG4RequirementIds: [] });
const score = (measurement: S1FunctionalRelationshipMeasurement, rooms: Record<string, string> = {}) => scoreS1FunctionalRelationships([measurement], handoff(rooms), graph(rooms)).pairScores[0]!;

describe("S1 functional relation scoring v0.1", () => {
  it("scores every kitchen—dining topology outcome without guessing an unknown intermediate", () => {
    expect(score(measured("S1-REL-001", "same_open_space")).score).toBe(100);
    expect(score(measured("S1-REL-001", "direct_connection")).score).toBe(100);
    expect(score(measured("S1-REL-001", "one_intermediate_space", ["i"]), { i: "BUTLER PANTRY" })).toMatchObject({ score: 90, matchedRuleId: "S1-FR-001-R03" });
    expect(score(measured("S1-REL-001", "one_intermediate_space", ["i"]), { i: "HALLWAY" })).toMatchObject({ score: 70, matchedRuleId: "S1-FR-001-R04" });
    expect(score(measured("S1-REL-001", "one_intermediate_space", ["i"]), { i: "LIVING ROOM" })).toMatchObject({ score: 40, matchedRuleId: "S1-FR-001-R05" });
    expect(score(measured("S1-REL-001", "multiple_intermediate_spaces", ["a", "b"])).score).toBe(20);
    expect(score(measured("S1-REL-001", "different_level")).score).toBe(0);
    expect(score(measured("S1-REL-001", "one_intermediate_space", ["i"]), { i: "SPACE 7" })).toMatchObject({ scoringStatus: "unable_to_determine", score: null });
  });

  it("scores kitchen—dining disconnection at zero only when the topology result contains reliable endpoints", () => {
    const disconnected = { ...measured("S1-REL-001", null), status: "unable_to_determine" as const, diagnostics: ["两个功能空间之间不存在可靠的 Room Connectivity Graph 路径"] };
    expect(score(disconnected)).toMatchObject({ score: 0, matchedRuleId: "S1-FR-001-R08" });
    expect(score({ ...disconnected, source: { ...disconnected.source!, confidence: "low" as const } })).toMatchObject({ scoringStatus: "unable_to_determine", score: null });
  });

  it("scores every primary bedroom—bathroom topology outcome and distinguishes a door from an open connection", () => {
    expect(score(measured("S1-REL-002", "direct_connection", [], ["door-1"]))).toMatchObject({ score: 100, matchedRuleId: "S1-FR-002-R01" });
    expect(score(measured("S1-REL-002", "direct_connection"))).toMatchObject({ score: 30, matchedRuleId: "S1-FR-002-R05" });
    expect(score(measured("S1-REL-002", "one_intermediate_space", ["i"]), { i: "WALK-IN CLOSET" })).toMatchObject({ score: 95, matchedRuleId: "S1-FR-002-R02" });
    expect(score(measured("S1-REL-002", "one_intermediate_space", ["i"]), { i: "CORRIDOR" })).toMatchObject({ score: 60, matchedRuleId: "S1-FR-002-R03" });
    expect(score(measured("S1-REL-002", "same_open_space"))).toMatchObject({ score: 30, matchedRuleId: "S1-FR-002-R04" });
    expect(score(measured("S1-REL-002", "one_intermediate_space", ["i"]), { i: "STUDY" })).toMatchObject({ score: 30, matchedRuleId: "S1-FR-002-R06" });
    expect(score(measured("S1-REL-002", "multiple_intermediate_spaces", ["a", "b"])).score).toBe(10);
    expect(score(measured("S1-REL-002", "different_level")).score).toBe(0);
    const disconnected = { ...measured("S1-REL-002", null), status: "unable_to_determine" as const, diagnostics: ["两个功能空间之间不存在可靠的 Room Connectivity Graph 路径"] };
    expect(score(disconnected)).toMatchObject({ score: 0, matchedRuleId: "S1-FR-002-R09" });
  });

  it("keeps absent or ambiguous primary-suite inputs out of scoring", () => {
    const absent = { ...measured("S1-REL-002", null), status: "not_applicable" as const, source: null, target: null };
    const ambiguous = { ...measured("S1-REL-002", null), status: "unable_to_determine" as const, source: null, target: null, diagnostics: ["primary_bedroom 匹配到 2 个候选 Room Region"] };
    expect(score(absent)).toMatchObject({ scoringStatus: "not_applicable", score: null });
    expect(score(ambiguous)).toMatchObject({ scoringStatus: "unable_to_determine", score: null });
  });

  it("excludes G4-covered pairs without modifying the topology measurement", () => {
    expect(score({ ...measured("S1-REL-001", "same_open_space"), coveredByG4Requirement: true, coveredByG4RequirementIds: ["REQ-1"] })).toMatchObject({ scoringStatus: "excluded", score: null, excludedFromScoring: true });
  });

  it("keeps name-fallback topology visible but refuses to issue a formal score", () => {
    const fallback = measured("S1-REL-001", "same_open_space");
    fallback.source = { ...fallback.source!, semanticSource: "name_fallback", spaceFunctionCodes: [], spaceFunctionNames: [] };
    expect(score(fallback)).toMatchObject({ scoringStatus: "unable_to_determine", score: null, scoreExplanation: "相关空间尚未绑定SDI空间功能编码，当前名称识别仅用于旧数据兼容，不能生成正式S1分数" });
  });

  it("summarizes scores, exclusions, not-applicable pairs and unresolved pairs conservatively", () => {
    const kitchen = measured("S1-REL-001", "same_open_space"), suite = measured("S1-REL-002", "one_intermediate_space", ["closet"]);
    expect(scoreS1FunctionalRelationships([kitchen, suite], handoff({ closet: "WALK-IN CLOSET" }), graph({ closet: "WALK-IN CLOSET" }))).toMatchObject({ scoringStatus: "scored", score: 97.5 });
    expect(scoreS1FunctionalRelationships([kitchen, { ...suite, status: "not_applicable", source: null, target: null }], handoff(), graph())).toMatchObject({ scoringStatus: "scored", score: 100 });
    expect(scoreS1FunctionalRelationships([{ ...kitchen, coveredByG4Requirement: true }, suite], handoff({ closet: "WALK-IN CLOSET" }), graph({ closet: "WALK-IN CLOSET" }))).toMatchObject({ scoringStatus: "scored", score: 95 });
    expect(scoreS1FunctionalRelationships([{ ...kitchen, coveredByG4Requirement: true }, { ...suite, status: "not_applicable", source: null, target: null }], handoff(), graph())).toMatchObject({ scoringStatus: "not_applicable", score: null });
    expect(scoreS1FunctionalRelationships([kitchen, { ...suite, status: "unable_to_determine", source: null, target: null }], handoff(), graph())).toMatchObject({ scoringStatus: "unable_to_determine", score: null });
  });
});
