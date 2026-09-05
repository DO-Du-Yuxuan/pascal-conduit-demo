import { BoxGeometry, BufferGeometry, Vector3 } from "three";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import type { BendArc, SurfaceChase, Vec3 } from "../domain/overlay";

const point = (value: Vec3) => new Vector3(...value);
const tuple = (value: Vector3): Vec3 => [value.x, value.y, value.z];

export function sampleBendArc(arc: BendArc, steps = 24): Vec3[] {
  const center = point(arc.center), start = point(arc.start).sub(center), radius = start.length(), normal = point(arc.normal).normalize(), tangent = new Vector3().crossVectors(normal, start).normalize();
  return Array.from({ length: steps + 1 }, (_, index) => tuple(center.clone().addScaledVector(start, Math.cos(arc.sweepRadians * index / steps)).addScaledVector(tangent, radius * Math.sin(arc.sweepRadians * index / steps))));
}

export function sampleChase(chase: SurfaceChase, steps = 24): Vec3[] {
  return chase.path.kind === "line" ? [chase.path.start.position, chase.path.end.position] : sampleBendArc(chase.path.arc, steps);
}

type LocalPoint = [number, number, number];

/** Subtracts rectangular shallow channels from a horizontal extruded host. */
export function subtractHorizontalChases(baseGeometry: BufferGeometry, chases: SurfaceChase[], surfaceY: number, thickness: number): { geometry: BufferGeometry; failed: boolean } {
  if (!chases.length || thickness <= 0) return { geometry: baseGeometry, failed: false };
  let result: Brush | null = null;
  try {
    const evaluator = new Evaluator(); evaluator.attributes = ["position", "normal", "uv"];
    result = new Brush(baseGeometry); result.updateMatrixWorld(true);
    for (const chase of chases) {
      const depth = Math.min(thickness, chase.depthMm / 1000), width = chase.widthMm / 1000;
      const points: LocalPoint[] = sampleChase(chase).map((value) => [value[0], -value[2], value[1] - surfaceY]);
      for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index], end = points[index + 1], dx = end[0] - start[0], dy = end[1] - start[1], distance = Math.hypot(dx, dy);
        if (distance < 1e-6) continue;
        const cutterGeometry = new BoxGeometry(distance + width, width, depth + .004), cutter = new Brush(cutterGeometry);
        cutter.position.set((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, thickness - depth / 2 + .001);
        cutter.rotation.z = Math.atan2(dy, dx); cutter.updateMatrixWorld(true);
        const previous = result.geometry;
        try { result = evaluator.evaluate(result, cutter, SUBTRACTION); result.updateMatrixWorld(true); }
        finally { cutterGeometry.dispose(); }
        if (previous !== baseGeometry && previous !== result.geometry) previous.dispose();
      }
    }
    if (result.geometry !== baseGeometry) baseGeometry.dispose();
    return { geometry: result.geometry, failed: false };
  } catch {
    if (result?.geometry && result.geometry !== baseGeometry) result.geometry.dispose();
    return { geometry: baseGeometry, failed: true };
  }
}

/** Subtracts shallow channels from one local wall box. */
export function subtractWallChases(baseGeometry: BufferGeometry, chases: SurfaceChase[], wallStart: Vec3, wallEnd: Vec3, wallY: number, partX: number, partY: number, thickness: number): { geometry: BufferGeometry; failed: boolean } {
  if (!chases.length || thickness <= 0) return { geometry: baseGeometry, failed: false };
  let result: Brush | null = null;
  try {
    const wallDirection = point(wallEnd).sub(point(wallStart)), wallLength = Math.hypot(wallDirection.x, wallDirection.z);
    if (wallLength < 1e-7) return { geometry: baseGeometry, failed: false };
    const tangent = new Vector3(wallDirection.x / wallLength, 0, wallDirection.z / wallLength), frontNormal = new Vector3(-tangent.z, 0, tangent.x);
    const evaluator = new Evaluator(); evaluator.attributes = ["position", "normal", "uv"];
    result = new Brush(baseGeometry); result.updateMatrixWorld(true);
    for (const chase of chases) {
      const depth = Math.min(thickness, chase.depthMm / 1000), width = chase.widthMm / 1000, side = point(chase.surfaceNormal).dot(frontNormal) >= 0 ? 1 : -1;
      const points: LocalPoint[] = sampleChase(chase).map((value) => {
        const relative = point(value).sub(point(wallStart));
        return [relative.dot(tangent) - wallLength / 2 - partX, value[1] - wallY - partY, 0];
      });
      for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index], end = points[index + 1], dx = end[0] - start[0], dy = end[1] - start[1], distance = Math.hypot(dx, dy);
        if (distance < 1e-6) continue;
        const cutterGeometry = new BoxGeometry(distance + width, width, depth + .004), cutter = new Brush(cutterGeometry);
        cutter.position.set((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, side * (thickness / 2 - depth / 2 + .001));
        cutter.rotation.z = Math.atan2(dy, dx); cutter.updateMatrixWorld(true);
        const previous = result.geometry;
        try { result = evaluator.evaluate(result, cutter, SUBTRACTION); result.updateMatrixWorld(true); }
        finally { cutterGeometry.dispose(); }
        if (previous !== baseGeometry && previous !== result.geometry) previous.dispose();
      }
    }
    if (result.geometry !== baseGeometry) baseGeometry.dispose();
    return { geometry: result.geometry, failed: false };
  } catch {
    if (result?.geometry && result.geometry !== baseGeometry) result.geometry.dispose();
    return { geometry: baseGeometry, failed: true };
  }
}
