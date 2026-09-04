import type { ConduitOverlayDocument, Penetration, RouteFitting, RoutePoint, RouteSegment, RoutingSystem, SurfaceMode, WallChase } from "./overlay";

let sequence = 0;
const nextId = (prefix: string) => `${prefix}_${(++sequence).toString(36)}`;
const copyPoint = (point: RoutePoint): RoutePoint => {
  const attachment = point.attachment ? { ...point.attachment, normal: [...point.attachment.normal] as [number, number, number] } : undefined;
  return attachment ? { position: [...point.position] as RoutePoint["position"], attachment } : { position: [...point.position] as RoutePoint["position"] };
};
const segmentType = (system: RoutingSystem) => system === "sprinkler" ? "sprinkler-segment" as const : "conduit-segment" as const;
const fittingType = (system: RoutingSystem) => system === "sprinkler" ? "sprinkler-fitting" as const : "conduit-fitting" as const;
const isElectrical = (system: RoutingSystem) => system !== "sprinkler";

export type PlannedRoute = {
  system: RoutingSystem;
  diameterMm: number;
  mode: SurfaceMode;
  points: RoutePoint[];
  segments: RouteSegment[];
  fittings: RouteFitting[];
  wallChases: WallChase[];
  penetrations: Penetration[];
};

export type ConstructionVisualParameters = { chaseWidthMm: number; chaseDepthMm: number; penetrationDiameterMm: number };
const defaultConstructionParameters = (diameterMm: number): ConstructionVisualParameters => ({ chaseWidthMm: diameterMm + 10, chaseDepthMm: diameterMm + 5, penetrationDiameterMm: diameterMm + 10 });

export function planRoute(system: RoutingSystem, diameterMm: number, mode: SurfaceMode, points: RoutePoint[], parameters = defaultConstructionParameters(diameterMm), explicitPenetrationPoints: RoutePoint[] = []): PlannedRoute {
  if (points.length < 2) throw new Error("至少需要两个路由点。");
  const segments = points.slice(0, -1).map((start, index): RouteSegment => ({
    id: nextId(system === "sprinkler" ? "sprinkler" : "conduit"), type: segmentType(system), system, diameterMm,
    start: copyPoint(start), end: copyPoint(points[index + 1]), createdAt: new Date().toISOString(),
  }));
  const fittings = points.slice(1, -1).map((point, index): RouteFitting => ({
    id: nextId("elbow"), type: fittingType(system), fitting: "elbow", system, diameterMm, position: copyPoint(point), segmentIds: [segments[index].id, segments[index + 1].id],
  }));
  const wallChases: WallChase[] = [];
  if (isElectrical(system) && mode === "surface") for (const segment of segments) {
    const a = segment.start.attachment, b = segment.end.attachment;
    if (a?.hostKind === "wall" && a.hostId === b?.hostId) wallChases.push({ id: nextId("chase"), type: "wall-chase", wallId: a.hostId, segmentId: segment.id, start: copyPoint(segment.start), end: copyPoint(segment.end), widthMm: parameters.chaseWidthMm, depthMm: parameters.chaseDepthMm });
  }
  const penetrations: Penetration[] = [];
  const penetrationCandidates = mode === "penetrate" ? segments.flatMap((segment) => [segment.start, segment.end]) : explicitPenetrationPoints;
  for (const point of penetrationCandidates) {
    const host = point.attachment;
    const segment = segments.find((candidate) => candidate.start === point || candidate.end === point) ?? segments.find((candidate) => candidate.start.position.every((value, index) => value === point.position[index]) || candidate.end.position.every((value, index) => value === point.position[index]));
    const duplicate = mode !== "penetrate" && penetrations.some((item) => item.hostId === host?.hostId && item.point.position.every((value, index) => value === point.position[index]));
    if (host && segment && !duplicate) penetrations.push({ id: nextId("penetration"), type: "penetration", hostId: host.hostId, hostKind: host.hostKind, segmentId: segment.id, point: copyPoint(point), diameterMm: parameters.penetrationDiameterMm });
  }
  return { system, diameterMm, mode, points: points.map(copyPoint), segments, fittings, wallChases, penetrations };
}

export function commitPlannedRoute(overlay: ConduitOverlayDocument, plan: PlannedRoute): ConduitOverlayDocument {
  return { ...overlay, segments: [...overlay.segments, ...plan.segments], fittings: [...overlay.fittings, ...plan.fittings], wallChases: [...overlay.wallChases, ...plan.wallChases], penetrations: [...overlay.penetrations, ...plan.penetrations] };
}

export function branchAtSegment(overlay: ConduitOverlayDocument, segmentId: string, point: RoutePoint, branchEnd: RoutePoint): ConduitOverlayDocument {
  const target = overlay.segments.find((segment) => segment.id === segmentId);
  if (!target) throw new Error("目标管段不存在。");
  const originalFittings = overlay.fittings.filter((fitting) => !fitting.segmentIds.includes(segmentId));
  const first: RouteSegment = { ...target, id: nextId("split"), end: copyPoint(point) };
  const second: RouteSegment = { ...target, id: nextId("split"), start: copyPoint(point) };
  const branch: RouteSegment = { id: nextId(target.system === "sprinkler" ? "sprinkler" : "conduit"), type: segmentType(target.system), system: target.system, diameterMm: target.diameterMm, start: copyPoint(point), end: copyPoint(branchEnd), createdAt: new Date().toISOString() };
  const tee: RouteFitting = { id: nextId("tee"), type: fittingType(target.system), fitting: "tee", system: target.system, diameterMm: target.diameterMm, position: copyPoint(point), segmentIds: [first.id, second.id, branch.id] };
  return { ...overlay, segments: overlay.segments.flatMap((segment) => segment.id === segmentId ? [first, second, branch] : [segment]), fittings: [...originalFittings, tee] };
}

export function resetRoutingIdsForTests() { sequence = 0; }
