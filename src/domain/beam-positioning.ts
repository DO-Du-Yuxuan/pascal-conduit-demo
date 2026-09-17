import type { NodeData } from "../types";
import { getWallCurveFrameAt, isCurvedWall } from "../geometry/walls/curve";
import { DEFAULT_WALL_THICKNESS } from "../geometry/walls/thickness";
import { editBeam, quantizeBeamMeters, validateBeam, type BeamNode, type BeamValidation } from "./beams";

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
  const position = Array.isArray(node.position) ? node.position : [];
  if (!finite(position[0]) || !finite(position[2])) return [];
  const center: [number, number] = [position[0], position[2]];
  const dimensions = Array.isArray(node.asset?.dimensions) ? node.asset.dimensions : [], width = finite(node.width) && node.width > 0 ? node.width : finite(dimensions[0]) && dimensions[0] > 0 ? dimensions[0] : null, depth = finite(node.depth) && node.depth > 0 ? node.depth : finite(dimensions[2]) && dimensions[2] > 0 ? dimensions[2] : width;
  if (!width || !depth) return [];
  const c = Math.cos(yaw(node)), s = Math.sin(yaw(node)), corners: [number, number][] = [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]].map(([x, z]) => [center[0] + x * c + z * s, center[1] - x * s + z * c]);
  return corners.map((start, index) => ({ id: node.id, kind: "column" as const, face: index % 2 ? "side-b" as const : "side-a" as const, start, end: corners[(index + 1) % corners.length]! }));
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
  // One useful position value: from the nearest long Beam side to a parallel
  // physical Wall face, never along the Beam or to an arbitrary diagonal point.
  const walls = beamAuthoringSurfaces(nodes, beam.parentId!, beam.id).filter((surface) => surface.kind === "wall");
  const queries: Array<{ origin: [number, number]; direction: [number, number] }> = [
    { origin: add(center, scale(normal, half)), direction: normal },
    { origin: add(center, scale(normal, -half)), direction: scale(normal, -1) },
  ];
  const candidates = queries.flatMap((query) => walls.flatMap((witness) => {
      const tangent = normalized(subtract(witness.end, witness.start));
      if (!tangent || Math.abs(cross(tangent, axis)) > 1e-5) return [];
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
