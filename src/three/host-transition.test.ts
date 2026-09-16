import { describe, expect, it } from "vitest";
import { transitionToAdjacentWall, type WallHostCandidate } from "./host-transition";

const walls: WallHostCandidate[] = [
  { node: { id: "wall-perpendicular", type: "wall", parentId: "level", start: [11, -2], end: [11, 2], thickness: .2 }, levelId: "level", openings: [] },
  { node: { id: "wall-horizontal", type: "wall", parentId: "level", start: [0, 0], end: [20, 0], thickness: .2 }, levelId: "level", openings: [{ center: 16.4, width: .4 }, { center: 15.24, width: .3 }] },
] as any;
const slabHit = (x: number, z: number) => ({ point: [x, .05, z] as [number, number, number], attachment: { hostId: "slab-a", hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId: "level" }, shiftKey: false });
const otherSlabHit = (x: number, z: number) => ({ ...slabHit(x, z), attachment: { ...slabHit(x, z).attachment, hostId: "slab-b" } });

describe("floor to wall host transitions", () => {
  it("finds both perpendicular and horizontal walls bordering the supplied slab", () => {
    expect(transitionToAdjacentWall(slabHit(11.12, -1), walls).attachment.hostId).toBe("wall-perpendicular");
    expect(transitionToAdjacentWall(slabHit(14, -.12), walls).attachment.hostId).toBe("wall-horizontal");
  });

  it("does not turn a door or window aperture into a wall host", () => {
    expect(transitionToAdjacentWall(slabHit(16.4, -.12), walls).attachment.hostId).toBe("slab-a");
    expect(transitionToAdjacentWall(slabHit(15.24, -.12), walls).attachment.hostId).toBe("slab-a");
  });

  it("intercepts the route at a wall even when the pointer ray has already hit the slab on the other side", () => {
    const previous = { position: [14, .05, -.8] as [number, number, number], attachment: slabHit(14, -.8).attachment };
    const transitioned = transitionToAdjacentWall(otherSlabHit(14, .5), walls, .14, previous);
    expect(transitioned.attachment.hostId).toBe("wall-horizontal");
    expect(transitioned.point[2]).toBeCloseTo(0, 2);
  });

  it("lets a one-shot Tab penetration bypass only its entrance wall", () => {
    const previous = { position: [14, .05, -.8] as [number, number, number], attachment: slabHit(14, -.8).attachment };
    const transitioned = transitionToAdjacentWall(otherSlabHit(14, .5), walls, .14, previous, "wall-horizontal");
    expect(transitioned.attachment.hostId).toBe("slab-b");
  });
});
