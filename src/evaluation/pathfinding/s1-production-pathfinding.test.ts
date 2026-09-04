import { describe, expect, it } from "vitest";
import type { MultiPolygon, Point, Ring } from "../envelope";
import { S1_PATHFINDING_AGENT_RADIUS_METERS } from "./s1-pathfinding-config";
import { validateS1RoomPath } from "./s1-path-validation";
import { resolveS1Anchor, S1VisibilityGraph } from "./s1-visibility-graph";
import { buildS1RoomWalkableGeometry, s1PointInMultiPolygon, s1SegmentInMultiPolygon } from "./s1-walkable-geometry";

const room = (polygons: MultiPolygon) => ({ roomRegionId: "R", levelId: "L1", polygons, holes: [], areaSquareMeters: 100, perimeterMeters: 40, compactness: 1, geometryArtifact: false, boundaryWallIds: [], sourceObjectIds: [], pascalSourceIds: [], confidence: "high" as const, diagnostics: [], usableForEvaluation: true });
const obstacle = (id: string, footprint: Ring) => ({ objectId: id, pascalSourceId: id, levelId: "L1", objectType: "furniture" as const, rawCategory: null, footprint, mobility: "movable" as const, classificationConfidence: "high" as const, diagnostics: [], usableForCollision: true, role: "large-movable" as const, name: null, areaSquareMeters: 1, reason: "test" });
const rect = (minX: number, minY: number, maxX: number, maxY: number): Ring => [[minX,minY],[maxX,minY],[maxX,maxY],[minX,maxY]];

describe("S1 production Polygon Visibility Graph", () => {
  it("uses a direct Euclidean path in an empty rectangle", () => {
    const geometry = buildS1RoomWalkableGeometry(room([[rect(0,0,10,10)]]), []), graph = new S1VisibilityGraph(geometry.walkablePolygons), result = graph.findPath([1,1],[9,9]);
    expect(result?.points).toEqual([[1,1],[9,9]]);
    expect(result?.lengthMeters).toBeCloseTo(Math.hypot(8,8), 6);
    expect(validateS1RoomPath(result!.points, geometry, S1_PATHFINDING_AGENT_RADIUS_METERS).valid).toBe(true);
  });

  it("does not cut across L and U-shaped concavities", () => {
    const fixtures: MultiPolygon[] = [
      [[[[0,0],[6,0],[6,2],[2,2],[2,6],[0,6]]]],
      [[[[0,0],[8,0],[8,8],[6,8],[6,2],[2,2],[2,8],[0,8]]]],
    ];
    for (const polygons of fixtures) {
      const geometry = buildS1RoomWalkableGeometry(room(polygons), []), graph = new S1VisibilityGraph(geometry.walkablePolygons), start: Point = [.5,.5], end: Point = polygons === fixtures[0] ? [.5,5.5] : [7.5,7.5], result = graph.findPath(start,end);
      expect(result).not.toBeNull();
      expect(result!.points.slice(1).every((point, index) => s1SegmentInMultiPolygon(result!.points[index]!, point, geometry.walkablePolygons))).toBe(true);
    }
  });

  it("routes stably around a central island and multiple furniture footprints", () => {
    const obstacles = [obstacle("island", rect(4,3,6,7)), obstacle("chair", rect(2,5,3,6))], geometry = buildS1RoomWalkableGeometry(room([[rect(0,0,10,10)]]), obstacles), graph = new S1VisibilityGraph(geometry.walkablePolygons);
    const first = graph.findPath([1,5],[9,5]), second = graph.findPath([1,5],[9,5]);
    expect(first?.points).toEqual(second?.points);
    expect(first!.lengthMeters).toBeGreaterThan(8);
    expect(first!.points.some((point) => s1PointInMultiPolygon(point, [[obstacles[0]!.footprint]]))).toBe(false);
  });

  it("treats holes as exclusions and respects the technical narrow-passage clearance", () => {
    const withHole: MultiPolygon = [[rect(0,0,10,10), rect(4,3,6,7)]], geometry = buildS1RoomWalkableGeometry(room(withHole), []), result = new S1VisibilityGraph(geometry.walkablePolygons).findPath([1,5],[9,5]);
    expect(result).not.toBeNull(); expect(result!.lengthMeters).toBeGreaterThan(8);
    const narrow = buildS1RoomWalkableGeometry(room([[rect(0,0,.35,4)]]), []);
    expect(narrow.walkablePolygons).toEqual([]);
  });

  it("snaps only a small numerical anchor error", () => {
    const geometry = buildS1RoomWalkableGeometry(room([[rect(0,0,4,4)]]), []);
    expect(resolveS1Anchor([.19,2], geometry.walkablePolygons)?.snappedDistanceMeters).toBeCloseTo(.01, 4);
    expect(resolveS1Anchor([0,2], geometry.walkablePolygons)).toBeNull();
  });

  it("round offset keeps rectangular and sharp obstacle corners outside the path", () => {
    const sharp: Ring = [[4,2],[7,5],[4,8]], geometry = buildS1RoomWalkableGeometry(room([[rect(0,0,10,10)]]), [obstacle("sharp", sharp)]), result = new S1VisibilityGraph(geometry.walkablePolygons).findPath([1,5],[9,5]);
    expect(result).not.toBeNull();
    expect(validateS1RoomPath(result!.points, geometry, S1_PATHFINDING_AGENT_RADIUS_METERS).valid).toBe(true);
  });
});

