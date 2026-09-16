import { describe, expect, it } from "vitest";
import { createBeam } from "./beams";
import { beamRouteDiagnostics, projectBeamPenetrationExit, revalidateBeamPenetrations, validBeamVolumes } from "./beam-routing";
import { createEmptyOverlay } from "./overlay";
import { planRoute } from "./routing";
import type { RoutePoint } from "./overlay";

const ceiling = { id: "ceiling", type: "ceiling", parentId: "level", height: 3, polygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]] };
const base: any = { level: { id: "level", type: "level", level: 0 }, ceiling };
const beam = createBeam(base, { id: "beam", name: "入口梁", levelId: "level", start: [-1, 0], end: [1, 0], width: .3, height: .5 }).beam!;
const nodes = { ...base, beam };
const free = (x: number, y: number, z: number) => ({ position: [x, y, z] as [number, number, number] });
const onBottom = (x: number, z: number): RoutePoint => ({ position: [x, 2.5, z], attachment: { hostId: "beam", hostKind: "beam", surface: "bottom", normal: [0, -1, 0], levelId: "level", localPosition: [z, 2.5, x], basis: { u: [1, 0, 0], v: [0, 0, 1] } } });

describe("Beam routing obstacle", () => {
  it("exposes only valid authored Beam solids", () => {
    expect(validBeamVolumes(nodes)).toHaveLength(1);
    expect(validBeamVolumes({ ...nodes, bad: { ...beam, id: "bad", start: [0, 0], end: [0, 0] } })).toHaveLength(1);
  });
  it("blocks a suspended or world-axis segment that enters a Beam without a mesh hit", () => {
    for (const route of [[free(0, 2.2, -1), free(0, 2.8, 1)], [free(-2, 2.75, 0), free(2, 2.75, 0)]]) {
      const diagnostics = beamRouteDiagnostics(nodes, planRoute("sprinkler", 50, "suspended", route));
      expect(diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "beam_collision", objectIds: ["beam"] })]));
    }
  });
  it("allows a truthful exposed-face run and never creates a Beam chase", () => {
    const plan = planRoute("receptacle", 20, "surface", [onBottom(-.8, 0), onBottom(.8, 0)]);
    expect(beamRouteDiagnostics(nodes, plan)).toEqual([]);
    expect(plan.surfaceChases).toEqual([]);
  });
  it("does not treat the ceiling-adjacent top face as legal contact", () => {
    const top = (x: number): RoutePoint => ({ position: [x, 3, 0], attachment: { ...onBottom(x, 0).attachment!, surface: "top", normal: [0, 1, 0] } });
    expect(beamRouteDiagnostics(nodes, planRoute("receptacle", 20, "surface", [top(-.8), top(.8)])).some((item) => item.code === "beam_collision")).toBe(true);
  });
  it("does not turn opposite-face contact into an implicit penetration, but permits departure away from a face", () => {
    const opposite = (x: number, side: "side-a" | "side-b"): RoutePoint => ({ position: [x, 2.75, side === "side-a" ? -.15 : .15], attachment: { ...onBottom(x, 0).attachment!, surface: side, normal: [0, 0, side === "side-a" ? -1 : 1] } });
    expect(beamRouteDiagnostics(nodes, planRoute("receptacle", 20, "surface", [opposite(0, "side-a"), opposite(0, "side-b")])).some((item) => item.code === "beam_collision")).toBe(true);
    expect(beamRouteDiagnostics(nodes, planRoute("receptacle", 20, "surface", [opposite(0, "side-a"), free(0, 2.75, -1)]))).toEqual([]);
  });
  it("permits only the Beam passage recorded by an explicit penetration", () => {
    const plan = planRoute("receptacle", 20, "penetrate", [free(0, 2.75, -1), free(0, 2.75, 1)], undefined, [{ host: onBottom(0, 0).attachment!, entry: free(0, 2.75, -.2), exit: free(0, 2.75, .2), direction: [0, 0, 1] }]);
    expect(beamRouteDiagnostics(nodes, plan)).toEqual([]);
  });
  it("keeps an explicit Beam passage through a bend even when routing assigns a different segment id", () => {
    const entry = free(0, 2.75, -.2), exit = free(0, 2.75, .2);
    const plan = planRoute("receptacle", 20, "penetrate", [free(-1, 2.75, -1), entry, exit, free(1, 2.75, 1)], undefined, [{ host: onBottom(0, 0).attachment!, entry, exit, direction: [0, 0, 1] }]);
    expect(beamRouteDiagnostics(nodes, plan)).toEqual([]);
  });
  it("does not use a perpendicular hole passage to waive a different Beam chord", () => {
    const entry = free(0, 2.75, -.2), exit = free(0, 2.75, .2);
    const plan = planRoute("receptacle", 20, "penetrate", [free(-1, 2.75, -1), free(1, 2.75, 1)], undefined, [{ host: onBottom(0, 0).attachment!, entry, exit, direction: [0, 0, 1] }]);
    expect(beamRouteDiagnostics(nodes, plan).some((item) => item.code === "beam_collision")).toBe(true);
  });
  it("projects Tab's frozen direction to the actual angled Beam exit face", () => {
    const entry = { ...onBottom(0, 0), position: [0, 2.5, 0] as [number, number, number] };
    expect(projectBeamPenetrationExit(nodes, { entry, host: entry.attachment!, direction: [0, 1, 0], orthogonal: false })).toMatchObject({ position: [0, 3, 0], attachment: { hostId: "beam", hostKind: "beam", surface: "top" } });
  });
  it("retains only still-physical Beam penetrations after a Beam edit or deletion", () => {
    const entry = onBottom(0, 0), exit = projectBeamPenetrationExit(nodes, { entry, host: entry.attachment!, direction: [0, 1, 0], orthogonal: false })!;
    const overlay = { ...createEmptyOverlay("a", "b"), segments: [{ id: "route", type: "conduit-segment" as const, system: "receptacle" as const, diameterMm: 20, start: entry, end: exit, createdAt: "now" }], penetrations: [{ id: "hole", type: "penetration" as const, hostId: "beam", hostKind: "beam" as const, segmentId: "route", entry, exit, direction: [0, 1, 0] as [number, number, number], diameterMm: 30 }] };
    expect(revalidateBeamPenetrations(nodes, overlay).penetrations).toHaveLength(1);
    expect(revalidateBeamPenetrations({ ...nodes, beam: { ...beam, start: [3, 0], end: [4, 0] } }, overlay).penetrations).toHaveLength(0);
    expect(revalidateBeamPenetrations({ ...base }, overlay).penetrations).toHaveLength(0);
  });
});
