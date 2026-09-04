import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import {
  buildFurnitureUseAnalysis,
  type FurnitureSemanticItem,
  type FurnitureUseAnalysis,
  type FurnitureUseZoneAssessment,
} from "./furniture-use";
import { G1_GEOMETRY_TOLERANCES as T } from "./tolerances";
import type { G3Rule, RuleDiagnostic, RuleResult, RuleStatus } from "./types";
import { ruleG3002 } from "./g3-operation-rules";
import { buildOperationUseAnalysis } from "./operation-use";

const cache = new WeakMap<object, FurnitureUseAnalysis>();
export const furnitureUseAnalysis = (handoff: EvaluationHandoff) => {
  const existing = cache.get(handoff);
  if (existing) return existing;
  const value = buildFurnitureUseAnalysis(handoff);
  cache.set(handoff, value);
  return value;
};
const result = (
  ruleId: string,
  ruleName: string,
  status: RuleStatus,
  summary: string,
  partial: Partial<RuleResult> = {},
): RuleResult => ({
  ruleId,
  ruleName,
  status,
  severity:
    status === "issue"
      ? "error"
      : status === "unable_to_determine"
        ? "warning"
        : "info",
  summary,
  details: [],
  normalizedObjectIds: [],
  pascalSourceIds: [],
  measurements: [],
  thresholds: [
    {
      name: "basicPassageWidth",
      value: T.basicPassageWidthMeters,
      unit: "meter",
    },
    { name: "furnitureUseZoneClearRatio", value: T.furnitureUseZoneClearRatio },
    { name: "bedAccessDepth", value: T.bedAccessDepthMeters, unit: "meter" },
    {
      name: "seatingAccessDepth",
      value: T.seatingAccessDepthMeters,
      unit: "meter",
    },
    {
      name: "diningChairPulloutDepth",
      value: T.diningChairPulloutDepthMeters,
      unit: "meter",
    },
  ],
  missingData: [],
  confidence: {
    level: status === "unable_to_determine" ? "low" : "medium",
    score: status === "unable_to_determine" ? 0.4 : 0.7,
    reasons: ["V0.1只判断基本可用性，不评价舒适度或规范符合性"],
  },
  diagnostics: [],
  ...partial,
});
const sourceIds = (items: FurnitureSemanticItem[], ids: string[]) => [
  ...new Set(
    ids.map(
      (id) => items.find((item) => item.item.id === id)?.item.rawPascalId ?? id,
    ),
  ),
];
const roomNames = (analysis: FurnitureUseAnalysis, roomId: string) =>
  analysis.navigation.rooms
    .find((room) => room.roomRegionId === roomId)
    ?.zoneNames.join(" / ") || roomId;
const bedroom = /BED(?:ROOM)?|MASTER|卧室/i,
  living = /LIVING|FAMILY|LOUNGE|客厅|起居/i,
  dining = /DIN+ING|餐厅/i;
const roomsMatching = (analysis: FurnitureUseAnalysis, pattern: RegExp) =>
  analysis.navigation.rooms.filter((room) =>
    room.zoneNames.some((name) => pattern.test(name)),
  );
const assessmentsFor = (
  analysis: FurnitureUseAnalysis,
  ownerId: string,
  kind?: string,
) =>
  analysis.assessments.filter(
    (assessment) =>
      assessment.zone.ownerObjectId === ownerId &&
      (!kind || assessment.zone.kind === kind),
  );
const diagnostic = (
  severity: RuleDiagnostic["severity"],
  code: string,
  message: string,
  ids: string[],
  origin: RuleDiagnostic["origin"],
  recommendation: string,
  extra: Partial<RuleDiagnostic> = {},
): RuleDiagnostic => ({
  severity,
  code,
  message,
  normalizedObjectIds: ids,
  origin,
  recommendation,
  ...extra,
});
const commonMeasurements = (
  analysis: FurnitureUseAnalysis,
  semantic: FurnitureSemanticItem["semantic"],
): RuleResult["measurements"] => [
  {
    name: `${semantic}Count`,
    value: analysis.items.filter((item) => item.semantic === semantic).length,
  },
  {
    name: `${semantic}LowConfidenceCount`,
    value: analysis.items.filter(
      (item) => item.semantic === semantic && item.semanticConfidence === "low",
    ).length,
  },
];
export const ruleG3014: G3Rule = (handoff) => {
  const analysis = furnitureUseAnalysis(handoff),
    beds = analysis.items.filter((item) => item.semantic === "bed"),
    reliable = beds.filter(
      (item) => item.semanticConfidence !== "low" && item.footprint,
    ),
    issue = reliable.filter(
      (item) => !item.roomRegionId || item.roomCoverageRatio < 0.98,
    ),
    unresolved = beds.filter(
      (item) => item.semanticConfidence === "low" || !item.footprint,
    ),
    status: RuleStatus = issue.length
      ? "issue"
      : unresolved.length
        ? "unable_to_determine"
        : reliable.length
          ? "pass"
          : "not_applicable";
  const diagnostics = [
    ...issue.map((bed) =>
      diagnostic(
        "error",
        "bed_not_fully_inside_room",
        `${bed.item.name ?? "床"}只有 ${(bed.roomCoverageRatio * 100).toFixed(0)}% 的平面占地位于所属房间内`,
        [bed.item.id, ...(bed.roomRegionId ? [bed.roomRegionId] : [])],
        "source_data",
        "检查床的位置、旋转、尺寸以及卧室边界。",
        {
          field: "bed footprint / Room Region",
          actualValue: bed.roomCoverageRatio,
          expectedValue: ">= 0.98",
        },
      ),
    ),
    ...unresolved.map((bed) =>
      diagnostic(
        "warning",
        "bed_semantic_or_footprint_unreliable",
        `${bed.item.name ?? "床"}的类别或占地不可靠，无法确认是否完整放置`,
        [bed.item.id],
        "insufficient_information",
        "修正家具category或补充可靠尺寸、位置和旋转。",
      ),
    ),
  ];
  return result(
    "G3-014",
    "床能够完整放置",
    status,
    issue.length
      ? `发现 ${issue.length} 张床没有完整位于可靠卧室区域内`
      : unresolved.length
        ? `${unresolved.length} 张疑似床因类别或占地不足无法判断`
        : `${reliable.length} 张床均完整位于所属房间内`,
    {
      normalizedObjectIds: issue.map((item) => item.item.id),
      pascalSourceIds: sourceIds(
        beds,
        issue.map((item) => item.item.id),
      ),
      details: diagnostics.map((item) => item.message),
      measurements: [
        ...commonMeasurements(analysis, "bed"),
        ...reliable.map((bed) => ({
          name: "bedRoomCoverageRatio",
          value: bed.roomCoverageRatio,
          normalizedObjectId: bed.item.id,
        })),
      ],
      missingData: unresolved.map(
        (item) => `${item.item.id}: 可靠床类别或footprint`,
      ),
      diagnostics,
    },
  );
};

export const ruleG3015: G3Rule = (handoff) => {
  const analysis = furnitureUseAnalysis(handoff),
    beds = analysis.items.filter((item) => item.semantic === "bed"),
    reliable = beds.filter(
      (item) =>
        item.semanticConfidence !== "low" &&
        item.footprint &&
        item.roomRegionId,
    ),
    evaluated = reliable.map((bed) => ({
      bed,
      sides: assessmentsFor(analysis, bed.item.id).filter((item) =>
        item.zone.kind.startsWith("bed-"),
      ),
    })),
    issue = evaluated.filter(
      (item) =>
        item.sides.length === 2 && !item.sides.some((side) => side.usable),
    ),
    unresolved = beds.filter(
      (item) =>
        item.semanticConfidence === "low" ||
        !item.footprint ||
        !item.roomRegionId,
    ),
    status: RuleStatus = issue.length
      ? "issue"
      : unresolved.length
        ? "unable_to_determine"
        : evaluated.length
          ? "pass"
          : "not_applicable";
  const diagnostics = [
    ...issue.map(({ bed, sides }) =>
      diagnostic(
        "error",
        "bed_has_no_usable_access_side",
        `${bed.item.name ?? "床"}两侧的600毫米基本上下床区域都不可用`,
        [bed.item.id, ...new Set(sides.flatMap((side) => side.blockerIds))],
        "source_data",
        "移动床或相邻家具，至少保留一侧基本上下床位置。",
        {
          actualValue: JSON.stringify(sides.map((side) => side.clearRatio)),
          expectedValue: `至少一侧净空比例 >= ${T.furnitureUseZoneClearRatio}`,
        },
      ),
    ),
    ...unresolved.map((bed) =>
      diagnostic(
        "warning",
        "bed_access_unresolved",
        `${bed.item.name ?? "疑似床"}无法生成可靠上下床区域`,
        [bed.item.id],
        "insufficient_information",
        "核对床的类别、尺寸、位置及所属卧室。",
      ),
    ),
  ];
  return result(
    "G3-015",
    "床至少具有一个有效上下床位置",
    status,
    issue.length
      ? `发现 ${issue.length} 张床没有可用的基本上下床位置`
      : unresolved.length
        ? `${unresolved.length} 张疑似床无法判断上下床位置`
        : `${evaluated.length} 张床至少有一侧可用于基本上下床`,
    {
      normalizedObjectIds: issue.map((item) => item.bed.item.id),
      pascalSourceIds: sourceIds(
        beds,
        issue.map((item) => item.bed.item.id),
      ),
      details: diagnostics.map((item) => item.message),
      measurements: evaluated.flatMap(({ bed, sides }) =>
        sides.map((side) => ({
          name: "bedAccessClearRatio",
          value: side.clearRatio,
          normalizedObjectId: bed.item.id,
        })),
      ),
      missingData: unresolved.map(
        (item) => `${item.item.id}: 可靠床语义或Room匹配`,
      ),
      diagnostics,
    },
  );
};

export const ruleG3016: G3Rule = (handoff) => {
  const analysis = furnitureUseAnalysis(handoff),
    beds = analysis.items.filter((item) => item.semantic === "bed"),
    doubles = beds.filter(
      (item) => item.bedType === "double" && item.semanticConfidence !== "low",
    ),
    unknown = beds.filter(
      (item) => item.bedType === "unknown" || item.semanticConfidence === "low",
    ),
    issue = doubles.filter(
      (bed) =>
        !assessmentsFor(analysis, bed.item.id).some((side) => side.usable),
    ),
    oneSide = doubles.filter(
      (bed) =>
        assessmentsFor(analysis, bed.item.id).filter((side) => side.usable)
          .length === 1,
    ),
    status: RuleStatus = issue.length
      ? "issue"
      : unknown.length
        ? "unable_to_determine"
        : doubles.length
          ? "pass"
          : "not_applicable";
  const diagnostics = [
    ...issue.map((bed) =>
      diagnostic(
        "error",
        "double_bed_has_no_access",
        `${bed.item.name ?? "双人床"}没有任何可用上下床位置，无法满足基本双人使用`,
        [bed.item.id],
        "source_data",
        "至少恢复床的一侧基本上下床区域。",
      ),
    ),
    ...oneSide.map((bed) =>
      diagnostic(
        "info",
        "double_bed_one_side_only",
        `${bed.item.name ?? "双人床"}目前只有一侧可上下床；本轮仍按基本可用处理，舒适性留给S1`,
        [bed.item.id],
        "rule",
        "如需提升便利性，可在床两侧均留出空间。",
      ),
    ),
    ...unknown.map((bed) =>
      diagnostic(
        "warning",
        "bed_type_unreliable",
        `${bed.item.name ?? "床"}缺少可靠单双人类型`,
        [bed.item.id],
        "insufficient_information",
        "补充可靠bed functionTags；不要依赖名称或模型外观。",
      ),
    ),
  ];
  return result(
    "G3-016",
    "双人床具备基本双人使用条件",
    status,
    issue.length
      ? `发现 ${issue.length} 张双人床完全没有上下床位置`
      : unknown.length
        ? `${unknown.length} 张床的单双人类型无法可靠确认`
        : `${doubles.length} 张双人床具备至少一个基本上下床位置`,
    {
      normalizedObjectIds: issue.map((item) => item.item.id),
      pascalSourceIds: sourceIds(
        beds,
        issue.map((item) => item.item.id),
      ),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "reliableDoubleBedCount", value: doubles.length },
        { name: "oneSideDoubleBedCount", value: oneSide.length },
      ],
      missingData: unknown.map((item) => `${item.item.id}: 单双人床类型`),
      diagnostics,
    },
  );
};

export const ruleG3017: G3Rule = (handoff) => {
  const analysis = furnitureUseAnalysis(handoff),
    rooms = roomsMatching(analysis, bedroom).filter(
      (room) => room.portalNodes.length,
    ),
    blocked = rooms.filter((room) => !room.furnishedConnected),
    unresolved = rooms.filter(
      (room) => !room.usableForEvaluation || room.uncertainObjectIds.length,
    ),
    duplicated = blocked.filter(
      (room) =>
        room.fixedBlockerIds.length || room.largeFurnitureBlockerIds.length,
    ),
    status: RuleStatus = duplicated.length
      ? "not_applicable"
      : unresolved.length
        ? "unable_to_determine"
        : rooms.length
          ? "pass"
          : "not_applicable";
  const diagnostics = [
    ...duplicated.map((room) =>
      diagnostic(
        "info",
        "bedroom_entry_blockage_reported_by_foundation",
        `${roomNames(analysis, room.roomRegionId)}的入口通行问题已由G3-003/G3-004/G3-006报告，本规则不重复生成问题卡`,
        [
          room.roomRegionId,
          ...room.fixedBlockerIds,
          ...room.largeFurnitureBlockerIds,
        ],
        "rule",
        "处理基础通行规则中已经定位的阻挡对象。",
      ),
    ),
    ...unresolved.map((room) =>
      diagnostic(
        "warning",
        "bedroom_entry_unresolved",
        `${roomNames(analysis, room.roomRegionId)}的入口因Room或对象分类不足无法判断`,
        [room.roomRegionId, ...room.uncertainObjectIds],
        "insufficient_information",
        "核对入口Portal、家具类别和占地。",
      ),
    ),
  ];
  return result(
    "G3-017",
    "家具布置后卧室入口仍可使用",
    status,
    duplicated.length
      ? "卧室入口阻断已由基础通行规则统一报告，本规则不重复报警"
      : unresolved.length
        ? `${unresolved.length} 个卧室入口无法判断`
        : `${rooms.length} 个卧室入口可连接到房内自由空间`,
    {
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "bedroomRoomCount", value: rooms.length },
        {
          name: "bedroomEntryConnectedCount",
          value: rooms.filter((room) => room.furnishedConnected).length,
        },
      ],
      missingData: unresolved.map(
        (room) => `${room.roomRegionId}: 可靠入口或家具分类`,
      ),
      diagnostics,
    },
  );
};

export const ruleG3018: G3Rule = (handoff) => {
  const analysis = furnitureUseAnalysis(handoff),
    operation = buildOperationUseAnalysis(handoff),
    wardrobes = analysis.items.filter(
      (item) =>
        item.semantic === "wardrobe" &&
        operation.items.find((candidate) => candidate.item.id === item.item.id)
          ?.explicitlyOpenable,
    ),
    evaluated = wardrobes.map((item) => ({
      item,
      operationItem: operation.items.find(
        (candidate) => candidate.item.id === item.item.id,
      ),
      assessment: operation.assessments.find(
        (candidate) =>
          candidate.zone.ownerObjectId === item.item.id &&
          candidate.zone.kind === "storage-front",
      ),
    })),
    blocked = evaluated.filter(
      (entry) =>
        entry.operationItem?.operationGeometryReliable &&
        entry.assessment &&
        !entry.assessment.usable,
    ),
    unresolved = evaluated.filter(
      (entry) =>
        !entry.operationItem?.operationGeometryReliable || !entry.assessment,
    );
  const ids = [...blocked, ...unresolved].map((entry) => entry.item.item.id);
  if (!wardrobes.length)
    return result(
      "G3-018",
      "衣柜能够正常开启和取物",
      "not_applicable",
      "当前项目没有识别到衣柜，本规则不适用",
      { measurements: commonMeasurements(analysis, "wardrobe") },
    );
  const diagnostics = [
    ...blocked.map((entry) =>
      diagnostic(
        "error",
        "wardrobe_door_operation_blocked",
        entry.assessment?.openingUsable === false
          ? `${entry.item.item.name ?? "衣柜"}的柜门开启范围被实体占用，无法达到JSON声明的开启状态`
          : `${entry.item.item.name ?? "衣柜"}开启后的人员操作区只有 ${Math.round(((entry.assessment?.openedUseClearRatio ?? entry.assessment?.clearRatio ?? 0) * 100))}% 可用`,
        [
          entry.item.item.id,
          ...(entry.assessment?.openingUsable === false
            ? entry.assessment.openingBlockerIds
            : entry.assessment?.openedUseBlockerIds ?? entry.assessment?.blockerIds ?? []),
        ],
        "source_data",
        "调整衣柜朝向或移开柜门前阻挡对象。",
      ),
    ),
    ...unresolved.map((entry) =>
      diagnostic(
        "warning",
        "wardrobe_door_geometry_unavailable",
        `${entry.item.item.name ?? "衣柜"}缺少门片数量、门宽、铰链侧和开启方向，无法判断柜门能否正常开启`,
        [entry.item.item.id],
        "insufficient_information",
        "补充明确柜门几何后重新评价。",
      ),
    ),
  ];
  const status: RuleStatus = blocked.length
    ? "issue"
    : unresolved.length
      ? "unable_to_determine"
      : "pass";
  return result(
    "G3-018",
    "衣柜能够正常开启和取物",
    status,
    blocked.length
      ? `${blocked.length} 个衣柜柜门操作区被阻挡`
      : unresolved.length
        ? `${unresolved.length} 个衣柜缺少可靠门片数据`
        : `${wardrobes.length} 个衣柜具有明确柜门数据和可用操作区`,
    {
      normalizedObjectIds: ids,
      pascalSourceIds: sourceIds(wardrobes, ids),
      measurements: [
        ...commonMeasurements(analysis, "wardrobe"),
        { name: "wardrobeDoorBlockedCount", value: blocked.length },
        ...operation.zones.filter((zone) => zone.kind === "storage-front" && wardrobes.some((wardrobe) => wardrobe.item.id === zone.ownerObjectId)).flatMap((zone) => [
          { name: "maximumOpeningDepth", value: zone.maximumOpeningDepthMeters ?? null, unit: "meter", normalizedObjectId: zone.ownerObjectId },
          { name: "minimumOpeningUseClearance", value: zone.minimumUseClearanceMeters ?? null, unit: "meter", normalizedObjectId: zone.ownerObjectId },
        ]),
      ],
      thresholds: [
        {
          name: "postOpeningUseClearRatio",
          value: T.furnitureUseZoneClearRatio,
        },
      ],
      missingData: unresolved.map(
        (entry) => `${entry.item.item.id}: 门片数量、门宽、铰链侧和开启方向`,
      ),
      details: diagnostics.map((item) => item.message),
      diagnostics,
    },
  );
};

export const ruleG3019: G3Rule = (handoff) => {
  const analysis = furnitureUseAnalysis(handoff),
    beds = analysis.items.filter(
      (item) => item.semantic === "bed" && item.roomRegionId,
    ),
    bedroomBeds = beds.filter((bed) =>
      analysis.navigation.rooms
        .find((room) => room.roomRegionId === bed.roomRegionId)
        ?.zoneNames.some((name) => bedroom.test(name)),
    ),
    doorEntryRule = ruleG3002(handoff);
  const pathDuplicates = bedroomBeds.filter((bed) =>
    analysis.navigation.rooms
      .find((room) => room.roomRegionId === bed.roomRegionId)
      ?.largeFurnitureBlockerIds.includes(bed.item.id),
  );
  const entryDuplicates = bedroomBeds.flatMap((bed) =>
    doorEntryRule.diagnostics
      .filter(
        (entry) =>
          entry.code === "door_entry_fully_blocked" &&
          entry.normalizedObjectIds.includes(bed.item.id),
      )
      .map((entry) => ({ bed, entry })),
  );
  const unresolved = bedroomBeds.filter((bed) => {
      const room = analysis.navigation.rooms.find(
        (candidate) => candidate.roomRegionId === bed.roomRegionId,
      );
      return !room || !room.usableForEvaluation || !room.portalNodes.length;
    }),
    duplicated = new Set([
      ...pathDuplicates.map((bed) => bed.item.id),
      ...entryDuplicates.map(({ bed }) => bed.item.id),
    ]),
    status: RuleStatus = duplicated.size
      ? "not_applicable"
      : unresolved.length
        ? "unable_to_determine"
        : bedroomBeds.length
          ? "pass"
          : "not_applicable";
  const diagnostics = [
    ...pathDuplicates.map((bed) =>
      diagnostic(
        "info",
        "bed_path_blockage_reported_by_g3004",
        `${bed.item.name ?? "床"}造成的主要路径中断已由G3-004报告，本规则不重复报警`,
        [bed.item.id, bed.roomRegionId!],
        "rule",
        "处理G3-004中对应的大型家具阻断。",
      ),
    ),
    ...entryDuplicates.map(({ bed, entry }) =>
      diagnostic(
        "info",
        "bed_entry_blockage_reported_by_g3002",
        `${bed.item.name ?? "床"}与卧室房门或相邻入口的阻断已由G3-002报告，本规则不重复报警`,
        [
          bed.item.id,
          ...entry.normalizedObjectIds.filter((id) => id !== bed.item.id),
        ],
        "rule",
        "处理G3-002中对应的门口阻断。",
      ),
    ),
    ...unresolved.map((bed) =>
      diagnostic(
        "warning",
        "bedroom_portal_or_path_unavailable",
        `${bed.item.name ?? "床"}所在卧室缺少可靠Door Portal或房内路径`,
        [bed.item.id, bed.roomRegionId!],
        "insufficient_information",
        "检查卧室房门、套内卫生间入口及Room路径。",
      ),
    ),
    ...bedroomBeds
      .filter(
        (bed) => bed.semanticConfidence === "low" && !unresolved.includes(bed),
      )
      .map((bed) =>
        diagnostic(
          "info",
          "bed_semantic_confidence_low_but_not_blocking",
          `${bed.item.name ?? "疑似床"}的源category存在冲突，但其几何没有形成明确入口或路径阻断`,
          [bed.item.id, bed.roomRegionId!],
          "source_data",
          "建议修正家具category；本轮不因未形成阻断而判失败。",
        ),
      ),
  ];
  const checkedDoorIds = [
    ...new Set(
      bedroomBeds.flatMap(
        (bed) =>
          analysis.navigation.rooms
            .find((room) => room.roomRegionId === bed.roomRegionId)
            ?.portalNodes.map((portal) => portal.doorId) ?? [],
      ),
    ),
  ];
  return result(
    "G3-019",
    "床不得阻断卧室房门、套内卫生间入口及已建立的主要通行路径",
    status,
    duplicated.size
      ? "相关床阻断已由基础门口或通行规则统一报告"
      : unresolved.length
        ? `${unresolved.length} 张床缺少可靠卧室入口或路径`
        : `${bedroomBeds.length} 张床未阻断卧室房门、相邻入口或已建立主要路径`,
    {
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "bedroomBedCount", value: bedroomBeds.length },
        { name: "checkedBedroomPortalCount", value: checkedDoorIds.length },
        { name: "duplicatedFoundationFindingCount", value: duplicated.size },
      ],
      missingData: unresolved.map(
        (item) => `${item.item.id}: 可靠卧室Door Portal或路径`,
      ),
      diagnostics,
    },
  );
};

export const ruleG3020: G3Rule = (handoff) => {
  const analysis = furnitureUseAnalysis(handoff),
    seats = analysis.items.filter(
      (item) => item.semantic === "sofa" || item.semantic === "lounge-chair",
    ),
    evaluated = seats
      .map((seat) => ({
        seat,
        assessment: assessmentsFor(analysis, seat.item.id, "seating-front")[0],
      }))
      .filter(
        (
          entry,
        ): entry is {
          seat: FurnitureSemanticItem;
          assessment: FurnitureUseZoneAssessment;
        } => Boolean(entry.assessment),
      ),
    issue = evaluated.filter((entry) => !entry.assessment.usable),
    unresolved = seats.filter(
      (seat) =>
        seat.semanticConfidence === "low" ||
        !evaluated.some((entry) => entry.seat.item.id === seat.item.id),
    ),
    status: RuleStatus = issue.length
      ? "issue"
      : unresolved.length
        ? "unable_to_determine"
        : evaluated.length
          ? "pass"
          : "not_applicable";
  const diagnostics = [
    ...issue.map(({ seat, assessment }) =>
      diagnostic(
        "error",
        "seating_front_use_zone_blocked",
        `${seat.item.name ?? "主要坐具"}沿家具中心红线方向的450毫米基本进入区只有 ${(assessment.clearRatio * 100).toFixed(0)}% 可用`,
        [seat.item.id, ...assessment.blockerIds],
        "source_data",
        "移动坐具或正前方家具，恢复基本进入区域。",
        {
          actualValue: assessment.clearRatio,
          expectedValue: `>= ${T.furnitureUseZoneClearRatio}`,
        },
      ),
    ),
    ...unresolved.map((seat) =>
      diagnostic(
        "warning",
        "seating_geometry_unavailable",
        `${seat.item.name ?? "主要坐具"}缺少可靠类别、尺寸、位置或旋转`,
        [seat.item.id],
        "insufficient_information",
        "补充可靠家具几何后重新评价。",
      ),
    ),
  ];
  return result(
    "G3-020",
    "客厅主要坐具能够正常使用",
    status,
    issue.length
      ? `发现 ${issue.length} 件主要坐具的正前方基本进入区被阻挡`
      : unresolved.length
        ? `${unresolved.length} 件主要坐具缺少可靠几何`
        : `${evaluated.length} 件主要坐具沿家具朝向具有基本进入区域`,
    {
      normalizedObjectIds: issue.map((entry) => entry.seat.item.id),
      pascalSourceIds: sourceIds(
        seats,
        issue.map((entry) => entry.seat.item.id),
      ),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "mainSeatingCount", value: seats.length },
        ...evaluated.map(({ seat, assessment }) => ({
          name: "seatingFrontClearRatio",
          value: assessment.clearRatio,
          normalizedObjectId: seat.item.id,
        })),
      ],
      missingData: unresolved.map((item) => `${item.item.id}: 可靠类别和几何`),
      diagnostics,
    },
  );
};

export const ruleG3021: G3Rule = (handoff) => {
  const analysis = furnitureUseAnalysis(handoff),
    rooms = roomsMatching(analysis, living).filter(
      (room) => room.portalNodes.length,
    ),
    blocked = rooms.filter(
      (room) =>
        !room.furnishedConnected && room.largeFurnitureBlockerIds.length,
    ),
    unresolved = rooms.filter(
      (room) => room.uncertainObjectIds.length || !room.usableForEvaluation,
    ),
    status: RuleStatus = blocked.length
      ? "not_applicable"
      : unresolved.length
        ? "unable_to_determine"
        : rooms.length
          ? "pass"
          : "not_applicable",
    diagnostics = [
      ...blocked.map((room) =>
        diagnostic(
          "info",
          "living_path_blockage_reported_by_g3004",
          `${roomNames(analysis, room.roomRegionId)}的家具通行阻断已由G3-004报告，本规则不重复报警`,
          [room.roomRegionId, ...room.largeFurnitureBlockerIds],
          "rule",
          "处理G3-004中对应问题。",
        ),
      ),
      ...unresolved.map((room) =>
        diagnostic(
          "warning",
          "living_navigation_unresolved",
          `${roomNames(analysis, room.roomRegionId)}因对象分类不足无法确认主要通行`,
          [room.roomRegionId, ...room.uncertainObjectIds],
          "insufficient_information",
          "核对橙色对象类别和占地。",
        ),
      ),
    ];
  return result(
    "G3-021",
    "客厅家具不得阻断主要通行",
    status,
    blocked.length
      ? "客厅阻断已由基础通行规则统一报告"
      : unresolved.length
        ? `${unresolved.length} 个客厅的家具通行无法判断`
        : `${rooms.length} 个客厅的必要Portal保持连通`,
    {
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "livingRoomCount", value: rooms.length },
        { name: "livingRoomBlockedCount", value: blocked.length },
      ],
      missingData: unresolved.map(
        (room) => `${room.roomRegionId}: 可靠家具分类`,
      ),
      diagnostics,
    },
  );
};

export const ruleG3022: G3Rule = (handoff) => {
  const analysis = furnitureUseAnalysis(handoff),
    tables = analysis.items.filter((item) => item.semantic === "dining-table"),
    chairs = analysis.items.filter((item) => item.semantic === "dining-chair"),
    evaluated = tables.map((table) => {
      const roomChairs = chairs.filter(
          (chair) =>
            chair.roomRegionId && chair.roomRegionId === table.roomRegionId,
        ),
        planned = (
          table.item as typeof table.item & { plannedSeatCount?: number | null }
        ).plannedSeatCount;
      return {
        table,
        roomChairs,
        planned: Number.isFinite(planned) ? Number(planned) : null,
      };
    }),
    failed = evaluated.filter(
      (entry) =>
        entry.planned !== null && entry.roomChairs.length < entry.planned,
    ),
    unknown = evaluated.filter((entry) => entry.planned === null),
    status: RuleStatus = failed.length
      ? "issue"
      : unknown.length
        ? "unable_to_determine"
        : evaluated.length
          ? "pass"
          : "not_applicable",
    diagnostics = [
      ...failed.map((entry) =>
        diagnostic(
          "error",
          "planned_dining_capacity_insufficient",
          `${entry.table.item.name ?? "餐桌"}计划 ${entry.planned} 席，但所在Room只识别到 ${entry.roomChairs.length} 把餐椅`,
          [
            entry.table.item.id,
            ...entry.roomChairs.map((chair) => chair.item.id),
          ],
          "source_data",
          "补足餐椅或下调明确计划座位数。",
        ),
      ),
      ...unknown.map((entry) =>
        diagnostic(
          "warning",
          "planned_dining_capacity_unavailable",
          `${entry.table.item.name ?? "餐桌"}所在Room识别到 ${entry.roomChairs.length} 把餐椅，但JSON没有计划使用人数，无法判断座位是否满足计划`,
          [
            entry.table.item.id,
            ...entry.roomChairs.map((chair) => chair.item.id),
          ],
          "insufficient_information",
          "提供项目计划用餐人数，或明确餐桌计划座位数。",
          {
            actualValue: entry.roomChairs.length,
            expectedValue: "plannedSeatCount",
          },
        ),
      ),
    ];
  return result(
    "G3-022",
    "餐桌具有与计划人数相符的基本座位",
    status,
    failed.length
      ? `${failed.length} 张餐桌座位不足`
      : unknown.length
        ? `${unknown.length} 张餐桌缺少计划使用人数`
        : evaluated.length
          ? `${evaluated.length} 张餐桌满足明确计划座位数`
          : "当前没有可识别餐桌",
    {
      details: diagnostics.map((item) => item.message),
      normalizedObjectIds: failed.map((entry) => entry.table.item.id),
      measurements: [
        { name: "diningTableCount", value: tables.length },
        { name: "diningChairCount", value: chairs.length },
        ...evaluated.map((entry) => ({
          name: "plannedSeatCount",
          value: entry.planned,
          normalizedObjectId: entry.table.item.id,
        })),
      ],
      missingData: unknown.map(
        (entry) => `${entry.table.item.id}: 计划用餐人数或计划座位数`,
      ),
      diagnostics,
    },
  );
};

export const ruleG3023: G3Rule = (handoff) => {
  const analysis = furnitureUseAnalysis(handoff),
    chairs = analysis.items.filter((item) => item.semantic === "dining-chair"),
    evaluated = chairs
      .map((chair) => ({
        chair,
        assessment: assessmentsFor(
          analysis,
          chair.item.id,
          "dining-chair-pullout",
        )[0],
      }))
      .filter(
        (
          item,
        ): item is {
          chair: FurnitureSemanticItem;
          assessment: FurnitureUseZoneAssessment;
        } => Boolean(item.assessment),
      ),
    issue = evaluated.filter((item) => !item.assessment.usable),
    unresolved = chairs.filter(
      (chair) =>
        chair.semanticConfidence === "low" ||
        !evaluated.some((item) => item.chair.item.id === chair.item.id),
    ),
    status: RuleStatus = issue.length
      ? "issue"
      : unresolved.length
        ? "unable_to_determine"
        : evaluated.length
          ? "pass"
          : "not_applicable",
    diagnostics = [
      ...issue.map(({ chair, assessment }) =>
        diagnostic(
          "error",
          "dining_chair_pullout_blocked",
          `${chair.item.name ?? "餐椅"}沿家具朝向反方向的600毫米拉出区域只有 ${(assessment.clearRatio * 100).toFixed(0)}% 可用，无法完成基本拉出和入座`,
          [chair.item.id, ...assessment.blockerIds],
          "source_data",
          "移动餐椅或后方家具，恢复基本拉出区域。",
          {
            actualValue: assessment.clearRatio,
            expectedValue: `>= ${T.furnitureUseZoneClearRatio}`,
          },
        ),
      ),
      ...unresolved.map((chair) =>
        diagnostic(
          "warning",
          "dining_chair_geometry_unavailable",
          `${chair.item.name ?? "疑似餐椅"}缺少可靠类别、尺寸、位置或旋转，无法生成后方拉出区域`,
          [chair.item.id],
          "insufficient_information",
          "核对餐椅category和几何。",
        ),
      ),
    ];
  return result(
    "G3-023",
    "餐椅能够完成基本拉出和入座",
    status,
    issue.length
      ? `发现 ${issue.length} 把餐椅没有基本拉出空间`
      : unresolved.length
        ? `${unresolved.length} 把餐椅缺少可靠几何`
        : `${evaluated.length} 把餐椅沿家具朝向反方向具有基本拉出区域`,
    {
      normalizedObjectIds: issue.map((item) => item.chair.item.id),
      pascalSourceIds: sourceIds(
        chairs,
        issue.map((item) => item.chair.item.id),
      ),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "evaluatedDiningChairCount", value: evaluated.length },
        ...evaluated.map(({ chair, assessment }) => ({
          name: "chairPulloutClearRatio",
          value: assessment.clearRatio,
          normalizedObjectId: chair.item.id,
        })),
      ],
      missingData: unresolved.map((item) => `${item.item.id}: 可靠类别和几何`),
      diagnostics,
    },
  );
};

export const ruleG3024: G3Rule = (handoff) => {
  const analysis = furnitureUseAnalysis(handoff),
    composite = analysis.navigation.rooms.filter(
      (room) =>
        room.zoneNames.some((name) => living.test(name)) &&
        room.zoneNames.some((name) => dining.test(name)),
    ),
    relevantAssessments = analysis.assessments.filter(
      (assessment) =>
        composite.some(
          (room) => room.roomRegionId === assessment.zone.roomRegionId,
        ) &&
        ["dining-chair-pullout", "seating-front"].includes(
          assessment.zone.kind,
        ),
    ),
    conflicts = relevantAssessments.filter((assessment) => !assessment.usable),
    unresolved = analysis.items.filter(
      (item) =>
        composite.some((room) => room.roomRegionId === item.roomRegionId) &&
        ["sofa", "lounge-chair", "dining-chair"].includes(item.semantic) &&
        !relevantAssessments.some(
          (assessment) => assessment.zone.ownerObjectId === item.item.id,
        ),
    ),
    status: RuleStatus = conflicts.length
      ? "issue"
      : unresolved.length
        ? "unable_to_determine"
        : composite.length
          ? "pass"
          : "not_applicable";
  const diagnostics = [
    ...conflicts.map((assessment) =>
      diagnostic(
        "error",
        "composite_function_use_zone_conflict",
        "客餐厅复合空间中的坐具或餐椅基本使用区被占用，多个功能不能同时成立",
        [
          assessment.zone.ownerObjectId,
          ...assessment.blockerIds,
          assessment.zone.roomRegionId!,
        ],
        "source_data",
        "调整客厅坐具、餐桌、餐椅或通道附近家具。",
      ),
    ),
    ...unresolved.map((item) =>
      diagnostic(
        "warning",
        "composite_furniture_geometry_unavailable",
        `${item.item.name ?? "家具"}没有可靠生成复合功能使用区`,
        [item.item.id, item.roomRegionId!],
        "insufficient_information",
        "核对家具类别、尺寸、位置和旋转。",
      ),
    ),
  ];
  return result(
    "G3-024",
    "客厅、餐厅和通道等复合功能能够同时成立",
    status,
    conflicts.length
      ? `发现 ${conflicts.length} 处复合功能使用区冲突`
      : unresolved.length
        ? `${composite.length} 个客餐厅复合空间仍有 ${unresolved.length} 件家具几何无法判断`
        : composite.length
          ? `${composite.length} 个客餐厅复合空间的基本使用区和通道可以同时成立`
          : "当前没有识别到同一Room内的客餐厅复合功能",
    {
      normalizedObjectIds: conflicts.map((item) => item.zone.ownerObjectId),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "compositeLivingDiningRoomCount", value: composite.length },
        { name: "compositeUseZoneConflictCount", value: conflicts.length },
      ],
      missingData: unresolved.map(
        (item) => `${item.item.id}: 可靠家具类别、尺寸、位置或旋转`,
      ),
      diagnostics,
    },
  );
};

export const FURNITURE_G3_RULES: G3Rule[] = [
  ruleG3014,
  ruleG3015,
  ruleG3016,
  ruleG3017,
  ruleG3018,
  ruleG3019,
  ruleG3020,
  ruleG3021,
  ruleG3022,
  ruleG3023,
  ruleG3024,
];
