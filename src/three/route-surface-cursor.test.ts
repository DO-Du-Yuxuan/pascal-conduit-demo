import { describe, expect, it } from "vitest";
import { createBeam } from "../domain/beams";
import { beamRouteDiagnostics } from "../domain/beam-routing";
import { planRoute } from "../domain/routing";
import type { RoutePoint } from "../domain/overlay";
import { resolveHostSurfaceCursor } from "./route-surface-cursor";

const base: any = { level: { id: "level", type: "level", level: 0 }, ceiling: { id: "ceiling", type: "ceiling", parentId: "level", height: 3, polygon: [[-2,-2],[2,-2],[2,2],[-2,2]] } };
const beam = createBeam(base, { id: "beam", name: "beam", levelId: "level", start: [-1,0], end: [1,0], width: .3, height: .5 }).beam!;
const nodes = { ...base, beam };
const bottom: RoutePoint = { position: [0,2.5,0], attachment: { hostId: "beam", hostKind: "beam", surface: "bottom", normal: [0,-1,0], levelId: "level", basis: { u: [1,0,0], v: [0,0,1] }, localPosition: [0,2.5,0] } };
const side: RoutePoint = { position: [0,2.8,-.15], attachment: { hostId: "beam", hostKind: "beam", surface: "side-a", normal: [0,0,-1], levelId: "level", basis: { u: [1,0,0], v: [0,1,0] }, localPosition: [-.15,2.8,0] } };

describe("shared conduit surface cursor", () => {
  it("confirms a bottom-to-side Beam edge then rises on its destination face with a 90 degree fitting", () => {
    const edge = resolveHostSurfaceCursor(nodes, bottom, side, true, null);
    expect(edge.position).toEqual([0,2.5,-.15]);
    expect(edge.attachment?.surface).toBe("side-a");
    const rise = resolveHostSurfaceCursor(nodes, edge, side, true, null);
    expect(rise.position).toEqual(side.position);
    for (const system of ["receptacle", "lighting", "network"] as const) {
      const plan = planRoute(system, 20, "surface", [bottom, edge, rise]);
      expect(plan.canCommit).toBe(true);
      expect(beamRouteDiagnostics(nodes, plan)).toEqual([]);
      expect(plan.fittings.some(fitting => fitting.fitting === "elbow" && fitting.bendStyle === "right-angle" && !fitting.arc)).toBe(true);
    }
  });
  it("does not silently land a constrained route on an unreachable Beam plane", () => {
    const start: RoutePoint = { position: [-2,2.3,0] };
    const result = resolveHostSurfaceCursor(nodes, start, side, true, [1,0,0]);
    expect(result.position).toEqual([0,2.3,0]);
    expect(result.attachment).toBeUndefined();
  });
  it("keeps free-mode adjacent-face transitions on their actual edge", () => {
    expect(resolveHostSurfaceCursor(nodes, bottom, side, false, null).position).toEqual([0,2.5,-.15]);
  });
});
