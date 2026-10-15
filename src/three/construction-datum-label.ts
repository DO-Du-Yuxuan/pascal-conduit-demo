import type { Vec3 } from "../domain/overlay";

export type DatumLabelFrame = { position: Vec3; right: Vec3; up: Vec3; normal: Vec3 };
type DatumLabelPoint = readonly [number, number, number];

/** Build an outward-facing, unmirrored text frame parallel to the wall at a label point. */
export function constructionDatumLabelFrame(points: readonly DatumLabelPoint[], side: -1 | 1, labelPosition: DatumLabelPoint, offset = 0.004): DatumLabelFrame | null {
  let tangent: Vec3 | undefined, nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index]!, b = points[index + 1]!, dx = b[0] - a[0], dz = b[2] - a[2], length2 = dx * dx + dz * dz;
    if (length2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1, ((labelPosition[0] - a[0]) * dx + (labelPosition[2] - a[2]) * dz) / length2));
    const distance = Math.hypot(labelPosition[0] - a[0] - dx * t, labelPosition[2] - a[2] - dz * t);
    if (distance < nearest) { nearest = distance; const length = Math.sqrt(length2); tangent = [dx / length, 0, dz / length]; }
  }
  if (!tangent) return null;
  const direction = side === 1 ? 1 : -1;
  const right: Vec3 = [tangent[0] * direction || 0, 0, tangent[2] * direction || 0], up: Vec3 = [0, 1, 0];
  const normal: Vec3 = [right[2] === 0 ? 0 : -right[2], 0, right[0] === 0 ? 0 : right[0]];
  return { position: [labelPosition[0] + normal[0] * offset, labelPosition[1], labelPosition[2] + normal[2] * offset], right, up, normal };
}
