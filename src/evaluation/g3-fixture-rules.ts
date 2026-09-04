import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { intersectionArea } from "./door-operations";
import {
  buildFixtureUseAnalysis,
  type FixtureSemantic,
  type FixtureSemanticItem,
  type FixtureUseAnalysis,
  type FixtureUseAssessment,
} from "./fixture-use";
import { buildOperationUseAnalysis } from "./operation-use";
import { hasFunctionTag } from "./object-semantics";
import { G1_GEOMETRY_TOLERANCES as T } from "./tolerances";
import type { G3Rule, RuleDiagnostic, RuleResult, RuleStatus } from "./types";

const cache = new WeakMap<object, FixtureUseAnalysis>();
export const fixtureUseAnalysis = (handoff: EvaluationHandoff) => {
  const prior = cache.get(handoff);
  if (prior) return prior;
  const value = buildFixtureUseAnalysis(handoff);
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
    {
      name: "fixtureStandingDepth",
      value: T.fixtureStandingDepthMeters,
      unit: "meter",
    },
    { name: "fixtureUseZoneClearRatio", value: T.furnitureUseZoneClearRatio },
    { name: "bathEntryDepth", value: T.bathEntryDepthMeters, unit: "meter" },
  ],
  missingData: [],
  confidence: {
    level: status === "unable_to_determine" ? "low" : "medium",
    score: status === "unable_to_determine" ? 0.4 : 0.75,
    reasons: ["V0.1只判断基本使用，不评价规范净空、无障碍或舒适度"],
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
const itemsIn = (
  analysis: FixtureUseAnalysis,
  roomId: string,
  semantics?: FixtureSemantic[],
) =>
  analysis.items.filter(
    (item) =>
      item.roomRegionId === roomId &&
      (!semantics || semantics.includes(item.semantic)),
  );
const assessmentFor = (analysis: FixtureUseAnalysis, itemId: string) =>
  analysis.assessments.find(
    (assessment) => assessment.zone.ownerObjectId === itemId,
  );
const sourceIds = (items: FixtureSemanticItem[], ids: string[]) => [
  ...new Set(
    ids.map(
      (id) => items.find((item) => item.item.id === id)?.item.rawPascalId ?? id,
    ),
  ),
];
const roomLabel = (room: FixtureUseAnalysis["kitchenRooms"][number]) =>
  room.zoneNames.join(" / ") || room.roomRegionId;
const KITCHEN_PER_ROOM_CORE_SEMANTICS = ["sink", "stove"] as const;

export type KitchenCoreConfiguration = {
  missingPerKitchen: Array<{
    room: FixtureUseAnalysis["kitchenRooms"][number];
    semantic: (typeof KITCHEN_PER_ROOM_CORE_SEMANTICS)[number];
  }>;
  sharedRefrigeratorCount: number;
};

/**
 * G3-025 verifies a minimal dwelling-wide kitchen inventory. A refrigerator
 * may serve more than one kitchen; water and cooking must exist in each
 * individual kitchen. This deliberately does not infer convenience, work
 * triangle quality, or appliance access.
 */
export const kitchenCoreConfiguration = (
  analysis: Pick<FixtureUseAnalysis, "kitchenRooms" | "items">,
): KitchenCoreConfiguration => ({
  missingPerKitchen: analysis.kitchenRooms.flatMap((room) =>
    KITCHEN_PER_ROOM_CORE_SEMANTICS.filter(
      (semantic) => !itemsIn(analysis as FixtureUseAnalysis, room.roomRegionId, [semantic]).length,
    ).map((semantic) => ({ room, semantic })),
  ),
  sharedRefrigeratorCount: analysis.items.filter(
    (item) => item.roomKind === "kitchen" && item.semantic === "refrigerator",
  ).length,
});
const centerDistance = (a: FixtureSemanticItem, b: FixtureSemanticItem) =>
  a.item.resolvedWorldPosition && b.item.resolvedWorldPosition
    ? Math.hypot(
        a.item.resolvedWorldPosition[0] - b.item.resolvedWorldPosition[0],
        a.item.resolvedWorldPosition[1] - b.item.resolvedWorldPosition[1],
      )
    : Infinity;
const fixtureDiagnostics = (
  entries: Array<{
    item: FixtureSemanticItem;
    assessment?: FixtureUseAssessment;
  }>,
  code: string,
  label: string,
) =>
  entries.map(({ item, assessment }) =>
    diagnostic(
      "error",
      code,
      `${item.item.name ?? label}前方的600毫米基本使用区只有 ${Math.round((assessment?.clearRatio ?? 0) * 100)}% 可用${assessment?.reachableFromRoomEntry ? "" : "，且未能从房间入口到达"}`,
      [
        item.item.id,
        ...(assessment?.blockerIds ?? []),
        ...(item.roomRegionId ? [item.roomRegionId] : []),
      ],
      "source_data",
      `移动前方阻挡对象或调整${label}位置，恢复基本站立和进入空间。`,
      {
        actualValue: assessment?.clearRatio ?? null,
        expectedValue: `>= ${T.furnitureUseZoneClearRatio}`,
      },
    ),
  );

export const ruleG3025: G3Rule = (handoff) => {
  const analysis = fixtureUseAnalysis(handoff), configuration = kitchenCoreConfiguration(analysis), missing = configuration.missingPerKitchen,
    refrigeratorMissing = analysis.kitchenRooms.length > 0 && configuration.sharedRefrigeratorCount === 0,
    status: RuleStatus = !analysis.kitchenRooms.length
      ? "not_applicable"
      : missing.length || refrigeratorMissing
        ? "unable_to_determine"
        : "pass",
    focusIdsFor = (room: FixtureUseAnalysis["kitchenRooms"][number]) => {
      const kitchenZoneIds = room.zoneIds.filter((zoneId) => {
        const code = handoff.zones.find((zone) => zone.id === zoneId)?.spaceFunctionCode;
        return code === "SF01" || code === "SF02";
      });
      return kitchenZoneIds.length ? kitchenZoneIds : [room.roomRegionId];
    },
    relatedObjectIdsFor = (room: FixtureUseAnalysis["kitchenRooms"][number]) =>
      itemsIn(analysis, room.roomRegionId, ["sink", "stove", "refrigerator", "counter", "base-cabinet", "island"]).map((item) => item.item.id),
    diagnostics = [
      ...missing.flatMap(({ room, semantic }) =>
        focusIdsFor(room).map((focusId) =>
          diagnostic(
            "warning",
            "kitchen_required_fixture_missing",
            `${roomLabel(room)}: 未能可靠识别${semantic === "sink" ? "水槽" : "灶具"}，无法确认该厨房的基本配置。`,
            [focusId, ...relatedObjectIdsFor(room)],
            "insufficient_information",
            "核对该厨房内设备的functionTags和空间归属。",
          ),
        ),
      ),
      ...(refrigeratorMissing
        ? analysis.kitchenRooms.flatMap((room) =>
            focusIdsFor(room).map((focusId) =>
              diagnostic(
                "warning",
                "shared_kitchen_refrigerator_missing",
                "住宅全部厨房中未能可靠识别至少一台冰箱，无法确认共享冰箱配置。",
                [focusId, ...relatedObjectIdsFor(room)],
                "insufficient_information",
                "核对任一厨房内冰箱的functionTags和空间归属。",
              ),
            ),
          )
        : []),
    ];
  return result(
    "G3-025",
    "厨房核心设备配置完整",
    status,
    status === "unable_to_determine"
      ? `${missing.length + (refrigeratorMissing ? 1 : 0)} 项厨房核心设备语义缺失，无法完整核验配置`
      : `${analysis.kitchenRooms.length} 个厨房均有水槽和灶具，住宅厨房共识别到 ${configuration.sharedRefrigeratorCount} 台可共享冰箱`,
    {
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "kitchenRoomCount", value: analysis.kitchenRooms.length },
        { name: "kitchenWithSinkCount", value: analysis.kitchenRooms.length - missing.filter((item) => item.semantic === "sink").length },
        { name: "kitchenWithStoveCount", value: analysis.kitchenRooms.length - missing.filter((item) => item.semantic === "stove").length },
        { name: "sharedKitchenRefrigeratorCount", value: configuration.sharedRefrigeratorCount },
        { name: "missingKitchenCoreCount", value: missing.length + (refrigeratorMissing ? 1 : 0) },
      ],
      thresholds: [],
      missingData: [
        ...missing.map(({ room, semantic }) => `${roomLabel(room)}: ${semantic === "sink" ? "水槽" : "灶具"}`),
        ...(refrigeratorMissing ? ["住宅厨房：至少一台冰箱"] : []),
      ],
      diagnostics,
      confidence: {
        level: status === "unable_to_determine" ? "low" : "high",
        score: status === "unable_to_determine" ? 0.4 : 1,
        reasons: ["每个厨房独立检查水槽和灶具；冰箱按住宅厨房集合计数，可由多个厨房共用", "不评价冰箱共享的便利性、设备前方操作空间或工作三角"],
      },
    },
  );
};

export const ruleG3026: G3Rule = (handoff) => {
  const analysis = fixtureUseAnalysis(handoff),
    core = analysis.items.filter(
      (item) =>
        item.roomKind === "kitchen" &&
        ["sink", "stove", "refrigerator"].includes(item.semantic),
    ),
    evaluated = core
      .map((item) => ({
        item,
        assessment: assessmentFor(analysis, item.item.id),
      }))
      .filter(
        (
          entry,
        ): entry is {
          item: FixtureSemanticItem;
          assessment: FixtureUseAssessment;
        } => Boolean(entry.assessment),
      ),
    issues = evaluated.filter((entry) => !entry.assessment.usable),
    unresolved = core.filter(
      (item) =>
        item.semanticConfidence === "low" ||
        !evaluated.some((entry) => entry.item.item.id === item.item.id),
    ),
    status: RuleStatus = issues.length
      ? "issue"
      : unresolved.length
        ? "unable_to_determine"
        : evaluated.length
          ? "pass"
          : "not_applicable",
    diagnostics = [
      ...fixtureDiagnostics(
        issues,
        "kitchen_core_fixture_inaccessible",
        "厨房设备",
      ),
      ...unresolved.map((item) =>
        diagnostic(
          "warning",
          "kitchen_core_fixture_geometry_unavailable",
          `${item.item.name ?? "厨房设备"}缺少可靠位置、尺寸、朝向或Room归属`,
          [item.item.id],
          "insufficient_information",
          "补充可靠设备几何和语义。",
        ),
      ),
    ];
  return result(
    "G3-026",
    "厨房核心设备能够正常接近",
    status,
    issues.length
      ? `发现 ${issues.length} 个厨房核心设备前没有可用站立位置或无法从入口到达`
      : unresolved.length
        ? `${unresolved.length} 个厨房核心设备无法判断`
        : `${evaluated.length} 个水槽、灶具或冰箱具有基本接近空间`,
    {
      normalizedObjectIds: issues.map((entry) => entry.item.item.id),
      pascalSourceIds: sourceIds(
        core,
        issues.map((entry) => entry.item.item.id),
      ),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "kitchenCoreFixtureCount", value: core.length },
        { name: "inaccessibleKitchenCoreCount", value: issues.length },
      ],
      missingData: unresolved.map(
        (item) => `${item.item.id}: 可靠设备几何或Room归属`,
      ),
      diagnostics,
    },
  );
};

export const ruleG3027: G3Rule = (handoff) => {
  const analysis = fixtureUseAnalysis(handoff),
    counters = analysis.items.filter(
      (item) =>
        item.roomKind === "kitchen" &&
        ["counter", "base-cabinet", "island"].includes(item.semantic),
    ),
    cores = analysis.items.filter(
      (item) =>
        item.roomKind === "kitchen" &&
        ["sink", "stove"].includes(item.semantic),
    ),
    unresolvedRooms = analysis.kitchenRooms.filter(
      (room) =>
        !itemsIn(analysis, room.roomRegionId, [
          "counter",
          "base-cabinet",
          "island",
        ]).length ||
        !itemsIn(analysis, room.roomRegionId, ["sink", "stove"]).length,
    ),
    bad = cores.filter(
      (core) =>
        !counters.some(
          (counter) =>
            counter.roomRegionId === core.roomRegionId &&
            centerDistance(core, counter) <= T.kitchenCounterRelationMeters,
        ),
    ),
    status: RuleStatus = bad.length
      ? "issue"
      : unresolvedRooms.length
        ? "unable_to_determine"
        : cores.length
          ? "pass"
          : "not_applicable",
    diagnostics = [
      ...bad.map((item) =>
        diagnostic(
          "error",
          "kitchen_counter_unavailable_near_core",
          `${item.item.name ?? "核心设备"}附近没有识别到基本操作台面`,
          [item.item.id, ...(item.roomRegionId ? [item.roomRegionId] : [])],
          "source_data",
          "在水槽或灶具附近补充可识别的Counter或Cabinet台面。",
          {
            expectedValue: `可靠台面中心距离 <= ${T.kitchenCounterRelationMeters}m`,
          },
        ),
      ),
      ...unresolvedRooms.map((room) =>
        diagnostic(
          "warning",
          "kitchen_counter_semantics_incomplete",
          `${roomLabel(room)}缺少可靠台面或水槽/灶具语义`,
          [room.roomRegionId],
          "insufficient_information",
          "核对Counter、Cabinet、水槽和灶具category。",
        ),
      ),
    ];
  return result(
    "G3-027",
    "厨房具有基本可用操作台面",
    status,
    bad.length
      ? `发现 ${bad.length} 个水槽或灶具附近没有可用操作台面`
      : unresolvedRooms.length
        ? `${unresolvedRooms.length} 个厨房缺少可靠台面或核心设备语义`
        : `${cores.length} 个水槽或灶具附近存在基本可用台面`,
    {
      normalizedObjectIds: bad.map((item) => item.item.id),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "counterLikeObjectCount", value: counters.length },
        { name: "coreWithoutNearbyCounterCount", value: bad.length },
      ],
      thresholds: [
        ...result("", "", "pass", "").thresholds,
        {
          name: "kitchenCounterRelation",
          value: T.kitchenCounterRelationMeters,
          unit: "meter",
        },
      ],
      missingData: unresolvedRooms.map(
        (room) => `${room.roomRegionId}: Counter/Cabinet台面或核心设备语义`,
      ),
      diagnostics,
    },
  );
};

export const ruleG3028: G3Rule = (handoff) => {
  const analysis = fixtureUseAnalysis(handoff),
    issues = analysis.kitchenRooms.filter(
      (room) =>
        room.portalNodes.length &&
        !room.furnishedConnected &&
        room.fixedObstacleIds.some((id) =>
          itemsIn(analysis, room.roomRegionId, [
            "counter",
            "base-cabinet",
            "island",
            "tall-cabinet",
          ]).some((item) => item.item.id === id),
        ),
    ),
    unresolved = analysis.kitchenRooms.filter(
      (room) => !room.portalNodes.length || !room.usableForEvaluation,
    ),
    status: RuleStatus = issues.length
      ? "issue"
      : unresolved.length
        ? "unable_to_determine"
        : analysis.kitchenRooms.length
          ? "pass"
          : "not_applicable",
    diagnostics = [
      ...issues.map((room) =>
        diagnostic(
          "error",
          "kitchen_aisle_not_connected",
          `${roomLabel(room)}的对向固定操作面之间未形成400毫米基本连续通行空间`,
          [room.roomRegionId, ...room.fixedBlockerIds],
          "source_data",
          "调整橱柜、岛台或半岛位置，恢复基本通行。",
        ),
      ),
      ...unresolved.map((room) =>
        diagnostic(
          "warning",
          "kitchen_aisle_geometry_unavailable",
          `${roomLabel(room)}缺少可靠入口或自由空间`,
          [room.roomRegionId],
          "insufficient_information",
          "检查Room、Door Portal和固定柜体占地。",
        ),
      ),
    ];
  return result(
    "G3-028",
    "对向橱柜、岛台之间可以基本通行",
    status,
    issues.length
      ? `发现 ${issues.length} 个厨房的固定操作面之间无法基本通行`
      : unresolved.length
        ? `${unresolved.length} 个厨房无法判断对向操作区通行`
        : `${analysis.kitchenRooms.length} 个厨房保留400毫米基本通行空间`,
    {
      normalizedObjectIds: issues.map((room) => room.roomRegionId),
      details: diagnostics.map((item) => item.message),
      measurements: [{ name: "kitchenAisleIssueCount", value: issues.length }],
      missingData: unresolved.map(
        (room) => `${room.roomRegionId}: 可靠入口或自由空间`,
      ),
      diagnostics,
    },
  );
};

export const ruleG3029: G3Rule = (handoff) => {
  const analysis = fixtureUseAnalysis(handoff),
    operation = buildOperationUseAnalysis(handoff),
    operationById = new Map(
      operation.items.map((item) => [item.item.id, item]),
    ),
    appliances = analysis.items.filter(
      (item) =>
        item.roomKind === "kitchen" &&
        hasFunctionTag(
          item.item,
          "refrigerators",
          "refrigerator",
          "fridges",
          "dishwashers",
          "dishwasher",
          "ovens",
          "oven",
          "stoves",
          "stove",
          "cooktops",
        ) &&
        operationById.get(item.item.id)?.explicitlyOpenable,
    ),
    assessmentById = new Map(
      operation.assessments
        .filter((item) => item.zone.kind === "appliance-front")
        .map((item) => [item.zone.ownerObjectId, item]),
    );
  const missing = appliances.filter(
      (item) => !operationById.get(item.item.id)?.operationGeometryReliable,
    ),
    unresolved = appliances.filter(
      (item) =>
        operationById.get(item.item.id)?.operationGeometryReliable &&
        !assessmentById.has(item.item.id),
    ),
    issues = appliances.filter(
      (item) =>
        operationById.get(item.item.id)?.operationGeometryReliable &&
        assessmentById.has(item.item.id) &&
        !assessmentById.get(item.item.id)!.usable,
    ),
    status: RuleStatus = issues.length
      ? "issue"
      : missing.length || unresolved.length
        ? "unable_to_determine"
        : appliances.length
          ? "pass"
          : "not_applicable";
  const diagnostics = [
    ...missing.map((item) =>
      diagnostic(
        "warning",
        "appliance_door_geometry_unavailable",
        `${item.item.name ?? "厨房设备"}声明为可开启，但无法建立开启与使用空间`,
        [item.item.id],
        "insufficient_information",
        "核对openingDirections、maxOpeningDepth和minOpeningUseClearance。",
      ),
    ),
    ...unresolved.map((item) =>
      diagnostic(
        "warning",
        "appliance_door_operation_zone_unresolved",
        `${item.item.name ?? "厨房设备"}已有门扇数据，但缺少可靠Room归属或操作区几何`,
        [item.item.id],
        "insufficient_information",
        "检查设备位置、尺寸、朝向和Kitchen Room归属。",
      ),
    ),
    ...issues.map((item) => {
      const assessment = assessmentById.get(item.item.id)!;
      return diagnostic(
        "error",
        assessment.openingUsable === false
          ? "appliance_door_sweep_blocked"
          : "appliance_post_opening_use_blocked",
        assessment.openingUsable === false
          ? `${item.item.name ?? "厨房设备"}的显式开门范围被实体占用，设备门无法打开`
          : `${item.item.name ?? "厨房设备"}开门后的人员操作区被阻挡或无法从入口到达`,
        [
          item.item.id,
          ...(assessment.openingUsable === false
            ? assessment.openingBlockerIds
            : assessment.openedUseBlockerIds),
        ],
        "source_data",
        "移动设备门前障碍或调整设备朝向，恢复可达的开启操作区。",
        {
          actualValue:
            assessment.openingUsable === false
              ? assessment.openingBlockedAreaSquareMeters
              : assessment.openedUseClearRatio,
          expectedValue:
            assessment.openingUsable === false
              ? `<= ${T.overlapAreaSquareMeters} m² opening collision`
              : `>= ${T.furnitureUseZoneClearRatio}`,
        },
      );
    }),
  ];
  return result(
    "G3-029",
    "厨房设备门能够完成基本开启和操作",
    status,
    status === "pass"
      ? `${appliances.length} 个厨房设备具有明确且可用的开启与使用空间`
      : issues.length
        ? `${issues.length} 个厨房设备完全开启后的使用区被阻挡或不可达`
        : missing.length || unresolved.length
          ? `${missing.length + unresolved.length} 个带门厨房设备缺少可评价的操作空间`
          : "当前没有声明为可开启的厨房设备",
    {
      normalizedObjectIds: [...issues, ...missing, ...unresolved].map(
        (item) => item.item.id,
      ),
      pascalSourceIds: sourceIds(
        appliances,
        [...issues, ...missing, ...unresolved].map((item) => item.item.id),
      ),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "applianceDoorCandidateCount", value: appliances.length },
        {
          name: "applianceDoorGeometryCount",
          value: appliances.length - missing.length,
        },
        {
          name: "applianceDoorUsableCount",
          value:
            appliances.length -
            missing.length -
            unresolved.length -
            issues.length,
        },
        ...operation.zones.filter((zone) => zone.kind === "appliance-front" && appliances.some((appliance) => appliance.item.id === zone.ownerObjectId)).flatMap((zone) => [
          { name: "maximumOpeningDepth", value: zone.maximumOpeningDepthMeters ?? null, unit: "meter", normalizedObjectId: zone.ownerObjectId },
          { name: "minimumOpeningUseClearance", value: zone.minimumUseClearanceMeters ?? null, unit: "meter", normalizedObjectId: zone.ownerObjectId },
        ]),
      ],
      missingData: [
        ...missing.map(
          (item) =>
            `${item.item.id}: openingDirections、maxOpeningDepth或minOpeningUseClearance`,
        ),
        ...unresolved.map(
          (item) => `${item.item.id}: 可靠Room归属或设备操作区`,
        ),
      ],
      diagnostics,
    },
  );
};

export const ruleG3030: G3Rule = (handoff) => {
  const analysis = fixtureUseAnalysis(handoff),
    duplicate = analysis.kitchenRooms.filter(
      (room) => room.portalNodes.length && !room.furnishedConnected,
    ),
    unresolved = analysis.kitchenRooms.filter(
      (room) => !room.portalNodes.length || !room.usableForEvaluation,
    ),
    status: RuleStatus = duplicate.length
      ? "not_applicable"
      : unresolved.length
        ? "unable_to_determine"
        : analysis.kitchenRooms.length
          ? "pass"
          : "not_applicable",
    diagnostics = [
      ...duplicate.map((room) =>
        diagnostic(
          "info",
          "kitchen_entry_reported_by_foundation",
          `${roomLabel(room)}的入口或房内通行问题已由G3-002/G3-003/G3-006报告`,
          [
            room.roomRegionId,
            ...room.fixedBlockerIds,
            ...room.largeFurnitureBlockerIds,
          ],
          "rule",
          "处理基础通行规则中的同一根因。",
        ),
      ),
      ...unresolved.map((room) =>
        diagnostic(
          "warning",
          "kitchen_entry_unresolved",
          `${roomLabel(room)}缺少可靠Door Portal或自由空间`,
          [room.roomRegionId],
          "insufficient_information",
          "检查厨房入口门和Room边界。",
        ),
      ),
    ];
  return result(
    "G3-030",
    "厨房入口能够正常进出",
    status,
    duplicate.length
      ? "厨房入口问题已由基础通行规则统一报告"
      : unresolved.length
        ? `${unresolved.length} 个厨房入口无法判断`
        : `${analysis.kitchenRooms.length} 个厨房入口可进入房内自由空间`,
    {
      details: diagnostics.map((item) => item.message),
      measurements: [
        {
          name: "kitchenEntryUsableCount",
          value:
            analysis.kitchenRooms.length - duplicate.length - unresolved.length,
        },
      ],
      missingData: unresolved.map(
        (room) => `${room.roomRegionId}: Door Portal或自由空间`,
      ),
      diagnostics,
    },
  );
};

const graphReachableWithout = (
  analysis: FixtureUseAnalysis,
  start: string,
  blockedRoom: string,
) => {
  const adjacency = new Map<string, string[]>();
  for (const edge of analysis.navigation.graph.edges) {
    if (edge.fromNodeId === blockedRoom || edge.toNodeId === blockedRoom)
      continue;
    adjacency.set(edge.fromNodeId, [
      ...(adjacency.get(edge.fromNodeId) ?? []),
      edge.toNodeId,
    ]);
    adjacency.set(edge.toNodeId, [
      ...(adjacency.get(edge.toNodeId) ?? []),
      edge.fromNodeId,
    ]);
  }
  const seen = new Set([start]),
    queue = [start];
  while (queue.length)
    for (const next of adjacency.get(queue.shift()!) ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  return seen;
};
export const ruleG3031: G3Rule = (handoff) => {
  const analysis = fixtureUseAnalysis(handoff),
    issues: typeof analysis.kitchenRooms = [],
    unresolved: typeof analysis.kitchenRooms = [];
  for (const room of analysis.kitchenRooms) {
    if (room.zoneNames.some((name) => /LIVING|DINING|客厅|餐厅/i.test(name)))
      continue;
    const neighbors = analysis.navigation.graph.edges
      .flatMap((edge) =>
        edge.fromNodeId === room.roomRegionId
          ? [edge.toNodeId]
          : edge.toNodeId === room.roomRegionId
            ? [edge.fromNodeId]
            : [],
      )
      .filter((id) => id !== "exterior");
    if (neighbors.length < 2) continue;
    const reached = graphReachableWithout(
        analysis,
        neighbors[0]!,
        room.roomRegionId,
      ),
      uniqueThroughKitchen = neighbors.slice(1).some((id) => !reached.has(id));
    if (!uniqueThroughKitchen) continue;
    const coreZones = analysis.useZones.filter(
      (zone) =>
        zone.roomRegionId === room.roomRegionId &&
        zone.kind === "kitchen-standing",
    );
    if (!coreZones.length || !room.paths.length) unresolved.push(room);
    else if (
      room.paths.some((path) =>
        path.points.some((point) =>
          coreZones.some((zone) => {
            let inside = false;
            for (
              let i = 0, j = zone.polygon.length - 1;
              i < zone.polygon.length;
              j = i++
            ) {
              const a = zone.polygon[i]!,
                b = zone.polygon[j]!;
              if (
                a[1] > point[1] !== b[1] > point[1] &&
                point[0] <
                  ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
              )
                inside = !inside;
            }
            return inside;
          }),
        ),
      )
    )
      issues.push(room);
  }
  const status: RuleStatus = issues.length
      ? "issue"
      : unresolved.length
        ? "unable_to_determine"
        : analysis.kitchenRooms.length
          ? "pass"
          : "not_applicable",
    diagnostics = [
      ...issues.map((room) =>
        diagnostic(
          "error",
          "kitchen_core_is_unique_through_route",
          `${roomLabel(room)}是连接其他主要空间的唯一拓扑通道，且路径穿过水槽或灶具前操作区`,
          [
            room.roomRegionId,
            ...itemsIn(analysis, room.roomRegionId, ["sink", "stove"]).map(
              (item) => item.item.id,
            ),
          ],
          "rule",
          "调整空间连接或核心设备位置，使日常穿行不必经过核心操作位。",
        ),
      ),
      ...unresolved.map((room) =>
        diagnostic(
          "warning",
          "kitchen_unique_route_geometry_unresolved",
          `${roomLabel(room)}可能承担唯一穿行关系，但缺少可靠核心使用区或房内路径`,
          [room.roomRegionId],
          "insufficient_information",
          "核对厨房核心设备朝向和Room路径。",
        ),
      ),
    ];
  return result(
    "G3-031",
    "厨房核心工作区不得成为通往其他主要空间的唯一通道",
    status,
    issues.length
      ? `发现 ${issues.length} 个厨房核心工作区位于唯一通行路径上`
      : unresolved.length
        ? `${unresolved.length} 个厨房的唯一通道关系无法完整判断`
        : "未发现必须穿过厨房核心工作区的唯一主要通道",
    {
      normalizedObjectIds: issues.map((room) => room.roomRegionId),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "kitchenUniqueCoreRouteCount", value: issues.length },
      ],
      missingData: unresolved.map(
        (room) => `${room.roomRegionId}: 核心使用区或房内路径`,
      ),
      diagnostics,
    },
  );
};

export const ruleG3032: G3Rule = (handoff) => {
  const analysis = fixtureUseAnalysis(handoff),
    candidates = analysis.items.filter(
      (item) =>
        item.roomKind === "kitchen" &&
        (item.semantic === "tall-cabinet" ||
          hasFunctionTag(
            item.item,
            "refrigerators",
            "refrigerator",
            "fridges",
            "dishwashers",
            "dishwasher",
            "ovens",
            "oven",
          )),
    ),
    tallCabinets = candidates.filter(
      (item) => item.semantic === "tall-cabinet",
    ),
    cabinets = analysis.items.filter(
      (item) =>
        item.roomKind === "kitchen" &&
        ["base-cabinet", "tall-cabinet", "island"].includes(item.semantic),
    ),
    collisions = candidates.flatMap((item) =>
      cabinets
        .filter(
          (cabinet) =>
            cabinet.item.id !== item.item.id &&
            cabinet.roomRegionId === item.roomRegionId &&
            item.footprint &&
            cabinet.footprint &&
            (intersectionArea(item.footprint, cabinet.footprint) ?? 0) >
              T.physicalCollisionAreaSquareMeters,
        )
        .map((cabinet) => ({ item, cabinet })),
    ),
    status: RuleStatus = collisions.length
      ? "issue"
      : tallCabinets.length
        ? "unable_to_determine"
        : "not_applicable",
    diagnostics = [
      ...collisions.map(({ item, cabinet }) =>
        diagnostic(
          "error",
          "kitchen_tall_unit_physical_deadlock",
          `${item.item.name ?? "设备"}与${cabinet.item.name ?? "柜体"}实体占地重叠，至少一个对象可能无法正常使用`,
          [item.item.id, cabinet.item.id],
          "source_data",
          "调整设备或高柜位置，消除实体重叠。",
        ),
      ),
      ...(!collisions.length && tallCabinets.length
        ? tallCabinets.map((item) =>
            diagnostic(
              "warning",
              "kitchen_tall_unit_opening_unavailable",
              `${item.item.name ?? "高柜"}没有可靠开启区，不能排除与设备形成使用死角`,
              [item.item.id],
              "insufficient_information",
              "补充高柜门扇开向和尺寸。",
            ),
          )
        : !collisions.length && candidates.length
          ? [
              diagnostic(
                "info",
                "appliance_opening_uncertainty_reported_by_g3029",
                "设备门扇数据不足已由G3-029统一说明；当前没有可靠高柜或实体碰撞，本规则不重复生成待核验卡片",
                candidates.map((item) => item.item.id),
                "rule",
                "查看G3-029中的设备门数据说明。",
              ),
            ]
          : []),
    ];
  return result(
    "G3-032",
    "高柜和设备之间不存在完全无法使用的死角",
    status,
    collisions.length
      ? `发现 ${collisions.length} 组高柜或设备实体重叠`
      : tallCabinets.length
        ? `${tallCabinets.length} 个高柜缺少开启几何，无法排除完全死角`
        : candidates.length
          ? "设备开门数据不足已由G3-029说明；未识别到可靠高柜或实体重叠"
          : "当前没有可检查的高柜或带门设备",
    {
      normalizedObjectIds: collisions.map(({ item }) => item.item.id),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "kitchenTallUnitCandidateCount", value: candidates.length },
        { name: "reliableTallCabinetCount", value: tallCabinets.length },
        { name: "kitchenTallUnitCollisionCount", value: collisions.length },
      ],
      missingData: !collisions.length
        ? tallCabinets.map((item) => `${item.item.id}: 门扇开向和尺寸`)
        : [],
      diagnostics,
    },
  );
};

export const ruleG3033: G3Rule = (handoff) => {
  const analysis = fixtureUseAnalysis(handoff),
    issues = analysis.bathroomRooms.filter(
      (room) =>
        room.portalNodes.length &&
        (!room.furnishedConnected ||
          !room.portalNodes.some((portal) => portal.furnishedLanding)),
    ),
    unresolved = analysis.bathroomRooms.filter(
      (room) => !room.portalNodes.length || !room.usableForEvaluation,
    ),
    status: RuleStatus = issues.length
      ? "issue"
      : unresolved.length
        ? "unable_to_determine"
        : analysis.bathroomRooms.length
          ? "pass"
          : "not_applicable",
    diagnostics = [
      ...issues.map((room) =>
        diagnostic(
          "error",
          "bathroom_entry_or_exit_blocked",
          `${roomLabel(room)}进入后没有连续基本站立和退出空间`,
          [
            room.roomRegionId,
            ...room.fixedBlockerIds,
            ...room.largeFurnitureBlockerIds,
          ],
          "source_data",
          "调整门口洁具或柜体，恢复进入、关门和退出空间。",
        ),
      ),
      ...unresolved.map((room) =>
        diagnostic(
          "warning",
          "bathroom_entry_unresolved",
          `${roomLabel(room)}缺少可靠入口或自由空间`,
          [room.roomRegionId],
          "insufficient_information",
          "检查卫生间Door Portal、Room边界和洁具占地。",
        ),
      ),
    ];
  return result(
    "G3-033",
    "卫生间能够正常进入和退出",
    status,
    issues.length
      ? `发现 ${issues.length} 个卫生间无法正常进入或退出`
      : unresolved.length
        ? `${unresolved.length} 个卫生间入口无法判断`
        : `${analysis.bathroomRooms.length} 个卫生间具有基本进入和退出空间`,
    {
      normalizedObjectIds: issues.map((room) => room.roomRegionId),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "bathroomRoomCount", value: analysis.bathroomRooms.length },
        { name: "bathroomEntryIssueCount", value: issues.length },
      ],
      missingData: unresolved.map(
        (room) => `${room.roomRegionId}: Door Portal或自由空间`,
      ),
      diagnostics,
    },
  );
};

const fixtureAccessRule =
  (
    ruleId: string,
    ruleName: string,
    semantics: FixtureSemantic[],
    code: string,
    label: string,
  ): G3Rule =>
  (handoff) => {
    const analysis = fixtureUseAnalysis(handoff),
      fixtures = analysis.items.filter(
        (item) =>
          item.roomKind === "bathroom" && semantics.includes(item.semantic),
      ),
      evaluated = fixtures
        .map((item) => ({
          item,
          assessment: assessmentFor(analysis, item.item.id),
        }))
        .filter(
          (
            entry,
          ): entry is {
            item: FixtureSemanticItem;
            assessment: FixtureUseAssessment;
          } => Boolean(entry.assessment),
        ),
      issues = evaluated.filter((entry) => !entry.assessment.usable),
      unresolved = fixtures.filter(
        (item) =>
          item.semanticConfidence === "low" ||
          !evaluated.some((entry) => entry.item.item.id === item.item.id),
      ),
      status: RuleStatus = issues.length
        ? "issue"
        : unresolved.length
          ? "unable_to_determine"
          : evaluated.length
            ? "pass"
            : "not_applicable",
      diagnostics = [
        ...fixtureDiagnostics(issues, code, label),
        ...unresolved.map((item) =>
          diagnostic(
            "warning",
            `${code}_geometry_unavailable`,
            `${item.item.name ?? label}缺少可靠位置、尺寸、朝向或Room归属`,
            [item.item.id],
            "insufficient_information",
            `核对${label}category和几何。`,
          ),
        ),
      ];
    return result(
      ruleId,
      ruleName,
      status,
      issues.length
        ? `发现 ${issues.length} 个${label}没有基本使用或进入空间`
        : unresolved.length
          ? `${unresolved.length} 个${label}无法判断`
          : `${evaluated.length} 个${label}具有基本使用和进入空间`,
      {
        normalizedObjectIds: issues.map((entry) => entry.item.item.id),
        pascalSourceIds: sourceIds(
          fixtures,
          issues.map((entry) => entry.item.item.id),
        ),
        details: diagnostics.map((item) => item.message),
        measurements: [
          { name: `${code}Count`, value: fixtures.length },
          { name: `${code}IssueCount`, value: issues.length },
        ],
        missingData: unresolved.map(
          (item) => `${item.item.id}: 可靠几何或Room归属`,
        ),
        diagnostics,
      },
    );
  };
export const ruleG3034 = fixtureAccessRule(
  "G3-034",
  "坐便器具备基本坐下和起身空间",
  ["toilet"],
  "toilet_use",
  "坐便器",
);
export const ruleG3035 = fixtureAccessRule(
  "G3-035",
  "洗手盆具备基本站立和操作位置",
  ["basin", "sink"],
  "basin_use",
  "洗手盆",
);
export const ruleG3036 = fixtureAccessRule(
  "G3-036",
  "淋浴或浴缸能够正常进入",
  ["shower", "bathtub"],
  "bath_fixture_entry",
  "淋浴或浴缸",
);

export const ruleG3037: G3Rule = (handoff) => {
  const analysis = fixtureUseAnalysis(handoff),
    bathRoomIds = new Set(
      analysis.bathroomRooms.map((room) => room.roomRegionId),
    ),
    doorById = new Map(handoff.doors.map((door) => [door.id, door])),
    doors = analysis.bathroomRooms.flatMap((room) =>
      room.portalNodes.map((portal) => ({
        room,
        door: doorById.get(portal.doorId),
        operation: analysis.doorOperations.find(
          (operation) => operation.doorId === portal.doorId,
        ),
      })),
    ),
    swingDoors = doors.filter(
      ({ door }) => door?.doorType === "hinged" || door?.doorType === "double",
    ),
    unresolved = swingDoors.filter(
      ({ operation }) => !operation?.usableForEvaluation,
    ),
    trapped = swingDoors.filter(
      ({ room, operation }) =>
        operation?.usableForEvaluation &&
        operation.leaves.some((leaf) =>
          itemsIn(analysis, room.roomRegionId, [
            "toilet",
            "basin",
            "sink",
          ]).some(
            (item) =>
              item.footprint &&
              (intersectionArea(leaf.requiredSwingPolygon, item.footprint) ??
                0) > T.doorCollisionAreaSquareMeters &&
              !assessmentFor(analysis, item.item.id)?.usable,
          ),
        ),
    ),
    status: RuleStatus = trapped.length
      ? "issue"
      : unresolved.length
        ? "unable_to_determine"
        : bathRoomIds.size
          ? "pass"
          : "not_applicable",
    diagnostics = [
      ...trapped.map(({ room, operation }) =>
        diagnostic(
          "error",
          "bathroom_door_trap_confirmed",
          `${roomLabel(room)}的门扇与洁具形成明确封锁，进入后可能无法重新开门退出`,
          [
            operation!.doorId,
            ...itemsIn(analysis, room.roomRegionId, [
              "toilet",
              "basin",
              "sink",
            ]).map((item) => item.item.id),
          ],
          "source_data",
          "调整卫生间门开向或洁具位置。",
        ),
      ),
      ...unresolved.map(({ room, operation }) =>
        diagnostic(
          "warning",
          "bathroom_door_operation_unavailable",
          `${roomLabel(room)}的平开门缺少可靠铰链、开向或门扇几何，不能排除被困风险`,
          [
            operation?.doorId ??
              room.portalNodes[0]?.doorId ??
              room.roomRegionId,
          ],
          "insufficient_information",
          "补充卫生间门的铰链侧、开向和开启角度。",
        ),
      ),
    ];
  return result(
    "G3-037",
    "卫生间门不得造成使用者被困风险",
    status,
    trapped.length
      ? `发现 ${trapped.length} 个卫生间存在明确门扇被洁具卡住风险`
      : unresolved.length
        ? `${unresolved.length} 扇卫生间门缺少可靠操作几何`
        : "未发现卫生间门与洁具形成明确被困风险",
    {
      normalizedObjectIds: trapped.map(({ operation }) => operation!.doorId),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "bathroomDoorCount", value: doors.length },
        { name: "confirmedTrapRiskCount", value: trapped.length },
      ],
      missingData: unresolved.map(
        ({ operation, room }) =>
          `${operation?.doorId ?? room.roomRegionId}: 门铰链、开向或开启角度`,
      ),
      diagnostics,
    },
  );
};

export const ruleG3038: G3Rule = (handoff) => {
  const analysis = fixtureUseAnalysis(handoff),
    assessments = analysis.assessments.filter((entry) =>
      analysis.items.some(
        (item) =>
          item.item.id === entry.zone.ownerObjectId &&
          item.roomKind === "bathroom",
      ),
    ),
    severe = assessments.filter(
      (entry) =>
        entry.blockedAreaRatio >= 0.8 &&
        entry.blockerIds.some((id) =>
          analysis.items.some(
            (item) =>
              item.item.id === id &&
              item.roomKind === "bathroom" &&
              ["toilet", "basin", "sink", "shower", "bathtub"].includes(
                item.semantic,
              ),
          ),
        ),
    ),
    mutual = severe.filter((entry) =>
      severe.some(
        (other) =>
          other.zone.ownerObjectId !== entry.zone.ownerObjectId &&
          entry.blockerIds.includes(other.zone.ownerObjectId) &&
          other.blockerIds.includes(entry.zone.ownerObjectId),
      ),
    ),
    status: RuleStatus = mutual.length
      ? "issue"
      : severe.length
        ? "not_applicable"
        : assessments.length
          ? "pass"
          : "not_applicable",
    diagnostics = [
      ...mutual.map((entry) =>
        diagnostic(
          "error",
          "bathroom_fixture_mutual_function_deadlock",
          "两个卫生设备相互占满对方唯一基本使用位置，至少一个设备无法使用",
          [entry.zone.ownerObjectId, ...entry.blockerIds],
          "source_data",
          "调整设备位置，使至少一个设备的必要使用区恢复可用。",
        ),
      ),
      ...(!mutual.length
        ? severe.map((entry) =>
            diagnostic(
              "info",
              "bathroom_fixture_conflict_reported_by_specific_rule",
              "该设备使用区被占用的问题已由对应G3-034/G3-035/G3-036报告，本规则不重复报警",
              [entry.zone.ownerObjectId, ...entry.blockerIds],
              "rule",
              "处理对应专项规则的问题。",
            ),
          )
        : []),
    ];
  return result(
    "G3-038",
    "卫生设备之间不存在完全功能冲突",
    status,
    mutual.length
      ? `发现 ${mutual.length} 处卫生设备相互完全占用必要使用位置`
      : severe.length
        ? "单项设备使用问题已由对应专项规则统一报告"
        : assessments.length
          ? "未发现卫生设备之间的完全功能冲突"
          : "当前没有可评价的卫生设备使用区",
    {
      normalizedObjectIds: mutual.map((entry) => entry.zone.ownerObjectId),
      details: diagnostics.map((item) => item.message),
      measurements: [
        { name: "bathroomFixtureUseZoneCount", value: assessments.length },
        { name: "mutualFunctionDeadlockCount", value: mutual.length },
      ],
      diagnostics,
    },
  );
};

export const FIXTURE_G3_RULES: G3Rule[] = [
  ruleG3025,
  ruleG3026,
  ruleG3027,
  ruleG3028,
  ruleG3029,
  ruleG3030,
  ruleG3031,
  ruleG3032,
  ruleG3033,
  ruleG3034,
  ruleG3035,
  ruleG3036,
  ruleG3037,
  ruleG3038,
];
