import type { RouteFitting, RouteSegment } from "./overlay";

/** Physical centerline length of one straight route segment, in millimetres. */
export function routeSegmentLengthMm(segment: Pick<RouteSegment, "start" | "end">) {
  return Math.hypot(
    segment.end.position[0] - segment.start.position[0],
    segment.end.position[1] - segment.start.position[1],
    segment.end.position[2] - segment.start.position[2],
  ) * 1000;
}

/** A tangent sweep is continuous conduit, so its centreline arc is billable length. */
export function routeSweepLengthMm(fitting: Pick<RouteFitting, "arc">) {
  if (!fitting.arc) return 0;
  const radiusMm = Math.hypot(
    fitting.arc.start[0] - fitting.arc.center[0],
    fitting.arc.start[1] - fitting.arc.center[1],
    fitting.arc.start[2] - fitting.arc.center[2],
  ) * 1000;
  return radiusMm * Math.abs(fitting.arc.sweepRadians);
}

export function formatRouteLengthMm(lengthMm: number) {
  return `${Math.round(lengthMm).toLocaleString("zh-CN")} mm`;
}
