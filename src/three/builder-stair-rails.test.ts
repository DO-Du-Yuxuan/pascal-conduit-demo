import { describe, expect, it } from "vitest";
import { buildBuilderStairRailPaths } from "./builder-stair-rails";

const segment = (id: string, type: "stair" | "landing", attachmentSide?: string) => ({
  id, type: "stair-segment", segmentType: type, attachmentSide, width: 1.2, length: type === "landing" ? 1.2 : 2,
  height: type === "landing" ? 0 : 1.4, stepCount: type === "landing" ? 1 : 7,
});

describe("Builder stair rail path geometry contract", () => {
  it("keeps source local segment points, attachment transforms, and landing edge selection", () => {
    const flight = segment("flight-a", "stair");
    const landing = segment("landing-a", "landing", "right");
    const nextFlight = segment("flight-b", "stair", "front");
    const paths = buildBuilderStairRailPaths({ id: "stair", type: "stair", stairType: "straight", railingMode: "both", railingHeight: .92 }, [flight, landing, nextFlight]);

    expect(paths).toHaveLength(3);
    expect(paths[0]!.sidePaths.map((path) => path.side)).toEqual(["left", "right"]);
    expect(paths[0]!.sidePaths[0]!.points[0]![0]).toBeCloseTo(-1);
    expect(paths[0]!.sidePaths[0]!.points[0]![1]).toBeCloseTo(.2);
    expect(paths[0]!.sidePaths[0]!.points[0]![2]).toBeCloseTo(.555);
    expect(paths[1]!.sidePaths.map((path) => path.side)).toEqual(["left", "right"]);
    expect(paths[1]!.position[1]).toBeCloseTo(1.4);
    expect(paths[1]!.rotation).toBeCloseTo(-Math.PI / 2);
    expect(paths[2]!.position[0]).toBeCloseTo(-2.8);
    expect(paths[2]!.position[2]).toBeCloseTo(1);
    expect(paths[2]!.connectFromPrevious).toBe(true);
  });

  it("selects canonical front and side paths around a two-flight U turn", () => {
    const paths = buildBuilderStairRailPaths(
      { id: "stair", type: "stair", stairType: "straight", railingMode: "both" },
      [segment("a", "stair"), segment("turn", "landing", "left"), segment("b", "stair", "left"), segment("top", "landing", "front")],
    );
    expect(paths.map((path) => path.sidePaths.map((side) => side.side))).toEqual([
      ["left", "right"], ["front", "right"], ["left", "right"], ["left", "right"],
    ]);
    expect(paths[1]!.sidePaths[0]!.points).toEqual([[-.52, 0, .52], [-.52, 0, -.52]]);
    expect(paths[1]!.connectFromPrevious).toBe(true);
  });

  it("uses Builder curved/spiral radius and elevation sampling and honors side mode", () => {
    const stair = { id: "spiral", type: "stair", stairType: "spiral", railingMode: "left", width: .8, innerRadius: .4, sweepAngle: Math.PI, stepCount: 4, totalRise: 2, thickness: .12 };
    const [path] = buildBuilderStairRailPaths(stair, []);
    expect(path!.sidePaths).toHaveLength(1);
    expect(path!.sidePaths[0]!.points).toHaveLength(4);
    expect(path!.sidePaths[0]!.points[0]![1]).toBeCloseTo(.12);
    expect(Math.hypot(path!.sidePaths[0]!.points[0]![0], path!.sidePaths[0]!.points[0]![2])).toBeCloseTo(.44);
  });
});
