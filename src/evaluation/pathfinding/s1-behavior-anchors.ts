import type { EvaluationHandoff } from "../../parser/evaluation-handoff";
import type { RoomConnectivityGraph } from "../connectivity";
import { rectangularFootprint, type Point } from "../envelope";
import polygonClipping from "polygon-clipping";
import type { RoomNavigationAnalysis } from "../navigation";
import { furnitureSemanticOf } from "../object-semantics";
import type { S1HighFrequencyPathSpaceRef } from "../s1-high-frequency-path";
import { S1_PATHFINDING_AGENT_RADIUS_METERS, S1_PATHFINDING_BED_EDGE_EXTRA_OFFSET_METERS, S1_PATHFINDING_BED_EDGE_SAMPLE_FRACTIONS, S1_PATHFINDING_REGION_TARGET_SAMPLE_SPACING_METERS } from "./s1-pathfinding-config";
import { buildS1PathRoomProviders, resolveS1DoorPortalLanding, resolveS1ZoneAnchor, type S1GlobalPathAnchor } from "./s1-global-path";
import { s1PathPointKey, s1PointInMultiPolygon, s1PointInRing } from "./s1-walkable-geometry";

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const representative = (rings: Point[][]): Point => {
  const points = rings.flat();
  return [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
};

export type S1AnchorSet = { anchors: S1GlobalPathAnchor[]; diagnostics: string[]; missingData: string[]; zoneAnchors: Array<{ zoneId: string; point: Point }>; itemIds: string[] };

export function resolveS1TechnicalZoneAnchors(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, navigation: RoomNavigationAnalysis, space: S1HighFrequencyPathSpaceRef): S1AnchorSet {
  const provider = buildS1PathRoomProviders(graph, navigation).get(space.roomRegionId), zones = space.zoneIds.map((id) => handoff.zones.find((zone) => zone.id === id)).filter((zone): zone is EvaluationHandoff["zones"][number] => Boolean(zone && Array.isArray(zone.outline) && zone.outline.length >= 3));
  if (!provider || !zones.length) return { anchors: [], diagnostics: ["无法建立 Zone 技术代表点。"], missingData: [`${space.roomRegionId}: 可通行多边形或 Zone outline`], zoneAnchors: [], itemIds: [] };
  const point = representative(zones.map((zone) => zone.outline)), anchor = resolveS1ZoneAnchor(provider.room, provider.geometry, zones, point);
  if (!anchor) return { anchors: [], diagnostics: ["Zone 与 RoomRegion 的有效重合范围内没有可通行技术代表点。"], missingData: [`${space.zoneIds.join("+")}: Zone 可通行锚点`], zoneAnchors: [], itemIds: [] };
  return { anchors: [anchor], diagnostics: ["当前路线端点沿用 Zone 范围内的技术代表点；生活行为对象尚未冻结。"], missingData: [], zoneAnchors: zones.map((zone) => ({ zoneId: zone.id, point: anchor.point })), itemIds: [] };
}

export function bedItemsForS1Bedroom(handoff: EvaluationHandoff, bedroom: S1HighFrequencyPathSpaceRef) {
  const zones = bedroom.zoneIds.map((id) => handoff.zones.find((zone) => zone.id === id)).filter((zone): zone is EvaluationHandoff["zones"][number] => Boolean(zone && Array.isArray(zone.outline) && zone.outline.length >= 3));
  return (handoff.items ?? []).filter((item) => item.levelId === bedroom.levelId && furnitureSemanticOf(item) === "bed" && Array.isArray(item.resolvedWorldPosition) && zones.some((zone) => s1PointInRing(item.resolvedWorldPosition as Point, zone.outline))).sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveS1BedEdgeAnchors(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, navigation: RoomNavigationAnalysis, bedroom: S1HighFrequencyPathSpaceRef, bedItemId: string): S1AnchorSet {
  const provider = buildS1PathRoomProviders(graph, navigation).get(bedroom.roomRegionId), zones = bedroom.zoneIds.map((id) => handoff.zones.find((zone) => zone.id === id)).filter((zone): zone is EvaluationHandoff["zones"][number] => Boolean(zone && Array.isArray(zone.outline) && zone.outline.length >= 3));
  if (!provider || !zones.length) return { anchors: [], diagnostics: ["卧室缺少可靠可通行几何或 Zone outline。"], missingData: [`${bedroom.roomRegionId}: 可通行多边形`], zoneAnchors: [], itemIds: [] };
  const item = bedItemsForS1Bedroom(handoff, bedroom).find((candidate) => candidate.id === bedItemId), footprint = item ? rectangularFootprint(item) : null, center = item?.resolvedWorldPosition as Point | null, rotation = item?.resolvedRotationRadians, dimensions = item?.dimensionsMeters;
  if (!item || !footprint || !center || !dimensions || !Number.isFinite(rotation) || !s1PointInMultiPolygon(center, provider.room.polygons)) return { anchors: [], diagnostics: ["该床缺少可靠中心点、世界方向、矩形 footprint 或 RoomRegion 归属。"], missingData: [`${bedItemId}: bed center / resolvedRotationRadians / footprint`], zoneAnchors: [], itemIds: [bedItemId] };
  const width = dimensions[0], depth = dimensions[2];
  if (!Number.isFinite(width) || !Number.isFinite(depth) || width! <= 0 || depth! <= 0) return { anchors: [], diagnostics: ["该床缺少有效局部尺寸，无法从世界方向建立左右下床侧。"], missingData: [`${bedItemId}: bed dimensions`], zoneAnchors: [], itemIds: [bedItemId] };
  // This is the same local-to-world convention as rectangularFootprint(): local Z is the
  // authoritative head-to-foot axis, and local X is its left/right perpendicular axis.
  const c = Math.cos(rotation!), s = Math.sin(rotation!), longitudinal: Point = [s, c], lateral: Point = [c, -s], offset = S1_PATHFINDING_AGENT_RADIUS_METERS + S1_PATHFINDING_BED_EDGE_EXTRA_OFFSET_METERS, candidates: S1GlobalPathAnchor[] = [];
  [-1, 1].forEach((side) => S1_PATHFINDING_BED_EDGE_SAMPLE_FRACTIONS.forEach((fraction) => {
    const along = (fraction - .5) * depth!, lateralOffset = side * (width! / 2 + offset), point: Point = [center[0] + longitudinal[0] * along + lateral[0] * lateralOffset, center[1] + longitudinal[1] * along + lateral[1] * lateralOffset];
    if (s1PointInMultiPolygon(point, provider.geometry.walkablePolygons)) candidates.push({ id: `bed:${item.id}:side:${side}:fraction:${fraction}`, roomRegionId: bedroom.roomRegionId, levelId: bedroom.levelId, point, anchorType: "bed_edge", sourceObjectId: item.id });
  }));
  const anchors = [...new Map(candidates.map((anchor) => [s1PathPointKey(anchor.point), anchor])).values()].sort((a, b) => a.id.localeCompare(b.id));
  if (!anchors.length) return { anchors: [], diagnostics: ["床左右长边周围没有落入正式可通行区域的候选点。"], missingData: [`${item.id}: 可通行左右床边候选`], zoneAnchors: [], itemIds: [item.id] };
  return { anchors, diagnostics: [`床 ${item.id} 按 resolvedRotationRadians 的局部左右侧生成 ${anchors.length} 个合法下床候选。`], missingData: [], zoneAnchors: bedroom.zoneIds.map((zoneId) => ({ zoneId, point: anchors.sort((a, b) => distance(a.point, center) - distance(b.point, center) || a.id.localeCompare(b.id))[0]!.point })), itemIds: [item.id] };
}

export function resolveS1KitchenRegionAnchors(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, navigation: RoomNavigationAnalysis, kitchen: S1HighFrequencyPathSpaceRef): S1AnchorSet {
  const provider = buildS1PathRoomProviders(graph, navigation).get(kitchen.roomRegionId), zones = kitchen.zoneIds.map((id) => handoff.zones.find((zone) => zone.id === id)).filter((zone): zone is EvaluationHandoff["zones"][number] => Boolean(zone && Array.isArray(zone.outline) && zone.outline.length >= 3));
  if (!provider || !zones.length) return { anchors: [], diagnostics: ["Kitchen Zone 缺少可靠可通行几何。"], missingData: [`${kitchen.roomRegionId}: Kitchen walkable intersection`], zoneAnchors: [], itemIds: [] };
  const candidates: S1GlobalPathAnchor[] = [];
  for (const zone of zones) {
    let intersection: any;
    try { intersection = polygonClipping.intersection([[zone.outline]] as any, provider.geometry.walkablePolygons as any); } catch { intersection = []; }
    for (const polygon of intersection as Point[][][]) for (const ring of polygon) for (let edgeIndex = 0; edgeIndex < ring.length; edgeIndex++) {
      const start = ring[edgeIndex]!, end = ring[(edgeIndex + 1) % ring.length]!, length = distance(start, end), steps = Math.max(1, Math.ceil(length / S1_PATHFINDING_REGION_TARGET_SAMPLE_SPACING_METERS));
      for (let step = 0; step <= steps; step++) { const fraction = step / steps, point: Point = [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction]; if (s1PointInMultiPolygon(point, provider.geometry.walkablePolygons)) candidates.push({ id: `kitchen:${zone.id}:${edgeIndex}:${step}:${steps}`, roomRegionId: kitchen.roomRegionId, levelId: kitchen.levelId, point, anchorType: "kitchen_zone_entry", zoneId: zone.id }); }
    }
  }
  const anchors = [...new Map(candidates.map((anchor) => [s1PathPointKey(anchor.point), anchor])).values()].sort((a, b) => a.id.localeCompare(b.id));
  return anchors.length ? { anchors, diagnostics: [`Kitchen Zone 与可通行区域交界生成 ${anchors.length} 个首次进入候选。`], missingData: [], zoneAnchors: zones.map((zone) => ({ zoneId: zone.id, point: anchors.find((anchor) => anchor.zoneId === zone.id)!.point })), itemIds: [] } : { anchors: [], diagnostics: ["Kitchen Zone 与正式可通行区域没有合法交集。"], missingData: [`${kitchen.zoneIds.join("+")}: Kitchen walkable boundary`], zoneAnchors: [], itemIds: [] };
}

const roomSetForCodes = (handoff: EvaluationHandoff, graph: RoomConnectivityGraph, codes: string[]) => new Set(graph.roomAnalysis.zoneMatches.filter((match) => match.matchedRoomRegionIds.length === 1 && handoff.zones.some((zone) => zone.id === match.zoneId && zone.spaceFunctionCode && codes.includes(zone.spaceFunctionCode))).map((match) => match.matchedRoomRegionIds[0]!));

export function resolveS1PrimaryEntranceAnchors(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, navigation: RoomNavigationAnalysis): S1AnchorSet {
  const marked = graph.portals.filter((portal) => portal.isPrimaryEntrance), garageRooms = roomSetForCodes(handoff, graph, ["SF30"]);
  if (marked.length > 1) return { anchors: [], diagnostics: ["存在多个 isPrimaryEntrance=true 的 Door，需要项目数据修正。"], missingData: ["唯一主要入口 Door 标记"], zoneAnchors: [], itemIds: marked.map((portal) => portal.doorId).sort() };
  let portal = marked[0];
  if (!portal) {
    const exterior = graph.portals.filter((item) => item.usableForConnectivity && item.connectsExterior);
    if (exterior.length !== 1) return { anchors: [], diagnostics: ["缺少正式主要入口 Door 标记，且不存在唯一可靠外门兼容 fallback。"], missingData: ["Door.isPrimaryEntrance=true"], zoneAnchors: [], itemIds: [] };
    portal = exterior[0];
  }
  if (!portal.usableForConnectivity) return { anchors: [], diagnostics: ["主要入口 Door 没有可靠 DoorPortal。"], missingData: [`${portal.doorId}: DoorPortal`], zoneAnchors: [], itemIds: [portal.doorId] };
  const rooms = [portal.roomRegionAId, portal.roomRegionBId].filter((id): id is string => Boolean(id)), residentialRooms = portal.connectsExterior ? rooms : rooms.filter((id) => !garageRooms.has(id));
  if (residentialRooms.length !== 1 || !portal.connectsExterior && rooms.every((id) => !garageRooms.has(id))) return { anchors: [], diagnostics: ["主要入口标记既不是住宅外门，也不能唯一解析为 Garage→Residence 门。"], missingData: [`${portal.doorId}: 唯一住宅侧`], zoneAnchors: [], itemIds: [portal.doorId] };
  const roomId = residentialRooms[0]!, provider = buildS1PathRoomProviders(graph, navigation).get(roomId), point = provider && resolveS1DoorPortalLanding(portal, roomId, handoff, provider.geometry);
  return point ? { anchors: [{ id: `primary-entry:${portal.doorId}:${roomId}`, roomRegionId: roomId, levelId: provider!.room.levelId, point, anchorType: "primary_entrance_landing", sourceObjectId: portal.doorId }], diagnostics: [marked.length ? "使用 isPrimaryEntrance=true Door 的住宅侧 landing。" : "旧项目兼容：使用唯一可靠住宅外门的室内侧 landing。"], missingData: [], zoneAnchors: [], itemIds: [portal.doorId] } : { anchors: [], diagnostics: ["主要入口住宅侧 landing 无法建立。"], missingData: [`${portal.doorId}: 住宅侧 landing`], zoneAnchors: [], itemIds: [portal.doorId] };
}

export function resolveS1GarageResidenceAnchors(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, navigation: RoomNavigationAnalysis, garage: S1HighFrequencyPathSpaceRef): S1AnchorSet {
  const garageRooms = roomSetForCodes(handoff, graph, ["SF30"]), roomIds = new Set(graph.nodes.filter((node) => node.nodeType === "room").map((node) => node.nodeId)), anchors: S1GlobalPathAnchor[] = [];
  for (const edge of graph.edges.filter((item) => item.connectionType === "door" && (item.fromNodeId === garage.roomRegionId || item.toNodeId === garage.roomRegionId))) {
    const otherRoomId = edge.fromNodeId === garage.roomRegionId ? edge.toNodeId : edge.fromNodeId;
    if (!roomIds.has(otherRoomId) || garageRooms.has(otherRoomId)) continue;
    const portal = graph.portals.find((item) => item.doorId === edge.sourceObjectId), provider = buildS1PathRoomProviders(graph, navigation).get(otherRoomId), point = portal && provider && resolveS1DoorPortalLanding(portal, otherRoomId, handoff, provider.geometry);
    if (point) anchors.push({ id: `garage-entry:${portal!.doorId}:${otherRoomId}`, roomRegionId: otherRoomId, levelId: provider!.room.levelId, point, anchorType: "garage_residence_landing", sourceObjectId: portal!.doorId });
  }
  anchors.sort((a, b) => a.id.localeCompare(b.id));
  return anchors.length ? { anchors, diagnostics: [`${anchors.length} 个 Garage→Residence DoorPortal 住宅侧 landing 参与全局最短选择。`], missingData: [], zoneAnchors: [], itemIds: anchors.map((anchor) => anchor.sourceObjectId!).sort() } : { anchors: [], diagnostics: ["Garage 没有通往非 Garage 住宅内部的可靠 DoorPortal。"], missingData: [], zoneAnchors: [], itemIds: [] };
}

export function resolveS1BathroomEntranceAnchors(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, navigation: RoomNavigationAnalysis, bathroom: S1HighFrequencyPathSpaceRef): S1AnchorSet {
  const provider = buildS1PathRoomProviders(graph, navigation).get(bathroom.roomRegionId);
  if (!provider) return { anchors: [], diagnostics: ["卫生间缺少正式可通行几何。"], missingData: [`${bathroom.roomRegionId}: 可通行多边形`], zoneAnchors: [], itemIds: [] };
  const roomIds = new Set(graph.nodes.filter((node) => node.nodeType === "room").map((node) => node.nodeId)), anchors: S1GlobalPathAnchor[] = [];
  for (const edge of graph.edges.filter((item) => item.connectionType === "door" && (item.fromNodeId === bathroom.roomRegionId || item.toNodeId === bathroom.roomRegionId))) {
    const other = edge.fromNodeId === bathroom.roomRegionId ? edge.toNodeId : edge.fromNodeId;
    if (!roomIds.has(other)) continue;
    const portal = graph.portals.find((item) => item.doorId === edge.sourceObjectId), point = portal && resolveS1DoorPortalLanding(portal, bathroom.roomRegionId, handoff, provider.geometry);
    if (point) anchors.push({ id: `bath-entry:${edge.edgeId}:${bathroom.roomRegionId}`, roomRegionId: bathroom.roomRegionId, levelId: bathroom.levelId, point, anchorType: "bathroom_entrance", sourceObjectId: edge.sourceObjectId });
  }
  anchors.sort((a, b) => a.id.localeCompare(b.id));
  return anchors.length ? { anchors, diagnostics: [`${anchors.length} 个真实卫生间 DoorPortal 入口参与全局路线选择。`], missingData: [], zoneAnchors: bathroom.zoneIds.map((zoneId) => ({ zoneId, point: anchors[0]!.point })), itemIds: [] } : { anchors: [], diagnostics: ["卫生间没有可用的真实 DoorPortal 入口。"], missingData: [`${bathroom.roomRegionId}: 卫生间入口 DoorPortal`], zoneAnchors: [], itemIds: [] };
}
