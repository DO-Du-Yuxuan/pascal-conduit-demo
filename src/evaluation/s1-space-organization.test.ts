import { describe, expect, it } from "vitest";
import { measureS1EntrySequence, scoreS1SpaceOrganization } from "./s1-space-organization";

const graph = (rows: Array<[string, string]> = [], options: { primary?: string[]; exterior?: string[] } = {}) => {
  const roomIds = [...new Set(rows.flatMap((row) => row).concat(["G", "M", "P", "L", "N", "B"]))];
  const primary = options.primary ?? ["door-primary"], exterior = options.exterior ?? [];
  const portals: any[] = primary.map((doorId, index) => ({ doorId, isPrimaryEntrance: true, usableForConnectivity: true, connectsExterior: false, roomRegionAId: "G", roomRegionBId: "M", confidence: "high" }));
  exterior.forEach((doorId) => portals.push({ doorId, isPrimaryEntrance: false, usableForConnectivity: true, connectsExterior: true, roomRegionAId: "M", roomRegionBId: null, confidence: "high" }));
  return { nodes: roomIds.map((nodeId) => ({ nodeId, nodeType: "room", levelId: "L1" })), edges: rows.map(([fromNodeId, toNodeId], index) => ({ edgeId: `edge-${index}`, sourceObjectId: `door-${index}`, connectionType: "door", fromNodeId, toNodeId, levelId: "L1", confidence: "high", diagnostics: [] })), portals, roomAnalysis: { roomToZoneIds: Object.fromEntries(roomIds.map((roomId) => [roomId, [`z-${roomId}`]])), zoneMatches: roomIds.map((roomId) => ({ zoneId: `z-${roomId}`, matchedRoomRegionIds: [roomId], relationship: "one-to-one", confidence: "high" })) } } as any;
};
const handoff = (codes: Record<string, string>) => ({ zones: Object.entries(codes).map(([room, spaceFunctionCode]) => ({ id: `z-${room}`, name: room, spaceFunctionCode })) }) as any;
const relations = (kitchen = 100, suite = 100) => ({ pairScores: [
  { pairId: "S1-REL-001", scoringStatus: "scored", score: kitchen, scoreExplanation: "厨房餐厅", matchedRuleId: "S1-FR-001-R01" },
  { pairId: "S1-REL-002", scoringStatus: "scored", score: suite, scoreExplanation: "主卧主卫", matchedRuleId: "S1-FR-002-R01" },
] }) as any;

describe("S1 SO-03 entry sequence", () => {
  it("gives garage arrival support spaces a 100 sequence score", () => {
    const value = measureS1EntrySequence(handoff({ G: "SF30", M: "SF35", P: "SF34", L: "SF06" }), graph([["G", "M"], ["M", "P"], ["P", "L"]]));
    expect(value).toMatchObject({ status: "scored", score: 100, entranceKind: "garage_origin", roomRegionIds: ["G", "M", "P", "L"], semanticClasses: ["garage", "appropriate_transition", "appropriate_transition", "public_core"] });
  });

  it("uses a semantic-best deterministic route and classifies neutral/unrelated transitions", () => {
    const value = measureS1EntrySequence(handoff({ G: "SF30", M: "SF35", P: "SF34", L: "SF06", N: "SF17", B: "SF13" }), graph([["G", "B"], ["B", "L"], ["G", "N"], ["N", "L"], ["G", "M"], ["M", "P"], ["P", "L"]]));
    expect(value).toMatchObject({ score: 100, roomRegionIds: ["G", "M", "P", "L"] });
    expect(measureS1EntrySequence(handoff({ G: "SF30", N: "SF17", L: "SF06" }), graph([["G", "N"], ["N", "L"]])).score).toBe(85);
    expect(measureS1EntrySequence(handoff({ G: "SF30", B: "SF13", L: "SF06" }), graph([["G", "B"], ["B", "L"]])).score).toBe(60);
  });

  it("keeps missing entrance data unresolved and reliable disconnection at zero", () => {
    expect(measureS1EntrySequence(handoff({ G: "SF30", L: "SF06" }), graph([], { primary: ["a", "b"] })).status).toBe("unable_to_determine");
    expect(measureS1EntrySequence(handoff({ G: "SF30", L: "SF06" }), graph([]))).toMatchObject({ status: "scored", score: 0, matchedRuleId: "SO-03-R05" });
  });

  it("averages SO-01 through SO-03 equally and blocks an incomplete axis score", () => {
    const entry = measureS1EntrySequence(handoff({ G: "SF30", M: "SF35", L: "SF06" }), graph([["G", "M"], ["M", "L"]]));
    expect(scoreS1SpaceOrganization(relations(90, 100), entry)).toMatchObject({ status: "scored", score: 96.7 });
    expect(scoreS1SpaceOrganization(relations(), { ...entry, status: "unable_to_determine", score: null })).toMatchObject({ status: "unable_to_determine", score: null });
  });
});
