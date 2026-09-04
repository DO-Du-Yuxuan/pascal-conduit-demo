import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { isSdiSpaceFunctionCode } from "../space-functions/sdi-space-functions";
import { findShortestRoomPath, type ConnectivityConfidence, type RoomConnectivityGraph, type ShortestRoomPath } from "./connectivity";
import { resolveZoneFunctionalSemantics } from "./space-semantics";

export const S1_PUBLIC_CIRCULATION_PRIVACY_VERSION = "v0.1" as const;
export const S1_PRIVATE_SPACE_FUNCTION_CODES = ["SF11", "SF12", "SF13", "SF14", "SF21", "SF03", "SF15"] as const;

const reliableZoneMatch = (relationship: string | undefined) => relationship === "one-to-one" || relationship === "room-with-multiple-zones";
const confidenceRank = { low: 0, medium: 1, high: 2 } as const;
const lowerConfidence = (values: ConnectivityConfidence[]) => values.reduce<ConnectivityConfidence>((lowest, value) => confidenceRank[value] < confidenceRank[lowest] ? value : lowest, "high");

export type S1PublicRouteGroupId = "entry_to_public" | "visitor_to_public_bathroom" | "public_to_public_outdoor" | "garage_return";
export type S1PublicRouteResultType = "privacy_safe_route_available" | "private_space_mandatory" | "baseline_unreachable" | "unable_to_determine" | "not_applicable";
export type S1PublicRouteStatus = "measured" | "unable_to_determine" | "not_applicable";
export type S1PublicRouteSemanticSource = "sdi_code" | "graph_entrance" | "unknown";

export type S1PublicRouteSpaceRef = {
  roomRegionId: string;
  levelId: string;
  zoneIds: string[];
  zoneNames: string[];
  spaceFunctionCodes: string[];
  semanticSource: S1PublicRouteSemanticSource;
  confidence: ConnectivityConfidence;
};

export type S1PublicCirculationRouteMeasurement = {
  metricId: "public_circulation_privacy";
  routeId: string;
  routeGroup: S1PublicRouteGroupId;
  routeGroupLabel: string;
  source: S1PublicRouteSpaceRef | null;
  target: S1PublicRouteSpaceRef | null;
  sourceRoomRegionId: string | null;
  targetRoomRegionId: string | null;
  sourceZoneIds: string[];
  targetZoneIds: string[];
  sourceSpaceFunctionCodes: string[];
  targetSpaceFunctionCodes: string[];
  baselineReachable: boolean | null;
  privacySafeReachable: boolean | null;
  resultType: S1PublicRouteResultType;
  baselinePathRoomRegionIds: string[];
  privacySafePathRoomRegionIds: string[];
  witnessPathRoomRegionIds: string[];
  privateIntermediateRoomRegionIds: string[];
  connectionDoorIds: string[];
  connectionStairIds: string[];
  levelIds: string[];
  semanticSource: S1PublicRouteSemanticSource;
  confidence: ConnectivityConfidence;
  status: S1PublicRouteStatus;
  diagnostics: string[];
  missingData: string[];
};

export type S1PublicRouteGroupSummary = {
  routeGroup: S1PublicRouteGroupId;
  label: string;
  status: "measured" | "unable_to_determine" | "not_applicable";
  routeCount: number;
  diagnostics: string[];
};

export type S1PublicCirculationPrivacyReport = {
  metricId: "public_circulation_privacy";
  metricName: "公共动线穿越私密空间";
  measurementVersion: typeof S1_PUBLIC_CIRCULATION_PRIVACY_VERSION;
  scoringStatus: "not_scored";
  measurements: S1PublicCirculationRouteMeasurement[];
  groups: S1PublicRouteGroupSummary[];
  counts: {
    generatedRoutes: number;
    privacySafeRoutes: number;
    privateMandatoryRoutes: number;
    baselineUnreachableRoutes: number;
    unableToDetermineRoutes: number;
    notApplicableRouteGroups: number;
  };
  affectedPublicTargetRoomRegionIds: string[];
  privateIntermediateRoomRegionIds: string[];
  privateWitnessPathAppearances: Array<{ roomRegionId: string; routeCount: number }>;
};

type RouteGroupConfig = {
  id: S1PublicRouteGroupId;
  label: string;
  sourceCodes: string[];
  targetCodes: string[];
  sourceSemantics: string[];
  targetSemantics: string[];
};

const routeGroups: RouteGroupConfig[] = [
  { id: "entry_to_public", label: "入户到公共空间", sourceCodes: ["SF10"], targetCodes: ["SF06", "SF07", "SF04", "SF27", "SF28"], sourceSemantics: ["entry"], targetSemantics: ["living_room", "dining", "bathroom", "recreation"] },
  { id: "visitor_to_public_bathroom", label: "访客空间到公卫", sourceCodes: ["SF06", "SF07", "SF27", "SF28"], targetCodes: ["SF04"], sourceSemantics: ["living_room", "dining", "recreation"], targetSemantics: ["bathroom"] },
  { id: "public_to_public_outdoor", label: "公共空间到公共户外", sourceCodes: ["SF06", "SF07", "SF27", "SF28"], targetCodes: ["SF51", "SF52", "SF54"], sourceSemantics: ["living_room", "dining", "recreation"], targetSemantics: [] },
  { id: "garage_return", label: "车库返回住宅", sourceCodes: ["SF30"], targetCodes: ["SF08", "SF09", "SF01", "SF02", "SF06", "SF07"], sourceSemantics: ["garage"], targetSemantics: ["foyer", "circulation", "kitchen", "living_room", "dining"] },
];

function pathWithoutRooms(graph: RoomConnectivityGraph, sourceRoomId: string, targetRoomId: string, excludedRoomIds: Set<string>): ShortestRoomPath | null {
  const excluded = new Set([...excludedRoomIds].filter((roomId) => roomId !== sourceRoomId && roomId !== targetRoomId));
  return findShortestRoomPath({ ...graph, nodes: graph.nodes.filter((node) => !excluded.has(node.nodeId)), edges: graph.edges.filter((edge) => !excluded.has(edge.fromNodeId) && !excluded.has(edge.toNodeId)) }, sourceRoomId, targetRoomId);
}

/** Raw graph operation used by this metric. Endpoints are always preserved. */
export function findPrivacySafeRoomPath(graph: RoomConnectivityGraph, sourceRoomId: string, targetRoomId: string, privateRoomIds: ReadonlySet<string>) {
  const baselinePath = findShortestRoomPath(graph, sourceRoomId, targetRoomId);
  return { baselinePath, privacySafePath: baselinePath ? pathWithoutRooms(graph, sourceRoomId, targetRoomId, new Set(privateRoomIds)) : null };
}

function codedSpaces(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, codes: string[]) {
  const codeSet = new Set(codes), roomById = new Map(graph.roomAnalysis.rooms.map((room) => [room.roomRegionId, room])), matchByZone = new Map(graph.roomAnalysis.zoneMatches.map((match) => [match.zoneId, match]));
  const relevant = handoff.zones.filter((zone) => isSdiSpaceFunctionCode(zone.spaceFunctionCode) && codeSet.has(zone.spaceFunctionCode));
  const invalid = relevant.filter((zone) => { const match = matchByZone.get(zone.id), roomId = match?.matchedRoomRegionIds.length === 1 ? match.matchedRoomRegionIds[0] : null; return !roomId || !roomById.get(roomId)?.usableForEvaluation || !reliableZoneMatch(match?.relationship); });
  const byRoom = new Map<string, typeof relevant>();
  relevant.filter((zone) => !invalid.includes(zone)).forEach((zone) => { const roomId = matchByZone.get(zone.id)!.matchedRoomRegionIds[0]!; byRoom.set(roomId, [...(byRoom.get(roomId) ?? []), zone]); });
  const spaces = [...byRoom.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([roomRegionId, zones]): S1PublicRouteSpaceRef => {
    const room = roomById.get(roomRegionId)!;
    return { roomRegionId, levelId: room.levelId, zoneIds: zones.map((zone) => zone.id).sort(), zoneNames: zones.map((zone) => zone.name?.trim() || zone.id), spaceFunctionCodes: [...new Set(zones.map((zone) => zone.spaceFunctionCode!))].sort(), semanticSource: "sdi_code", confidence: lowerConfidence([room.confidence, ...zones.map((zone) => matchByZone.get(zone.id)!.confidence)]) };
  });
  return { spaces, invalid };
}

function hasFallbackSemantic(handoff: EvaluationHandoff, semantics: string[]) {
  const set = new Set(semantics);
  return semantics.length > 0 && handoff.zones.some((zone) => { const resolution = resolveZoneFunctionalSemantics(zone); return resolution.semanticSource === "name_fallback" && [...resolution.semantics].some((semantic) => set.has(semantic)); });
}

function entranceFallback(graph: RoomConnectivityGraph): S1PublicRouteSpaceRef[] {
  const roomId = graph.entrance.selectedRoomRegionId, room = roomId ? graph.roomAnalysis.rooms.find((candidate) => candidate.roomRegionId === roomId && candidate.usableForEvaluation) : null;
  if (!room) return [];
  return [{ roomRegionId: room.roomRegionId, levelId: room.levelId, zoneIds: graph.roomAnalysis.roomToZoneIds[room.roomRegionId] ?? [], zoneNames: [], spaceFunctionCodes: [], semanticSource: "graph_entrance", confidence: lowerConfidence([room.confidence, graph.entrance.confidence]) }];
}

function garageHasInternalConnection(graph: RoomConnectivityGraph, garage: S1PublicRouteSpaceRef, garageRoomIds: Set<string>) {
  return graph.edges.some((edge) => edge.connectionType !== "stair" && ((edge.fromNodeId === garage.roomRegionId && !garageRoomIds.has(edge.toNodeId) && graph.nodes.some((node) => node.nodeType === "room" && node.nodeId === edge.toNodeId)) || (edge.toNodeId === garage.roomRegionId && !garageRoomIds.has(edge.fromNodeId) && graph.nodes.some((node) => node.nodeType === "room" && node.nodeId === edge.fromNodeId))));
}

function routeId(group: S1PublicRouteGroupId, sourceRoomId: string, targetRoomId: string) {
  return `S1-PCP-${group}-${sourceRoomId}-${targetRoomId}`;
}

function unresolvedRoute(config: RouteGroupConfig, resultType: "unable_to_determine" | "not_applicable", diagnostics: string[], missingData: string[] = []): S1PublicCirculationRouteMeasurement {
  return { metricId: "public_circulation_privacy", routeId: `S1-PCP-${config.id}-${resultType}`, routeGroup: config.id, routeGroupLabel: config.label, source: null, target: null, sourceRoomRegionId: null, targetRoomRegionId: null, sourceZoneIds: [], targetZoneIds: [], sourceSpaceFunctionCodes: [], targetSpaceFunctionCodes: [], baselineReachable: null, privacySafeReachable: null, resultType, baselinePathRoomRegionIds: [], privacySafePathRoomRegionIds: [], witnessPathRoomRegionIds: [], privateIntermediateRoomRegionIds: [], connectionDoorIds: [], connectionStairIds: [], levelIds: [], semanticSource: "unknown", confidence: "low", status: resultType, diagnostics, missingData };
}

function measureRoute(graph: RoomConnectivityGraph, source: S1PublicRouteSpaceRef, target: S1PublicRouteSpaceRef, privateRoomIds: Set<string>, config: RouteGroupConfig): S1PublicCirculationRouteMeasurement {
  const { baselinePath: baseline, privacySafePath: safe } = findPrivacySafeRoomPath(graph, source.roomRegionId, target.roomRegionId, privateRoomIds);
  const base = { metricId: "public_circulation_privacy" as const, routeId: routeId(config.id, source.roomRegionId, target.roomRegionId), routeGroup: config.id, routeGroupLabel: config.label, source, target, sourceRoomRegionId: source.roomRegionId, targetRoomRegionId: target.roomRegionId, sourceZoneIds: source.zoneIds, targetZoneIds: target.zoneIds, sourceSpaceFunctionCodes: source.spaceFunctionCodes, targetSpaceFunctionCodes: target.spaceFunctionCodes, semanticSource: source.semanticSource === "sdi_code" && target.semanticSource === "sdi_code" ? "sdi_code" as const : source.semanticSource === "graph_entrance" ? "graph_entrance" as const : "unknown" as const };
  if (!baseline) return { ...base, baselineReachable: false, privacySafeReachable: null, resultType: "baseline_unreachable", baselinePathRoomRegionIds: [], privacySafePathRoomRegionIds: [], witnessPathRoomRegionIds: [], privateIntermediateRoomRegionIds: [], connectionDoorIds: [], connectionStairIds: [], levelIds: [...new Set([source.levelId, target.levelId])], confidence: lowerConfidence([source.confidence, target.confidence]), status: "measured", diagnostics: ["起点与目的空间在原始空间图中不可达，本项不重复评价。"], missingData: [] };
  const selectedPath = safe ?? baseline;
  const privateIntermediateRoomRegionIds = baseline.roomRegionIds.slice(1, -1).filter((roomId) => privateRoomIds.has(roomId));
  const levelByRoom = new Map(graph.roomAnalysis.rooms.map((room) => [room.roomRegionId, room.levelId]));
  return { ...base, baselineReachable: true, privacySafeReachable: Boolean(safe), resultType: safe ? "privacy_safe_route_available" : "private_space_mandatory", baselinePathRoomRegionIds: baseline.roomRegionIds, privacySafePathRoomRegionIds: safe?.roomRegionIds ?? [], witnessPathRoomRegionIds: safe ? [] : baseline.roomRegionIds, privateIntermediateRoomRegionIds: safe ? [] : privateIntermediateRoomRegionIds, connectionDoorIds: selectedPath.edges.filter((edge) => edge.connectionType === "door").map((edge) => edge.sourceObjectId), connectionStairIds: selectedPath.edges.filter((edge) => edge.connectionType === "stair").map((edge) => edge.sourceObjectId), levelIds: [...new Set(selectedPath.roomRegionIds.map((roomId) => levelByRoom.get(roomId)).filter((id): id is string => Boolean(id)))], confidence: lowerConfidence([source.confidence, target.confidence, ...selectedPath.edges.map((edge) => edge.confidence)]), status: "measured", diagnostics: [safe ? "存在不穿越私密空间的可行路线。" : "前往该公共空间的所有可行路线都必须经过私密空间。"], missingData: [] };
}

export function measureS1PublicCirculationPrivacy(handoff: EvaluationHandoff, graph: RoomConnectivityGraph): S1PublicCirculationPrivacyReport {
  const privateResolution = codedSpaces(handoff, graph, [...S1_PRIVATE_SPACE_FUNCTION_CODES]), privateRoomIds = new Set(privateResolution.spaces.map((space) => space.roomRegionId));
  const measurements: S1PublicCirculationRouteMeasurement[] = [], groups: S1PublicRouteGroupSummary[] = [];
  for (const config of routeGroups) {
    let sourceResolution = codedSpaces(handoff, graph, config.sourceCodes), targetResolution = codedSpaces(handoff, graph, config.targetCodes);
    let sources = sourceResolution.spaces, targets = targetResolution.spaces;
    if (config.id === "entry_to_public" && !sources.length && !sourceResolution.invalid.length) sources = entranceFallback(graph);
    if (config.id === "garage_return") { const garageRoomIds = new Set(sources.map((source) => source.roomRegionId)); sources = sources.filter((source) => garageHasInternalConnection(graph, source, garageRoomIds)); }
    const invalid = [...sourceResolution.invalid, ...targetResolution.invalid];
    const fallbackOnly = (!sources.length && hasFallbackSemantic(handoff, config.sourceSemantics)) || (!targets.length && hasFallbackSemantic(handoff, config.targetSemantics));
    if (invalid.length || fallbackOnly || (config.id === "entry_to_public" && !sources.length && graph.entrance.candidateDoorIds.length > 0)) {
      const diagnostics = invalid.length ? [`${invalid.map((zone) => zone.name ?? zone.id).join("、")} 无法可靠映射到 RoomRegion`] : fallbackOnly ? ["相关空间尚未绑定 SDI 空间功能编码，名称识别仅用于旧数据兼容，不能生成正式 S1 测量结果。"] : graph.entrance.diagnostics.map((item) => item.message);
      measurements.push(unresolvedRoute(config, "unable_to_determine", diagnostics, invalid.map((zone) => `${zone.id}: 可靠 Zone–RoomRegion 映射`)));
      groups.push({ routeGroup: config.id, label: config.label, status: "unable_to_determine", routeCount: 0, diagnostics });
      continue;
    }
    if (!sources.length || !targets.length) {
      const reason = config.id === "garage_return" && sourceResolution.spaces.length ? "车库没有可靠的住宅内部连接，本路线组不适用。" : `缺少${!sources.length ? "起点" : "目的"}空间，本路线组不适用。`;
      groups.push({ routeGroup: config.id, label: config.label, status: "not_applicable", routeCount: 0, diagnostics: [reason] });
      continue;
    }
    const routes = sources.flatMap((source) => targets.filter((target) => target.roomRegionId !== source.roomRegionId || config.id !== "garage_return").map((target) => measureRoute(graph, source, target, privateRoomIds, config))).sort((a, b) => a.routeId.localeCompare(b.routeId));
    measurements.push(...routes);
    groups.push({ routeGroup: config.id, label: config.label, status: "measured", routeCount: routes.length, diagnostics: [] });
  }
  if (privateResolution.invalid.length) {
    const diagnostic = `私密空间 ${privateResolution.invalid.map((zone) => zone.name ?? zone.id).join("、")} 无法可靠映射到 RoomRegion`;
    measurements.splice(0, measurements.length, ...routeGroups.map((config) => unresolvedRoute(config, "unable_to_determine", [diagnostic], privateResolution.invalid.map((zone) => `${zone.id}: 可靠 Zone–RoomRegion 映射`))));
    groups.splice(0, groups.length, ...routeGroups.map((config) => ({ routeGroup: config.id, label: config.label, status: "unable_to_determine" as const, routeCount: 0, diagnostics: [diagnostic] })));
  }
  const measuredRoutes = measurements.filter((measurement) => measurement.status === "measured"), mandatory = measuredRoutes.filter((measurement) => measurement.resultType === "private_space_mandatory"), appearance = new Map<string, number>();
  mandatory.forEach((route) => route.privateIntermediateRoomRegionIds.forEach((roomId) => appearance.set(roomId, (appearance.get(roomId) ?? 0) + 1)));
  return { metricId: "public_circulation_privacy", metricName: "公共动线穿越私密空间", measurementVersion: S1_PUBLIC_CIRCULATION_PRIVACY_VERSION, scoringStatus: "not_scored", measurements, groups, counts: { generatedRoutes: measuredRoutes.length, privacySafeRoutes: measuredRoutes.filter((measurement) => measurement.resultType === "privacy_safe_route_available").length, privateMandatoryRoutes: mandatory.length, baselineUnreachableRoutes: measuredRoutes.filter((measurement) => measurement.resultType === "baseline_unreachable").length, unableToDetermineRoutes: measurements.filter((measurement) => measurement.status === "unable_to_determine").length, notApplicableRouteGroups: groups.filter((group) => group.status === "not_applicable").length }, affectedPublicTargetRoomRegionIds: [...new Set(mandatory.map((route) => route.targetRoomRegionId).filter((id): id is string => Boolean(id)))].sort(), privateIntermediateRoomRegionIds: [...appearance.keys()].sort(), privateWitnessPathAppearances: [...appearance.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([roomRegionId, routeCount]) => ({ roomRegionId, routeCount })) };
}
