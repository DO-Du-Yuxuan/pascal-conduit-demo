import { describe, expect, it } from "vitest";
import { createNetworkDevice, createReferencePlaneDevice, openRouteEndpoints, placeNetworkDevice, startRouteFromDevice, commitDeviceRoute } from "./devices";
import { createEmptyOverlay, type RoutePoint } from "./overlay";
import { planRoute } from "./routing";
import { describeDevicePosition, editDevicePosition, resizeDevicePoint } from "./device-positioning";

const wallPoint = (x: number, y: number): RoutePoint => ({
  position: [x, y, 0],
  attachment: { hostId: "wall-a", hostKind: "wall", surface: "interior", normal: [0, 0, 1], levelId: "L0", localPosition: [x, y, 0], basis: { u: [1, 0, 0], v: [0, 1, 0] } },
});

describe("device point positioning transaction", () => {
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

    const result = editDevicePosition(overlay, { deviceIds: [light.id, wall.id], elevationMm: 3000 }, { levelFloorY: { L0: 0 }, wallSpans: {} }, "commit");

    expect(result.overlay.devices[0].position.position[1]).toBe(3);
    expect(result.overlay.devices[0].position.attachment).toBeUndefined();
    expect(result.overlay.devices[1]).toEqual(wall);
    expect(result.skippedDeviceIds).toEqual([wall.id]);
  });

  it("bulk-edits the bottom-edge height of multiple wall device points", () => {
    const first = createNetworkDevice("switch", wallPoint(1, 1.2)), second = createNetworkDevice("socket", wallPoint(2, .3));
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [first, second] };
    const result = editDevicePosition(overlay, { deviceIds: [first.id, second.id], bottomHeightMm: 500 }, { levelFloorY: { L0: 0 }, wallSpans: { "wall-a": [0, 4] } }, "commit");
    expect(result.overlay.devices.map((device) => Math.round((device.position.position[1] - device.sizeMm[1] / 2000) * 1000))).toEqual([500, 500]);
  });

  it("uses a stable near-orthogonal wall pair for reference-plane edge clearances", () => {
    const light = createReferencePlaneDevice("luminaire", [2, 2.7, 3], "L0", 2700);
    const overlay = { ...createEmptyOverlay("a", "sha"), devices: [light] };
    const context = { levelFloorY: { L0: 0 }, wallSpans: {}, wallFaces: [
      { id: "wall-x", levelId: "L0", point: [0, 0, 0] as [number, number, number], normal: [1, 0, 0] as [number, number, number] },
      { id: "wall-z", levelId: "L0", point: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] },
    ] };
    const description = describeDevicePosition(overlay, light.id, context);
    expect(description.planar?.map((item) => [item.wallId, item.millimeters])).toEqual([["wall-x", 1850], ["wall-z", 2980]]);
    const result = editDevicePosition(overlay, { deviceIds: [light.id], planarClearanceMm: { "wall-x": 1000 } }, context, "commit");
    expect(result.overlay.devices[0].position.position[0]).toBeCloseTo(1.15);
    expect(result.overlay.devices[0].positioning?.planarWallIds).toEqual(["wall-x", "wall-z"]);
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
