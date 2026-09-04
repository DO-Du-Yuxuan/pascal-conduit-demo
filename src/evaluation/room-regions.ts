import polygonClipping from "polygon-clipping";
import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { buildBuildingEnvelopes, polygonArea, type BuildingEnvelope, type MultiPolygon, type Point, type Ring } from "./envelope";
import { G1_GEOMETRY_TOLERANCES as T } from "./tolerances";

export type RoomRegionDiagnostic = { code: string; message: string };
export type RoomRegion = {
  roomRegionId: string;
  levelId: string;
  polygons: MultiPolygon;
  holes: Ring[];
  areaSquareMeters: number;
  perimeterMeters: number;
  compactness: number;
  geometryArtifact: boolean;
  boundaryWallIds: string[];
  sourceObjectIds: string[];
  pascalSourceIds: string[];
  confidence: "high" | "medium" | "low";
  diagnostics: RoomRegionDiagnostic[];
  usableForEvaluation: boolean;
};

export type ZoneRoomOverlap = { roomRegionId: string; intersectionAreaSquareMeters: number; zoneCoverageRatio: number; roomCoverageRatio: number };
export type ZoneRoomMatch = {
  zoneId: string;
  levelId: string | null;
  overlaps: ZoneRoomOverlap[];
  matchedRoomRegionIds: string[];
  relationship: "one-to-one" | "room-with-multiple-zones" | "zone-crosses-rooms" | "unmatched-zone" | "partial";
  confidence: "high" | "medium" | "low";
  diagnostics: string[];
};
export type ZonePairOverlap = { zoneAId: string; zoneBId: string; levelId: string | null; intersectionAreaSquareMeters: number; smallerZoneCoverageRatio: number };
export type RoomRegionAnalysis = { envelopes: BuildingEnvelope[]; rooms: RoomRegion[]; zoneMatches: ZoneRoomMatch[]; zoneOverlaps: ZonePairOverlap[]; unmatchedRoomRegionIds: string[]; roomToZoneIds: Record<string, string[]>; diagnostics: RoomRegionDiagnostic[] };
const roomRegionCache = new WeakMap<object, RoomRegionAnalysis>();

const close = (ring: Ring): Ring => ring.length && (ring[0]![0] !== ring[ring.length - 1]![0] || ring[0]![1] !== ring[ring.length - 1]![1]) ? [...ring, ring[0]!] : ring;
const snapRing = (ring: Ring): Ring => close(ring.map(([x, z]) => [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000]));
const ringPerimeter = (ring: Ring) => ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]!; return sum + Math.hypot(next[0] - point[0], next[1] - point[1]); }, 0);
const polygonNetArea = (polygon: Ring[]) => Math.max(0, polygonArea(polygon[0] ?? []) - polygon.slice(1).reduce((sum, hole) => sum + polygonArea(hole), 0));
const multiArea = (multi: MultiPolygon) => multi.reduce((sum, polygon) => sum + polygonNetArea(polygon), 0);
const pointSegmentDistance = (point: Point, start: Point, end: Point) => { const dx = end[0] - start[0], dz = end[1] - start[1], length2 = dx * dx + dz * dz; if (!length2) return Math.hypot(point[0] - start[0], point[1] - start[1]); const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / length2)); return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dz); };
const boundaryTouches = (room: Ring[], footprint: Ring) => room.some((ring) => ring.some((point) => footprint.some((start, index) => pointSegmentDistance(point, start, footprint[(index + 1) % footprint.length]!) <= T.roomWallGapMeters)));
const intersectionArea = (a: Ring[], b: Ring[]) => { try { return multiArea(polygonClipping.intersection(a as any, b as any) as MultiPolygon); } catch { return 0; } };

export function buildRoomRegionAnalysis(handoff: EvaluationHandoff): RoomRegionAnalysis {
  const cached = roomRegionCache.get(handoff);
  if (cached) return cached;
  const envelopes = buildBuildingEnvelopes(handoff), rooms: RoomRegion[] = [], diagnostics: RoomRegionDiagnostic[] = [];
  for (const envelope of envelopes) {
    if (!envelope.usableForEvaluation) { diagnostics.push({ code: "room_envelope_unavailable", message: `${envelope.levelId} 没有可用建筑边界，未生成 Room Region` }); continue; }
    const levelWalls = handoff.walls.filter((wall) => wall.levelId === envelope.levelId), validWalls = levelWalls.filter((wall) => wall.footprintValidation.valid && wall.footprintValidation.footprint.length >= 3), invalidWalls = levelWalls.filter((wall) => !validWalls.includes(wall));
    if (invalidWalls.length) diagnostics.push({ code: "invalid_walls_excluded", message: `${envelope.levelId} 排除 ${invalidWalls.length} 个无效墙体 footprint` });
    let candidates: MultiPolygon = envelope.polygons;
    if (validWalls.length) {
      try {
        const wallPolygons = validWalls.map((wall) => [snapRing(wall.footprintValidation.footprint as Ring)] as Ring[]), [first, ...rest] = wallPolygons, wallUnion = polygonClipping.union(first as any, ...rest as any);
        candidates = polygonClipping.difference(envelope.polygons as any, wallUnion as any) as MultiPolygon;
      } catch { diagnostics.push({ code: "room_partition_failed", message: `${envelope.levelId} 墙体分割运算失败，未生成 Room Region` }); continue; }
    }
    const ordered = candidates.map((polygon) => ({ polygon, area: polygonNetArea(polygon), perimeter: polygon.reduce((sum, ring) => sum + ringPerimeter(ring), 0) })).filter((item) => item.area > T.areaSquareMeters).sort((a, b) => b.area - a.area);
    ordered.forEach((item, index) => {
      const compactness = item.perimeter > 0 ? 4 * Math.PI * item.area / (item.perimeter * item.perimeter) : 0, geometryArtifact = item.area <= T.roomNumericalSliverAreaSquareMeters, fragment = !geometryArtifact && item.area < T.roomMinimumAreaSquareMeters, slender = !geometryArtifact && compactness < T.roomSlendernessMinimum, boundaryWallIds = validWalls.filter((wall) => boundaryTouches(item.polygon, wall.footprintValidation.footprint as Ring)).map((wall) => wall.id), roomDiagnostics: RoomRegionDiagnostic[] = [];
      if (geometryArtifact) roomDiagnostics.push({ code: "geometry_artifact", message: `区域面积 ${item.area.toFixed(6)} m²，小于几何残留阈值 ${T.roomNumericalSliverAreaSquareMeters} m²；仅保留技术诊断，不作为设计师级别空间问题` });
      if (fragment) roomDiagnostics.push({ code: "tiny_room_fragment", message: `区域面积 ${item.area.toFixed(3)} m²，小于 ${T.roomMinimumAreaSquareMeters} m²` });
      if (slender) roomDiagnostics.push({ code: "slender_room_fragment", message: `区域紧凑度 ${compactness.toFixed(4)}，可能是墙缝或细长裂缝` });
      if (!boundaryWallIds.length) roomDiagnostics.push({ code: "no_boundary_wall_mapping", message: "区域边界未能映射到可靠墙体，可能是开放区域或由 Slab 边界直接形成" });
      rooms.push({ roomRegionId: `${envelope.levelId}-room-${index + 1}`, levelId: envelope.levelId, polygons: [item.polygon], holes: item.polygon.slice(1), areaSquareMeters: item.area, perimeterMeters: item.perimeter, compactness, geometryArtifact, boundaryWallIds, sourceObjectIds: [...envelope.sourceObjectIds, ...boundaryWallIds], pascalSourceIds: [...envelope.pascalSourceIds, ...boundaryWallIds], confidence: geometryArtifact || fragment || slender ? "low" : boundaryWallIds.length ? "medium" : "low", diagnostics: roomDiagnostics, usableForEvaluation: !geometryArtifact && !fragment && !slender });
    });
  }

  const roomToZoneIds: Record<string, string[]> = Object.fromEntries(rooms.map((room) => [room.roomRegionId, []]));
  const zoneMatches: ZoneRoomMatch[] = handoff.zones.map((zone) => {
    const zonePolygon: Ring[] = [close(zone.outline as Ring)], zoneArea = zone.areaSquareMeters ?? polygonArea(zone.outline as Ring), levelRooms = rooms.filter((room) => room.levelId === zone.levelId && room.usableForEvaluation), overlaps = levelRooms.map((room) => { const area = intersectionArea(zonePolygon, room.polygons[0]!); return { roomRegionId: room.roomRegionId, intersectionAreaSquareMeters: area, zoneCoverageRatio: zoneArea > 0 ? area / zoneArea : 0, roomCoverageRatio: room.areaSquareMeters > 0 ? area / room.areaSquareMeters : 0 }; }).filter((overlap) => overlap.intersectionAreaSquareMeters > T.overlapAreaSquareMeters).sort((a, b) => b.intersectionAreaSquareMeters - a.intersectionAreaSquareMeters), matched = overlaps.filter((overlap) => overlap.zoneCoverageRatio >= T.zoneCrossRoomMinimumRatio).map((overlap) => overlap.roomRegionId);
    matched.forEach((roomId) => roomToZoneIds[roomId]?.push(zone.id));
    const relationship: ZoneRoomMatch["relationship"] = !overlaps.length ? "unmatched-zone" : matched.length > 1 ? "zone-crosses-rooms" : overlaps[0]!.zoneCoverageRatio >= T.zoneRoomMatchMinimumRatio ? "one-to-one" : "partial";
    return { zoneId: zone.id, levelId: zone.levelId, overlaps, matchedRoomRegionIds: matched, relationship, confidence: relationship === "one-to-one" ? "medium" : relationship === "unmatched-zone" ? "low" : "medium", diagnostics: relationship === "zone-crosses-rooms" ? [`Zone 与 ${matched.length} 个 Room Region 有显著面积重叠`] : relationship === "unmatched-zone" ? ["Zone 未与任何可靠 Room Region 匹配"] : [] };
  });
  for (const match of zoneMatches) if (match.relationship === "one-to-one" && match.matchedRoomRegionIds[0] && (roomToZoneIds[match.matchedRoomRegionIds[0]]?.length ?? 0) > 1) match.relationship = "room-with-multiple-zones";
  const zoneOverlaps: ZonePairOverlap[] = [];
  handoff.zones.forEach((zone, index) => handoff.zones.slice(index + 1).filter((other) => other.levelId === zone.levelId).forEach((other) => {
    const overlapArea = intersectionArea([close(zone.outline as Ring)], [close(other.outline as Ring)]), smallerArea = Math.min(zone.areaSquareMeters ?? polygonArea(zone.outline as Ring), other.areaSquareMeters ?? polygonArea(other.outline as Ring));
    if (overlapArea > T.overlapAreaSquareMeters) zoneOverlaps.push({ zoneAId: zone.id, zoneBId: other.id, levelId: zone.levelId, intersectionAreaSquareMeters: overlapArea, smallerZoneCoverageRatio: smallerArea > 0 ? overlapArea / smallerArea : 0 });
  }));
  const unmatchedRoomRegionIds = rooms.filter((room) => room.usableForEvaluation && !(roomToZoneIds[room.roomRegionId]?.length)).map((room) => room.roomRegionId);
  const analysis = { envelopes, rooms, zoneMatches, zoneOverlaps, unmatchedRoomRegionIds, roomToZoneIds, diagnostics };
  roomRegionCache.set(handoff, analysis);
  return analysis;
}
