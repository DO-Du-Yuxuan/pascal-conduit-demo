import { describe, expect, it } from "vitest";
import { buildDoorOperations, buildObstacles } from "./door-operations";
import { ruleG3002, ruleG3007, ruleG3008 } from "./g3-operation-rules";

const wall = { id: "wall", rawPascalId: "wall", levelId: "L1", parentId: "L1", visible: true, name: "wall", start: [0, 0], end: [10, 0], thicknessMeters: .1, heightMeters: 3, curveOffsetMeters: 0, footprintValidation: { valid: true, codes: [], areaSquareMeters: 1, footprint: [[0, -.05], [10, -.05], [10, .05], [0, .05]] } };
const door = (id = "door", extra: any = {}) => ({ id, rawPascalId: id, levelId: "L1", parentId: "wall", visible: true, name: id, hostWallId: "wall", resolvedWorldPosition: [5, 0], resolvedTangentRadians: 0, widthMeters: 1, heightMeters: 2.1, doorType: "hinged", hingesSide: "left", swingDirection: "inward", swingAngleRadians: Math.PI / 2, ...extra });
const item = (id: string, x: number, z: number, width: number, depth: number, category: string | null = "cabinets") => ({ id, rawPascalId: id, levelId: "L1", parentId: "L1", visible: true, name: id, category, functionTags: category ? [category] : [], dimensionsMeters: [width, 1, depth], resolvedWorldPosition: [x, z], resolvedRotationRadians: 0, transformStatus: "ok" });
const base = (options: any = {}) => ({ schemaVersion: "1.0", source: {}, units: {}, levels: [{ id: "L1", rawPascalId: "L1", levelId: "L1", parentId: null, visible: true }], walls: [wall], doors: [door()], furniture: [], equipment: [], columns: [], shafts: [], slabs: [], zones: [], spaces: [], windows: [], shelves: [], stairs: [], relationships: {}, unclassifiedNodes: [], diagnostics: [], ...options } as any);

describe("Door operation geometry and G3 obstruction checks", () => {
  it("creates swing geometry only for a hinged door with explicit operation fields", () => {
    expect(buildDoorOperations(base())[0]).toMatchObject({ usableForEvaluation: true, hingePoint: [4.5, 0] });
    const rightHinged = buildDoorOperations(base({ doors: [door("right", { hingesSide: "right" })] }))[0]!;
    expect(rightHinged.openLeafSegment?.[1][1]).toBeGreaterThan(0);
    const rightOutward = buildDoorOperations(base({ doors: [door("right-outward", { hingesSide: "right", swingDirection: "outward" })] }))[0]!;
    expect(rightOutward.openLeafSegment?.[1][1]).toBeLessThan(0);
    expect(buildDoorOperations(base({ doors: [door("slide", { doorType: "sliding" })] }))[0]).toMatchObject({ usableForEvaluation: false, diagnostics: ["non_swing_door_not_applicable"] });
    const double = buildDoorOperations(base({ doors: [door("double", { doorType: "double", leafCount: 2 })] }))[0]!;
    expect(double).toMatchObject({ usableForEvaluation: true, diagnostics: ["double_door_equal_leaf_assumption"], leaves: [{ leafIndex: 0 }, { leafIndex: 1 }] });
    expect(double.leaves.map((leaf) => Math.hypot(leaf.closedLeafSegment[1][0] - leaf.closedLeafSegment[0][0], leaf.closedLeafSegment[1][1] - leaf.closedLeafSegment[0][1]))).toEqual([.5, .5]);
    expect(double.leaves.every((leaf) => leaf.openLeafSegment[1][1] > 0)).toBe(true);
    expect(buildDoorOperations(base({ doors: [door("french", { doorType: "french", leafCount: 2 })] }))[0]).toMatchObject({ usableForEvaluation: true, leaves: [{ leafIndex: 0 }, { leafIndex: 1 }] });
    expect(buildDoorOperations(base({ doors: [door("short-swing", { swingAngleRadians: Math.PI * .45 })] }))[0]).toMatchObject({ usableForEvaluation: false, diagnostics: ["door_operation_data_unavailable"] });
    expect(buildDoorOperations(base({ doors: [door("unknown", { hingesSide: null })] }))[0]?.diagnostics).toContain("door_operation_data_unavailable");
  });

  it("detects a fully blocked entry but ignores furniture that is merely near it", () => {
    const blocked = base({ furniture: [item("cabinet", 5, 0, 1.2, 1.2)] });
    expect(ruleG3002(blocked).status).toBe("issue");
    const clear = base({ furniture: [item("nearby", 5, 1.1, 1, .3)] });
    expect(ruleG3002(clear).status).toBe("pass");
    const uncertain = base({ furniture: [item("unknown", 5, 0, 1.2, 1.2, null)] });
    expect(ruleG3002(uncertain)).toMatchObject({ status: "unable_to_determine", diagnostics: [expect.objectContaining({ code: "door_entry_obstacle_classification_unreliable" })] });
  });

  it("detects a swing collision, excludes the host wall, and only flags actual leaf interlock", () => {
    const cabinet = item("cabinet", 5, .35, .35, .5, "cabinets");
    expect(ruleG3007(base({ equipment: [cabinet] }))).toMatchObject({ status: "issue", normalizedObjectIds: expect.arrayContaining(["door", "cabinet"]) });
    const chair = item("chair", 5, .35, .35, .5, "chairs");
    expect(ruleG3007(base({ furniture: [chair] }))).toMatchObject({ status: "pass", normalizedObjectIds: [] });
    expect(ruleG3007(base({ furniture: [item("unknown", 5, .35, .35, .5, null)] }))).toMatchObject({ status: "unable_to_determine", diagnostics: [expect.objectContaining({ code: "door_swing_obstacle_classification_unreliable" })] });
    const blockingWall = { ...wall, id: "other-wall", rawPascalId: "other-wall", footprintValidation: { valid: true, codes: [], areaSquareMeters: .1, footprint: [[4.9, .2], [5.1, .2], [5.1, .7], [4.9, .7]] } };
    expect(ruleG3007(base({ walls: [wall, blockingWall] }))).toMatchObject({ status: "issue", normalizedObjectIds: expect.arrayContaining(["door", "other-wall"]) });
    expect(ruleG3007(base()).status).toBe("pass");
    const overlapping = base({ doors: [door("a"), door("b", { resolvedWorldPosition: [5.02, 0] })] });
    expect(ruleG3008(overlapping).status).toBe("issue");
    const sequential = base({ doors: [door("a"), door("b", { resolvedWorldPosition: [5.5, 0] })] });
    expect(ruleG3008(sequential)).toMatchObject({ status: "pass", diagnostics: [expect.objectContaining({ code: "door_sweeps_overlap_sequential_use_possible" })] });
    expect(buildObstacles(base()).find((obstacle) => obstacle.objectId === "wall")?.mobility).toBe("fixed");
  });
});
