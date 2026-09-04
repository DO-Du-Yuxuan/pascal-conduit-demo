import polygonClipping from "polygon-clipping";
import { Diagnostic, NodeData } from "../types";
import { resolveAncestorLevelId } from "./transform";
import { buildExperimentalWalls, getWallArcData, isCurvedWall, Wall } from "./walls";

export const POSITION_TOLERANCE_M = 0.001;
export const INNER_CHAIN_OFFSET_M = 0.45;
export const OVERALL_CHAIN_OFFSET_M = 0.85;
export const EXTENSION_OVERSHOOT_M = 0.1;
const COLLINEAR_TOLERANCE = 1e-6;
const CHAIN_TOLERANCE_M = 0.001;

export type Point = [number, number];
export type DimensionWitnessPoint = { id: string; point: Point; scalarOnRun: number; sourceNodeId: string; sourceKind: "exterior-run-start" | "exterior-run-end" | "exterior-wall-junction" | "door-left" | "door-right" | "window-left" | "window-right"; sourcePath: string };
export type ExteriorBoundarySegment = { start: Point; end: Point; sourceWallIds: string[] };
export type ExteriorDimensionRun = { id: string; levelId: string; componentId: string; start: Point; end: Point; direction: Point; outwardNormal: Point; sourceWallIds: string[]; boundarySegments: ExteriorBoundarySegment[]; lengthMeters: number };
export type DimensionSegment = { id: string; chainId: string; levelId: string; componentId: string; runId: string; dimensionLayer: "inner-chain" | "overall"; start: Point; end: Point; valueMeters: number; displayMillimeters: string; direction: Point; outwardNormal: Point; sourceStart: DimensionWitnessPoint; sourceEnd: DimensionWitnessPoint; sourceWallIds: string[]; sourceOpeningIds: string[]; sourcePaths: string[]; method: "projected-world-distance"; unionAlgorithm: "polygon-clipping.union" };
export type DimensionDisplayGeometry = { edgeStart: Point; edgeEnd: Point; faceStart: Point; faceEnd: Point };
export type ExteriorRing = { componentId: string; ringId: string; points: Point[]; signedArea: number; winding: "clockwise" | "counterclockwise"; sourceWallIds: string[] };
export type ExteriorDimensionReport = { levelId: string; rings: ExteriorRing[]; runs: ExteriorDimensionRun[]; dimensions: DimensionSegment[]; diagnostics: Diagnostic[]; summary: { exteriorComponentCount: number; exteriorRingCount: number; interiorRingCount: number; exteriorRunCount: number; innerChainCount: number; innerSegmentCount: number; overallDimensionCount: number; exteriorDoorCount: number; exteriorWindowCount: number; excludedInteriorOpeningCount: number; curvedExteriorRunCount: number; unresolvedRunCount: number; chainSumMismatchCount: number; dimensionTextUnresolvedCollisionCount: number } };

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const add = (a: Point, b: Point, scale = 1): Point => [a[0] + b[0] * scale, a[1] + b[1] * scale];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const normalize = (a: Point): Point => { const length = Math.hypot(a[0], a[1]); return length > 1e-12 ? [a[0] / length, a[1] / length] : [0, 0]; };
const unique = (values: string[]) => [...new Set(values)];
const snapCoordinate = (value: number) => Math.round(value / POSITION_TOLERANCE_M) * POSITION_TOLERANCE_M;
const snapPoint = (point: Point): Point => [snapCoordinate(point[0]), snapCoordinate(point[1])];
const pointLineDistance = (point: Point, start: Point, end: Point) => { const edge = sub(end, start), length = Math.hypot(...edge); return length < 1e-12 ? distance(point, start) : Math.abs(cross(edge, sub(point, start))) / length; };
const segmentOverlapsEdge = (a: Point, b: Point, edgeA: Point, edgeB: Point) => {
  const direction = normalize(sub(b, a));
  if (distance(a, b) <= POSITION_TOLERANCE_M || distance(edgeA, edgeB) <= POSITION_TOLERANCE_M) return false;
  if (pointLineDistance(edgeA, a, b) > POSITION_TOLERANCE_M || pointLineDistance(edgeB, a, b) > POSITION_TOLERANCE_M) return false;
  const edgeScalars = [dot(sub(edgeA, a), direction), dot(sub(edgeB, a), direction)].sort((left, right) => left - right);
  return Math.min(distance(a, b), edgeScalars[1]!) - Math.max(0, edgeScalars[0]!) > POSITION_TOLERANCE_M;
};

export function signedRingArea(points: Point[]) { return points.reduce((area, point, index) => { const next = points[(index + 1) % points.length]!; return area + point[0] * next[1] - next[0] * point[1]; }, 0) / 2; }
export function formatDimensionMetersToMillimeters(valueMeters: number) { return String(Math.round(valueMeters * 1000)); }
export function uprightDimensionAngle(direction: Point, viewRotationDegrees = 0) { let degrees = Math.atan2(direction[1], direction[0]) * 180 / Math.PI, screen = ((degrees + viewRotationDegrees + 180) % 360 + 360) % 360 - 180; if (screen > 90 || screen <= -90) degrees += 180; return degrees; }

export function buildExteriorDimensions(nodes: Record<string, NodeData>, levelId: string): ExteriorDimensionReport {
  const diagnostics: Diagnostic[] = [], walls = Object.values(nodes).filter((node) => node.type === "wall" && resolveAncestorLevelId(node.id, nodes).levelId === levelId) as Wall[];
  const built = buildExperimentalWalls(walls).filter((wall) => wall.validation.valid && wall.footprint.length >= 3);
  const emptySummary = { exteriorComponentCount: 0, exteriorRingCount: 0, interiorRingCount: 0, exteriorRunCount: 0, innerChainCount: 0, innerSegmentCount: 0, overallDimensionCount: 0, exteriorDoorCount: 0, exteriorWindowCount: 0, excludedInteriorOpeningCount: 0, curvedExteriorRunCount: 0, unresolvedRunCount: 0, chainSumMismatchCount: 0, dimensionTextUnresolvedCollisionCount: 0 };
  if (!built.length) return { levelId, rings: [], runs: [], dimensions: [], diagnostics: [{ severity: "warning", code: "no_exterior_contour", message: "当前 Level 没有可用于外围尺寸的有效墙体 footprint", sourcePath: `nodes` }], summary: emptySummary };
  let union: any;
  try {
    // polygon-clipping requires coincident wall corners to be byte-identical. Pascal
    // wall miters can differ by floating-point noise, so only the derived union input
    // is snapped to the named 1 mm position tolerance. Source nodes/footprints stay intact.
    const geometries = built.map((wall) => [[wall.footprint.map((point) => snapPoint([point.x, point.y]))]] as any), [first, ...rest] = geometries;
    union = polygonClipping.union(first, ...rest);
  }
  catch { return { levelId, rings: [], runs: [], dimensions: [], diagnostics: [{ severity: "error", code: "exterior_union_failed", message: "墙体 physical footprint polygon union 失败", sourcePath: "derived.exterior-dimensions" }], summary: emptySummary }; }
  if (!Array.isArray(union) || !union.length) return { levelId, rings: [], runs: [], dimensions: [], diagnostics: [{ severity: "warning", code: "no_exterior_contour", message: "Polygon union 未生成外轮廓", sourcePath: "derived.exterior-dimensions" }], summary: emptySummary };
  const rings: ExteriorRing[] = [], runs: ExteriorDimensionRun[] = [];
  let interiorRingCount = 0, curvedExteriorRunCount = 0, unresolvedRunCount = 0;
  union.forEach((polygon: any, componentIndex: number) => {
    const componentId = `component-${componentIndex + 1}`; interiorRingCount += Math.max(0, polygon.length - 1);
    const raw = polygon[0] as number[][], points = raw.slice(0, raw.length > 1 && distance(raw[0] as Point, raw[raw.length - 1] as Point) <= POSITION_TOLERANCE_M ? -1 : undefined).map((point) => [point[0], point[1]] as Point);
    if (points.length < 3 || Math.abs(signedRingArea(points)) < 1e-9) { diagnostics.push({ severity: "error", code: "invalid_exterior_ring", message: `无效外围 ring：${componentId}`, sourcePath: "derived.exterior-dimensions" }); return; }
    const area = signedRingArea(points), boundary = points.map((start, index) => {
      const end = points[(index + 1) % points.length]!, sourceWallIds = built.filter((builtWall) => {
        const footprint = builtWall.footprint.map((point) => [point.x, point.y] as Point);
        return footprint.some((edgeStart, edgeIndex) => segmentOverlapsEdge(start, end, edgeStart, footprint[(edgeIndex + 1) % footprint.length]!));
      }).map((wall) => wall.wallId);
      return { start, end, sourceWallIds };
    });
    const ringWallIds = unique(boundary.flatMap((segment) => segment.sourceWallIds));
    rings.push({ componentId, ringId: `${componentId}-outer`, points, signedArea: area, winding: area > 0 ? "counterclockwise" : "clockwise", sourceWallIds: ringWallIds });
    type Candidate = ExteriorBoundarySegment & { direction: Point; curved: boolean; unresolved: boolean; boundarySegments: ExteriorBoundarySegment[] };
    const candidates: Candidate[] = boundary.map((segment) => ({ ...segment, direction: normalize(sub(segment.end, segment.start)), curved: segment.sourceWallIds.some((id) => isCurvedWall(walls.find((wall) => wall.id === id)!)), unresolved: segment.sourceWallIds.length === 0, boundarySegments: [segment] }));
    const merged: Candidate[] = [];
    for (const candidate of candidates) {
      const previous = merged[merged.length - 1];
      if (previous && !previous.unresolved && !candidate.unresolved && previous.curved === candidate.curved && Math.abs(cross(previous.direction, candidate.direction)) <= COLLINEAR_TOLERANCE && dot(previous.direction, candidate.direction) > 0) {
        previous.end = candidate.end; previous.sourceWallIds = unique([...previous.sourceWallIds, ...candidate.sourceWallIds]); previous.boundarySegments.push(...candidate.boundarySegments);
      } else merged.push({ ...candidate, sourceWallIds: [...candidate.sourceWallIds] });
    }
    if (merged.length > 1) { const first = merged[0]!, last = merged[merged.length - 1]!; if (!first.unresolved && !last.unresolved && first.curved === last.curved && Math.abs(cross(last.direction, first.direction)) <= COLLINEAR_TOLERANCE && dot(last.direction, first.direction) > 0) { first.start = last.start; first.sourceWallIds = unique([...last.sourceWallIds, ...first.sourceWallIds]); first.boundarySegments = [...last.boundarySegments, ...first.boundarySegments]; merged.pop(); } }
    merged.forEach((candidate, index) => {
      const runId = `${componentId}-run-${index + 1}`, lengthMeters = distance(candidate.start, candidate.end), direction = normalize(sub(candidate.end, candidate.start)), outwardNormal: Point = area > 0 ? [direction[1], -direction[0]] : [-direction[1], direction[0]];
      if (candidate.unresolved) { unresolvedRunCount += 1; diagnostics.push({ severity: "error", code: "ambiguous_exterior_wall_mapping", message: `外围边界无法映射到来源 Wall：${runId}`, sourcePath: "derived.exterior-dimensions" }); return; }
      if (candidate.curved) { curvedExteriorRunCount += 1; const curvedIds = candidate.sourceWallIds.filter((id) => isCurvedWall(walls.find((wall) => wall.id === id)!)); for (const wallId of curvedIds) { const wall = walls.find((item) => item.id === wallId)!, arc = getWallArcData(wall); diagnostics.push({ severity: "warning", code: "unsupported_curved_exterior_dimension", message: `曲墙外围段本轮不生成直线尺寸：${wallId}; radius=${arc?.radius ?? "unknown"}; sweep=${arc?.delta ?? "unknown"}`, nodeId: wallId, sourcePath: `nodes.${wallId}.curveOffset` }); } return; }
      if (lengthMeters > POSITION_TOLERANCE_M) runs.push({ id: runId, levelId, componentId, start: candidate.start, end: candidate.end, direction, outwardNormal, sourceWallIds: candidate.sourceWallIds, boundarySegments: candidate.boundarySegments, lengthMeters });
    });
  });
  if (union.length > 1) diagnostics.push({ severity: "info", code: "multiple_exterior_components", message: `检测到 ${union.length} 个互不连接的外围组件`, sourcePath: "derived.exterior-dimensions" });
  const dimensions: DimensionSegment[] = [], exteriorDoorIds = new Set<string>(), exteriorWindowIds = new Set<string>(); let excludedInteriorOpeningCount = 0, chainSumMismatchCount = 0;
  for (const run of runs) {
    const witnesses: DimensionWitnessPoint[] = [witness(run, 0, "exterior-run-start", run.id), witness(run, run.lengthMeters, "exterior-run-end", run.id)];
    const collinearWalls = run.sourceWallIds.map((wallId) => walls.find((item) => item.id === wallId)).filter((wall): wall is Wall => Boolean(wall)).filter((wall) => Math.abs(cross(normalize([wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]]), run.direction)) <= COLLINEAR_TOLERANCE);
    if (collinearWalls.length > 1) for (const wall of collinearWalls) for (const endpoint of [wall.start, wall.end]) { const scalar = dot(sub([endpoint[0], endpoint[1]], run.start), run.direction); if (scalar > POSITION_TOLERANCE_M && scalar < run.lengthMeters - POSITION_TOLERANCE_M && pointLineDistance([endpoint[0], endpoint[1]], run.start, run.end) <= Math.max((wall.thickness ?? .1) / 2 + POSITION_TOLERANCE_M, POSITION_TOLERANCE_M)) witnesses.push(witness(run, scalar, "exterior-wall-junction", wall.id)); }
    const openings = Object.values(nodes).filter((node) => (node.type === "door" || node.type === "window") && resolveAncestorLevelId(node.id, nodes).levelId === levelId);
    for (const opening of openings) {
      const wallId = opening.wallId ?? opening.parentId;
      if (!run.sourceWallIds.includes(wallId)) continue;
      const wall = walls.find((item) => item.id === wallId), width = Number(opening.width), centerDistance = Array.isArray(opening.position) ? Number(opening.position[0]) : NaN;
      if (!wall || !Number.isFinite(width) || width <= 0 || !Number.isFinite(centerDistance)) { diagnostics.push({ severity: "error", code: "invalid_opening_span_for_dimension", message: `无效 ${opening.type} opening span`, nodeId: opening.id, sourcePath: `nodes.${opening.id}` }); continue; }
      const wallDirection = normalize([wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]]), center: Point = [wall.start[0] + wallDirection[0] * centerDistance, wall.start[1] + wallDirection[1] * centerDistance];
      const edgeA = add(center, wallDirection, -width / 2), edgeB = add(center, wallDirection, width / 2), scalars = [dot(sub(edgeA, run.start), run.direction), dot(sub(edgeB, run.start), run.direction)].sort((a, b) => a - b);
      if (scalars[0]! < -POSITION_TOLERANCE_M || scalars[1]! > run.lengthMeters + POSITION_TOLERANCE_M || Math.abs((scalars[1]! - scalars[0]!) - width) > CHAIN_TOLERANCE_M) { diagnostics.push({ severity: "warning", code: "opening_not_on_exterior_run", message: `${opening.type} opening span 不在外墙 run 有效范围`, nodeId: opening.id, sourcePath: `nodes.${opening.id}` }); continue; }
      const prefix = opening.type as "door" | "window"; witnesses.push(witness(run, Math.max(0, scalars[0]!), `${prefix}-left`, opening.id), witness(run, Math.min(run.lengthMeters, scalars[1]!), `${prefix}-right`, opening.id)); if (prefix === "door") exteriorDoorIds.add(opening.id); else exteriorWindowIds.add(opening.id);
    }
    const sorted = witnesses.sort((a, b) => a.scalarOnRun - b.scalarOnRun), deduped: DimensionWitnessPoint[] = [];
    for (const item of sorted) { const previous = deduped[deduped.length - 1]; if (previous && Math.abs(item.scalarOnRun - previous.scalarOnRun) <= POSITION_TOLERANCE_M) { if (item.sourceNodeId !== previous.sourceNodeId) diagnostics.push({ severity: "info", code: "duplicate_dimension_witness", message: `尺寸基准点按 ${POSITION_TOLERANCE_M}m 容差去重`, sourcePath: item.sourcePath }); continue; } deduped.push(item); }
    if (deduped.length > 2) { for (let index = 0; index < deduped.length - 1; index += 1) { const start = deduped[index]!, end = deduped[index + 1]!, value = end.scalarOnRun - start.scalarOnRun; if (value <= POSITION_TOLERANCE_M) { diagnostics.push({ severity: "error", code: "invalid_dimension_segment", message: `零长度外围尺寸段：${run.id}`, sourcePath: "derived.exterior-dimensions" }); continue; } dimensions.push(dimension(run, start, end, "inner-chain", index + 1)); } const sum = dimensions.filter((item) => item.runId === run.id && item.dimensionLayer === "inner-chain").reduce((total, item) => total + item.valueMeters, 0); if (Math.abs(sum - run.lengthMeters) > CHAIN_TOLERANCE_M) { chainSumMismatchCount += 1; diagnostics.push({ severity: "error", code: "dimension_chain_sum_mismatch", message: `${run.id} 分段和 ${sum}m 不等于总长 ${run.lengthMeters}m`, sourcePath: "derived.exterior-dimensions" }); } }
    dimensions.push(dimension(run, deduped[0]!, deduped[deduped.length - 1]!, "overall", 1));
  }
  const exteriorOpeningIds = new Set([...exteriorDoorIds, ...exteriorWindowIds]); excludedInteriorOpeningCount = Object.values(nodes).filter((node) => (node.type === "door" || node.type === "window") && resolveAncestorLevelId(node.id, nodes).levelId === levelId && !exteriorOpeningIds.has(node.id)).length;
  let dimensionTextUnresolvedCollisionCount = 0;
  for (const chainId of new Set(dimensions.filter((item) => item.dimensionLayer === "inner-chain").map((item) => item.chainId))) {
    const shortLabels = dimensions.filter((item) => item.chainId === chainId).filter((item) => item.valueMeters <= Math.max(.24, item.displayMillimeters.length * .105) + .16).map((item) => ({ item, start: item.sourceEnd.scalarOnRun + .14, end: item.sourceEnd.scalarOnRun + .14 + Math.max(.24, item.displayMillimeters.length * .105) })).sort((left, right) => left.start - right.start);
    for (let index = 1; index < shortLabels.length; index += 1) if (shortLabels[index]!.start < shortLabels[index - 1]!.end - POSITION_TOLERANCE_M) { dimensionTextUnresolvedCollisionCount += 1; diagnostics.push({ severity: "warning", code: "dimension_text_collision_unresolved", message: `短尺寸外置文字仍有碰撞风险：${shortLabels[index]!.item.id}`, sourcePath: "derived.exterior-dimensions" }); }
  }
  return { levelId, rings, runs, dimensions, diagnostics, summary: { exteriorComponentCount: union.length, exteriorRingCount: rings.length, interiorRingCount, exteriorRunCount: runs.length, innerChainCount: new Set(dimensions.filter((item) => item.dimensionLayer === "inner-chain").map((item) => item.chainId)).size, innerSegmentCount: dimensions.filter((item) => item.dimensionLayer === "inner-chain").length, overallDimensionCount: dimensions.filter((item) => item.dimensionLayer === "overall").length, exteriorDoorCount: exteriorDoorIds.size, exteriorWindowCount: exteriorWindowIds.size, excludedInteriorOpeningCount, curvedExteriorRunCount, unresolvedRunCount, chainSumMismatchCount, dimensionTextUnresolvedCollisionCount } };
}

function witness(run: ExteriorDimensionRun, scalarOnRun: number, sourceKind: DimensionWitnessPoint["sourceKind"], sourceNodeId: string): DimensionWitnessPoint { return { id: `${run.id}-${sourceKind}-${sourceNodeId}-${scalarOnRun.toFixed(6)}`, point: add(run.start, run.direction, scalarOnRun), scalarOnRun, sourceNodeId, sourceKind, sourcePath: sourceNodeId === run.id ? "derived.exterior-run" : `nodes.${sourceNodeId}` }; }
function dimension(run: ExteriorDimensionRun, start: DimensionWitnessPoint, end: DimensionWitnessPoint, layer: DimensionSegment["dimensionLayer"], index: number): DimensionSegment { const valueMeters = Math.abs(end.scalarOnRun - start.scalarOnRun); return { id: `${run.id}-${layer}-${index}`, chainId: `${run.id}-${layer}`, levelId: run.levelId, componentId: run.componentId, runId: run.id, dimensionLayer: layer, start: start.point, end: end.point, valueMeters, displayMillimeters: formatDimensionMetersToMillimeters(valueMeters), direction: run.direction, outwardNormal: run.outwardNormal, sourceStart: start, sourceEnd: end, sourceWallIds: run.sourceWallIds, sourceOpeningIds: unique([start, end].filter((item) => item.sourceKind.startsWith("door") || item.sourceKind.startsWith("window")).map((item) => item.sourceNodeId)), sourcePaths: unique([start.sourcePath, end.sourcePath]), method: "projected-world-distance", unionAlgorithm: "polygon-clipping.union" }; }

const axis = (direction: Point): "horizontal" | "vertical" | "diagonal" => Math.abs(direction[0]) >= 1 - COLLINEAR_TOLERANCE ? "horizontal" : Math.abs(direction[1]) >= 1 - COLLINEAR_TOLERANCE ? "vertical" : "diagonal";
const ringBounds = (ring: ExteriorRing) => ({ minX: Math.min(...ring.points.map((point) => point[0])), maxX: Math.max(...ring.points.map((point) => point[0])), minY: Math.min(...ring.points.map((point) => point[1])), maxY: Math.max(...ring.points.map((point) => point[1])) });
const runOnComponentEnvelope = (run: ExteriorDimensionRun, ring: ExteriorRing) => { const bounds = ringBounds(ring); if (axis(run.direction) === "horizontal") return Math.abs(run.start[1] - (run.outwardNormal[1] < 0 ? bounds.minY : bounds.maxY)) <= POSITION_TOLERANCE_M; if (axis(run.direction) === "vertical") return Math.abs(run.start[0] - (run.outwardNormal[0] < 0 ? bounds.minX : bounds.maxX)) <= POSITION_TOLERANCE_M; return false; };

function componentFrameDimension(report: ExteriorDimensionReport, ring: ExteriorRing, side: "top" | "right" | "bottom" | "left"): DimensionSegment {
  const bounds = ringBounds(ring), horizontal = side === "top" || side === "bottom", start: Point = side === "top" ? [bounds.minX, bounds.minY] : side === "right" ? [bounds.maxX, bounds.minY] : side === "bottom" ? [bounds.maxX, bounds.maxY] : [bounds.minX, bounds.maxY], end: Point = side === "top" ? [bounds.maxX, bounds.minY] : side === "right" ? [bounds.maxX, bounds.maxY] : side === "bottom" ? [bounds.minX, bounds.maxY] : [bounds.minX, bounds.minY], direction = normalize(sub(end, start)), outwardNormal: Point = side === "top" ? [0, -1] : side === "right" ? [1, 0] : side === "bottom" ? [0, 1] : [-1, 0], valueMeters = horizontal ? bounds.maxX - bounds.minX : bounds.maxY - bounds.minY, runId = `${ring.componentId}-frame-${side}`;
  const sourceStart: DimensionWitnessPoint = { id: `${runId}-start`, point: start, scalarOnRun: 0, sourceNodeId: ring.ringId, sourceKind: "exterior-run-start", sourcePath: "derived.exterior-ring.bounds" }, sourceEnd: DimensionWitnessPoint = { id: `${runId}-end`, point: end, scalarOnRun: valueMeters, sourceNodeId: ring.ringId, sourceKind: "exterior-run-end", sourcePath: "derived.exterior-ring.bounds" };
  return { id: `${runId}-overall`, chainId: `${runId}-overall`, levelId: report.levelId, componentId: ring.componentId, runId, dimensionLayer: "overall", start, end, valueMeters, displayMillimeters: formatDimensionMetersToMillimeters(valueMeters), direction, outwardNormal, sourceStart, sourceEnd, sourceWallIds: ring.sourceWallIds, sourceOpeningIds: [], sourcePaths: ["derived.exterior-ring.bounds"], method: "projected-world-distance", unionAlgorithm: "polygon-clipping.union" };
}

export function buildAlignedDimensionDisplay(report: ExteriorDimensionReport): DimensionSegment[] {
  const displayed = report.dimensions.filter((item) => {
    if (item.dimensionLayer === "inner-chain" || axis(item.direction) === "diagonal") return true;
    const run = report.runs.find((entry) => entry.id === item.runId), ring = report.rings.find((entry) => entry.componentId === item.componentId);
    return !run || !ring || !runOnComponentEnvelope(run, ring);
  });
  for (const ring of report.rings) {
    const componentRuns = report.runs.filter((run) => run.componentId === ring.componentId);
    const sides = new Set<"top" | "right" | "bottom" | "left">();
    for (const run of componentRuns) {
      if (!runOnComponentEnvelope(run, ring)) continue;
      if (axis(run.direction) === "horizontal") sides.add(run.outwardNormal[1] < 0 ? "top" : "bottom");
      if (axis(run.direction) === "vertical") sides.add(run.outwardNormal[0] < 0 ? "left" : "right");
    }
    for (const side of sides) displayed.push(componentFrameDimension(report, ring, side));
  }
  return displayed;
}

export function dimensionDisplayGeometry(report: ExteriorDimensionReport, item: DimensionSegment): DimensionDisplayGeometry {
  const ring = report.rings.find((entry) => entry.componentId === item.componentId), run = report.runs.find((entry) => entry.id === item.runId);
  if (!ring || !run || !runOnComponentEnvelope(run, ring) || item.dimensionLayer !== "inner-chain" || axis(item.direction) === "diagonal") return { edgeStart: item.start, edgeEnd: item.end, faceStart: item.start, faceEnd: item.end };
  const bounds = ringBounds(ring);
  if (axis(item.direction) === "horizontal") { const y = item.outwardNormal[1] < 0 ? bounds.minY : bounds.maxY; return { edgeStart: item.start, edgeEnd: item.end, faceStart: [item.start[0], y], faceEnd: [item.end[0], y] }; }
  const x = item.outwardNormal[0] < 0 ? bounds.minX : bounds.maxX; return { edgeStart: item.start, edgeEnd: item.end, faceStart: [x, item.start[1]], faceEnd: [x, item.end[1]] };
}

export function dimensionOverlayBounds(report: ExteriorDimensionReport) { return buildAlignedDimensionDisplay(report).flatMap((item) => { const geometry = dimensionDisplayGeometry(report, item), offset = item.dimensionLayer === "inner-chain" ? INNER_CHAIN_OFFSET_M : OVERALL_CHAIN_OFFSET_M, start = add(geometry.faceStart, item.outwardNormal, offset), end = add(geometry.faceEnd, item.outwardNormal, offset), textPadding = Math.max(.25, item.displayMillimeters.length * .055); return [geometry.edgeStart, geometry.edgeEnd, add(start, item.outwardNormal, EXTENSION_OVERSHOOT_M), add(end, item.outwardNormal, EXTENSION_OVERSHOOT_M), add(start, item.direction, -textPadding), add(end, item.direction, textPadding)].map((point) => ({ x: point[0], z: point[1] })); }); }
