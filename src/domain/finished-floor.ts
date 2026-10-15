import polygonClipping from "polygon-clipping";
import earcut from "earcut";
import type { NodeData } from "../types";
import type { ConstructionDatum, Vec3 } from "./overlay";
import { constructionDatumRegionAt } from "./construction-datum";

export type XZPoint = [number, number];
export type FinishedFloorPolygon = { outer: XZPoint[]; holes: XZPoint[][] };
export type FinishedFloorSurface = { id: string; levelId: string; datumId: string; rawReferenceSourceId: string; sourceSlabId: string; regionId?: string; y: number; polygon: FinishedFloorPolygon; triangles: Vec3[][] };
type Ring = number[][];
type MultiPolygon = Ring[][];

const point = (value: unknown): XZPoint | undefined => {
  if (!Array.isArray(value) || !Number.isFinite(value[0])) return undefined;
  const z = value.length >= 3 ? value[2] : value[1];
  return Number.isFinite(z) ? [Number(value[0]), Number(z)] : undefined;
};
const close = (ring: XZPoint[]) => ring.length && (ring[0]![0] !== ring[ring.length - 1]![0] || ring[0]![1] !== ring[ring.length - 1]![1]) ? [...ring, ring[0]!] : ring;
const asRing = (raw: unknown): XZPoint[] => Array.isArray(raw) ? raw.map(point).filter((value): value is XZPoint => Boolean(value)) : [];
const levelOf = (node: NodeData, nodes: Record<string, NodeData>): string | undefined => {
  let current: NodeData | undefined = node;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.type === "level") return current.id;
    current = current.parentId ? nodes[current.parentId] : undefined;
  }
  return undefined;
};
const contains = (ring: XZPoint[], x: number, z: number) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
const insideSlab = (slab: NodeData, x: number, z: number) => {
  const outer = asRing(slab.polygon);
  return outer.length >= 3 && contains(outer, x, z) && !(Array.isArray(slab.holes) && slab.holes.some((hole: unknown) => contains(asRing(hole), x, z)));
};
const zoneRings = (nodes: Record<string, NodeData>, levelId: string): Array<{ id: string; ring: XZPoint[] }> => Object.values(nodes)
  .filter(node => node.type === "zone" && levelOf(node, nodes) === levelId)
  .map(node => ({ id: node.id, ring: asRing(node.polygon) }))
  .filter(item => item.ring.length >= 3)
  .sort((a, b) => a.id.localeCompare(b.id));
const slabGeometry = (slab: NodeData): MultiPolygon => {
  const outer = close(asRing(slab.polygon));
  const holes = Array.isArray(slab.holes) ? slab.holes.map((hole: unknown) => close(asRing(hole))).filter((ring: XZPoint[]) => ring.length >= 4) : [];
  return outer.length >= 4 ? [[outer, ...holes]] : [];
};
const sortPolygons = (geometry: MultiPolygon): MultiPolygon => [...geometry].sort((a, b) => {
  const bounds = (polygon: Ring[]) => {
    const points = (polygon[0] ?? []).map(point).filter((value): value is XZPoint => Boolean(value));
    return points.length ? [Math.min(...points.map(item => item[0])), Math.min(...points.map(item => item[1])), Math.max(...points.map(item => item[0])), Math.max(...points.map(item => item[1]))] : [0, 0, 0, 0];
  };
  const left = bounds(a), right = bounds(b);
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return left[index]! - right[index]!;
  return 0;
});
const zoneGeometry = (zones: Array<{ id: string; ring: XZPoint[] }>): MultiPolygon => zones.map(item => [close(item.ring)]);
const finishY = (datum: ConstructionDatum, nodes: Record<string, NodeData>, regionId?: string) => {
  const offset = datum.finishedFloorOffsetMm;
  const local = regionId ? datum.localRegionFinishOffsets.find(item => item.regionId === regionId)?.offsetMm ?? 0 : 0;
  if (offset === undefined) return undefined;
  const levelValue = nodes[datum.levelId]?.level, levelBase = (typeof levelValue === "number" && Number.isFinite(levelValue) ? levelValue : 0) * 3.2;
  return levelBase + (datum.rawReference.elevationMm + offset + local) / 1000;
};
const area = (ring: XZPoint[]) => Math.abs(ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]!; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);

function triangulate(y: number, polygon: FinishedFloorPolygon): Vec3[][] {
  const flat = [...polygon.outer.flatMap(item => item)], holes: number[] = [];
  for (const hole of polygon.holes) { holes.push(flat.length / 2); flat.push(...hole.flatMap(item => item)); }
  const indices = earcut(flat, holes, 2), triangles: Vec3[][] = [];
  for (let index = 0; index < indices.length; index += 3) {
    const at = (i: number): Vec3 => [flat[i * 2]!, y, flat[i * 2 + 1]!];
    triangles.push([at(indices[index]!), at(indices[index + 1]!), at(indices[index + 2]!) ]);
  }
  return triangles;
}
function appendGeometry(result: FinishedFloorSurface[], geometry: MultiPolygon, datum: ConstructionDatum, slab: NodeData, regionId: string | undefined, y: number) {
  for (const [partIndex, polygon] of sortPolygons(geometry).entries()) {
    const outer = asRing(polygon[0]);
    const holes = polygon.slice(1).map(asRing).filter(ring => ring.length >= 3);
    if (outer.length < 3 || area(outer) < 1e-8) continue;
    const value: FinishedFloorSurface = {
      id: `finished-floor:${datum.id}:${slab.id}:${regionId ?? "base"}:part-${partIndex}`,
      levelId: datum.levelId, datumId: datum.id, rawReferenceSourceId: datum.rawReference.sourceObjectId, sourceSlabId: slab.id,
      ...(regionId ? { regionId } : {}), y, polygon: { outer, holes }, triangles: [],
    };
    value.triangles = triangulate(y, value.polygon);
    if (value.triangles.length) result.push(value);
  }
}

/** Derived finish patches clipped to every same-level Slab, its holes, and unique local Zones. */
export function buildFinishedFloorSurfaces(datums: readonly ConstructionDatum[], nodes: Record<string, NodeData>): FinishedFloorSurface[] {
  const result: FinishedFloorSurface[] = [];
  for (const datum of [...datums].sort((a, b) => a.id.localeCompare(b.id))) {
    if (datum.finishedFloorOffsetMm === undefined || !["slab-top", "level-base"].includes(datum.rawReference.kind)) continue;
    const slabs = Object.values(nodes).filter(item => item.type === "slab" && levelOf(item, nodes) === datum.levelId && asRing(item.polygon).length >= 3).sort((a, b) => a.id.localeCompare(b.id));
    const zones = zoneRings(nodes, datum.levelId), relevant = zones.filter(zone => datum.localRegionFinishOffsets.some(item => item.regionId === zone.id));
    for (const slab of slabs) {
      let base = slabGeometry(slab);
      if (!base.length) continue;
      const overlappingSlabs = slabs.filter(item => item.id !== slab.id);
      try {
        if (overlappingSlabs.length) {
          const overlaps = overlappingSlabs.flatMap(item => slabGeometry(item));
          if (overlaps.length) base = polygonClipping.difference(base as any, (polygonClipping.union as any)(...overlaps) as any) as MultiPolygon;
        }
        const uniqueRegions = relevant.filter(zone => {
          const others = zones.filter(item => item.id !== zone.id);
          const own = polygonClipping.intersection(base as any, [[close(zone.ring)]] as any) as MultiPolygon;
          const unique = others.length ? polygonClipping.difference(own as any, zoneGeometry(others) as any) as MultiPolygon : own;
          return unique.length > 0;
        });
        const localGeometries = uniqueRegions.map(zone => {
          const own = polygonClipping.intersection(base as any, [[close(zone.ring)]] as any) as MultiPolygon;
          const others = zones.filter(item => item.id !== zone.id);
          return (others.length ? polygonClipping.difference(own as any, zoneGeometry(others) as any) : own) as MultiPolygon;
        });
        const uniqueZoneGeometry = localGeometries.length ? (polygonClipping.union as any)(...localGeometries) as MultiPolygon : [];
        const baseGeometry = uniqueZoneGeometry.length ? polygonClipping.difference(base as any, uniqueZoneGeometry as any) as MultiPolygon : base;
        const baseY = finishY(datum, nodes);
        if (baseY !== undefined) appendGeometry(result, baseGeometry, datum, slab, undefined, baseY);
        for (const zone of uniqueRegions) {
          const y = finishY(datum, nodes, zone.id);
          if (y === undefined) continue;
          const own = polygonClipping.intersection(base as any, [[close(zone.ring)]] as any) as MultiPolygon;
          const others = zones.filter(item => item.id !== zone.id);
          const geometry = others.length ? polygonClipping.difference(own as any, zoneGeometry(others) as any) as MultiPolygon : own;
          appendGeometry(result, geometry, datum, slab, zone.id, y);
        }
      } catch { /* malformed source polygons are omitted rather than filled */ }
    }
  }
  return result;
}

/** Resolve only where one datum and exactly one valid source slab cover this point. */
export function finishedFloorAt(datums: readonly ConstructionDatum[], nodes: Record<string, NodeData>, levelId: string, x: number, z: number): { y: number; datumId: string; rawReferenceSourceId: string; sourceSlabId: string; regionId?: string } | undefined {
  const matchingDatums = datums.filter(datum => datum.levelId === levelId && datum.finishedFloorOffsetMm !== undefined && ["slab-top", "level-base"].includes(datum.rawReference.kind));
  if (matchingDatums.length !== 1) return undefined;
  const datum = matchingDatums[0]!;
  const slabs = Object.values(nodes).filter(item => item.type === "slab" && levelOf(item, nodes) === levelId && insideSlab(item, x, z));
  if (slabs.length !== 1) return undefined;
  const region = constructionDatumRegionAt(nodes, levelId, x, z);
  const regionId = region && datum.localRegionFinishOffsets.some(item => item.regionId === region) ? region : undefined;
  const y = finishY(datum, nodes, region);
  return y === undefined ? undefined : { y, datumId: datum.id, rawReferenceSourceId: datum.rawReference.sourceObjectId, sourceSlabId: slabs[0]!.id, ...(regionId ? { regionId } : {}) };
}
