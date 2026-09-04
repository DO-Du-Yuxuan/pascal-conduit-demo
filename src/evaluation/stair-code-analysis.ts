import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import type { ConfidenceLevel } from "./types";
import type { StairMeasurementAnalysis } from "./stair-measurement";

type EvidenceBasis = "explicit" | "derived";
export type SpiralInnerBoundarySemantic = "tread_inner_edge" | "central_pole_center" | "unknown";
const SPIRAL_WALKLINE_OFFSET_FROM_NARROW_END_METERS = 12 * .0254;

export type SpiralStairOverride = {
  clearWidthMeters?: number | null;
  walklineRadiusMeters?: number | null;
  treadDepthsAtWalklineMeters?: number[] | null;
  headroomMeters?: number | null;
  innerBoundarySemantic?: SpiralInnerBoundarySemantic;
  source: string;
};

export type SpiralStairAnalysis = {
  stairId: string;
  levelIds: string[];
  nominalWidthMeters: number | null;
  clearWidthMeters: number | null;
  clearWidthLowerBoundMeters: number | null;
  clearWidthUpperBoundMeters: number | null;
  innerRadiusMeters: number | null;
  outerRadiusMeters: number | null;
  walklineRadiusMeters: number | null;
  walklineRadiusLowerBoundMeters: number | null;
  walklineRadiusUpperBoundMeters: number | null;
  innerBoundarySemantic: SpiralInnerBoundarySemantic;
  legalWalklineOffsetMeters: number | null;
  treadDepthsAtWalklineMeters: number[] | null;
  minimumTreadDepthAtWalklineMeters: number | null;
  treadDepthLowerBoundMeters: number | null;
  treadDepthUpperBoundMeters: number | null;
  maximumRiserHeightMeters: number | null;
  treadGeometryConsistent: boolean | null;
  headroomMeters: number | null;
  measurementBasis: EvidenceBasis;
  confidence: ConfidenceLevel;
  assumptions: string[];
  missingData: string[];
};

export type StairFlightWidthOverride = {
  flightId: string;
  nominalWidthMeters?: number | null;
  wallClearWidthMeters?: number | null;
  handrailCount?: 0 | 1 | 2 | null;
  handrailClearWidthMeters?: number | null;
  sectionObjectIds?: string[];
  source: string;
};

export type StairClearWidthAnalysis = {
  stairId: string;
  flightId: string;
  levelIds: string[];
  stairType: string;
  nominalWidthMeters: number | null;
  wallClearWidthMeters: number | null;
  handrailCount: 0 | 1 | 2 | null;
  handrailClearWidthMeters: number | null;
  belowHandrailLowerBoundMeters: number | null;
  belowHandrailUpperBoundMeters: number | null;
  measurementBasis: EvidenceBasis;
  confidence: ConfidenceLevel;
  assumptions: string[];
  missingData: string[];
  locatableObjectIds: string[];
};

export type StairCodeAnalysisOptions = {
  spiralOverrides?: Record<string, SpiralStairOverride>;
  ordinaryFlightOverrides?: Record<string, StairFlightWidthOverride[]>;
};

const finitePositive = (value: unknown): value is number => Number.isFinite(value) && Number(value) > 0;
const finitePositiveArray = (value: unknown): value is number[] => Array.isArray(value) && value.length > 0 && value.every(finitePositive);

export function analyzeSpiralStairs(
  handoff: EvaluationHandoff,
  measurements: StairMeasurementAnalysis[],
  options: StairCodeAnalysisOptions = {},
): SpiralStairAnalysis[] {
  const measurementById = new Map(measurements.map((item) => [item.stairId, item]));
  return handoff.stairs.filter((stair) => stair.stairType === "spiral").map((stair) => {
    const base = measurementById.get(stair.id);
    const override = options.spiralOverrides?.[stair.id];
    const extended = stair as typeof stair & {
      clearWidthMeters?: number;
      walklineRadiusMeters?: number;
      treadDepthsAtWalklineMeters?: number[];
      headroomMeters?: number;
    };
    const assumptions: string[] = [];
    const missingData: string[] = [];
    let basis: EvidenceBasis = "derived";
    let confidence: ConfidenceLevel = "medium";

    const nominalWidth = finitePositive(stair.widthMeters) ? stair.widthMeters : null;
    const explicitClearWidth = finitePositive(override?.clearWidthMeters) ? override!.clearWidthMeters!
      : finitePositive(extended.clearWidthMeters) ? extended.clearWidthMeters : null;
    if (explicitClearWidth !== null) {
      basis = "explicit";
      assumptions.push(`螺旋楼梯净宽采用明确测量来源：${override?.source ?? "stair.clearWidthMeters"}`);
    } else {
      assumptions.push("stair.widthMeters仅作为内外模型边界之间的名义宽度上界；缺少扶手实体突出量时不冒充扶手处实际净宽");
      missingData.push(`${stair.id}.clearWidthAtAndBelowHandrail`);
    }

    const innerRadius = finitePositive(stair.innerRadiusMeters) ? stair.innerRadiusMeters : null;
    const outerRadius = innerRadius !== null && nominalWidth !== null ? innerRadius + nominalWidth : null;
    // The plan generator starts each radial tread line at innerRadius and uses that
    // same arc as the inner footprint boundary. It is not the optional centre-column radius.
    const innerBoundarySemantic = override?.innerBoundarySemantic ?? (innerRadius !== null ? "tread_inner_edge" : "unknown");
    const explicitWalkline = finitePositive(override?.walklineRadiusMeters) ? override!.walklineRadiusMeters!
      : finitePositive(extended.walklineRadiusMeters) ? extended.walklineRadiusMeters : null;
    const derivedLegalWalkline = explicitWalkline === null && innerRadius !== null && innerBoundarySemantic === "tread_inner_edge"
      ? innerRadius + SPIRAL_WALKLINE_OFFSET_FROM_NARROW_END_METERS : null;
    const legalWalkline = explicitWalkline ?? derivedLegalWalkline;
    if (explicitWalkline === null && derivedLegalWalkline !== null) {
      assumptions.push("innerRadius在螺旋楼梯几何中是每级踏步的内侧窄端边缘；法规行走线按该边缘外12 in推导，不使用中心箭头或中心柱");
    } else if (explicitWalkline === null) {
      assumptions.push(innerBoundarySemantic === "central_pole_center" ? "innerRadius仅表示中心柱中心，缺少中心柱外缘或踏步内侧窄端边缘，不能定位法规行走线" : "缺少可证明为踏步内侧窄端边缘的半径，不能定位法规行走线");
      missingData.push(`${stair.id}.legalWalklineRadius`);
    } else assumptions.push(`法规行走线半径采用明确来源：${override?.source ?? "stair.walklineRadiusMeters"}`);

    const explicitTreads = finitePositiveArray(override?.treadDepthsAtWalklineMeters) ? override!.treadDepthsAtWalklineMeters!
      : finitePositiveArray(extended.treadDepthsAtWalklineMeters) ? extended.treadDepthsAtWalklineMeters : null;
    const stepAngle = Number.isFinite(stair.sweepAngleRadians) && base?.treadCount ? Math.abs(stair.sweepAngleRadians!) / base.treadCount : null;
    const derivedTreads = !explicitTreads && legalWalkline !== null && stepAngle !== null
      ? Array.from({ length: base!.treadCount! }, () => legalWalkline * stepAngle) : null;
    const treads = explicitTreads ?? derivedTreads;
    const treadLower = treads ? Math.min(...treads) : null;
    const treadUpper = treads ? Math.min(...treads) : null;
    if (!treads) {
      missingData.push(`${stair.id}.treadDepthAtLegalWalkline`);
      assumptions.push("法规行走线位置或每级圆心角不足，不能把内外半径范围冒充行走线处踏面深度");
    }

    const explicitHeadroom = finitePositive(override?.headroomMeters) ? override!.headroomMeters!
      : finitePositive(extended.headroomMeters) ? extended.headroomMeters : null;
    if (explicitHeadroom === null) missingData.push(`${stair.id}.headroomAlongLegalWalkline`);
    else assumptions.push(`净高采用明确来源：${override?.source ?? "stair.headroomMeters"}`);

    const generatedConsistent = stepAngle !== null && Number.isInteger(base?.treadCount);
    if (generatedConsistent) assumptions.push("明确sweepAngle与整数stepCount生成等圆心角踏步，固定半径处踏步深度一致");
    if (!innerRadius || !outerRadius || !stepAngle) confidence = "low";
    if (override) confidence = "high";

    return {
      stairId: stair.id,
      levelIds: [stair.fromLevelId, stair.toLevelId].filter((id): id is string => Boolean(id)),
      nominalWidthMeters: nominalWidth,
      clearWidthMeters: explicitClearWidth,
      clearWidthLowerBoundMeters: explicitClearWidth,
      clearWidthUpperBoundMeters: explicitClearWidth ?? nominalWidth,
      innerRadiusMeters: innerRadius,
      outerRadiusMeters: outerRadius,
      walklineRadiusMeters: legalWalkline,
      walklineRadiusLowerBoundMeters: legalWalkline,
      walklineRadiusUpperBoundMeters: legalWalkline,
      innerBoundarySemantic,
      legalWalklineOffsetMeters: legalWalkline !== null && explicitWalkline === null ? SPIRAL_WALKLINE_OFFSET_FROM_NARROW_END_METERS : null,
      treadDepthsAtWalklineMeters: treads,
      minimumTreadDepthAtWalklineMeters: treads ? Math.min(...treads) : null,
      treadDepthLowerBoundMeters: treadLower,
      treadDepthUpperBoundMeters: treadUpper,
      maximumRiserHeightMeters: base?.maximumRiserHeightMeters ?? null,
      treadGeometryConsistent: generatedConsistent ? true : null,
      headroomMeters: explicitHeadroom,
      measurementBasis: basis,
      confidence,
      assumptions,
      missingData: [...new Set(missingData)],
    };
  });
}

const handrailCountFromMode = (mode: unknown): 0 | 1 | 2 | null => mode === "none" ? 0 : mode === "left" || mode === "right" ? 1 : mode === "both" ? 2 : null;

export function analyzeOrdinaryStairClearWidths(
  handoff: EvaluationHandoff,
  options: StairCodeAnalysisOptions = {},
): StairClearWidthAnalysis[] {
  return handoff.stairs.filter((stair) => !/spiral|curved|winder|alternat|ship|ladder/i.test(stair.stairType)).flatMap((stair) => {
    const extended = stair as typeof stair & {
      wallClearWidthMeters?: number;
      handrailCount?: 0 | 1 | 2;
      handrailClearWidthMeters?: number;
      railingMode?: string;
    };
    const overrides = options.ordinaryFlightOverrides?.[stair.id];
    const sourceFlights: StairFlightWidthOverride[] = overrides?.length ? overrides : [{
      flightId: `${stair.id}-flight-1`,
      nominalWidthMeters: stair.widthMeters,
      wallClearWidthMeters: extended.wallClearWidthMeters,
      handrailCount: extended.handrailCount ?? handrailCountFromMode(extended.railingMode),
      handrailClearWidthMeters: extended.handrailClearWidthMeters,
      sectionObjectIds: [stair.id],
      source: "StairMeasurementAnalysis",
    }];
    return sourceFlights.map((flight) => {
      const nominal = finitePositive(flight.nominalWidthMeters) ? flight.nominalWidthMeters! : finitePositive(stair.widthMeters) ? stair.widthMeters : null;
      const explicitWall = finitePositive(flight.wallClearWidthMeters) ? flight.wallClearWidthMeters! : null;
      const wall = explicitWall ?? nominal;
      const count = flight.handrailCount === 0 || flight.handrailCount === 1 || flight.handrailCount === 2 ? flight.handrailCount : null;
      const explicitHandrail = finitePositive(flight.handrailClearWidthMeters) ? flight.handrailClearWidthMeters! : null;
      const assumptions: string[] = [];
      const missingData: string[] = [];
      let basis: EvidenceBasis = explicitWall || explicitHandrail || overrides?.length ? "explicit" : "derived";
      let confidence: ConfidenceLevel = explicitWall ? "high" : nominal ? "medium" : "low";
      if (!explicitWall && nominal) assumptions.push("stair.widthMeters作为模型梯段左右结构边界间宽度；不使用轴对齐bounding box");
      if (!wall) missingData.push(`${flight.flightId}.wallClearWidth`);
      if (count === null) {
        missingData.push(`${flight.flightId}.handrailCount`);
        assumptions.push("扶手对象缺失不解释为没有扶手");
        confidence = "low";
      }
      if (count !== null && count > 0 && explicitHandrail === null) {
        missingData.push(`${flight.flightId}.handrailProjectionOrClearWidth`);
        assumptions.push("有扶手但缺少突出量时，仅以墙间宽度作为扶手间净宽理论上界");
        confidence = "low";
      }
      if (overrides?.length) assumptions.push(`梯段证据来自评价配置：${flight.source}`);
      const handrailClear = count === 0 ? wall : explicitHandrail;
      return {
        stairId: stair.id,
        flightId: flight.flightId,
        levelIds: [stair.fromLevelId, stair.toLevelId].filter((id): id is string => Boolean(id)),
        stairType: stair.stairType,
        nominalWidthMeters: nominal,
        wallClearWidthMeters: wall,
        handrailCount: count,
        handrailClearWidthMeters: handrailClear,
        belowHandrailLowerBoundMeters: handrailClear,
        belowHandrailUpperBoundMeters: handrailClear ?? wall,
        measurementBasis: basis,
        confidence,
        assumptions,
        missingData,
        locatableObjectIds: [...new Set([stair.id, ...(flight.sectionObjectIds ?? [])])],
      };
    });
  });
}
