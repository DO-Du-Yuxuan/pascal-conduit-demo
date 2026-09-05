import type { BendArc, ConduitOverlayDocument, HostAttachment, JunctionBox, NetworkPort, Penetration, RouteFitting, RoutePoint, RouteSegment, RoutingSystem, SurfaceChase, SurfaceMode, Vec3 } from "./overlay";

let sequence = 0;
const nextId = (prefix: string) => `${prefix}_${(++sequence).toString(36)}`;
const EPSILON = 1e-6;
const copyPoint = (point: RoutePoint): RoutePoint => {
  const attachment = point.attachment ? { ...point.attachment, normal: [...point.attachment.normal] as Vec3, localPosition: point.attachment.localPosition ? [...point.attachment.localPosition] as Vec3 : undefined, basis: point.attachment.basis ? { u: [...point.attachment.basis.u] as Vec3, v: [...point.attachment.basis.v] as Vec3 } : undefined } : undefined;
  return attachment ? { position: [...point.position] as Vec3, attachment } : { position: [...point.position] as Vec3 };
};
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (value: Vec3, amount: number): Vec3 => [value[0] * amount, value[1] * amount, value[2] * amount];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (value: Vec3) => Math.hypot(...value);
const normalize = (value: Vec3): Vec3 => { const size = length(value); return size < EPSILON ? [1, 0, 0] : scale(value, 1 / size); };
const pointAlong = (start: RoutePoint, end: RoutePoint, distance: number): RoutePoint => ({ ...copyPoint(start), position: add(start.position, scale(normalize(subtract(end.position, start.position)), distance)) });
const segmentType = (system: RoutingSystem) => system === "sprinkler" ? "sprinkler-segment" as const : "conduit-segment" as const;
const fittingType = (system: RoutingSystem) => system === "sprinkler" ? "sprinkler-fitting" as const : "conduit-fitting" as const;
const isElectrical = (system: RoutingSystem) => system !== "sprinkler";

export type RouteDiagnostic = { code: "bend_clearance" | "route_collision" | "self_collision" | "branch_clearance"; message: string; objectIds?: string[]; point?: Vec3 };
export type PenetrationRequest = { host: HostAttachment; entry: RoutePoint; exit: RoutePoint; direction: Vec3 };
export type PlannedRoute = { system: RoutingSystem; diameterMm: number; mode: SurfaceMode; points: RoutePoint[]; segments: RouteSegment[]; fittings: RouteFitting[]; junctionBoxes: JunctionBox[]; surfaceChases: SurfaceChase[]; penetrations: Penetration[]; diagnostics: RouteDiagnostic[]; canCommit: boolean };
export type ConstructionVisualParameters = { chaseWidthMm: number; chaseDepthMm: number; penetrationDiameterMm: number };
const defaultConstructionParameters = (diameterMm: number): ConstructionVisualParameters => ({ chaseWidthMm: diameterMm + 10, chaseDepthMm: diameterMm + 5, penetrationDiameterMm: diameterMm + 10 });

type Corner = { point: RoutePoint; style: "none" | "sweep" | "standard"; radiusMm?: number; arc?: BendArc };

function port(ownerId: string, index: number, position: RoutePoint, direction: Vec3, segmentId: string, system: RoutingSystem, ownerKind: NetworkPort["owner"]["kind"] = "fitting"): NetworkPort {
  return { id: `${ownerId}:port:${index}`, owner: { kind: ownerKind, id: ownerId }, position: copyPoint(position), direction: normalize(direction), role: ownerKind === "junction-box" ? "branch" : "bidirectional", system, connectedSegmentIds: [segmentId], segmentId };
}
function bindPort(segment: RouteSegment, atStart: boolean, value: NetworkPort) { if (atStart) segment.startPortId = value.id; else segment.endPortId = value.id; }

/** Builds tangent sweep bends first, then creates stock-length conduit pieces. */
export function planRoute(system: RoutingSystem, diameterMm: number, mode: SurfaceMode, points: RoutePoint[], parameters = defaultConstructionParameters(diameterMm), explicitPenetrations: PenetrationRequest[] = [], options?: { bendRadiusMm?: number; stockLengthMm?: number }): PlannedRoute {
  if (points.length < 2) throw new Error("至少需要两个路由点。");
  const bendRadiusMm = options?.bendRadiusMm ?? 200, stockLengthMm = options?.stockLengthMm ?? 4000;
  const legStarts = points.slice(0, -1).map(copyPoint), legEnds = points.slice(1).map(copyPoint), corners: Corner[] = [], diagnostics: RouteDiagnostic[] = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1], corner = points[index], next = points[index + 1], incoming = normalize(subtract(corner.position, previous.position)), outgoing = normalize(subtract(next.position, corner.position));
    const deflection = Math.acos(Math.max(-1, Math.min(1, dot(incoming, outgoing))));
    if (deflection < .01) { corners.push({ point: copyPoint(corner), style: "none" }); continue; }
    if (isElectrical(system)) {
      const radius = bendRadiusMm / 1000, tangentDistance = radius * Math.tan(deflection / 2), incomingLength = length(subtract(corner.position, previous.position)), outgoingLength = length(subtract(next.position, corner.position));
      if (tangentDistance >= incomingLength - EPSILON || tangentDistance >= outgoingLength - EPSILON) {
        diagnostics.push({ code: "bend_clearance", message: `转角空间不足，无法放置 ${bendRadiusMm} mm 大弯。`, point: [...corner.position] as Vec3 });
        corners.push({ point: copyPoint(corner), style: "sweep", radiusMm: bendRadiusMm });
        continue;
      }
      const arcStart = subtract(corner.position, scale(incoming, tangentDistance)), arcEnd = add(corner.position, scale(outgoing, tangentDistance));
      const centerDirection = normalize(add(scale(incoming, -1), outgoing)), centerDistance = radius / Math.max(EPSILON, Math.cos(deflection / 2)), center = add(corner.position, scale(centerDirection, centerDistance)), normal = normalize(cross(incoming, outgoing));
      legEnds[index - 1] = { ...copyPoint(corner), position: arcStart };
      legStarts[index] = { ...copyPoint(corner), position: arcEnd };
      corners.push({ point: copyPoint(corner), style: "sweep", radiusMm: bendRadiusMm, arc: { start: arcStart, end: arcEnd, center, normal, sweepRadians: deflection } });
    } else corners.push({ point: copyPoint(corner), style: "standard" });
  }

  const segments: RouteSegment[] = [], legParts: RouteSegment[][] = [], couplingSpecs: Array<{ point: RoutePoint; left: RouteSegment; right: RouteSegment }> = [], cornerBreaks: Array<{ cornerIndex: number; point: RoutePoint; left: RouteSegment }> = [];
  let remainingMeters = stockLengthMm / 1000;
  for (let legIndex = 0; legIndex < legStarts.length; legIndex += 1) {
    if (legIndex > 0) {
      const priorCorner = corners[legIndex - 1], bendLength = priorCorner?.arc ? priorCorner.arc.sweepRadians * (priorCorner.radiusMm ?? bendRadiusMm) / 1000 : 0;
      if (bendLength > remainingMeters + EPSILON) {
        const priorParts = legParts[legIndex - 1], left = priorParts?.[priorParts.length - 1];
        if (left && priorCorner?.arc) cornerBreaks.push({ cornerIndex: legIndex - 1, point: { ...copyPoint(priorCorner.point), position: [...priorCorner.arc.start] as Vec3 }, left });
        remainingMeters = stockLengthMm / 1000;
      }
      remainingMeters = Math.max(EPSILON, remainingMeters - bendLength);
    }
    const parts: RouteSegment[] = [], start = legStarts[legIndex], end = legEnds[legIndex], total = length(subtract(end.position, start.position));
    let consumed = 0, prior: RouteSegment | null = null;
    while (total - consumed > EPSILON) {
      const amount = Math.min(total - consumed, remainingMeters), partStart = pointAlong(start, end, consumed), partEnd = pointAlong(start, end, consumed + amount);
      const segment: RouteSegment = { id: nextId(system === "sprinkler" ? "sprinkler" : "conduit"), type: segmentType(system), system, diameterMm, start: partStart, end: partEnd, createdAt: new Date().toISOString() };
      segments.push(segment); parts.push(segment);
      if (prior) couplingSpecs.push({ point: copyPoint(partStart), left: prior, right: segment });
      prior = segment; consumed += amount; remainingMeters -= amount;
      if (remainingMeters <= EPSILON) remainingMeters = stockLengthMm / 1000;
    }
    legParts.push(parts);
  }

  const fittings: RouteFitting[] = [];
  for (const spec of couplingSpecs) {
    const id = nextId("coupling"), direction = normalize(subtract(spec.right.end.position, spec.right.start.position)), ports = [port(id, 0, spec.point, scale(direction, -1), spec.left.id, system), port(id, 1, spec.point, direction, spec.right.id, system)];
    bindPort(spec.left, false, ports[0]); bindPort(spec.right, true, ports[1]);
    fittings.push({ id, type: fittingType(system), fitting: "coupling", system, diameterMm, position: copyPoint(spec.point), segmentIds: [spec.left.id, spec.right.id], ports });
  }
  const cornerFittings = new Map<number, RouteFitting>();
  corners.forEach((corner, index) => {
    if (corner.style === "none") return;
    const priorParts = legParts[index], left = priorParts?.[priorParts.length - 1], right = legParts[index + 1]?.[0];
    if (!left || !right) return;
    const id = nextId("elbow"), ports = [port(id, 0, left.end, subtract(left.start.position, left.end.position), left.id, system), port(id, 1, right.start, subtract(right.end.position, right.start.position), right.id, system)];
    bindPort(left, false, ports[0]); bindPort(right, true, ports[1]);
    const fitting: RouteFitting = { id, type: fittingType(system), fitting: "elbow", bendStyle: corner.style, radiusMm: corner.radiusMm, arc: corner.arc, system, diameterMm, position: copyPoint(corner.point), segmentIds: [left.id, right.id], ports };
    fittings.push(fitting); cornerFittings.set(index, fitting);
  });
  for (const spec of cornerBreaks) {
    const elbow = cornerFittings.get(spec.cornerIndex);
    if (!elbow) continue;
    const id = nextId("coupling"), direction = normalize(subtract(spec.left.end.position, spec.left.start.position)), ports = [port(id, 0, spec.point, scale(direction, -1), spec.left.id, system), port(id, 1, spec.point, direction, elbow.id, system)];
    ports[1].connectedPortId = elbow.ports[0]?.id; if (elbow.ports[0]) elbow.ports[0].connectedPortId = ports[1].id;
    bindPort(spec.left, false, ports[0]); fittings.push({ id, type: fittingType(system), fitting: "coupling", system, diameterMm, position: copyPoint(spec.point), segmentIds: [spec.left.id], ports });
  }

  const surfaceChases: SurfaceChase[] = [];
  if (isElectrical(system) && mode === "surface") for (const segment of segments) {
    const hosts = [segment.start.attachment, segment.end.attachment].filter((host): host is HostAttachment => Boolean(host && (host.hostKind === "wall" || host.hostKind === "slab")));
    for (const host of hosts.filter((candidate, hostIndex) => hosts.findIndex((item) => item.hostId === candidate.hostId) === hostIndex)) surfaceChases.push({ id: nextId("chase"), type: "surface-chase", hostId: host.hostId, hostKind: host.hostKind as "wall" | "slab", surfaceNormal: [...host.normal] as Vec3, routeElementId: segment.id, path: { kind: "line", start: copyPoint(segment.start), end: copyPoint(segment.end) }, widthMm: parameters.chaseWidthMm, depthMm: parameters.chaseDepthMm });
  }
  if (isElectrical(system) && mode === "surface") corners.forEach((corner, index) => {
    if (!corner.arc) return;
    const fitting = cornerFittings.get(index);
    if (!fitting) return;
    const hosts = [points[index].attachment, points[index + 1].attachment, points[index + 2].attachment].filter((host): host is HostAttachment => Boolean(host && (host.hostKind === "wall" || host.hostKind === "slab")));
    for (const host of hosts.filter((candidate, hostIndex) => hosts.findIndex((item) => item.hostId === candidate.hostId) === hostIndex)) surfaceChases.push({ id: nextId("chase"), type: "surface-chase", hostId: host.hostId, hostKind: host.hostKind as "wall" | "slab", surfaceNormal: [...host.normal] as Vec3, routeElementId: fitting.id, path: { kind: "arc", arc: { ...corner.arc, start: [...corner.arc.start] as Vec3, end: [...corner.arc.end] as Vec3, center: [...corner.arc.center] as Vec3, normal: [...corner.arc.normal] as Vec3 } }, widthMm: parameters.chaseWidthMm, depthMm: parameters.chaseDepthMm });
  });
  const legacyRequests: PenetrationRequest[] = mode === "penetrate" ? segments.flatMap((segment) => [segment.start, segment.end].flatMap((entry) => entry.attachment ? [{ host: entry.attachment, entry, exit: entry, direction: entry.attachment.normal }] : [])) : [];
  const penetrations: Penetration[] = [];
  for (const request of [...legacyRequests, ...explicitPenetrations]) {
    const segment = segments.find((candidate) => [candidate.start, candidate.end].some((endpoint) => length(subtract(endpoint.position, request.entry.position)) < EPSILON || length(subtract(endpoint.position, request.exit.position)) < EPSILON)) ?? segments[0];
    if (!segment || penetrations.some((item) => item.hostId === request.host.hostId && length(subtract(item.entry.position, request.entry.position)) < EPSILON)) continue;
    penetrations.push({ id: nextId("penetration"), type: "penetration", hostId: request.host.hostId, hostKind: request.host.hostKind, segmentId: segment.id, entry: copyPoint(request.entry), exit: copyPoint(request.exit), direction: normalize(request.direction), diameterMm: parameters.penetrationDiameterMm });
  }
  return { system, diameterMm, mode, points: points.map(copyPoint), segments, fittings, junctionBoxes: [], surfaceChases, penetrations, diagnostics, canCommit: diagnostics.length === 0 };
}

export function commitPlannedRoute(overlay: ConduitOverlayDocument, plan: PlannedRoute): ConduitOverlayDocument {
  if (!plan.canCommit) return overlay;
  return { ...overlay, segments: [...overlay.segments, ...plan.segments], fittings: [...overlay.fittings, ...plan.fittings], junctionBoxes: [...overlay.junctionBoxes, ...plan.junctionBoxes], surfaceChases: [...overlay.surfaceChases, ...plan.surfaceChases], penetrations: [...overlay.penetrations, ...plan.penetrations] };
}

/** Legacy helper retained for callers; the editor uses the full branch route. */
export function branchAtSegment(overlay: ConduitOverlayDocument, segmentId: string, point: RoutePoint, branchEnd: RoutePoint): ConduitOverlayDocument {
  return commitBranchRoute(overlay, segmentId, [point, branchEnd], defaultConstructionParameters(overlay.segments.find((item) => item.id === segmentId)?.diameterMm ?? 20));
}

/** Plans the continuation from a physical branch-node port, rather than through its body. */
export function planBranchContinuation(overlay: ConduitOverlayDocument, segmentId: string, branchPoints: RoutePoint[], parameters: ConstructionVisualParameters, explicitPenetrations: PenetrationRequest[] = []): PlannedRoute | null {
  const target = overlay.segments.find((segment) => segment.id === segmentId);
  if (!target || target.system === "network" || target.legacyUnrooted || branchPoints.length < 2) return null;
  const center = branchPoints[0], mainDirection = normalize(subtract(target.end.position, target.start.position)), branchDirection = normalize(subtract(branchPoints[1].position, center.position)), electrical = isElectrical(target.system);
  const halfSize = electrical ? overlay.settings.junctionBoxSizeMm[0] / 2000 : target.diameterMm / 1000;
  const branchPortPoint = { ...copyPoint(center), position: add(center.position, scale(branchDirection, halfSize)) };
  return planRoute(target.system, target.diameterMm, target.system === "sprinkler" ? "suspended" : "surface", [branchPortPoint, ...branchPoints.slice(1)], parameters, explicitPenetrations, { bendRadiusMm: overlay.settings.bendRadiusMm, stockLengthMm: overlay.settings.stockLengthMm });
}

export function commitBranchRoute(overlay: ConduitOverlayDocument, segmentId: string, branchPoints: RoutePoint[], parameters: ConstructionVisualParameters, explicitPenetrations: PenetrationRequest[] = []): ConduitOverlayDocument {
  const target = overlay.segments.find((segment) => segment.id === segmentId);
  if (!target || target.system === "network" || target.legacyUnrooted || branchPoints.length < 2) return overlay;
  const center = branchPoints[0], mainDirection = normalize(subtract(target.end.position, target.start.position)), branchDirection = normalize(subtract(branchPoints[1].position, center.position)), electrical = isElectrical(target.system);
  const halfSize = electrical ? overlay.settings.junctionBoxSizeMm[0] / 2000 : target.diameterMm / 1000;
  const leftPoint = { ...copyPoint(center), position: add(center.position, scale(mainDirection, -halfSize)) }, rightPoint = { ...copyPoint(center), position: add(center.position, scale(mainDirection, halfSize)) }, branchPortPoint = { ...copyPoint(center), position: add(center.position, scale(branchDirection, halfSize)) };
  const first: RouteSegment = { ...target, id: nextId("split"), end: leftPoint, endPortId: undefined }, second: RouteSegment = { ...target, id: nextId("split"), start: rightPoint, startPortId: undefined };
  const route = planBranchContinuation(overlay, segmentId, branchPoints, parameters, explicitPenetrations);
  if (!route || !route.canCommit || !route.segments[0]) return overlay;
  const branchFirst = route.segments[0], nodeId = nextId(electrical ? "box86" : "tee"), ownerKind = electrical ? "junction-box" as const : "fitting" as const, nodePorts = [port(nodeId, 0, leftPoint, scale(mainDirection, -1), first.id, target.system, ownerKind), port(nodeId, 1, rightPoint, mainDirection, second.id, target.system, ownerKind), port(nodeId, 2, branchPortPoint, branchDirection, branchFirst.id, target.system, ownerKind)];
  bindPort(first, false, nodePorts[0]); bindPort(second, true, nodePorts[1]); bindPort(branchFirst, true, nodePorts[2]);
  const replacementForPort = (position: RoutePoint) => length(subtract(position.position, target.start.position)) <= length(subtract(position.position, target.end.position)) ? first.id : second.id;
  const remapFitting = (fitting: RouteFitting): RouteFitting => ({ ...fitting, segmentIds: fitting.segmentIds.map((id) => id === segmentId ? replacementForPort(fitting.position) : id), ports: fitting.ports.map((value) => value.segmentId === segmentId ? { ...value, segmentId: replacementForPort(value.position), connectedSegmentIds: value.connectedSegmentIds.map((id) => id === segmentId ? replacementForPort(value.position) : id) } : value) });
  const retainedFittings = overlay.fittings.map(remapFitting);
  const fittings: RouteFitting[] = electrical ? retainedFittings : [...retainedFittings, { id: nodeId, type: "sprinkler-fitting", fitting: "tee", system: target.system, diameterMm: target.diameterMm, position: copyPoint(center), segmentIds: [first.id, second.id, branchFirst.id], ports: nodePorts }];
  const remappedBoxes = overlay.junctionBoxes.map((box) => ({ ...box, segmentIds: box.segmentIds.map((id) => id === segmentId ? replacementForPort(box.position) : id), ports: box.ports.map((value) => value.segmentId === segmentId ? { ...value, segmentId: replacementForPort(value.position), connectedSegmentIds: value.connectedSegmentIds.map((id) => id === segmentId ? replacementForPort(value.position) : id) } : value) }));
  const junctionBoxes: JunctionBox[] = electrical ? [...remappedBoxes, { id: nodeId, type: "junction-box", system: target.system as Exclude<RoutingSystem, "sprinkler">, position: copyPoint(center), sizeMm: [...overlay.settings.junctionBoxSizeMm], segmentIds: [first.id, second.id, branchFirst.id], ports: nodePorts }] : remappedBoxes;
  const splitChases = overlay.surfaceChases.flatMap((chase) => chase.routeElementId !== segmentId || chase.path.kind !== "line" ? [chase] : [{ ...chase, id: nextId("chase"), routeElementId: first.id, path: { kind: "line" as const, start: chase.path.start, end: copyPoint(leftPoint) } }, { ...chase, id: nextId("chase"), routeElementId: second.id, path: { kind: "line" as const, start: copyPoint(rightPoint), end: chase.path.end } }]);
  const penetrations = overlay.penetrations.map((penetration) => penetration.segmentId !== segmentId ? penetration : ({ ...penetration, segmentId: length(subtract(penetration.entry.position, target.start.position)) <= length(subtract(center.position, target.start.position)) ? first.id : second.id }));
  const routedSegments = [first, second, ...route.segments].map((segment) => ({ ...segment, circuitId: target.circuitId, legacyUnrooted: target.legacyUnrooted }));
  return { ...overlay, segments: overlay.segments.flatMap((segment) => segment.id === segmentId ? routedSegments : [segment]), fittings: [...fittings, ...route.fittings], junctionBoxes, circuits: overlay.circuits.map((circuit) => circuit.id === target.circuitId ? { ...circuit, segmentIds: circuit.segmentIds.flatMap((id) => id === segmentId ? routedSegments.map((item) => item.id) : [id]) } : circuit), surfaceChases: [...splitChases, ...route.surfaceChases], penetrations: [...penetrations, ...route.penetrations] };
}

/** Removes a network member and every dependency that can no longer exist. */
export function deleteNetworkObject(overlay: ConduitOverlayDocument, id: string): ConduitOverlayDocument {
  const device = overlay.devices.find((item) => item.id === id), removedCircuitIds = new Set(overlay.circuits.filter((circuit) => circuit.sourceDeviceId === id).map((circuit) => circuit.id));
  const connectedSegmentIds = new Set([...(overlay.fittings.find((fitting) => fitting.id === id)?.segmentIds ?? []), ...(overlay.junctionBoxes.find((box) => box.id === id)?.segmentIds ?? []), ...(device?.ports.flatMap((port) => port.connectedSegmentIds) ?? []), ...overlay.segments.filter((segment) => segment.circuitId && removedCircuitIds.has(segment.circuitId)).map((segment) => segment.id)]);
  const segments = overlay.segments.filter((segment) => segment.id !== id && !connectedSegmentIds.has(segment.id)), remainingIds = new Set(segments.map((segment) => segment.id)), removedIds = new Set(overlay.segments.filter((segment) => !remainingIds.has(segment.id)).map((segment) => segment.id));
  const remainingFittings = overlay.fittings.filter((fitting) => fitting.id !== id && fitting.segmentIds.every((segmentId) => remainingIds.has(segmentId))), remainingElementIds = new Set([...remainingIds, ...remainingFittings.map((fitting) => fitting.id)]);
  const devices = overlay.devices.filter((item) => item.id !== id).map((item) => ({ ...item, ports: item.ports.map((port) => ({ ...port, connectedSegmentIds: port.connectedSegmentIds.filter((segmentId) => remainingIds.has(segmentId)) })) }));
  return { ...overlay, segments, fittings: remainingFittings, junctionBoxes: overlay.junctionBoxes.filter((box) => box.id !== id && box.segmentIds.every((segmentId) => remainingIds.has(segmentId))), devices, circuits: overlay.circuits.filter((circuit) => !removedCircuitIds.has(circuit.id)).map((circuit) => ({ ...circuit, segmentIds: circuit.segmentIds.filter((segmentId) => remainingIds.has(segmentId)), status: circuit.segmentIds.some((segmentId) => removedIds.has(segmentId)) ? "broken" : circuit.status })), surfaceChases: overlay.surfaceChases.filter((chase) => chase.id !== id && remainingElementIds.has(chase.routeElementId)), penetrations: overlay.penetrations.filter((penetration) => penetration.id !== id && !removedIds.has(penetration.segmentId)) };
}

export function resetRoutingIdsForTests() { sequence = 0; }
