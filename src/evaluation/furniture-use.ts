import polygonClipping from "polygon-clipping";
import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { rectangularFootprint, polygonArea, type Ring } from "./envelope";
import type { RoomNavigationAnalysis } from "./navigation";
import { navigationAnalysis } from "./g3-navigation-rules";
import { G1_GEOMETRY_TOLERANCES as T } from "./tolerances";
import { furnitureSemanticOf, hasFunctionTag } from "./object-semantics";

type Item = EvaluationHandoff["furniture"][number] | EvaluationHandoff["equipment"][number] | EvaluationHandoff["columns"][number];
export type FurnitureSemantic = "bed" | "wardrobe" | "sofa" | "lounge-chair" | "office-chair" | "coffee-table" | "tv-cabinet" | "dining-table" | "dining-chair" | "desk" | "other";
export type FurnitureSemanticItem = {
  item: Item;
  semantic: FurnitureSemantic;
  semanticConfidence: "high" | "medium" | "low";
  semanticReason: string;
  bedType: "single" | "double" | "unknown";
  footprint: Ring | null;
  roomRegionId: string | null;
  roomCoverageRatio: number;
};
export type FurnitureUseZone = {
  useZoneId: string;
  ownerObjectId: string;
  roomRegionId: string | null;
  levelId: string | null;
  kind: "bed-left" | "bed-right" | "seating-front" | "dining-chair-pullout";
  polygon: Ring;
  relatedObjectIds: string[];
  confidence: "high" | "medium" | "low";
  usableForEvaluation: boolean;
  diagnostics: string[];
};
export type FurnitureUseZoneAssessment = {
  zone: FurnitureUseZone;
  insideRoomRatio: number;
  blockedAreaRatio: number;
  clearRatio: number;
  blockerIds: string[];
  usable: boolean;
};
export type FurnitureUseAnalysis = {
  navigation: RoomNavigationAnalysis;
  items: FurnitureSemanticItem[];
  useZones: FurnitureUseZone[];
  assessments: FurnitureUseZoneAssessment[];
  diagnostics: string[];
};

const close = (ring: Ring): Ring => ring.length && (ring[0]![0] !== ring[ring.length - 1]![0] || ring[0]![1] !== ring[ring.length - 1]![1]) ? [...ring, ring[0]!] : ring;
const multiArea = (multi: Ring[][]) => multi.reduce((sum, polygon) => sum + polygonArea(polygon[0] ?? []), 0);
const intersectionArea = (a: Ring, b: Ring[]) => { try { return multiArea(polygonClipping.intersection([close(a)] as any, b as any) as Ring[][]); } catch { return 0; } };
const unionIntersectionArea = (zone: Ring, obstacles: Ring[]) => {
  if (!obstacles.length) return 0;
  try { const [first, ...rest] = obstacles.map((ring) => [close(ring)] as any), union = polygonClipping.union(first, ...rest); return multiArea(polygonClipping.intersection([close(zone)] as any, union as any) as Ring[][]); } catch { return 0; }
};
function classify(item: Item): Omit<FurnitureSemanticItem, "footprint" | "roomRegionId" | "roomCoverageRatio"> {
  const resolved = furnitureSemanticOf(item), semantic: FurnitureSemantic = resolved === "armchair" ? "lounge-chair" : ["bed", "wardrobe", "sofa", "office-chair", "coffee-table", "dining-table", "dining-chair", "desk"].includes(resolved) ? resolved as FurnitureSemantic : "other", categoryConflict = item.category === "columns" && semantic !== "other";
  const semanticConfidence = semantic === "other" ? "low" : categoryConflict ? "medium" : "high";
  const semanticReason = categoryConflict ? `源 category=${item.category} 与 ${semantic} 语义冲突；functionTags仍明确支持该语义` : semantic !== "other" ? "functionTags提供明确用途语义" : "functionTags缺少本轮可用家具用途";
  const bedType = semantic !== "bed" ? "unknown" : hasFunctionTag(item, "double-beds") ? "double" : hasFunctionTag(item, "single-beds") ? "single" : "unknown";
  return { item, semantic, semanticConfidence, semanticReason, bedType };
}
const orientedRectangle = (item: Item, centerLocalX: number, centerLocalZ: number, width: number, depth: number): Ring => {
  const [x, z] = item.resolvedWorldPosition!, rotation = item.resolvedRotationRadians!, c = Math.cos(rotation), s = Math.sin(rotation);
  return [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]].map(([dx, dz]) => [x + (centerLocalX + dx) * c + (centerLocalZ + dz) * s, z - (centerLocalX + dx) * s + (centerLocalZ + dz) * c]);
};
export function buildFurnitureUseAnalysis(handoff: EvaluationHandoff): FurnitureUseAnalysis {
  const navigation = navigationAnalysis(handoff), rooms = navigation.graph.roomAnalysis.rooms.filter((room) => room.usableForEvaluation), candidates: Item[] = handoff.items ?? [...handoff.furniture, ...handoff.equipment, ...handoff.columns];
  const items: FurnitureSemanticItem[] = candidates.map((item) => {
    const footprint = rectangularFootprint(item), classified = classify(item), footprintArea = footprint ? polygonArea(footprint) : 0;
    const matches = footprint ? rooms.filter((room) => room.levelId === item.levelId).map((room) => ({ room, area: room.polygons.reduce((sum, polygon) => sum + intersectionArea(footprint, polygon), 0) })).sort((a, b) => b.area - a.area) : [];
    const best = matches[0], roomCoverageRatio = footprintArea > 0 && best ? best.area / footprintArea : 0;
    return { ...classified, footprint, roomRegionId: roomCoverageRatio >= .5 ? best!.room.roomRegionId : null, roomCoverageRatio };
  });
  const useZones: FurnitureUseZone[] = [];
  const add = (owner: FurnitureSemanticItem, kind: FurnitureUseZone["kind"], polygon: Ring, confidence: FurnitureUseZone["confidence"], usableForEvaluation: boolean, diagnostics: string[], relatedObjectIds: string[] = []) => useZones.push({ useZoneId: `${owner.item.id}:${kind}:${useZones.filter((zone) => zone.ownerObjectId === owner.item.id && zone.kind === kind).length + 1}`, ownerObjectId: owner.item.id, roomRegionId: owner.roomRegionId, levelId: owner.item.levelId, kind, polygon, relatedObjectIds, confidence, usableForEvaluation, diagnostics });
  for (const owner of items) {
    const dimensions = owner.item.dimensionsMeters, transformReady = owner.item.resolvedWorldPosition && Number.isFinite(owner.item.resolvedRotationRadians) && dimensions?.length === 3;
    if (!transformReady || !owner.roomRegionId || owner.semanticConfidence === "low") continue;
    const [width, , depth] = dimensions!;
    if (owner.semantic === "bed") {
      add(owner, "bed-left", orientedRectangle(owner.item, -(width! + T.bedAccessDepthMeters) / 2, 0, T.bedAccessDepthMeters, depth!), "medium", true, []);
      add(owner, "bed-right", orientedRectangle(owner.item, (width! + T.bedAccessDepthMeters) / 2, 0, T.bedAccessDepthMeters, depth!), "medium", true, []);
    } else if (owner.semantic === "sofa" || owner.semantic === "lounge-chair") {
      add(owner, "seating-front", orientedRectangle(owner.item, 0, (depth! + T.seatingAccessDepthMeters) / 2, width!, T.seatingAccessDepthMeters), "medium", true, []);
    } else if (owner.semantic === "dining-chair") {
      add(owner, "dining-chair-pullout", orientedRectangle(owner.item, 0, -(depth! + T.diningChairPulloutDepthMeters) / 2, width!, T.diningChairPulloutDepthMeters), "medium", true, ["chair_pullout_uses_local_negative_z"]);
    }
  }
  const footprintById = new Map(items.filter((item) => item.footprint).map((item) => [item.item.id, item.footprint!]));
  const assessments = useZones.map((zone): FurnitureUseZoneAssessment => {
    const room = rooms.find((candidate) => candidate.roomRegionId === zone.roomRegionId), zoneArea = polygonArea(zone.polygon), insideArea = room ? room.polygons.reduce((sum, polygon) => sum + intersectionArea(zone.polygon, polygon), 0) : 0, excluded = new Set([zone.ownerObjectId, ...zone.relatedObjectIds]);
    const blockers = items.filter((candidate) => candidate.item.levelId === zone.levelId && candidate.footprint && !excluded.has(candidate.item.id)).filter((candidate) => intersectionArea(zone.polygon, [candidate.footprint!]) > T.overlapAreaSquareMeters), blockedArea = unionIntersectionArea(zone.polygon, blockers.map((candidate) => candidate.footprint!)), insideRoomRatio = zoneArea > 0 ? Math.min(1, insideArea / zoneArea) : 0, blockedAreaRatio = zoneArea > 0 ? Math.min(1, blockedArea / zoneArea) : 1, clearRatio = Math.max(0, Math.min(insideRoomRatio, 1 - blockedAreaRatio));
    return { zone, insideRoomRatio, blockedAreaRatio, clearRatio, blockerIds: blockers.map((candidate) => candidate.item.id), usable: zone.usableForEvaluation && clearRatio >= T.furnitureUseZoneClearRatio };
  });
  const diagnostics = items.filter((item) => item.semantic !== "other" && (item.semanticConfidence === "low" || item.semanticReason.includes("语义冲突"))).map((item) => `${item.item.id}: ${item.semanticReason}`);
  return { navigation, items, useZones, assessments, diagnostics };
}
