import polygonClipping from "polygon-clipping";
import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { isSdiSpaceFunctionCode, sdiSpaceFunctionName, type SdiSpaceFunctionCode } from "../space-functions/sdi-space-functions";
import type { RoomConnectivityGraph } from "./connectivity";
import { polygonArea, type MultiPolygon, type Ring } from "./envelope";
import { measureS1EffectiveResidentialIndoorArea } from "./s1-high-frequency-path-scoring";
import { measureFootprintGeometry } from "./s1-space-fragment";
import { S1_SPACE_UTILIZATION_COMPACTNESS_THRESHOLD as COMPACTNESS, S1_SPACE_UTILIZATION_CONVEXITY_THRESHOLD as CONVEXITY, S1_SPACE_UTILIZATION_CORRIDOR_ANCHORS as CORRIDOR_ANCHORS, S1_SPACE_UTILIZATION_CORRIDOR_CODES, S1_SPACE_UTILIZATION_INEFFICIENT_AREA_ANCHORS as SHAPE_ANCHORS, S1_SPACE_UTILIZATION_RULE_STATUS, S1_SPACE_UTILIZATION_RULE_VERSION, S1_SPACE_UTILIZATION_SHAPE_EXCLUDED_CODES } from "./s1-space-utilization-config";

export type S1SpaceUtilizationStatus = "scored" | "not_applicable" | "unable_to_determine";
export type S1UtilizationShapeMeasurement = { zoneId: string; zoneName: string; levelId: string; spaceFunctionCode: SdiSpaceFunctionCode; spaceFunctionName: string; areaSquareMeters: number; compactness: number; convexityRatio: number; status: "normal_shape" | "inefficient_shape"; polygons: MultiPolygon };
export type S1SpaceUtilizationRule = { ruleId: "LY-01" | "LY-02"; ruleName: string; status: S1SpaceUtilizationStatus; score: number | null; diagnostics: string[] };
export type S1SpaceUtilizationReport = { metricId: "S1-LY"; metricName: "空间利用"; status: S1SpaceUtilizationStatus; score: number | null; ruleVersion: typeof S1_SPACE_UTILIZATION_RULE_VERSION; ruleStatus: typeof S1_SPACE_UTILIZATION_RULE_STATUS; ly01: S1SpaceUtilizationRule & { effectiveResidentialIndoorAreaSquareMeters: number | null; corridorAreaSquareMeters: number | null; corridorRatio: number | null; corridorZoneIds: string[] }; ly02: S1SpaceUtilizationRule & { applicableZoneCount: number; applicableAreaSquareMeters: number | null; inefficientShapeAreaSquareMeters: number | null; inefficientShapeAreaRatio: number | null; measurements: S1UtilizationShapeMeasurement[] } };

const reliableMatch = (relationship: string | undefined) => relationship === "one-to-one" || relationship === "room-with-multiple-zones";
const close = (ring: Ring): Ring => ring.length > 2 && (ring[0]![0] !== ring[ring.length - 1]![0] || ring[0]![1] !== ring[ring.length - 1]![1]) ? [...ring, ring[0]!] : ring;
const multiArea = (multi: MultiPolygon) => multi.reduce((sum, polygon) => sum + Math.max(0, polygonArea(polygon[0] ?? []) - polygon.slice(1).reduce((holes, hole) => holes + polygonArea(hole), 0)), 0);
const roundOne = (value: number) => Math.round(value * 10) / 10;
function interpolate(value: number, anchors: readonly { value: number; score: number }[]) { if (value <= anchors[0]!.value) return anchors[0]!.score; if (value >= anchors[anchors.length - 1]!.value) return anchors[anchors.length - 1]!.score; const upperIndex = anchors.findIndex((anchor) => value <= anchor.value), upper = anchors[upperIndex]!, lower = anchors[upperIndex - 1]!; return lower.score + (upper.score - lower.score) * (value - lower.value) / (upper.value - lower.value); }

type ReliableZoneGeometry = { zone: EvaluationHandoff["zones"][number]; code: SdiSpaceFunctionCode; polygons: MultiPolygon };
function reliableZoneGeometries(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, predicate: (code: SdiSpaceFunctionCode) => boolean) {
  const rooms = new Map(graph.roomAnalysis.rooms.map((room) => [room.roomRegionId, room])), matches = new Map(graph.roomAnalysis.zoneMatches.map((match) => [match.zoneId, match])); const valid: ReliableZoneGeometry[] = [], invalid: string[] = [];
  for (const zone of handoff.zones) {
    if (!isSdiSpaceFunctionCode(zone.spaceFunctionCode) || Number(zone.spaceFunctionCode.slice(2)) >= 50 || !predicate(zone.spaceFunctionCode)) continue;
    const match = matches.get(zone.id), roomId = match?.matchedRoomRegionIds.length === 1 ? match.matchedRoomRegionIds[0] : null, room = roomId ? rooms.get(roomId) : null;
    if (!room || !room.usableForEvaluation || !reliableMatch(match?.relationship) || !zone.levelId || !Array.isArray(zone.outline) || zone.outline.length < 3) { invalid.push(zone.id); continue; }
    try { const polygons = polygonClipping.intersection([[close(zone.outline as Ring)]] as any, room.polygons as any) as MultiPolygon; if (!polygons.length || multiArea(polygons) <= 1e-8) invalid.push(zone.id); else valid.push({ zone, code: zone.spaceFunctionCode, polygons }); } catch { invalid.push(zone.id); }
  }
  return { valid, invalid: invalid.sort() };
}
function unionAreaByLevel(values: ReliableZoneGeometry[]) {
  const levels = new Map<string, MultiPolygon[]>(); values.forEach((item) => levels.set(item.zone.levelId!, [...(levels.get(item.zone.levelId!) ?? []), item.polygons]));
  try { return [...levels.values()].reduce((sum, polygons) => { const [first, ...rest] = polygons; return sum + multiArea(polygonClipping.union(first as any, ...rest as any) as MultiPolygon); }, 0); } catch { return null; }
}

function ly01(handoff: EvaluationHandoff, graph: RoomConnectivityGraph): S1SpaceUtilizationReport["ly01"] {
  const effective = measureS1EffectiveResidentialIndoorArea(handoff, graph); if (effective.status !== "measured" || effective.squareMeters === null) return { ruleId: "LY-01", ruleName: "显式纯交通面积占比", status: "unable_to_determine", score: null, effectiveResidentialIndoorAreaSquareMeters: effective.squareMeters, corridorAreaSquareMeters: null, corridorRatio: null, corridorZoneIds: [], diagnostics: effective.diagnostics };
  const corridor = reliableZoneGeometries(handoff, graph, (code) => S1_SPACE_UTILIZATION_CORRIDOR_CODES.has(code)); if (corridor.invalid.length) return { ruleId: "LY-01", ruleName: "显式纯交通面积占比", status: "unable_to_determine", score: null, effectiveResidentialIndoorAreaSquareMeters: effective.squareMeters, corridorAreaSquareMeters: null, corridorRatio: null, corridorZoneIds: corridor.valid.map((item) => item.zone.id), diagnostics: [`SF09 走道 Zone 缺少可靠有效几何：${corridor.invalid.join("、")}`] };
  const area = corridor.valid.length ? unionAreaByLevel(corridor.valid) : 0; if (area === null) return { ruleId: "LY-01", ruleName: "显式纯交通面积占比", status: "unable_to_determine", score: null, effectiveResidentialIndoorAreaSquareMeters: effective.squareMeters, corridorAreaSquareMeters: null, corridorRatio: null, corridorZoneIds: corridor.valid.map((item) => item.zone.id), diagnostics: ["SF09 走道几何并集计算失败。"] };
  const ratio = area / effective.squareMeters; return { ruleId: "LY-01", ruleName: "显式纯交通面积占比", status: "scored", score: roundOne(interpolate(ratio, CORRIDOR_ANCHORS)), effectiveResidentialIndoorAreaSquareMeters: effective.squareMeters, corridorAreaSquareMeters: area, corridorRatio: ratio, corridorZoneIds: corridor.valid.map((item) => item.zone.id).sort(), diagnostics: [area ? `独立 SF09 走道占有效住宅面积 ${(ratio * 100).toFixed(1)}%。` : "没有独立 SF09 走道面积。"] };
}

function ly02(handoff: EvaluationHandoff, graph: RoomConnectivityGraph): S1SpaceUtilizationReport["ly02"] {
  const shapes = reliableZoneGeometries(handoff, graph, (code) => !S1_SPACE_UTILIZATION_SHAPE_EXCLUDED_CODES.has(code)); if (shapes.invalid.length) return { ruleId: "LY-02", ruleName: "二维低效形状", status: "unable_to_determine", score: null, applicableZoneCount: shapes.valid.length, applicableAreaSquareMeters: null, inefficientShapeAreaSquareMeters: null, inefficientShapeAreaRatio: null, measurements: [], diagnostics: [`适用功能 Zone 缺少可靠有效几何：${shapes.invalid.join("、")}`] };
  if (!shapes.valid.length) return { ruleId: "LY-02", ruleName: "二维低效形状", status: "not_applicable", score: null, applicableZoneCount: 0, applicableAreaSquareMeters: null, inefficientShapeAreaSquareMeters: null, inefficientShapeAreaRatio: null, measurements: [], diagnostics: ["不存在可参与二维形状评价的正式功能 Zone。"] };
  const measurements: S1UtilizationShapeMeasurement[] = [];
  for (const item of shapes.valid) { const geometry = measureFootprintGeometry(item.polygons); if (!geometry) return { ruleId: "LY-02", ruleName: "二维低效形状", status: "unable_to_determine", score: null, applicableZoneCount: shapes.valid.length, applicableAreaSquareMeters: null, inefficientShapeAreaSquareMeters: null, inefficientShapeAreaRatio: null, measurements, diagnostics: [`${item.zone.id} 无法计算可靠二维形状指标。`] }; const inefficient = geometry.compactness < COMPACTNESS && geometry.convexityRatio < CONVEXITY; measurements.push({ zoneId: item.zone.id, zoneName: item.zone.name?.trim() || item.zone.id, levelId: item.zone.levelId!, spaceFunctionCode: item.code, spaceFunctionName: sdiSpaceFunctionName(item.code)!, areaSquareMeters: geometry.area, compactness: geometry.compactness, convexityRatio: geometry.convexityRatio, status: inefficient ? "inefficient_shape" : "normal_shape", polygons: item.polygons }); }
  const total = unionAreaByLevel(shapes.valid), inefficient = measurements.filter((item) => item.status === "inefficient_shape"), inefficientGeometry = shapes.valid.filter((item) => inefficient.some((measure) => measure.zoneId === item.zone.id)), inefficientArea = unionAreaByLevel(inefficientGeometry); if (total === null || inefficientArea === null || total <= 1e-8) return { ruleId: "LY-02", ruleName: "二维低效形状", status: "unable_to_determine", score: null, applicableZoneCount: measurements.length, applicableAreaSquareMeters: total, inefficientShapeAreaSquareMeters: inefficientArea, inefficientShapeAreaRatio: null, measurements, diagnostics: ["适用功能 Zone 几何并集无法建立。"] };
  const ratio = inefficientArea / total; return { ruleId: "LY-02", ruleName: "二维低效形状", status: "scored", score: roundOne(interpolate(ratio, SHAPE_ANCHORS)), applicableZoneCount: measurements.length, applicableAreaSquareMeters: total, inefficientShapeAreaSquareMeters: inefficientArea, inefficientShapeAreaRatio: ratio, measurements: measurements.sort((a, b) => a.zoneId.localeCompare(b.zoneId)), diagnostics: [inefficient.length ? `发现 ${inefficient.length} 个同时低紧凑度且低凸度的功能 Zone。` : "未发现同时低紧凑度且低凸度的功能 Zone。"] };
}

export function scoreS1SpaceUtilization(handoff: EvaluationHandoff, graph: RoomConnectivityGraph): S1SpaceUtilizationReport {
  const corridor = ly01(handoff, graph), shape = ly02(handoff, graph), applicable = [corridor, shape].filter((rule) => rule.status === "scored"), unable = [corridor, shape].filter((rule) => rule.status === "unable_to_determine");
  return { metricId: "S1-LY", metricName: "空间利用", status: unable.length ? "unable_to_determine" : applicable.length ? "scored" : "not_applicable", score: unable.length || !applicable.length ? null : roundOne(applicable.reduce((sum, rule) => sum + rule.score!, 0) / applicable.length), ruleVersion: S1_SPACE_UTILIZATION_RULE_VERSION, ruleStatus: S1_SPACE_UTILIZATION_RULE_STATUS, ly01: corridor, ly02: shape };
}
