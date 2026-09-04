import { describe, expect, it } from "vitest";
import defaultLayout from "../../sample-data/default-layout.json";
import { transitionToAdjacentWall, type WallHostCandidate } from "./host-transition";

const nodes = defaultLayout.nodes as Record<string, any>;
const walls: WallHostCandidate[] = Object.values(nodes).filter((node: any) => node.type === "wall").map((node: any) => ({ node, levelId: node.parentId, openings: Object.values(nodes).filter((child: any) => (child.type === "door" || child.type === "window") && child.wallId === node.id).map((child: any) => ({ center: child.position[0], width: child.width })) }));
const slabHit = (x: number, z: number) => ({ point: [x, .05, z] as [number, number, number], attachment: { hostId: "slab_nukmmmuy5nl7tdvn", hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId: "level_3syt3grnb9zg523c" }, shiftKey: false });
const otherSlabHit = (x: number, z: number) => ({ ...slabHit(x, z), attachment: { ...slabHit(x, z).attachment, hostId: "slab_kjh8f1fpfjzu8zyt" } });

describe("floor to wall host transitions", () => {
  it("finds both perpendicular and horizontal walls bordering the supplied slab", () => {
    expect(transitionToAdjacentWall(slabHit(11.12, -1), walls).attachment.hostId).toBe("wall_wjmievt994ffq9fs");
    expect(transitionToAdjacentWall(slabHit(14, -.12), walls).attachment.hostId).toBe("wall_54wj6s46m9q0m5qg");
  });

  it("does not turn a door or window aperture into a wall host", () => {
    expect(transitionToAdjacentWall(slabHit(16.4, -.12), walls).attachment.hostId).toBe("slab_nukmmmuy5nl7tdvn");
    expect(transitionToAdjacentWall(slabHit(15.24, -.12), walls).attachment.hostId).toBe("slab_nukmmmuy5nl7tdvn");
  });

  it("intercepts the route at a wall even when the pointer ray has already hit the slab on the other side", () => {
    const previous = { position: [14, .05, -.8] as [number, number, number], attachment: slabHit(14, -.8).attachment };
    const transitioned = transitionToAdjacentWall(otherSlabHit(14, .5), walls, .14, previous);
    expect(transitioned.attachment.hostId).toBe("wall_54wj6s46m9q0m5qg");
    expect(transitioned.point[2]).toBeCloseTo(-.0566, 2);
  });
});
