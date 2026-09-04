import { describe, expect, it } from "vitest";
import { evaluateG2002, evaluateG2007, evaluateG2008, type G2EvaluationContext } from "./g2-rules";
import { analyzeStairMeasurements } from "./stair-measurement";
import { G2_PARAMETERS, INCH_TO_METER, SQUARE_FOOT_TO_SQUARE_METER } from "./g2-regulations";
import { buildEeroCandidateAnalysis, type EeroCandidate } from "./eero-candidates";

const room = (id = "bed") => ({ roomRegionId: id, levelId: "level-1", polygons: [[[[-2, -2], [2, -2], [2, 2], [-2, 2]]]], holes: [], areaSquareMeters: 16, perimeterMeters: 16, compactness: .8, geometryArtifact: false, boundaryWallIds: [], sourceObjectIds: [id], pascalSourceIds: [id], confidence: "high", diagnostics: [], usableForEvaluation: true });
const context = (overrides: Partial<G2EvaluationContext> = {}): G2EvaluationContext => ({ codeApplicability: "applicable", projectUse: "detached_dwelling", eeroRequiredRoomIds: ["bed"], ...overrides });
const baseEnvironment = () => {
  const target = room(), rooms = { rooms: [target], roomToZoneIds: { bed: [] }, envelopes: [], zoneMatches: [], zoneOverlaps: [], unmatchedRoomRegionIds: [], diagnostics: [] };
  return {
    handoff: { doors: [], windows: [], zones: [], walls: [], furniture: [], equipment: [], columns: [], shelves: [], shafts: [], ceilings: [], levels: [{ id: "level-1" }], stairs: [] },
    context: context(),
    rooms,
    graph: { roomAnalysis: rooms, portals: [], stairConnections: [], nodes: [], edges: [], entrance: { candidateDoorIds: [], selectedDoorId: null, selectedRoomRegionId: null, confidence: "low", diagnostics: [] }, diagnostics: [] },
    stairs: [],
    eero: { rooms: [{ roomRegionId: "bed", levelId: "level-1", candidates: [] }], candidates: [] },
  } as any;
};

const candidate = (overrides: Partial<EeroCandidate> = {}): EeroCandidate => ({
  candidateId: "window-a",
  pascalSourceId: "window-a",
  roomRegionId: "bed",
  levelId: "level-1",
  openingType: "window",
  operationType: "casement",
  eligible: true,
  exclusionReason: null,
  nominalWidthMeters: 1,
  nominalHeightMeters: 1,
  clearWidthMeters: .8,
  clearHeightMeters: .8,
  clearAreaSquareMeters: .64,
  clearWidthLowerBoundMeters: .8,
  clearWidthUpperBoundMeters: .8,
  clearHeightLowerBoundMeters: .8,
  clearHeightUpperBoundMeters: .8,
  clearAreaLowerBoundSquareMeters: .64,
  clearAreaUpperBoundSquareMeters: .64,
  openingBottomAboveFinishedFloorMeters: .8,
  finishedFloorBasis: "explicit:test",
  gradeFloorStatus: "no",
  sizeStatus: "pass",
  measurementBasis: "explicit",
  confidence: "high",
  assumptions: [],
  missingData: [],
  ...overrides,
});
const eeroEnvironment = (candidates: EeroCandidate[], ctx: Partial<G2EvaluationContext> = {}) => {
  const environment = baseEnvironment();
  environment.context = context(ctx);
  environment.eero = { rooms: [{ roomRegionId: "bed", levelId: "level-1", candidates }], candidates };
  return environment;
};

describe("shared StairMeasurementAnalysis and G2-002", () => {
  const handoff = (stairs: any[]) => ({ stairs } as any);
  const ordinary = (overrides: Record<string, unknown> = {}) => ({ id: "stair", rawPascalId: "stair", stairType: "straight", fromLevelId: "level-1", toLevelId: "level-2", stepCount: 12, totalRiseMeters: 2.1, footprint: [], ...overrides });

  it("passes explicit ordinary step arrays, equality and explicitly uniform generated stairs", () => {
    const exact = ordinary({
      riserHeightsMeters: Array(12).fill(G2_PARAMETERS.stairMaximumRiserHeight.convertedValue),
      treadDepthsMeters: Array(12).fill(G2_PARAMETERS.stairMinimumTreadDepth.convertedValue),
    });
    const analysis = analyzeStairMeasurements(handoff([exact]));
    const environment = baseEnvironment(); environment.stairs = analysis;
    expect(evaluateG2002(environment).status).toBe("pass");
    const uniform = ordinary({ uniformStepGeneration: true, totalRunMeters: 12 * .3 });
    expect(analyzeStairMeasurements(handoff([uniform]))[0]).toMatchObject({ riserHeightVariationMeters: 0, treadDepthVariationMeters: 0, measurementBasis: "derived" });
  });

  it("issues for high risers, shallow treads and excessive variation", () => {
    for (const stair of [
      ordinary({ riserHeightsMeters: [.19, .2], treadDepthsMeters: [.3, .3] }),
      ordinary({ riserHeightsMeters: [.18, .18], treadDepthsMeters: [.24, .24] }),
      ordinary({ riserHeightsMeters: [.18, .191], treadDepthsMeters: [.3, .3] }),
      ordinary({ riserHeightsMeters: [.18, .18], treadDepthsMeters: [.3, .31] }),
    ]) {
      const environment = baseEnvironment(); environment.stairs = analyzeStairMeasurements(handoff([stair]));
      expect(evaluateG2002(environment).status).toBe("issue");
    }
  });

  it("uses an average to prove a violation but keeps unknown variations unable", () => {
    const highAverage = ordinary({ totalRiseMeters: 12 * .21 });
    const issueEnvironment = baseEnvironment(); issueEnvironment.stairs = analyzeStairMeasurements(handoff([highAverage]));
    expect(evaluateG2002(issueEnvironment).status).toBe("issue");
    const averageOnly = ordinary({ totalRiseMeters: 12 * .18 });
    const unableEnvironment = baseEnvironment(); unableEnvironment.stairs = analyzeStairMeasurements(handoff([averageOnly]));
    expect(evaluateG2002(unableEnvironment).status).toBe("unable_to_determine");
  });

  it("does not apply ordinary thresholds to special stairs and handles no stairs", () => {
    const spiral = ordinary({ stairType: "spiral" });
    const special = baseEnvironment(); special.stairs = analyzeStairMeasurements(handoff([spiral]));
    expect(evaluateG2002(special).status).toBe("not_applicable");
    expect(evaluateG2002(baseEnvironment()).status).toBe("not_applicable");
  });
});

describe("G2-007 shared-candidate EERO size evaluation", () => {
  it("passes only when one candidate independently satisfies width, height and area", () => {
    expect(evaluateG2007(eeroEnvironment([candidate()])).status).toBe("pass");
    const split = [
      candidate({ candidateId: "width-only", clearHeightLowerBoundMeters: .5, clearHeightUpperBoundMeters: .5, clearAreaLowerBoundSquareMeters: .4, clearAreaUpperBoundSquareMeters: .4, sizeStatus: "issue" }),
      candidate({ candidateId: "height-only", clearWidthLowerBoundMeters: .4, clearWidthUpperBoundMeters: .4, clearAreaLowerBoundSquareMeters: .4, clearAreaUpperBoundSquareMeters: .4, sizeStatus: "issue" }),
    ];
    expect(evaluateG2007(eeroEnvironment(split)).status).toBe("issue");
  });

  it("issues for each definite width, height or area failure and for no eligible opening", () => {
    for (const failed of [
      candidate({ clearWidthLowerBoundMeters: .4, clearWidthUpperBoundMeters: .4, sizeStatus: "issue" }),
      candidate({ clearHeightLowerBoundMeters: .5, clearHeightUpperBoundMeters: .5, sizeStatus: "issue" }),
      candidate({ clearAreaLowerBoundSquareMeters: .4, clearAreaUpperBoundSquareMeters: .4, sizeStatus: "issue" }),
    ]) expect(evaluateG2007(eeroEnvironment([failed])).status).toBe("issue");
    expect(evaluateG2007(eeroEnvironment([])).status).toBe("issue");
    expect(evaluateG2007(eeroEnvironment([candidate({ eligible: false, exclusionReason: "fixed", sizeStatus: "not_applicable" })])).status).toBe("issue");
  });

  it("uses upper and lower bounds and keeps only a genuinely crossing result unable", () => {
    const upperFails = candidate({ clearWidthMeters: null, clearWidthLowerBoundMeters: null, clearWidthUpperBoundMeters: .4, sizeStatus: "issue", measurementBasis: "derived" });
    expect(evaluateG2007(eeroEnvironment([upperFails])).status).toBe("issue");
    const lowerPasses = candidate({ clearWidthMeters: null, clearHeightMeters: null, clearAreaSquareMeters: null, measurementBasis: "derived" });
    expect(evaluateG2007(eeroEnvironment([lowerPasses])).status).toBe("pass");
    const crossing = candidate({ clearWidthMeters: null, clearWidthLowerBoundMeters: .45, clearWidthUpperBoundMeters: .8, sizeStatus: "unable_to_determine", measurementBasis: "derived" });
    expect(evaluateG2007(eeroEnvironment([crossing])).status).toBe("unable_to_determine");
  });

  it("applies grade-floor area only when confirmed and accepts unknown grade only when the strict area passes", () => {
    const between = 5.2 * SQUARE_FOOT_TO_SQUARE_METER;
    const grade = candidate({ gradeFloorStatus: "yes", clearAreaLowerBoundSquareMeters: between, clearAreaUpperBoundSquareMeters: between, sizeStatus: "pass" });
    expect(evaluateG2007(eeroEnvironment([grade])).status).toBe("pass");
    const unknown = candidate({ gradeFloorStatus: "unknown", clearAreaLowerBoundSquareMeters: between, clearAreaUpperBoundSquareMeters: between, sizeStatus: "unable_to_determine" });
    expect(evaluateG2007(eeroEnvironment([unknown])).status).toBe("unable_to_determine");
    const strict = candidate({ gradeFloorStatus: "unknown", clearAreaLowerBoundSquareMeters: 5.7 * SQUARE_FOOT_TO_SQUARE_METER, clearAreaUpperBoundSquareMeters: 5.7 * SQUARE_FOOT_TO_SQUARE_METER });
    expect(evaluateG2007(eeroEnvironment([strict])).status).toBe("pass");
  });
});

describe("shared EeroCandidateAnalysis", () => {
  const synthetic = (windowType: string, width: number, height: number) => {
    const target = room();
    const rooms = {
      rooms: [target],
      roomToZoneIds: { bed: [] },
      envelopes: [{ levelId: "level-1", usableForEvaluation: true, polygons: target.polygons }],
      zoneMatches: [], zoneOverlaps: [], unmatchedRoomRegionIds: [], diagnostics: [],
    };
    const handoff = {
      levels: [{ id: "level-1" }],
      walls: [{ id: "wall", thicknessMeters: .2 }],
      windows: [{ id: "window", rawPascalId: "window", visible: true, levelId: "level-1", hostWallId: "wall", resolvedWorldPosition: [0, 2], resolvedTangentRadians: 0, widthMeters: width, heightMeters: height, frameThicknessMeters: .05, rawWallLocalPosition: [2, 1.2, 0], windowType, casementStyle: "french" }],
      doors: [],
    };
    const graph = { portals: [] };
    return buildEeroCandidateAnalysis(handoff as any, rooms as any, graph as any, [target] as any);
  };

  it("derives a traceable conservative casement bound and opening bottom from wall-local center height", () => {
    const found = synthetic("casement", 1.2, 1.5).candidates[0]!;
    expect(found).toMatchObject({ candidateId: "window", measurementBasis: "derived", sizeStatus: "pass", clearWidthLowerBoundMeters: 1, clearHeightLowerBoundMeters: 1.4 });
    expect(found.openingBottomAboveFinishedFloorMeters).toBeCloseTo(.5);
    expect(found.finishedFloorBasis).toContain("wall-local");
    expect(found.assumptions.join(" ")).toContain("frameThickness");
  });

  it("excludes fixed windows and uses bounds instead of treating an awning nominal opening as clear opening", () => {
    expect(synthetic("fixed", 2, 2).candidates[0]).toMatchObject({ eligible: false, sizeStatus: "not_applicable" });
    expect(synthetic("awning", .4, .5).candidates[0]).toMatchObject({ eligible: true, clearWidthLowerBoundMeters: null, clearWidthUpperBoundMeters: .4, sizeStatus: "issue" });
    expect(synthetic("awning", 1.2, 1.5).candidates[0]).toMatchObject({ sizeStatus: "unable_to_determine" });
  });
});

describe("G2-008 uses the same size-qualified EERO candidate", () => {
  it("passes equality, issues above and derives no result from a size-ineligible low window", () => {
    const exact = candidate({ openingBottomAboveFinishedFloorMeters: 44 * INCH_TO_METER });
    expect(evaluateG2008(eeroEnvironment([exact])).status).toBe("pass");
    expect(evaluateG2008(eeroEnvironment([candidate({ openingBottomAboveFinishedFloorMeters: 44 * INCH_TO_METER + .001 })])).status).toBe("issue");
    const lowButSmall = candidate({ candidateId: "small-low", sizeStatus: "issue", openingBottomAboveFinishedFloorMeters: .1 });
    const qualifiedHigh = candidate({ candidateId: "qualified-high", openingBottomAboveFinishedFloorMeters: 1.2 });
    expect(evaluateG2008(eeroEnvironment([lowButSmall, qualifiedHigh])).status).toBe("issue");
  });

  it("keeps an unresolved G2-007 dependency as technical unable, but stays unable for a qualified candidate missing vertical evidence", () => {
    const failed = candidate({ sizeStatus: "issue" });
    const suppressed = evaluateG2008(eeroEnvironment([failed]));
    expect(suppressed.status).toBe("not_applicable");
    expect(suppressed.diagnostics).toContainEqual(expect.objectContaining({ code: "eero_sill_not_applicable_due_to_size_failure", severity: "info" }));
    const unresolvedSize = candidate({ sizeStatus: "unable_to_determine" });
    expect(evaluateG2008(eeroEnvironment([unresolvedSize]))).toMatchObject({ status: "unable_to_determine", measurements: expect.arrayContaining([expect.objectContaining({ name: "blockedRoomCount", value: 1 }), expect.objectContaining({ name: "dependencyRuleId", value: "G2-007" }), expect.objectContaining({ name: "eeroSillSubitemStatus", value: "blocked_by_G2_007" })]), diagnostics: [expect.objectContaining({ code: "eero_sill_not_applicable_due_to_size_qualification_unresolved", severity: "info" })] });
    expect(evaluateG2008(eeroEnvironment([candidate({ openingBottomAboveFinishedFloorMeters: null, finishedFloorBasis: null })])).status).toBe("unable_to_determine");
  });

  it("passes when one of several size-qualified candidates also meets the sill limit", () => {
    expect(evaluateG2008(eeroEnvironment([
      candidate({ candidateId: "high", openingBottomAboveFinishedFloorMeters: 1.2 }),
      candidate({ candidateId: "low", openingBottomAboveFinishedFloorMeters: .7 }),
    ])).status).toBe("pass");
  });
});
