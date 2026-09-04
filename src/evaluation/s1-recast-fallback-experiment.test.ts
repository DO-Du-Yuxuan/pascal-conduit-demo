import { describe, expect, it } from "vitest";
import earcut, { flatten } from "earcut";
import { init, NavMeshQuery } from "@recast-navigation/core";
import { generateSoloNavMesh } from "@recast-navigation/generators";
import type { MultiPolygon, Point } from "./envelope";

const mesh = (polygons: MultiPolygon) => {
  const positions: number[] = [], indices: number[] = [];
  for (const polygon of polygons) {
    const flattened = flatten(polygon), offset = positions.length / 3;
    for (let index = 0; index < flattened.vertices.length; index += 2) positions.push(flattened.vertices[index]!, 0, flattened.vertices[index + 1]!);
    const raw = earcut(flattened.vertices, flattened.holes, 2);
    for (let index = 0; index < raw.length; index += 3) indices.push(raw[index]! + offset, raw[index + 2]! + offset, raw[index + 1]! + offset);
  }
  return { positions, indices };
};

describe("S1 Recast fallback smoke POC", () => {
  it("can build and query a deterministic 2D polygon with a hole", async () => {
    await init();
    const geometry: MultiPolygon = [[[[0,0],[10,0],[10,8],[0,8]], [[4,2],[6,2],[6,6],[4,6]]]], { positions, indices } = mesh(geometry), generated = generateSoloNavMesh(positions, indices);
    if (!generated.success) console.log(generated.error);
    expect(generated.success).toBe(true);
    if (!generated.success) return;
    const query = new NavMeshQuery(generated.navMesh), run = () => query.computePath({ x: 1, y: 0, z: 4 }, { x: 9, y: 0, z: 4 }, { halfExtents: { x: .5, y: .5, z: .5 } }), first = run(), second = run();
    if (!first.success) console.log(first.error, first.path);
    expect(first.success).toBe(true);
    expect(first.path.map(({ x, z }) => [x, z] as Point)).toEqual(second.path.map(({ x, z }) => [x, z] as Point));
    query.destroy(); generated.navMesh.destroy();
  }, 20_000);
});
