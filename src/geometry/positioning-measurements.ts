import type { NodeData } from "../types";

type DeviceEnvelope = { deviceType: string; sizeMm: readonly number[]; frame?: { right: readonly number[]; up: readonly number[]; front: readonly number[] } };

/** Half of a placed device's physical envelope projected onto world vertical. */
export function deviceVerticalHalfExtentMeters(device: DeviceEnvelope): number {
  const [width = 0, height = 0, depth = 0] = device.sizeMm.map(value => Number.isFinite(value) ? value / 1000 : 0);
  const diskDevice = device.deviceType === "luminaire" || device.deviceType === "smoke-detector" || device.deviceType === "sensor";
  const frame = device.frame;
  if (!frame) return diskDevice ? depth / 2 : height / 2;
  if (diskDevice) {
    const radialVertical = Math.hypot(frame.right[1] ?? 0, frame.up[1] ?? 0) * width / 2;
    return radialVertical + Math.abs(frame.front[1] ?? 0) * depth / 2;
  }
  if (device.deviceType === "sprinkler-head") {
    // Its body and deflector extend along the host normal from the center.
    return Math.abs(frame.front[1] ?? 0) * height * .52 + Math.hypot(frame.right[1] ?? 0, frame.up[1] ?? 0) * width / 2;
  }
  return Math.abs(frame.right[1] ?? 0) * width / 2 + Math.abs(frame.up[1] ?? 0) * height / 2 + Math.abs(frame.front[1] ?? 0) * depth / 2;
}

/** Half of the modeled device envelope projected onto its local positioning axis. */
export function devicePositioningHalfExtent(deviceType: string, sizeMm: readonly number[], key: string): number {
  if (deviceType !== "strong-panel" && deviceType !== "weak-panel") return 0;
  return (key.startsWith("u") ? sizeMm[0] ?? 0 : sizeMm[1] ?? 0) / 2000;
}

export type PlanPoint = [number, number];
function pointInRing(x: number, z: number, raw: unknown[]): boolean {
  let inside = false;
  for (let index = 0, previous = raw.length - 1; index < raw.length; previous = index++) {
    const point = (value: unknown): PlanPoint | null => Array.isArray(value) && Number.isFinite(value[0]) && Number.isFinite(value.length >= 3 ? value[2] : value[1]) ? [Number(value[0]), Number(value.length >= 3 ? value[2] : value[1])] : null;
    const a = point(raw[index]), b = point(raw[previous]);
    if (a && b && (a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Resolve the finished-floor top used by 2D H labels and 3D wall-point dimensions. */
export function finishedFloorElevationAt(nodes: Record<string, NodeData>, levelId: string, levelBaseY: number, x: number, z: number, measurementStartY = Number.POSITIVE_INFINITY): number {
  const belongsToLevel = (node: NodeData) => {
    let cursor: NodeData | undefined = node;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      if (cursor.type === "level") return cursor.id === levelId;
      cursor = cursor.parentId ? nodes[cursor.parentId] : undefined;
    }
    return false;
  };
  const slabTops = Object.values(nodes).filter(node => node.type === "slab" && belongsToLevel(node) && Array.isArray(node.polygon) && pointInRing(x, z, node.polygon) && !(Array.isArray(node.holes) && node.holes.some((hole: unknown) => Array.isArray(hole) && pointInRing(x, z, hole)))).map(node => Math.max(0, typeof node.elevation === "number" && Number.isFinite(node.elevation) ? node.elevation : .05)).filter(elevation => levelBaseY + elevation <= measurementStartY + 1e-7);
  return levelBaseY + Math.max(0, ...slabTops);
}
