import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { polygonArea, type MultiPolygon, type Point, type Ring } from "./envelope";
import { findInscribedCircle, maximumInscribedCircleDiameter } from "./g2-geometry";
import { buildFixtureUseAnalysis } from "./fixture-use";
import { hasFunctionTag } from "./object-semantics";
import type { RoomHeadroomAnalysis } from "./room-headroom";

export type ShowerCompartmentOverride = {
  showerId: string;
  levelId: string;
  roomRegionId: string | null;
  /** This is an explicit completed inside face, not an asset bounding box. */
  finishedInteriorPolygon?: MultiPolygon;
  outerFootprint?: Ring;
  receptorOverallWidthMeters?: number | null;
  receptorOverallLengthMeters?: number | null;
  isException2Receptor?: boolean;
  source?: string;
};

export type ShowerCompartmentEvidence = {
  showerId: string;
  levelId: string;
  roomRegionId: string | null;
  objectType: "shower_compartment";
  receptorObjectId: string | null;
  enclosureObjectIds: string[];
  outerFootprint: Ring | null;
  finishedInteriorPolygon: MultiPolygon | null;
  finishedInteriorAreaSquareMeters: number | null;
  maximumInscribedCircleDiameterMeters: number | null;
  inscribedCircleCenter: Point | null;
  inscribedCirclePolygon: Ring | null;
  exception2: { requested: boolean; widthMeters: number | null; lengthMeters: number | null; source: string | null };
  headroom: { status: "pass" | "issue" | "unable_to_determine"; minimumHeightMeters: number | null; source: string; missingData: string[] };
  measurementBasis: "explicit" | "derived";
  confidence: "high" | "medium" | "low";
  assumptions: string[];
  missingData: string[];
  locatableObjectIds: string[];
};

export type ShowerCompartmentAnalysis = { compartments: ShowerCompartmentEvidence[]; showerheadObjectIds: string[]; bathtubObjectIds: string[]; assumptions: string[] };

const areaOf = (multi: MultiPolygon) => multi.reduce((sum, polygon) => sum + Math.max(0, polygonArea(polygon[0] ?? []) - polygon.slice(1).reduce((holes, hole) => holes + polygonArea(hole), 0)), 0);

function headroomFor(roomRegionId: string | null, headroom: RoomHeadroomAnalysis, thresholdMeters: number) {
  const room = roomRegionId ? headroom.rooms.find((item) => item.roomId === roomRegionId) : null;
  if (!room) return { status: "unable_to_determine" as const, minimumHeightMeters: null, source: "未能关联Room的Ceiling证据", missingData: ["showerCompartment.roomCeiling"] };
  const uniform = room.coverageRatio >= .98 && !room.multipleHeightRegions && !room.overlappingHeightEvidence && room.minimumMappedHeightMeters !== null;
  if (!uniform) return { status: "unable_to_determine" as const, minimumHeightMeters: room.minimumMappedHeightMeters, source: "Room Ceiling存在覆盖缺口、多高度或重叠证据，可能影响淋浴间范围", missingData: ["showerCompartment.localCeilingCoverage"] };
  return room.minimumMappedHeightMeters! + 1e-9 >= thresholdMeters
    ? { status: "pass" as const, minimumHeightMeters: room.minimumMappedHeightMeters, source: "整个所属Room由统一Ceiling覆盖；以其最低可靠净高作为淋浴间70in范围下界", missingData: [] }
    : { status: "issue" as const, minimumHeightMeters: room.minimumMappedHeightMeters, source: "整个所属Room由统一Ceiling覆盖，但最低可靠净高低于70in", missingData: [] };
}

export function buildShowerCompartmentAnalysis(
  handoff: EvaluationHandoff,
  headroom: RoomHeadroomAnalysis,
  thresholdMeters: number,
  requiredCircleDiameterMeters: number,
  overrides: Record<string, ShowerCompartmentOverride> | undefined = undefined,
): ShowerCompartmentAnalysis {
  const fixture = buildFixtureUseAnalysis(handoff), assumptions = ["仅明确独立Shower Compartment、接水盘或固定围合对象进入本规则；Showerhead和Bathtub本身不会创建淋浴间。"];
  const explicit = fixture.items.filter((entry) => entry.semantic === "shower" && hasFunctionTag(entry.item, "shower-enclosures", "shower-enclosure", "showers"));
  const entries = new Map<string, ShowerCompartmentEvidence>(), groups = new Map<string, typeof explicit>();
  for (const entry of explicit) { const key = `${entry.item.levelId}:${entry.roomRegionId ?? entry.item.id}`; groups.set(key, [...(groups.get(key) ?? []), entry]); }
  for (const group of groups.values()) {
    const entry = group[0]!, explicitRing = group.map((item) => (item.item as typeof item.item & { finishedInteriorPolygon?: Ring | null }).finishedInteriorPolygon).find((ring): ring is Ring => Boolean(ring?.length && ring.length >= 3)), finishedInteriorPolygon: MultiPolygon | null = explicitRing ? [[explicitRing]] : null, circle = finishedInteriorPolygon ? findInscribedCircle(finishedInteriorPolygon, requiredCircleDiameterMeters) : null;
    entries.set(entry.item.id, {
      showerId: entry.item.id, levelId: entry.item.levelId!, roomRegionId: entry.roomRegionId, objectType: "shower_compartment", receptorObjectId: null, enclosureObjectIds: group.map((item) => item.item.id), outerFootprint: null, finishedInteriorPolygon,
      finishedInteriorAreaSquareMeters: finishedInteriorPolygon ? areaOf(finishedInteriorPolygon) : null, maximumInscribedCircleDiameterMeters: finishedInteriorPolygon ? maximumInscribedCircleDiameter(finishedInteriorPolygon) : null, inscribedCircleCenter: circle?.center ?? null, inscribedCirclePolygon: circle?.polygon ?? null,
      exception2: { requested: false, widthMeters: null, lengthMeters: null, source: null }, headroom: headroomFor(entry.roomRegionId, headroom, thresholdMeters), measurementBasis: finishedInteriorPolygon ? "explicit" : "derived", confidence: finishedInteriorPolygon ? "high" : "medium",
      assumptions: finishedInteriorPolygon ? ["完成内部轮廓由 Pascal Item.finishedInteriorPolygon 明确提供。"] : ["同一Room内的固定淋浴围合资产合并为一个候选；这些资产是围合构件而非完成内部轮廓，未把其薄型footprint当作淋浴面积。"], missingData: finishedInteriorPolygon ? [] : ["finishedInteriorPolygon"], locatableObjectIds: [...group.map((item) => item.item.id), ...(entry.roomRegionId ? [entry.roomRegionId] : [])],
    });
  }
  for (const override of Object.values(overrides ?? {})) {
    const polygon = override.finishedInteriorPolygon ?? null, circle = polygon ? findInscribedCircle(polygon, requiredCircleDiameterMeters) : null;
    entries.set(override.showerId, {
      showerId: override.showerId, levelId: override.levelId, roomRegionId: override.roomRegionId, objectType: "shower_compartment", receptorObjectId: override.showerId, enclosureObjectIds: [], outerFootprint: override.outerFootprint ?? null, finishedInteriorPolygon: polygon,
      finishedInteriorAreaSquareMeters: polygon ? areaOf(polygon) : null, maximumInscribedCircleDiameterMeters: polygon ? maximumInscribedCircleDiameter(polygon) : override.outerFootprint ? maximumInscribedCircleDiameter([[override.outerFootprint]]) : null,
      inscribedCircleCenter: circle?.center ?? null, inscribedCirclePolygon: circle?.polygon ?? null,
      exception2: { requested: Boolean(override.isException2Receptor), widthMeters: override.receptorOverallWidthMeters ?? null, lengthMeters: override.receptorOverallLengthMeters ?? null, source: override.source ?? "评价配置明确接水盘" },
      headroom: headroomFor(override.roomRegionId, headroom, thresholdMeters), measurementBasis: "explicit", confidence: polygon ? "high" : "medium",
      assumptions: polygon ? ["finishedInteriorPolygon由评价配置明确提供。"] : ["仅有接水盘外轮廓或名义尺寸，不能推定完成内部轮廓。"], missingData: polygon ? [] : ["finishedInteriorPolygon"], locatableObjectIds: [override.showerId, ...(override.roomRegionId ? [override.roomRegionId] : [])],
    });
  }
  return { compartments: [...entries.values()], showerheadObjectIds: fixture.items.filter((entry) => entry.semantic === "shower-head").map((entry) => entry.item.id), bathtubObjectIds: fixture.items.filter((entry) => entry.semantic === "bathtub").map((entry) => entry.item.id), assumptions };
}
