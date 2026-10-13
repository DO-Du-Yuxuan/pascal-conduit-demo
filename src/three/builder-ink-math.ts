export type Vec3Tuple = readonly [number, number, number];

const smoothstep = (from: number, to: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

export function builderDepthEdge(center: number, right: number, left: number, up: number, down: number): number {
  const laplacian = Math.abs(right + left + up + down - center * 4);
  const inverseDepth = 1 - center;
  const metric = laplacian / (inverseDepth * inverseDepth + 0.00002);
  const noiseGate = smoothstep(0.00002, 0.00006, laplacian);
  return smoothstep(0.5, 2.5, metric) * noiseGate;
}

const normalizedDot = (left: Vec3Tuple, right: Vec3Tuple) => {
  const leftLength = Math.hypot(...left), rightLength = Math.hypot(...right);
  if (leftLength === 0 || rightLength === 0) return 1;
  const dot = (left[0] * right[0] + left[1] * right[1] + left[2] * right[2]) / (leftLength * rightLength);
  return Math.max(-1, Math.min(1, dot));
};

export function builderNormalEdge(center: Vec3Tuple, neighbors: readonly [Vec3Tuple, Vec3Tuple, Vec3Tuple, Vec3Tuple]): number {
  const difference = Math.max(...neighbors.map((neighbor) => 1 - normalizedDot(center, neighbor)));
  return smoothstep(0.01, 0.05, difference);
}

export function builderInkMask(depthEdge: number, normalEdge: number, opacity = 0.5): number {
  return Math.min(1, Math.max(0, Math.max(depthEdge, normalEdge) * opacity));
}
