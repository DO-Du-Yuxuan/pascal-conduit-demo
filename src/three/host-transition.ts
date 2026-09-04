import { getWallCurveFrameAt, isCurvedWall } from "../geometry/walls/curve";
import type { NodeData } from "../types";
import type { HostAttachment, Vec3 } from "../domain/overlay";
import type { ThreeDSurfaceHit } from "./PascalScenePreview";

export type WallHostCandidate = { node: NodeData; levelId: string | null; openings: Array<{ center: number; width: number }> };

const planPoint = (value: unknown): [number, number] | null => Array.isArray(value) && Number.isFinite(value[0]) && Number.isFinite(value[1]) ? [Number(value[0]), Number(value[1])] : null;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function closestPoint(point: [number, number], start: [number, number], end: [number, number]) {
  const dx = end[0] - start[0], dz = end[1] - start[1], lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared < 1e-12 ? 0 : clamp(((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared);
  const x = start[0] + dx * t, z = start[1] + dz * t;
  return { t, x, z, distance: Math.hypot(point[0] - x, point[1] - z) };
}

/**
 * Converts an attached floor/ceiling cursor into a wall cursor when it reaches
 * a shared boundary. This is geometric adjacency, not a screen-ray accident,
 * so it works for horizontal, vertical and curved walls equally.
 */
export function transitionToAdjacentWall(hit: ThreeDSurfaceHit, walls: WallHostCandidate[], toleranceMeters = .14): ThreeDSurfaceHit {
  if (hit.attachment.hostKind !== "slab" && hit.attachment.hostKind !== "ceiling") return hit;
  const point: [number, number] = [hit.point[0], hit.point[2]];
  let nearest: { candidate: WallHostCandidate; t: number; x: number; z: number; distance: number; tangent: [number, number] } | null = null;
  for (const candidate of walls) {
    if (candidate.levelId !== hit.attachment.levelId) continue;
    const start = planPoint(candidate.node.start), end = planPoint(candidate.node.end);
    if (!start || !end) continue;
    const steps = isCurvedWall(candidate.node as any) ? 24 : 1;
    for (let index = 0; index < steps; index += 1) {
      const first = getWallCurveFrameAt(candidate.node as any, index / steps), second = getWallCurveFrameAt(candidate.node as any, (index + 1) / steps);
      const closest = closestPoint(point, [first.point.x, first.point.y], [second.point.x, second.point.y]);
      const t = (index + closest.t) / steps;
      if (closest.distance > toleranceMeters || nearest && closest.distance >= nearest.distance) continue;
      const frame = getWallCurveFrameAt(candidate.node as any, t);
      const chordLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
      const along = t * chordLength;
      if (candidate.openings.some((opening) => along >= opening.center - opening.width / 2 && along <= opening.center + opening.width / 2)) continue;
      nearest = { candidate, t, x: closest.x, z: closest.z, distance: closest.distance, tangent: [frame.tangent.x, frame.tangent.y] };
    }
  }
  if (!nearest) return hit;
  let normal: Vec3 = [-nearest.tangent[1], 0, nearest.tangent[0]];
  const fromWall: Vec3 = [hit.point[0] - nearest.x, 0, hit.point[2] - nearest.z];
  if (normal[0] * fromWall[0] + normal[2] * fromWall[2] < 0) normal = [-normal[0], 0, -normal[2]];
  const attachment: HostAttachment = {
    hostId: nearest.candidate.node.id,
    hostKind: "wall",
    surface: "interior",
    normal,
    levelId: nearest.candidate.levelId,
    localPosition: [nearest.t * Math.hypot((nearest.candidate.node.end?.[0] ?? 0) - (nearest.candidate.node.start?.[0] ?? 0), (nearest.candidate.node.end?.[1] ?? 0) - (nearest.candidate.node.start?.[1] ?? 0)), hit.point[1], 0],
    basis: { u: [nearest.tangent[0], 0, nearest.tangent[1]], v: [0, 1, 0] },
    curveT: isCurvedWall(nearest.candidate.node as any) ? nearest.t : undefined,
    wallSide: "interior",
  };
  return { ...hit, point: [nearest.x, hit.point[1], nearest.z], attachment };
}
