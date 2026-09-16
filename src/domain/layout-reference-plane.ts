import type { NodeData } from "../types";
import { DERIVED_CEILING_ELEVATION_METERS, resolveBeamCeilings } from "./beams";
import type { LayoutReferencePlane } from "./overlay";

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const levelFor = (nodes: Record<string, NodeData>, node: NodeData) => {
  let cursor: NodeData | undefined = node;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    if (cursor.type === "level") return cursor.id;
    cursor = cursor.parentId ? nodes[cursor.parentId] : undefined;
  }
  return null;
};
const polygonArea = (polygon: unknown) =>
  Array.isArray(polygon) && polygon.length >= 3
    ? Math.abs(
        polygon.reduce((sum, point, index) => {
          const next = polygon[(index + 1) % polygon.length];
          return Array.isArray(point) &&
            Array.isArray(next) &&
            finite(point[0]) &&
            finite(point[1]) &&
            finite(next[0]) &&
            finite(next[1])
            ? sum + point[0] * next[1] - next[0] * point[1]
            : sum;
        }, 0),
      ) / 2
    : 0;

/** Deterministically resolves an authoring aid without mutating a project node. */
export function defaultLayoutReferencePlane(
  nodes: Record<string, NodeData>,
  levelId: string,
): LayoutReferencePlane {
  const ceiling = Object.values(nodes)
    .filter(
      (node) =>
        node.type === "ceiling" &&
        levelFor(nodes, node) === levelId &&
        polygonArea(node.polygon) > 0,
    )
    .sort(
      (left, right) =>
        polygonArea(right.polygon) - polygonArea(left.polygon) ||
        left.id.localeCompare(right.id),
    )[0];
  if (!ceiling)
    return {
      levelId,
      visible: true,
      elevationMm: DERIVED_CEILING_ELEVATION_METERS * 1000,
      basis: "derived-default-2700mm",
    };
  const height =
    finite(ceiling.height) && ceiling.height > 0
      ? ceiling.height
      : DERIVED_CEILING_ELEVATION_METERS;
  return {
    levelId,
    visible: true,
    elevationMm: height * 1000,
    basis: "largest-area-ceiling",
    sourceCeilingId: ceiling.id,
  };
}

export function layoutReferencePlaneFor(
  nodes: Record<string, NodeData>,
  planes: LayoutReferencePlane[],
  levelId: string,
) {
  return (
    planes.find((plane) => plane.levelId === levelId) ??
    defaultLayoutReferencePlane(nodes, levelId)
  );
}

export function replaceLayoutReferencePlane(
  planes: LayoutReferencePlane[],
  next: LayoutReferencePlane,
) {
  return [...planes.filter((plane) => plane.levelId !== next.levelId), next];
}

/** Kept as a narrow evidence check for callers that need a legal Beam source. */
export const beamSourceExistsAt = (
  nodes: Record<string, NodeData>,
  levelId: string,
  point: [number, number],
) => resolveBeamCeilings(nodes, levelId, point, point).length > 0;
