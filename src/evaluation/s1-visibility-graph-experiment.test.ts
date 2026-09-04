import { describe, expect, it } from "vitest";
import passingDemo from "../../sample-data/Bellevue passing demo.json";
import { buildEvaluationHandoff } from "../parser/evaluation-handoff";
import { parseProject } from "../parser/parse";
import { buildRoomConnectivityGraph } from "./connectivity";
import { buildRoomNavigationAnalysis } from "./navigation";
import { measureS1HighFrequencyPaths } from "./s1-high-frequency-path";
import { compareHpeRouteWithVisibilityGraph } from "./s1-visibility-graph-experiment";

describe("S1 visibility graph calibration experiment", () => {
  it("uses the same furnished free-space authority and returns stable Bellevue comparisons", () => {
    const handoff = buildEvaluationHandoff(parseProject(passingDemo));
    const graph = buildRoomConnectivityGraph(handoff), navigation = buildRoomNavigationAnalysis(handoff);
    const comparisons = measureS1HighFrequencyPaths(handoff, graph, navigation).measurements.filter((route) => route.status === "measured").map((route) => compareHpeRouteWithVisibilityGraph(route, navigation));
    expect(comparisons).toHaveLength(5);
    expect(comparisons.every((comparison) => comparison.currentLengthMeters !== null)).toBe(true);
    expect(comparisons.map((comparison) => comparison.routeId)).toEqual(measureS1HighFrequencyPaths(handoff, graph, navigation).measurements.filter((route) => route.status === "measured").map((route) => route.routeId));
  }, 20_000);
});
