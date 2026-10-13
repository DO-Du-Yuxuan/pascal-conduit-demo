import { BoxGeometry } from "three";
import type { Penetration, Vec3 } from "../../domain/overlay";
import { subtractBeamPenetrations } from "../../three/chase-geometry";
import type { BeamNode } from "../../domain/beams";

export type BeamRenderTransform = {
  length: number;
  center: Vec3;
  rotationY: number;
};

/** Runtime transform for the axis-aligned local beam prism. `levelBaseY` is the
 * rendered Level origin; stored effective elevation remains relative to it. */
export function beamRenderTransform(node: BeamNode, levelBaseY: number): BeamRenderTransform | null {
  const dx = node.end[0] - node.start[0];
  const dz = node.end[1] - node.start[1];
  const length = Math.hypot(dx, dz);
  const top = node.effectiveCeilingElevation.meters;
  if (!Number.isFinite(length) || length < 1e-8 || !Number.isFinite(node.width) || node.width <= 0 || !Number.isFinite(node.height) || node.height <= 0 || !Number.isFinite(top) || top <= 0 || !Number.isFinite(levelBaseY)) return null;
  return {
    length,
    center: [(node.start[0] + node.end[0]) / 2, levelBaseY + top - node.height / 2, (node.start[1] + node.end[1]) / 2],
    rotationY: Math.atan2(dx, dz),
  };
}

/** Builds a Beam's centered, local-space solid and optional explicit sleeves.
 * Domain validation, collision, and penetration ownership remain elsewhere. */
export function buildBeamGeometry(node: BeamNode, levelBaseY: number, penetrations: Penetration[] = []) {
  const transform = beamRenderTransform(node, levelBaseY);
  if (!transform) return null;
  const base = new BoxGeometry(node.width, node.height, transform.length);
  const result = subtractBeamPenetrations(
    base,
    penetrations,
    [node.start[0], 0, node.start[1]],
    [node.end[0], 0, node.end[1]],
    transform.center[1],
  );
  return { ...result, transform };
}

export type BeamSurfaceHit = {
  point: Vec3;
  attachment: {
    hostId: string;
    hostKind: "beam";
    surface: "bottom" | "side-a" | "side-b" | "end-a" | "end-b";
    normal: Vec3;
    levelId: string | null;
    localPosition: Vec3;
    basis: { u: Vec3; v: Vec3 };
  };
  shiftKey: boolean;
  ctrlKey: boolean;
};

/** Resolves the exposed physical face under an already raycast Beam hit.
 * The ceiling-adjacent top is deliberately excluded as a construction host. */
export function resolveBeamSurfaceHit(
  node: BeamNode,
  levelBaseY: number,
  point: Vec3,
  modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
): BeamSurfaceHit | null {
  const dx = node.end[0] - node.start[0];
  const dz = node.end[1] - node.start[1];
  const length = Math.hypot(dx, dz);
  const top = node.effectiveCeilingElevation.meters;
  if (length < 1e-8 || !Number.isFinite(node.width) || node.width <= 0 || !Number.isFinite(node.height) || node.height <= 0 || !Number.isFinite(top) || top <= 0 || !Number.isFinite(levelBaseY) || point.some((coordinate) => !Number.isFinite(coordinate))) return null;

  const axis: Vec3 = [dx / length, 0, dz / length];
  const side: Vec3 = [-axis[2], 0, axis[0]];
  const center: Vec3 = [(node.start[0] + node.end[0]) / 2, 0, (node.start[1] + node.end[1]) / 2];
  const delta: Vec3 = [point[0] - center[0], 0, point[2] - center[2]];
  const along = delta[0] * axis[0] + delta[2] * axis[2];
  const across = delta[0] * side[0] + delta[2] * side[2];
  const bottom = levelBaseY + top - node.height;
  const candidates: Array<{ surface: BeamSurfaceHit["attachment"]["surface"]; distance: number; normal: Vec3; u: Vec3; v: Vec3 }> = [
    { surface: "bottom", distance: Math.abs(point[1] - bottom), normal: [0, -1, 0], u: axis, v: side },
    { surface: "side-a", distance: Math.abs(across + node.width / 2), normal: [-side[0], 0, -side[2]], u: axis, v: [0, 1, 0] },
    { surface: "side-b", distance: Math.abs(across - node.width / 2), normal: side, u: axis, v: [0, 1, 0] },
    { surface: "end-a", distance: Math.abs(along + length / 2), normal: [-axis[0], 0, -axis[2]], u: side, v: [0, 1, 0] },
    { surface: "end-b", distance: Math.abs(along - length / 2), normal: axis, u: side, v: [0, 1, 0] },
  ];
  const face = candidates.sort((a, b) => a.distance - b.distance)[0];
  if (!face || Math.abs(point[1] - (levelBaseY + top)) < face.distance) return null;
  return {
    point,
    attachment: {
      hostId: node.id,
      hostKind: "beam",
      surface: face.surface,
      normal: face.normal,
      levelId: node.parentId ?? null,
      localPosition: [across, point[1] - levelBaseY, along],
      basis: { u: face.u, v: face.v },
    },
    shiftKey: Boolean(modifiers.shiftKey),
    ctrlKey: Boolean(modifiers.ctrlKey || modifiers.metaKey),
  };
}

export type BeamFootprintLayout = {
  center: [number, number];
  length: number;
  width: number;
  rotationDegrees: number;
  holes: Array<{ id: string; center: [number, number]; radius: number; segmentId: string }>;
};

/** Pure 2D footprint coordinates in the Plan SVG's X/Z coordinate system. */
export function beamFootprintLayout(node: BeamNode, penetrations: Penetration[] = []): BeamFootprintLayout | null {
  const dx = node.end[0] - node.start[0];
  const dz = node.end[1] - node.start[1];
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length) || length < 1e-8 || !Number.isFinite(node.width) || node.width <= 0) return null;
  const center: [number, number] = [(node.start[0] + node.end[0]) / 2, (node.start[1] + node.end[1]) / 2];
  const radians = Math.atan2(dz, dx);
  const cos = Math.cos(-radians);
  const sin = Math.sin(-radians);
  return {
    center,
    length,
    width: node.width,
    rotationDegrees: radians * 180 / Math.PI,
    holes: penetrations.map((penetration) => {
      const x = penetration.entry.position[0] - center[0];
      const z = penetration.entry.position[2] - center[1];
      return {
        id: penetration.id,
        center: [x * cos - z * sin, x * sin + z * cos],
        radius: penetration.diameterMm / 2000,
        segmentId: penetration.segmentId,
      };
    }),
  };
}
