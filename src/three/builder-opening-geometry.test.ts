import { Box3, ShapeUtils, Vector2, Vector3 } from "three";
// @ts-ignore Node types are intentionally not a production dependency in this Vite-only repo.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBuilderOpeningGeometry, createBuilderOpeningShape, resolveBuilderOpeningWallTransform } from "./builder-opening-geometry";
import type { NodeData } from "../types";

const node = (type: string, props: Record<string, unknown> = {}): NodeData => ({ id: "opening-test", type, ...props });
const bounds = (geometries: Array<{ geometry: any; position: [number, number, number] }>) => {
  const box = new Box3();
  for (const part of geometries) {
    part.geometry.computeBoundingBox();
    const partBox = part.geometry.boundingBox!.clone().translate(new Vector3(...part.position));
    box.union(partBox);
  }
  return box;
};

describe("Builder read-only opening geometry contract", () => {
  it("creates a fixed window from saved frame, ratio grid, sill, and material dimensions", () => {
    const result = buildBuilderOpeningGeometry(node("Window", {
      width: 4.2, height: 3.52, frameThickness: 0.06, frameDepth: 0.11,
      columnRatios: [0.25, 0.25, 0.25, 0.25], rowRatios: [0.25, 0.25, 0.25, 0.25],
      columnDividerThickness: 0.03, rowDividerThickness: 0.03, sill: true, sillDepth: 0.08,
      side: "back", rotation: [0, Math.PI, 0], operationState: 0.3,
      material: { color: "#735d4c", roughness: 0.62, metalness: 0.1 },
    }));
    const box = bounds(result.parts);
    expect(box.min.x).toBeCloseTo(-2.116, 3); // Builder sill width = window width + 0.4 * sillDepth
    expect(box.max.x).toBeCloseTo(2.116, 3);
    expect(box.max.y).toBeCloseTo(1.76, 4);
    expect(box.min.y).toBeLessThan(-1.76); // saved sill protrudes below opening
    expect(result.parts.filter((part) => part.materialRole === "glazing")).toHaveLength(16);
    expect(result.parts.some((part) => part.name === "window-column-divider-2")).toBe(true);
    expect(result.parts.find((part) => part.name === "window-sill")?.position[2]).toBeCloseTo(0.095, 4);
    const cutBox = new Box3().setFromBufferAttribute(result.cutGeometry.getAttribute("position") as any);
    expect(cutBox.min.x).toBeCloseTo(-2.1, 4);
    expect(cutBox.max.y).toBeCloseTo(1.76, 4);
    expect(result.diagnostics).toEqual([]);
  });

  it("uses Builder swingAngle for hinged leaves and operationState for barn sliding", () => {
    const closed = buildBuilderOpeningGeometry(node("Door", { width: 0.9, height: 2.1, doorType: "hinged", operationState: 0, swingAngle: 0, segments: [{ type: "glass", heightRatio: 1, columnRatios: [1], dividerThickness: 0.03, panelDepth: 0.01, panelInset: 0.04 }] }));
    const opened = buildBuilderOpeningGeometry(node("Door", { width: 0.9, height: 2.1, doorType: "hinged", operationState: 1, swingAngle: Math.PI / 2, segments: [{ type: "glass", heightRatio: 1, columnRatios: [1], dividerThickness: 0.03, panelDepth: 0.01, panelInset: 0.04 }] }));
    const closedLeaf = closed.parts.find((part) => part.name === "door-segment-0-glass-0")!;
    const openedLeaf = opened.parts.find((part) => part.name === "door-segment-0-glass-0")!;
    expect(Math.abs(closedLeaf.rotationY)).toBeCloseTo(0, 4);
    expect(Math.abs(openedLeaf.rotationY)).toBeCloseTo(Math.PI / 2, 4);
    const stateWithoutAngle = buildBuilderOpeningGeometry(node("Door", { width: 0.9, height: 2.1, doorType: "hinged", operationState: 1, swingAngle: 0 }));
    expect(Math.abs(stateWithoutAngle.parts.find((part) => part.name === "door-leaf-frame-top")!.rotationY)).toBeCloseTo(0, 4);
    const barn = buildBuilderOpeningGeometry(node("Door", { width: 1.3699856, height: 2.1, doorType: "barn", operationState: 1, slideDirection: "left", segments: [{ type: "panel", heightRatio: 1, columnRatios: [1], dividerThickness: 0.02, panelDepth: 0.008, panelInset: 0.025 }] }));
    const barnPanel = barn.parts.find((part) => part.name === "door-segment-0-panel-0")!;
    expect(barnPanel.position[0]).toBeLessThan(-1.2);
    expect(barn.parts.some((part) => part.name === "barn-track")).toBe(true);
  });

  it("shares the same arch or rounded outer dimensions for CSG and display decisions", () => {
    for (const openingShape of ["arch", "rounded"] as const) {
      const result = buildBuilderOpeningGeometry(node("Door", { width: 1.2, height: 2.4, openingKind: "opening", openingShape, archHeight: 0.4, cornerRadius: 0.2 }));
      expect(result.parts).toHaveLength(0);
      result.cutGeometry.computeBoundingBox();
      expect(result.cutGeometry.boundingBox!.min.x).toBeCloseTo(-0.6, 3);
      expect(result.cutGeometry.boundingBox!.max.x).toBeCloseTo(0.6, 3);
      expect(result.cutGeometry.boundingBox!.max.y).toBeCloseTo(1.2, 3);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("builds non-self-intersecting Builder rounded outlines with correctly inset top corners", () => {
    const windowShape = createBuilderOpeningShape(node("Window", { width: 2, height: 1.5, openingShape: "rounded", openingRadiusMode: "individual", openingCornerRadii: [0.25, 0.3, 0.1, 0.15] }));
    const windowPoints = windowShape.getPoints(12);
    const windowTriangles = ShapeUtils.triangulateShape(windowPoints.map((p) => new Vector2(p.x, p.y)), []);
    expect(windowTriangles.length).toBeGreaterThan(20);
    expect(windowPoints.some((p) => p.x > 0.73 && p.y > 0.749)).toBe(false); // top-right corner is cut in
    expect(windowPoints.some((p) => p.x < -0.8 && p.y > 0.749)).toBe(false); // top-left corner is cut in

    const doorShape = createBuilderOpeningShape(node("Door", { width: 2, height: 2.1, openingShape: "rounded", openingRadiusMode: "individual", openingTopRadii: [0.25, 0.3] }));
    const doorPoints = doorShape.getPoints(12);
    expect(ShapeUtils.triangulateShape(doorPoints.map((p) => new Vector2(p.x, p.y)), []).length).toBeGreaterThan(20);
    expect(doorPoints.some((p) => p.x < -0.99 && p.y < 0.9)).toBe(true); // door bottom corners stay square
    expect(doorPoints.some((p) => p.x > 0.73 && p.y > 1.049)).toBe(false); // top-right rounded corner
  });

  it("uses the distinct Builder Window default size and composes host yaw separately from source XYZ rotation", () => {
    const defaultWindow = buildBuilderOpeningGeometry(node("Window"));
    defaultWindow.cutGeometry.computeBoundingBox();
    expect(defaultWindow.cutGeometry.boundingBox!.max.x).toBeCloseTo(0.75, 4);
    expect(defaultWindow.cutGeometry.boundingBox!.max.y).toBeCloseTo(0.75, 4);
    const transformed = resolveBuilderOpeningWallTransform(node("Door", { position: [2, 1.05, 0], rotation: [0, Math.PI * 4, 0] }), node("wall", { start: [4, 3], end: [4, 8] }));
    expect(transformed?.position).toEqual([4, 1.05, 5]);
    expect(transformed?.wallRotationY).toBeCloseTo(-Math.PI / 2, 8);
    expect(transformed?.openingRotation[1]).toBeCloseTo(Math.PI * 4, 8);
  });

  it("reports unsupported variants without discarding their saved source dimensions", () => {
    const result = buildBuilderOpeningGeometry(node("Window", { width: 2.3, height: 1.7, windowType: "sliding", frameThickness: 0.04, frameDepth: 0.12 }));
    expect(result.parts.length).toBeGreaterThan(0);
    expect(result.diagnostics).toContain("window_variant_fallback:sliding:fixed_frame");
    expect(bounds(result.parts).max.x).toBeCloseTo(1.15, 4);
  });

  const sourcePath = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CONDUIT_PROJECT_FIXTURE_PATH;
  const hasSource = Boolean(sourcePath && existsSync(sourcePath));
  (hasSource ? it : it.skip)("accepts the supplied project JSON's 4 Door and 7 Window nodes at unscaled source dimensions", () => {
    const project = JSON.parse(readFileSync(sourcePath, "utf8"));
    const found: NodeData[] = [];
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      const item = value as NodeData;
      if (item.type === "Door" || item.type === "Window" || item.type === "door" || item.type === "window") found.push(item);
      Object.values(item).forEach(visit);
    };
    visit(project);
    const doors = found.filter((item) => item.type.toLowerCase() === "door");
    const windows = found.filter((item) => item.type.toLowerCase() === "window");
    expect(doors).toHaveLength(4);
    expect(windows).toHaveLength(7);
    expect(doors.filter((door) => door.doorType === "hinged")).toHaveLength(3);
    expect(doors.filter((door) => door.doorType === "barn")).toHaveLength(1);
    expect(windows.every((window) => window.windowType === "fixed")).toBe(true);
    for (const opening of found) {
      const result = buildBuilderOpeningGeometry(opening);
      const expectedWidth = Number(opening.width) / 2;
      result.cutGeometry.computeBoundingBox();
      expect(result.cutGeometry.boundingBox!.max.x).toBeCloseTo(expectedWidth, 4);
      expect(result.cutGeometry.boundingBox!.max.y).toBeCloseTo(Number(opening.height) / 2, 4);
      expect(result.parts.length).toBeGreaterThan(0);
    }
  });
});
