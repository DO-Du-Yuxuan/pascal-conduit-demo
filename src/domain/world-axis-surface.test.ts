import { describe, expect, it } from "vitest";
import type { NodeData } from "../types";
import { beamRouteDiagnostics, isValidBeamAttachment } from "./beam-routing";
import { planRoute } from "./routing";
import { createBeam } from "./beams";
import type { RoutePoint } from "./overlay";
import { buildPhysicalPositioningSurfaces, type PositioningTriangle } from "./physical-positioning-surfaces";
import { resolveWorldAxisHostSurface } from "./world-axis-surface";

const nodes: Record<string, NodeData> = {
  level: { id: "level", type: "level", level: 0 },
  wall: { id: "wall", type: "wall", parentId: "level", start: [0, 0], end: [4, 0], height: 3, thickness: .2 },
  ceiling: { id: "ceiling", type: "ceiling", parentId: "level", height: 3, polygon: [[-2, -2], [4, -2], [4, 4], [-2, 4]] },
} as Record<string, NodeData>;
const wallHit: RoutePoint = { position: [2, 2, -.1], attachment: { hostId: "wall", hostKind: "wall", surface: "interior", normal: [0, 0, -1], levelId: "level", basis: { u: [1, 0, 0], v: [0, 1, 0] }, localPosition: [2, 2, .1] } };

describe("world-axis finite host reference", () => {
  it("uses the physical wall face distance while preserving the other coordinates", () => {
    const surfaces = buildPhysicalPositioningSurfaces(nodes), start: RoutePoint = { position: [1, 1, -2] };
    const result = resolveWorldAxisHostSurface(start, wallHit, "z", surfaces);
    expect(result.kind).toBe("arrival");
    expect(result.point.position).toEqual([1, 1, -.10000000000000009]);
    expect(result.point.attachment).toMatchObject({ hostId: "wall" });
    expect(result.point.attachment?.localPosition?.slice(0, 2)).toEqual([1, 1]);
    expect(wallHit.attachment?.localPosition).toEqual([2, 2, .1]);
    expect(start.position).toEqual([1, 1, -2]);
  });
  it("finds the true slanted-plane intersection rather than projecting the mouse hit", () => {
    const surfaces: PositioningTriangle[] = [
      { objectId: "angled", objectKind: "wall", vertices: [[4, 0, 0], [0, 0, 4], [0, 3, 4]] },
      { objectId: "angled", objectKind: "wall", vertices: [[4, 0, 0], [0, 3, 4], [4, 3, 0]] },
    ];
    const hit: RoutePoint = { position: [1, 2, 3], attachment: { ...wallHit.attachment!, hostId: "angled", normal: [-Math.SQRT1_2, 0, -Math.SQRT1_2] } };
    const result = resolveWorldAxisHostSurface({ position: [0, 1, 1] }, hit, "x", surfaces);
    expect(result.kind).toBe("arrival");
    expect(result.point.position).toEqual([3, 1, 1]);
  });
  it("only aligns when the axis is parallel, outside the finite wall, or over an opening", () => {
    const surfaces = buildPhysicalPositioningSurfaces(nodes);
    expect(resolveWorldAxisHostSurface({ position: [1, 1, -2] }, wallHit, "x", surfaces).kind).toBe("alignment");
    expect(resolveWorldAxisHostSurface({ position: [5, 1, -2] }, wallHit, "z", surfaces).kind).toBe("alignment");
    const withDoor = { ...nodes, door: { id: "door", type: "door", parentId: "wall", wallId: "wall", position: [2, 1, 0], width: 1, height: 2 } } as Record<string, NodeData>;
    const result = resolveWorldAxisHostSurface({ position: [2, 1, -2] }, wallHit, "z", buildPhysicalPositioningSurfaces(withDoor));
    expect(result.kind).toBe("alignment");
    expect(result.point.position[0]).toBe(2);
    expect(result.point.attachment).toBeUndefined();
  });
  it("stops at a finite beam side, but not its extended plane", () => {
    const beam = createBeam(nodes, { id: "beam", name: "beam", levelId: "level", start: [-1, 0], end: [1, 0], width: .3, height: .5 }).beam!;
    const surfaces = buildPhysicalPositioningSurfaces({ ...nodes, beam });
    const hit: RoutePoint = { position: [0, 2.8, -.15], attachment: { hostId: "beam", hostKind: "beam", surface: "side-a", normal: [0, 0, -1], levelId: "level", basis: { u: [1, 0, 0], v: [0, 1, 0] }, localPosition: [-.15, 2.8, 0] } };
    const start: RoutePoint = { position: [.8, 2.6, -1] };
    const result = resolveWorldAxisHostSurface(start, hit, "z", surfaces);
    expect(result.kind).toBe("arrival");
    expect(result.point.attachment?.localPosition).toEqual([-.15, 2.6, .8]);
    expect(isValidBeamAttachment({ ...nodes, beam }, result.point)).toBe(true);
    expect(beamRouteDiagnostics({ ...nodes, beam }, planRoute("network", 20, "suspended", [start, result.point]))).toEqual([]);
    expect(resolveWorldAxisHostSurface({ position: [2, 2.6, -1] }, hit, "z", surfaces).kind).toBe("alignment");
  });
  it("uses ceiling elevation for Y while respecting ceiling holes", () => {
    const hit: RoutePoint = { position: [2, 3, 2], attachment: { hostId: "ceiling", hostKind: "ceiling", surface: "bottom", normal: [0, -1, 0], levelId: "level" } };
    const start: RoutePoint = { position: [1, 1, 1] };
    expect(resolveWorldAxisHostSurface(start, hit, "y", buildPhysicalPositioningSurfaces(nodes))).toMatchObject({ kind: "arrival", point: { position: [1, 3, 1] } });
    const withHole = { ...nodes, ceiling: { ...nodes.ceiling, holes: [[[.5, .5], [1.5, .5], [1.5, 1.5], [.5, 1.5]]] } };
    expect(resolveWorldAxisHostSurface(start, hit, "y", buildPhysicalPositioningSurfaces(withHole)).kind).toBe("alignment");
  });
  it("does not invent a reference for unhosted hits", () => {
    expect(resolveWorldAxisHostSurface({ position: [1, 2, 3] }, { position: [5, 6, 7] }, "x", [])).toEqual({ kind: "none", point: { position: [5, 2, 3] } });
  });
  it.each(["wall", "ceiling"] as const)("retains a real %s arrival in saved stock-split segments", kind => {
    const hit: RoutePoint = kind === "wall" ? wallHit : { position: [2, 3, 2], attachment: { hostId: "ceiling", hostKind: "ceiling", surface: "bottom", normal: [0, -1, 0], levelId: "level", localPosition: [2, 3, 2], basis: { u: [1, 0, 0], v: [0, 0, 1] } } };
    const start: RoutePoint = kind === "wall" ? { position: [1, 1, -6] } : { position: [1, -3, 1] };
    const axis = kind === "wall" ? "z" : "y";
    const arrival = resolveWorldAxisHostSurface(start, hit, axis, buildPhysicalPositioningSurfaces(nodes));
    expect(arrival.kind).toBe("arrival");
    for (const system of ["receptacle", "network", "fire-signal", "sprinkler"] as const) {
      const plan = planRoute(system, 20, "suspended", [start, arrival.point]);
      expect(plan.canCommit).toBe(true);
      expect(plan.segments.length).toBeGreaterThan(1);
      expect(plan.segments[plan.segments.length - 1]?.end).toEqual(arrival.point);
      expect(plan.segments[plan.segments.length - 1]?.end.attachment).not.toBe(arrival.point.attachment);
    }
    if (kind === "ceiling") expect(arrival.point.attachment?.localPosition).toEqual([1, 3, 1]);
  });
});
