import { describe, expect, it } from "vitest";
import { scoreS1ActivityZoning } from "./s1-activity-zoning";
import { S1_INDOOR_ACTIVITY_ZONE_CLASSIFICATION } from "./s1-activity-zoning-config";

const graph = (links: Array<[string, string]> = []) => {
  const ids = [...new Set(links.flat().concat(["A", "C", "Q", "N", "L", "S"]))];
  return { nodes: ids.map((nodeId) => ({ nodeId, nodeType: "room", levelId: "L1" })), edges: links.map(([fromNodeId, toNodeId], index) => ({ edgeId: `e${index}`, sourceObjectId: `d${index}`, connectionType: "door", fromNodeId, toNodeId, levelId: "L1", confidence: "high", diagnostics: [] })), roomAnalysis: { rooms: ids.map((roomRegionId) => ({ roomRegionId, levelId: "L1", usableForEvaluation: true, confidence: "high" })), zoneMatches: ids.map((id) => ({ zoneId: `z-${id}`, matchedRoomRegionIds: [id], relationship: "one-to-one", confidence: "high" })) } } as any;
};
const handoff = (codes: Record<string, string>) => ({ zones: Object.entries(codes).map(([id, spaceFunctionCode]) => ({ id: `z-${id}`, name: id, spaceFunctionCode })) }) as any;

describe("S1 DZ activity zoning", () => {
  it("classifies every current indoor SDI code exactly once", () => {
    expect(Object.keys(S1_INDOOR_ACTIVITY_ZONE_CLASSIFICATION)).toHaveLength(37);
    expect(S1_INDOOR_ACTIVITY_ZONE_CLASSIFICATION.SF16).toBe("quiet");
    expect(S1_INDOOR_ACTIVITY_ZONE_CLASSIFICATION.SF25).toBe("quiet");
    expect(S1_INDOOR_ACTIVITY_ZONE_CLASSIFICATION.SF31).toBe("quiet");
    expect(S1_INDOOR_ACTIVITY_ZONE_CLASSIFICATION.SF33).toBe("neutral");
  });

  it("keeps active circulation safe through neutral space", () => {
    const value = scoreS1ActivityZoning(handoff({ A: "SF22", N: "SF09", C: "SF06", Q: "SF11" }), graph([["A", "N"], ["N", "C"], ["Q", "N"]]));
    expect(value.dz01).toMatchObject({ status: "scored", score: 100, affectedCount: 0 });
    expect(value.dz01.measurements.find((item) => item.space?.roomRegionId === "A")?.result).toBe("safe");
  });

  it("detects a mandatory quiet intermediate and applies the DZ-01 ratio score", () => {
    const value = scoreS1ActivityZoning(handoff({ A: "SF22", Q: "SF11", C: "SF06", S: "SF27" }), graph([["A", "Q"], ["Q", "C"], ["S", "C"]]));
    expect(value.dz01).toMatchObject({ status: "scored", score: 50, affectedCount: 1, evaluableCount: 3 });
    expect(value.dz01.measurements.find((item) => item.space?.roomRegionId === "A")?.result).toBe("quiet_mandatory");
  });

  it("scores quiet buffering from real direct DoorPortal neighbors", () => {
    const value = scoreS1ActivityZoning(handoff({ Q: "SF16", N: "SF09", L: "SF06", S: "SF11" }), graph([["Q", "N"], ["Q", "L"], ["S", "S"]]));
    expect(value.dz02.measurements.find((item) => item.space?.roomRegionId === "Q")).toMatchObject({ score: 80, bufferType: "neutral_and_active" });
    expect(value.dz02.measurements.find((item) => item.space?.roomRegionId === "S")).toMatchObject({ score: 70, bufferType: "quiet_only" });
  });

  it("keeps missing topology unable instead of treating it as zero", () => {
    const value = scoreS1ActivityZoning(handoff({ A: "SF22", C: "SF06", Q: "SF11" }), graph([["A", "Q"]]));
    expect(value.dz01).toMatchObject({ status: "unable_to_determine", score: null });
    expect(value.status).toBe("unable_to_determine");
  });

  it("excludes a genuinely absent rule and uses the other axis rule", () => {
    const value = scoreS1ActivityZoning(handoff({ Q: "SF11", N: "SF09" }), graph([["Q", "N"]]));
    expect(value.dz01.status).toBe("not_applicable");
    expect(value.dz02).toMatchObject({ status: "scored", score: 100 });
    expect(value).toMatchObject({ status: "scored", score: 100 });
  });
});
