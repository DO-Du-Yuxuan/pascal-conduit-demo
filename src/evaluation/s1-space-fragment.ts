import polygonClipping from "polygon-clipping";
import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { isSdiSpaceFunctionCode, sdiSpaceFunctionName, type SdiSpaceFunctionCode } from "../space-functions/sdi-space-functions";
import type { RoomConnectivityGraph } from "./connectivity";
import type { MultiPolygon, Point, Ring } from "./envelope";
import { buildRoomNavigationAnalysis, type RoomNavigationAnalysis, type RoomNavigableSpace } from "./navigation";
import type { RoomRegion, ZoneRoomMatch } from "./room-regions";
import { S1_SPACE_FRAGMENT_CONFIG as CONFIG } from "./s1-space-fragment-config";

export type S1SpaceFragmentStatus = "measured" | "unable_to_determine" | "not_applicable";
export type S1SpaceFragmentComponent = {
  componentId: string;
  cellCount: number;
  areaSquareMeters: number;
  cells: Point[];
};
export type S1SpaceFragmentMeasurement = {
  metricId: "S1-SFS";
  spaceInstanceId: string;
  zoneIds: string[];
  zoneNames: string[];
  roomRegionId: string | null;
  levelId: string | null;
  spaceFunctionCode: SdiSpaceFunctionCode;
  spaceFunctionName: string;
  footprintPolygons: MultiPolygon;
  footprintAreaSquareMeters: number | null;
  footprintPerimeterMeters: number | null;
  compactness: number | null;
  convexHullAreaSquareMeters: number | null;
  convexityRatio: number | null;
  concavePocketAreaSquareMeters: number | null;
  concavePocketRatio: number | null;
  totalNavigableAreaSquareMeters: number | null;
  navigableComponentCount: number | null;
  largestNavigableComponentAreaSquareMeters: number | null;
  largestNavigableComponentRatio: number | null;
  fragmentComponentCount: number | null;
  fragmentAreaSquareMeters: number | null;
  fragmentAreaRatio: number | null;
  navigableComponents: S1SpaceFragmentComponent[];
  fragmentPolygonsOrCells: S1SpaceFragmentComponent[];
  gridMeters: number | null;
  status: S1SpaceFragmentStatus;
  confidence: "high" | "medium" | "low";
  diagnostics: string[];
  missingData: string[];
  ruleVersion: "v0.1";
};
export type S1SpaceFragmentReport = {
  metricId: "S1-SFS";
  metricName: string;
  status: "measured" | "not_applicable";
  ruleVersion: "v0.1";
  measurementStatus: string;
  measurements: S1SpaceFragmentMeasurement[];
  counts: {
    measured: number;
    unableToDetermine: number;
    notApplicable: number;
    multipleNavigableComponents: number;
  };
  totals: { fragmentAreaSquareMeters: number };
  averages: {
    compactness: number | null;
    convexityRatio: number | null;
    largestNavigableComponentRatio: number | null;
  };
  diagnostics: string[];
};

type HandoffZone = EvaluationHandoff["zones"][number];
type Candidate = { zone: HandoffZone; code: SdiSpaceFunctionCode; match: ZoneRoomMatch | null; room: RoomRegion | null };

const close = (ring: Ring): Ring => ring.length > 2 && (ring[0]![0] !== ring[ring.length - 1]![0] || ring[0]![1] !== ring[ring.length - 1]![1]) ? [...ring, ring[0]!] : [...ring];
const signedArea = (ring: Ring) => ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]!; return sum + point[0] * next[1] - next[0] * point[1]; }, 0) / 2;
const ringArea = (ring: Ring) => Math.abs(signedArea(ring));
const ringPerimeter = (ring: Ring) => ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]!; return sum + Math.hypot(next[0] - point[0], next[1] - point[1]); }, 0);
const pointKey = ([x, z]: Point) => `${x.toFixed(9)}:${z.toFixed(9)}`;
const gridKey = ([x, z]: Point, _grid: number) => `${x.toFixed(7)}:${z.toFixed(7)}`;
const uniqueSorted = <T>(values: T[]) => [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
const finiteAverage = (values: Array<number | null>) => { const finite = values.filter((value): value is number => value !== null && Number.isFinite(value)); return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null; };
const indoorCode = (code: SdiSpaceFunctionCode) => Number(code.slice(2)) <= CONFIG.indoorCodeMaximum;
const reliableMatch = (match: ZoneRoomMatch | null) => match?.matchedRoomRegionIds.length === 1 && (match.relationship === "one-to-one" || match.relationship === "room-with-multiple-zones");
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function properSegmentIntersection(a: Point, b: Point, c: Point, d: Point) { return cross(a, b, c) * cross(a, b, d) < -CONFIG.geometryEpsilon && cross(c, d, a) * cross(c, d, b) < -CONFIG.geometryEpsilon; }
function validZoneOutline(outline: Ring | undefined) {
  if (!outline || outline.length < 3 || !outline.every((point) => point.length >= 2 && point.every(Number.isFinite)) || ringArea(outline) <= CONFIG.geometryEpsilon) return false;
  for (let index = 0; index < outline.length; index++) for (let other = index + 1; other < outline.length; other++) {
    if (Math.abs(index - other) <= 1 || index === 0 && other === outline.length - 1) continue;
    if (properSegmentIntersection(outline[index]!, outline[(index + 1) % outline.length]!, outline[other]!, outline[(other + 1) % outline.length]!)) return false;
  }
  return true;
}

function pointOnSegment(point: Point, start: Point, end: Point) {
  const dx = end[0] - start[0], dz = end[1] - start[1], l2 = dx * dx + dz * dz;
  if (l2 <= CONFIG.geometryEpsilon) return Math.hypot(point[0] - start[0], point[1] - start[1]) <= CONFIG.geometryEpsilon;
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / l2));
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dz) <= CONFIG.geometryEpsilon;
}
function pointInRing(point: Point, ring: Ring) {
  if (ring.some((start, index) => pointOnSegment(point, start, ring[(index + 1) % ring.length]!))) return true;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index]!, b = ring[previous]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function pointInMultiPolygon(point: Point, polygons: MultiPolygon) {
  return polygons.some((polygon) => Boolean(polygon[0] && pointInRing(point, polygon[0]) && !polygon.slice(1).some((hole) => pointInRing(point, hole))));
}

/** Stable monotone-chain hull. Collinear interior points are intentionally removed. */
export function convexHull(points: Point[]): Ring {
  const sorted = [...new Map(points.map((point) => [pointKey(point), point] as const)).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length <= 2) return sorted;
  const cross = (origin: Point, a: Point, b: Point) => (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
  const half = (input: Point[]) => { const out: Point[] = []; for (const point of input) { while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, point) <= CONFIG.geometryEpsilon) out.pop(); out.push(point); } return out; };
  return [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)];
}

export function measureFootprintGeometry(polygons: MultiPolygon) {
  const area = polygons.reduce((sum, polygon) => sum + Math.max(0, ringArea(polygon[0] ?? []) - polygon.slice(1).reduce((holes, hole) => holes + ringArea(hole), 0)), 0);
  const perimeter = polygons.reduce((sum, polygon) => sum + polygon.reduce((rings, ring) => rings + ringPerimeter(ring), 0), 0);
  const hull = convexHull(polygons.flatMap((polygon) => polygon[0] ?? []));
  const hullArea = hull.length >= 3 ? ringArea(hull) : 0;
  if (area <= CONFIG.geometryEpsilon || perimeter <= CONFIG.geometryEpsilon || hullArea <= CONFIG.geometryEpsilon) return null;
  const convexity = Math.min(1, area / hullArea), pocketArea = Math.max(0, hullArea - area);
  return { area, perimeter, compactness: 4 * Math.PI * area / (perimeter * perimeter), convexHullArea: hullArea, convexityRatio: convexity, concavePocketArea: pocketArea, concavePocketRatio: pocketArea / hullArea };
}

export function connectedNavigableComponents(cells: Point[], gridMeters: number): Point[][] {
  const byKey = new Map(cells.map((point) => [gridKey(point, gridMeters), point])), visited = new Set<string>(), components: Point[][] = [];
  for (const start of [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const startKey = gridKey(start, gridMeters); if (visited.has(startKey)) continue;
    const component: Point[] = [], queue = [start]; visited.add(startKey);
    while (queue.length) {
      const point = queue.shift()!; component.push(point);
      for (const [dx, dz] of [[gridMeters, 0], [-gridMeters, 0], [0, gridMeters], [0, -gridMeters]] as Point[]) {
        const next = byKey.get(gridKey([point[0] + dx, point[1] + dz], gridMeters)), key = next && gridKey(next, gridMeters);
        if (next && key && !visited.has(key)) { visited.add(key); queue.push(next); }
      }
    }
    components.push(component.sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  }
  return components.sort((a, b) => b.length - a.length || a[0]![0] - b[0]![0] || a[0]![1] - b[0]![1]);
}

function unable(candidate: Candidate, diagnostics: string[], missingData: string[]): S1SpaceFragmentMeasurement {
  const zone = candidate.zone;
  return { metricId: CONFIG.metricId, spaceInstanceId: `${CONFIG.metricId}:${candidate.code}:${zone.id}`, zoneIds: [zone.id], zoneNames: [zone.name?.trim() || zone.id], roomRegionId: candidate.room?.roomRegionId ?? null, levelId: zone.levelId, spaceFunctionCode: candidate.code, spaceFunctionName: sdiSpaceFunctionName(candidate.code)!, footprintPolygons: [], footprintAreaSquareMeters: null, footprintPerimeterMeters: null, compactness: null, convexHullAreaSquareMeters: null, convexityRatio: null, concavePocketAreaSquareMeters: null, concavePocketRatio: null, totalNavigableAreaSquareMeters: null, navigableComponentCount: null, largestNavigableComponentAreaSquareMeters: null, largestNavigableComponentRatio: null, fragmentComponentCount: null, fragmentAreaSquareMeters: null, fragmentAreaRatio: null, navigableComponents: [], fragmentPolygonsOrCells: [], gridMeters: null, status: "unable_to_determine", confidence: "low", diagnostics, missingData, ruleVersion: CONFIG.ruleVersion };
}

function intersectZonesWithRoom(zones: HandoffZone[], room: RoomRegion): MultiPolygon | null {
  try {
    const zonePolygons = zones.map((zone) => [close(zone.outline as Ring)] as Ring[]).filter((polygon) => polygon[0]!.length >= 4);
    if (!zonePolygons.length) return null;
    const [first, ...rest] = zonePolygons, union = polygonClipping.union(first as any, ...rest as any);
    const intersection = polygonClipping.intersection(union as any, room.polygons as any) as MultiPolygon;
    return intersection.length ? intersection : null;
  } catch { return null; }
}

function measureGroup(code: SdiSpaceFunctionCode, room: RoomRegion, zones: HandoffZone[], navRoom: RoomNavigableSpace | null, matches: ZoneRoomMatch[]): S1SpaceFragmentMeasurement {
  const zoneIds = uniqueSorted(zones.map((zone) => zone.id)), zoneNames = uniqueSorted(zones.map((zone) => zone.name?.trim() || zone.id)), instanceId = `${CONFIG.metricId}:${code}:${room.roomRegionId}`;
  const footprint = intersectZonesWithRoom(zones, room), geometry = footprint ? measureFootprintGeometry(footprint) : null;
  const base = { metricId: CONFIG.metricId, spaceInstanceId: instanceId, zoneIds, zoneNames, roomRegionId: room.roomRegionId, levelId: room.levelId, spaceFunctionCode: code, spaceFunctionName: sdiSpaceFunctionName(code)!, ruleVersion: CONFIG.ruleVersion } as const;
  if (!footprint || !geometry) return { ...base, footprintPolygons: footprint ?? [], footprintAreaSquareMeters: null, footprintPerimeterMeters: null, compactness: null, convexHullAreaSquareMeters: null, convexityRatio: null, concavePocketAreaSquareMeters: null, concavePocketRatio: null, totalNavigableAreaSquareMeters: null, navigableComponentCount: null, largestNavigableComponentAreaSquareMeters: null, largestNavigableComponentRatio: null, fragmentComponentCount: null, fragmentAreaSquareMeters: null, fragmentAreaRatio: null, navigableComponents: [], fragmentPolygonsOrCells: [], gridMeters: navRoom?.gridMeters ?? null, status: "unable_to_determine", confidence: "low", diagnostics: ["Zone 与 RoomRegion 的有效交集无法形成可测量多边形"], missingData: ["有效 Zone–RoomRegion 交集几何"] };
  if (!navRoom || !Number.isFinite(navRoom.gridMeters) || navRoom.gridMeters <= 0) return { ...base, footprintPolygons: footprint, footprintAreaSquareMeters: geometry.area, footprintPerimeterMeters: geometry.perimeter, compactness: geometry.compactness, convexHullAreaSquareMeters: geometry.convexHullArea, convexityRatio: geometry.convexityRatio, concavePocketAreaSquareMeters: geometry.concavePocketArea, concavePocketRatio: geometry.concavePocketRatio, totalNavigableAreaSquareMeters: null, navigableComponentCount: null, largestNavigableComponentAreaSquareMeters: null, largestNavigableComponentRatio: null, fragmentComponentCount: null, fragmentAreaSquareMeters: null, fragmentAreaRatio: null, navigableComponents: [], fragmentPolygonsOrCells: [], gridMeters: null, status: "unable_to_determine", confidence: "low", diagnostics: ["对应 RoomRegion 缺少 furnished 自由网格"], missingData: ["furnished 自由网格"] };
  const freeCells = navRoom.navigableFreeCells.filter((point) => pointInMultiPolygon(point, footprint)), components = connectedNavigableComponents(freeCells, navRoom.gridMeters), cellArea = navRoom.gridMeters * navRoom.gridMeters;
  const componentFacts = components.map((cells, index) => ({ componentId: `${instanceId}:component-${index + 1}`, cellCount: cells.length, areaSquareMeters: cells.length * cellArea, cells }));
  const totalArea = freeCells.length * cellArea, largestArea = componentFacts[0]?.areaSquareMeters ?? 0, fragments = componentFacts.slice(1), fragmentArea = fragments.reduce((sum, component) => sum + component.areaSquareMeters, 0);
  const confidence = room.confidence === "high" && matches.every((match) => match.confidence === "high") ? "high" : room.confidence === "low" || matches.some((match) => match.confidence === "low") ? "low" : "medium";
  return { ...base, footprintPolygons: footprint, footprintAreaSquareMeters: geometry.area, footprintPerimeterMeters: geometry.perimeter, compactness: geometry.compactness, convexHullAreaSquareMeters: geometry.convexHullArea, convexityRatio: geometry.convexityRatio, concavePocketAreaSquareMeters: geometry.concavePocketArea, concavePocketRatio: geometry.concavePocketRatio, totalNavigableAreaSquareMeters: totalArea, navigableComponentCount: componentFacts.length, largestNavigableComponentAreaSquareMeters: largestArea, largestNavigableComponentRatio: totalArea > 0 ? largestArea / totalArea : null, fragmentComponentCount: fragments.length, fragmentAreaSquareMeters: fragmentArea, fragmentAreaRatio: totalArea > 0 ? fragmentArea / totalArea : null, navigableComponents: componentFacts, fragmentPolygonsOrCells: fragments, gridMeters: navRoom.gridMeters, status: "measured", confidence, diagnostics: totalArea === 0 ? ["功能空间范围内没有任何 furnished 可通行网格；保留零面积测量事实，不作质量判断"] : [], missingData: [] };
}

export function measureS1SpaceFragments(handoff: EvaluationHandoff, graph: RoomConnectivityGraph, navigation?: RoomNavigationAnalysis): S1SpaceFragmentReport {
  const roomById = new Map(graph.roomAnalysis.rooms.map((room) => [room.roomRegionId, room])), matchByZone = new Map(graph.roomAnalysis.zoneMatches.map((match) => [match.zoneId, match]));
  const coded = handoff.zones.filter((zone) => isSdiSpaceFunctionCode(zone.spaceFunctionCode)), indoor = coded.filter((zone) => indoorCode(zone.spaceFunctionCode as SdiSpaceFunctionCode));
  if (!indoor.length) return { metricId: CONFIG.metricId, metricName: CONFIG.metricName, status: "not_applicable", ruleVersion: CONFIG.ruleVersion, measurementStatus: CONFIG.measurementStatus, measurements: [], counts: { measured: 0, unableToDetermine: 0, notApplicable: 1, multipleNavigableComponents: 0 }, totals: { fragmentAreaSquareMeters: 0 }, averages: { compactness: null, convexityRatio: null, largestNavigableComponentRatio: null }, diagnostics: ["项目中没有带合法 SDI 编码的室内功能空间（SF00–SF33）"] };
  let resolvedNavigation = navigation;
  if (!resolvedNavigation) { try { resolvedNavigation = buildRoomNavigationAnalysis(handoff); } catch { resolvedNavigation = undefined; } }
  const navByRoom = new Map((resolvedNavigation?.rooms ?? []).map((room) => [room.roomRegionId, room]));
  const candidates: Candidate[] = indoor.map((zone) => { const match = matchByZone.get(zone.id) ?? null, roomId = reliableMatch(match) ? match!.matchedRoomRegionIds[0]! : null; return { zone, code: zone.spaceFunctionCode as SdiSpaceFunctionCode, match, room: roomId ? roomById.get(roomId) ?? null : null }; });
  const measurements: S1SpaceFragmentMeasurement[] = candidates.filter((candidate) => !candidate.room || !candidate.match || !reliableMatch(candidate.match) || !candidate.room.usableForEvaluation || !validZoneOutline(candidate.zone.outline as Ring | undefined)).map((candidate) => unable(candidate, [`${candidate.zone.name ?? candidate.zone.id} 无法可靠映射到可评价 RoomRegion 或缺少有效 Zone 几何`], [`${candidate.zone.id}: 可靠 Zone–RoomRegion 映射和有效 polygon`]));
  const groups = new Map<string, Candidate[]>();
  candidates.filter((candidate) => candidate.room && candidate.match && reliableMatch(candidate.match) && candidate.room.usableForEvaluation && validZoneOutline(candidate.zone.outline as Ring | undefined)).forEach((candidate) => { const key = `${candidate.code}:${candidate.room!.roomRegionId}`; groups.set(key, [...(groups.get(key) ?? []), candidate]); });
  for (const group of [...groups.values()].sort((a, b) => `${a[0]!.zone.levelId}:${a[0]!.room!.roomRegionId}:${a[0]!.code}`.localeCompare(`${b[0]!.zone.levelId}:${b[0]!.room!.roomRegionId}:${b[0]!.code}`))) {
    const first = group[0]!;
    measurements.push(measureGroup(first.code, first.room!, group.map((item) => item.zone), navByRoom.get(first.room!.roomRegionId) ?? null, group.map((item) => item.match!)));
  }
  measurements.sort((a, b) => `${a.levelId ?? ""}:${a.roomRegionId ?? ""}:${a.spaceFunctionCode}:${a.spaceInstanceId}`.localeCompare(`${b.levelId ?? ""}:${b.roomRegionId ?? ""}:${b.spaceFunctionCode}:${b.spaceInstanceId}`));
  const measured = measurements.filter((item) => item.status === "measured"), unableToDetermine = measurements.filter((item) => item.status === "unable_to_determine").length;
  return { metricId: CONFIG.metricId, metricName: CONFIG.metricName, status: "measured", ruleVersion: CONFIG.ruleVersion, measurementStatus: CONFIG.measurementStatus, measurements, counts: { measured: measured.length, unableToDetermine, notApplicable: 0, multipleNavigableComponents: measured.filter((item) => (item.navigableComponentCount ?? 0) > 1).length }, totals: { fragmentAreaSquareMeters: measured.reduce((sum, item) => sum + (item.fragmentAreaSquareMeters ?? 0), 0) }, averages: { compactness: finiteAverage(measured.map((item) => item.compactness)), convexityRatio: finiteAverage(measured.map((item) => item.convexityRatio)), largestNavigableComponentRatio: finiteAverage(measured.map((item) => item.largestNavigableComponentRatio)) }, diagnostics: [...(!resolvedNavigation ? ["无法建立 furnished 自由网格；相关空间返回 unable_to_determine"] : []), ...(coded.length > indoor.length ? [`已排除 ${coded.length - indoor.length} 个 SF50 及以上户外 Zone`] : [])] };
}
