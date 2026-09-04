import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import type { CustomerRequirement, RequirementHandoff } from "../requirements/requirement-handoff";
import { buildRoomConnectivityGraph, findShortestRoomPath, type ConnectivityConfidence, type RoomConnectivityGraph } from "./connectivity";
import { canonicalSpaceSemantic, resolveZoneFunctionalSemantics, type SpaceSemanticSource } from "./space-semantics";
import { scoreS1FunctionalRelationships, type S1FunctionalRelationScoreSummary } from "./s1-functional-relation-scoring";
import { measureS1PublicCirculationPrivacy, type S1PublicCirculationPrivacyReport } from "./s1-public-circulation-privacy";
import { scoreS1PublicCirculationPrivacy, type S1PublicCirculationPrivacyScoreSummary } from "./s1-public-circulation-privacy-scoring";
import { measureS1HighFrequencyPaths, type S1HighFrequencyPathReport } from "./s1-high-frequency-path";
import { scoreS1HighFrequencyPaths, type S1HighFrequencyPathScoreSummary } from "./s1-high-frequency-path-scoring";
import type { RoomNavigationAnalysis } from "./navigation";
import { measureS1PathConflicts, type S1PathConflictReport } from "./s1-path-conflict";
import { measureS1SpaceFragments, type S1SpaceFragmentReport } from "./s1-space-fragment";
import { measureS1Furniture, type S1FurnitureReport } from "./s1-furniture";

export const S1_GATE_ALLOWED_STATUSES = ["pass", "not_applicable"] as const;
export const S1_FUNCTIONAL_RELATIONSHIP_PAIRS = [
  { pairId: "S1-REL-001", label: "厨房—餐厅空间关系", sourceSemantic: "kitchen", targetSemantic: "dining" },
  { pairId: "S1-REL-002", label: "主卧—主卫空间关系", sourceSemantic: "primary_bedroom", targetSemantic: "primary_bathroom" },
] as const;

export type S1GateBlockingResult = { ruleId: string; status: string };
export type S1GateResult = { allowed: boolean; evaluatedRuleCount: number; allowedStatuses: readonly string[]; blockingResults: S1GateBlockingResult[] };
export type S1MeasurementStatus = "measured" | "not_applicable" | "unable_to_determine";
export type S1RelationType = "same_open_space" | "direct_connection" | "one_intermediate_space" | "multiple_intermediate_spaces" | "different_level";
export type S1FunctionalSpaceRef = { semantic: string; semanticSource: SpaceSemanticSource; spaceFunctionCodes: string[]; spaceFunctionNames: string[]; zoneIds: string[]; zoneNames: string[]; roomRegionId: string; levelId: string; confidence: ConnectivityConfidence };
export type S1FunctionalRelationshipMeasurement = {
  metricId: "functional_space_relationship";
  measurementId: string;
  label: string;
  sourceSemantic: string;
  targetSemantic: string;
  source: S1FunctionalSpaceRef | null;
  target: S1FunctionalSpaceRef | null;
  status: S1MeasurementStatus;
  relationType: S1RelationType | null;
  topologicalSteps: number | null;
  pathRoomRegionIds: string[];
  intermediateRoomRegionIds: string[];
  connectionDoorIds: string[];
  connectionStairIds: string[];
  confidence: ConnectivityConfidence;
  diagnostics: string[];
  missingData: string[];
  coveredByG4Requirement: boolean;
  coveredByG4RequirementIds: string[];
};
export type S1FunctionalRelationshipReport = { reportVersion: "0.9"; status: "measured"; generatedAt: string; gate: S1GateResult; measurements: S1FunctionalRelationshipMeasurement[]; counts: Record<S1MeasurementStatus, number>; functionalRelationScoring: S1FunctionalRelationScoreSummary; publicCirculationPrivacy: S1PublicCirculationPrivacyReport; publicCirculationPrivacyScoring: S1PublicCirculationPrivacyScoreSummary; highFrequencyPathEfficiency: S1HighFrequencyPathReport; highFrequencyPathEfficiencyScoring: S1HighFrequencyPathScoreSummary; pathConflictInteraction: S1PathConflictReport; spaceFragmentShape: S1SpaceFragmentReport; furnitureRelationshipAndUseSpace: S1FurnitureReport };

/** G1-G4 are a strict allow-list gate. Unknown and future statuses block S1 by default. */
export function evaluateS1Gate(results: ReadonlyArray<{ ruleId: string; status: string }>): S1GateResult {
  const gateResults = results.filter((result) => /^G[1-4]-/.test(result.ruleId)), allowed = new Set<string>(S1_GATE_ALLOWED_STATUSES);
  const blockingResults = gateResults.filter((result) => !allowed.has(result.status)).map(({ ruleId, status }) => ({ ruleId, status }));
  return { allowed: gateResults.length > 0 && blockingResults.length === 0, evaluatedRuleCount: gateResults.length, allowedStatuses: S1_GATE_ALLOWED_STATUSES, blockingResults };
}

const confidenceRank = { low: 0, medium: 1, high: 2 } as const;
const lowerConfidence = (values: ConnectivityConfidence[]) => values.reduce<ConnectivityConfidence>((lowest, value) => confidenceRank[value] < confidenceRank[lowest] ? value : lowest, "high");
const reliableZoneMatch = (relationship: string | undefined) => relationship === "one-to-one" || relationship === "room-with-multiple-zones";

function resolveSemanticSpace(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, semantic: string): { space: S1FunctionalSpaceRef | null; status: Extract<S1MeasurementStatus, "not_applicable" | "unable_to_determine"> | null; diagnostics: string[]; missingData: string[] } {
  const matches = handoff.zones.map((zone) => ({ zone, resolution: resolveZoneFunctionalSemantics(zone) })).filter((candidate) => candidate.resolution.semantics.has(semantic));
  const codedMatches = matches.filter((candidate) => candidate.resolution.semanticSource === "sdi_code"), candidates = codedMatches.length ? codedMatches : matches;
  if (!candidates.length) return { space: null, status: "not_applicable", diagnostics: [`未识别到 ${semantic} 功能 Zone`], missingData: [] };
  const roomById = new Map(graph.roomAnalysis.rooms.map((room) => [room.roomRegionId, room]));
  const matchByZone = new Map(graph.roomAnalysis.zoneMatches.map((match) => [match.zoneId, match]));
  const invalid = candidates.filter(({ zone }) => { const match = matchByZone.get(zone.id), roomId = match?.matchedRoomRegionIds.length === 1 ? match.matchedRoomRegionIds[0] : null, room = roomId ? roomById.get(roomId) : null; return !roomId || !room?.usableForEvaluation || !reliableZoneMatch(match?.relationship); });
  if (invalid.length) return { space: null, status: "unable_to_determine", diagnostics: [`${semantic} Zone 无法可靠映射到可评价 Room Region：${invalid.map(({ zone }) => zone.name ?? zone.id).join("、")}`, ...candidates.flatMap((candidate) => candidate.resolution.diagnostics)], missingData: invalid.map(({ zone }) => `${zone.id}: 可靠 Zone–RoomRegion 映射`) };
  const byRoom = new Map<string, typeof candidates>();
  candidates.forEach((candidate) => { const roomId = matchByZone.get(candidate.zone.id)!.matchedRoomRegionIds[0]!; byRoom.set(roomId, [...(byRoom.get(roomId) ?? []), candidate]); });
  if (byRoom.size !== 1) return { space: null, status: "unable_to_determine", diagnostics: [`${semantic} 匹配到 ${byRoom.size} 个候选 Room Region，无法可靠区分`], missingData: [`${semantic}: 唯一功能空间候选`] };
  const [roomRegionId, roomMatches] = [...byRoom.entries()][0]!, room = roomById.get(roomRegionId)!, sources = roomMatches.map((match) => match.resolution.semanticSource), semanticSource: SpaceSemanticSource = sources.every((source) => source === "sdi_code") ? "sdi_code" : sources.some((source) => source === "name_fallback") ? "name_fallback" : "unknown";
  return { space: { semantic, semanticSource, spaceFunctionCodes: roomMatches.flatMap((match) => match.resolution.spaceFunctionCode ? [match.resolution.spaceFunctionCode] : []), spaceFunctionNames: roomMatches.flatMap((match) => match.resolution.spaceFunctionName ? [match.resolution.spaceFunctionName] : []), zoneIds: roomMatches.map((match) => match.zone.id), zoneNames: roomMatches.map((match) => match.zone.name?.trim() || match.zone.id), roomRegionId, levelId: room.levelId, confidence: lowerConfidence([room.confidence, ...roomMatches.map((match) => matchByZone.get(match.zone.id)!.confidence)]) }, status: null, diagnostics: roomMatches.flatMap((match) => match.resolution.diagnostics), missingData: [] };
}

function coveredG4Requirements(requirements: RequirementHandoff | null | undefined, sourceSemantic: string, targetSemantic: string): string[] {
  if (!requirements) return [];
  const source = canonicalSpaceSemantic(sourceSemantic), target = canonicalSpaceSemantic(targetSemantic);
  return requirements.requirements.filter((requirement): requirement is Extract<CustomerRequirement, { type: "space_adjacency" | "space_separation" }> => (requirement.type === "space_adjacency" || requirement.type === "space_separation") && ((canonicalSpaceSemantic(requirement.leftSpace.semantic) === source && canonicalSpaceSemantic(requirement.rightSpace.semantic) === target) || (canonicalSpaceSemantic(requirement.leftSpace.semantic) === target && canonicalSpaceSemantic(requirement.rightSpace.semantic) === source))).map((requirement) => requirement.id);
}

function measurePair(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, requirements: RequirementHandoff | null | undefined, pair: typeof S1_FUNCTIONAL_RELATIONSHIP_PAIRS[number]): S1FunctionalRelationshipMeasurement {
  const sourceResult = resolveSemanticSpace(handoff, graph, pair.sourceSemantic), targetResult = resolveSemanticSpace(handoff, graph, pair.targetSemantic), coveredByG4RequirementIds = coveredG4Requirements(requirements, pair.sourceSemantic, pair.targetSemantic);
  const base = { metricId: "functional_space_relationship" as const, measurementId: pair.pairId, label: pair.label, sourceSemantic: pair.sourceSemantic, targetSemantic: pair.targetSemantic, source: sourceResult.space, target: targetResult.space, coveredByG4Requirement: coveredByG4RequirementIds.length > 0, coveredByG4RequirementIds };
  const unresolved = [sourceResult, targetResult].find((result) => result.status === "unable_to_determine");
  if (unresolved) return { ...base, status: "unable_to_determine", relationType: null, topologicalSteps: null, pathRoomRegionIds: [], intermediateRoomRegionIds: [], connectionDoorIds: [], connectionStairIds: [], confidence: "low", diagnostics: [...sourceResult.diagnostics, ...targetResult.diagnostics], missingData: [...sourceResult.missingData, ...targetResult.missingData] };
  const absent = [sourceResult, targetResult].find((result) => result.status === "not_applicable");
  if (absent) return { ...base, status: "not_applicable", relationType: null, topologicalSteps: null, pathRoomRegionIds: [], intermediateRoomRegionIds: [], connectionDoorIds: [], connectionStairIds: [], confidence: "low", diagnostics: [...sourceResult.diagnostics, ...targetResult.diagnostics], missingData: [] };
  const source = sourceResult.space!, target = targetResult.space!, path = findShortestRoomPath(graph, source.roomRegionId, target.roomRegionId);
  if (!path) return { ...base, status: "unable_to_determine", relationType: null, topologicalSteps: null, pathRoomRegionIds: [], intermediateRoomRegionIds: [], connectionDoorIds: [], connectionStairIds: [], confidence: lowerConfidence([source.confidence, target.confidence]), diagnostics: ["两个功能空间之间不存在可靠的 Room Connectivity Graph 路径"], missingData: ["可靠 Room Connectivity Graph 路径"] };
  const topologicalSteps = path.edges.length, relationType: S1RelationType = source.levelId !== target.levelId ? "different_level" : topologicalSteps === 0 ? "same_open_space" : topologicalSteps === 1 ? "direct_connection" : topologicalSteps === 2 ? "one_intermediate_space" : "multiple_intermediate_spaces";
  return { ...base, status: "measured", relationType, topologicalSteps, pathRoomRegionIds: path.roomRegionIds, intermediateRoomRegionIds: path.roomRegionIds.slice(1, -1), connectionDoorIds: path.edges.filter((edge) => edge.connectionType === "door").map((edge) => edge.sourceObjectId), connectionStairIds: path.edges.filter((edge) => edge.connectionType === "stair").map((edge) => edge.sourceObjectId), confidence: lowerConfidence([source.confidence, target.confidence, ...path.edges.map((edge) => edge.confidence)]), diagnostics: [...sourceResult.diagnostics, ...targetResult.diagnostics], missingData: [] };
}

export function measureS1FunctionalRelationships(handoff: EvaluationHandoff, gate: S1GateResult, requirements: RequirementHandoff | null = null, generatedAt = new Date().toISOString(), graph = buildRoomConnectivityGraph(handoff), navigation?: RoomNavigationAnalysis): S1FunctionalRelationshipReport {
  if (!gate.allowed) throw new Error("S1_GATE_BLOCKED");
  const measurements = measureS1FunctionalRelationshipPairs(handoff, graph, requirements);
  const counts = Object.fromEntries((["measured", "not_applicable", "unable_to_determine"] as const).map((status) => [status, measurements.filter((measurement) => measurement.status === status).length])) as Record<S1MeasurementStatus, number>;
  const publicCirculationPrivacy = measureS1PublicCirculationPrivacy(handoff, graph), highFrequencyPathEfficiency = measureS1HighFrequencyPaths(handoff, graph, navigation), highFrequencyPathEfficiencyScoring = scoreS1HighFrequencyPaths(highFrequencyPathEfficiency, handoff, graph);
  return { reportVersion: "0.9", status: "measured", generatedAt, gate, measurements, counts, functionalRelationScoring: scoreS1FunctionalRelationships(measurements, handoff, graph), publicCirculationPrivacy, publicCirculationPrivacyScoring: scoreS1PublicCirculationPrivacy(publicCirculationPrivacy), highFrequencyPathEfficiency, highFrequencyPathEfficiencyScoring, pathConflictInteraction: measureS1PathConflicts(highFrequencyPathEfficiency), spaceFragmentShape: measureS1SpaceFragments(handoff, graph, navigation), furnitureRelationshipAndUseSpace: measureS1Furniture(handoff) };
}

/** Lightweight formal reuse point for axes that need SO-01/SO-02 but not the other S1 measurements. */
export function measureS1FunctionalRelationshipPairs(handoff: EvaluationHandoff, graph = buildRoomConnectivityGraph(handoff), requirements: RequirementHandoff | null = null) {
  return S1_FUNCTIONAL_RELATIONSHIP_PAIRS.map((pair) => measurePair(handoff, graph, requirements, pair));
}
