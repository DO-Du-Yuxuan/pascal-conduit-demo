import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { buildObstacles, type Obstacle } from "./door-operations";
import type { Point, Ring } from "./envelope";
import { buildRoomConnectivityGraph, type DoorPortal, type RoomConnectivityGraph } from "./connectivity";
import type { RoomRegion } from "./room-regions";
import { G1_GEOMETRY_TOLERANCES as T } from "./tolerances";

export type NavigationObstacleRole = "fixed" | "large-movable" | "small" | "uncertain" | "excluded";
export type NavigationObstacle = Obstacle & { role: NavigationObstacleRole; name: string | null; areaSquareMeters: number; reason: string };
export type NavigationPortalNode = { doorId: string; sourcePoint: Point; fixedLanding: Point | null; furnishedLanding: Point | null; fixedComponentId: number | null; furnishedComponentId: number | null };
export type NavigationPortalConnection = { fromDoorId: string; toDoorId: string; fixedConnected: boolean; furnishedConnected: boolean; fixedPath: Point[]; furnishedPath: Point[] };
export type NavigationPath = { fromId: string; toId: string; points: Point[]; status: "connected" | "blocked" };
export type RoomNavigableSpace = {
  roomRegionId: string; levelId: string; zoneIds: string[]; zoneNames: string[]; mainSpace: boolean;
  gridMeters: number; clearanceRadiusMeters: number; anchorPoint: Point | null; portalNodes: NavigationPortalNode[];
  portalConnections: NavigationPortalConnection[];
  fixedFreeCells: Point[]; navigableFreeCells: Point[];
  /**
   * Free cells that are actually reachable from at least one room-side Door
   * Portal landing.  Consumers must use this instead of reconstructing grid
   * connectivity from display coordinates.
   */
  furnishedPortalReachableFreeCells?: Point[];
  fixedComponentCount: number; furnishedComponentCount: number;
  fixedConnected: boolean; furnishedConnected: boolean; uncertainConnected: boolean;
  fixedObstacleIds: string[]; fixedBlockerIds: string[]; largeFurnitureBlockerIds: string[]; uncertainObjectIds: string[]; ignoredSmallObjectIds: string[];
  paths: NavigationPath[]; diagnostics: string[]; usableForEvaluation: boolean;
};
export type RoomNavigationAnalysis = { graph: RoomConnectivityGraph; obstacles: NavigationObstacle[]; rooms: RoomNavigableSpace[]; diagnostics: string[] };

const mainPattern = /\b(LIVING|FAMILY|DINING|KITCHEN|BED(?:ROOM)?|BATH|TOILET|WC|OFFICE|STUDY|ENTRY|FOYER|HALL|LAUNDRY)\b|客厅|起居|餐厅|厨房|卧室|卫生间|书房|入口|门厅|走廊|洗衣/i;
const fixedPattern = /cabinet|counter|kitchen|appliance|toilet|sink|basin|bathtub|shower|vanity|sanitary|plumb|橱柜|台面|洁具|马桶|洗手盆|浴缸|淋浴/i;
const sanitaryPattern = /toilet|sink|basin|bathtub|shower|vanity|sanitary|plumb|洁具|马桶|洗手盆|浴缸|淋浴/i;
const largePattern = /bed|sofa|couch|dining.?table|table|desk|wardrobe|cabinet|床|沙发|餐桌|书桌|衣柜|柜体/i;
const smallPattern = /chair|stool|ottoman|side.?table|nightstand|椅|凳|脚凳|边几|床头柜/i;
const excludedPattern = /vehicle|car\b|automobile|outdoor|patio|garden|车辆|汽车|室外/i;
const polygonArea = (ring: Ring) => Math.abs(ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]!; return sum + point[0] * next[1] - next[0] * point[1]; }, 0) / 2);
const pointSegmentDistance = (point: Point, start: Point, end: Point) => { const dx = end[0] - start[0], dz = end[1] - start[1], l2 = dx * dx + dz * dz; if (!l2) return Math.hypot(point[0] - start[0], point[1] - start[1]); const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / l2)); return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dz); };
const pointOnRing = (point: Point, ring: Ring) => ring.some((start, index) => pointSegmentDistance(point, start, ring[(index + 1) % ring.length]!) <= 1e-7);
const pointInRing = (point: Point, ring: Ring) => { if (pointOnRing(point, ring)) return true; let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i]!, b = ring[j]!; if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; };
const pointInPolygon = (point: Point, polygon: Ring[]) => Boolean(polygon[0] && pointInRing(point, polygon[0]) && !polygon.slice(1).some((hole) => pointInRing(point, hole)));
const pointInRoom = (point: Point, room: RoomRegion) => room.polygons.some((polygon) => pointInPolygon(point, polygon));
const distanceToRoomBoundary = (point: Point, room: RoomRegion) => Math.min(...room.polygons.flatMap((polygon) => polygon.flatMap((ring) => ring.map((start, index) => pointSegmentDistance(point, start, ring[(index + 1) % ring.length]!)))));
const pointBlocked = (point: Point, obstacle: NavigationObstacle) => pointInRing(point, obstacle.footprint) || obstacle.footprint.some((start, index) => pointSegmentDistance(point, start, obstacle.footprint[(index + 1) % obstacle.footprint.length]!) < T.personRadiusMeters - 1e-9);
const centroid = (points: Point[]): Point => [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
const key = (i: number, j: number) => `${i}:${j}`;

function classifyObstacles(handoff: EvaluationHandoff): NavigationObstacle[] {
  const names = new Map([...handoff.furniture, ...handoff.equipment, ...handoff.columns, ...handoff.shelves, ...handoff.shafts, ...handoff.walls].map((item) => [item.id, item.name ?? null]));
  return buildObstacles(handoff).map((obstacle) => {
    const name = names.get(obstacle.objectId) ?? null, text = `${name ?? ""} ${obstacle.rawCategory ?? ""}`, areaSquareMeters = polygonArea(obstacle.footprint);
    let role: NavigationObstacleRole, reason: string;
    if (obstacle.diagnostics.includes("vehicle_excluded") || excludedPattern.test(text)) { role = "excluded"; reason = "functionTags明确为车辆对象"; }
    else if (obstacle.diagnostics.includes("light_movable_excluded_from_hard_blocking")) { role = "small"; reason = "functionTags明确为日常轻型可移动座椅，不作为硬性通行阻断"; }
    else if (!obstacle.usableForCollision || obstacle.classificationConfidence === "low") { role = "uncertain"; reason = "类别或几何置信度不足"; }
    else if (["wall", "column", "shaft", "fixed-cabinet"].includes(obstacle.objectType) || obstacle.mobility === "fixed") { role = "fixed"; reason = "functionTags明确为固定构件、设备或洁具"; }
    else if (obstacle.mobility === "movable") { role = "large-movable"; reason = "当前摆放家具参与通行检查，不假设评价时移动"; }
    else { role = "uncertain"; reason = "无法可靠归入固定或大型可移动障碍"; }
    return { ...obstacle, name, areaSquareMeters, role, reason };
  });
}

type GridCell = { point: Point; i: number; j: number; componentId: number };
type GridResult = { cells: GridCell[]; byKey: Map<string, GridCell>; components: GridCell[][] };
function buildGrid(room: RoomRegion, obstacles: NavigationObstacle[]): GridResult {
  const points = room.polygons.flatMap((polygon) => polygon.flatMap((ring) => ring)), xs = points.map((p) => p[0]), zs = points.map((p) => p[1]), minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs), cells: GridCell[] = [], byKey = new Map<string, GridCell>();
  const columns = Math.ceil((maxX - minX) / T.navigationGridMeters), rows = Math.ceil((maxZ - minZ) / T.navigationGridMeters);
  for (let i = 0; i <= columns; i++) for (let j = 0; j <= rows; j++) {
    const point: Point = [minX + i * T.navigationGridMeters, minZ + j * T.navigationGridMeters];
    if (!pointInRoom(point, room) || distanceToRoomBoundary(point, room) < T.personRadiusMeters - T.navigationGridMeters * .25 || obstacles.some((obstacle) => pointBlocked(point, obstacle))) continue;
    const cell = { point, i, j, componentId: -1 }; cells.push(cell); byKey.set(key(i, j), cell);
  }
  const components: GridCell[][] = [];
  for (const cell of cells) { if (cell.componentId >= 0) continue; const id = components.length, component: GridCell[] = [], queue = [cell]; cell.componentId = id; while (queue.length) { const current = queue.shift()!; component.push(current); for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1]]) { const next = byKey.get(key(current.i + di, current.j + dj)); if (next && next.componentId < 0) { next.componentId = id; queue.push(next); } } } components.push(component); }
  return { cells, byKey, components };
}
function portalSource(portal: DoorPortal, roomId: string) { const points = portal.roomRegionAId === roomId ? portal.samplePointsA : portal.samplePointsB; return points.length ? centroid(points) : portal.openingCenter; }
function nearestCell(grid: GridResult, point: Point | null) { if (!point) return null; let best: GridCell | null = null, distance = Infinity; for (const cell of grid.cells) { const current = Math.hypot(cell.point[0] - point[0], cell.point[1] - point[1]); if (current < distance) { distance = current; best = cell; } } return distance <= T.portalLandingSearchMeters ? best : null; }
function anchorCell(grid: GridResult) { const component = [...grid.components].sort((a, b) => b.length - a.length)[0]; if (!component?.length) return null; const center = centroid(component.map((cell) => cell.point)); return component.reduce((best, cell) => Math.hypot(cell.point[0] - center[0], cell.point[1] - center[1]) < Math.hypot(best.point[0] - center[0], best.point[1] - center[1]) ? cell : best, component[0]!); }
function connected(landings: Array<GridCell | null>, anchor: GridCell | null) { return landings.length > 0 && Boolean(anchor) && landings.every(Boolean) && new Set([...landings.map((cell) => cell!.componentId), anchor!.componentId]).size === 1; }
function path(grid: GridResult, from: GridCell, to: GridCell): Point[] { const queue = [from], previous = new Map<string, string | null>([[key(from.i, from.j), null]]); while (queue.length) { const current = queue.shift()!; if (current === to) break; for (const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]) { const next = grid.byKey.get(key(current.i + di, current.j + dj)), nextKey = next && key(next.i, next.j); if (next && nextKey && !previous.has(nextKey)) { previous.set(nextKey, key(current.i, current.j)); queue.push(next); } } } const targetKey = key(to.i, to.j); if (!previous.has(targetKey)) return []; const result: Point[] = []; let cursor: string | null = targetKey; while (cursor) { const cell = grid.byKey.get(cursor); if (cell) result.push(cell.point); cursor = previous.get(cursor) ?? null; } return result.reverse(); }

export function buildRoomNavigationAnalysis(handoff: EvaluationHandoff): RoomNavigationAnalysis {
  const graph = buildRoomConnectivityGraph(handoff), obstacles = classifyObstacles(handoff), zoneById = new Map(handoff.zones.map((zone) => [zone.id, zone])), rooms: RoomNavigableSpace[] = [], diagnostics: string[] = [];
  for (const room of graph.roomAnalysis.rooms.filter((item) => item.usableForEvaluation)) {
    const portals = graph.portals.filter((portal) => portal.usableForConnectivity && (portal.roomRegionAId === room.roomRegionId || portal.roomRegionBId === room.roomRegionId)), zoneIds = graph.roomAnalysis.roomToZoneIds[room.roomRegionId] ?? [], zoneNames = zoneIds.map((id) => zoneById.get(id)?.name?.trim()).filter((name): name is string => Boolean(name));
    const relevant = obstacles.filter((obstacle) => obstacle.levelId === room.levelId && obstacle.objectType !== "wall" && obstacle.role !== "excluded" && obstacle.footprint.length >= 3 && (obstacle.footprint.some((point) => pointInRoom(point, room)) || room.polygons.some((polygon) => polygon[0]?.some((point) => pointInRing(point, obstacle.footprint))))), fixed = relevant.filter((obstacle) => obstacle.role === "fixed"), large = relevant.filter((obstacle) => obstacle.role === "large-movable"), uncertain = relevant.filter((obstacle) => obstacle.role === "uncertain"), small = relevant.filter((obstacle) => obstacle.role === "small");
    const fixedGrid = buildGrid(room, fixed), furnishedGrid = buildGrid(room, [...fixed, ...large]), uncertainGrid = buildGrid(room, [...fixed, ...large, ...uncertain]), sources = portals.map((portal) => ({ doorId: portal.doorId, point: portalSource(portal, room.roomRegionId) })), fixedLandings = sources.map((source) => nearestCell(fixedGrid, source.point)), furnishedLandings = sources.map((source) => nearestCell(furnishedGrid, source.point)), uncertainLandings = sources.map((source) => nearestCell(uncertainGrid, source.point)), fixedAnchor = anchorCell(fixedGrid), anchor = anchorCell(furnishedGrid), uncertainAnchor = anchorCell(uncertainGrid), fixedConnected = connected(fixedLandings, fixedAnchor), furnishedConnected = connected(furnishedLandings, anchor), uncertainConnected = connected(uncertainLandings, uncertainAnchor);
    const testWithout = (role: NavigationObstacleRole, obstacleId: string) => { const included = relevant.filter((obstacle) => obstacle.role === "fixed" || role === "large-movable" && obstacle.role === "large-movable").filter((obstacle) => obstacle.objectId !== obstacleId), grid = buildGrid(room, included), landings = sources.map((source) => nearestCell(grid, source.point)); return connected(landings, anchorCell(grid)); };
    const largeFurnitureBlockerIds = !furnishedConnected && fixedConnected ? large.filter((obstacle) => testWithout("large-movable", obstacle.objectId)).map((obstacle) => obstacle.objectId) : [], fixedBlockerIds = !fixedConnected ? fixed.filter((obstacle) => { const grid = buildGrid(room, fixed.filter((item) => item.objectId !== obstacle.objectId)), landings = sources.map((source) => nearestCell(grid, source.point)); return connected(landings, anchorCell(grid)); }).map((obstacle) => obstacle.objectId) : [], uncertainObjectIds = furnishedConnected && !uncertainConnected ? uncertain.map((obstacle) => obstacle.objectId) : [];
    const paths: NavigationPath[] = []; for (let index = 0; index < sources.length; index++) { const landing = furnishedLandings[index], source = sources[index]!; if (anchor && landing) { const points = path(furnishedGrid, landing, anchor); paths.push({ fromId: source.doorId, toId: "room-anchor", points: points.length ? points : [source.point!, anchor.point], status: points.length ? "connected" : "blocked" }); } else paths.push({ fromId: source.doorId, toId: "room-anchor", points: [source.point!, ...(anchor ? [anchor.point] : [])], status: "blocked" }); }
    const portalConnections: NavigationPortalConnection[] = [];
    for (let first = 0; first < sources.length; first++) for (let second = first + 1; second < sources.length; second++) {
      const a = sources[first]!, b = sources[second]!, fixedA = fixedLandings[first] ?? null, fixedB = fixedLandings[second] ?? null, furnishedA = furnishedLandings[first] ?? null, furnishedB = furnishedLandings[second] ?? null,
        fixedPairConnected = Boolean(fixedA && fixedB && fixedA.componentId === fixedB.componentId), furnishedPairConnected = Boolean(furnishedA && furnishedB && furnishedA.componentId === furnishedB.componentId),
        fixedPath = fixedPairConnected ? path(fixedGrid, fixedA!, fixedB!) : [a.point!, b.point!], furnishedPath = furnishedPairConnected ? path(furnishedGrid, furnishedA!, furnishedB!) : [a.point!, b.point!];
      portalConnections.push({ fromDoorId: a.doorId, toDoorId: b.doorId, fixedConnected: fixedPairConnected, furnishedConnected: furnishedPairConnected, fixedPath, furnishedPath });
      paths.push({ fromId: a.doorId, toId: b.doorId, points: furnishedPath, status: furnishedPairConnected ? "connected" : "blocked" });
    }
    const portalNodes = sources.map((source, index) => ({ doorId: source.doorId, sourcePoint: source.point!, fixedLanding: fixedLandings[index]?.point ?? null, furnishedLanding: furnishedLandings[index]?.point ?? null, fixedComponentId: fixedLandings[index]?.componentId ?? null, furnishedComponentId: furnishedLandings[index]?.componentId ?? null }));
    const furnishedPortalComponentIds = new Set(
      furnishedLandings
        .filter((cell): cell is GridCell => Boolean(cell))
        .map((cell) => cell.componentId),
    );
    const furnishedPortalReachableFreeCells = furnishedGrid.cells
      .filter((cell) => furnishedPortalComponentIds.has(cell.componentId))
      .map((cell) => cell.point);
    const usableForEvaluation = portals.length > 0 && fixedGrid.cells.length > 0;
    if (!portals.length) diagnostics.push(`${room.roomRegionId}: 没有可用于房内路径的可靠 Door Portal`);
    rooms.push({ roomRegionId: room.roomRegionId, levelId: room.levelId, zoneIds, zoneNames, mainSpace: zoneNames.some((name) => mainPattern.test(name)), gridMeters: T.navigationGridMeters, clearanceRadiusMeters: T.personRadiusMeters, anchorPoint: anchor?.point ?? null, portalNodes, portalConnections, fixedFreeCells: fixedGrid.cells.map((cell) => cell.point), navigableFreeCells: furnishedGrid.cells.map((cell) => cell.point), furnishedPortalReachableFreeCells, fixedComponentCount: fixedGrid.components.length, furnishedComponentCount: furnishedGrid.components.length, fixedConnected, furnishedConnected, uncertainConnected, fixedObstacleIds: fixed.map((item) => item.objectId), fixedBlockerIds, largeFurnitureBlockerIds, uncertainObjectIds, ignoredSmallObjectIds: small.map((item) => item.objectId), paths, diagnostics: [...(!fixedGrid.cells.length ? ["room_free_space_empty"] : []), ...(!portals.length ? ["room_portal_unavailable"] : []), ...(uncertainObjectIds.length ? ["uncertain_objects_may_block_path"] : [])], usableForEvaluation });
  }
  return { graph, obstacles, rooms, diagnostics };
}
