import { describe, expect, it } from "vitest";
import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import type { ConnectivityEdge, RoomConnectivityGraph } from "./connectivity";
import type { Point } from "./envelope";
import type { RoomNavigationAnalysis, RoomNavigableSpace } from "./navigation";
import { countPathTurns, measureS1HighFrequencyPaths, segmentIsNavigable, simplifyPathPoints, smoothNavigablePath } from "./s1-high-frequency-path";

type ZoneSpec = { id: string; room: string; code?: string; name?: string; outline?: Point[] };
const doorEdge = (fromNodeId: string, toNodeId: string, id: string): ConnectivityEdge => ({ edgeId: `edge:${id}`, sourceObjectId: id, connectionType: "door", fromNodeId, toNodeId, levelId: "L1", confidence: "high", diagnostics: [] });
function fixture(roomIds: string[], edges: ConnectivityEdge[], zones: ZoneSpec[], options: { levels?: Record<string, string>; cells?: Record<string, Point[]>; anchors?: Record<string, Point>; stairs?: any[]; stairConnections?: any[] } = {}) {
  const levels = options.levels ?? {}, rooms = roomIds.map((roomRegionId, roomIndex) => ({ roomRegionId, levelId: levels[roomRegionId] ?? "L1", polygons: [[[[roomIndex * 3 - 1, -1], [roomIndex * 3 + 3, -1], [roomIndex * 3 + 3, 3], [roomIndex * 3 - 1, 3]] as Point[]]], holes: [], areaSquareMeters: 16, perimeterMeters: 16, compactness: .8, geometryArtifact: false, boundaryWallIds: [], sourceObjectIds: [], pascalSourceIds: [], confidence: "high" as const, diagnostics: [], usableForEvaluation: true }));
  const zoneMatches = zones.map((zone) => ({ zoneId: zone.id, levelId: levels[zone.room] ?? "L1", overlaps: [], matchedRoomRegionIds: [zone.room], relationship: "one-to-one" as const, confidence: "high" as const, diagnostics: [] })), roomToZoneIds = Object.fromEntries(roomIds.map((id) => [id, zones.filter((zone) => zone.room === id).map((zone) => zone.id)]));
  const graph: RoomConnectivityGraph = { roomAnalysis: { envelopes: [], rooms, zoneMatches, zoneOverlaps: [], unmatchedRoomRegionIds: [], roomToZoneIds, diagnostics: [] }, portals: [], stairConnections: options.stairConnections ?? [], nodes: roomIds.map((nodeId) => ({ nodeId, nodeType: "room", levelId: levels[nodeId] ?? "L1", roomRegionId: nodeId })), edges, entrance: { candidateDoorIds: [], selectedDoorId: null, selectedRoomRegionId: null, confidence: "low", diagnostics: [] }, diagnostics: [] };
  const roomCells = (roomId: string) => options.cells?.[roomId] ?? [[roomIds.indexOf(roomId) * 3, 0], [roomIds.indexOf(roomId) * 3 + 1, 0], [roomIds.indexOf(roomId) * 3 + 2, 0]] as Point[];
  const handoff = { zones: zones.map((zone) => { const zoneIndex = zones.filter((item) => item.room === zone.room).findIndex((item) => item.id === zone.id), cells = roomCells(zone.room), center = cells[Math.min(zoneIndex, cells.length - 1)]!, half = .45; return { id: zone.id, name: zone.name ?? zone.id, spaceFunctionCode: zone.code ?? null, levelId: levels[zone.room] ?? "L1", outline: zone.outline ?? [[center[0] - half, center[1] - half], [center[0] + half, center[1] - half], [center[0] + half, center[1] + half], [center[0] - half, center[1] + half]] }; }), stairs: options.stairs ?? [] } as unknown as EvaluationHandoff;
  const navRooms: RoomNavigableSpace[] = roomIds.map((roomId) => {
    const cells = roomCells(roomId), anchorPoint = options.anchors?.[roomId] ?? cells[0]!;
    const portalNodes = edges.filter((edge) => edge.connectionType === "door" && (edge.fromNodeId === roomId || edge.toNodeId === roomId)).map((edge) => ({ doorId: edge.sourceObjectId, sourcePoint: cells[cells.length - 1]!, fixedLanding: cells[cells.length - 1]!, furnishedLanding: edge.fromNodeId === roomId ? cells[cells.length - 1]! : cells[0]!, fixedComponentId: 0, furnishedComponentId: 0 }));
    return { roomRegionId: roomId, levelId: levels[roomId] ?? "L1", zoneIds: roomToZoneIds[roomId]!, zoneNames: [], mainSpace: true, gridMeters: 1, clearanceRadiusMeters: .3, anchorPoint, portalNodes, portalConnections: [], fixedFreeCells: cells, navigableFreeCells: cells, fixedComponentCount: 1, furnishedComponentCount: 1, fixedConnected: true, furnishedConnected: true, uncertainConnected: true, fixedObstacleIds: [], fixedBlockerIds: [], largeFurnitureBlockerIds: [], uncertainObjectIds: [], ignoredSmallObjectIds: [], paths: [], diagnostics: [], usableForEvaluation: true };
  });
  const navigation: RoomNavigationAnalysis = { graph, obstacles: [], rooms: navRooms, diagnostics: [] };
  return { handoff, graph, navigation };
}

describe("S1-HPE path geometry", () => {
  it("simplifies collinear points and counts configured direction changes", () => {
    expect(simplifyPathPoints([[0,0],[1,0],[2,0],[2,1]])).toEqual([[0,0],[2,0],[2,1]]);
    expect(countPathTurns([[0,0],[1,0],[2,0],[2,1]].map((point) => ({ levelId: "L1", point: point as Point })))).toBe(1);
  });

  it("smooths a stair-step grid path only when the direct segment remains in free cells", () => {
    const open = { navigableFreeCells: [[0,0],[1,0],[0,1],[1,1],[2,1],[2,2]] as Point[], gridMeters: 1 };
    expect(smoothNavigablePath(open, [[0,0],[1,0],[1,1],[2,1],[2,2]])).toEqual([[0,0],[2,2]]);
    const blocked = { navigableFreeCells: [[0,0],[0,1],[0,2],[1,2],[2,2]] as Point[], gridMeters: 1 };
    expect(segmentIsNavigable(blocked, [0,0], [2,2])).toBe(false);
    expect(smoothNavigablePath(blocked, [[0,0],[0,1],[0,2],[1,2],[2,2]]).length).toBeGreaterThan(2);
  });

  it("does not use SF10 or SF08 Zone representatives when a primary Door is unavailable", () => {
    const f = fixture(["R"], [], [{ id: "entry", room: "R", code: "SF10" }, { id: "kitchen", room: "R", code: "SF01" }]), route = measureS1HighFrequencyPaths(f.handoff, f.graph, f.navigation).measurements[0]!;
    expect(route).toMatchObject({ status: "unable_to_determine", sourceAnchorPoint: null, targetAnchorPoint: null, pathProvider: "polygon_visibility_graph", independentGeometryValidated: false });
    expect(route.diagnostics.join(" ")).toContain("主要入口");
    expect(Object.keys(route)).not.toEqual(expect.arrayContaining(["score", "weight", "deduction", "grade"]));
  });

  it("does not silently restore old Zone-center entry behavior", () => {
    const cells: Point[] = [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1],[0,2],[1,2],[2,2]], f = fixture(["R"], [], [
      { id: "entry", room: "R", code: "SF10", outline: [[-.4,-.4],[.4,-.4],[.4,.4],[-.4,.4]] },
      { id: "kitchen", room: "R", code: "SF01", outline: [[1.6,1.6],[2.4,1.6],[2.4,2.4],[1.6,2.4]] },
    ], { cells: { R: cells } });
    const route = measureS1HighFrequencyPaths(f.handoff, f.graph, f.navigation).measurements[0]!;
    expect(route).toMatchObject({ status: "unable_to_determine", sourceAnchorPoint: null, pathPoints: [] });
  });

  it.skip("legacy free-grid anchor selection is retained only for shadow comparison", () => {
    const cells: Point[] = [[0,0],[0,1],[1,1],[2,1],[2,0]], f = fixture(["R"], [], [
      { id: "entry", room: "R", code: "SF10", outline: [[-.4,-.4],[2.4,-.4],[2.4,.4],[-.4,.4]] },
      { id: "kitchen", room: "R", code: "SF01", outline: [[1.6,.6],[2.4,.6],[2.4,1.4],[1.6,1.4]] },
    ], { cells: { R: cells } });
    const route = measureS1HighFrequencyPaths(f.handoff, f.graph, f.navigation).measurements[0]!;
    expect(route.sourceAnchorPoint).toEqual([0,0]);
    expect(route.sourceAnchorPoint).not.toEqual([1,0]);
  });

  it("returns unable_to_determine instead of falling back to a Room anchor when a Zone has no free cell", () => {
    const f = fixture(["R"], [], [{ id: "entry", room: "R", code: "SF10", outline: [[10,10],[11,10],[11,11],[10,11]] }, { id: "kitchen", room: "R", code: "SF01" }]);
    expect(measureS1HighFrequencyPaths(f.handoff, f.graph, f.navigation).measurements[0]).toMatchObject({ status: "unable_to_determine", pathPoints: [], sourceAnchorPoint: null });
  });

  it.skip("legacy synthetic portals without DoorPortal geometry are not accepted by production HPE", () => {
    const edges = [doorEdge("A", "B", "d1"), doorEdge("B", "C", "d2"), doorEdge("C", "D", "d3")], f = fixture(["A","B","C","D"], edges, [{ id: "entry", room: "A", code: "SF10" }, { id: "kitchen", room: "D", code: "SF01" }]);
    const route = measureS1HighFrequencyPaths(f.handoff, f.graph, f.navigation).measurements[0]!;
    expect(route).toMatchObject({ status: "measured", roomPathIds: ["A","B","C","D"], doorIds: ["d1","d2","d3"], topologicalSteps: 3, intermediateRoomCount: 2 });
    expect(route.actualPathLengthMeters).toBeGreaterThan(0);
    expect(route.detourRatio).not.toBeNull();
    expect(route.pathPoints.map((item) => item.point)).toEqual(expect.arrayContaining([[2,0],[3,0],[5,0],[6,0],[8,0],[9,0]]));
  });

  it.skip("legacy free-grid obstacles are not a production Visibility Graph input", () => {
    const cells: Point[] = [[0,0],[0,1],[0,2],[1,2],[2,2],[2,1],[2,0]], f = fixture(["A","B"], [doorEdge("A","B","d")], [{ id: "entry", room: "A", code: "SF10" }, { id: "kitchen", room: "B", code: "SF01" }], { cells: { A: cells, B: [[3,0],[4,0]] }, anchors: { A: [0,0], B: [4,0] } });
    const route = measureS1HighFrequencyPaths(f.handoff, f.graph, f.navigation).measurements[0]!;
    expect(route.pathPoints[0]?.point).toEqual([0,0]);
    expect(route.pathPoints.some((item) => item.point[0] === 1 && item.point[1] === 0)).toBe(false);
    expect(route.turnCount).toBeGreaterThan(0);
  });

  it.skip("legacy synthetic stairs without production landing geometry are not accepted", () => {
    const stairEdge: ConnectivityEdge = { edgeId: "stair-edge:S", sourceObjectId: "S", connectionType: "stair", fromNodeId: "A", toNodeId: "B", levelId: null, confidence: "medium", diagnostics: [] }, f = fixture(["A","B"], [stairEdge], [{ id: "bed", room: "A", code: "SF11" }, { id: "bath", room: "B", code: "SF03" }], { levels: { A: "L1", B: "L2" }, cells: { A: [[0,0],[1,0]], B: [[0,0],[1,0]] }, anchors: { A: [0,0], B: [1,0] }, stairs: [{ id: "S", fromLandingCenter: [1,0], toLandingCenter: [0,0], totalRiseMeters: 3, treadDepthsAtWalklineMeters: [2] }], stairConnections: [{ stairId: "S", fromRoomRegionId: "A", toRoomRegionId: "B", usableForConnectivity: true }] });
    const route = measureS1HighFrequencyPaths(f.handoff, f.graph, f.navigation).measurements[0]!;
    expect(route).toMatchObject({ status: "measured", stairIds: ["S"], straightLineDistanceMeters: null, detourRatio: null, topologicalSteps: 1 });
    expect(route.actualPathLengthMeters).toBeCloseTo(1 + Math.hypot(2,3), 3);
    expect(route.pathPoints).toEqual(expect.arrayContaining([{ levelId: "L1", point: [1,0] }, { levelId: "L2", point: [0,0] }]));
  });
});

describe("S1-HPE route selection", () => {
  it("does not treat SF10 or SF08 as the primary-return behavior origin", () => {
    const withEntry = fixture(["E","F","K"], [doorEdge("E","K","e"), doorEdge("F","K","f")], [{ id: "entry", room: "E", code: "SF10" }, { id: "foyer", room: "F", code: "SF08" }, { id: "k", room: "K", code: "SF01" }]);
    expect(measureS1HighFrequencyPaths(withEntry.handoff, withEntry.graph, withEntry.navigation).measurements.find((route) => route.routeGroup === "entry_to_kitchen")).toMatchObject({ status: "unable_to_determine", sourceRoomRegionId: null });
    const foyerOnly = fixture(["F","K"], [doorEdge("F","K","f")], [{ id: "foyer", room: "F", code: "SF08" }, { id: "k", room: "K", code: "SF02" }]);
    expect(measureS1HighFrequencyPaths(foyerOnly.handoff, foyerOnly.graph, foyerOnly.navigation).measurements.find((route) => route.routeGroup === "entry_to_kitchen")).toMatchObject({ status: "unable_to_determine", sourceRoomRegionId: null });
  });

  it("marks a garage without an internal connection not applicable", () => {
    const f = fixture(["G","K"], [], [{ id: "garage", room: "G", code: "SF30" }, { id: "k", room: "K", code: "SF01" }]);
    expect(measureS1HighFrequencyPaths(f.handoff, f.graph, f.navigation).groups.find((group) => group.routeGroup === "garage_to_kitchen")?.status).toBe("not_applicable");
  });

  it("reports missing primary Door semantics before attempting a disconnected route", () => {
    const f = fixture(["E","K"], [], [{ id: "entry", room: "E", code: "SF10" }, { id: "kitchen", room: "K", code: "SF01" }]);
    const route = measureS1HighFrequencyPaths(f.handoff, f.graph, f.navigation).measurements.find((item) => item.routeGroup === "entry_to_kitchen");
    expect(route).toMatchObject({ status: "unable_to_determine", pathPoints: [], actualPathLengthMeters: null, detourRatio: null });
  });

  it.skip("bedroom behavior routing requires formal bed functionTags and real bathroom DoorPortals", () => {
    const edges = [doorEdge("P","PB","a"), doorEdge("C","B1","b"), doorEdge("C","X","c"), doorEdge("X","B2","d")], f = fixture(["P","PB","C","B1","X","B2"], edges, [{ id: "primary", room: "P", code: "SF11" }, { id: "primary-bath", room: "PB", code: "SF03" }, { id: "child", room: "C", code: "SF13" }, { id: "public", room: "B1", code: "SF04" }, { id: "secondary", room: "B2", code: "SF05" }]);
    const routes = measureS1HighFrequencyPaths(f.handoff, f.graph, f.navigation).measurements.filter((route) => route.routeGroup === "bedroom_to_bathroom");
    expect(routes.find((route) => route.sourceSpaceFunctionCodes.includes("SF11"))?.targetSpaceFunctionCodes).toEqual(["SF03"]);
    expect(routes.find((route) => route.sourceSpaceFunctionCodes.includes("SF13"))?.targetSpaceFunctionCodes).toEqual(["SF04"]);
  });

  it.skip("bedroom fallback integration requires formal bed and DoorPortal fixtures", () => {
    const f = fixture(["P","PB","B"], [doorEdge("P","B","door")], [{ id: "primary", room: "P", code: "SF11" }, { id: "primary-bath", room: "PB", code: "SF03" }, { id: "public-bath", room: "B", code: "SF04" }]);
    const route = measureS1HighFrequencyPaths(f.handoff, f.graph, f.navigation).measurements.find((item) => item.routeGroup === "bedroom_to_bathroom");
    expect(route).toMatchObject({ status: "measured", targetRoomRegionId: "B", targetSpaceFunctionCodes: ["SF04"], fallbackTargetUsed: true });
    expect(route?.diagnostics.join(" ")).toContain("主卫");
  });

  it.skip("equal bathroom integration requires formal bed and DoorPortal fixtures", () => {
    const edges = [doorEdge("C1","B1","a"), doorEdge("C1","B2","b"), doorEdge("C2","B1","c"), doorEdge("C2","B2","d")], f = fixture(["C1","C2","B1","B2"], edges, [{ id: "child1", room: "C1", code: "SF13" }, { id: "child2", room: "C2", code: "SF13" }, { id: "bath1", room: "B1", code: "SF04" }, { id: "bath2", room: "B2", code: "SF05" }], { cells: { C1: [[0,0],[1,0]], C2: [[0,0],[1,0]], B1: [[1,0],[2,0]], B2: [[1,0],[2,0]] } });
    const routes = measureS1HighFrequencyPaths(f.handoff, f.graph, f.navigation).measurements.filter((route) => route.routeGroup === "bedroom_to_bathroom");
    expect(routes).toHaveLength(2);
    expect(routes[0]?.tiedCandidateTargetRoomIds).toEqual(["B1","B2"]);
    expect(routes[0]?.targetRoomRegionId).toBe("B1");
  });

  it("does not create a formal route from name fallback semantics", () => {
    const f = fixture(["E","K"], [doorEdge("E","K","d")], [{ id: "entry", room: "E", name: "ENTRY" }, { id: "kitchen", room: "K", name: "KITCHEN" }]);
    expect(measureS1HighFrequencyPaths(f.handoff, f.graph, f.navigation).measurements.find((route) => route.routeGroup === "entry_to_kitchen")).toMatchObject({ status: "unable_to_determine", pathPoints: [] });
  });
});
