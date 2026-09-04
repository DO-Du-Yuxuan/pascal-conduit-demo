import { describe, expect, it } from "vitest";
import type { RoutePoint } from "../domain/overlay";
import { projectRayToActiveWall } from "./active-host";

const wall = { id: "wall-a", type: "wall", start: [0, 0], end: [4, 0], height: 3, thickness: .12 } as any;
const active: RoutePoint = { position: [1, 1, .06], attachment: { hostId: "wall-a", hostKind: "wall", surface: "interior", normal: [0, 0, 1], levelId: "L0", localPosition: [1, 1, .06], basis: { u: [1, 0, 0], v: [0, 1, 0] }, wallSide: "interior" } };

describe("active wall pointer projection", () => {
  it("keeps a pointer ray on the active wall face instead of a host behind it", () => {
    const projected = projectRayToActiveWall(wall, active, [2.5, 2, 5], [0, 0, -1]);
    expect(projected?.position[0]).toBeCloseTo(2.5);
    expect(projected?.position[1]).toBeCloseTo(2);
    expect(projected?.position[2]).toBeCloseTo(.06);
    expect(projected?.attachment?.hostId).toBe("wall-a");
    expect(projected?.attachment?.localPosition?.slice(0, 2)).toEqual([2.5, 2]);
  });

  it("releases the active wall after the ray leaves its finite bounds", () => {
    expect(projectRayToActiveWall(wall, active, [5, 2, 5], [0, 0, -1])).toBeNull();
    expect(projectRayToActiveWall(wall, active, [2, 4, 5], [0, 0, -1])).toBeNull();
  });
});
