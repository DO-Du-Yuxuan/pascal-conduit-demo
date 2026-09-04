import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { relateOpeningToHostBoundary } from "./geometry";
import { buildBuildingEnvelopes, outsideFootprintArea, polygonArea } from "./envelope";
import { buildRoomRegionAnalysis, type RoomRegionAnalysis } from "./room-regions";
import { placementFootprint, type PlacementEntity } from "./physical-placement";
import { hasFunctionTag } from "./object-semantics";
import { G1_GEOMETRY_TOLERANCES as T } from "./tolerances";
import { isEnclosedSpaceZoneName } from "./space-semantics";
import type { G1Rule, RuleDiagnostic, RuleResult, RuleStatus } from "./types";

type Entity = { id: string; rawPascalId: string; levelId: string | null; parentId: string | null; name?: string | null };
const collections = ["levels", "spaces", "walls", "doors", "windows", "furniture", "equipment", "columns", "shelves", "stairs", "shafts"] as const;
const entities = (h: EvaluationHandoff) => collections.flatMap((key) => h[key] as Entity[]);
const ids = (items: Entity[]) => [...new Set(items.map((item) => item.id))];
const rawIds = (items: Entity[]) => [...new Set(items.map((item) => item.rawPascalId))];
const confidence = (level: "high" | "medium" | "low", reasons: string[] = []) => ({ level, score: level === "high" ? 1 : level === "medium" ? 0.75 : 0.4, reasons });
const roomAnalysisCache = new WeakMap<object, RoomRegionAnalysis>();
const roomAnalysis = (handoff: EvaluationHandoff) => { const cached = roomAnalysisCache.get(handoff); if (cached) return cached; const built = buildRoomRegionAnalysis(handoff); roomAnalysisCache.set(handoff, built); return built; };
const result = (ruleId: string, ruleName: string, status: RuleStatus, summary: string, partial: Partial<RuleResult> = {}): RuleResult => ({
  ruleId, ruleName, status, severity: status === "issue" ? "error" : status === "unable_to_determine" ? "warning" : "info", summary,
  details: [], normalizedObjectIds: [], pascalSourceIds: [], measurements: [], thresholds: [], missingData: [], confidence: confidence("high"), diagnostics: [], ...partial,
});
const finitePoint = (value: unknown): value is number[] => Array.isArray(value) && value.length >= 2 && value.every(Number.isFinite);
const positive = (value: unknown) => Number.isFinite(value) && (value as number) > T.lengthMeters;

export const ruleG1001: G1Rule = (h) => {
  const expected = { length: "meter", area: "square-meter", angles: "radian" }, mismatches = Object.entries(expected).filter(([key, value]) => h.units[key as keyof typeof expected] !== value);
  return result("G1-001", "项目单位有效", mismatches.length ? "issue" : "pass", mismatches.length ? "项目单位与评价器支持的单位不一致" : "长度、面积和角度单位均受支持", {
    details: mismatches.map(([key, value]) => `${key} 应为 ${value}`), measurements: Object.entries(expected).map(([name]) => ({ name, value: h.units[name as keyof typeof expected] })), thresholds: Object.entries(expected).map(([name, value]) => ({ name: `required-${name}`, value })), confidence: confidence("high"),
  });
};

export const ruleG1002: G1Rule = (h) => {
  const all = entities(h), byId = new Map<string, Entity[]>();
  all.forEach((item) => byId.set(item.id, [...(byId.get(item.id) ?? []), item]));
  const duplicates = [...byId.entries()].filter(([, matches]) => matches.length > 1), affected = duplicates.flatMap(([, matches]) => matches);
  return result("G1-002", "参与评价的对象具有唯一身份", duplicates.length ? "issue" : "pass", duplicates.length ? `发现 ${duplicates.length} 个重复标准化 ID` : `${all.length} 个参与评价对象的标准化 ID 唯一`, {
    details: duplicates.map(([id, matches]) => `${id} 出现 ${matches.length} 次`), normalizedObjectIds: ids(affected), pascalSourceIds: rawIds(affected), measurements: [{ name: "participatingObjectCount", value: all.length }, { name: "duplicateIdCount", value: duplicates.length }], thresholds: [{ name: "maximumDuplicateIdCount", value: 0 }], confidence: confidence("high"),
  });
};

export const ruleG1003: G1Rule = (h) => {
  const levelIds = new Set(h.levels.map((level) => level.id)), unresolved = entities(h).filter((item) => !item.levelId || !levelIds.has(item.levelId));
  return result("G1-003", "对象的楼层归属明确", unresolved.length ? "issue" : "pass", unresolved.length ? `${unresolved.length} 个对象缺少有效楼层归属` : "所有参与评价对象均可归属到已知楼层", {
    details: unresolved.map((item) => `${item.id}: ${item.levelId ? `楼层 ${item.levelId} 不存在` : "未解析出楼层"}`), normalizedObjectIds: ids(unresolved), pascalSourceIds: rawIds(unresolved), measurements: [{ name: "unresolvedLevelObjectCount", value: unresolved.length }], thresholds: [{ name: "maximumUnresolvedLevelObjectCount", value: 0 }], missingData: unresolved.map((item) => `${item.id}.levelId`), confidence: confidence("high"),
  });
};

export const ruleG1004: G1Rule = (h) => {
  const invalid: Entity[] = [], diagnostics: RuleDiagnostic[] = [], add = (item: Entity, reason: string, diagnostic?: Omit<RuleDiagnostic, "severity" | "code" | "message" | "normalizedObjectIds">) => { invalid.push(item); diagnostics.push({ severity: "error", code: "invalid_dimension_or_coordinate", message: reason, normalizedObjectIds: [item.id], ...diagnostic }); };
  h.spaces.forEach((item) => { if (item.outline.length < 3 || item.outline.some((p) => !finitePoint(p)) || !positive(item.areaSquareMeters)) add(item, `${item.id} 的 Zone 派生轮廓或面积无效`); });
  h.walls.forEach((item) => {
    const length = finitePoint(item.start) && finitePoint(item.end) ? Math.hypot(item.end[0] - item.start[0], item.end[1] - item.start[1]) : null;
    if (!finitePoint(item.start) || !finitePoint(item.end)) add(item, `${item.name ?? item.id} 的起点或终点不是有限坐标`, { field: "wall.start/end", actualValue: `start=${JSON.stringify(item.start)}, end=${JSON.stringify(item.end)}`, expectedValue: "两个有限 [x,z] 坐标", origin: "source_data", recommendation: "检查 Pascal Wall.start 和 Wall.end。" });
    else if (length! <= T.lengthMeters) add(item, `${item.name ?? item.id} 的起点与终点重合，墙长为 0 mm`, { field: "wall.lengthMeters", actualValue: length, expectedValue: `大于 ${T.lengthMeters} m`, origin: "source_data", recommendation: "删除残留零长度墙，或为该墙提供不同的起点和终点。" });
    if (!positive(item.thicknessMeters)) add(item, `${item.name ?? item.id} 的墙厚无效`, { field: "wall.thicknessMeters", actualValue: item.thicknessMeters, expectedValue: `大于 ${T.lengthMeters} m`, origin: "source_data", recommendation: "检查 Pascal Wall.thickness。" });
  });
  [...h.doors, ...h.windows].forEach((item) => { if (!positive(item.widthMeters) || !positive(item.heightMeters) || !finitePoint(item.rawWallLocalPosition)) add(item, `${item.id} 的门窗尺寸或墙局部坐标无效`); });
  [...h.furniture, ...h.equipment, ...h.columns].forEach((item) => { if (!item.dimensionsMeters || item.dimensionsMeters.some((value) => !positive(value)) || item.transformStatus !== "ok" || !finitePoint(item.resolvedWorldPosition)) add(item, `${item.id} 的物体尺寸或解析坐标无效`); });
  h.shelves.forEach((item) => { if (item.dimensionsMeters.some((value) => !positive(value))) add(item, `${item.id} 的架体尺寸无效`); });
  const invalidWalls = h.walls.filter((item) => ids(invalid).includes(item.id));
  return result("G1-004", "对象尺寸与坐标有效", invalid.length ? "issue" : "pass", invalid.length ? `${ids(invalid).length} 个对象存在无效尺寸或坐标` : "已提供的评价对象尺寸与坐标有效", { details: diagnostics.map((d) => d.message), normalizedObjectIds: ids(invalid), pascalSourceIds: rawIds(invalid), measurements: [{ name: "invalidObjectCount", value: ids(invalid).length }, ...invalidWalls.flatMap((wall) => [{ name: "wallStart", value: JSON.stringify(wall.start), normalizedObjectId: wall.id }, { name: "wallEnd", value: JSON.stringify(wall.end), normalizedObjectId: wall.id }, { name: "wallLength", value: wall.start && wall.end ? Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) : null, unit: "m", normalizedObjectId: wall.id }, { name: "wallThickness", value: wall.thicknessMeters, unit: "m", normalizedObjectId: wall.id }, { name: "wallHeight", value: wall.heightMeters, unit: "m", normalizedObjectId: wall.id }, { name: "wallCurveOffset", value: wall.curveOffsetMeters, unit: "m", normalizedObjectId: wall.id }, { name: "footprintValid", value: wall.footprintValidation.valid, normalizedObjectId: wall.id }, { name: "footprintArea", value: wall.footprintValidation.areaSquareMeters, unit: "m²", normalizedObjectId: wall.id }, { name: "footprintCodes", value: wall.footprintValidation.codes.join(", "), normalizedObjectId: wall.id }])], thresholds: [{ name: "minimumLength", value: T.lengthMeters, unit: "m" }, { name: "minimumArea", value: T.areaSquareMeters, unit: "m²" }], confidence: confidence("high"), diagnostics });
};

export const ruleG1005: G1Rule = (h) => {
  const all = [...entities(h), ...h.zones, ...h.unclassifiedNodes.map((item) => ({ ...item, levelId: null, parentId: null }))], known = new Set(all.map((item) => item.id)), broken: Entity[] = [], details: string[] = [], diagnostics: RuleDiagnostic[] = [];
  const note = (item: Entity, target: string | null, kind: string, expected = "现有标准化对象 ID") => { if (target && !known.has(target)) { broken.push(item); const detail = `${item.id}: ${kind} ${target} 不存在`; details.push(detail); diagnostics.push({ severity: "error", code: "missing_reference", message: `${item.name ?? item.id} 的 ${kind} 指向项目中不存在的对象`, normalizedObjectIds: [item.id], field: kind, actualValue: target, expectedValue: expected, origin: "source_data", recommendation: "检查源 Pascal JSON 中的引用 ID；若项目经历复制或楼层重建，请重新关联该对象。" }); } };
  entities(h).forEach((item) => note(item, item.parentId, "parentId"));
  [...h.doors, ...h.windows].forEach((item) => note(item, item.hostWallId, "hostWallId"));
  h.spaces.forEach((item) => note(item, item.sourceZoneId, "sourceZoneId"));
  h.stairs.forEach((item) => { note(item, item.fromLevelId, "fromLevelId", "现有 Level ID"); note(item, item.toLevelId, "toLevelId", "现有 Level ID"); });
  h.shelves.forEach((item) => item.childItemIds.forEach((child: string) => note(item, child, "childItemId")));
  return result("G1-005", "对象关联关系有效", broken.length ? "issue" : "pass", broken.length ? `发现 ${details.length} 条失效引用` : "已声明的对象引用均可解析", { details, normalizedObjectIds: ids(broken), pascalSourceIds: rawIds(broken), measurements: [{ name: "brokenReferenceCount", value: details.length }, { name: "knownLevelIds", value: h.levels.map((level) => level.id).join(", ") }], thresholds: [{ name: "maximumBrokenReferenceCount", value: 0 }], missingData: details, confidence: confidence("high"), diagnostics });
};

export const ruleG1019: G1Rule = (h) => {
  const analysis = roomAnalysis(h), usableRooms = analysis.rooms.filter((room) => room.usableForEvaluation), unnamedZones = h.zones.filter((zone) => !zone.name?.trim()), unmatchedRooms = usableRooms.filter((room) => !analysis.roomToZoneIds[room.roomRegionId]?.length);
  if (!usableRooms.length) return result("G1-019", "主要空间具有明确名称", "unable_to_determine", "未形成可用于命名检查的可靠 Room Region", { missingData: ["可靠 Room Region", "独立 Space 对象"], confidence: confidence("low", analysis.diagnostics.map((item) => item.message)), diagnostics: [{ severity: "warning", code: "room_regions_unavailable", message: "当前无法建立独立物理空间区域，因此不能判断主要空间名称", normalizedObjectIds: [], origin: "insufficient_information" }] });
  const status: RuleStatus = unnamedZones.length ? "issue" : unmatchedRooms.length ? "unable_to_determine" : "pass";
  return result("G1-019", "主要空间具有明确名称", status, unnamedZones.length ? `${unnamedZones.length} 个 Zone 没有名称` : unmatchedRooms.length ? `${unmatchedRooms.length} 个可靠 Room Region 没有 Zone 匹配，无法确认其是否为未命名主要空间` : `${usableRooms.length} 个可靠 Room Region 均至少匹配一个有名称的 Zone`, { details: [...unnamedZones.map((zone) => `${zone.id} 未命名`), ...unmatchedRooms.map((room) => `${room.roomRegionId} 未匹配 Zone`)], normalizedObjectIds: [...unnamedZones.map((zone) => zone.id), ...unmatchedRooms.map((room) => room.roomRegionId)], pascalSourceIds: unnamedZones.map((zone) => zone.rawPascalId), measurements: [{ name: "reliableRoomRegionCount", value: usableRooms.length }, { name: "namedZoneCount", value: h.zones.filter((zone) => zone.name?.trim()).length }, { name: "unnamedZoneCount", value: unnamedZones.length }, { name: "unmatchedRoomCount", value: unmatchedRooms.length }], thresholds: [{ name: "requiredNonBlankName", value: true }], missingData: unmatchedRooms.map((room) => `${room.roomRegionId}: 主要空间语义`), confidence: confidence(status === "pass" ? "medium" : unmatchedRooms.length ? "low" : "medium", ["Room Region 由建筑边界和墙体 footprint 独立生成", ...(unmatchedRooms.length ? ["未匹配 Room 可能是开放区域、交通空间或主要房间"] : [])]), diagnostics: unmatchedRooms.map((room) => ({ severity: "warning", code: "unmatched_room_name_unknown", message: `${room.roomRegionId} 没有 Zone；这不等于已经发现未命名房间`, normalizedObjectIds: [room.roomRegionId], origin: "insufficient_information", recommendation: "在画布核验该区域是否属于主要空间，再决定是否补充 Zone 名称。" })) });
};

export const ruleG1013: G1Rule = (h) => {
  const openings = [...h.doors, ...h.windows];
  if (!openings.length) return result("G1-013", "门窗位于有效开口边界", "not_applicable", "项目中没有门窗对象", { confidence: confidence("high") });
  const wallById = new Map(h.walls.map((wall) => [wall.id, wall])), relations = openings.map((opening) => relateOpeningToHostBoundary(opening, opening.hostWallId ? wallById.get(opening.hostWallId) : undefined)), outside = relations.filter((r) => r.status === "outside"), unknown = relations.filter((r) => r.status === "invalid" || r.status === "unsupported"), affected = openings.filter((opening) => [...outside, ...unknown].some((r) => r.openingId === opening.id));
  const status: RuleStatus = outside.length ? "issue" : unknown.length ? "unable_to_determine" : "pass";
  const openingById = new Map(openings.map((opening) => [opening.id, opening]));
  const relevant = relations.filter((relation) => relation.status !== "inside");
  const diagnostics: RuleDiagnostic[] = relevant.map((relation) => {
    const opening = openingById.get(relation.openingId)!;
    if (relation.status === "outside") {
      const side = (relation.rightOvershootMeters ?? 0) > 0 ? "右侧" : "左侧", overshoot = Math.max(relation.rightOvershootMeters ?? 0, relation.leftOvershootMeters ?? 0);
      return { severity: "error", code: "opening_outside_host_wall", message: `${opening.name ?? opening.id} 的洞口${side}超出宿主墙端约 ${(overshoot * 1000).toFixed(1)} mm`, normalizedObjectIds: [opening.id, relation.wallId!], field: "opening.position[0] + opening.width / 2", actualValue: `${relation.openingEndMeters?.toFixed(6)} m`, expectedValue: `0–${relation.wallLengthMeters?.toFixed(6)} m（容差 ±${T.pointOnBoundaryMeters} m）`, origin: "source_data", recommendation: "检查窗户位置、洞口宽度或宿主墙关系；此检查使用 Pascal width 洞口宽度，不使用 frameThickness/frameDepth 或模型包围盒。" };
    }
    return { severity: "warning", code: relation.status === "unsupported" ? "curved_wall_opening_unsupported" : "invalid_opening_geometry", message: relation.reason ?? "无法判断", normalizedObjectIds: [opening.id], origin: relation.status === "unsupported" ? "insufficient_information" : "source_data", recommendation: relation.status === "unsupported" ? "提供沿曲线弧长的门窗定位后再检查。" : "修复宿主墙或门窗的几何字段后再检查。" };
  });
  return result("G1-013", "门窗位于有效开口边界", status, outside.length ? `${outside.length} 个门窗超出直墙有效区间` : unknown.length ? `${unknown.length} 个门窗因几何或宿主证据不足无法判断` : "所有可评价门窗均位于直墙有效区间", { details: relevant.map((r) => `${r.openingId}: ${r.status}${r.reason ? `（${r.reason}）` : ""}`), normalizedObjectIds: ids(affected), pascalSourceIds: rawIds(affected), measurements: relevant.flatMap((r) => { const opening = openingById.get(r.openingId)!; return [{ name: "wallLength", value: r.wallLengthMeters, unit: "m", normalizedObjectId: r.openingId }, { name: "openingCenterAlongWall", value: r.openingCenterMeters, unit: "m", normalizedObjectId: r.openingId }, { name: "openingWidth", value: opening.widthMeters, unit: "m", normalizedObjectId: r.openingId }, { name: "openingStart", value: r.openingStartMeters, unit: "m", normalizedObjectId: r.openingId }, { name: "openingEnd", value: r.openingEndMeters, unit: "m", normalizedObjectId: r.openingId }, { name: "rightOvershoot", value: r.rightOvershootMeters, unit: "m", normalizedObjectId: r.openingId }, { name: "leftOvershoot", value: r.leftOvershootMeters, unit: "m", normalizedObjectId: r.openingId }, { name: "resolvedWorldPosition", value: JSON.stringify(opening.resolvedWorldPosition), normalizedObjectId: r.openingId }]; }), thresholds: [{ name: "pointOnBoundaryTolerance", value: T.pointOnBoundaryMeters, unit: "m" }], missingData: unknown.map((r) => `${r.openingId}: ${r.reason}`), confidence: confidence(unknown.length ? "medium" : "high", unknown.map((r) => `${r.openingId}: ${r.reason}`)), diagnostics });
};

export const ruleG1006: G1Rule = (h) => {
  const envelopes = buildBuildingEnvelopes(h), unavailable = envelopes.filter((envelope) => !envelope.usableForEvaluation), broken = unavailable.filter((envelope) => envelope.sourceType !== "none");
  const status: RuleStatus = broken.length ? "issue" : unavailable.length ? "unable_to_determine" : "pass";
  return result("G1-006", "建筑平面边界能够识别", status, status === "pass" ? `${envelopes.length} 个参与评价楼层均已由 Slab 轮廓识别有效建筑范围` : broken.length ? `${broken.length} 个楼层的 Slab 边界存在明确几何异常` : `${unavailable.length} 个楼层缺少可作为建筑范围的可靠 Slab 轮廓`, {
    details: envelopes.flatMap((envelope) => envelope.diagnostics.map((diagnostic) => `${envelope.levelId}: ${diagnostic.message}`)),
    normalizedObjectIds: envelopes.flatMap((envelope) => [envelope.levelId, ...envelope.sourceObjectIds]), pascalSourceIds: envelopes.flatMap((envelope) => envelope.pascalSourceIds),
    measurements: envelopes.flatMap((envelope) => [{ name: "envelopeArea", value: envelope.areaSquareMeters, unit: "m²", normalizedObjectId: envelope.levelId }, { name: "polygonCount", value: envelope.polygons.length, normalizedObjectId: envelope.levelId }, { name: "holeCount", value: envelope.holes.length, normalizedObjectId: envelope.levelId }, { name: "usableForEvaluation", value: envelope.usableForEvaluation, normalizedObjectId: envelope.levelId }, { name: "sourceType", value: envelope.sourceType, normalizedObjectId: envelope.levelId }]),
    thresholds: [{ name: "minimumEnvelopeArea", value: T.areaSquareMeters, unit: "m²" }, { name: "boundaryContactTolerance", value: T.pointOnBoundaryMeters, unit: "m" }],
    missingData: unavailable.flatMap((envelope) => envelope.diagnostics.map((diagnostic) => `${envelope.levelId}: ${diagnostic.message}`)), confidence: confidence(status === "pass" ? "medium" : "low", envelopes.flatMap((envelope) => envelope.diagnostics.map((diagnostic) => diagnostic.message))),
    diagnostics: unavailable.flatMap((envelope) => envelope.diagnostics.map((diagnostic) => ({ severity: envelope.sourceType === "none" ? "warning" as const : "error" as const, code: diagnostic.code, message: diagnostic.message, normalizedObjectIds: [envelope.levelId, ...envelope.sourceObjectIds], origin: envelope.sourceType === "none" ? "insufficient_information" as const : "source_data" as const, recommendation: "补充或修复该楼层的可见室内 Floor/Slab Polygon；Zone 不会被当作建筑边界。" }))),
  });
};

export const ruleG1023: G1Rule = (h) => {
  const envelopes = new Map(buildBuildingEnvelopes(h).map((envelope) => [envelope.levelId, envelope])), itemCandidates = (h.items ?? [...h.furniture, ...h.equipment, ...h.columns]).filter((item) => !hasFunctionTag(item, "vehicles", "vehicle")), candidates: PlacementEntity[] = [...itemCandidates, ...h.shelves], contactAreaTolerance = T.pointOnBoundaryMeters ** 2 * 2;
  if (!candidates.length) return result("G1-023", "家具和设备主体位于建筑范围内", "not_applicable", "没有参与室内平面评价的家具、Shelf 柜体或设备");
  const outside: PlacementEntity[] = [], unknown: PlacementEntity[] = [], measurements: RuleResult["measurements"] = [], diagnostics: RuleDiagnostic[] = [];
  for (const item of candidates) {
    const footprint = placementFootprint(item), envelope = item.levelId ? envelopes.get(item.levelId) : undefined, shelf = "style" in item;
    if ((!shelf && !(item.functionTags?.length ?? 0)) || shelf && !(item.functionTags?.length ?? 0) || !footprint) { unknown.push(item); diagnostics.push({ severity: "warning", code: "item_footprint_unavailable", message: `${item.name ?? item.id} 缺少可靠的functionTags、尺寸或平面坐标`, normalizedObjectIds: [item.id], origin: "insufficient_information", recommendation: "补充对象functionTags、宽度、深度和可解析的平面位置后再检查。" }); continue; }
    if (!envelope?.usableForEvaluation) { unknown.push(item); diagnostics.push({ severity: "warning", code: "building_envelope_unavailable", message: `${item.name ?? item.id} 所属楼层没有可靠建筑边界`, normalizedObjectIds: [item.id], origin: "insufficient_information", recommendation: "先补充该楼层的有效 Floor/Slab Polygon。" }); continue; }
    const outsideArea = outsideFootprintArea(footprint, envelope), footprintArea = polygonArea(footprint);
    if (outsideArea === null) { unknown.push(item); diagnostics.push({ severity: "warning", code: "containment_geometry_failed", message: `${item.name ?? item.id} 的包含关系几何计算失败`, normalizedObjectIds: [item.id], origin: "insufficient_information" }); continue; }
    const ratio = footprintArea > 0 ? outsideArea / footprintArea : null;
    if (outsideArea > contactAreaTolerance) { outside.push(item); measurements.push({ name: "footprintArea", value: footprintArea, unit: "m²", normalizedObjectId: item.id }, { name: "outsideArea", value: outsideArea, unit: "m²", normalizedObjectId: item.id }, { name: "outsideAreaRatio", value: ratio, normalizedObjectId: item.id }, { name: "envelopeArea", value: envelope.areaSquareMeters, unit: "m²", normalizedObjectId: item.id }); diagnostics.push({ severity: "error", code: "item_outside_building_envelope", message: `${item.name ?? item.id} 有 ${(outsideArea * 1000000).toFixed(0)} mm² 的平面占地越出建筑范围`, normalizedObjectIds: [item.id, ...envelope.sourceObjectIds], field: "footprint", actualValue: outsideArea, expectedValue: `≤ ${contactAreaTolerance} m²`, origin: "source_data", recommendation: "检查家具/设备位置、尺寸或所属楼层；如该对象属于室外，请使用明确的室外分类。" }); }
  }
  const status: RuleStatus = outside.length ? "issue" : unknown.length ? "unable_to_determine" : "pass";
  const affected = [...outside, ...unknown];
  return result("G1-023", "家具和设备主体位于建筑范围内", status, outside.length ? `发现 ${outside.length} 个家具或设备主体越出建筑范围` : unknown.length ? `${unknown.length} 个对象因占地、楼层或建筑边界不足无法判断` : `${candidates.length} 个参与评价的家具、Shelf 柜体和设备主体均在有效建筑范围内`, {
    normalizedObjectIds: ids(affected),
    pascalSourceIds: rawIds(affected),
    measurements: [{ name: "participatingItemCount", value: itemCandidates.length }, { name: "participatingShelfCount", value: h.shelves.length }, { name: "participatingPhysicalObjectCount", value: candidates.length }, { name: "outsideItemCount", value: outside.length }, { name: "unableToDetermineItemCount", value: unknown.length }, ...measurements],
    thresholds: [{ name: "outsideAreaTolerance", value: contactAreaTolerance, unit: "m²" }, { name: "boundaryContactTolerance", value: T.pointOnBoundaryMeters, unit: "m" }],
    missingData: unknown.map((item) => `${item.id}: 可靠对象footprint、所属Level与建筑边界`),
    confidence: confidence(status === "pass" ? "medium" : unknown.length ? "low" : "medium", ["建筑边界由Slab并集推导", "只检查对象主体平面占地是否越出建筑边界", "嵌墙、对象实体碰撞、开启区和最小人员使用空间由3D编辑器负责"]),
    diagnostics,
    details: diagnostics.map((diagnostic) => diagnostic.message),
  });
};

export const ruleG1007: G1Rule = (h) => {
  const analysis = roomAnalysis(h), required = h.zones.filter((zone) => isEnclosedSpaceZoneName(zone.name ?? ""));
  if (!required.length) return result("G1-007", "应封闭空间的边界闭合", "unable_to_determine", "Zone 缺少足以确认“必须独立封闭”的功能语义", { missingData: ["应封闭空间用途分类"], confidence: confidence("low", ["未根据名称以外的结构化用途字段识别到应封闭空间"]), diagnostics: [{ severity: "warning", code: "enclosure_semantics_unavailable", message: "没有结构化空间用途可用于确认哪些 Zone 必须独立封闭", normalizedObjectIds: [], origin: "insufficient_information" }] });
  const matchByZone = new Map(analysis.zoneMatches.map((match) => [match.zoneId, match])), failed = required.filter((zone) => { const match = matchByZone.get(zone.id); return !match || !["one-to-one", "room-with-multiple-zones"].includes(match.relationship) || match.matchedRoomRegionIds.length !== 1; });
  return result("G1-007", "应封闭空间的边界闭合", failed.length ? "issue" : "pass", failed.length ? `${failed.length} 个明确应封闭的 Zone 未能匹配到单一可靠 Room Region` : `${required.length} 个明确应封闭的 Zone 均匹配到单一可靠 Room Region`, { normalizedObjectIds: failed.map((zone) => zone.id), pascalSourceIds: failed.map((zone) => zone.rawPascalId), measurements: [{ name: "requiredEnclosedZoneCount", value: required.length }, { name: "failedEnclosedZoneCount", value: failed.length }], thresholds: [{ name: "zoneRoomMatchMinimumRatio", value: T.zoneRoomMatchMinimumRatio }], confidence: confidence("medium", ["应封闭语义由严格功能关键词识别", "闭合证据来自独立 Room Region 面积匹配"]), diagnostics: failed.map((zone) => ({ severity: "error", code: "required_zone_not_enclosed", message: `${zone.name ?? zone.id} 未匹配到单一可靠物理空间`, normalizedObjectIds: [zone.id], origin: "source_data", recommendation: "检查该功能区周边墙体是否闭合，或修正 Zone 轮廓。" })) });
};

export const ruleG1009: G1Rule = (h) => {
  const analysis = roomAnalysis(h), abnormalOverlaps = analysis.zoneOverlaps.filter((overlap) => overlap.smallerZoneCoverageRatio > T.zoneOverlapMaximumRatio), crossing = analysis.zoneMatches.filter((match) => match.relationship === "zone-crosses-rooms"), affectedIds = [...new Set([...abnormalOverlaps.flatMap((overlap) => [overlap.zoneAId, overlap.zoneBId]), ...crossing.map((match) => match.zoneId)])], zoneById = new Map(h.zones.map((zone) => [zone.id, zone]));
  const status: RuleStatus = affectedIds.length ? "issue" : analysis.rooms.some((room) => room.usableForEvaluation) ? "pass" : "unable_to_determine";
  return result("G1-009", "不同空间不存在异常重叠", status, abnormalOverlaps.length ? `${abnormalOverlaps.length} 组 Zone 存在无设计依据的显著面积重叠` : crossing.length ? `${crossing.length} 个 Zone 显著跨越多个独立 Room Region` : status === "pass" ? "未发现 Zone 异常重叠或跨越多个独立 Room Region" : "缺少可靠 Room Region，无法检查空间重叠", { normalizedObjectIds: affectedIds, pascalSourceIds: affectedIds.map((id) => zoneById.get(id)?.rawPascalId).filter((id): id is string => Boolean(id)), measurements: [{ name: "zonePairOverlapCount", value: abnormalOverlaps.length }, { name: "zoneCrossRoomCount", value: crossing.length }, ...abnormalOverlaps.map((overlap) => ({ name: "zoneOverlapArea", value: overlap.intersectionAreaSquareMeters, unit: "m²", normalizedObjectId: overlap.zoneAId }))], thresholds: [{ name: "overlapAreaTolerance", value: T.overlapAreaSquareMeters, unit: "m²" }, { name: "zoneOverlapMaximumRatio", value: T.zoneOverlapMaximumRatio }, { name: "zoneCrossRoomMinimumRatio", value: T.zoneCrossRoomMinimumRatio }], confidence: confidence(status === "unable_to_determine" ? "low" : "medium", ["开放式空间内多个不重叠 Zone 共享同一 Room 不视为异常"]), diagnostics: [...abnormalOverlaps.map((overlap) => ({ severity: "error" as const, code: "abnormal_zone_overlap", message: `${zoneById.get(overlap.zoneAId)?.name ?? overlap.zoneAId} 与 ${zoneById.get(overlap.zoneBId)?.name ?? overlap.zoneBId} 重叠 ${overlap.intersectionAreaSquareMeters.toFixed(3)} m²`, normalizedObjectIds: [overlap.zoneAId, overlap.zoneBId], origin: "source_data" as const, recommendation: "检查两个功能 Zone 的轮廓是否重复绘制。" })), ...crossing.map((match) => ({ severity: "error" as const, code: "zone_crosses_rooms", message: `${zoneById.get(match.zoneId)?.name ?? match.zoneId} 跨越 ${match.matchedRoomRegionIds.length} 个独立 Room Region`, normalizedObjectIds: [match.zoneId, ...match.matchedRoomRegionIds], origin: "source_data" as const, recommendation: "检查 Zone 轮廓或房间分隔墙。" }))] });
};

export const ruleG1012: G1Rule = (h) => {
  const analysis = roomAnalysis(h), wallById = new Map(h.walls.map((wall) => [wall.id, wall])), artifacts = analysis.rooms.filter((room) => room.geometryArtifact), uncertainFragments = analysis.rooms.filter((room) => !room.usableForEvaluation && !room.geometryArtifact), invalidLevels = analysis.envelopes.filter((envelope) => !envelope.usableForEvaluation);
  const trace = (room: RoomRegionAnalysis["rooms"][number]) => {
    const walls = room.boundaryWallIds.map((id) => wallById.get(id)).filter((wall): wall is NonNullable<typeof wall> => Boolean(wall)), points = room.polygons.flatMap((polygon) => polygon.flatMap((ring) => ring));
    const nearCurvedWall = walls.some((wall) => Math.abs(wall.curveOffsetMeters) > T.lengthMeters);
    const nearWallEnd = walls.some((wall) => [wall.start, wall.end].some((end) => end && points.some((point) => Math.hypot(point[0] - end[0], point[1] - end[1]) <= T.roomWallGapMeters)));
    const inferredSource = nearCurvedWall ? "evaluator_boolean_near_curved_wall" : nearWallEnd ? "evaluator_boolean_near_wall_endpoint" : "evaluator_polygon_boolean_residual";
    return { room, nearCurvedWall, nearWallEnd, inferredSource };
  };
  const artifactTrace = artifacts.map(trace), uncertainTrace = uncertainFragments.map(trace), status: RuleStatus = invalidLevels.length || uncertainFragments.length ? "unable_to_determine" : "pass";
  const measurements: RuleResult["measurements"] = [{ name: "roomRegionCount", value: analysis.rooms.length }, { name: "numericalSliverCount", value: artifacts.length }, { name: "unconfirmedFragmentCount", value: uncertainFragments.length }, ...[...artifactTrace, ...uncertainTrace].flatMap(({ room, nearCurvedWall, nearWallEnd, inferredSource }) => [{ name: "fragmentArea", value: room.areaSquareMeters, unit: "m²", normalizedObjectId: room.roomRegionId }, { name: "fragmentPerimeter", value: room.perimeterMeters, unit: "m", normalizedObjectId: room.roomRegionId }, { name: "fragmentCompactness", value: room.compactness, normalizedObjectId: room.roomRegionId }, { name: "fragmentLevelId", value: room.levelId, normalizedObjectId: room.roomRegionId }, { name: "nearbyWallIds", value: room.boundaryWallIds.join(","), normalizedObjectId: room.roomRegionId }, { name: "nearCurvedWall", value: nearCurvedWall, normalizedObjectId: room.roomRegionId }, { name: "nearWallEndpoint", value: nearWallEnd, normalizedObjectId: room.roomRegionId }, { name: "inferredSource", value: inferredSource, normalizedObjectId: room.roomRegionId }])];
  const diagnostics: RuleDiagnostic[] = [...artifactTrace.map(({ room, nearCurvedWall, nearWallEnd, inferredSource }) => ({ severity: "warning" as const, code: "geometry_artifact", message: `${room.roomRegionId}：面积 ${room.areaSquareMeters.toFixed(6)} m²、周长 ${room.perimeterMeters.toFixed(4)} m、紧凑度 ${room.compactness.toFixed(4)}；邻近墙 ${room.boundaryWallIds.join(", ") || "无"}；邻近曲墙=${nearCurvedWall}；邻近墙端=${nearWallEnd}；推测来源=${inferredSource}`, normalizedObjectIds: [room.roomRegionId, ...room.boundaryWallIds], origin: "geometry_tolerance" as const, recommendation: "该区域明确低于数值残差阈值，仅保留技术诊断，不影响 G1 状态。" })), ...uncertainTrace.map(({ room, inferredSource }) => ({ severity: "warning" as const, code: "room_fragment_origin_unconfirmed", message: `${room.roomRegionId} 面积 ${room.areaSquareMeters.toFixed(4)} m²，但尚不能确认属于源数据异常还是评价器布尔运算残片；推测来源=${inferredSource}`, normalizedObjectIds: [room.roomRegionId, ...room.boundaryWallIds], origin: "insufficient_information" as const, recommendation: "在画布核对原始 Slab、墙端与曲墙几何后再决定是否修复源数据。" }))];
  return result("G1-012", "不存在错误空间", status, invalidLevels.length ? "部分楼层缺少可靠建筑边界，无法排查错误空间" : uncertainFragments.length ? `${uncertainFragments.length} 个空间碎片来源尚不能确认` : artifacts.length ? `未发现需要设计师处理的错误空间；${artifacts.length} 个数值残差仅保留技术诊断` : `未在 ${analysis.rooms.length} 个 Room Region 中发现几何碎片`, { details: diagnostics.map((diagnostic) => diagnostic.message), normalizedObjectIds: uncertainFragments.map((room) => room.roomRegionId), pascalSourceIds: [...new Set(uncertainFragments.flatMap((room) => room.pascalSourceIds))], measurements, thresholds: [{ name: "minimumRoomArea", value: T.roomMinimumAreaSquareMeters, unit: "m²" }, { name: "numericalSliverArea", value: T.roomNumericalSliverAreaSquareMeters, unit: "m²" }, { name: "minimumRoomCompactness", value: T.roomSlendernessMinimum }, { name: "wallEndpointProximity", value: T.roomWallGapMeters, unit: "m" }], missingData: uncertainFragments.map((room) => `${room.roomRegionId}: 原始几何与布尔运算来源确认`), confidence: confidence(status === "pass" ? "high" : "low", ["低于 0.001 m² 且形状极小的区域判为评价器计算残差", "来源未确认的碎片不会被直接认定为设计错误"]), diagnostics });
};

export const FIRST_G1_RULES: G1Rule[] = [ruleG1001, ruleG1002, ruleG1003, ruleG1004, ruleG1005, ruleG1006, ruleG1007, ruleG1009, ruleG1012, ruleG1013, ruleG1019, ruleG1023];
