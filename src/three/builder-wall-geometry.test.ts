import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { Evaluator } from "three-bvh-csg";
import { describe, expect, it, vi } from "vitest";
import { buildBuilderWallGeometry } from "./builder-wall-geometry";
import type { Wall } from "../geometry/walls/types";
import type { NodeData } from "../types";
import { getWallCurveFrameAt } from "../geometry/walls/curve";

const wall = (id: string, start: [number, number], end: [number, number], extras: Partial<Wall> = {}): Wall => ({
  id,
  type: "wall",
  start,
  end,
  height: 3,
  thickness: 0.2,
  ...extras,
} as Wall);

function hasVertexAt(geometry: ReturnType<typeof buildBuilderWallGeometry>, x: number, y: number, z: number) {
  const positions = geometry.getAttribute("position");
  for (let index = 0; index < positions.count; index += 1) {
    if (
      Math.abs(positions.getX(index) - x) < 1e-5 &&
      Math.abs(positions.getY(index) - y) < 1e-5 &&
      Math.abs(positions.getZ(index) - z) < 1e-5
    ) return true;
  }
  return false;
}

function rayHits(geometry: ReturnType<typeof buildBuilderWallGeometry>, origin: [number, number, number], direction: [number, number, number]) {
  const raycaster = new Raycaster(new Vector3(...origin), new Vector3(...direction));
  return raycaster.intersectObject(new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })), false);
}

describe("Builder wall geometry", () => {
  it("extrudes the supplied world footprint to the wall height and level elevation", () => {
    const horizontal = wall("horizontal", [0, 0], [4, 0]);
    const geometry = buildBuilderWallGeometry(horizontal, {
      levelWalls: [horizontal],
      levelY: 1,
    });

    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.x).toBeCloseTo(0);
    expect(geometry.boundingBox!.max.x).toBeCloseTo(4);
    expect(geometry.boundingBox!.min.y).toBeCloseTo(1);
    expect(geometry.boundingBox!.max.y).toBeCloseTo(4);
    expect(geometry.boundingBox!.min.z).toBeCloseTo(-0.1);
    expect(geometry.boundingBox!.max.z).toBeCloseTo(0.1);
  });

  it("uses the shared level miter footprint at joined wall endpoints", () => {
    const first = wall("first", [0, 0], [2, 0]);
    const second = wall("second", [2, 0], [2, 2]);
    const firstGeometry = buildBuilderWallGeometry(first, { levelWalls: [first, second] });
    const secondGeometry = buildBuilderWallGeometry(second, { levelWalls: [first, second] });

    expect(hasVertexAt(firstGeometry, 2, 0, 0)).toBe(true);
    expect(hasVertexAt(firstGeometry, 2, 3, 0)).toBe(true);
    expect(hasVertexAt(secondGeometry, 2, 0, 0)).toBe(true);
    expect(hasVertexAt(secondGeometry, 2, 3, 0)).toBe(true);
  });

  it("groups Builder interior and exterior faces separately from wall edges", () => {
    const host = wall("grouped", [0, 0], [4, 0], { frontSide: "interior", backSide: "exterior" });
    const geometry = buildBuilderWallGeometry(host, { levelWalls: [host] });
    expect(new Set(geometry.groups.map((group) => group.materialIndex))).toEqual(new Set([0, 1, 2]));
    expect(geometry.groups.reduce((sum, group) => sum + group.count, 0)).toBe(geometry.getAttribute("position").count);
  });

  it("cuts finite door and window openings through the wall without mutating project nodes", () => {
    const host = wall("host", [0, 0], [4, 0]);
    const door: NodeData = { id: "door", type: "door", parentId: host.id, wallId: host.id, position: [1, 1, 0], width: 1, height: 2 };
    const window: NodeData = { id: "window", type: "window", parentId: host.id, wallId: host.id, position: [3, 1.5, 0], width: 1, height: 1 };
    const sourceBefore = JSON.stringify({ host, door, window });
    const geometry = buildBuilderWallGeometry(host, {
      levelWalls: [host],
      openings: [door, window],
    });

    expect(rayHits(geometry, [1, 1, 1], [0, 0, -1])).toHaveLength(0);
    expect(rayHits(geometry, [3, 1.5, 1], [0, 0, -1])).toHaveLength(0);
    expect(rayHits(geometry, [2, 1.5, 1], [0, 0, -1]).length).toBeGreaterThan(0);
    expect(JSON.stringify({ host, door, window })).toBe(sourceBefore);
  });

  it("places and aims a curved-wall opening cutter at the local curve frame", () => {
    const host = wall("curved-host", [0, 0], [6, 0], { curveOffset: 1.2 });
    const along = 1.5;
    const t = along / 6;
    const frame = getWallCurveFrameAt(host, t);
    const opening: NodeData = {
      id: "curved-door", type: "door", parentId: host.id, wallId: host.id,
      position: [along, 1, 0], width: 1, height: 2,
    };
    const sourceBefore = JSON.stringify({ host, opening });
    const geometry = buildBuilderWallGeometry(host, { levelWalls: [host], openings: [opening] });
    const normal = { x: -frame.tangent.y, z: frame.tangent.x };
    const rayOrigin: [number, number, number] = [frame.point.x + normal.x, 1, frame.point.y + normal.z];
    const rayDirection: [number, number, number] = [-normal.x, 0, -normal.z];
    const solidFrame = getWallCurveFrameAt(host, 0.8);
    const solidNormal = { x: -solidFrame.tangent.y, z: solidFrame.tangent.x };

    expect(rayHits(geometry, rayOrigin, rayDirection)).toHaveLength(0);
    expect(rayHits(geometry, [solidFrame.point.x + solidNormal.x, 1.5, solidFrame.point.y + solidNormal.z], [-solidNormal.x, 0, -solidNormal.z]).length).toBeGreaterThan(0);
    expect(JSON.stringify({ host, opening })).toBe(sourceBefore);
  });

  it("returns a safe intact wall and reports the diagnostic when CSG fails", () => {
    const host = wall("fallback", [0, 0], [4, 0]);
    const opening: NodeData = { id: "bad-cut", type: "door", parentId: host.id, wallId: host.id, position: [2, 1, 0], width: 1, height: 2 };
    const onCsgFailure = vi.fn();
    const evaluate = vi.spyOn(Evaluator.prototype, "evaluate").mockImplementation(() => {
      throw new Error("forced CSG failure");
    });

    const geometry = buildBuilderWallGeometry(host, { levelWalls: [host], openings: [opening], onCsgFailure });
    geometry.computeBoundingBox();

    expect(geometry.boundingBox!.max.y).toBeCloseTo(3);
    expect(rayHits(geometry, [2, 1, 1], [0, 0, -1]).length).toBeGreaterThan(0);
    expect(onCsgFailure).toHaveBeenCalledWith("wall_csg_fallback:fallback:forced CSG failure");
    evaluate.mockRestore();
  });
});
