import { describe, expect, it } from "vitest";
import { createBeam } from "../domain/beams";
import { beamRouteDiagnostics } from "../domain/beam-routing";
import { commitPlannedRoute, planRoute } from "../domain/routing";
import { createEmptyOverlay, parseOverlay, type RoutePoint, type Vec3 } from "../domain/overlay";
import { transitionToAdjacentBeamFace } from "./host-transition";

const rotate = (p: Vec3, angle: number): Vec3 => [p[0] * Math.cos(angle) - p[2] * Math.sin(angle), p[1], p[0] * Math.sin(angle) + p[2] * Math.cos(angle)];
function hosted(position: Vec3, surface: string, normal: Vec3, angle: number): RoutePoint {
  return { position: rotate(position, angle), attachment: { hostId: "beam", hostKind: "beam", surface, normal: rotate(normal, angle), levelId: "level" } };
}

describe("shared Beam-face routing pipeline", () => {
  it.each(["receptacle", "lighting", "network"] as const)("confirms, plans and persists adjacent-face turns for %s", (system) => {
    for (const angle of [0, Math.PI / 4]) {
      const a = rotate([-1, 0, 0], angle), b = rotate([1, 0, 0], angle);
      const base: any = { level: { id: "level", type: "level", level: 0 }, ceiling: { id: "ceiling", type: "ceiling", parentId: "level", height: 3, polygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]] } };
      const beam = createBeam(base, { id: "beam", name: "梁", levelId: "level", start: [a[0], a[2]], end: [b[0], b[2]], width: .3, height: .5 }).beam!;
      const bottom = hosted([0, 2.5, 0], "bottom", [0, -1, 0], angle), side = hosted([0, 2.8, -.15], "side-a", [0, 0, -1], angle);
      const sideNearEnd = hosted([-.5, 2.7, -.15], "side-a", [0, 0, -1], angle), end = hosted([-1, 2.7, 0], "end-a", [-1, 0, 0], angle);
      for (const [start, finish] of [[bottom, side], [side, bottom], [sideNearEnd, end], [end, sideNearEnd]]) {
        const edge = transitionToAdjacentBeamFace(start, finish);
        const plan = planRoute(system, 20, "surface", [start, edge, finish]);
        expect(plan.canCommit).toBe(true);
        expect(beamRouteDiagnostics({ ...base, beam }, plan)).toEqual([]);
        expect(plan.surfaceChases).toEqual([]);
        expect(plan.fittings).toEqual([expect.objectContaining({ bendStyle: "right-angle", arc: undefined, radiusMm: undefined })]);
        const saved = commitPlannedRoute(createEmptyOverlay("beam.json", "sha"), plan);
        const restored = parseOverlay(JSON.parse(JSON.stringify(saved)));
        expect(restored.segments.map(({ id, start, end, startPortId, endPortId }) => ({ id, start: JSON.parse(JSON.stringify(start)), end: JSON.parse(JSON.stringify(end)), startPortId, endPortId }))).toEqual(saved.segments.map(({ id, start, end, startPortId, endPortId }) => ({ id, start: JSON.parse(JSON.stringify(start)), end: JSON.parse(JSON.stringify(end)), startPortId, endPortId })));
        expect(restored.fittings).toEqual(JSON.parse(JSON.stringify(saved.fittings)));
      }
    }
  });
});
