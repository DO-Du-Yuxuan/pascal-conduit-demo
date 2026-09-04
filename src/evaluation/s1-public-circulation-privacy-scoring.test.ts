import { describe, expect, it } from "vitest";
import type { S1PublicCirculationPrivacyReport, S1PublicCirculationRouteMeasurement, S1PublicRouteGroupId } from "./s1-public-circulation-privacy";
import { scoreS1PublicCirculationPrivacy } from "./s1-public-circulation-privacy-scoring";

const groupIds: S1PublicRouteGroupId[] = ["entry_to_public", "visitor_to_public_bathroom", "public_to_public_outdoor", "garage_return"];
const route = (routeGroup: S1PublicRouteGroupId, id: string, resultType: S1PublicCirculationRouteMeasurement["resultType"]): S1PublicCirculationRouteMeasurement => ({ metricId: "public_circulation_privacy", routeId: id, routeGroup, routeGroupLabel: routeGroup, source: null, target: null, sourceRoomRegionId: null, targetRoomRegionId: null, sourceZoneIds: [], targetZoneIds: [], sourceSpaceFunctionCodes: [], targetSpaceFunctionCodes: [], baselineReachable: resultType === "baseline_unreachable" ? false : true, privacySafeReachable: resultType === "privacy_safe_route_available", resultType, baselinePathRoomRegionIds: [], privacySafePathRoomRegionIds: [], witnessPathRoomRegionIds: [], privateIntermediateRoomRegionIds: [], connectionDoorIds: [], connectionStairIds: [], levelIds: [], semanticSource: "sdi_code", confidence: "high", status: resultType === "unable_to_determine" ? "unable_to_determine" : resultType === "not_applicable" ? "not_applicable" : "measured", diagnostics: [], missingData: [] });
function report(routes: S1PublicCirculationRouteMeasurement[], states: Partial<Record<S1PublicRouteGroupId, "measured" | "unable_to_determine" | "not_applicable">> = {}): S1PublicCirculationPrivacyReport {
  const groups = groupIds.map((routeGroup) => ({ routeGroup, label: routeGroup, status: states[routeGroup] ?? (routes.some((item) => item.routeGroup === routeGroup) ? "measured" : "not_applicable") as "measured" | "unable_to_determine" | "not_applicable", routeCount: routes.filter((item) => item.routeGroup === routeGroup).length, diagnostics: [] }));
  return { metricId: "public_circulation_privacy", metricName: "公共动线穿越私密空间", measurementVersion: "v0.1", scoringStatus: "not_scored", measurements: routes, groups, counts: { generatedRoutes: routes.length, privacySafeRoutes: 0, privateMandatoryRoutes: 0, baselineUnreachableRoutes: 0, unableToDetermineRoutes: 0, notApplicableRouteGroups: 0 }, affectedPublicTargetRoomRegionIds: [], privateIntermediateRoomRegionIds: [], privateWitnessPathAppearances: [] };
}

describe("S1-PCP scoring v0.1", () => {
  it("scores safe routes 100 and mandatory private routes 0", () => {
    const summary = scoreS1PublicCirculationPrivacy(report([route("visitor_to_public_bathroom", "safe", "privacy_safe_route_available"), route("visitor_to_public_bathroom", "mandatory", "private_space_mandatory")]));
    expect(summary.routeScores.map((item) => [item.score, item.matchedRuleId])).toEqual([[100, "S1-PCP-R01"], [0, "S1-PCP-R02"]]);
    expect(summary.groupScores.find((item) => item.routeGroup === "visitor_to_public_bathroom")).toMatchObject({ status: "scored", score: 50, evaluableRouteCount: 2, safeRouteCount: 1, mandatoryPrivateRouteCount: 1 });
  });

  it("does not convert baseline-unreachable or unable routes into zero", () => {
    const summary = scoreS1PublicCirculationPrivacy(report([route("entry_to_public", "unreachable", "baseline_unreachable")], { entry_to_public: "measured" }));
    expect(summary.routeScores[0]).toMatchObject({ scoringStatus: "unable_to_determine", score: null, matchedRuleId: "S1-PCP-R03" });
    expect(summary.groupScores[0]).toMatchObject({ status: "unable_to_determine", score: null });
    const unable = scoreS1PublicCirculationPrivacy(report([route("entry_to_public", "unable", "unable_to_determine")], { entry_to_public: "unable_to_determine" }));
    expect(unable.routeScores[0]).toMatchObject({ scoringStatus: "unable_to_determine", score: null, matchedRuleId: "S1-PCP-R04" });
  });

  it("excludes not-applicable groups and routes from denominators", () => {
    const summary = scoreS1PublicCirculationPrivacy(report([route("visitor_to_public_bathroom", "safe", "privacy_safe_route_available")], { entry_to_public: "not_applicable", public_to_public_outdoor: "not_applicable", garage_return: "not_applicable" }));
    expect(summary).toMatchObject({ status: "scored", score: 100, applicableGroupCount: 1, notApplicableGroupCount: 3, unableGroupCount: 0 });
  });

  it("averages groups equally, rounds to one decimal, and blocks the metric on an unable group", () => {
    const routes = [route("entry_to_public", "e", "privacy_safe_route_available"), route("visitor_to_public_bathroom", "v1", "privacy_safe_route_available"), route("visitor_to_public_bathroom", "v2", "privacy_safe_route_available"), route("visitor_to_public_bathroom", "v3", "privacy_safe_route_available"), route("visitor_to_public_bathroom", "v4", "private_space_mandatory"), route("public_to_public_outdoor", "o", "privacy_safe_route_available"), route("garage_return", "g", "privacy_safe_route_available")];
    expect(scoreS1PublicCirculationPrivacy(report(routes))).toMatchObject({ status: "scored", score: 93.8, applicableGroupCount: 4 });
    const blocked = scoreS1PublicCirculationPrivacy(report([...routes, route("entry_to_public", "bad", "unable_to_determine")], { entry_to_public: "unable_to_determine" }));
    expect(blocked).toMatchObject({ status: "unable_to_determine", score: null, unableGroupCount: 1 });
  });

  it("returns not_applicable when every group is not applicable", () => {
    expect(scoreS1PublicCirculationPrivacy(report([]))).toMatchObject({ status: "not_applicable", score: null, applicableGroupCount: 0, notApplicableGroupCount: 4 });
  });
});
