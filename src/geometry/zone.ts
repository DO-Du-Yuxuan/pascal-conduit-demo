import { NodeData } from "../types";

export type ZonePoint = { x: number; z: number };
const palette = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316"];

export function zonePoints(node: NodeData): ZonePoint[] {
  if (!Array.isArray(node.polygon)) return [];
  return node.polygon.flatMap((point: unknown) => {
    if (!Array.isArray(point)) return [];
    const x = point[0], z = point[2] ?? point[1];
    return Number.isFinite(x) && Number.isFinite(z) ? [{ x, z }] : [];
  });
}

export function zoneColor(node: NodeData) {
  if (typeof node.color === "string" && /^#[0-9a-f]{6}$/i.test(node.color)) return node.color;
  const hash = [...node.id].reduce((value, char) => ((value * 31) + char.charCodeAt(0)) >>> 0, 0);
  return palette[hash % palette.length]!;
}

/** Area centroid for a simple polygon; falls back to the vertex average for degenerate data. */
export function zoneLabelPoint(node: NodeData): ZonePoint | null {
  const points = zonePoints(node);
  if (points.length < 3) return null;
  let twiceArea = 0, weightedX = 0, weightedZ = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!, next = points[(index + 1) % points.length]!, cross = point.x * next.z - next.x * point.z;
    twiceArea += cross;
    weightedX += (point.x + next.x) * cross;
    weightedZ += (point.z + next.z) * cross;
  }
  if (Math.abs(twiceArea) > 1e-9) return { x: weightedX / (3 * twiceArea), z: weightedZ / (3 * twiceArea) };
  return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, z: points.reduce((sum, point) => sum + point.z, 0) / points.length };
}
