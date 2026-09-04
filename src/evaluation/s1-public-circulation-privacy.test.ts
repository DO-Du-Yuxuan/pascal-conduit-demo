import { describe, expect, it } from "vitest";
import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import type { ConnectivityEdge, RoomConnectivityGraph } from "./connectivity";
import { findPrivacySafeRoomPath, measureS1PublicCirculationPrivacy } from "./s1-public-circulation-privacy";
import { scoreS1PublicCirculationPrivacy } from "./s1-public-circulation-privacy-scoring";

const edge = (fromNodeId: string, toNodeId: string, id: string, connectionType: ConnectivityEdge["connectionType"] = "door"): ConnectivityEdge => ({ edgeId: `edge:${id}`, sourceObjectId: id, connectionType, fromNodeId, toNodeId, levelId: connectionType === "stair" ? null : "L1", confidence: "high", diagnostics: [] });
const graph = (roomIds: string[], edges: ConnectivityEdge[], levels: Record<string, string> = {}, entranceRoomId: string | null = null): RoomConnectivityGraph => ({
  roomAnalysis: { envelopes: [], rooms: roomIds.map((roomRegionId) => ({ roomRegionId, levelId: levels[roomRegionId] ?? "L1", polygons: [], holes: [], areaSquareMeters: 10, perimeterMeters: 12, compactness: .8, geometryArtifact: false, boundaryWallIds: [], sourceObjectIds: [], pascalSourceIds: [], confidence: "high", diagnostics: [], usableForEvaluation: true })), zoneMatches: [], zoneOverlaps: [], unmatchedRoomRegionIds: [], roomToZoneIds: Object.fromEntries(roomIds.map((id) => [id, []])), diagnostics: [] },
  portals: [], stairConnections: [], nodes: roomIds.map((nodeId) => ({ nodeId, nodeType: "room", levelId: levels[nodeId] ?? "L1", roomRegionId: nodeId })), edges,
  entrance: { candidateDoorIds: entranceRoomId ? ["front-door"] : [], selectedDoorId: entranceRoomId ? "front-door" : null, selectedRoomRegionId: entranceRoomId, confidence: entranceRoomId ? "high" : "low", diagnostics: entranceRoomId ? [] : [{ code: "no_entry", message: "没有可靠主入口" }] }, diagnostics: [],
});

type ZoneSpec = { id: string; room: string | null; code?: string; name?: string };
function handoffWithZones(baseGraph: RoomConnectivityGraph, specs: ZoneSpec[]): EvaluationHandoff {
  const zones = specs.map((spec) => ({ id: spec.id, rawPascalId: spec.id, name: spec.name ?? spec.id, parentId: null, levelId: spec.room ? baseGraph.roomAnalysis.rooms.find((room) => room.roomRegionId === spec.room)?.levelId ?? "L1" : "L1", visible: true, spaceFunctionCode: spec.code ?? null, spaceFunctionName: null, color: null, outline: [], areaSquareMeters: 1 }));
  baseGraph.roomAnalysis.zoneMatches = specs.map((spec) => ({ zoneId: spec.id, levelId: "L1", overlaps: [], matchedRoomRegionIds: spec.room ? [spec.room] : [], relationship: spec.room ? "one-to-one" as const : "unmatched-zone" as const, confidence: spec.room ? "high" as const : "low" as const, diagnostics: [] }));
  specs.forEach((spec) => { if (spec.room) baseGraph.roomAnalysis.roomToZoneIds[spec.room] = [...(baseGraph.roomAnalysis.roomToZoneIds[spec.room] ?? []), spec.id]; });
  return { zones, doors: [], levels: [], stairs: [] } as unknown as EvaluationHandoff;
}

describe("S1 public circulation privacy raw graph measurement", () => {
  it("finds an alternative safe path even when the stable baseline crosses a private room", () => {
    const g = graph(["A", "P", "X", "B"], [edge("A", "P", "01"), edge("P", "B", "02"), edge("A", "X", "03"), edge("X", "B", "04")]);
    const result = findPrivacySafeRoomPath(g, "A", "B", new Set(["P"]));
    expect(result.baselinePath?.roomRegionIds).toEqual(["A", "P", "B"]);
    expect(result.privacySafePath?.roomRegionIds).toEqual(["A", "X", "B"]);
  });

  it("detects mandatory private traversal, multiple private witnesses, and stable equal paths", () => {
    const g = graph(["A", "P1", "P2", "B", "Q1", "Q2"], [edge("A", "P1", "01"), edge("P1", "P2", "02"), edge("P2", "B", "03"), edge("A", "Q1", "11"), edge("Q1", "Q2", "12"), edge("Q2", "B", "13")]);
    const first = findPrivacySafeRoomPath(g, "A", "B", new Set(["P1", "P2", "Q1", "Q2"]));
    const second = findPrivacySafeRoomPath(g, "A", "B", new Set(["P1", "P2", "Q1", "Q2"]));
    expect(first.baselinePath?.roomRegionIds).toEqual(["A", "P1", "P2", "B"]);
    expect(first.privacySafePath).toBeNull();
    expect(second).toEqual(first);
  });

  it("preserves private source and target endpoints", () => {
    const g = graph(["A", "B"], [edge("A", "B", "d")]);
    expect(findPrivacySafeRoomPath(g, "A", "B", new Set(["A", "B"])).privacySafePath?.roomRegionIds).toEqual(["A", "B"]);
  });

  it("returns baseline unreachable without inventing a safe path", () => {
    const result = findPrivacySafeRoomPath(graph(["A", "B"], []), "A", "B", new Set());
    expect(result).toEqual({ baselinePath: null, privacySafePath: null });
  });

  it("retains cross-level stairs in the safe path", () => {
    const g = graph(["A", "S", "B"], [edge("A", "S", "door"), edge("S", "B", "stair-1", "stair")], { A: "L1", S: "L1", B: "L2" });
    expect(findPrivacySafeRoomPath(g, "A", "B", new Set()).privacySafePath?.edges.map((item) => item.sourceObjectId)).toEqual(["door", "stair-1"]);
  });
});

describe("S1 public circulation privacy route generation", () => {
  it("uses authoritative SF instances, merges zones in one room, and measures each distinct room instance", () => {
    const g = graph(["E", "L1", "L2", "PB", "P1", "P2"], [edge("E", "L1", "e-l1"), edge("L1", "PB", "l1-pb"), edge("L2", "P1", "l2-p1"), edge("P1", "P2", "p1-p2"), edge("P2", "PB", "p2-pb")]);
    const h = handoffWithZones(g, [
      { id: "entry", room: "E", code: "SF10" }, { id: "living-a", room: "L1", code: "SF06" }, { id: "living-a-2", room: "L1", code: "SF06" }, { id: "living-b", room: "L2", code: "SF06" }, { id: "bath", room: "PB", code: "SF04" }, { id: "bed", room: "P1", code: "SF11" }, { id: "closet", room: "P2", code: "SF15" },
    ]);
    const report = measureS1PublicCirculationPrivacy(h, g);
    const visitorRoutes = report.measurements.filter((route) => route.routeGroup === "visitor_to_public_bathroom");
    expect(visitorRoutes).toHaveLength(2);
    expect(Object.keys(visitorRoutes[0]!)).not.toEqual(expect.arrayContaining(["score", "weight", "deduction", "grade", "rating", "maxScore"]));
    expect(visitorRoutes.find((route) => route.sourceRoomRegionId === "L1")?.sourceZoneIds).toEqual(["living-a", "living-a-2"]);
    expect(visitorRoutes.find((route) => route.sourceRoomRegionId === "L2")).toMatchObject({ resultType: "private_space_mandatory", privateIntermediateRoomRegionIds: ["P1", "P2"] });
  });

  it("uses the selected graph entrance only when SF10 is absent", () => {
    const g = graph(["E", "L"], [edge("E", "L", "front")], {}, "E"), h = handoffWithZones(g, [{ id: "living", room: "L", code: "SF06" }]);
    const route = measureS1PublicCirculationPrivacy(h, g).measurements.find((item) => item.routeGroup === "entry_to_public");
    expect(route).toMatchObject({ source: { roomRegionId: "E", semanticSource: "graph_entrance" }, resultType: "privacy_safe_route_available" });
    expect(scoreS1PublicCirculationPrivacy(measureS1PublicCirculationPrivacy(h, g)).groupScores.find((item) => item.routeGroup === "entry_to_public")).toMatchObject({ status: "scored", score: 100 });
  });

  it("measures each SF10 entrance instance separately", () => {
    const g = graph(["E1", "E2", "L"], [edge("E1", "L", "one"), edge("E2", "L", "two")]), h = handoffWithZones(g, [{ id: "entry-1", room: "E1", code: "SF10" }, { id: "entry-2", room: "E2", code: "SF10" }, { id: "living", room: "L", code: "SF06" }]);
    const report = measureS1PublicCirculationPrivacy(h, g), routes = report.measurements.filter((item) => item.routeGroup === "entry_to_public");
    expect(routes.map((item) => item.sourceRoomRegionId)).toEqual(["E1", "E2"]);
    expect(scoreS1PublicCirculationPrivacy(report).groupScores.find((item) => item.routeGroup === "entry_to_public")).toMatchObject({ status: "scored", score: 100, evaluableRouteCount: 2 });
  });

  it("does not use SF03 as the visitor bathroom and does not use SF17 as public outdoor", () => {
    const g = graph(["L", "B", "O"], [edge("L", "B", "lb"), edge("L", "O", "lo")]), h = handoffWithZones(g, [{ id: "living", room: "L", code: "SF06" }, { id: "primary-bath", room: "B", code: "SF03" }, { id: "balcony", room: "O", code: "SF17" }]);
    const report = measureS1PublicCirculationPrivacy(h, g);
    expect(report.groups.find((group) => group.routeGroup === "visitor_to_public_bathroom")?.status).toBe("not_applicable");
    expect(report.groups.find((group) => group.routeGroup === "public_to_public_outdoor")?.status).toBe("not_applicable");
  });

  it("includes a garage only with a reliable internal non-stair connection", () => {
    const disconnected = graph(["G", "F"], []), h1 = handoffWithZones(disconnected, [{ id: "garage", room: "G", code: "SF30" }, { id: "foyer", room: "F", code: "SF08" }]);
    expect(measureS1PublicCirculationPrivacy(h1, disconnected).groups.find((group) => group.routeGroup === "garage_return")?.status).toBe("not_applicable");
    const connected = graph(["G", "F"], [edge("G", "F", "internal")]), h2 = handoffWithZones(connected, [{ id: "garage", room: "G", code: "SF30" }, { id: "foyer", room: "F", code: "SF08" }]);
    expect(measureS1PublicCirculationPrivacy(h2, connected).measurements.find((route) => route.routeGroup === "garage_return")).toMatchObject({ resultType: "privacy_safe_route_available", connectionDoorIds: ["internal"] });
  });

  it("returns unable for name fallback or unreliable coded RoomRegion mapping", () => {
    const g1 = graph(["L"], []), fallback = handoffWithZones(g1, [{ id: "living", room: "L", name: "LIVING ROOM" }, { id: "bath", room: "L", name: "PUBLIC BATH" }]);
    expect(measureS1PublicCirculationPrivacy(fallback, g1).groups.find((group) => group.routeGroup === "visitor_to_public_bathroom")?.status).toBe("unable_to_determine");
    const g2 = graph(["L"], []), invalid = handoffWithZones(g2, [{ id: "living", room: "L", code: "SF06" }, { id: "bath", room: null, code: "SF04" }]);
    expect(measureS1PublicCirculationPrivacy(invalid, g2).groups.find((group) => group.routeGroup === "visitor_to_public_bathroom")?.status).toBe("unable_to_determine");
  });
});
