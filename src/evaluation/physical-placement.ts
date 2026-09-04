import polygonClipping from "polygon-clipping";
import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { polygonArea, rectangularFootprint, type Ring } from "./envelope";
import { G1_GEOMETRY_TOLERANCES as T } from "./tolerances";
import { hasFunctionTag } from "./object-semantics";

type Item = EvaluationHandoff["furniture"][number] | EvaluationHandoff["equipment"][number] | EvaluationHandoff["columns"][number];
type Shelf = EvaluationHandoff["shelves"][number];
export type PlacementEntity = Item | Shelf;
type VerticalRange = [number, number];

export type WallPenetration = {
  item: PlacementEntity;
  wall: EvaluationHandoff["walls"][number];
  overlapAreaSquareMeters: number;
  penetrationDepthMeters: number | null;
  verticalOverlapMeters: number;
};

export type ItemCollision = {
  primary: PlacementEntity;
  related: PlacementEntity;
  overlapAreaSquareMeters: number;
  planarPenetrationDepthMeters: number;
  verticalOverlapMeters: number;
  overlapVolumeCubicMeters: number;
};

export type PlacementCollisionAnalysis = {
  wallPenetrations: WallPenetration[];
  itemCollisions: ItemCollision[];
  unresolvedPlanarOverlaps: Array<{ itemIds: string[]; reason: string }>;
};

const closed = (ring: Ring) => ring.length > 2 ? [...ring, ring[0]!] : ring;
const multiArea = (multi: Ring[][]) => multi.reduce((sum, polygon) => sum + polygonArea(polygon[0] ?? []), 0);
const intersectionArea = (a: Ring, b: Ring) => {
  try { return multiArea(polygonClipping.intersection([closed(a)] as any, [closed(b)] as any) as Ring[][]); }
  catch { return null; }
};
const planarPenetrationDepth = (a: Ring, b: Ring) => {
  const axes = [a, b].flatMap((ring) => ring.map((point, index) => {
    const next = ring[(index + 1) % ring.length]!, dx = next[0] - point[0], dz = next[1] - point[1], length = Math.hypot(dx, dz);
    return length > T.lengthMeters ? [-dz / length, dx / length] as [number, number] : null;
  }).filter((axis): axis is [number, number] => Boolean(axis)));
  if (!axes.length) return null;
  let minimum = Number.POSITIVE_INFINITY;
  for (const [axisX, axisZ] of axes) {
    const project = (ring: Ring) => ring.map(([x, z]) => x * axisX + z * axisZ), projectionsA = project(a), projectionsB = project(b), overlap = Math.min(Math.max(...projectionsA), Math.max(...projectionsB)) - Math.max(Math.min(...projectionsA), Math.min(...projectionsB));
    if (overlap <= T.lengthMeters) return 0;
    minimum = Math.min(minimum, overlap);
  }
  return Number.isFinite(minimum) ? minimum : null;
};
const isShelf = (item: PlacementEntity): item is Shelf => "footprint" in item && "style" in item;
export const placementFootprint = (item: PlacementEntity): Ring | null => isShelf(item) ? item.footprint.length >= 3 ? item.footprint as Ring : null : rectangularFootprint(item);
const verticalRange = (item: PlacementEntity): VerticalRange | null => {
  const explicit = item.resolvedVerticalRangeMeters;
  if (Array.isArray(explicit) && explicit.length >= 2 && explicit.every(Number.isFinite) && explicit[1] > explicit[0]) return [explicit[0], explicit[1]];
  const y = item.rawPosition?.[1], height = item.dimensionsMeters?.[1];
  return Number.isFinite(y) && Number.isFinite(height) && height! > 0 ? [y!, y! + height!] : null;
};
const verticalOverlap = (a: VerticalRange, b: VerticalRange) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
const ancestorRelated = (a: PlacementEntity, b: PlacementEntity) => a.parentId === b.id || b.parentId === a.id;
const needsMeshInsteadOfBox = (a: PlacementEntity, b: PlacementEntity) => {
  if (isShelf(a) || isShelf(b)) return false;
  const chair = (item: PlacementEntity) => hasFunctionTag(item, "dining-chairs", "office-chairs", "chairs", "stools"), workSurface = (item: PlacementEntity) => hasFunctionTag(item, "dining-tables", "desks", "coffee-tables", "counters", "kitchen-islands"), integratedAppliance = (item: PlacementEntity) => hasFunctionTag(item, "stoves", "cooktops", "ovens"), cabinet = (item: PlacementEntity) => hasFunctionTag(item, "cabinets", "base-cabinets", "kitchen-islands");
  return chair(a) && workSurface(b) || chair(b) && workSurface(a) || integratedAppliance(a) && cabinet(b) || integratedAppliance(b) && cabinet(a);
};

function straightWallPenetrationDepth(itemFootprint: Ring, item: PlacementEntity, wall: EvaluationHandoff["walls"][number]) {
  if (!wall.start || !wall.end || Math.abs(wall.curveOffsetMeters) > T.lengthMeters || !item.resolvedWorldPosition) return null;
  const dx = wall.end[0] - wall.start[0], dz = wall.end[1] - wall.start[1], length = Math.hypot(dx, dz);
  if (length <= T.lengthMeters) return null;
  const nx = -dz / length, nz = dx / length, signed = ([x, z]: number[]) => (x - wall.start![0]) * nx + (z - wall.start![1]) * nz;
  const centerSide = signed(item.resolvedWorldPosition), projections = itemFootprint.map(signed), half = wall.thicknessMeters / 2;
  return Math.max(0, centerSide >= 0 ? half - Math.min(...projections) : Math.max(...projections) + half);
}

/** Physical-placement checks are 3D: a plan overlap is only a collision when height intervals overlap too. */
export function analyzePhysicalPlacement(handoff: EvaluationHandoff, candidates: PlacementEntity[]): PlacementCollisionAnalysis {
  const footprints = new Map(candidates.map((item) => [item.id, placementFootprint(item)]));
  const ranges = new Map(candidates.map((item) => [item.id, verticalRange(item)]));
  const wallPenetrations: WallPenetration[] = [], itemCollisions: ItemCollision[] = [], unresolvedPlanarOverlaps: PlacementCollisionAnalysis["unresolvedPlanarOverlaps"] = [];

  for (const item of candidates) {
    const footprint = footprints.get(item.id), range = ranges.get(item.id);
    if (!footprint) continue;
    for (const wall of handoff.walls) {
      if (wall.levelId !== item.levelId || !wall.footprintValidation.valid || wall.footprintValidation.footprint.length < 3) continue;
      const area = intersectionArea(footprint, wall.footprintValidation.footprint as Ring);
      if (area === null || area <= T.physicalCollisionAreaSquareMeters) continue;
      const penetrationDepth = straightWallPenetrationDepth(footprint, item, wall);
      if (penetrationDepth !== null && penetrationDepth <= T.physicalCollisionPenetrationMeters) continue;
      if (!range || !Number.isFinite(wall.heightMeters)) {
        unresolvedPlanarOverlaps.push({ itemIds: [item.id, wall.id], reason: !range ? "item_vertical_range_unavailable" : "wall_height_unavailable" });
        continue;
      }
      const heightOverlap = verticalOverlap(range, [0, wall.heightMeters!]);
      if (heightOverlap <= T.physicalCollisionVerticalMeters) continue;
      wallPenetrations.push({ item, wall, overlapAreaSquareMeters: area, penetrationDepthMeters: penetrationDepth, verticalOverlapMeters: heightOverlap });
    }
  }

  for (let index = 0; index < candidates.length; index++) for (let otherIndex = index + 1; otherIndex < candidates.length; otherIndex++) {
    const a = candidates[index]!, b = candidates[otherIndex]!;
    if (a.levelId !== b.levelId || ancestorRelated(a, b)) continue;
    const footprintA = footprints.get(a.id), footprintB = footprints.get(b.id);
    if (!footprintA || !footprintB) continue;
    const area = intersectionArea(footprintA, footprintB);
    if (area === null || area <= T.physicalCollisionAreaSquareMeters) continue;
    const penetrationDepth = planarPenetrationDepth(footprintA, footprintB);
    if (penetrationDepth === null || penetrationDepth <= T.physicalCollisionPenetrationMeters) continue;
    const rangeA = ranges.get(a.id), rangeB = ranges.get(b.id);
    if (!rangeA || !rangeB) { unresolvedPlanarOverlaps.push({ itemIds: [a.id, b.id], reason: "item_vertical_range_unavailable" }); continue; }
    const heightOverlap = verticalOverlap(rangeA, rangeB);
    if (heightOverlap <= T.physicalCollisionVerticalMeters) continue;
    if (needsMeshInsteadOfBox(a, b)) { unresolvedPlanarOverlaps.push({ itemIds: [a.id, b.id], reason: "mesh_geometry_required_for_nestable_pair" }); continue; }
    const areaA = polygonArea(footprintA), areaB = polygonArea(footprintB), [primary, related] = areaA >= areaB ? [a, b] : [b, a];
    itemCollisions.push({ primary, related, overlapAreaSquareMeters: area, planarPenetrationDepthMeters: penetrationDepth, verticalOverlapMeters: heightOverlap, overlapVolumeCubicMeters: area * heightOverlap });
  }
  return { wallPenetrations, itemCollisions, unresolvedPlanarOverlaps };
}
