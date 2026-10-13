import { describe, expect, it } from "vitest";
import { Box3, Vector3 } from "three";
import { ColumnNode, FenceNode } from "@pascal-app/core";
import type { NodeData } from "../types";
import { buildBuilderColumnParts, buildBuilderFenceParts } from "./builder-structural-geometry";

const disposeParts = (parts: Array<{ geometry: { dispose: () => void } }>) => parts.forEach((part) => part.geometry.dispose());
const partSummary = (parts: Array<{ geometry: { getAttribute: (name: string) => { array: ArrayLike<number> }; computeBoundingBox: () => void; boundingBox: Box3 | null }; position: [number, number, number]; rotationY: number }>) => parts.map((part) => {
  part.geometry.computeBoundingBox();
  const bounds = part.geometry.boundingBox;
  return {
    position: part.position,
    rotationY: part.rotationY,
    positions: Array.from(part.geometry.getAttribute("position").array),
    bounds: bounds ? [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z] : null,
  };
});

describe("canonical Builder structural geometry", () => {
  it("fills missing ColumnNode fields from the actual Builder schema without changing raw data", () => {
    const raw: NodeData = { id: "column-raw-defaults", type: "column", futureStructuralField: { untouched: true } };
    const before = JSON.stringify(raw);
    const defaults = ColumnNode.parse({ id: "column_schema_defaults", type: "column" });
    const rawParts = buildBuilderColumnParts(raw);
    const defaultsParts = buildBuilderColumnParts(defaults as unknown as NodeData);
    expect(defaults.crossSection).toBe("round");
    expect(defaults.shaftStartScale).toBe(0.72);
    expect(defaults.baseStyle).toBe("round-rings");
    expect(partSummary(rawParts)).toEqual(partSummary(defaultsParts));
    expect(JSON.stringify(raw)).toBe(before);
    disposeParts(rawParts);
    disposeParts(defaultsParts);
  });

  it("fills absent fence style fields from the Builder schema and preserves raw future data", () => {
    const raw: NodeData = { id: "fence-raw-defaults", type: "fence", start: [0, 0], end: [4, 0], futureFenceField: "keep" };
    const before = JSON.stringify(raw);
    const defaults = FenceNode.parse({ id: "fence_schema_defaults", type: "fence", start: [0, 0], end: [4, 0] });
    const rawParts = buildBuilderFenceParts(raw);
    const defaultsParts = buildBuilderFenceParts(defaults as unknown as NodeData);
    expect(partSummary(rawParts)).toEqual(partSummary(defaultsParts));
    expect(JSON.stringify(raw)).toBe(before);
    disposeParts(rawParts);
    disposeParts(defaultsParts);
  });

  it("preserves column height and radius and emits five shafts for a cluster", () => {
    const regular: NodeData = {
      id: "column-plain",
      type: "column",
      height: 4.2,
      radius: 0.3,
      width: 0.6,
      depth: 0.6,
      baseStyle: "none",
      capitalStyle: "none",
      shaftStartScale: 1,
      shaftEndScale: 1,
    };
    const cluster: NodeData = { ...regular, id: "column-cluster", style: "cluster" };
    const regularParts = buildBuilderColumnParts(regular);
    const clusterParts = buildBuilderColumnParts(cluster);
    regularParts[0]!.geometry.computeBoundingBox();
    const regularBox = regularParts[0]!.geometry.boundingBox!;
    // Canonical ColumnRenderer overlaps shaft blocks by 1.5% to hide seams.
    expect(regularBox.max.y - regularBox.min.y).toBeCloseTo(4.263, 2);
    expect(regularParts[0]!.geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(clusterParts.length).toBe(5);
    expect(clusterParts.every((part) => {
      part.geometry.computeBoundingBox();
      return part.geometry.boundingBox!.max.y > 2;
    })).toBe(true);
    disposeParts(regularParts);
    disposeParts(clusterParts);
  });

  it("includes saved base, capital, shaft and carving details without mutating source nodes", () => {
    const column: NodeData = {
      id: "column-ionic",
      type: "column",
      style: "faceted",
      crossSection: "round",
      height: 3.2,
      radius: 0.24,
      width: 0.48,
      depth: 0.48,
      baseStyle: "ribbed-lotus",
      baseHeight: 0.28,
      baseRibCount: 16,
      capitalStyle: "leaf-carved",
      capitalHeight: 0.34,
      leafCount: 12,
      leafRows: 2,
      shaftProfile: "tapered",
      shaftTaper: 0.18,
      shaftSegmentCount: 8,
      ringCount: 4,
      fluteCount: 12,
      carvingPlacement: "all",
      baseCarvingLevel: 2,
      capitalCarvingLevel: 2,
      capitalBandCount: 2,
      lowerBandEnabled: true,
      spiralTwist: 1.4,
      spiralRibCount: 6,
      supportStyle: "vertical",
    };
    const before = JSON.stringify(column);
    const parts = buildBuilderColumnParts(column);
    const bounds = parts.reduce((box, part) => {
      part.geometry.computeBoundingBox();
      return box.union(part.geometry.boundingBox!.clone().translate(new Vector3(...part.position)));
    }, new Box3());

    expect(parts.length).toBeGreaterThan(30);
    expect(bounds.min.y).toBeCloseTo(0, 1);
    // Some carved capitals intentionally leave an open top profile.
    expect(bounds.max.y).toBeGreaterThan(3.05);
    expect(JSON.stringify(column)).toBe(before);
    disposeParts(parts);
  });

  it("uses the canonical fence generator for full style, curve, post spacing and ground controls", () => {
    const fence: NodeData = {
      id: "fence-curve",
      type: "fence",
      start: [0, 0],
      end: [5, 0],
      curveOffset: 0.8,
      height: 1.7,
      thickness: 0.12,
      baseHeight: 0.25,
      topRailHeight: 0.08,
      groundClearance: 0.2,
      edgeInset: 0.04,
      baseStyle: "floating",
      showInfill: true,
      postSpacing: 0.6,
      postSize: 0.14,
      style: "rail",
    };
    const before = JSON.stringify(fence);
    const parts = buildBuilderFenceParts(fence);
    const geometry = parts[0]!.geometry;
    geometry.computeBoundingBox();

    expect(parts).toHaveLength(1);
    expect(geometry.getAttribute("position").count).toBeGreaterThan(300);
    expect(geometry.boundingBox!.min.y).toBeGreaterThanOrEqual(0);
    expect(geometry.boundingBox!.max.y).toBeCloseTo(1.9, 1);
    expect(JSON.stringify(fence)).toBe(before);
    disposeParts(parts);
  });

  it("builds canonical A-frame supports from their actual saved spread and height", () => {
    const support: NodeData = {
      id: "column-frame",
      type: "column",
      height: 3.6,
      width: 0.3,
      depth: 0.26,
      supportStyle: "a-frame",
      braceWidth: 0.14,
      braceDepth: 0.12,
      braceBottomSpread: 2.4,
      braceTopSpread: 0.4,
      bracePlateEnabled: true,
    };
    const before = JSON.stringify(support);
    const parts = buildBuilderColumnParts(support);
    const bounds = new Box3();
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      bounds.union(part.geometry.boundingBox!.clone().translate(new Vector3(...part.position)));
    }
    expect(parts.length).toBeGreaterThanOrEqual(5);
    expect(bounds.max.y).toBeCloseTo(3.6, 1);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(2.5);
    expect(JSON.stringify(support)).toBe(before);
    disposeParts(parts);
  });
});
