import type { RouteFitting, Vec3 } from "./overlay";

export type PlanFittingDisplay = { kind: "arc"; fitting: RouteFitting } | { kind: "bridge"; points: Vec3[] } | { kind: "connectors"; lines: Array<{ start: Vec3; end: Vec3 }> } | { kind: "hidden" };

/** 2D keeps pipe continuity but suppresses fitting point symbols. */
export function planFittingDisplay(fitting: RouteFitting): PlanFittingDisplay {
  if (fitting.arc) return { kind: "arc", fitting };
  if (fitting.bridge) return { kind: "bridge", points: [fitting.bridge.entry, fitting.bridge.crestStart, fitting.bridge.crestEnd, fitting.bridge.exit] };
  if (fitting.fitting === "tee") return { kind: "connectors", lines: fitting.ports.slice(0, 3).map((port) => ({ start: [...fitting.position.position], end: [...port.position.position] })) };
  return { kind: "hidden" };
}
