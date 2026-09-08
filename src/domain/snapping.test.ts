import { describe, expect, it } from "vitest";
import { projectRoutePointToDirection, resolveOrthogonalDirection, resolveSnapCandidate, resolveTargetClick, type SnapCandidate } from "./snapping";
import type { RoutePoint } from "./overlay";

const point = (x: number, y: number, z: number): RoutePoint => ({ position: [x, y, z], attachment: { hostId: "wall", hostKind: "wall", surface: "interior", normal: [0, 0, 1], levelId: "L0", localPosition: [x, y, z], basis: { u: [1, 0, 0], v: [0, 1, 0] } } });
const candidate = (kind: SnapCandidate["kind"], x: number, y = 0, z = 0, distancePixels = 5): SnapCandidate => ({ kind, point: point(x, y, z), targetId: `${kind}-target`, label: kind, distancePixels, compatible: true });

describe("route object snap resolution", () => {
  it("uses deterministic target priority inside the screen tolerance", () => {
    expect(resolveSnapCandidate(point(0, 0, 0), [candidate("host-corner", 1, 0, 0, 2), candidate("device-port", 1, 0, 0, 8)], { tolerancePixels: 12 }).candidate?.kind).toBe("device-port");
    expect(resolveSnapCandidate(point(0, 0, 0), [candidate("open-end", 1, 0, 0, 5), candidate("open-end", 2, 0, 0, 5)], { tolerancePixels: 12 }).candidate?.targetId).toBe("open-end-target");
  });

  it("excludes incompatible and out-of-tolerance candidates", () => {
    const incompatible = { ...candidate("device-port", 1), compatible: false };
    expect(resolveSnapCandidate(point(0, 0, 0), [incompatible, candidate("open-end", 1, 0, 0, 20)], { tolerancePixels: 12 })).toMatchObject({ kind: "none" });
  });

  it("lets a world-axis lock connect only collinear targets and otherwise returns alignment", () => {
    expect(resolveSnapCandidate(point(0, 0, 0), [candidate("device-port", 2, 0, 0)], { tolerancePixels: 12, worldAxis: "x" })).toMatchObject({ kind: "snap", point: { position: [2, 0, 0] } });
    expect(resolveSnapCandidate(point(0, 0, 0), [candidate("device-port", 2, 1, 0)], { tolerancePixels: 12, worldAxis: "x" })).toMatchObject({ kind: "alignment", point: { position: [2, 0, 0] } });
  });

  it("preserves host orthogonal direction instead of faking a diagonal connection", () => {
    expect(resolveSnapCandidate(point(0, 0, 0), [candidate("open-end", 2, .1, 0)], { tolerancePixels: 12, hostOrthogonal: true })).toMatchObject({ kind: "alignment", point: { position: [2, 0, 0] } });
    expect(resolveSnapCandidate(point(0, 0, 0), [candidate("open-end", 2, 0, 0)], { tolerancePixels: 12, hostOrthogonal: true })).toMatchObject({ kind: "snap" });
  });

  it("uses pointer intent instead of the target position to choose the assisted direction", () => {
    const start = point(0, 0, 0), target = candidate("device-port", 1, 4, 0);
    expect(resolveSnapCandidate(start, [target], {
      tolerancePixels: 12,
      hostOrthogonal: true,
      orthogonalDirection: [1, 0, 0],
    })).toMatchObject({ kind: "alignment", point: { position: [1, 0, 0] } });
  });

  it("keeps the current pointer-intent direction until another direction is 1.5 times stronger", () => {
    const start = point(0, 0, 0);
    expect(resolveOrthogonalDirection(start, point(1, 1.4, 0), [1, 0, 0])).toEqual([1, 0, 0]);
    expect(resolveOrthogonalDirection(start, point(1, 1.6, 0), [1, 0, 0])).toEqual([0, 1, 0]);
  });

  it("projects a raw pointer intent onto the selected orthogonal direction", () => {
    expect(projectRoutePointToDirection(point(1, 2, 3), point(5, 7, 9), [0, 0, 1])).toMatchObject({ position: [1, 2, 9] });
  });

  it("uses world-axis alignment for an orthogonal suspended route instead of snapping diagonally", () => {
    const suspendedStart: RoutePoint = { position: [0, 2.7, 0] };
    const suspendedTarget = { ...candidate("device-port", 2, 3.2, 1), point: { position: [2, 3.2, 1] as [number, number, number] } };
    expect(resolveSnapCandidate(suspendedStart, [suspendedTarget], { tolerancePixels: 12, hostOrthogonal: true })).toMatchObject({ kind: "alignment", point: { position: [2, 2.7, 0] } });
  });

  it("confirms the exported-overlay ground alignment without connecting to the elevated socket", () => {
    const groundPoint: RoutePoint = {
      position: [18.807783912579635, 0.05, 3.767350428786431],
      attachment: {
        hostId: "slab",
        hostKind: "slab",
        surface: "top",
        normal: [0, 1, 0],
        levelId: "level_3syt3grnb9zg523c",
        localPosition: [18.807783912579635, 0.05, 3.767350428786431],
        basis: { u: [1, 0, 0], v: [0, 0, 1] },
      },
    };
    const socketPort: SnapCandidate = {
      kind: "device-port",
      point: { position: [18.607783912579634, 1.4952438117866862, 4.408290428786431] },
      targetId: "socket_2:port:1",
      label: "插座端口",
      distancePixels: 0,
      compatible: true,
    };

    expect(resolveTargetClick(groundPoint, socketPort, { tolerancePixels: 16, hostOrthogonal: true })).toMatchObject({
      kind: "confirm-alignment",
      point: { position: [18.807783912579635, 0.05, 4.408290428786431] },
    });
  });

  it("connects only when the constrained route actually reaches the device port", () => {
    const start = point(0, 0, 0);
    const port = candidate("device-port", 2, 0, 0, 0);
    expect(resolveTargetClick(start, port, { tolerancePixels: 16, hostOrthogonal: true })).toMatchObject({
      kind: "connect",
      point: port.point,
    });
  });

  it("treats same-wall host-plane alignment as arrival despite a small normal-depth offset", () => {
    const wallAttachment = {
      hostId: "wall_z0z1e5demyxgtc01",
      hostKind: "wall" as const,
      surface: "interior",
      normal: [0.0014783378991640127, 0, -0.999998907257931] as [number, number, number],
      levelId: "level_3syt3grnb9zg523c",
      basis: { u: [-0.999998907257931, 0, -0.0014783378991640127] as [number, number, number], v: [0, 1, 0] as [number, number, number] },
    };
    const routePoint: RoutePoint = { position: [18.35449159874197, 1.6310574890420748, 4.407598867113591], attachment: wallAttachment };
    const socketPort: SnapCandidate = {
      kind: "device-port",
      point: { position: [18.35449159874197, 1.8069774890420751, 4.4079159767501395], attachment: wallAttachment },
      targetId: "socket_2:port:2",
      label: "插座底部端口",
      distancePixels: 0,
      compatible: true,
    };

    expect(resolveTargetClick(routePoint, socketPort, { tolerancePixels: 16, hostOrthogonal: true })).toMatchObject({
      kind: "connect",
      point: socketPort.point,
    });

    const distantPort = { ...socketPort, point: { ...socketPort.point, position: [socketPort.point.position[0], socketPort.point.position[1], socketPort.point.position[2] + .01] as [number, number, number] } };
    expect(resolveTargetClick(routePoint, distantPort, { tolerancePixels: 16, hostOrthogonal: true }).kind).toBe("confirm-alignment");
    expect(resolveSnapCandidate(routePoint, [{ ...socketPort, kind: "open-end" }], { tolerancePixels: 16, hostOrthogonal: true }).kind).toBe("alignment");
  });
});
