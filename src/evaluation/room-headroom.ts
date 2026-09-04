import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import type { MultiPolygon, Ring } from "./envelope";
import { intersectedAreaSquareMeters, unionMultiPolygons } from "./g2-geometry";
import type { RoomRegion, RoomRegionAnalysis } from "./room-regions";
import type { ConfidenceLevel } from "./types";

export type HeadroomRoomUse = "habitable" | "kitchen" | "hallway" | "bathroom" | "toilet_room" | "laundry" | "basement_nonhabitable" | "other" | "unknown";

export type HeadroomHeightRegion = {
  ceilingId: string;
  heightMeters: number;
  areaWithinRoomSquareMeters: number;
  polygons: MultiPolygon;
  measurementBasis: "explicit" | "derived";
};

export type RoomHeadroomEvidence = {
  roomId: string;
  levelId: string;
  use: HeadroomRoomUse;
  roomAreaSquareMeters: number;
  roomPolygons: MultiPolygon;
  finishedFloorBasis: string;
  heightRegions: HeadroomHeightRegion[];
  coveredAreaSquareMeters: number;
  uncoveredAreaSquareMeters: number;
  coverageRatio: number;
  minimumMappedHeightMeters: number | null;
  maximumMappedHeightMeters: number | null;
  multipleHeightRegions: boolean;
  slopedCeiling: boolean;
  overlappingHeightEvidence: boolean;
  measurementBasis: "derived";
  confidence: ConfidenceLevel;
  assumptions: string[];
  missingData: string[];
};

export type RoomHeadroomAnalysis = {
  rooms: RoomHeadroomEvidence[];
};

export type RoomHeadroomOptions = {
  roomUses?: Record<string, HeadroomRoomUse>;
  slopedRoomIds?: string[];
  finishedFloorBasisByLevelId?: Record<string, string>;
};

const ceilingPolygon = (ceiling: EvaluationHandoff["ceilings"][number]): MultiPolygon =>
  ceiling.outline.length >= 3 ? [[ceiling.outline as Ring, ...(ceiling.holes as Ring[])]] : [];

export function buildRoomHeadroomAnalysis(
  handoff: EvaluationHandoff,
  roomAnalysis: RoomRegionAnalysis,
  options: RoomHeadroomOptions = {},
): RoomHeadroomAnalysis {
  const slopedIds = new Set(options.slopedRoomIds ?? []);
  const rooms = roomAnalysis.rooms.filter((room) => room.usableForEvaluation).map((room): RoomHeadroomEvidence => {
    const ceilings = handoff.ceilings.filter((ceiling) =>
      ceiling.visible && ceiling.levelId === room.levelId && Number.isFinite(ceiling.heightMeters) && ceiling.outline.length >= 3);
    const regions = ceilings.map((ceiling): HeadroomHeightRegion => {
      const polygons = ceilingPolygon(ceiling);
      return {
        ceilingId: ceiling.id,
        heightMeters: ceiling.heightMeters!,
        areaWithinRoomSquareMeters: intersectedAreaSquareMeters(room.polygons, polygons),
        polygons,
        measurementBasis: "explicit",
      };
    }).filter((region) => region.areaWithinRoomSquareMeters > 1e-7);
    const coveredGeometry = unionMultiPolygons(regions.map((region) => region.polygons));
    const coveredArea = Math.min(room.areaSquareMeters, intersectedAreaSquareMeters(room.polygons, coveredGeometry));
    const sumRegionArea = regions.reduce((sum, region) => sum + region.areaWithinRoomSquareMeters, 0);
    const overlapping = sumRegionArea - coveredArea > Math.max(.01, room.areaSquareMeters * .005) &&
      new Set(regions.map((region) => Math.round(region.heightMeters * 10000))).size > 1;
    const uncoveredArea = Math.max(0, room.areaSquareMeters - coveredArea);
    const coverageRatio = room.areaSquareMeters > 0 ? coveredArea / room.areaSquareMeters : 0;
    const heights = regions.map((region) => region.heightMeters);
    const assumptions = ["Ceiling.height按Level局部完成地面至Ceiling底部的完成净高解释；没有把Level层高、墙高或楼板顶标高当净高"];
    const missingData: string[] = [];
    if (uncoveredArea > Math.max(.01, room.areaSquareMeters * .02)) missingData.push(`${room.roomRegionId}.ceilingCoverage`);
    if (overlapping) missingData.push(`${room.roomRegionId}.overlappingCeilingHeightPriority`);
    if (!regions.length) missingData.push(`${room.roomRegionId}.ceilingHeightRegions`);
    if (slopedIds.has(room.roomRegionId)) assumptions.push("评价配置明确该Room按坡顶面积比例规则执行");
    return {
      roomId: room.roomRegionId,
      levelId: room.levelId,
      use: options.roomUses?.[room.roomRegionId] ?? "unknown",
      roomAreaSquareMeters: room.areaSquareMeters,
      roomPolygons: room.polygons,
      finishedFloorBasis: options.finishedFloorBasisByLevelId?.[room.levelId] ?? "Level local finished-floor plane",
      heightRegions: regions,
      coveredAreaSquareMeters: coveredArea,
      uncoveredAreaSquareMeters: uncoveredArea,
      coverageRatio,
      minimumMappedHeightMeters: heights.length ? Math.min(...heights) : null,
      maximumMappedHeightMeters: heights.length ? Math.max(...heights) : null,
      multipleHeightRegions: new Set(heights.map((height) => Math.round(height * 10000))).size > 1,
      slopedCeiling: slopedIds.has(room.roomRegionId),
      overlappingHeightEvidence: overlapping,
      measurementBasis: "derived",
      confidence: overlapping || coverageRatio < .98 ? "low" : "high",
      assumptions,
      missingData,
    };
  });
  return { rooms };
}

export function headroomAreaAtOrAbove(room: RoomHeadroomEvidence, thresholdMeters: number) {
  const geometry = unionMultiPolygons(room.heightRegions.filter((region) => region.heightMeters + 1e-9 >= thresholdMeters).map((region) => region.polygons));
  return geometry.length ? intersectedAreaSquareMeters(room.roomPolygons, geometry) : 0;
}

export function findRoomHeadroom(analysis: RoomHeadroomAnalysis, room: RoomRegion) {
  return analysis.rooms.find((item) => item.roomId === room.roomRegionId) ?? null;
}
