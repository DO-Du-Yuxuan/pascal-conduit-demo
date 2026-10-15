import type { NodeData } from "../types";
import { getWallCurveFrameAt, isCurvedWall } from "../geometry/walls/curve";
import { DEFAULT_WALL_THICKNESS } from "../geometry/walls/thickness";
import { constrainBeamEnd, editBeam, quantizeBeamMeters, validateBeam, type BeamNode, type BeamValidation } from "./beams";

export type BeamSurfaceKind = "wall" | "column" | "beam" | "ceiling-edge";
export type BeamSurface = { id: string; kind: BeamSurfaceKind; face: "side-a" | "side-b" | "end-a" | "end-b"; start: [number, number]; end: [number, number] };
export type BeamSnap = { point: [number, number]; distance: number; target: BeamSurface };
export type BeamClearanceEdge = "left" | "right" | "start" | "end";
export type BeamClearance = { edge: BeamClearanceEdge; meters: number; witness: BeamSurface };
/** A whole-Beam plan position is expressed against one physical Wall face.
 * Its direction is perpendicular to the Beam's longitudinal axis. */
export type BeamPlanarClearance = { meters: number; witness: BeamSurface; direction: [number, number]; origin: [number, number] };

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const point = (value: unknown): [number, number] | null => Array.isArray(value) && finite(value[0]) && finite(value[1]) ? [value[0], value[1]] : null;
const cross = (a: [number, number], b: [number, number]) => a[0] * b[1] - a[1] * b[0];
const dot = (a: [number, number], b: [number, number]) => a[0] * b[0] + a[1] * b[1];
const subtract = (a: [number, number], b: [number, number]): [number, number] => [a[0] - b[0], a[1] - b[1]];
const add = (a: [number, number], b: [number, number]): [number, number] => [a[0] + b[0], a[1] + b[1]];
const scale = (value: [number, number], distance: number): [number, number] => [value[0] * distance, value[1] * distance];
const length = (value: [number, number]) => Math.hypot(value[0], value[1]);
const normalized = (value: [number, number]): [number, number] | null => { const size = length(value); return size > 1e-8 ? [value[0] / size, value[1] / size] : null; };
const levelFor = (nodes: Record<string, NodeData>, node: NodeData) => { let current: NodeData | undefined = node; const seen = new Set<string>(); while (current && !seen.has(current.id)) { seen.add(current.id); if (current.type === "level") return current.id; current = current.parentId ? nodes[current.parentId] : undefined; } return null; };

const closest = (target: [number, number], start: [number, number], end: [number, number]) => {
  const direction = subtract(end, start), span = dot(direction, direction), t = span < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(subtract(target, start), direction) / span));
  const hit = add(start, scale(direction, t));
  return { point: hit, distance: length(subtract(target, hit)) };
};
const yaw = (node: NodeData) => typeof node.rotation === "number" ? node.rotation : Array.isArray(node.rotation) && finite(node.rotation[1]) ? node.rotation[1] : 0;
const columnSurfaces = (node: NodeData): BeamSurface[] => {
  // Pascal's default Column includes a wider base and capital, and round or
  // profiled shafts have no rectangular side faces. Only expose an exact
  // straight square profile when all nonuniform shaping is explicitly off.
  if ((node.crossSection && node.crossSection !== "square") || (node.shaftProfile && node.shaftProfile !== "straight") ||
    node.baseStyle !== "none" || node.capitalStyle !== "none" || (finite(node.shaftTaper) && node.shaftTaper !== 0) ||
    (finite(node.shaftTwist) && node.shaftTwist !== 0) || (finite(node.shaftBulge) && node.shaftBulge !== 0) ||
    (finite(node.fluteCount) && node.fluteCount > 0) || node.shaftStartScale !== 1 || node.shaftEndScale !== 1 ||
    (node.supportStyle && node.supportStyle !== "vertical") || node.style === "cluster" ||
    (finite(node.shaftTwistStep) && node.shaftTwistStep !== 0) || !(finite(node.shaftCornerRadius) && node.shaftCornerRadius > .001) ||
    (finite(node.ringCount) && node.ringCount > 0) || (finite(node.latheRingCount) && node.latheRingCount > 0) || node.shaftDetail === "lathe-turned") return [];
  const position = Array.isArray(node.position) ? node.position : [0, 0, 0];
  if (!finite(position[0]) || !finite(position[2])) return [];
  const center: [number, number] = [position[0], position[2]];
  const dimensions = Array.isArray(node.asset?.dimensions) ? node.asset.dimensions : [], width = finite(node.width) && node.width > 0 ? node.width : finite(dimensions[0]) && dimensions[0] > 0 ? dimensions[0] : .44, depth = finite(node.depth) && node.depth > 0 ? node.depth : finite(dimensions[2]) && dimensions[2] > 0 ? dimensions[2] : width;
  if (!width || !depth) return [];
  const c = Math.cos(yaw(node)), s = Math.sin(yaw(node)), corners: [number, number][] = [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]].map(([x, z]) => [center[0] + x * c + z * s, center[1] - x * s + z * c]);
  const faces: BeamSurface["face"][] = ["side-a", "end-a", "side-b", "end-b"];
  const bevel = Math.min(Number(node.shaftCornerRadius), Math.min(width, depth) * .35);
  return corners.map((start, index) => {
    const end = corners[(index + 1) % corners.length]!, tangent = normalized(subtract(end, start))!;
    return { id: node.id, kind: "column" as const, face: faces[index]!, start: add(start, scale(tangent, bevel)), end: add(end, scale(tangent, -bevel)) };
  });
};
const wallSurfaces = (node: NodeData): BeamSurface[] => {
  const start = point(node.start), end = point(node.end); if (!start || !end) return [];
  const direction = normalized(subtract(end, start)); if (!direction) return [];
  const thickness = finite(node.thickness) && node.thickness > 0 ? node.thickness : DEFAULT_WALL_THICKNESS;
  const half = thickness / 2, normal: [number, number] = [-direction[1], direction[0]];
  if (isCurvedWall(node as any)) return [-1, 1].flatMap((side) => Array.from({ length: 12 }, (_, index) => {
    const a = getWallCurveFrameAt(node as any, index / 12), b = getWallCurveFrameAt(node as any, (index + 1) / 12);
    return { id: node.id, kind: "wall" as const, face: side < 0 ? "side-a" as const : "side-b" as const, start: [a.point.x + a.normal.x * side * half, a.point.y + a.normal.y * side * half] as [number, number], end: [b.point.x + b.normal.x * side * half, b.point.y + b.normal.y * side * half] as [number, number] };
  }));
  return [-1, 1].map((side) => ({ id: node.id, kind: "wall" as const, face: side < 0 ? "side-a" as const : "side-b" as const, start: add(start, scale(normal, side * half)), end: add(end, scale(normal, side * half)) }));
};
export const beamSurfaces = (beam: BeamNode): BeamSurface[] => {
  const axis = normalized(subtract(beam.end, beam.start)); if (!axis) return [];
  const normal: [number, number] = [-axis[1], axis[0]], half = beam.width / 2;
  return [
    { id: beam.id, kind: "beam", face: "side-a", start: add(beam.start, scale(normal, half)), end: add(beam.end, scale(normal, half)) },
    { id: beam.id, kind: "beam", face: "side-b", start: add(beam.start, scale(normal, -half)), end: add(beam.end, scale(normal, -half)) },
    { id: beam.id, kind: "beam", face: "end-a", start: add(beam.start, scale(normal, half)), end: add(beam.start, scale(normal, -half)) },
    { id: beam.id, kind: "beam", face: "end-b", start: add(beam.end, scale(normal, half)), end: add(beam.end, scale(normal, -half)) },
  ];
};
/** Return physical plan faces for one supported host without validating a
 * Beam host. This keeps endpoint validation free of surface/validator recursion. */
export function physicalBeamSurfacesForNode(node: NodeData): BeamSurface[] {
  if (node.type === "wall") return wallSurfaces(node);
  if (node.type === "column") return columnSurfaces(node);
  if (node.type === "beam") {
    const beam = node as BeamNode;
    return point(beam.start) && point(beam.end) && finite(beam.width) && beam.width > 0 ? beamSurfaces(beam) : [];
  }
  return [];
}
export const beamAuthoringSurfaces = (nodes: Record<string, NodeData>, levelId: string, exceptId?: string) => Object.values(nodes).flatMap((node) => {
  if (node.id === exceptId || levelFor(nodes, node) !== levelId) return [];
  if (node.type === "wall") return wallSurfaces(node);
  if (node.type === "column") return columnSurfaces(node);
  if (node.type === "beam") { const valid = validateBeam(node, nodes).beam; return valid ? beamSurfaces(valid) : []; }
  if (node.type === "ceiling" && Array.isArray(node.polygon)) {
    const polygon = node.polygon.filter(point) as [number, number][];
    return polygon.length >= 3 ? polygon.map((start, index) => ({ id: node.id, kind: "ceiling-edge" as const, face: "side-a" as const, start, end: polygon[(index + 1) % polygon.length]! })) : [];
  }
  return [];
});
export function snapBeamPoint(nodes: Record<string, NodeData>, levelId: string, candidate: [number, number], tolerance = .15, exceptId?: string): BeamSnap | null {
  const matches = beamAuthoringSurfaces(nodes, levelId, exceptId).map((target) => ({ target, ...closest(candidate, target.start, target.end) })).filter((item) => item.distance <= tolerance).sort((a, b) => a.distance - b.distance || a.target.kind.localeCompare(b.target.kind) || a.target.id.localeCompare(b.target.id) || a.target.face.localeCompare(b.target.face));
  const match = matches[0];
  if (!match) return null;
  const segment = subtract(match.target.end, match.target.start), span = length(segment), parameter = span < 1e-8 ? 0 : Math.max(0, Math.min(1, quantizeBeamMeters(dot(subtract(match.point, match.target.start), segment) / span) / span));
  return { point: add(match.target.start, scale(segment, parameter)), distance: match.distance, target: match.target };
}

export type SupportedBeamSnapOptions = { objectId?: string; kind?: "wall" | "column" | "beam"; start?: [number, number]; orthogonal?: boolean; tolerance?: number; exceptId?: string };
/** Snap only to physical Wall, Column, or Beam faces. With orthogonal lock,
 * intersect the locked axis with the finite face so the resulting point keeps
 * the axis constraint. */
export function snapSupportedBeamPoint(nodes: Record<string, NodeData>, levelId: string, candidate: [number, number], options: SupportedBeamSnapOptions = {}): BeamSnap | null {
  const tolerance = options.tolerance ?? .15;
  let projectedCandidate = candidate;
  let axisDirection: [number, number] | null = null;
  if (options.start && options.orthogonal) {
    projectedCandidate = constrainBeamEnd(options.start, candidate, true);
    axisDirection = Math.abs(projectedCandidate[0] - options.start[0]) >= Math.abs(projectedCandidate[1] - options.start[1])
      ? [1, 0] : [0, 1];
  }
  const surfaces = Object.values(nodes).flatMap((node) => {
    if (node.id === options.exceptId || (options.objectId && node.id !== options.objectId) || (options.kind && node.type !== options.kind) || levelFor(nodes, node) !== levelId) return [];
    return physicalBeamSurfacesForNode(node);
  });
  const matches = surfaces.flatMap((target) => {
    if (axisDirection) {
      const faceVector = subtract(target.end, target.start), denom = cross(axisDirection, faceVector);
      if (Math.abs(denom) < 1e-10) return [];
      const delta = subtract(target.start, options.start!);
      const alongFace = cross(delta, axisDirection) / denom;
      const hit = add(target.start, scale(faceVector, alongFace));
      const distance = length(subtract(projectedCandidate, hit));
      return alongFace >= -1e-8 && alongFace <= 1 + 1e-8 && distance <= tolerance ? [{ target, point: hit, distance }] : [];
    }
    const hit = closest(candidate, target.start, target.end);
    return hit.distance <= tolerance ? [{ target, ...hit }] : [];
  }).sort((a, b) => a.distance - b.distance || a.target.kind.localeCompare(b.target.kind) || a.target.id.localeCompare(b.target.id) || a.target.face.localeCompare(b.target.face));
  const match = matches[0];
  if (!match) return null;
  const face = subtract(match.target.end, match.target.start), span = length(face);
  const fraction = span < 1e-8 ? 0 : Math.max(0, Math.min(1, dot(subtract(match.point, match.target.start), face) / (span * span)));
  const snappedFraction = axisDirection ? fraction : Math.max(0, Math.min(1, quantizeBeamMeters(fraction * span) / span));
  const snapped = add(match.target.start, scale(face, snappedFraction));
  if (axisDirection && Math.abs(axisDirection[0]) > .5) snapped[1] = options.start![1];
  if (axisDirection && Math.abs(axisDirection[1]) > .5) snapped[0] = options.start![0];
  return { point: snapped, distance: length(subtract(projectedCandidate, snapped)), target: match.target };
}

const rayHit = (origin: [number, number], direction: [number, number], surface: BeamSurface) => {
  const segment = subtract(surface.end, surface.start), denominator = cross(direction, segment); if (Math.abs(denominator) < 1e-7) return null;
  const offset = subtract(surface.start, origin), distance = cross(offset, segment) / denominator, t = cross(offset, direction) / denominator;
  return distance > 1e-7 && t >= -1e-7 && t <= 1 + 1e-7 ? distance : null;
};
export function beamClearances(nodes: Record<string, NodeData>, beam: BeamNode): BeamClearance[] {
  const axis = normalized(subtract(beam.end, beam.start)); if (!axis) return [];
  const normal: [number, number] = [-axis[1], axis[0]], center = scale(add(beam.start, beam.end), .5), half = beam.width / 2;
  const queries: Array<{ edge: BeamClearanceEdge; origin: [number, number]; direction: [number, number]; parallel: boolean }> = [
    { edge: "left", origin: add(center, scale(normal, half)), direction: normal, parallel: true },
    { edge: "right", origin: add(center, scale(normal, -half)), direction: scale(normal, -1), parallel: true },
    { edge: "start", origin: beam.start, direction: scale(axis, -1), parallel: false },
    { edge: "end", origin: beam.end, direction: axis, parallel: false },
  ];
  // Ceiling edges are endpoint-only authoring targets, never clearance witnesses.
  const surfaces = beamAuthoringSurfaces(nodes, beam.parentId!, beam.id).filter((surface) => surface.kind !== "column" && surface.kind !== "ceiling-edge");
  return queries.flatMap((query) => {
    const hits = surfaces.flatMap((witness) => { const tangent = normalized(subtract(witness.end, witness.start)); if (!tangent || (query.parallel ? Math.abs(cross(tangent, axis)) > 1e-5 : Math.abs(dot(tangent, axis)) > 1e-5)) return []; const meters = rayHit(query.origin, query.direction, witness); return meters === null ? [] : [{ meters, witness }]; }).sort((a, b) => a.meters - b.meters || a.witness.kind.localeCompare(b.witness.kind) || a.witness.id.localeCompare(b.witness.id));
    const hit = hits[0]; return hit ? [{ edge: query.edge, meters: quantizeBeamMeters(hit.meters), witness: hit.witness }] : [];
  });
}
export function editBeamClearance(nodes: Record<string, NodeData>, beam: BeamNode, edge: BeamClearanceEdge, targetMeters: number): BeamValidation {
  const witness = beamClearances(nodes, beam).find((item) => item.edge === edge);
  if (!witness || !finite(targetMeters) || targetMeters < 0) return { valid: false, beam: null, diagnostics: ["Beam 缺少可用物理表面见证，不能编辑该净距。"] };
  const axis = normalized(subtract(beam.end, beam.start))!, normal: [number, number] = [-axis[1], axis[0],], change = quantizeBeamMeters(targetMeters) - witness.meters;
  if (edge === "left") return editBeam(nodes, beam, { start: add(beam.start, scale(normal, -change)), end: add(beam.end, scale(normal, -change)) });
  if (edge === "right") return editBeam(nodes, beam, { start: add(beam.start, scale(normal, change)), end: add(beam.end, scale(normal, change)) });
  if (edge === "start") return editBeam(nodes, beam, { start: add(beam.start, scale(axis, change)) });
  return editBeam(nodes, beam, { end: add(beam.end, scale(axis, -change)) });
}

export function beamPlanarClearances(nodes: Record<string, NodeData>, beam: BeamNode): BeamPlanarClearance[] {
  const axis = normalized(subtract(beam.end, beam.start));
  if (!axis) return [];
  const normal: [number, number] = [-axis[1], axis[0]], center = scale(add(beam.start, beam.end), .5), half = beam.width / 2;
  // One useful position value: cast from the nearest long Beam side in the
  // cross-axis direction to the first physical Wall face.  The wall itself may
  // be angled; the dimension direction never is along the Beam.
  const walls = beamAuthoringSurfaces(nodes, beam.parentId!, beam.id).filter((surface) => surface.kind === "wall");
  const queries: Array<{ origin: [number, number]; direction: [number, number] }> = [
    { origin: add(center, scale(normal, half)), direction: normal },
    { origin: add(center, scale(normal, -half)), direction: scale(normal, -1) },
  ];
  const candidates = queries.flatMap((query) => walls.flatMap((witness) => {
      const meters = rayHit(query.origin, query.direction, witness);
      return meters === null ? [] : [{ meters: quantizeBeamMeters(meters), witness, direction: query.direction, origin: query.origin }];
    })).sort((a, b) => a.meters - b.meters || a.witness.id.localeCompare(b.witness.id) || a.witness.face.localeCompare(b.witness.face));
  return candidates[0] ? [candidates[0]] : [];
}

export function editBeamPlanarClearance(nodes: Record<string, NodeData>, beam: BeamNode, reference: BeamPlanarClearance, targetMeters: number): BeamValidation {
  if (!finite(targetMeters) || targetMeters < 0) return { valid: false, beam: null, diagnostics: ["梁平面净距必须是非负有限数值。"] };
  const current = beamPlanarClearances(nodes, beam).find((candidate) => candidate.witness.id === reference.witness.id && candidate.witness.face === reference.witness.face && dot(candidate.direction, reference.direction) > .999);
  if (!current) return { valid: false, beam: null, diagnostics: ["梁的定位见证面已不可用，请重新选择梁。"] };
  const delta = current.meters - quantizeBeamMeters(targetMeters);
  return editBeam(nodes, beam, { start: add(beam.start, scale(current.direction, delta)), end: add(beam.end, scale(current.direction, delta)) });
}
