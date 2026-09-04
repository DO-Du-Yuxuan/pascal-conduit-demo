import polygonClipping from "polygon-clipping";
import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { isSdiSpaceFunctionCode } from "../space-functions/sdi-space-functions";
import type { RoomConnectivityGraph } from "./connectivity";
import { polygonArea, type MultiPolygon, type Ring } from "./envelope";
import type { S1HighFrequencyPathMeasurement, S1HighFrequencyPathReport } from "./s1-high-frequency-path";
import { S1_HIGH_FREQUENCY_PATH_BEDROOM_DISTANCE_ANCHORS as BEDROOM_DISTANCE, S1_HIGH_FREQUENCY_PATH_DETOUR_ANCHORS as DETOUR, S1_HIGH_FREQUENCY_PATH_DETOUR_WEIGHT as DETOUR_WEIGHT, S1_HIGH_FREQUENCY_PATH_DISTANCE_WEIGHT as DISTANCE_WEIGHT, S1_HIGH_FREQUENCY_PATH_EFFECTIVE_AREA_EXCLUDED_CODES as EXCLUDED_CODES, S1_HIGH_FREQUENCY_PATH_RETURN_DISTANCE_ANCHORS as RETURN_DISTANCE, S1_HIGH_FREQUENCY_PATH_SCORING_RULE_STATUS, S1_HIGH_FREQUENCY_PATH_SCORING_RULE_VERSION } from "./s1-high-frequency-path-scoring-config";

export type S1HighFrequencyPathScoringStatus = "scored" | "not_applicable" | "unable_to_determine";
export type S1HighFrequencyPathScene = "bedroom_to_bathroom" | "return_to_kitchen";
export type S1HighFrequencyPathRouteScore = {
  metricId: "S1-HPE"; routeId: string; scene: S1HighFrequencyPathScene; scoringStatus: S1HighFrequencyPathScoringStatus;
  normalizedDistance: number | null; normalizedDistanceScore: number | null; detourScore: number | null; routeScore: number | null;
  ruleVersion: typeof S1_HIGH_FREQUENCY_PATH_SCORING_RULE_VERSION; diagnostics: string[];
};
export type S1HighFrequencyPathSceneScore = {
  scene: S1HighFrequencyPathScene; label: string; status: S1HighFrequencyPathScoringStatus; score: number | null;
  evaluableRouteCount: number; unableRouteCount: number; notApplicableRouteCount: number; routeIds: string[]; diagnostics: string[];
};
export type S1EffectiveResidentialIndoorArea = {
  squareMeters: number | null; status: "measured" | "unable_to_determine" | "not_applicable"; includedZoneIds: string[]; excludedZoneIds: string[]; diagnostics: string[];
};
export type S1HighFrequencyPathScoreSummary = {
  metricId: "S1-HPE"; metricName: "高频活动路径效率"; status: S1HighFrequencyPathScoringStatus; score: number | null;
  effectiveResidentialIndoorArea: S1EffectiveResidentialIndoorArea; applicableSceneCount: number; notApplicableSceneCount: number; unableSceneCount: number;
  ruleVersion: typeof S1_HIGH_FREQUENCY_PATH_SCORING_RULE_VERSION; ruleStatus: typeof S1_HIGH_FREQUENCY_PATH_SCORING_RULE_STATUS;
  routeScores: S1HighFrequencyPathRouteScore[]; sceneScores: S1HighFrequencyPathSceneScore[];
};

const close = (ring: Ring): Ring => ring.length > 2 && (ring[0]![0] !== ring[ring.length - 1]![0] || ring[0]![1] !== ring[ring.length - 1]![1]) ? [...ring, ring[0]!] : ring;
const multiArea = (multi: MultiPolygon) => multi.reduce((sum, polygon) => sum + Math.max(0, polygonArea(polygon[0] ?? []) - polygon.slice(1).reduce((holes, hole) => holes + polygonArea(hole), 0)), 0);
const reliableMatch = (relationship: string | undefined) => relationship === "one-to-one" || relationship === "room-with-multiple-zones";
const roundOne = (value: number) => Math.round(value * 10) / 10;

function interpolate(value: number, anchors: readonly { value: number; score: number }[]) {
  if (value <= anchors[0]!.value) return anchors[0]!.score;
  if (value >= anchors[anchors.length - 1]!.value) return anchors[anchors.length - 1]!.score;
  const upperIndex = anchors.findIndex((anchor) => value <= anchor.value), upper = anchors[upperIndex]!, lower = anchors[upperIndex - 1]!;
  return lower.score + (upper.score - lower.score) * ((value - lower.value) / (upper.value - lower.value));
}

/** HPE-only v0.1 area denominator: reliable, countable SF-coded Zone∩RoomRegion geometry, unioned per level. */
export function measureS1EffectiveResidentialIndoorArea(handoff: EvaluationHandoff, graph: RoomConnectivityGraph): S1EffectiveResidentialIndoorArea {
  const roomById = new Map(graph.roomAnalysis.rooms.map((room) => [room.roomRegionId, room]));
  const matchByZone = new Map(graph.roomAnalysis.zoneMatches.map((match) => [match.zoneId, match]));
  const coded = handoff.zones.filter((zone) => isSdiSpaceFunctionCode(zone.spaceFunctionCode));
  const included = coded.filter((zone) => Number(zone.spaceFunctionCode!.slice(2)) < 50 && !EXCLUDED_CODES.has(zone.spaceFunctionCode!));
  const excludedZoneIds = coded.filter((zone) => !included.includes(zone)).map((zone) => zone.id).sort();
  if (!included.length) return { squareMeters: null, status: "not_applicable", includedZoneIds: [], excludedZoneIds, diagnostics: ["不存在可计入的正式 SF 编码住宅室内 Zone。"] };
  const invalid: string[] = [], byLevel = new Map<string, MultiPolygon[]>();
  for (const zone of included) {
    const match = matchByZone.get(zone.id), roomId = match?.matchedRoomRegionIds.length === 1 ? match.matchedRoomRegionIds[0] : null, room = roomId ? roomById.get(roomId) : null;
    if (!room || !room.usableForEvaluation || !reliableMatch(match?.relationship) || !Array.isArray(zone.outline) || zone.outline.length < 3) { invalid.push(zone.id); continue; }
    try {
      const intersection = polygonClipping.intersection([[close(zone.outline as Ring)]] as any, room.polygons as any) as MultiPolygon;
      if (!intersection.length || multiArea(intersection) <= 1e-8) { invalid.push(zone.id); continue; }
      const levelId = zone.levelId;
      if (!levelId) { invalid.push(zone.id); continue; }
      byLevel.set(levelId, [...(byLevel.get(levelId) ?? []), intersection]);
    } catch { invalid.push(zone.id); }
  }
  if (invalid.length) return { squareMeters: null, status: "unable_to_determine", includedZoneIds: included.map((zone) => zone.id).sort(), excludedZoneIds, diagnostics: [`以下应计入 Zone 缺少可靠 Zone–RoomRegion 有效几何：${invalid.sort().join("、")}`] };
  let total = 0;
  try {
    for (const polygons of byLevel.values()) {
      const [first, ...rest] = polygons;
      total += multiArea(polygonClipping.union(first as any, ...rest.map((polygon) => polygon as any)) as MultiPolygon);
    }
  } catch { return { squareMeters: null, status: "unable_to_determine", includedZoneIds: included.map((zone) => zone.id).sort(), excludedZoneIds, diagnostics: ["有效住宅 Zone 几何并集计算失败。"] }; }
  return total > 1e-8 ? { squareMeters: total, status: "measured", includedZoneIds: included.map((zone) => zone.id).sort(), excludedZoneIds, diagnostics: [] } : { squareMeters: null, status: "unable_to_determine", includedZoneIds: included.map((zone) => zone.id).sort(), excludedZoneIds, diagnostics: ["有效住宅室内面积为零或不可用。"] };
}

const sceneOf = (route: S1HighFrequencyPathMeasurement): S1HighFrequencyPathScene => route.behaviorSources.includes("bedroom") ? "bedroom_to_bathroom" : "return_to_kitchen";
const labelOf = (scene: S1HighFrequencyPathScene) => scene === "bedroom_to_bathroom" ? "卧室 → 卫生间" : "归家 → 厨房";

function scoreRoute(route: S1HighFrequencyPathMeasurement, area: S1EffectiveResidentialIndoorArea): S1HighFrequencyPathRouteScore {
  const scene = sceneOf(route), base = { metricId: "S1-HPE" as const, routeId: route.routeId, scene, ruleVersion: S1_HIGH_FREQUENCY_PATH_SCORING_RULE_VERSION };
  if (route.status === "not_applicable") return { ...base, scoringStatus: "not_applicable", normalizedDistance: null, normalizedDistanceScore: null, detourScore: null, routeScore: null, diagnostics: ["该路线不适用，未进入评分分母。"] };
  if (route.status !== "measured" || route.actualPathLengthMeters === null || route.detourRatio === null) return { ...base, scoringStatus: "unable_to_determine", normalizedDistance: null, normalizedDistanceScore: null, detourScore: null, routeScore: null, diagnostics: [...route.diagnostics, "路线未能形成完整正式测量，不能按零分处理。"] };
  if (area.status !== "measured" || area.squareMeters === null) return { ...base, scoringStatus: "unable_to_determine", normalizedDistance: null, normalizedDistanceScore: null, detourScore: null, routeScore: null, diagnostics: [...area.diagnostics, "缺少可靠有效住宅室内面积，不能生成正式路线分数。"] };
  const normalizedDistance = route.actualPathLengthMeters / Math.sqrt(area.squareMeters), normalizedDistanceScore = interpolate(normalizedDistance, scene === "bedroom_to_bathroom" ? BEDROOM_DISTANCE : RETURN_DISTANCE), detourScore = interpolate(route.detourRatio, DETOUR), routeScore = normalizedDistanceScore * DISTANCE_WEIGHT + detourScore * DETOUR_WEIGHT;
  return { ...base, scoringStatus: "scored", normalizedDistance, normalizedDistanceScore, detourScore, routeScore, diagnostics: [] };
}

export function scoreS1HighFrequencyPaths(measurement: S1HighFrequencyPathReport, handoff: EvaluationHandoff, graph: RoomConnectivityGraph): S1HighFrequencyPathScoreSummary {
  const area = measureS1EffectiveResidentialIndoorArea(handoff, graph), routeScores = measurement.measurements.map((route) => scoreRoute(route, area));
  const sceneScores = (["bedroom_to_bathroom", "return_to_kitchen"] as const).map((scene): S1HighFrequencyPathSceneScore => {
    const routes = routeScores.filter((route) => route.scene === scene), evaluable = routes.filter((route) => route.scoringStatus === "scored" && route.routeScore !== null), unable = routes.filter((route) => route.scoringStatus === "unable_to_determine"), notApplicable = routes.filter((route) => route.scoringStatus === "not_applicable");
    if (!routes.length || routes.length === notApplicable.length) return { scene, label: labelOf(scene), status: "not_applicable", score: null, evaluableRouteCount: 0, unableRouteCount: 0, notApplicableRouteCount: notApplicable.length, routeIds: routes.map((route) => route.routeId), diagnostics: [] };
    if (unable.length) return { scene, label: labelOf(scene), status: "unable_to_determine", score: null, evaluableRouteCount: evaluable.length, unableRouteCount: unable.length, notApplicableRouteCount: notApplicable.length, routeIds: routes.map((route) => route.routeId), diagnostics: ["存在本应适用但无法判断的路线；已测路线保留局部结果，场景不生成完整正式分数。"] };
    return { scene, label: labelOf(scene), status: "scored", score: roundOne(evaluable.reduce((sum, route) => sum + route.routeScore!, 0) / evaluable.length), evaluableRouteCount: evaluable.length, unableRouteCount: 0, notApplicableRouteCount: notApplicable.length, routeIds: routes.map((route) => route.routeId), diagnostics: [] };
  });
  const applicable = sceneScores.filter((scene) => scene.status === "scored"), unable = sceneScores.filter((scene) => scene.status === "unable_to_determine"), status: S1HighFrequencyPathScoringStatus = unable.length ? "unable_to_determine" : applicable.length ? "scored" : "not_applicable";
  return { metricId: "S1-HPE", metricName: "高频活动路径效率", status, score: status === "scored" ? roundOne(applicable.reduce((sum, scene) => sum + scene.score!, 0) / applicable.length) : null, effectiveResidentialIndoorArea: area, applicableSceneCount: applicable.length, notApplicableSceneCount: sceneScores.filter((scene) => scene.status === "not_applicable").length, unableSceneCount: unable.length, ruleVersion: S1_HIGH_FREQUENCY_PATH_SCORING_RULE_VERSION, ruleStatus: S1_HIGH_FREQUENCY_PATH_SCORING_RULE_STATUS, routeScores, sceneScores };
}
