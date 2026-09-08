import { describe, expect, it } from "vitest";
import { assessOverlayHosts, createEmptyOverlay, parseOverlay, SYSTEM_DEFAULTS } from "./overlay";
import { branchAtSegment, commitBranchRoute, commitPlannedRoute, deleteNetworkObject, planBranchContinuation, planRoute, resetRoutingIdsForTests, type PenetrationRequest } from "./routing";
import { withCollisionDiagnostics } from "./routing-collision";

const point = (x: number, y: number, z: number, hostId = "wall-a") => ({ position: [x, y, z] as [number, number, number], attachment: { hostId, hostKind: "wall" as const, surface: "interior", normal: [0, 0, 1] as [number, number, number], levelId: "L0" } });
const floorPoint = (x: number, y: number, z: number, hostId = "slab-a") => ({ position: [x, y, z] as [number, number, number], attachment: { hostId, hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId: "L0" } });
const rawDevice = (id: string, deviceType: "switch" | "luminaire") => ({ id, type: "network-device", deviceType, name: id, position: point(0, 1, 0), sizeMm: [86, 86, 50], orientation: [0, 0, 1], systems: ["lighting"], ports: [], createdAt: "now" });

describe("Conduit overlay", () => {
  it("round-trips an empty overlay", () => {
    const overlay = createEmptyOverlay("default-layout.json", "abc");
    expect(parseOverlay(JSON.parse(JSON.stringify(overlay)))).toEqual(overlay);
  });

  it("loads older overlays with no lighting control groups", () => {
    const raw = JSON.parse(JSON.stringify(createEmptyOverlay("default-layout.json", "abc")));
    raw.schemaVersion = "2.1";
    delete raw.lightingControlGroups;
    expect(parseOverlay(raw)).toMatchObject({ schemaVersion: "2.2", lightingControlGroups: [] });
  });

  it("rejects imported lighting groups that violate membership invariants", () => {
    const valid = JSON.parse(JSON.stringify(createEmptyOverlay("controls.json", "abc")));
    valid.devices = [rawDevice("switch", "switch"), rawDevice("lamp-a", "luminaire"), rawDevice("lamp-b", "luminaire")];
    const group = { id: "group-a", switchDeviceId: "switch", luminaireDeviceIds: ["lamp-a"], createdAt: "now" };
    valid.lightingControlGroups = [group];
    expect(parseOverlay(valid).lightingControlGroups).toEqual([group]);

    const invalidGroups = [
      [{ ...group, luminaireDeviceIds: [] }],
      [{ ...group, switchDeviceId: "lamp-a" }],
      [{ ...group, luminaireDeviceIds: ["missing"] }],
      [{ ...group, luminaireDeviceIds: ["lamp-a", "lamp-a"] }],
      [group, { ...group, id: "group-b", luminaireDeviceIds: ["lamp-a", "lamp-b"] }],
      [group, { ...group, luminaireDeviceIds: ["lamp-b"] }],
    ];
    for (const lightingControlGroups of invalidGroups) expect(() => parseOverlay({ ...valid, lightingControlGroups })).toThrow();
  });

  it("preserves local host anchors while accepting older overlay documents", () => {
    const overlay = createEmptyOverlay("default-layout.json", "abc");
    const anchored = { ...overlay, segments: [{ id: "pipe", type: "conduit-segment" as const, system: "receptacle" as const, diameterMm: 20, start: { position: [0, 1, 0] as [number, number, number], attachment: { ...point(0, 1, 0).attachment!, localPosition: [0.5, 1, 0], basis: { u: [1, 0, 0] as [number, number, number], v: [0, 1, 0] as [number, number, number] }, curveT: .25, wallSide: "interior" as const } }, end: point(1, 1, 0), createdAt: "now" }] };
    expect(parseOverlay(JSON.parse(JSON.stringify(anchored))).segments[0].start.attachment?.curveT).toBe(.25);
    const legacy = JSON.parse(JSON.stringify(overlay)); delete legacy.settings.visibleSystems;
    expect(parseOverlay(legacy).settings.visibleSystems.receptacle).toBe(true);
    legacy.schemaVersion = "1.0"; delete legacy.settings.bendRadiusMm; delete legacy.settings.stockLengthMm; delete legacy.settings.junctionBoxSizeMm; delete legacy.junctionBoxes;
    delete legacy.surfaceChases; legacy.wallChases = [{ id: "legacy-chase", type: "wall-chase", wallId: "wall-a", segmentId: "pipe", start: point(0, 1, 0), end: point(1, 1, 0), widthMm: 30, depthMm: 25 }];
    legacy.penetrations = [{ id: "legacy-hole", type: "penetration", hostId: "wall-a", hostKind: "wall", segmentId: "pipe", point: point(.5, 1, 0), diameterMm: 30 }];
    const migratedLegacy = parseOverlay(legacy);
    expect(migratedLegacy).toMatchObject({ schemaVersion: "2.2", junctionBoxes: [], devices: [], lightingControlGroups: [], settings: { bendRadiusMm: 200, stockLengthMm: 4000, junctionBoxSizeMm: [86, 86, 50] } });
    expect(migratedLegacy.surfaceChases[0]).toMatchObject({ type: "surface-chase", hostId: "wall-a", hostKind: "wall", path: { kind: "line" } });
    expect(migratedLegacy.penetrations[0]).toMatchObject({ entry: { position: [.5, 1, 0] }, exit: { position: [.5, 1, 0] }, direction: [0, 0, 1], derived: true });
    expect(parseOverlay(JSON.parse(JSON.stringify(migratedLegacy)))).toEqual(migratedLegacy);
  });

  it("uses the documented four system defaults", () => {
    expect(SYSTEM_DEFAULTS.receptacle).toMatchObject({ color: "#ef4444", diameterMm: 20 });
    expect(SYSTEM_DEFAULTS["lighting"]).toMatchObject({ color: "#3b82f6", diameterMm: 20 });
    expect(SYSTEM_DEFAULTS.network).toMatchObject({ color: "#ffffff", diameterMm: 20 });
    expect(SYSTEM_DEFAULTS.sprinkler).toMatchObject({ color: "#22c55e", diameterMm: 50 });
  });

  it("migrates 1.2 system names and marks their routes as unrooted", () => {
    const raw = JSON.parse(JSON.stringify(createEmptyOverlay("legacy.json", "sha")));
    raw.schemaVersion = "1.2";
    raw.settings.colors = { power: "#ef4444", "low-voltage": "#3b82f6", signal: "#ffffff", sprinkler: "#22c55e" };
    raw.settings.visibleSystems = { power: true, "low-voltage": true, signal: true, sprinkler: true };
    raw.segments = [
      { id: "red", type: "conduit-segment", system: "power", diameterMm: 20, start: point(0, 1, 0), end: point(1, 1, 0), createdAt: "old" },
      { id: "blue", type: "conduit-segment", system: "low-voltage", diameterMm: 20, start: point(0, 1, 1), end: point(1, 1, 1), createdAt: "old" },
      { id: "white", type: "conduit-segment", system: "signal", diameterMm: 20, start: point(0, 1, 2), end: point(1, 1, 2), createdAt: "old" },
    ];
    const migrated = parseOverlay(raw);
    expect(migrated.segments.map((segment) => segment.system)).toEqual(["receptacle", "lighting", "network"]);
    expect(migrated.segments.every((segment) => segment.legacyUnrooted)).toBe(true);
    expect(migrated.circuits.map((circuit) => circuit.status)).toEqual(["legacy-unrooted", "legacy-unrooted", "legacy-unrooted"]);
  });

  it("migrates pre-2.1 86 box centre ports to edge holes without changing connection IDs", () => {
    const raw = JSON.parse(JSON.stringify(createEmptyOverlay("legacy.json", "sha")));
    raw.schemaVersion = "2.0";
    raw.devices = [{
      id: "socket-old", type: "network-device", deviceType: "socket", name: "旧插座", position: point(0, 1, 0), sizeMm: [86, 86, 50], orientation: [0, 0, 1], systems: ["receptacle"],
      ports: [{ id: "socket-old:port:0", position: point(0, 1, 0), direction: [0, 1, 0], role: "bidirectional", system: "receptacle", connectedSegmentIds: ["line"] }], createdAt: "old",
    }];
    const migrated = parseOverlay(raw), device = migrated.devices[0];
    expect(device.ports).toHaveLength(8);
    const retained = device.ports.find((port) => port.id === "socket-old:port:0");
    expect(retained).toMatchObject({ connectedSegmentIds: ["line"], face: "top", slot: 0 });
    expect(retained?.position.position[1]).toBeCloseTo(1.043);
    expect(device.ports.every((port) => port.face && port.slot !== undefined)).toBe(true);
  });

  it("migrates an older three-port branch box to the interactive eight-hole model", () => {
    const raw = JSON.parse(JSON.stringify(createEmptyOverlay("legacy.json", "sha")));
    raw.schemaVersion = "2.0";
    raw.junctionBoxes = [{ id: "box-old", type: "junction-box", system: "receptacle", position: point(0, 1, 0), sizeMm: [86, 86, 50], segmentIds: ["line"], ports: [{ id: "box-old:port:0", position: point(0, 1, 0), direction: [0, 1, 0], role: "branch", system: "receptacle", connectedSegmentIds: ["line"], segmentId: "line" }] }];
    const box = parseOverlay(raw).junctionBoxes[0];
    expect(box.ports).toHaveLength(8);
    expect(box.ports.find((port) => port.id === "box-old:port:0")).toMatchObject({ connectedSegmentIds: ["line"], face: "top" });
    expect(box.frame).toBeDefined();
  });

  it("makes explicit segments, sweep and straight-plus-arc wall chases", () => {
    resetRoutingIdsForTests();
    const source = [point(0, 1, 0), point(1, 1, 0), point(1, 1, 1)], before = JSON.stringify(source);
    const plan = planRoute("receptacle", 20, "surface", source);
    expect(plan.segments).toHaveLength(2);
    expect(plan.fittings).toMatchObject([{ fitting: "elbow", system: "receptacle" }]);
    expect(plan.surfaceChases).toHaveLength(3);
    expect(plan.surfaceChases.map((chase) => chase.path.kind)).toEqual(["line", "line", "arc"]);
    expect(plan.penetrations).toHaveLength(0);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("does not cut sprinkler wall chases and can mark penetrations", () => {
    resetRoutingIdsForTests();
    const plan = planRoute("sprinkler", 50, "penetrate", [point(0, 2, 0), point(0, 2, 1, "slab-a")]);
    expect(plan.surfaceChases).toHaveLength(0);
    expect(plan.penetrations).toHaveLength(2);
    expect(plan.penetrations[0].diameterMm).toBe(60);
  });

  it("uses explicitly confirmed demo construction parameters", () => {
    const electrical = planRoute("receptacle", 20, "surface", [point(0, 1, 0), point(1, 1, 0)], { chaseWidthMm: 44, chaseDepthMm: 31, penetrationDiameterMm: 52 });
    expect(electrical.surfaceChases[0]).toMatchObject({ widthMm: 44, depthMm: 31 });
    const through = planRoute("sprinkler", 50, "penetrate", [point(0, 2, 0), point(0, 2, 1, "slab-a")], { chaseWidthMm: 44, chaseDepthMm: 31, penetrationDiameterMm: 52 });
    expect(through.penetrations.every((feature) => feature.diameterMm === 52)).toBe(true);
  });

  it("can add a one-shot penetration to an otherwise surface route", () => {
    const a = point(0, 1, 0), b = point(1, 1, 0), c = point(2, 1, 0), request: PenetrationRequest = { host: b.attachment!, entry: b, exit: c, direction: [1, 0, 0] };
    const plan = planRoute("receptacle", 20, "surface", [a, b, c], { chaseWidthMm: 30, chaseDepthMm: 25, penetrationDiameterMm: 34 }, [request]);
    expect(plan.penetrations).toHaveLength(1);
    expect(plan.penetrations[0]).toMatchObject({ hostId: "wall-a", diameterMm: 34 });
  });

  it("splits an electrical segment at an 86 junction box", () => {
    resetRoutingIdsForTests();
    const base = createEmptyOverlay("default-layout.json", "abc");
    const routed = commitPlannedRoute(base, planRoute("receptacle", 20, "surface", [point(0, 1, 0), point(2, 1, 0)]));
    const branched = branchAtSegment(routed, routed.segments[0].id, point(1, 1, 0), point(1, 1, 1));
    expect(branched.segments).toHaveLength(3);
    expect(branched.junctionBoxes).toMatchObject([{ type: "junction-box", sizeMm: [86, 86, 50], segmentIds: expect.any(Array), ports: expect.arrayContaining([expect.objectContaining({ segmentId: expect.any(String) })]) }]);
    expect(branched.fittings).toHaveLength(0);
    expect(branched.segments.every((segment) => !segment.start.position.every((value, axis) => value === point(1, 1, 0).position[axis]) && !segment.end.position.every((value, axis) => value === point(1, 1, 0).position[axis]))).toBe(true);
  });

  it("uses the same physical box port for branch preview and commit", () => {
    const base = createEmptyOverlay("default-layout.json", "abc"), routed = commitPlannedRoute(base, planRoute("receptacle", 20, "surface", [point(0, 1, 0), point(2, 1, 0)]));
    const branchPoints = [point(1, 1, 0), point(1, 1, 1)], preview = planBranchContinuation(routed, routed.segments[0].id, branchPoints, { chaseWidthMm: 30, chaseDepthMm: 25, penetrationDiameterMm: 30 })!;
    const committed = commitBranchRoute(routed, routed.segments[0].id, branchPoints, { chaseWidthMm: 30, chaseDepthMm: 25, penetrationDiameterMm: 30 }), box = committed.junctionBoxes[0], branchPort = box.ports.find((port) => port.connectedSegmentIds.length && port.position.position.every((value, axis) => Math.abs(value - preview.segments[0].start.position[axis]) < 1e-7))!, branch = committed.segments.find((segment) => segment.startPortId === branchPort.id)!;
    expect(preview.segments[0].start.position).toEqual(branchPort.position.position);
    expect(branch.start.position).toEqual(preview.segments[0].start.position);
    expect(branch.start.position).toEqual(branchPort.position.position);
  });

  it("uses the same unified sweep rule while continuing an electrical branch", () => {
    const base = createEmptyOverlay("default-layout.json", "abc"), routed = commitPlannedRoute(base, planRoute("receptacle", 20, "surface", [point(0, 1, 0), point(2, 1, 0)]));
    const plan = planBranchContinuation(routed, routed.segments[0].id, [point(1, 1, 0), point(1, 2, 0), point(2, 2, 0)], { chaseWidthMm: 30, chaseDepthMm: 25, penetrationDiameterMm: 30 })!;
    expect(plan.canCommit).toBe(true);
    expect(plan.fittings.find((fitting) => fitting.fitting === "elbow")).toMatchObject({ bendStyle: "sweep", radiusMm: 200, arc: expect.any(Object) });
  });

  it("splits a sprinkler segment at a physical tee", () => {
    resetRoutingIdsForTests();
    const base = createEmptyOverlay("default-layout.json", "abc"), routed = commitPlannedRoute(base, planRoute("sprinkler", 50, "suspended", [point(0, 2, 0), point(2, 2, 0)]));
    const branched = commitBranchRoute(routed, routed.segments[0].id, [point(1, 2, 0), point(1, 2, 1)], { chaseWidthMm: 60, chaseDepthMm: 55, penetrationDiameterMm: 60 });
    expect(branched.junctionBoxes).toHaveLength(0);
    expect(branched.fittings).toEqual(expect.arrayContaining([expect.objectContaining({ fitting: "tee", ports: expect.any(Array) })]));
  });

  it("deletes a junction box or tee with all connected dependencies atomically", () => {
    const base = createEmptyOverlay("default-layout.json", "abc"), electrical = commitPlannedRoute(base, planRoute("receptacle", 20, "surface", [point(0, 1, 0), point(2, 1, 0)])), branched = branchAtSegment(electrical, electrical.segments[0].id, point(1, 1, 0), point(1, 1, 1));
    const removedBox = deleteNetworkObject(branched, branched.junctionBoxes[0].id);
    expect(removedBox.segments).toHaveLength(0);
    expect(removedBox.junctionBoxes).toHaveLength(0);
    expect(removedBox.surfaceChases).toHaveLength(0);
    const sprinkler = commitPlannedRoute(base, planRoute("sprinkler", 50, "suspended", [point(0, 2, 0), point(2, 2, 0)])), sprinklerBranch = branchAtSegment(sprinkler, sprinkler.segments[0].id, point(1, 2, 0), point(1, 2, 1)), tee = sprinklerBranch.fittings.find((fitting) => fitting.fitting === "tee")!;
    expect(deleteNetworkObject(sprinklerBranch, tee.id).segments).toHaveLength(0);
  });

  it("creates a 200 mm tangent sweep on one electrical host", () => {
    const plan = planRoute("receptacle", 20, "surface", [point(0, 1, 0), point(1, 1, 0), point(1, 1, 1)]);
    expect(plan.canCommit).toBe(true);
    expect(plan.fittings).toEqual(expect.arrayContaining([expect.objectContaining({ fitting: "elbow", bendStyle: "sweep", radiusMm: 200, arc: expect.any(Object) })]));
    expect(plan.segments[0].end.position[0]).toBeCloseTo(.8);
    expect(plan.segments[1].start.position[2]).toBeCloseTo(.2);
  });

  it("rejects a sweep when either tangent is shorter than its clearance", () => {
    const plan = planRoute("receptacle", 20, "surface", [point(0, 1, 0), point(.1, 1, 0), point(.1, 1, .1)]);
    expect(plan.canCommit).toBe(false);
    expect(plan.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "bend_clearance" })]));
  });

  it("uses sweep electrical bends across hosts and standard sprinkler bends", () => {
    const electrical = planRoute("receptacle", 20, "surface", [point(0, 1, 0, "wall-a"), point(1, 1, 0, "wall-a"), point(1, 1, 1, "slab-a")]);
    expect(electrical.fittings[0]).toMatchObject({ bendStyle: "sweep", radiusMm: 200, arc: expect.any(Object) });
    const sprinkler = planRoute("sprinkler", 50, "suspended", [point(0, 2, 0), point(1, 2, 0), point(1, 2, 1)]);
    expect(sprinkler.fittings[0]).toMatchObject({ bendStyle: "standard" });
  });

  it("uses a 200 mm sweep for every electrical system across the complete host matrix", () => {
    const wallB = (x: number, y: number, z: number) => ({ ...point(x, y, z, "wall-b"), attachment: { ...point(x, y, z, "wall-b").attachment!, normal: [1, 0, 0] as [number, number, number] } });
    const cases = [
      [floorPoint(0, 0, 0), floorPoint(1, 0, 0), floorPoint(1, 0, 1)],
      [floorPoint(0, 0, 0), point(1, 0, 0), point(1, 1, 0)],
      [point(0, 1, 0), floorPoint(1, 1, 0), floorPoint(1, 1, 1)],
      [point(0, 1, 0), wallB(1, 1, 0), wallB(1, 2, 0)],
      [point(0, 1, 0), point(1, 1, 0), wallB(1, 2, 0), floorPoint(2, 2, 0)],
      [{ ...point(0, 1, 0), attachment: { ...point(0, 1, 0).attachment!, curveT: .1 } }, { ...point(1, 1, 0), attachment: { ...point(1, 1, 0).attachment!, curveT: .4 } }, { ...point(1, 2, 0), attachment: { ...point(1, 2, 0).attachment!, curveT: .7 } }],
    ];
    for (const system of ["receptacle", "lighting", "network"] as const) for (const route of cases) {
      const plan = planRoute(system, 20, "surface", route);
      expect(plan.canCommit, `${system}: ${route.map((item) => item.attachment?.hostId).join(" -> ")}`).toBe(true);
      expect(plan.fittings.filter((fitting) => fitting.fitting === "elbow").every((fitting) => fitting.bendStyle === "sweep" && fitting.radiusMm === 200 && Boolean(fitting.arc))).toBe(true);
    }
  });

  it("does not add an elbow to a collinear Tab penetration and sweeps its surrounding turns", () => {
    const route = [floorPoint(0, 0, 0), floorPoint(1, 0, 0), point(2, 0, 0), point(3, 0, 0), point(3, 1, 0)];
    const request: PenetrationRequest = { host: route[1].attachment!, entry: route[1], exit: route[2], direction: [1, 0, 0] };
    const plan = planRoute("receptacle", 20, "surface", route, undefined, [request]);
    expect(plan.fittings.filter((fitting) => fitting.fitting === "elbow")).toHaveLength(1);
    expect(plan.fittings.find((fitting) => fitting.fitting === "elbow")).toMatchObject({ bendStyle: "sweep", radiusMm: 200 });
    expect(plan.penetrations).toMatchObject([{ hostId: "slab-a", entry: { position: [1, 0, 0] }, exit: { position: [2, 0, 0] }, direction: [1, 0, 0] }]);
  });

  it("creates shallow line and arc chase records on every affected wall and slab, never ceilings", () => {
    const route = [floorPoint(0, 0, 0, "floor"), floorPoint(1, 0, 0, "floor"), point(1, 1, 0, "wall"), { ...point(1, 1, 1, "ceiling"), attachment: { ...point(1, 1, 1, "ceiling").attachment!, hostKind: "ceiling" as const } }];
    const plan = planRoute("receptacle", 20, "surface", route, { chaseWidthMm: 30, chaseDepthMm: 25, penetrationDiameterMm: 30 });
    expect(new Set(plan.surfaceChases.map((chase) => chase.hostId))).toEqual(new Set(["floor", "wall"]));
    expect(plan.surfaceChases.some((chase) => chase.hostKind === "slab" && chase.path.kind === "line")).toBe(true);
    expect(plan.surfaceChases.some((chase) => chase.hostKind === "wall" && chase.path.kind === "arc")).toBe(true);
    expect(plan.surfaceChases.every((chase) => chase.widthMm === 30 && chase.depthMm === 25 && chase.hostKind !== ("ceiling" as never))).toBe(true);
  });

  it("keeps an old-host sweep until the actual host-transition corner", () => {
    const floor = (x: number, z: number) => ({ position: [x, 0, z] as [number, number, number], attachment: { hostId: "floor", hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId: "L0" } });
    const wall = (x: number, y: number, z: number) => ({ position: [x, y, z] as [number, number, number], attachment: { hostId: "wall", hostKind: "wall" as const, surface: "interior", normal: [0, 0, 1] as [number, number, number], levelId: "L0" } });
    const plan = planRoute("receptacle", 20, "surface", [floor(0, 0), floor(1, 0), wall(1, 0, 1), wall(1, 1, 1)]);
    expect(plan.fittings.map((fitting) => fitting.bendStyle)).toEqual(["sweep", "sweep"]);
  });

  it("restores the first sweep after entering a new host plane", () => {
    const oldHost = { position: [0, 0, 0] as [number, number, number], attachment: { hostId: "floor", hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId: "L0" } };
    const wallCorner = { position: [0, 1, 0] as [number, number, number], attachment: { hostId: "wall", hostKind: "wall" as const, surface: "interior", normal: [0, 0, 1] as [number, number, number], levelId: "L0" } };
    const wallNext = { ...wallCorner, position: [1, 1, 0] as [number, number, number] };
    expect(planRoute("receptacle", 20, "surface", [oldHost, wallCorner, wallNext]).fittings[0]).toMatchObject({ bendStyle: "sweep", radiusMm: 200 });
  });

  it("splits all systems at four metres and inserts physical couplings", () => {
    for (const system of ["receptacle", "lighting", "network", "sprinkler"] as const) {
      const plan = planRoute(system, system === "sprinkler" ? 50 : 20, "suspended", [point(0, 1, 0), point(9, 1, 0)]);
      expect(plan.segments.map((segment) => Math.hypot(...segment.end.position.map((value, axis) => value - segment.start.position[axis])))).toEqual([4, 4, 1]);
      expect(plan.fittings.filter((fitting) => fitting.fitting === "coupling")).toHaveLength(2);
    }
  });

  it("accumulates stock length through a sweep and breaks early at the arc start", () => {
    const plan = planRoute("receptacle", 20, "surface", [point(0, 1, 0), point(3.9, 1, 0), point(3.9, 1, 2)]);
    const sweep = plan.fittings.find((fitting) => fitting.bendStyle === "sweep")!;
    const coupling = plan.fittings.find((fitting) => fitting.fitting === "coupling" && fitting.position.position.every((value, axis) => Math.abs(value - sweep.arc!.start[axis]) < 1e-6));
    expect(coupling).toBeDefined();
    expect(coupling?.ports[1].connectedPortId).toBe(sweep.ports[0].id);
  });

  it("blocks physical crossings but allows separated heights", () => {
    const base = commitPlannedRoute(createEmptyOverlay("default-layout.json", "abc"), planRoute("receptacle", 20, "surface", [point(-1, 1, 0), point(1, 1, 0)]));
    const crossing = withCollisionDiagnostics(base, planRoute("network", 20, "surface", [point(0, 1, -1, "slab-a"), point(0, 1, 1, "slab-a")]));
    expect(crossing.canCommit).toBe(false);
    expect(crossing.diagnostics[0]).toMatchObject({ code: "route_collision" });
    const above = withCollisionDiagnostics(base, planRoute("sprinkler", 50, "suspended", [point(0, 2, -1, "ceiling-a"), point(0, 2, 1, "ceiling-a")]));
    expect(above.canCommit).toBe(true);
  });

  it("keeps orphaned route coordinates while reporting missing hosts", () => {
    const overlay = commitPlannedRoute(createEmptyOverlay("source.json", "old"), planRoute("receptacle", 20, "surface", [point(0, 1, 0), point(2, 1, 0)]));
    expect(assessOverlayHosts(overlay, ["different-wall"])).toEqual({ referencedHostIds: ["wall-a"], missingHostIds: ["wall-a"] });
    expect(overlay.segments).toHaveLength(1);
  });

  it("plans 500 chase records analytically without invoking runtime CSG", () => {
    const slabPoint = (index: number) => ({ position: [index * .02, 0, 0] as [number, number, number], attachment: { hostId: "slab-a", hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId: "L0" } });
    const plan = planRoute("receptacle", 20, "surface", Array.from({ length: 501 }, (_, index) => slabPoint(index)));
    expect(plan.segments).toHaveLength(500);
    expect(plan.surfaceChases).toHaveLength(500);
    expect(plan.penetrations).toHaveLength(0);
  });

  it("creates 100 penetration pairs only at final route planning time", () => {
    const points = Array.from({ length: 101 }, (_, index) => ({ position: [index, 2, 0] as [number, number, number], attachment: { hostId: `host-${index}`, hostKind: "slab" as const, surface: "top", normal: [0, 1, 0] as [number, number, number], levelId: "L0" } }));
    const plan = planRoute("sprinkler", 50, "penetrate", points);
    expect(plan.penetrations).toHaveLength(200);
    expect(plan.segments).toHaveLength(100);
  });
});
