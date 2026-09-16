import type { NodeData } from "../types";

export type BeamElevation = { meters: number; basis: "explicit-ceiling-height" | "derived-default-2700mm" };
export type BeamNode = NodeData & { type: "beam"; name: string; start: [number, number]; end: [number, number]; width: number; height: number; ceilingIds: string[]; effectiveCeilingElevation: BeamElevation };
export type BeamValidation = { valid: boolean; beam: BeamNode | null; diagnostics: string[] };

export const DEFAULT_BEAM_WIDTH_METERS = .3;
export const DEFAULT_BEAM_HEIGHT_METERS = .5;
export const DERIVED_CEILING_ELEVATION_METERS = 2.7;
export const BEAM_EDIT_INCREMENT_METERS = .005;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const planPoint = (value: unknown): [number, number] | null => Array.isArray(value) && finite(value[0]) && finite(value[1]) ? [value[0], value[1]] : null;
const cross = (a: [number, number], b: [number, number], c: [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (a: [number, number], b: [number, number], point: [number, number]) => Math.min(a[0], b[0]) - 1e-9 <= point[0] && point[0] <= Math.max(a[0], b[0]) + 1e-9 && Math.min(a[1], b[1]) - 1e-9 <= point[1] && point[1] <= Math.max(a[1], b[1]) + 1e-9;
const intersects = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]) => {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return (Math.sign(abC) !== Math.sign(abD) && Math.sign(cdA) !== Math.sign(cdB)) || Math.abs(abC) < 1e-9 && onSegment(a, b, c) || Math.abs(abD) < 1e-9 && onSegment(a, b, d) || Math.abs(cdA) < 1e-9 && onSegment(c, d, a) || Math.abs(cdB) < 1e-9 && onSegment(c, d, b);
};
const pointInPolygon = (point: [number, number], polygon: [number, number][]) => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!, b = polygon[previous]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
export const segmentIntersectsPolygon = (start: [number, number], end: [number, number], polygon: [number, number][]) => polygon.length >= 3 && (pointInPolygon(start, polygon) || pointInPolygon(end, polygon) || polygon.some((point, index) => intersects(start, end, point, polygon[(index + 1) % polygon.length]!)));
const levelFor = (nodes: Record<string, NodeData>, node: NodeData): string | null => { let current: NodeData | undefined = node; const seen = new Set<string>(); while (current && !seen.has(current.id)) { seen.add(current.id); if (current.type === "level") return current.id; current = current.parentId ? nodes[current.parentId] : undefined; } return null; };
const ceilingElevation = (node: NodeData): BeamElevation => finite(node.height) && node.height > 0 ? { meters: node.height, basis: "explicit-ceiling-height" } : { meters: DERIVED_CEILING_ELEVATION_METERS, basis: "derived-default-2700mm" };

/** The authoring tool keeps diagonals unless the current pointer holds Shift. */
export const constrainBeamEnd = (start: [number, number], end: [number, number], orthogonal: boolean): [number, number] => {
  if (!orthogonal) return end;
  const dx = end[0] - start[0], dz = end[1] - start[1];
  return Math.abs(dx) >= Math.abs(dz) ? [end[0], start[1]] : [start[0], end[1]];
};
export const quantizeBeamMeters = (value: number) => Math.round(value / BEAM_EDIT_INCREMENT_METERS) * BEAM_EDIT_INCREMENT_METERS;

export type BeamEdit = { name?: string; start?: [number, number]; end?: [number, number]; width?: number; height?: number; /** A physical face supplies the already 5 mm-parameterized plan point. */ surfaceResolved?: boolean };
export function editBeam(nodes: Record<string, NodeData>, beam: BeamNode, edit: BeamEdit): BeamValidation {
  const resolvePlan = edit.surfaceResolved ? (value: number) => value : quantizeBeamMeters;
  const start = (edit.start ?? beam.start).map(resolvePlan) as [number, number], end = (edit.end ?? beam.end).map(resolvePlan) as [number, number];
  const width = quantizeBeamMeters(edit.width ?? beam.width), height = quantizeBeamMeters(edit.height ?? beam.height);
  return createBeam(nodes, { id: beam.id, name: edit.name?.trim() || beam.name, levelId: beam.parentId!, start, end, width, height });
}
export const translateBeam = (nodes: Record<string, NodeData>, beam: BeamNode, delta: [number, number]) => editBeam(nodes, beam, { start: [beam.start[0] + delta[0], beam.start[1] + delta[1]], end: [beam.end[0] + delta[0], beam.end[1] + delta[1]] });
export const nudgeBeamLaterally = (nodes: Record<string, NodeData>, beam: BeamNode, distance: number) => {
  const dx = beam.end[0] - beam.start[0], dz = beam.end[1] - beam.start[1], length = Math.hypot(dx, dz);
  return length < 1e-8 ? { valid: false, beam: null, diagnostics: ["Beam 轴线无效，不能横向移动。"] } : translateBeam(nodes, beam, [-dz / length * distance, dx / length * distance]);
};
export const resizeBeamLength = (nodes: Record<string, NodeData>, beam: BeamNode, length: number) => {
  const dx = beam.end[0] - beam.start[0], dz = beam.end[1] - beam.start[1], current = Math.hypot(dx, dz);
  return current < 1e-8 ? { valid: false, beam: null, diagnostics: ["Beam 轴线无效，不能改变长度。"] } : editBeam(nodes, beam, { end: [beam.start[0] + dx / current * length, beam.start[1] + dz / current * length] });
};

export function resolveBeamCeilings(nodes: Record<string, NodeData>, levelId: string, start: [number, number], end: [number, number]) {
  return Object.values(nodes).filter((node) => node.type === "ceiling" && levelFor(nodes, node) === levelId).flatMap((node) => {
    const polygon = Array.isArray(node.polygon) ? node.polygon.map(planPoint).filter((point): point is [number, number] => Boolean(point)) : [];
    return segmentIntersectsPolygon(start, end, polygon) ? [{ id: node.id, elevation: ceilingElevation(node) }] : [];
  });
}

export function validateBeam(raw: unknown, nodes: Record<string, NodeData>): BeamValidation {
  if (!raw || typeof raw !== "object") return { valid: false, beam: null, diagnostics: ["Beam 必须是对象。"] };
  const value = raw as Partial<BeamNode>, start = planPoint(value.start), end = planPoint(value.end), diagnostics: string[] = [];
  if (value.type !== "beam") diagnostics.push("节点不是 Beam。");
  if (typeof value.id !== "string" || !value.id) diagnostics.push("Beam 缺少稳定 ID。");
  if (typeof value.parentId !== "string" || nodes[value.parentId]?.type !== "level") diagnostics.push("Beam 必须直接属于一个 Level。");
  if (!start || !end || Math.hypot((end?.[0] ?? 0) - (start?.[0] ?? 0), (end?.[1] ?? 0) - (start?.[1] ?? 0)) < 1e-8) diagnostics.push("Beam 需要两个不同的有限平面端点。");
  if (!finite(value.width) || value.width <= 0 || !finite(value.height) || value.height <= 0) diagnostics.push("Beam 宽度和高度必须为正数（米）。");
  const ceilingIds = Array.isArray(value.ceilingIds) ? value.ceilingIds : [];
  if (!ceilingIds.length || ceilingIds.some((id) => typeof id !== "string" || nodes[id]?.type !== "ceiling")) diagnostics.push("Beam 必须关联至少一个有效 Ceiling。");
  const elevation = value.effectiveCeilingElevation;
  if (!elevation || !finite(elevation.meters) || elevation.meters <= 0 || !["explicit-ceiling-height", "derived-default-2700mm"].includes(elevation.basis)) diagnostics.push("Beam 缺少有效 Ceiling 标高及依据。");
  if (!diagnostics.length) {
    const parentId = value.parentId!;
    const hosts = resolveBeamCeilings(nodes, parentId, start!, end!);
    const intersectedIds = new Set(hosts.map((host) => host.id));
    if (new Set(ceilingIds).size !== ceilingIds.length || ceilingIds.length !== intersectedIds.size || ceilingIds.some((id) => !intersectedIds.has(id))) diagnostics.push("Beam 必须完整且唯一地记录与其轴线相交、位于同一 Level 的 Ceiling。");
    if (!hosts.length) diagnostics.push("Beam 轴线必须与至少一个 Ceiling 相交。");
    const elevations = new Set(hosts.map((host) => host.elevation.meters));
    if (elevations.size > 1) diagnostics.push("Beam 不能跨越不同有效标高的 Ceiling。");
    if (new Set(hosts.map((host) => host.elevation.basis)).size > 1) diagnostics.push("Beam 不能混用明确和推导的 Ceiling 标高依据。");
    const resolved = hosts[0]?.elevation;
    if (resolved && (resolved.meters !== elevation!.meters || resolved.basis !== elevation!.basis)) diagnostics.push("Beam 记录的 Ceiling 标高或依据与宿主 Ceiling 不一致。");
  }
  if (diagnostics.length) return { valid: false, beam: null, diagnostics };
  return { valid: true, beam: value as BeamNode, diagnostics: [] };
}

export function createBeam(nodes: Record<string, NodeData>, input: { id: string; name: string; levelId: string; start: [number, number]; end: [number, number]; width?: number; height?: number }): BeamValidation {
  const hosts = resolveBeamCeilings(nodes, input.levelId, input.start, input.end), elevations = [...new Set(hosts.map((host) => host.elevation.meters))];
  if (!hosts.length) return { valid: false, beam: null, diagnostics: ["Beam 必须与至少一个 Ceiling 相交。"] };
  if (elevations.length !== 1) return { valid: false, beam: null, diagnostics: ["Beam 不能跨越不同有效标高的 Ceiling。"] };
  if (new Set(hosts.map((host) => host.elevation.basis)).size !== 1) return { valid: false, beam: null, diagnostics: ["Beam 不能混用明确和推导的 Ceiling 标高依据。"] };
  const elevation = hosts[0]!.elevation, beam: BeamNode = { id: input.id, type: "beam", parentId: input.levelId, name: input.name, start: input.start, end: input.end, width: input.width ?? DEFAULT_BEAM_WIDTH_METERS, height: input.height ?? DEFAULT_BEAM_HEIGHT_METERS, ceilingIds: hosts.map((host) => host.id), effectiveCeilingElevation: elevation };
  return validateBeam(beam, { ...nodes, [beam.id]: beam });
}
