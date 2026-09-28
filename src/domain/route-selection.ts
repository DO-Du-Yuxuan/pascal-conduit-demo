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

function physicallyConnectedRouteElementIds(
  overlay: Pick<ConduitOverlayDocument, "segments" | "fittings" | "junctionBoxes"> & Partial<Pick<ConduitOverlayDocument, "devices">>,
  startId: string,
  allowedSegmentIds?: ReadonlySet<string>,
) {
  const segmentIds = new Set(overlay.segments.filter((segment) => !allowedSegmentIds || allowedSegmentIds.has(segment.id)).map((segment) => segment.id));
  const segmentElements = new Map<string, string[]>();
  const elementSegments = new Map<string, string[]>();
  const traversableElements = [
    ...overlay.fittings.map((element) => ({ id: element.id, segmentIds: [...element.segmentIds, ...element.ports.flatMap((port) => port.connectedSegmentIds)], selectable: true })),
    ...overlay.junctionBoxes.map((element) => ({ id: element.id, segmentIds: [...element.segmentIds, ...element.ports.flatMap((port) => port.connectedSegmentIds)], selectable: true })),
    ...(overlay.devices ?? []).map((element) => ({ id: element.id, segmentIds: element.ports.flatMap((port) => port.connectedSegmentIds), selectable: false })),
  ];
  const selectableIds = new Set(traversableElements.filter((element) => element.selectable).map((element) => element.id));
  for (const element of traversableElements) {
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
  return [...visited].filter((id) => segmentIds.has(id) || selectableIds.has(id));
}

/** Returns the physically reachable route component within the selected Circuit.
 * Circuit membership bounds the search; fittings, box ports and device ports
 * define connectivity, so a broken Circuit cannot bridge a deleted gap.
 * Legacy and circuit-less routes fall back to their physical component.
 */
export function circuitRouteElementIds(overlay: Pick<ConduitOverlayDocument, "segments" | "fittings" | "junctionBoxes" | "circuits"> & Partial<Pick<ConduitOverlayDocument, "devices">>, startId: string) {
  const startSegment = overlay.segments.find((segment) => segment.id === startId);
  const seedSegmentIds = startSegment ? [startId] : [
    ...(overlay.fittings.find((fitting) => fitting.id === startId)?.segmentIds ?? []),
    ...(overlay.fittings.find((fitting) => fitting.id === startId)?.ports.flatMap((port) => port.connectedSegmentIds) ?? []),
    ...(overlay.junctionBoxes.find((box) => box.id === startId)?.segmentIds ?? []),
    ...(overlay.junctionBoxes.find((box) => box.id === startId)?.ports.flatMap((port) => port.connectedSegmentIds) ?? []),
  ];
  const seedSegmentId = seedSegmentIds[0];
  const circuitId = startSegment?.circuitId ?? overlay.segments.find((segment) => seedSegmentIds.includes(segment.id) && segment.circuitId)?.circuitId ?? overlay.circuits.find((circuit) => circuit.segmentIds.includes(startId) || seedSegmentIds.some((id) => circuit.segmentIds.includes(id)))?.id;
  const circuit = circuitId ? overlay.circuits.find((item) => item.id === circuitId) : undefined;
  if (!circuit) return physicallyConnectedRouteElementIds(overlay, seedSegmentId ?? startId);

  // Circuit membership identifies the allowed branch of the network; physical
  // connectivity determines which part remains reachable after edits/deletes.
  const circuitSegmentIds = new Set([...circuit.segmentIds, ...overlay.segments.filter((segment) => segment.circuitId === circuit.id).map((segment) => segment.id)]);
  const allowedSegmentIds = new Set(overlay.segments
    .filter((segment) => circuitSegmentIds.has(segment.id) && (!segment.circuitId || segment.circuitId === circuit.id))
    .map((segment) => segment.id));
  return physicallyConnectedRouteElementIds(overlay, startId, allowedSegmentIds);
}
