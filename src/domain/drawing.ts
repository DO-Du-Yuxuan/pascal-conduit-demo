import type { HostAttachment, RoutePoint, Vec3 } from "./overlay";
import type { PenetrationRequest } from "./routing";

export type DirectionMode = "free" | "orthogonal";
export type WorldAxis = "x" | "y" | "z";
export type DirectionArrow = "ArrowLeft" | "ArrowUp" | "ArrowRight" | "ArrowDown";
export type PenetrationSession = { entry: RoutePoint; host: HostAttachment; direction: Vec3; orthogonal: boolean };
export type RouteCompletionMode = "confirmed-only" | "include-preview";

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (v: Vec3, n: number): Vec3 => [v[0] * n, v[1] * n, v[2] * n];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const length = (value: Vec3) => Math.hypot(...value);
const normalize = (value: Vec3): Vec3 => { const size = length(value); return size < 1e-9 ? [1, 0, 0] : scale(value, 1 / size); };
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
  if (!cursor.attachment) return confirmed;
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

/** Selects the route points owned by a completion gesture without mutating the draft. */
export function routePointsForCompletion(confirmed: RoutePoint[], preview: RoutePoint | null, mode: RouteCompletionMode): RoutePoint[] {
  if (mode === "confirmed-only" || !preview) return confirmed;
  const last = confirmed[confirmed.length - 1];
  if (last && preview.position.every((value, axis) => Math.abs(value - last.position[axis]) <= 1e-7)) return confirmed;
  return [...confirmed, preview];
}

export function beginPenetration(confirmed: RoutePoint[], entry: RoutePoint | null, orthogonal: boolean): PenetrationSession | null {
  const previous = confirmed[confirmed.length - 1];
  if (!previous || !entry?.attachment) return null;
  const delta = subtract(entry.position, previous.position);
  if (length(delta) < 1e-7) return null;
  return { entry, host: entry.attachment, direction: normalize(delta), orthogonal };
}

/**
 * Intersect the frozen incoming line with the destination host plane.  Using a
 * closest-point projection here made the preview look constrained while its
 * saved host anchor still described the raw mouse hit, which could leave the
 * confirmed point floating away from the host.
 */
export function projectPenetrationExit(session: PenetrationSession, candidate: RoutePoint | null): RoutePoint | null {
  if (!candidate?.attachment) return null;
  const denominator = dot(session.direction, candidate.attachment.normal);
  const planeOffset = dot(subtract(candidate.position, session.entry.position), candidate.attachment.normal);
  const distance = Math.abs(denominator) < 1e-7
    ? Math.abs(planeOffset) < 1e-5 ? dot(subtract(candidate.position, session.entry.position), session.direction) : Number.NaN
    : planeOffset / denominator;
  if (!Number.isFinite(distance)) return null;
  if (distance <= 1e-5) return null;
  const position = add(session.entry.position, scale(session.direction, distance));
  const attachment = { ...candidate.attachment };
  if (attachment.localPosition && attachment.basis) {
    const delta = subtract(position, candidate.position);
    const alongU = dot(delta, attachment.basis.u), alongV = dot(delta, attachment.basis.v);
    attachment.localPosition = attachment.hostKind === "wall"
      ? [attachment.localPosition[0] + alongU, attachment.localPosition[1] + alongV, 0]
      : [attachment.localPosition[0] + alongU, 0, attachment.localPosition[2] + alongV];
  }
  return { position, attachment };
}

export function penetrationRequest(session: PenetrationSession, exit: RoutePoint): PenetrationRequest {
  return { host: session.host, entry: session.entry, exit, direction: session.direction };
}

export function displayedRoutePoints(confirmed: RoutePoint[], cursor: RoutePoint | null, mode: DirectionMode, options: { worldAxis?: WorldAxis | null; penetration?: PenetrationSession | null } = {}): RoutePoint[] {
  if (options.penetration) return [...confirmed, options.penetration.entry, ...(cursor ? [cursor] : [])];
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
