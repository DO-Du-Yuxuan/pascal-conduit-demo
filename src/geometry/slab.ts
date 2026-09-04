import { NodeData } from "../types";

export type SlabPoint = { x: number; z: number };
export type SlabPlanGeometry = {
  outer: SlabPoint[];
  holes: SlabPoint[][];
  path: string;
  outerArea: number;
  holeArea: number;
  netArea: number;
};

function ring(points: unknown): SlabPoint[] | null {
  if (!Array.isArray(points) || points.length < 3) return null;
  const result = points.map((point) => {
    if (!Array.isArray(point)) return null;
    const x = point[0], z = point[2] ?? point[1];
    return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
  });
  return result.every(Boolean) ? (result as SlabPoint[]) : null;
}

export function polygonArea(points: SlabPoint[]) {
  return Math.abs(points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return area + point.x * next.z - next.x * point.z;
  }, 0) / 2);
}

function pathForRing(points: SlabPoint[]) {
  return `M ${points.map((point) => `${point.x} ${point.z}`).join(" L ")} Z`;
}

/** Uses stored Pascal rings directly; no wall-derived boundary healing is applied. */
export function buildSlabPlanGeometry(node: NodeData): SlabPlanGeometry | null {
  const outer = ring(node.polygon);
  if (!outer) return null;
  const holes = (Array.isArray(node.holes) ? node.holes : [])
    .map(ring)
    .filter((hole): hole is SlabPoint[] => hole !== null);
  const outerArea = polygonArea(outer);
  const holeArea = holes.reduce((sum, hole) => sum + polygonArea(hole), 0);
  return {
    outer,
    holes,
    path: [pathForRing(outer), ...holes.map(pathForRing)].join(" "),
    outerArea,
    holeArea,
    netArea: outerArea - holeArea,
  };
}

export function slabCorners(node: NodeData) {
  return buildSlabPlanGeometry(node)?.outer ?? [];
}
