import type { NodeData } from "../types";
import { resolveEffectiveHeight } from "../geometry/effective-building";
import { physicalBeamSurfacesForNode, type BeamSnap, type BeamSurface } from "./beam-positioning";

export type BeamElevation = { meters: number; basis: "explicit-ceiling-height" | "derived-default-2700mm" };
export type SupportedBeamTopElevation = { meters: number; basis: "wall-top"; sourceWallId: string; measurementBasis: "explicit" | "derived" };
export type BeamSupport = { objectId: string; kind: "wall" | "column" | "beam"; face: BeamSurface["face"] };
export type BeamNode = NodeData & { type: "beam"; name: string; start: [number, number]; end: [number, number]; width: number; height: number; ceilingIds: string[]; effectiveCeilingElevation?: BeamElevation; topElevation?: SupportedBeamTopElevation; supports?: { start: BeamSupport; end: BeamSupport }; explicitCeilingCrossing?: true };
export type BeamValidation = { valid: boolean; beam: BeamNode | null; diagnostics: string[] };

export const DEFAULT_BEAM_WIDTH_METERS = .3;
export const DEFAULT_BEAM_HEIGHT_METERS = .5;
export const DERIVED_CEILING_ELEVATION_METERS = 2.7;
export const BEAM_EDIT_INCREMENT_METERS = .005;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function beamTopElevationMeters(node: NodeData): number {
  const beam = node as Partial<BeamNode>;
  const top = beam.topElevation?.meters ?? beam.effectiveCeilingElevation?.meters;
  return finite(top) ? top : 0;
}
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

/** Orthogonal lock projects a live authoring candidate onto its dominant world axis. */
export const constrainBeamEnd = (start: [number, number], end: [number, number], orthogonal: boolean): [number, number] => {
  if (!orthogonal) return end;
  const dx = end[0] - start[0], dz = end[1] - start[1];
  return Math.abs(dx) >= Math.abs(dz) ? [end[0], start[1]] : [start[0], end[1]];
};
export const quantizeBeamMeters = (value: number) => Math.round(value / BEAM_EDIT_INCREMENT_METERS) * BEAM_EDIT_INCREMENT_METERS;

export type BeamEdit = { name?: string; start?: [number, number]; end?: [number, number]; width?: number; height?: number; /** A physical face supplies the already 5 mm-parameterized plan point. */ surfaceResolved?: boolean };
export function editBeam(nodes: Record<string, NodeData>, beam: BeamNode, edit: BeamEdit): BeamValidation {
  const resolvePlan = edit.surfaceResolved ? (value: number) => value : quantizeBeamMeters;
  // Section/name edits cannot change the Ceiling polygons crossed by the
  // existing axis, so preserve imported explicit-crossing evidence.
  if (edit.start === undefined && edit.end === undefined) {
    const width = quantizeBeamMeters(edit.width ?? beam.width), height = quantizeBeamMeters(edit.height ?? beam.height);
    if (!finite(width) || width <= 0 || !finite(height) || height <= 0) return { valid: false, beam: null, diagnostics: ["Beam 宽度和高度必须为正数（米）。"] };
    const updated = { ...beam, name: edit.name?.trim() || beam.name, width, height };
    return beam.supports ? validateBeam(updated, { ...nodes, [updated.id]: updated }) : { valid: true, beam: updated, diagnostics: [] };
  }
  const start = (edit.start ?? beam.start).map(resolvePlan) as [number, number], end = (edit.end ?? beam.end).map(resolvePlan) as [number, number];
  const width = quantizeBeamMeters(edit.width ?? beam.width), height = quantizeBeamMeters(edit.height ?? beam.height);
  if (beam.supports) {
    const updated = { ...beam, name: edit.name?.trim() || beam.name, start, end, width, height };
    return validateBeam(updated, { ...nodes, [updated.id]: updated });
  }
  return createBeam(nodes, { id: beam.id, name: edit.name?.trim() || beam.name, levelId: beam.parentId!, start, end, width, height, explicitCeilingCrossing: beam.explicitCeilingCrossing });
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

export function validateBeam(raw: unknown, nodes: Record<string, NodeData>, visiting = new Set<string>()): BeamValidation {
  if (!raw || typeof raw !== "object") return { valid: false, beam: null, diagnostics: ["Beam 必须是对象。"] };
  const value = raw as Partial<BeamNode>, start = planPoint(value.start), end = planPoint(value.end), diagnostics: string[] = [];
  if (value.type !== "beam") diagnostics.push("节点不是 Beam。");
  if (typeof value.id !== "string" || !value.id) diagnostics.push("Beam 缺少稳定 ID。");
  if (typeof value.parentId !== "string" || nodes[value.parentId]?.type !== "level") diagnostics.push("Beam 必须直接属于一个 Level。");
  if (!start || !end || Math.hypot((end?.[0] ?? 0) - (start?.[0] ?? 0), (end?.[1] ?? 0) - (start?.[1] ?? 0)) < 1e-8) diagnostics.push("Beam 需要两个不同的有限平面端点。");
  if (!finite(value.width) || value.width <= 0 || !finite(value.height) || value.height <= 0) diagnostics.push("Beam 宽度和高度必须为正数（米）。");
  if (value.supports || value.topElevation) {
    const id = typeof value.id === "string" ? value.id : "";
    if (id && visiting.has(id)) return { valid: false, beam: null, diagnostics: ["Beam 支承关系不能形成循环。"] };
    if (id) visiting.add(id);
    const result = validateSupportedBeam(value, nodes, start, end, diagnostics, visiting);
    if (id) visiting.delete(id);
    return result;
  }
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
    if (elevations.size > 1 && value.explicitCeilingCrossing !== true) diagnostics.push("Beam 不能跨越不同有效标高的 Ceiling。");
    if (new Set(hosts.map((host) => host.elevation.basis)).size > 1 && value.explicitCeilingCrossing !== true) diagnostics.push("Beam 不能混用明确和推导的 Ceiling 标高依据。");
    const source = value.explicitCeilingCrossing ? resolveBeamCeilings(nodes, parentId, start!, start!)[0] : hosts[0];
    const resolved = source?.elevation;
    if (resolved && (resolved.meters !== elevation!.meters || resolved.basis !== elevation!.basis)) diagnostics.push("Beam 记录的 Ceiling 标高或依据与宿主 Ceiling 不一致。");
  }
  if (diagnostics.length) return { valid: false, beam: null, diagnostics };
  return { valid: true, beam: value as BeamNode, diagnostics: [] };
}

function validateSupportedBeam(value: Partial<BeamNode>, nodes: Record<string, NodeData>, start: [number, number] | null, end: [number, number] | null, diagnostics: string[], visiting: Set<string>): BeamValidation {
  const supports = value.supports;
  const top = value.topElevation;
  if (!supports || !top || !finite(top.meters) || top.meters <= 0 || top.basis !== "wall-top" || typeof top.sourceWallId !== "string" || !["explicit", "derived"].includes(top.measurementBasis)) diagnostics.push("Beam 缺少有效墙顶标高及测量依据。");
  if (!supports || supports.start?.kind !== "wall" || !["wall", "column", "beam"].includes(supports.end?.kind)) diagnostics.push("Beam 起点必须支承于 Wall，终点必须支承于 Wall、Column 或 Beam 的物理表面。");
  if (!supports || !start || !end || diagnostics.length) return { valid: false, beam: null, diagnostics };
  const levelId = value.parentId!;
  const supportTop = (support: BeamSupport): { meters: number; source?: "explicit" | "derived" } | null => {
    const host = nodes[support.objectId];
    if (!host || host.type !== support.kind || levelFor(nodes, host) !== levelId) return null;
    if (support.kind === "wall") {
      const resolved = resolveEffectiveHeight(host, nodes).height;
      return resolved && finite(resolved.value) && resolved.value > 0 ? { meters: resolved.value, source: resolved.source === "explicit" ? "explicit" : "derived" } : null;
    }
    if (support.kind === "column") {
      const height = finite(host.height) && host.height > 0 ? host.height : 2.5;
      const position = Array.isArray(host.position) ? host.position : [];
      return { meters: (finite(position[1]) ? position[1] : 0) + height, source: finite(host.height) ? "explicit" : "derived" };
    }
    const supportedBeam = host as Partial<BeamNode>;
    if (host.id === value.id || beamSupportChainContains(support.objectId, value.id ?? "", nodes, new Set())) return null;
    if (!validateBeam(host, nodes, visiting).valid) return null;
    if (!finite(supportedBeam.width) || supportedBeam.width <= 0 || !finite(supportedBeam.height) || supportedBeam.height <= 0) return null;
    const meters = beamTopElevationMeters(host);
    return meters > 0 ? { meters, source: supportedBeam.topElevation?.measurementBasis ?? (supportedBeam.effectiveCeilingElevation?.basis === "explicit-ceiling-height" ? "explicit" : "derived") } : null;
  };
  const startTop = supportTop(supports.start), endTop = supportTop(supports.end);
  if (!startTop) diagnostics.push("Beam 起点 Wall 无效或不属于同一 Level。");
  if (!endTop) diagnostics.push("Beam 终点支承无效或不属于同一 Level。");
  if (startTop && endTop && Math.abs(startTop.meters - endTop.meters) > 1e-6) diagnostics.push("Beam 两端支承的有效顶标高必须相同。");
  if (startTop && top && (top.sourceWallId !== supports.start.objectId || Math.abs(top.meters - startTop.meters) > 1e-6 || top.measurementBasis !== startTop.source)) diagnostics.push("Beam 记录的墙顶标高或测量依据与起点 Wall 不一致。");
  const surfaceAt = (support: BeamSupport, endpoint: [number, number]) => {
    const surface = physicalBeamSurfacesForNode(nodes[support.objectId]!).filter((item) => item.face === support.face && item.kind === support.kind).map((item) => ({ item, distance: pointSegmentDistance(endpoint, item.start, item.end) })).sort((a, b) => a.distance - b.distance)[0];
    return surface && surface.distance <= .006 ? surface.item : null;
  };
  const startSurface = surfaceAt(supports.start, start), endSurface = surfaceAt(supports.end, end);
  if (!startSurface) diagnostics.push("Beam 起点必须位于指定 Wall 的物理侧面。");
  if (!endSurface) diagnostics.push("Beam 终点必须位于指定支承的物理表面。");
  const direction: [number, number] = [end[0] - start[0], end[1] - start[1]];
  const startNormal = startSurface && physicalSurfaceOutwardNormal(startSurface, nodes[supports.start.objectId]!);
  const endNormal = endSurface && physicalSurfaceOutwardNormal(endSurface, nodes[supports.end.objectId]!);
  if (startNormal && direction[0] * startNormal[0] + direction[1] * startNormal[1] <= 1e-7) diagnostics.push("Beam 必须从起点支承面向外延伸，不得进入 Wall。");
  if (endNormal && direction[0] * endNormal[0] + direction[1] * endNormal[1] >= -1e-7) diagnostics.push("Beam 必须从外侧到达终点支承面，不得进入 Wall、Column 或 Beam。");
  if (diagnostics.length) return { valid: false, beam: null, diagnostics };
  return { valid: true, beam: value as BeamNode, diagnostics: [] };
}

function beamSupportChainContains(id: string, soughtId: string, nodes: Record<string, NodeData>, visited: Set<string>): boolean {
  if (id === soughtId) return true;
  if (visited.has(id)) return false;
  visited.add(id);
  const beam = nodes[id] as Partial<BeamNode> | undefined;
  const nextIds = [beam?.supports?.start?.objectId, beam?.supports?.end?.objectId].filter((next): next is string => typeof next === "string" && next.length > 0);
  return nextIds.some((next) => beamSupportChainContains(next, soughtId, nodes, visited));
}

function physicalSurfaceOutwardNormal(surface: BeamSurface, host: NodeData): [number, number] | null {
  const dx = surface.end[0] - surface.start[0], dz = surface.end[1] - surface.start[1], span = Math.hypot(dx, dz);
  if (span < 1e-8) return null;
  const left: [number, number] = [-dz / span, dx / span];
  if (host.type === "wall") return surface.face === "side-a" ? [-left[0], -left[1]] : left;
  if (host.type === "column") return [-left[0], -left[1]];
  const beam = host as Partial<BeamNode>, axisLength = beam.start && beam.end ? Math.hypot(beam.end[0] - beam.start[0], beam.end[1] - beam.start[1]) : 0;
  if (axisLength < 1e-8 || !beam.start || !beam.end) return null;
  const axis: [number, number] = [(beam.end[0] - beam.start[0]) / axisLength, (beam.end[1] - beam.start[1]) / axisLength];
  if (surface.face === "side-a") return [-axis[1], axis[0]];
  if (surface.face === "side-b") return [axis[1], -axis[0]];
  return surface.face === "end-a" ? [-axis[0], -axis[1]] : axis;
}

function pointSegmentDistance(point: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared < 1e-12 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSquared));
  return Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dz * t));
}

export function createSupportedBeam(nodes: Record<string, NodeData>, input: { id: string; name: string; levelId: string; start: BeamSnap; end: BeamSnap; width?: number; height?: number }): BeamValidation {
  const startWall = nodes[input.start.target.id];
  if (!startWall || startWall.type !== "wall") return { valid: false, beam: null, diagnostics: ["Beam 起点必须支承于 Wall 物理侧面。"] };
  const resolved = resolveEffectiveHeight(startWall, nodes).height;
  if (!resolved || !finite(resolved.value) || resolved.value <= 0) return { valid: false, beam: null, diagnostics: ["Beam 起点 Wall 缺少有效高度。"] };
  const topElevation: SupportedBeamTopElevation = {
    meters: resolved.value,
    basis: "wall-top",
    sourceWallId: startWall.id,
    measurementBasis: resolved.source === "explicit" ? "explicit" : "derived",
  };
  const beam: BeamNode = {
    id: input.id, type: "beam", parentId: input.levelId, name: input.name,
    start: input.start.point, end: input.end.point,
    width: input.width ?? DEFAULT_BEAM_WIDTH_METERS,
    height: input.height ?? DEFAULT_BEAM_HEIGHT_METERS,
    ceilingIds: [], topElevation,
    supports: {
      start: { objectId: input.start.target.id, kind: input.start.target.kind as "wall", face: input.start.target.face },
      end: { objectId: input.end.target.id, kind: input.end.target.kind as "wall" | "column" | "beam", face: input.end.target.face },
    },
  };
  return validateBeam(beam, { ...nodes, [beam.id]: beam });
}

export function createBeam(nodes: Record<string, NodeData>, input: { id: string; name: string; levelId: string; start: [number, number]; end: [number, number]; width?: number; height?: number; explicitCeilingCrossing?: boolean }): BeamValidation {
  const hosts = resolveBeamCeilings(nodes, input.levelId, input.start, input.end), elevations = [...new Set(hosts.map((host) => host.elevation.meters))];
  if (!hosts.length) return { valid: false, beam: null, diagnostics: ["Beam 必须与至少一个 Ceiling 相交。"] };
  if (elevations.length !== 1 && !input.explicitCeilingCrossing) return { valid: false, beam: null, diagnostics: ["Beam 不能跨越不同有效标高的 Ceiling。"] };
  if (new Set(hosts.map((host) => host.elevation.basis)).size !== 1 && !input.explicitCeilingCrossing) return { valid: false, beam: null, diagnostics: ["Beam 不能混用明确和推导的 Ceiling 标高依据。"] };
  const crossesElevation = elevations.length !== 1 || new Set(hosts.map((host) => host.elevation.basis)).size !== 1;
  const explicitCeilingCrossing = Boolean(input.explicitCeilingCrossing && crossesElevation);
  const source = explicitCeilingCrossing ? resolveBeamCeilings(nodes, input.levelId, input.start, input.start)[0] : hosts[0];
  if (!source) return { valid: false, beam: null, diagnostics: ["Beam 起点必须位于有效 Ceiling。"] };
  const elevation = source.elevation, beam: BeamNode = { id: input.id, type: "beam", parentId: input.levelId, name: input.name, start: input.start, end: input.end, width: input.width ?? DEFAULT_BEAM_WIDTH_METERS, height: input.height ?? DEFAULT_BEAM_HEIGHT_METERS, ceilingIds: hosts.map((host) => host.id), effectiveCeilingElevation: elevation, ...(explicitCeilingCrossing ? { explicitCeilingCrossing: true } : {}) };
  return validateBeam(beam, { ...nodes, [beam.id]: beam });
}
