import type { RoutePoint, Vec3 } from "./overlay";

export type DirectionMode = "free" | "orthogonal";

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (v: Vec3, n: number): Vec3 => [v[0] * n, v[1] * n, v[2] * n];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const fallbackBasis = (point: RoutePoint) => point.attachment?.hostKind === "wall"
  ? { u: [1, 0, 0] as Vec3, v: [0, 1, 0] as Vec3 }
  : { u: [1, 0, 0] as Vec3, v: [0, 0, 1] as Vec3 };

/** Project a candidate onto the dominant local direction of the last host. */
export function constrainToHostAxes(previous: RoutePoint, candidate: RoutePoint, mode: DirectionMode): RoutePoint {
  if (mode === "free") return candidate;
  const basis = previous.attachment?.basis ?? fallbackBasis(previous);
  const delta = subtract(candidate.position, previous.position);
  const alongU = dot(delta, basis.u), alongV = dot(delta, basis.v);
  const constrained = Math.abs(alongU) >= Math.abs(alongV)
    ? add(previous.position, scale(basis.u, alongU))
    : add(previous.position, scale(basis.v, alongV));
  return { ...candidate, position: constrained };
}

/** Drafts are intentionally ephemeral. This helper makes that invariant testable. */
export function previewRoutePoints(confirmed: RoutePoint[], cursor: RoutePoint | null, mode: DirectionMode, shiftKey = false): RoutePoint[] {
  if (!cursor || confirmed.length === 0) return confirmed;
  const previous = confirmed[confirmed.length - 1];
  const effective = shiftKey ? (mode === "free" ? "orthogonal" : "free") : mode;
  return [...confirmed, constrainToHostAxes(previous, cursor, effective)];
}
