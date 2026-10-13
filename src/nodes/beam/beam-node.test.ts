import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
// @ts-ignore Node types are intentionally not a production dependency in this Vite-only repo.
import { readFileSync } from "node:fs";
import {
  createBeam,
  DEFAULT_BEAM_HEIGHT_METERS,
  DEFAULT_BEAM_WIDTH_METERS,
  validateBeam,
  type BeamNode,
} from "../../domain/beams";
import type { NodeData } from "../../types";
import { beamNodeDefinition } from "./definition";
import { beamFootprintLayout, beamRenderTransform, buildBeamGeometry, resolveBeamSurfaceHit } from "./geometry";

const level = { id: "fixture-level", type: "level" };
const ceilings: NodeData[] = [
  { id: "ceiling-west", type: "ceiling", parentId: level.id, height: 4.19, polygon: [[-1, -1], [5, -1], [5, 1], [-1, 1]] },
  { id: "ceiling-east", type: "ceiling", parentId: level.id, height: 4.19, polygon: [[5, -1], [10, -1], [10, 6], [5, 6]] },
  { id: "ceiling-north", type: "ceiling", parentId: level.id, height: 4.19, polygon: [[0, 1], [5, 1], [5, 6], [0, 6]] },
];
const nodes: Record<string, NodeData> = {
  [level.id]: level,
  ...Object.fromEntries(ceilings.map((ceiling) => [ceiling.id, ceiling])),
};
const syntheticInputs = [
  { id: "beam-fixture-1", name: "直梁 A", start: [0, 0] as [number, number], end: [4, 0] as [number, number], width: .9, height: .59 },
  { id: "beam-fixture-2", name: "直梁 B", start: [7, 0] as [number, number], end: [7, 4] as [number, number], width: .75, height: .59 },
  { id: "beam-fixture-3", name: "跨同标高 Ceiling 梁", start: [4, 3] as [number, number], end: [8, 3] as [number, number], width: .75, height: .59 },
  { id: "beam-fixture-4", name: "斜梁", start: [1, 4] as [number, number], end: [4, 5] as [number, number], width: .3, height: .47 },
  { id: "beam-fixture-5", name: "反向直梁", start: [9, 2] as [number, number], end: [6, 2] as [number, number], width: .33, height: .47 },
];
const syntheticBeams = syntheticInputs.map((input) => {
  const result = createBeam(nodes, { ...input, levelId: level.id });
  if (!result.valid || !result.beam) throw new Error(`Invalid synthetic Beam fixture: ${result.diagnostics.join("; ")}`);
  return result.beam;
});

const fixturePath = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env?.CONDUIT_PROJECT_FIXTURE_PATH;

describe("Demo Beam node module", () => {
  it("keeps domain validation, creation defaults, and authoring edits as the only authority", () => {
    expect(beamNodeDefinition.schema.validate).toBe(validateBeam);
    expect(beamNodeDefinition.defaults()).toEqual({ width: DEFAULT_BEAM_WIDTH_METERS, height: DEFAULT_BEAM_HEIGHT_METERS });
    expect(beamNodeDefinition.parameters.map(({ defaultValue }) => defaultValue)).toEqual([300, 500]);
    expect(beamNodeDefinition.create).toBe(createBeam);
    expect(beamNodeDefinition.edit).toBeTypeOf("function");
    expect(beamNodeDefinition.parametrics.resizeLength).toBeTypeOf("function");
    expect(beamNodeDefinition.parametrics.editPlanClearance).toBeTypeOf("function");
    for (const beam of syntheticBeams) expect(beamNodeDefinition.schema.validate(beam, nodes).valid).toBe(true);
  });

  it("renders synthetic straight, angled, and multi-Ceiling fixtures without mutating model evidence", () => {
    const before = structuredClone(syntheticBeams);
    expect(syntheticBeams.map((beam) => beam.effectiveCeilingElevation)).toEqual(Array(5).fill({ meters: 4.19, basis: "explicit-ceiling-height" }));
    expect(syntheticBeams[2]!.ceilingIds).toEqual(["ceiling-east", "ceiling-north"]);
    expect(syntheticBeams[3]!.start).not.toEqual(syntheticBeams[3]!.end);
    for (const beam of syntheticBeams) {
      expect(beamRenderTransform(beam, 0)).not.toBeNull();
      expect(beamFootprintLayout(beam)).toMatchObject({ length: expect.any(Number), width: beam.width });
    }
    expect(syntheticBeams).toEqual(before);
  });

  it("builds the local prism at the stored effective ceiling elevation", () => {
    const beam = syntheticBeams[0]!;
    const transform = beamRenderTransform(beam, 3.2)!;
    expect(transform.length).toBeCloseTo(4);
    expect(transform.center).toEqual([2, 3.2 + 4.19 - .59 / 2, 0]);
    const built = buildBeamGeometry(beam, 3.2)!;
    built.geometry.computeBoundingBox();
    expect(built.geometry.boundingBox!.max.x - built.geometry.boundingBox!.min.x).toBeCloseTo(.9);
    expect(built.geometry.boundingBox!.max.y - built.geometry.boundingBox!.min.y).toBeCloseTo(.59);
    expect(built.geometry.boundingBox!.max.z - built.geometry.boundingBox!.min.z).toBeCloseTo(4);
    built.geometry.dispose();
  });

  it("resolves exposed physical Beam faces and excludes the ceiling-adjacent top", () => {
    const beam: BeamNode = {
      id: "beam-hit", type: "beam", parentId: level.id, name: "梁", start: [0, 0], end: [4, 0], width: .3, height: .5,
      ceilingIds: ["ceiling-west"], effectiveCeilingElevation: { meters: 4.19, basis: "explicit-ceiling-height" },
    };
    const bottom = resolveBeamSurfaceHit(beam, 0, [2, 3.69, 0])!;
    const side = resolveBeamSurfaceHit(beam, 0, [2, 3.9, -.15], { shiftKey: true })!;
    const end = resolveBeamSurfaceHit(beam, 0, [0, 3.9, 0])!;
    expect(bottom.attachment.surface).toBe("bottom");
    expect(side).toMatchObject({ attachment: { surface: "side-a", hostId: beam.id, hostKind: "beam", levelId: level.id }, shiftKey: true });
    expect(end.attachment.surface).toBe("end-a");
    expect(resolveBeamSurfaceHit(beam, 0, [2, 4.19, 0])).toBeNull();
  });

  it("lays out the plan footprint and penetration marker in Beam-local coordinates", () => {
    const beam: BeamNode = {
      id: "beam-plan", type: "beam", parentId: level.id, name: "梁", start: [2, 1], end: [2, 5], width: .3, height: .5,
      ceilingIds: ["ceiling-north"], effectiveCeilingElevation: { meters: 4.19, basis: "explicit-ceiling-height" },
    };
    const penetration = {
      id: "penetration-test", type: "penetration" as const, hostId: beam.id, hostKind: "beam" as const,
      segmentId: "segment-test", entry: { position: [2, 0, 3] as [number, number, number] },
      exit: { position: [2, 1, 3] as [number, number, number] }, direction: [0, 1, 0] as [number, number, number], diameterMm: 50,
    };
    expect(beamFootprintLayout(beam, [penetration])).toEqual({
      center: [2, 3], length: 4, width: .3, rotationDegrees: 90,
      holes: [{ id: penetration.id, center: [0, 0], radius: .025, segmentId: penetration.segmentId }],
    });
    const planMarkup = renderToStaticMarkup(createElement(beamNodeDefinition.PlanRenderer, {
      node: beam, selected: true, penetrations: [penetration], onSelect: () => undefined,
    }));
    expect(planMarkup).toContain('data-selectable="beam"');
    expect(planMarkup).toContain("<rect");
    expect(planMarkup).toContain("Ø50 · segment-test");
    const visualMarkup = renderToStaticMarkup(createElement(beamNodeDefinition.PlanRenderer, {
      node: beam, selected: false, penetrations: [], onSelect: () => undefined, visualOnly: true,
    }));
    expect(visualMarkup).not.toContain('data-selectable="beam"');
  });

  it.skipIf(!fixturePath)("optionally validates and display-reads Beams from CONDUIT_PROJECT_FIXTURE_PATH without rewriting source identity/elevation", () => {
    const raw = JSON.parse(readFileSync(fixturePath!, "utf8")) as { nodes: Record<string, Record<string, unknown>> };
    const projectNodes = Object.fromEntries(Object.entries(raw.nodes).map(([id, node]) => [id, { ...node, type: String(node.type).toLowerCase() }])) as Record<string, NodeData>;
    const projectBeams = Object.values(projectNodes).filter((node): node is BeamNode => node.type === "beam") as BeamNode[];
    expect(projectBeams).toHaveLength(5);
    const sourceEvidence = projectBeams.map(({ id, parentId, start, end, width, height, ceilingIds, effectiveCeilingElevation }) => ({ id, parentId, start, end, width, height, ceilingIds, effectiveCeilingElevation }));
    for (const beam of projectBeams) {
      expect(beamNodeDefinition.schema.validate(beam, projectNodes).valid).toBe(true);
      expect(beamRenderTransform(beam, 0)).not.toBeNull();
      expect(beamFootprintLayout(beam)).not.toBeNull();
    }
    expect(projectBeams.map(({ id, parentId, start, end, width, height, ceilingIds, effectiveCeilingElevation }) => ({ id, parentId, start, end, width, height, ceilingIds, effectiveCeilingElevation }))).toEqual(sourceEvidence);
  });
});
