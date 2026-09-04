import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import {
  buildOperationUseAnalysis,
  type OperationAssessment,
  type OperationItem,
  type OperationUseAnalysis,
} from "./operation-use";
import { G1_GEOMETRY_TOLERANCES as T } from "./tolerances";
import { buildBuildingEnvelopes, outsideFootprintArea, polygonArea } from "./envelope";
import { hasFunctionTag } from "./object-semantics";
import type { G3Rule, RuleDiagnostic, RuleResult, RuleStatus } from "./types";

const cache = new WeakMap<object, OperationUseAnalysis>();
export const operationUseAnalysis = (handoff: EvaluationHandoff) => {
  const prior = cache.get(handoff);
  if (prior) return prior;
  const value = buildOperationUseAnalysis(handoff);
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
    { name: "operationZoneClearRatio", value: T.furnitureUseZoneClearRatio },
    {
      name: "cabinetOperationDepth",
      value: T.cabinetOperationDepthMeters,
      unit: "meter",
    },
    {
      name: "applianceOperationDepth",
      value: T.applianceOperationDepthMeters,
      unit: "meter",
    },
    {
      name: "windowOperationDepth",
      value: T.windowOperationDepthMeters,
      unit: "meter",
    },
    {
      name: "windowOperationPassClearRatio",
      value: T.windowOperationPassClearRatio,
    },
    {
      name: "windowOperationIssueClearRatio",
      value: T.windowOperationIssueClearRatio,
    },
  ],
  missingData: [],
  confidence: {
    level: status === "unable_to_determine" ? "low" : "medium",
    score: status === "unable_to_determine" ? 0.4 : 0.75,
    reasons: ["V0.1只判断基本使用，不评价规范净空或舒适度"],
  },
  diagnostics: [],
  ...partial,
});
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
const assessmentFor = (
  analysis: OperationUseAnalysis,
  id: string,
  kind?: string,
) =>
  analysis.assessments.find(
    (entry) =>
      entry.zone.ownerObjectId === id && (!kind || entry.zone.kind === kind),
  );
const sourceIds = (items: OperationItem[], ids: string[]) => [
  ...new Set(
    ids.map(
      (id) => items.find((item) => item.item.id === id)?.item.rawPascalId ?? id,
    ),
  ),
];
const roomName = (room: OperationUseAnalysis["storageRooms"][number]) =>
  room.zoneNames.join(" / ") || room.roomRegionId;

export const ruleG3009: G3Rule = (handoff) => {
  const analysis = operationUseAnalysis(handoff),
    rooms = analysis.navigation.rooms.filter((room) => room.portalNodes.length),
    blocked = rooms.flatMap((room) =>
      room.portalNodes
        .filter((portal) => !portal.furnishedLanding)
        .map((portal) => ({ room, portal })),
    ),
    duplicates = blocked.filter(
      ({ room }) =>
        room.fixedBlockerIds.length || room.largeFurnitureBlockerIds.length,
    ),
    unresolved = blocked.filter(
      (entry) => !duplicates.includes(entry) && !entry.room.usableForEvaluation,
    ),
    unique = blocked.filter(
      (entry) => !duplicates.includes(entry) && !unresolved.includes(entry),
    ),
    status: RuleStatus = unique.length
      ? "issue"
      : unresolved.length
        ? "unable_to_determine"
        : duplicates.length
          ? "not_applicable"
          : rooms.length
            ? "pass"
            : "not_applicable",
    diagnostics = [
      ...unique.map(({ room, portal }) =>
        diagnostic(
          "error",
          "door_rear_standing_unavailable",
          `${roomName(room)}的门后没有可停留并继续进入房间的基本位置`,
          [portal.doorId, room.roomRegionId],
          "source_data",
          "移动门后对象或调整门和房间布局。",
        ),
      ),
      ...duplicates.map(({ room, portal }) =>
        diagnostic(
          "info",
          "door_rear_blockage_reported_by_navigation",
          `${roomName(room)}的门后阻断已由G3-003/G3-004/G3-006报告，本规则不重复报警`,
          [
            portal.doorId,
            room.roomRegionId,
            ...room.fixedBlockerIds,
            ...room.largeFurnitureBlockerIds,
          ],
          "rule",
          "处理基础通行规则中的同一根因。",
        ),
      ),
      ...unresolved.map(({ room, portal }) =>
        diagnostic(
          "warning",
          "door_rear_geometry_unresolved",
          `${roomName(room)}的门后落点因Room或Portal几何不足无法判断`,
          [portal.doorId, room.roomRegionId],
          "insufficient_information",
          "核对Door Portal和Room几何。",
        ),
      ),
    ];
  return result(
    "G3-009",
    "门后具有基本停留空间",
    status,
    unique.length
      ? `发现 ${unique.length} 处门后没有基本停留空间`
      : unresolved.length
        ? `${unresolved.length} 处门后空间无法判断`
        : duplicates.length
          ? "门后阻断已由基础通行规则统一报告"
          : `${rooms.reduce((sum, room) => sum + room.portalNodes.length, 0)} 个房间侧门后落点可继续进入内部`,
    {
      normalizedObjectIds: unique.map(({ portal }) => portal.doorId),
      details: diagnostics.map((item) => item.message),
      measurements: [
        {
          name: "doorRoomSideLandingCount",
          value: rooms.reduce((sum, room) => sum + room.portalNodes.length, 0),
        },
        { name: "doorRearUnavailableCount", value: blocked.length },
      ],
      missingData: unresolved.map(
        ({ portal }) => `${portal.doorId}: 可靠门后落点`,
      ),
      diagnostics,
    },
  );
};

export const ruleG3010: G3Rule = (handoff) => {
  const analysis = operationUseAnalysis(handoff),
    cabinets = analysis.items.filter(
      (item) => item.explicitlyOpenable && item.capabilities.includes("fixed-cabinet"),
    ),
    evaluated = cabinets
      .map((item) => ({
        item,
        assessment: assessmentFor(analysis, item.item.id, "cabinet-front"),
      }))
      .filter(
        (
          entry,
        ): entry is { item: OperationItem; assessment: OperationAssessment } =>
          Boolean(entry.assessment),
      ),
    reliable = evaluated.filter(
      (entry) => entry.item.operationGeometryReliable,
    ),
    blocked = reliable.filter((entry) => !entry.assessment.usable),
    missing = cabinets.filter((item) => !item.operationGeometryReliable),
    reported = [
      ...blocked.map(({ item }) => item.item.id),
      ...missing.map((item) => item.item.id),
    ],
    status: RuleStatus = blocked.length
      ? "issue"
      : missing.length
        ? "unable_to_determine"
        : reliable.length
          ? "pass"
          : "not_applicable",
    diagnostics = [
      ...blocked.map(({ item, assessment }) =>
        diagnostic(
          "error",
          assessment.openingUsable === false
            ? "fixed_cabinet_opening_sweep_blocked"
            : "fixed_cabinet_post_opening_use_blocked",
          assessment.openingUsable === false
            ? `${item.item.name ?? "固定柜体"}的显式柜门开启范围被实体占用，柜门无法打开`
            : `${item.item.name ?? "固定柜体"}打开后人员操作区只有${Math.round((assessment.openedUseClearRatio ?? assessment.clearRatio) * 100)}%可用`,
          [
            item.item.id,
            ...(assessment.openingUsable === false
              ? assessment.openingBlockerIds
              : assessment.openedUseBlockerIds),
          ],
          "source_data",
          "移动柜前阻挡对象，恢复基本操作位置。",
        ),
      ),
      ...missing.map((item) => {
        const assessment = assessmentFor(
          analysis,
          item.item.id,
          "cabinet-front",
        );
        return diagnostic(
          "warning",
          "cabinet_door_geometry_unavailable",
          `${item.item.name ?? "固定柜体"}只有柜体位置${assessment ? `，柜前操作区可用约${Math.round(assessment.clearRatio * 100)}%` : ""}，但没有独立门片数量、宽度、铰链和开向`,
          [item.item.id, ...(assessment?.blockerIds ?? [])],
          "insufficient_information",
          "保留柜前空间诊断；补充柜门几何后才能判断实际开启。",
        );
      }),
    ];
  return result(
    "G3-010",
    "固定柜门能够正常开启",
    status,
    blocked.length
      ? `发现 ${blocked.length} 个固定柜门无法开启`
      : missing.length
        ? `${missing.length} 个固定柜体缺少柜门开启几何`
        : reliable.length
          ? `${reliable.length} 个固定柜门具有基本操作条件`
          : "当前没有可识别固定柜体",
    {
      normalizedObjectIds: reported,
      pascalSourceIds: sourceIds(cabinets, reported),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "fixedCabinetCount", value: cabinets.length },
        { name: "cabinetDoorGeometryCount", value: reliable.length },
        ...analysis.zones.filter((zone) => zone.kind === "cabinet-front").flatMap((zone) => [
          { name: "maximumOpeningDepth", value: zone.maximumOpeningDepthMeters ?? null, unit: "meter", normalizedObjectId: zone.ownerObjectId },
          { name: "minimumOpeningUseClearance", value: zone.minimumUseClearanceMeters ?? null, unit: "meter", normalizedObjectId: zone.ownerObjectId },
        ]),
      ],
      missingData: missing.map(
        (item) => `${item.item.id}: 柜门数量、门宽、铰链侧和开向`,
      ),
      diagnostics,
    },
  );
};

export const ruleG3011: G3Rule = (handoff) => {
  const analysis = operationUseAnalysis(handoff),
    drawers = analysis.items.filter(
      (item) => item.explicitlyOpenable && item.capabilities.includes("drawer"),
    ),
    evaluated = drawers
      .map((item) => ({
        item,
        assessment: assessmentFor(analysis, item.item.id, "drawer-front"),
      }))
      .filter(
        (
          entry,
        ): entry is { item: OperationItem; assessment: OperationAssessment } =>
          Boolean(entry.assessment),
      ),
    blocked = evaluated.filter(
      (entry) =>
        entry.item.operationGeometryBasis === "explicit" &&
        !entry.assessment.usable,
    ),
    boundedUnclear = evaluated.filter(
      (entry) =>
        entry.item.operationGeometryBasis === "bounded-assumption" &&
        !entry.assessment.usable,
    ),
    safe = evaluated.filter(
      (entry) =>
        entry.item.operationGeometryBasis !== "unavailable" &&
        entry.assessment.usable,
    ),
    missing = drawers.filter(
      (item) => item.operationGeometryBasis === "unavailable",
    ),
    diagnostics = [
      ...blocked.map(({ item, assessment }) =>
        diagnostic(
          "error",
          assessment.openingUsable === false
            ? "drawer_pullout_sweep_blocked"
            : "drawer_post_opening_use_blocked",
          assessment.openingUsable === false
            ? `${item.item.name ?? "抽屉"}的拉出范围被实体占用，无法拉出`
            : `${item.item.name ?? "抽屉"}拉出后的人员操作区不足`,
          [
            item.item.id,
            ...(assessment.openingUsable === false
              ? assessment.openingBlockerIds
              : assessment.openedUseBlockerIds),
          ],
          "source_data",
          "移动抽屉前方对象。",
        ),
      ),
      ...boundedUnclear.map(({ item, assessment }) =>
        diagnostic(
          "warning",
          "drawer_bounded_envelope_not_clear",
          `${item.item.name ?? "抽屉柜"}按“拉出不超过柜体深度”的保守包络计算，前方空间未完全满足；真实抽屉可能更短`,
          [item.item.id, ...assessment.blockerIds],
          "geometry_tolerance",
          "人工核对实际抽屉深度；当前不直接判失败。",
        ),
      ),
      ...safe
        .filter(
          ({ item }) => item.operationGeometryBasis === "bounded-assumption",
        )
        .map(({ item }) =>
          diagnostic(
            "info",
            "drawer_bounded_envelope_clear",
            `${item.item.name ?? "抽屉柜"}沿家具正面方向、按柜体深度生成的保守拉出包络保持畅通`,
            [item.item.id],
            "rule",
            "V0.1据此确认基本拉出。",
          ),
        ),
      ...missing.map((item) =>
        diagnostic(
          "warning",
          "drawer_operation_geometry_unavailable",
          `${item.item.name ?? "抽屉柜"}缺少可用尺寸或朝向，无法建立保守拉出包络`,
          [item.item.id],
          "insufficient_information",
          "补充对象尺寸和朝向。",
        ),
      ),
    ];
  return result(
    "G3-011",
    "主要抽屉能够基本拉出",
    blocked.length
      ? "issue"
      : boundedUnclear.length || missing.length
        ? "unable_to_determine"
        : safe.length
          ? "pass"
          : "not_applicable",
    blocked.length
      ? `发现 ${blocked.length} 个主要抽屉无法基本拉出`
      : boundedUnclear.length || missing.length
        ? `${boundedUnclear.length + missing.length} 个抽屉的保守拉出包络仍需核验`
        : `${safe.length} 个抽屉按不超过柜体深度的上界可基本拉出`,
    {
      normalizedObjectIds: [
        ...blocked,
        ...boundedUnclear,
        ...missing.map((item) => ({ item })),
      ].map(({ item }) => item.item.id),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "drawerCandidateCount", value: drawers.length },
        { name: "boundedEnvelopeClearCount", value: safe.length },
        { name: "boundedEnvelopeUnclearCount", value: boundedUnclear.length },
      ],
      missingData: missing.map((item) => `${item.item.id}: 有效尺寸或朝向`),
      diagnostics,
    },
  );
};

export const ruleG3012: G3Rule = (handoff) => {
  const analysis = operationUseAnalysis(handoff),
    laundry = analysis.items.filter(
      (item) => item.explicitlyOpenable && item.capabilities.includes("laundry-appliance"),
    ),
    kitchen = analysis.items.filter(
      (item) =>
        item.capabilities.includes("major-appliance") &&
        !item.capabilities.includes("laundry-appliance"),
    ),
    evaluated = laundry
      .map((item) => ({
        item,
        assessment: assessmentFor(analysis, item.item.id, "laundry-front"),
      }))
      .filter(
        (
          entry,
        ): entry is { item: OperationItem; assessment: OperationAssessment } =>
          Boolean(entry.assessment),
      ),
    blocked = evaluated.filter(
      (entry) =>
        entry.item.operationGeometryBasis === "explicit" &&
        !entry.assessment.usable,
    ),
    boundedUnclear = evaluated.filter(
      (entry) =>
        entry.item.operationGeometryBasis === "bounded-assumption" &&
        !entry.assessment.usable,
    ),
    safe = evaluated.filter(
      (entry) =>
        entry.item.operationGeometryBasis !== "unavailable" &&
        entry.assessment.usable,
    ),
    missing = laundry.filter(
      (item) => item.operationGeometryBasis === "unavailable",
    ),
    diagnostics = [
      ...blocked.map(({ item, assessment }) =>
        diagnostic(
          "error",
          assessment.openingUsable === false
            ? "major_appliance_door_sweep_blocked"
            : "major_appliance_post_opening_use_blocked",
          assessment.openingUsable === false
            ? `${item.item.name ?? "主要设备"}的开门范围被实体占用，设备门无法打开`
            : `${item.item.name ?? "主要设备"}开门后的人员操作区不足`,
          [
            item.item.id,
            ...(assessment.openingUsable === false
              ? assessment.openingBlockerIds
              : assessment.openedUseBlockerIds),
          ],
          "source_data",
          "移动设备门前对象。",
        ),
      ),
      ...boundedUnclear.map(({ item, assessment }) =>
        diagnostic(
          "warning",
          "appliance_bounded_envelope_not_clear",
          `${item.item.name ?? "主要设备"}按“门体不超过设备宽度”的保守包络计算仍有阻挡；未知铰链和真实门径可能避开该阻挡`,
          [item.item.id, ...assessment.blockerIds],
          "geometry_tolerance",
          "人工核对设备门；当前不直接判失败。",
        ),
      ),
      ...safe
        .filter(
          ({ item }) => item.operationGeometryBasis === "bounded-assumption",
        )
        .map(({ item }) =>
          diagnostic(
            "info",
            "appliance_bounded_envelope_clear",
            `${item.item.name ?? "主要设备"}正前方按设备宽度生成的完整开门包络保持畅通`,
            [item.item.id],
            "rule",
            "V0.1据此确认基本开启。",
          ),
        ),
      ...missing.map((item) =>
        diagnostic(
          "warning",
          "major_appliance_door_geometry_unavailable",
          `${item.item.name ?? "主要设备"}缺少可用于保守包络的尺寸或朝向`,
          [item.item.id],
          "insufficient_information",
          "补充设备尺寸和朝向。",
        ),
      ),
      ...kitchen.map((item) =>
        diagnostic(
          "info",
          "kitchen_appliance_door_reported_by_g3029",
          `${item.item.name ?? "厨房设备"}的设备门数据由G3-029统一说明`,
          [item.item.id],
          "rule",
          "查看G3-029，避免重复卡片。",
        ),
      ),
    ];
  return result(
    "G3-012",
    "主要设备门能够正常开启",
    blocked.length
      ? "issue"
      : boundedUnclear.length || missing.length
        ? "unable_to_determine"
        : safe.length
          ? "pass"
          : kitchen.length
            ? "not_applicable"
            : "not_applicable",
    blocked.length
      ? `发现 ${blocked.length} 个主要设备门无法基本开启`
      : boundedUnclear.length || missing.length
        ? `${boundedUnclear.length + missing.length} 个主要设备门的保守开启包络仍需核验`
        : `${safe.length} 个主要设备门按不超过设备宽度的上界可基本开启`,
    {
      normalizedObjectIds: [
        ...blocked,
        ...boundedUnclear,
        ...missing.map((item) => ({ item })),
      ].map(({ item }) => item.item.id),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "majorApplianceCount", value: laundry.length + kitchen.length },
        { name: "boundedEnvelopeClearCount", value: safe.length },
        { name: "boundedEnvelopeUnclearCount", value: boundedUnclear.length },
      ],
      missingData: missing.map((item) => `${item.item.id}: 有效尺寸或朝向`),
      diagnostics,
    },
  );
};

export const ruleG3039: G3Rule = (handoff) => {
  const analysis = operationUseAnalysis(handoff),
    laundry = analysis.items.filter((item) =>
      item.capabilities.includes("laundry-appliance"),
    ),
    evaluated = laundry
      .map((item) => ({
        item,
        assessment: assessmentFor(analysis, item.item.id, "laundry-front"),
      }))
      .filter(
        (
          entry,
        ): entry is { item: OperationItem; assessment: OperationAssessment } =>
          Boolean(entry.assessment) && Boolean(entry.item.roomRegionId),
      ),
    blocked = evaluated.filter((entry) => !entry.assessment.usable),
    unresolved = laundry.filter(
      (item) => !evaluated.some((entry) => entry.item.item.id === item.item.id),
    ),
    reported = [
      ...blocked.map(({ item }) => item.item.id),
      ...unresolved.map((item) => item.item.id),
    ],
    status: RuleStatus = blocked.length
      ? "issue"
      : unresolved.length
        ? "unable_to_determine"
        : laundry.length
          ? "pass"
          : "not_applicable",
    diagnostics = [
      ...blocked.map(({ item, assessment }) =>
        diagnostic(
          "error",
          assessment.openingUsable === false
            ? "laundry_appliance_door_sweep_blocked"
            : "laundry_appliance_operation_area_blocked",
          assessment.openingUsable === false
            ? `${item.item.name ?? "洗衣设备"}的显式开门范围被实体占用，设备门无法打开`
            : `${item.item.name ?? "洗衣设备"}前方没有可从入口到达的基本装取衣物区域`,
          [
            item.item.id,
            ...(assessment.openingUsable === false
              ? assessment.openingBlockerIds
              : assessment.openedUseBlockerIds),
          ],
          "source_data",
          "移动设备前方柜体或调整洗衣设备位置。",
        ),
      ),
      ...unresolved.map((item) =>
        diagnostic(
          "warning",
          "laundry_appliance_room_relation_unresolved",
          `${item.item.name ?? "洗衣设备"}没有可靠Room归属，无法建立设备前操作位置`,
          [item.item.id],
          "insufficient_information",
          "核对设备位置和Room Region。",
        ),
      ),
    ];
  return result(
    "G3-039",
    "洗衣设备能够正常操作",
    status,
    blocked.length
      ? `发现 ${blocked.length} 台洗衣设备没有基本装取衣物空间`
      : unresolved.length
        ? `${unresolved.length} 台洗衣设备缺少可靠Room归属`
        : laundry.length
          ? `${laundry.length} 台洗衣设备可从所在空间入口到达并具有基本操作位置`
          : "当前没有识别到洗衣机或烘干机",
    {
      normalizedObjectIds: reported,
      pascalSourceIds: sourceIds(laundry, reported),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "laundryApplianceCount", value: laundry.length },
        { name: "roomResolvedLaundryApplianceCount", value: evaluated.length },
        { name: "namedLaundryRoomCount", value: analysis.laundryRooms.length },
      ],
      missingData: unresolved.map((item) => `${item.item.id}: 可靠Room归属`),
      diagnostics,
    },
  );
};

export const ruleG3040: G3Rule = (handoff) => {
  const analysis = operationUseAnalysis(handoff),
    laundry = analysis.items.filter((item) =>
      item.capabilities.includes("laundry-appliance"),
    ),
    unresolved = laundry.filter((item) => !item.roomRegionId),
    blocked = laundry.flatMap((item) => {
      const room = analysis.navigation.rooms.find(
        (candidate) => candidate.roomRegionId === item.roomRegionId,
      );
      return room &&
        !room.furnishedConnected &&
        (room.fixedBlockerIds.includes(item.item.id) ||
          room.largeFurnitureBlockerIds.includes(item.item.id))
        ? [{ item, room }]
        : [];
    }),
    status: RuleStatus = blocked.length
      ? "not_applicable"
      : unresolved.length
        ? "unable_to_determine"
        : laundry.length
          ? "pass"
          : "not_applicable",
    diagnostics = [
      ...blocked.map(({ item, room }) =>
        diagnostic(
          "info",
          "laundry_path_blockage_reported_by_foundation",
          `${item.item.name ?? "洗衣设备"}造成的通行中断已由G3-003/G3-006报告`,
          [item.item.id, room.roomRegionId],
          "rule",
          "处理基础通行规则中的同一根因。",
        ),
      ),
      ...unresolved.map((item) =>
        diagnostic(
          "warning",
          "laundry_navigation_room_unresolved",
          `${item.item.name ?? "洗衣设备"}没有可靠Room归属，无法判断是否阻断必要通道`,
          [item.item.id],
          "insufficient_information",
          "核对设备位置和Room Region。",
        ),
      ),
    ];
  return result(
    "G3-040",
    "洗衣设备不得阻断必要通道",
    status,
    blocked.length
      ? "洗衣设备通行阻断已由基础规则统一报告"
      : unresolved.length
        ? `${unresolved.length} 台洗衣设备无法进行路径判断`
        : laundry.length
          ? "未发现洗衣设备切断必要通道"
          : "当前没有洗衣设备",
    {
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "laundryPathBlockerCount", value: blocked.length },
      ],
      missingData: unresolved.map((item) => `${item.item.id}: Room归属`),
      diagnostics,
    },
  );
};

export const ruleG3041: G3Rule = (handoff) => {
  const analysis = operationUseAnalysis(handoff),
    rooms = analysis.storageRooms,
    blocked = rooms.filter(
      (room) => room.portalNodes.length && !room.furnishedConnected,
    ),
    noEntry = rooms.filter((room) => !room.portalNodes.length),
    duplicates = [...blocked, ...noEntry].filter(
      (room) =>
        room.fixedBlockerIds.length || room.largeFurnitureBlockerIds.length,
    ),
    unique = [...blocked, ...noEntry].filter(
      (room) => !duplicates.includes(room),
    ),
    status: RuleStatus = unique.length
      ? "issue"
      : duplicates.length
        ? "not_applicable"
        : rooms.length
          ? "pass"
          : "not_applicable",
    diagnostics = [
      ...unique.map((room) =>
        diagnostic(
          "error",
          "storage_room_entry_unavailable",
          `${roomName(room)}没有可靠入口或无法进入内部自由空间`,
          [room.roomRegionId, ...room.zoneIds],
          "source_data",
          "检查储藏空间入口和柜体布置。",
        ),
      ),
      ...duplicates.map((room) =>
        diagnostic(
          "info",
          "storage_entry_reported_by_foundation",
          `${roomName(room)}的入口阻断已由G3-003/G3-005/G3-006报告`,
          [
            room.roomRegionId,
            ...room.fixedBlockerIds,
            ...room.largeFurnitureBlockerIds,
          ],
          "rule",
          "处理基础规则中的同一根因。",
        ),
      ),
    ];
  return result(
    "G3-041",
    "储藏空间能够正常进入",
    status,
    unique.length
      ? `发现 ${unique.length} 个储藏空间无法正常进入`
      : duplicates.length
        ? "储藏入口问题已由基础规则统一报告"
        : rooms.length
          ? `${rooms.length} 个储藏空间具有可靠入口和内部自由空间`
          : "当前没有识别到独立储藏空间",
    {
      normalizedObjectIds: unique.map((room) => room.roomRegionId),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "storageRoomCount", value: rooms.length },
        {
          name: "storageEntryUsableCount",
          value: rooms.filter(
            (room) => room.portalNodes.length && room.furnishedConnected,
          ).length,
        },
      ],
      diagnostics,
    },
  );
};

export const ruleG3042: G3Rule = (handoff) => {
  const analysis = operationUseAnalysis(handoff),
    cabinets = analysis.items.filter(
      (item) =>
        !hasFunctionTag(item.item, "wardrobes", "wardrobe") &&
        (item.capabilities.includes("open-shelf") ||
          (item.explicitlyOpenable &&
            item.capabilities.includes("storage-cabinet"))),
    ),
    bestAssessment = (id: string) =>
      analysis.assessments
        .filter(
          (entry) =>
            entry.zone.ownerObjectId === id &&
            entry.zone.kind === "storage-front",
        )
        .sort(
          (a, b) =>
            Number(b.usable) - Number(a.usable) || b.clearRatio - a.clearRatio,
        )[0],
    evaluated = cabinets
      .map((item) => ({ item, assessment: bestAssessment(item.item.id) }))
      .filter(
        (
          entry,
        ): entry is { item: OperationItem; assessment: OperationAssessment } =>
          Boolean(entry.assessment),
      ),
    blocked = evaluated.filter(
      (entry) =>
        entry.assessment.openingUsable === false ||
        entry.assessment.clearRatio < 0.2,
    ),
    unresolved = cabinets.filter(
      (item) =>
        !item.operationGeometryReliable &&
        !blocked.some((entry) => entry.item.item.id === item.item.id),
    ),
    status: RuleStatus = blocked.length
      ? "issue"
      : unresolved.length
        ? "unable_to_determine"
        : evaluated.length
          ? "pass"
          : "not_applicable",
    diagnostics = [
      ...blocked.map(({ item, assessment }) =>
        diagnostic(
          "error",
          "storage_cabinet_retrieval_area_blocked",
          assessment.openingUsable === false
            ? `${item.item.name ?? "储物柜"}的显式开启范围被实体占用，无法打开`
            : `${item.item.name ?? "储物柜"}前方600毫米取物区域只有${Math.round(assessment.clearRatio * 100)}%可用，已接近完全封堵`,
          [
            item.item.id,
            ...(assessment.openingUsable === false
              ? assessment.openingBlockerIds
              : assessment.blockerIds),
          ],
          "source_data",
          "移动柜前床、家具或设备，恢复基本取物位置。",
        ),
      ),
      ...unresolved.map((item) => {
        const assessment = bestAssessment(item.item.id);
        return diagnostic(
          "warning",
          "storage_cabinet_door_geometry_unavailable",
          `${item.item.name ?? "储物柜"}柜前接近空间${assessment ? `约${Math.round(assessment.clearRatio * 100)}%可用` : "可检查"}，但JSON没有柜门数量、门宽、铰链和开向`,
          [item.item.id],
          "insufficient_information",
          "柜门开启结论保持待核验，不用柜体宽度猜门片。",
        );
      }),
    ];
  return result(
    "G3-042",
    "储物柜具备基本取物条件",
    status,
    blocked.length
      ? `发现 ${blocked.length} 个储物柜前方几乎完全被封堵`
      : unresolved.length
        ? `${unresolved.length} 个储物柜可接近，但柜门开启仍待核验`
        : evaluated.length
          ? `${evaluated.length} 个储物柜具有基本取物位置`
          : "当前没有识别到主要储物柜",
    {
      normalizedObjectIds: blocked.map(({ item }) => item.item.id),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "storageCabinetCount", value: cabinets.length },
        { name: "storageCabinetApproachIssueCount", value: blocked.length },
        { name: "shelfCabinetCount", value: handoff.shelves.length },
        ...analysis.zones.filter((zone) => zone.kind === "storage-front" && zone.maximumOpeningDepthMeters !== undefined).flatMap((zone) => [
          { name: "maximumOpeningDepth", value: zone.maximumOpeningDepthMeters!, unit: "meter", normalizedObjectId: zone.ownerObjectId },
          { name: "minimumOpeningUseClearance", value: zone.minimumUseClearanceMeters!, unit: "meter", normalizedObjectId: zone.ownerObjectId },
        ]),
      ],
      missingData: unresolved.map(
        (item) => `${item.item.id}: 柜门数量、门宽、铰链和开向`,
      ),
      diagnostics,
    },
  );
};

export const ruleG3043: G3Rule = (handoff) => {
  const analysis = operationUseAnalysis(handoff),
    household = analysis.items.filter(
      (item) =>
        item.capabilities.includes("laundry-appliance") ||
        item.capabilities.includes("household-fixture"),
    ),
    inLaundry = household.filter((item) =>
      analysis.laundryRooms.some(
        (room) => room.roomRegionId === item.roomRegionId,
      ),
    ),
    assessments = inLaundry
      .map((item) => assessmentFor(analysis, item.item.id))
      .filter((item): item is OperationAssessment => Boolean(item)),
    severe = assessments.filter(
      (entry) =>
        entry.clearRatio < 0.2 &&
        entry.blockerIds.some((id) =>
          inLaundry.some((item) => item.item.id === id),
        ),
    ),
    status: RuleStatus = severe.length
      ? "issue"
      : inLaundry.length >= 2
        ? "pass"
        : "not_applicable",
    diagnostics = severe.map((entry) =>
      diagnostic(
        "error",
        "household_equipment_complete_function_conflict",
        "一个家务设备完全占用了另一个核心设备的唯一操作位置",
        [entry.zone.ownerObjectId, ...entry.blockerIds],
        "source_data",
        "调整设备位置，使设备可以顺序使用。",
      ),
    );
  return result(
    "G3-043",
    "家务设备之间不存在完全功能冲突",
    status,
    severe.length
      ? `发现 ${severe.length} 处家务设备完全功能冲突`
      : inLaundry.length >= 2
        ? "家务设备操作区虽可部分重叠，但仍可顺序使用"
        : "当前洗衣区域内不足两个可靠家务设备，不执行相互冲突判断",
    {
      normalizedObjectIds: severe.map((entry) => entry.zone.ownerObjectId),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "householdEquipmentCount", value: inLaundry.length },
        { name: "completeHouseholdConflictCount", value: severe.length },
      ],
      diagnostics,
    },
  );
};

/**
 * Checks the full operation envelope explicitly supplied by Pascal against the
 * physical Slab-derived building boundary. This is deliberately independent
 * of Room/Zone matching: a valid-looking Room association must not hide an
 * operation or opening area that extends outdoors.
 */
export const ruleG3044: G3Rule = (handoff) => {
  const analysis = operationUseAnalysis(handoff);
  const itemsById = new Map(analysis.items.map((item) => [item.item.id, item]));
  const envelopes = new Map(
    buildBuildingEnvelopes(handoff).map((envelope) => [envelope.levelId, envelope]),
  );
  const explicitZones = analysis.zones.filter(
    (zone) =>
      zone.geometryReliable &&
      zone.openingPolygon &&
      zone.openedUsePolygon &&
      zone.maximumOpeningDepthMeters !== undefined &&
      zone.minimumUseClearanceMeters !== undefined,
  );
  const checked = explicitZones.map((zone) => {
    const envelope = zone.levelId ? envelopes.get(zone.levelId) : undefined;
    const fullArea = polygonArea(zone.polygon);
    const outsideArea = envelope ? outsideFootprintArea(zone.polygon, envelope) : null;
    return {
      zone,
      item: itemsById.get(zone.ownerObjectId),
      envelope,
      fullArea,
      outsideArea,
      outsideRatio:
        outsideArea !== null && fullArea > T.areaSquareMeters
          ? Math.min(1, outsideArea / fullArea)
          : null,
    };
  });
  // A single object can legitimately expose multiple directions. Keep its
  // strongest overrun as the one actionable finding, while preserving every
  // direction in measurements and diagnostics.
  const mostSevereByOwner = new Map<string, (typeof checked)[number]>();
  for (const entry of checked) {
    const prior = mostSevereByOwner.get(entry.zone.ownerObjectId);
    if (
      !prior ||
      (entry.outsideArea ?? -1) > (prior.outsideArea ?? -1)
    )
      mostSevereByOwner.set(entry.zone.ownerObjectId, entry);
  }
  const strongest = [...mostSevereByOwner.values()];
  const issues = strongest.filter(
    (entry) =>
      entry.outsideArea !== null &&
      entry.outsideArea > T.operationZoneOutsideAreaSquareMeters,
  );
  const unresolved = strongest.filter(
    (entry) =>
      entry.outsideArea === null || !entry.envelope?.usableForEvaluation,
  );
  const inside = strongest.filter(
    (entry) =>
      entry.outsideArea !== null &&
      entry.outsideArea <= T.operationZoneOutsideAreaSquareMeters,
  );
  const diagnostics = [
    ...issues.map((entry) => {
      const name = entry.item?.item.name ?? "对象";
      return diagnostic(
        "error",
        "explicit_operation_zone_outside_building_envelope",
        `${name}的完整开启与操作区有${entry.outsideArea!.toFixed(2)}平方米越出有效建筑范围`,
        [entry.zone.ownerObjectId],
        "source_data",
        "调整对象位置、朝向、openingDirections、maxOpeningDepth或minOpeningUseClearance，使完整操作区回到建筑范围内。",
        {
          actualValue: entry.outsideArea,
          expectedValue: `<= ${T.operationZoneOutsideAreaSquareMeters} m²`,
        },
      );
    }),
    ...unresolved.map((entry) =>
      diagnostic(
        "warning",
        "explicit_operation_zone_building_boundary_unresolved",
        `${entry.item?.item.name ?? "对象"}有明确开启与操作参数，但所属楼层缺少可靠Slab建筑范围，无法判断是否越界`,
        [entry.zone.ownerObjectId],
        "insufficient_information",
        "补充或修复该楼层的可见 Floor/Slab 轮廓后重新检查。",
      ),
    ),
  ];
  const status: RuleStatus = issues.length
    ? "issue"
    : unresolved.length
      ? "unable_to_determine"
      : strongest.length
        ? "pass"
        : "not_applicable";
  const reportedIds = [...issues, ...unresolved].map(
    (entry) => entry.zone.ownerObjectId,
  );
  return result(
    "G3-044",
    "已声明的开启与操作区不得超出有效建筑范围",
    status,
    issues.length
      ? `发现 ${issues.length} 个对象的完整开启与操作区越出建筑范围`
      : unresolved.length
        ? `${unresolved.length} 个对象因建筑范围不足暂时无法核验`
        : strongest.length
          ? `${strongest.length} 个对象的显式开启与操作区均在有效建筑范围内`
          : "当前没有带显式开启与操作参数的对象",
    {
      normalizedObjectIds: reportedIds,
      pascalSourceIds: sourceIds(analysis.items, reportedIds),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "explicitOperationZoneCount", value: explicitZones.length },
        { name: "operationOwnerCount", value: strongest.length },
        { name: "operationZoneOutsideBuildingCount", value: issues.length },
        ...[...issues, ...unresolved].map((entry) => ({
          name: "operationZoneOutsideBuildingArea",
          value: entry.outsideArea,
          unit: "square_meter",
          normalizedObjectId: entry.zone.ownerObjectId,
        })),
        ...[...issues, ...unresolved].map((entry) => ({
          name: "operationZoneOutsideBuildingRatio",
          value: entry.outsideRatio,
          normalizedObjectId: entry.zone.ownerObjectId,
        })),
        ...[...issues, ...unresolved].map((entry) => ({
          name: "buildingBoundarySourceObjectCount",
          value: entry.envelope?.sourceObjectIds.length ?? null,
          normalizedObjectId: entry.zone.ownerObjectId,
        })),
      ],
      thresholds: [
        {
          name: "operationZoneOutsideAreaTolerance",
          value: T.operationZoneOutsideAreaSquareMeters,
          unit: "square_meter",
        },
      ],
      missingData: unresolved.map(
        (entry) => `${entry.zone.ownerObjectId}: 可靠 Floor/Slab 建筑范围`,
      ),
      confidence: {
        level: unresolved.length ? "low" : "high",
        score: unresolved.length ? 0.4 : 0.9,
        reasons: [
          "开启方向、开启深度和最小使用空间直接来自Pascal JSON",
          "建筑范围仅由可见Slab并集推导，不以Zone替代",
        ],
      },
      diagnostics,
    },
  );
};

export const FINAL_G3_RULES: G3Rule[] = [
  ruleG3009,
  ruleG3010,
  ruleG3011,
  ruleG3012,
  ruleG3039,
  ruleG3040,
  ruleG3041,
  ruleG3042,
  ruleG3043,
  ruleG3044,
];
