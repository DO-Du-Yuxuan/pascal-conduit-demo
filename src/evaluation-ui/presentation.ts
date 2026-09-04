import type { RuleResult } from "../evaluation/types";
import type { NodeData } from "../types";
import { resolveAncestorLevelId } from "../geometry/transform";
import type { RoomRegionAnalysis } from "../evaluation/room-regions";

export type EvaluationFocusTarget = {
  primaryId: string;
  relatedIds: string[];
  label: string;
  levelId: string | null;
  levelName: string;
  status?: RuleResult["status"] | "measured";
};

export type DesignerRulePresentation = {
  title: string;
  description: string;
  rationale: string;
  recommendation: string;
  supplemental?: string;
  problemCountLabel: string;
  targets: EvaluationFocusTarget[];
};

/** A canvas-facing index of every issue that has a known renderable object. */
export type EvaluationIssueTarget = EvaluationFocusTarget & { ruleId: string; targetIndex: number };
const statusPriority: Record<RuleResult["status"], number> = { issue: 0, unable_to_determine: 1, pass: 2, not_applicable: 3 };
const furnitureSpecialistRule = (ruleId: string) => /^G3-0(?:1[4-9]|2[0-4])$/.test(ruleId);
const fixtureSpecialistRule = (ruleId: string) => /^G3-0(?:2[5-9]|3[0-8])$/.test(ruleId);
const fixtureItemRule = (ruleId: string) => ["G3-026", "G3-027", "G3-029", "G3-032", "G3-034", "G3-035", "G3-036", "G3-038"].includes(ruleId);
const operationItemRule = (ruleId: string) => ["G3-010", "G3-011", "G3-012", "G3-039", "G3-040", "G3-042", "G3-043", "G3-044"].includes(ruleId);
const finalOperationRule = (ruleId: string) => /^G3-0(?:0[9]|1[0-2]|3[9]|4[0-4])$/.test(ruleId);
export const orderEvaluationRulesForDisplay = (rules: RuleResult[]) => rules.map((rule, index) => ({ rule, index })).sort((a, b) => statusPriority[a.rule.status] - statusPriority[b.rule.status] || a.index - b.index).map((item) => item.rule);
/** Keep a technical dependency in the report/counts while avoiding a duplicate user card. */
export const isDependencyOnlyTechnicalRule = (rule: RuleResult) => rule.ruleId === "G2-008" && rule.status === "unable_to_determine" && rule.measurements.some((item) => item.name === "blockedRoomCount" && item.value !== 0) && !rule.diagnostics.some((item) => item.origin === "insufficient_information");

const measurement = (rule: RuleResult, name: string) => rule.measurements.find((item) => item.name === name)?.value;
const humanLevelName = (levelId: string | undefined, nodes: Record<string, NodeData>) => levelId ? nodes[levelId]?.name || "未命名楼层" : "楼层未确定";

export function evaluationFocusTargets(rule: RuleResult, nodes: Record<string, NodeData>, roomAnalysis?: RoomRegionAnalysis | null): EvaluationFocusTarget[] {
  if (rule.status !== "issue" && rule.status !== "unable_to_determine") return [];
  if (rule.ruleId.startsWith("G4-")) {
    const ids = new Set(rule.normalizedObjectIds);
    const roomTargets = (roomAnalysis?.rooms ?? []).filter((room) => ids.has(room.roomRegionId) && room.usableForEvaluation).map((room) => {
      const zoneIds = roomAnalysis?.roomToZoneIds[room.roomRegionId] ?? [];
      const zoneNames = zoneIds.map((id) => nodes[id]?.name?.trim()).filter((value): value is string => Boolean(value));
      return { primaryId: room.roomRegionId, relatedIds: zoneIds, label: `${zoneNames.join(" / ") || "相关空间"} · ${humanLevelName(room.levelId, nodes)}`, levelId: room.levelId, levelName: humanLevelName(room.levelId, nodes), status: rule.status };
    });
    if (roomTargets.length) return roomTargets;
    return rule.normalizedObjectIds.map((id) => nodes[id]).filter((node): node is NodeData => Boolean(node) && node.type === "zone").map((node) => {
      const levelId = resolveAncestorLevelId(node.id, nodes).levelId ?? null;
      return { primaryId: node.id, relatedIds: [], label: `${node.name || "相关空间"} · ${humanLevelName(levelId ?? undefined, nodes)}`, levelId, levelName: humanLevelName(levelId ?? undefined, nodes), status: rule.status };
    });
  }
  const includeWholeDiagnostic = ["G2-002", "G2-007", "G2-008", "G2-011", "G2-012", "G2-013", "G2-014", "G2-015", "G2-016", "G2-017", "G2-019", "G2-020"].includes(rule.ruleId);
  const diagnosticIds = [...new Set(rule.diagnostics.filter((diagnostic) => rule.status === "issue" ? diagnostic.severity === "error" : diagnostic.severity !== "info").flatMap((diagnostic) => includeWholeDiagnostic ? diagnostic.normalizedObjectIds : diagnostic.normalizedObjectIds.slice(0, 1)))];
  const focusIds = rule.ruleId === "G1-023" && rule.status === "issue" ? [...new Set(rule.diagnostics.filter((diagnostic) => diagnostic.code === "item_outside_building_envelope").flatMap((diagnostic) => diagnostic.normalizedObjectIds.slice(0, 1)))] : rule.ruleId === "G2-019" ? diagnosticIds : ["G3-001", "G3-002", "G3-007", "G3-008", "G3-009"].includes(rule.ruleId) || rule.status === "unable_to_determine" ? diagnosticIds : rule.normalizedObjectIds;
  const candidates = focusIds.map((id) => nodes[id]).filter((node): node is NodeData => Boolean(node));
  const primary = rule.ruleId === "G1-004" ? candidates.filter((node) => node.type === "wall")
    : rule.ruleId === "G1-005" || ["G2-002", "G2-011", "G2-012", "G2-013", "G2-014", "G2-015"].includes(rule.ruleId) || rule.ruleId === "G3-001" ? candidates.filter((node) => node.type === "stair")
    : ["G2-006", "G2-017", "G2-020"].includes(rule.ruleId) ? candidates.filter((node) => node.type === "item")
      : rule.ruleId === "G1-013" ? candidates.filter((node) => node.type === "window" || node.type === "door")
        : rule.ruleId === "G1-023" ? candidates.filter((node) => node.type === "item" || node.type === "shelf")
          : ["G2-001", "G2-009", "G3-002", "G3-007", "G3-008", "G3-009"].includes(rule.ruleId) ? candidates.filter((node) => node.type === "door")
          : ["G2-006", "G2-017"].includes(rule.ruleId) ? candidates.filter((node) => node.type === "item")
          : rule.ruleId === "G2-019" ? candidates.filter((node) => node.type === "zone")
          : ["G2-007", "G2-008"].includes(rule.ruleId) ? candidates.filter((node) => node.type === "window" || node.type === "door")
          : rule.ruleId === "G3-037" ? candidates.filter((node) => node.type === "door")
          : rule.ruleId === "G3-025" ? candidates.filter((node) => node.type === "zone")
          : fixtureItemRule(rule.ruleId) ? candidates.filter((node) => node.type === "item")
          : operationItemRule(rule.ruleId) ? candidates.filter((node) => node.type === "item" || rule.ruleId === "G3-042" && node.type === "shelf")
          : furnitureSpecialistRule(rule.ruleId) ? candidates.filter((node) => node.type === "item")
          : ["G1-007", "G1-009", "G1-019"].includes(rule.ruleId) ? candidates.filter((node) => node.type === "zone") : [];
  const nodeTargets = primary.map((node, index) => {
    const levelId = resolveAncestorLevelId(node.id, nodes).levelId ?? null, levelName = humanLevelName(levelId ?? undefined, nodes);
    const typeLabel = rule.ruleId === "G1-004" ? `无效墙体 ${index + 1}` : rule.ruleId === "G1-023" ? `${node.name || (node.type === "shelf" ? "Shelf 柜体" : "家具或设备")} ${index + 1}` : node.type === "zone" ? `${node.name || "功能区"} ${index + 1}` : node.type === "shelf" ? `${node.name || "Shelf 柜体"} ${index + 1}` : node.type === "item" ? `${node.name || "家具或设备"} ${index + 1}` : node.type === "stair" ? "楼梯" : node.type === "window" ? "窗户" : "门";
    const hostId = rule.ruleId === "G1-013" ? node.wallId ?? node.parentId : null;
    const diagnosticRelated = rule.diagnostics.filter((diagnostic) => diagnostic.normalizedObjectIds.includes(node.id)).flatMap((diagnostic) => diagnostic.normalizedObjectIds.filter((id) => id !== node.id && nodes[id] && resolveAncestorLevelId(id, nodes).levelId === levelId));
    const eeroHost = ["G2-007", "G2-008"].includes(rule.ruleId) ? node.wallId ?? node.parentId : null;
    const kitchenSinkEvidenceIds = rule.ruleId === "G2-019" ? rule.measurements.filter((item) => item.name === "kitchenSinkAreaAssociation" && item.value === "unassociated" && item.normalizedObjectId && nodes[item.normalizedObjectId]).map((item) => item.normalizedObjectId!) : [];
    const relatedIds = rule.ruleId.startsWith("G2-") || rule.ruleId.startsWith("G3-") || rule.ruleId === "G1-023" ? [...diagnosticRelated, ...kitchenSinkEvidenceIds, ...(eeroHost && nodes[eeroHost] ? [eeroHost] : [])].filter((id, index, all) => all.indexOf(id) === index) : hostId && nodes[hostId] ? [hostId] : [];
    return { primaryId: node.id, relatedIds, label: `${typeLabel} · ${levelName}`, levelId, levelName, status: rule.status };
  });
  const roomTargets = ["G1-012", "G1-019", "G2-003", "G2-004", "G2-005", "G2-007", "G2-008", "G2-009", "G2-010", "G2-016", "G2-017", "G2-019", "G3-001", "G3-003", "G3-004", "G3-005", "G3-006", "G3-017", "G3-019", "G3-021", "G3-024", "G3-025", "G3-028", "G3-030", "G3-031", "G3-033", "G3-041"].includes(rule.ruleId) ? (roomAnalysis?.rooms ?? []).filter((room) => focusIds.includes(room.roomRegionId)).map((room, index) => { const navigationRule = ["G2-010", "G2-016", "G2-017", "G2-019", "G3-003", "G3-004", "G3-006", "G3-017", "G3-019", "G3-021", "G3-024", "G3-025", "G3-028", "G3-030", "G3-031", "G3-033", "G3-041"].includes(rule.ruleId), relatedIds = ["G2-007", "G2-008"].includes(rule.ruleId) ? rule.diagnostics.filter((diagnostic) => diagnostic.normalizedObjectIds.includes(room.roomRegionId)).flatMap((diagnostic) => diagnostic.normalizedObjectIds.filter((id) => id !== room.roomRegionId && nodes[id])).filter((id, position, all) => all.indexOf(id) === position) : navigationRule ? rule.diagnostics.filter((diagnostic) => diagnostic.normalizedObjectIds.includes(room.roomRegionId)).flatMap((diagnostic) => diagnostic.normalizedObjectIds.filter((id) => id !== room.roomRegionId && nodes[id])).filter((id, position, all) => all.indexOf(id) === position) : rule.ruleId === "G3-001" && rule.status === "unable_to_determine" ? [] : room.boundaryWallIds, zoneNames = (roomAnalysis?.roomToZoneIds[room.roomRegionId] ?? []).map((id) => nodes[id]?.name?.trim()).filter((value): value is string => Boolean(value)), roomName = zoneNames.join(" / ") || `${rule.ruleId === "G3-001" ? "跨层待核验空间" : rule.ruleId === "G3-005" ? "无入口空间" : navigationRule ? rule.status === "unable_to_determine" ? "待核验空间" : "通行受阻空间" : "异常空间"} ${index + 1}`; return { primaryId: room.roomRegionId, relatedIds, label: `${roomName} · ${humanLevelName(room.levelId, nodes)}`, levelId: room.levelId, levelName: humanLevelName(room.levelId, nodes), status: rule.status }; }) : [];
  return [...nodeTargets, ...roomTargets];
}

export function designerRulePresentation(rule: RuleResult, nodes: Record<string, NodeData>, roomAnalysis?: RoomRegionAnalysis | null): DesignerRulePresentation {
  const targets = evaluationFocusTargets(rule, nodes, roomAnalysis), count = targets.length;
  if (rule.ruleId.startsWith("G4-") && rule.customerRequirement) return {
    title: rule.ruleName,
    description: rule.summary,
    rationale: rule.customerRequirement.reason,
    recommendation: rule.status === "issue" ? "调整方案以满足该客户需求，或与客户确认是否接受当前结果。" : rule.status === "unable_to_determine" ? "按人工检查说明核对并记录客户确认结果。" : "无需处理。",
    supplemental: rule.status === "unable_to_determine" ? "需要人工检查不等于客户需求未满足。" : undefined,
    problemCountLabel: rule.status === "pass" ? "0" : "1",
    targets,
  };
  if (rule.ruleId === "G1-004" && rule.status === "issue") return {
    title: `发现 ${count} 段无效墙体`,
    description: "这些墙段的起点和终点重合，实际长度为 0，可能是误操作产生的无效墙段。",
    rationale: "零长度墙无法形成有效墙面，也可能影响后续尺寸、开口和空间检查。",
    recommendation: "在图中逐段定位后删除无效墙体，或重新确定墙体的起点和终点。",
    problemCountLabel: String(count), targets,
  };
  if (rule.ruleId === "G1-005" && rule.status === "issue") return {
    title: "楼梯的楼层关联已丢失",
    description: "这座楼梯记录的起始楼层和到达楼层在当前项目中都不存在，因此无法确认它实际连接的楼层。",
    rationale: "楼层关联缺失会使跨层关系、到达层入口和后续通行检查失去依据。",
    recommendation: "检查楼梯的上下楼层设置，并重新关联到项目中的有效楼层。",
    supplemental: "可以在图中定位楼梯本身；缺失的楼层无法高亮。",
    problemCountLabel: String(count), targets,
  };
  if (rule.ruleId === "G1-013" && rule.status === "issue") {
    const overshoot = Number(measurement(rule, "rightOvershoot") ?? measurement(rule, "leftOvershoot")), tolerance = Number(rule.thresholds.find((item) => item.name === "pointOnBoundaryTolerance")?.value);
    return {
      title: "窗户超出所在墙体",
      description: `该窗洞右侧超出宿主墙约 ${Number.isFinite(overshoot) ? Math.round(overshoot * 1000) : "—"} 毫米，超过当前允许的 ${Number.isFinite(tolerance) ? Math.round(tolerance * 1000) : "—"} 毫米几何容差。`,
      rationale: "超出墙端的洞口可能造成墙体与窗洞关系错误，并影响施工尺寸。",
      recommendation: "检查窗户位置、洞口宽度或宿主墙长度。",
      problemCountLabel: String(count), targets,
    };
  }
  if (rule.ruleId === "G1-019" && rule.status === "unable_to_determine") {
    const reliableRoomCount = Number(measurement(rule, "reliableRoomRegionCount") ?? 0);
    const unmatchedRoomCount = Number(measurement(rule, "unmatchedRoomCount") ?? 0);
    return {
      title: "主要空间名称暂时无法完整核验",
      description: reliableRoomCount === 0
        ? "当前没有形成可用于命名核验的可靠 Room Region，系统不会把 Zone 直接当作房间。"
        : `当前识别出 ${reliableRoomCount} 个可靠 Room Region，其中 ${unmatchedRoomCount} 个尚未匹配到可用于命名的 Zone。`,
      rationale: "物理房间与设计师标注的功能 Zone 是两类对象；只有可靠匹配后才能核验房间名称。",
      recommendation: reliableRoomCount === 0 ? "先检查建筑边界和墙体分隔是否能形成可靠空间。" : "核对未匹配 Room Region 附近的 Zone 范围和名称。",
      supplemental: "这不代表已经发现未命名房间。",
      problemCountLabel: "未确定", targets: [],
    };
  }
  if (rule.ruleId === "G1-006") {
    const unavailable = Number(measurement(rule, "usableForEvaluation") === false ? 1 : 0);
    return {
      title: rule.status === "pass" ? "已识别各楼层的建筑范围" : "建筑范围暂时无法可靠识别",
      description: rule.status === "pass" ? "系统已根据楼层中的 Floor/Slab 轮廓生成建筑平面范围。" : "当前 Floor/Slab 轮廓不足或存在异常，系统不能可靠判断该楼层的室内建筑范围。",
      rationale: "建筑范围是判断家具、设备和后续空间关系的共同依据。",
      recommendation: rule.status === "pass" ? "可在画布中打开“显示建筑边界”核对结果。" : "检查该楼层的 Floor/Slab 轮廓是否完整、闭合且属于室内区域。",
      problemCountLabel: rule.status === "pass" ? "0" : String(Math.max(1, unavailable)), targets: [],
    };
  }
  if (rule.ruleId === "G1-023" && rule.status === "issue") return {
    title: `发现 ${count} 个家具或设备主体越出建筑范围`,
    description: rule.summary,
    rationale: "本项只核对对象主体的平面占地是否落在Floor/Slab形成的建筑边界内，不检查嵌墙、对象碰撞或开启使用空间。",
    recommendation: "逐个在图中查看红色对象，调整位置、尺寸或所属楼层，使对象主体回到建筑范围内。",
    problemCountLabel: String(count), targets,
  };
  if (rule.ruleId === "G1-023" && rule.status === "unable_to_determine") return {
    title: "部分家具或设备的建筑范围关系待核验",
    description: "缺少可靠建筑边界、对象平面占地或所属楼层，系统不会猜测对象主体是否越界。",
    rationale: "本项只需要对象主体平面占地与所属楼层建筑边界；实体碰撞由3D编辑器检查。",
    recommendation: "补充Floor/Slab轮廓以及对象位置、宽度、深度和所属楼层。",
    problemCountLabel: "未确定", targets,
  };
  if (rule.ruleId === "G1-007") return { title: rule.status === "pass" ? "需要独立封闭的空间边界完整" : "部分应封闭空间没有形成独立房间", description: rule.summary, rationale: "卧室、卫生间和储藏类空间需要可靠边界，才能支持隐私、功能和后续通行检查。", recommendation: rule.status === "pass" ? "无需处理。" : "检查对应 Zone 周边墙体闭合情况和 Zone 轮廓。", problemCountLabel: rule.status === "issue" ? String(count) : "0", targets };
  if (rule.ruleId === "G1-009") return { title: rule.status === "issue" ? "发现功能区域异常重叠" : "未发现空间异常重叠", description: rule.summary, rationale: "重复或跨房间的功能区域会造成面积统计和空间归属错误。", recommendation: rule.status === "issue" ? "在图中检查红色 Zone 的轮廓是否重复或跨越分隔墙。" : "无需处理。", problemCountLabel: rule.status === "issue" ? String(count) : "0", targets };
  if (rule.ruleId === "G1-012") return { title: rule.status === "issue" ? `发现 ${count} 个异常空间碎片` : "未发现错误空间", description: rule.summary, rationale: "极小或细长区域通常来自墙端缝隙、曲墙离散或边界误差，并非真实房间。", recommendation: rule.status === "issue" ? "逐个定位并检查相邻墙端与 Slab 边界。" : "无需处理。", problemCountLabel: rule.status === "issue" ? String(count) : "0", targets };
  if (rule.ruleId.startsWith("G2-")) {
    const copy: Record<string, { issue: string; unable: string; rationale: string; recommendation: string }> = {
      "G2-001": { issue: "必要疏散门净开口不符合规范", unable: "必要疏散门净开口无法判断", rationale: "本项检查可靠 Room–Exterior 外门中的侧铰门；有实测值时优先采用，否则按完整门洞扣除两侧各5/8英寸门框止口推定净开口，不把双扇门机械除以二。", recommendation: "优先现场复核门扇开启90°时的实际净宽及门槛至门挡净高；若平面推定已不足，应调整门洞或门型。" },
      "G2-002": { issue: "普通楼梯踏步或踢面尺寸不符合规范", unable: "普通楼梯部分踏步尺寸无法判断", rationale: "优先使用逐级几何；只有总高或总进深时仅派生平均值，不能凭平均值证明实际极差。螺旋、扇形等特殊楼梯不套用普通楼梯参数。", recommendation: "点击“在图中查看”定位楼梯，核对逐级踏步、踢面、梯段类型及模型是否明确均匀生成。" },
      "G2-003": { issue: "住宅走廊最窄处低于规范", unable: "住宅走廊净宽无法判断", rationale: "测量基于可靠 hallway Room 的真实墙面边界，并沿分支和凹折墙面建立局部垂直截面；普通房间内路径及可移动家具不作为建筑走廊法定净宽。", recommendation: "调整墙体或永久固定构件，或核验走廊用途和真实净边界。" },
      "G2-004": { issue: "居住房间可计入平面面积低于规范", unable: "居住房间面积证据不完整", rationale: "测量主体是完整 Room Region，并结合现有 Ceiling 覆盖及净高判断 R304.3 可计入面积；该值仍是平面派生结果，不是法定建筑面积。", recommendation: "扩大房间，或补齐未覆盖区域的 Ceiling、坡顶及低净高资料。" },
      "G2-005": { issue: "居住房间有效水平尺寸不足", unable: "居住房间水平尺寸无法判断", rationale: "系统使用真实 Room 几何检查有效尺寸，凹口、孔洞和固定构件会参与；不会只看轴对齐包围盒。", recommendation: "调整房间边界或固定构件，形成至少7英尺的有效水平尺寸。" },
      "G2-006": { issue: "坐便器法规净空不足", unable: "坐便器法规净空无法判断", rationale: "本项使用真实中心、朝向和固定边界；住宅/睡眠单元只执行21英寸前方例外，不同时强制24英寸，也不复用G3坐便器使用区。", recommendation: "调整坐便器、侧墙、隔断或相邻固定洁具，或补充可靠中心与朝向。" },
      "G2-007": { issue: "紧急逃生救援开口净尺寸不符合规范", unable: "紧急逃生救援开口净尺寸待确认", rationale: "每个适用Room必须由同一个可操作外部开口同时满足净宽、净高和净面积；不会跨窗口拼接数值，也不会把名义洞口直接当净开口。", recommendation: "在图中核对候选窗/门的窗型、正常开启扇几何和真实净开口；明显过小的候选应调整。" },
      "G2-008": { issue: "紧急逃生救援开口窗台过高", unable: "紧急逃生救援开口窗台高度待确认", rationale: "只使用G2-007尺寸资格已确认的同一候选，从室内完成地面量至正常开启后的净开口底部；尺寸失败或尺寸资格待确认时均由G2-007主报，不重复报警。", recommendation: "先在G2-007确认同一候选正常开启后的净开口；尺寸资格确认后，再核对完成地面基准和净开口底部。" },
      "G2-009": { issue: "车库直接开口通向睡眠房间", unable: "车库与睡眠房间连接无法判断", rationale: "只有 Door Portal 直接形成 Garage–Sleeping Room 连接才判问题；经走廊、前厅或其他 Room 的连接不属于直接开口。", recommendation: "取消直接开口，改由前厅、走廊或其他适用空间分隔；用途不明时先核验 Room 语义。" },
      "G2-010": { issue: "住宅疏散路径必须穿过车库", unable: "住宅疏散路径无法判断", rationale: "检查是否至少存在一条避开车库的路径；最短路径经过车库并不等于必须经过车库。", recommendation: "提供住宅单元范围和必要疏散门，或增加一条不经过车库的连续疏散路径。" },
      "G2-011": { issue: "螺旋楼梯尺寸不符合规范", unable: "螺旋楼梯部分专项尺寸待核验", rationale: "系统分别检查扶手处净宽、法规行走线半径及踏面、踢面一致性和净高；模型中心线不会被猜作法规行走线。", recommendation: "在图中定位螺旋楼梯，补充或复核扶手后净宽、距窄端12英寸处的行走线、逐级踏面与楼梯净高。" },
      "G2-012": { issue: "普通楼梯净宽不符合规范", unable: "普通楼梯扶手条件或净宽待核验", rationale: "36英寸要求用于扶手高度以上；扶手高度及以下按零、一侧或两侧扶手分别采用36、31.5或27英寸，不使用楼梯包围盒宽度。", recommendation: "核对各梯段墙面间净宽、扶手数量和扶手间净宽，必要时调整梯段或扶手。" },
      "G2-013": { issue: "楼梯端部缺少必要平台", unable: "楼梯端部的平台边界待核验", rationale: "系统只接受紧邻最后一级踏步、连续落在真实 Room polygon 内的局部站立区域，不会把整个房间直接当作平台。", recommendation: "核对楼梯上下端是否有连续同标高站立面；顶部室内例外还需确认门不向楼梯开启。" },
      "G2-014": { issue: "楼梯平台尺寸不符合规范", unable: "特殊形状平台尺寸待核验", rationale: "直跑楼梯平台沿行进方向至少36英寸，宽度不得小于梯段；螺旋和非矩形平台需要额外的法规行走线连续可用深度与面积证据。", recommendation: "在图中核对平台有效边界、梯段宽度和连续可用深度；为特殊平台补充行走线几何。" },
      "G2-020": { issue: "淋浴空间尺寸不符合规范", unable: "淋浴空间完成内部尺寸待核验", rationale: "仅独立淋浴间检查完成内部面积、30英寸内接圆（或适用接水盘例外）及70英寸维持高度；浴缸和Showerhead本身不触发。", recommendation: "补充 finishedInteriorPolygon，或可靠接水盘的完成内边界与30×60英寸产品尺寸；固定围合可先按30英寸内接圆和900平方英寸内部空间复核。" },
      "G2-015": { issue: "门扇违法侵占楼梯平台", unable: "门扇与楼梯平台关系待复核", rationale: "仅检查同层、靠近楼梯端部且有可靠开启方向与扫掠几何的门；住宅条文例外取决于门向和高差。", recommendation: "核对门的铰链、开向、最大开启角度以及门槛与平台的高差。" },
      "G2-016": { issue: "居住房间净高不符合规范", unable: "居住房间净高覆盖证据不足", rationale: "系统以Room Region与Ceiling真实多边形的交集统计净高；坡顶区域另按5英尺计入和7英尺面积比例检查。", recommendation: "在图中核对低净高区域、坡顶范围及未被Ceiling覆盖的Room区域。" },
      "G2-017": { issue: "非居住或交通空间净高不符合规范", unable: "局部净高证据待核验", rationale: "厨房和走廊采用7英尺，卫生间、厕所及洗衣房采用80英寸；淋浴喷头处还需独立核对30×30英寸局部区域的80英寸净高。", recommendation: "核对对应Room的Ceiling覆盖；淋浴区域需补充或人工复核喷头处30×30英寸局部净高。" },
      "G2-019": { issue: "住宅缺少法规要求的基本卫生或厨房设施", unable: "住宅基本设施语义或清单完整性待核验", rationale: "坐便器、洗手盆、浴缸或淋浴、厨房水槽是四个独立要求；厨房水槽不会替代洗手盆，灶具也不会替代厨房水槽。", recommendation: "核对缺失设施，或修正用途含糊的洁具资产名称、类别和标签。" },
    };
    const current = copy[rule.ruleId]!;
    return { title: rule.status === "issue" ? current.issue : rule.status === "unable_to_determine" ? current.unable : rule.ruleName, description: rule.summary, rationale: current.rationale, recommendation: rule.status === "pass" || rule.status === "not_applicable" ? "无需处理。" : current.recommendation, supplemental: rule.status === "unable_to_determine" ? "黄色标注表示证据不足，不代表已经违反规范。" : undefined, problemCountLabel: rule.status === "issue" || rule.status === "unable_to_determine" ? String(count || rule.diagnostics.filter((diagnostic) => diagnostic.severity !== "info").length) : "0", targets };
  }
  if (rule.ruleId === "G3-005") return { title: rule.status === "issue" ? `发现 ${count} 个无法进入的房间` : rule.status === "unable_to_determine" ? "部分房间入口暂时无法确认" : "使用空间均有有效入口", description: rule.summary, rationale: "形成完整房间的使用空间需要至少一个有效房门、开放入口或楼梯连接。", recommendation: rule.status === "issue" ? "检查是否遗漏房门、门的宿主关系，或该区域是否属于无需进入的构造空间。" : rule.status === "unable_to_determine" ? "先修复未解析门洞或补充空间用途。" : "无需处理。", problemCountLabel: rule.status === "issue" ? String(count) : rule.status === "unable_to_determine" ? "未确定" : "0", targets };
  if (rule.ruleId === "G3-001") {
    const entranceCandidates = Number(measurement(rule, "entranceCandidateCount") ?? 0), unresolvedStairs = Number(measurement(rule, "unresolvedStairCount") ?? 0), connectedLevels = rule.measurements.filter((item) => item.name === "levelSameFloorConnected" && item.value === true).length;
    const crossLevelRooms = Number(measurement(rule, "crossLevelMainRoomCount") ?? 0);
    return { title: rule.status === "issue" ? `发现 ${count} 个外门不可达的主要空间` : rule.status === "unable_to_determine" ? `${crossLevelRooms} 个跨层主要空间尚未确认` : "主要空间均可从至少一个外门到达", description: rule.status === "unable_to_determine" ? `当前识别到 ${entranceCandidates} 个可靠外门，${connectedLevels} 个楼层各自的同层门网已经连通；但 ${unresolvedStairs} 座楼梯尚未可靠匹配上下层落地区域，因此不能确认另一层的 ${crossLevelRooms} 个主要空间。` : rule.summary, rationale: "只要存在任意一扇可靠外门能通达全部主要空间，即满足本项。当前只检查拓扑连通，不检查家具、净宽或门扇碰撞。", recommendation: rule.status === "issue" ? "逐个定位不可达空间，检查沿途房门、开放连接和楼梯设置。" : rule.status === "unable_to_determine" ? "先在图中查看楼梯，核对上下层ID及两端楼梯口所在空间。" : "无需处理。", supplemental: rule.status === "unable_to_determine" ? "黄色标注表示待核验，不代表这些空间已经不可达。" : undefined, problemCountLabel: rule.status === "issue" ? String(count) : rule.status === "unable_to_determine" ? String(crossLevelRooms) : "0", targets };
  }
  if (rule.ruleId === "G3-002") return { title: rule.status === "issue" ? `发现 ${count} 处被阻断的门口` : rule.status === "unable_to_determine" ? "部分门口暂时无法核验" : "门口均保留基本进入空间", description: rule.status === "issue" ? `${targets[0]?.label ?? "该门"}两侧的基本进入区域被${targets[0]?.relatedIds.map((id) => nodes[id]?.name || nodes[id]?.type).filter(Boolean).join("、") || "大型对象"}完全占用，可能无法正常进出。` : rule.summary, rationale: "门口需要保留可进入区域；轻微靠近但未完全堵住的家具不会被判为问题。", recommendation: rule.status === "issue" ? "在图中定位后移动或缩小阻挡对象，恢复门口两侧的基本进入空间。" : rule.status === "unable_to_determine" ? "补充门洞位置、宽度或关联对象的可靠平面占地。" : "无需处理。", problemCountLabel: rule.status === "issue" ? String(count) : rule.status === "unable_to_determine" ? "未确定" : "0", targets };
  if (rule.ruleId === "G3-007") return { title: rule.status === "issue" ? `发现 ${count} 扇无法打开到90°的门` : rule.status === "unable_to_determine" ? `${count} 扇门的90°开启情况待核验` : "门均可打开到90°", description: rule.status === "issue" ? `${targets[0]?.label ?? "该门"}在打开到90°之前会碰到${targets[0]?.relatedIds.map((id) => nodes[id]?.name || nodes[id]?.type).filter(Boolean).join("、") || "障碍物"}。` : rule.status === "unable_to_determine" ? "这些门缺少可靠位置、铰链或开向；可以逐扇在图中查看。" : rule.summary, rationale: "单开门按实际门扇计算；普通双开门按两片等宽门扇、各占总门洞一半，并采用JSON中的开向。", recommendation: rule.status === "issue" ? "检查门的开启方向、铰链侧，以及图中橙色对象的位置。" : rule.status === "unable_to_determine" ? "逐扇定位并补充门的位置、铰链或开向。" : "无需处理。", supplemental: rule.status === "unable_to_determine" ? "黄色标注表示数据待核验，不代表门已经打不开。" : undefined, problemCountLabel: rule.status === "issue" || rule.status === "unable_to_determine" ? String(count) : "0", targets };
  if (rule.ruleId === "G3-008") return { title: rule.status === "issue" ? `发现 ${count} 组严重门扇互锁` : rule.status === "unable_to_determine" ? `${count} 扇门的互锁风险待核验` : "未发现严重门扇互锁", description: rule.status === "issue" ? "两扇门打开到90°时会相互撞到对方关闭状态的门扇，可能形成互锁。" : rule.status === "unable_to_determine" ? "这些门缺少可靠操作几何，系统不能完整排除与附近门的互锁；可以逐扇在图中查看。" : rule.summary, rationale: "只有两扇门相互阻挡、导致双方都不能完成90°开启时才判为严重互锁。", recommendation: rule.status === "issue" ? "调整其中一扇门的开启方向、铰链侧或位置。" : rule.status === "unable_to_determine" ? "逐扇定位并补充门扇位置、铰链或开向。" : "无需处理。", supplemental: rule.status === "unable_to_determine" ? "黄色标注表示待核验，不代表已经发现严重互锁。" : undefined, problemCountLabel: rule.status === "issue" || rule.status === "unable_to_determine" ? String(count) : "0", targets };
  if (rule.ruleId === "G3-003") return { title: rule.status === "issue" ? `发现 ${count} 个主要空间通行中断` : rule.status === "unable_to_determine" ? `${count} 个主要空间路径待核验` : "主要空间内部基本路径连续", description: rule.status === "issue" ? "从门口进入后，无法保留约400毫米宽、路径中心距障碍物至少200毫米的连续基本通行空间。" : rule.summary, rationale: "本项检查房间内部的基础连通性，不评价舒适度、最优路线或规范通道宽度。", recommendation: rule.status === "issue" ? "定位红色中断区域，调整橙色阻挡对象或家具布局。" : rule.status === "unable_to_determine" ? "逐个定位黄色空间，检查Room几何、对象类别或占地轮廓。" : "无需处理。", problemCountLabel: rule.status === "issue" || rule.status === "unable_to_determine" ? String(count) : "0", targets };
  if (rule.ruleId === "G3-004") return { title: rule.status === "issue" ? `发现 ${count} 个房间依赖移动大型家具才能通行` : rule.status === "unable_to_determine" ? `${count} 个房间的家具阻断归因待核验` : "通行不依赖移动大型家具", description: rule.status === "issue" ? `${targets[0]?.relatedIds.map((id) => nodes[id]?.name || "大型家具").filter(Boolean).join("、") || "大型家具"}截断了门口到房间内部或其他门口之间的基本路径。` : rule.summary, rationale: "只有固定障碍下可通、加入大型家具后不通，才归入本规则。", recommendation: rule.status === "issue" ? "移动床、沙发、餐桌、书桌或独立柜体，恢复距障碍物至少300毫米的连续路径。" : rule.status === "unable_to_determine" ? "逐个定位并确认相关对象类别、尺寸和可移动属性。" : "无需处理。", problemCountLabel: rule.status === "issue" || rule.status === "unable_to_determine" ? String(count) : "0", targets };
  if (rule.ruleId === "G3-006") return { title: rule.status === "issue" ? `发现 ${count} 个房间被固定实体截断通行` : rule.status === "unable_to_determine" ? `${count} 个房间的固定障碍情况待核验` : "未发现路径穿越固定实体", description: rule.status === "issue" ? `${targets[0]?.relatedIds.map((id) => nodes[id]?.name || "固定对象").filter(Boolean).join("、") || "固定对象"}截断了日常基本路径。` : rule.status === "unable_to_determine" ? `${targets[0]?.label ?? "该空间"}按300毫米避让距离计算后没有可靠自由空间；图中橙色的${targets[0]?.relatedIds.map((id) => nodes[id]?.name || "固定设备").filter(Boolean).join("、") || "固定设备"}占用了主要空间，但系统还不能确认该设备空间是否适用日常通行检查。` : rule.summary, rationale: "固定柜体、洁具、设备和建筑构件造成的中断与可移动家具分开归因。", recommendation: rule.status === "issue" ? "调整固定对象、门口或空间布局。" : rule.status === "unable_to_determine" ? "点击“在图中查看”，核对该空间是否属于日常进入区域，以及固定设备是否真实占用通道。" : "无需处理。", supplemental: rule.status === "unable_to_determine" ? "黄色标注表示待核验，不代表已经发现固定对象阻断。" : undefined, problemCountLabel: rule.status === "issue" || rule.status === "unable_to_determine" ? String(count) : "0", targets };
  if (furnitureSpecialistRule(rule.ruleId)) {
    const copy: Record<string, { issue: string; unable: string; rationale: string; recommendation: string }> = {
      "G3-014": { issue: "床没有完整放在卧室内", unable: "部分床的放置情况待核验", rationale: "床的实体占地需要完整位于可靠房间内；贴墙可以，穿入墙体或越出房间不可以。", recommendation: "在图中检查床的位置、旋转和尺寸，并修正穿墙或越界。" },
      "G3-015": { issue: "这张床没有可用的上下床位置", unable: "部分床无法核验上下床位置", rationale: "床至少需要一侧保留600毫米基本上下床区域；只有一侧可用不会在本轮判失败。", recommendation: "移动床或相邻家具，至少恢复一侧基本上下床位置。" },
      "G3-016": { issue: "双人床没有基本上下床位置", unable: "部分床的单双人类型待确认", rationale: "本轮只要求双人床至少保留一个基本上下床位置；两侧便利性留给S1。", recommendation: "补充可靠床型，或移动家具恢复至少一侧上下床空间。" },
      "G3-017": { issue: "卧室入口被家具挡住", unable: "部分卧室入口待核验", rationale: "从卧室门口进入后应能到达房间内部；基础通行规则已报告的问题不会在这里重复报警。", recommendation: "检查卧室门口、Portal落点和附近家具。" },
      "G3-018": { issue: "衣柜无法正常打开和取物", unable: "衣柜门开启情况待核验", rationale: "当前项目已经识别到衣柜，但JSON没有门片数量、门宽、铰链侧和开启方向，因此不能判断柜门是否能正常打开。柜前能否接近和取物仍由G3-042检查。", recommendation: "点击“在图中查看”逐个定位衣柜，并人工核对柜门类型与开启方向；黄色标注不代表已经发现设计错误。" },
      "G3-019": { issue: "床阻断了卧室必要通行", unable: "部分卧室入口或路径待核验", rationale: "本项只检查卧室房门、套内卫生间入口和已建立主要路径。普通窗户操作不再由平面G3评价；紧急逃生窗属于G2。", recommendation: "检查卧室Door Portal和主要路径；已有入口或路径阻断请查看基础通行结果。" },
      "G3-020": { issue: "客厅主要坐具无法正常使用", unable: "部分坐具几何待确认", rationale: "家具中心红线就是解析后局部+Z朝向，系统沿该方向生成基本进入区；沙发靠墙不是问题。", recommendation: "检查家具尺寸、位置、旋转和正前方阻挡对象。" },
      "G3-021": { issue: "客厅家具阻断了主要通行", unable: "客厅主要通行待核验", rationale: "本项复用400毫米房内路径；G3-004已报告的同一阻断不会重复生成问题。", recommendation: "检查客厅Portal和橙色家具。" },
      "G3-022": { issue: "餐桌座位不足", unable: "餐桌计划人数尚未提供", rationale: "系统可以数出附近餐椅，但没有计划用餐人数时无法判断座位是否满足计划。", recommendation: "补充计划用餐人数或餐桌计划座位数。" },
      "G3-023": { issue: "餐椅后方空间不足，无法基本入座", unable: "部分餐椅缺少可靠位置或尺寸", rationale: "家具中心红线表示餐椅前方，红线反方向就是椅后方；系统沿该方向检查600毫米基本拉出区域，不需要用餐桌推断方向。", recommendation: "移动餐椅或椅后方家具，恢复基本拉出区域。" },
      "G3-024": { issue: "客餐厅复合使用区发生冲突", unable: "客餐厅复合功能暂时无法完整核验", rationale: "客厅坐具、餐桌餐椅和主要通道需要能够同时基本使用；坐具和餐椅方向都直接复用家具中心红线。", recommendation: "检查坐具或餐椅使用区、家具几何和主要路径。" },
    };
    const current = copy[rule.ruleId]!;
    return { title: rule.status === "issue" ? current.issue : rule.status === "unable_to_determine" ? current.unable : rule.ruleName, description: rule.summary, rationale: current.rationale, recommendation: rule.status === "pass" || rule.status === "not_applicable" ? "无需处理。" : current.recommendation, supplemental: rule.status === "unable_to_determine" ? "黄色标注表示缺少判断依据，不代表已经发现设计问题。" : undefined, problemCountLabel: rule.status === "issue" || rule.status === "unable_to_determine" ? String(count) : "0", targets };
  }
  if (fixtureSpecialistRule(rule.ruleId)) {
    const copy: Record<string, { issue: string; unable: string; rationale: string; recommendation: string }> = {
      "G3-025": { issue: "厨房核心设备配置不完整", unable: "厨房核心设备配置暂时无法完整核验", rationale: "每个厨房都需要可识别的水槽和灶具；住宅全部厨房合计至少需要一台冰箱，可由多个厨房共用。", recommendation: "核对水槽、灶具或冰箱的functionTags和所在Room。冰箱共享便利性不在本规则评价范围内。" },
      "G3-026": { issue: "厨房核心设备前没有可用站立位置", unable: "部分厨房设备的接近空间待核验", rationale: "系统沿设备自身红线方向检查600毫米基本站立区，并确认该区域可从厨房入口到达。", recommendation: "移动红色设备前方的橙色对象，或检查设备位置和朝向。" },
      "G3-027": { issue: "水槽或灶具附近缺少基本操作台面", unable: "厨房台面语义暂时不完整", rationale: "只有明确标记为Counter、Cabinet或Island的实体才作为台面依据，不根据空白区域猜测。", recommendation: "核对台面对象类别，或在水槽、灶具附近补充可识别台面。" },
      "G3-028": { issue: "橱柜或岛台之间无法基本通行", unable: "厨房对向操作区暂时无法核验", rationale: "本轮只要求保留400毫米基本连续通行空间，更舒适的厨房间距留给S1。", recommendation: "调整橱柜、岛台或半岛位置，恢复基本通行。" },
      "G3-029": { issue: "厨房设备门无法基本使用", unable: "厨房设备门的开启情况无法判断", rationale: "JSON没有设备门扇宽度、铰链和开向时，系统不会用冰箱或烤箱的整体矩形冒充门扇。", recommendation: "补充设备门扇尺寸、铰链侧、开向和开启角度。" },
      "G3-030": { issue: "厨房入口被设备或岛台挡住", unable: "厨房入口暂时无法完整核验", rationale: "厨房入口需要连接到房内基本自由空间；基础通行规则已报告的同一问题不会重复生成卡片。", recommendation: "检查厨房Door Portal、入口落点及附近高柜、冰箱或岛台。" },
      "G3-031": { issue: "厨房核心操作位成为唯一穿行通道", unable: "厨房唯一通道关系暂时无法核验", rationale: "只有其他主要空间的唯一拓扑路径明确穿过水槽或灶具前操作区时才判问题；开放式客餐厨不会自动失败。", recommendation: "调整空间连接或核心设备位置，避免日常穿行经过操作位。" },
      "G3-032": { issue: "厨房高柜或设备形成完全死锁", unable: "设备与高柜的开启死角无法排除", rationale: "实体重叠可以直接确认；没有门扇开向时，只能标记待核验，不能猜测设备如何开启。", recommendation: "检查红色设备及橙色柜体，或补充设备门和高柜门的开启几何。" },
      "G3-033": { issue: "卫生间无法正常进入或退出", unable: "卫生间入口暂时无法核验", rationale: "进入后需要存在基本站立、关门和退出空间；同一门口根因只保留一条主要问题。", recommendation: "调整门口洁具、柜体或门开向，恢复进入和退出空间。" },
      "G3-034": { issue: "坐便器前方无法正常坐下和起身", unable: "部分坐便器使用区待核验", rationale: "这里只判断坐便器前方是否有600毫米基本使用区并能从入口到达，不执行G2规范净空。", recommendation: "移动前方洗手台、浴缸、隔断或其他阻挡对象。" },
      "G3-035": { issue: "洗手盆前没有可用站立位置", unable: "部分洗手盆使用区待核验", rationale: "洗手盆前需要基本站立位置并可从卫生间入口到达。", recommendation: "调整洗手盆或前方洁具、门扇和隔断。" },
      "G3-036": { issue: "淋浴或浴缸入口被挡住", unable: "部分淋浴或浴缸入口待核验", rationale: "缺少淋浴门数据时只检查几何入口，不猜测门型或开向。", recommendation: "移动入口前的坐便器、洗手台或其他阻挡对象。" },
      "G3-037": { issue: "卫生间门与洁具形成被困风险", unable: "部分卫生间平开门的被困风险待核验", rationale: "只有门扇被洁具明确卡住且必要使用区也不可用时才判问题；推拉门不套用平开门扫掠。", recommendation: "调整卫生间门开向、铰链侧或洁具位置。" },
      "G3-038": { issue: "卫生设备相互占满必要使用位置", unable: "卫生设备功能冲突待核验", rationale: "使用区可以部分重叠并顺序使用；只有相互完全占用、导致至少一个设备无法使用才判问题。", recommendation: "调整冲突洁具的位置，恢复至少一个必要使用区。" },
    };
    const current = copy[rule.ruleId]!;
    return { title: rule.status === "issue" ? current.issue : rule.status === "unable_to_determine" ? current.unable : rule.ruleName, description: rule.summary, rationale: current.rationale, recommendation: rule.status === "pass" || rule.status === "not_applicable" ? "无需处理。" : current.recommendation, supplemental: rule.status === "unable_to_determine" ? "黄色标注表示数据不足，不代表已经发现设计错误。" : undefined, problemCountLabel: rule.status === "issue" || rule.status === "unable_to_determine" ? String(count || Number(measurement(rule, "missingKitchenCoreCount") ?? 0)) : "0", targets };
  }
  if (finalOperationRule(rule.ruleId)) {
    const copy: Record<string, { issue: string; unable: string; rationale: string; recommendation: string }> = {
      "G3-009": { issue: "进入房间后没有可停留的位置", unable: "部分门后的停留空间待核验", rationale: "穿过门后需要有一个可以站住并继续进入房间的位置；同一通行阻断不会重复报警。", recommendation: "查看门内侧红色落点，移动附近固定对象或大型家具。" },
      "G3-010": { issue: "固定柜前被完全挡住", unable: "固定柜门开启情况待核验", rationale: "当前可以检查柜前600毫米操作位置；没有门片数量、宽度、铰链和开向时，不能判断柜门实际如何打开。", recommendation: "逐个查看黄色柜体；如需自动判断开启，资产需提供独立柜门几何。" },
      "G3-011": { issue: "主要抽屉无法拉出", unable: "部分抽屉的保守拉出包络待核验", rationale: "系统沿家具红线方向，把柜体深度作为抽屉最大拉出深度；完整包络畅通即可确认通过。", recommendation: "查看黄色包络并人工核对实际抽屉深度；空间不足时不会直接猜测失败。" },
      "G3-012": { issue: "主要设备门无法打开", unable: "部分设备门的保守开启包络待核验", rationale: "系统沿设备正面方向，以设备宽度作为门体最大伸出范围；完整包络畅通即可确认通过。", recommendation: "查看黄色包络；若发生局部冲突，人工核对真实门径和左右铰链。" },
      "G3-039": { issue: "洗衣设备前没有装取衣物空间", unable: "洗衣设备的Room归属待核验", rationale: "洗衣机可以位于洗衣房、MUD或其他合理空间；本规则只要求所在Room可靠且设备前操作位置可达。", recommendation: "核对洗衣机位置和Room Region，不再强制要求LAUNDRY Zone。" },
      "G3-040": { issue: "洗衣设备阻断必要通道", unable: "洗衣设备的通道关系待核验", rationale: "只有设备切断入口或必要路径才算问题；基础通行规则已报告的同一根因不会再生成卡片。", recommendation: "核对设备Room归属和必要路径。" },
      "G3-041": { issue: "储藏空间无法正常进入", unable: "储藏空间入口待核验", rationale: "储藏室、食品储藏室和步入式衣帽间需要有入口，并能从门口进入内部自由空间。", recommendation: "检查入口Door Portal及门后的柜体布置。" },
      "G3-042": { issue: "储物柜前被完全挡住", unable: "储物柜取物条件待核验", rationale: "系统可以检查柜前600毫米取物位置；缺少柜门几何时只保留接近检查，不猜测门片。", recommendation: "逐个查看黄色储物柜，移动柜前大型家具，柜门开启另行人工核对。" },
      "G3-043": { issue: "家务设备形成完全功能冲突", unable: "家务设备关系待核验", rationale: "操作区允许部分重叠并顺序使用；只有一个设备完全占掉另一个设备唯一位置才判问题。", recommendation: "调整相互锁死的设备或家政柜位置。" },
      "G3-044": { issue: "设备或家具的开启操作区越出建筑范围", unable: "开启操作区是否越出建筑范围待核验", rationale: "系统直接使用JSON中声明的开启方向、开启深度和最小使用空间，并与Floor/Slab形成的建筑范围比对；不依赖Zone或Room名称。", recommendation: "调整对象位置、朝向、开启方向或JSON开启参数，使完整操作区回到建筑范围内。" },
    };
    const current = copy[rule.ruleId]!;
    return { title: rule.status === "issue" ? current.issue : rule.status === "unable_to_determine" ? current.unable : rule.ruleName, description: rule.summary, rationale: current.rationale, recommendation: rule.status === "pass" || rule.status === "not_applicable" ? "无需处理。" : current.recommendation, supplemental: rule.status === "unable_to_determine" ? "黄色标注是可逐项定位的待核验对象，不代表已经发现设计错误。" : undefined, problemCountLabel: rule.status === "issue" || rule.status === "unable_to_determine" ? String(count || rule.diagnostics.filter((diagnostic) => diagnostic.severity !== "info").length) : "0", targets };
  }
  return {
    title: rule.ruleName,
    description: rule.summary,
    rationale: rule.status === "pass" ? "当前数据满足本项基础检查。" : "请查看技术详情了解判断依据。",
    recommendation: rule.status === "pass" || rule.status === "not_applicable" ? "无需处理。" : "根据技术详情补充或修正数据。",
    problemCountLabel: rule.status === "issue" ? String(rule.normalizedObjectIds.length) : "0", targets,
  };
}

export function evaluationIssueTargets(rules: RuleResult[], nodes: Record<string, NodeData>, roomAnalysis?: RoomRegionAnalysis | null): EvaluationIssueTarget[] {
  return rules.flatMap((rule) => designerRulePresentation(rule, nodes, roomAnalysis).targets.map((target, targetIndex) => ({ ...target, ruleId: rule.ruleId, targetIndex })));
}
