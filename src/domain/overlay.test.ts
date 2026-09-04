import { describe, expect, it } from "vitest";
import { assessOverlayHosts, createEmptyOverlay, parseOverlay, SYSTEM_DEFAULTS } from "./overlay";
import { branchAtSegment, commitBranchRoute, commitPlannedRoute, deleteNetworkObject, planBranchContinuation, planRoute, resetRoutingIdsForTests } from "./routing";
import { withCollisionDiagnostics } from "./routing-collision";

const point = (x: number, y: number, z: number, hostId = "wall-a") => ({ position: [x, y, z] as [number, number, number], attachment: { hostId, hostKind: "wall" as const, surface: "interior", normal: [0, 0, 1] as [number, number, number], levelId: "L0" } });

describe("Conduit overlay", () => {
  it("round-trips an empty overlay", () => {
    const overlay = createEmptyOverlay("default-layout.json", "abc");
    expect(parseOverlay(JSON.parse(JSON.stringify(overlay)))).toEqual(overlay);
  });

  it("preserves local host anchors while accepting older overlay documents", () => {
    const overlay = createEmptyOverlay("default-layout.json", "abc");
    const anchored = { ...overlay, segments: [{ id: "pipe", type: "conduit-segment" as const, system: "power" as const, diameterMm: 20, start: { position: [0, 1, 0] as [number, number, number], attachment: { ...point(0, 1, 0).attachment!, localPosition: [0.5, 1, 0], basis: { u: [1, 0, 0] as [number, number, number], v: [0, 1, 0] as [number, number, number] }, curveT: .25, wallSide: "interior" as const } }, end: point(1, 1, 0), createdAt: "now" }] };
    expect(parseOverlay(JSON.parse(JSON.stringify(anchored))).segments[0].start.attachment?.curveT).toBe(.25);
    const legacy = JSON.parse(JSON.stringify(overlay)); delete legacy.settings.visibleSystems;
    expect(parseOverlay(legacy).settings.visibleSystems.power).toBe(true);
    legacy.schemaVersion = "1.0"; delete legacy.settings.bendRadiusMm; delete legacy.settings.stockLengthMm; delete legacy.settings.junctionBoxSizeMm; delete legacy.junctionBoxes;
    const migrated = parseOverlay(legacy);
    expect(migrated).toMatchObject({ schemaVersion: "1.1", junctionBoxes: [], settings: { bendRadiusMm: 200, stockLengthMm: 4000, junctionBoxSizeMm: [86, 86, 50] } });
  });

  it("uses the documented four system defaults", () => {
    expect(SYSTEM_DEFAULTS.power).toMatchObject({ color: "#ef4444", diameterMm: 20 });
    expect(SYSTEM_DEFAULTS["low-voltage"]).toMatchObject({ color: "#3b82f6", diameterMm: 20 });
    expect(SYSTEM_DEFAULTS.signal).toMatchObject({ color: "#ffffff", diameterMm: 20 });
    expect(SYSTEM_DEFAULTS.sprinkler).toMatchObject({ color: "#22c55e", diameterMm: 50 });
  });

  it("makes explicit segments, elbow and electrical wall chase", () => {
    resetRoutingIdsForTests();
    const source = [point(0, 1, 0), point(1, 1, 0), point(1, 1, 1)], before = JSON.stringify(source);
    const plan = planRoute("power", 20, "surface", source);
    expect(plan.segments).toHaveLength(2);
    expect(plan.fittings).toMatchObject([{ fitting: "elbow", system: "power" }]);
    expect(plan.wallChases).toHaveLength(2);
    expect(plan.penetrations).toHaveLength(0);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("does not cut sprinkler wall chases and can mark penetrations", () => {
    resetRoutingIdsForTests();
    const plan = planRoute("sprinkler", 50, "penetrate", [point(0, 2, 0), point(0, 2, 1, "slab-a")]);
    expect(plan.wallChases).toHaveLength(0);
    expect(plan.penetrations).toHaveLength(2);
    expect(plan.penetrations[0].diameterMm).toBe(60);
  });

  it("uses explicitly confirmed demo construction parameters", () => {
    const electrical = planRoute("power", 20, "surface", [point(0, 1, 0), point(1, 1, 0)], { chaseWidthMm: 44, chaseDepthMm: 31, penetrationDiameterMm: 52 });
    expect(electrical.wallChases[0]).toMatchObject({ widthMm: 44, depthMm: 31 });
    const through = planRoute("sprinkler", 50, "penetrate", [point(0, 2, 0), point(0, 2, 1, "slab-a")], { chaseWidthMm: 44, chaseDepthMm: 31, penetrationDiameterMm: 52 });
    expect(through.penetrations.every((feature) => feature.diameterMm === 52)).toBe(true);
  });

  it("can add a one-shot penetration to an otherwise surface route", () => {
    const a = point(0, 1, 0), b = point(1, 1, 0), c = point(2, 1, 0);
    const plan = planRoute("power", 20, "surface", [a, b, c], { chaseWidthMm: 30, chaseDepthMm: 25, penetrationDiameterMm: 34 }, [b]);
    expect(plan.penetrations).toHaveLength(1);
    expect(plan.penetrations[0]).toMatchObject({ hostId: "wall-a", diameterMm: 34 });
  });

  it("splits an electrical segment at an 86 junction box", () => {
    resetRoutingIdsForTests();
    const base = createEmptyOverlay("default-layout.json", "abc");
    const routed = commitPlannedRoute(base, planRoute("power", 20, "surface", [point(0, 1, 0), point(2, 1, 0)]));
    const branched = branchAtSegment(routed, routed.segments[0].id, point(1, 1, 0), point(1, 1, 1));
    expect(branched.segments).toHaveLength(3);
    expect(branched.junctionBoxes).toMatchObject([{ type: "junction-box", sizeMm: [86, 86, 50], segmentIds: expect.any(Array), ports: expect.arrayContaining([expect.objectContaining({ segmentId: expect.any(String) })]) }]);
    expect(branched.fittings).toHaveLength(0);
    expect(branched.segments.every((segment) => !segment.start.position.every((value, axis) => value === point(1, 1, 0).position[axis]) && !segment.end.position.every((value, axis) => value === point(1, 1, 0).position[axis]))).toBe(true);
  });

  it("uses the same physical box port for branch preview and commit", () => {
    const base = createEmptyOverlay("default-layout.json", "abc"), routed = commitPlannedRoute(base, planRoute("power", 20, "surface", [point(0, 1, 0), point(2, 1, 0)]));
    const branchPoints = [point(1, 1, 0), point(1, 1, 1)], preview = planBranchContinuation(routed, routed.segments[0].id, branchPoints, { chaseWidthMm: 30, chaseDepthMm: 25, penetrationDiameterMm: 30 })!;
    const committed = commitBranchRoute(routed, routed.segments[0].id, branchPoints, { chaseWidthMm: 30, chaseDepthMm: 25, penetrationDiameterMm: 30 }), box = committed.junctionBoxes[0], branch = committed.segments.find((segment) => segment.startPortId === box.ports[2].id)!;
    expect(preview.segments[0].start.position).toEqual([1, 1, .043]);
    expect(branch.start.position).toEqual(preview.segments[0].start.position);
    expect(branch.start.position).toEqual(box.ports[2].position.position);
  });

  it("splits a sprinkler segment at a physical tee", () => {
    resetRoutingIdsForTests();
    const base = createEmptyOverlay("default-layout.json", "abc"), routed = commitPlannedRoute(base, planRoute("sprinkler", 50, "suspended", [point(0, 2, 0), point(2, 2, 0)]));
    const branched = commitBranchRoute(routed, routed.segments[0].id, [point(1, 2, 0), point(1, 2, 1)], { chaseWidthMm: 60, chaseDepthMm: 55, penetrationDiameterMm: 60 });
    expect(branched.junctionBoxes).toHaveLength(0);
    expect(branched.fittings).toEqual(expect.arrayContaining([expect.objectContaining({ fitting: "tee", ports: expect.any(Array) })]));
  });

  it("deletes a junction box or tee with all connected dependencies atomically", () => {
    const base = createEmptyOverlay("default-layout.json", "abc"), electrical = commitPlannedRoute(base, planRoute("power", 20, "surface", [point(0, 1, 0), point(2, 1, 0)])), branched = branchAtSegment(electrical, electrical.segments[0].id, point(1, 1, 0), point(1, 1, 1));
    const removedBox = deleteNetworkObject(branched, branched.junctionBoxes[0].id);
    expect(removedBox.segments).toHaveLength(0);
    expect(removedBox.junctionBoxes).toHaveLength(0);
    expect(removedBox.wallChases).toHaveLength(0);
    const sprinkler = commitPlannedRoute(base, planRoute("sprinkler", 50, "suspended", [point(0, 2, 0), point(2, 2, 0)])), sprinklerBranch = branchAtSegment(sprinkler, sprinkler.segments[0].id, point(1, 2, 0), point(1, 2, 1)), tee = sprinklerBranch.fittings.find((fitting) => fitting.fitting === "tee")!;
    expect(deleteNetworkObject(sprinklerBranch, tee.id).segments).toHaveLength(0);
  });

  it("creates a 200 mm tangent sweep on one electrical host", () => {
    const plan = planRoute("power", 20, "surface", [point(0, 1, 0), point(1, 1, 0), point(1, 1, 1)]);
    expect(plan.canCommit).toBe(true);
    expect(plan.fittings).toEqual(expect.arrayContaining([expect.objectContaining({ fitting: "elbow", bendStyle: "sweep", radiusMm: 200, arc: expect.any(Object) })]));
    expect(plan.segments[0].end.position[0]).toBeCloseTo(.8);
    expect(plan.segments[1].start.position[2]).toBeCloseTo(.2);
  });

  it("rejects a sweep when either tangent is shorter than its clearance", () => {
    const plan = planRoute("power", 20, "surface", [point(0, 1, 0), point(.1, 1, 0), point(.1, 1, .1)]);
    expect(plan.canCommit).toBe(false);
    expect(plan.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "bend_clearance" })]));
  });

  it("uses right-angle electrical bends across hosts and standard sprinkler bends", () => {
    const electrical = planRoute("power", 20, "surface", [point(0, 1, 0, "wall-a"), point(1, 1, 0, "wall-a"), point(1, 1, 1, "slab-a")]);
    expect(electrical.fittings[0]).toMatchObject({ bendStyle: "right-angle" });
    const sprinkler = planRoute("sprinkler", 50, "suspended", [point(0, 2, 0), point(1, 2, 0), point(1, 2, 1)]);
    expect(sprinkler.fittings[0]).toMatchObject({ bendStyle: "standard" });
  });

  it("keeps an old-host sweep until the actual host-transition corner", () => {
    const floor = (x: number, z: number) => ({ position: [x, 0, z] as [number, number, number], attachment: { hostId: "floor", hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId: "L0" } });
    const wall = (x: number, y: number, z: number) => ({ position: [x, y, z] as [number, number, number], attachment: { hostId: "wall", hostKind: "wall" as const, surface: "interior", normal: [0, 0, 1] as [number, number, number], levelId: "L0" } });
    const plan = planRoute("power", 20, "surface", [floor(0, 0), floor(1, 0), wall(1, 0, 1), wall(1, 1, 1)]);
    expect(plan.fittings.map((fitting) => fitting.bendStyle)).toEqual(["sweep", "right-angle"]);
  });

  it("restores the first sweep after entering a new host plane", () => {
    const oldHost = { position: [0, 0, 0] as [number, number, number], attachment: { hostId: "floor", hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId: "L0" } };
    const wallCorner = { position: [0, 1, 0] as [number, number, number], attachment: { hostId: "wall", hostKind: "wall" as const, surface: "interior", normal: [0, 0, 1] as [number, number, number], levelId: "L0" } };
    const wallNext = { ...wallCorner, position: [1, 1, 0] as [number, number, number] };
    expect(planRoute("power", 20, "surface", [oldHost, wallCorner, wallNext]).fittings[0]).toMatchObject({ bendStyle: "sweep", radiusMm: 200 });
  });

  it("splits all systems at four metres and inserts physical couplings", () => {
    for (const system of ["power", "low-voltage", "signal", "sprinkler"] as const) {
      const plan = planRoute(system, system === "sprinkler" ? 50 : 20, "suspended", [point(0, 1, 0), point(9, 1, 0)]);
      expect(plan.segments.map((segment) => Math.hypot(...segment.end.position.map((value, axis) => value - segment.start.position[axis])))).toEqual([4, 4, 1]);
      expect(plan.fittings.filter((fitting) => fitting.fitting === "coupling")).toHaveLength(2);
    }
  });

  it("accumulates stock length through a sweep and breaks early at the arc start", () => {
    const plan = planRoute("power", 20, "surface", [point(0, 1, 0), point(3.9, 1, 0), point(3.9, 1, 2)]);
    const sweep = plan.fittings.find((fitting) => fitting.bendStyle === "sweep")!;
    const coupling = plan.fittings.find((fitting) => fitting.fitting === "coupling" && fitting.position.position.every((value, axis) => Math.abs(value - sweep.arc!.start[axis]) < 1e-6));
    expect(coupling).toBeDefined();
    expect(coupling?.ports[1].connectedPortId).toBe(sweep.ports[0].id);
  });

  it("blocks physical crossings but allows separated heights", () => {
    const base = commitPlannedRoute(createEmptyOverlay("default-layout.json", "abc"), planRoute("power", 20, "surface", [point(-1, 1, 0), point(1, 1, 0)]));
    const crossing = withCollisionDiagnostics(base, planRoute("signal", 20, "surface", [point(0, 1, -1, "slab-a"), point(0, 1, 1, "slab-a")]));
    expect(crossing.canCommit).toBe(false);
    expect(crossing.diagnostics[0]).toMatchObject({ code: "route_collision" });
    const above = withCollisionDiagnostics(base, planRoute("sprinkler", 50, "suspended", [point(0, 2, -1, "ceiling-a"), point(0, 2, 1, "ceiling-a")]));
    expect(above.canCommit).toBe(true);
  });

  it("keeps orphaned route coordinates while reporting missing hosts", () => {
    const overlay = commitPlannedRoute(createEmptyOverlay("source.json", "old"), planRoute("power", 20, "surface", [point(0, 1, 0), point(2, 1, 0)]));
    expect(assessOverlayHosts(overlay, ["different-wall"])).toEqual({ referencedHostIds: ["wall-a"], missingHostIds: ["wall-a"] });
    expect(overlay.segments).toHaveLength(1);
  });

  it("plans a dense 500-segment preview without generating host cuts", () => {
    const slabPoint = (index: number) => ({ position: [index * .02, 0, 0] as [number, number, number], attachment: { hostId: "slab-a", hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId: "L0" } });
    const plan = planRoute("power", 20, "surface", Array.from({ length: 501 }, (_, index) => slabPoint(index)));
    expect(plan.segments).toHaveLength(500);
    expect(plan.wallChases).toHaveLength(0);
    expect(plan.penetrations).toHaveLength(0);
  });

  it("creates 100 penetration pairs only at final route planning time", () => {
    const points = Array.from({ length: 101 }, (_, index) => ({ position: [index, 2, 0] as [number, number, number], attachment: { hostId: `host-${index}`, hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId: "L0" } }));
    const plan = planRoute("sprinkler", 50, "penetrate", points);
    expect(plan.penetrations).toHaveLength(200);
    expect(plan.segments).toHaveLength(100);
  });
});
