import { BoxGeometry } from "three";
import { describe, expect, it } from "vitest";
import type { BendArc, SurfaceChase } from "../domain/overlay";
import { sampleBendArc, subtractHorizontalChases, subtractWallChases } from "./chase-geometry";

const arc: BendArc = {
  start: [.8, .1, 0],
  end: [1, .1, .2],
  center: [.8, .1, .2],
  normal: [0, -1, 0],
  sweepRadians: Math.PI / 2,
};

const lineChase: SurfaceChase = {
  id: "floor-line",
  type: "surface-chase",
  hostId: "floor",
  hostKind: "slab",
  surfaceNormal: [0, 1, 0],
  routeElementId: "segment",
  path: { kind: "line", start: { position: [.2, .1, 0] }, end: { position: [1.8, .1, 0] } },
  widthMm: 30,
  depthMm: 25,
};

describe("surface chase runtime geometry", () => {
  it("samples a sweep without changing its tangent endpoints", () => {
    const samples = sampleBendArc(arc, 8);
    expect(samples).toHaveLength(9);
    expect(samples[0]).toEqual(arc.start);
    expect(samples[samples.length - 1][0]).toBeCloseTo(arc.end[0]);
    expect(samples[samples.length - 1][1]).toBeCloseTo(arc.end[1]);
    expect(samples[samples.length - 1][2]).toBeCloseTo(arc.end[2]);
  });

  it("subtracts a shallow slab chase without mutating or piercing the source box", () => {
    const base = new BoxGeometry(2, 2, .1), originalCount = base.attributes.position.count;
    const result = subtractHorizontalChases(base, [lineChase], 0, .1);
    expect(result.failed).toBe(false);
    expect(result.geometry).not.toBe(base);
    expect(base.attributes.position.count).toBe(originalCount);
    result.geometry.computeBoundingBox();
    expect(result.geometry.boundingBox?.min.z).toBeCloseTo(-.05);
    expect(result.geometry.boundingBox?.max.z).toBeCloseTo(.05);
  });

  it("subtracts wall line and sweep chases as shallow face cuts", () => {
    const wallLine = { ...lineChase, id: "wall-line", hostId: "wall", hostKind: "wall" as const, surfaceNormal: [0, 0, 1] as [number, number, number], path: { kind: "line" as const, start: { position: [.2, 1, .1] as [number, number, number] }, end: { position: [1.8, 1, .1] as [number, number, number] } } };
    const wallArc: SurfaceChase = { ...wallLine, id: "wall-arc", routeElementId: "elbow", path: { kind: "arc", arc } };
    const base = new BoxGeometry(2, 2, .2), result = subtractWallChases(base, [wallLine, wallArc], [0, 0, 0], [2, 0, 0], 0, 0, 1, .2);
    expect(result.failed).toBe(false);
    expect(result.geometry).not.toBe(base);
    result.geometry.computeBoundingBox();
    expect(result.geometry.boundingBox?.min.z).toBeCloseTo(-.1);
    expect(result.geometry.boundingBox?.max.z).toBeCloseTo(.1);
  });

  it("does no CSG work when there are no committed chase records", () => {
    const base = new BoxGeometry(1, 1, .1);
    expect(subtractHorizontalChases(base, [], 0, .1)).toEqual({ geometry: base, failed: false });
    expect(subtractWallChases(base, [], [0, 0, 0], [1, 0, 0], 0, 0, .5, .1)).toEqual({ geometry: base, failed: false });
  });
});
