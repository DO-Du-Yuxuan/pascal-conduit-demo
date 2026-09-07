import { describe, expect, it } from "vitest";
import { beginPenetration, constrainToHostAxes, directionStateForArrow, displayedRoutePoints, penetrationRequest, pointOnWorldAxis, previewRoutePoints, projectPenetrationExit, resolveConfirmedRoutePoint, routePointsForCompletion } from "./drawing";
import type { RoutePoint } from "./overlay";

const wall = (position: [number, number, number]): RoutePoint => ({ position, attachment: { hostId: "wall", hostKind: "wall", surface: "interior", normal: [0, 0, 1], levelId: "L0", basis: { u: [1, 0, 0], v: [0, 1, 0] }, localPosition: position } });
const slab = (position: [number, number, number]): RoutePoint => ({ position, attachment: { hostId: "slab", hostKind: "slab", surface: "top", normal: [0, 1, 0], levelId: "L0", basis: { u: [1, 0, 0], v: [0, 0, 1] }, localPosition: position } });

describe("surface drawing preview", () => {
  it("uses the wall's local horizontal or vertical axis, never a world dominant axis", () => {
    expect(constrainToHostAxes(wall([0, 1, 0]), wall([3, 2, 0]), "orthogonal").position).toEqual([3, 1, 0]);
    expect(constrainToHostAxes(wall([0, 1, 0]), wall([1, 4, 0]), "orthogonal").position).toEqual([0, 4, 0]);
  });

  it("uses local floor axes and keeps free mode untouched", () => {
    expect(constrainToHostAxes(slab([0, 0, 0]), slab([3, 0, 1]), "orthogonal").position).toEqual([3, 0, 0]);
    expect(constrainToHostAxes(slab([0, 0, 0]), slab([3, 0, 1]), "free").position).toEqual([3, 0, 1]);
  });

  it("defines free as arbitrary angle on the active host plane", () => {
    expect(constrainToHostAxes(wall([0, 1, 0]), wall([2, 3, .8]), "free").position).toEqual([2, 3, 0]);
    const other = { ...wall([2, 3, .8]), attachment: { ...wall([2, 3, .8]).attachment!, hostId: "adjacent-wall" } };
    expect(constrainToHostAxes(wall([0, 1, 0]), other, "free")).toBe(other);
  });

  it("keeps the previous host's orthogonal axes while previewing a host transition", () => {
    const adjacent = { ...wall([2, 3, .8]), attachment: { ...wall([2, 3, .8]).attachment!, hostId: "adjacent-wall" } };
    expect(constrainToHostAxes(wall([0, 1, 0]), adjacent, "orthogonal").position).toEqual([2, 1, 0]);
  });

  it("adds a cursor-only preview without mutating confirmed route points", () => {
    const confirmed = [slab([0, 0, 0])];
    const preview = previewRoutePoints(confirmed, slab([2, 0, 1]), "orthogonal");
    expect(preview).toHaveLength(2);
    expect(preview[1].position).toEqual([2, 0, 0]);
    expect(confirmed).toHaveLength(1);
  });

  it("lets Enter finish at the last confirmed click instead of the live preview", () => {
    const confirmed = [slab([0, 0, 0]), slab([2, 0, 0])];
    const preview = slab([4, 0, 0]);

    expect(routePointsForCompletion(confirmed, preview, "confirmed-only")).toEqual(confirmed);
    expect(routePointsForCompletion(confirmed, preview, "include-preview")).toEqual([...confirmed, preview]);
    expect(routePointsForCompletion([confirmed[0]], preview, "confirmed-only")).toHaveLength(1);
  });

  it("rejects unhosted cursor points outside explicit world-axis mode", () => {
    const start = slab([0, 0, 0]), floating: RoutePoint = { position: [2, 3, 4] };
    expect(displayedRoutePoints([start], floating, "free")).toEqual([start]);
    expect(displayedRoutePoints([start], floating, "orthogonal")).toEqual([start]);
    expect(displayedRoutePoints([start], floating, "orthogonal", { worldAxis: "y" })).toEqual([start, floating]);
  });

  it("uses Shift to temporarily enable surface-relative orthogonal drawing", () => {
    expect(previewRoutePoints([slab([0, 0, 0])], slab([2, 0, 1]), "free")[1].position).toEqual([2, 0, 1]);
    expect(previewRoutePoints([slab([0, 0, 0])], slab([2, 0, 1]), "free", true)[1].position).toEqual([2, 0, 0]);
  });

  it("projects a suspended preview onto the requested world axis", () => {
    const start = slab([1, 2, 3]);
    expect(pointOnWorldAxis(start, "x", [0, 4, 3], [0, -1, 0]).position).toEqual([0, 2, 3]);
    expect(pointOnWorldAxis(start, "y", [4, 0, 3], [-1, 0, 0]).position).toEqual([1, 0, 3]);
  });

  it("confirms the displayed world-axis point instead of the raw click hit", () => {
    const preview = pointOnWorldAxis(slab([1, 2, 3]), "x", [0, 4, 3], [0, -1, 0]);
    expect(displayedRoutePoints([slab([1, 2, 3])], preview, "orthogonal", { worldAxis: "x" })[1]).toBe(preview);
    const confirmed = resolveConfirmedRoutePoint(preview, slab([8, 0, 9]));
    expect(confirmed).toBe(preview);
    expect(confirmed?.position).toEqual([0, 2, 3]);
    expect(confirmed?.attachment).toBeUndefined();
  });

  it("locks a Tab penetration to its incoming line and restores a real destination host", () => {
    const start = slab([0, 0, 0]), entry = wall([2, 0, 0]), session = beginPenetration([start], entry, true)!;
    const rawDestination: RoutePoint = { position: [4, 2, 2], attachment: { hostId: "rear-wall", hostKind: "wall", surface: "interior", normal: [-1, 0, 0], levelId: "L0", basis: { u: [0, 0, 1], v: [0, 1, 0] }, localPosition: [2, 2, 0] } }, displayedExit = projectPenetrationExit(session, rawDestination)!;
    expect(session.direction).toEqual([1, 0, 0]);
    expect(displayedExit.position).toEqual([4, 0, 0]);
    expect(displayedExit.attachment).toMatchObject({ hostId: "rear-wall", localPosition: [0, 0, 0] });
    expect(displayedRoutePoints([start], displayedExit, "orthogonal", { penetration: session })).toEqual([start, entry, displayedExit]);
    expect(resolveConfirmedRoutePoint(displayedExit, wall([9, 2, 0]))).toBe(displayedExit);
    expect(penetrationRequest(session, displayedExit)).toMatchObject({ host: { hostId: "wall" }, entry, exit: displayedExit, direction: [1, 0, 0] });
  });

  it("rejects a Tab exit behind the entry or without a destination host", () => {
    const session = beginPenetration([slab([0, 0, 0])], wall([2, 0, 0]), true)!;
    expect(projectPenetrationExit(session, { position: [1, 0, 0], attachment: { ...wall([1, 0, 0]).attachment!, normal: [-1, 0, 0] } })).toBeNull();
    expect(projectPenetrationExit(session, slab([4, 1, 0]))).toBeNull();
    expect(projectPenetrationExit(session, { position: [4, 2, 0] })).toBeNull();
  });

  it("reattaches a horizontal Tab route to a coplanar slab behind a wall", () => {
    const session = beginPenetration([slab([0, 0, 0])], wall([2, 0, 0]), true)!;
    const rearSlab = { ...slab([4, 0, 2]), attachment: { ...slab([4, 0, 2]).attachment!, hostId: "rear-slab" } };
    expect(projectPenetrationExit(session, rearSlab)).toMatchObject({ position: [4, 0, 0], attachment: { hostId: "rear-slab", localPosition: [4, 0, 0] } });
  });

  it("keeps every non-world preview attached to a real host after Tab", () => {
    const start = slab([0, 0, 0]), entry = wall([2, 0, 0]), session = beginPenetration([start], entry, false)!;
    const destination: RoutePoint = { position: [4, 1, 0], attachment: { ...wall([4, 1, 0]).attachment!, hostId: "destination", normal: [-1, 0, 0] } };
    const exit = projectPenetrationExit(session, destination)!;
    expect(exit.attachment?.hostId).toBe("destination");
    expect(constrainToHostAxes(exit, { ...destination, position: [4, 2, 3] }, session.orthogonal ? "orthogonal" : "free").attachment?.hostId).toBe("destination");
  });

  it("turns off surface orthogonal mode for every world-axis arrow", () => {
    expect(directionStateForArrow("ArrowLeft")).toEqual({ worldAxis: "x", orthogonal: false });
    expect(directionStateForArrow("ArrowUp")).toEqual({ worldAxis: "y", orthogonal: false });
    expect(directionStateForArrow("ArrowRight")).toEqual({ worldAxis: "z", orthogonal: false });
    expect(directionStateForArrow("ArrowDown")).toEqual({ worldAxis: null, orthogonal: false });
  });
});
