import polygonClipping from "polygon-clipping";
import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { G1_GEOMETRY_TOLERANCES as T } from "./tolerances";

export type Point = [number, number];
export type Ring = Point[];
export type MultiPolygon = Ring[][];
export type EnvelopeDiagnostic = { code: string; message: string; sourceObjectIds?: string[] };
export type BuildingEnvelope = {
  levelId: string;
  polygons: MultiPolygon;
  holes: Ring[];
  sourceType: "slab-union" | "none";
  sourceObjectIds: string[];
  pascalSourceIds: string[];
  areaSquareMeters: number | null;
  confidence: "high" | "medium" | "low";
  diagnostics: EnvelopeDiagnostic[];
  usableForEvaluation: boolean;
};

const finite = (point: unknown): point is Point => Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(Number.isFinite);
const envelopeCache = new WeakMap<object, BuildingEnvelope[]>();
const area = (ring: Ring) => Math.abs(ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]!; return sum + point[0] * next[1] - next[0] * point[1]; }, 0) / 2);
const closed = (ring: Ring) => ring.length > 2 && (ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring : [...ring, ring[0]!]);
const multiArea = (multi: MultiPolygon) => multi.reduce((sum, polygon) => sum + Math.max(0, area(polygon[0] ?? []) - polygon.slice(1).reduce((holes, hole) => holes + area(hole), 0)), 0);

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  const cross = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}
function selfIntersecting(ring: Ring) {
  for (let index = 0; index < ring.length; index++) for (let other = index + 1; other < ring.length; other++) {
    if (Math.abs(index - other) <= 1 || (index === 0 && other === ring.length - 1)) continue;
    if (segmentsIntersect(ring[index]!, ring[(index + 1) % ring.length]!, ring[other]!, ring[(other + 1) % ring.length]!)) return true;
  }
  return false;
}

/** Uses explicit Slab rings only. Zone and wall collections are intentionally not promoted to an envelope. */
export function buildBuildingEnvelopes(handoff: EvaluationHandoff): BuildingEnvelope[] {
  const cached = envelopeCache.get(handoff);
  if (cached) return cached;
  const envelopes: BuildingEnvelope[] = handoff.levels.map((level) => {
    const slabs = (handoff.slabs ?? []).filter((slab) => slab.levelId === level.id && slab.visible);
    if (!slabs.length) return { levelId: level.id, polygons: [], holes: [], sourceType: "none", sourceObjectIds: [], pascalSourceIds: [], areaSquareMeters: null, confidence: "low", diagnostics: [{ code: "no_level_slab", message: "该楼层没有可用的 Floor/Slab 轮廓" }], usableForEvaluation: false };
    const invalid = slabs.filter((slab) => slab.outline.length < 3 || !slab.outline.every(finite) || area(slab.outline as Ring) <= T.areaSquareMeters || selfIntersecting(slab.outline as Ring));
    if (invalid.length) return { levelId: level.id, polygons: [], holes: [], sourceType: "slab-union", sourceObjectIds: invalid.map((slab) => slab.id), pascalSourceIds: invalid.map((slab) => slab.rawPascalId), areaSquareMeters: null, confidence: "low", diagnostics: invalid.map((slab) => ({ code: "invalid_slab_polygon", message: `${slab.name ?? slab.id} 的 Slab Polygon 无效或自相交`, sourceObjectIds: [slab.id] })), usableForEvaluation: false };
    try {
      const geometries = slabs.map((slab) => [closed(slab.outline as Ring), ...(slab.holes as Ring[]).map(closed)] as Ring[]);
      const [first, ...rest] = geometries;
      const polygons = polygonClipping.union(first as any, ...rest as any) as MultiPolygon;
      const resultArea = multiArea(polygons), holes = polygons.flatMap((polygon) => polygon.slice(1));
      if (!polygons.length || resultArea <= T.areaSquareMeters) throw new Error("empty_union");
      return { levelId: level.id, polygons, holes, sourceType: "slab-union", sourceObjectIds: slabs.map((slab) => slab.id), pascalSourceIds: slabs.map((slab) => slab.rawPascalId), areaSquareMeters: resultArea, confidence: "medium", diagnostics: [{ code: "slab_semantics_limited", message: "边界由可见 Slab 并集推导；未把 Zone 或墙体集合当作建筑边界。" }, ...(polygons.length > 1 ? [{ code: "multiple_components", message: `检测到 ${polygons.length} 个不相连的建筑区域` }] : [])], usableForEvaluation: true };
    } catch {
      return { levelId: level.id, polygons: [], holes: [], sourceType: "slab-union", sourceObjectIds: slabs.map((slab) => slab.id), pascalSourceIds: slabs.map((slab) => slab.rawPascalId), areaSquareMeters: null, confidence: "low", diagnostics: [{ code: "slab_union_failed", message: "Slab Polygon 无法稳定合并为建筑边界" }], usableForEvaluation: false };
    }
  });
  envelopeCache.set(handoff, envelopes);
  return envelopes;
}

export function rectangularFootprint(item: { dimensionsMeters: number[] | null; resolvedWorldPosition: number[] | null; resolvedRotationRadians: number | null }): Ring | null {
  const [width, , depth] = item.dimensionsMeters ?? [], [x, z] = item.resolvedWorldPosition ?? [], rotation = item.resolvedRotationRadians;
  if (![width, depth, x, z, rotation].every(Number.isFinite) || width! <= T.lengthMeters || depth! <= T.lengthMeters) return null;
  const c = Math.cos(rotation!), s = Math.sin(rotation!), local: Point[] = [[-width! / 2, -depth! / 2], [width! / 2, -depth! / 2], [width! / 2, depth! / 2], [-width! / 2, depth! / 2]];
  return local.map(([dx, dz]) => [x! + dx * c + dz * s, z! - dx * s + dz * c]);
}

export function outsideFootprintArea(footprint: Ring, envelope: BuildingEnvelope): number | null {
  if (!envelope.usableForEvaluation) return null;
  try { return multiArea(polygonClipping.difference([closed(footprint)] as any, envelope.polygons as any) as MultiPolygon); }
  catch { return null; }
}

export { area as polygonArea };
