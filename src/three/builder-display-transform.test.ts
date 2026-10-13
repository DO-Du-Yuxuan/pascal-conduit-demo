import { Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { builderDisplayPoint, builderEditingRay, resolveBuilderDisplayTransform } from "./builder-display-transform";
import type { NodeData } from "../types";

const node = (id: string, type: string, extra: Record<string, unknown> = {}): NodeData => ({ id, type, ...extra });

describe("Builder display coordinate transform", () => {
  it("honors stored Level height and additive baseElevation only in the display transform", () => {
    const nodes = {
      building: node("building", "building", {}),
      lower: node("lower", "level", { parentId: "building", level: 0, height: 4.2, baseElevation: .1 }),
      upper: node("upper", "level", { parentId: "building", level: 1, height: 3, baseElevation: .2 }),
    };
    const before = JSON.stringify(nodes);
    const transform = resolveBuilderDisplayTransform(nodes, "upper");
    expect(transform.actualLevelBaseY).toBeCloseTo(4.5);
    expect(builderDisplayPoint([0, 3.2, 0], transform.displayMatrix)[1]).toBeCloseTo(4.5);
    expect(JSON.stringify(nodes)).toBe(before);
  });

  it("composes Building translation and XYZ rotation with Builder level stacking", () => {
    const nodes: Record<string, NodeData> = {
      building: node("building", "building", { position: [10, 2, -4], rotation: [0, Math.PI / 2, 0], children: ["lower", "upper", "active"] }),
      lower: node("lower", "level", { parentId: "building", level: 0, children: ["wall", "ceiling"] }),
      upper: node("upper", "level", { parentId: "building", level: 1, children: ["upper-wall"] }),
      active: node("active", "level", { parentId: "building", level: 2, children: [] }),
      wall: node("wall", "wall", { parentId: "lower", height: 2.8, position: [0, 0.1, 0] }),
      ceiling: node("ceiling", "ceiling", { parentId: "lower", height: 3.1 }),
      "upper-wall": node("upper-wall", "wall", { parentId: "upper", height: 3, position: [0, 0.1, 0] }),
    };
    const transform = resolveBuilderDisplayTransform(nodes, "active");
    expect(transform.actualLevelBaseY).toBeCloseTo(6.2);
    expect(transform.levelCorrectionY).toBeCloseTo(-0.2);
    expect(builderDisplayPoint([2, 6.4, 1], transform.displayMatrix)).toEqual([11, 8.2, -6]);
    expect(nodes.building.position).toEqual([10, 2, -4]);
  });

  it("uses Builder's default 2.5m level height where a floor has no wall or ceiling", () => {
    const nodes: Record<string, NodeData> = {
      building: node("building", "building", { children: ["lower", "active"] }),
      lower: node("lower", "level", { parentId: "building", level: 0, children: [] }),
      active: node("active", "level", { parentId: "building", level: 1, children: [] }),
    };
    expect(resolveBuilderDisplayTransform(nodes, "active").actualLevelBaseY).toBe(2.5);
  });

  it("matches Builder's floor clamp when a wall starts below its level plane", () => {
    const nodes: Record<string, NodeData> = {
      building: node("building", "building", { children: ["lower", "active"] }),
      lower: node("lower", "level", { parentId: "building", level: 0, children: ["wall"] }),
      active: node("active", "level", { parentId: "building", level: 1, children: [] }),
      wall: node("wall", "wall", { parentId: "lower", height: 2.9, position: [0, -0.4, 0] }),
    };
    expect(resolveBuilderDisplayTransform(nodes, "active").actualLevelBaseY).toBe(2.9);
    expect(nodes.wall.position).toEqual([0, -0.4, 0]);
  });

  it("round-trips an editing-space ray through the display transform", () => {
    const nodes: Record<string, NodeData> = {
      building: node("building", "building", { position: [-4, 3, 8], rotation: [0.1, 0.7, -0.2] }),
      level: node("level", "level", { parentId: "building", level: 0, children: [] }),
    };
    const transform = resolveBuilderDisplayTransform(nodes, "level");
    const editingOrigin = [1, 2, -3] as const;
    const editingDirection = [0.2, -0.1, -1] as const;
    const worldOrigin = new Vector3(...editingOrigin).applyMatrix4(transform.displayMatrix);
    const worldDirection = new Vector3(...editingDirection).normalize().transformDirection(transform.displayMatrix);
    const localRay = builderEditingRay([worldOrigin.x, worldOrigin.y, worldOrigin.z], [worldDirection.x, worldDirection.y, worldDirection.z], transform.worldToEditing);
    expect(localRay.origin[0]).toBeCloseTo(editingOrigin[0]);
    expect(localRay.origin[1]).toBeCloseTo(editingOrigin[1]);
    expect(localRay.origin[2]).toBeCloseTo(editingOrigin[2]);
    expect(new Vector3(...localRay.direction).dot(new Vector3(...editingDirection).normalize())).toBeCloseTo(1);
    transform.worldToEditing.clone().multiply(transform.displayMatrix).elements.forEach((value, index) => {
      expect(value).toBeCloseTo(new Matrix4().elements[index]!);
    });
  });
});
