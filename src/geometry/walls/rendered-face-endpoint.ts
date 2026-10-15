import { calculateLevelMiters } from "./miter";
import { getWallPlanFootprint } from "./footprint";
import type { Wall } from "./types";

export type WallPlanInput = Pick<Wall, "id" | "start" | "end"> & { thickness?: number };

/** Return the endpoint of the selected side of a wall's actual Builder plan footprint. */
export function renderedWallFaceEndpoint(
  wallId: string,
  hit: readonly [number, number],
  sideNormal: readonly [number, number],
  sameLevelWalls: readonly WallPlanInput[],
): [number, number] | undefined {
  const source = sameLevelWalls.find((wall) => wall.id === wallId);
  // A missing thickness is insufficient evidence for a rendered face offset.
  if (!source || !Number.isFinite(source.thickness) || source.thickness! <= 0) return undefined;
  const walls = sameLevelWalls as Wall[];
  const miters = calculateLevelMiters(walls);
  const startDistance = Math.hypot(hit[0] - source.start[0]!, hit[1] - source.start[1]!);
  const endDistance = Math.hypot(hit[0] - source.end[0]!, hit[1] - source.end[1]!);
  const start = startDistance <= endDistance;
  const dx = source.end[0]! - source.start[0]!, dz = source.end[1]! - source.start[1]!, length = Math.hypot(dx, dz);
  if (length < 1e-8) return undefined;
  const positiveNormal: [number, number] = [-dz / length, dx / length];
  const direction = positiveNormal[0] * sideNormal[0] + positiveNormal[1] * sideNormal[1] >= 0 ? 1 : -1;
  const endpoint = start ? source.start : source.end;
  const footprint = getWallPlanFootprint(source as Wall, miters);
  const endpointCandidates = footprint.filter(candidate => Math.hypot(candidate.x - endpoint[0]!, candidate.y - endpoint[1]!) <= Math.max((source.thickness ?? 0.1) * 5, 0.01));
  const candidates = endpointCandidates.reduce((best, candidate) => {
    const score = (candidate.x - endpoint[0]!) * positiveNormal[0] * direction + (candidate.y - endpoint[1]!) * positiveNormal[1] * direction;
    return !best || score > best.score ? { point: candidate, score } : best;
  }, undefined as { point: { x: number; y: number }; score: number } | undefined)?.point;
  if (!candidates) return undefined;
  const progress = (hit[0] - source.start[0]!) * dx / length + (hit[1] - source.start[1]!) * dz / length;
  const alongEndpointDistance = start ? Math.abs(progress) : Math.abs(length - progress);
  const halfThickness = source.thickness! / 2;
  const crossDistance = Math.abs((hit[0] - source.start[0]!) * positiveNormal[0] + (hit[1] - source.start[1]!) * positiveNormal[1]);
  const centerlineEndHit = alongEndpointDistance <= 0.001 && crossDistance <= halfThickness + 0.003;
  const renderedMiterVertexHit = Math.hypot(hit[0] - candidates.x, hit[1] - candidates.y) <= 0.003;
  if (!centerlineEndHit && !renderedMiterVertexHit) return undefined;
  return [candidates.x, candidates.y];
}
