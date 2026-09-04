import { describe, expect, it } from "vitest";
import type { S1HighFrequencyPathMeasurement, S1HighFrequencyPathReport } from "./s1-high-frequency-path";
import { measureS1EffectiveResidentialIndoorArea, scoreS1HighFrequencyPaths } from "./s1-high-frequency-path-scoring";

const route = (id: string, group: S1HighFrequencyPathMeasurement["routeGroup"], length: number | null, detour: number | null, status: S1HighFrequencyPathMeasurement["status"] = "measured", behaviorSources: S1HighFrequencyPathMeasurement["behaviorSources"] = group === "bedroom_to_bathroom" ? ["bedroom"] : ["primary_entry"]): S1HighFrequencyPathMeasurement => ({ metricId: "S1-HPE", routeId: id, routeGroup: group, routeLabel: id, source: null, target: null, sourceRoomRegionId: null, targetRoomRegionId: null, sourceZoneIds: [], targetZoneIds: [], sourceSpaceFunctionCodes: [], targetSpaceFunctionCodes: [], roomPathIds: [], doorIds: [], stairIds: [], pathPoints: [], actualPathLengthMeters: length, straightLineDistanceMeters: length, detourRatio: detour, topologicalSteps: null, intermediateRoomCount: null, turnCount: null, sourceLevelId: null, targetLevelId: null, sourceAnchorPoint: null, targetAnchorPoint: null, sourceAnchorType: null, targetAnchorType: null, sourceBehaviorObjectIds: [], targetBehaviorObjectIds: [], behaviorSources, selectedTargetZoneId: null, selectedTargetSpaceFunctionCode: null, pathProvider: "polygon_visibility_graph", independentGeometryValidated: true, sourceZoneAnchorPoints: [], targetZoneAnchorPoints: [], pathSmoothed: false, rawPathPointCount: 0, debugTrace: null, fallbackTargetUsed: false, tiedCandidateTargetRoomIds: [], status, confidence: "high", diagnostics: [], missingData: [] });
const report = (routes: S1HighFrequencyPathMeasurement[]): S1HighFrequencyPathReport => ({ metricId: "S1-HPE", metricName: "高频活动路径效率", measurementVersion: "v0.1", measurementStatus: "v0.1 Demo 正式局部评分", measurements: routes, groups: [], counts: { measured: routes.filter((item) => item.status === "measured").length, baselineUnreachable: 0, unableToDetermine: routes.filter((item) => item.status === "unable_to_determine").length, notApplicableRouteGroups: 0 }, averages: { actualPathLengthMeters: null, topologicalSteps: null, turnCount: null } });
const graph = (area = 100) => ({ roomAnalysis: { rooms: [{ roomRegionId: "R", levelId: "L1", usableForEvaluation: true, confidence: "high", polygons: [[[[0, 0], [Math.sqrt(area), 0], [Math.sqrt(area), Math.sqrt(area)], [0, Math.sqrt(area)]]]], areaSquareMeters: area }], zoneMatches: [{ zoneId: "Z", matchedRoomRegionIds: ["R"], relationship: "one-to-one" }], roomToZoneIds: {} } }) as any;
const handoff = (area = 100) => ({ zones: [{ id: "Z", levelId: "L1", outline: [[0, 0], [Math.sqrt(area), 0], [Math.sqrt(area), Math.sqrt(area)], [0, Math.sqrt(area)]], spaceFunctionCode: "SF06" }] }) as any;

describe("S1-HPE scoring v0.1 Demo", () => {
  it("uses frozen anchor boundaries and linear interpolation", () => {
    const scored = scoreS1HighFrequencyPaths(report([route("bed-boundary", "bedroom_to_bathroom", 3.5, 1.2), route("return-middle", "entry_to_kitchen", 4.5, 1.275)]), handoff(), graph());
    expect(scored.routeScores[0]).toMatchObject({ normalizedDistanceScore: 90, detourScore: 90 });
    expect(scored.routeScores[1]).toMatchObject({ normalizedDistanceScore: 95 });
    expect(scored.routeScores[1]!.detourScore).toBeCloseTo(82.5, 10);
  });

  it("keeps normalized distance stable when residential area quadruples and path length doubles", () => {
    const first = scoreS1HighFrequencyPaths(report([route("a", "bedroom_to_bathroom", 5, 1.1)]), handoff(100), graph(100));
    const second = scoreS1HighFrequencyPaths(report([route("b", "bedroom_to_bathroom", 10, 1.1)]), handoff(400), graph(400));
    expect(first.routeScores[0]!.normalizedDistance).toBeCloseTo(second.routeScores[0]!.normalizedDistance!, 10);
  });

  it("uses distinct Bedroom and Return curves plus the frozen 60/40 route score", () => {
    const summary = scoreS1HighFrequencyPaths(report([route("bed", "bedroom_to_bathroom", 5, 1.1), route("return", "entry_to_kitchen", 5, 1.1)]), handoff(), graph());
    expect(summary.routeScores.map((item) => item.normalizedDistanceScore)).toEqual([75, 92.5]);
    expect(summary.routeScores.map((item) => item.routeScore)).toEqual([85, 95.5]);
  });

  it("averages routes within scenes first, then scenes equally; excludes not applicable", () => {
    const summary = scoreS1HighFrequencyPaths(report([route("b1", "bedroom_to_bathroom", 2, 1.1), route("b2", "bedroom_to_bathroom", 11, 1.1), route("entry", "entry_to_kitchen", 3.5, 1.1), route("garage", "garage_to_kitchen", null, null, "not_applicable", ["garage_return"])]), handoff(), graph());
    expect(summary.sceneScores.find((item) => item.scene === "bedroom_to_bathroom")).toMatchObject({ score: 70, evaluableRouteCount: 2 });
    expect(summary.sceneScores.find((item) => item.scene === "return_to_kitchen")).toMatchObject({ score: 100, evaluableRouteCount: 1 });
    expect(summary).toMatchObject({ status: "scored", score: 85 });
  });

  it("keeps measured route scores but blocks an incomplete formal total", () => {
    const summary = scoreS1HighFrequencyPaths(report([route("good", "bedroom_to_bathroom", 2, 1.1), route("unknown", "bedroom_to_bathroom", null, null, "unable_to_determine")]), handoff(), graph());
    expect(summary.routeScores[0]).toMatchObject({ scoringStatus: "scored", routeScore: 100 });
    expect(summary).toMatchObject({ status: "unable_to_determine", score: null, unableSceneCount: 1 });
  });

  it("uses only countable SF-coded Zone∩RoomRegion area and excludes technical, garage and outdoor codes", () => {
    const area = measureS1EffectiveResidentialIndoorArea({ zones: [
      { id: "living", levelId: "L1", outline: [[0, 0], [10, 0], [10, 10], [0, 10]], spaceFunctionCode: "SF06" },
      { id: "dining-overlap", levelId: "L1", outline: [[5, 0], [15, 0], [15, 10], [5, 10]], spaceFunctionCode: "SF07" },
      { id: "garage", levelId: "L1", outline: [[15, 0], [25, 0], [25, 10], [15, 10]], spaceFunctionCode: "SF30" },
      { id: "outdoor", levelId: "L1", outline: [[25, 0], [35, 0], [35, 10], [25, 10]], spaceFunctionCode: "SF51" },
    ] } as any, { roomAnalysis: { rooms: [{ roomRegionId: "R", levelId: "L1", usableForEvaluation: true, polygons: [[[[0, 0], [35, 0], [35, 10], [0, 10]]]] }], zoneMatches: ["living", "dining-overlap", "garage", "outdoor"].map((zoneId) => ({ zoneId, matchedRoomRegionIds: ["R"], relationship: "one-to-one" })), roomToZoneIds: {} } } as any);
    expect(area).toMatchObject({ status: "measured", squareMeters: 150, excludedZoneIds: ["garage", "outdoor"] });
  });
});
