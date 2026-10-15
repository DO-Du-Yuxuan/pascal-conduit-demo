import type { ConstructionDatum, Vec3 } from "./overlay";
import { getWallCurveFrameAt, isCurvedWall } from "../geometry/walls/curve";
import { renderedWallFaceEndpoint, type WallPlanInput } from "../geometry/walls/rendered-face-endpoint";
import { zonePoints } from "../geometry/zone";

export type DatumRegionOffset = { regionId: string; offsetMm: number };

export function constructionDatumLabel(index: number): string {
  return `H${String(index).padStart(2, "0")}`;
}

export function constructionDatumElevationMm(rawReferenceElevationMm: number, heightAboveRawMm: number): number {
  return rawReferenceElevationMm + heightAboveRawMm;
}

export function constructionDatumHeightAboveFinishMm(datum: ConstructionDatum, finishOffsetMm: number | undefined = datum.finishedFloorOffsetMm): number | null {
  if (finishOffsetMm === undefined || !Number.isFinite(finishOffsetMm)) return null;
  return datum.heightAboveRawMm - finishOffsetMm;
}

export function constructionDatumWallLabel(datum: ConstructionDatum, finishOffsetMm?: number): string {
  const height = constructionDatumHeightAboveFinishMm(datum, finishOffsetMm);
  return height === null
    ? `${datum.label} 水平基线离完成面高度 待设置`
    : `${datum.label} 水平基线离完成面高度 ${Math.round(height)} mm`;
}

export function finishOffsetForRegion(datum: ConstructionDatum, regionId?: string): number | undefined {
  if (regionId) {
    const local = datum.localRegionFinishOffsets.find((item) => item.regionId === regionId);
    if (local) return datum.finishedFloorOffsetMm === undefined ? undefined : datum.finishedFloorOffsetMm + local.offsetMm;
  }
  return datum.finishedFloorOffsetMm;
}

export function replaceRegionFinishOffset(datum: ConstructionDatum, regionId: string, offsetMm: number): ConstructionDatum {
  const localRegionFinishOffsets = datum.localRegionFinishOffsets.filter((item) => item.regionId !== regionId);
  localRegionFinishOffsets.push({ regionId, offsetMm });
  return { ...datum, localRegionFinishOffsets };
}

function pointInPolygon(x: number, z: number, polygon: unknown): boolean {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    const az = Array.isArray(a) ? a.length >= 3 ? a[2] : a[1] : undefined, bz = Array.isArray(b) ? b.length >= 3 ? b[2] : b[1] : undefined;
    if (!Array.isArray(a) || !Array.isArray(b) || typeof a[0] !== "number" || typeof az !== "number" || typeof b[0] !== "number" || typeof bz !== "number") continue;
    if ((az > z) !== (bz > z) && x < (b[0] - a[0]) * (z - az) / (bz - az) + a[0]) inside = !inside;
  }
  return inside;
}

export function constructionDatumRegionAt(nodes: Record<string, Record<string, any>>, levelId: string, x: number, z: number): string | undefined {
  const levelOf = (node: Record<string, any>) => {
    let cursor: Record<string, any> | undefined = node, seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) { seen.add(cursor.id); if (String(cursor.type).toLowerCase() === "level") return cursor.id; cursor = cursor.parentId ? nodes[cursor.parentId] : undefined; }
    return undefined;
  };
  const matches = Object.values(nodes).filter((node) => String(node.type).toLowerCase() === "zone" && levelOf(node) === levelId && pointInPolygon(x, z, node.polygon));
  return matches.length === 1 ? matches[0]!.id : undefined;
}

/** World Y for a configured finished floor. Undefined means the datum has no confirmed finish. */
export function constructionDatumFinishedFloorY(datum: ConstructionDatum, nodes: Record<string, Record<string, any>>, x: number, z: number): number | undefined {
  if (datum.finishedFloorOffsetMm === undefined) return undefined;
  const level = nodes[datum.levelId];
  const levelBase = (typeof level?.level === "number" && Number.isFinite(level.level) ? level.level : 0) * 3.2;
  const regionId = constructionDatumRegionAt(nodes, datum.levelId, x, z);
  const offset = finishOffsetForRegion(datum, regionId);
  if (offset === undefined) return undefined;
  return levelBase + (datum.rawReference.elevationMm + offset) / 1000;
}

export function constructionDatumWorldY(datum: ConstructionDatum, nodes: Record<string, Record<string, any>>): number {
  const level = nodes[datum.levelId];
  const levelBase = (typeof level?.level === "number" && Number.isFinite(level.level) ? level.level : 0) * 3.2;
  return levelBase + datum.elevationMm / 1000;
}

export function deviceBottomOffsetFromDatumMm(datum: ConstructionDatum, nodes: Record<string, Record<string, any>>, centerY: number, halfExtentMeters: number): number {
  return Math.round((centerY - halfExtentMeters - constructionDatumWorldY(datum, nodes)) * 1000);
}

export function datumWallLineSegments(
  datum: ConstructionDatum,
  walls: readonly Record<string, any>[],
  openingsByWall: Readonly<Record<string, readonly Record<string, any>[]>>,
  levelBaseY: number,
): Array<{ wallId: string; side: -1 | 1; points: Vec3[]; labelPosition: Vec3 }> {
  const y = levelBaseY + datum.elevationMm / 1000;
  const result: Array<{ wallId: string; side: -1 | 1; points: Vec3[]; labelPosition: Vec3 }> = [];
  const sameLevelWalls: WallPlanInput[] = walls.filter(wall => Array.isArray(wall.start) && Array.isArray(wall.end)).map(wall => ({
    ...wall,
    id: String(wall.id),
    start: wall.start as [number, number],
    end: wall.end as [number, number],
    thickness: Number.isFinite(wall.thickness) ? wall.thickness as number : .1,
  } as WallPlanInput));
  for (const wall of walls) {
    if (!Array.isArray(wall.start) || !Array.isArray(wall.end)) continue;
    const [sx, sz] = wall.start as [number, number], [ex, ez] = wall.end as [number, number];
    const length = Math.hypot(ex - sx, ez - sz);
    if (!Number.isFinite(length) || length < 1e-6) continue;
    const wallY = levelBaseY;
    if (y < wallY || y > wallY + (Number.isFinite(wall.height) ? wall.height : 2.5)) continue;
    const blocked: Array<[number, number]> = [];
    for (const opening of openingsByWall[wall.id] ?? []) {
      const position = Array.isArray(opening.position) ? opening.position : [];
      const openingHeight = Number.isFinite(opening.height) ? opening.height : opening.type === "window" ? 1.5 : 2.1;
      const centerY = Number.isFinite(position[1]) ? position[1] : opening.type === "window" ? 1.2 : openingHeight / 2;
      if (y < wallY + centerY - openingHeight / 2 || y > wallY + centerY + openingHeight / 2) continue;
      const width = Number.isFinite(opening.width) ? opening.width : opening.type === "window" ? 1.5 : .9;
      const center = Number.isFinite(position[0]) ? position[0] : 0;
      const from = Math.max(0, Math.min(length, center - width / 2)), to = Math.max(0, Math.min(length, center + width / 2));
      if (to > from) blocked.push([from, to]);
    }
    blocked.sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    const add = (from: number, to: number, side: -1 | 1) => {
      if (to - from < .015) return;
      const halfThickness = Math.max(.001, Number.isFinite(wall.thickness) ? wall.thickness : .1) / 2 + .002;
      const startFrame = getWallCurveFrameAt(wall as any, 0), endFrame = getWallCurveFrameAt(wall as any, 1);
      const startMiter = !isCurvedWall(wall as any) ? renderedWallFaceEndpoint(String(wall.id), [sx, sz], [startFrame.normal.x * side, startFrame.normal.y * side], sameLevelWalls) : undefined;
      const endMiter = !isCurvedWall(wall as any) ? renderedWallFaceEndpoint(String(wall.id), [ex, ez], [endFrame.normal.x * side, endFrame.normal.y * side], sameLevelWalls) : undefined;
      const dx = (ex - sx) / length, dz = (ez - sz) / length;
      const startAlong = startMiter ? (startMiter[0] - sx) * dx + (startMiter[1] - sz) * dz : 0;
      const endAlong = endMiter ? (endMiter[0] - sx) * dx + (endMiter[1] - sz) * dz : length;
      const requestedFrom = startMiter && from <= 1e-7 ? startAlong : from;
      const requestedTo = endMiter && to >= length - 1e-7 ? endAlong : to;
      const renderedFrom = Math.max(startAlong, requestedFrom), renderedTo = Math.min(endAlong, requestedTo);
      if (renderedTo - renderedFrom < .015) return;
      const samples = Math.max(1, Math.ceil((renderedTo - renderedFrom) / .2));
      const points = Array.from({ length: samples + 1 }, (_, index): Vec3 => {
        const distance = renderedFrom + (renderedTo - renderedFrom) * index / samples;
        if (!isCurvedWall(wall as any)) return [sx + dx * distance + startFrame.normal.x * side * halfThickness, y, sz + dz * distance + startFrame.normal.y * side * halfThickness];
        const frame = getWallCurveFrameAt(wall as any, distance / length);
        return [frame.point.x + frame.normal.x * halfThickness * side, y, frame.point.y + frame.normal.y * halfThickness * side];
      });
      const middle = getWallCurveFrameAt(wall as any, (renderedFrom + renderedTo) / 2 / length);
      result.push({ wallId: wall.id, side, points, labelPosition: [middle.point.x + middle.normal.x * halfThickness * side, y, middle.point.y + middle.normal.y * halfThickness * side] });
    };
    for (const side of [-1, 1] as const) {
      cursor = 0;
      for (const [from, to] of blocked) { add(cursor, from, side); cursor = Math.max(cursor, to); }
      add(cursor, length, side);
    }
  }
  return result;
}

/** Finished-floor strokes reuse wall-face clipping at each region's actual elevation. */
export function finishedFloorWallLineSegments(
  datum: ConstructionDatum,
  walls: readonly Record<string, any>[],
  openingsByWall: Readonly<Record<string, readonly Record<string, any>[]>>,
  levelBaseY: number,
  nodes: Record<string, Record<string, any>>,
) {
  if (datum.finishedFloorOffsetMm === undefined) return [];
  const offsets = new Set([datum.finishedFloorOffsetMm, ...datum.localRegionFinishOffsets.map(local => datum.finishedFloorOffsetMm! + local.offsetMm)]);
  return [...offsets].flatMap(offset => {
    const finishDatum = { ...datum, elevationMm: datum.rawReference.elevationMm + offset };
    return splitDatumLinesByRegions(datumWallLineSegments(finishDatum, walls, openingsByWall, levelBaseY), nodes, datum.levelId)
      .filter(line => finishOffsetForRegion(datum, line.regionId) === offset);
  });
}

/** Split visible wall strokes where a Zone boundary changes the applicable finish. */
export function splitDatumLinesByRegions<T extends { wallId: string; side: -1 | 1; points: Vec3[]; labelPosition: Vec3 }>(lines: readonly T[], nodes: Record<string, Record<string, any>>, levelId: string): Array<T & { regionId?: string }> {
  const zones = Object.values(nodes).filter(node => String(node.type).toLowerCase() === "zone" && constructionDatumLevelId(node, nodes) === levelId).map(node => ({ id: node.id, points: zonePoints(node as any) }));
  const regionAt = (x: number, z: number) => {
    const matches = zones.filter(zone => pointInPolygon(x, z, zone.points.map(point => [point.x, point.z])));
    return matches.length === 1 ? matches[0]!.id : undefined;
  };
  const output: Array<T & { regionId?: string }> = [];
  for (const line of lines) {
    let active: { regionId?: string; points: Vec3[] } | undefined;
    const flush = () => {
      if (!active || active.points.length < 2) { active = undefined; return; }
      const lengths = active.points.slice(1).map((point, index) => Math.hypot(point[0] - active!.points[index]![0], point[2] - active!.points[index]![2])), total = lengths.reduce((sum, length) => sum + length, 0);
      let remaining = total / 2, labelPosition = active.points[0]!;
      for (let index = 0; index < lengths.length; index++) { const segmentLength = lengths[index]!; if (remaining <= segmentLength) { const a = active.points[index]!, b = active.points[index + 1]!, ratio = segmentLength ? remaining / segmentLength : 0; labelPosition = [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio, a[2] + (b[2] - a[2]) * ratio]; break; } remaining -= segmentLength; }
      output.push({ ...line, points: active.points, labelPosition, ...(active.regionId ? { regionId: active.regionId } : {}) }); active = undefined;
    };
    for (let segmentIndex = 0; segmentIndex < line.points.length - 1; segmentIndex++) {
      const a = line.points[segmentIndex]!, b = line.points[segmentIndex + 1]!, dx = b[0] - a[0], dz = b[2] - a[2], cuts = [0, 1];
      for (const zone of zones) for (let edge = 0; edge < zone.points.length; edge++) {
        const p = zone.points[edge]!, q = zone.points[(edge + 1) % zone.points.length]!, ex = q.x - p.x, ez = q.z - p.z, denominator = dx * ez - dz * ex;
        if (Math.abs(denominator) < 1e-9) continue;
        const t = ((p.x - a[0]) * ez - (p.z - a[2]) * ex) / denominator, u = ((p.x - a[0]) * dz - (p.z - a[2]) * dx) / denominator;
        if (t > 1e-7 && t < 1 - 1e-7 && u >= -1e-7 && u <= 1 + 1e-7) cuts.push(t);
      }
      cuts.sort((left, right) => left - right);
      const unique = cuts.filter((value, index) => index === 0 || value - cuts[index - 1]! > 1e-7);
      for (let index = 0; index < unique.length - 1; index++) {
        const from = unique[index]!, to = unique[index + 1]!, middle = (from + to) / 2, regionId = regionAt(a[0] + dx * middle, a[2] + dz * middle), start: Vec3 = [a[0] + dx * from, a[1] + (b[1] - a[1]) * from, a[2] + dz * from], end: Vec3 = [a[0] + dx * to, a[1] + (b[1] - a[1]) * to, a[2] + dz * to];
        if (active && active.regionId !== regionId) flush();
        if (!active) active = { regionId, points: [start, end] };
        else if (Math.hypot(active.points[active.points.length - 1]![0] - start[0], active.points[active.points.length - 1]![2] - start[2]) < 1e-6) active.points.push(end);
        else { flush(); active = { regionId, points: [start, end] }; }
      }
    }
    flush();
  }
  return output;
}

export function constructionDatumRegionLevelId(nodes: Record<string, Record<string, any>>, regionId: string): string | undefined {
  const node = nodes[regionId];
  return node && String(node.type).toLowerCase() === "zone" ? constructionDatumLevelId(node, nodes) : undefined;
}

function constructionDatumLevelId(node: Record<string, any>, nodes: Record<string, Record<string, any>>): string | undefined {
  let cursor: Record<string, any> | undefined = node, seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) { seen.add(cursor.id); if (String(cursor.type).toLowerCase() === "level") return cursor.id; cursor = cursor.parentId ? nodes[cursor.parentId] : undefined; }
  return undefined;
}
