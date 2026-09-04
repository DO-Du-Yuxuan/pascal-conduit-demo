import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { isSdiSpaceFunctionCode, sdiSpaceFunctionName, type SdiSpaceFunctionCode } from "../space-functions/sdi-space-functions";
import type { ConnectivityEdge, RoomConnectivityGraph } from "./connectivity";
import { measureS1EntrySequence, type S1EntrySequenceMeasurement } from "./s1-space-organization";
import {
  S1_STORAGE_ARRIVAL_ANCHORS, S1_STORAGE_ARRIVAL_SUPPORT_CODES, S1_STORAGE_ARRIVAL_TAGS,
  S1_STORAGE_BEDROOM_ANCHORS, S1_STORAGE_BEDROOM_CODES, S1_STORAGE_KITCHEN_ANCHORS,
  S1_STORAGE_KITCHEN_TAGS, S1_STORAGE_PANTRY_CODE, S1_STORAGE_WARDROBE_TAGS,
  S1_STORAGE_CONFIGURATION_RULE_STATUS, S1_STORAGE_CONFIGURATION_RULE_VERSION,
} from "./s1-storage-configuration-config";

export type S1StorageStatus = "scored" | "not_applicable" | "unable_to_determine";
export type S1StorageItem = { itemId: string; sourceKind: "item" | "shelf"; functionTags: string[]; dimensionsMeters: [number, number, number] | null; grossStorageVolumeCubicMeters: number | null; zoneIds: string[]; roomRegionId: string | null; levelId: string | null };
export type S1BedroomStorageMeasurement = { bedroomZoneId: string; bedroomName: string; bedroomRoomRegionId: string; ownWardrobes: S1StorageItem[]; dedicatedClosetZoneIds: string[]; bedroomOwnStorageVolumeCubicMeters: number | null; dedicatedClosetStorageVolumeCubicMeters: number | null; bedroomStorageVolumeCubicMeters: number | null; status: S1StorageStatus; score: number | null; diagnostics: string[]; missingData: string[] };
export type S1ClosetAssignment = { zoneId: string; zoneName: string; roomRegionId: string | null; status: "dedicated" | "shared" | "unable_to_determine"; dedicatedBedroomZoneId: string | null; topologyRoomRegionIds: string[]; doorIds: string[]; wardrobes: S1StorageItem[]; grossStorageVolumeCubicMeters: number | null; diagnostics: string[]; missingData: string[] };
export type S1StorageRule = { ruleId: "SN-01" | "SN-02" | "SN-03"; ruleName: string; status: S1StorageStatus; score: number | null; diagnostics: string[] };
export type S1StorageConfigurationReport = {
  metricId: "S1-SN"; metricName: "收纳配置"; status: S1StorageStatus; score: number | null;
  ruleVersion: typeof S1_STORAGE_CONFIGURATION_RULE_VERSION; ruleStatus: typeof S1_STORAGE_CONFIGURATION_RULE_STATUS;
  sn01: S1StorageRule & { bedrooms: S1BedroomStorageMeasurement[]; closets: S1ClosetAssignment[] };
  sn02: S1StorageRule & { kitchenSystems: Array<{ kitchenZoneId: string; kitchenZoneName: string; kitchenRoomRegionId: string; kitchenItems: S1StorageItem[]; pantryZoneIds: string[]; pantryChains: string[][]; pantryItemsByZone: Array<{ zoneId: string; zoneName: string; items: S1StorageItem[]; grossStorageVolumeCubicMeters: number | null }>; kitchenStorageVolumeCubicMeters: number | null; pantryStorageVolumeCubicMeters: number | null; totalStorageVolumeCubicMeters: number | null; score: number | null; status: S1StorageStatus; diagnostics: string[] }> };
  sn03: S1StorageRule & { primaryEntranceDoorId: string | null; entranceKind: S1EntrySequenceMeasurement["entranceKind"]; arrivalSupportZoneIds: string[]; arrivalSupportRoomRegionIds: string[]; items: S1StorageItem[]; grossStorageVolumeCubicMeters: number | null; entrySequence: S1EntrySequenceMeasurement };
};

type ZoneInfo = { zone: EvaluationHandoff["zones"][number]; roomId: string };
type StorageSource = { id: string; sourceKind: "item" | "shelf"; functionTags: string[]; dimensionsMeters: [number, number, number] | null; levelId: string | null; point: [number, number] | null };

const reliableMatch = (value: string | undefined) => value === "one-to-one" || value === "room-with-multiple-zones";
const round = (value: number) => Math.round(value * 1e9) / 1e9;
const roundOne = (value: number) => Math.round(value * 10) / 10;
const sum = (values: Array<number | null>) => values.some((value) => value === null) ? null : round(values.reduce<number>((total, value) => total + value!, 0));
const asDimensions = (value: readonly number[] | null | undefined): [number, number, number] | null => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? [value[0]!, value[1]!, value[2]!] : null;
const asPoint = (value: readonly number[] | null | undefined): [number, number] | null => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) ? [value[0]!, value[1]!] : null;
const pointInRing = (point: [number, number], ring: Array<[number, number]>) => { let inside = false; for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) { const a = ring[index]!, b = ring[previous]!; if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; };
export function interpolateStorageScore(value: number, anchors: readonly { value: number; score: number }[]) { if (value <= anchors[0]!.value) return anchors[0]!.score; if (value >= anchors[anchors.length - 1]!.value) return anchors[anchors.length - 1]!.score; const upperIndex = anchors.findIndex((anchor) => value <= anchor.value), upper = anchors[upperIndex]!, lower = anchors[upperIndex - 1]!; return lower.score + (upper.score - lower.score) * (value - lower.value) / (upper.value - lower.value); }
export function grossStorageVolume(dimensions: [number, number, number] | null) { return dimensions && dimensions.every((value) => Number.isFinite(value) && value > 0) ? round(dimensions[0] * dimensions[1] * dimensions[2]) : null; }

function context(handoff: EvaluationHandoff, graph: RoomConnectivityGraph) {
  const matchByZone = new Map(graph.roomAnalysis.zoneMatches.map((match) => [match.zoneId, match]));
  const rooms = new Set(graph.roomAnalysis.rooms.filter((room) => room.usableForEvaluation).map((room) => room.roomRegionId));
  const validZones = handoff.zones.flatMap((zone): ZoneInfo[] => { const match = matchByZone.get(zone.id), roomId = match?.matchedRoomRegionIds.length === 1 ? match.matchedRoomRegionIds[0] : null; return roomId && rooms.has(roomId) && reliableMatch(match?.relationship) && isSdiSpaceFunctionCode(zone.spaceFunctionCode) ? [{ zone, roomId }] : []; });
  const source: StorageSource[] = [
    ...handoff.items.map((item) => ({ id: item.id, sourceKind: "item" as const, functionTags: item.functionTags, dimensionsMeters: asDimensions(item.dimensionsMeters), levelId: item.levelId, point: asPoint(item.resolvedWorldPosition) })),
    ...handoff.shelves.map((item) => ({ id: item.id, sourceKind: "shelf" as const, functionTags: item.functionTags, dimensionsMeters: asDimensions(item.dimensionsMeters), levelId: item.levelId, point: asPoint(item.resolvedWorldPosition) })),
  ];
  const items = source.map((item) => {
    const zoneInfos = item.point ? validZones.filter(({ zone }) => zone.levelId === item.levelId && zone.outline.length >= 3 && pointInRing(item.point!, zone.outline as Array<[number, number]>)) : [];
    const zoneIds = zoneInfos.map(({ zone }) => zone.id).sort();
    return { itemId: item.id, sourceKind: item.sourceKind, functionTags: [...new Set(item.functionTags)].sort(), dimensionsMeters: item.dimensionsMeters, grossStorageVolumeCubicMeters: grossStorageVolume(item.dimensionsMeters), zoneIds, roomRegionId: zoneInfos.length ? zoneInfos[0]!.roomId : null, levelId: item.levelId } satisfies S1StorageItem;
  });
  return { validZones, items };
}

const itemsInZones = (items: S1StorageItem[], zoneIds: Set<string>, tags: Set<string>) => items.filter((item) => item.functionTags.some((tag) => tags.has(tag)) && item.zoneIds.some((zoneId) => zoneIds.has(zoneId))).sort((a, b) => a.itemId.localeCompare(b.itemId));
const roomCodes = (zones: ZoneInfo[], roomId: string) => [...new Set(zones.filter((entry) => entry.roomId === roomId).map((entry) => entry.zone.spaceFunctionCode).filter(isSdiSpaceFunctionCode))].sort();
const roomZoneIds = (zones: ZoneInfo[], roomId: string) => zones.filter((entry) => entry.roomId === roomId).map((entry) => entry.zone.id).sort();
const interiorEdges = (graph: RoomConnectivityGraph, roomId: string) => graph.edges.filter((edge) => edge.fromNodeId === roomId || edge.toNodeId === roomId).filter((edge) => graph.nodes.some((node) => node.nodeType === "room" && node.nodeId === edge.fromNodeId) && graph.nodes.some((node) => node.nodeType === "room" && node.nodeId === edge.toNodeId)).sort((a, b) => a.edgeId.localeCompare(b.edgeId));
const otherRoom = (edge: ConnectivityEdge, roomId: string) => edge.fromNodeId === roomId ? edge.toNodeId : edge.fromNodeId;
const publicSystemCode = (code: string) => ["SF06", "SF07", "SF08", "SF09", "SF10", "SF35"].includes(code);
const suiteAuxiliaryCode = (code: string) => ["SF03", "SF15", "SF20"].includes(code);

function dedicatedSuiteBedroom(closetRoomId: string, zones: ZoneInfo[], graph: RoomConnectivityGraph, bedroomByRoom: Map<string, ZoneInfo[]>) {
  const queue = [closetRoomId], visited = new Set<string>(), bedroomZoneIds = new Set<string>();
  while (queue.length) {
    const roomId = queue.shift()!;
    if (visited.has(roomId)) continue;
    visited.add(roomId);
    const codes = roomCodes(zones, roomId);
    if (codes.some(publicSystemCode)) return { bedroomZoneIds: [], roomIds: [...visited].sort(), reachesPublicSystem: true };
    bedroomByRoom.get(roomId)?.forEach((bedroom) => bedroomZoneIds.add(bedroom.zone.id));
    if (roomId !== closetRoomId && !codes.every((code) => suiteAuxiliaryCode(code) || S1_STORAGE_BEDROOM_CODES.has(code))) continue;
    interiorEdges(graph, roomId).map((edge) => otherRoom(edge, roomId)).filter((next) => !visited.has(next)).sort().forEach((next) => queue.push(next));
  }
  return { bedroomZoneIds: [...bedroomZoneIds].sort(), roomIds: [...visited].sort(), reachesPublicSystem: false };
}

function assignCloset(zoneInfo: ZoneInfo, zones: ZoneInfo[], items: S1StorageItem[], graph: RoomConnectivityGraph, bedroomByRoom: Map<string, ZoneInfo[]>): S1ClosetAssignment {
  const direct = interiorEdges(graph, zoneInfo.roomId), neighbors = direct.map((edge) => otherRoom(edge, zoneInfo.roomId)), directBedrooms = [...new Set(neighbors.flatMap((roomId) => bedroomByRoom.get(roomId)?.map((entry) => entry.zone.id) ?? []))];
  const publicOrShared = neighbors.some((roomId) => roomCodes(zones, roomId).some(publicSystemCode));
  const wardrobes = itemsInZones(items, new Set([zoneInfo.zone.id]), S1_STORAGE_WARDROBE_TAGS), volume = sum(wardrobes.map((item) => item.grossStorageVolumeCubicMeters));
  if (wardrobes.some((item) => item.grossStorageVolumeCubicMeters === null)) return { zoneId: zoneInfo.zone.id, zoneName: zoneInfo.zone.name ?? zoneInfo.zone.id, roomRegionId: zoneInfo.roomId, status: "unable_to_determine", dedicatedBedroomZoneId: null, topologyRoomRegionIds: [zoneInfo.roomId, ...neighbors], doorIds: direct.map((edge) => edge.sourceObjectId), wardrobes, grossStorageVolumeCubicMeters: null, diagnostics: ["衣帽间内存在尺寸无效的 wardrobe，无法计算估算收纳体积。"], missingData: ["wardrobe.dimensionsMeters"] };
  if (directBedrooms.length === 1 && !publicOrShared) return { zoneId: zoneInfo.zone.id, zoneName: zoneInfo.zone.name ?? zoneInfo.zone.id, roomRegionId: zoneInfo.roomId, status: "dedicated", dedicatedBedroomZoneId: directBedrooms[0]!, topologyRoomRegionIds: [zoneInfo.roomId, ...neighbors], doorIds: direct.map((edge) => edge.sourceObjectId), wardrobes, grossStorageVolumeCubicMeters: volume, diagnostics: ["SF15 仅通过可靠 DoorPortal 直接服务一个卧室。"], missingData: [] };
  if (directBedrooms.length > 1 || publicOrShared) return { zoneId: zoneInfo.zone.id, zoneName: zoneInfo.zone.name ?? zoneInfo.zone.id, roomRegionId: zoneInfo.roomId, status: "shared", dedicatedBedroomZoneId: null, topologyRoomRegionIds: [zoneInfo.roomId, ...neighbors], doorIds: direct.map((edge) => edge.sourceObjectId), wardrobes, grossStorageVolumeCubicMeters: volume, diagnostics: [publicOrShared ? "SF15 连接走廊、入户或公共系统，不分配给单一卧室。" : "SF15 直接连接多个卧室，不分配给单一卧室。"], missingData: [] };
  const suite = dedicatedSuiteBedroom(zoneInfo.roomId, zones, graph, bedroomByRoom);
  if (!suite.reachesPublicSystem && suite.bedroomZoneIds.length === 1) return { zoneId: zoneInfo.zone.id, zoneName: zoneInfo.zone.name ?? zoneInfo.zone.id, roomRegionId: zoneInfo.roomId, status: "dedicated", dedicatedBedroomZoneId: suite.bedroomZoneIds[0]!, topologyRoomRegionIds: suite.roomIds, doorIds: direct.map((edge) => edge.sourceObjectId), wardrobes, grossStorageVolumeCubicMeters: volume, diagnostics: ["SF15 仅经明确套房内部辅助空间服务一个卧室。"], missingData: [] };
  return { zoneId: zoneInfo.zone.id, zoneName: zoneInfo.zone.name ?? zoneInfo.zone.id, roomRegionId: zoneInfo.roomId, status: "unable_to_determine", dedicatedBedroomZoneId: null, topologyRoomRegionIds: [zoneInfo.roomId, ...neighbors], doorIds: direct.map((edge) => edge.sourceObjectId), wardrobes, grossStorageVolumeCubicMeters: volume, diagnostics: ["SF15 无法通过可靠 DoorPortal 唯一归属到一个卧室。"], missingData: ["SF15 与卧室的唯一拓扑归属"] };
}

function sn01(handoff: EvaluationHandoff, graph: RoomConnectivityGraph): S1StorageConfigurationReport["sn01"] {
  const { validZones, items } = context(handoff, graph), bedrooms = validZones.filter((entry) => S1_STORAGE_BEDROOM_CODES.has(entry.zone.spaceFunctionCode!)).sort((a, b) => a.zone.id.localeCompare(b.zone.id));
  if (!bedrooms.length) return { ruleId: "SN-01", ruleName: "卧室收纳", status: "not_applicable", score: null, bedrooms: [], closets: [], diagnostics: ["未识别到可评价的正式卧室 Zone。"] };
  const bedroomByRoom = new Map<string, ZoneInfo[]>(); bedrooms.forEach((bedroom) => bedroomByRoom.set(bedroom.roomId, [...(bedroomByRoom.get(bedroom.roomId) ?? []), bedroom]));
  const closets = validZones.filter((entry) => entry.zone.spaceFunctionCode === "SF15").sort((a, b) => a.zone.id.localeCompare(b.zone.id)).map((entry) => assignCloset(entry, validZones, items, graph, bedroomByRoom));
  const unableClosets = closets.filter((closet) => closet.status === "unable_to_determine");
  const measurements = bedrooms.map((bedroom): S1BedroomStorageMeasurement => {
    const ownWardrobes = itemsInZones(items, new Set([bedroom.zone.id]), S1_STORAGE_WARDROBE_TAGS), own = sum(ownWardrobes.map((item) => item.grossStorageVolumeCubicMeters)), dedicated = closets.filter((closet) => closet.status === "dedicated" && closet.dedicatedBedroomZoneId === bedroom.zone.id), closetVolume = sum(dedicated.map((closet) => closet.grossStorageVolumeCubicMeters));
    if (own === null || closetVolume === null) return { bedroomZoneId: bedroom.zone.id, bedroomName: bedroom.zone.name ?? bedroom.zone.id, bedroomRoomRegionId: bedroom.roomId, ownWardrobes, dedicatedClosetZoneIds: dedicated.map((closet) => closet.zoneId), bedroomOwnStorageVolumeCubicMeters: own, dedicatedClosetStorageVolumeCubicMeters: closetVolume, bedroomStorageVolumeCubicMeters: null, status: "unable_to_determine", score: null, diagnostics: ["参与收纳的 wardrobe 缺少有效 dimensionsMeters。"], missingData: ["wardrobe.dimensionsMeters"] };
    const total = round(own + closetVolume); return { bedroomZoneId: bedroom.zone.id, bedroomName: bedroom.zone.name ?? bedroom.zone.id, bedroomRoomRegionId: bedroom.roomId, ownWardrobes, dedicatedClosetZoneIds: dedicated.map((closet) => closet.zoneId), bedroomOwnStorageVolumeCubicMeters: own, dedicatedClosetStorageVolumeCubicMeters: closetVolume, bedroomStorageVolumeCubicMeters: total, status: "scored", score: roundOne(interpolateStorageScore(total, S1_STORAGE_BEDROOM_ANCHORS)), diagnostics: dedicated.length ? ["包含唯一 dedicated SF15 衣帽间的 wardrobe。"] : [], missingData: [] };
  });
  const unable = unableClosets.length || measurements.some((entry) => entry.status === "unable_to_determine"), values = measurements.flatMap((entry) => entry.score === null ? [] : [entry.score]);
  return { ruleId: "SN-01", ruleName: "卧室收纳", status: unable ? "unable_to_determine" : values.length ? "scored" : "not_applicable", score: unable || !values.length ? null : roundOne(values.reduce((total, value) => total + value, 0) / values.length), bedrooms: measurements, closets, diagnostics: unable ? ["存在无法可靠计算或归属的卧室收纳，暂不生成完整 SN-01 分数。"] : [] };
}

function pantryChain(kitchenRoomId: string, zones: ZoneInfo[], graph: RoomConnectivityGraph) {
  const pantryRooms = new Set(zones.filter((entry) => entry.zone.spaceFunctionCode === S1_STORAGE_PANTRY_CODE).map((entry) => entry.roomId));
  const queue = interiorEdges(graph, kitchenRoomId).map((edge) => otherRoom(edge, kitchenRoomId)).filter((roomId) => pantryRooms.has(roomId)).sort(), visited = new Set<string>();
  while (queue.length) { const roomId = queue.shift()!; if (visited.has(roomId)) continue; visited.add(roomId); interiorEdges(graph, roomId).map((edge) => otherRoom(edge, roomId)).filter((next) => pantryRooms.has(next) && !visited.has(next)).sort().forEach((next) => queue.push(next)); }
  return [...visited].sort();
}

function sn02(handoff: EvaluationHandoff, graph: RoomConnectivityGraph): S1StorageConfigurationReport["sn02"] {
  const { validZones, items } = context(handoff, graph), kitchens = validZones.filter((entry) => ["SF01", "SF02"].includes(entry.zone.spaceFunctionCode!)).sort((a, b) => a.zone.id.localeCompare(b.zone.id));
  if (!kitchens.length) return { ruleId: "SN-02", ruleName: "厨房 / 食品收纳", status: "not_applicable", score: null, kitchenSystems: [], diagnostics: ["未识别到正式 SF01/SF02 厨房。"] };
  const systems = kitchens.map((kitchen) => {
    const pantryRooms = pantryChain(kitchen.roomId, validZones, graph), pantryZones = validZones.filter((entry) => pantryRooms.includes(entry.roomId) && entry.zone.spaceFunctionCode === S1_STORAGE_PANTRY_CODE).sort((a, b) => a.zone.id.localeCompare(b.zone.id));
    const kitchenItems = itemsInZones(items, new Set([kitchen.zone.id]), S1_STORAGE_KITCHEN_TAGS), pantryItemsByZone = pantryZones.map((pantry) => { const values = itemsInZones(items, new Set([pantry.zone.id]), S1_STORAGE_KITCHEN_TAGS); return { zoneId: pantry.zone.id, zoneName: pantry.zone.name ?? pantry.zone.id, items: values, grossStorageVolumeCubicMeters: sum(values.map((item) => item.grossStorageVolumeCubicMeters)) }; });
    const kitchenVolume = sum(kitchenItems.map((item) => item.grossStorageVolumeCubicMeters)), pantryVolume = sum(pantryItemsByZone.map((entry) => entry.grossStorageVolumeCubicMeters)), total = kitchenVolume === null || pantryVolume === null ? null : round(kitchenVolume + pantryVolume), invalid = [...kitchenItems, ...pantryItemsByZone.flatMap((entry) => entry.items)].some((item) => item.grossStorageVolumeCubicMeters === null);
    return { kitchenZoneId: kitchen.zone.id, kitchenZoneName: kitchen.zone.name ?? kitchen.zone.id, kitchenRoomRegionId: kitchen.roomId, kitchenItems, pantryZoneIds: pantryZones.map((entry) => entry.zone.id), pantryChains: pantryRooms.map((roomId) => roomZoneIds(validZones, roomId)), pantryItemsByZone, kitchenStorageVolumeCubicMeters: kitchenVolume, pantryStorageVolumeCubicMeters: pantryVolume, totalStorageVolumeCubicMeters: total, score: total === null ? null : roundOne(interpolateStorageScore(total, S1_STORAGE_KITCHEN_ANCHORS)), status: invalid ? "unable_to_determine" as const : "scored" as const, diagnostics: pantryZones.length ? ["只沿连续 SF34 Pantry RoomRegion 链统计食品收纳。"] : ["厨房没有直接进入的连续 SF34 Pantry 链。"] };
  });
  const unable = systems.some((system) => system.status === "unable_to_determine"), values = systems.flatMap((system) => system.score === null ? [] : [system.score]);
  return { ruleId: "SN-02", ruleName: "厨房 / 食品收纳", status: unable ? "unable_to_determine" : values.length ? "scored" : "not_applicable", score: unable || !values.length ? null : roundOne(values.reduce((total, value) => total + value, 0) / values.length), kitchenSystems: systems, diagnostics: unable ? ["存在尺寸无效的厨房或 Pantry 收纳 Item，暂不生成完整 SN-02 分数。"] : [] };
}

function sn03(handoff: EvaluationHandoff, graph: RoomConnectivityGraph): S1StorageConfigurationReport["sn03"] {
  const entrySequence = measureS1EntrySequence(handoff, graph), base = { ruleId: "SN-03" as const, ruleName: "归家收纳" as const, primaryEntranceDoorId: entrySequence.primaryEntranceDoorId, entranceKind: entrySequence.entranceKind, entrySequence };
  if (entrySequence.status === "not_applicable") return { ...base, status: "not_applicable", score: null, arrivalSupportZoneIds: [], arrivalSupportRoomRegionIds: [], items: [], grossStorageVolumeCubicMeters: null, diagnostics: entrySequence.diagnostics };
  if (entrySequence.status !== "scored") return { ...base, status: "unable_to_determine", score: null, arrivalSupportZoneIds: [], arrivalSupportRoomRegionIds: [], items: [], grossStorageVolumeCubicMeters: null, diagnostics: entrySequence.diagnostics };
  const { validZones, items } = context(handoff, graph), supportRooms = entrySequence.roomRegionIds.slice(0, -1), supportZones = validZones.filter((entry) => supportRooms.includes(entry.roomId) && S1_STORAGE_ARRIVAL_SUPPORT_CODES.has(entry.zone.spaceFunctionCode!)), supportIds = new Set(supportZones.map((entry) => entry.zone.id)), selected = itemsInZones(items, supportIds, S1_STORAGE_ARRIVAL_TAGS), volume = sum(selected.map((item) => item.grossStorageVolumeCubicMeters));
  if (volume === null) return { ...base, status: "unable_to_determine", score: null, arrivalSupportZoneIds: [...supportIds].sort(), arrivalSupportRoomRegionIds: [...new Set(supportZones.map((entry) => entry.roomId))].sort(), items: selected, grossStorageVolumeCubicMeters: null, diagnostics: ["归家支持空间存在尺寸无效的收纳 Item。"] };
  return { ...base, status: "scored", score: roundOne(interpolateStorageScore(volume, S1_STORAGE_ARRIVAL_ANCHORS)), arrivalSupportZoneIds: [...supportIds].sort(), arrivalSupportRoomRegionIds: [...new Set(supportZones.map((entry) => entry.roomId))].sort(), items: selected, grossStorageVolumeCubicMeters: volume, diagnostics: supportZones.length ? ["只统计进入公共核心前、入户序列中的 Entry/Foyer/Mudroom 收纳。"] : ["入户序列中没有正式 Entry/Foyer/Mudroom 支持 Zone，按 0 m³ 评分。"] };
}

export function scoreS1StorageConfiguration(handoff: EvaluationHandoff, graph: RoomConnectivityGraph): S1StorageConfigurationReport {
  const bedroom = sn01(handoff, graph), kitchen = sn02(handoff, graph), arrival = sn03(handoff, graph), rules = [bedroom, kitchen, arrival], unable = rules.some((rule) => rule.status === "unable_to_determine"), scores = rules.flatMap((rule) => rule.score === null ? [] : [rule.score]);
  return { metricId: "S1-SN", metricName: "收纳配置", status: unable ? "unable_to_determine" : scores.length ? "scored" : "not_applicable", score: unable || !scores.length ? null : roundOne(scores.reduce((total, score) => total + score, 0) / scores.length), ruleVersion: S1_STORAGE_CONFIGURATION_RULE_VERSION, ruleStatus: S1_STORAGE_CONFIGURATION_RULE_STATUS, sn01: bedroom, sn02: kitchen, sn03: arrival };
}
