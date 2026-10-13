// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ColumnNode, FenceNode } from "@pascal-app/core";
import type { NodeData } from "../types";
import { BuilderStructures, buildColumnPlanFootprints, buildFencePlanGeometry } from "./BuilderStructures";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("BuilderStructures read-only plan geometry", () => {
  it("uses SDK column defaults, saved dimensions, and yaw without changing source data", () => {
    const raw = {
      id: "column_plan_defaults", type: "column", parentId: "level-a",
      position: [2, 47, 3], rotation: Math.PI / 2, width: 0.8, depth: 0.4,
      futureColumnField: { keep: true },
    } as unknown as NodeData;
    const before = JSON.stringify(raw);
    const defaults = ColumnNode.parse({ id: "column_plan_schema_defaults", type: "column" });
    const absentShapes = buildColumnPlanFootprints(raw);
    const parsedShapes = buildColumnPlanFootprints({ ...defaults, ...raw } as unknown as NodeData);
    expect(absentShapes).toEqual(parsedShapes);
    expect(absentShapes).toHaveLength(1);
    expect(absentShapes[0]?.kind).toBe("polygon");
    const polygon = absentShapes[0]?.kind === "polygon" ? absentShapes[0].points : [];
    const xs = polygon.map(point => point.x), zs = polygon.map(point => point.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.584, 3); // saved depth × default capital scale
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(1.168, 3); // saved width × default capital scale
    expect((Math.max(...zs) + Math.min(...zs)) / 2).toBeCloseTo(3); // source Y is not plan depth
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("renders the canonical five-member column cluster footprint with schema defaults", () => {
    const column: NodeData = {
      id: "column-cluster-plan", type: "column", position: [4, 2, 5], style: "cluster", radius: 0.3,
      baseWidthScale: 1, baseDepthScale: 1, capitalWidthScale: 1, capitalDepthScale: 1,
    };
    const shapes = buildColumnPlanFootprints(column);
    expect(shapes.filter(shape => shape.kind === "circle")).toHaveLength(5);
    const circles = shapes.filter((shape): shape is Extract<typeof shape, { kind: "circle" }> => shape.kind === "circle");
    expect(circles[0]?.radius).toBeCloseTo(0.186);
    circles.slice(1).forEach(shape => expect(shape.radius).toBeCloseTo(0.108));
  });

  it("samples curved fence spans and places posts along the arc at saved spacing", () => {
    const raw: NodeData = {
      id: "fence_plan_curve", type: "fence", parentId: "level-a", start: [0, 0], end: [6, 0],
      curveOffset: 1.2, postSpacing: 1, postSize: 0.16, showInfill: true, futureFenceField: "keep",
    };
    const before = JSON.stringify(raw);
    const geometry = buildFencePlanGeometry(raw)!;
    const chordMidpoint = { x: 3, z: 0 };
    expect(geometry.points.length).toBeGreaterThan(24);
    expect(geometry.points.some(point => Math.abs(point.z) > 0.4)).toBe(true);
    expect(geometry.posts.length).toBeGreaterThan(4);
    expect(geometry.posts.some(post => Math.hypot(post.point.x - chordMidpoint.x, post.point.z) > 0.3)).toBe(true);
    geometry.posts.forEach(post => expect(post.radius).toBeCloseTo(0.08));
    expect(JSON.stringify(raw)).toBe(before);

    const endpointPosts = buildFencePlanGeometry({ ...raw, showInfill: false })!.posts;
    expect(endpointPosts).toHaveLength(2);
    const defaults = FenceNode.parse({ id: "fence_plan_schema_defaults", type: "fence", start: [0, 0], end: [6, 0] });
    expect(buildFencePlanGeometry({ id: raw.id, type: raw.type, start: raw.start, end: raw.end })?.posts.length).toBeGreaterThan(1);
    expect(defaults.postSpacing).toBe(2);
  });

  it("selects by stable source ID and filters hidden/out-of-level objects", () => {
    const nodes: Record<string, NodeData> = {
      "level-a": { id: "level-a", type: "level" },
      "level-b": { id: "level-b", type: "level" },
      "column-a": { id: "column-a", type: "column", parentId: "level-a", position: [0, 0, 0] },
      "fence-a": { id: "fence-a", type: "fence", parentId: "level-a", start: [0, 0], end: [2, 0] },
      "column-b": { id: "column-b", type: "column", parentId: "level-b", position: [8, 0, 8] },
    };
    const onSelect = vi.fn();
    const host = document.createElement("div"), root = createRoot(host);
    act(() => root.render(<svg><BuilderStructures nodes={nodes} levelId="level-a" hiddenNodeIds={new Set(["fence-a"])} selectedId="column-a" onSelect={onSelect} /></svg>));
    const column = host.querySelector('[data-builder-structure="column"][data-node-id="column-a"]')!;
    expect(column).toBeTruthy();
    expect(host.querySelector('[data-node-id="column-b"]')).toBeNull();
    expect(host.querySelector('[data-node-id="fence-a"]')).toBeNull();
    act(() => column.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSelect).toHaveBeenCalledWith("column-a");
    act(() => root.unmount());
  });

  it("accepts an already level-filtered array for direct canvas composition", () => {
    const selected = vi.fn();
    const host = document.createElement("div"), root = createRoot(host);
    act(() => root.render(<svg><BuilderStructures nodes={[{ id: "fence-array", type: "fence", start: [0, 0], end: [2, 1] }]} levelId="level-a" onSelect={selected} /></svg>));
    const fence = host.querySelector('[data-builder-structure="fence"][data-node-id="fence-array"]')!;
    expect(fence).toBeTruthy();
    act(() => fence.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(selected).toHaveBeenCalledWith("fence-array");
    act(() => root.unmount());
  });
});
