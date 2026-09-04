import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { isSdiSpaceFunctionCode, sdiSpaceFunctionName, type SdiSpaceFunctionCode } from "../space-functions/sdi-space-functions";
import type { RoomConnectivityGraph, ConnectivityEdge, DoorPortal } from "./connectivity";
import type { S1FunctionalRelationScoreSummary } from "./s1-functional-relation-scoring";

export const S1_SPACE_ORGANIZATION_RULE_VERSION = "v0.1-demo" as const;
export const S1_SPACE_ORGANIZATION_RULE_STATUS = "Demo provisional calibration" as const;
export type S1SpaceOrganizationStatus = "scored" | "not_applicable" | "unable_to_determine";
export type S1EntrySequenceClass = "public_core" | "appropriate_transition" | "neutral_transition" | "unrelated_major_function" | "garage";
export type S1EntrySequenceMeasurement = {
  ruleId: "SO-03";
  ruleName: "入户序列适配";
  status: S1SpaceOrganizationStatus;
  score: number | null;
  matchedRuleId: "SO-03-R01" | "SO-03-R02" | "SO-03-R03" | "SO-03-R04" | "SO-03-R05" | null;
  primaryEntranceDoorId: string | null;
  entranceKind: "normal_residential" | "garage_origin" | null;
  roomRegionIds: string[];
  zoneIdsByRoom: string[][];
  spaceFunctionCodesByRoom: string[][];
  spaceFunctionNamesByRoom: string[][];
  semanticClasses: S1EntrySequenceClass[];
  diagnostics: string[];
  missingData: string[];
};
export type S1SpaceOrganizationRuleScore = { ruleId: "SO-01" | "SO-02" | "SO-03"; ruleName: string; status: S1SpaceOrganizationStatus; score: number | null; explanation: string; sourceRuleId: string | null };
export type S1SpaceOrganizationReport = { metricId: "S1-SO"; metricName: "空间组织"; status: S1SpaceOrganizationStatus; score: number | null; ruleVersion: typeof S1_SPACE_ORGANIZATION_RULE_VERSION; ruleStatus: typeof S1_SPACE_ORGANIZATION_RULE_STATUS; rules: S1SpaceOrganizationRuleScore[]; entrySequence: S1EntrySequenceMeasurement };

const NORMAL_APPROPRIATE = new Set<SdiSpaceFunctionCode>(["SF08", "SF09", "SF10", "SF19", "SF35"]);
const GARAGE_APPROPRIATE = new Set<SdiSpaceFunctionCode>(["SF01", "SF02", "SF34", "SF35"]);
const PUBLIC_CORE = new Set<SdiSpaceFunctionCode>(["SF06", "SF07"]);
const UNRELATED_MAJOR = new Set<SdiSpaceFunctionCode>(["SF03", "SF04", "SF05", "SF11", "SF12", "SF13", "SF14", "SF16", "SF21", "SF22", "SF25", "SF26", "SF27", "SF28", "SF29", "SF31", "SF33", "SF36"]);

const reliableMatch = (value: string | undefined) => value === "one-to-one" || value === "room-with-multiple-zones";
const roomCodes = (handoff: EvaluationHandoff, graph: RoomConnectivityGraph, roomId: string) => {
  const zones = new Map(handoff.zones.map((zone) => [zone.id, zone]));
  const matchByZone = new Map(graph.roomAnalysis.zoneMatches.map((match) => [match.zoneId, match]));
  const ids = (graph.roomAnalysis.roomToZoneIds[roomId] ?? []).filter((zoneId) => {
    const match = matchByZone.get(zoneId);
    return match?.matchedRoomRegionIds.length === 1 && match.matchedRoomRegionIds[0] === roomId && reliableMatch(match.relationship);
  }).sort();
  return { zoneIds: ids, codes: ids.flatMap((id) => { const code = zones.get(id)?.spaceFunctionCode; return code && isSdiSpaceFunctionCode(code) ? [code] : []; }).sort() };
};

const roomClass = (codes: SdiSpaceFunctionCode[], garageOrigin: boolean): S1EntrySequenceClass => {
  if (codes.some((code) => PUBLIC_CORE.has(code))) return "public_core";
  if (codes.includes("SF30")) return "garage";
  if (codes.some((code) => NORMAL_APPROPRIATE.has(code) || garageOrigin && GARAGE_APPROPRIATE.has(code))) return "appropriate_transition";
  if (codes.some((code) => UNRELATED_MAJOR.has(code))) return "unrelated_major_function";
  return "neutral_transition";
};

type SequencePath = { rooms: string[]; edges: ConnectivityEdge[]; neutral: number; unrelated: number };
const comparePath = (a: SequencePath, b: SequencePath) => a.unrelated - b.unrelated || a.neutral - b.neutral || a.edges.length - b.edges.length || a.rooms.join("|").localeCompare(b.rooms.join("|")) || a.edges.map((edge) => edge.edgeId).join("|").localeCompare(b.edges.map((edge) => edge.edgeId).join("|"));

function lowestSemanticPath(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, startRoomId: string, garageOrigin: boolean): SequencePath | null {
  const rooms = new Set(graph.nodes.filter((node) => node.nodeType === "room").map((node) => node.nodeId));
  const targetRooms = [...rooms].filter((roomId) => roomCodes(handoff, graph, roomId).codes.some((code) => PUBLIC_CORE.has(code))).sort();
  if (!targetRooms.length) return null;
  const adjacency = new Map<string, Array<{ roomId: string; edge: ConnectivityEdge }>>();
  for (const edge of graph.edges) {
    if (!rooms.has(edge.fromNodeId) || !rooms.has(edge.toNodeId)) continue;
    adjacency.set(edge.fromNodeId, [...(adjacency.get(edge.fromNodeId) ?? []), { roomId: edge.toNodeId, edge }]);
    adjacency.set(edge.toNodeId, [...(adjacency.get(edge.toNodeId) ?? []), { roomId: edge.fromNodeId, edge }]);
  }
  adjacency.forEach((entries) => entries.sort((a, b) => a.roomId.localeCompare(b.roomId) || a.edge.edgeId.localeCompare(b.edge.edgeId)));
  const queue: SequencePath[] = [{ rooms: [startRoomId], edges: [], neutral: 0, unrelated: 0 }], best = new Map<string, SequencePath>();
  best.set(startRoomId, queue[0]!);
  while (queue.length) {
    queue.sort(comparePath);
    const current = queue.shift()!;
    if (best.get(current.rooms[current.rooms.length - 1]!) !== current) continue;
    const currentRoom = current.rooms[current.rooms.length - 1]!;
    if (targetRooms.includes(currentRoom)) return current;
    for (const next of adjacency.get(currentRoom) ?? []) {
      const classification = roomClass(roomCodes(handoff, graph, next.roomId).codes, garageOrigin);
      const candidate: SequencePath = { rooms: [...current.rooms, next.roomId], edges: [...current.edges, next.edge], neutral: current.neutral + Number(classification === "neutral_transition"), unrelated: current.unrelated + Number(classification === "unrelated_major_function") };
      const previous = best.get(next.roomId);
      if (!previous || comparePath(candidate, previous) < 0) { best.set(next.roomId, candidate); queue.push(candidate); }
    }
  }
  return null;
}

function resolvePrimaryEntrance(graph: RoomConnectivityGraph, handoff: EvaluationHandoff): { portal: DoorPortal | null; startRoomId: string | null; entranceKind: "normal_residential" | "garage_origin" | null; diagnostics: string[]; missingData: string[] } {
  const marked = graph.portals.filter((portal) => portal.isPrimaryEntrance);
  if (marked.length > 1) return { portal: null, startRoomId: null, entranceKind: null, diagnostics: ["存在多个 isPrimaryEntrance=true 的 Door，无法唯一确定主要入口。"], missingData: ["唯一主要入口 Door 标记"] };
  const portal = marked[0] ?? (() => { const exterior = graph.portals.filter((item) => item.usableForConnectivity && item.connectsExterior); return exterior.length === 1 ? exterior[0]! : null; })();
  if (!portal) return { portal: null, startRoomId: null, entranceKind: null, diagnostics: ["缺少正式主要入口 Door 标记，且不存在唯一可靠外门兼容 fallback。"], missingData: ["Door.isPrimaryEntrance=true"] };
  if (!portal.usableForConnectivity) return { portal, startRoomId: null, entranceKind: null, diagnostics: ["主要入口 Door 没有可靠 DoorPortal。"], missingData: [`${portal.doorId}: DoorPortal`] };
  const roomIds = [portal.roomRegionAId, portal.roomRegionBId].filter((id): id is string => Boolean(id));
  const garageRooms = roomIds.filter((roomId) => roomCodes(handoff, graph, roomId).codes.includes("SF30"));
  if (garageRooms.length > 1) return { portal, startRoomId: null, entranceKind: null, diagnostics: ["主要入口两侧均被识别为 Garage，无法确定住宅归家序列。"], missingData: [`${portal.doorId}: 住宅侧 RoomRegion`] };
  if (garageRooms.length === 1) return { portal, startRoomId: garageRooms[0]!, entranceKind: "garage_origin", diagnostics: ["主要入口 DoorPortal 一侧属于 SF30 Garage，按车库归家入口评价。"], missingData: [] };
  const residential = portal.connectsExterior ? roomIds : [];
  if (residential.length !== 1) return { portal, startRoomId: null, entranceKind: null, diagnostics: ["主要入口不是可唯一解析的住宅外门，也不连接 SF30 Garage。"], missingData: [`${portal.doorId}: 唯一住宅侧 RoomRegion`] };
  return { portal, startRoomId: residential[0]!, entranceKind: "normal_residential", diagnostics: marked.length ? ["使用 isPrimaryEntrance=true 的住宅入口。"] : ["旧项目兼容：使用唯一可靠住宅外门。"], missingData: [] };
}

export function measureS1EntrySequence(handoff: EvaluationHandoff, graph: RoomConnectivityGraph): S1EntrySequenceMeasurement {
  const entrance = resolvePrimaryEntrance(graph, handoff), base = { ruleId: "SO-03" as const, ruleName: "入户序列适配" as const, primaryEntranceDoorId: entrance.portal?.doorId ?? null, entranceKind: entrance.entranceKind, diagnostics: entrance.diagnostics, missingData: entrance.missingData };
  if (!entrance.startRoomId || !entrance.entranceKind) return { ...base, status: "unable_to_determine", score: null, matchedRuleId: null, roomRegionIds: [], zoneIdsByRoom: [], spaceFunctionCodesByRoom: [], spaceFunctionNamesByRoom: [], semanticClasses: [] };
  const targets = graph.nodes.filter((node) => node.nodeType === "room" && roomCodes(handoff, graph, node.nodeId).codes.some((code) => PUBLIC_CORE.has(code)));
  if (!targets.length) return { ...base, status: "not_applicable", score: null, matchedRuleId: null, roomRegionIds: [], zoneIdsByRoom: [], spaceFunctionCodesByRoom: [], spaceFunctionNamesByRoom: [], semanticClasses: [], diagnostics: [...base.diagnostics, "未识别到可靠 SF06 客厅或 SF07 餐厅公共核心。"] };
  const path = lowestSemanticPath(handoff, graph, entrance.startRoomId, entrance.entranceKind === "garage_origin");
  if (!path) { const start = roomCodes(handoff, graph, entrance.startRoomId); return { ...base, status: "scored", score: 0, matchedRuleId: "SO-03-R05", roomRegionIds: [entrance.startRoomId], zoneIdsByRoom: [start.zoneIds], spaceFunctionCodesByRoom: [start.codes], spaceFunctionNamesByRoom: [start.codes.map((code) => sdiSpaceFunctionName(code)!)], semanticClasses: [roomClass(start.codes, entrance.entranceKind === "garage_origin")], diagnostics: [...base.diagnostics, "主要入口与可靠公共核心在 RoomConnectivityGraph 中不连通。"] }; }
  const rows = path.rooms.map((roomId) => roomCodes(handoff, graph, roomId)), classes = rows.map((row) => roomClass(row.codes, entrance.entranceKind === "garage_origin")), intermediate = classes.slice(1, -1), unrelated = intermediate.filter((value) => value === "unrelated_major_function").length, neutral = intermediate.filter((value) => value === "neutral_transition").length;
  const score = unrelated >= 2 ? 30 : unrelated === 1 ? 60 : neutral > 0 ? 85 : 100;
  const matchedRuleId = score === 100 ? "SO-03-R01" : score === 85 ? "SO-03-R02" : score === 60 ? "SO-03-R03" : "SO-03-R04";
  const readable = path.rooms.map((roomId, index) => `${rows[index]!.codes.map((code) => `${code}-${sdiSpaceFunctionName(code)}`).join("/") || roomId}`).join(" → ");
  return { ...base, status: "scored", score, matchedRuleId, roomRegionIds: path.rooms, zoneIdsByRoom: rows.map((row) => row.zoneIds), spaceFunctionCodesByRoom: rows.map((row) => row.codes), spaceFunctionNamesByRoom: rows.map((row) => row.codes.map((code) => sdiSpaceFunctionName(code)!)), semanticClasses: classes, diagnostics: [...base.diagnostics, `选择语义代价最低的合法入户序列：${readable}。`, ...(neutral ? [`经过 ${neutral} 个中性过渡空间。`] : []), ...(unrelated ? [`经过 ${unrelated} 个无关主要功能空间。`] : [])] };
}

const relationRule = (id: "SO-01" | "SO-02", name: string, pairId: string, relations: S1FunctionalRelationScoreSummary): S1SpaceOrganizationRuleScore => {
  const pair = relations.pairScores.find((item) => item.pairId === pairId);
  if (!pair || pair.scoringStatus === "excluded" || pair.scoringStatus === "not_applicable") return { ruleId: id, ruleName: name, status: "not_applicable", score: null, explanation: pair?.scoreExplanation ?? "该关系不适用。", sourceRuleId: pair?.matchedRuleId ?? null };
  if (pair.scoringStatus !== "scored" || pair.score === null) return { ruleId: id, ruleName: name, status: "unable_to_determine", score: null, explanation: pair.scoreExplanation, sourceRuleId: pair.matchedRuleId };
  return { ruleId: id, ruleName: name, status: "scored", score: pair.score, explanation: pair.scoreExplanation, sourceRuleId: pair.matchedRuleId };
};

export function scoreS1SpaceOrganization(relations: S1FunctionalRelationScoreSummary, entrySequence: S1EntrySequenceMeasurement): S1SpaceOrganizationReport {
  const entry: S1SpaceOrganizationRuleScore = { ruleId: "SO-03", ruleName: "入户序列适配", status: entrySequence.status, score: entrySequence.score, explanation: entrySequence.diagnostics[entrySequence.diagnostics.length - 1] ?? "入户序列无法评价。", sourceRuleId: entrySequence.matchedRuleId };
  const rules = [relationRule("SO-01", "厨房—餐厅关系", "S1-REL-001", relations), relationRule("SO-02", "主卧—主卫关系", "S1-REL-002", relations), entry];
  const unable = rules.some((rule) => rule.status === "unable_to_determine"), values = rules.flatMap((rule) => rule.status === "scored" && rule.score !== null ? [rule.score] : []);
  return { metricId: "S1-SO", metricName: "空间组织", status: unable ? "unable_to_determine" : values.length ? "scored" : "not_applicable", score: unable || !values.length ? null : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10, ruleVersion: S1_SPACE_ORGANIZATION_RULE_VERSION, ruleStatus: S1_SPACE_ORGANIZATION_RULE_STATUS, rules, entrySequence };
}
