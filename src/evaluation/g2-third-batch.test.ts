import { describe, expect, it } from "vitest";
import { evaluateG2011, evaluateG2012, evaluateG2013, evaluateG2014, evaluateG2015, evaluateG2016, evaluateG2017, evaluateG2019, evaluateG2020 } from "./g2-rules";
import { G2_PARAMETERS as P } from "./g2-regulations";
import type { RoomHeadroomEvidence } from "./room-headroom";
import { analyzeOrdinaryStairClearWidths, analyzeSpiralStairs, type SpiralStairAnalysis, type StairClearWidthAnalysis } from "./stair-code-analysis";

const context = (overrides: Record<string, unknown> = {}) => ({ codeApplicability: "applicable", projectUse: "detached_dwelling", fixtureInventoryCompleteness: "complete", ...overrides });
const environment = (overrides: Record<string, unknown> = {}) => ({
  context: context(),
  handoff: { stairs: [], zones: [], furniture: [], equipment: [], columns: [] },
  rooms: { rooms: [], roomToZoneIds: {} },
  spiralStairs: [],
  stairClearWidths: [],
  headroom: { rooms: [] },
  requiredFixtures: { fixtures: [], counts: { water_closet: 0, lavatory: 0, bathing_fixture: 0, kitchen_sink: 0 }, unresolvedObjectIds: [], showerHeads: [], kitchenAreas: [], kitchenSinkAssociations: [], inventoryReliable: true, assumptions: [], missingData: [] },
  ...overrides,
}) as any;

const spiral = (overrides: Partial<SpiralStairAnalysis> = {}): SpiralStairAnalysis => ({
  stairId: "spiral",
  levelIds: ["L1", "L2"],
  nominalWidthMeters: .8,
  clearWidthMeters: .8,
  clearWidthLowerBoundMeters: .8,
  clearWidthUpperBoundMeters: .8,
  innerRadiusMeters: .3,
  outerRadiusMeters: 1.1,
  walklineRadiusMeters: .6,
  walklineRadiusLowerBoundMeters: .6,
  walklineRadiusUpperBoundMeters: .6,
  innerBoundarySemantic: "tread_inner_edge",
  legalWalklineOffsetMeters: .3048,
  treadDepthsAtWalklineMeters: [.2, .2],
  minimumTreadDepthAtWalklineMeters: .2,
  treadDepthLowerBoundMeters: .2,
  treadDepthUpperBoundMeters: .2,
  maximumRiserHeightMeters: .2,
  treadGeometryConsistent: true,
  headroomMeters: 2.1,
  measurementBasis: "explicit",
  confidence: "high",
  assumptions: [],
  missingData: [],
  ...overrides,
});

const flight = (overrides: Partial<StairClearWidthAnalysis> = {}): StairClearWidthAnalysis => ({
  stairId: "stair",
  flightId: "flight",
  levelIds: ["L1", "L2"],
  stairType: "straight",
  nominalWidthMeters: 1,
  wallClearWidthMeters: 1,
  handrailCount: 0,
  handrailClearWidthMeters: 1,
  belowHandrailLowerBoundMeters: 1,
  belowHandrailUpperBoundMeters: 1,
  measurementBasis: "explicit",
  confidence: "high",
  assumptions: [],
  missingData: [],
  locatableObjectIds: ["stair"],
  ...overrides,
});

const landing = (overrides: Record<string, unknown> = {}) => ({
  stairId: "stair", stairType: "straight", endpoint: "bottom", endpointLevelId: "L1", travelDirection: [1, 0], stairWidthMeters: 1,
  lastTreadEdgeCenter: [0, 0], roomRegionId: "room", platformCandidate: [[[[0, 0], [0, 1], [1, 1], [1, 0]]]], platformEffective: [[[[0, 0], [0, 1], [1, 1], [1, 0]]]],
  platformWidthMeters: 1, platformDepthMeters: .9144, platformSource: "room_region_derived", nearbyDoorIds: [], doorOperations: [], fixedObstacleIds: [], measurementBasis: "derived", confidence: "high", assumptions: [], missingData: [], lowerBound: { widthMeters: 1, depthMeters: .9144 }, upperBound: { widthMeters: 1, depthMeters: .9144 }, locatableObjectIds: ["stair", "room"], ...overrides,
});

describe("G2-013/014/015 stair landing checks", () => {
  it("passes two reliable landings, detects a missing bottom landing, and permits the narrow top exception only without a relevant door", () => {
    expect(evaluateG2013(environment({ stairLandings: [landing(), landing({ endpoint: "top" })] })).status).toBe("pass");
    expect(evaluateG2013(environment({ stairLandings: [landing({ platformEffective: [], platformWidthMeters: null, platformDepthMeters: null })] })).status).toBe("issue");
    expect(evaluateG2013(environment({ stairLandings: [landing({ endpoint: "top", platformEffective: [], platformWidthMeters: null, platformDepthMeters: null })] })).status).toBe("not_applicable");
  });
  it("uses the actual platform dimensions for straight stairs and retains special-shape evidence as unable", () => {
    expect(evaluateG2014(environment({ stairClearWidths: [flight()], stairLandings: [landing()] })).status).toBe("pass");
    expect(evaluateG2014(environment({ stairClearWidths: [flight()], stairLandings: [landing({ platformDepthMeters: .8, lowerBound: { widthMeters: 1, depthMeters: .8 }, upperBound: { widthMeters: 1, depthMeters: .8 } })] })).status).toBe("issue");
    const nonrect = landing({ stairType: "spiral", walkingLineRadiusMeters: .6048, walkingLineDepthMeters: .8, effectiveAreaSquareMeters: Math.PI * .6604 ** 2 / 4, quarterCircleWitnessFits: true, effectiveLandingPolygon: [[[[0, 0], [0, 1], [1, 1], [1, 0]]]] });
    expect(evaluateG2014(environment({ spiralStairs: [spiral({ stairId: "stair" })], stairLandings: [nonrect] })).status).toBe("pass");
    expect(evaluateG2014(environment({ spiralStairs: [spiral({ stairId: "stair" })], stairLandings: [landing({ ...nonrect, walkingLineDepthMeters: .5 })] })).status).toBe("issue");
    expect(evaluateG2014(environment({ spiralStairs: [spiral({ stairId: "stair" })], stairLandings: [landing({ ...nonrect, effectiveAreaSquareMeters: .2 })] })).status).toBe("issue");
    expect(evaluateG2014(environment({ spiralStairs: [spiral({ stairId: "stair" })], stairLandings: [landing({ ...nonrect, quarterCircleWitnessFits: false })] })).status).toBe("issue");
    expect(evaluateG2014(environment({ spiralStairs: [spiral({ stairId: "stair" })], stairLandings: [landing({ ...nonrect, walkingLineDepthMeters: null })] })).status).toBe("unable_to_determine");
  });
  it("does not treat an unrelated door as a landing door and flags a sweep intersection for manual code review", () => {
    expect(evaluateG2015(environment({ stairLandings: [landing()] })).status).toBe("not_applicable");
    const door = { doorId: "door", usableForEvaluation: true, confidence: "high", openingAngleRadians: Math.PI / 2, leaves: [{ swingPolygon: [[0, 0], [0, 1], [1, 1]] }] };
    expect(evaluateG2015(environment({ stairLandings: [landing({ nearbyDoorIds: ["door"], doorOperations: [door] })] })).status).toBe("unable_to_determine");
  });
});

const rectangle = (x0: number, width: number) => [[[x0, 0], [x0 + width, 0], [x0 + width, 10], [x0, 10]]] as any;
const headroom = (use: RoomHeadroomEvidence["use"], regions: Array<{ x: number; width: number; height: number }>, overrides: Partial<RoomHeadroomEvidence> = {}): RoomHeadroomEvidence => {
  const roomPolygons = [rectangle(0, 10)];
  const heightRegions = regions.map((region, index) => ({
    ceilingId: `ceiling-${index}`,
    heightMeters: region.height,
    areaWithinRoomSquareMeters: region.width * 10,
    polygons: [rectangle(region.x, region.width)],
    measurementBasis: "explicit" as const,
  }));
  const covered = regions.reduce((sum, region) => sum + region.width * 10, 0);
  return {
    roomId: `${use}-room`,
    levelId: "L1",
    use,
    roomAreaSquareMeters: 100,
    roomPolygons,
    finishedFloorBasis: "Level finished floor",
    heightRegions,
    coveredAreaSquareMeters: covered,
    uncoveredAreaSquareMeters: 100 - covered,
    coverageRatio: covered / 100,
    minimumMappedHeightMeters: regions.length ? Math.min(...regions.map((region) => region.height)) : null,
    maximumMappedHeightMeters: regions.length ? Math.max(...regions.map((region) => region.height)) : null,
    multipleHeightRegions: new Set(regions.map((region) => region.height)).size > 1,
    slopedCeiling: false,
    overlappingHeightEvidence: false,
    measurementBasis: "derived",
    confidence: covered >= 98 ? "high" : "low",
    assumptions: [],
    missingData: covered >= 98 ? [] : ["coverage"],
    ...overrides,
  };
};

describe("G2-011 spiral stair", () => {
  it("is not applicable without a spiral and passes complete evidence at equality", () => {
    expect(evaluateG2011(environment()).status).toBe("not_applicable");
    const exact = spiral({
      clearWidthMeters: P.spiralMinimumClearWidth.convertedValue,
      clearWidthLowerBoundMeters: P.spiralMinimumClearWidth.convertedValue,
      clearWidthUpperBoundMeters: P.spiralMinimumClearWidth.convertedValue,
      walklineRadiusMeters: P.spiralMaximumWalklineRadius.convertedValue,
      walklineRadiusLowerBoundMeters: P.spiralMaximumWalklineRadius.convertedValue,
      walklineRadiusUpperBoundMeters: P.spiralMaximumWalklineRadius.convertedValue,
      minimumTreadDepthAtWalklineMeters: P.spiralMinimumWalklineTreadDepth.convertedValue,
      treadDepthLowerBoundMeters: P.spiralMinimumWalklineTreadDepth.convertedValue,
      treadDepthUpperBoundMeters: P.spiralMinimumWalklineTreadDepth.convertedValue,
      maximumRiserHeightMeters: P.spiralMaximumRiserHeight.convertedValue,
      headroomMeters: P.spiralMinimumHeadroom.convertedValue,
    });
    const result = evaluateG2011(environment({ spiralStairs: [exact] }));
    expect(result.status).toBe("pass");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code.endsWith("_borderline"))).toBe(true);
  });

  it("issues for each reliable width, walkline radius, tread, riser or headroom violation", () => {
    for (const bad of [
      spiral({ clearWidthMeters: .5, clearWidthLowerBoundMeters: .5, clearWidthUpperBoundMeters: .5 }),
      spiral({ walklineRadiusMeters: .7, walklineRadiusLowerBoundMeters: .7, walklineRadiusUpperBoundMeters: .7 }),
      spiral({ minimumTreadDepthAtWalklineMeters: .15, treadDepthLowerBoundMeters: .15, treadDepthUpperBoundMeters: .15 }),
      spiral({ maximumRiserHeightMeters: .25 }),
      spiral({ headroomMeters: 1.9 }),
      spiral({ treadGeometryConsistent: false }),
    ]) expect(evaluateG2011(environment({ spiralStairs: [bad] })).status).toBe("issue");
  });

  it("uses an average riser to prove violation but stays unable when other mandatory bounds cross", () => {
    expect(evaluateG2011(environment({ spiralStairs: [spiral({ maximumRiserHeightMeters: .25, measurementBasis: "derived" })] })).status).toBe("issue");
    const partial = spiral({
      clearWidthMeters: null, clearWidthLowerBoundMeters: null, clearWidthUpperBoundMeters: .8,
      walklineRadiusMeters: null, walklineRadiusLowerBoundMeters: .3, walklineRadiusUpperBoundMeters: 1.1,
      minimumTreadDepthAtWalklineMeters: null, treadDepthLowerBoundMeters: .1, treadDepthUpperBoundMeters: .3,
      headroomMeters: null,
    });
    expect(evaluateG2011(environment({ spiralStairs: [partial] })).status).toBe("unable_to_determine");
  });

  it("only analyzes explicit spiral stairs and gives explicit walkline treads priority", () => {
    const stair = (id: string, stairType: string) => ({
      id, stairType, widthMeters: .8, innerRadiusMeters: .3, sweepAngleRadians: Math.PI * 2,
      totalRiseMeters: 2.4, stepCount: 12, fromLevelId: "L1", toLevelId: "L2",
    });
    const handoff = { stairs: [stair("ordinary", "straight"), stair("winder", "winder"), stair("spiral-source", "spiral")] } as any;
    const measurements = [{ stairId: "spiral-source", treadCount: 12, maximumRiserHeightMeters: .2 }] as any;
    const [analysis] = analyzeSpiralStairs(handoff, measurements, {
      spiralOverrides: { "spiral-source": { source: "survey", walklineRadiusMeters: .5, treadDepthsAtWalklineMeters: [.18, .19] } },
    });
    expect(analysis.stairId).toBe("spiral-source");
    expect(analysis.treadDepthsAtWalklineMeters).toEqual([.18, .19]);
    expect(analysis.minimumTreadDepthAtWalklineMeters).toBe(.18);
  });

  it("derives the legal walkline from a confirmed tread inner edge, but not from a pole centre or unknown radius", () => {
    const handoff = { stairs: [{ id: "spiral-source", stairType: "spiral", widthMeters: 1, innerRadiusMeters: .3, sweepAngleRadians: Math.PI * 2, fromLevelId: "L1", toLevelId: "L2" }] } as any;
    const measurements = [{ stairId: "spiral-source", treadCount: 12, maximumRiserHeightMeters: .2 }] as any;
    const [pass] = analyzeSpiralStairs(handoff, measurements);
    expect(pass.walklineRadiusMeters).toBeCloseTo(.6048);
    expect(pass.minimumTreadDepthAtWalklineMeters).toBeGreaterThan(P.spiralMinimumWalklineTreadDepth.convertedValue);
    const [radiusIssue] = analyzeSpiralStairs({ stairs: [{ ...handoff.stairs[0], innerRadiusMeters: .4 }] } as any, measurements);
    expect(evaluateG2011(environment({ spiralStairs: [radiusIssue] })).status).toBe("issue");
    const [depthIssue] = analyzeSpiralStairs({ stairs: [{ ...handoff.stairs[0], sweepAngleRadians: .9 }] } as any, measurements);
    expect(evaluateG2011(environment({ spiralStairs: [depthIssue] })).status).toBe("issue");
    for (const semantic of ["central_pole_center", "unknown"] as const) {
      const [unresolved] = analyzeSpiralStairs(handoff, measurements, { spiralOverrides: { "spiral-source": { source: "test", innerBoundarySemantic: semantic } } });
      expect(unresolved.walklineRadiusMeters).toBeNull();
      expect(unresolved.missingData).toContain("spiral-source.legalWalklineRadius");
    }
  });
});

describe("G2-012 ordinary stair clear width", () => {
  it("applies 36, 31.5 and 27 inch conditions at equality", () => {
    const cases = [
      flight({ wallClearWidthMeters: P.stairWidthAboveHandrail.convertedValue, handrailCount: 0, handrailClearWidthMeters: P.stairWidthAboveHandrail.convertedValue, belowHandrailLowerBoundMeters: P.stairWidthAboveHandrail.convertedValue, belowHandrailUpperBoundMeters: P.stairWidthAboveHandrail.convertedValue }),
      flight({ handrailCount: 1, handrailClearWidthMeters: P.stairWidthOneHandrail.convertedValue, belowHandrailLowerBoundMeters: P.stairWidthOneHandrail.convertedValue, belowHandrailUpperBoundMeters: P.stairWidthOneHandrail.convertedValue }),
      flight({ handrailCount: 2, handrailClearWidthMeters: P.stairWidthTwoHandrails.convertedValue, belowHandrailLowerBoundMeters: P.stairWidthTwoHandrails.convertedValue, belowHandrailUpperBoundMeters: P.stairWidthTwoHandrails.convertedValue }),
    ];
    cases.forEach((item) => expect(evaluateG2012(environment({ stairClearWidths: [item] })).status).toBe("pass"));
  });

  it("issues below wall or handrail width and preserves per-flight aggregation", () => {
    expect(evaluateG2012(environment({ stairClearWidths: [flight({ wallClearWidthMeters: .68, handrailClearWidthMeters: .68, belowHandrailLowerBoundMeters: .68, belowHandrailUpperBoundMeters: .68 })] })).status).toBe("issue");
    expect(evaluateG2012(environment({ stairClearWidths: [flight(), flight({ flightId: "bad", handrailCount: 2, handrailClearWidthMeters: .68, belowHandrailLowerBoundMeters: .68, belowHandrailUpperBoundMeters: .68 })] })).status).toBe("issue");
  });

  it("does not infer absent handrails and excludes spiral-only projects", () => {
    expect(evaluateG2012(environment({ stairClearWidths: [flight({ handrailCount: null, handrailClearWidthMeters: null, belowHandrailLowerBoundMeters: null, belowHandrailUpperBoundMeters: 1 })] })).status).toBe("unable_to_determine");
    expect(evaluateG2012(environment({ spiralStairs: [spiral()] })).status).toBe("not_applicable");
  });

  it("uses the stair structural width and never an axis-aligned footprint width", () => {
    const handoff = {
      stairs: [{
        id: "ordinary",
        stairType: "straight",
        widthMeters: .8,
        fromLevelId: "L1",
        toLevelId: "L2",
        footprint: { minX: 0, maxX: 8, minY: 0, maxY: 8 },
      }],
    } as any;
    const [analysis] = analyzeOrdinaryStairClearWidths(handoff);
    expect(analysis.wallClearWidthMeters).toBe(.8);
    expect(analysis.handrailCount).toBeNull();
    expect(analysis.assumptions.join(" ")).toContain("不使用轴对齐bounding box");
  });
});

describe("G2-016 shared Room headroom", () => {
  it("passes a flat room at 7 ft and issues below it", () => {
    expect(evaluateG2016(environment({ headroom: { rooms: [headroom("habitable", [{ x: 0, width: 10, height: P.habitableMinimumHeadroom.convertedValue }])] } })).status).toBe("pass");
    expect(evaluateG2016(environment({ headroom: { rooms: [headroom("habitable", [{ x: 0, width: 10, height: 2 }])] } })).status).toBe("issue");
  });

  it("uses real height polygons and sloped 50 percent bounds", () => {
    const pass = headroom("habitable", [{ x: 0, width: 5, height: 2.2 }, { x: 5, width: 5, height: 1.6 }], { slopedCeiling: true });
    const issue = headroom("habitable", [{ x: 0, width: 4, height: 2.2 }, { x: 4, width: 6, height: 1.6 }], { slopedCeiling: true });
    expect(evaluateG2016(environment({ headroom: { rooms: [pass] } })).status).toBe("pass");
    expect(evaluateG2016(environment({ headroom: { rooms: [issue] } })).status).toBe("issue");
  });

  it("resolves partial-coverage lower/upper bounds and keeps a crossing case unable", () => {
    const pass = headroom("habitable", [{ x: 0, width: 6, height: 2.2 }, { x: 6, width: 2, height: 1.6 }], { slopedCeiling: true });
    const issue = headroom("habitable", [{ x: 0, width: 2, height: 2.2 }, { x: 2, width: 6, height: 1.6 }], { slopedCeiling: true });
    const unable = headroom("habitable", [{ x: 0, width: 4, height: 2.2 }, { x: 4, width: 4, height: 1.6 }], { slopedCeiling: true });
    expect(evaluateG2016(environment({ headroom: { rooms: [pass] } })).status).toBe("pass");
    expect(evaluateG2016(environment({ headroom: { rooms: [issue] } })).status).toBe("issue");
    expect(evaluateG2016(environment({ headroom: { rooms: [unable] } })).status).toBe("unable_to_determine");
    expect(evaluateG2016(environment()).status).toBe("not_applicable");
  });
});

describe("G2-017 nonhabitable and local headroom", () => {
  it("keeps separate kitchen/hallway and bath/toilet/laundry conditions", () => {
    const rooms = [
      headroom("kitchen", [{ x: 0, width: 10, height: P.kitchenHallwayMinimumHeadroom.convertedValue }]),
      headroom("hallway", [{ x: 0, width: 10, height: P.kitchenHallwayMinimumHeadroom.convertedValue }], { roomId: "hall" }),
      headroom("bathroom", [{ x: 0, width: 10, height: P.bathToiletLaundryMinimumHeadroom.convertedValue }]),
      headroom("toilet_room", [{ x: 0, width: 10, height: P.bathToiletLaundryMinimumHeadroom.convertedValue }]),
      headroom("laundry", [{ x: 0, width: 10, height: P.bathToiletLaundryMinimumHeadroom.convertedValue }]),
    ];
    expect(evaluateG2017(environment({ headroom: { rooms } })).status).toBe("pass");
    expect(evaluateG2017(environment({ headroom: { rooms: [headroom("kitchen", [{ x: 0, width: 10, height: 2 }])] } })).status).toBe("issue");
  });

  it("uses a complete uniform Ceiling as the local 30-inch-region lower bound, but preserves multi-height uncertainty", () => {
    const room = headroom("bathroom", [{ x: 0, width: 10, height: 2.5 }]);
    const requiredFixtures = { ...environment().requiredFixtures, showerHeads: [{ objectId: "head", levelId: "L1", roomRegionId: room.roomId, centerPoint: [1, 1], centerInsideRoom: true, confidence: "high" }] };
    expect(evaluateG2017(environment({ headroom: { rooms: [room] }, requiredFixtures })).status).toBe("pass");
    expect(evaluateG2017(environment({ headroom: { rooms: [room] }, requiredFixtures, context: context({ showerLocalHeadroomOverrides: { head: { heightMeters: 2.1, regionSideMeters: .8, reliable: true, source: "test" } } }) })).status).toBe("pass");
    expect(evaluateG2017(environment({ headroom: { rooms: [room] }, requiredFixtures, context: context({ showerLocalHeadroomOverrides: { head: { heightMeters: 1.9, regionSideMeters: .8, reliable: true, source: "test" } } }) })).status).toBe("issue");
    const multi = headroom("bathroom", [{ x: 0, width: 5, height: 2.5 }, { x: 5, width: 5, height: 2.5 }], { multipleHeightRegions: true });
    expect(evaluateG2017(environment({ headroom: { rooms: [multi] }, requiredFixtures: { ...requiredFixtures, showerHeads: [{ ...requiredFixtures.showerHeads[0], roomRegionId: multi.roomId }] } })).status).toBe("unable_to_determine");
    const low = headroom("bathroom", [{ x: 0, width: 10, height: 1.9 }]);
    expect(evaluateG2017(environment({ headroom: { rooms: [low] }, requiredFixtures: { ...requiredFixtures, showerHeads: [{ ...requiredFixtures.showerHeads[0], roomRegionId: low.roomId }] } })).status).toBe("issue");
    expect(evaluateG2017(environment()).status).toBe("not_applicable");
  });
});

describe("G2-019 dwelling required fixtures", () => {
  const fixtures = (counts: Record<string, number>, unresolvedObjectIds: string[] = [], inventoryReliable = true) => ({
    fixtures: Object.entries(counts).flatMap(([kind, count]) => Array.from({ length: count }, (_, index) => ({ objectId: `${kind}-${index}`, pascalSourceId: `${kind}-${index}`, levelId: "L1", roomRegionId: kind === "kitchen_sink" ? "kitchen" : "bath", roomNames: [], kind, measurementBasis: "explicit", confidence: "high", assumptions: [] }))),
    counts,
    unresolvedObjectIds,
    showerHeads: [],
    kitchenAreas: [{ areaId: "room:kitchen", kind: "room", name: "Kitchen", levelId: "L1", roomRegionId: "kitchen", zoneId: null, polygons: [] }],
    kitchenSinkAssociations: Array.from({ length: counts.kitchen_sink ?? 0 }, (_, index) => ({ objectId: `kitchen_sink-${index}`, centerPoint: [0, 0], roomRegionId: "kitchen", kitchenZoneIds: [], associatedKitchenAreaIds: ["room:kitchen"], associationBasis: "room_center", conflictReason: null })),
    inventoryReliable,
    assumptions: ["test"],
    missingData: [],
  });
  const complete = { water_closet: 1, lavatory: 1, bathing_fixture: 1, kitchen_sink: 1 };

  it("passes four distinct groups and keeps P05 for the kitchen sink", () => {
    const result = evaluateG2019(environment({ requiredFixtures: fixtures(complete) }));
    expect(result.status).toBe("pass");
    expect(result.thresholds.map((threshold) => threshold.name)).toContain(P.dwellingMinimumKitchenSinkCount.name);
    expect(P.dwellingMinimumKitchenSinkCount.id).toBe("G2-019-P05");
  });

  it("issues each reliable zero count, accepts bathtub or shower as one group, and ignores cooking appliances", () => {
    for (const kind of Object.keys(complete)) {
      const counts = { ...complete, [kind]: 0 };
      expect(evaluateG2019(environment({ requiredFixtures: fixtures(counts) })).status).toBe("issue");
    }
    expect(evaluateG2019(environment({ requiredFixtures: fixtures({ ...complete, bathing_fixture: 1 }) })).status).toBe("pass");
  });

  it("does not exchange lavatory and kitchen sink and stays unable for unreliable inventory or sink semantics", () => {
    expect(evaluateG2019(environment({ requiredFixtures: fixtures({ ...complete, kitchen_sink: 0 }) })).status).toBe("issue");
    expect(evaluateG2019(environment({ requiredFixtures: fixtures({ ...complete, lavatory: 0 }) })).status).toBe("issue");
    expect(evaluateG2019(environment({ requiredFixtures: fixtures({ ...complete, kitchen_sink: 0 }, ["ambiguous-sink"]) })).status).toBe("unable_to_determine");
    expect(evaluateG2019(environment({ requiredFixtures: fixtures({ ...complete, water_closet: 0 }, [], false) })).status).toBe("unable_to_determine");
    expect(evaluateG2019(environment({ context: context({ projectUse: "sleeping_unit" }), requiredFixtures: fixtures(complete) })).status).toBe("not_applicable");
  });

  it("checks every Kitchen Area instead of using a whole-dwelling kitchen-sink total", () => {
    const one = fixtures(complete);
    const twoAreas = { ...one, kitchenAreas: [...one.kitchenAreas, { areaId: "zone:second", kind: "zone", name: "Chinese Kitchen", levelId: "L1", roomRegionId: "second", zoneId: "second", polygons: [] }] };
    expect(evaluateG2019(environment({ requiredFixtures: twoAreas })).status).toBe("issue");
    const mudSink = { ...one, kitchenSinkAssociations: [{ ...one.kitchenSinkAssociations[0], roomRegionId: "mud", associatedKitchenAreaIds: [], associationBasis: "unassociated", conflictReason: "位于MUD" }] };
    expect(evaluateG2019(environment({ requiredFixtures: mudSink })).status).toBe("issue");
    const hallButZone = { ...one, kitchenAreas: [{ areaId: "zone:kitchen", kind: "zone", name: "Open Kitchen", levelId: "L1", roomRegionId: "hall", zoneId: "kitchen", polygons: [] }], kitchenSinkAssociations: [{ ...one.kitchenSinkAssociations[0], roomRegionId: "hall", associatedKitchenAreaIds: ["zone:kitchen"], associationBasis: "zone_center" }] };
    expect(evaluateG2019(environment({ requiredFixtures: hallButZone })).status).toBe("pass");
    const unresolved = { ...one, kitchenSinkAssociations: [{ ...one.kitchenSinkAssociations[0], associatedKitchenAreaIds: [], associationBasis: "unresolved", conflictReason: "缺位置" }] };
    expect(evaluateG2019(environment({ requiredFixtures: unresolved })).status).toBe("unable_to_determine");
  });
});

describe("G2-020 shower compartment dimensions", () => {
  const rectangle = (width: number, depth: number) => [[[[0, 0], [width, 0], [width, depth], [0, depth]]]] as any;
  const compartment = (overrides: Record<string, unknown> = {}) => ({
    showerId: "shower", levelId: "L1", roomRegionId: "bathroom", objectType: "shower_compartment", receptorObjectId: "shower", enclosureObjectIds: [], outerFootprint: null,
    finishedInteriorPolygon: rectangle(.9, .9), finishedInteriorAreaSquareMeters: .81, maximumInscribedCircleDiameterMeters: .9, inscribedCircleCenter: [.45, .45], inscribedCirclePolygon: null,
    exception2: { requested: false, widthMeters: null, lengthMeters: null, source: null }, headroom: { status: "pass", minimumHeightMeters: 2, source: "uniform ceiling", missingData: [] }, measurementBasis: "explicit", confidence: "high", assumptions: [], missingData: [], locatableObjectIds: ["shower", "bathroom"], ...overrides,
  });
  const showerEnvironment = (items: any[]) => environment({ showerCompartments: { compartments: items, showerheadObjectIds: [], bathtubObjectIds: [], assumptions: ["test"] } });

  it("passes explicit finished interior geometry at or above 900 in² and a 30 in witness circle", () => {
    const exact = compartment({ finishedInteriorPolygon: rectangle(P.showerCompartmentMinimumInscribedCircle.convertedValue, P.showerCompartmentMinimumInscribedCircle.convertedValue), finishedInteriorAreaSquareMeters: P.showerCompartmentMinimumInteriorArea.convertedValue, maximumInscribedCircleDiameterMeters: P.showerCompartmentMinimumInscribedCircle.convertedValue });
    expect(evaluateG2020(showerEnvironment([exact])).status).toBe("pass");
  });
  it("issues independently for insufficient area, an insufficient actual-polygon circle, or low maintained height", () => {
    expect(evaluateG2020(showerEnvironment([compartment({ finishedInteriorPolygon: rectangle(.7, .7), finishedInteriorAreaSquareMeters: .49, maximumInscribedCircleDiameterMeters: .7 })])).status).toBe("issue");
    expect(evaluateG2020(showerEnvironment([compartment({ finishedInteriorPolygon: rectangle(.7, 1), finishedInteriorAreaSquareMeters: .7, maximumInscribedCircleDiameterMeters: .7 })])).status).toBe("issue");
    expect(evaluateG2020(showerEnvironment([compartment({ headroom: { status: "issue", minimumHeightMeters: 1.7, source: "low soffit", missingData: [] } })])).status).toBe("issue");
  });
  it("uses a rotated true polygon, not an axis-aligned bounding box", () => {
    const rotated = [[[[.7, .063604], [1.336396, .7], [.7, 1.336396], [.063604, .7]]]] as any;
    expect(evaluateG2020(showerEnvironment([compartment({ finishedInteriorPolygon: rotated, finishedInteriorAreaSquareMeters: .81, maximumInscribedCircleDiameterMeters: .9 })])).status).toBe("pass");
  });
  it("keeps incomplete interior bounds or multi-height ceiling as unable only when they can change the result", () => {
    expect(evaluateG2020(showerEnvironment([compartment({ finishedInteriorPolygon: null, finishedInteriorAreaSquareMeters: null, maximumInscribedCircleDiameterMeters: 1, outerFootprint: [[0, 0], [1, 0], [1, 1], [0, 1]] })])).status).toBe("unable_to_determine");
    expect(evaluateG2020(showerEnvironment([compartment({ headroom: { status: "unable_to_determine", minimumHeightMeters: 2, source: "multiple ceilings", missingData: ["coverage"] } })])).status).toBe("unable_to_determine");
  });
  it("proves an issue from a theoretical outer-footprint maximum without treating it as interior", () => {
    expect(evaluateG2020(showerEnvironment([compartment({ finishedInteriorPolygon: null, finishedInteriorAreaSquareMeters: null, maximumInscribedCircleDiameterMeters: .6, outerFootprint: [[0, 0], [.6, 0], [.6, .6], [0, .6]] })])).status).toBe("issue");
  });
  it("accepts only the explicit paired 30 by 60 inch receptor exception and still checks 70 in height", () => {
    const exception = compartment({ finishedInteriorPolygon: null, finishedInteriorAreaSquareMeters: null, maximumInscribedCircleDiameterMeters: null, exception2: { requested: true, widthMeters: P.showerReceptorExceptionMinimumWidth.convertedValue, lengthMeters: P.showerReceptorExceptionMinimumLength.convertedValue, source: "explicit receptor" } });
    expect(evaluateG2020(showerEnvironment([exception])).status).toBe("pass");
    expect(evaluateG2020(showerEnvironment([{ ...exception, exception2: { ...exception.exception2, lengthMeters: 1 } }])).status).toBe("unable_to_determine");
    expect(evaluateG2020(showerEnvironment([{ ...exception, headroom: { status: "issue", minimumHeightMeters: 1.7, source: "low", missingData: [] } }])).status).toBe("issue");
  });
  it("does not make a compartment from a showerhead or bathtub and aggregates any failing compartment", () => {
    const none = showerEnvironment([]); none.showerCompartments.showerheadObjectIds = ["head"]; none.showerCompartments.bathtubObjectIds = ["tub"];
    expect(evaluateG2020(none).status).toBe("not_applicable");
    expect(evaluateG2020(showerEnvironment([compartment(), compartment({ showerId: "bad", finishedInteriorPolygon: rectangle(.6, .6), finishedInteriorAreaSquareMeters: .36, maximumInscribedCircleDiameterMeters: .6 })])).status).toBe("issue");
  });
});
