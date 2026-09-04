import { describe, expect, it } from "vitest";
import { buildCurvedStairPlanGeometry, buildStraightStairPlanGeometry, stairLandingGeometry } from "./stairs";

const base = { id: "stair", type: "stair", parentId: "level", position: [10, 0, 20], rotation: 0, stairType: "straight", children: ["a", "landing", "b"] };
describe("non-spiral stair plan geometry", () => {
  it("accumulates straight segments using front/left/right Pascal attachments", () => {
    const nodes: any = { stair: base, a: { id: "a", type: "stair-segment", parentId: "stair", segmentType: "stair", width: 2, length: 4, height: 1, stepCount: 4 }, landing: { id: "landing", type: "stair-segment", parentId: "stair", segmentType: "landing", attachmentSide: "left", width: 2, length: 2, height: .2 }, b: { id: "b", type: "stair-segment", parentId: "stair", segmentType: "stair", attachmentSide: "right", width: 2, length: 3, height: 1, stepCount: 3 } };
    const geometry = buildStraightStairPlanGeometry(base as any, nodes)!;
    expect(geometry.segments).toHaveLength(3);
    expect(geometry.segments[0]!.treads).toHaveLength(3);
    expect(geometry.segments[1]!.treads).toHaveLength(0);
    expect(geometry.segments[1]!.polygon[0]).toEqual({ x: 11, z: 23 });
    expect(geometry.segments[2]!.polygon[0]).toEqual({ x: 11, z: 23 });
  });
  it("builds a signed curved annular sector with exactly stepCount boundaries", () => {
    const positive = buildCurvedStairPlanGeometry({ id: "curve", type: "stair", stairType: "curved", position: [0, 0, 0], rotation: 0, width: 1, innerRadius: 2, sweepAngle: Math.PI / 2, stepCount: 5 } as any)!;
    const negative = buildCurvedStairPlanGeometry({ id: "curve", type: "stair", stairType: "curved", position: [0, 0, 0], rotation: 0, width: 1, innerRadius: 2, sweepAngle: -Math.PI / 2, stepCount: 5 } as any)!;
    expect(positive.treadLines).toHaveLength(6);
    expect(negative.treadLines).toHaveLength(6);
    expect(positive.footprintPath).not.toEqual(negative.footprintPath);
    expect(positive.upDirection.to.z).toBeGreaterThan(positive.upDirection.from.z);
    expect(negative.upDirection.to.z).toBeLessThan(negative.upDirection.from.z);
  });
  it("derives separate outward landing directions for a spiral stair", () => {
    const stair = { id: "spiral", type: "stair", stairType: "spiral", position: [0, 0, 0], rotation: 0, width: 1, innerRadius: .4, sweepAngle: -Math.PI * 1.5, stepCount: 16 } as any, landing = stairLandingGeometry(stair, { spiral: stair })!;
    expect(landing.width).toBe(1);
    expect(Math.hypot(landing.fromOutward.x, landing.fromOutward.z)).toBeCloseTo(1);
    expect(Math.hypot(landing.toOutward.x, landing.toOutward.z)).toBeCloseTo(1);
    expect(landing.fromCenter).not.toEqual(landing.toCenter);
  });
});
