import type { NodeData } from "../types";

/** Read-only presentation values. `raw` always refers to the imported value. */
export type EffectiveValue<T> = {
  raw: unknown;
  value: T;
  source: "explicit" | "builder-default" | "level-plane" | "legacy-elevation";
};

export type EffectiveBuildingParameters = {
  id: string;
  type: string;
  levelId: string | null;
  width?: EffectiveValue<number>;
  height?: EffectiveValue<number>;
  /** Editor's follows-level interpretation, exposed separately from Builder's raw-schema default. */
  editorFollowHeight?: EffectiveValue<number>;
  thickness?: EffectiveValue<number>;
  baseElevation?: EffectiveValue<number>;
  /** Raw support references are surfaced separately; this resolver does not elect a slab. */
  supportSlabId?: string | null;
};

export const BUILDER_DEFAULT_LEVEL_HEIGHT = 2.5;
export const BUILDER_DEFAULT_WALL_THICKNESS = 0.1;
export const BUILDER_DEFAULT_DOOR_SIZE = { width: 0.9, height: 2.1 } as const;
export const BUILDER_DEFAULT_WINDOW_SIZE = { width: 1.5, height: 1.5 } as const;
export const EDITOR_CEILING_CLAMP_MARGIN = 0.01;

/** Explicit thickness uses top-elevation semantics; legacy files extrude to
 * elevation from the Level plane. Neither interpretation rewrites source. */
export function resolveSlabVerticalRange(node: NodeData): { bottom: number; top: number; thickness: number } {
  const elevation = typeof node.elevation === "number" && Number.isFinite(node.elevation) ? node.elevation : 0.05;
  if (typeof node.thickness === "number" && Number.isFinite(node.thickness) && node.thickness >= 0) {
    return { bottom: elevation - node.thickness, top: elevation, thickness: node.thickness };
  }
  return { bottom: Math.min(0, elevation), top: Math.max(0, elevation), thickness: Math.abs(elevation) };
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const kindOf = (node: Pick<NodeData, "type">): string => node.type
  .replace(/([a-z])([A-Z])/g, "$1-$2")
  .replace(/_/g, "-")
  .toLowerCase();

function valueOrDefault(raw: unknown, fallback: number): EffectiveValue<number> {
  return finite(raw)
    ? { raw, value: raw, source: "explicit" }
    : { raw: raw ?? null, value: fallback, source: "builder-default" };
}

function findLevelId(node: NodeData, nodes: Readonly<Record<string, NodeData>>): string | null {
  const seen = new Set<string>();
  let current: NodeData | undefined = node;
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    const parentNode: NodeData | undefined = nodes[current.parentId];
    if (!parentNode) return null;
    if (kindOf(parentNode) === "level") return parentNode.id;
    current = parentNode;
  }
  return null;
}

function effectiveLevelHeight(level: NodeData | undefined): EffectiveValue<number> {
  return valueOrDefault(level?.height, BUILDER_DEFAULT_LEVEL_HEIGHT);
}

function pointInPolygon(point: [number, number], polygon: unknown): boolean {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (!Array.isArray(a) || !Array.isArray(b) || !finite(a[0]) || !finite(a[1]) || !finite(b[0]) || !finite(b[1])) continue;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function orientation(a: number[], b: number[], c: number[]): number {
  return (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
}

function polygonsOverlap(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return false;
  if (a.some((point) => Array.isArray(point) && finite(point[0]) && finite(point[1]) && pointInPolygon([point[0], point[1]], b))) return true;
  if (b.some((point) => Array.isArray(point) && finite(point[0]) && finite(point[1]) && pointInPolygon([point[0], point[1]], a))) return true;
  const edgesCross = (first: unknown[], second: unknown[]) => {
    for (let i = 0; i < first.length; i++) {
      const p = first[i], q = first[(i + 1) % first.length];
      if (!Array.isArray(p) || !Array.isArray(q) || !finite(p[0]) || !finite(p[1]) || !finite(q[0]) || !finite(q[1])) continue;
      for (let j = 0; j < second.length; j++) {
        const r = second[j], s = second[(j + 1) % second.length];
        if (!Array.isArray(r) || !Array.isArray(s) || !finite(r[0]) || !finite(r[1]) || !finite(s[0]) || !finite(s[1])) continue;
        const o1 = orientation(p, q, r), o2 = orientation(p, q, s), o3 = orientation(r, s, p), o4 = orientation(r, s, q);
        if (o1 * o2 < 0 && o3 * o4 < 0) return true;
      }
    }
    return false;
  };
  return edgesCross(a, b);
}

function ceilingFollowHeight(level: NodeData, ceiling: NodeData, nodes: Readonly<Record<string, NodeData>>): number {
  const levelHeight = effectiveLevelHeight(level).value;
  const slabUndersides = Object.values(nodes)
    .filter((node) => kindOf(node) === "slab" && node.parentId === level.id && node.recessed !== true && polygonsOverlap(ceiling.polygon, node.polygon))
    .map((slab) => levelHeight + (finite(slab.elevation) ? slab.elevation : 0.05) - (finite(slab.thickness) ? slab.thickness : 0.05));
  return Math.max(0, Math.min(levelHeight, ...slabUndersides) - EDITOR_CEILING_CLAMP_MARGIN);
}

/**
 * Resolves a node's height without filling or mutating the source node.
 * A missing wall height follows an authored Level plane when one exists;
 * missing heights on a Level with an authored height follow its vertical
 * plane. A missing height on a legacy Level without a stored height falls
 * back to the Builder's 2.5m default. Ceiling follow height applies the
 * Editor clamp margin and overlapping slab underside, but remains derived
 * metadata and must never be passed to Beam authoring as source evidence.
 */
export function resolveEffectiveHeight(
  node: NodeData,
  nodes: Readonly<Record<string, NodeData>>,
): Pick<EffectiveBuildingParameters, "height" | "editorFollowHeight" | "levelId"> {
  const type = kindOf(node);
  const levelId = findLevelId(node, nodes);
  const level = levelId ? nodes[levelId] : undefined;
  const levelHeight = effectiveLevelHeight(level);

  if (type === "wall") {
    const height = finite(node.height)
      ? { raw: node.height, value: node.height, source: "explicit" as const }
      : level && finite(level.height)
        ? { raw: node.height ?? null, value: level.height, source: "level-plane" as const }
        : { raw: node.height ?? null, value: BUILDER_DEFAULT_LEVEL_HEIGHT, source: "builder-default" as const };
    return { height, levelId };
  }

  if (type === "ceiling") {
    const hasAuthoredLevelHeight = Boolean(level && finite(level.height));
    const followsHeight = level && hasAuthoredLevelHeight
      ? ceilingFollowHeight(level, node, nodes)
      : BUILDER_DEFAULT_LEVEL_HEIGHT;
    const height = finite(node.height)
      ? { raw: node.height, value: node.height, source: "explicit" as const }
      : { raw: node.height ?? null, value: followsHeight, source: hasAuthoredLevelHeight ? "level-plane" as const : "builder-default" as const };
    const editorFollowHeight = finite(node.height) || !hasAuthoredLevelHeight ? undefined : height;
    return { height, editorFollowHeight, levelId };
  }
  return { height: valueOrDefault(node.height, BUILDER_DEFAULT_LEVEL_HEIGHT), levelId };
}

/**
 * Build a read-only effective parameter index for building nodes. No source
 * object is copied with defaults, so raw export and Beam evidence keep their
 * original explicit-vs-derived distinction.
 */
export function resolveEffectiveBuildingParameters(
  nodes: Readonly<Record<string, NodeData>>,
): Record<string, EffectiveBuildingParameters> {
  const result: Record<string, EffectiveBuildingParameters> = {};
  for (const node of Object.values(nodes)) {
    const type = kindOf(node);
    if (["door", "window", "wall", "ceiling", "slab", "level"].includes(type) === false) continue;
    const levelId = type === "level" ? node.id : findLevelId(node, nodes);
    const entry: EffectiveBuildingParameters = { id: node.id, type, levelId };

    if (type === "door" || type === "window") {
      const defaults = type === "door" ? BUILDER_DEFAULT_DOOR_SIZE : BUILDER_DEFAULT_WINDOW_SIZE;
      entry.width = valueOrDefault(node.width, defaults.width);
      entry.height = valueOrDefault(node.height, defaults.height);
    } else if (type === "wall" || type === "ceiling") {
      Object.assign(entry, resolveEffectiveHeight(node, nodes));
      if (type === "wall") {
        entry.thickness = finite(node.thickness)
          ? { raw: node.thickness, value: node.thickness, source: "explicit" }
          : { raw: node.thickness ?? null, value: BUILDER_DEFAULT_WALL_THICKNESS, source: "builder-default" };
        entry.supportSlabId = typeof node.supportSlabId === "string" ? node.supportSlabId : null;
        entry.baseElevation = finite(node.baseElevation)
          ? { raw: node.baseElevation, value: node.baseElevation, source: "explicit" }
          : { raw: node.baseElevation ?? null, value: 0, source: "builder-default" };
      }
    } else if (type === "slab") {
      const explicitThickness = finite(node.thickness);
      const legacyElevation = finite(node.elevation) ? Math.abs(node.elevation) : 0.05;
      entry.thickness = explicitThickness
        ? { raw: node.thickness, value: node.thickness, source: "explicit" }
        : { raw: node.thickness ?? null, value: legacyElevation, source: "legacy-elevation" };
      entry.height = valueOrDefault(node.elevation, 0.05);
    } else {
      entry.height = valueOrDefault(node.height, BUILDER_DEFAULT_LEVEL_HEIGHT);
      entry.baseElevation = finite(node.baseElevation)
        ? { raw: node.baseElevation, value: node.baseElevation, source: "explicit" }
        : { raw: node.baseElevation ?? null, value: 0, source: "builder-default" };
    }
    result[node.id] = entry;
  }
  return result;
}
