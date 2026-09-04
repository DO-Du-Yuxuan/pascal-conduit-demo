import type { RoutePoint, Vec3 } from "./overlay";

export type DirectionMode = "free" | "orthogonal";
export type WorldAxis = "x" | "y" | "z";
export type DirectionArrow = "ArrowLeft" | "ArrowUp" | "ArrowRight" | "ArrowDown";

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (v: Vec3, n: number): Vec3 => [v[0] * n, v[1] * n, v[2] * n];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const fallbackBasis = (point: RoutePoint) => point.attachment?.hostKind === "wall"
  ? { u: [1, 0, 0] as Vec3, v: [0, 1, 0] as Vec3 }
  : { u: [1, 0, 0] as Vec3, v: [0, 0, 1] as Vec3 };

/** Project a candidate onto the dominant local direction of the last host. */
export function constrainToHostAxes(previous: RoutePoint, candidate: RoutePoint, mode: DirectionMode): RoutePoint {
  const basis = previous.attachment?.basis ?? fallbackBasis(previous);
  const delta = subtract(candidate.position, previous.position);
  const alongU = dot(delta, basis.u), alongV = dot(delta, basis.v);
  if (mode === "free") {
    if (previous.attachment?.hostId !== candidate.attachment?.hostId || candidate.attachment?.curveT !== undefined) return candidate;
    return { ...candidate, position: add(previous.position, add(scale(basis.u, alongU), scale(basis.v, alongV))) };
  }
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

/**
 * The rendered cursor is authoritative. A click hit is only a fallback for the
 * first frame before pointer-move has produced a preview.
 */
export function resolveConfirmedRoutePoint(preview: RoutePoint | null, clickHit: RoutePoint | null): RoutePoint | null {
  return preview ?? clickHit;
}

export function displayedRoutePoints(confirmed: RoutePoint[], cursor: RoutePoint | null, mode: DirectionMode, options: { worldAxis?: WorldAxis | null; penetrationEntry?: RoutePoint | null } = {}): RoutePoint[] {
  if (options.penetrationEntry) return [...confirmed, options.penetrationEntry, ...(cursor && cursor !== options.penetrationEntry ? [cursor] : [])];
  if (options.worldAxis && cursor) return [...confirmed, cursor];
  return previewRoutePoints(confirmed, cursor, mode);
}

const axisVector = (axis: WorldAxis): Vec3 => axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];

export function directionStateForArrow(key: DirectionArrow): { worldAxis: WorldAxis | null; orthogonal: false } {
  return { worldAxis: key === "ArrowLeft" ? "x" : key === "ArrowUp" ? "y" : key === "ArrowRight" ? "z" : null, orthogonal: false };
}

/** Closest point on a world axis through `start` to a pointer ray. */
export function pointOnWorldAxis(start: RoutePoint, axis: WorldAxis, rayOrigin: Vec3, rayDirection: Vec3): RoutePoint {
  const u = axisVector(axis), w = subtract(start.position, rayOrigin);
  const a = dot(u, u), b = dot(u, rayDirection), c = dot(rayDirection, rayDirection), d = dot(u, w), e = dot(rayDirection, w);
  const denominator = a * c - b * b;
  const distance = Math.abs(denominator) < 1e-7 ? -d / a : (b * e - c * d) / denominator;
  return { position: add(start.position, scale(u, distance)) };
}
