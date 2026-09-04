import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import type { RoomConnectivityGraph } from "./connectivity";
import type { Point } from "./envelope";
import { pointInMultiPolygon } from "./g2-geometry";
import { G2_DOOR_OPENING_ASSUMPTIONS, G2_PARAMETERS as P } from "./g2-regulations";
import type { RoomRegion, RoomRegionAnalysis } from "./room-regions";
import type { ConfidenceLevel, RuleStatus } from "./types";

export type GradeFloorStatus = "yes" | "no" | "unknown";
export type EeroOpeningType = "window" | "door";

export type ExplicitEeroOpeningMeasurement = {
  clearWidthMeters: number | null;
  clearHeightMeters: number | null;
  clearAreaSquareMeters?: number | null;
  sillHeightMeters?: number | null;
  gradeFloorStatus?: GradeFloorStatus;
  reliable: boolean;
  source: string;
};

export type EeroCandidate = {
  candidateId: string;
  pascalSourceId: string;
  roomRegionId: string;
  levelId: string;
  openingType: EeroOpeningType;
  operationType: string;
  eligible: boolean;
  exclusionReason: string | null;
  nominalWidthMeters: number | null;
  nominalHeightMeters: number | null;
  clearWidthMeters: number | null;
  clearHeightMeters: number | null;
  clearAreaSquareMeters: number | null;
  clearWidthLowerBoundMeters: number | null;
  clearWidthUpperBoundMeters: number | null;
  clearHeightLowerBoundMeters: number | null;
  clearHeightUpperBoundMeters: number | null;
  clearAreaLowerBoundSquareMeters: number | null;
  clearAreaUpperBoundSquareMeters: number | null;
  openingBottomAboveFinishedFloorMeters: number | null;
  finishedFloorBasis: string | null;
  gradeFloorStatus: GradeFloorStatus;
  sizeStatus: RuleStatus;
  measurementBasis: "explicit" | "derived";
  confidence: ConfidenceLevel;
  assumptions: string[];
  missingData: string[];
};

export type EeroRoomAnalysis = {
  roomRegionId: string;
  levelId: string;
  candidates: EeroCandidate[];
};

export type EeroCandidateAnalysis = {
  rooms: EeroRoomAnalysis[];
  candidates: EeroCandidate[];
};

export type EeroCandidateOptions = {
  explicitMeasurements?: Record<string, ExplicitEeroOpeningMeasurement>;
  gradeFloorStatusByOpeningId?: Record<string, GradeFloorStatus>;
};

const finitePositive = (value: unknown): value is number => Number.isFinite(value) && Number(value) > 0;
const conservativeFrame = (value: number | null) => finitePositive(value) ? value : null;
const area = (width: number | null, height: number | null) => width !== null && height !== null ? width * height : null;

function classifySize(candidate: Pick<EeroCandidate,
  "eligible" | "gradeFloorStatus" |
  "clearWidthLowerBoundMeters" | "clearWidthUpperBoundMeters" |
  "clearHeightLowerBoundMeters" | "clearHeightUpperBoundMeters" |
  "clearAreaLowerBoundSquareMeters" | "clearAreaUpperBoundSquareMeters"
>): RuleStatus {
  if (!candidate.eligible) return "not_applicable";
  const lowerWidth = candidate.clearWidthLowerBoundMeters, upperWidth = candidate.clearWidthUpperBoundMeters;
  const lowerHeight = candidate.clearHeightLowerBoundMeters, upperHeight = candidate.clearHeightUpperBoundMeters;
  const lowerArea = candidate.clearAreaLowerBoundSquareMeters, upperArea = candidate.clearAreaUpperBoundSquareMeters;
  if (upperWidth !== null && upperWidth + 1e-9 < P.eeroMinimumClearWidth.convertedValue) return "issue";
  if (upperHeight !== null && upperHeight + 1e-9 < P.eeroMinimumClearHeight.convertedValue) return "issue";
  const issueAreaThreshold = candidate.gradeFloorStatus === "no" ? P.eeroMinimumClearArea.convertedValue : P.eeroGradeFloorMinimumClearArea.convertedValue;
  if (upperArea !== null && upperArea + 1e-9 < issueAreaThreshold) return "issue";
  const passAreaThreshold = candidate.gradeFloorStatus === "yes" ? P.eeroGradeFloorMinimumClearArea.convertedValue : P.eeroMinimumClearArea.convertedValue;
  if (lowerWidth !== null && lowerHeight !== null && lowerArea !== null &&
    lowerWidth + 1e-9 >= P.eeroMinimumClearWidth.convertedValue &&
    lowerHeight + 1e-9 >= P.eeroMinimumClearHeight.convertedValue &&
    lowerArea + 1e-9 >= passAreaThreshold) return "pass";
  return "unable_to_determine";
}

function roomExteriorRelation(
  center: Point | null,
  tangentRadians: number | null,
  width: number | null,
  wallThickness: number,
  levelRooms: RoomRegion[],
  targetRoomIds: Set<string>,
  roomAnalysis: RoomRegionAnalysis,
  levelId: string,
) {
  if (!center || !Number.isFinite(tangentRadians) || !finitePositive(width)) return null;
  const tangent: Point = [Math.cos(tangentRadians!), Math.sin(tangentRadians!)];
  const normal: Point = [-tangent[1], tangent[0]];
  const offset = wallThickness / 2 + .08;
  const envelope = roomAnalysis.envelopes.find((item) => item.levelId === levelId && item.usableForEvaluation);
  const classify = (sign: number) => {
    const samples = [-.25, 0, .25].map((fraction) => [
      center[0] + tangent[0] * width * fraction + normal[0] * offset * sign,
      center[1] + tangent[1] * width * fraction + normal[1] * offset * sign,
    ] as Point);
    const roomVotes = new Map<string, number>();
    let exteriorVotes = 0;
    samples.forEach((point) => {
      const matches = levelRooms.filter((room) => pointInMultiPolygon(point, room.polygons));
      if (matches.length === 1) roomVotes.set(matches[0]!.roomRegionId, (roomVotes.get(matches[0]!.roomRegionId) ?? 0) + 1);
      else if (!matches.length && envelope && !pointInMultiPolygon(point, envelope.polygons)) exteriorVotes++;
    });
    const room = [...roomVotes.entries()].sort((a, b) => b[1] - a[1])[0];
    return { roomId: room && room[1] >= 2 ? room[0] : null, exterior: exteriorVotes >= 2 };
  };
  const a = classify(1), b = classify(-1);
  if (a.roomId && targetRoomIds.has(a.roomId) && b.exterior) return a.roomId;
  if (b.roomId && targetRoomIds.has(b.roomId) && a.exterior) return b.roomId;
  return null;
}

function windowCandidate(
  window: EvaluationHandoff["windows"][number],
  roomRegionId: string,
  options: EeroCandidateOptions,
): EeroCandidate {
  const explicit = options.explicitMeasurements?.[window.id];
  const nominalWidth = finitePositive(window.widthMeters) ? window.widthMeters : null;
  const nominalHeight = finitePositive(window.heightMeters) ? window.heightMeters : null;
  const operationType = window.windowType ?? "unknown";
  const fixed = operationType === "fixed";
  const assumptions: string[] = [];
  const missingData: string[] = [];
  const frame = conservativeFrame(window.frameThicknessMeters);
  let basis: "explicit" | "derived" = "derived";
  let confidence: ConfidenceLevel = "medium";
  let lowerWidth: number | null = null, upperWidth = nominalWidth;
  let lowerHeight: number | null = null, upperHeight = nominalHeight;

  if (explicit?.reliable && finitePositive(explicit.clearWidthMeters) && finitePositive(explicit.clearHeightMeters)) {
    basis = "explicit";
    confidence = "high";
    lowerWidth = upperWidth = explicit.clearWidthMeters;
    lowerHeight = upperHeight = explicit.clearHeightMeters;
    assumptions.push(`采用显式净开口：${explicit.source}`);
  } else if (!fixed && operationType === "casement" && nominalWidth !== null && nominalHeight !== null && frame !== null) {
    const widthDeductions = window.casementStyle === "french" ? 4 : 3;
    lowerWidth = Math.max(0, nominalWidth - widthDeductions * frame);
    lowerHeight = Math.max(0, nominalHeight - 2 * frame);
    assumptions.push(`平开窗保守下界：宽度扣除${widthDeductions}个显式 frameThickness（两侧框及开启扇/中梃占用），高度扣除2个 frameThickness`);
    assumptions.push("按窗型的正常完全开启状态评价，不把当前展示开度直接当最大开启能力");
  } else if (!fixed && operationType === "sliding" && nominalWidth !== null && nominalHeight !== null) {
    assumptions.push("推拉窗缺少活动扇数量和重叠尺寸，净开口下界取0、理论上界取名义洞口");
    missingData.push(`${window.id}.operablePanelGeometry`);
    confidence = "low";
  } else if (!fixed && nominalWidth !== null && nominalHeight !== null) {
    assumptions.push(`${operationType}窗缺少正常开启后的扇体/角度几何，净开口下界取0、理论上界取名义洞口`);
    missingData.push(`${window.id}.normalOperationGeometry`);
    confidence = "low";
  } else if (!fixed) {
    missingData.push(`${window.id}.nominalOpeningDimensions`);
    confidence = "low";
  }

  const explicitArea = explicit?.reliable && finitePositive(explicit.clearAreaSquareMeters) ? explicit.clearAreaSquareMeters : null;
  const lowerArea = explicitArea ?? area(lowerWidth, lowerHeight);
  const upperArea = explicitArea ?? area(upperWidth, upperHeight);
  const clearWidth = lowerWidth !== null && lowerWidth === upperWidth ? lowerWidth : null;
  const clearHeight = lowerHeight !== null && lowerHeight === upperHeight ? lowerHeight : null;
  const clearArea = lowerArea !== null && lowerArea === upperArea ? lowerArea : null;

  let openingBottom: number | null = null;
  let floorBasis: string | null = null;
  if (explicit?.reliable && Number.isFinite(explicit.sillHeightMeters)) {
    openingBottom = explicit.sillHeightMeters!;
    floorBasis = `explicit:${explicit.source}`;
  } else if (Array.isArray(window.rawWallLocalPosition) && Number.isFinite(window.rawWallLocalPosition[1]) && nominalHeight !== null) {
    openingBottom = window.rawWallLocalPosition[1] - nominalHeight / 2 + (frame ?? 0);
    floorBasis = "derived: wall-local opening center relative to Level finished-floor plane";
    assumptions.push(`净开口底部 = position[1] - nominalHeight/2 + ${frame !== null ? "frameThickness" : "0（框厚缺失）"}`);
    if (frame === null) {
      missingData.push(`${window.id}.frameThicknessForOpeningBottom`);
      confidence = "low";
    }
  } else missingData.push(`${window.id}.openingBottomOrLocalVerticalPosition`);

  const gradeFloorStatus = explicit?.gradeFloorStatus ?? options.gradeFloorStatusByOpeningId?.[window.id] ?? "unknown";
  const partial: EeroCandidate = {
    candidateId: window.id,
    pascalSourceId: window.rawPascalId,
    roomRegionId,
    levelId: window.levelId!,
    openingType: "window",
    operationType,
    eligible: !fixed,
    exclusionReason: fixed ? "固定窗不能作为可操作EERO" : null,
    nominalWidthMeters: nominalWidth,
    nominalHeightMeters: nominalHeight,
    clearWidthMeters: clearWidth,
    clearHeightMeters: clearHeight,
    clearAreaSquareMeters: clearArea,
    clearWidthLowerBoundMeters: lowerWidth,
    clearWidthUpperBoundMeters: upperWidth,
    clearHeightLowerBoundMeters: lowerHeight,
    clearHeightUpperBoundMeters: upperHeight,
    clearAreaLowerBoundSquareMeters: lowerArea,
    clearAreaUpperBoundSquareMeters: upperArea,
    openingBottomAboveFinishedFloorMeters: openingBottom,
    finishedFloorBasis: floorBasis,
    gradeFloorStatus,
    sizeStatus: "unable_to_determine",
    measurementBasis: basis,
    confidence,
    assumptions,
    missingData,
  };
  partial.sizeStatus = classifySize(partial);
  return partial;
}

function doorCandidate(
  door: EvaluationHandoff["doors"][number],
  roomRegionId: string,
  options: EeroCandidateOptions,
): EeroCandidate {
  const explicit = options.explicitMeasurements?.[door.id];
  const nominalWidth = finitePositive(door.widthMeters) ? door.widthMeters : null;
  const nominalHeight = finitePositive(door.heightMeters) ? door.heightMeters : null;
  const vehicleDoor = door.doorType === "garage-sectional";
  const eligibleType = !vehicleDoor && ["hinged", "double", "sliding"].includes(door.doorType ?? "");
  const assumptions: string[] = [];
  const missingData: string[] = [];
  let basis: "explicit" | "derived" = "derived";
  let confidence: ConfidenceLevel = "medium";
  let lowerWidth: number | null = null, lowerHeight: number | null = null;
  let upperWidth = nominalWidth, upperHeight = nominalHeight;
  if (explicit?.reliable && finitePositive(explicit.clearWidthMeters) && finitePositive(explicit.clearHeightMeters)) {
    basis = "explicit"; confidence = "high";
    lowerWidth = upperWidth = explicit.clearWidthMeters;
    lowerHeight = upperHeight = explicit.clearHeightMeters;
    assumptions.push(`采用显式净开口：${explicit.source}`);
  } else if (eligibleType && nominalWidth !== null && nominalHeight !== null && ["hinged", "double"].includes(door.doorType ?? "")) {
    const jamb = G2_DOOR_OPENING_ASSUMPTIONS.jambStopDeductionPerSideMeters;
    lowerWidth = Math.max(0, nominalWidth - 2 * jamb);
    lowerHeight = Math.max(0, nominalHeight - jamb - (door.thresholdHeightMeters ?? 0));
    assumptions.push("侧铰外门按完整可开启门洞扣除两侧各5/8 in门框止口，并扣除上框和门槛");
  } else if (eligibleType && nominalWidth !== null && nominalHeight !== null) {
    confidence = "low";
    missingData.push(`${door.id}.normalOperationGeometry`);
    assumptions.push("推拉门缺少活动扇几何，净开口下界取0、理论上界取名义门洞");
  } else if (eligibleType) {
    confidence = "low";
    missingData.push(`${door.id}.nominalOpeningDimensions`);
  }
  const explicitArea = explicit?.reliable && finitePositive(explicit.clearAreaSquareMeters) ? explicit.clearAreaSquareMeters : null;
  const lowerArea = explicitArea ?? area(lowerWidth, lowerHeight);
  const upperArea = explicitArea ?? area(upperWidth, upperHeight);
  const openingBottom = explicit?.reliable && Number.isFinite(explicit.sillHeightMeters) ? explicit.sillHeightMeters! : door.thresholdHeightMeters;
  const partial: EeroCandidate = {
    candidateId: door.id,
    pascalSourceId: door.rawPascalId,
    roomRegionId,
    levelId: door.levelId!,
    openingType: "door",
    operationType: door.doorType ?? "unknown",
    eligible: eligibleType,
    exclusionReason: vehicleDoor ? "车库车辆门不作为EERO" : eligibleType ? null : "门型不属于可确认的可操作外部开口",
    nominalWidthMeters: nominalWidth,
    nominalHeightMeters: nominalHeight,
    clearWidthMeters: lowerWidth !== null && lowerWidth === upperWidth ? lowerWidth : null,
    clearHeightMeters: lowerHeight !== null && lowerHeight === upperHeight ? lowerHeight : null,
    clearAreaSquareMeters: lowerArea !== null && lowerArea === upperArea ? lowerArea : null,
    clearWidthLowerBoundMeters: lowerWidth,
    clearWidthUpperBoundMeters: upperWidth,
    clearHeightLowerBoundMeters: lowerHeight,
    clearHeightUpperBoundMeters: upperHeight,
    clearAreaLowerBoundSquareMeters: lowerArea,
    clearAreaUpperBoundSquareMeters: upperArea,
    openingBottomAboveFinishedFloorMeters: Number.isFinite(openingBottom) ? openingBottom! : null,
    finishedFloorBasis: Number.isFinite(openingBottom) ? explicit?.reliable ? `explicit:${explicit.source}` : "derived: door thresholdHeight relative to Level finished-floor plane" : null,
    gradeFloorStatus: explicit?.gradeFloorStatus ?? options.gradeFloorStatusByOpeningId?.[door.id] ?? "unknown",
    sizeStatus: "unable_to_determine",
    measurementBasis: basis,
    confidence,
    assumptions,
    missingData,
  };
  partial.sizeStatus = classifySize(partial);
  return partial;
}

export function buildEeroCandidateAnalysis(
  handoff: EvaluationHandoff,
  roomAnalysis: RoomRegionAnalysis,
  graph: RoomConnectivityGraph,
  requiredRooms: RoomRegion[],
  options: EeroCandidateOptions = {},
): EeroCandidateAnalysis {
  const targetIds = new Set(requiredRooms.map((room) => room.roomRegionId));
  const levelRooms = new Map(handoff.levels.map((level) => [level.id, roomAnalysis.rooms.filter((room) => room.levelId === level.id && room.usableForEvaluation)]));
  const wallById = new Map(handoff.walls.map((wall) => [wall.id, wall]));
  const candidates: EeroCandidate[] = [];

  handoff.windows.filter((window) => window.visible && window.levelId && window.hostWallId).forEach((window) => {
    const wall = wallById.get(window.hostWallId!);
    if (!wall) return;
    const roomId = roomExteriorRelation(
      window.resolvedWorldPosition as Point | null,
      window.resolvedTangentRadians,
      window.widthMeters,
      wall.thicknessMeters,
      levelRooms.get(window.levelId!) ?? [],
      targetIds,
      roomAnalysis,
      window.levelId!,
    );
    if (roomId) candidates.push(windowCandidate(window, roomId, options));
  });

  const doorById = new Map(handoff.doors.map((door) => [door.id, door]));
  graph.portals.filter((portal) => portal.usableForConnectivity && portal.connectsExterior).forEach((portal) => {
    const roomId = portal.roomRegionAId ?? portal.roomRegionBId;
    const door = doorById.get(portal.doorId);
    if (roomId && targetIds.has(roomId) && door?.levelId) candidates.push(doorCandidate(door, roomId, options));
  });

  return {
    rooms: requiredRooms.map((room) => ({ roomRegionId: room.roomRegionId, levelId: room.levelId, candidates: candidates.filter((candidate) => candidate.roomRegionId === room.roomRegionId) })),
    candidates,
  };
}
