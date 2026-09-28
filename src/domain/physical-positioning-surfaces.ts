import earcut from "earcut";
import { finalDimensions, resolveItemPlanTransform, resolveWallOpeningTransform } from "../geometry/transform";
import { getWallCurveFrameAt, isCurvedWall } from "../geometry/walls/curve";
import type { NodeData, Vec3 } from "../types";
import { validateBeam } from "./beams";
import { DEFAULT_WALL_THICKNESS } from "../geometry/walls/thickness";

export type PositioningTriangle = { objectId: string; objectKind: string; vertices: readonly [Vec3, Vec3, Vec3] };
export type PhysicalPositioningHit = { distance: number; objectId: string; objectKind: string; point: Vec3 };

const subtract3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const addScaled3 = (origin: Vec3, direction: Vec3, distance: number): Vec3 => [origin[0] + direction[0] * distance, origin[1] + direction[1] * distance, origin[2] + direction[2] * distance];

/** Shared finite-triangle witness used by 2D and 3D positioning dimensions. */
export function firstPhysicalPositioningHit(origin: Vec3, direction: Vec3, surfaces: readonly PositioningTriangle[], accepts?: (surface: PositioningTriangle) => boolean): PhysicalPositioningHit | undefined {
  const hits = surfaces.flatMap(surface => {
    if (surface.objectKind === "item" || surface.objectKind === "shelf" || surface.objectKind === "cabinet" || surface.objectKind === "cabinet-module") return [];
    if (accepts && !accepts(surface)) return [];
    const [a, b, c] = surface.vertices, edge1 = subtract3(b, a), edge2 = subtract3(c, a);
    const p: Vec3 = [direction[1] * edge2[2] - direction[2] * edge2[1], direction[2] * edge2[0] - direction[0] * edge2[2], direction[0] * edge2[1] - direction[1] * edge2[0]];
    const determinant = dot3(edge1, p);
    if (Math.abs(determinant) < 1e-9) return [];
    const inverse = 1 / determinant, offset = subtract3(origin, a), u = dot3(offset, p) * inverse;
    if (u < -1e-8 || u > 1 + 1e-8) return [];
    const q: Vec3 = [offset[1] * edge1[2] - offset[2] * edge1[1], offset[2] * edge1[0] - offset[0] * edge1[2], offset[0] * edge1[1] - offset[1] * edge1[0]];
    const v = dot3(direction, q) * inverse;
    if (v < -1e-8 || u + v > 1 + 1e-8) return [];
    const distance = dot3(edge2, q) * inverse;
    return distance > 1e-7 ? [{ distance, objectId: surface.objectId, objectKind: surface.objectKind, point: addScaled3(origin, direction, distance) }] : [];
  }).sort((a, b) => a.distance - b.distance || a.objectId.localeCompare(b.objectId));
  return hits[0];
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const number = (value: unknown, fallback: number) => finite(value) ? value : fallback;
const point2 = (value: unknown): [number, number] | null => Array.isArray(value) && finite(value[0]) && finite(value.length >= 3 ? value[2] : value[1]) ? [value[0], value.length >= 3 ? value[2] : value[1]] : null;
const vec3 = (value: unknown): Vec3 => Array.isArray(value) && value.length >= 3 && value.every(finite) ? [value[0], value[1], value[2]] : [0, 0, 0];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function pushTriangle(out: PositioningTriangle[], objectId: string, objectKind: string, a: Vec3, b: Vec3, c: Vec3) {
  if (Math.hypot(...cross(sub(b, a), sub(c, a))) > 1e-10) out.push({ objectId, objectKind, vertices: [a, b, c] });
}
function pushQuad(out: PositioningTriangle[], objectId: string, objectKind: string, points: [Vec3, Vec3, Vec3, Vec3]) {
  pushTriangle(out, objectId, objectKind, points[0], points[1], points[2]);
  pushTriangle(out, objectId, objectKind, points[0], points[2], points[3]);
}
function transformLocal(center: Vec3, yaw: number, local: Vec3): Vec3 {
  const cosine = Math.cos(yaw), sine = Math.sin(yaw);
  return [center[0] + local[0] * cosine + local[2] * sine, center[1] + local[1], center[2] - local[0] * sine + local[2] * cosine];
}
function pushBox(out: PositioningTriangle[], objectId: string, objectKind: string, center: Vec3, dimensions: Vec3, yaw = 0) {
  const [width, height, depth] = dimensions;
  if (![width, height, depth].every(value => Number.isFinite(value) && value > 0)) return;
  const [x, y, z] = [width / 2, height / 2, depth / 2], v = (a: number, b: number, c: number) => transformLocal(center, yaw, [a, b, c]);
  pushQuad(out, objectId, objectKind, [v(-x, -y, z), v(x, -y, z), v(x, y, z), v(-x, y, z)]);
  pushQuad(out, objectId, objectKind, [v(x, -y, -z), v(-x, -y, -z), v(-x, y, -z), v(x, y, -z)]);
  pushQuad(out, objectId, objectKind, [v(-x, -y, -z), v(-x, -y, z), v(-x, y, z), v(-x, y, -z)]);
  pushQuad(out, objectId, objectKind, [v(x, -y, z), v(x, -y, -z), v(x, y, -z), v(x, y, z)]);
  pushQuad(out, objectId, objectKind, [v(-x, y, z), v(x, y, z), v(x, y, -z), v(-x, y, -z)]);
  pushQuad(out, objectId, objectKind, [v(-x, -y, -z), v(x, -y, -z), v(x, -y, z), v(-x, -y, z)]);
}

function levelIdFor(node: NodeData, nodes: Record<string, NodeData>): string | null {
  let current: NodeData | undefined = node;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.type === "level") return current.id;
    current = current.parentId ? nodes[current.parentId] : undefined;
  }
  return null;
}
function levelY(node: NodeData, nodes: Record<string, NodeData>): number {
  const levelId = levelIdFor(node, nodes), level = levelId ? nodes[levelId] : undefined;
  return level ? (finite(level.level) ? level.level : 0) * 3.2 : 0;
}
function wallDimensions(node: NodeData) {
  const start = point2(node.start), end = point2(node.end);
  if (!start || !end) return null;
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
  return length > 1e-8 ? { start, end, length, yaw: -Math.atan2(end[1] - start[1], end[0] - start[0]) } : null;
}
function pushWallSection(out: PositioningTriangle[], node: NodeData, center: Vec3, length: number, yaw: number, height: number, thickness: number, openings: { left: number; right: number; bottom: number; top: number }[], includeStart: boolean, includeEnd: boolean) {
  const halfLength = length / 2, halfThickness = thickness / 2;
  const world = (x: number, y: number, z: number): Vec3 => transformLocal(center, yaw, [x, y - height / 2, z]);
  const xBreaks = [...new Set([-halfLength, halfLength, ...openings.flatMap(hole => [hole.left - length / 2, hole.right - length / 2])])].sort((a, b) => a - b);
  const yBreaks = [...new Set([0, height, ...openings.flatMap(hole => [hole.bottom, hole.top])])].sort((a, b) => a - b);
  const occupied = (x: number, y: number) => !openings.some(hole => x + length / 2 > hole.left && x + length / 2 < hole.right && y > hole.bottom && y < hole.top);
  for (let xi = 0; xi < xBreaks.length - 1; xi += 1) for (let yi = 0; yi < yBreaks.length - 1; yi += 1) {
    const left = xBreaks[xi]!, right = xBreaks[xi + 1]!, bottom = yBreaks[yi]!, top = yBreaks[yi + 1]!, middleX = (left + right) / 2, middleY = (bottom + top) / 2;
    if (right - left < 1e-5 || top - bottom < 1e-5 || !occupied(middleX, middleY)) continue;
    // Front/back panels meet at grid edges without creating artificial side walls.
    pushQuad(out, node.id, "wall", [world(left, bottom, halfThickness), world(right, bottom, halfThickness), world(right, top, halfThickness), world(left, top, halfThickness)]);
    pushQuad(out, node.id, "wall", [world(right, bottom, -halfThickness), world(left, bottom, -halfThickness), world(left, top, -halfThickness), world(right, top, -halfThickness)]);
    if (includeStart && xi === 0) pushQuad(out, node.id, "wall", [world(left, bottom, -halfThickness), world(left, bottom, halfThickness), world(left, top, halfThickness), world(left, top, -halfThickness)]);
    if (includeEnd && xi === xBreaks.length - 2) pushQuad(out, node.id, "wall", [world(right, bottom, halfThickness), world(right, bottom, -halfThickness), world(right, top, -halfThickness), world(right, top, halfThickness)]);
  }
  // Real wall perimeter surfaces (not the artificial seams between split panels).
  for (let xi = 0; xi < xBreaks.length - 1; xi += 1) {
    const left = xBreaks[xi]!, right = xBreaks[xi + 1]!, middleX = (left + right) / 2;
    if (occupied(middleX, 1e-6)) pushQuad(out, node.id, "wall", [world(left, 0, -halfThickness), world(right, 0, -halfThickness), world(right, 0, halfThickness), world(left, 0, halfThickness)]);
    if (occupied(middleX, height - 1e-6)) pushQuad(out, node.id, "wall", [world(left, height, halfThickness), world(right, height, halfThickness), world(right, height, -halfThickness), world(left, height, -halfThickness)]);
  }
  for (const hole of openings) {
    const left = hole.left - length / 2, right = hole.right - length / 2;
    if (hole.right > hole.left && hole.top > hole.bottom) {
      pushQuad(out, node.id, "wall", [world(left, hole.bottom, -halfThickness), world(left, hole.bottom, halfThickness), world(left, hole.top, halfThickness), world(left, hole.top, -halfThickness)]);
      pushQuad(out, node.id, "wall", [world(right, hole.bottom, halfThickness), world(right, hole.bottom, -halfThickness), world(right, hole.top, -halfThickness), world(right, hole.top, halfThickness)]);
      pushQuad(out, node.id, "wall", [world(left, hole.bottom, -halfThickness), world(right, hole.bottom, -halfThickness), world(right, hole.bottom, halfThickness), world(left, hole.bottom, halfThickness)]);
      pushQuad(out, node.id, "wall", [world(left, hole.top, halfThickness), world(right, hole.top, halfThickness), world(right, hole.top, -halfThickness), world(left, hole.top, -halfThickness)]);
    }
  }
}

/**
 * Build finite ray targets from the same architectural source nodes used by
 * the 3D viewer. No Overlay routes, devices, dimensions, or reference planes
 * are included. Hidden presentation layers do not change physical witnesses.
 */
export function buildPhysicalPositioningSurfaces(nodes: Record<string, NodeData>): PositioningTriangle[] {
  const out: PositioningTriangle[] = [], nodesByWall = new Map<string, NodeData[]>(), floorTops = new Map<string, NodeData[]>();
  for (const node of Object.values(nodes)) {
    if ((node.type === "door" || node.type === "window") && (node.wallId || node.parentId)) {
      const id = node.wallId ?? node.parentId!;
      nodesByWall.set(id, [...(nodesByWall.get(id) ?? []), node]);
    }
    if (node.type === "slab") {
      const id = levelIdFor(node, nodes) ?? "";
      floorTops.set(id, [...(floorTops.get(id) ?? []), node]);
    }
  }

  for (const node of Object.values(nodes)) {
    const y = levelY(node, nodes);
    if (node.type === "wall") {
      const frame = wallDimensions(node);
      if (!frame) continue;
      const height = Math.max(0.1, number(node.height, 2.7)), thickness = Math.max(0.05, number(node.thickness, DEFAULT_WALL_THICKNESS));
      const segments = isCurvedWall(node as any) ? Math.max(12, Math.min(32, Math.ceil(frame.length * 3))) : 1;
      for (let segment = 0; segment < segments; segment += 1) {
        const t0 = segment / segments, t1 = (segment + 1) / segments;
        const a = getWallCurveFrameAt(node as any, t0), b = getWallCurveFrameAt(node as any, t1), dx = b.point.x - a.point.x, dz = b.point.y - a.point.y, segmentLength = Math.hypot(dx, dz);
        if (segmentLength < 1e-8) continue;
        const segmentYaw = -Math.atan2(dz, dx), center: Vec3 = [(a.point.x + b.point.x) / 2, y + height / 2, (a.point.y + b.point.y) / 2];
        const openings = (nodesByWall.get(node.id) ?? []).flatMap(opening => {
          const width = Math.max(0.05, number(opening.width, 0.9)), openingHeight = Math.max(0.05, number(opening.height, 2)), openingCenter = number(Array.isArray(opening.position) ? opening.position[0] : undefined, 0), centerY = number(Array.isArray(opening.position) ? opening.position[1] : undefined, openingHeight / 2);
          const from = Math.max(t0, (openingCenter - width / 2) / frame.length), to = Math.min(t1, (openingCenter + width / 2) / frame.length);
          if (to <= from) return [];
          return [{ left: (from - t0) / (t1 - t0) * segmentLength, right: (to - t0) / (t1 - t0) * segmentLength, bottom: Math.max(0, centerY - openingHeight / 2), top: Math.min(height, centerY + openingHeight / 2) }];
        });
        pushWallSection(out, node, center, segmentLength, segmentYaw, height, thickness, openings, segment === 0, segment === segments - 1);
      }
      continue;
    }
    if (node.type === "door" || node.type === "window") {
      const transform = resolveWallOpeningTransform(node, nodes);
      if (!transform) continue;
      const width = Math.max(0.2, number(node.width, 0.9)), height = Math.max(0.2, number(node.height, 2)), depth = Math.max(0.04, number(node.depth, 0.08));
      const centerY = y + number(Array.isArray(node.position) ? node.position[1] : undefined, height / 2);
      pushBox(out, node.id, node.type, [transform.x, centerY, transform.z], [width, height, depth], -transform.rotationY);
      continue;
    }
    if (node.type === "beam") {
      const beam = validateBeam(node, nodes).beam;
      if (!beam) continue;
      const start = beam.start, end = beam.end, dx = end[0] - start[0], dz = end[1] - start[1], length = Math.hypot(dx, dz), ceiling = beam.effectiveCeilingElevation;
      if (length < 1e-8 || !ceiling) continue;
      const top = ceiling.meters, center: Vec3 = [(start[0] + end[0]) / 2, y + top - beam.height / 2, (start[1] + end[1]) / 2];
      pushBox(out, beam.id, "beam", center, [beam.width, beam.height, length], Math.atan2(dx, dz));
      continue;
    }
    if (node.type === "slab" || node.type === "ceiling") {
      const polygon = Array.isArray(node.polygon) ? node.polygon.map(point2) : [];
      if (polygon.length < 3 || polygon.some(point => !point)) continue;
      const outer = polygon as [number, number][], holes = Array.isArray(node.holes) ? node.holes.map((hole: unknown) => Array.isArray(hole) ? hole.map(point2) : []).filter((hole: (number[] | null)[]) => hole.length >= 3 && hole.every(Boolean)) as [number, number][][] : [];
      const flat: number[] = [...outer.flatMap(point => point)];
      const holeIndices: number[] = [];
      for (const hole of holes) { holeIndices.push(flat.length / 2); flat.push(...hole.flatMap(point => point)); }
      const indices = earcut(flat, holeIndices, 2), thickness = node.type === "slab" ? Math.max(0.01, Math.abs(number(node.elevation, 0.05))) : 0.04, baseY = node.type === "ceiling" ? y + number(node.height, 2.7) : y;
      const pointAt = (index: number, surfaceY: number): Vec3 => [flat[index * 2]!, surfaceY, flat[index * 2 + 1]!];
      for (let index = 0; index < indices.length; index += 3) {
        const a = indices[index]!, b = indices[index + 1]!, c = indices[index + 2]!;
        pushTriangle(out, node.id, node.type, pointAt(a, baseY), pointAt(b, baseY), pointAt(c, baseY));
        pushTriangle(out, node.id, node.type, pointAt(a, baseY + thickness), pointAt(c, baseY + thickness), pointAt(b, baseY + thickness));
      }
      for (const ring of [outer, ...holes]) for (let index = 0; index < ring.length; index += 1) {
        const a = ring[index]!, b = ring[(index + 1) % ring.length]!;
        pushQuad(out, node.id, node.type, [[a[0], baseY, a[1]], [b[0], baseY, b[1]], [b[0], baseY + thickness, b[1]], [a[0], baseY + thickness, a[1]]]);
      }
      continue;
    }
    if (node.type === "item" || node.type === "shelf" || node.type === "cabinet" || node.type === "cabinet-module") {
      const dimensions = finalDimensions(node), transform = resolveItemPlanTransform(node.id, nodes), position = vec3(node.position);
      if (!dimensions) continue;
      const grounded = node.asset?.attachTo === "wall-side" || node.asset?.attachTo === "ceiling" ? 0 : Math.max(0, ...(floorTops.get(levelIdFor(node, nodes) ?? "") ?? []).filter(slab => Array.isArray(slab.polygon) && pointInPolygon(transform.status === "ok" ? transform.x : position[0], transform.status === "ok" ? transform.z : position[2], slab.polygon)).map(slab => Math.max(0, number(slab.elevation, 0.05))));
      const center: Vec3 = [transform.status === "ok" ? transform.x : position[0], y + grounded + position[1] + dimensions.height / 2, transform.status === "ok" ? transform.z : position[2]];
      const orientation = transform.status === "ok" ? transform.rotationY : yaw(node);
      pushBox(out, node.id, "item", center, [dimensions.width, dimensions.height, dimensions.depth], orientation);
      continue;
    }
    if (node.type === "stair" || node.type === "stair-segment") {
      const position = vec3(node.position), width = Math.max(0.4, number(node.width, 1)), height = Math.max(0.25, number(node.totalRise ?? node.height, 2.8)), depth = Math.max(0.7, number(node.depth ?? node.run, 2.4));
      pushBox(out, node.id, node.type, [position[0], y + position[1] + height / 2, position[2]], [width, height, depth], yaw(node));
    }
  }
  return out;
}

function pointInPolygon(x: number, z: number, raw: unknown[]) {
  let inside = false;
  for (let index = 0, previous = raw.length - 1; index < raw.length; previous = index++) {
    const a = point2(raw[index]), b = point2(raw[previous]);
    if (a && b && (a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function yaw(node: NodeData) { return typeof node.rotation === "number" ? node.rotation : Array.isArray(node.rotation) && finite(node.rotation[1]) ? node.rotation[1] : 0; }
