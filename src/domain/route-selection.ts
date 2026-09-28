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

function physicallyConnectedRouteElementIds(overlay: Pick<ConduitOverlayDocument, "segments" | "fittings" | "junctionBoxes">, startId: string) {
  const segmentIds = new Set(overlay.segments.map((segment) => segment.id));
  const segmentElements = new Map<string, string[]>();
  const elementSegments = new Map<string, string[]>();
  for (const element of [...overlay.fittings, ...overlay.junctionBoxes]) {
    const connected = element.segmentIds.filter((id) => segmentIds.has(id));
    elementSegments.set(element.id, connected);
    for (const segmentId of connected) (segmentElements.get(segmentId) ?? segmentElements.set(segmentId, []).get(segmentId)!).push(element.id);
  }
  if (!segmentIds.has(startId) && !elementSegments.has(startId)) return [];
  const pending = [startId], visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const neighbours = segmentIds.has(id) ? segmentElements.get(id) ?? [] : elementSegments.get(id) ?? [];
    for (const neighbour of neighbours) if (!visited.has(neighbour)) pending.push(neighbour);
  }
  return [...visited];
}

/** Returns all route elements in the selected circuit, including branch boxes.
 * Legacy and circuit-less routes fall back to their physical fitting component.
 */
export function circuitRouteElementIds(overlay: Pick<ConduitOverlayDocument, "segments" | "fittings" | "junctionBoxes" | "circuits">, startId: string) {
  const startSegment = overlay.segments.find((segment) => segment.id === startId);
  const seedSegmentIds = startSegment ? [startId] : [...(overlay.fittings.find((fitting) => fitting.id === startId)?.segmentIds ?? []), ...(overlay.junctionBoxes.find((box) => box.id === startId)?.segmentIds ?? [])];
  const seedSegmentId = seedSegmentIds[0];
  const circuitId = startSegment?.circuitId ?? overlay.segments.find((segment) => seedSegmentIds.includes(segment.id) && segment.circuitId)?.circuitId ?? overlay.circuits.find((circuit) => circuit.segmentIds.includes(startId) || seedSegmentIds.some((id) => circuit.segmentIds.includes(id)))?.id;
  const circuit = circuitId ? overlay.circuits.find((item) => item.id === circuitId) : undefined;
  if (!circuit) return physicallyConnectedRouteElementIds(overlay, seedSegmentId ?? startId);

  const segmentIds = new Set([...circuit.segmentIds, ...overlay.segments.filter((segment) => segment.circuitId === circuit.id).map((segment) => segment.id)]);
  const result = new Set<string>([...segmentIds].filter((id) => overlay.segments.some((segment) => segment.id === id)));
  for (const fitting of overlay.fittings) if (fitting.segmentIds.some((id) => segmentIds.has(id))) result.add(fitting.id);
  for (const box of overlay.junctionBoxes) if (box.segmentIds.some((id) => segmentIds.has(id))) result.add(box.id);
  return [...result];
}
