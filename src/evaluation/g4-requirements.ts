import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import type { CustomerRequirement, RequirementHandoff, TargetSpace } from "../requirements/requirement-handoff";
import { buildRoomConnectivityGraph, type RoomConnectivityGraph } from "./connectivity";
import { buildRoomRegionAnalysis, type RoomRegion, type RoomRegionAnalysis } from "./room-regions";
import { canonicalSpaceSemantic, knownSpaceSemantics, semanticSpaces, type SemanticSpace } from "./space-semantics";
import type { RuleMeasurement, RuleResult, RuleThreshold } from "./types";

export type G4Status = "satisfied" | "not_satisfied" | "manual_review";

export type G4RequirementResult = {
  requirement: CustomerRequirement;
  status: G4Status;
  targetDescription: string;
  actualResult: string;
  reason: string;
  relatedObjectIds: string[];
  measurements: RuleMeasurement[];
  thresholds: RuleThreshold[];
  confidence: RuleResult["confidence"];
};

export type { SemanticSpace } from "./space-semantics";
export { canonicalSpaceSemantic, functionalSemanticsForZoneName as semanticsForZoneName, knownSpaceSemantics, semanticSpaces } from "./space-semantics";

const normalize = (value: string) => value.trim().toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const labelOf = (target: TargetSpace) => target.label ?? target.semantic;
const meters = (value: number) => `${Number(value.toFixed(2))} m²`;
const countCondition = (min?: number, max?: number) => [min !== undefined ? `至少 ${min} 个` : "", max !== undefined ? `最多 ${max} 个` : ""].filter(Boolean).join("且");
const areaCondition = (min?: number, max?: number) => [min !== undefined ? `不少于 ${meters(min)}` : "", max !== undefined ? `不超过 ${meters(max)}` : ""].filter(Boolean).join("且");
const relatedIds = (spaces: SemanticSpace[], extra: string[] = []) => [...new Set([...spaces.flatMap((space) => [space.room.roomRegionId, ...space.zoneIds]), ...extra])];
const confidence = (level: "high" | "medium" | "low", reason: string): RuleResult["confidence"] => ({ level, score: level === "high" ? .95 : level === "medium" ? .8 : .45, reasons: [reason] });

function targetDescription(requirement: CustomerRequirement): string {
  switch (requirement.type) {
    case "space_presence": return `存在${labelOf(requirement.targetSpace)}`;
    case "space_count": return `${labelOf(requirement.targetSpace)}${countCondition(requirement.quantity.min, requirement.quantity.max)}`;
    case "space_area": return `${labelOf(requirement.targetSpace)}按“${requirement.area.mode === "any" ? "任意一个" : requirement.area.mode === "every" ? "每一个" : "总面积"}”检查，${areaCondition(requirement.area.minSquareMeters, requirement.area.maxSquareMeters)}`;
    case "level_location": return `${labelOf(requirement.targetSpace)}位于${requirement.level.name ?? requirement.level.levelId ?? `第 ${requirement.level.ordinal} 层`}，${countCondition(requirement.quantity?.min ?? 1, requirement.quantity?.max)}`;
    case "space_adjacency": return `${labelOf(requirement.leftSpace)}与${labelOf(requirement.rightSpace)}${requirement.relationship === "directly_adjacent" ? "直接相邻" : "直接连通"}`;
    case "space_separation": return `${labelOf(requirement.leftSpace)}与${labelOf(requirement.rightSpace)}不${requirement.relationship === "directly_adjacent" ? "直接相邻" : "直接连通"}`;
    case "manual": return requirement.originalDescription ?? requirement.name;
  }
}

function manualResult(requirement: CustomerRequirement, reason: string, objects: string[] = []): G4RequirementResult {
  return { requirement, status: "manual_review", targetDescription: targetDescription(requirement), actualResult: "当前数据无法自动确认", reason, relatedObjectIds: objects, measurements: [], thresholds: [], confidence: confidence("low", "当前平面证据不足，需要人工检查") };
}

const valueMeets = (value: number, min?: number, max?: number) => (min === undefined || value >= min) && (max === undefined || value <= max);
const spacesFor = (allSpaces: SemanticSpace[], target: TargetSpace) => {
  const semantic = canonicalSpaceSemantic(target.semantic);
  const coded = allSpaces.filter((space) => space.sdiSemantics.has(semantic));
  return { semantic, supported: knownSpaceSemantics.has(semantic), spaces: coded.length ? coded : allSpaces.filter((space) => space.semantics.has(semantic)) };
};

function portalEvidenceComplete(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, room: RoomRegion): boolean {
  const boundaryWalls = new Set(room.boundaryWallIds);
  const boundaryDoors = handoff.doors.filter((door) => door.hostWallId && boundaryWalls.has(door.hostWallId));
  return boundaryDoors.length > 0 && boundaryDoors.every((door) => graph.portals.some((portal) => portal.doorId === door.id && portal.usableForConnectivity));
}

function evaluateRelationship(
  requirement: Extract<CustomerRequirement, { type: "space_adjacency" | "space_separation" }>,
  handoff: EvaluationHandoff,
  allSpaces: SemanticSpace[],
  graph: RoomConnectivityGraph,
): G4RequirementResult {
  const left = spacesFor(allSpaces, requirement.leftSpace), right = spacesFor(allSpaces, requirement.rightSpace);
  if (!left.supported || !right.supported) return manualResult(requirement, "当前 G4 语义别名表尚不支持该目标空间类型。");
  const relevant = [...left.spaces, ...right.spaces];
  if (!left.spaces.length || !right.spaces.length) {
    if (requirement.type === "space_separation") return { requirement, status: "satisfied", targetDescription: targetDescription(requirement), actualResult: "至少一类目标空间不存在，没有发现直接连接关系", reason: "当前可靠空间语义中不存在可形成冲突的空间对。", relatedObjectIds: relatedIds(relevant), measurements: [{ name: "matchingPairCount", value: 0, unit: "count", measurementBasis: "derived" }], thresholds: [], confidence: confidence("high", "可靠 Room–Zone 语义清单中没有可形成冲突的空间对") };
    return { requirement, status: "not_satisfied", targetDescription: targetDescription(requirement), actualResult: "未找到可建立关系的目标空间", reason: "至少一类目标空间在可靠 Room–Zone 语义中不存在。", relatedObjectIds: relatedIds(relevant), measurements: [{ name: "matchingPairCount", value: 0, unit: "count", measurementBasis: "derived" }], thresholds: [], confidence: confidence("high", "可靠空间语义清单中缺少目标空间") };
  }
  const qualifyingEdges = graph.edges.filter((edge) => requirement.relationship === "directly_connected" || edge.connectionType !== "stair");
  const directPairs: Array<{ left: SemanticSpace; right: SemanticSpace; sourceIds: string[] }> = [];
  left.spaces.forEach((leftSpace) => right.spaces.forEach((rightSpace) => {
    if (leftSpace.room.roomRegionId === rightSpace.room.roomRegionId) directPairs.push({ left: leftSpace, right: rightSpace, sourceIds: [] });
    else {
      const edges = qualifyingEdges.filter((edge) => (edge.fromNodeId === leftSpace.room.roomRegionId && edge.toNodeId === rightSpace.room.roomRegionId) || (edge.toNodeId === leftSpace.room.roomRegionId && edge.fromNodeId === rightSpace.room.roomRegionId));
      if (edges.length) directPairs.push({ left: leftSpace, right: rightSpace, sourceIds: edges.map((edge) => edge.sourceObjectId) });
    }
  }));
  const pairIds = [...new Set(directPairs.flatMap((pair) => [pair.left.room.roomRegionId, pair.right.room.roomRegionId, ...pair.left.zoneIds, ...pair.right.zoneIds, ...pair.sourceIds]))];
  if (requirement.type === "space_adjacency" && directPairs.length) return { requirement, status: "satisfied", targetDescription: targetDescription(requirement), actualResult: `找到 ${directPairs.length} 组可靠的直接关系`, reason: "复用了现有 Room Connectivity Graph、Door Portal 或同一 Room Region 的 Zone 关系。", relatedObjectIds: pairIds, measurements: [{ name: "directRelationshipCount", value: directPairs.length, unit: "count", measurementBasis: "derived" }], thresholds: [{ name: "minimumDirectRelationshipCount", value: 1, unit: "count" }], confidence: confidence("high", "存在明确连接边或同一可靠 Room Region 证据") };
  if (requirement.type === "space_separation" && directPairs.length) return { requirement, status: "not_satisfied", targetDescription: targetDescription(requirement), actualResult: `发现 ${directPairs.length} 组直接关系`, reason: "现有空间连接证据明确证明目标空间直接相邻或连通。", relatedObjectIds: pairIds, measurements: [{ name: "directRelationshipCount", value: directPairs.length, unit: "count", measurementBasis: "derived" }], thresholds: [{ name: "maximumDirectRelationshipCount", value: 0, unit: "count" }], confidence: confidence("high", "存在明确连接边或同一可靠 Room Region 证据") };
  const complete = relevant.every((space) => portalEvidenceComplete(handoff, graph, space.room));
  if (!complete) return manualResult(requirement, "现有 Portal 或 Room Connectivity Graph 不能完整证明目标空间边界上的所有直接连接关系，暂时无法自动确认。", relatedIds(relevant));
  return {
    requirement,
    status: requirement.type === "space_separation" ? "satisfied" : "not_satisfied",
    targetDescription: targetDescription(requirement),
    actualResult: "完整的直接连接证据中未找到目标空间之间的关系",
    reason: requirement.type === "space_separation" ? "相关房间边界上的门连接均已解析，未发现直接关系。" : "相关房间边界上的门连接均已解析，但未发现要求的直接关系。",
    relatedObjectIds: relatedIds(relevant),
    measurements: [{ name: "directRelationshipCount", value: 0, unit: "count", measurementBasis: "derived" }],
    thresholds: [{ name: requirement.type === "space_separation" ? "maximumDirectRelationshipCount" : "minimumDirectRelationshipCount", value: requirement.type === "space_separation" ? 0 : 1, unit: "count" }],
    confidence: confidence("medium", "相关 Room 边界的 Portal 证据完整且未发现直接关系"),
  };
}

function evaluateRequirement(
  requirement: CustomerRequirement,
  handoff: EvaluationHandoff,
  allSpaces: SemanticSpace[],
  graph: RoomConnectivityGraph,
): G4RequirementResult {
  if (requirement.type === "manual") return manualResult(requirement, requirement.manualReviewNote);
  if (!requirement.autoCheckSupported) return manualResult(requirement, requirement.manualReviewNote ?? "该需求当前不支持自动检查。");
  if (requirement.type === "space_adjacency" || requirement.type === "space_separation") return evaluateRelationship(requirement, handoff, allSpaces, graph);
  const matched = spacesFor(allSpaces, requirement.targetSpace);
  if (!matched.supported) return manualResult(requirement, "当前 G4 语义别名表尚不支持该目标空间类型。");
  const ids = relatedIds(matched.spaces), count = matched.spaces.length;
  if (requirement.type === "space_presence") return {
    requirement, status: count > 0 ? "satisfied" : "not_satisfied", targetDescription: targetDescription(requirement),
    actualResult: count > 0 ? `找到 ${count} 个匹配空间` : "未找到匹配空间",
    reason: count > 0 ? "目标语义已匹配到可靠 Room Region。" : "可靠 Room–Zone 语义清单中没有该类空间。",
    relatedObjectIds: ids, measurements: [{ name: "matchingSpaceCount", value: count, unit: "count", measurementBasis: "derived" }], thresholds: [{ name: "minimumSpaceCount", value: 1, unit: "count" }], confidence: confidence("high", "使用可靠 Room Region 并以 Zone 提供语义"),
  };
  if (requirement.type === "space_count") {
    const pass = valueMeets(count, requirement.quantity.min, requirement.quantity.max);
    return { requirement, status: pass ? "satisfied" : "not_satisfied", targetDescription: targetDescription(requirement), actualResult: `共 ${count} 个匹配空间`, reason: pass ? "匹配空间数量满足客户条件。" : "匹配空间数量未达到客户条件；Room 与 Zone 已按 Room Region 去重。", relatedObjectIds: ids, measurements: [{ name: "matchingSpaceCount", value: count, unit: "count", measurementBasis: "derived" }], thresholds: [requirement.quantity.min !== undefined ? { name: "minimumSpaceCount", value: requirement.quantity.min, unit: "count" } : { name: "maximumSpaceCount", value: requirement.quantity.max!, unit: "count" }], confidence: confidence("high", "以 Room Region 为唯一计数主体，Zone 只提供语义") };
  }
  if (requirement.type === "space_area") {
    if (!count) return { requirement, status: "not_satisfied", targetDescription: targetDescription(requirement), actualResult: "未找到可检查面积的匹配空间", reason: "可靠 Room–Zone 语义清单中没有目标空间。", relatedObjectIds: [], measurements: [{ name: "matchingSpaceCount", value: 0, unit: "count", measurementBasis: "derived" }], thresholds: [], confidence: confidence("high", "可靠空间语义清单中缺少目标空间") };
    const areas = matched.spaces.map((space) => space.room.areaSquareMeters);
    const selectedValue = requirement.area.mode === "total" ? areas.reduce((sum, area) => sum + area, 0) : requirement.area.mode === "any" ? Math.max(...areas) : Math.min(...areas);
    const pass = requirement.area.mode === "any"
      ? areas.some((area) => valueMeets(area, requirement.area.minSquareMeters, requirement.area.maxSquareMeters))
      : requirement.area.mode === "every"
        ? areas.every((area) => valueMeets(area, requirement.area.minSquareMeters, requirement.area.maxSquareMeters))
        : valueMeets(selectedValue, requirement.area.minSquareMeters, requirement.area.maxSquareMeters);
    return { requirement, status: pass ? "satisfied" : "not_satisfied", targetDescription: targetDescription(requirement), actualResult: `${requirement.area.mode === "total" ? "总面积" : requirement.area.mode === "any" ? "最大匹配面积" : "最小匹配面积"} ${meters(selectedValue)}`, reason: pass ? "Evaluation Handoff 的可靠 Room Region 面积满足客户条件。" : "Evaluation Handoff 的可靠 Room Region 面积未达到客户条件。", relatedObjectIds: ids, measurements: matched.spaces.map((space) => ({ name: "roomArea", value: Number(space.room.areaSquareMeters.toFixed(3)), unit: "m²", normalizedObjectId: space.room.roomRegionId, measurementBasis: "derived" })), thresholds: [requirement.area.minSquareMeters !== undefined ? { name: "minimumArea", value: requirement.area.minSquareMeters, unit: "m²" } : { name: "maximumArea", value: requirement.area.maxSquareMeters!, unit: "m²" }], confidence: confidence("high", "直接复用 Room Region 的可靠面积，不重新计算几何") };
  }
  const requestedLevel = requirement.level.levelId
    ? handoff.levels.find((level) => level.id === requirement.level.levelId)
    : requirement.level.ordinal !== undefined
      ? handoff.levels.find((level) => level.ordinal === requirement.level.ordinal)
      : handoff.levels.find((level) => normalize(level.name ?? "") === normalize(requirement.level.name ?? ""));
  if (!requestedLevel) return manualResult(requirement, "需求指定的稳定 Level 标识在当前方案中不存在，无法可靠匹配楼层。", ids);
  const onLevel = matched.spaces.filter((space) => space.room.levelId === requestedLevel.id), min = requirement.quantity?.min ?? 1, max = requirement.quantity?.max, pass = valueMeets(onLevel.length, min, max);
  return { requirement, status: pass ? "satisfied" : "not_satisfied", targetDescription: targetDescription(requirement), actualResult: `${requestedLevel.name ?? requestedLevel.id} 有 ${onLevel.length} 个匹配空间（方案共 ${count} 个）`, reason: pass ? "目标空间的稳定 levelId 满足客户楼层条件。" : "目标楼层上的匹配空间数量未达到客户条件。", relatedObjectIds: relatedIds(matched.spaces, [requestedLevel.id]), measurements: [{ name: "matchingSpaceCountOnLevel", value: onLevel.length, unit: "count", measurementBasis: "derived" }, { name: "matchingSpaceCountAllLevels", value: count, unit: "count", measurementBasis: "derived" }], thresholds: [{ name: "minimumSpaceCountOnLevel", value: min, unit: "count" }], confidence: confidence("high", "优先使用 Requirement Handoff 中的稳定 levelId") };
}

export function evaluateG4Requirements(handoff: EvaluationHandoff, requirementHandoff: RequirementHandoff, analysis = buildRoomRegionAnalysis(handoff), graph = buildRoomConnectivityGraph(handoff, analysis)): G4RequirementResult[] {
  const spaces = semanticSpaces(handoff, analysis);
  return requirementHandoff.requirements.map((requirement) => evaluateRequirement(requirement, handoff, spaces, graph));
}

export function g4ResultToRuleResult(result: G4RequirementResult, handoff: EvaluationHandoff): RuleResult {
  const status = result.status === "satisfied" ? "pass" : result.status === "not_satisfied" ? "issue" : "unable_to_determine";
  const pascalIds = new Set([...handoff.zones, ...handoff.doors, ...handoff.levels].map((item) => item.id));
  return {
    ruleId: `G4-${result.requirement.id}`,
    ruleName: result.requirement.name,
    status,
    severity: status === "issue" ? "warning" : "info",
    summary: `${result.actualResult}。${result.reason}`,
    details: [`客户目标：${result.targetDescription}`, `方案实际：${result.actualResult}`, result.reason],
    normalizedObjectIds: result.relatedObjectIds,
    pascalSourceIds: result.relatedObjectIds.filter((id) => pascalIds.has(id)),
    measurements: result.measurements,
    thresholds: result.thresholds,
    missingData: status === "unable_to_determine" ? [result.reason] : [],
    confidence: result.confidence,
    diagnostics: status === "pass" ? [] : [{
      severity: status === "issue" ? "warning" : "info",
      code: status === "issue" ? "customer_requirement_not_satisfied" : "customer_requirement_manual_review",
      message: result.reason,
      normalizedObjectIds: result.relatedObjectIds,
      origin: status === "issue" ? "rule" : "insufficient_information",
      recommendation: status === "issue" ? "调整方案以满足该客户需求，或与客户确认是否接受当前结果。" : result.requirement.manualReviewNote ?? "请人工核对该客户需求。",
    }],
    applicability: { status: "applicable", reasons: ["客户需求已通过 Requirement Handoff 明确提供"] },
    dataSufficiency: { status: status === "unable_to_determine" ? "insufficient" : "sufficient", missingFields: status === "unable_to_determine" ? [result.reason] : [] },
    customerRequirement: {
      requirementId: result.requirement.id,
      requirementType: result.requirement.type,
      targetDescription: result.targetDescription,
      actualResult: result.actualResult,
      reason: result.reason,
      originalDescription: result.requirement.originalDescription,
    },
  };
}

export function evaluateG4RequirementRules(handoff: EvaluationHandoff, requirements: RequirementHandoff, analysis?: RoomRegionAnalysis, graph?: RoomConnectivityGraph): RuleResult[] {
  return evaluateG4Requirements(handoff, requirements, analysis, graph).map((result) => g4ResultToRuleResult(result, handoff));
}
