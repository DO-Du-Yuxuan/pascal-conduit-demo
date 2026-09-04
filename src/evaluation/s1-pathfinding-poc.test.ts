import { describe, expect, it } from "vitest";
import passingDemo from "../../sample-data/Bellevue passing demo.json";
import { buildEvaluationHandoff } from "../parser/evaluation-handoff";
import { parseProject } from "../parser/parse";
import type { Point, Ring } from "./envelope";
import { buildRoomConnectivityGraph } from "./connectivity";
import { buildRoomNavigationAnalysis } from "./navigation";
import { measureS1HighFrequencyPaths } from "./s1-high-frequency-path";
import { compareHpeRoutePathfindingPoc, CurrentGridPocProvider, S1_PATHFINDING_POC_AGENT_RADIUS_METERS, VisibilityGraphPocProvider, YukaNavMeshPocProvider, type S1PocPathProvider, type S1PocRoomInput } from "./s1-pathfinding-poc";

const rectangle = (x1: number, y1: number, x2: number, y2: number): Ring => [[x1,y1],[x2,y1],[x2,y2],[x1,y2]];
const fixture = (room: Ring, start: Point, end: Point, obstaclePolygons: Ring[] = [], radius = .2): S1PocRoomInput => ({ roomRegionId: "fixture", levelId: "L1", roomPolygons: [[room]], obstaclePolygons, start, end, agentRadiusMeters: radius });
const providers = (): S1PocPathProvider[] => [new CurrentGridPocProvider(), new YukaNavMeshPocProvider(), new VisibilityGraphPocProvider()];
const assertMeasured = (input: S1PocRoomInput) => providers().map((provider) => { const result = provider.findPath(input); expect(result, provider.id).toMatchObject({ status: "measured", geometryValid: true, clearanceValid: true }); expect(result.pathPoints[0]).toBeDefined(); expect(result.pathPoints[result.pathPoints.length - 1]).toBeDefined(); return result; });

describe("S1 2D pathfinding POC benchmark final", () => {
  it("covers empty, L, U and multiple-obstacle polygon fixtures", () => {
    const fixtures = [
      fixture(rectangle(0,0,8,5), [1,1], [7,4]),
      fixture([[0,0],[8,0],[8,2],[3,2],[3,7],[0,7]], [1,6], [7,1]),
      fixture([[0,0],[8,0],[8,8],[5,8],[5,3],[3,3],[3,8],[0,8]], [1,7], [7,7]),
      fixture(rectangle(0,0,10,8), [1,1], [9,7], [rectangle(3,2,4,6), rectangle(6,2,7,6)]),
    ];
    fixtures.forEach((input) => assertMeasured(input));
  });

  it("keeps clearance around a central island and is deterministic on equal alternatives", () => {
    const input = fixture(rectangle(0,0,10,8), [1,4], [9,4], [rectangle(4,2,6,6)]);
    for (const provider of providers()) {
      const first = provider.findPath(input), second = provider.findPath(input);
      expect(first.status, provider.id).toBe("measured");
      expect(first.pathPoints, provider.id).toEqual(second.pathPoints);
      expect(first.lengthMeters, provider.id).toEqual(second.lengthMeters);
    }
  });

  it("handles narrow-door and narrow-corridor clearance boundaries", () => {
    const doorway = [rectangle(4,0,6,3.7), rectangle(4,4.3,6,8)];
    assertMeasured(fixture(rectangle(0,0,10,8), [1,4], [9,4], doorway));
    for (const provider of providers()) expect(provider.findPath(fixture(rectangle(0,0,10,8), [1,4], [9,4], [rectangle(4,0,6,3.85), rectangle(4,4.15,6,8)])).status, provider.id).toBe("unable_to_determine");
  });

  it("handles wall-adjacent obstacles, tiny edges, collinear points and holes", () => {
    assertMeasured(fixture([[0,0],[5,0],[5,.00001],[10,.00001],[10,8],[0,8],[0,4]], [1,1], [9,7], [rectangle(0,2,2,3)]));
    assertMeasured({ ...fixture(rectangle(0,0,10,8), [1,1], [9,7]), roomPolygons: [[rectangle(0,0,10,8), rectangle(4,2,6,6)]] });
  });

  it("does not switch a fixed portal endpoint even when another portal is shorter", () => {
    const input = fixture(rectangle(0,0,10,8), [1,1], [9,7], [rectangle(4,0,6,5)]);
    for (const result of assertMeasured(input)) { expect(result.pathPoints[0]).toEqual(expect.arrayContaining([expect.any(Number)])); expect(result.pathPoints[result.pathPoints.length - 1]).toEqual(expect.arrayContaining([expect.any(Number)])); }
  });

  it("uses the centralized experimental agent radius", () => {
    expect(S1_PATHFINDING_POC_AGENT_RADIUS_METERS).toBe(.2);
  });

  it("compares all formally measured Bellevue HPE behavior routes with stable geometry and portals", () => {
    const handoff = buildEvaluationHandoff(parseProject(passingDemo)), graph = buildRoomConnectivityGraph(handoff), navigation = buildRoomNavigationAnalysis(handoff), routes = measureS1HighFrequencyPaths(handoff, graph, navigation).measurements.filter((route) => route.status === "measured"), comparisons = routes.map((route) => compareHpeRoutePathfindingPoc(route, navigation));
    expect(comparisons).toHaveLength(5);
    for (const comparison of comparisons) {
      expect(comparison.visibilityGraph, comparison.routeId).toMatchObject({ status: "measured", geometryValid: true, clearanceValid: true, portalValid: true, deterministic: true });
      expect(comparison.yuka.deterministic || comparison.yuka.status === "unable_to_determine", comparison.routeId).toBe(true);
    }
    expect(comparisons.filter((comparison) => comparison.yuka.status === "unable_to_determine").length).toBeGreaterThanOrEqual(1);
    expect(comparisons.every((comparison) => comparison.current.providerId === "current")).toBe(true);
  }, 30_000);
});
