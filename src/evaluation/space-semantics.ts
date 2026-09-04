import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import type { RoomRegion, RoomRegionAnalysis } from "./room-regions";
import { isSdiSpaceFunctionCode, sdiFunctionalSemantics, sdiSpaceFunctionName, type SdiSpaceFunctionCode } from "../space-functions/sdi-space-functions";

/** Shared vocabulary: regulation uses are coarse; functional semantics stay detailed for G4 and S1. */
export type RegulatoryRoomUse = "garage" | "sleeping" | "basement" | "habitable_attic" | "hallway" | "habitable" | "kitchen" | "bathroom" | "circulation" | "storage" | "service" | "other" | "unknown";
export type RoomSemanticConfidence = "high" | "medium" | "low";
export type RegulatoryRoomSemantic = { use: RegulatoryRoomUse; confidence: RoomSemanticConfidence; names: string[]; reason: string };
export type SpaceSemanticSource = "sdi_code" | "name_fallback" | "unknown";
export type ZoneFunctionalSemanticResolution = { semantics: Set<string>; semanticSource: SpaceSemanticSource; spaceFunctionCode: string | null; spaceFunctionName: string | null; diagnostics: string[] };
export type SemanticSpace = { room: RoomRegion; zoneIds: string[]; zoneNames: string[]; semantics: Set<string>; sdiSemantics: Set<string>; fallbackSemantics: Set<string>; semanticSources: Set<SpaceSemanticSource>; spaceFunctionCodes: string[]; diagnostics: string[] };

export const knownSpaceSemantics = new Set(["bathroom", "bedroom", "chinese_kitchen", "circulation", "closed_kitchen", "dining", "entry", "foyer", "garage", "kitchen", "laundry", "living_room", "mud_room", "office", "open_kitchen", "pantry", "primary_bathroom", "primary_bedroom", "recreation", "service", "storage", "study", "walk_in_closet"]);
const semanticAliases: Record<string, string> = { bath: "bathroom", bedroom: "bedroom", chinese_kitchen: "chinese_kitchen", dining_room: "dining", garage: "garage", kitchen: "kitchen", laundry_room: "laundry", living: "living_room", master_bathroom: "primary_bathroom", master_bedroom: "primary_bedroom", mudroom: "mud_room", primary_bath: "primary_bathroom", primary_suite: "primary_bedroom", study_room: "study", wic: "walk_in_closet" };

export const normalizeSpaceSemantic = (value: string) => value.trim().toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
export const canonicalSpaceSemantic = (value: string) => semanticAliases[normalizeSpaceSemantic(value)] ?? normalizeSpaceSemantic(value);

export function functionalSemanticsForZoneName(name: string): string[] {
  const text = normalizeSpaceSemantic(name), result = new Set<string>();
  if (/(^|_)bed(?:room)?(_|$)/.test(text) || /卧室/i.test(name)) result.add("bedroom");
  if (/(master|primary)_bedroom/.test(text) || /主卧/i.test(name)) { result.add("bedroom"); result.add("primary_bedroom"); }
  if (/(^|_)(bath|bathroom)(_|$)/.test(text) || /卫生间|浴室|厕所/i.test(name)) result.add("bathroom");
  if (/(master|primary)_(bath|bathroom)/.test(text) || /主卫/i.test(name)) { result.add("bathroom"); result.add("primary_bathroom"); }
  if (text.includes("kitchen") || /厨房/i.test(name)) result.add("kitchen");
  if (text.includes("chinese_kitchen") || /中厨/i.test(name)) { result.add("kitchen"); result.add("chinese_kitchen"); }
  if (text.includes("open_kitchen") || /开放式?厨房/i.test(name)) { result.add("kitchen"); result.add("open_kitchen"); }
  if (text === "office" || /^office_/.test(text)) { result.add("office"); result.add("study"); }
  if (text === "reading" || text.includes("study") || /书房|阅读/i.test(name)) result.add("study");
  if (text.includes("laundry") || /洗衣/i.test(name)) result.add("laundry");
  if (text.includes("garage") || /车库/i.test(name)) result.add("garage");
  if (text === "mud" || text.includes("mud_room") || text.includes("mudroom") || /泥房|玄关/i.test(name)) result.add("mud_room");
  if (text.includes("dining") || text.includes("dinning") || /餐厅/i.test(name)) result.add("dining");
  if (text.includes("living") || text.includes("family") || text.includes("lounge") || /客厅|起居/i.test(name)) result.add("living_room");
  if (text.includes("pantry") || /储藏|食品库/i.test(name)) result.add("pantry");
  if (text.includes("walk_in_closet") || text.includes("dressing") || /^wic(_|$)/.test(text) || /衣帽间|更衣/i.test(name)) result.add("walk_in_closet");
  if (/(^|_)(hall|hallway|corridor|foyer)(_|$)/.test(text) || /走廊|门厅/i.test(name)) result.add("circulation");
  if (text.includes("recreation") || text.includes("play_area") || /娱乐|活动区|游戏区/i.test(name)) result.add("recreation");
  return [...result];
}

const detailedSemantics = new Set(["open_kitchen", "closed_kitchen", "primary_bathroom", "primary_bedroom"]);
const semanticsConflict = (fromCode: Set<string>, fromName: Set<string>) => {
  if (!fromName.size) return false;
  if (![...fromCode].some((semantic) => fromName.has(semantic))) return true;
  return [...fromName].some((semantic) => detailedSemantics.has(semantic) && !fromCode.has(semantic));
};

/** Single authoritative entry point for G4 and S1 functional-space semantics. */
export function resolveZoneFunctionalSemantics(zone: { name?: string | null; spaceFunctionCode?: string | null }): ZoneFunctionalSemanticResolution {
  const code = typeof zone.spaceFunctionCode === "string" ? zone.spaceFunctionCode : null;
  const nameSemantics = new Set(functionalSemanticsForZoneName(zone.name ?? ""));
  if (code && isSdiSpaceFunctionCode(code)) {
    const semantics = new Set<string>(sdiFunctionalSemantics(code as SdiSpaceFunctionCode)), diagnostics: string[] = [];
    if (semanticsConflict(semantics, nameSemantics)) diagnostics.push(`Zone 名称“${zone.name ?? ""}”与 ${code}-${sdiSpaceFunctionName(code)} 的语义冲突；正式语义以 SF 编码为准`);
    return { semantics, semanticSource: "sdi_code", spaceFunctionCode: code, spaceFunctionName: sdiSpaceFunctionName(code), diagnostics };
  }
  const diagnostics = code ? [`未知 SDI 空间功能编码 ${code}；已降级为名称兼容识别`] : [];
  if (nameSemantics.size) return { semantics: nameSemantics, semanticSource: "name_fallback", spaceFunctionCode: code, spaceFunctionName: null, diagnostics };
  return { semantics: new Set(), semanticSource: "unknown", spaceFunctionCode: code, spaceFunctionName: null, diagnostics: [...diagnostics, "Zone 缺少可用的 SDI 编码和名称语义"] };
}

export function regulatoryUseForZoneName(name: string): RegulatoryRoomUse {
  if (/GARAGE|车库/i.test(name)) return "garage";
  if (/BEDROOM|SLEEP|卧室/i.test(name)) return "sleeping";
  if (/HABITABLE\s+ATTIC|可居住阁楼/i.test(name)) return "habitable_attic";
  if (/BASEMENT|地下室/i.test(name)) return "basement";
  if (/^HALL(?:WAY)?$|CORRIDOR|走廊/i.test(name)) return "hallway";
  if (/KITCHEN|厨房/i.test(name)) return "kitchen";
  if (/BATH|TOILET|WC|卫生间|浴室/i.test(name)) return "bathroom";
  if (/CLOSET|WIC|PANTRY|STORAGE|储藏|衣帽/i.test(name)) return "storage";
  if (/STAIR|FOYER|MUD|OPEN TO BELOW|楼梯|门厅/i.test(name)) return "circulation";
  if (/MEP|LAUNDRY|UTILITY|设备|洗衣/i.test(name)) return "service";
  if (/BEDROOM|LIVING|DINING|DINNING|OFFICE|PLAY|RECREATION|READING|FAMILY|起居|餐厅|书房/i.test(name)) return "habitable";
  return "unknown";
}

export function resolveRegulatoryRoomSemantic(names: string[], override?: RegulatoryRoomUse): RegulatoryRoomSemantic {
  if (override) return { use: override, confidence: "high", names, reason: "评价配置明确指定 Room 法规用途" };
  const uses = [...new Set(names.map(regulatoryUseForZoneName))], known = uses.filter((use) => use !== "unknown");
  if (!names.length || !known.length) return { use: "unknown", confidence: "low", names, reason: "Room 缺少可靠用途语义" };
  if (known.length === 1 && uses.every((use) => use === known[0] || use === "unknown")) return { use: known[0]!, confidence: uses.includes("unknown") ? "medium" : "high", names, reason: "匹配 Zone 名称形成一致用途语义" };
  if (known.some((use) => use === "sleeping" || use === "habitable") && known.every((use) => ["sleeping", "habitable", "kitchen", "circulation", "hallway"].includes(use))) return { use: "habitable", confidence: "medium", names, reason: "同一开放 Room 包含居住用途及其附属客餐厨/交通 Zone，法规测量仍以完整 Room Region 为主体" };
  return { use: "unknown", confidence: "low", names, reason: `开放或复合 Room 用途混合：${names.join(" / ")}` };
}

export const isEnclosedSpaceZoneName = (name: string) => /\b(BED(?:ROOM)?|BATH|TOILET|WC|WIC|CLOSET|PANTRY|LAUNDRY|MEP|STORAGE)\b|卧室|卫生间|浴室|储藏|衣帽间/i.test(name);

export function semanticSpaces(handoff: EvaluationHandoff, analysis: RoomRegionAnalysis): SemanticSpace[] {
  const zones = new Map(handoff.zones.map((zone) => [zone.id, zone]));
  return analysis.rooms.filter((room) => room.usableForEvaluation).map((room) => {
    const zoneIds = [...new Set(analysis.roomToZoneIds[room.roomRegionId] ?? [])];
    const roomZones = zoneIds.map((id) => zones.get(id)).filter((zone): zone is EvaluationHandoff["zones"][number] => Boolean(zone)), resolutions = roomZones.map(resolveZoneFunctionalSemantics);
    const zoneNames = roomZones.map((zone) => zone.name?.trim()).filter((name): name is string => Boolean(name));
    return { room, zoneIds, zoneNames, semantics: new Set(resolutions.flatMap((resolution) => [...resolution.semantics])), sdiSemantics: new Set(resolutions.filter((resolution) => resolution.semanticSource === "sdi_code").flatMap((resolution) => [...resolution.semantics])), fallbackSemantics: new Set(resolutions.filter((resolution) => resolution.semanticSource === "name_fallback").flatMap((resolution) => [...resolution.semantics])), semanticSources: new Set(resolutions.map((resolution) => resolution.semanticSource)), spaceFunctionCodes: resolutions.flatMap((resolution) => resolution.spaceFunctionCode ? [resolution.spaceFunctionCode] : []), diagnostics: resolutions.flatMap((resolution) => resolution.diagnostics) };
  });
}
