import { describe, expect, it } from "vitest";
import { resolveSnapCandidate, type SnapCandidate } from "./snapping";
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
});
