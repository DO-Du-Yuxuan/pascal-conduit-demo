import { describe, expect, it } from "vitest";
import sample from "../../fixtures/evaluation/sample-normalized-plan.json";
import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { evaluateG1Foundation } from "./evaluate";
import { ruleG1001, ruleG1002, ruleG1003, ruleG1004, ruleG1005, ruleG1023 } from "./g1-rules";
import { CONFIRMED_G1_RULE_IDS } from "./product-rule-scope";

const fixture = () => structuredClone(sample) as unknown as EvaluationHandoff;
const rule = (report: ReturnType<typeof evaluateG1Foundation>, id: string) => report.rules.find((item) => item.ruleId === id)!;

describe("G1 foundation evaluator", () => {
  it("only emits product-confirmed G1 rules", () => {
    const report = evaluateG1Foundation(fixture(), "2026-01-01T00:00:00.000Z");
    expect(report.rules.map((item) => item.ruleId)).toEqual(CONFIRMED_G1_RULE_IDS);
  });

  it("retains canceled import preflight helpers without emitting product cards", () => {
    const handoff = fixture();
    handoff.walls.push({ ...handoff.walls[0] });
    handoff.walls[0].start = [Number.NaN, 0];
    handoff.furniture[0].dimensionsMeters = [0, 1, 1];
    handoff.furniture[0].levelId = null;
    handoff.windows[0].hostWallId = "wall_missing";
    expect(ruleG1001(handoff).status).toBe("pass");
    expect(ruleG1002(handoff).status).toBe("issue");
    expect(ruleG1003(handoff).status).toBe("issue");
    expect(ruleG1004(handoff).status).toBe("issue");
    expect(ruleG1005(handoff).status).toBe("issue");
    expect(evaluateG1Foundation(handoff).rules.some((item) => ["G1-001", "G1-002", "G1-003", "G1-004", "G1-005"].includes(item.ruleId))).toBe(false);
  });

  it("uses unable_to_determine when main-space semantics are missing", () => {
    const found = rule(evaluateG1Foundation(fixture()), "G1-019");
    expect(found.status).toBe("unable_to_determine");
    expect(found.missingData).toContain("独立 Space 对象");
    expect(found.confidence.level).toBe("low");
  });

  it("does not crash on invalid or unsupported geometry", () => {
    const handoff = fixture();
    handoff.walls[0].start = null;
    handoff.walls[1].curveOffsetMeters = 1;
    expect(() => evaluateG1Foundation(handoff)).not.toThrow();
    expect(rule(evaluateG1Foundation(handoff), "G1-013").status).toBe("unable_to_determine");
  });

  it("does not mix wall penetration or item collision into G1-023", () => {
    const handoff = fixture(), first = handoff.furniture[0], second = { ...structuredClone(first), id: "collision-related", rawPascalId: "collision-related" };
    first.levelId = handoff.walls[0].levelId;
    first.resolvedWorldPosition = handoff.walls[0].start;
    first.resolvedRotationRadians = 0;
    first.rawPosition = [handoff.walls[0].start![0], 0, handoff.walls[0].start![1]];
    first.dimensionsMeters = [1, 1, 1];
    (first as any).resolvedVerticalRangeMeters = [0, 1];
    second.levelId = first.levelId;
    second.resolvedWorldPosition = first.resolvedWorldPosition;
    second.rawPosition = first.rawPosition;
    second.dimensionsMeters = first.dimensionsMeters;
    (second as any).resolvedVerticalRangeMeters = [.2, 1.2];
    handoff.furniture = [first, second];
    const found = ruleG1023(handoff);
    expect(found.diagnostics.map((diagnostic) => diagnostic.code)).not.toEqual(expect.arrayContaining(["item_penetrates_wall", "item_physical_collision"]));
    expect(found.measurements.find((measurement) => measurement.name === "wallPenetrationCount")).toBeUndefined();
    expect(found.measurements.find((measurement) => measurement.name === "itemCollisionPairCount")).toBeUndefined();
  });

  it("retains invalid wall-footprint diagnostics and refuses to guess", () => {
    const handoff = fixture();
    handoff.doors = [handoff.doors[0]];
    handoff.windows = [];
    handoff.walls[0].footprintValidation = { valid: false, codes: ["wall_self_intersection"], areaSquareMeters: 0, footprint: [] };
    const found = rule(evaluateG1Foundation(handoff), "G1-013");
    expect(found.status).toBe("unable_to_determine");
    expect(found.diagnostics[0].message).toContain("wall_self_intersection");
  });

  it("passes a straight opening inside its host and reports actual intervals", () => {
    const handoff = fixture();
    handoff.doors = [handoff.doors[0]];
    handoff.windows = [];
    const found = rule(evaluateG1Foundation(handoff), "G1-013");
    expect(found.status).toBe("pass");
    expect(found.measurements).toEqual([]);
  });
});
