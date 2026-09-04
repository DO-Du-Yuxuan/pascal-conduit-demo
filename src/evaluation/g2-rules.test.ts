import { describe, expect, it } from "vitest";
import type { Ring } from "./envelope";
import { canFitEffectiveSquare } from "./g2-geometry";
import { FOOT_TO_METER, G2_DOOR_OPENING_ASSUMPTIONS, G2_PARAMETERS, INCH_TO_METER, SQUARE_FOOT_TO_SQUARE_METER } from "./g2-regulations";
import { evaluateG2001, evaluateG2003, evaluateG2004, evaluateG2005, evaluateG2006, evaluateG2009, evaluateG2010, type G2EvaluationContext } from "./g2-rules";

const rectangle = (width: number, depth: number, x = 0, z = 0): Ring => [[x - width / 2, z - depth / 2], [x + width / 2, z - depth / 2], [x + width / 2, z + depth / 2], [x - width / 2, z + depth / 2]];
const room = (id: string, polygon = rectangle(4, 4), area = 16) => ({ roomRegionId: id, levelId: "level-1", polygons: [[polygon]], holes: [], areaSquareMeters: area, perimeterMeters: 16, compactness: .8, geometryArtifact: false, boundaryWallIds: [`wall-${id}`], sourceObjectIds: [id], pascalSourceIds: [id], confidence: "high", diagnostics: [], usableForEvaluation: true });
const context = (overrides: Partial<G2EvaluationContext> = {}): G2EvaluationContext => ({ codeApplicability: "applicable", projectUse: "detached_dwelling", ...overrides });
const environment = (rooms: any[], overrides: any = {}) => {
  const analysis = { rooms, roomToZoneIds: Object.fromEntries(rooms.map((item) => [item.roomRegionId, []])), envelopes: [], zoneMatches: [], zoneOverlaps: [], unmatchedRoomRegionIds: [], diagnostics: [] };
  const handoff = { doors: [], zones: [], walls: [], furniture: [], equipment: [], columns: [], shelves: [], shafts: [], levels: [{ id: "level-1" }], stairs: [] };
  const graph = { roomAnalysis: analysis, portals: [], stairConnections: [], nodes: [], edges: [], entrance: { candidateDoorIds: [], selectedDoorId: null, selectedRoomRegionId: null, confidence: "low", diagnostics: [] }, diagnostics: [] };
  return { handoff, context: context(), rooms: analysis, graph, ...overrides } as any;
};

describe("G2 exact regulatory parameters", () => {
  it("uses exact imperial conversions instead of rounded metric display values", () => {
    expect(G2_PARAMETERS.egressDoorWidth.convertedValue).toBe(32 * INCH_TO_METER);
    expect(G2_PARAMETERS.hallwayWidth.convertedValue).toBe(3 * FOOT_TO_METER);
    expect(G2_PARAMETERS.habitableRoomArea.convertedValue).toBe(70 * SQUARE_FOOT_TO_SQUARE_METER);
    expect(G2_PARAMETERS.habitableRoomDimension.convertedValue).toBe(7 * FOOT_TO_METER);
    expect(G2_PARAMETERS.toiletFrontResidential.convertedValue).toBe(21 * INCH_TO_METER);
    expect(G2_PARAMETERS.toiletFrontGeneral.convertedValue).toBe(24 * INCH_TO_METER);
    expect(G2_PARAMETERS.stairMaximumRiserHeight.convertedValue).toBe(7.75 * INCH_TO_METER);
    expect(G2_PARAMETERS.stairMinimumTreadDepth.convertedValue).toBe(10 * INCH_TO_METER);
    expect(G2_PARAMETERS.stairMaximumRiserVariation.convertedValue).toBe(.375 * INCH_TO_METER);
    expect(G2_PARAMETERS.eeroMinimumClearArea.convertedValue).toBe(5.7 * SQUARE_FOOT_TO_SQUARE_METER);
    expect(G2_PARAMETERS.eeroGradeFloorMinimumClearArea.convertedValue).toBe(5 * SQUARE_FOOT_TO_SQUARE_METER);
    expect(G2_PARAMETERS.eeroMinimumClearHeight.convertedValue).toBe(24 * INCH_TO_METER);
    expect(G2_PARAMETERS.eeroMinimumClearWidth.convertedValue).toBe(20 * INCH_TO_METER);
    expect(G2_PARAMETERS.eeroMaximumSillHeight.convertedValue).toBe(44 * INCH_TO_METER);
    expect(G2_PARAMETERS.spiralMinimumClearWidth.convertedValue).toBe(26 * INCH_TO_METER);
    expect(G2_PARAMETERS.spiralMaximumWalklineRadius.convertedValue).toBe(24.5 * INCH_TO_METER);
    expect(G2_PARAMETERS.spiralMinimumWalklineTreadDepth.convertedValue).toBe(6.75 * INCH_TO_METER);
    expect(G2_PARAMETERS.spiralMaximumRiserHeight.convertedValue).toBe(9.5 * INCH_TO_METER);
    expect(G2_PARAMETERS.spiralMinimumHeadroom.convertedValue).toBe(78 * INCH_TO_METER);
    expect(G2_PARAMETERS.stairWidthAboveHandrail.convertedValue).toBe(36 * INCH_TO_METER);
    expect(G2_PARAMETERS.stairWidthOneHandrail.convertedValue).toBe(31.5 * INCH_TO_METER);
    expect(G2_PARAMETERS.stairWidthTwoHandrails.convertedValue).toBe(27 * INCH_TO_METER);
    expect(G2_PARAMETERS.habitableMinimumHeadroom.convertedValue).toBe(7 * FOOT_TO_METER);
    expect(G2_PARAMETERS.slopedHabitableCountableMinimumHeadroom.convertedValue).toBe(5 * FOOT_TO_METER);
    expect(G2_PARAMETERS.slopedHabitableMinimumCompliantRatio.convertedValue).toBe(.5);
    expect(G2_PARAMETERS.bathToiletLaundryMinimumHeadroom.convertedValue).toBe(80 * INCH_TO_METER);
    expect(G2_PARAMETERS.basementObstructionMinimumHeadroom.convertedValue).toBe(76 * INCH_TO_METER);
    expect(G2_PARAMETERS.showerHeadroomRegionMinimumSide.convertedValue).toBe(30 * INCH_TO_METER);
    expect(G2_PARAMETERS.dwellingMinimumKitchenSinkCount).toMatchObject({ id: "G2-019-P05", originalValue: 1, originalUnit: "count" });
    expect(G2_PARAMETERS.stairWidthOneHandrail.convertedValue).not.toBe(.787);
    expect(G2_PARAMETERS.stairWidthTwoHandrails.convertedValue).not.toBe(.698);
    expect(G2_PARAMETERS.hallwayWidth.convertedValue).not.toBe(.914);
    expect(G2_PARAMETERS.habitableRoomDimension.convertedValue).not.toBe(2.134);
    expect(Object.values(G2_PARAMETERS).map((parameter) => parameter.convertedValue)).not.toContain(.6);
    expect(Object.values(G2_PARAMETERS).map((parameter) => parameter.convertedValue)).not.toContain(.3);
  });
});

describe("G2-001 necessary egress door", () => {
  const door = { id: "exterior-a", rawPascalId: "exterior-a", widthMeters: .9, heightMeters: 2, doorType: "hinged" };
  const second = { id: "exterior-b", rawPascalId: "exterior-b", widthMeters: 1, heightMeters: 2.1, doorType: "hinged" };
  const other = { id: "ordinary-interior-door", rawPascalId: "ordinary-interior-door", widthMeters: .9, heightMeters: 2, doorType: "hinged" };
  const run = (ctx: Partial<G2EvaluationContext>) => {
    const env = environment([], { handoff: { ...environment([]).handoff, doors: [door, second, other] }, context: context(ctx) });
    env.graph.portals = [
      { doorId: door.id, pascalSourceId: door.id, usableForConnectivity: true, connectsExterior: true },
      { doorId: second.id, pascalSourceId: second.id, usableForConnectivity: true, connectsExterior: true },
      { doorId: other.id, pascalSourceId: other.id, usableForConnectivity: true, connectsExterior: false },
    ];
    return evaluateG2001(env);
  };

  it("uses every reliable exterior portal without a main-entry field and passes when any candidate complies", () => {
    const found = run({ actualDoorClearOpenings: { [door.id]: { widthMeters: 32 * INCH_TO_METER, heightMeters: 78 * INCH_TO_METER, reliable: true, source: "field measurement" }, [second.id]: { widthMeters: .1, heightMeters: .1, reliable: true, source: "field measurement" }, [other.id]: { widthMeters: .1, heightMeters: .1, reliable: true, source: "irrelevant" } } });
    expect(found.status).toBe("pass");
    expect(found.normalizedObjectIds).toEqual([door.id, second.id]);
    expect(found.measurements).toContainEqual(expect.objectContaining({ name: "exteriorDoorCandidateCount", value: 2 }));
    expect(found.measurements).toContainEqual(expect.objectContaining({ name: "actualClearWidthMeters", measurementBasis: "explicit", margin: 0, borderline: true }));
  });
  it("issues only when every candidate is reliably measured and fails, and derives clear openings without a new JSON field", () => {
    const failing = { widthMeters: 32 * INCH_TO_METER - .0001, heightMeters: 78 * INCH_TO_METER, reliable: true, source: "field measurement" };
    expect(run({ actualDoorClearOpenings: { [door.id]: failing, [second.id]: failing } }).status).toBe("issue");
    expect(run({}).status).toBe("pass");
    expect(run({ codeApplicability: "not_applicable", projectUse: "nonresidential" }).status).toBe("not_applicable");
  });
  it("uses the complete operable double-door opening minus jamb stops instead of halving it", () => {
    const double = { ...door, id: "double", widthMeters: 1.7, doorType: "double", leafCount: 2 };
    const env = environment([], { handoff: { ...environment([]).handoff, doors: [double] } });
    env.graph.portals = [{ doorId: double.id, pascalSourceId: double.id, usableForConnectivity: true, connectsExterior: true }];
    const found = evaluateG2001(env);
    expect(found.status).toBe("pass");
    expect(found.measurements).toContainEqual(expect.objectContaining({
      name: "planDerivedClearWidthMeters",
      value: 1.7 - 2 * G2_DOOR_OPENING_ASSUMPTIONS.jambStopDeductionPerSideMeters,
    }));
  });
  it("remains unable when a reliable side-hinged exterior portal lacks opening dimensions", () => {
    const unknown = { ...door, id: "unknown", widthMeters: null, heightMeters: null };
    const env = environment([], { handoff: { ...environment([]).handoff, doors: [unknown] } });
    env.graph.portals = [{ doorId: unknown.id, pascalSourceId: unknown.id, usableForConnectivity: true, connectsExterior: true }];
    expect(evaluateG2001(env).status).toBe("unable_to_determine");
  });
});

describe("G2-003 residential hallway width", () => {
  it("passes equality, issues below, and does not turn an ordinary room path into a hallway", () => {
    const exact = room("hall", rectangle(6, 3 * FOOT_TO_METER), 6 * 3 * FOOT_TO_METER), exactEnv = environment([exact]);
    exactEnv.context.roomUseOverrides = { hall: "hallway" };
    expect(evaluateG2003(exactEnv).status).toBe("pass");
    exact.polygons = [[rectangle(6, 3 * FOOT_TO_METER - .001)]];
    expect(evaluateG2003(exactEnv).status).toBe("issue");
    exactEnv.context.roomUseOverrides = { hall: "habitable" };
    exactEnv.context.confirmedNoHallways = true;
    expect(evaluateG2003(exactEnv).status).toBe("not_applicable");
  });
  it("returns unable when hallway purpose cannot be established", () => {
    expect(evaluateG2003(environment([room("unknown")])).status).toBe("unable_to_determine");
  });
  it("measures the narrow branch of a concave hallway instead of rejecting the shape", () => {
    const branched: Ring = [[0, 0], [6, 0], [6, 1], [3.5, 1], [3.5, 4], [2.5, 4], [2.5, 1], [0, 1]];
    const target = room("branched", branched, 9), env = environment([target]);
    env.context.roomUseOverrides = { branched: "hallway" };
    expect(evaluateG2003(env).status).toBe("pass");
    target.polygons = [[[[0, 0], [6, 0], [6, 1], [3.4, 1], [3.4, 4], [2.6, 4], [2.6, 1], [0, 1]]]];
    expect(evaluateG2003(env).status).toBe("issue");
  });
});

describe("G2-004 habitable room area", () => {
  it("passes exact countable area, issues just below, and requires height evidence for an apparent pass", () => {
    const threshold = 70 * SQUARE_FOOT_TO_SQUARE_METER, target = room("bed", rectangle(3, threshold / 3), threshold), env = environment([target]);
    env.context.roomUseOverrides = { bed: "sleeping" };
    env.context.roomHeightLimitations = { bed: "confirmed_absent" };
    expect(evaluateG2004(env).status).toBe("pass");
    target.areaSquareMeters = threshold - .0001;
    expect(evaluateG2004(env).status).toBe("issue");
    target.areaSquareMeters = threshold + 1;
    env.context.roomHeightLimitations = { bed: "unknown" };
    expect(evaluateG2004(env).status).toBe("unable_to_determine");
  });
  it("does not unconditionally split a mixed open Room into Zone areas", () => {
    const target = room("open"), env = environment([target]);
    env.handoff.zones = [{ id: "living", name: "LIVING ROOM" }, { id: "kitchen", name: "OPEN KITCHEN" }];
    env.rooms.roomToZoneIds.open = ["living", "kitchen"];
    expect(evaluateG2004(env).status).toBe("unable_to_determine");
    expect(evaluateG2004(env).measurements).toContainEqual(expect.objectContaining({ name: "derivedPlanRoomAreaSquareMeters", value: 16, normalizedObjectId: "open" }));
    expect(evaluateG2004(env).diagnostics.map((item) => item.code)).not.toContain("habitable_open_room_use_unresolved");
    env.context.confirmedNoHabitableRooms = true;
    env.context.roomUseOverrides = { open: "kitchen" };
    expect(evaluateG2004(env).status).toBe("not_applicable");
  });
  it("uses existing flat Ceiling coverage and height without a separate JSON extension", () => {
    const target = room("bed", rectangle(4, 4), 16), env = environment([target]);
    env.context.roomUseOverrides = { bed: "sleeping" };
    env.handoff.ceilings = [{ id: "ceiling", levelId: "level-1", visible: true, outline: rectangle(4, 4), holes: [], heightMeters: 7 * FOOT_TO_METER }];
    expect(evaluateG2004(env).status).toBe("pass");
    env.handoff.ceilings[0].heightMeters = 7 * FOOT_TO_METER - .001;
    expect(evaluateG2004(env).status).toBe("issue");
  });
});

describe("G2-005 effective horizontal dimension", () => {
  it("passes equality and issues just below without using a bounding box", () => {
    const threshold = 7 * FOOT_TO_METER, target = room("bed", rectangle(4, threshold), 4 * threshold), env = environment([target]);
    env.context.roomUseOverrides = { bed: "sleeping" };
    expect(evaluateG2005(env).status).toBe("pass");
    target.polygons = [[rectangle(4, threshold - .001)]];
    expect(evaluateG2005(env).status).toBe("issue");
    const concave: Ring = [[0, 0], [5, 0], [5, 1.8], [1.8, 1.8], [1.8, 5], [0, 5]];
    target.polygons = [[concave]];
    expect(canFitEffectiveSquare(target.polygons, threshold).fits).toBe(false);
    expect(evaluateG2005(env).status).toBe("issue");
  });
  it("supports unable and not-applicable use gates", () => {
    expect(evaluateG2005(environment([room("unknown")]))).toMatchObject({ status: "unable_to_determine" });
    const env = environment([room("kitchen")]); env.context.roomUseOverrides = { kitchen: "kitchen" };
    expect(evaluateG2005(env).status).toBe("not_applicable");
  });
  it("measures one complete open living-dining-kitchen Room Region and excludes a pure kitchen", () => {
    const open = room("open", rectangle(8, 5), 40), env = environment([open]);
    env.handoff.zones = [{ id: "living", name: "LIVING ROOM" }, { id: "dining", name: "DINING" }, { id: "kitchen", name: "OPEN KITCHEN" }];
    env.rooms.roomToZoneIds.open = ["living", "dining", "kitchen"];
    const found = evaluateG2005(env);
    expect(found.status).toBe("pass");
    expect(found.measurements.filter((item) => item.normalizedObjectId === "open")).toHaveLength(1);
    const kitchen = environment([room("kitchen", rectangle(8, 5), 40)]);
    kitchen.handoff.zones = [{ id: "kitchen-zone", name: "KITCHEN" }];
    kitchen.rooms.roomToZoneIds.kitchen = ["kitchen-zone"];
    expect(evaluateG2005(kitchen).status).toBe("not_applicable");
  });
});

describe("G2-006 toilet clearances", () => {
  const toilet = { id: "toilet", rawPascalId: "toilet", name: "Toilet", assetName: "Toilet", category: "toilets", functionTags: ["toilets"], assetTags: [], levelId: "level-1", resolvedWorldPosition: [0, 0], resolvedRotationRadians: 0, dimensionsMeters: [.4, .8, .7], rawPosition: [0, 0, 0] };
  const run = (polygon: Ring, item: any = toilet, ctx: Partial<G2EvaluationContext> = {}) => {
    const env = environment([room("bath", polygon)]);
    env.handoff.furniture = [item];
    env.context = context(ctx);
    return evaluateG2006(env);
  };
  it("uses the residential 21 in branch exclusively and passes equality", () => {
    const side = 15 * INCH_TO_METER, front = 21 * INCH_TO_METER, polygon = [[-side, -.7], [side, -.7], [side, .35 + front], [-side, .35 + front]] as Ring, found = run(polygon);
    expect(found.status).toBe("pass");
    expect(found.thresholds.map((item) => item.originalValue)).toContain(21);
    expect(found.thresholds.map((item) => item.originalValue)).not.toContain(24);
  });
  it("issues below, is unable for missing orientation, and is not applicable when absence is confirmed", () => {
    expect(run(rectangle(.7, 3)).status).toBe("issue");
    expect(run(rectangle(3, 3), { ...toilet, resolvedRotationRadians: null }).status).toBe("unable_to_determine");
    const env = environment([room("bath")]); env.context.confirmedNoToilets = true;
    expect(evaluateG2006(env).status).toBe("not_applicable");
  });
  it("does not compare toilets across wall-separated Rooms and only compares adjacent toilets in one Room", () => {
    const left = room("bath-left", rectangle(4, 4, -3, 0)), right = room("bath-right", rectangle(4, 4, 3, 0)), separated = environment([left, right]);
    separated.handoff.furniture = [{ ...toilet, id: "left-toilet", rawPascalId: "left-toilet", resolvedWorldPosition: [-3, 0] }, { ...toilet, id: "right-toilet", rawPascalId: "right-toilet", resolvedWorldPosition: [3, 0] }];
    const separateResult = evaluateG2006(separated);
    expect(separateResult.measurements.filter((item) => item.name.startsWith("centerDistanceTo:"))).toHaveLength(0);
    expect(separateResult.measurements.filter((item) => item.name === "sameFixtureCenterSpacingSubitemStatus").map((item) => item.value)).toEqual(["not_applicable", "not_applicable"]);
    const shared = environment([room("shared-bath", rectangle(8, 4), 32)]);
    shared.handoff.furniture = [{ ...toilet, id: "toilet-a", rawPascalId: "toilet-a", resolvedWorldPosition: [-1, 0] }, { ...toilet, id: "toilet-b", rawPascalId: "toilet-b", resolvedWorldPosition: [1, 0] }];
    const sharedResult = evaluateG2006(shared);
    expect(sharedResult.measurements.filter((item) => item.name.startsWith("centerDistanceTo:"))).toHaveLength(1);
    expect(sharedResult.measurements.filter((item) => item.name === "sameFixtureCenterSpacingSubitemStatus").map((item) => item.value)).toEqual(["pass", "pass"]);
  });
  it("normalizes multi-turn rotations and records the abnormal source value without changing the result", () => {
    const found = run(rectangle(3, 3), { ...toilet, resolvedRotationRadians: Math.PI * 5 });
    expect(found.status).toBe("pass");
    expect(found.measurements).toContainEqual(expect.objectContaining({ name: "normalizedRotationRadians", value: Math.PI, measurementBasis: "derived" }));
    expect(found.diagnostics).toContainEqual(expect.objectContaining({ code: "toilet_rotation_multiple_turns_normalized", severity: "info" }));
  });
});

describe("G2-009 garage direct opening", () => {
  const garage = room("garage"), bedroom = room("bedroom"), foyer = room("foyer");
  const base = () => { const env = environment([garage, bedroom, foyer]); env.context.roomUseOverrides = { garage: "garage", bedroom: "sleeping", foyer: "circulation" }; return env; };
  it("issues for Garage–Bedroom and passes for Garage–Foyer–Bedroom", () => {
    const direct = base(); direct.graph.portals = [{ doorId: "direct-door", pascalSourceId: "direct-door", usableForConnectivity: true, roomRegionAId: "garage", roomRegionBId: "bedroom" }];
    expect(evaluateG2009(direct)).toMatchObject({ status: "issue", normalizedObjectIds: ["direct-door"] });
    const indirect = base(); indirect.graph.portals = [{ doorId: "garage-foyer", usableForConnectivity: true, roomRegionAId: "garage", roomRegionBId: "foyer" }, { doorId: "foyer-bedroom", usableForConnectivity: true, roomRegionAId: "foyer", roomRegionBId: "bedroom" }];
    expect(evaluateG2009(indirect).status).toBe("pass");
  });
  it("supports unable and not-applicable semantics", () => {
    const unknown = environment([garage, room("unknown")]); unknown.context.roomUseOverrides = { garage: "garage", unknown: "unknown" };
    expect(evaluateG2009(unknown).status).toBe("unable_to_determine");
    unknown.context.confirmedNoSleepingRooms = true;
    expect(evaluateG2009(unknown).status).toBe("not_applicable");
  });
});

describe("G2-010 egress path avoiding garage", () => {
  const exit = room("exit"), secondExit = room("second-exit"), garage = room("garage"), bedroom = room("bedroom");
  const base = () => {
    const env = environment([exit, secondExit, garage, bedroom]);
    env.context.roomUseOverrides = { exit: "circulation", "second-exit": "circulation", garage: "garage", bedroom: "sleeping" };
    env.graph.portals = [{ doorId: "egress-a", usableForConnectivity: true, connectsExterior: true, roomRegionAId: "exit", roomRegionBId: null }, { doorId: "egress-b", usableForConnectivity: true, connectsExterior: true, roomRegionAId: "second-exit", roomRegionBId: null }];
    return env;
  };
  it("uses every exterior door without a main-entry field and passes when any exit path avoids Garage", () => {
    const required = base(); required.graph.edges = [{ fromNodeId: "exit", toNodeId: "garage" }, { fromNodeId: "garage", toNodeId: "bedroom" }];
    expect(evaluateG2010(required).status).toBe("issue");
    required.graph.edges.push({ fromNodeId: "second-exit", toNodeId: "bedroom" });
    expect(evaluateG2010(required).status).toBe("pass");
    expect(evaluateG2010(required).measurements).toContainEqual(expect.objectContaining({ name: "exteriorExitCandidateCount", value: 2 }));
  });
  it("supports unable and not-applicable", () => {
    const env = base(); env.graph.portals = [];
    expect(evaluateG2010(env).status).toBe("unable_to_determine");
    env.context.confirmedNoGarage = true; env.context.roomUseOverrides = { exit: "circulation", garage: "other", bedroom: "sleeping" };
    expect(evaluateG2010(env).status).toBe("not_applicable");
  });
});
