import { describe, expect, it } from "vitest";
import bellevue from "../../sample-data/Bellevue demo.json";
import bellevueRequirementsJson from "../../sample-data/requirements/Bellevue requirements demo.json";
import { buildEvaluationHandoff } from "../parser/evaluation-handoff";
import { parseProject } from "../parser/parse";
import { parseRequirementHandoff } from "../requirements/requirement-handoff";
import { findShortestRoomPath } from "./connectivity";
import { evaluateS1Gate, measureS1FunctionalRelationships, type S1GateResult } from "./s1";

const handoff = () => buildEvaluationHandoff(parseProject(bellevue));
const parsedRequirements = parseRequirementHandoff(bellevueRequirementsJson);
if (!parsedRequirements.ok) throw new Error(parsedRequirements.error);
const requirements = parsedRequirements.handoff;
const allowedGate: S1GateResult = { allowed: true, evaluatedRuleCount: 2, allowedStatuses: ["pass", "not_applicable"], blockingResults: [] };

const graph = (edgeRows: Array<[string, string, "door" | "stair" | "open-connection", string]> = [], roomIds = ["A", "B", "C", "D"]) => ({
  nodes: roomIds.map((nodeId) => ({ nodeId, nodeType: "room" as const, levelId: nodeId === "D" ? "L2" : "L1" })),
  edges: edgeRows.map(([fromNodeId, toNodeId, connectionType, sourceObjectId], index) => ({ edgeId: `edge-${index}:${sourceObjectId}`, fromNodeId, toNodeId, connectionType, sourceObjectId, levelId: connectionType === "stair" ? null : "L1", confidence: "high" as const, diagnostics: [] })),
  roomAnalysis: { rooms: [], zoneMatches: [], roomToZoneIds: {} }, portals: [], stairConnections: [], entrance: { candidateDoorIds: [], selectedDoorId: null, selectedRoomRegionId: null, confidence: "low" as const, diagnostics: [] }, diagnostics: [],
}) as any;

describe("S1 admission gate", () => {
  it("allows only an explicit pass/not_applicable whitelist", () => {
    expect(evaluateS1Gate([{ ruleId: "G1-001", status: "pass" }, { ruleId: "G2-001", status: "not_applicable" }]).allowed).toBe(true);
    expect(evaluateS1Gate([{ ruleId: "G1-001", status: "pass" }, { ruleId: "G3-001", status: "issue" }]).allowed).toBe(false);
    expect(evaluateS1Gate([{ ruleId: "G4-MANUAL", status: "unable_to_determine" }]).allowed).toBe(false);
    expect(evaluateS1Gate([{ ruleId: "G1-FUTURE", status: "pending_review" }]).allowed).toBe(false);
  });
});

describe("stable shortest Room path", () => {
  it("covers same room, direct, intermediates, stairs, disconnection and stable equal paths", () => {
    expect(findShortestRoomPath(graph(), "A", "A")).toMatchObject({ roomRegionIds: ["A"], edges: [] });
    expect(findShortestRoomPath(graph([["A", "B", "door", "door-1"]]), "A", "B")?.roomRegionIds).toEqual(["A", "B"]);
    expect(findShortestRoomPath(graph([["A", "B", "door", "door-1"], ["B", "C", "door", "door-2"]]), "A", "C")?.roomRegionIds).toEqual(["A", "B", "C"]);
    expect(findShortestRoomPath(graph([["A", "B", "door", "door-1"], ["B", "C", "door", "door-2"], ["C", "D", "door", "door-3"]]), "A", "D")?.roomRegionIds).toEqual(["A", "B", "C", "D"]);
    expect(findShortestRoomPath(graph([["A", "D", "stair", "stair-1"]]), "A", "D")?.edges[0]?.sourceObjectId).toBe("stair-1");
    expect(findShortestRoomPath(graph([["A", "B", "door", "door-1"]]), "A", "D")).toBeNull();
    const tied = graph([["A", "C", "door", "z-door"], ["C", "D", "door", "z-door-2"], ["A", "B", "door", "a-door"], ["B", "D", "door", "a-door-2"]]);
    expect(findShortestRoomPath(tied, "A", "D")?.roomRegionIds).toEqual(["A", "B", "D"]);
  });
});

describe("S1 functional-space relationship measurement", () => {
  it("uses only the configured pairs and has no score or judgment", () => {
    const report = measureS1FunctionalRelationships(handoff(), allowedGate, requirements, "2026-07-31T00:00:00.000Z");
    expect(report.measurements.map((measurement) => measurement.measurementId)).toEqual(["S1-REL-001", "S1-REL-002"]);
    expect(report.measurements.every((measurement) => !("score" in measurement) && !("threshold" in measurement))).toBe(true);
    expect(report.measurements.every((measurement) => ["measured", "not_applicable", "unable_to_determine"].includes(measurement.status))).toBe(true);
    expect(report.functionalRelationScoring).toMatchObject({ metricId: "S1-FR", ruleVersion: "v0.1" });
  }, 15_000);

  it("marks matching G4 adjacency or separation requirements without judging the pair again", () => {
    const report = measureS1FunctionalRelationships(handoff(), allowedGate, requirements, "2026-07-31T00:00:00.000Z");
    expect(report.measurements.find((measurement) => measurement.measurementId === "S1-REL-002")).toMatchObject({ coveredByG4Requirement: true, coveredByG4RequirementIds: ["REQ-005"] });
  }, 15_000);

  it("returns not_applicable for absent semantics and unable_to_determine for multiple candidates", () => {
    const noDining = { zones: [{ id: "k1", name: "KITCHEN" }] } as any, noDiningGraph = graph([], ["K1"]);
    noDiningGraph.roomAnalysis = { rooms: [{ roomRegionId: "K1", levelId: "L1", usableForEvaluation: true, confidence: "high" }], zoneMatches: [{ zoneId: "k1", matchedRoomRegionIds: ["K1"], relationship: "one-to-one", confidence: "high" }], roomToZoneIds: { K1: ["k1"] } };
    expect(measureS1FunctionalRelationships(noDining, allowedGate, null, "2026-07-31T00:00:00.000Z", noDiningGraph).measurements[0]?.status).toBe("not_applicable");
    const synthetic = { zones: [{ id: "k1", name: "KITCHEN" }, { id: "k2", name: "KITCHEN" }, { id: "d1", name: "DINING" }] } as any;
    const syntheticGraph = graph([["K1", "D", "door", "door-1"]], ["K1", "K2", "D"]);
    syntheticGraph.roomAnalysis = { rooms: [{ roomRegionId: "K1", levelId: "L1", usableForEvaluation: true, confidence: "high" }, { roomRegionId: "K2", levelId: "L1", usableForEvaluation: true, confidence: "high" }, { roomRegionId: "D", levelId: "L1", usableForEvaluation: true, confidence: "high" }], zoneMatches: [{ zoneId: "k1", matchedRoomRegionIds: ["K1"], relationship: "one-to-one", confidence: "high" }, { zoneId: "k2", matchedRoomRegionIds: ["K2"], relationship: "one-to-one", confidence: "high" }, { zoneId: "d1", matchedRoomRegionIds: ["D"], relationship: "one-to-one", confidence: "high" }], roomToZoneIds: { K1: ["k1"], K2: ["k2"], D: ["d1"] } };
    expect(measureS1FunctionalRelationships(synthetic, allowedGate, null, "2026-07-31T00:00:00.000Z", syntheticGraph).measurements[0]).toMatchObject({ status: "unable_to_determine", source: null });
  });

  it("does not guess when a recognized Zone has an unreliable Room match or primary-space candidates are ambiguous", () => {
    const unreliable = { zones: [{ id: "k1", name: "KITCHEN" }, { id: "d1", name: "DINING" }] } as any, unreliableGraph = graph([["K", "D", "door", "door-1"]], ["K", "D"]);
    unreliableGraph.roomAnalysis = { rooms: [{ roomRegionId: "K", levelId: "L1", usableForEvaluation: true, confidence: "high" }, { roomRegionId: "D", levelId: "L1", usableForEvaluation: true, confidence: "high" }], zoneMatches: [{ zoneId: "k1", matchedRoomRegionIds: ["K"], relationship: "partial", confidence: "low" }, { zoneId: "d1", matchedRoomRegionIds: ["D"], relationship: "one-to-one", confidence: "high" }], roomToZoneIds: { K: ["k1"], D: ["d1"] } };
    expect(measureS1FunctionalRelationships(unreliable, allowedGate, null, "2026-07-31T00:00:00.000Z", unreliableGraph).measurements[0]).toMatchObject({ status: "unable_to_determine", source: null });
    const primary = { zones: [{ id: "p1", name: "PRIMARY BEDROOM" }, { id: "p2", name: "PRIMARY BEDROOM" }, { id: "b1", name: "PRIMARY BATHROOM" }] } as any, primaryGraph = graph([["P1", "B", "door", "door-1"]], ["P1", "P2", "B"]);
    primaryGraph.roomAnalysis = { rooms: [{ roomRegionId: "P1", levelId: "L1", usableForEvaluation: true, confidence: "high" }, { roomRegionId: "P2", levelId: "L1", usableForEvaluation: true, confidence: "high" }, { roomRegionId: "B", levelId: "L1", usableForEvaluation: true, confidence: "high" }], zoneMatches: [{ zoneId: "p1", matchedRoomRegionIds: ["P1"], relationship: "one-to-one", confidence: "high" }, { zoneId: "p2", matchedRoomRegionIds: ["P2"], relationship: "one-to-one", confidence: "high" }, { zoneId: "b1", matchedRoomRegionIds: ["B"], relationship: "one-to-one", confidence: "high" }], roomToZoneIds: { P1: ["p1"], P2: ["p2"], B: ["b1"] } };
    expect(measureS1FunctionalRelationships(primary, allowedGate, null, "2026-07-31T00:00:00.000Z", primaryGraph).measurements[1]).toMatchObject({ status: "unable_to_determine", source: null });
  });

  it("finds S1 spaces by authoritative SF code regardless of display name", () => {
    const coded = { zones: [{ id: "k", name: "任意厨房文字", spaceFunctionCode: "SF02", spaceFunctionName: "封闭厨房" }, { id: "d", name: "任意餐厅文字", spaceFunctionCode: "SF07", spaceFunctionName: "餐厅" }] } as any, codedGraph = graph([["K", "D", "door", "door-1"]], ["K", "D"]);
    codedGraph.roomAnalysis = { rooms: [{ roomRegionId: "K", levelId: "L1", usableForEvaluation: true, confidence: "high" }, { roomRegionId: "D", levelId: "L1", usableForEvaluation: true, confidence: "high" }], zoneMatches: [{ zoneId: "k", matchedRoomRegionIds: ["K"], relationship: "one-to-one", confidence: "high" }, { zoneId: "d", matchedRoomRegionIds: ["D"], relationship: "one-to-one", confidence: "high" }], roomToZoneIds: { K: ["k"], D: ["d"] } };
    expect(measureS1FunctionalRelationships(coded, allowedGate, null, "2026-08-03T00:00:00.000Z", codedGraph).measurements[0]).toMatchObject({ status: "measured", source: { semanticSource: "sdi_code", spaceFunctionCodes: ["SF02"] }, target: { semanticSource: "sdi_code", spaceFunctionCodes: ["SF07"] } });
  });

  it("does not choose among duplicate authoritative SF candidates in different Rooms", () => {
    const duplicate = { zones: [{ id: "k1", name: "A", spaceFunctionCode: "SF01" }, { id: "k2", name: "B", spaceFunctionCode: "SF02" }, { id: "d", name: "C", spaceFunctionCode: "SF07" }] } as any, duplicateGraph = graph([], ["K1", "K2", "D"]);
    duplicateGraph.roomAnalysis = { rooms: ["K1", "K2", "D"].map((roomRegionId) => ({ roomRegionId, levelId: "L1", usableForEvaluation: true, confidence: "high" })), zoneMatches: [{ zoneId: "k1", matchedRoomRegionIds: ["K1"], relationship: "one-to-one", confidence: "high" }, { zoneId: "k2", matchedRoomRegionIds: ["K2"], relationship: "one-to-one", confidence: "high" }, { zoneId: "d", matchedRoomRegionIds: ["D"], relationship: "one-to-one", confidence: "high" }], roomToZoneIds: { K1: ["k1"], K2: ["k2"], D: ["d"] } };
    expect(measureS1FunctionalRelationships(duplicate, allowedGate, null, "2026-08-03T00:00:00.000Z", duplicateGraph).measurements[0]).toMatchObject({ status: "unable_to_determine", source: null });
  });

  it("ignores legacy name candidates when an authoritative SF candidate exists", () => {
    const mixed = { zones: [{ id: "coded", name: "A", spaceFunctionCode: "SF11" }, { id: "legacy", name: "MASTER BEDROOM" }, { id: "bath", name: "B", spaceFunctionCode: "SF03" }] } as any, mixedGraph = graph([["P", "B", "door", "door-1"]], ["P", "LEGACY", "B"]);
    mixedGraph.roomAnalysis = { rooms: ["P", "LEGACY", "B"].map((roomRegionId) => ({ roomRegionId, levelId: "L1", usableForEvaluation: true, confidence: "high" })), zoneMatches: [{ zoneId: "coded", matchedRoomRegionIds: ["P"], relationship: "one-to-one", confidence: "high" }, { zoneId: "legacy", matchedRoomRegionIds: ["LEGACY"], relationship: "one-to-one", confidence: "high" }, { zoneId: "bath", matchedRoomRegionIds: ["B"], relationship: "one-to-one", confidence: "high" }], roomToZoneIds: { P: ["coded"], LEGACY: ["legacy"], B: ["bath"] } };
    expect(measureS1FunctionalRelationships(mixed, allowedGate, null, "2026-08-03T00:00:00.000Z", mixedGraph).measurements[1]).toMatchObject({ status: "measured", source: { zoneIds: ["coded"], semanticSource: "sdi_code" } });
  });

  it("refuses to run measurement when the G gate is blocked", () => {
    expect(() => measureS1FunctionalRelationships(handoff(), evaluateS1Gate([{ ruleId: "G1-001", status: "issue" }]))).toThrow("S1_GATE_BLOCKED");
  });
});
