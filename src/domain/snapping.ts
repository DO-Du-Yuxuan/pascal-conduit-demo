import type { RoutePoint, Vec3 } from "./overlay";
import type { WorldAxis } from "./drawing";

export type SnapKind = "device-port" | "open-end" | "branch" | "host-corner" | "host-edge";
export type SnapCandidate = { kind: SnapKind; point: RoutePoint; targetId: string; label: string; distancePixels: number; compatible: boolean };
export type SnapResolution = { kind: "none" | "snap" | "alignment"; point?: RoutePoint; candidate?: SnapCandidate };
export type TargetClickResolution =
  | { kind: "none" }
  | { kind: "confirm-alignment"; point: RoutePoint; candidate: SnapCandidate }
  | { kind: "connect"; point: RoutePoint; candidate: SnapCandidate };

const priority: Record<SnapKind, number> = { "device-port": 0, "open-end": 1, branch: 2, "host-corner": 3, "host-edge": 4 };
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, amount: number): Vec3 => [a[0] * amount, a[1] * amount, a[2] * amount];
const distance = (a: Vec3, b: Vec3) => Math.hypot(...subtract(a, b));
const axisVector = (axis: WorldAxis): Vec3 => axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];
const ARRIVAL_EPSILON_METERS = 1e-5;
const HOST_NORMAL_OFFSET_TOLERANCE_METERS = .002;

export function projectRoutePointToDirection(start: RoutePoint, target: RoutePoint, direction: Vec3): RoutePoint {
  const delta = subtract(target.position, start.position);
  return { ...target, position: add(start.position, scale(direction, dot(delta, direction))) };
}

export function resolveOrthogonalDirection(start: RoutePoint, intent: RoutePoint, previous: Vec3 | null = null, switchRatio = 1.5): Vec3 {
  const basis = start.attachment?.basis;
  const directions: Vec3[] = basis ? [basis.u, basis.v] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const delta = subtract(intent.position, start.position);
  const scores = directions.map((direction) => Math.abs(dot(delta, direction)));
  let strongest = 0;
  for (let index = 1; index < scores.length; index += 1) if (scores[index] > scores[strongest]) strongest = index;
  if (!previous) return directions[strongest];
  const previousIndex = directions.findIndex((direction) => Math.abs(dot(direction, previous)) >= .999);
  if (previousIndex < 0 || previousIndex === strongest) return directions[strongest];
  return scores[strongest] > scores[previousIndex] * switchRatio ? directions[strongest] : directions[previousIndex];
}

function reachesSameHostPlane(start: RoutePoint, projected: Vec3, target: RoutePoint): boolean {
  const startHost = start.attachment, targetHost = target.attachment;
  if (!startHost || !targetHost || startHost.hostId !== targetHost.hostId || startHost.hostKind !== targetHost.hostKind || startHost.surface !== targetHost.surface || startHost.levelId !== targetHost.levelId) return false;
  const basis = startHost.basis ?? targetHost.basis;
  if (!basis) return false;
  const residual = subtract(target.position, projected);
  const normal = startHost.normal ?? targetHost.normal;
  return Boolean(normal) && Math.hypot(dot(residual, basis.u), dot(residual, basis.v)) <= ARRIVAL_EPSILON_METERS && Math.abs(dot(residual, normal!)) <= HOST_NORMAL_OFFSET_TOLERANCE_METERS;
}

export function resolveSnapCandidate(start: RoutePoint, candidates: readonly SnapCandidate[], options: { tolerancePixels: number; worldAxis?: WorldAxis | null; hostOrthogonal?: boolean; orthogonalDirection?: Vec3 | null }): SnapResolution {
  const candidate = candidates
    .filter((item) => item.compatible && Number.isFinite(item.distancePixels) && item.distancePixels <= options.tolerancePixels)
    .sort((left, right) => priority[left.kind] - priority[right.kind] || left.distancePixels - right.distancePixels || left.targetId.localeCompare(right.targetId))[0];
  if (!candidate) return { kind: "none" };
  const delta = subtract(candidate.point.position, start.position);
  if (options.worldAxis) {
    const axis = axisVector(options.worldAxis), projected = add(start.position, scale(axis, dot(delta, axis)));
    return distance(projected, candidate.point.position) <= ARRIVAL_EPSILON_METERS ? { kind: "snap", point: candidate.point, candidate } : { kind: "alignment", point: { position: projected }, candidate };
  }
  if (options.hostOrthogonal) {
    const direction = options.orthogonalDirection ?? resolveOrthogonalDirection(start, candidate.point);
    const projected = add(start.position, scale(direction, dot(delta, direction)));
    return distance(projected, candidate.point.position) <= ARRIVAL_EPSILON_METERS ? { kind: "snap", point: candidate.point, candidate } : { kind: "alignment", point: { position: projected, attachment: start.attachment }, candidate };
  }
  return { kind: "snap", point: candidate.point, candidate };
}

export function resolveTargetClick(start: RoutePoint, candidate: SnapCandidate, options: { tolerancePixels: number; worldAxis?: WorldAxis | null; hostOrthogonal?: boolean; orthogonalDirection?: Vec3 | null }): TargetClickResolution {
  const resolution = resolveSnapCandidate(start, [candidate], options);
  if (!resolution.point || !resolution.candidate) return { kind: "none" };
  if (resolution.kind === "alignment" && candidate.kind === "device-port" && reachesSameHostPlane(start, resolution.point.position, candidate.point)) return { kind: "connect", point: candidate.point, candidate };
  return resolution.kind === "alignment"
    ? { kind: "confirm-alignment", point: resolution.point, candidate: resolution.candidate }
    : { kind: "connect", point: resolution.point, candidate: resolution.candidate };
}
