import { getWallCurveFrameAt, isCurvedWall } from "../geometry/walls/curve";
import type { NodeData } from "../types";
import type { HostAttachment, RoutePoint, Vec3 } from "../domain/overlay";
import type { ThreeDSurfaceHit } from "./PascalScenePreview";

export type WallHostCandidate = { node: NodeData; levelId: string | null; openings: Array<{ center: number; width: number }> };
const subtract3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a: Vec3, amount: number): Vec3 => [a[0] * amount, a[1] * amount, a[2] * amount];

/** Snaps a hit on an adjacent Beam face back to the physical edge shared with the active face. */
export function transitionToAdjacentBeamFace(start: RoutePoint, hit: RoutePoint): RoutePoint {
  const from = start.attachment, target = hit.attachment;
  if (from?.hostKind !== "beam" || !target || target.hostKind !== "beam" || from.hostId !== target.hostId || from.surface === target.surface) return hit;
  const fromFace = ["bottom", "side-a", "side-b", "end-a", "end-b"].includes(from.surface);
  const targetFace = ["bottom", "side-a", "side-b", "end-a", "end-b"].includes(target.surface);
  // Exposed faces of a rectangular Beam meet at right angles. Opposite faces
  // are parallel and cannot be joined by an edge transition.
  if (!fromFace || !targetFace || Math.abs(dot3(from.normal, target.normal)) > .001) return hit;
  const position = add3(hit.position, scale3(from.normal, dot3(subtract3(start.position, hit.position), from.normal)));
  const delta = subtract3(position, hit.position), attachment = { ...target, localPosition: target.localPosition ? [...target.localPosition] as Vec3 : undefined };
  if (attachment.localPosition && target.basis) {
    if (target.surface === "bottom") {
      attachment.localPosition[0] += dot3(delta, target.basis.v);
      attachment.localPosition[1] += delta[1];
      attachment.localPosition[2] += dot3(delta, target.basis.u);
    } else if (target.surface === "side-a" || target.surface === "side-b") {
      attachment.localPosition[1] += dot3(delta, target.basis.v);
      attachment.localPosition[2] += dot3(delta, target.basis.u);
    } else {
      attachment.localPosition[0] += dot3(delta, target.basis.u);
      attachment.localPosition[1] += dot3(delta, target.basis.v);
    }
  }
  return { ...hit, position, attachment };
}

const planPoint = (value: unknown): [number, number] | null => Array.isArray(value) && Number.isFinite(value[0]) && Number.isFinite(value[1]) ? [Number(value[0]), Number(value[1])] : null;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function closestPoint(point: [number, number], start: [number, number], end: [number, number]) {
  const dx = end[0] - start[0], dz = end[1] - start[1], lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared < 1e-12 ? 0 : clamp(((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared);
  const x = start[0] + dx * t, z = start[1] + dz * t;
  return { t, x, z, distance: Math.hypot(point[0] - x, point[1] - z) };
}

function cross(a: [number, number], b: [number, number]) { return a[0] * b[1] - a[1] * b[0]; }

function segmentIntersection(start: [number, number], end: [number, number], wallStart: [number, number], wallEnd: [number, number]) {
  const route: [number, number] = [end[0] - start[0], end[1] - start[1]], wall: [number, number] = [wallEnd[0] - wallStart[0], wallEnd[1] - wallStart[1]];
  const denominator = cross(route, wall);
  if (Math.abs(denominator) < 1e-10) return null;
  const offset: [number, number] = [wallStart[0] - start[0], wallStart[1] - start[1]];
  const routeT = cross(offset, wall) / denominator, wallT = cross(offset, route) / denominator;
  if (routeT < 1e-6 || routeT > 1 + 1e-6 || wallT < -1e-6 || wallT > 1 + 1e-6) return null;
  return { routeT: clamp(routeT), wallT: clamp(wallT), x: start[0] + route[0] * routeT, z: start[1] + route[1] * routeT };
}

/**
 * Converts an attached floor/ceiling cursor into a wall cursor when it reaches
 * a shared boundary. This is geometric adjacency, not a screen-ray accident,
 * so it works for horizontal, vertical and curved walls equally.
 */
export function transitionToAdjacentWall(hit: ThreeDSurfaceHit, walls: WallHostCandidate[], toleranceMeters = .14, previousPoint?: RoutePoint, bypassWallHostId?: string | null): ThreeDSurfaceHit {
  if (hit.attachment.hostKind !== "slab" && hit.attachment.hostKind !== "ceiling") return hit;
  const point: [number, number] = [hit.point[0], hit.point[2]];
  type Match = { candidate: WallHostCandidate; t: number; x: number; y: number; z: number; distance: number; tangent: [number, number] };
  let nearest: Match | null = null, crossed: (Match & { routeT: number }) | null = null;
  const previousPlan: [number, number] | null = previousPoint && (previousPoint.attachment?.hostKind === "slab" || previousPoint.attachment?.hostKind === "ceiling") ? [previousPoint.position[0], previousPoint.position[2]] : null;
  for (const candidate of walls) {
    if (candidate.node.id === bypassWallHostId) continue;
    if (candidate.levelId !== hit.attachment.levelId) continue;
    const start = planPoint(candidate.node.start), end = planPoint(candidate.node.end);
    if (!start || !end) continue;
    const steps = isCurvedWall(candidate.node as any) ? 24 : 1;
    for (let index = 0; index < steps; index += 1) {
      const first = getWallCurveFrameAt(candidate.node as any, index / steps), second = getWallCurveFrameAt(candidate.node as any, (index + 1) / steps);
      const closest = closestPoint(point, [first.point.x, first.point.y], [second.point.x, second.point.y]);
      const t = (index + closest.t) / steps;
      const frame = getWallCurveFrameAt(candidate.node as any, t);
      const chordLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
      const along = t * chordLength;
      const inOpening = candidate.openings.some((opening) => along >= opening.center - opening.width / 2 && along <= opening.center + opening.width / 2);
      if (!inOpening && closest.distance <= toleranceMeters && (!nearest || closest.distance < nearest.distance)) nearest = { candidate, t, x: closest.x, y: hit.point[1], z: closest.z, distance: closest.distance, tangent: [frame.tangent.x, frame.tangent.y] };
      if (!previousPlan || candidate.levelId !== previousPoint?.attachment?.levelId) continue;
      const intersection = segmentIntersection(previousPlan, point, [first.point.x, first.point.y], [second.point.x, second.point.y]);
      if (!intersection || crossed && intersection.routeT >= crossed.routeT) continue;
      const wallT = (index + intersection.wallT) / steps, intersectionFrame = getWallCurveFrameAt(candidate.node as any, wallT), intersectionAlong = wallT * chordLength;
      if (candidate.openings.some((opening) => intersectionAlong >= opening.center - opening.width / 2 && intersectionAlong <= opening.center + opening.width / 2)) continue;
      crossed = { candidate, t: wallT, x: intersection.x, y: previousPoint.position[1] + (hit.point[1] - previousPoint.position[1]) * intersection.routeT, z: intersection.z, distance: 0, tangent: [intersectionFrame.tangent.x, intersectionFrame.tangent.y], routeT: intersection.routeT };
    }
  }
  const match = crossed ?? nearest;
  if (!match) return hit;
  let normal: Vec3 = [-match.tangent[1], 0, match.tangent[0]];
  const sideReference = crossed && previousPoint ? previousPoint.position : hit.point;
  const fromWall: Vec3 = [sideReference[0] - match.x, 0, sideReference[2] - match.z];
  if (normal[0] * fromWall[0] + normal[2] * fromWall[2] < 0) normal = [-normal[0], 0, -normal[2]];
  const frameNormal: Vec3 = [-match.tangent[1], 0, match.tangent[0]];
  const front = normal[0] * frameNormal[0] + normal[2] * frameNormal[2] >= 0;
  const declaredSide = front ? match.candidate.node.frontSide : match.candidate.node.backSide;
  const wallSide = declaredSide === "exterior" ? "exterior" : "interior";
  const attachment: HostAttachment = {
    hostId: match.candidate.node.id,
    hostKind: "wall",
    surface: wallSide,
    normal,
    levelId: match.candidate.levelId,
    localPosition: [match.t * Math.hypot((match.candidate.node.end?.[0] ?? 0) - (match.candidate.node.start?.[0] ?? 0), (match.candidate.node.end?.[1] ?? 0) - (match.candidate.node.start?.[1] ?? 0)), match.y, 0],
    basis: { u: [match.tangent[0], 0, match.tangent[1]], v: [0, 1, 0] },
    curveT: isCurvedWall(match.candidate.node as any) ? match.t : undefined,
    wallSide,
  };
  return { ...hit, point: [match.x, match.y, match.z], attachment };
}
