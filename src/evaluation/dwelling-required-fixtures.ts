import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { buildFixtureUseAnalysis } from "./fixture-use";
import { intersectedAreaSquareMeters, pointInMultiPolygon } from "./g2-geometry";
import type { MultiPolygon, Point, Ring } from "./envelope";
import type { RoomRegionAnalysis } from "./room-regions";
import type { ConfidenceLevel } from "./types";

export type RequiredFixtureKind = "water_closet" | "lavatory" | "bathing_fixture" | "kitchen_sink";

export type RequiredFixtureEvidence = {
  objectId: string;
  pascalSourceId: string;
  levelId: string | null;
  roomRegionId: string | null;
  roomNames: string[];
  kind: RequiredFixtureKind;
  measurementBasis: "explicit" | "derived";
  confidence: ConfidenceLevel;
  assumptions: string[];
};

export type KitchenAreaEvidence = {
  areaId: string;
  kind: "zone" | "room";
  name: string;
  levelId: string;
  roomRegionId: string | null;
  zoneId: string | null;
  polygons: MultiPolygon;
};

export type KitchenSinkAssociation = {
  objectId: string;
  centerPoint: Point | null;
  roomRegionId: string | null;
  kitchenZoneIds: string[];
  associatedKitchenAreaIds: string[];
  associationBasis: "zone_center" | "zone_footprint" | "room_center" | "room_footprint" | "unassociated" | "unresolved";
  conflictReason: string | null;
};

export type DwellingRequiredFixtureAnalysis = {
  fixtures: RequiredFixtureEvidence[];
  counts: Record<RequiredFixtureKind, number>;
  unresolvedObjectIds: string[];
  showerHeads: Array<{ objectId: string; levelId: string | null; roomRegionId: string | null; centerPoint: Point | null; centerInsideRoom: boolean; confidence: ConfidenceLevel }>;
  kitchenAreas: KitchenAreaEvidence[];
  kitchenSinkAssociations: KitchenSinkAssociation[];
  inventoryReliable: boolean;
  assumptions: string[];
  missingData: string[];
};

const fixtureKinds: RequiredFixtureKind[] = ["water_closet", "lavatory", "bathing_fixture", "kitchen_sink"];
const kitchenName = (value: string | null | undefined) => /KITCHEN|厨房/i.test(value ?? "");
const zonePolygons = (outline: Ring): MultiPolygon => outline.length >= 3 ? [[outline]] : [];
const footprintCoverage = (footprint: Ring | null, polygons: MultiPolygon) => {
  if (!footprint?.length || !polygons.length) return 0;
  const area = Math.abs(footprint.reduce((sum, point, index) => {
    const next = footprint[(index + 1) % footprint.length]!;
    return sum + point[0] * next[1] - point[1] * next[0];
  }, 0) / 2);
  return area > 1e-9 ? intersectedAreaSquareMeters([[footprint]], polygons) / area : 0;
};

export function buildDwellingRequiredFixtureAnalysis(
  handoff: EvaluationHandoff,
  rooms: RoomRegionAnalysis,
  inventoryReliable: boolean,
): DwellingRequiredFixtureAnalysis {
  const fixtureUse = buildFixtureUseAnalysis(handoff);
  const roomNames = (roomId: string | null) => roomId ? (rooms.roomToZoneIds[roomId] ?? [])
    .map((zoneId) => handoff.zones.find((zone) => zone.id === zoneId)?.name?.trim())
    .filter((name): name is string => Boolean(name)) : [];
  const kitchenZones = handoff.zones.filter((zone): zone is typeof zone & { levelId: string } => kitchenName(zone.name) && typeof zone.levelId === "string" && zone.outline.length >= 3);
  const kitchenAreas: KitchenAreaEvidence[] = kitchenZones.map((zone) => ({
    areaId: `zone:${zone.id}`, kind: "zone", name: zone.name ?? "未命名厨房区", levelId: zone.levelId,
    roomRegionId: rooms.rooms.find((room) => (rooms.roomToZoneIds[room.roomRegionId] ?? []).includes(zone.id))?.roomRegionId ?? null,
    zoneId: zone.id, polygons: zonePolygons(zone.outline),
  }));
  rooms.rooms.filter((room) => room.usableForEvaluation).forEach((room) => {
    const names = roomNames(room.roomRegionId), hasKitchenZone = (rooms.roomToZoneIds[room.roomRegionId] ?? []).some((zoneId) => kitchenZones.some((zone) => zone.id === zoneId));
    if (names.some(kitchenName) && !hasKitchenZone) kitchenAreas.push({
      areaId: `room:${room.roomRegionId}`, kind: "room", name: names.find(kitchenName) ?? "Kitchen Room", levelId: room.levelId,
      roomRegionId: room.roomRegionId, zoneId: null, polygons: room.polygons,
    });
  });
  const fixtures: RequiredFixtureEvidence[] = [];
  const showerHeads: DwellingRequiredFixtureAnalysis["showerHeads"] = [];
  const kitchenSinkAssociations: KitchenSinkAssociation[] = [];
  const unresolved = new Set<string>();
  const add = (entry: typeof fixtureUse.items[number], kind: RequiredFixtureKind, assumptions: string[]) => {
    fixtures.push({
      objectId: entry.item.id,
      pascalSourceId: entry.item.rawPascalId,
      levelId: entry.item.levelId,
      roomRegionId: entry.roomRegionId,
      roomNames: roomNames(entry.roomRegionId),
      kind,
      measurementBasis: entry.semanticConfidence === "high" ? "explicit" : "derived",
      confidence: entry.roomRegionId && entry.semanticConfidence === "high" ? "high" : entry.semanticConfidence,
      assumptions,
    });
  };

  fixtureUse.items.forEach((entry) => {
    const names = roomNames(entry.roomRegionId), bathroomRoom = names.some((name) => /BATH|TOILET|WC|卫生间|浴室/i.test(name));
    const kitchenRoom = names.some(kitchenName);
    if (entry.semantic === "shower-head") {
      const center = entry.item.resolvedWorldPosition as Point | null;
      const room = entry.roomRegionId ? rooms.rooms.find((candidate) => candidate.roomRegionId === entry.roomRegionId) : null;
      showerHeads.push({ objectId: entry.item.id, levelId: entry.item.levelId, roomRegionId: entry.roomRegionId, centerPoint: center, centerInsideRoom: Boolean(center && room && pointInMultiPolygon(center, room.polygons)), confidence: entry.roomRegionId && center && room ? entry.semanticConfidence : "low" });
      return;
    }
    if (entry.semantic === "toilet" && entry.semanticConfidence !== "low") {
      add(entry, "water_closet", ["对象functionTags明确支持water closet语义"]);
      return;
    }
    if ((entry.semantic === "basin" || entry.semantic === "sink" && bathroomRoom) && entry.semanticConfidence !== "low") {
      add(entry, "lavatory", [entry.semantic === "basin" ? "对象语义明确为lavatory/basin" : "Sink结合Bathroom Room或明确lavatory标签识别为洗面盆"]);
      return;
    }
    if ((entry.semantic === "bathtub" || entry.semantic === "shower") && entry.semanticConfidence !== "low") {
      add(entry, "bathing_fixture", ["对象functionTags明确支持bathtub或shower设施语义"]);
      return;
    }
    if (entry.semantic === "sink" && entry.semanticConfidence !== "low") {
      const center = entry.item.resolvedWorldPosition as Point | null;
      const zoneMatches = kitchenAreas.filter((area) => area.levelId === entry.item.levelId && area.kind === "zone" && (
        Boolean(center && pointInMultiPolygon(center, area.polygons)) || footprintCoverage(entry.footprint, area.polygons) >= .5));
      const roomMatches = !zoneMatches.length ? kitchenAreas.filter((area) => area.levelId === entry.item.levelId && area.kind === "room" && (
        Boolean(center && pointInMultiPolygon(center, area.polygons)) || footprintCoverage(entry.footprint, area.polygons) >= .5)) : [];
      const matches = [...zoneMatches, ...roomMatches], basis: KitchenSinkAssociation["associationBasis"] = zoneMatches.length
        ? (center && pointInMultiPolygon(center, zoneMatches[0]!.polygons) ? "zone_center" : "zone_footprint")
        : roomMatches.length ? (center && pointInMultiPolygon(center, roomMatches[0]!.polygons) ? "room_center" : "room_footprint")
          : center ? "unassociated" : "unresolved";
      const conflictReason = zoneMatches.length && !kitchenRoom && entry.roomRegionId
        ? `厨房水槽资产所属Room为${names.join(" / ") || "非厨房Room"}，但其几何位于Kitchen Zone；按Zone优先关联`
        : !matches.length && entry.roomRegionId ? `厨房水槽资产位于${names.join(" / ") || "未命名Room"}，且不在任何可靠Kitchen Area内` : null;
      kitchenSinkAssociations.push({ objectId: entry.item.id, centerPoint: center, roomRegionId: entry.roomRegionId, kitchenZoneIds: zoneMatches.map((area) => area.zoneId!).filter(Boolean), associatedKitchenAreaIds: matches.map((area) => area.areaId), associationBasis: basis, conflictReason });
      add(entry, "kitchen_sink", [matches.length ? `Sink通过${basis}关联至${matches.map((area) => area.name).join(" / ")}` : conflictReason ?? "Kitchen Sink缺少可确认Kitchen Area关联"]);
      return;
    }
    if (entry.semantic === "sink" || entry.semantic === "basin") unresolved.add(entry.item.id);
  });

  const counts = Object.fromEntries(fixtureKinds.map((kind) => [kind, fixtures.filter((fixture) => fixture.kind === kind).length])) as Record<RequiredFixtureKind, number>;
  const missingData: string[] = [];
  if (!inventoryReliable) missingData.push("project.fixtureInventoryCompleteness");
  if (unresolved.size) missingData.push(...[...unresolved].map((id) => `${id}.requiredFixtureSemantic`));
  return {
    fixtures,
    counts,
    unresolvedObjectIds: [...unresolved],
    showerHeads,
    kitchenAreas,
    kitchenSinkAssociations,
    inventoryReliable,
    assumptions: ["只汇总可靠结构化对象；不根据Room名称虚构缺失设施", "Cooking Appliance不属于G2-019必需设施"],
    missingData,
  };
}
