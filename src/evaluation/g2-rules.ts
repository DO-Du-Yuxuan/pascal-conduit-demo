import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { rectangularFootprint, type Point, type Ring } from "./envelope";
import { buildObstacles } from "./door-operations";
import { fixtureSemanticOf } from "./object-semantics";
import { buildRoomConnectivityGraph, type RoomConnectivityGraph } from "./connectivity";
import { buildRoomRegionAnalysis, type RoomRegion, type RoomRegionAnalysis } from "./room-regions";
import { canFitEffectiveSquare, clearanceAlongRay, findInscribedCircle, intersectedAreaSquareMeters, maximumEffectiveSquareSize, minimumBranchedCorridorCrossSection, pointInMultiPolygon, subtractFixedObstacles, unionMultiPolygons } from "./g2-geometry";
import { G2_CITATIONS, G2_DOOR_OPENING_ASSUMPTIONS, G2_PARAMETERS as P, thresholdFrom, type G2RuleId } from "./g2-regulations";
import { analyzeStairMeasurements, type StairMeasurementAnalysis } from "./stair-measurement";
import { buildEeroCandidateAnalysis, type EeroCandidate, type EeroCandidateAnalysis, type ExplicitEeroOpeningMeasurement, type GradeFloorStatus } from "./eero-candidates";
import { analyzeOrdinaryStairClearWidths, analyzeSpiralStairs, type SpiralStairAnalysis, type SpiralStairOverride, type StairClearWidthAnalysis, type StairFlightWidthOverride } from "./stair-code-analysis";
import { buildRoomHeadroomAnalysis, headroomAreaAtOrAbove, type HeadroomRoomUse, type RoomHeadroomAnalysis, type RoomHeadroomEvidence } from "./room-headroom";
import { buildDwellingRequiredFixtureAnalysis, type DwellingRequiredFixtureAnalysis, type RequiredFixtureKind } from "./dwelling-required-fixtures";
import { analyzeStairLandings, doorSweepsPlatform, type StairLandingEvidence } from "./stair-landing-analysis";
import { buildShowerCompartmentAnalysis, type ShowerCompartmentAnalysis, type ShowerCompartmentOverride } from "./shower-compartment-analysis";
import { resolveRegulatoryRoomSemantic, type RegulatoryRoomUse } from "./space-semantics";
import type { RuleDiagnostic, RuleResult, RuleStatus } from "./types";

export type G2ProjectUse = "detached_dwelling" | "dwelling_unit" | "sleeping_unit" | "nonresidential" | "unknown";
export type G2RoomUse = RegulatoryRoomUse;
export type G2EvaluationContext = {
  codeApplicability: "applicable" | "not_applicable" | "unknown";
  projectUse: G2ProjectUse;
  jurisdiction?: "Bellevue, WA";
  dwellingUnitRoomIds?: string[];
  necessaryEgressDoorIds?: string[];
  actualDoorClearOpenings?: Record<string, { widthMeters: number | null; heightMeters: number | null; reliable: boolean; source: string }>;
  roomUseOverrides?: Record<string, G2RoomUse>;
  roomHeightLimitations?: Record<string, "confirmed_absent" | "present_and_accounted" | "unknown">;
  confirmedNoHallways?: boolean;
  confirmedNoHabitableRooms?: boolean;
  confirmedNoGarage?: boolean;
  confirmedNoSleepingRooms?: boolean;
  confirmedNoToilets?: boolean;
  confirmedNoEeroRequiredRooms?: boolean;
  eeroRequiredRoomIds?: string[];
  eeroExemptRoomIds?: string[];
  explicitEeroOpeningMeasurements?: Record<string, ExplicitEeroOpeningMeasurement>;
  eeroGradeFloorStatusByOpeningId?: Record<string, GradeFloorStatus>;
  spiralStairOverrides?: Record<string, SpiralStairOverride>;
  ordinaryStairFlightOverrides?: Record<string, StairFlightWidthOverride[]>;
  slopedHeadroomRoomIds?: string[];
  fixtureInventoryCompleteness?: "complete" | "partial" | "unknown";
  showerLocalHeadroomOverrides?: Record<string, { heightMeters: number | null; regionSideMeters: number | null; reliable: boolean; source: string }>;
  showerCompartmentOverrides?: Record<string, ShowerCompartmentOverride>;
};

export const BELLEVUE_DETACHED_DWELLING_G2_CONTEXT: G2EvaluationContext = {
  codeApplicability: "applicable",
  projectUse: "detached_dwelling",
  jurisdiction: "Bellevue, WA",
  fixtureInventoryCompleteness: "complete",
};

type RoomSemantic = ReturnType<typeof resolveRegulatoryRoomSemantic>;
type RuleEnvironment = {
  handoff: EvaluationHandoff;
  context: G2EvaluationContext;
  rooms: RoomRegionAnalysis;
  graph: RoomConnectivityGraph;
  stairs: StairMeasurementAnalysis[];
  eero: EeroCandidateAnalysis;
  spiralStairs: SpiralStairAnalysis[];
  stairClearWidths: StairClearWidthAnalysis[];
  headroom: RoomHeadroomAnalysis;
  requiredFixtures: DwellingRequiredFixtureAnalysis;
  stairLandings: StairLandingEvidence[];
  showerCompartments: ShowerCompartmentAnalysis;
};

const ruleNames: Record<G2RuleId, string> = {
  "G2-001": "住宅单元必要疏散门净开口符合规范",
  "G2-002": "楼梯踏步尺寸符合适用规范",
  "G2-003": "住宅走廊净宽符合规范",
  "G2-004": "居住房间平面面积符合规范",
  "G2-005": "居住房间最小水平尺寸符合规范",
  "G2-006": "坐便器平面净空符合规范",
  "G2-007": "紧急逃生救援开口净尺寸符合规范",
  "G2-008": "紧急逃生救援开口窗台高度符合规范",
  "G2-009": "车库不得直接开口通向睡眠房间",
  "G2-010": "住宅疏散路径不得穿过车库",
  "G2-011": "螺旋楼梯适用性与尺寸符合规范",
  "G2-012": "楼梯净宽符合规范",
  "G2-013": "楼梯上下端设置必要平台",
  "G2-014": "楼梯平台尺寸符合规范",
  "G2-015": "门扇不得违法侵占楼梯平台",
  "G2-016": "居住房间净高符合规范",
  "G2-017": "非居住房间与交通空间净高符合规范",
  "G2-019": "住宅基本卫生与厨房水槽设施满足法定配置",
  "G2-020": "淋浴空间尺寸符合规范",
};
const confidenceScore = { high: .95, medium: .75, low: .35 };

function result(id: G2RuleId, status: RuleStatus, summary: string, options: Partial<RuleResult> = {}): RuleResult {
  const missingData = options.missingData ?? [], applicabilityStatus = status === "not_applicable" ? "not_applicable" : options.applicability?.status ?? "applicable";
  return {
    ruleId: id,
    ruleName: ruleNames[id],
    status,
    severity: status === "issue" ? "error" : status === "unable_to_determine" ? "warning" : "info",
    summary,
    details: options.details ?? [],
    normalizedObjectIds: options.normalizedObjectIds ?? [],
    pascalSourceIds: options.pascalSourceIds ?? [],
    measurements: options.measurements ?? [],
    thresholds: options.thresholds ?? [],
    missingData,
    confidence: options.confidence ?? { level: status === "unable_to_determine" ? "low" : "high", score: status === "unable_to_determine" ? .35 : .95, reasons: [] },
    diagnostics: options.diagnostics ?? [],
    applicability: options.applicability ?? { status: applicabilityStatus, reasons: [] },
    dataSufficiency: options.dataSufficiency ?? { status: missingData.length ? "insufficient" : status === "not_applicable" ? "not_required" : "sufficient", missingFields: missingData },
    regulation: G2_CITATIONS[id],
  };
}

const projectGate = (id: G2RuleId, context: G2EvaluationContext): RuleResult | null => {
  if (context.codeApplicability === "not_applicable" || context.projectUse === "nonresidential" && id !== "G2-006") return result(id, "not_applicable", "该项目不适用本项住宅技术规范。", { applicability: { status: "not_applicable", reasons: ["项目用途或法规适用性已确认不适用"] } });
  if (context.codeApplicability === "unknown" || context.projectUse === "unknown") return result(id, "unable_to_determine", "项目用途或法规适用性尚未确认。", { missingData: ["project.codeApplicability", "project.projectUse"], applicability: { status: "unable_to_determine", reasons: ["缺少项目用途或法规适用性"] } });
  return null;
};

const roomNames = (handoff: EvaluationHandoff, analysis: RoomRegionAnalysis, room: RoomRegion) => (analysis.roomToZoneIds[room.roomRegionId] ?? []).map((id) => handoff.zones.find((zone) => zone.id === id)?.name?.trim()).filter((name): name is string => Boolean(name));
function semanticOf(environment: RuleEnvironment, room: RoomRegion): RoomSemantic {
  return resolveRegulatoryRoomSemantic(roomNames(environment.handoff, environment.rooms, room), environment.context.roomUseOverrides?.[room.roomRegionId]);
}

function headroomUseOf(environment: RuleEnvironment, room: RoomRegion): HeadroomRoomUse {
  const semantic = semanticOf(environment, room), names = semantic.names;
  if (semantic.use === "sleeping" || semantic.use === "habitable") return "habitable";
  if (semantic.use === "kitchen") return "kitchen";
  if (semantic.use === "hallway") return "hallway";
  if (semantic.use === "basement") return "basement_nonhabitable";
  if (semantic.use === "bathroom") return names.some((name) => /^(TOILET|WC)|厕所间/i.test(name)) ? "toilet_room" : "bathroom";
  if (names.some((name) => /LAUNDRY|洗衣/i.test(name))) return "laundry";
  if (semantic.use === "unknown") return "unknown";
  return "other";
}

const issueDiagnostic = (code: string, message: string, ids: string[], actualValue?: number, expectedValue?: string): RuleDiagnostic => ({ severity: "error", code, message, normalizedObjectIds: ids, actualValue, expectedValue, origin: "rule", recommendation: "调整布局或核验源数据后重新评价。" });
const unableDiagnostic = (code: string, message: string, ids: string[] = [], recommendation = "补充明确字段后重新评价。"): RuleDiagnostic => ({ severity: "warning", code, message, normalizedObjectIds: ids, origin: "insufficient_information", recommendation });
const borderlineTolerance = (threshold: number) => Math.max(.001, Math.abs(threshold) * .01);
const isBorderline = (margin: number, threshold: number) => Math.abs(margin) <= borderlineTolerance(threshold);
const borderlineDiagnostic = (code: string, message: string, ids: string[], actualValue: number, expectedValue: string): RuleDiagnostic => ({ severity: "warning", code, message, normalizedObjectIds: ids, actualValue, expectedValue, origin: "geometry_tolerance", recommendation: "结论保留为通过或不通过；该值接近阈值，建议复核模型或现场尺寸。" });

export function evaluateG2002(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-002", environment.context); if (gate) return gate;
  if (!environment.stairs.length) return result("G2-002", "not_applicable", "项目中没有楼梯。", { applicability: { status: "not_applicable", reasons: ["无楼梯"] }, thresholds: [thresholdFrom(P.stairMaximumRiserHeight), thresholdFrom(P.stairMinimumTreadDepth), thresholdFrom(P.stairMaximumRiserVariation), thresholdFrom(P.stairMaximumTreadVariation)] });
  const ordinary = environment.stairs.filter((stair) => stair.codeFamily === "ordinary");
  const special = environment.stairs.filter((stair) => stair.codeFamily === "special");
  const measurements: RuleResult["measurements"] = [];
  const diagnostics: RuleDiagnostic[] = [];
  special.forEach((stair) => {
    measurements.push(
      { name: "stairType", value: stair.stairType, normalizedObjectId: stair.stairId, measurementBasis: "explicit", confidence: "high" },
      { name: "averageRiserHeightMeters", value: stair.minimumRiserHeightMeters, unit: "m", normalizedObjectId: stair.stairId, measurementBasis: stair.measurementBasis, assumptions: stair.assumptions, confidence: stair.confidence },
      { name: "treadCount", value: stair.treadCount, normalizedObjectId: stair.stairId, measurementBasis: "explicit", confidence: stair.confidence },
      { name: "riserCount", value: stair.riserCount, normalizedObjectId: stair.stairId, measurementBasis: "explicit", confidence: stair.confidence },
      { name: "stairApplicability", value: "not_applicable_special_type", normalizedObjectId: stair.stairId, measurementBasis: "explicit", confidence: "high" },
    );
  });
  if (!ordinary.length) return result("G2-002", "not_applicable", `${special.length} 座楼梯均为适用专门条文的特殊类型，不套用普通楼梯踏步参数。`, { normalizedObjectIds: special.map((stair) => stair.stairId), pascalSourceIds: special.map((stair) => stair.pascalSourceId), measurements, thresholds: [thresholdFrom(P.stairMaximumRiserHeight), thresholdFrom(P.stairMinimumTreadDepth), thresholdFrom(P.stairMaximumRiserVariation), thresholdFrom(P.stairMaximumTreadVariation)], applicability: { status: "not_applicable", reasons: special.map((stair) => `${stair.stairId}:${stair.stairType}`) } });

  ordinary.forEach((stair) => {
    const basis = stair.measurementBasis, assumptions = stair.assumptions, confidence = stair.confidence;
    const record = (name: string, value: number | null, threshold: number, direction: "maximum" | "minimum") => {
      const margin = value === null ? null : direction === "maximum" ? threshold - value : value - threshold;
      measurements.push({ name, value, unit: "m", normalizedObjectId: stair.stairId, measurementBasis: basis, assumptions, confidence, thresholdValue: threshold, margin, borderline: margin !== null && isBorderline(margin, threshold) });
      return margin;
    };
    measurements.push(
      { name: "stairType", value: stair.stairType, normalizedObjectId: stair.stairId, measurementBasis: "explicit", confidence: "high" },
      { name: "treadCount", value: stair.treadCount, normalizedObjectId: stair.stairId, measurementBasis: "explicit", confidence },
      { name: "riserCount", value: stair.riserCount, normalizedObjectId: stair.stairId, measurementBasis: "explicit", confidence },
      { name: "measurementSourceFields", value: stair.sourceFields.join(","), normalizedObjectId: stair.stairId, measurementBasis: basis, assumptions, confidence },
    );
    const riserHeightMargin = record("maximumRiserHeightMeters", stair.maximumRiserHeightMeters, P.stairMaximumRiserHeight.convertedValue, "maximum");
    const treadDepthMargin = record("minimumTreadDepthMeters", stair.minimumTreadDepthMeters, P.stairMinimumTreadDepth.convertedValue, "minimum");
    const riserVariationMargin = record("riserHeightVariationMeters", stair.riserHeightVariationMeters, P.stairMaximumRiserVariation.convertedValue, "maximum");
    const treadVariationMargin = record("treadDepthVariationMeters", stair.treadDepthVariationMeters, P.stairMaximumTreadVariation.convertedValue, "maximum");

    const checks: Array<[string, number | null, number | null, string, number]> = [
      ["stair_riser_height_above_maximum", riserHeightMargin, stair.maximumRiserHeightMeters, `≤${P.stairMaximumRiserHeight.originalValue} ${P.stairMaximumRiserHeight.originalUnit}`, P.stairMaximumRiserHeight.convertedValue],
      ["stair_tread_depth_below_minimum", treadDepthMargin, stair.minimumTreadDepthMeters, `≥${P.stairMinimumTreadDepth.originalValue} ${P.stairMinimumTreadDepth.originalUnit}`, P.stairMinimumTreadDepth.convertedValue],
      ["stair_riser_variation_above_maximum", riserVariationMargin, stair.riserHeightVariationMeters, `≤${P.stairMaximumRiserVariation.originalValue} ${P.stairMaximumRiserVariation.originalUnit}`, P.stairMaximumRiserVariation.convertedValue],
      ["stair_tread_variation_above_maximum", treadVariationMargin, stair.treadDepthVariationMeters, `≤${P.stairMaximumTreadVariation.originalValue} ${P.stairMaximumTreadVariation.originalUnit}`, P.stairMaximumTreadVariation.convertedValue],
    ];
    checks.forEach(([code, margin, actual, expected, threshold]) => {
      if (margin !== null && margin < -1e-9) diagnostics.push(issueDiagnostic(code, "该普通楼梯的可靠尺寸违反法规阈值。", [stair.stairId], actual!, expected));
      if (margin !== null && isBorderline(margin, threshold)) diagnostics.push(borderlineDiagnostic(`${code}_borderline`, "该楼梯测量值接近法规阈值。", [stair.stairId], actual!, expected));
    });
    if (riserHeightMargin === null) diagnostics.push(unableDiagnostic("stair_riser_height_unresolved", "缺少逐级踢面高度，且总高与级数不足以派生平均值。", [stair.stairId]));
    if (treadDepthMargin === null) diagnostics.push(unableDiagnostic("stair_tread_depth_unresolved", "缺少逐级踏步深度或可靠总进深与级数。", [stair.stairId]));
    if (riserVariationMargin === null) diagnostics.push(unableDiagnostic("stair_riser_variation_unresolved", "缺少逐级踢面高度或明确均匀生成事实，不能证明极差。", [stair.stairId]));
    if (treadVariationMargin === null) diagnostics.push(unableDiagnostic("stair_tread_variation_unresolved", "缺少逐级踏步深度或明确均匀生成事实，不能证明极差。", [stair.stairId]));
  });
  const hasIssue = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const hasUnknown = diagnostics.some((diagnostic) => diagnostic.origin === "insufficient_information");
  const status: RuleStatus = hasIssue ? "issue" : hasUnknown ? "unable_to_determine" : "pass";
  return result("G2-002", status, status === "pass" ? `${ordinary.length} 座普通楼梯的踏步、踢面及同梯段极差均符合规范。` : status === "issue" ? "至少一座普通楼梯的可靠尺寸违反法规阈值。" : "现有数据可确认部分楼梯尺寸，但至少一个可能改变合规结论的普通楼梯子项缺少逐级证据。", { normalizedObjectIds: ordinary.map((stair) => stair.stairId), pascalSourceIds: ordinary.map((stair) => stair.pascalSourceId), measurements, thresholds: [thresholdFrom(P.stairMaximumRiserHeight), thresholdFrom(P.stairMinimumTreadDepth), thresholdFrom(P.stairMaximumRiserVariation), thresholdFrom(P.stairMaximumTreadVariation)], diagnostics, missingData: diagnostics.filter((diagnostic) => diagnostic.origin === "insufficient_information").map((diagnostic) => `${diagnostic.normalizedObjectIds[0]}.${diagnostic.code}`), confidence: { level: status === "unable_to_determine" ? "low" : ordinary.every((stair) => stair.confidence === "high") ? "high" : "medium", score: status === "unable_to_determine" ? .35 : ordinary.every((stair) => stair.confidence === "high") ? .95 : .75, reasons: [...new Set(ordinary.flatMap((stair) => stair.assumptions))] } });
}

export function evaluateG2001(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-001", environment.context); if (gate) return gate;
  const candidates = environment.graph.portals.filter((portal) => portal.usableForConnectivity && portal.connectsExterior), ids = candidates.map((portal) => portal.doorId), doorById = new Map(environment.handoff.doors.map((door) => [door.id, door]));
  const nominalCount = ids.filter((id) => { const door = doorById.get(id); return Number.isFinite(door?.widthMeters) && Number.isFinite(door?.heightMeters); }).length;
  const measurements: RuleResult["measurements"] = [
    { name: "exteriorDoorCandidateCount", value: ids.length },
    { name: "nominalOpeningDimensionCount", value: nominalCount },
  ];
  if (!ids.length) {
    const unresolved = environment.graph.portals.filter((portal) => !portal.usableForConnectivity);
    if (unresolved.length) return result("G2-001", "unable_to_determine", "没有形成可靠 Room–Exterior 门候选，但存在无法解析空间连接的门，不能确认住宅确实没有外门。", { normalizedObjectIds: unresolved.map((portal) => portal.doorId), measurements: [...measurements, { name: "reliableActualClearOpeningCount", value: 0 }], missingData: ["doorPortal.roomExteriorRelation"], diagnostics: unresolved.map((portal) => unableDiagnostic("exterior_door_portal_unresolved", portal.diagnostics.map((item) => item.message).join("；") || "门两侧空间关系不可靠。", [portal.doorId])), thresholds: [thresholdFrom(P.egressDoorWidth), thresholdFrom(P.egressDoorHeight)] });
    return result("G2-001", "issue", "已确认的独立住宅没有可靠 Room–Exterior 门，不能满足必要疏散门要求。", { measurements: [...measurements, { name: "reliableActualClearOpeningCount", value: 0 }], diagnostics: [issueDiagnostic("necessary_egress_door_missing", "每个适用住宅单元至少需要一樘符合要求的侧铰疏散门。", [], 0, "至少1樘可靠 Room–Exterior 门")], thresholds: [thresholdFrom(P.egressDoorWidth), thresholdFrom(P.egressDoorHeight)] });
  }
  const diagnostics: RuleDiagnostic[] = [], missing: string[] = [];
  let actualCount = 0, derivedCount = 0, compliantCount = 0, eligibleCount = 0;
  for (const id of ids) {
    const door = doorById.get(id), actual = environment.context.actualDoorClearOpenings?.[id];
    const sideHinged = door?.doorType === "hinged" || door?.doorType === "double";
    if (!sideHinged) continue;
    eligibleCount++;
    let width: number | null = null, height: number | null = null, source: "actual" | "plan-derived" | null = null;
    if (actual?.reliable && Number.isFinite(actual.widthMeters) && Number.isFinite(actual.heightMeters)) {
      width = actual.widthMeters; height = actual.heightMeters; source = "actual"; actualCount++;
    } else if (Number.isFinite(door.widthMeters) && Number.isFinite(door.heightMeters)) {
      const jamb = G2_DOOR_OPENING_ASSUMPTIONS.jambStopDeductionPerSideMeters;
      width = Math.max(0, door.widthMeters! - jamb * 2);
      height = Math.max(0, door.heightMeters! - jamb - (door.thresholdHeightMeters ?? 0));
      source = "plan-derived"; derivedCount++;
    }
    if (width === null || height === null) {
      missing.push(`${id}.nominalOpeningDimensions`);
      diagnostics.push(unableDiagnostic("clear_opening_derivation_unavailable", "该侧铰外门缺少可靠门洞宽高，无法推定净开口。", [id]));
      continue;
    }
    measurements.push(
      { name: source === "actual" ? "actualClearWidthMeters" : "planDerivedClearWidthMeters", value: width, unit: "m", normalizedObjectId: id, measurementBasis: source === "actual" ? "explicit" : "derived", assumptions: source === "actual" ? [`采用可靠净开口来源：${actual?.source ?? "explicit"}`] : ["完整可开启门洞宽度扣除两侧各5/8 in门框止口"], confidence: source === "actual" ? "high" : "medium", thresholdValue: P.egressDoorWidth.convertedValue, margin: width - P.egressDoorWidth.convertedValue, borderline: isBorderline(width - P.egressDoorWidth.convertedValue, P.egressDoorWidth.convertedValue) },
      { name: source === "actual" ? "actualClearHeightMeters" : "planDerivedClearHeightMeters", value: height, unit: "m", normalizedObjectId: id, measurementBasis: source === "actual" ? "explicit" : "derived", assumptions: source === "actual" ? [`采用可靠净开口来源：${actual?.source ?? "explicit"}`] : ["名义洞口高度扣除5/8 in上框止口和显式门槛"], confidence: source === "actual" ? "high" : "medium", thresholdValue: P.egressDoorHeight.convertedValue, margin: height - P.egressDoorHeight.convertedValue, borderline: isBorderline(height - P.egressDoorHeight.convertedValue, P.egressDoorHeight.convertedValue) },
      { name: "clearOpeningMeasurementSource", value: source, normalizedObjectId: id, measurementBasis: source === "actual" ? "explicit" : "derived", confidence: source === "actual" ? "high" : "medium" },
    );
    const widthPass = width + 1e-9 >= P.egressDoorWidth.convertedValue, heightPass = height + 1e-9 >= P.egressDoorHeight.convertedValue;
    if (widthPass && heightPass) compliantCount++;
    else {
      if (!widthPass) diagnostics.push(issueDiagnostic("egress_door_clear_width_below_minimum", `该外门候选${source === "actual" ? "实测" : "平面推定"}净开宽度低于法规要求。`, [id], width, `≥${P.egressDoorWidth.originalValue} ${P.egressDoorWidth.originalUnit}`));
      if (!heightPass) diagnostics.push(issueDiagnostic("egress_door_clear_height_below_minimum", `该外门候选${source === "actual" ? "实测" : "平面推定"}净开高度低于法规要求。`, [id], height, `≥${P.egressDoorHeight.originalValue} ${P.egressDoorHeight.originalUnit}`));
    }
    if (isBorderline(width - P.egressDoorWidth.convertedValue, P.egressDoorWidth.convertedValue)) diagnostics.push(borderlineDiagnostic("egress_door_clear_width_borderline", "该外门净开宽度接近法规阈值。", [id], width, `≥${P.egressDoorWidth.originalValue} ${P.egressDoorWidth.originalUnit}`));
    if (isBorderline(height - P.egressDoorHeight.convertedValue, P.egressDoorHeight.convertedValue)) diagnostics.push(borderlineDiagnostic("egress_door_clear_height_borderline", "该外门净开高度接近法规阈值。", [id], height, `≥${P.egressDoorHeight.originalValue} ${P.egressDoorHeight.originalUnit}`));
  }
  measurements.push(
    { name: "sideHingedExteriorDoorCandidateCount", value: eligibleCount },
    { name: "nonSideHingedExteriorDoorCount", value: ids.length - eligibleCount },
    { name: "reliableActualClearOpeningCount", value: actualCount },
    { name: "reliablePlanDerivedClearOpeningCount", value: derivedCount },
    { name: "jambStopDeductionPerSideMeters", value: G2_DOOR_OPENING_ASSUMPTIONS.jambStopDeductionPerSideMeters, unit: "m" },
    { name: "compliantExteriorDoorCandidateCount", value: compliantCount },
  );
  const measuredCount = actualCount + derivedCount;
  const status: RuleStatus = compliantCount ? "pass" : eligibleCount > 0 && measuredCount === eligibleCount ? "issue" : eligibleCount === 0 ? "issue" : "unable_to_determine";
  const effectiveDiagnostics = status === "pass" ? diagnostics.filter((item) => item.severity === "warning") : status === "unable_to_determine" ? diagnostics.map((item) => item.severity === "error" ? { ...item, severity: "warning" as const, recommendation: "补测其余外门候选的实际净开口后再作最终判定。" } : item) : diagnostics;
  return result("G2-001", status, status === "pass" ? `${ids.length} 樘可靠外门中，至少一樘侧铰门按门洞扣除两侧门框止口后的推定净开口符合要求。` : status === "issue" ? eligibleCount ? `${eligibleCount} 樘侧铰外门的实测或平面推定净开口均不符合要求。` : "可靠外门中没有符合 R311.2 门型要求的侧铰门。" : `识别到 ${ids.length} 樘可靠外门，但侧铰候选缺少可用于推定净开口的门洞尺寸。`, { normalizedObjectIds: ids, pascalSourceIds: candidates.map((portal) => portal.pascalSourceId), measurements, thresholds: [thresholdFrom(P.egressDoorWidth), thresholdFrom(P.egressDoorHeight)], missingData: status === "pass" ? [] : missing, confidence: { level: actualCount ? "high" : status === "unable_to_determine" ? "low" : "medium", score: actualCount ? .95 : status === "unable_to_determine" ? .35 : .75, reasons: actualCount ? ["采用可靠实际净开口"] : ["净开口由平面门洞尺寸减去每侧 5/8 in 门框/止口余量推定；双扇门按全部可开启门洞计算，不机械除以二"] }, diagnostics: effectiveDiagnostics });
}

const fixedRingsForRoom = (environment: RuleEnvironment, room: RoomRegion, excludeIds: string[] = []) => buildObstacles(environment.handoff).filter((obstacle) => obstacle.levelId === room.levelId && ["column", "shaft"].includes(obstacle.objectType) && obstacle.usableForCollision && !excludeIds.includes(obstacle.objectId)).map((obstacle) => obstacle.footprint);
const structuralRingsForRoom = (environment: RuleEnvironment, room: RoomRegion) => {
  return buildObstacles(environment.handoff).filter((obstacle) => obstacle.levelId === room.levelId && ["column", "shaft"].includes(obstacle.objectType) && obstacle.usableForCollision).map((obstacle) => obstacle.footprint);
};
const roomBoundingFillRatio = (room: RoomRegion) => {
  const points = room.polygons.flatMap((polygon) => polygon.flatMap((ring) => ring));
  if (!points.length) return 0;
  const width = Math.max(...points.map((point) => point[0])) - Math.min(...points.map((point) => point[0])), depth = Math.max(...points.map((point) => point[1])) - Math.min(...points.map((point) => point[1]));
  return width > 0 && depth > 0 ? room.areaSquareMeters / (width * depth) : 0;
};

export function evaluateG2003(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-003", environment.context); if (gate) return gate;
  const usable = environment.rooms.rooms.filter((room) => room.usableForEvaluation), semantics = usable.map((room) => ({ room, semantic: semanticOf(environment, room) })), halls = semantics.filter((item) => item.semantic.use === "hallway" && item.semantic.confidence !== "low"), ambiguous = semantics.filter((item) => item.semantic.use === "unknown");
  if (!halls.length) {
    if (environment.context.confirmedNoHallways || !ambiguous.length) return result("G2-003", "not_applicable", "项目中没有适用的住宅走廊。", { applicability: { status: "not_applicable", reasons: ["没有可靠 hallway Room"] } });
    return result("G2-003", "unable_to_determine", "当前 Room/Zone 语义不足以确认是否存在法规意义上的住宅走廊。", { missingData: ambiguous.map((item) => `${item.room.roomRegionId}.legalUse`), diagnostics: ambiguous.map((item) => unableDiagnostic("hallway_use_unresolved", item.semantic.reason, [item.room.roomRegionId])), thresholds: [thresholdFrom(P.hallwayWidth)] });
  }
  const diagnostics: RuleDiagnostic[] = [], measurements: RuleResult["measurements"] = [];
  for (const { room } of halls) {
    const geometry = subtractFixedObstacles(room.polygons, fixedRingsForRoom(environment, room)), width = minimumBranchedCorridorCrossSection(geometry);
    measurements.push({ name: "roomBoundingFillRatio", value: roomBoundingFillRatio(room), normalizedObjectId: room.roomRegionId });
    measurements.push({ name: "minimumReliableClearWidthMeters", value: width, unit: "m", normalizedObjectId: room.roomRegionId });
    if (width === null) diagnostics.push(unableDiagnostic("hallway_width_unresolved", "无法从真实 Room 边界建立可靠最窄截面。", [room.roomRegionId]));
    else if (width + 1e-9 < P.hallwayWidth.convertedValue) diagnostics.push(issueDiagnostic("hallway_clear_width_below_minimum", "走廊最窄可靠截面低于法规要求。", [room.roomRegionId, ...room.boundaryWallIds], width, `≥${P.hallwayWidth.originalValue} ${P.hallwayWidth.originalUnit}`));
  }
  const status: RuleStatus = diagnostics.some((item) => item.severity === "error") ? "issue" : diagnostics.some((item) => item.origin === "insufficient_information") ? "unable_to_determine" : "pass";
  const minimum = measurements.map((item) => Number(item.value)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  return result("G2-003", status, status === "pass" ? `${halls.length} 个住宅走廊最窄可靠截面均不小于 3 ft（0.9144 m）。` : status === "issue" ? `走廊最窄处约 ${(minimum! / .0254).toFixed(1)} in，低于法规要求的 36 in。` : "Pascal 已提供走廊边界，但当前最窄截面算法不足以可靠测量该复杂走廊。", { normalizedObjectIds: [...new Set(diagnostics.flatMap((item) => item.normalizedObjectIds).concat(halls.map((item) => item.room.roomRegionId)))], pascalSourceIds: halls.flatMap((item) => item.room.pascalSourceIds), measurements, thresholds: [thresholdFrom(P.hallwayWidth)], diagnostics, missingData: diagnostics.filter((item) => item.severity === "warning").map((item) => `${item.normalizedObjectIds[0]}.${item.code === "complex_hallway_cross_section_algorithm_limited" ? "specializedCrossSection" : "reliableBoundary"}`) });
}

const habitableRooms = (environment: RuleEnvironment) => {
  const usable = environment.rooms.rooms.filter((room) => room.usableForEvaluation), classified = usable.map((room) => ({ room, semantic: semanticOf(environment, room) }));
  return { applicable: classified.filter((item) => ["habitable", "sleeping"].includes(item.semantic.use) && item.semantic.confidence !== "low"), ambiguous: classified.filter((item) => item.semantic.use === "unknown") };
};

export function evaluateG2004(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-004", environment.context); if (gate) return gate;
  const rooms = habitableRooms(environment);
  if (!rooms.applicable.length) {
    if (environment.context.confirmedNoHabitableRooms || !rooms.ambiguous.length) return result("G2-004", "not_applicable", "项目中没有适用居住房间。", { applicability: { status: "not_applicable", reasons: ["没有可靠 habitable room"] } });
    return result("G2-004", "unable_to_determine", "Room 与 Zone 语义不足以识别法规意义上的居住房间。", { missingData: rooms.ambiguous.map((item) => `${item.room.roomRegionId}.legalUse`), diagnostics: rooms.ambiguous.map((item) => unableDiagnostic("habitable_room_use_unresolved", item.semantic.reason, [item.room.roomRegionId])), thresholds: [thresholdFrom(P.habitableRoomArea)] });
  }
  const diagnostics: RuleDiagnostic[] = [], measurements: RuleResult["measurements"] = [];
  rooms.ambiguous.forEach((item) => diagnostics.push(unableDiagnostic("habitable_room_use_unresolved", item.semantic.reason, [item.room.roomRegionId])));
  for (const { room } of rooms.applicable) {
    const planarPass = room.areaSquareMeters + 1e-9 >= P.habitableRoomArea.convertedValue;
    measurements.push({ name: "derivedPlanRoomAreaSquareMeters", value: room.areaSquareMeters, unit: "m²", normalizedObjectId: room.roomRegionId }, { name: "planAreaInitialCheck", value: planarPass ? "pass" : "issue", normalizedObjectId: room.roomRegionId });
    if (!planarPass) {
      diagnostics.push(issueDiagnostic("habitable_room_area_below_minimum", "平面派生 Room 的最大可能可计入面积已低于法规下限。", [room.roomRegionId, ...room.boundaryWallIds], room.areaSquareMeters, `≥${P.habitableRoomArea.originalValue} ${P.habitableRoomArea.originalUnit}`));
      continue;
    }
    const override = environment.context.roomHeightLimitations?.[room.roomRegionId];
    if (["confirmed_absent", "present_and_accounted"].includes(override ?? "unknown")) {
      measurements.push({ name: "countableAreaSquareMeters", value: room.areaSquareMeters, unit: "m²", normalizedObjectId: room.roomRegionId });
      continue;
    }
    const ceilings = (environment.handoff.ceilings ?? []).filter((ceiling) => ceiling.levelId === room.levelId && ceiling.visible && ceiling.outline.length >= 3 && Number.isFinite(ceiling.heightMeters));
    const allCeilingGeometry = unionMultiPolygons(ceilings.map((ceiling) => [[ceiling.outline, ...ceiling.holes]]));
    const countableCeilings = ceilings.filter((ceiling) => ceiling.heightMeters! + 1e-9 >= P.habitableRoomFurredCeilingCountableHeight.convertedValue);
    const countableGeometry = unionMultiPolygons(countableCeilings.map((ceiling) => [[ceiling.outline, ...ceiling.holes]]));
    const coveredArea = intersectedAreaSquareMeters(room.polygons, allCeilingGeometry), countableArea = intersectedAreaSquareMeters(room.polygons, countableGeometry);
    const coverageRatio = room.areaSquareMeters > 0 ? coveredArea / room.areaSquareMeters : 0;
    measurements.push(
      { name: "ceilingEvidenceCoverageRatio", value: coverageRatio, normalizedObjectId: room.roomRegionId },
      { name: "minimumMappedCeilingHeightMeters", value: ceilings.length ? Math.min(...ceilings.map((ceiling) => ceiling.heightMeters!)) : null, unit: "m", normalizedObjectId: room.roomRegionId },
      { name: "countableAreaSquareMeters", value: countableArea, unit: "m²", normalizedObjectId: room.roomRegionId },
    );
    if (coverageRatio < .98) diagnostics.push(unableDiagnostic("countable_area_ceiling_coverage_incomplete", "已有 Ceiling 数据，但没有完整覆盖该 Room Region，不能确认未覆盖部分的 R304.3 可计入高度。", [room.roomRegionId, ...ceilings.map((ceiling) => ceiling.id)]));
    else if (countableArea + 1e-9 < P.habitableRoomArea.convertedValue) diagnostics.push(issueDiagnostic("habitable_room_countable_area_below_minimum", "扣除低于 R304.3 平顶/吊顶计入高度的区域后，可计入面积低于法规下限。", [room.roomRegionId, ...ceilings.map((ceiling) => ceiling.id)], countableArea, `≥${P.habitableRoomArea.originalValue} ${P.habitableRoomArea.originalUnit}`));
  }
  const status: RuleStatus = diagnostics.some((item) => item.severity === "error") ? "issue" : diagnostics.length ? "unable_to_determine" : "pass";
  return result("G2-004", status, status === "pass" ? `${rooms.applicable.length} 个居住房间均结合现有 Ceiling 净高证据确认可计入面积不小于 70 ft²。` : status === "issue" ? "至少一个完整 Room Region 的二维面积或结合 Ceiling 高度后的可计入面积低于 70 ft²。" : "完整 Room Region 的二维面积初检已输出；仍有房间的 Ceiling 覆盖或用途证据不完整。", { normalizedObjectIds: rooms.applicable.map((item) => item.room.roomRegionId), pascalSourceIds: rooms.applicable.flatMap((item) => item.room.pascalSourceIds), measurements, thresholds: [thresholdFrom(P.habitableRoomArea), thresholdFrom(P.habitableRoomFurredCeilingCountableHeight), thresholdFrom(P.habitableRoomSlopedCeilingCountableHeight)], diagnostics, missingData: diagnostics.filter((item) => item.severity === "warning").map((item) => `${item.normalizedObjectIds[0]}.${item.code === "habitable_room_use_unresolved" ? "legalUse" : "ceilingCoverage"}`) });
}

export function evaluateG2005(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-005", environment.context); if (gate) return gate;
  const rooms = habitableRooms(environment);
  if (!rooms.applicable.length) {
    if (environment.context.confirmedNoHabitableRooms || !rooms.ambiguous.length) return result("G2-005", "not_applicable", "项目中没有适用居住房间。", { applicability: { status: "not_applicable", reasons: ["没有可靠 habitable room"] } });
    return result("G2-005", "unable_to_determine", "用途或 Room 边界不足以执行最小水平尺寸检查。", { missingData: rooms.ambiguous.map((item) => `${item.room.roomRegionId}.legalUse`), diagnostics: rooms.ambiguous.map((item) => unableDiagnostic("habitable_room_use_unresolved", item.semantic.reason, [item.room.roomRegionId])), thresholds: [thresholdFrom(P.habitableRoomDimension)] });
  }
  const diagnostics: RuleDiagnostic[] = [], measurements: RuleResult["measurements"] = [];
  rooms.ambiguous.forEach((item) => diagnostics.push(unableDiagnostic("habitable_room_use_unresolved", item.semantic.reason, [item.room.roomRegionId])));
  for (const { room } of rooms.applicable) {
    const obstacles = structuralRingsForRoom(environment, room), fit = canFitEffectiveSquare(room.polygons, P.habitableRoomDimension.convertedValue, obstacles), measured = fit.fits ? P.habitableRoomDimension.convertedValue : maximumEffectiveSquareSize(room.polygons, obstacles);
    measurements.push({ name: fit.fits ? "effectiveHorizontalDimensionAtLeastMeters" : "maximumEffectiveHorizontalDimensionMeters", value: measured, unit: "m", normalizedObjectId: room.roomRegionId });
    if (!fit.fits) diagnostics.push(issueDiagnostic("habitable_room_horizontal_dimension_below_minimum", "真实 Room 几何（含凹口、孔洞和固定构件）无法容纳法规要求的有效水平尺寸。", [room.roomRegionId, ...room.boundaryWallIds], measured, `≥${P.habitableRoomDimension.originalValue} ${P.habitableRoomDimension.originalUnit}`));
  }
  const status: RuleStatus = diagnostics.some((item) => item.severity === "error") ? "issue" : diagnostics.length ? "unable_to_determine" : "pass";
  return result("G2-005", status, status === "pass" ? `${rooms.applicable.length} 个完整居住用途 Room Region 均存在不小于 7 ft 的有效水平尺寸。` : status === "issue" ? "至少一个完整居住用途 Room Region 的真实几何无法形成 7 ft 有效水平尺寸。" : "至少一个 Room 的边界或法规用途不可靠，不能完整判断水平尺寸。", { normalizedObjectIds: rooms.applicable.map((item) => item.room.roomRegionId), pascalSourceIds: rooms.applicable.flatMap((item) => item.room.pascalSourceIds), measurements, thresholds: [thresholdFrom(P.habitableRoomDimension)], diagnostics, missingData: diagnostics.filter((item) => item.severity === "warning").map((item) => `${item.normalizedObjectIds[0]}.legalUse`) });
}

type Item = EvaluationHandoff["furniture"][number] | EvaluationHandoff["equipment"][number] | EvaluationHandoff["columns"][number];
const isToilet = (item: Item) => fixtureSemanticOf(item) === "toilet";
const isFixedFixture = (item: Item) => fixtureSemanticOf(item) !== "other";
const directions = (rotation: number) => ({ right: [Math.cos(rotation), -Math.sin(rotation)] as Point, front: [Math.sin(rotation), Math.cos(rotation)] as Point });

export function evaluateG2006(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-006", environment.context); if (gate) return gate;
  const items: Item[] = environment.handoff.items ?? [...environment.handoff.furniture, ...environment.handoff.equipment, ...environment.handoff.columns], toilets = items.filter(isToilet);
  if (!toilets.length) return environment.context.confirmedNoToilets ? result("G2-006", "not_applicable", "项目中没有适用坐便器。", { applicability: { status: "not_applicable", reasons: ["已确认无坐便器"] } }) : result("G2-006", "unable_to_determine", "没有识别到可靠坐便器；无法区分确实不存在与语义缺失。", { missingData: ["fixture.semantic"], diagnostics: [unableDiagnostic("toilet_semantic_unresolved", "需要可靠的坐便器类别或标签。")] });
  const residential = ["detached_dwelling", "dwelling_unit", "sleeping_unit"].includes(environment.context.projectUse), frontParameter = residential ? P.toiletFrontResidential : P.toiletFrontGeneral;
  const diagnostics: RuleDiagnostic[] = [], measurements: RuleResult["measurements"] = [], fixedBase = buildObstacles(environment.handoff).filter((obstacle) => obstacle.mobility === "fixed" && obstacle.usableForCollision && obstacle.objectType !== "wall");
  const toiletRooms = new Map<string, RoomRegion>(), subitemStatus = new Map<string, { side: RuleStatus; front: RuleStatus; centerSpacing: RuleStatus }>();
  for (const toilet of toilets) {
    const center = toilet.resolvedWorldPosition as Point | null, rotation = toilet.resolvedRotationRadians, dimensions = toilet.dimensionsMeters, room = center ? environment.rooms.rooms.find((candidate) => candidate.usableForEvaluation && candidate.levelId === toilet.levelId && pointInMultiPolygon(center, candidate.polygons)) : undefined;
    subitemStatus.set(toilet.id, { side: "unable_to_determine", front: "unable_to_determine", centerSpacing: center && room ? "not_applicable" : "unable_to_determine" });
    if (!center || !Number.isFinite(rotation) || !dimensions || !room) { diagnostics.push(unableDiagnostic("toilet_geometry_unresolved", "坐便器中心、朝向、尺寸或 Room 归属不可靠。", [toilet.id])); continue; }
    toiletRooms.set(toilet.id, room);
    const normalizedRotation = ((rotation! % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (Math.abs(rotation!) > Math.PI * 2 + 1e-9) {
      measurements.push({ name: "normalizedRotationRadians", value: normalizedRotation, unit: "rad", normalizedObjectId: toilet.id, measurementBasis: "derived", assumptions: ["旋转角按2π周期归一化"], confidence: "high" });
      diagnostics.push({ severity: "info", code: "toilet_rotation_multiple_turns_normalized", message: `原始旋转 ${rotation} rad 超过一圈，已按2π归一化为 ${normalizedRotation} rad。`, normalizedObjectIds: [toilet.id], actualValue: rotation, expectedValue: "按2π周期等价", origin: "source_data", recommendation: "无需改变判定；建议核对源数据角度单位。" });
    }
    const footprintItems = items.filter((item) => item.id !== toilet.id && item.levelId === toilet.levelId && isFixedFixture(item)).map((item) => ({ id: item.id, ring: rectangularFootprint(item) })).filter((item): item is { id: string; ring: Ring } => Boolean(item.ring));
    const obstacleRings = [...fixedBase.filter((item) => item.levelId === toilet.levelId && item.objectId !== toilet.id).map((item) => item.footprint), ...footprintItems.map((item) => item.ring)], direction = directions(rotation!), right = clearanceAlongRay(center, direction.right, room.polygons, obstacleRings), left = clearanceAlongRay(center, [-direction.right[0], -direction.right[1]], room.polygons, obstacleRings), [width, , depth] = dimensions;
    const frontOrigins: Point[] = [-.45, 0, .45].map((fraction) => [center[0] + direction.front[0] * depth! / 2 + direction.right[0] * width! * fraction, center[1] + direction.front[1] * depth! / 2 + direction.right[1] * width! * fraction]), frontDistances = frontOrigins.map((origin) => clearanceAlongRay(origin, direction.front, room.polygons, obstacleRings)).filter((value): value is number => value !== null), front = frontDistances.length === frontOrigins.length ? Math.min(...frontDistances) : null;
    measurements.push(
      { name: "leftCenterToObstacleMeters", value: left, unit: "m", normalizedObjectId: toilet.id, measurementBasis: "derived", assumptions: ["从坐便器真实中心沿归一化左右方向量至Room边界或固定障碍物"], confidence: "high", thresholdValue: P.toiletSide.convertedValue, margin: left === null ? undefined : left - P.toiletSide.convertedValue, borderline: left !== null && isBorderline(left - P.toiletSide.convertedValue, P.toiletSide.convertedValue) },
      { name: "rightCenterToObstacleMeters", value: right, unit: "m", normalizedObjectId: toilet.id, measurementBasis: "derived", assumptions: ["从坐便器真实中心沿归一化左右方向量至Room边界或固定障碍物"], confidence: "high", thresholdValue: P.toiletSide.convertedValue, margin: right === null ? undefined : right - P.toiletSide.convertedValue, borderline: right !== null && isBorderline(right - P.toiletSide.convertedValue, P.toiletSide.convertedValue) },
      { name: "frontClearanceMeters", value: front, unit: "m", normalizedObjectId: toilet.id, measurementBasis: "derived", assumptions: ["从坐便器前缘沿归一化朝向量至Room边界或固定障碍物"], confidence: "high", thresholdValue: frontParameter.convertedValue, margin: front === null ? undefined : front - frontParameter.convertedValue, borderline: front !== null && isBorderline(front - frontParameter.convertedValue, frontParameter.convertedValue) },
      { name: "appliedFrontClearanceOriginal", value: `${frontParameter.originalValue} ${frontParameter.originalUnit}`, normalizedObjectId: toilet.id, measurementBasis: "explicit", confidence: "high" },
    );
    const status = subitemStatus.get(toilet.id)!;
    if (left === null || right === null) diagnostics.push(unableDiagnostic("toilet_side_clearance_measurement_unresolved", "无法可靠建立坐便器侧向净空边界。", [toilet.id]));
    else if (Math.min(left, right) + 1e-9 < P.toiletSide.convertedValue) { status.side = "issue"; diagnostics.push(issueDiagnostic("toilet_side_clearance_below_minimum", "坐便器中心至侧墙或固定障碍物距离不足。", [toilet.id], Math.min(left, right), `≥${P.toiletSide.originalValue} ${P.toiletSide.originalUnit}`)); }
    else status.side = "pass";
    if (front === null) diagnostics.push(unableDiagnostic("toilet_front_clearance_measurement_unresolved", "无法可靠建立坐便器前方净空边界。", [toilet.id]));
    else if (front + 1e-9 < frontParameter.convertedValue) { status.front = "issue"; diagnostics.push(issueDiagnostic("toilet_front_clearance_below_minimum", `坐便器前方净空低于${residential ? "住宅/睡眠单元" : "一般场景"}要求。`, [toilet.id], front, `≥${frontParameter.originalValue} ${frontParameter.originalUnit}`)); }
    else status.front = "pass";
    const minimumSide = left === null || right === null ? null : Math.min(left, right);
    if (minimumSide !== null && isBorderline(minimumSide - P.toiletSide.convertedValue, P.toiletSide.convertedValue)) diagnostics.push(borderlineDiagnostic("toilet_side_clearance_borderline", "坐便器最小侧向净空接近法规阈值。", [toilet.id], minimumSide, `≥${P.toiletSide.originalValue} ${P.toiletSide.originalUnit}`));
    if (front !== null && isBorderline(front - frontParameter.convertedValue, frontParameter.convertedValue)) diagnostics.push(borderlineDiagnostic("toilet_front_clearance_borderline", "坐便器前方净空接近法规阈值。", [toilet.id], front, `≥${frontParameter.originalValue} ${frontParameter.originalUnit}`));
  }
  const adjacentPairKeys = new Set<string>(), toiletById = new Map(toilets.map((toilet) => [toilet.id, toilet]));
  for (const roomId of new Set([...toiletRooms.values()].map((room) => room.roomRegionId))) {
    const inRoom = toilets.filter((toilet) => toiletRooms.get(toilet.id)?.roomRegionId === roomId && toilet.resolvedWorldPosition);
    if (inRoom.length < 2) continue;
    for (const toilet of inRoom) {
      const nearest = inRoom.filter((other) => other.id !== toilet.id).sort((a, b) => Math.hypot(toilet.resolvedWorldPosition![0] - a.resolvedWorldPosition![0], toilet.resolvedWorldPosition![1] - a.resolvedWorldPosition![1]) - Math.hypot(toilet.resolvedWorldPosition![0] - b.resolvedWorldPosition![0], toilet.resolvedWorldPosition![1] - b.resolvedWorldPosition![1]))[0]!;
      adjacentPairKeys.add([toilet.id, nearest.id].sort().join("\0"));
    }
  }
  for (const key of adjacentPairKeys) {
    const [aId, bId] = key.split("\0"), a = toiletById.get(aId!)!, b = toiletById.get(bId!)!;
    const distance = Math.hypot(a.resolvedWorldPosition![0] - b.resolvedWorldPosition![0], a.resolvedWorldPosition![1] - b.resolvedWorldPosition![1]);
    measurements.push({ name: `centerDistanceTo:${b.id}`, value: distance, unit: "m", normalizedObjectId: a.id });
    const pairStatus: RuleStatus = distance + 1e-9 < P.toiletCenter.convertedValue ? "issue" : "pass";
    subitemStatus.get(a.id)!.centerSpacing = pairStatus;
    subitemStatus.get(b.id)!.centerSpacing = pairStatus;
    if (pairStatus === "issue") diagnostics.push(issueDiagnostic("toilet_center_spacing_below_minimum", "同一 Room 内相邻同类洁具中心距不足。", [a.id, b.id], distance, `≥${P.toiletCenter.originalValue} ${P.toiletCenter.originalUnit}`));
  }
  toilets.forEach((toilet) => {
    const status = subitemStatus.get(toilet.id)!;
    measurements.push({ name: "sideClearanceSubitemStatus", value: status.side, normalizedObjectId: toilet.id }, { name: "frontClearanceSubitemStatus", value: status.front, normalizedObjectId: toilet.id }, { name: "sameFixtureCenterSpacingSubitemStatus", value: status.centerSpacing, normalizedObjectId: toilet.id });
  });
  const status: RuleStatus = diagnostics.some((item) => item.severity === "error") ? "issue" : diagnostics.some((item) => item.origin === "insufficient_information") ? "unable_to_determine" : "pass";
  return result("G2-006", status, status === "pass" ? `${toilets.length} 个坐便器符合侧向及${frontParameter.originalValue} in 前方净空要求；同类中心距仅在同一 Room 存在相邻洁具时适用，本次检查 ${adjacentPairKeys.size} 对。` : status === "issue" ? "至少一个坐便器的法规平面净空不足。" : "至少一个坐便器的中心、朝向或固定边界不足以完成规范测量。", { normalizedObjectIds: toilets.map((item) => item.id), pascalSourceIds: toilets.map((item) => item.rawPascalId), measurements, thresholds: [thresholdFrom(P.toiletSide), thresholdFrom(P.toiletCenter), thresholdFrom(frontParameter)], missingData: diagnostics.filter((item) => item.origin === "insufficient_information").map((item) => `${item.normalizedObjectIds[0]}.centerOrientationOrBoundary`), diagnostics });
}

const roomsByUse = (environment: RuleEnvironment, use: G2RoomUse) => environment.rooms.rooms.filter((room) => room.usableForEvaluation).map((room) => ({ room, semantic: semanticOf(environment, room) })).filter((item) => item.semantic.use === use && item.semantic.confidence !== "low");

type EeroRoomEvaluation = { roomRegionId: string; status: RuleStatus; candidates: EeroCandidate[]; passingCandidateIds: string[] };
const eeroRequiredRooms = (environment: RuleEnvironment) => {
  const explicitIds = environment.context.eeroRequiredRoomIds;
  if (explicitIds?.length) return environment.rooms.rooms.filter((room) => explicitIds.includes(room.roomRegionId) && room.usableForEvaluation);
  return environment.rooms.rooms.filter((room) => room.usableForEvaluation && ["sleeping", "basement", "habitable_attic"].includes(semanticOf(environment, room).use));
};
const eeroCandidateMeasurements = (candidate: EeroCandidate): RuleResult["measurements"] => {
  const areaThreshold = candidate.gradeFloorStatus === "yes" ? P.eeroGradeFloorMinimumClearArea.convertedValue : P.eeroMinimumClearArea.convertedValue;
  const margin = (lower: number | null, threshold: number) => lower === null ? null : lower - threshold;
  return [
    { name: "eeroOperationType", value: candidate.operationType, normalizedObjectId: candidate.candidateId, measurementBasis: candidate.measurementBasis, assumptions: candidate.assumptions, confidence: candidate.confidence },
    { name: "eeroRoomRegionId", value: candidate.roomRegionId, normalizedObjectId: candidate.candidateId, measurementBasis: "derived", assumptions: ["Room–Exterior关系由外墙开口两侧与Room Region采样建立"], confidence: candidate.confidence },
    { name: "eeroGradeFloorStatus", value: candidate.gradeFloorStatus, normalizedObjectId: candidate.candidateId, measurementBasis: candidate.gradeFloorStatus === "unknown" ? "derived" : candidate.measurementBasis, confidence: candidate.gradeFloorStatus === "unknown" ? "low" : candidate.confidence },
    { name: "eeroClearWidthMeters", value: candidate.clearWidthMeters, unit: "m", normalizedObjectId: candidate.candidateId, measurementBasis: candidate.measurementBasis, assumptions: candidate.assumptions, confidence: candidate.confidence, thresholdValue: P.eeroMinimumClearWidth.convertedValue, margin: margin(candidate.clearWidthLowerBoundMeters, P.eeroMinimumClearWidth.convertedValue), lowerBound: candidate.clearWidthLowerBoundMeters, upperBound: candidate.clearWidthUpperBoundMeters, borderline: candidate.clearWidthLowerBoundMeters !== null && isBorderline(candidate.clearWidthLowerBoundMeters - P.eeroMinimumClearWidth.convertedValue, P.eeroMinimumClearWidth.convertedValue) },
    { name: "eeroClearHeightMeters", value: candidate.clearHeightMeters, unit: "m", normalizedObjectId: candidate.candidateId, measurementBasis: candidate.measurementBasis, assumptions: candidate.assumptions, confidence: candidate.confidence, thresholdValue: P.eeroMinimumClearHeight.convertedValue, margin: margin(candidate.clearHeightLowerBoundMeters, P.eeroMinimumClearHeight.convertedValue), lowerBound: candidate.clearHeightLowerBoundMeters, upperBound: candidate.clearHeightUpperBoundMeters, borderline: candidate.clearHeightLowerBoundMeters !== null && isBorderline(candidate.clearHeightLowerBoundMeters - P.eeroMinimumClearHeight.convertedValue, P.eeroMinimumClearHeight.convertedValue) },
    { name: "eeroClearAreaSquareMeters", value: candidate.clearAreaSquareMeters, unit: "m²", normalizedObjectId: candidate.candidateId, measurementBasis: candidate.measurementBasis, assumptions: candidate.assumptions, confidence: candidate.confidence, thresholdValue: areaThreshold, margin: margin(candidate.clearAreaLowerBoundSquareMeters, areaThreshold), lowerBound: candidate.clearAreaLowerBoundSquareMeters, upperBound: candidate.clearAreaUpperBoundSquareMeters, borderline: candidate.clearAreaLowerBoundSquareMeters !== null && isBorderline(candidate.clearAreaLowerBoundSquareMeters - areaThreshold, areaThreshold) },
    { name: "eeroSizeSubitemStatus", value: candidate.sizeStatus, normalizedObjectId: candidate.candidateId, measurementBasis: candidate.measurementBasis, assumptions: candidate.assumptions, confidence: candidate.confidence },
  ];
};

function evaluateEeroRooms(environment: RuleEnvironment): EeroRoomEvaluation[] {
  const exempt = new Set(environment.context.eeroExemptRoomIds ?? []);
  return environment.eero.rooms.filter((room) => !exempt.has(room.roomRegionId)).map((room) => {
    const candidates = room.candidates.filter((candidate) => candidate.eligible);
    const passing = candidates.filter((candidate) => candidate.sizeStatus === "pass");
    const status: RuleStatus = passing.length ? "pass" : !candidates.length || candidates.every((candidate) => candidate.sizeStatus === "issue") ? "issue" : "unable_to_determine";
    return { roomRegionId: room.roomRegionId, status, candidates, passingCandidateIds: passing.map((candidate) => candidate.candidateId) };
  });
}

export function evaluateG2007(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-007", environment.context); if (gate) return gate;
  const requiredRooms = eeroRequiredRooms(environment);
  if (!requiredRooms.length) {
    if (environment.context.confirmedNoEeroRequiredRooms || !environment.rooms.rooms.some((room) => room.usableForEvaluation && semanticOf(environment, room).use === "unknown")) return result("G2-007", "not_applicable", "项目中没有需要紧急逃生救援开口的空间。", { applicability: { status: "not_applicable", reasons: ["无Sleeping Room、Basement或Habitable Attic"] }, thresholds: [thresholdFrom(P.eeroMinimumClearArea), thresholdFrom(P.eeroGradeFloorMinimumClearArea), thresholdFrom(P.eeroMinimumClearHeight), thresholdFrom(P.eeroMinimumClearWidth)] });
    return result("G2-007", "unable_to_determine", "Room用途语义不足以确认是否存在需要EERO的空间。", { missingData: ["room.eeroRequiredUse"], diagnostics: [unableDiagnostic("eero_required_room_use_unresolved", "需要可靠识别Sleeping Room、Basement或Habitable Attic。")], thresholds: [thresholdFrom(P.eeroMinimumClearArea), thresholdFrom(P.eeroGradeFloorMinimumClearArea), thresholdFrom(P.eeroMinimumClearHeight), thresholdFrom(P.eeroMinimumClearWidth)] });
  }
  const roomEvaluations = evaluateEeroRooms(environment);
  const diagnostics: RuleDiagnostic[] = [];
  const measurements = environment.eero.candidates.flatMap(eeroCandidateMeasurements);
  roomEvaluations.forEach((room) => {
    measurements.push({ name: "eeroCandidateCount", value: room.candidates.length, normalizedObjectId: room.roomRegionId, measurementBasis: "derived", assumptions: ["只计入与该Room形成可靠Room–Exterior关系且可操作的开口"], confidence: room.candidates.some((candidate) => candidate.confidence === "low") ? "low" : "high" });
    if (!room.candidates.length) diagnostics.push(issueDiagnostic("eero_exterior_opening_missing", "该适用空间没有可操作的Exterior EERO候选。", [room.roomRegionId], 0, "至少1个同一候选同时满足净宽、净高和净面积"));
    else if (room.status === "issue") {
      room.candidates.forEach((candidate) => {
        const failed: string[] = [];
        if (candidate.clearWidthUpperBoundMeters !== null && candidate.clearWidthUpperBoundMeters + 1e-9 < P.eeroMinimumClearWidth.convertedValue) failed.push("净宽");
        if (candidate.clearHeightUpperBoundMeters !== null && candidate.clearHeightUpperBoundMeters + 1e-9 < P.eeroMinimumClearHeight.convertedValue) failed.push("净高");
        const relaxedArea = candidate.gradeFloorStatus === "no" ? P.eeroMinimumClearArea.convertedValue : P.eeroGradeFloorMinimumClearArea.convertedValue;
        if (candidate.clearAreaUpperBoundSquareMeters !== null && candidate.clearAreaUpperBoundSquareMeters + 1e-9 < relaxedArea) failed.push("净面积");
        diagnostics.push(issueDiagnostic("eero_candidate_size_below_minimum", `该候选的理论上界仍不能同时满足${failed.join("、") || "全部净尺寸"}要求。`, [candidate.candidateId, room.roomRegionId]));
      });
    } else if (room.status === "unable_to_determine") {
      room.candidates.filter((candidate) => candidate.sizeStatus === "unable_to_determine").forEach((candidate) => diagnostics.push(unableDiagnostic("eero_candidate_clear_opening_bounds_cross_threshold", "已确认这是适用Room的可操作外部候选；但正常开启后的净宽、净高或净面积仍只具有上下界，可能从合格变为不合格。", [candidate.candidateId, room.roomRegionId], "补充该窗型正常开启90°/最大开启状态下的产品净开口宽、高、面积或可复核扇体几何；在补齐前可通过增设已知净开口合格的独立逃生开口规避风险。")));
    }
    room.candidates.filter((candidate) => candidate.sizeStatus === "pass").forEach((candidate) => {
      const margins = [
        (candidate.clearWidthLowerBoundMeters ?? Infinity) - P.eeroMinimumClearWidth.convertedValue,
        (candidate.clearHeightLowerBoundMeters ?? Infinity) - P.eeroMinimumClearHeight.convertedValue,
        (candidate.clearAreaLowerBoundSquareMeters ?? Infinity) - (candidate.gradeFloorStatus === "yes" ? P.eeroGradeFloorMinimumClearArea.convertedValue : P.eeroMinimumClearArea.convertedValue),
      ];
      if (margins.some((margin, index) => isBorderline(margin, index === 2 ? P.eeroMinimumClearArea.convertedValue : index === 1 ? P.eeroMinimumClearHeight.convertedValue : P.eeroMinimumClearWidth.convertedValue))) diagnostics.push(borderlineDiagnostic("eero_candidate_size_borderline", "该EERO候选通过，但至少一个净尺寸接近阈值。", [candidate.candidateId, room.roomRegionId], Math.min(...margins), "净宽、净高和净面积均满足"));
    });
  });
  const sillQualifiedRoomCount = roomEvaluations.filter((room) => room.status === "pass").length;
  const sillDependencyBlockedRooms = roomEvaluations.filter((room) => room.status === "unable_to_determine");
  if (sillDependencyBlockedRooms.length) diagnostics.push({ severity: "info", code: "eero_sill_dependency_summary", message: `G2-008窗台高度已完成${sillQualifiedRoomCount}/${roomEvaluations.length}个房间；另${sillDependencyBlockedRooms.length}个房间需先确认G2-007净开口资格，不重复生成第二张待核验卡。`, normalizedObjectIds: sillDependencyBlockedRooms.flatMap((room) => [room.roomRegionId, ...room.candidates.map((candidate) => candidate.candidateId)]), origin: "rule", recommendation: "先补充G2-007所需的正常开启净开口参数或扇体几何；确认尺寸资格后，G2-008会自动继续评价窗台高度。" });
  const status: RuleStatus = roomEvaluations.some((room) => room.status === "issue") ? "issue" : roomEvaluations.some((room) => room.status === "unable_to_determine") ? "unable_to_determine" : "pass";
  const focusIds = status === "pass" ? roomEvaluations.flatMap((room) => room.passingCandidateIds) : diagnostics.flatMap((diagnostic) => diagnostic.normalizedObjectIds.slice(0, 1));
  return result("G2-007", status, status === "pass" ? `${roomEvaluations.length} 个适用空间均有至少一个同一候选同时满足EERO净宽、净高和净面积。` : status === "issue" ? "至少一个适用空间没有EERO候选，或全部候选的理论上界仍不满足净尺寸要求。" : "至少一个适用空间的候选净开口上下界跨越法规阈值，需要进一步确认正常开启几何。", { normalizedObjectIds: [...new Set(focusIds)], pascalSourceIds: [...new Set(environment.eero.candidates.map((candidate) => candidate.pascalSourceId))], measurements, thresholds: [thresholdFrom(P.eeroMinimumClearArea), thresholdFrom(P.eeroGradeFloorMinimumClearArea), thresholdFrom(P.eeroMinimumClearHeight), thresholdFrom(P.eeroMinimumClearWidth)], diagnostics, missingData: diagnostics.filter((diagnostic) => diagnostic.origin === "insufficient_information").flatMap((diagnostic) => diagnostic.normalizedObjectIds.slice(0, 1).map((id) => `${id}.normalOperationClearOpening`)), confidence: { level: status === "unable_to_determine" ? "low" : environment.eero.candidates.some((candidate) => candidate.measurementBasis === "derived") ? "medium" : "high", score: status === "unable_to_determine" ? .35 : environment.eero.candidates.some((candidate) => candidate.measurementBasis === "derived") ? .75 : .95, reasons: [...new Set(environment.eero.candidates.flatMap((candidate) => candidate.assumptions))] } });
}

export function evaluateG2008(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-008", environment.context); if (gate) return gate;
  const requiredRooms = eeroRequiredRooms(environment);
  if (!requiredRooms.length) return result("G2-008", "not_applicable", "项目中没有需要紧急逃生救援开口的空间。", { applicability: { status: "not_applicable", reasons: ["无适用EERO空间"] }, thresholds: [thresholdFrom(P.eeroMaximumSillHeight)] });
  const sizeRooms = evaluateEeroRooms(environment);
  const diagnostics: RuleDiagnostic[] = [], measurements: RuleResult["measurements"] = [];
  let passedRooms = 0, issueRooms = 0, unableRooms = 0, blockedRooms = 0, sizeFailureRooms = 0;
  const blockedRoomIds: string[] = [];
  sizeRooms.forEach((room) => {
    if (room.status === "issue") {
      sizeFailureRooms++;
      measurements.push({ name: "eeroSillSubitemStatus", value: "not_applicable_due_to_size_failure", normalizedObjectId: room.roomRegionId, measurementBasis: "derived", assumptions: ["G2-007没有尺寸合格候选，G2-008不重复报告同一根因"], confidence: "high" });
      diagnostics.push({ severity: "info", code: "eero_sill_not_applicable_due_to_size_failure", message: "该Room没有尺寸合格EERO候选，窗台规则不重复生成问题。", normalizedObjectIds: [room.roomRegionId], origin: "rule" });
      return;
    }
    if (room.status === "unable_to_determine") {
      blockedRooms++; blockedRoomIds.push(room.roomRegionId);
      measurements.push({ name: "eeroSillSubitemStatus", value: "blocked_by_G2_007", normalizedObjectId: room.roomRegionId, measurementBasis: "derived", assumptions: ["G2-007尚不能确认同一候选的尺寸资格；G2-008保留技术依赖状态但不重复生成窗台待核验卡"], confidence: "high" }, { name: "eeroSillDependencyRuleId", value: "G2-007", normalizedObjectId: room.roomRegionId, measurementBasis: "derived", confidence: "high" }, { name: "eeroSillBlockedCandidateIds", value: room.candidates.map((candidate) => candidate.candidateId).join(","), normalizedObjectId: room.roomRegionId, measurementBasis: "derived", confidence: "high" });
      diagnostics.push({ severity: "info", code: "eero_sill_not_applicable_due_to_size_qualification_unresolved", message: "同一候选的净开口资格仍由G2-007待核验；本规则不重复生成窗台问题。", normalizedObjectIds: [room.roomRegionId, ...room.candidates.map((candidate) => candidate.candidateId)], origin: "rule", recommendation: "先在G2-007补充正常开启后的净开口几何或产品参数；尺寸资格确认后才检查同一候选的窗台高度。" });
      return;
    }
    const candidates = room.candidates.filter((candidate) => candidate.sizeStatus === "pass");
    const known = candidates.filter((candidate) => candidate.openingBottomAboveFinishedFloorMeters !== null);
    candidates.forEach((candidate) => {
      const height = candidate.openingBottomAboveFinishedFloorMeters;
      const margin = height === null ? null : P.eeroMaximumSillHeight.convertedValue - height;
      measurements.push({ name: "eeroOpeningBottomAboveFinishedFloorMeters", value: height, unit: "m", normalizedObjectId: candidate.candidateId, measurementBasis: candidate.measurementBasis, assumptions: candidate.assumptions, confidence: candidate.confidence, thresholdValue: P.eeroMaximumSillHeight.convertedValue, margin, borderline: margin !== null && isBorderline(margin, P.eeroMaximumSillHeight.convertedValue) });
      measurements.push({ name: "eeroFinishedFloorBasis", value: candidate.finishedFloorBasis, normalizedObjectId: candidate.candidateId, measurementBasis: candidate.measurementBasis, assumptions: candidate.assumptions, confidence: candidate.confidence });
    });
    const passing = known.filter((candidate) => candidate.openingBottomAboveFinishedFloorMeters! <= P.eeroMaximumSillHeight.convertedValue + 1e-9);
    if (passing.length) {
      passedRooms++;
      passing.filter((candidate) => isBorderline(P.eeroMaximumSillHeight.convertedValue - candidate.openingBottomAboveFinishedFloorMeters!, P.eeroMaximumSillHeight.convertedValue)).forEach((candidate) => diagnostics.push(borderlineDiagnostic("eero_sill_height_borderline", "该尺寸合格候选的窗台高度通过，但接近法规上限。", [candidate.candidateId, room.roomRegionId], candidate.openingBottomAboveFinishedFloorMeters!, `≤${P.eeroMaximumSillHeight.originalValue} ${P.eeroMaximumSillHeight.originalUnit}`)));
    } else if (known.length === candidates.length && known.length) {
      issueRooms++;
      known.forEach((candidate) => diagnostics.push(issueDiagnostic("eero_sill_height_above_maximum", "该尺寸合格EERO候选的净开口底部高于法规上限。", [candidate.candidateId, room.roomRegionId], candidate.openingBottomAboveFinishedFloorMeters!, `≤${P.eeroMaximumSillHeight.originalValue} ${P.eeroMaximumSillHeight.originalUnit}`)));
    } else {
      unableRooms++;
      diagnostics.push(unableDiagnostic("eero_opening_bottom_or_finished_floor_unresolved", "尺寸合格候选缺少可靠完成地面或净开口底部关系。", [room.roomRegionId, ...candidates.map((candidate) => candidate.candidateId)]));
    }
  });
  const activeRoomCount = sizeRooms.length - sizeFailureRooms;
  measurements.push({ name: "applicableRoomCount", value: sizeRooms.length, unit: "count", measurementBasis: "derived", confidence: "high" }, { name: "evaluatedRoomCount", value: passedRooms + issueRooms + unableRooms, unit: "count", measurementBasis: "derived", confidence: "high" }, { name: "blockedRoomCount", value: blockedRooms, unit: "count", measurementBasis: "derived", assumptions: blockedRooms ? ["被阻断Room依赖G2-007对同一EERO候选的尺寸资格"] : [], confidence: "high" }, { name: "dependencyRuleId", value: "G2-007", measurementBasis: "derived", confidence: "high" });
  const status: RuleStatus = issueRooms ? "issue" : unableRooms || blockedRooms ? "unable_to_determine" : activeRoomCount ? "pass" : "not_applicable";
  const focusIds = diagnostics.filter((diagnostic) => status === "issue" ? diagnostic.severity === "error" : status === "unable_to_determine" ? diagnostic.severity === "warning" : false).flatMap((diagnostic) => diagnostic.normalizedObjectIds.slice(0, 1));
  return result("G2-008", status, status === "pass" ? `${passedRooms} 个有尺寸合格EERO候选的适用空间均有同一候选满足44 in窗台上限。` : status === "issue" ? `${issueRooms} 个适用空间的尺寸合格EERO候选窗台均高于44 in。` : blockedRooms ? `窗台高度检查已完成 ${passedRooms + issueRooms + unableRooms}/${sizeRooms.length} 个房间，另${blockedRooms}个房间需先确认G2-007净开口资格。` : "至少一个尺寸合格候选的完成地面或净开口底部仍不可靠。", { normalizedObjectIds: [...new Set(focusIds)], pascalSourceIds: [...new Set(environment.eero.candidates.map((candidate) => candidate.pascalSourceId))], measurements, thresholds: [thresholdFrom(P.eeroMaximumSillHeight)], diagnostics, missingData: [...diagnostics.filter((diagnostic) => diagnostic.origin === "insufficient_information").flatMap((diagnostic) => diagnostic.normalizedObjectIds.slice(0, 1).map((id) => `${id}.finishedFloorOrOpeningBottom`)), ...blockedRoomIds.map((id) => `${id}.G2-007.eeroSizeQualification`)], applicability: status === "not_applicable" ? { status: "not_applicable", reasons: ["G2-007尺寸失败，避免重复问题"] } : undefined });
}

export function evaluateG2009(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-009", environment.context); if (gate) return gate;
  const garages = roomsByUse(environment, "garage"), sleeping = roomsByUse(environment, "sleeping"), ambiguous = environment.rooms.rooms.filter((room) => room.usableForEvaluation && semanticOf(environment, room).use === "unknown");
  if (!garages.length || !sleeping.length) {
    const confirmedAbsent = !garages.length && environment.context.confirmedNoGarage || !sleeping.length && environment.context.confirmedNoSleepingRooms;
    if (confirmedAbsent || !ambiguous.length) return result("G2-009", "not_applicable", !garages.length ? "项目中没有适用私人车库。" : "项目中没有睡眠房间。", { applicability: { status: "not_applicable", reasons: [!garages.length ? "无私人车库" : "无睡眠房间"] } });
    return result("G2-009", "unable_to_determine", "车库或睡眠房间用途语义不可靠。", { missingData: ambiguous.map((room) => `${room.roomRegionId}.legalUse`), diagnostics: ambiguous.map((room) => unableDiagnostic("garage_or_sleeping_use_unresolved", semanticOf(environment, room).reason, [room.roomRegionId])) });
  }
  const garageIds = new Set(garages.map((item) => item.room.roomRegionId)), sleepingIds = new Set(sleeping.map((item) => item.room.roomRegionId)), direct = environment.graph.portals.filter((portal) => portal.usableForConnectivity && portal.roomRegionAId && portal.roomRegionBId && (garageIds.has(portal.roomRegionAId) && sleepingIds.has(portal.roomRegionBId) || garageIds.has(portal.roomRegionBId) && sleepingIds.has(portal.roomRegionAId)));
  const diagnostics = direct.map((portal) => issueDiagnostic("garage_directly_opens_to_sleeping_room", "该 Door Portal 直接形成 Garage–Sleeping Room 连接。", [portal.doorId, portal.roomRegionAId!, portal.roomRegionBId!]));
  return result("G2-009", direct.length ? "issue" : "pass", direct.length ? `发现 ${direct.length} 樘门直接连接车库与睡眠房间。` : "车库与睡眠房间之间不存在直接可通行开口。", { normalizedObjectIds: direct.length ? direct.map((portal) => portal.doorId) : [...garageIds, ...sleepingIds], pascalSourceIds: direct.map((portal) => portal.pascalSourceId), measurements: [{ name: "garageRoomCount", value: garages.length }, { name: "sleepingRoomCount", value: sleeping.length }, { name: "directOpeningCount", value: direct.length }], diagnostics });
}

const reachableAvoiding = (graph: RoomConnectivityGraph, starts: string[], excluded: Set<string>) => {
  const adjacency = new Map<string, string[]>();
  graph.edges.forEach((edge) => {
    if (excluded.has(edge.fromNodeId) || excluded.has(edge.toNodeId)) return;
    adjacency.set(edge.fromNodeId, [...(adjacency.get(edge.fromNodeId) ?? []), edge.toNodeId]);
    adjacency.set(edge.toNodeId, [...(adjacency.get(edge.toNodeId) ?? []), edge.fromNodeId]);
  });
  const visited = new Set<string>(), queue = [...starts];
  while (queue.length) { const current = queue.shift()!; if (visited.has(current) || excluded.has(current)) continue; visited.add(current); (adjacency.get(current) ?? []).forEach((next) => { if (!visited.has(next)) queue.push(next); }); }
  return visited;
};

export function evaluateG2010(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-010", environment.context); if (gate) return gate;
  const garages = roomsByUse(environment, "garage");
  if (!garages.length && environment.context.confirmedNoGarage) return result("G2-010", "not_applicable", "项目中没有适用私人车库。", { applicability: { status: "not_applicable", reasons: ["无私人车库"] } });
  if (!garages.length) return result("G2-010", "unable_to_determine", "无法可靠确认住宅单元内是否存在私人车库。", { missingData: ["dwellingUnit.garageRoomIds"], diagnostics: [unableDiagnostic("garage_room_unresolved", "不能以不可靠 Zone 名称排除车库。")] });
  const classified = environment.rooms.rooms.filter((room) => room.usableForEvaluation).map((room) => ({ room, semantic: semanticOf(environment, room) }));
  const ambiguous = classified.filter((item) => item.semantic.use === "unknown" || item.semantic.confidence === "low");
  if (ambiguous.length) return result("G2-010", "unable_to_determine", "项目已确认为独立住宅，但部分 Room 用途语义不可靠，无法确定完整疏散起点集合。", { normalizedObjectIds: [...garages.map((item) => item.room.roomRegionId), ...ambiguous.map((item) => item.room.roomRegionId)], missingData: ambiguous.map((item) => `${item.room.roomRegionId}.legalUse`), diagnostics: ambiguous.map((item) => unableDiagnostic("dwelling_egress_start_use_unresolved", item.semantic.reason, [item.room.roomRegionId])) });
  const egressPortals = environment.graph.portals.filter((portal) => portal.usableForConnectivity && portal.connectsExterior), doorIds = egressPortals.map((portal) => portal.doorId), starts = [...new Set(egressPortals.map((portal) => portal.roomRegionAId ?? portal.roomRegionBId).filter((id): id is string => Boolean(id)))];
  if (!starts.length) return result("G2-010", "unable_to_determine", "没有识别到可靠 Room–Exterior 出口候选，无法执行避开车库的路径判定。", { normalizedObjectIds: garages.map((item) => item.room.roomRegionId), measurements: [{ name: "exteriorExitCandidateCount", value: 0 }], missingData: ["doorPortal.roomExteriorRelation"], diagnostics: [unableDiagnostic("exterior_egress_candidate_unresolved", "需要至少一樘可靠 Room–Exterior Door Portal。", garages.map((item) => item.room.roomRegionId))] });
  const garageIds = new Set(garages.map((item) => item.room.roomRegionId)), withoutGarage = reachableAvoiding(environment.graph, starts, garageIds), full = reachableAvoiding(environment.graph, starts, new Set());
  const applicableRooms = classified.filter((item) => !["garage", "other", "unknown"].includes(item.semantic.use)).map((item) => item.room.roomRegionId), onlyThroughGarage = applicableRooms.filter((id) => full.has(id) && !withoutGarage.has(id)), disconnected = applicableRooms.filter((id) => !full.has(id));
  const measurements: RuleResult["measurements"] = [{ name: "checkedDwellingRoomCount", value: applicableRooms.length }, { name: "garageRoomCount", value: garageIds.size }, { name: "exteriorExitCandidateCount", value: doorIds.length }, { name: "onlyThroughGarageCount", value: onlyThroughGarage.length }];
  if (onlyThroughGarage.length) return result("G2-010", "issue", `${onlyThroughGarage.length} 个住宅使用 Room 到任一可靠外门的所有路径都必须经过车库。`, { normalizedObjectIds: onlyThroughGarage, measurements, diagnostics: onlyThroughGarage.map((id) => issueDiagnostic("egress_path_requires_garage", "完整连接图可到达外门，但删除 Garage Room 后不再可达。", [id, ...garageIds, ...doorIds])) });
  if (disconnected.length) return result("G2-010", "unable_to_determine", "部分住宅使用 Room 在完整连接图中也无法到达任何可靠外门，当前不能归因为必须经过车库。", { normalizedObjectIds: disconnected, measurements, missingData: disconnected.map((id) => `${id}.connectivity`), diagnostics: disconnected.map((id) => unableDiagnostic("dwelling_room_egress_connectivity_unresolved", "需核验该 Room 的 Door Portal、开放连接或楼梯连接。", [id])) });
  return result("G2-010", "pass", `${applicableRooms.length} 个可靠住宅使用 Room 均存在至少一条不经过 Garage Room、到达任一可靠外门的路径。`, { normalizedObjectIds: applicableRooms, measurements });
}

type SubitemStatus = "pass" | "issue" | "unable_to_determine" | "not_applicable";
const statusFromSubitems = (statuses: SubitemStatus[]): RuleStatus =>
  statuses.includes("issue") ? "issue" : statuses.includes("unable_to_determine") ? "unable_to_determine" : statuses.includes("pass") ? "pass" : "not_applicable";
const minimumBoundStatus = (lower: number | null, upper: number | null, threshold: number): SubitemStatus =>
  upper !== null && upper + 1e-9 < threshold ? "issue" : lower !== null && lower + 1e-9 >= threshold ? "pass" : "unable_to_determine";
const maximumBoundStatus = (lower: number | null, upper: number | null, threshold: number): SubitemStatus =>
  lower !== null && lower - 1e-9 > threshold ? "issue" : upper !== null && upper - 1e-9 <= threshold ? "pass" : "unable_to_determine";

const landingStatus = (landing: StairLandingEvidence): SubitemStatus => landing.platformEffective.length ? "pass" : landing.lastTreadEdgeCenter && landing.travelDirection && landing.stairWidthMeters ? "issue" : "unable_to_determine";
const landingMeasurements = (landing: StairLandingEvidence): RuleResult["measurements"] => [
  { name: "stairLandingEndpoint", value: landing.endpoint, normalizedObjectId: landing.stairId, measurementBasis: landing.measurementBasis, assumptions: landing.assumptions, confidence: landing.confidence },
  { name: "stairLandingLevelId", value: landing.endpointLevelId, normalizedObjectId: landing.stairId, measurementBasis: "explicit", confidence: landing.confidence },
  { name: "stairLandingSource", value: landing.platformSource, normalizedObjectId: landing.stairId, measurementBasis: landing.measurementBasis, assumptions: landing.assumptions, confidence: landing.confidence },
  { name: "stairLandingWidthMeters", value: landing.platformWidthMeters, unit: "m", normalizedObjectId: landing.stairId, measurementBasis: landing.measurementBasis, assumptions: landing.assumptions, confidence: landing.confidence, lowerBound: landing.lowerBound.widthMeters, upperBound: landing.upperBound.widthMeters },
  { name: "stairLandingDepthMeters", value: landing.platformDepthMeters, unit: "m", normalizedObjectId: landing.stairId, measurementBasis: landing.measurementBasis, assumptions: landing.assumptions, confidence: landing.confidence, lowerBound: landing.lowerBound.depthMeters, upperBound: landing.upperBound.depthMeters },
];

export function evaluateG2013(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-013", environment.context); if (gate) return gate;
  if (!environment.stairLandings.length) return result("G2-013", "not_applicable", "项目中没有适用楼梯。", { applicability: { status: "not_applicable", reasons: ["无楼梯"] } });
  const diagnostics: RuleDiagnostic[] = [], statuses: SubitemStatus[] = [], measurements: RuleResult["measurements"] = [];
  environment.stairLandings.forEach((landing) => {
    let status = landingStatus(landing);
    // R311.7.6’s narrow interior-top exception is valid only when no nearby door opens over the stair.
    if (landing.endpoint === "top" && status === "issue") {
      const relevant = landing.doorOperations.filter((door) => door.usableForEvaluation);
      const requiredArea = landing.platformCandidate;
      const opensOverStair = relevant.some((door) => doorSweepsPlatform(door, requiredArea));
      if (!landing.doorOperations.length) status = "not_applicable";
      else if (!relevant.length) status = "unable_to_determine";
      else if (!opensOverStair) status = "not_applicable";
      // a reliable sweep over the required area means the top exception cannot be used
    }
    statuses.push(status); measurements.push(...landingMeasurements(landing), { name: "stairLandingExistenceStatus", value: status, normalizedObjectId: landing.stairId, measurementBasis: landing.measurementBasis, confidence: landing.confidence });
    if (status === "issue") diagnostics.push(issueDiagnostic("stair_required_landing_missing", `${landing.endpoint}端没有可由真实Room Region连续覆盖的必要平台；顶部门向楼梯上方开启时不能使用室内顶部例外。`, landing.locatableObjectIds));
    else if (status === "unable_to_determine") diagnostics.push(unableDiagnostic("stair_landing_boundary_unresolved", `${landing.endpoint}端缺少可建立连续平台的端点、行进方向、宽度或Room边界。`, landing.locatableObjectIds));
  });
  const status = statusFromSubitems(statuses);
  return result("G2-013", status, status === "pass" ? "全部适用楼梯端部均有可靠连续平台。" : status === "issue" ? "至少一个依法需要的平台端部未能由可靠平面几何建立。" : status === "not_applicable" ? "所有楼梯端部均落入明确的顶部室内例外。" : "至少一个楼梯端部的平台边界或端点关系不足。", { normalizedObjectIds: [...new Set(environment.stairLandings.flatMap((item) => item.locatableObjectIds))], measurements, diagnostics, missingData: diagnostics.filter((item) => item.origin === "insufficient_information").map((item) => item.code) });
}

export function evaluateG2014(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-014", environment.context); if (gate) return gate;
  const platforms = environment.stairLandings.filter((landing) => landing.platformEffective.length);
  if (!platforms.length) return result("G2-014", "not_applicable", "没有由G2-013确认存在的平台；本规则不重复报告平台缺失。", { applicability: { status: "not_applicable", reasons: ["无已确认平台"] }, thresholds: [thresholdFrom(P.straightStairLandingMinimumDepth)] });
  const diagnostics: RuleDiagnostic[] = [], measurements: RuleResult["measurements"] = [], statuses: SubitemStatus[] = [];
  platforms.forEach((landing) => {
    const spiral = environment.spiralStairs.find((item) => item.stairId === landing.stairId);
    const ordinaryFlight = environment.stairClearWidths.find((item) => item.stairId === landing.stairId);
    const nonrectangular = /spiral|curved|winder|non.?rect/i.test(landing.stairType);
    const requirement = spiral ? { width: P.spiralMinimumClearWidth.convertedValue, source: "G2-011 螺旋楼梯专项最小净宽 26 in", confidence: spiral.innerBoundarySemantic === "tread_inner_edge" ? "high" as const : "low" as const, flightId: null }
      : ordinaryFlight ? { width: ordinaryFlight.handrailCount === 2 ? P.stairWidthTwoHandrails.convertedValue : ordinaryFlight.handrailCount === 1 ? P.stairWidthOneHandrail.convertedValue : P.stairWidthAboveHandrail.convertedValue, source: ordinaryFlight.handrailCount === 2 ? "G2-012 双侧扶手适用宽度" : ordinaryFlight.handrailCount === 1 ? "G2-012 单侧扶手适用宽度" : "G2-012 扶手高度以上/无扶手适用宽度", confidence: ordinaryFlight.confidence, flightId: ordinaryFlight.flightId }
        : null;
    const requiredWidth = requirement?.width ?? null, requiredArea = requiredWidth === null ? null : Math.PI * requiredWidth * requiredWidth / 4;
    const widthStatus = requiredWidth === null ? "unable_to_determine" : minimumBoundStatus(landing.platformWidthMeters, landing.platformWidthMeters, requiredWidth);
    const depthValue = nonrectangular ? landing.walkingLineDepthMeters : landing.platformDepthMeters;
    const depthThreshold = nonrectangular ? requiredWidth : P.straightStairLandingMinimumDepth.convertedValue;
    const depthStatus = depthThreshold === null ? "unable_to_determine" : minimumBoundStatus(depthValue, depthValue, depthThreshold);
    // Circular witnesses are tessellated for polygon operations; 50 mm² is a numerical
    // tolerance, not an added legal allowance, and equality to the exact sector passes.
    const areaStatus = !nonrectangular ? "not_applicable" : requiredArea === null || landing.effectiveAreaSquareMeters === null ? "unable_to_determine" : landing.effectiveAreaSquareMeters + .00005 < requiredArea ? "issue" : landing.quarterCircleWitnessFits === true ? "pass" : landing.quarterCircleWitnessFits === false ? "issue" : "unable_to_determine";
    const witnessStatus = !nonrectangular ? "not_applicable" : landing.quarterCircleWitnessFits === true ? "pass" : landing.quarterCircleWitnessFits === false ? "issue" : "unable_to_determine";
    const status = statusFromSubitems([widthStatus, depthStatus, areaStatus, witnessStatus]); statuses.push(status);
    const widthMargin = landing.platformWidthMeters === null || requiredWidth === null ? null : landing.platformWidthMeters - requiredWidth;
    const depthMargin = depthValue === null || depthThreshold === null ? null : depthValue - depthThreshold;
    const areaMargin = landing.effectiveAreaSquareMeters === null || requiredArea === null ? null : landing.effectiveAreaSquareMeters - requiredArea;
    landing.requiredLandingWidthMeters = requiredWidth;
    landing.requiredLandingAreaSquareMeters = requiredArea;
    landing.widthMarginMeters = widthMargin;
    landing.depthMarginMeters = depthMargin;
    landing.areaMarginSquareMeters = areaMargin;
    measurements.push(...landingMeasurements(landing),
      { name: "servedStairId", value: landing.stairId, normalizedObjectId: landing.stairId, measurementBasis: "explicit", confidence: requirement?.confidence ?? "low" },
      { name: "servedFlightId", value: requirement?.flightId ?? null, normalizedObjectId: landing.stairId, measurementBasis: "derived", confidence: requirement?.confidence ?? "low" },
      { name: "requiredLandingWidthMeters", value: requiredWidth, unit: "m", normalizedObjectId: landing.stairId, measurementBasis: "derived", assumptions: requirement ? [requirement.source] : ["缺少所服务梯段适用法规宽度"], confidence: requirement?.confidence ?? "low", thresholdValue: requiredWidth ?? undefined, margin: widthMargin },
      { name: "requiredLandingAreaSquareMeters", value: requiredArea, unit: "m²", normalizedObjectId: landing.stairId, measurementBasis: "derived", assumptions: requiredWidth === null ? ["requiredLandingWidth未建立"] : ["π × requiredLandingWidth² ÷ 4"], confidence: requirement?.confidence ?? "low", thresholdValue: requiredArea ?? undefined, margin: areaMargin },
      { name: "stairLandingWidthStatus", value: widthStatus, normalizedObjectId: landing.stairId, measurementBasis: landing.measurementBasis, confidence: landing.confidence },
      { name: "stairLandingDepthStatus", value: depthStatus, normalizedObjectId: landing.stairId, measurementBasis: landing.measurementBasis, confidence: landing.confidence },
      { name: "walkingLineRadiusMeters", value: landing.walkingLineRadiusMeters, unit: "m", normalizedObjectId: landing.stairId, measurementBasis: "derived", assumptions: spiral ? ["复用G2-011的innerRadius踏步内侧窄端语义，向外12 in"] : [], confidence: landing.confidence },
      { name: "walkingLineContinuousUsableDepthMeters", value: nonrectangular ? landing.walkingLineDepthMeters : null, unit: "m", normalizedObjectId: landing.stairId, measurementBasis: "derived", assumptions: ["法规行走线自最后一级踏步边缘进入平台后的连续可用深度；不是平台的固定总长度。"], confidence: landing.confidence, thresholdValue: nonrectangular ? depthThreshold ?? undefined : undefined, margin: depthMargin },
      { name: "effectiveLandingAreaSquareMeters", value: nonrectangular ? landing.effectiveAreaSquareMeters : null, unit: "m²", normalizedObjectId: landing.stairId, measurementBasis: "derived", confidence: landing.confidence, thresholdValue: requiredArea ?? undefined, margin: areaMargin },
      { name: "quarterCircleWitnessStatus", value: witnessStatus, normalizedObjectId: landing.stairId, measurementBasis: "derived", confidence: landing.confidence },
      { name: "stairLandingAreaStatus", value: areaStatus, normalizedObjectId: landing.stairId, measurementBasis: "derived", confidence: landing.confidence },
    );
    if (status === "issue") diagnostics.push(issueDiagnostic("stair_landing_dimension_noncompliant", nonrectangular ? "非矩形平台的有效宽度、法规行走线深度、四分之一圆面积或见证区域有可靠不足。" : "平台有效宽度小于所服务梯段的适用法定宽度，或直跑楼梯行进深度小于36 in。", landing.locatableObjectIds));
    else if (status === "unable_to_determine") diagnostics.push(unableDiagnostic("stair_landing_dimension_unresolved", requiredWidth === null ? "无法建立所服务梯段的适用法规宽度。" : nonrectangular ? "非矩形平台的行走线、有效边界或四分之一圆见证区域不足，且可能改变结论。" : "平台关键尺寸上下界不足。", landing.locatableObjectIds));
  });
  const status = statusFromSubitems(statuses);
  return result("G2-014", status, status === "pass" ? "所有已确认平台均满足所服务梯段适用宽度；直跑深度或非矩形行走线、面积和见证区域也满足要求。" : status === "issue" ? "至少一个已确认平台的可靠宽度、深度、面积或见证区域不足。" : "平台存在，但所服务梯段适用宽度、行走线或有效边界仍有可能改变结论。", { normalizedObjectIds: [...new Set(platforms.flatMap((item) => item.locatableObjectIds))], measurements, thresholds: [thresholdFrom(P.straightStairLandingMinimumDepth), thresholdFrom(P.spiralMinimumClearWidth)], diagnostics, missingData: diagnostics.filter((item) => item.origin === "insufficient_information").map((item) => item.code) });
}

export function evaluateG2015(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-015", environment.context); if (gate) return gate;
  const candidates = environment.stairLandings.flatMap((landing) => landing.doorOperations.map((door) => ({ landing, door }))).filter(({ door }) => door.usableForEvaluation);
  if (!candidates.length) return result("G2-015", "not_applicable", "没有与楼梯端部存在可靠几何关系且具有可用门扇操作数据的门。", { applicability: { status: "not_applicable", reasons: ["无相关可靠门扇"] } });
  const diagnostics: RuleDiagnostic[] = [], measurements: RuleResult["measurements"] = [], statuses: SubitemStatus[] = [];
  candidates.forEach(({ landing, door }) => {
    const intersects = doorSweepsPlatform(door, landing.platformEffective);
    const status: SubitemStatus = !landing.platformEffective.length ? "unable_to_determine" : intersects ? "unable_to_determine" : "pass";
    statuses.push(status); measurements.push({ name: "stairLandingDoorSweepIntersects", value: intersects, normalizedObjectId: door.doorId, measurementBasis: "derived", assumptions: ["仅检查同Level、门洞靠近楼梯端部且具有可靠门扇扫掠的门"], confidence: door.confidence }, { name: "stairLandingDoorOpeningAngleRadians", value: door.openingAngleRadians, unit: "rad", normalizedObjectId: door.doorId, measurementBasis: "explicit", confidence: door.confidence });
    if (status === "unable_to_determine") diagnostics.push(unableDiagnostic("stair_landing_door_sweep_manual_review", !landing.platformEffective.length ? "门与楼梯端部关系可见，但平台有效polygon尚未建立。" : "门扇扫掠进入平台；现有住宅条文记录没有可普遍套用的侵占英寸阈值，需人工核验高差/例外及剩余连续区域。", [landing.stairId, door.doorId, ...landing.locatableObjectIds]));
  });
  const status = statusFromSubitems(statuses);
  return result("G2-015", status, status === "pass" ? "所有具有可靠操作几何的相关门均未扫入已确认平台。" : "至少一扇相关门的扫掠与平台关系仍需要条文例外和高差人工复核。", { normalizedObjectIds: [...new Set(candidates.flatMap(({ landing, door }) => [landing.stairId, door.doorId]))], measurements, diagnostics, missingData: diagnostics.filter((item) => item.origin === "insufficient_information").map((item) => item.code) });
}

export function evaluateG2011(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-011", environment.context); if (gate) return gate;
  if (!environment.spiralStairs.length) return result("G2-011", "not_applicable", "项目中没有明确标记为spiral的楼梯。", {
    applicability: { status: "not_applicable", reasons: ["无spiral楼梯"] },
    thresholds: [thresholdFrom(P.spiralMinimumClearWidth), thresholdFrom(P.spiralMaximumWalklineRadius), thresholdFrom(P.spiralMinimumWalklineTreadDepth), thresholdFrom(P.spiralMaximumRiserHeight), thresholdFrom(P.spiralMinimumHeadroom)],
  });
  const diagnostics: RuleDiagnostic[] = [], measurements: RuleResult["measurements"] = [], stairStatuses: RuleStatus[] = [];
  environment.spiralStairs.forEach((stair) => {
    const items: Array<{ key: string; label: string; status: SubitemStatus; actual: number | null; threshold: number; expected: string }> = [];
    items.push({
      key: "clear_width", label: "扶手处及以下净宽",
      status: minimumBoundStatus(stair.clearWidthLowerBoundMeters, stair.clearWidthUpperBoundMeters, P.spiralMinimumClearWidth.convertedValue),
      actual: stair.clearWidthMeters, threshold: P.spiralMinimumClearWidth.convertedValue,
      expected: `≥${P.spiralMinimumClearWidth.originalValue} ${P.spiralMinimumClearWidth.originalUnit}`,
    }, {
      key: "walkline_radius", label: "法规行走线半径",
      status: maximumBoundStatus(stair.walklineRadiusLowerBoundMeters, stair.walklineRadiusUpperBoundMeters, P.spiralMaximumWalklineRadius.convertedValue),
      actual: stair.walklineRadiusMeters, threshold: P.spiralMaximumWalklineRadius.convertedValue,
      expected: `≤${P.spiralMaximumWalklineRadius.originalValue} ${P.spiralMaximumWalklineRadius.originalUnit}`,
    }, {
      key: "walkline_tread_depth", label: "行走线处踏步深度",
      status: minimumBoundStatus(stair.treadDepthLowerBoundMeters, stair.treadDepthUpperBoundMeters, P.spiralMinimumWalklineTreadDepth.convertedValue),
      actual: stair.minimumTreadDepthAtWalklineMeters, threshold: P.spiralMinimumWalklineTreadDepth.convertedValue,
      expected: `≥${P.spiralMinimumWalklineTreadDepth.originalValue} ${P.spiralMinimumWalklineTreadDepth.originalUnit}`,
    }, {
      key: "riser_height", label: "踢面高度",
      status: maximumBoundStatus(stair.maximumRiserHeightMeters, stair.maximumRiserHeightMeters, P.spiralMaximumRiserHeight.convertedValue),
      actual: stair.maximumRiserHeightMeters, threshold: P.spiralMaximumRiserHeight.convertedValue,
      expected: `≤${P.spiralMaximumRiserHeight.originalValue} ${P.spiralMaximumRiserHeight.originalUnit}`,
    }, {
      key: "tread_consistency", label: "踏步一致性",
      status: stair.treadGeometryConsistent === true ? "pass" : stair.treadGeometryConsistent === false ? "issue" : "unable_to_determine",
      actual: null, threshold: 0, expected: "踏步一致",
    }, {
      key: "headroom", label: "净高",
      status: minimumBoundStatus(stair.headroomMeters, stair.headroomMeters, P.spiralMinimumHeadroom.convertedValue),
      actual: stair.headroomMeters, threshold: P.spiralMinimumHeadroom.convertedValue,
      expected: `≥${P.spiralMinimumHeadroom.originalValue} ${P.spiralMinimumHeadroom.originalUnit}`,
    });
    const stairStatus = statusFromSubitems(items.map((item) => item.status));
    stairStatuses.push(stairStatus);
    measurements.push(
      { name: "spiralNominalWidthMeters", value: stair.nominalWidthMeters, unit: "m", normalizedObjectId: stair.stairId, measurementBasis: "explicit", confidence: stair.confidence },
      { name: "spiralInnerRadiusMeters", value: stair.innerRadiusMeters, unit: "m", normalizedObjectId: stair.stairId, measurementBasis: "explicit", confidence: stair.confidence },
      { name: "spiralOuterRadiusMeters", value: stair.outerRadiusMeters, unit: "m", normalizedObjectId: stair.stairId, measurementBasis: "derived", assumptions: stair.assumptions, confidence: stair.confidence },
    );
    const boundsByKey: Record<string, [number | null, number | null]> = {
      clear_width: [stair.clearWidthLowerBoundMeters, stair.clearWidthUpperBoundMeters],
      walkline_radius: [stair.walklineRadiusLowerBoundMeters, stair.walklineRadiusUpperBoundMeters],
      walkline_tread_depth: [stair.treadDepthLowerBoundMeters, stair.treadDepthUpperBoundMeters],
      riser_height: [stair.maximumRiserHeightMeters, stair.maximumRiserHeightMeters],
      tread_consistency: [null, null],
      headroom: [stair.headroomMeters, stair.headroomMeters],
    };
    items.forEach((item) => {
      const [lower, upper] = boundsByKey[item.key]!;
      const maximum = ["walkline_radius", "riser_height"].includes(item.key);
      const margin = item.actual === null ? null : maximum ? item.threshold - item.actual : item.actual - item.threshold;
      measurements.push(
        { name: `spiral_${item.key}_status`, value: item.status, normalizedObjectId: stair.stairId, measurementBasis: stair.measurementBasis, assumptions: stair.assumptions, confidence: stair.confidence },
        { name: `spiral_${item.key}_meters`, value: item.actual, unit: item.key === "tread_consistency" ? undefined : "m", normalizedObjectId: stair.stairId, measurementBasis: stair.measurementBasis, assumptions: stair.assumptions, confidence: stair.confidence, thresholdValue: item.threshold || undefined, margin, lowerBound: lower, upperBound: upper, borderline: margin !== null && isBorderline(margin, item.threshold) },
      );
      if (item.status === "issue") diagnostics.push(issueDiagnostic(`spiral_${item.key}_noncompliant`, `${item.label}的可靠值或理论上界违反螺旋楼梯专项要求。`, [stair.stairId], item.actual ?? (maximum ? lower ?? undefined : upper ?? undefined), item.expected));
      else if (item.status === "unable_to_determine") {
        const missing = item.key === "clear_width" ? "扶手数量、扶手突出及扶手处净宽" : item.key === "headroom" ? "沿法规行走线的净高及其上方梁、吊顶或其他突出物" : item.key === "walkline_radius" || item.key === "walkline_tread_depth" ? "踏步内侧净边缘或逐级踏步几何" : `${item.label}的可靠测量关系`;
        diagnostics.push(unableDiagnostic(`spiral_${item.key}_unresolved`, `已确认该楼梯为螺旋楼梯并已评价其他专项尺寸；但缺少${missing}，其结果仍可能改变该子项结论。`, [stair.stairId], "补充楼梯扶手、逐级踏步或沿法规行走线的截面/净高证据；当前已确认的违规仍应优先处理，可考虑调整螺旋楼梯几何或改用其他楼梯形式。"));
      }
      if (margin !== null && isBorderline(margin, item.threshold)) diagnostics.push(borderlineDiagnostic(`spiral_${item.key}_borderline`, `${item.label}接近法规阈值。`, [stair.stairId], item.actual!, item.expected));
    });
  });
  const status = statusFromSubitems(stairStatuses);
  return result("G2-011", status, status === "pass" ? `${environment.spiralStairs.length} 座螺旋楼梯的全部专项尺寸均符合规范。` : status === "issue" ? "至少一座螺旋楼梯有可靠专项尺寸违反规范。" : "螺旋楼梯已按专项规则启用，但至少一个可能改变结论的扶手净宽、法规行走线或净高子项仍未确定。", {
    normalizedObjectIds: environment.spiralStairs.map((stair) => stair.stairId),
    measurements,
    thresholds: [thresholdFrom(P.spiralMinimumClearWidth), thresholdFrom(P.spiralMaximumWalklineRadius), thresholdFrom(P.spiralMinimumWalklineTreadDepth), thresholdFrom(P.spiralMaximumRiserHeight), thresholdFrom(P.spiralMinimumHeadroom)],
    diagnostics,
    missingData: diagnostics.filter((item) => item.origin === "insufficient_information").map((item) => `${item.normalizedObjectIds[0]}.${item.code}`),
    confidence: { level: status === "unable_to_determine" ? "low" : environment.spiralStairs.every((stair) => stair.confidence === "high") ? "high" : "medium", score: status === "unable_to_determine" ? .35 : .75, reasons: [...new Set(environment.spiralStairs.flatMap((stair) => stair.assumptions))] },
  });
}

export function evaluateG2012(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-012", environment.context); if (gate) return gate;
  if (!environment.stairClearWidths.length) return result("G2-012", "not_applicable", environment.spiralStairs.length ? "项目中只有由G2-011覆盖的spiral楼梯，没有普通适用楼梯。" : "项目中没有普通适用楼梯。", {
    normalizedObjectIds: environment.spiralStairs.map((stair) => stair.stairId),
    applicability: { status: "not_applicable", reasons: ["无普通适用楼梯；spiral由G2-011覆盖"] },
    thresholds: [thresholdFrom(P.stairWidthAboveHandrail), thresholdFrom(P.stairWidthOneHandrail), thresholdFrom(P.stairWidthTwoHandrails)],
  });
  const diagnostics: RuleDiagnostic[] = [], measurements: RuleResult["measurements"] = [], flightStatuses: RuleStatus[] = [];
  environment.stairClearWidths.forEach((flight) => {
    const aboveStatus = minimumBoundStatus(flight.wallClearWidthMeters, flight.wallClearWidthMeters, P.stairWidthAboveHandrail.convertedValue);
    let belowThreshold = P.stairWidthTwoHandrails, condition = "handrail_count_unknown";
    if (flight.handrailCount === 0) { belowThreshold = P.stairWidthAboveHandrail; condition = "no_handrail_36_in"; }
    else if (flight.handrailCount === 1) { belowThreshold = P.stairWidthOneHandrail; condition = "one_handrail_31_5_in"; }
    else if (flight.handrailCount === 2) { belowThreshold = P.stairWidthTwoHandrails; condition = "two_handrails_27_in"; }
    const belowStatus = flight.handrailCount === null
      ? flight.belowHandrailUpperBoundMeters !== null && flight.belowHandrailUpperBoundMeters + 1e-9 < P.stairWidthTwoHandrails.convertedValue ? "issue" : "unable_to_determine"
      : minimumBoundStatus(flight.belowHandrailLowerBoundMeters, flight.belowHandrailUpperBoundMeters, belowThreshold.convertedValue);
    const flightStatus = statusFromSubitems([aboveStatus, belowStatus]);
    flightStatuses.push(flightStatus);
    const aboveMargin = flight.wallClearWidthMeters === null ? null : flight.wallClearWidthMeters - P.stairWidthAboveHandrail.convertedValue;
    const belowValue = flight.handrailClearWidthMeters;
    const belowMargin = belowValue === null ? null : belowValue - belowThreshold.convertedValue;
    measurements.push(
      { name: "stairFlightId", value: flight.flightId, normalizedObjectId: flight.stairId, measurementBasis: flight.measurementBasis, assumptions: flight.assumptions, confidence: flight.confidence },
      { name: "stairNominalWidthMeters", value: flight.nominalWidthMeters, unit: "m", normalizedObjectId: flight.stairId, measurementBasis: flight.measurementBasis, assumptions: flight.assumptions, confidence: flight.confidence },
      { name: "stairWallClearWidthMeters", value: flight.wallClearWidthMeters, unit: "m", normalizedObjectId: flight.stairId, measurementBasis: flight.measurementBasis, assumptions: flight.assumptions, confidence: flight.confidence, thresholdValue: P.stairWidthAboveHandrail.convertedValue, margin: aboveMargin },
      { name: "stairHandrailCount", value: flight.handrailCount, normalizedObjectId: flight.stairId, measurementBasis: flight.measurementBasis, assumptions: flight.assumptions, confidence: flight.confidence },
      { name: "stairHandrailClearWidthMeters", value: belowValue, unit: "m", normalizedObjectId: flight.stairId, measurementBasis: flight.measurementBasis, assumptions: flight.assumptions, confidence: flight.confidence, thresholdValue: belowThreshold.convertedValue, margin: belowMargin, lowerBound: flight.belowHandrailLowerBoundMeters, upperBound: flight.belowHandrailUpperBoundMeters },
      { name: "stairWidthRegulatoryCondition", value: condition, normalizedObjectId: flight.stairId, measurementBasis: "derived", assumptions: flight.assumptions, confidence: flight.confidence },
      { name: "stairWidthAboveHandrailStatus", value: aboveStatus, normalizedObjectId: flight.stairId, measurementBasis: flight.measurementBasis, confidence: flight.confidence },
      { name: "stairWidthBelowHandrailStatus", value: belowStatus, normalizedObjectId: flight.stairId, measurementBasis: flight.measurementBasis, confidence: flight.confidence },
    );
    if (aboveStatus === "issue") diagnostics.push(issueDiagnostic("stair_width_above_handrail_below_minimum", "扶手允许高度以上的墙间可靠净宽低于36 in。", flight.locatableObjectIds, flight.wallClearWidthMeters!, "≥36 in"));
    if (belowStatus === "issue") diagnostics.push(issueDiagnostic("stair_width_below_handrail_below_minimum", "扶手高度及以下的理论最大净宽仍低于适用阈值。", flight.locatableObjectIds, belowValue ?? flight.belowHandrailUpperBoundMeters ?? undefined, `≥${belowThreshold.originalValue} ${belowThreshold.originalUnit}`));
    if (aboveStatus === "unable_to_determine") diagnostics.push(unableDiagnostic("stair_wall_clear_width_unresolved", "缺少可靠梯段左右结构边界宽度。", flight.locatableObjectIds));
    if (belowStatus === "unable_to_determine") diagnostics.push(unableDiagnostic("stair_handrail_clear_width_unresolved", "扶手数量或突出后的扶手间净宽可能改变结论。", flight.locatableObjectIds));
    if (aboveMargin !== null && isBorderline(aboveMargin, P.stairWidthAboveHandrail.convertedValue)) diagnostics.push(borderlineDiagnostic("stair_width_above_handrail_borderline", "扶手以上净宽接近36 in阈值。", flight.locatableObjectIds, flight.wallClearWidthMeters!, "≥36 in"));
    if (belowMargin !== null && isBorderline(belowMargin, belowThreshold.convertedValue)) diagnostics.push(borderlineDiagnostic("stair_width_below_handrail_borderline", "扶手间净宽接近适用阈值。", flight.locatableObjectIds, belowValue!, `≥${belowThreshold.originalValue} ${belowThreshold.originalUnit}`));
  });
  const status = statusFromSubitems(flightStatuses);
  return result("G2-012", status, status === "pass" ? `${environment.stairClearWidths.length} 个普通梯段在扶手以上和以下均满足适用净宽。` : status === "issue" ? "至少一个普通梯段的可靠净宽低于适用阈值。" : "普通梯段边界已识别，但扶手数量或突出后的净宽仍可能改变结论。", {
    normalizedObjectIds: [...new Set(environment.stairClearWidths.flatMap((flight) => flight.locatableObjectIds))],
    measurements,
    thresholds: [thresholdFrom(P.stairWidthAboveHandrail), thresholdFrom(P.stairWidthOneHandrail), thresholdFrom(P.stairWidthTwoHandrails)],
    diagnostics,
    missingData: diagnostics.filter((item) => item.origin === "insufficient_information").map((item) => `${item.normalizedObjectIds[0]}.${item.code}`),
  });
}

function commonHeadroomMeasurements(room: RoomHeadroomEvidence): RuleResult["measurements"] {
  return [
    { name: "headroomRoomAreaSquareMeters", value: room.roomAreaSquareMeters, unit: "m²", normalizedObjectId: room.roomId, measurementBasis: "derived", assumptions: room.assumptions, confidence: room.confidence },
    { name: "headroomCeilingCoverageRatio", value: room.coverageRatio, unit: "ratio", normalizedObjectId: room.roomId, measurementBasis: "derived", assumptions: room.assumptions, confidence: room.confidence, lowerBound: room.coverageRatio, upperBound: 1 },
    { name: "headroomUncoveredAreaSquareMeters", value: room.uncoveredAreaSquareMeters, unit: "m²", normalizedObjectId: room.roomId, measurementBasis: "derived", assumptions: room.assumptions, confidence: room.confidence },
    { name: "minimumMappedHeadroomMeters", value: room.minimumMappedHeightMeters, unit: "m", normalizedObjectId: room.roomId, measurementBasis: "explicit", assumptions: room.assumptions, confidence: room.confidence },
    ...room.heightRegions.map((region) => ({ name: "headroomHeightRegionSquareMeters", value: region.areaWithinRoomSquareMeters, unit: "m²", normalizedObjectId: region.ceilingId, measurementBasis: region.measurementBasis, assumptions: [`Ceiling.height=${region.heightMeters}m`], confidence: room.confidence })),
  ];
}

export function evaluateG2016(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-016", environment.context); if (gate) return gate;
  const applicable = environment.headroom.rooms.filter((room) => room.use === "habitable");
  if (!applicable.length) return result("G2-016", "not_applicable", "项目中没有可靠识别的habitable Room。", {
    applicability: { status: "not_applicable", reasons: ["无habitable Room"] },
    thresholds: [thresholdFrom(P.habitableMinimumHeadroom), thresholdFrom(P.slopedHabitableCountableMinimumHeadroom), thresholdFrom(P.slopedHabitableMinimumCompliantRatio)],
  });
  const diagnostics: RuleDiagnostic[] = [], measurements: RuleResult["measurements"] = [], statuses: RuleStatus[] = [];
  applicable.forEach((room) => {
    measurements.push(...commonHeadroomMeasurements(room));
    const sevenArea = headroomAreaAtOrAbove(room, P.habitableMinimumHeadroom.convertedValue);
    const fiveArea = headroomAreaAtOrAbove(room, P.slopedHabitableCountableMinimumHeadroom.convertedValue);
    const tolerance = Math.max(.01, room.roomAreaSquareMeters * .02);
    let status: RuleStatus;
    if (room.slopedCeiling) {
      const denominatorWorst = fiveArea + room.uncoveredAreaSquareMeters;
      const lowerRatio = denominatorWorst > 0 ? sevenArea / denominatorWorst : 0;
      const upperRatio = denominatorWorst > 0 ? (sevenArea + room.uncoveredAreaSquareMeters) / denominatorWorst : 0;
      status = upperRatio + 1e-9 < P.slopedHabitableMinimumCompliantRatio.convertedValue ? "issue"
        : lowerRatio + 1e-9 >= P.slopedHabitableMinimumCompliantRatio.convertedValue && !room.overlappingHeightEvidence ? "pass"
        : "unable_to_determine";
      measurements.push(
        { name: "slopedHeadroomAreaAtLeast7FtSquareMeters", value: sevenArea, unit: "m²", normalizedObjectId: room.roomId, measurementBasis: "derived", assumptions: room.assumptions, confidence: room.confidence },
        { name: "slopedCountableAreaAtLeast5FtSquareMeters", value: fiveArea, unit: "m²", normalizedObjectId: room.roomId, measurementBasis: "derived", assumptions: room.assumptions, confidence: room.confidence },
        { name: "slopedCompliantAreaRatioLowerBound", value: lowerRatio, unit: "ratio", normalizedObjectId: room.roomId, measurementBasis: "derived", assumptions: room.assumptions, confidence: room.confidence, thresholdValue: P.slopedHabitableMinimumCompliantRatio.convertedValue, margin: lowerRatio - P.slopedHabitableMinimumCompliantRatio.convertedValue, lowerBound: lowerRatio, upperBound: upperRatio },
        { name: "slopedCompliantAreaRatioUpperBound", value: upperRatio, unit: "ratio", normalizedObjectId: room.roomId, measurementBasis: "derived", assumptions: room.assumptions, confidence: room.confidence, thresholdValue: P.slopedHabitableMinimumCompliantRatio.convertedValue },
      );
      if (status === "issue") diagnostics.push(issueDiagnostic("sloped_habitable_headroom_ratio_below_minimum", "即使把未知覆盖区全部按最好情况计入，达到7 ft的面积比例仍低于50%。", [room.roomId, ...room.heightRegions.map((region) => region.ceilingId)], upperRatio, "≥50%"));
      else if (status === "unable_to_determine") diagnostics.push(unableDiagnostic("sloped_habitable_headroom_ratio_crosses_threshold", "坡顶已知区域与未知覆盖区形成的面积比例上下界跨越50%。", [room.roomId, ...room.heightRegions.map((region) => region.ceilingId)]));
    } else {
      const knownLowArea = Math.max(0, room.coveredAreaSquareMeters - sevenArea);
      status = knownLowArea > tolerance ? "issue" : room.uncoveredAreaSquareMeters > tolerance || room.overlappingHeightEvidence ? "unable_to_determine" : "pass";
      measurements.push({ name: "habitableAreaBelow7FtSquareMeters", value: knownLowArea, unit: "m²", normalizedObjectId: room.roomId, measurementBasis: "derived", assumptions: room.assumptions, confidence: room.confidence, thresholdValue: 0, margin: -knownLowArea });
      if (status === "issue") diagnostics.push(issueDiagnostic("habitable_headroom_below_7ft", "可靠Ceiling区域的完成净高低于7 ft。", [room.roomId, ...room.heightRegions.map((region) => region.ceilingId)], room.minimumMappedHeightMeters ?? undefined, "≥7 ft"));
      else if (status === "unable_to_determine") diagnostics.push(unableDiagnostic("habitable_headroom_coverage_unresolved", "Ceiling未覆盖区或重叠高度证据可能改变净高结论。", [room.roomId, ...room.heightRegions.map((region) => region.ceilingId)]));
    }
    statuses.push(status);
  });
  const status = statusFromSubitems(statuses);
  return result("G2-016", status, status === "pass" ? `${applicable.length} 个habitable Room的完成净高证据均满足适用要求。` : status === "issue" ? "至少一个habitable Room的可靠净高或坡顶面积比例不符合规范。" : "至少一个habitable Room的Ceiling覆盖或坡顶面积比例上下界仍可能改变结论。", {
    normalizedObjectIds: applicable.map((room) => room.roomId),
    measurements,
    thresholds: [thresholdFrom(P.habitableMinimumHeadroom), thresholdFrom(P.slopedHabitableCountableMinimumHeadroom), thresholdFrom(P.slopedHabitableMinimumCompliantRatio)],
    diagnostics,
    missingData: diagnostics.filter((item) => item.origin === "insufficient_information").map((item) => `${item.normalizedObjectIds[0]}.${item.code}`),
  });
}

const nonhabitableHeadroomParameter = (use: HeadroomRoomUse) =>
  use === "kitchen" || use === "hallway" ? P.kitchenHallwayMinimumHeadroom
    : use === "bathroom" || use === "toilet_room" || use === "laundry" ? P.bathToiletLaundryMinimumHeadroom
      : use === "basement_nonhabitable" ? P.nonhabitableBasementMinimumHeadroom : null;

export function evaluateG2017(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-017", environment.context); if (gate) return gate;
  const applicable = environment.headroom.rooms.filter((room) => nonhabitableHeadroomParameter(room.use));
  if (!applicable.length) return result("G2-017", "not_applicable", "项目中没有本规则适用的Kitchen、Bathroom、Laundry、Hallway或非居住地下室空间。", {
    applicability: { status: "not_applicable", reasons: ["无适用非居住或交通空间"] },
    thresholds: [thresholdFrom(P.kitchenHallwayMinimumHeadroom), thresholdFrom(P.bathToiletLaundryMinimumHeadroom), thresholdFrom(P.nonhabitableBasementMinimumHeadroom), thresholdFrom(P.basementObstructionMinimumHeadroom), thresholdFrom(P.showerHeadroomRegionMinimumSide)],
  });
  const diagnostics: RuleDiagnostic[] = [], measurements: RuleResult["measurements"] = [], statuses: RuleStatus[] = [];
  applicable.forEach((room) => {
    const parameter = nonhabitableHeadroomParameter(room.use)!;
    const qualifiedArea = headroomAreaAtOrAbove(room, parameter.convertedValue);
    const knownLowArea = Math.max(0, room.coveredAreaSquareMeters - qualifiedArea);
    const tolerance = Math.max(.01, room.roomAreaSquareMeters * .02);
    let roomStatus: RuleStatus = knownLowArea > tolerance ? "issue" : room.uncoveredAreaSquareMeters > tolerance || room.overlappingHeightEvidence ? "unable_to_determine" : "pass";
    measurements.push(...commonHeadroomMeasurements(room), {
      name: "nonhabitableHeadroomApplicableThresholdMeters", value: parameter.convertedValue, unit: "m", normalizedObjectId: room.roomId, measurementBasis: "explicit", confidence: "high", thresholdValue: parameter.convertedValue,
    }, {
      name: "nonhabitableAreaBelowThresholdSquareMeters", value: knownLowArea, unit: "m²", normalizedObjectId: room.roomId, measurementBasis: "derived", assumptions: room.assumptions, confidence: room.confidence,
    });
    if (roomStatus === "issue") diagnostics.push(issueDiagnostic("nonhabitable_room_headroom_below_minimum", "可靠Ceiling区域的完成净高低于该空间适用阈值。", [room.roomId, ...room.heightRegions.map((region) => region.ceilingId)], room.minimumMappedHeightMeters ?? undefined, `≥${parameter.originalValue} ${parameter.originalUnit}`));
    else if (roomStatus === "unable_to_determine") diagnostics.push(unableDiagnostic("nonhabitable_room_headroom_coverage_unresolved", "Room整体净高子项已有部分证据，但Ceiling覆盖缺口可能改变结论。", [room.roomId, ...room.heightRegions.map((region) => region.ceilingId)]));

    const showerHeads = environment.requiredFixtures.showerHeads.filter((fixture) => fixture.roomRegionId === room.roomId);
    showerHeads.forEach((fixture) => {
      const override = environment.context.showerLocalHeadroomOverrides?.[fixture.objectId];
      let localStatus: RuleStatus = "unable_to_determine";
      if (override?.reliable && Number.isFinite(override.heightMeters) && Number.isFinite(override.regionSideMeters)) {
        localStatus = override.heightMeters! + 1e-9 < P.bathToiletLaundryMinimumHeadroom.convertedValue || override.regionSideMeters! + 1e-9 < P.showerHeadroomRegionMinimumSide.convertedValue ? "issue" : "pass";
        measurements.push(
          { name: "showerLocalHeadroomMeters", value: override.heightMeters, unit: "m", normalizedObjectId: fixture.objectId, measurementBasis: "explicit", assumptions: [`局部区域来源：${override.source}`], confidence: "high", thresholdValue: P.bathToiletLaundryMinimumHeadroom.convertedValue, margin: override.heightMeters! - P.bathToiletLaundryMinimumHeadroom.convertedValue },
          { name: "showerHeadroomRegionSideMeters", value: override.regionSideMeters, unit: "m", normalizedObjectId: fixture.objectId, measurementBasis: "explicit", assumptions: [`局部区域来源：${override.source}`], confidence: "high", thresholdValue: P.showerHeadroomRegionMinimumSide.convertedValue, margin: override.regionSideMeters! - P.showerHeadroomRegionMinimumSide.convertedValue },
        );
      } else {
        const centerCovered = Boolean(fixture.centerPoint && room.heightRegions.some((region) => pointInMultiPolygon(fixture.centerPoint!, region.polygons)));
        const uniformCompleteCeiling = room.coverageRatio >= 1 - 1e-7 && !room.multipleHeightRegions && !room.overlappingHeightEvidence;
        const uniformHeight = uniformCompleteCeiling ? room.minimumMappedHeightMeters : null;
        if (fixture.centerInsideRoom && centerCovered && uniformHeight !== null) {
          localStatus = uniformHeight + 1e-9 >= P.bathToiletLaundryMinimumHeadroom.convertedValue ? "pass" : "issue";
          measurements.push(
            { name: "showerheadCenterInsideRoom", value: true, normalizedObjectId: fixture.objectId, measurementBasis: "derived", confidence: fixture.confidence },
            { name: "showerheadCenterInsideCeilingCoverage", value: true, normalizedObjectId: fixture.objectId, measurementBasis: "derived", confidence: room.confidence },
            { name: "showerLocalHeadroomMeters", value: uniformHeight, unit: "m", normalizedObjectId: fixture.objectId, measurementBasis: "derived", assumptions: ["Showerhead中心位于Room及统一高度Ceiling覆盖内；Room 100%统一净高为该30 in×30 in局部区域提供下界"], confidence: room.confidence, thresholdValue: P.bathToiletLaundryMinimumHeadroom.convertedValue, margin: uniformHeight - P.bathToiletLaundryMinimumHeadroom.convertedValue },
          );
        } else measurements.push({ name: "showerLocalHeadroomStatus", value: "unable_to_determine", normalizedObjectId: fixture.objectId, measurementBasis: "derived", assumptions: ["Showerhead局部区域无法由统一完整Ceiling下界覆盖；需要可靠局部30 in×30 in区域或高度证据"], confidence: "low" });
      }
      if (localStatus === "issue") diagnostics.push(issueDiagnostic("shower_local_headroom_noncompliant", "淋浴喷头处可靠局部净高或30 in×30 in区域不符合要求。", [fixture.objectId, room.roomId]));
      if (localStatus === "unable_to_determine") diagnostics.push(unableDiagnostic("shower_local_headroom_region_unresolved", "已识别Showerhead，但缺少可靠30 in×30 in测量区域及其Ceiling覆盖。", [fixture.objectId, room.roomId]));
      roomStatus = statusFromSubitems([roomStatus, localStatus]);
    });
    statuses.push(roomStatus);
  });
  const status = statusFromSubitems(statuses);
  return result("G2-017", status, status === "pass" ? `${applicable.length} 个适用非居住/交通空间及可识别局部区域均满足净高要求。` : status === "issue" ? "至少一个适用Room或洁具上方局部区域的可靠净高不符合规范。" : "Room整体净高已分别评价，但至少一个淋浴局部区域或Ceiling覆盖仍无法可靠建立。", {
    normalizedObjectIds: [...new Set([...applicable.map((room) => room.roomId), ...environment.requiredFixtures.showerHeads.map((item) => item.objectId)])],
    measurements,
    thresholds: [thresholdFrom(P.kitchenHallwayMinimumHeadroom), thresholdFrom(P.bathToiletLaundryMinimumHeadroom), thresholdFrom(P.nonhabitableBasementMinimumHeadroom), thresholdFrom(P.basementObstructionMinimumHeadroom), thresholdFrom(P.showerHeadroomRegionMinimumSide)],
    diagnostics,
    missingData: diagnostics.filter((item) => item.origin === "insufficient_information").map((item) => `${item.normalizedObjectIds[0]}.${item.code}`),
  });
}

const requiredFixtureParameters: Array<[RequiredFixtureKind, typeof P.dwellingMinimumWaterClosetCount]> = [
  ["water_closet", P.dwellingMinimumWaterClosetCount],
  ["lavatory", P.dwellingMinimumLavatoryCount],
  ["bathing_fixture", P.dwellingMinimumBathingFixtureCount],
  ["kitchen_sink", P.dwellingMinimumKitchenSinkCount],
];

export function evaluateG2019(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-019", environment.context); if (gate) return gate;
  if (!["detached_dwelling", "dwelling_unit"].includes(environment.context.projectUse)) return result("G2-019", "not_applicable", "当前评价范围不构成完整独立住宅或住宅单元。", {
    applicability: { status: "not_applicable", reasons: ["非完整住宅单元范围"] },
    thresholds: requiredFixtureParameters.map(([, parameter]) => thresholdFrom(parameter)),
  });
  const analysis = environment.requiredFixtures, diagnostics: RuleDiagnostic[] = [], measurements: RuleResult["measurements"] = [], statuses: RuleStatus[] = [];
  const bathroomRoomIds = environment.headroom.rooms.filter((room) => ["bathroom", "toilet_room"].includes(room.use)).map((room) => room.roomId);
  const kitchenRoomIds = environment.headroom.rooms.filter((room) => room.use === "kitchen" || room.use === "habitable" && roomNames(environment.handoff, environment.rooms, environment.rooms.rooms.find((candidate) => candidate.roomRegionId === room.roomId)!).some((name) => /KITCHEN/i.test(name))).map((room) => room.roomId);
  requiredFixtureParameters.filter(([kind]) => kind !== "kitchen_sink").forEach(([kind, parameter]) => {
    const fixtures = analysis.fixtures.filter((fixture) => fixture.kind === kind), count = fixtures.length;
    const sinkSemanticCanChange = ["lavatory", "kitchen_sink"].includes(kind) && analysis.unresolvedObjectIds.length > 0;
    const status: RuleStatus = count >= parameter.convertedValue ? "pass" : analysis.inventoryReliable && !sinkSemanticCanChange ? "issue" : "unable_to_determine";
    statuses.push(status);
    measurements.push(
      { name: `${kind}Count`, value: count, unit: "count", measurementBasis: "derived", assumptions: analysis.assumptions, confidence: status === "unable_to_determine" ? "low" : "high", thresholdValue: parameter.convertedValue, margin: count - parameter.convertedValue },
      { name: `${kind}SubitemStatus`, value: status, measurementBasis: "derived", assumptions: analysis.assumptions, confidence: status === "unable_to_determine" ? "low" : "high" },
      ...fixtures.map((fixture) => ({ name: `${kind}Object`, value: fixture.objectId, normalizedObjectId: fixture.objectId, measurementBasis: fixture.measurementBasis, assumptions: fixture.assumptions, confidence: fixture.confidence } as const)),
    );
    if (status === "issue") {
      diagnostics.push(issueDiagnostic(`dwelling_required_${kind}_missing`, `完整住宅单元的可靠对象清单中缺少法定${parameter.name}。`, bathroomRoomIds, count, `≥${parameter.originalValue} ${parameter.originalUnit}`));
    } else if (status === "unable_to_determine") diagnostics.push(unableDiagnostic(`dwelling_required_${kind}_unresolved`, `现有对象语义或清单完整性不足以确认${parameter.name}是否确实缺失。`, [...analysis.unresolvedObjectIds]));
  });
  const kitchenParameter = P.dwellingMinimumKitchenSinkCount;
  const candidateKitchenSinks = analysis.fixtures.filter((fixture) => fixture.kind === "kitchen_sink");
  const unassociatedKitchenSinks = analysis.kitchenSinkAssociations.filter((sink) => sink.associatedKitchenAreaIds.length === 0);
  analysis.kitchenSinkAssociations.filter((sink) => sink.conflictReason && sink.associatedKitchenAreaIds.length > 0).forEach((sink) => diagnostics.push({ severity: "warning", code: "kitchen_sink_room_zone_conflict_resolved", message: sink.conflictReason!, normalizedObjectIds: [sink.objectId, ...sink.associatedKitchenAreaIds], origin: "rule", recommendation: "已按可靠Kitchen Zone关联；建议在图中复核Room与Zone标注。" }));
  measurements.push(
    { name: "kitchen_sinkCount", value: candidateKitchenSinks.length, unit: "count", measurementBasis: "derived", assumptions: analysis.assumptions, confidence: "high", thresholdValue: kitchenParameter.convertedValue, margin: candidateKitchenSinks.length - kitchenParameter.convertedValue },
    ...candidateKitchenSinks.map((fixture) => ({ name: "kitchen_sinkObject", value: fixture.objectId, normalizedObjectId: fixture.objectId, measurementBasis: fixture.measurementBasis, assumptions: fixture.assumptions, confidence: fixture.confidence } as const)),
  );
  if (!analysis.kitchenAreas.length) {
    const kitchenStatus: RuleStatus = candidateKitchenSinks.length && unassociatedKitchenSinks.length ? "unable_to_determine" : analysis.inventoryReliable ? "issue" : "unable_to_determine";
    statuses.push(kitchenStatus);
    measurements.push({ name: "kitchenAreaCount", value: 0, unit: "count", measurementBasis: "derived", assumptions: analysis.assumptions, confidence: kitchenStatus === "unable_to_determine" ? "low" : "high" }, { name: "kitchen_sinkSubitemStatus", value: kitchenStatus, measurementBasis: "derived", assumptions: analysis.assumptions, confidence: kitchenStatus === "unable_to_determine" ? "low" : "high" });
    if (kitchenStatus === "issue") diagnostics.push(issueDiagnostic("dwelling_required_kitchen_area_missing", "完整住宅单元中未识别可靠Kitchen Area或其法定厨房水槽。", kitchenRoomIds, 0, `≥${kitchenParameter.originalValue} ${kitchenParameter.originalUnit}`));
    else diagnostics.push(unableDiagnostic("dwelling_required_kitchen_area_unresolved", "Kitchen Sink资产存在，但无法确认其服务的Kitchen Area。", unassociatedKitchenSinks.map((sink) => sink.objectId)));
  } else {
    analysis.kitchenAreas.forEach((area) => {
      const associated = analysis.kitchenSinkAssociations.filter((sink) => sink.associatedKitchenAreaIds.includes(area.areaId));
      const conflicting = analysis.unresolvedObjectIds.length > 0 || unassociatedKitchenSinks.some((sink) => sink.associationBasis === "unresolved");
      const kitchenStatus: RuleStatus = associated.length >= kitchenParameter.convertedValue ? "pass" : analysis.inventoryReliable && !conflicting ? "issue" : "unable_to_determine";
      statuses.push(kitchenStatus);
      measurements.push(
        { name: "kitchenArea", value: area.name, normalizedObjectId: area.zoneId ?? area.roomRegionId ?? undefined, measurementBasis: "explicit", confidence: "high" },
        { name: "kitchenAreaSinkCount", value: associated.length, unit: "count", normalizedObjectId: area.zoneId ?? area.roomRegionId ?? undefined, measurementBasis: "derived", assumptions: associated.map((sink) => `${sink.objectId}:${sink.associationBasis}`), confidence: kitchenStatus === "unable_to_determine" ? "low" : "high", thresholdValue: kitchenParameter.convertedValue, margin: associated.length - kitchenParameter.convertedValue },
        { name: "kitchenAreaSubitemStatus", value: kitchenStatus, normalizedObjectId: area.zoneId ?? area.roomRegionId ?? undefined, measurementBasis: "derived", confidence: kitchenStatus === "unable_to_determine" ? "low" : "high" },
      );
      if (kitchenStatus === "issue") diagnostics.push(issueDiagnostic("dwelling_required_kitchen_sink_missing", `${area.name}没有可靠关联的厨房水槽。`, [area.zoneId ?? area.roomRegionId ?? area.areaId], associated.length, `≥${kitchenParameter.originalValue} ${kitchenParameter.originalUnit}`));
      else if (kitchenStatus === "unable_to_determine") diagnostics.push(unableDiagnostic("dwelling_required_kitchen_sink_area_unresolved", `${area.name}附近存在未关联的Kitchen Sink资产，空间归属冲突可能改变结论。`, [area.zoneId ?? area.roomRegionId ?? area.areaId, ...unassociatedKitchenSinks.map((sink) => sink.objectId)]));
    });
    measurements.push({ name: "kitchenAreaCount", value: analysis.kitchenAreas.length, unit: "count", measurementBasis: "derived", assumptions: analysis.assumptions, confidence: "high" }, ...analysis.kitchenSinkAssociations.map((sink) => ({ name: "kitchenSinkAreaAssociation", value: sink.associationBasis, normalizedObjectId: sink.objectId, measurementBasis: "derived" as const, assumptions: [sink.conflictReason ?? `关联Kitchen Area: ${sink.associatedKitchenAreaIds.join(", ") || "无"}`], confidence: sink.associatedKitchenAreaIds.length ? "high" as const : "low" as const })));
  }
  const status = statusFromSubitems(statuses);
  return result("G2-019", status, status === "pass" ? "住宅单元已可靠识别至少1个坐便器、1个洗面盆、1个浴缸或淋浴以及1个厨房水槽。" : status === "issue" ? "完整住宅单元的可靠对象清单明确缺少至少一类法定设施。" : "至少一类法定设施的对象语义或项目清单完整性仍不足。", {
    normalizedObjectIds: analysis.fixtures.map((fixture) => fixture.objectId),
    pascalSourceIds: analysis.fixtures.map((fixture) => fixture.pascalSourceId),
    measurements,
    thresholds: requiredFixtureParameters.map(([, parameter]) => thresholdFrom(parameter)),
    diagnostics,
    missingData: diagnostics.filter((item) => item.origin === "insufficient_information").map((item) => item.code),
    confidence: { level: status === "unable_to_determine" ? "low" : "high", score: status === "unable_to_determine" ? .35 : .95, reasons: analysis.assumptions },
  });
}

export function evaluateG2020(environment: RuleEnvironment): RuleResult {
  const gate = projectGate("G2-020", environment.context); if (gate) return gate;
  const analysis = environment.showerCompartments;
  const thresholds = [thresholdFrom(P.showerCompartmentMinimumInteriorArea), thresholdFrom(P.showerCompartmentMinimumInscribedCircle), thresholdFrom(P.showerCompartmentMaintainedHeight), thresholdFrom(P.showerReceptorExceptionMinimumWidth), thresholdFrom(P.showerReceptorExceptionMinimumLength)];
  if (!analysis.compartments.length) return result("G2-020", "not_applicable", "未识别独立 Shower Compartment；Showerhead或Bathtub本身不触发本规则。", {
    normalizedObjectIds: [...analysis.showerheadObjectIds, ...analysis.bathtubObjectIds], thresholds,
    applicability: { status: "not_applicable", reasons: ["无可靠独立淋浴间；未把Showerhead或Bathtub推定为淋浴间"] },
    measurements: [{ name: "showerCompartmentCount", value: 0, unit: "count", measurementBasis: "derived", assumptions: analysis.assumptions, confidence: "high" }, { name: "showerheadOnlyCount", value: analysis.showerheadObjectIds.length, unit: "count", measurementBasis: "derived", confidence: "high" }, { name: "bathtubCount", value: analysis.bathtubObjectIds.length, unit: "count", measurementBasis: "derived", confidence: "high" }],
  });
  const statuses: RuleStatus[] = [], diagnostics: RuleDiagnostic[] = [], measurements: RuleResult["measurements"] = [];
  for (const item of analysis.compartments) {
    const ids = item.locatableObjectIds, polygon = item.finishedInteriorPolygon;
    const outerPolygonArea = item.outerFootprint ? Math.abs(item.outerFootprint.reduce((sum, point, index, ring) => { const next = ring[(index + 1) % ring.length]!; return sum + point[0] * next[1] - next[0] * point[1]; }, 0)) / 2 : null;
    const exceptionWidth = item.exception2.widthMeters, exceptionLength = item.exception2.lengthMeters;
    const exceptionComplete = item.exception2.requested && exceptionWidth !== null && exceptionLength !== null;
    const exceptionPass = exceptionComplete && exceptionWidth! + 1e-9 >= P.showerReceptorExceptionMinimumWidth.convertedValue && exceptionLength! + 1e-9 >= P.showerReceptorExceptionMinimumLength.convertedValue;
    const exceptionStatus: RuleStatus = !item.exception2.requested || !exceptionPass && exceptionComplete ? "not_applicable" : !exceptionComplete ? "unable_to_determine" : "pass";
    let areaStatus: RuleStatus, circleStatus: RuleStatus;
    if (exceptionPass) { areaStatus = "not_applicable"; circleStatus = "not_applicable"; }
    else {
      areaStatus = item.finishedInteriorAreaSquareMeters !== null ? item.finishedInteriorAreaSquareMeters + 1e-9 >= P.showerCompartmentMinimumInteriorArea.convertedValue ? "pass" : "issue" : outerPolygonArea !== null && outerPolygonArea + 1e-9 < P.showerCompartmentMinimumInteriorArea.convertedValue ? "issue" : "unable_to_determine";
      const witness = polygon ? findInscribedCircle(polygon, P.showerCompartmentMinimumInscribedCircle.convertedValue) : null;
      circleStatus = polygon ? witness!.fits ? "pass" : "issue" : item.maximumInscribedCircleDiameterMeters !== null && item.maximumInscribedCircleDiameterMeters + 1e-9 < P.showerCompartmentMinimumInscribedCircle.convertedValue ? "issue" : "unable_to_determine";
      if (exceptionStatus === "unable_to_determine" && (areaStatus === "issue" || circleStatus === "issue")) { areaStatus = "unable_to_determine"; circleStatus = "unable_to_determine"; }
    }
    const heightStatus = item.headroom.status;
    const objectStatus = statusFromSubitems([areaStatus, circleStatus, exceptionStatus, heightStatus]); statuses.push(objectStatus);
    const record = (name: string, value: number | string | null, status: RuleStatus, threshold: number | null, unit?: string) => measurements.push({ name, value, unit, normalizedObjectId: item.showerId, measurementBasis: item.measurementBasis, assumptions: [...item.assumptions, item.headroom.source], confidence: status === "unable_to_determine" ? "low" : item.confidence, thresholdValue: threshold ?? undefined, margin: typeof value === "number" && threshold !== null ? value - threshold : null });
    measurements.push({ name: "showerCompartment", value: item.showerId, normalizedObjectId: item.showerId, measurementBasis: item.measurementBasis, assumptions: item.assumptions, confidence: item.confidence }, { name: "showerCompartmentRoom", value: item.roomRegionId ?? "unresolved", normalizedObjectId: item.showerId, measurementBasis: "derived", confidence: item.roomRegionId ? item.confidence : "low" });
    record("finishedInteriorAreaSquareMeters", item.finishedInteriorAreaSquareMeters ?? outerPolygonArea, areaStatus, P.showerCompartmentMinimumInteriorArea.convertedValue, "m²");
    record("maximumInscribedCircleDiameterMeters", item.maximumInscribedCircleDiameterMeters, circleStatus, P.showerCompartmentMinimumInscribedCircle.convertedValue, "m");
    record("exception2WidthMeters", exceptionWidth, exceptionStatus, P.showerReceptorExceptionMinimumWidth.convertedValue, "m"); record("exception2LengthMeters", exceptionLength, exceptionStatus, P.showerReceptorExceptionMinimumLength.convertedValue, "m");
    record("maintainedHeightMeters", item.headroom.minimumHeightMeters, heightStatus, P.showerCompartmentMaintainedHeight.convertedValue, "m");
    [ ["area", areaStatus], ["inscribedCircle", circleStatus], ["exception2", exceptionStatus], ["maintainedHeight", heightStatus] ].forEach(([name, status]) => measurements.push({ name: `showerCompartment${name[0]!.toUpperCase()}${name.slice(1)}Status`, value: status, normalizedObjectId: item.showerId, measurementBasis: "derived", confidence: status === "unable_to_determine" ? "low" : item.confidence }));
    if (objectStatus === "issue") diagnostics.push(issueDiagnostic("shower_compartment_dimension_noncompliant", "该独立淋浴间的完成内部尺寸、接水盘例外或70 in维持高度存在可靠不符合项。", ids));
    else if (objectStatus === "unable_to_determine") diagnostics.push(unableDiagnostic("shower_compartment_finished_interior_unresolved", `已确认独立淋浴间及其${item.headroom.status === "pass" ? "70 in净高通过" : "局部净高证据"}；但缺少完成内部轮廓或适用接水盘内边界，面积、30 in内接圆或30×60 in例外可能改变结论。`, ids, "补充 finishedInteriorPolygon，或提供可靠接水盘产品的完成内边界及30×60 in整体尺寸；在补齐前，可将固定围合按至少30 in内接圆和900 in²完成内部空间复核以规避风险。"));
  }
  const status = statusFromSubitems(statuses);
  return result("G2-020", status, status === "pass" ? "所有可靠独立淋浴间均满足完成内部面积、30 in内接圆（或适用接水盘例外）及70 in维持高度。" : status === "issue" ? "至少一个独立淋浴间存在可靠法定尺寸或高度不足。" : "已识别独立淋浴间，但至少一个关键完成内部轮廓、例外或Ceiling证据可能改变结论。", {
    normalizedObjectIds: [...new Set(analysis.compartments.flatMap((item) => item.locatableObjectIds))], thresholds, measurements, diagnostics,
    missingData: diagnostics.filter((item) => item.origin === "insufficient_information").map((item) => item.code),
    confidence: { level: status === "unable_to_determine" ? "low" : analysis.compartments.every((item) => item.confidence === "high") ? "high" : "medium", score: status === "unable_to_determine" ? .35 : .75, reasons: analysis.assumptions },
  });
}

export function buildG2RuleEnvironment(handoff: EvaluationHandoff, context: G2EvaluationContext): RuleEnvironment {
  const rooms = buildRoomRegionAnalysis(handoff), graph = buildRoomConnectivityGraph(handoff, rooms);
  const stairs = analyzeStairMeasurements(handoff);
  const base = {
    handoff, context, rooms, graph, stairs,
    eero: { rooms: [], candidates: [] },
    spiralStairs: [],
    stairClearWidths: [],
    stairLandings: [],
    showerCompartments: { compartments: [], showerheadObjectIds: [], bathtubObjectIds: [], assumptions: [] },
    headroom: { rooms: [] },
    requiredFixtures: { fixtures: [], counts: { water_closet: 0, lavatory: 0, bathing_fixture: 0, kitchen_sink: 0 }, unresolvedObjectIds: [], showerHeads: [], kitchenAreas: [], kitchenSinkAssociations: [], inventoryReliable: false, assumptions: [], missingData: [] },
  } as RuleEnvironment;
  base.spiralStairs = analyzeSpiralStairs(handoff, stairs, { spiralOverrides: context.spiralStairOverrides });
  base.stairClearWidths = analyzeOrdinaryStairClearWidths(handoff, { ordinaryFlightOverrides: context.ordinaryStairFlightOverrides });
  base.stairLandings = analyzeStairLandings(handoff, rooms, P.straightStairLandingMinimumDepth.convertedValue);
  const roomUses = Object.fromEntries(rooms.rooms.map((room) => [room.roomRegionId, headroomUseOf(base, room)]));
  base.headroom = buildRoomHeadroomAnalysis(handoff, rooms, { roomUses, slopedRoomIds: context.slopedHeadroomRoomIds });
  base.showerCompartments = buildShowerCompartmentAnalysis(handoff, base.headroom, P.showerCompartmentMaintainedHeight.convertedValue, P.showerCompartmentMinimumInscribedCircle.convertedValue, context.showerCompartmentOverrides);
  base.requiredFixtures = buildDwellingRequiredFixtureAnalysis(handoff, rooms, context.fixtureInventoryCompleteness === "complete");
  const requiredRooms = eeroRequiredRooms(base).filter((room) => !(context.eeroExemptRoomIds ?? []).includes(room.roomRegionId));
  base.eero = buildEeroCandidateAnalysis(handoff, rooms, graph, requiredRooms, { explicitMeasurements: context.explicitEeroOpeningMeasurements, gradeFloorStatusByOpeningId: context.eeroGradeFloorStatusByOpeningId });
  return base;
}

export function evaluateG2TechnicalRules(handoff: EvaluationHandoff, context: G2EvaluationContext) {
  const environment = buildG2RuleEnvironment(handoff, context);
  return [evaluateG2001, evaluateG2002, evaluateG2003, evaluateG2004, evaluateG2005, evaluateG2006, evaluateG2007, evaluateG2008, evaluateG2009, evaluateG2010, evaluateG2011, evaluateG2012, evaluateG2013, evaluateG2014, evaluateG2015, evaluateG2016, evaluateG2017, evaluateG2019, evaluateG2020].map((evaluate) => evaluate(environment));
}
