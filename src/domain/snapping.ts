import type { RoutePoint, Vec3 } from "./overlay";
import type { WorldAxis } from "./drawing";

export type SnapKind = "device-port" | "open-end" | "branch" | "host-corner" | "host-edge";
export type SnapCandidate = { kind: SnapKind; point: RoutePoint; targetId: string; label: string; distancePixels: number; compatible: boolean };
export type SnapResolution = { kind: "none" | "snap" | "alignment"; point?: RoutePoint; candidate?: SnapCandidate };

const priority: Record<SnapKind, number> = { "device-port": 0, "open-end": 1, branch: 2, "host-corner": 3, "host-edge": 4 };
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, amount: number): Vec3 => [a[0] * amount, a[1] * amount, a[2] * amount];
const distance = (a: Vec3, b: Vec3) => Math.hypot(...subtract(a, b));
const axisVector = (axis: WorldAxis): Vec3 => axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];

export function resolveSnapCandidate(start: RoutePoint, candidates: readonly SnapCandidate[], options: { tolerancePixels: number; worldAxis?: WorldAxis | null; hostOrthogonal?: boolean }): SnapResolution {
  const candidate = candidates
    .filter((item) => item.compatible && Number.isFinite(item.distancePixels) && item.distancePixels <= options.tolerancePixels)
    .sort((left, right) => priority[left.kind] - priority[right.kind] || left.distancePixels - right.distancePixels || left.targetId.localeCompare(right.targetId))[0];
  if (!candidate) return { kind: "none" };
  const delta = subtract(candidate.point.position, start.position);
  if (options.worldAxis) {
    const axis = axisVector(options.worldAxis), projected = add(start.position, scale(axis, dot(delta, axis)));
    return distance(projected, candidate.point.position) <= 1e-5 ? { kind: "snap", point: candidate.point, candidate } : { kind: "alignment", point: { position: projected }, candidate };
  }
  if (options.hostOrthogonal) {
    const basis = start.attachment?.basis;
    const directions: Vec3[] = basis ? [basis.u, basis.v] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const direction = directions.sort((left, right) => Math.abs(dot(delta, right)) - Math.abs(dot(delta, left)))[0];
    const projected = add(start.position, scale(direction, dot(delta, direction)));
    return distance(projected, candidate.point.position) <= 1e-5 ? { kind: "snap", point: candidate.point, candidate } : { kind: "alignment", point: { position: projected, attachment: start.attachment }, candidate };
  }
  return { kind: "snap", point: candidate.point, candidate };
}
