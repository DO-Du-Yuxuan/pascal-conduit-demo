import { describe, expect, it } from "vitest";
import { scoreS1SpaceUtilization } from "./s1-space-utilization";
import type { Point } from "./envelope";

const rect = (x: number, y: number, width: number, height: number): Point[] => [[x,y],[x + width,y],[x + width,y + height],[x,y + height]];
const graph = (zones: Array<{ id: string; code: string; outline: Point[]; level?: string }>) => {
  const room = { roomRegionId: "R", levelId: "L1", polygons: [[rect(0, 0, 20, 20)]], usableForEvaluation: true, confidence: "high" };
  return { roomAnalysis: { rooms: [room], zoneMatches: zones.map((zone) => ({ zoneId: zone.id, matchedRoomRegionIds: ["R"], relationship: "one-to-one", confidence: "high" })) } } as any;
};
const handoff = (zones: Array<{ id: string; code: string; outline: Point[]; level?: string }>) => ({ zones: zones.map((zone) => ({ id: zone.id, name: zone.id, levelId: zone.level ?? "L1", outline: zone.outline, spaceFunctionCode: zone.code })) }) as any;
const twoLevelGraph = (zones: Array<{ id: string; code: string; outline: Point[]; level: string }>) => ({ roomAnalysis: { rooms: ["L1", "L2"].map((levelId) => ({ roomRegionId: `R-${levelId}`, levelId, polygons: [[rect(0,0,10,10)]], usableForEvaluation: true, confidence: "high" })), zoneMatches: zones.map((zone) => ({ zoneId: zone.id, matchedRoomRegionIds: [`R-${zone.level}`], relationship: "one-to-one", confidence: "high" })) } } as any);

describe("S1 LY space utilization", () => {
  it("keeps no corridor at 100 and excludes stair from the numerator", () => {
    const zones = [{ id: "living", code: "SF06", outline: rect(0,0,10,10) }, { id: "stair", code: "SF19", outline: rect(10,0,5,5) }], result = scoreS1SpaceUtilization(handoff(zones), graph(zones));
    expect(result.ly01).toMatchObject({ score: 100, corridorAreaSquareMeters: 0, corridorRatio: 0 });
  });

  it("uses the continuous corridor curve and deduplicates overlapping corridor Zones", () => {
    const zones = [{ id: "living", code: "SF06", outline: rect(0,0,10,10) }, { id: "c1", code: "SF09", outline: rect(0,10,6,1) }, { id: "c2", code: "SF09", outline: rect(3,10,6,1) }], result = scoreS1SpaceUtilization(handoff(zones), graph(zones));
    expect(result.ly01.corridorAreaSquareMeters).toBe(9); expect(result.ly01.corridorRatio).toBeCloseTo(9 / 109, 8); expect(result.ly01.score).toBeCloseTo(83.7, 1);
  });

  it("adds corridor unions from separate levels", () => {
    const zones = [{ id: "living-1", code: "SF06", level: "L1", outline: rect(0,0,10,10) }, { id: "corridor-1", code: "SF09", level: "L1", outline: rect(0,0,1,10) }, { id: "living-2", code: "SF06", level: "L2", outline: rect(0,0,10,10) }, { id: "corridor-2", code: "SF09", level: "L2", outline: rect(0,0,2,10) }], result = scoreS1SpaceUtilization(handoff(zones), twoLevelGraph(zones));
    expect(result.ly01.corridorAreaSquareMeters).toBe(30);
  });

  it("does not flag a convex narrow space or a generally L-shaped space", () => {
    const l: Point[] = [[0,0],[6,0],[6,2],[2,2],[2,6],[0,6]];
    const zones = [{ id: "kitchen", code: "SF01", outline: rect(0,0,1,12) }, { id: "living", code: "SF06", outline: l }], result = scoreS1SpaceUtilization(handoff(zones), graph(zones));
    expect(result.ly02.measurements.every((item) => item.status === "normal_shape")).toBe(true);
  });

  it("flags only a simultaneous low-compactness and low-convexity Zone", () => {
    const broken: Point[] = [[0,0],[10,0],[10,1],[1,1],[1,10],[0,10]];
    const zones = [{ id: "broken", code: "SF06", outline: broken }, { id: "bed", code: "SF11", outline: rect(12,0,4,4) }], result = scoreS1SpaceUtilization(handoff(zones), graph(zones));
    expect(result.ly02.measurements.find((item) => item.zoneId === "broken")?.status).toBe("inefficient_shape");
    expect(result.ly02.inefficientShapeAreaRatio).toBeGreaterThan(0);
  });

  it("unions multiple inefficient Zone areas before calculating the ratio", () => {
    const brokenA: Point[] = [[0,0],[10,0],[10,1],[1,1],[1,10],[0,10]], brokenB: Point[] = [[11,0],[19,0],[19,1],[12,1],[12,8],[11,8]];
    const zones = [{ id: "a", code: "SF06", outline: brokenA }, { id: "b", code: "SF16", outline: brokenB }], result = scoreS1SpaceUtilization(handoff(zones), graph(zones));
    expect(result.ly02.measurements.filter((item) => item.status === "inefficient_shape")).toHaveLength(2); expect(result.ly02.inefficientShapeAreaRatio).toBe(1);
  });

  it("keeps unavailable geometry unable and excludes pure transition SF from LY-02", () => {
    const valid = [{ id: "foyer", code: "SF08", outline: rect(0,0,4,4) }, { id: "balcony", code: "SF17", outline: rect(4,0,4,4) }, { id: "living", code: "SF06", outline: rect(8,0,4,4) }], result = scoreS1SpaceUtilization(handoff(valid), graph(valid));
    expect(result.ly02.applicableZoneCount).toBe(1);
    const invalid = [{ id: "living", code: "SF06", outline: [[0,0],[1,1]] as any }];
    expect(scoreS1SpaceUtilization(handoff(invalid), graph(invalid)).ly02.status).toBe("unable_to_determine");
  });

  it("averages applicable rules and blocks the axis on unable", () => {
    const zones = [{ id: "living", code: "SF06", outline: rect(0,0,10,10) }], result = scoreS1SpaceUtilization(handoff(zones), graph(zones));
    expect(result).toMatchObject({ status: "scored", score: 100 });
    const invalid = [{ id: "living", code: "SF06", outline: [[0,0],[1,1]] as any }];
    expect(scoreS1SpaceUtilization(handoff(invalid), graph(invalid))).toMatchObject({ status: "unable_to_determine", score: null });
  });
});
