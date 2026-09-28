import { describe, expect, it } from "vitest";
import { createEmptyOverlay } from "./overlay";
import type { RouteFitting, RouteSegment } from "./overlay";
import { commitPlannedRoute, planRoute } from "./routing";
import { preserveSlabHostForWorldAxisPoint, validateBranchCandidate, validatePlannedRoute, withCollisionDiagnostics } from "./routing-collision";
import { placeNetworkDevice } from "./devices";
import { pointOnWorldAxis } from "./drawing";
import { projectRoutePointToWorldAxis } from "./snapping";

const point = (x: number, y: number, z: number, hostId = "slab") => ({ position: [x, y, z] as [number, number, number], attachment: { hostId, hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId: "L0" } });

describe("routing collision validation", () => {
  it("checks candidate conduits against persisted HVAC control routes", () => {
    const overlay = createEmptyOverlay("a.json", "sha");
    overlay.hvac.controlConduits = [{ id: "hvac-route", type: "hvac-control-conduit", system: "control", thermostatId: "t", thermostatPortId: "t:control-port", indoorUnitId: "u", indoorUnitPortId: "u:control-port", segmentIds: ["hvac-segment"], fittingIds: [], diameterMm: 20, createdAt: "now" }];
    overlay.hvac.controlSegments = [{ id: "hvac-segment", start: point(-1, 1, 0), end: point(1, 1, 0) }];
    const crossing = planRoute("network", 20, "surface", [point(0, 1, -1), point(0, 1, 1)]);
    expect(validatePlannedRoute(overlay, crossing)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "route_collision", objectIds: expect.arrayContaining(["hvac-segment"]) })]));
  });

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

  it("keeps an open-end helper separate from a physical connection", () => {
    const overlay = commitPlannedRoute(createEmptyOverlay("a.json", "sha"), planRoute("receptacle", 20, "surface", [point(0, 0, 0), point(1, 0, 0)]));
    const coincidentHelper = planRoute("receptacle", 20, "surface", [point(1, 0, 1), point(1, 0, 0)]);
    const projectedHelper = planRoute("receptacle", 20, "surface", [point(1, 0, 1), point(1, 0, .1)]);

    // A helper click does not supply the endpoint-contact exception used by
    // explicit continuation, so it cannot leave a second route pretending to
    // connect at the same physical location.
    expect(withCollisionDiagnostics(overlay, coincidentHelper).canCommit).toBe(false);
    const checkedProjection = withCollisionDiagnostics(overlay, projectedHelper);
    expect(checkedProjection.canCommit).toBe(true);

    const next = commitPlannedRoute(overlay, checkedProjection);
    expect(next.segments).toHaveLength(2);
    expect(next.segments[0]?.endPortId).toBeUndefined();
    expect(next.segments[1]?.startPortId).toBeUndefined();
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
    expect(bridge?.bridge?.riseMm).toBe(30);
    expect(bridge?.bridge?.entry[2]).toBeCloseTo(-.05);
    expect(bridge?.bridge?.exit[2]).toBeCloseTo(.05);
  });

  it("derives a temporary slab host only for a fully covered imported obstacle segment", () => {
    const levelId = "level_3syt3grnb9zg523c", slabId = "slab_r3920kf4ohvb5je5";
    const importedTarget: RouteSegment = {
      id: "conduit-1e50b4cb-92d0-43e2-857a-d29f9b353825", type: "conduit-segment", system: "receptacle", diameterMm: 20,
      start: { position: [2.9589368904521614, 0.05000000074505784, 0.12816424066267318] },
      end: { position: [1.9840517295464135, 0.05000000074505784, 0.12816424066267318] }, createdAt: "",
    };
    const overlay = { ...createEmptyOverlay("a.json", "sha"), segments: [importedTarget] };
    const slabPoint = (x: number, z: number) => ({ position: [x, .05, z] as [number, number, number], attachment: { hostId: slabId, hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId } });
    const whiteRoute = planRoute("network", 20, "surface", [slabPoint(2.45, -.55), slabPoint(2.45, .75)]);
    const slabContext = {
      levelId,
      slabs: [{
        id: slabId, parentId: levelId, type: "slab", elevation: .05,
        polygon: [[5.84484856854921, -3.6011988670505257], [3.5777821517392283, -.5977600998749288], [3.577782406510387, .9118220666263639], [1.8340517288013558, .9092442406626731], [1.8340517288013558, -3.6111155138997084]],
        holes: [],
      }],
    };

    expect(withCollisionDiagnostics(overlay, whiteRoute).fittings.some(fitting => fitting.fitting === "bridge-bend")).toBe(false);
    const bridged = withCollisionDiagnostics(overlay, whiteRoute, undefined, undefined, undefined, slabContext);
    expect(bridged.canCommit).toBe(true);
    expect(bridged.fittings.find(fitting => fitting.fitting === "bridge-bend")?.bridge).toMatchObject({ obstacleSegmentId: importedTarget.id, riseMm: 30, clearanceMm: 10 });
    expect(importedTarget.start.attachment).toBeUndefined();
    expect(importedTarget.end.attachment).toBeUndefined();
    expect(overlay.segments[0]).toEqual(importedTarget);
  });

  it("retains a verified slab host on horizontal world-axis cursor points only", () => {
    const levelId = "level-1", slabId = "slab-1", context = {
      levelId,
      slabs: [{ id: slabId, parentId: levelId, type: "slab", elevation: .05, polygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]], holes: [] }],
    };
    const start = { position: [0, .05, 0] as [number, number, number], attachment: { hostId: slabId, hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId, localPosition: [0, .05, 0] as [number, number, number], basis: { u: [1, 0, 0] as [number, number, number], v: [0, 0, 1] as [number, number, number] } } };
    const projected = pointOnWorldAxis(start, "x", [0.5, 1, 0], [0, -1, 0]);
    const onSlab = preserveSlabHostForWorldAxisPoint(start, projected.position, "x", 20, context);
    expect(onSlab.position).toEqual([.5, .05, 0]);
    expect(onSlab.attachment?.hostId).toBe(slabId);
    expect(onSlab.attachment?.localPosition).toEqual([.5, .05, 0]);
    const surfaceProjected = projectRoutePointToWorldAxis(start, { position: [.5, .05, .2] }, "x");
    expect(preserveSlabHostForWorldAxisPoint(start, surfaceProjected.position, "x", 20, context).attachment?.hostId).toBe(slabId);
    expect(preserveSlabHostForWorldAxisPoint(start, [2, .05, 0], "x", 20, context).attachment).toBeUndefined();
    expect(preserveSlabHostForWorldAxisPoint(start, [0, .05, 0], "y", 20, context).attachment).toBeUndefined();
    expect(preserveSlabHostForWorldAxisPoint(start, [0, .15, 0], "y", 20, context).attachment).toBeUndefined();
    const freeStart = { position: [0, .05, 0] as [number, number, number] };
    const freeLanding = preserveSlabHostForWorldAxisPoint(freeStart, [.25, .05, 0], "x", 20, context);
    expect(freeLanding.attachment).toMatchObject({ hostId: slabId, hostKind: "slab", surface: "top", levelId, localPosition: [.25, .05, 0] });
    const wallStart = { ...freeStart, attachment: { hostId: "wall-1", hostKind: "wall" as const, surface: "interior", normal: [0, 0, 1] as [number, number, number], levelId } };
    const wallLanding = preserveSlabHostForWorldAxisPoint(wallStart, [.25, .05, 0], "x", 20, context);
    expect(wallLanding.attachment).toMatchObject({ hostId: slabId, hostKind: "slab", surface: "top", levelId, localPosition: [.25, .05, 0] });
  });

  it("preserves established explicit slab attachments when scene slab geometry is unavailable", () => {
    const base = commitPlannedRoute(createEmptyOverlay("a.json", "sha"), planRoute("receptacle", 20, "surface", [point(-1, 0, 0, "floor-a"), point(1, 0, 0, "floor-a")]));
    const plan = planRoute("network", 20, "surface", [point(0, 0, -1, "floor-a"), point(0, 0, 1, "floor-a")]);
    const checked = withCollisionDiagnostics(base, plan, undefined, undefined, undefined, { levelId: "L0", slabs: [] });
    expect(checked.canCommit).toBe(true);
    expect(checked.fittings.some(fitting => fitting.fitting === "bridge-bend")).toBe(true);
  });

  it("bridges a floor crossing over a supported large elbow arc without ignoring its collision volume", () => {
    const levelId = "level-1", slabId = "slab-1", attachment = { hostId: slabId, hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId };
    const elbow: RouteFitting = {
      id: "large-sweep", type: "conduit-fitting", fitting: "elbow", bendStyle: "sweep", radiusMm: 300,
      system: "receptacle", diameterMm: 20, position: { position: [.3, .05, 0], attachment },
      segmentIds: ["elbow-before", "elbow-after"], ports: [],
      arc: { start: [.3, .05, 0], end: [0, .05, .3], center: [0, .05, 0], normal: [0, -1, 0], sweepRadians: Math.PI / 2 },
    };
    const obstacleSegments: RouteSegment[] = [
      { id: "elbow-before", type: "conduit-segment", system: "receptacle", diameterMm: 20, start: { position: [.5, .05, 0], attachment }, end: { position: [.3, .05, 0], attachment }, createdAt: "" },
      { id: "elbow-after", type: "conduit-segment", system: "receptacle", diameterMm: 20, start: { position: [0, .05, .3], attachment }, end: { position: [0, .05, .5], attachment }, createdAt: "" },
    ];
    const overlay = { ...createEmptyOverlay("a.json", "sha"), segments: obstacleSegments, fittings: [elbow] };
    const routePoint = (z: number) => ({ position: [.2, .05, z] as [number, number, number], attachment });
    const proposed = planRoute("network", 20, "surface", [routePoint(-.5), routePoint(.5)]);
    const slabContext = { levelId, slabs: [{ id: slabId, parentId: levelId, type: "slab", elevation: .05, polygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]], holes: [] }] };
    const checked = withCollisionDiagnostics(overlay, proposed, undefined, undefined, undefined, slabContext);

    expect(checked.canCommit).toBe(true);
    expect(checked.fittings.find(fitting => fitting.fitting === "bridge-bend")?.bridge).toMatchObject({ obstacleSegmentId: "elbow-before", obstacleSegmentIds: [], obstacleFittingIds: [elbow.id], riseMm: 30, clearanceMm: 10 });
  });

  it("does not infer a slab host for routes outside, through holes, on another level, or with ambiguous slabs", () => {
    const levelId = "level-1", slabId = "slab-1";
    const obstacle: RouteSegment = { id: "red", type: "conduit-segment", system: "receptacle", diameterMm: 20, start: { position: [-.8, .05, 0] }, end: { position: [.8, .05, 0] }, createdAt: "" };
    const overlay = { ...createEmptyOverlay("a.json", "sha"), segments: [obstacle] };
    const route = planRoute("network", 20, "surface", [point(0, .05, -1), point(0, .05, 1)]);
    const slab = { id: slabId, parentId: levelId, type: "slab", elevation: .05, polygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]], holes: [] as unknown[] };
    const context = (slabs: typeof slab[], activeLevel = levelId) => ({ levelId: activeLevel, slabs });

    for (const invalidContext of [
      context([{ ...slab, polygon: [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]] }]),
      context([{ ...slab, holes: [[[-.1, -.1], [.1, -.1], [.1, .1], [-.1, .1]]] }]),
      context([{ ...slab, parentId: "other-level" }]),
      context([slab, { ...slab, id: "slab-2" }]),
    ]) {
      const checked = withCollisionDiagnostics(overlay, route, undefined, undefined, undefined, invalidContext);
      expect(checked.fittings.some(fitting => fitting.fitting === "bridge-bend")).toBe(false);
      expect(checked.canCommit).toBe(false);
    }
  });

  it("uses one wider bridge over overlapping crossings and raises it for the widest conduit", () => {
    let base = commitPlannedRoute(createEmptyOverlay("a.json", "sha"), planRoute("receptacle", 20, "surface", [point(-1, 0, -.05, "floor-a"), point(1, 0, -.05, "floor-a")]));
    base = commitPlannedRoute(base, planRoute("network", 50, "surface", [point(-1, 0, .05, "floor-a"), point(1, 0, .05, "floor-a")]));
    const preview = withCollisionDiagnostics(base, planRoute("lighting", 20, "surface", [point(0, 0, -1, "floor-a"), point(0, 0, 1, "floor-a")]));
    const bridges = preview.fittings.filter((fitting) => fitting.fitting === "bridge-bend");
    expect(preview.canCommit).toBe(true);
    expect(bridges).toHaveLength(1);
    expect(bridges[0]?.bridge?.obstacleSegmentIds).toEqual(base.segments.map(segment => segment.id));
    expect(bridges[0]?.bridge?.riseMm).toBeCloseTo(45, 8);
    expect(bridges[0]?.bridge?.crestStart[2]).toBeCloseTo(-.07);
    expect(bridges[0]?.bridge?.crestEnd[2]).toBeCloseTo(.085);
  });

  it("keeps separated crossing groups as separate bridges", () => {
    let base = commitPlannedRoute(createEmptyOverlay("a.json", "sha"), planRoute("receptacle", 20, "surface", [point(-1, 0, -.3, "floor-a"), point(1, 0, -.3, "floor-a")]));
    base = commitPlannedRoute(base, planRoute("network", 20, "surface", [point(-1, 0, .3, "floor-a"), point(1, 0, .3, "floor-a")]));
    const preview = withCollisionDiagnostics(base, planRoute("lighting", 20, "surface", [point(0, 0, -1, "floor-a"), point(0, 0, 1, "floor-a")]));
    expect(preview.canCommit).toBe(true);
    expect(preview.fittings.filter((fitting) => fitting.fitting === "bridge-bend")).toHaveLength(2);
  });

  it("raises every red, blue and white cross-system floor combination", () => {
    for (const existingSystem of ["receptacle", "lighting", "network"] as const) for (const newSystem of ["receptacle", "lighting", "network"] as const) {
      if (existingSystem === newSystem) continue;
      const base = commitPlannedRoute(createEmptyOverlay("a.json", "sha"), planRoute(existingSystem, 20, "surface", [point(-1, 0, 0, "floor-a"), point(1, 0, 0, "floor-a")]));
      const preview = withCollisionDiagnostics(base, planRoute(newSystem, 20, "surface", [point(0, 0, -1, "floor-a"), point(0, 0, 1, "floor-a")]));
      expect(preview.canCommit, `${existingSystem} -> ${newSystem}`).toBe(true);
      expect(preview.fittings.some((fitting) => fitting.fitting === "bridge-bend")).toBe(true);
    }
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
