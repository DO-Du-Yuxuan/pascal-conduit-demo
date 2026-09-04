import type { RegulatoryCitation, RuleThreshold } from "./types";

export const INCH_TO_METER = 0.0254;
export const FOOT_TO_METER = 0.3048;
export const SQUARE_FOOT_TO_SQUARE_METER = 0.09290304;

/**
 * Plan-derived opening allowance, not a legal threshold.
 * 5/8 in per jamb is a conservative stop/frame allowance: Republic Doors
 * documents 5/8 in as its standard frame stop, and the U.S. Access Board
 * uses the same dimension for a permitted latch-side stop projection.
 */
export const G2_DOOR_OPENING_ASSUMPTIONS = {
  jambStopDeductionPerSideMeters: 5 / 8 * INCH_TO_METER,
  source: "Republic Doors and Frames Technical Data Manual: 5/8 in standard stop",
  sourceUrl: "https://www.republicdoor.com/content/dam/republic/literature/REPUBLIC_TECH_DATA_MANUAL_ONLINE-4.2020.pdf",
  measurementReferenceUrl: "https://www.access-board.gov/ada/guides/chapter-4-entrances-doors-and-gates/",
} as const;

export type G2Parameter = {
  id: string;
  name: string;
  originalValue: number;
  originalUnit: "in" | "in²" | "ft" | "ft²" | "%" | "count";
  convertedValue: number;
  convertedUnit: "m" | "m²" | "ratio" | "count";
  applicability: string;
};

const length = (id: string, name: string, value: number, unit: "in" | "ft", applicability: string): G2Parameter => ({
  id, name, originalValue: value, originalUnit: unit,
  convertedValue: value * (unit === "in" ? INCH_TO_METER : FOOT_TO_METER),
  convertedUnit: "m", applicability,
});
const area = (id: string, name: string, value: number, applicability: string): G2Parameter => ({
  id, name, originalValue: value, originalUnit: "ft²",
  convertedValue: value * SQUARE_FOOT_TO_SQUARE_METER,
  convertedUnit: "m²", applicability,
});
const squareInchArea = (id: string, name: string, value: number, applicability: string): G2Parameter => ({
  id, name, originalValue: value, originalUnit: "in²",
  convertedValue: value * INCH_TO_METER ** 2,
  convertedUnit: "m²", applicability,
});
const ratio = (id: string, name: string, value: number, applicability: string): G2Parameter => ({
  id, name, originalValue: value, originalUnit: "%",
  convertedValue: value / 100, convertedUnit: "ratio", applicability,
});
const fixtureCount = (id: string, name: string, value: number, applicability: string): G2Parameter => ({
  id, name, originalValue: value, originalUnit: "count",
  convertedValue: value, convertedUnit: "count", applicability,
});

export const G2_PARAMETERS = {
  egressDoorWidth: length("G2-001-P01", "必要疏散门最小净开宽度", 32, "in", "已确认的侧铰必要疏散门，门扇开启90°"),
  egressDoorHeight: length("G2-001-P02", "必要疏散门最小净开高度", 78, "in", "已确认的必要疏散门，门槛顶至门挡底"),
  stairMaximumRiserHeight: length("G2-002-P01", "常规楼梯最大踢面高度", 7.75, "in", "适用的常规住宅楼梯梯段；专用楼梯类型不适用"),
  stairMinimumTreadDepth: length("G2-002-P02", "常规楼梯最小踏步深度", 10, "in", "适用的常规住宅楼梯梯段；扇形踏步等适用专门条文"),
  stairMaximumRiserVariation: length("G2-002-P03", "同梯段最大踢面高度差", 0.375, "in", "适用的常规住宅楼梯同一梯段"),
  stairMaximumTreadVariation: length("G2-002-P04", "同梯段最大踏步深度差", 0.375, "in", "适用的常规住宅楼梯同一梯段"),
  hallwayWidth: length("G2-003-P01", "住宅走廊最小净宽", 3, "ft", "法规意义上的住宅 hallway"),
  habitableRoomArea: area("G2-004-P01", "居住房间最小面积", 70, "适用居住房间；厨房例外；低矮或坡顶不可计入面积排除"),
  habitableRoomSlopedCeilingCountableHeight: length("G2-004-P02", "坡顶面积可计入最小净高", 5, "ft", "R304.3 坡顶区域"),
  habitableRoomFurredCeilingCountableHeight: length("G2-004-P03", "平顶/吊顶面积可计入最小净高", 7, "ft", "R304.3 平顶或吊顶区域"),
  habitableRoomDimension: length("G2-005-P01", "居住房间最小水平尺寸", 7, "ft", "适用居住房间；厨房例外"),
  toiletSide: length("G2-006-P01", "坐便器中心至侧墙或障碍物最小距离", 15, "in", "纸巾盒和无障碍扶手除外"),
  toiletCenter: length("G2-006-P02", "相邻同类洁具最小中心距", 30, "in", "相邻坐便器或坐浴盆"),
  toiletFrontResidential: length("G2-006-P03", "住宅/睡眠单元坐便器前方最小净空", 21, "in", "仅 dwelling unit 或 sleeping unit"),
  toiletFrontGeneral: length("G2-006-P04", "一般场景坐便器前方最小净空", 24, "in", "不满足住宅/睡眠单元例外的场景"),
  eeroMinimumClearArea: area("G2-007-P01", "紧急逃生救援开口最小净开口面积", 5.7, "非 grade-floor 的必要紧急逃生救援开口"),
  eeroGradeFloorMinimumClearArea: area("G2-007-P02", "地面层紧急逃生救援开口最小净面积", 5, "满足 grade-floor 定义的必要紧急逃生救援开口"),
  eeroMinimumClearHeight: length("G2-007-P03", "紧急逃生救援开口最小净高度", 24, "in", "必要紧急逃生救援开口正常开启后"),
  eeroMinimumClearWidth: length("G2-007-P04", "紧急逃生救援开口最小净宽度", 20, "in", "必要紧急逃生救援开口正常开启后"),
  eeroMaximumSillHeight: length("G2-008-P01", "紧急逃生救援开口底部最大离地高度", 44, "in", "室内完成地面至正常开启后净开口底部"),
  spiralMinimumClearWidth: length("G2-011-P01", "螺旋楼梯扶手处及以下最小净宽", 26, "in", "适用螺旋楼梯在扶手处及以下"),
  spiralMaximumWalklineRadius: length("G2-011-P02", "螺旋楼梯最大行走线半径", 24.5, "in", "适用螺旋楼梯法规行走线"),
  spiralMinimumWalklineTreadDepth: length("G2-011-P03", "螺旋楼梯行走线处最小踏步深度", 6.75, "in", "适用螺旋楼梯每级踏步在法规行走线处"),
  spiralMaximumRiserHeight: length("G2-011-P04", "螺旋楼梯最大踢面高度", 9.5, "in", "适用螺旋楼梯每级rise"),
  spiralMinimumHeadroom: length("G2-011-P05", "螺旋楼梯最小净高", 78, "in", "适用螺旋楼梯沿法规测量线"),
  stairWidthAboveHandrail: length("G2-012-P01", "普通楼梯扶手高度以上最小净宽", 36, "in", "普通适用楼梯在扶手允许高度以上、规定净高以下"),
  stairWidthOneHandrail: length("G2-012-P02", "普通楼梯一侧扶手时最小净宽", 31.5, "in", "普通适用楼梯在扶手高度及以下，仅一侧设置扶手"),
  stairWidthTwoHandrails: length("G2-012-P03", "普通楼梯两侧扶手时最小净宽", 27, "in", "普通适用楼梯在扶手高度及以下，两侧均设置扶手"),
  straightStairLandingMinimumDepth: length("G2-014-P01", "直跑楼梯平台最小行进方向深度", 36, "in", "直跑楼梯依法需要且已可靠识别的平台；平台宽度另须不小于梯段宽度"),
  habitableMinimumHeadroom: length("G2-016-P01", "居住空间一般最小净高", 7, "ft", "法规意义上的habitable space"),
  slopedHabitableCountableMinimumHeadroom: length("G2-016-P02", "坡顶居住房间可计入区域最低高度", 5, "ft", "坡顶房间用于满足规定面积的区域"),
  slopedHabitableMinimumCompliantRatio: ratio("G2-016-P03", "坡顶居住房间达到一般净高的最小面积比例", 50, "坡顶房间规定面积"),
  kitchenHallwayMinimumHeadroom: length("G2-017-P01", "厨房和走廊一般最小净高", 7, "ft", "厨房、走廊及包含这些空间的地下室部分"),
  bathToiletLaundryMinimumHeadroom: length("G2-017-P02", "浴室厕所间和洗衣房最小净高", 80, "in", "浴室、厕所间和洗衣房"),
  nonhabitableBasementMinimumHeadroom: length("G2-017-P03", "非居住非走廊地下室部分最小净高", 80, "in", "不包含habitable space或hallway的地下室部分"),
  basementObstructionMinimumHeadroom: length("G2-017-P04", "非居住地下室障碍处最小净高", 76, "in", "适用地下室梁、主梁、风管或允许障碍处"),
  showerHeadroomRegionMinimumSide: length("G2-017-P05", "淋浴喷头处最小净高区域边长", 30, "in", "淋浴或带喷头浴缸在喷头处"),
  dwellingMinimumWaterClosetCount: fixtureCount("G2-019-P01", "每住宅单元最少坐便器数量", 1, "每个适用住宅单元"),
  dwellingMinimumLavatoryCount: fixtureCount("G2-019-P02", "每住宅单元最少洗面盆数量", 1, "每个适用住宅单元"),
  dwellingMinimumBathingFixtureCount: fixtureCount("G2-019-P03", "每住宅单元最少浴缸或淋浴组合数量", 1, "每个适用住宅单元"),
  dwellingMinimumKitchenSinkCount: fixtureCount("G2-019-P05", "每住宅单元最少厨房水槽数量", 1, "每个适用住宅单元"),
  showerCompartmentMinimumInteriorArea: squareInchArea("G2-020-P01", "淋浴间最小完成内部面积", 900, "淋浴间完成内部有效空间；自门槛顶测量"),
  showerCompartmentMinimumInscribedCircle: length("G2-020-P02", "淋浴间最小内接圆直径", 30, "in", "淋浴间完成内部有效空间；自门槛顶测量"),
  showerCompartmentMaintainedHeight: length("G2-020-P03", "淋浴间尺寸维持最小高度", 70, "in", "自门槛顶至淋浴排水口上方至少70 in"),
  showerReceptorExceptionMinimumWidth: length("G2-020-P04", "接水盘例外最小宽度", 30, "in", "408.6 Exception 2：适用的淋浴接水盘整体宽度"),
  showerReceptorExceptionMinimumLength: length("G2-020-P05", "接水盘例外最小长度", 60, "in", "408.6 Exception 2：适用的淋浴接水盘整体长度；与P04成对适用"),
} as const;

export const thresholdFrom = (parameter: G2Parameter): RuleThreshold => ({
  name: parameter.name,
  value: parameter.convertedValue,
  unit: parameter.convertedUnit,
  originalValue: parameter.originalValue,
  originalUnit: parameter.originalUnit,
  convertedValue: parameter.convertedValue,
  convertedUnit: parameter.convertedUnit,
});

const citation = (section: string, sourceId: string, codeName = "2021 Washington State Residential Code"): RegulatoryCitation => ({
  jurisdiction: "美国华盛顿州 Bellevue",
  codeName,
  codeVersion: "Bellevue Ordinance 6781；2024-03-15 生效",
  section,
  sourceId,
  adoptionId: "BEL-ADOPT-2021",
});

export const G2_CITATIONS = {
  "G2-001": citation("R311.2", "WSRC-2021-R311.2"),
  "G2-002": citation("R311.7.5.1、R311.7.5.2", "WSRC-2021-R311.7.5.1-R311.7.5.2"),
  "G2-003": citation("R311.6", "WSRC-2021-R311.6"),
  "G2-004": citation("R304.1（结合 R304.3）", "WSRC-2021-R304.1"),
  "G2-005": citation("R304.2", "WSRC-2021-R304.2"),
  "G2-006": citation("WAC 51-56-0400 / UPC 402.5", "WAC-51-56-0400-402.5", "WAC Chapter 51-56，采用并修订 2021 Uniform Plumbing Code"),
  "G2-007": citation("R310.1、R310.2.1、R310.2.2", "WSRC-2021-R310.1-R310.2.2"),
  "G2-008": citation("R310.2.3", "WSRC-2021-R310.2.3"),
  "G2-009": citation("R302.5.1", "WSRC-2021-R302.5.1"),
  "G2-010": citation("R311.1", "WSRC-2021-R311.1"),
  "G2-011": citation("R311.7.10.1", "WSRC-2021-R311.7.10.1"),
  "G2-012": citation("R311.7.1", "WSRC-2021-R311.7.1"),
  "G2-013": citation("R311.7.6", "WSRC-2021-R311.7.6"),
  "G2-014": citation("R311.7.6", "WSRC-2021-R311.7.6"),
  "G2-015": citation("R311.7.6；R311.3.1、R311.3.2、R311.3.3", "WSRC-2021-R311.7.6"),
  "G2-016": citation("R305.1、R305.1.1", "WSRC-2021-R305.1-R305.1.1"),
  "G2-017": citation("R305.1、R305.1.1", "WSRC-2021-R305.1-R305.1.1"),
  "G2-019": citation("R306.1、R306.2", "WSRC-2021-R306.1-R306.2"),
  "G2-020": citation("WAC 51-56-0400 / UPC 408.6", "WAC-51-56-0400-408.6", "WAC Chapter 51-56，采用并修订 2021 Uniform Plumbing Code"),
} as const;

export type G2RuleId = keyof typeof G2_CITATIONS;
