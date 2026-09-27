import { describe, expect, it } from "vitest";
import { createNetworkDevice, createReferencePlaneDevice, openRouteEndpoints, placeNetworkDevice, startRouteFromDevice, commitDeviceRoute } from "./devices";
import { createEmptyOverlay, type RoutePoint } from "./overlay";
import { planRoute } from "./routing";
import { describeDevicePosition, editDevicePosition, resizeDevicePoint, resizeSpotlight } from "./device-positioning";
import { buildPhysicalPositioningSurfaces } from "./physical-positioning-surfaces";

const quad = (objectId: string, objectKind: string, a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]) => [
  { objectId, objectKind, vertices: [a, b, c] as [[number, number, number], [number, number, number], [number, number, number]] },
  { objectId, objectKind, vertices: [a, c, d] as [[number, number, number], [number, number, number], [number, number, number]] },
];

const wallPoint = (x: number, y: number): RoutePoint => ({
  position: [x, y, 0],
  attachment: { hostId: "wall-a", hostKind: "wall", surface: "interior", normal: [0, 0, 1], levelId: "L0", localPosition: [x, y, 0], basis: { u: [1, 0, 0], v: [0, 1, 0] } },
});

describe("device point positioning transaction", () => {
  it("measures a wall box from its centre to the wall opening, same-height box, wall top and floor", () => {
    const wall = { id: "wall-a", type: "wall", parentId: "L0", start: [0, 0], end: [10, 0], height: 4.19, thickness: 0.12 };
    const door = { id: "door-a", type: "door", parentId: wall.id, wallId: wall.id, position: [1.5, 1.05, 0], width: 1, height: 2.1, depth: 0.08 };
    const slab = { id: "slab-a", type: "slab", parentId: "L0", elevation: 0.05, polygon: [[-1, -1], [11, -1], [11, 1], [-1, 1]] };
    const selectedPoint = wallPoint(3, .493), neighborPoint = wallPoint(4.4, .493);
    const deviceAt = (id: string, point: RoutePoint) => ({ ...createNetworkDevice("socket", point), id, position: { ...point, position: [point.position[0], point.position[1], .06] as [number, number, number] } });
    const selected = deviceAt("selected", selectedPoint), neighbor = deviceAt("neighbor", neighborPoint);
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [selected, neighbor] };
    const physicalSurfaces = buildPhysicalPositioningSurfaces({ L0: { id: "L0", type: "level", level: 0 }, [wall.id]: wall, [door.id]: door, [slab.id]: slab });
    const decoyAboveBox = quad("nearby-item", "item", [2.5, .9, -.2], [3.5, .9, -.2], [3.5, .9, .2], [2.5, .9, .2]);
    physicalSurfaces.push(...decoyAboveBox);

    const description = describeDevicePosition(overlay, selected.id, { levelFloorY: { L0: 0 }, wallSpans: {}, physicalSurfaces });

    expect(description.planar?.map(({ key, millimeters, witness }) => [key, millimeters, witness?.objectId])).toEqual([
      ["u+", 1400, "neighbor"], ["u-", 1000, "wall-a"], ["v+", 3697, "wall-a"], ["v-", 443, "slab-a"],
    ]);
    expect(description.planar?.find(reference => reference.key === "u+")?.witness?.point).toEqual([4.4, .493, .06]);
  });

  it("uses true straight-wall coordinates and does not turn opening grid seams into hits", () => {
    const wall = { id: "wall-a", type: "wall", parentId: "L0", start: [0, 0], end: [4, 0], height: 2.7, thickness: 0.12 };
    const opening = { id: "window-a", type: "window", parentId: wall.id, position: [2, 1.5, 0], width: 1, height: 1.5, depth: 0.08 };
    const device = { ...createNetworkDevice("socket", wallPoint(0.5, 2.4)), position: { position: [0.5, 2.4, 0.06] as [number, number, number], attachment: wallPoint(0.5, 2.4).attachment } };
    const physicalSurfaces = buildPhysicalPositioningSurfaces({ L0: { id: "L0", type: "level", level: 0 }, [wall.id]: wall, [opening.id]: opening });
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [device] };

    const description = describeDevicePosition(overlay, device.id, { levelFloorY: { L0: 0 }, wallSpans: {}, physicalSurfaces });

    expect(description.planar?.find(reference => reference.key === "u+")).toMatchObject({ millimeters: 3500, witness: { objectId: wall.id, point: [4, 2.4, 0.06] } });
  });
  it("does not treat an unrendered column node as a physical dimension target", () => {
    const device = createReferencePlaneDevice("luminaire", [0, 2, 0], "L0", 2000);
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [device] };
    const physicalSurfaces = buildPhysicalPositioningSurfaces({
      L0: { id: "L0", type: "level", level: 0 },
      column: { id: "column", type: "column", parentId: "L0", position: [1, 0, 0], width: 0.4, height: 3, depth: 0.4 },
    });

    expect(physicalSurfaces.some(surface => surface.objectId === "column")).toBe(false);
    expect(describeDevicePosition(overlay, device.id, { levelFloorY: { L0: 0 }, wallSpans: {}, physicalSurfaces })).toMatchObject({ planar: [] });
    expect(describeDevicePosition(overlay, device.id, { levelFloorY: { L0: 0 }, wallSpans: {}, physicalSurfaces }).vertical).toBeUndefined();
  });
  it("measures four local mounting-plane rays to the first finite physical surface", () => {
    const device = {
      ...createNetworkDevice("socket", wallPoint(0, 2)),
      position: {
        position: [0, 2, 0] as [number, number, number],
        attachment: { ...wallPoint(0, 2).attachment!, hostKind: "beam" as const, basis: { u: [1, 0, 0] as [number, number, number], v: [0, 1, 0] as [number, number, number] } },
      },
    };
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [device] };
    const physicalSurfaces = [
      ...quad("near-east", "wall", [1, 0, -1], [1, 0, 1], [1, 4, 1], [1, 4, -1]),
      ...quad("far-east", "wall", [3, 0, -1], [3, 0, 1], [3, 4, 1], [3, 4, -1]),
      ...quad("west", "column", [-2, 0, -1], [-2, 0, 1], [-2, 4, 1], [-2, 4, -1]),
      ...quad("up", "beam", [-1, 4, -1], [1, 4, -1], [1, 4, 1], [-1, 4, 1]),
      ...quad("down", "slab", [-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]),
      // A closer surface outside the ray's finite vertical span must not win.
      ...quad("misses-ray", "wall", [0.5, 3, -1], [0.5, 3, 1], [0.5, 4, 1], [0.5, 4, -1]),
    ];

    const description = describeDevicePosition(overlay, device.id, { levelFloorY: { L0: 0 }, wallSpans: {}, physicalSurfaces });

    expect(description.planar?.map(({ key, millimeters, witness }) => [key, millimeters, witness?.objectId])).toEqual([
      ["u+", 1000, "near-east"], ["u-", 2000, "west"], ["v+", 2000, "up"], ["v-", 2000, "down"],
    ]);
    expect(description.planar?.[0]?.witness?.point).toEqual([1, 2, 0]);
  });

  it("measures slab-mounted points center to center and lets a nearer physical surface win", () => {
    const slabPoint = (id: string, position: [number, number, number]) => {
      const base = createNetworkDevice("socket", { position, attachment: { hostId: "slab-a", hostKind: "slab", surface: "top", normal: [0, 1, 0], levelId: "L0", basis: { u: [1, 0, 0], v: [0, 0, 1] } } });
      return { ...base, id };
    };
    const selected = slabPoint("floor-a", [0, .05, 0]), peer = slabPoint("floor-b", [.026, .05, .55]);
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [selected, peer] };
    const context = { levelFloorY: { L0: 0 }, wallSpans: {}, physicalSurfaces: [] as ReturnType<typeof buildPhysicalPositioningSurfaces> };

    const unobstructed = describeDevicePosition(overlay, selected.id, context).planar?.find(reference => reference.key === "v+");
    expect(unobstructed).toMatchObject({ millimeters: 551, witness: { objectId: peer.id, objectKind: "device", point: peer.position.position } });

    const nearerWall = quad("near-wall", "wall", [-1, 0, .25], [1, 0, .25], [1, 2, .25], [-1, 2, .25]);
    const obstructed = describeDevicePosition(overlay, selected.id, { ...context, physicalSurfaces: nearerWall }).planar?.find(reference => reference.key === "v+");
    expect(obstructed).toMatchObject({ millimeters: 250, witness: { objectId: "near-wall", objectKind: "wall", point: [0, .05, .25] } });
  });

  it("ignores furniture as a dimension target even when furniture surfaces are present", () => {
    const selected = createNetworkDevice("socket", { position: [0, .05, 0], attachment: { hostId: "slab-a", hostKind: "slab", surface: "top", normal: [0, 1, 0], levelId: "L0", basis: { u: [1, 0, 0], v: [0, 0, 1] } } });
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [selected] };
    const wall = quad("real-wall", "wall", [1.2, 0, -1], [1.2, 0, 1], [1.2, 2, 1], [1.2, 2, -1]);
    const furniture = quad("hidden-item", "item", [.3, 0, -1], [.3, 0, 1], [.3, 2, 1], [.3, 2, -1]);
    const context = { levelFloorY: { L0: 0 }, wallSpans: {}, physicalSurfaces: [...furniture, ...wall] };

    expect(describeDevicePosition(overlay, selected.id, context).planar?.find(reference => reference.key === "u+")).toMatchObject({ millimeters: 1200, witness: { objectId: "real-wall" } });
    expect(describeDevicePosition(overlay, selected.id, { ...context, physicalSurfaces: wall }).planar?.find(reference => reference.key === "u+")).toMatchObject({ millimeters: 1200, witness: { objectId: "real-wall" } });
  });

  it("ignores furniture below a suspended point when finding its downward witness", () => {
    const device = createReferencePlaneDevice("luminaire", [0, 2, 0], "L0", 2000);
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [device] };
    const furniture = quad("table", "item", [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]);
    const slab = quad("floor", "slab", [-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]);

    expect(describeDevicePosition(overlay, device.id, { levelFloorY: { L0: 0 }, wallSpans: {}, physicalSurfaces: [...furniture, ...slab] }).vertical).toMatchObject({ millimeters: 2000, witness: { objectId: "floor" } });
  });

  it("measures an unhosted point's fifth direction down to the first physical surface", () => {
    const device = createReferencePlaneDevice("luminaire", [0, 2, 0], "L0", 2000);
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [device] };
    const physicalSurfaces = [
      ...quad("floor", "slab", [-2, 0, -2], [2, 0, -2], [2, 0, 2], [-2, 0, 2]),
      ...quad("near-floor", "beam", [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]),
    ];

    const description = describeDevicePosition(overlay, device.id, { levelFloorY: { L0: 0 }, wallSpans: {}, physicalSurfaces });

    expect(description.vertical).toMatchObject({ millimeters: 1000, witness: { objectId: "near-floor", point: [0, 1, 0] } });
  });

  it("moves a hosted point along only the edited local ray and reports no dimension without a hit", () => {
    const base = wallPoint(0, 2);
    const device = { ...createNetworkDevice("socket", base), position: { ...base, position: [0, 2, 0] as [number, number, number], attachment: { ...base.attachment!, hostKind: "beam" as const } } };
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [device] };
    const physicalSurfaces = [
      ...quad("east", "wall", [1, 0, -1], [1, 0, 1], [1, 4, 1], [1, 4, -1]),
      ...quad("west", "column", [-2, 0, -1], [-2, 0, 1], [-2, 4, 1], [-2, 4, -1]),
      ...quad("up", "beam", [-1, 4, -1], [1, 4, -1], [1, 4, 1], [-1, 4, 1]),
      ...quad("down", "slab", [-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]),
    ];
    const context = { levelFloorY: { L0: 0 }, wallSpans: {}, physicalSurfaces };
    const moved = editDevicePosition(overlay, { deviceIds: [device.id], planarClearanceMm: { "u+": 500 } }, context, "preview");

    expect(moved.status).toBe("preview");
    expect(moved.overlay.devices[0]?.position.position).toEqual([0.5, 2, 0]);
    expect(describeDevicePosition(overlay, device.id, { levelFloorY: { L0: 0 }, wallSpans: {}, physicalSurfaces: [] }).planar).toEqual([]);
    expect(describeDevicePosition(overlay, device.id, { levelFloorY: { L0: 0 }, wallSpans: {}, physicalSurfaces: [] }).vertical).toBeUndefined();
  });

  it("describes wall-device bottom and nearest architectural boundary clearance", () => {
    const selected = createNetworkDevice("switch", wallPoint(2, 1.2));
    const neighbor = createNetworkDevice("socket", wallPoint(1, .3));
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [selected, neighbor] };

    expect(describeDevicePosition(overlay, selected.id, { levelFloorY: { L0: 0 }, wallSpans: { "wall-a": [0, 4] } })).toMatchObject({
      vertical: { millimeters: 1157, kind: "finished-floor" },
      horizontal: { millimeters: 1957, kind: "wall-end", referenceId: "wall-a:end", direction: 1 },
    });
  });

  it("previews without mutation and moves only the selected wall device on commit", () => {
    const selected = createNetworkDevice("switch", wallPoint(2, 1.2));
    const neighbor = createNetworkDevice("socket", wallPoint(1, .3));
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [selected, neighbor] };
    const context = { levelFloorY: { L0: 0 }, wallSpans: { "wall-a": [0, 4] as [number, number] } };
    const preview = editDevicePosition(overlay, { deviceIds: [selected.id], horizontalClearanceMm: 500 }, context, "preview");

    expect(preview.status).toBe("preview");
    expect(overlay.devices[0].position.position).toEqual([2, 1.2, 0]);
    expect(preview.overlay.devices[0].position.position[0]).toBeCloseTo(3.457);
    expect(preview.overlay.devices[1].position.position).toEqual(neighbor.position.position);

    const committed = editDevicePosition(overlay, { deviceIds: [selected.id], bottomHeightMm: 300 }, context, "commit");
    expect(committed.status).toBe("committed");
    expect(committed.overlay.devices[0].position.position[1]).toBeCloseTo(.343);
    expect(committed.overlay.devices[1]).toEqual(neighbor);
  });

  it("prefers the nearest opening edge over another device point", () => {
    const selected = createNetworkDevice("switch", wallPoint(2, 1.2));
    const neighbor = createNetworkDevice("socket", wallPoint(1.9, .3));
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [selected, neighbor] };
    const description = describeDevicePosition(overlay, selected.id, { levelFloorY: { L0: 0 }, wallSpans: { "wall-a": [0, 4] }, wallOpenings: { "wall-a": [{ id: "door-a", start: 2.5, end: 3.4 }] } });
    expect(description.horizontal).toEqual({ millimeters: 457, kind: "opening", referenceId: "door-a:start", direction: 1 });
  });

  it("moves a connected device and removes only its adjacent conduit as truthful open ends", () => {
    let overlay = placeNetworkDevice(createEmptyOverlay("a", "sha"), "strong-panel", wallPoint(0, 1));
    overlay = placeNetworkDevice(overlay, "socket", wallPoint(2, 1));
    const started = startRouteFromDevice(overlay, overlay.devices[0].id, "receptacle");
    overlay = commitDeviceRoute(started.overlay, planRoute("receptacle", 20, "surface", [started.port.position, overlay.devices[1].ports[0].position]), started.circuit, started.port, overlay.devices[1].id);
    const socket = overlay.devices[1], source = overlay.devices[0];

    const result = editDevicePosition(overlay, { deviceIds: [socket.id], bottomHeightMm: 400 }, { levelFloorY: { L0: 0 }, wallSpans: { "wall-a": [0, 4] } }, "commit");

    expect(result.removedSegmentIds).toEqual(overlay.segments.map((segment) => segment.id));
    expect(result.overlay.segments).toHaveLength(0);
    expect(result.overlay.devices.find((device) => device.id === socket.id)?.ports.every((port) => port.connectedSegmentIds.length === 0)).toBe(true);
    expect(result.overlay.devices.find((device) => device.id === source.id)?.ports.every((port) => port.connectedSegmentIds.length === 0)).toBe(true);
    expect(result.overlay.circuits[0]).toMatchObject({ status: "broken", segmentIds: [] });
  });

  it("stops local removal at the next route leg and exposes its boundary as an open end", () => {
    let overlay = placeNetworkDevice(createEmptyOverlay("a", "sha"), "strong-panel", wallPoint(0, 1));
    overlay = placeNetworkDevice(overlay, "socket", wallPoint(2, 2));
    const started = startRouteFromDevice(overlay, overlay.devices[0].id, "receptacle");
    overlay = commitDeviceRoute(started.overlay, planRoute("receptacle", 20, "surface", [started.port.position, wallPoint(1, 1), overlay.devices[1].ports[0].position]), started.circuit, started.port, overlay.devices[1].id);
    const socket = overlay.devices[1], result = editDevicePosition(overlay, { deviceIds: [socket.id], bottomHeightMm: 400 }, { levelFloorY: { L0: 0 }, wallSpans: { "wall-a": [0, 4] } }, "commit");

    expect(result.removedSegmentIds).toHaveLength(1);
    expect(result.overlay.segments.length).toBeGreaterThan(0);
    expect(result.overlay.segments.some((segment) => !segment.startPortId || !segment.endPortId)).toBe(true);
    expect(result.overlay.segments.flatMap((segment) => [segment.startPortId, segment.endPortId]).filter(Boolean).every((portId) => result.overlay.fittings.some((fitting) => fitting.ports.some((port) => port.id === portId)) || result.overlay.devices.some((device) => device.ports.some((port) => port.id === portId)))).toBe(true);
    expect(openRouteEndpoints(result.overlay)).toHaveLength(1);
  });

  it("does not remove conduit when a submitted positioning value is unchanged", () => {
    let overlay = placeNetworkDevice(createEmptyOverlay("a", "sha"), "strong-panel", wallPoint(0, 1));
    overlay = placeNetworkDevice(overlay, "socket", wallPoint(2, 1));
    const started = startRouteFromDevice(overlay, overlay.devices[0].id, "receptacle");
    overlay = commitDeviceRoute(started.overlay, planRoute("receptacle", 20, "surface", [started.port.position, overlay.devices[1].ports[0].position]), started.circuit, started.port, overlay.devices[1].id);
    const socket = overlay.devices[1], current = describeDevicePosition(overlay, socket.id, { levelFloorY: { L0: 0 }, wallSpans: { "wall-a": [0, 4] } }).vertical!.millimeters;
    const result = editDevicePosition(overlay, { deviceIds: [socket.id], bottomHeightMm: current }, { levelFloorY: { L0: 0 }, wallSpans: { "wall-a": [0, 4] } }, "commit");
    expect(result.status).toBe("rejected");
    expect(result.overlay).toBe(overlay);
    expect(result.overlay.segments).toHaveLength(overlay.segments.length);
  });

  it("bulk-edits only installation-reference-plane device points", () => {
    const light = { ...createNetworkDevice("luminaire", { position: [1, 2.7, 1], attachment: { hostId: "temporary", hostKind: "ceiling" as const, surface: "ceiling-face", normal: [0, -1, 0], levelId: "L0" } }), position: { position: [1, 2.7, 1] as [number, number, number] }, mount: { kind: "reference-plane" as const, levelId: "L0", elevationMm: 2700 } };
    const wall = createNetworkDevice("socket", wallPoint(2, .3));
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [light, wall] };

    const result = editDevicePosition(overlay, { deviceIds: [light.id, wall.id], elevationMm: 3000 }, { levelFloorY: { L0: 0 }, wallSpans: {}, physicalSurfaces: [] }, "commit");

    expect(result.overlay.devices[0].position.position[1]).toBe(3);
    expect(result.overlay.devices[0].position.attachment).toBeUndefined();
    expect(result.overlay.devices[1]).toEqual(wall);
    expect(result.skippedDeviceIds).toEqual([wall.id]);
  });

  it("promotes a Ceiling-mounted socket to an editable reference-plane point when changing XYZ", () => {
    const socket = createNetworkDevice("socket", { position: [2, 2.7, 3], attachment: { hostId: "ceiling", hostKind: "ceiling", surface: "bottom", normal: [0, -1, 0], levelId: "L0", localPosition: [2, 2.7, 3], basis: { u: [1, 0, 0], v: [0, 0, 1] } } });
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [socket] };
    const context = { levelFloorY: { L0: 0 }, wallSpans: {}, wallFaces: [
      { id: "wall-x", levelId: "L0", point: [0, 0, 0] as [number, number, number], normal: [1, 0, 0] as [number, number, number] },
      { id: "wall-z", levelId: "L0", point: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] },
    ] };
    expect(describeDevicePosition(overlay, socket.id, context)).toMatchObject({ vertical: { millimeters: 2700, kind: "reference-plane" }, planar: expect.any(Array) });
    const moved = editDevicePosition(overlay, { deviceIds: [socket.id], elevationMm: 3000, planarClearanceMm: { "wall-x": 1000 } }, context, "commit");
    expect(moved.status).toBe("committed");
    expect(moved.overlay.devices[0].mount).toEqual({ kind: "reference-plane", levelId: "L0", elevationMm: 3000 });
    expect(moved.overlay.devices[0].position.position).toEqual([1, 3, 3]);
    expect(moved.overlay.devices[0].position.attachment).toBeUndefined();
  });

  it("promotes an eligible hosted point on the first physical planar edit while preserving world position", () => {
    const ceilingLight = createNetworkDevice("luminaire", {
      position: [2, 2.7, 3],
      attachment: { hostId: "ceiling", hostKind: "ceiling", surface: "ceiling-face", normal: [0, -1, 0], levelId: "L0", localPosition: [2, 2.7, 3], basis: { u: [1, 0, 0], v: [0, 0, 1] } },
    });
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [ceilingLight] };
    const physicalSurfaces = quad("east-wall", "wall", [3, 0, 0], [3, 0, 6], [3, 4, 6], [3, 4, 0]);

    const moved = editDevicePosition(overlay, { deviceIds: [ceilingLight.id], planarClearanceMm: { "u+": 500 } }, { levelFloorY: { L0: 0 }, wallSpans: {}, physicalSurfaces }, "commit");

    expect(moved.status).toBe("committed");
    expect(moved.overlay.devices[0]?.position.position).toEqual([2.5, 2.7, 3]);
    expect(moved.overlay.devices[0]?.position.attachment).toBeUndefined();
    expect(moved.overlay.devices[0]?.mount).toEqual({ kind: "reference-plane", levelId: "L0", elevationMm: 2700 });
  });

  it("bulk-edits the bottom-edge height of multiple wall device points", () => {
    const first = createNetworkDevice("switch", wallPoint(1, 1.2)), second = createNetworkDevice("socket", wallPoint(2, .3));
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [first, second] };
    const result = editDevicePosition(overlay, { deviceIds: [first.id, second.id], bottomHeightMm: 500 }, { levelFloorY: { L0: 0 }, wallSpans: { "wall-a": [0, 4] } }, "commit");
    expect(result.overlay.devices.map((device) => Math.round((device.position.position[1] - device.sizeMm[1] / 2000) * 1000))).toEqual([500, 500]);
  });

  it("uses a stable near-orthogonal wall pair for reference-plane centre dimensions", () => {
    const light = createReferencePlaneDevice("luminaire", [2, 2.7, 3], "L0", 2700);
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [light] };
    const context = { levelFloorY: { L0: 0 }, wallSpans: {}, wallFaces: [
      { id: "wall-x", levelId: "L0", point: [0, 0, 0] as [number, number, number], normal: [1, 0, 0] as [number, number, number] },
      { id: "wall-z", levelId: "L0", point: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] },
    ] };
    const description = describeDevicePosition(overlay, light.id, context);
    expect(description.planar?.map((item) => [item.wallId, item.millimeters])).toEqual([["wall-x", 2000], ["wall-z", 3000]]);
    const result = editDevicePosition(overlay, { deviceIds: [light.id], planarClearanceMm: { "wall-x": 1000 } }, context, "commit");
    expect(result.overlay.devices[0].position.position[0]).toBeCloseTo(1);
    expect(result.overlay.devices[0].positioning?.planarWallIds).toEqual(["wall-x", "wall-z"]);
  });

  it("ignores a nearer finite wall when the dimension ray misses its extent", () => {
    const light = createReferencePlaneDevice("luminaire", [4, 2.7, 3], "L0", 2700);
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [light] };
    const context = { levelFloorY: { L0: 0 }, wallSpans: {}, wallFaces: [
      { id: "short-near", levelId: "L0", point: [3, 0, 0] as [number, number, number], normal: [1, 0, 0] as [number, number, number], start: [3, 0, 0] as [number, number, number], end: [3, 0, 1] as [number, number, number] },
      { id: "right-hit", levelId: "L0", point: [7, 0, 0] as [number, number, number], normal: [1, 0, 0] as [number, number, number], start: [7, 0, 0] as [number, number, number], end: [7, 0, 6] as [number, number, number] },
      { id: "bottom-hit", levelId: "L0", point: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], start: [0, 0, 0] as [number, number, number], end: [8, 0, 0] as [number, number, number] },
    ] };
    expect(describeDevicePosition(overlay, light.id, context).planar?.map((item) => item.wallId).sort()).toEqual(["bottom-hit", "right-hit"]);
  });

  it("rebuilds physical port positions when a device size changes", () => {
    const socket = createNetworkDevice("socket", wallPoint(2, 1));
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [socket] };
    const resized = resizeDevicePoint(overlay, socket.id, [172, 86, 50]);
    const rightPorts = resized.devices[0].ports.filter((port) => port.face === "right");
    expect(rightPorts.every((port) => Math.abs(port.position.position[0] - 2.086) < 1e-8)).toBe(true);
    expect(rightPorts.map((port) => port.id)).toEqual(socket.ports.filter((port) => port.face === "right").map((port) => port.id));
  });

  it("rejects resizing a connected device instead of detaching its physical ports", () => {
    let overlay = placeNetworkDevice(createEmptyOverlay("a", "sha"), "strong-panel", wallPoint(0, 1));
    overlay = placeNetworkDevice(overlay, "socket", wallPoint(2, 1));
    const started = startRouteFromDevice(overlay, overlay.devices[0].id, "receptacle");
    overlay = commitDeviceRoute(started.overlay, planRoute("receptacle", 20, "surface", [started.port.position, overlay.devices[1].ports[0].position]), started.circuit, started.port, overlay.devices[1].id);
    expect(resizeDevicePoint(overlay, overlay.devices[1].id, [172, 86, 50])).toBe(overlay);
  });

  it("resizes a connected spotlight cylinder without moving its centre or physical ports", () => {
    const spotlight = createNetworkDevice("luminaire", { position: [2, 2.7, 3], attachment: { hostId: "ceiling-a", hostKind: "ceiling", surface: "bottom", normal: [0, -1, 0], levelId: "L0" } });
    const connected = { ...spotlight, ports: spotlight.ports.map((port, index) => index === 0 ? { ...port, connectedSegmentIds: ["lighting-run"] } : port) };
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [connected] };

    const resized = resizeSpotlight(overlay, spotlight.id, 120, 180);

    expect(resized.devices[0]).toMatchObject({ sizeMm: [120, 120, 180], position: connected.position, mount: connected.mount, ports: connected.ports });
    expect(resized.devices[0].ports).toEqual(connected.ports);
    expect(resizeSpotlight(overlay, spotlight.id, 0, 180)).toBe(overlay);
  });

  it("rejects a wall clearance that would move the device outside its host span", () => {
    const socket = createNetworkDevice("socket", wallPoint(2, 1));
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [socket] };
    const result = editDevicePosition(overlay, { deviceIds: [socket.id], horizontalClearanceMm: 5000 }, { levelFloorY: { L0: 0 }, wallSpans: { "wall-a": [0, 4] } }, "commit");
    expect(result.status).toBe("rejected");
    expect(result.overlay).toBe(overlay);
  });

  it("keeps host-local coordinates in their wall basis on a rotated wall", () => {
    const point: RoutePoint = { position: [0, 1, 2], attachment: { hostId: "wall-a", hostKind: "wall", surface: "interior", normal: [1, 0, 0], levelId: "L0", localPosition: [2, 1, 0], basis: { u: [0, 0, 1], v: [0, 1, 0] } } };
    const socket = createNetworkDevice("socket", point), overlay = { ...createEmptyOverlay("a", "sha"), devices: [socket] };
    const result = editDevicePosition(overlay, { deviceIds: [socket.id], horizontalClearanceMm: 500 }, { levelFloorY: { L0: 0 }, wallSpans: { "wall-a": [0, 4] } }, "commit");
    expect(result.overlay.devices[0].position.attachment?.localPosition?.[0]).toBeCloseTo(3.457);
    expect(result.overlay.devices[0].position.attachment?.localPosition?.[2]).toBeCloseTo(0);
  });
});
