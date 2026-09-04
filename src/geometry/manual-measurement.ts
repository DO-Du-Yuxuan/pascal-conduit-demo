import { NodeData } from "../types";
import { composePascalTransformWithWorldToSvg, finalDimensions, resolveAncestorLevelId, resolveItemPlanTransform } from "./transform";
import { buildExperimentalWalls, Wall } from "./walls";
import { hasValidShelfFootprint, shelfCorners } from "./shelf";

export type MeasurementUnit = "millimeters" | "feet-inches";
export type MeasurementMode = "off" | "aligned" | "horizontal" | "vertical";
export type MeasurementPoint = [number, number];
export type MeasurementSnapKind = "free" | "wall-corner" | "wall-edge" | "furniture-corner" | "furniture-edge" | "shelf-corner" | "shelf-edge";
export type MeasurementSnap = { point: MeasurementPoint; kind: MeasurementSnapKind; sourceNodeId?: string; distanceMeters: number };
export type ManualMeasurement = { id: string; levelId: string; mode: Exclude<MeasurementMode, "off">; start: MeasurementSnap; end: MeasurementSnap; createdAt: number };
export type MeasurementSegment = { start: MeasurementPoint; end: MeasurementPoint };
export type ManualMeasurementGeometry = { measurementStart: MeasurementPoint; measurementEnd: MeasurementPoint; extensionLines: MeasurementSegment[]; valueMeters: number; direction: MeasurementPoint; normal: MeasurementPoint; labelPoint: MeasurementPoint };

type SnapSegment = { start: MeasurementPoint; end: MeasurementPoint; sourceNodeId: string; sourceType: "wall" | "furniture" | "shelf" };

const distance = (a: MeasurementPoint, b: MeasurementPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const normalize = (point: MeasurementPoint): MeasurementPoint => { const length = Math.hypot(point[0], point[1]); return length > 1e-12 ? [point[0] / length, point[1] / length] : [1, 0]; };
const polygonSegments = (points: MeasurementPoint[], sourceNodeId: string, sourceType: SnapSegment["sourceType"]): SnapSegment[] => points.map((start, index) => ({ start, end: points[(index + 1) % points.length]!, sourceNodeId, sourceType }));
const transformedItemCorners = (node: NodeData, nodes: Record<string, NodeData>): MeasurementPoint[] => {
  const dimensions = finalDimensions(node), transform = resolveItemPlanTransform(node.id, nodes);
  if (!dimensions || transform.status !== "ok") return [];
  const matrix = composePascalTransformWithWorldToSvg(transform);
  return [[-dimensions.width / 2, -dimensions.depth / 2], [dimensions.width / 2, -dimensions.depth / 2], [dimensions.width / 2, dimensions.depth / 2], [-dimensions.width / 2, dimensions.depth / 2]].map(([x, y]) => [matrix.a * x + matrix.c * y + matrix.e, matrix.b * x + matrix.d * y + matrix.f]);
};

export function buildMeasurementSnapSegments(nodes: Record<string, NodeData>, levelId: string): SnapSegment[] {
  const levelNodes = Object.values(nodes).filter((node) => resolveAncestorLevelId(node.id, nodes).levelId === levelId), segments: SnapSegment[] = [];
  const walls = buildExperimentalWalls(levelNodes.filter((node) => node.type === "wall") as Wall[]);
  for (const wall of walls) if (wall.validation.valid && wall.footprint.length >= 3) segments.push(...polygonSegments(wall.footprint.map((point) => [point.x, point.y]), wall.wallId, "wall"));
  for (const node of levelNodes) {
    if (node.type === "item") { const corners = transformedItemCorners(node, nodes); if (corners.length === 4) segments.push(...polygonSegments(corners, node.id, "furniture")); }
    if (node.type === "shelf" && hasValidShelfFootprint(node)) { const corners = shelfCorners(node, nodes).map((point) => [point.x, point.z] as MeasurementPoint); if (corners.length === 4) segments.push(...polygonSegments(corners, node.id, "shelf")); }
  }
  return segments;
}

const closestPointOnSegment = (point: MeasurementPoint, segment: SnapSegment): MeasurementPoint => {
  const dx = segment.end[0] - segment.start[0], dy = segment.end[1] - segment.start[1], lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-18) return segment.start;
  const t = Math.max(0, Math.min(1, ((point[0] - segment.start[0]) * dx + (point[1] - segment.start[1]) * dy) / lengthSquared));
  return [segment.start[0] + dx * t, segment.start[1] + dy * t];
};

const snapKind = (sourceType: SnapSegment["sourceType"], corner: boolean): MeasurementSnapKind => sourceType === "wall" ? corner ? "wall-corner" : "wall-edge" : sourceType === "shelf" ? corner ? "shelf-corner" : "shelf-edge" : corner ? "furniture-corner" : "furniture-edge";

export function snapMeasurementPoint(point: MeasurementPoint, segments: SnapSegment[], toleranceMeters: number): MeasurementSnap {
  let nearestCorner: MeasurementSnap | null = null;
  for (const segment of segments) for (const corner of [segment.start, segment.end]) { const gap = distance(point, corner); if (gap <= toleranceMeters && (!nearestCorner || gap < nearestCorner.distanceMeters)) nearestCorner = { point: corner, kind: snapKind(segment.sourceType, true), sourceNodeId: segment.sourceNodeId, distanceMeters: gap }; }
  if (nearestCorner) return nearestCorner;
  let nearestEdge: MeasurementSnap | null = null;
  for (const segment of segments) { const projected = closestPointOnSegment(point, segment), gap = distance(point, projected); if (gap <= toleranceMeters && (!nearestEdge || gap < nearestEdge.distanceMeters)) nearestEdge = { point: projected, kind: snapKind(segment.sourceType, false), sourceNodeId: segment.sourceNodeId, distanceMeters: gap }; }
  return nearestEdge ?? { point, kind: "free", distanceMeters: 0 };
}

const gcd = (left: number, right: number): number => right ? gcd(right, left % right) : left;
export function formatMeasurement(valueMeters: number, unit: MeasurementUnit): string {
  if (unit === "millimeters") return String(Math.round(valueMeters * 1000));
  const sign = valueMeters < 0 ? "−" : "", totalSixteenths = Math.round(Math.abs(valueMeters) * 39.37007874015748 * 16), feet = Math.floor(totalSixteenths / 192), remainder = totalSixteenths % 192, inches = Math.floor(remainder / 16), fraction = remainder % 16;
  if (!fraction) return `${sign}${feet}'-${inches}\"`;
  const divisor = gcd(fraction, 16);
  return `${sign}${feet}'-${inches} ${fraction / divisor}/${16 / divisor}\"`;
}

export function formatArea(valueSquareMeters: number, unit: MeasurementUnit): string {
  return unit === "millimeters" ? `${valueSquareMeters.toFixed(2)} m²` : `${(valueSquareMeters * 10.76391041671).toFixed(2)} ft²`;
}

export function buildManualMeasurementGeometry(start: MeasurementPoint, end: MeasurementPoint, mode: Exclude<MeasurementMode, "off">): ManualMeasurementGeometry {
  let measurementEnd = end, extensionLines: MeasurementSegment[] = [];
  if (mode === "horizontal") { measurementEnd = [end[0], start[1]]; if (distance(end, measurementEnd) > 1e-9) extensionLines = [{ start: end, end: measurementEnd }]; }
  if (mode === "vertical") { measurementEnd = [start[0], end[1]]; if (distance(end, measurementEnd) > 1e-9) extensionLines = [{ start: end, end: measurementEnd }]; }
  const vector: MeasurementPoint = [measurementEnd[0] - start[0], measurementEnd[1] - start[1]], valueMeters = Math.hypot(vector[0], vector[1]), direction = normalize(vector), normal: MeasurementPoint = [-direction[1], direction[0]], labelPoint: MeasurementPoint = [(start[0] + measurementEnd[0]) / 2, (start[1] + measurementEnd[1]) / 2];
  return { measurementStart: start, measurementEnd, extensionLines, valueMeters, direction, normal, labelPoint };
}

export function resolveMeasurementMode(start: MeasurementPoint | null, end: MeasurementPoint | null, orthogonal: boolean): Exclude<MeasurementMode, "off"> {
  if (!orthogonal || !start || !end) return "aligned";
  return Math.abs(end[0] - start[0]) >= Math.abs(end[1] - start[1]) ? "horizontal" : "vertical";
}
