import { describe, expect, it } from "vitest";
import bellevue from "../../sample-data/Bellevue demo.json";
import passingBellevue from "../../sample-data/Bellevue passing demo.json";
import bellevueRequirementsJson from "../../sample-data/requirements/Bellevue requirements demo.json";
import { buildUnifiedEvaluationReport, reportHasSourceGroup, visibleReportFindings } from "../evaluation-report/report";
import { buildEvaluationHandoff } from "../parser/evaluation-handoff";
import { parseProject } from "../parser/parse";
import { parseRequirementHandoff, type CustomerRequirement, type RequirementHandoff } from "../requirements/requirement-handoff";
import { evaluateAll, evaluateG4RequirementsOnly, requirementGateBlocks } from "./evaluate";
import { evaluateG4Requirements, evaluateG4RequirementRules } from "./g4-requirements";
import { BELLEVUE_DETACHED_DWELLING_G2_CONTEXT } from "./g2-rules";

const parsedRequirements = parseRequirementHandoff(bellevueRequirementsJson);
if (!parsedRequirements.ok) throw new Error(parsedRequirements.error);
const demoRequirements = parsedRequirements.handoff;
const handoff = () => buildEvaluationHandoff(parseProject(bellevue));
const handoffWith = (...requirements: CustomerRequirement[]): RequirementHandoff => ({ schemaVersion: "0.1", source: { name: "test" }, requirements });
const resultFor = (requirements: RequirementHandoff, id: string, plan = handoff()) => evaluateG4Requirements(plan, requirements).find((result) => result.requirement.id === id)!;
type RequirementBody<T extends CustomerRequirement = CustomerRequirement> = T extends unknown ? Omit<T, "id" | "name" | "autoCheckSupported"> : never;
const requirement = (id: string, value: RequirementBody): CustomerRequirement => ({ id, name: id, autoCheckSupported: true, ...value } as CustomerRequirement);

describe("G4 customer requirement evaluation", () => {
  it("does not run or expose G4 when no Requirement Handoff is supplied", () => {
    const report = evaluateAll(handoff(), BELLEVUE_DETACHED_DWELLING_G2_CONTEXT, "2026-07-29T00:00:00.000Z");
    expect(report.scope).toBe("G1-G2-G3-foundation");
    expect(report.rules).toHaveLength(31);
    expect(report.rules.some((rule) => rule.ruleId.startsWith("G4-"))).toBe(false);
    const unified = buildUnifiedEvaluationReport(report);
    expect(unified.summary.groupCounts.G4).toEqual({ pass: 0, issue: 0, unable_to_determine: 0, not_applicable: 0 });
    expect(reportHasSourceGroup(unified, "G4")).toBe(false);
  }, 20_000);

  it("evaluates the Bellevue demo as five satisfied, two not satisfied and two manual review", () => {
    const results = evaluateG4Requirements(handoff(), demoRequirements);
    expect(results.map((result) => result.status)).toEqual([
      "satisfied", "satisfied", "satisfied", "satisfied", "satisfied",
      "not_satisfied", "not_satisfied", "manual_review", "manual_review",
    ]);
  });

  it("uses every customer requirement as a mandatory front gate", () => {
    const report = evaluateG4RequirementsOnly(handoff(), demoRequirements, "2026-07-29T00:00:00.000Z");
    expect(report.scope).toBe("G4-requirements");
    expect(report.rules.every((rule) => rule.ruleId.startsWith("G4-"))).toBe(true);
    expect(requirementGateBlocks(report.rules)).toBe(true);
    expect(requirementGateBlocks([{ ruleId: "G4-ONLY", status: "pass" }])).toBe(false);
    expect(requirementGateBlocks([{ ruleId: "G4-MANUAL", status: "unable_to_determine" }])).toBe(true);
    expect(requirementGateBlocks([{ ruleId: "G1-ISSUE", status: "issue" }])).toBe(false);
  });

  it("checks space presence and deduplicates duplicate Garage Zones through one Room Region", () => {
    const presence = requirement("PRESENCE", { type: "space_presence", targetSpace: { semantic: "chinese_kitchen" } });
    const count = requirement("COUNT", { type: "space_count", targetSpace: { semantic: "garage" }, quantity: { max: 1 } });
    expect(resultFor(handoffWith(presence), "PRESENCE").status).toBe("satisfied");
    const counted = resultFor(handoffWith(count), "COUNT");
    expect(counted.status).toBe("satisfied");
    expect(counted.measurements[0]?.value).toBe(1);
  });

  it("uses SF code before display name while retaining old name fallback", () => {
    const coded = buildEvaluationHandoff(parseProject(passingBellevue)), primary = coded.zones.find((zone) => zone.spaceFunctionCode === "SF11")!;
    primary.name = "与主卧无关的显示名称";
    const presence = requirement("PRIMARY", { type: "space_presence", targetSpace: { semantic: "primary_bedroom" } });
    expect(resultFor(handoffWith(presence), "PRIMARY", coded).status).toBe("satisfied");
    expect(resultFor(handoffWith(presence), "PRIMARY", handoff()).status).toBe("satisfied");
  });

  it("checks any, every and total area modes using existing Room Region area", () => {
    const any = requirement("AREA-ANY", { type: "space_area", targetSpace: { semantic: "bedroom" }, area: { mode: "any", minSquareMeters: 30 } });
    const every = requirement("AREA-EVERY", { type: "space_area", targetSpace: { semantic: "bedroom" }, area: { mode: "every", minSquareMeters: 14 } });
    const total = requirement("AREA-TOTAL", { type: "space_area", targetSpace: { semantic: "bedroom" }, area: { mode: "total", minSquareMeters: 80 } });
    const results = evaluateG4Requirements(handoff(), handoffWith(any, every, total));
    expect(results.map((result) => result.status)).toEqual(["satisfied", "satisfied", "satisfied"]);
    expect(results.flatMap((result) => result.measurements).every((measurement) => measurement.name === "roomArea")).toBe(true);
  });

  it("checks a stable Level ID before display name or ordinal", () => {
    const level = requirement("LEVEL", { type: "level_location", targetSpace: { semantic: "laundry" }, level: { levelId: "level_tf1ug5dswkkzfhqa", ordinal: 999, name: "Wrong display name" }, quantity: { min: 1 } });
    expect(resultFor(handoffWith(level), "LEVEL").status).toBe("satisfied");
  });

  it("reuses direct connectivity for adjacency and separation", () => {
    const adjacency = requirement("ADJ", { type: "space_adjacency", leftSpace: { semantic: "primary_bedroom" }, rightSpace: { semantic: "primary_bathroom" }, relationship: "directly_connected" });
    const separation = requirement("SEP", { type: "space_separation", leftSpace: { semantic: "garage" }, rightSpace: { semantic: "mud_room" }, relationship: "directly_connected" });
    const results = evaluateG4Requirements(handoff(), handoffWith(adjacency, separation));
    expect(results.map((result) => result.status)).toEqual(["satisfied", "not_satisfied"]);
    expect(results.every((result) => result.reason.includes("连接") || result.reason.includes("Room"))).toBe(true);
  });

  it("returns manual_review when direct relationship evidence is insufficient", () => {
    const plan = handoff();
    plan.doors = [];
    const adjacency = requirement("ADJ-UNKNOWN", { type: "space_adjacency", leftSpace: { semantic: "primary_bedroom" }, rightSpace: { semantic: "primary_bathroom" }, relationship: "directly_connected" });
    expect(resultFor(handoffWith(adjacency), "ADJ-UNKNOWN", plan)).toMatchObject({ status: "manual_review" });
  });

  it("keeps the two washers and one refrigerator request as manual review, never an issue", () => {
    const result = resultFor(demoRequirements, "REQ-008");
    expect(result.status).toBe("manual_review");
    expect(result.relatedObjectIds).toEqual([]);
    expect(result.reason).toContain("客户设备绑定");
    expect(evaluateG4RequirementRules(handoff(), demoRequirements).find((rule) => rule.ruleId === "G4-REQ-008")?.status).toBe("unable_to_determine");
  });

  it("maps G4 into the unified report without changing G1, G2 or G3 results", () => {
    const plan = handoff();
    const baseline = evaluateAll(plan, BELLEVUE_DETACHED_DWELLING_G2_CONTEXT, "2026-07-29T00:00:00.000Z");
    const withG4 = evaluateAll(plan, BELLEVUE_DETACHED_DWELLING_G2_CONTEXT, "2026-07-29T00:00:00.000Z", demoRequirements);
    expect(withG4.scope).toBe("G1-G2-G3-G4-foundation");
    expect(withG4.rules.filter((rule) => !rule.ruleId.startsWith("G4-"))).toEqual(baseline.rules);
    const unified = buildUnifiedEvaluationReport(withG4), g4 = visibleReportFindings(unified, { groups: ["G4"] });
    expect(g4).toHaveLength(9);
    expect(unified.summary.groupCounts.G4).toEqual({ pass: 5, issue: 2, unable_to_determine: 2, not_applicable: 0 });
    expect(reportHasSourceGroup(unified, "G4")).toBe(true);
    expect(g4.find((finding) => finding.ruleId === "G4-REQ-001")).toMatchObject({ sourceGroup: "G4", status: "pass", customerRequirement: { requirementId: "REQ-001" } });
    expect(g4.find((finding) => finding.ruleId === "G4-REQ-007")?.status).toBe("issue");
    expect(g4.find((finding) => finding.ruleId === "G4-REQ-008")?.status).toBe("unable_to_determine");
  }, 20_000);
});
