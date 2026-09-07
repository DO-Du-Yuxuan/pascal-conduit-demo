import { describe, expect, it } from "vitest";
import { createEmptyOverlay } from "./overlay";
import { commitPlannedRoute, planRoute } from "./routing";
import { validateBranchCandidate, withCollisionDiagnostics } from "./routing-collision";
import { placeNetworkDevice } from "./devices";

const point = (x: number, y: number, z: number, hostId = "slab") => ({ position: [x, y, z] as [number, number, number], attachment: { hostId, hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId: "L0" } });

describe("routing collision validation", () => {
  it("includes network device bodies in route collision checks", () => {
    const overlay = placeNetworkDevice(createEmptyOverlay("a.json", "sha"), "strong-panel", { ...point(0, 0, 0), attachment: { ...point(0, 0, 0).attachment, hostKind: "wall" as const } });
    const plan = withCollisionDiagnostics(overlay, planRoute("receptacle", 20, "surface", [point(-1, 0, 0), point(1, 0, 0)]));
    expect(plan.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "route_collision", objectIds: expect.arrayContaining([overlay.devices[0].id]) })]));
  });

  it("can ignore only the route's explicit source device without dropping other device collisions", () => {
    let overlay = placeNetworkDevice(createEmptyOverlay("a.json", "sha"), "strong-panel", { ...point(0, 0, 0), attachment: { ...point(0, 0, 0).attachment, hostKind: "wall" as const } });
    overlay = placeNetworkDevice(overlay, "strong-panel", { ...point(1, 0, 0), attachment: { ...point(1, 0, 0).attachment, hostKind: "wall" as const } });
    const plan = planRoute("receptacle", 20, "surface", [point(-1, 0, 0), point(2, 0, 0)]);
    const checked = withCollisionDiagnostics(overlay, plan, undefined, new Set([overlay.devices[0].id]));
    expect(checked.diagnostics).not.toEqual(expect.arrayContaining([expect.objectContaining({ objectIds: expect.arrayContaining([overlay.devices[0].id]) })]));
    expect(checked.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ objectIds: expect.arrayContaining([overlay.devices[1].id]) })]));
  });
  it("rejects a non-adjacent self crossing", () => {
    const plan = planRoute("sprinkler", 50, "suspended", [point(-1, 1, 0), point(1, 1, 0), point(0, 1, -1), point(0, 1, 1)]);
    const checked = withCollisionDiagnostics(createEmptyOverlay("a.json", "sha"), plan);
    expect(checked.canCommit).toBe(false);
    expect(checked.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "self_collision" })]));
  });

  it("allows contact at a shared physical port", () => {
    const overlay = createEmptyOverlay("a.json", "sha"), existing = planRoute("receptacle", 20, "surface", [point(0, 0, 0), point(1, 0, 0)]);
    existing.segments[0].endPortId = "shared-port";
    const committed = commitPlannedRoute(overlay, existing), extension = planRoute("receptacle", 20, "surface", [point(1, 0, 0), point(2, 0, 0)]);
    extension.segments[0].startPortId = "shared-port";
    expect(withCollisionDiagnostics(committed, extension).canCommit).toBe(true);
  });

  it("allows a new route to leave a rooted open end without ignoring the rest of its source conduit", () => {
    const overlay = commitPlannedRoute(createEmptyOverlay("a.json", "sha"), planRoute("receptacle", 20, "surface", [point(0, 0, 0), point(1, 0, 0)]));
    const extension = planRoute("receptacle", 20, "surface", [point(1, 0, 0), point(1, 0, 1)]);
    const checked = withCollisionDiagnostics(overlay, extension, undefined, undefined, { segmentId: overlay.segments[0].id, point: [1, 0, 0] });
    expect(checked.canCommit).toBe(true);
  });

  it("checks branch box clearance against other network objects", () => {
    const base = commitPlannedRoute(createEmptyOverlay("a.json", "sha"), planRoute("receptacle", 20, "surface", [point(0, 0, 0), point(2, 0, 0)]));
    const other = commitPlannedRoute(base, planRoute("network", 20, "surface", [point(1, 0, -.2), point(1, 0, .2)]));
    expect(validateBranchCandidate(other, base.segments[0].id, [1, 0, 0], Math.hypot(86, 86, 50) / 2000)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "branch_clearance" })]));
  });

  it("keeps a 500-segment scene in the lightweight analytic path", () => {
    let overlay = createEmptyOverlay("a.json", "sha");
    for (let index = 0; index < 500; index += 1) overlay = commitPlannedRoute(overlay, planRoute("receptacle", 20, "surface", [point(index * .1, 0, 0), point(index * .1 + .05, 0, 0)]));
    const preview = planRoute("sprinkler", 50, "suspended", [point(0, 3, 2), point(10, 3, 2)]);
    expect(withCollisionDiagnostics(overlay, preview).canCommit).toBe(true);
  });

  it("raises a newly planned electrical floor crossing with a double-45 bridge", () => {
    const base = commitPlannedRoute(createEmptyOverlay("a.json", "sha"), planRoute("receptacle", 20, "surface", [point(-1, 0, 0, "floor-a"), point(1, 0, 0, "floor-a")]));
    const preview = withCollisionDiagnostics(base, planRoute("lighting", 20, "surface", [point(0, 0, -1, "floor-a"), point(0, 0, 1, "floor-a")]));
    const bridge = preview.fittings.find((fitting) => fitting.fitting === "bridge-bend");
    expect(preview.canCommit).toBe(true);
    expect(bridge?.bridge).toMatchObject({ obstacleSegmentId: base.segments[0].id, clearanceMm: 10 });
    expect(bridge?.bridge?.crestStart[1]).toBeGreaterThan(0);
  });

  it("does not bridge a sprinkler crossing or parallel floor overlap", () => {
    const base = commitPlannedRoute(createEmptyOverlay("a.json", "sha"), planRoute("receptacle", 20, "surface", [point(-1, 0, 0, "floor-a"), point(1, 0, 0, "floor-a")]));
    const sprinkler = withCollisionDiagnostics(base, planRoute("sprinkler", 50, "suspended", [point(0, 0, -1, "floor-a"), point(0, 0, 1, "floor-a")]));
    const parallel = withCollisionDiagnostics(base, planRoute("lighting", 20, "surface", [point(-.8, 0, 0, "floor-a"), point(.8, 0, 0, "floor-a")]));
    expect(sprinkler.fittings.some((fitting) => fitting.fitting === "bridge-bend")).toBe(false);
    expect(parallel.fittings.some((fitting) => fitting.fitting === "bridge-bend")).toBe(false);
    expect(parallel.canCommit).toBe(false);
  });
});
