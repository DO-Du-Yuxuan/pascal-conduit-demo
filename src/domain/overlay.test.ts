import { describe, expect, it } from "vitest";
import { assessOverlayHosts, createEmptyOverlay, parseOverlay, SYSTEM_DEFAULTS } from "./overlay";
import { branchAtSegment, commitPlannedRoute, planRoute, resetRoutingIdsForTests } from "./routing";

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

  it("splits a compatible segment and inserts one tee", () => {
    resetRoutingIdsForTests();
    const base = createEmptyOverlay("default-layout.json", "abc");
    const routed = commitPlannedRoute(base, planRoute("power", 20, "surface", [point(0, 1, 0), point(2, 1, 0)]));
    const branched = branchAtSegment(routed, routed.segments[0].id, point(1, 1, 0), point(1, 1, 1));
    expect(branched.segments).toHaveLength(3);
    expect(branched.fittings).toMatchObject([{ fitting: "tee", segmentIds: expect.any(Array) }]);
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
