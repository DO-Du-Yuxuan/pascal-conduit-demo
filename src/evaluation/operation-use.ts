import polygonClipping from "polygon-clipping";
import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import {
  rectangularFootprint,
  polygonArea,
  type Point,
  type Ring,
} from "./envelope";
import { buildObstacles } from "./door-operations";
import { navigationAnalysis } from "./g3-navigation-rules";
import type { RoomNavigableSpace, RoomNavigationAnalysis } from "./navigation";
import { G1_GEOMETRY_TOLERANCES as T } from "./tolerances";
import {
  operationCapabilitiesOf,
  type OperationCapability,
} from "./object-semantics";
import { isExplicitlyOpenable, planUseSpaces } from "./object-use-space";

type StandardItem =
  | EvaluationHandoff["furniture"][number]
  | EvaluationHandoff["equipment"][number]
  | EvaluationHandoff["columns"][number];
type ShelfItem = EvaluationHandoff["shelves"][number] & {
  sourceKind: "shelf";
  category: string;
  functionTags: string[];
  assetId: null;
  assetName: null;
  assetTags: string[];
};
type Item = StandardItem | ShelfItem;
export type OperationZoneKind =
  | "cabinet-front"
  | "storage-front"
  | "drawer-front"
  | "appliance-front"
  | "laundry-front"
  | "generic-operation"
  | "window-approach";
export type OperationGeometryBasis =
  "explicit" | "bounded-assumption" | "unavailable";
export type OperationItem = {
  item: Item;
  capabilities: OperationCapability[];
  confidence: "high" | "medium" | "low";
  reason: string;
  footprint: Ring | null;
  roomRegionId: string | null;
  zoneIds: string[];
  explicitlyOpenable: boolean;
  operationGeometryReliable: boolean;
  operationGeometryBasis: OperationGeometryBasis;
  operationMissingFields: string[];
};
export type OperationWindow = {
  window: EvaluationHandoff["windows"][number];
  operable: boolean;
  dailyOperationSemanticsReliable: boolean;
  roomRegionId: string | null;
  approachPolygon: Ring;
  confidence: "high" | "medium" | "low";
  diagnostics: string[];
};
export type OperationZone = {
  operationZoneId: string;
  ownerObjectId: string;
  levelId: string | null;
  roomRegionId: string | null;
  kind: OperationZoneKind;
  polygon: Ring;
  openingPolygon?: Ring;
  openedUsePolygon?: Ring;
  minimumUsePolygon?: Ring;
  direction?: string;
  maximumOpeningDepthMeters?: number;
  minimumUseClearanceMeters?: number;
  geometryReliable: boolean;
  diagnostics: string[];
};
export type OperationAssessment = {
  zone: OperationZone;
  /** Full opening + post-opening use envelope; retained for debug display. */
  clearRatio: number;
  insideRoomRatio: number;
  blockerIds: string[];
  reachableFromEntry: boolean;
  /** A door/drawer/leaf sweep is rigid: material overlap is never proportionally acceptable. */
  openingBlockedAreaSquareMeters: number | null;
  openingBlockerIds: string[];
  openingUsable: boolean | null;
  /** The post-opening standing/use area is assessed separately and may use a ratio. */
  openedUseClearRatio: number | null;
  openedUseBlockerIds: string[];
  openedUseReachableFromEntry: boolean | null;
  /** Explicit minimum personnel-use area, assessed with the same obstacle and reachability policy. */
  minimumUseAreaSquareMeters: number | null;
  minimumUseBlockedAreaSquareMeters: number | null;
  minimumUseInsideRoomRatio: number | null;
  minimumUseClearRatio: number | null;
  minimumUseBlockerIds: string[];
  minimumUseReachableFromEntry: boolean | null;
  minimumUseUsable: boolean | null;
  usable: boolean;
};
export type OperationUseAnalysis = {
  navigation: RoomNavigationAnalysis;
  items: OperationItem[];
  windows: OperationWindow[];
  zones: OperationZone[];
  assessments: OperationAssessment[];
  laundryRooms: RoomNavigableSpace[];
  storageRooms: RoomNavigableSpace[];
  diagnostics: string[];
};
export type OperationZoneDisplayGroup = "furniture" | "fixture" | "other";
export function operationZoneDisplayGroup(owner: OperationItem): OperationZoneDisplayGroup {
  if ("sourceKind" in owner.item && owner.item.sourceKind === "shelf") return "furniture";
  if (owner.capabilities.some((capability) => ["major-appliance", "laundry-appliance", "household-fixture", "fixed-cabinet"].includes(capability))) return "fixture";
  if (owner.capabilities.some((capability) => ["storage-cabinet", "drawer", "open-shelf"].includes(capability))) return "furniture";
  return "other";
}
const close = (ring: Ring): Ring =>
  ring.length &&
  (ring[0]![0] !== ring[ring.length - 1]![0] ||
    ring[0]![1] !== ring[ring.length - 1]![1])
    ? [...ring, ring[0]!]
    : ring;
const multiArea = (multi: Ring[][]) =>
  multi.reduce((sum, polygon) => sum + polygonArea(polygon[0] ?? []), 0);
const intersectionArea = (a: Ring, b: Ring[]) => {
  try {
    return multiArea(
      polygonClipping.intersection([close(a)] as any, b as any) as Ring[][],
    );
  } catch {
    return 0;
  }
};
const unionIntersectionArea = (a: Ring, rings: Ring[]) => {
  if (!rings.length) return 0;
  try {
    const [first, ...rest] = rings.map((ring) => [close(ring)] as any),
      union = polygonClipping.union(first, ...rest);
    return multiArea(
      polygonClipping.intersection([close(a)] as any, union as any) as Ring[][],
    );
  } catch {
    return 0;
  }
};
const pointInRing = (point: Point, ring: Ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!,
      b = ring[j]!;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
};
const orientedRectangle = (item: Item, depth: number, side = 1): Ring => {
  const [width, , objectDepth] = item.dimensionsMeters!,
    [x, z] = item.resolvedWorldPosition!,
    r = item.resolvedRotationRadians!,
    c = Math.cos(r),
    s = Math.sin(r),
    centerZ = ((objectDepth! + depth) / 2) * side;
  return [
    [-width! / 2, -depth / 2],
    [width! / 2, -depth / 2],
    [width! / 2, depth / 2],
    [-width! / 2, depth / 2],
  ].map(([dx, dz]) => [
    x + dx * c + (centerZ + dz) * s,
    z - dx * s + (centerZ + dz) * c,
  ]);
};
const rectangleAlong = (
  center: Point,
  tangent: Point,
  normal: Point,
  width: number,
  depth: number,
  side: number,
): Ring => {
  const cx = center[0] + (normal[0] * side * depth) / 2,
    cz = center[1] + (normal[1] * side * depth) / 2,
    tx = (tangent[0] * width) / 2,
    tz = (tangent[1] * width) / 2,
    nx = (normal[0] * side * depth) / 2,
    nz = (normal[1] * side * depth) / 2;
  return [
    [cx - tx - nx, cz - tz - nz],
    [cx + tx - nx, cz + tz - nz],
    [cx + tx + nx, cz + tz + nz],
    [cx - tx + nx, cz - tz + nz],
  ];
};

function capabilities(
  item: Item,
): Pick<
  OperationItem,
  | "capabilities"
  | "confidence"
  | "reason"
  | "operationGeometryReliable"
  | "operationGeometryBasis"
  | "operationMissingFields"
> {
  const result = operationCapabilitiesOf(item),
    operationGeometryReliable =
      isExplicitlyOpenable(item) || result.includes("open-shelf"),
    operationGeometryBasis: OperationGeometryBasis = operationGeometryReliable
      ? "explicit"
      : "unavailable";
  return {
    capabilities: result,
    confidence: result.length ? "high" : "low",
    reason: result.length
      ? "functionTags提供明确操作对象语义"
      : "functionTags缺少本轮操作对象用途",
    operationGeometryReliable,
    operationGeometryBasis,
    operationMissingFields: [],
  };
}

export function buildOperationUseAnalysis(
  handoff: EvaluationHandoff,
): OperationUseAnalysis {
  const navigation = navigationAnalysis(handoff),
    physicalRooms = navigation.graph.roomAnalysis.rooms.filter(
      (room) => room.usableForEvaluation,
    ),
    shelfItems: ShelfItem[] = handoff.shelves.map((shelf) => ({
      ...shelf,
      sourceKind: "shelf",
      category: shelf.style,
      assetId: null,
      assetName: null,
      assetTags: [],
    })),
    candidates: Item[] = [
      ...(handoff.items ?? [
        ...handoff.furniture,
        ...handoff.equipment,
        ...handoff.columns,
      ]),
      ...shelfItems,
    ];
  const items: OperationItem[] = candidates.map((item) => {
    const footprint = rectangularFootprint(item),
      area = footprint ? polygonArea(footprint) : 0,
      matches = footprint
        ? physicalRooms
            .filter((room) => room.levelId === item.levelId)
            .map((room) => ({
              room,
              area: room.polygons.reduce(
                (sum, polygon) => sum + intersectionArea(footprint, polygon),
                0,
              ),
            }))
            .sort((a, b) => b.area - a.area)
        : [],
      best = matches[0],
      ratio = area && best ? best.area / area : 0,
      roomRegionId = ratio >= 0.5 ? best!.room.roomRegionId : null,
      zoneIds = roomRegionId
        ? (navigation.graph.roomAnalysis.roomToZoneIds[roomRegionId] ?? [])
        : [];
    return {
      item,
      ...capabilities(item),
      explicitlyOpenable: isExplicitlyOpenable(item),
      footprint,
      roomRegionId,
      zoneIds,
    };
  });
  const zones: OperationZone[] = [];
  const addItemZone = (
    owner: OperationItem,
    kind: OperationZoneKind,
    depth: number,
    geometryReliable = owner.operationGeometryReliable,
    side = 1,
  ) => {
    if (
      !owner.roomRegionId ||
      !owner.item.dimensionsMeters ||
      !owner.item.resolvedWorldPosition ||
      !Number.isFinite(owner.item.resolvedRotationRadians)
    )
      return;
    zones.push({
      operationZoneId: `${owner.item.id}:${kind}:${side > 0 ? "front" : "back"}`,
      ownerObjectId: owner.item.id,
      levelId: owner.item.levelId,
      roomRegionId: owner.roomRegionId,
      kind,
      polygon: orientedRectangle(owner.item, depth, side),
      geometryReliable,
      diagnostics: [
        side > 0
          ? "operation_front_uses_item_local_positive_z"
          : "backless_shelf_allows_opposite_side_access",
        ...owner.operationMissingFields,
      ],
    });
  };
  for (const owner of items) {
    const kind: OperationZoneKind | null = owner.capabilities.includes(
      "laundry-appliance",
    )
      ? "laundry-front"
      : owner.capabilities.includes("major-appliance") ||
          owner.capabilities.includes("household-fixture")
        ? "appliance-front"
        : owner.capabilities.includes("fixed-cabinet")
          ? "cabinet-front"
          : owner.capabilities.includes("storage-cabinet")
            ? "storage-front"
            : owner.capabilities.includes("drawer")
              ? "drawer-front"
              : owner.explicitlyOpenable
                ? "generic-operation"
                : null;
    // Explicit source operation fields remain useful even when a Room match is
    // absent. G3-044 evaluates the resulting envelope against the Slab boundary.
    if (kind)
      for (const space of planUseSpaces(owner.item))
        zones.push({
          operationZoneId: `${owner.item.id}:${kind}:${space.direction}`,
          ownerObjectId: owner.item.id,
          levelId: owner.item.levelId,
          roomRegionId: owner.roomRegionId,
          kind,
          polygon: space.fullUsePolygon,
          openingPolygon: space.openingPolygon,
          openedUsePolygon: space.openedUsePolygon,
          minimumUsePolygon: space.minimumUsePolygon,
          direction: space.direction,
          maximumOpeningDepthMeters: space.maximumOpeningDepthMeters,
          minimumUseClearanceMeters: space.minimumUseClearanceMeters,
          geometryReliable: true,
          diagnostics: space.assumptions,
        });
    if (owner.capabilities.includes("open-shelf")) {
      addItemZone(owner, "storage-front", T.cabinetOperationDepthMeters, true);
      if (
        "sourceKind" in owner.item &&
        owner.item.sourceKind === "shelf" &&
        !owner.item.withBack
      )
        addItemZone(
          owner,
          "storage-front",
          T.cabinetOperationDepthMeters,
          true,
          -1,
        );
    }
  }
  const windows: OperationWindow[] = handoff.windows.map((window) => {
    const wall = handoff.walls.find(
        (candidate) => candidate.id === window.hostWallId,
      ),
      operable = Boolean(window.windowType && window.windowType !== "fixed"),
      diagnostics: string[] = [],
      width = window.widthMeters ?? 0;
    if (
      !wall?.start ||
      !wall.end ||
      !window.resolvedWorldPosition ||
      width <= 0
    ) {
      return {
        window,
        operable,
        dailyOperationSemanticsReliable: operable,
        roomRegionId: null,
        approachPolygon: [],
        confidence: "low",
        diagnostics: ["window_approach_geometry_unavailable"],
      };
    }
    const dx = wall.end[0] - wall.start[0],
      dz = wall.end[1] - wall.start[1],
      length = Math.hypot(dx, dz),
      tangent: Point = [dx / length, dz / length],
      normal: Point = [-tangent[1], tangent[0]],
      options = [-1, 1]
        .flatMap((side) => {
          const polygon = rectangleAlong(
            window.resolvedWorldPosition as Point,
            tangent,
            normal,
            width,
            T.windowOperationDepthMeters,
            side,
          );
          return physicalRooms
            .filter((room) => room.levelId === window.levelId)
            .map((room) => ({
              room,
              polygon,
              area: room.polygons.reduce(
                (sum, p) => sum + intersectionArea(polygon, p),
                0,
              ),
            }));
        })
        .sort((a, b) => b.area - a.area),
      best = options[0];
    if (!best || best.area <= T.areaSquareMeters)
      diagnostics.push("window_interior_side_unresolved");
    if (operable)
      diagnostics.push("v0_1_all_operable_windows_require_daily_access");
    return {
      window,
      operable,
      dailyOperationSemanticsReliable: operable,
      roomRegionId: best?.room.roomRegionId ?? null,
      approachPolygon: best?.polygon ?? [],
      confidence: best ? "medium" : "low",
      diagnostics,
    };
  });
  // Window approach polygons remain an internal Room-side inference aid only.
  // They are not opening/use zones and are therefore not exposed as 2D
  // operation geometry. Physical sash opening, hand reach and minimum
  // personnel-use space belong to 3D; the retired G3-013 rule is not rebuilt
  // from these internal polygons.
  const obstacles = buildObstacles(handoff).filter(
      (obstacle) =>
        obstacle.usableForCollision && obstacle.footprint.length >= 3,
    ),
    hostWallByWindow = new Map(
      handoff.windows.map((window) => [window.id, window.hostWallId]),
    );
  const assessments: OperationAssessment[] = zones.map((zone) => {
    const room = physicalRooms.find(
        (candidate) => candidate.roomRegionId === zone.roomRegionId,
      ),
      navRoom = navigation.rooms.find(
        (candidate) => candidate.roomRegionId === zone.roomRegionId,
      ),
      excluded = new Set([
        zone.ownerObjectId,
        hostWallByWindow.get(zone.ownerObjectId) ?? "",
      ]),
      polygonAssessment = (polygon: Ring) => {
        const area = polygonArea(polygon),
          inside = room
            ? room.polygons.reduce(
                (sum, candidate) => sum + intersectionArea(polygon, candidate),
                0,
              )
            : 0,
          blockers = obstacles.filter(
            (obstacle) =>
              obstacle.levelId === zone.levelId &&
              !excluded.has(obstacle.objectId) &&
              intersectionArea(polygon, [obstacle.footprint]) >
                T.overlapAreaSquareMeters,
          ),
          blockedArea = unionIntersectionArea(
            polygon,
            blockers.map((obstacle) => obstacle.footprint),
          ),
          insideRoomRatio = area ? Math.min(1, inside / area) : 0,
          clearRatio = area
            ? Math.max(0, Math.min(insideRoomRatio, 1 - blockedArea / area))
            : 0,
          reachable = Boolean(
            navRoom?.portalNodes.some((portal) => portal.furnishedLanding) &&
            navRoom.furnishedConnected &&
            navRoom.navigableFreeCells.some((point) => pointInRing(point, polygon)),
          );
        return { blockedArea, blockerIds: blockers.map((obstacle) => obstacle.objectId), insideRoomRatio, clearRatio, reachable };
      },
      full = polygonAssessment(zone.polygon),
      opening = zone.openingPolygon ? polygonAssessment(zone.openingPolygon) : null,
      openedUse = zone.openedUsePolygon
        ? polygonAssessment(zone.openedUsePolygon)
        : null,
      minimumUse = zone.minimumUsePolygon
        ? polygonAssessment(zone.minimumUsePolygon)
        : null,
      // Opening geometry is a rigid sweep. A material overlap beyond the
      // centralized numerical tolerance means the object cannot reach its
      // declared opening state; no percentage threshold is applicable here.
      openingUsable = opening
        ? opening.blockedArea <= T.overlapAreaSquareMeters
        : null,
      postOpeningClearRatio = openedUse?.clearRatio ?? full.clearRatio,
      postOpeningReachable = openedUse?.reachable ?? full.reachable,
      usable =
        (openingUsable ?? true) &&
        postOpeningClearRatio >= T.furnitureUseZoneClearRatio &&
        postOpeningReachable;
    return {
      zone,
      clearRatio: full.clearRatio,
      insideRoomRatio: full.insideRoomRatio,
      blockerIds: full.blockerIds,
      reachableFromEntry: full.reachable,
      openingBlockedAreaSquareMeters: opening?.blockedArea ?? null,
      openingBlockerIds: opening?.blockerIds ?? [],
      openingUsable,
      openedUseClearRatio: openedUse?.clearRatio ?? null,
      openedUseBlockerIds: openedUse?.blockerIds ?? [],
      openedUseReachableFromEntry: openedUse?.reachable ?? null,
      minimumUseAreaSquareMeters: zone.minimumUsePolygon ? polygonArea(zone.minimumUsePolygon) : null,
      minimumUseBlockedAreaSquareMeters: minimumUse?.blockedArea ?? null,
      minimumUseInsideRoomRatio: minimumUse?.insideRoomRatio ?? null,
      minimumUseClearRatio: minimumUse?.clearRatio ?? null,
      minimumUseBlockerIds: minimumUse?.blockerIds ?? [],
      minimumUseReachableFromEntry: minimumUse?.reachable ?? null,
      minimumUseUsable: minimumUse ? minimumUse.clearRatio >= T.furnitureUseZoneClearRatio && minimumUse.reachable : null,
      usable,
    };
  });
  const laundryRooms = navigation.rooms.filter((room) =>
      room.zoneNames.some((name) => /LAUNDRY|洗衣|家政/i.test(name)),
    ),
    storageRooms = navigation.rooms.filter((room) =>
      room.zoneNames.some((name) =>
        /PANTRY|WALK.?IN.?CLOSET|\bWIC\b|STORAGE|STORE|储藏|储物|衣帽/i.test(
          name,
        ),
      ),
    ),
    diagnostics = [
      ...items
        .filter(
          (item) =>
            item.capabilities.length && item.operationMissingFields.length,
        )
        .map(
          (item) => `${item.item.id}: ${item.operationMissingFields.join(",")}`,
        ),
      ...windows
        .filter((window) => window.operable)
        .map((window) => `${window.window.id}: dailyOperationSemantics`),
    ];
  return {
    navigation,
    items,
    windows,
    zones,
    assessments,
    laundryRooms,
    storageRooms,
    diagnostics,
  };
}
