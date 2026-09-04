import polygonClipping from "polygon-clipping";
import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { rectangularFootprint, polygonArea, type Point, type Ring } from "./envelope";
import type { RoomNavigableSpace, RoomNavigationAnalysis } from "./navigation";
import { navigationAnalysis } from "./g3-navigation-rules";
import { buildDoorOperations, buildObstacles, type DoorOperation } from "./door-operations";
import { G1_GEOMETRY_TOLERANCES as T } from "./tolerances";
import { regulatoryUseForZoneName } from "./space-semantics";
import { fixtureSemanticOf } from "./object-semantics";
import { planUseSpaces } from "./object-use-space";

type Item = EvaluationHandoff["furniture"][number] | EvaluationHandoff["equipment"][number] | EvaluationHandoff["columns"][number];
export type FixtureSemantic = "sink" | "stove" | "refrigerator" | "dishwasher" | "oven" | "counter" | "base-cabinet" | "tall-cabinet" | "island" | "toilet" | "basin" | "shower" | "shower-head" | "bathtub" | "other";
export type FixtureRoomKind = "kitchen" | "bathroom" | "other";
export type FixtureUseKind = "kitchen-standing" | "counter-standing" | "toilet-front" | "basin-front" | "shower-entry" | "bathtub-entry" | "appliance-operation";
export type FixtureSemanticItem = { item: Item; semantic: FixtureSemantic; semanticConfidence: "high" | "medium" | "low"; semanticReason: string; footprint: Ring | null; roomRegionId: string | null; roomKind: FixtureRoomKind; roomCoverageRatio: number };
export type FixtureUseZone = { useZoneId: string; ownerObjectId: string; roomRegionId: string | null; levelId: string | null; kind: FixtureUseKind; polygon: Ring; confidence: "high" | "medium" | "low"; usableForEvaluation: boolean; measurementBasis: "explicit" | "derived"; diagnostics: string[] };
export type FixtureUseAssessment = { zone: FixtureUseZone; insideRoomRatio: number; blockedAreaRatio: number; clearRatio: number; blockerIds: string[]; reachableFromRoomEntry: boolean; usable: boolean };
export type FixtureUseAnalysis = { navigation: RoomNavigationAnalysis; items: FixtureSemanticItem[]; useZones: FixtureUseZone[]; assessments: FixtureUseAssessment[]; doorOperations: DoorOperation[]; kitchenRooms: RoomNavigableSpace[]; bathroomRooms: RoomNavigableSpace[]; diagnostics: string[] };

const close = (ring: Ring): Ring => ring.length && (ring[0]![0] !== ring[ring.length - 1]![0] || ring[0]![1] !== ring[ring.length - 1]![1]) ? [...ring, ring[0]!] : ring;
const multiArea = (multi: Ring[][]) => multi.reduce((sum, polygon) => sum + polygonArea(polygon[0] ?? []), 0);
const intersectionArea = (a: Ring, b: Ring[]) => { try { return multiArea(polygonClipping.intersection([close(a)] as any, b as any) as Ring[][]); } catch { return 0; } };
const unionIntersectionArea = (zone: Ring, obstacles: Ring[]) => { if (!obstacles.length) return 0; try { const [first, ...rest] = obstacles.map((ring) => [close(ring)] as any), union = polygonClipping.union(first, ...rest); return multiArea(polygonClipping.intersection([close(zone)] as any, union as any) as Ring[][]); } catch { return 0; } };
const pointInRing = (point: Point, ring: Ring) => { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i]!, b = ring[j]!; if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; };
const roomKindOf = (names: string[]): FixtureRoomKind => {
  const uses = names.map(regulatoryUseForZoneName);
  return uses.includes("kitchen") ? "kitchen" : uses.includes("bathroom") ? "bathroom" : "other";
};
const orientedRectangle = (item: Item, localX: number, localZ: number, width: number, depth: number): Ring => { const [x, z] = item.resolvedWorldPosition!, rotation = item.resolvedRotationRadians!, c = Math.cos(rotation), s = Math.sin(rotation); return [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]].map(([dx, dz]) => [x + (localX + dx) * c + (localZ + dz) * s, z - (localX + dx) * s + (localZ + dz) * c]); };

function classify(item: Item): Pick<FixtureSemanticItem, "semantic" | "semanticConfidence" | "semanticReason"> {
  const resolved = fixtureSemanticOf(item), semantic: FixtureSemantic = resolved === "showerhead" ? "shower-head" : resolved === "washer" ? "other" : resolved, categoryConflict = item.category === "columns" && semantic !== "other", semanticConfidence = semantic === "other" ? "low" : categoryConflict ? "medium" : "high";
  return { semantic, semanticConfidence, semanticReason: categoryConflict ? `源 category=${item.category} 与 ${semantic} 语义冲突；functionTags仍明确支持该语义` : semantic !== "other" ? "functionTags提供明确用途语义" : "functionTags缺少本轮可用厨卫用途" };
}

export function buildFixtureUseAnalysis(handoff: EvaluationHandoff): FixtureUseAnalysis {
  const navigation = navigationAnalysis(handoff), rooms = navigation.rooms, candidates: Item[] = handoff.items ?? [...handoff.furniture, ...handoff.equipment, ...handoff.columns];
  const items: FixtureSemanticItem[] = candidates.map((item) => { const footprint = rectangularFootprint(item), classified = classify(item), area = footprint ? polygonArea(footprint) : 0, matches = footprint ? navigation.graph.roomAnalysis.rooms.filter((room) => room.usableForEvaluation && room.levelId === item.levelId).map((room) => ({ room, area: room.polygons.reduce((sum, polygon) => sum + intersectionArea(footprint, polygon), 0) })).sort((a, b) => b.area - a.area) : [], best = matches[0], ratio = area > 0 && best ? best.area / area : 0, roomRegionId = ratio >= .5 ? best!.room.roomRegionId : null, navRoom = rooms.find((room) => room.roomRegionId === roomRegionId), roomKind = roomKindOf(navRoom?.zoneNames ?? []); let semantic = classified.semantic; if (semantic === "sink" && roomKind === "bathroom") semantic = "basin"; return { item, ...classified, semantic, footprint, roomRegionId, roomKind, roomCoverageRatio: ratio }; });
  const useZones: FixtureUseZone[] = [], add = (owner: FixtureSemanticItem, kind: FixtureUseKind, depth: number, diagnostics: string[] = []) => {
    const dimensions = owner.item.dimensionsMeters;
    if (!owner.item.resolvedWorldPosition || !Number.isFinite(owner.item.resolvedRotationRadians) || !dimensions || !owner.roomRegionId || owner.semanticConfidence === "low") return;
    const explicitSpaces = planUseSpaces(owner.item);
    if (explicitSpaces.length) {
      explicitSpaces.forEach((space) => useZones.push({ useZoneId: `${owner.item.id}:${kind}:${space.direction}`, ownerObjectId: owner.item.id, roomRegionId: owner.roomRegionId, levelId: owner.item.levelId, kind, polygon: space.minimumUsePolygon, confidence: owner.semanticConfidence, usableForEvaluation: true, measurementBasis: "explicit", diagnostics: [...space.assumptions, ...diagnostics] }));
      return;
    }
    const [width, , objectDepth] = dimensions;
    useZones.push({ useZoneId: `${owner.item.id}:${kind}`, ownerObjectId: owner.item.id, roomRegionId: owner.roomRegionId, levelId: owner.item.levelId, kind, polygon: orientedRectangle(owner.item, 0, (objectDepth! + depth) / 2, width!, depth), confidence: owner.semanticConfidence, usableForEvaluation: true, measurementBasis: "derived", diagnostics: ["fixture_front_uses_local_positive_z", ...diagnostics] });
  };
  for (const owner of items) {
    if (owner.roomKind === "kitchen") {
      if (["sink", "stove", "refrigerator"].includes(owner.semantic)) add(owner, "kitchen-standing", T.fixtureStandingDepthMeters);
      else if (["counter", "base-cabinet", "island"].includes(owner.semantic)) add(owner, "counter-standing", T.fixtureStandingDepthMeters);
      else if (["dishwasher", "oven", "tall-cabinet"].includes(owner.semantic)) add(owner, "appliance-operation", T.fixtureStandingDepthMeters, ["opening_geometry_not_available"]);
    } else if (owner.roomKind === "bathroom") {
      if (owner.semantic === "toilet") add(owner, "toilet-front", T.fixtureStandingDepthMeters);
      else if (owner.semantic === "basin" || owner.semantic === "sink") add(owner, "basin-front", T.fixtureStandingDepthMeters);
      else if (owner.semantic === "shower") add(owner, "shower-entry", T.bathEntryDepthMeters, ["shower_door_operation_not_assumed"]);
      else if (owner.semantic === "bathtub") add(owner, "bathtub-entry", T.bathEntryDepthMeters, ["bathtub_primary_entry_side_uses_asset_orientation"]);
    }
  }
  const obstacles = buildObstacles(handoff).filter((item) => item.usableForCollision && item.footprint.length >= 3);
  const assessments = useZones.map((zone): FixtureUseAssessment => { const room = navigation.graph.roomAnalysis.rooms.find((candidate) => candidate.roomRegionId === zone.roomRegionId), navRoom = rooms.find((candidate) => candidate.roomRegionId === zone.roomRegionId), area = polygonArea(zone.polygon), inside = room ? room.polygons.reduce((sum, polygon) => sum + intersectionArea(zone.polygon, polygon), 0) : 0, blockers = obstacles.filter((candidate) => candidate.levelId === zone.levelId && candidate.objectId !== zone.ownerObjectId && intersectionArea(zone.polygon, [candidate.footprint]) > T.overlapAreaSquareMeters), blocked = unionIntersectionArea(zone.polygon, blockers.map((candidate) => candidate.footprint)), insideRoomRatio = area > 0 ? Math.min(1, inside / area) : 0, blockedAreaRatio = area > 0 ? Math.min(1, blocked / area) : 1, clearRatio = Math.max(0, Math.min(insideRoomRatio, 1 - blockedAreaRatio)), hasFreeCell = Boolean(navRoom?.navigableFreeCells.some((point) => pointInRing(point, zone.polygon))), reachableFromRoomEntry = Boolean(navRoom?.portalNodes.some((portal) => portal.furnishedLanding) && hasFreeCell && navRoom.furnishedConnected); return { zone, insideRoomRatio, blockedAreaRatio, clearRatio, blockerIds: blockers.map((item) => item.objectId), reachableFromRoomEntry, usable: clearRatio >= T.furnitureUseZoneClearRatio && reachableFromRoomEntry }; });
  const kitchenRooms = rooms.filter((room) => roomKindOf(room.zoneNames) === "kitchen"), bathroomRooms = rooms.filter((room) => roomKindOf(room.zoneNames) === "bathroom"), doorOperations = buildDoorOperations(handoff), diagnostics = items.filter((item) => item.semantic !== "other" && item.semanticReason.includes("语义冲突")).map((item) => `${item.item.id}: ${item.semanticReason}`);
  return { navigation, items, useZones, assessments, doorOperations, kitchenRooms, bathroomRooms, diagnostics };
}
