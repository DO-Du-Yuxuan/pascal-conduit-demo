import { resolveAncestorLevelId, resolveItemPlanTransform, resolveWallOpeningTransform, type ViewBox } from "../geometry/transform";
import { finalDimensions } from "../geometry/transform";
import { shelfCorners } from "../geometry/shelf";
import { stairCorners } from "../geometry/stairs";
import { zonePoints } from "../geometry/zone";
import type { NodeData } from "../types";
import type { EvaluationFocusTarget } from "./presentation";
import type { RoomRegionAnalysis } from "../evaluation/room-regions";

export type EvaluationHighlight = { ruleId: string; primaryId: string; relatedIds: string[]; emphasizedIds?: string[]; pathPoints?: Array<{ levelId: string; point: [number, number] }>; secondaryPathPoints?: Array<{ levelId: string; point: [number, number] }>; crossingPoints?: Array<{ levelId: string; point: [number, number] }>; overlapSegments?: Array<{ levelId: string; start: [number, number]; end: [number, number] }>; hpePocPaths?: { yuka: Array<{ levelId: string; point: [number, number] }>; visibilityGraph: Array<{ levelId: string; point: [number, number] }> }; hpeDebugTrace?: { rawGridSegments: Array<{ roomRegionId: string; levelId: string; points: Array<[number, number]> }>; smoothedSegments: Array<{ roomRegionId: string; levelId: string; points: Array<[number, number]> }>; portalPoints: Array<{ doorId?: string; stairId?: string; levelId: string; point: [number, number] }>; sourceAnchor: { levelId: string; point: [number, number] } | null; targetAnchor: { levelId: string; point: [number, number] } | null }; spaceBoundaryPolygons?: Array<{ levelId: string; rings: Array<Array<[number, number]>> }>; primaryNavigableCells?: Array<{ levelId: string; point: [number, number]; gridMeters: number }>; fragmentNavigableCells?: Array<{ levelId: string; point: [number, number]; gridMeters: number }>; furnitureMinimumUsePolygons?: Array<{ levelId: string; polygon: Array<[number, number]> }>; furnitureOpeningPolygons?: Array<{ levelId: string; polygon: Array<[number, number]> }>; furnitureRelationLine?: { levelId: string; start: [number, number]; end: [number, number] }; targetIndex: number; status?: EvaluationFocusTarget["status"] };
export type EvaluationFocusResolution = { renderable: boolean; levelId: string | null; viewBox: ViewBox | null; reason?: string };

const finitePoint = (value: unknown): value is number[] => Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite);
const viewAround = (points: Array<{ x: number; z: number }>, minimumSpan = 2.4, padding = .55): ViewBox | null => {
  if (!points.length || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.z))) return null;
  const xs = points.map((point) => point.x), zs = points.map((point) => point.z), rawWidth = Math.max(...xs) - Math.min(...xs), rawHeight = Math.max(...zs) - Math.min(...zs), width = Math.max(minimumSpan, rawWidth + padding * 2), height = Math.max(minimumSpan, rawHeight + padding * 2), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  return { minX: cx - width / 2, minZ: cz - height / 2, width, height };
};

export const evaluationPathViewBox = (points: Array<[number, number]>) => viewAround(points.map(([x, z]) => ({ x, z })), 2.4, .8);

export function resolveEvaluationFocus(nodes: Record<string, NodeData>, objectId: string, roomAnalysis?: RoomRegionAnalysis | null): EvaluationFocusResolution {
  const node = nodes[objectId];
  if (!node) {
    const room = roomAnalysis?.rooms.find((item) => item.roomRegionId === objectId), roomPoints = room?.polygons.flatMap((polygon) => polygon.flatMap((ring) => ring.map(([x, z]) => ({ x, z }))));
    if (room && roomPoints?.length) return { renderable: true, levelId: room.levelId, viewBox: viewAround(roomPoints) };
    return { renderable: false, levelId: null, viewBox: null, reason: "评价引用的对象已不存在。" };
  }
  const levelId = resolveAncestorLevelId(node.id, nodes).levelId ?? null;
  if (!levelId) return { renderable: false, levelId: null, viewBox: null, reason: "无法确定对象所属楼层。" };
  let points: Array<{ x: number; z: number }> = [];
  if (node.type === "wall" && finitePoint(node.start) && finitePoint(node.end)) points = [{ x: node.start[0], z: node.start[1] }, { x: node.end[0], z: node.end[1] }];
  else if (node.type === "door" || node.type === "window") {
    const transform = resolveWallOpeningTransform(node, nodes), width = Number(node.width);
    if (transform && Number.isFinite(width) && width > 0) { const dx = Math.cos(transform.rotationY) * width / 2, dz = Math.sin(transform.rotationY) * width / 2; points = [{ x: transform.x - dx, z: transform.z - dz }, { x: transform.x + dx, z: transform.z + dz }]; }
  } else if (node.type === "stair") points = stairCorners(node, nodes);
  else if (node.type === "shelf") points = shelfCorners(node, nodes);
  else if (node.type === "zone") points = zonePoints(node);
  else if (node.type === "item") {
    const transform = resolveItemPlanTransform(node.id, nodes), dimensions = finalDimensions(node);
    if (transform.status === "ok" && dimensions) points = [{ x: transform.x - dimensions.width / 2, z: transform.z - dimensions.depth / 2 }, { x: transform.x + dimensions.width / 2, z: transform.z + dimensions.depth / 2 }];
  }
  const viewBox = viewAround(points);
  return viewBox ? { renderable: true, levelId, viewBox } : { renderable: false, levelId, viewBox: null, reason: "该对象暂时无法在画布中显示。" };
}

export function evaluationHighlightFor(ruleId: string, target: EvaluationFocusTarget, targetIndex: number): EvaluationHighlight {
  return { ruleId, primaryId: target.primaryId, relatedIds: [...target.relatedIds], targetIndex, status: target.status };
}

export function evaluationHighlightRole(highlight: EvaluationHighlight | null, objectId: string): "primary" | "emphasized" | "related" | null {
  if (!highlight) return null;
  if (highlight.primaryId === objectId) return "primary";
  if (highlight.emphasizedIds?.includes(objectId)) return "emphasized";
  return highlight.relatedIds.includes(objectId) ? "related" : null;
}
