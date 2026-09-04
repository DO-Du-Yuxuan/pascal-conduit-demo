import { describe, expect, it } from "vitest";
import type { Point } from "./envelope";
import type { S1HighFrequencyPathMeasurement, S1HighFrequencyPathPoint, S1HighFrequencyPathReport } from "./s1-high-frequency-path";
import { measureS1PathConflicts } from "./s1-path-conflict";

const path = (points: Point[], levelId = "L1"): S1HighFrequencyPathPoint[] => points.map((point) => ({ levelId, point }));
function route(id: string, pathPoints: S1HighFrequencyPathPoint[], overrides: Partial<S1HighFrequencyPathMeasurement> = {}): S1HighFrequencyPathMeasurement {
  const length = pathPoints.slice(1).reduce((sum, item, index) => item.levelId === pathPoints[index]!.levelId ? sum + Math.hypot(item.point[0] - pathPoints[index]!.point[0], item.point[1] - pathPoints[index]!.point[1]) : sum, 0);
  return { metricId: "S1-HPE", routeId: id, routeGroup: "entry_to_kitchen", routeLabel: id, source: null, target: null, sourceRoomRegionId: "RA", targetRoomRegionId: "RB", sourceZoneIds: [`${id}-source`], targetZoneIds: [`${id}-target`], sourceSpaceFunctionCodes: ["SF10"], targetSpaceFunctionCodes: ["SF01"], roomPathIds: ["RA", "RB"], doorIds: [], stairIds: [], pathPoints, actualPathLengthMeters: length, straightLineDistanceMeters: length, detourRatio: 1, topologicalSteps: 1, intermediateRoomCount: 0, turnCount: 0, sourceLevelId: pathPoints[0]?.levelId ?? "L1", targetLevelId: pathPoints[pathPoints.length - 1]?.levelId ?? "L1", sourceAnchorPoint: pathPoints[0]?.point ?? null, targetAnchorPoint: pathPoints[pathPoints.length - 1]?.point ?? null, sourceAnchorType: "zone_representative", targetAnchorType: "zone_representative", sourceBehaviorObjectIds: [], targetBehaviorObjectIds: [], behaviorSources: ["primary_entry"], selectedTargetZoneId: `${id}-target`, selectedTargetSpaceFunctionCode: "SF01", pathProvider: "polygon_visibility_graph", independentGeometryValidated: true, sourceZoneAnchorPoints: [], targetZoneAnchorPoints: [], pathSmoothed: false, rawPathPointCount: 0, debugTrace: null, fallbackTargetUsed: false, tiedCandidateTargetRoomIds: [], status: "measured", confidence: "high", diagnostics: [], missingData: [], ...overrides };
}
const hpe = (routes: S1HighFrequencyPathMeasurement[]): S1HighFrequencyPathReport => ({ metricId: "S1-HPE", metricName: "高频活动路径效率", measurementVersion: "v0.1", measurementStatus: "v0.1 Demo 正式局部评分", measurements: routes, groups: [], counts: { measured: routes.filter((item) => item.status === "measured").length, baselineUnreachable: 0, unableToDetermine: 0, notApplicableRouteGroups: 0 }, averages: { actualPathLengthMeters: null, topologicalSteps: null, turnCount: null } });

describe("S1-PCI polyline comparison", () => {
  it("reports two fully separated paths as no interaction even when they share a RoomRegion", () => {
    const pair = measureS1PathConflicts(hpe([route("A", path([[0,0],[2,0]])), route("B", path([[0,2],[2,2]]))])).routePairs[0]!;
    expect(pair).toMatchObject({ interactionTypes: ["no_interaction"], crossingCount: 0, overlapSegmentCount: 0, sharedRoomRegionCount: 2 });
  });

  it("deduplicates a point crossing produced by adjacent polyline segments", () => {
    const pair = measureS1PathConflicts(hpe([route("A", path([[-1,0],[0,0],[1,0]])), route("B", path([[0,-1],[0,0],[0,1]]))])).routePairs[0]!;
    expect(pair.interactionTypes).toContain("path_crossing");
    expect(pair.crossingCount).toBe(1);
    expect(pair.crossingPointsByLevel[0]?.point).toEqual([0,0]);
  });

  it("measures same-direction, opposite-direction and mixed overlaps", () => {
    const a = route("A", path([[0,0],[4,0]]));
    const same = measureS1PathConflicts(hpe([a, route("B", path([[1,0],[3,0]]))])).routePairs[0]!;
    expect(same).toMatchObject({ sharedPathLengthMeters: 2, overlapDirection: "same_direction", overlapSegmentCount: 1 });
    expect(same.interactionTypes).toContain("path_overlap_same_direction");
    const opposite = measureS1PathConflicts(hpe([a, route("C", path([[3,0],[1,0]]))])).routePairs[0]!;
    expect(opposite.overlapDirection).toBe("opposite_direction");
    expect(opposite.interactionTypes).toContain("path_overlap_opposite_direction");
    const mixed = measureS1PathConflicts(hpe([a, route("D", path([[0,0],[2,0],[0,0]]))])).routePairs[0]!;
    expect(mixed.overlapDirection).toBe("mixed");
    expect(mixed.interactionTypes).toContain("path_overlap_mixed_direction");
  });

  it("marks only a common source or target as shared_endpoint rather than an ordinary crossing", () => {
    const source = measureS1PathConflicts(hpe([route("A", path([[0,0],[2,0]])), route("B", path([[0,0],[0,2]]))])).routePairs[0]!;
    expect(source.interactionTypes).toEqual(["shared_endpoint"]); expect(source.crossingCount).toBe(0);
    const target = measureS1PathConflicts(hpe([route("C", path([[2,0],[0,0]])), route("D", path([[0,2],[0,0]]))])).routePairs[0]!;
    expect(target.interactionTypes).toEqual(["shared_endpoint"]); expect(target.crossingCount).toBe(0);
  });

  it("records shared doors, multiple doors, stairs and RoomRegions as independent facts", () => {
    const a = route("A", path([[0,0],[1,0]]), { doorIds: ["D1","D2"], stairIds: ["S1"], roomPathIds: ["R1","R2"] }), b = route("B", path([[0,2],[1,2]]), { doorIds: ["D2","D1","D3"], stairIds: ["S1"], roomPathIds: ["R2","R3"] });
    const report = measureS1PathConflicts(hpe([a,b])), pair = report.routePairs[0]!;
    expect(pair).toMatchObject({ sharedDoorIds: ["D1","D2"], sharedDoorCount: 2, sharedStairIds: ["S1"], sharedStairCount: 1, sharedRoomRegionIds: ["R2"] });
    expect(pair.interactionTypes).toEqual(expect.arrayContaining(["shared_door","shared_stair"]));
    expect(report.hotspots.doors.find((item) => item.objectId === "D1")?.routeCount).toBe(2);
  });

  it("never compares segments on different levels", () => {
    const pair = measureS1PathConflicts(hpe([route("A", path([[0,0],[2,0]], "L1")), route("B", path([[1,-1],[1,1]], "L2"))])).routePairs[0]!;
    expect(pair).toMatchObject({ comparedLevelIds: [], crossingCount: 0, sharedPathLengthMeters: 0, interactionTypes: ["no_interaction"] });
  });

  it("uses the configured overlap-distance boundary without multiplying micro-noise segments", () => {
    const a = route("A", path([[0,0],[4,0]])), within = measureS1PathConflicts(hpe([a, route("B", path([[1,.04],[2,.041],[3,.04]]))])).routePairs[0]!, outside = measureS1PathConflicts(hpe([a, route("C", path([[1,.06],[3,.06]]))])).routePairs[0]!;
    expect(within).toMatchObject({ overlapSegmentCount: 1, sharedPathLengthMeters: 2 });
    expect(outside.overlapSegmentCount).toBe(0);
  });

  it("produces stable unique pair IDs independent of input order", () => {
    const a = route("route-z", path([[0,0],[1,0]])), b = route("route-a", path([[0,1],[1,1]]));
    expect(measureS1PathConflicts(hpe([a,b])).routePairs[0]?.routePairId).toBe(measureS1PathConflicts(hpe([b,a])).routePairs[0]?.routePairId);
    expect(measureS1PathConflicts(hpe([a,b])).routePairs).toHaveLength(1);
  });

  it("is not applicable with fewer than two measured routes and excludes unresolved routes", () => {
    const unresolved = route("bad", [], { status: "unable_to_determine", actualPathLengthMeters: null, pathSmoothed: false });
    const report = measureS1PathConflicts(hpe([route("A", path([[0,0],[1,0]])), unresolved]));
    expect(report).toMatchObject({ status: "not_applicable", eligibleRouteIds: ["A"], counts: { eligibleRoutes: 1, routePairs: 0 } });
  });
});
