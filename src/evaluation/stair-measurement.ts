import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import type { ConfidenceLevel } from "./types";

export type StairMeasurementBasis = "explicit" | "derived";
export type StairCodeFamily = "ordinary" | "special";

export type StairMeasurementAnalysis = {
  stairId: string;
  pascalSourceId: string;
  fromLevelId: string | null;
  toLevelId: string | null;
  stairType: string;
  codeFamily: StairCodeFamily;
  sourceFields: string[];
  treadCount: number | null;
  riserCount: number | null;
  treadDepthsMeters: number[] | null;
  riserHeightsMeters: number[] | null;
  minimumTreadDepthMeters: number | null;
  maximumTreadDepthMeters: number | null;
  treadDepthVariationMeters: number | null;
  minimumRiserHeightMeters: number | null;
  maximumRiserHeightMeters: number | null;
  riserHeightVariationMeters: number | null;
  measurementBasis: StairMeasurementBasis;
  confidence: ConfidenceLevel;
  missingData: string[];
  assumptions: string[];
  uniformGeneration: boolean;
  locatableObjectIds: string[];
};

type ExtendedStair = EvaluationHandoff["stairs"][number] & {
  treadDepthsMeters?: number[];
  riserHeightsMeters?: number[];
  treadDepthMeters?: number;
  riserHeightMeters?: number;
  treadCount?: number;
  riserCount?: number;
  totalRunMeters?: number;
  uniformStepGeneration?: boolean;
};

const finitePositive = (value: unknown): value is number => Number.isFinite(value) && Number(value) > 0;
const finitePositiveArray = (value: unknown): value is number[] => Array.isArray(value) && value.length > 0 && value.every(finitePositive);
const count = (value: unknown) => finitePositive(value) && Number.isInteger(value) ? value : null;
const extrema = (values: number[] | null) => values?.length ? {
  minimum: Math.min(...values),
  maximum: Math.max(...values),
  variation: Math.max(...values) - Math.min(...values),
} : { minimum: null, maximum: null, variation: null };

export const isSpecialStairType = (stairType: string) => /spiral|curved|winder|alternat|ship|ladder|扇形|螺旋|交错|船梯|梯子/i.test(stairType);

export function analyzeStairMeasurements(handoff: EvaluationHandoff): StairMeasurementAnalysis[] {
  return handoff.stairs.map((source) => {
    const stair = source as ExtendedStair;
    const stairType = stair.stairType || "unknown";
    const special = isSpecialStairType(stairType);
    const sourceFields: string[] = [];
    const missingData: string[] = [];
    const assumptions: string[] = [];
    let basis: StairMeasurementBasis = "explicit";
    let confidence: ConfidenceLevel = "high";

    const riserCount = count(stair.riserCount) ?? count(stair.stepCount);
    const treadCount = count(stair.treadCount) ?? count(stair.stepCount);
    if (stair.riserCount !== undefined) sourceFields.push("riserCount");
    else if (stair.stepCount !== null) sourceFields.push("stepCount");
    if (stair.treadCount !== undefined) sourceFields.push("treadCount");

    let riserHeights = finitePositiveArray(stair.riserHeightsMeters) ? [...stair.riserHeightsMeters] : null;
    let treadDepths = finitePositiveArray(stair.treadDepthsMeters) ? [...stair.treadDepthsMeters] : null;
    if (riserHeights) sourceFields.push("riserHeightsMeters");
    if (treadDepths) sourceFields.push("treadDepthsMeters");

    const explicitlyUniformRisers = stair.uniformStepGeneration === true || finitePositive(stair.riserHeightMeters);
    const explicitlyUniformTreads = stair.uniformStepGeneration === true || finitePositive(stair.treadDepthMeters);
    const uniform = explicitlyUniformRisers && explicitlyUniformTreads;
    if (!riserHeights && finitePositive(stair.riserHeightMeters) && riserCount) {
      riserHeights = Array.from({ length: riserCount }, () => stair.riserHeightMeters!);
      sourceFields.push("riserHeightMeters");
      assumptions.push("明确的单值riserHeightMeters按模型统一踢面生成参数解释");
    }
    if (!treadDepths && finitePositive(stair.treadDepthMeters) && treadCount) {
      treadDepths = Array.from({ length: treadCount }, () => stair.treadDepthMeters!);
      sourceFields.push("treadDepthMeters");
      assumptions.push("明确的单值treadDepthMeters按模型统一踏步生成参数解释");
    }

    let averageRiser: number | null = null;
    if (!riserHeights && finitePositive(stair.totalRiseMeters) && riserCount) {
      averageRiser = stair.totalRiseMeters! / riserCount;
      sourceFields.push("totalRiseMeters");
      basis = "derived";
      confidence = "medium";
      assumptions.push("平均踢面高度由 totalRiseMeters ÷ riserCount 派生");
      if (stair.uniformStepGeneration === true) riserHeights = Array.from({ length: riserCount }, () => averageRiser!);
    }

    let averageTread: number | null = null;
    if (!treadDepths && finitePositive(stair.totalRunMeters) && treadCount) {
      averageTread = stair.totalRunMeters / treadCount;
      sourceFields.push("totalRunMeters");
      basis = "derived";
      confidence = "medium";
      assumptions.push("平均踏步深度由 totalRunMeters ÷ treadCount 派生");
      if (stair.uniformStepGeneration === true) treadDepths = Array.from({ length: treadCount }, () => averageTread!);
    }

    const riser = extrema(riserHeights);
    const tread = extrema(treadDepths);
    if (!riserHeights) {
      if (averageRiser === null) missingData.push(`${stair.id}.riserHeightsOrTotalRiseAndCount`);
      missingData.push(`${stair.id}.riserHeightVariation`);
    }
    if (!treadDepths) {
      if (averageTread === null) missingData.push(`${stair.id}.treadDepthsOrTotalRunAndCount`);
      missingData.push(`${stair.id}.treadDepthVariation`);
    }
    if (uniform) assumptions.push("模型明确以均匀踏步参数生成，尺寸极差按0处理");
    if (special) assumptions.push(`楼梯类型 ${stairType} 适用专门条文，不套用普通楼梯阈值`);

    return {
      stairId: stair.id,
      pascalSourceId: stair.rawPascalId,
      fromLevelId: stair.fromLevelId,
      toLevelId: stair.toLevelId,
      stairType,
      codeFamily: special ? "special" : "ordinary",
      sourceFields: [...new Set(sourceFields)],
      treadCount,
      riserCount,
      treadDepthsMeters: treadDepths,
      riserHeightsMeters: riserHeights,
      minimumTreadDepthMeters: tread.minimum ?? averageTread,
      maximumTreadDepthMeters: tread.maximum ?? averageTread,
      treadDepthVariationMeters: tread.variation,
      minimumRiserHeightMeters: riser.minimum ?? averageRiser,
      maximumRiserHeightMeters: riser.maximum ?? averageRiser,
      riserHeightVariationMeters: riser.variation,
      measurementBasis: basis,
      confidence,
      missingData: [...new Set(missingData)],
      assumptions,
      uniformGeneration: uniform,
      locatableObjectIds: [stair.id],
    };
  });
}
