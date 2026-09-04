import { describe, expect, it } from "vitest";
import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import type { RoomConnectivityGraph } from "./connectivity";
import type { MultiPolygon, Point } from "./envelope";
import type { RoomNavigationAnalysis, RoomNavigableSpace } from "./navigation";
import { connectedNavigableComponents, measureFootprintGeometry, measureS1SpaceFragments } from "./s1-space-fragment";

type ZoneInput = { id: string; code?: string; room?: string | null; outline: Point[]; name?: string; relationship?: "one-to-one" | "room-with-multiple-zones" | "unmatched-zone" };
const rectangle = (x: number, z: number, width: number, depth: number): Point[] => [[x,z],[x + width,z],[x + width,z + depth],[x,z + depth]];
function fixture(zones: ZoneInput[], roomPolygons: MultiPolygon = [[rectangle(0,0,4,4)]], cells: Point[] = [[.5,.5],[1.5,.5],[2.5,.5],[3.5,.5]], gridMeters = 1) {
  const rooms = [{ roomRegionId: "R", levelId: "L1", polygons: roomPolygons, holes: roomPolygons[0]?.slice(1) ?? [], areaSquareMeters: 16, perimeterMeters: 16, compactness: .78, geometryArtifact: false, boundaryWallIds: [], sourceObjectIds: [], pascalSourceIds: [], confidence: "high" as const, diagnostics: [], usableForEvaluation: true }];
  const zoneMatches = zones.map((zone) => ({ zoneId: zone.id, levelId: "L1", overlaps: [], matchedRoomRegionIds: zone.room === null ? [] : [zone.room ?? "R"], relationship: zone.relationship ?? (zones.length > 1 ? "room-with-multiple-zones" as const : "one-to-one" as const), confidence: "high" as const, diagnostics: [] }));
  const graph = { roomAnalysis: { envelopes: [], rooms, zoneMatches, zoneOverlaps: [], unmatchedRoomRegionIds: [], roomToZoneIds: { R: zones.filter((zone) => zone.room !== null).map((zone) => zone.id) }, diagnostics: [] }, portals: [], stairConnections: [], nodes: [], edges: [], entrance: { candidateDoorIds: [], selectedDoorId: null, selectedRoomRegionId: null, confidence: "low" as const, diagnostics: [] }, diagnostics: [] } as RoomConnectivityGraph;
  const handoff = { zones: zones.map((zone) => ({ id: zone.id, name: zone.name ?? zone.id, levelId: "L1", outline: zone.outline, spaceFunctionCode: zone.code ?? null, spaceFunctionName: null })) } as unknown as EvaluationHandoff;
  const navRoom: RoomNavigableSpace = { roomRegionId: "R", levelId: "L1", zoneIds: zones.map((zone) => zone.id), zoneNames: [], mainSpace: true, gridMeters, clearanceRadiusMeters: .3, anchorPoint: cells[0] ?? null, portalNodes: [], portalConnections: [], fixedFreeCells: cells, navigableFreeCells: cells, fixedComponentCount: cells.length ? 1 : 0, furnishedComponentCount: cells.length ? 1 : 0, fixedConnected: true, furnishedConnected: true, uncertainConnected: true, fixedObstacleIds: [], fixedBlockerIds: [], largeFurnitureBlockerIds: [], uncertainObjectIds: [], ignoredSmallObjectIds: [], paths: [], diagnostics: [], usableForEvaluation: true };
  const navigation: RoomNavigationAnalysis = { graph, obstacles: [], rooms: [navRoom], diagnostics: [] };
  return { handoff, graph, navigation };
}

describe("S1-SFS footprint geometry", () => {
  it("measures a rectangle and a stable convex hull", () => {
    const geometry = measureFootprintGeometry([[rectangle(0,0,4,2)]])!;
    expect(geometry.area).toBe(8); expect(geometry.perimeter).toBe(12);
    expect(geometry.compactness).toBeCloseTo(4 * Math.PI * 8 / 144, 8);
    expect(geometry.convexHullArea).toBe(8); expect(geometry.convexityRatio).toBe(1); expect(geometry.concavePocketArea).toBe(0);
  });

  it("measures L-shaped and concave polygons against their convex hull", () => {
    const l: Point[] = [[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]], geometry = measureFootprintGeometry([[l]])!;
    expect(geometry.area).toBe(5); expect(geometry.convexHullArea).toBe(7);
    expect(geometry.convexityRatio).toBeCloseTo(5 / 7, 8); expect(geometry.concavePocketArea).toBe(2);
  });

  it("uses net area and includes hole boundaries in perimeter", () => {
    const geometry = measureFootprintGeometry([[rectangle(0,0,4,4), rectangle(1,1,2,2)]])!;
    expect(geometry.area).toBe(12); expect(geometry.perimeter).toBe(24); expect(geometry.convexHullArea).toBe(16); expect(geometry.concavePocketArea).toBe(4);
  });
});

describe("S1-SFS free-space components and instances", () => {
  it("finds one component, a furniture-separated second component, and multiple fragments", () => {
    expect(connectedNavigableComponents([[0,0],[1,0],[2,0]], 1)).toHaveLength(1);
    expect(connectedNavigableComponents([[0,0],[2,0]], 1)).toHaveLength(2);
    const f = fixture([{ id: "living", code: "SF06", outline: rectangle(0,0,4,4) }], undefined, [[.5,.5],[1.5,.5],[3.5,.5],[3.5,1.5],[.5,3.5]]), measurement = measureS1SpaceFragments(f.handoff, f.graph, f.navigation).measurements[0]!;
    expect(measurement).toMatchObject({ status: "measured", navigableComponentCount: 3, fragmentComponentCount: 2, totalNavigableAreaSquareMeters: 5, largestNavigableComponentAreaSquareMeters: 2, fragmentAreaSquareMeters: 3, fragmentAreaRatio: .6 });
  });

  it("records zero furnished free area without inventing a score or a component", () => {
    const f = fixture([{ id: "study", code: "SF16", outline: rectangle(0,0,2,2) }], undefined, []), measurement = measureS1SpaceFragments(f.handoff, f.graph, f.navigation).measurements[0]!;
    expect(measurement).toMatchObject({ status: "measured", totalNavigableAreaSquareMeters: 0, navigableComponentCount: 0, largestNavigableComponentAreaSquareMeters: 0, largestNavigableComponentRatio: null, fragmentAreaSquareMeters: 0, fragmentAreaRatio: null });
    expect(measurement.diagnostics.join(" ")).toContain("没有任何 furnished 可通行网格");
    expect(Object.keys(measurement)).not.toEqual(expect.arrayContaining(["score", "weight", "deduction", "grade", "rating"]));
  });

  it("intersects Zone with RoomRegion instead of measuring outside the room", () => {
    const f = fixture([{ id: "kitchen", code: "SF01", outline: rectangle(-2,-2,4,4) }]), measurement = measureS1SpaceFragments(f.handoff, f.graph, f.navigation).measurements[0]!;
    expect(measurement.footprintAreaSquareMeters).toBe(4); expect(measurement.footprintPolygons).toHaveLength(1);
  });

  it("keeps different SF instances separate in one RoomRegion and merges equal SF instances", () => {
    const different = fixture([{ id: "k", code: "SF01", outline: rectangle(0,0,2,4) }, { id: "d", code: "SF07", outline: rectangle(2,0,2,4) }]);
    expect(measureS1SpaceFragments(different.handoff, different.graph, different.navigation).measurements.map((item) => item.spaceFunctionCode)).toEqual(["SF01","SF07"]);
    const same = fixture([{ id: "k1", code: "SF01", outline: rectangle(0,0,2,4) }, { id: "k2", code: "SF01", outline: rectangle(2,0,2,4) }]), measured = measureS1SpaceFragments(same.handoff, same.graph, same.navigation).measurements;
    expect(measured).toHaveLength(1); expect(measured[0]?.zoneIds).toEqual(["k1","k2"]); expect(measured[0]?.footprintAreaSquareMeters).toBe(16);
  });

  it("separates equal SF codes in different RoomRegions and sorts results stably", () => {
    const f = fixture([{ id: "b", code: "SF12", outline: rectangle(0,0,2,2) }, { id: "a", code: "SF06", outline: rectangle(2,0,2,2) }]);
    const first = measureS1SpaceFragments(f.handoff, f.graph, f.navigation).measurements.map((item) => item.spaceInstanceId), second = measureS1SpaceFragments(f.handoff, f.graph, f.navigation).measurements.map((item) => item.spaceInstanceId);
    expect(first).toEqual(second); expect(first).toEqual([...first].sort());
    const zones = [{ id: "b1", code: "SF12", outline: rectangle(0,0,1,1), room: "R1" }, { id: "b2", code: "SF12", outline: rectangle(2,0,1,1), room: "R2" }];
    const twoRooms = fixture(zones), room2 = { ...twoRooms.graph.roomAnalysis.rooms[0]!, roomRegionId: "R2", polygons: [[rectangle(2,0,2,2)]] };
    twoRooms.graph.roomAnalysis.rooms = [{ ...twoRooms.graph.roomAnalysis.rooms[0]!, roomRegionId: "R1", polygons: [[rectangle(0,0,2,2)]] }, room2];
    twoRooms.graph.roomAnalysis.zoneMatches = zones.map((zone) => ({ zoneId: zone.id, levelId: "L1", overlaps: [], matchedRoomRegionIds: [zone.room!], relationship: "one-to-one", confidence: "high", diagnostics: [] }));
    twoRooms.navigation.rooms = [
      { ...twoRooms.navigation.rooms[0]!, roomRegionId: "R1", navigableFreeCells: [[.5,.5]] },
      { ...twoRooms.navigation.rooms[0]!, roomRegionId: "R2", navigableFreeCells: [[2.5,.5]] },
    ];
    expect(measureS1SpaceFragments(twoRooms.handoff, twoRooms.graph, twoRooms.navigation).measurements).toHaveLength(2);
  });

  it("does not formally measure unencoded, invalidly mapped, or outdoor Zones", () => {
    const unencoded = fixture([{ id: "unknown", outline: rectangle(0,0,2,2) }]);
    expect(measureS1SpaceFragments(unencoded.handoff, unencoded.graph, unencoded.navigation)).toMatchObject({ status: "not_applicable", measurements: [] });
    const outdoor = fixture([{ id: "garden", code: "SF51", outline: rectangle(0,0,2,2) }]);
    expect(measureS1SpaceFragments(outdoor.handoff, outdoor.graph, outdoor.navigation)).toMatchObject({ status: "not_applicable", measurements: [] });
    const invalid = fixture([{ id: "bed", code: "SF11", room: null, relationship: "unmatched-zone", outline: rectangle(0,0,2,2) }]);
    expect(measureS1SpaceFragments(invalid.handoff, invalid.graph, invalid.navigation).measurements[0]).toMatchObject({ status: "unable_to_determine", footprintAreaSquareMeters: null });
    const invalidGeometry = fixture([{ id: "crossed", code: "SF11", outline: [[0,0],[2,2],[0,2],[2,0]] }]);
    expect(measureS1SpaceFragments(invalidGeometry.handoff, invalidGeometry.graph, invalidGeometry.navigation).measurements[0]).toMatchObject({ status: "unable_to_determine", footprintAreaSquareMeters: null });
  });
});
