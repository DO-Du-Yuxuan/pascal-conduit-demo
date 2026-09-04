import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { buildObstacles } from "./door-operations";
import { buildBuildingEnvelopes, outsideFootprintArea, polygonArea, rectangularFootprint, type Point, type Ring } from "./envelope";
import { buildOperationUseAnalysis, type OperationUseAnalysis } from "./operation-use";
import { functionTagsOf, furnitureSemanticOf, type FurnitureSemantic } from "./object-semantics";
import { S1_FURNITURE_CONFIG as CONFIG, S1_FURNITURE_RELATION_CONFIG } from "./s1-furniture-config";
import { G1_GEOMETRY_TOLERANCES as T } from "./tolerances";

type Item = EvaluationHandoff["items"][number];
export type S1FurnitureMeasurementStatus = "measured" | "unable_to_determine" | "not_applicable";
export type S1FurniturePairingStatus = "paired" | "ambiguous";
export type S1FurnitureRelativeDirection = "front" | "right" | "back" | "left" | "unable_to_determine";
export type S1FurniturePairType = typeof S1_FURNITURE_RELATION_CONFIG[number]["pairType"];

export type S1FurnitureUseMeasurement = {
  metricId: "S1-FUR";
  measurementId: string;
  itemId: string;
  itemName: string;
  functionTags: string[];
  zoneIds: string[];
  roomRegionId: string | null;
  levelId: string | null;
  footprint: Ring | null;
  minimumUsePolygons: Ring[];
  minimumUseSpaceAvailable: boolean | null;
  minimumUseSpaceAreaSquareMeters: number | null;
  minimumUseSpaceConflictAreaSquareMeters: number | null;
  minimumUseSpaceConflictRatio: number | null;
  minimumUseSpaceConflictItemIds: string[];
  minimumUseSpaceConflictBuildingElementIds: string[];
  maximumOpeningPolygons: Ring[];
  maximumOpeningAvailable: boolean | null;
  maximumOpeningAreaSquareMeters: number | null;
  maximumOpeningConflictAreaSquareMeters: number | null;
  maximumOpeningConflictRatio: number | null;
  maximumOpeningConflictItemIds: string[];
  maximumOpeningConflictBuildingElementIds: string[];
  status: S1FurnitureMeasurementStatus;
  confidence: "high" | "medium" | "low";
  diagnostics: string[];
  missingData: string[];
};

export type S1FurnitureRelationMeasurement = {
  metricId: "S1-FUR";
  relationId: string;
  pairType: S1FurniturePairType;
  pairLabel: string;
  pairingStatus: S1FurniturePairingStatus;
  itemAId: string | null;
  itemBId: string;
  itemAName: string | null;
  itemBName: string;
  itemAFunctionTags: string[];
  itemBFunctionTags: string[];
  candidateItemAIds: string[];
  roomRegionId: string | null;
  levelId: string | null;
  sharedZoneIds: string[];
  sameRoomRegion: boolean | null;
  sameZoneOrFunctionalSpace: boolean | null;
  itemACenter: Point | null;
  itemBCenter: Point | null;
  itemAFootprint: Ring | null;
  itemBFootprint: Ring | null;
  centerDistanceMeters: number | null;
  boundaryDistanceMeters: number | null;
  relativeDirection: S1FurnitureRelativeDirection;
  relativeAngleDegrees: number | null;
  status: S1FurnitureMeasurementStatus;
  confidence: "high" | "medium" | "low";
  diagnostics: string[];
  missingData: string[];
};

export type S1FurnitureRelationGroup = {
  pairType: S1FurniturePairType;
  label: string;
  status: S1FurnitureMeasurementStatus;
  measurementCount: number;
  unableToDetermineCount: number;
  notApplicableCount: number;
  diagnostics: string[];
};

export type S1FurnitureReport = {
  metricId: "S1-FUR";
  metricName: string;
  status: S1FurnitureMeasurementStatus;
  ruleVersion: "v0.1";
  measurementStatus: "原始测量，尚未评分";
  itemMeasurements: S1FurnitureUseMeasurement[];
  relationMeasurements: S1FurnitureRelationMeasurement[];
  relationGroups: S1FurnitureRelationGroup[];
  counts: {
    participatingItems: number;
    itemsWithMinimumUseSpace: number;
    itemsWithMaximumOpening: number;
    minimumUseConflictItems: number;
    maximumOpeningConflictItems: number;
    measuredRelations: number;
    unableToDetermine: number;
    notApplicable: number;
  };
  diagnostics: string[];
};

const round = (value: number) => Math.round(value * 1e9) / 1e9;
const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
const centerOf = (item: Item): Point | null => item.resolvedWorldPosition?.length === 2 ? [item.resolvedWorldPosition[0]!, item.resolvedWorldPosition[1]!] : null;
const pointInRing = (point: Point, ring: Ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
const distancePointSegment = (point: Point, a: Point, b: Point) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], length2 = dx * dx + dz * dz;
  if (length2 <= T.lengthMeters * T.lengthMeters) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / length2));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dz));
};
export const polygonBoundaryDistance = (a: Ring, b: Ring) => {
  if (!a.length || !b.length) return null;
  if (a.some((point) => pointInRing(point, b)) || b.some((point) => pointInRing(point, a))) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const a0 = a[i]!, a1 = a[(i + 1) % a.length]!, b0 = b[j]!, b1 = b[(j + 1) % b.length]!;
    best = Math.min(best, distancePointSegment(a0, b0, b1), distancePointSegment(a1, b0, b1), distancePointSegment(b0, a0, a1), distancePointSegment(b1, a0, a1));
  }
  return Number.isFinite(best) ? round(best) : null;
};

const zoneIdsForItem = (item: Item, handoff: EvaluationHandoff, operation: OperationUseAnalysis) => {
  const center = centerOf(item), owner = operation.items.find((candidate) => candidate.item.id === item.id);
  if (!center || !owner?.roomRegionId) return [];
  const roomZoneIds = new Set(operation.navigation.graph.roomAnalysis.roomToZoneIds[owner.roomRegionId] ?? []);
  return handoff.zones.filter((zone) => zone.levelId === item.levelId && roomZoneIds.has(zone.id) && zone.outline.length >= 3 && pointInRing(center, zone.outline as Ring)).map((zone) => zone.id).sort();
};

const relativePosition = (anchor: Item, partner: Item): { direction: S1FurnitureRelativeDirection; angle: number | null } => {
  const a = centerOf(anchor), b = centerOf(partner), rotation = anchor.resolvedRotationRadians;
  if (!a || !b || !Number.isFinite(rotation)) return { direction: "unable_to_determine", angle: null };
  const vx = b[0] - a[0], vz = b[1] - a[1], length = Math.hypot(vx, vz);
  if (length <= T.lengthMeters) return { direction: "unable_to_determine", angle: null };
  const front: Point = [Math.sin(rotation!), Math.cos(rotation!)], right: Point = [Math.cos(rotation!), -Math.sin(rotation!)], angle = Math.atan2(vx * right[0] + vz * right[1], vx * front[0] + vz * front[1]) * 180 / Math.PI;
  return { direction: angle >= -45 && angle < 45 ? "front" : angle >= 45 && angle < 135 ? "right" : angle >= -135 && angle < -45 ? "left" : "back", angle: round(angle) };
};

const aggregateArea = (rings: Ring[]) => rings.reduce((sum, ring) => sum + polygonArea(ring), 0);

function measureUseSpaces(handoff: EvaluationHandoff, operation: OperationUseAnalysis): S1FurnitureUseMeasurement[] {
  const itemById = new Map((handoff.items ?? []).map((item) => [item.id, item])), obstacles = new Map(buildObstacles(handoff).map((item) => [item.objectId, item])), envelopes = new Map(buildBuildingEnvelopes(handoff).map((item) => [item.levelId, item]));
  const byOwner = new Map<string, typeof operation.assessments>();
  operation.assessments.filter((assessment) => Boolean(assessment.zone.minimumUsePolygon || assessment.zone.openingPolygon)).forEach((assessment) => byOwner.set(assessment.zone.ownerObjectId, [...(byOwner.get(assessment.zone.ownerObjectId) ?? []), assessment]));
  const participantIds = unique([...[...byOwner.keys()], ...(handoff.items ?? []).filter((item) => furnitureSemanticOf(item) !== "other").map((item) => item.id)]);
  return participantIds.flatMap((itemId): S1FurnitureUseMeasurement[] => {
    const assessments = byOwner.get(itemId) ?? [];
    const item = itemById.get(itemId); if (!item) return [];
    const owner = operation.items.find((candidate) => candidate.item.id === itemId), minimum = assessments.filter((entry) => entry.zone.minimumUsePolygon), opening = assessments.filter((entry) => entry.zone.openingPolygon), minimumPolygons = minimum.map((entry) => entry.zone.minimumUsePolygon!), openingPolygons = opening.map((entry) => entry.zone.openingPolygon!), minimumArea = aggregateArea(minimumPolygons), openingArea = aggregateArea(openingPolygons), minimumBlocked = minimum.reduce((sum, entry) => sum + (entry.minimumUseBlockedAreaSquareMeters ?? 0), 0), openingBlocked = opening.reduce((sum, entry) => sum + (entry.openingBlockedAreaSquareMeters ?? 0), 0), minimumBlockers = unique(minimum.flatMap((entry) => entry.minimumUseBlockerIds)), openingBlockers = unique(opening.flatMap((entry) => entry.openingBlockerIds)), split = (ids: string[]) => ({ building: ids.filter((id) => ["wall", "column", "shaft"].includes(obstacles.get(id)?.objectType ?? "")), items: ids.filter((id) => !["wall", "column", "shaft"].includes(obstacles.get(id)?.objectType ?? "")) }), minimumSplit = split(minimumBlockers), openingSplit = split(openingBlockers), envelope = item.levelId ? envelopes.get(item.levelId) : undefined, outsideOpeningArea = envelope ? openingPolygons.reduce((sum, polygon) => sum + (outsideFootprintArea(polygon, envelope) ?? 0), 0) : null, openingEnvelopeResolved = Boolean(envelope?.usableForEvaluation), maximumOpeningAvailable = opening.length ? opening.every((entry) => entry.openingUsable === true) && openingEnvelopeResolved && (outsideOpeningArea ?? Infinity) <= T.operationZoneOutsideAreaSquareMeters : null, status: S1FurnitureMeasurementStatus = owner?.roomRegionId && minimum.length && opening.length && openingEnvelopeResolved ? "measured" : "unable_to_determine";
    const tags = functionTagsOf(item), noExplicitSpace = assessments.length === 0, effectiveStatus: S1FurnitureMeasurementStatus = noExplicitSpace ? "not_applicable" : !tags.length ? "unable_to_determine" : status;
    return [{ metricId: CONFIG.metricId, measurementId: `${CONFIG.metricId}:USE:${itemId}`, itemId, itemName: item.name?.trim() || item.assetName?.trim() || itemId, functionTags: tags, zoneIds: zoneIdsForItem(item, handoff, operation), roomRegionId: owner?.roomRegionId ?? null, levelId: item.levelId, footprint: rectangularFootprint(item), minimumUsePolygons: minimumPolygons, minimumUseSpaceAvailable: minimum.length ? minimum.every((entry) => entry.minimumUseUsable === true) : null, minimumUseSpaceAreaSquareMeters: minimum.length ? round(minimumArea) : null, minimumUseSpaceConflictAreaSquareMeters: minimum.length ? round(minimumBlocked) : null, minimumUseSpaceConflictRatio: minimumArea > T.areaSquareMeters ? round(minimumBlocked / minimumArea) : null, minimumUseSpaceConflictItemIds: minimumSplit.items, minimumUseSpaceConflictBuildingElementIds: minimumSplit.building, maximumOpeningPolygons: openingPolygons, maximumOpeningAvailable, maximumOpeningAreaSquareMeters: opening.length ? round(openingArea) : null, maximumOpeningConflictAreaSquareMeters: opening.length ? round(openingBlocked + (outsideOpeningArea ?? 0)) : null, maximumOpeningConflictRatio: openingArea > T.areaSquareMeters ? round((openingBlocked + (outsideOpeningArea ?? 0)) / openingArea) : null, maximumOpeningConflictItemIds: openingSplit.items, maximumOpeningConflictBuildingElementIds: openingSplit.building, status: effectiveStatus, confidence: effectiveStatus === "measured" ? "high" : effectiveStatus === "not_applicable" ? "high" : "low", diagnostics: [...(noExplicitSpace ? ["该家具未声明最大开启范围或最小使用空间，本项不适用"] : []), ...(outsideOpeningArea && outsideOpeningArea > T.operationZoneOutsideAreaSquareMeters ? [`最大开启范围有 ${outsideOpeningArea.toFixed(3)} m² 越出 Slab 建筑范围`] : []), ...assessments.flatMap((entry) => entry.zone.diagnostics)], missingData: [...(!noExplicitSpace && !tags.length ? [`${itemId}: functionTags`] : []), ...(!noExplicitSpace && !owner?.roomRegionId ? [`${itemId}: 可靠 RoomRegion`] : []), ...(!noExplicitSpace && !openingEnvelopeResolved ? [`${item.levelId ?? itemId}: 可靠 Slab 建筑范围`] : [])] }];
  });
}

type Candidate = { item: Item; semantic: FurnitureSemantic; roomRegionId: string | null; zoneIds: string[]; footprint: Ring | null; center: Point | null };
function candidates(handoff: EvaluationHandoff, operation: OperationUseAnalysis): Candidate[] {
  const ownerById = new Map(operation.items.map((owner) => [owner.item.id, owner]));
  return [...(handoff.items ?? [])].sort((a, b) => a.id.localeCompare(b.id)).map((item) => ({ item, semantic: furnitureSemanticOf(item), roomRegionId: ownerById.get(item.id)?.roomRegionId ?? null, zoneIds: zoneIdsForItem(item, handoff, operation), footprint: rectangularFootprint(item), center: centerOf(item) }));
}

function measureRelations(handoff: EvaluationHandoff, operation: OperationUseAnalysis) {
  const all = candidates(handoff, operation), measurements: S1FurnitureRelationMeasurement[] = [], groups: S1FurnitureRelationGroup[] = [];
  for (const config of S1_FURNITURE_RELATION_CONFIG) {
    const anchors = all.filter((item) => item.semantic === config.anchorSemantic), partners = all.filter((item) => item.semantic === config.partnerSemantic);
    if (!anchors.length || !partners.length) { groups.push({ pairType: config.pairType, label: config.label, status: "not_applicable", measurementCount: 0, unableToDetermineCount: 0, notApplicableCount: 1, diagnostics: [`缺少 functionTags 明确认定的${!anchors.length ? config.anchorSemantic : config.partnerSemantic}实例`] }); continue; }
    for (const partner of partners) {
      const sameZone = anchors.filter((anchor) => anchor.zoneIds.some((id) => partner.zoneIds.includes(id))), sameRoom = anchors.filter((anchor) => anchor.roomRegionId && anchor.roomRegionId === partner.roomRegionId), pool = sameZone.length ? sameZone : sameRoom;
      if (!partner.center || !partner.footprint || !partner.roomRegionId || !pool.length) {
        measurements.push({ metricId: CONFIG.metricId, relationId: `${CONFIG.metricId}:REL:${config.pairType}:${partner.item.id}`, pairType: config.pairType, pairLabel: config.label, pairingStatus: "ambiguous", itemAId: null, itemBId: partner.item.id, itemAName: null, itemBName: partner.item.name?.trim() || partner.item.id, itemAFunctionTags: [], itemBFunctionTags: functionTagsOf(partner.item), candidateItemAIds: pool.map((item) => item.item.id), roomRegionId: partner.roomRegionId, levelId: partner.item.levelId, sharedZoneIds: [], sameRoomRegion: null, sameZoneOrFunctionalSpace: null, itemACenter: null, itemBCenter: partner.center, itemAFootprint: null, itemBFootprint: partner.footprint, centerDistanceMeters: null, boundaryDistanceMeters: null, relativeDirection: "unable_to_determine", relativeAngleDegrees: null, status: "unable_to_determine", confidence: "low", diagnostics: [pool.length ? "候选家具缺少可靠几何" : "没有位于同一功能 Zone 或 RoomRegion 的候选家具"], missingData: [pool.length ? "可靠家具 footprint 与姿态" : "同一功能空间内的关系候选"] }); continue;
      }
      const ranked = pool.map((anchor) => ({ anchor, boundary: anchor.footprint ? polygonBoundaryDistance(anchor.footprint, partner.footprint!) : null, center: anchor.center ? Math.hypot(anchor.center[0] - partner.center![0], anchor.center[1] - partner.center![1]) : null })).filter((item) => item.boundary !== null && item.center !== null).sort((a, b) => a.boundary! - b.boundary! || a.center! - b.center! || a.anchor.item.id.localeCompare(b.anchor.item.id));
      const best = ranked[0], tied = best ? ranked.filter((item) => Math.abs(item.boundary! - best.boundary!) <= CONFIG.pairingTieToleranceMeters && Math.abs(item.center! - best.center!) <= CONFIG.pairingTieToleranceMeters) : [];
      if (!best || tied.length > 1) {
        measurements.push({ metricId: CONFIG.metricId, relationId: `${CONFIG.metricId}:REL:${config.pairType}:${partner.item.id}`, pairType: config.pairType, pairLabel: config.label, pairingStatus: "ambiguous", itemAId: null, itemBId: partner.item.id, itemAName: null, itemBName: partner.item.name?.trim() || partner.item.id, itemAFunctionTags: [], itemBFunctionTags: functionTagsOf(partner.item), candidateItemAIds: (tied.length ? tied : ranked).map((item) => item.anchor.item.id), roomRegionId: partner.roomRegionId, levelId: partner.item.levelId, sharedZoneIds: [], sameRoomRegion: null, sameZoneOrFunctionalSpace: null, itemACenter: null, itemBCenter: partner.center, itemAFootprint: null, itemBFootprint: partner.footprint, centerDistanceMeters: null, boundaryDistanceMeters: null, relativeDirection: "unable_to_determine", relativeAngleDegrees: null, status: "unable_to_determine", confidence: "low", diagnostics: [tied.length > 1 ? `存在 ${tied.length} 个同样合理的稳定候选，未随机选择` : "候选家具缺少可靠几何"], missingData: ["唯一可确定的关系对象"] }); continue;
      }
      const anchor = best.anchor, sharedZoneIds = anchor.zoneIds.filter((id) => partner.zoneIds.includes(id)).sort(), relative = relativePosition(anchor.item, partner.item);
      measurements.push({ metricId: CONFIG.metricId, relationId: `${CONFIG.metricId}:REL:${config.pairType}:${anchor.item.id}:${partner.item.id}`, pairType: config.pairType, pairLabel: config.label, pairingStatus: "paired", itemAId: anchor.item.id, itemBId: partner.item.id, itemAName: anchor.item.name?.trim() || anchor.item.id, itemBName: partner.item.name?.trim() || partner.item.id, itemAFunctionTags: functionTagsOf(anchor.item), itemBFunctionTags: functionTagsOf(partner.item), candidateItemAIds: ranked.map((item) => item.anchor.item.id), roomRegionId: partner.roomRegionId, levelId: partner.item.levelId, sharedZoneIds, sameRoomRegion: anchor.roomRegionId === partner.roomRegionId, sameZoneOrFunctionalSpace: sharedZoneIds.length > 0, itemACenter: anchor.center, itemBCenter: partner.center, itemAFootprint: anchor.footprint, itemBFootprint: partner.footprint, centerDistanceMeters: round(best.center!), boundaryDistanceMeters: best.boundary, relativeDirection: relative.direction, relativeAngleDegrees: relative.angle, status: "measured", confidence: "high", diagnostics: [sameZone.length ? "按同一明确功能 Zone 优先配对" : "无共同明确 Zone，按同一 RoomRegion 与几何关系配对"], missingData: [] });
    }
    const groupMeasurements = measurements.filter((item) => item.pairType === config.pairType), unable = groupMeasurements.filter((item) => item.status === "unable_to_determine").length;
    groups.push({ pairType: config.pairType, label: config.label, status: unable ? "unable_to_determine" : "measured", measurementCount: groupMeasurements.filter((item) => item.status === "measured").length, unableToDetermineCount: unable, notApplicableCount: 0, diagnostics: [] });
  }
  return { measurements: measurements.sort((a, b) => a.relationId.localeCompare(b.relationId)), groups };
}

const emptyFurnitureReport = (diagnostic: string): S1FurnitureReport => ({
  metricId: CONFIG.metricId,
  metricName: CONFIG.metricName,
  status: "not_applicable",
  ruleVersion: CONFIG.ruleVersion,
  measurementStatus: CONFIG.measurementStatus,
  itemMeasurements: [],
  relationMeasurements: [],
  relationGroups: S1_FURNITURE_RELATION_CONFIG.map((config) => ({ pairType: config.pairType, label: config.label, status: "not_applicable", measurementCount: 0, unableToDetermineCount: 0, notApplicableCount: 1, diagnostics: [diagnostic] })),
  counts: { participatingItems: 0, itemsWithMinimumUseSpace: 0, itemsWithMaximumOpening: 0, minimumUseConflictItems: 0, maximumOpeningConflictItems: 0, measuredRelations: 0, unableToDetermine: 0, notApplicable: S1_FURNITURE_RELATION_CONFIG.length },
  diagnostics: [diagnostic],
});

export function measureS1Furniture(handoff: EvaluationHandoff, operation?: OperationUseAnalysis): S1FurnitureReport {
  // Some relationship-only callers intentionally provide a minimal synthetic
  // handoff. Furniture measurement must remain independently not applicable
  // instead of forcing them to construct unrelated navigation collections.
  if (!Array.isArray(handoff.items) || !Array.isArray(handoff.levels)) return emptyFurnitureReport("当前输入没有可参与 S1-FUR 的完整 Item 数据链");
  operation ??= buildOperationUseAnalysis(handoff);
  const itemMeasurements = measureUseSpaces(handoff, operation), relations = measureRelations(handoff, operation), measuredRelations = relations.measurements.filter((item) => item.status === "measured").length, unable = relations.measurements.filter((item) => item.status === "unable_to_determine").length, notApplicable = relations.groups.filter((item) => item.status === "not_applicable").length;
  return { metricId: CONFIG.metricId, metricName: CONFIG.metricName, status: itemMeasurements.length || measuredRelations ? "measured" : unable ? "unable_to_determine" : "not_applicable", ruleVersion: CONFIG.ruleVersion, measurementStatus: CONFIG.measurementStatus, itemMeasurements, relationMeasurements: relations.measurements, relationGroups: relations.groups, counts: { participatingItems: itemMeasurements.length, itemsWithMinimumUseSpace: itemMeasurements.filter((item) => item.minimumUseSpaceAreaSquareMeters !== null).length, itemsWithMaximumOpening: itemMeasurements.filter((item) => item.maximumOpeningAreaSquareMeters !== null).length, minimumUseConflictItems: itemMeasurements.filter((item) => (item.minimumUseSpaceConflictAreaSquareMeters ?? 0) > T.overlapAreaSquareMeters || item.minimumUseSpaceAvailable === false).length, maximumOpeningConflictItems: itemMeasurements.filter((item) => item.maximumOpeningAvailable === false).length, measuredRelations, unableToDetermine: unable, notApplicable }, diagnostics: ["家具使用空间与家具关系分别测量；本指标不生成综合好坏结论", "正式用途仅来自 functionTags；asset.category、名称与资产 ID 仅用于显示和诊断"] };
}
