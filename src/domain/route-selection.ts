import type { ConduitOverlayDocument } from "./overlay";

/** Returns every segment and fitting physically connected to a route element. */
export function connectedRouteElementIds(overlay: Pick<ConduitOverlayDocument, "segments" | "fittings">, startId: string) {
  const segmentIds = new Set(overlay.segments.map((segment) => segment.id));
  const fittingBySegment = new Map<string, string[]>();
  const fittingSegments = new Map<string, string[]>();
  for (const fitting of overlay.fittings) {
    const connected = fitting.segmentIds.filter((id) => segmentIds.has(id));
    fittingSegments.set(fitting.id, connected);
    for (const segmentId of connected) (fittingBySegment.get(segmentId) ?? fittingBySegment.set(segmentId, []).get(segmentId)!).push(fitting.id);
  }
  if (!segmentIds.has(startId) && !fittingSegments.has(startId)) return [];
  const pending = [startId], visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const neighbours = segmentIds.has(id) ? fittingBySegment.get(id) ?? [] : fittingSegments.get(id) ?? [];
    for (const neighbour of neighbours) if (!visited.has(neighbour)) pending.push(neighbour);
  }
  return [...visited];
}
