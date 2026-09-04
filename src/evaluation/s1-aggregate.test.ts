import { describe, expect, it } from "vitest";
import { aggregateS1V01, S1_V01_AXIS_DEFINITIONS } from "./s1-aggregate";

const gate = (allowed = true) => ({ allowed, evaluatedRuleCount: 4, allowedStatuses: ["pass", "not_applicable"] as const, blockingResults: allowed ? [] : [{ ruleId: "G3-001", status: "issue" }] });
const report = (score: number | null, status: "scored" | "not_applicable" | "unable_to_determine" = "scored", ruleId = "R") => ({ status, score, rules: [{ ruleId, status, explanation: "test" }] }) as any;
const input = (statuses: Array<{ score: number | null; status?: "scored" | "not_applicable" | "unable_to_determine" }>) => ({
  spaceOrganization: report(statuses[0]!.score, statuses[0]!.status, "SO-01"),
  highFrequencyPathEfficiency: { ...report(statuses[1]!.score, statuses[1]!.status), sceneScores: [{ scene: "bedroom_to_bathroom", status: statuses[1]!.status, diagnostics: ["test"] }] },
  activityZoning: { ...report(statuses[2]!.score, statuses[2]!.status), dz01: { ruleId: "DZ-01", status: statuses[2]!.status, diagnostics: ["test"] }, dz02: { ruleId: "DZ-02", status: statuses[2]!.status, diagnostics: ["test"] } },
  spaceUtilization: { ...report(statuses[3]!.score, statuses[3]!.status), ly01: { ruleId: "LY-01", status: statuses[3]!.status, diagnostics: ["test"] }, ly02: { ruleId: "LY-02", status: statuses[3]!.status, diagnostics: ["test"] } },
  storageConfiguration: { ...report(statuses[4]!.score, statuses[4]!.status), sn01: { ruleId: "SN-01", status: statuses[4]!.status, diagnostics: ["test"] }, sn02: { ruleId: "SN-02", status: statuses[4]!.status, diagnostics: ["test"] }, sn03: { ruleId: "SN-03", status: statuses[4]!.status, diagnostics: ["test"] } },
}) as any;

describe("S1 v0.1 aggregate", () => {
  it("keeps the frozen five-axis order and averages five formal scores", () => {
    const result = aggregateS1V01(gate(), input([{ score: 100 }, { score: 97.6 }, { score: 96.7 }, { score: 83.2 }, { score: 81.4 }]));
    expect(S1_V01_AXIS_DEFINITIONS.map((axis) => axis.name)).toEqual(["空间组织", "动线效率", "动静分区", "空间利用", "收纳配置"]);
    expect(result).toMatchObject({ status: "scored", score: 91.8, coverage: { applicableAxisCount: 5, notApplicableAxisCount: 0, unableAxisCount: 0 } });
  });

  it("re-normalizes only genuinely not-applicable axes", () => {
    const result = aggregateS1V01(gate(), input([{ score: 100 }, { score: 80 }, { score: 60 }, { score: 40 }, { score: null, status: "not_applicable" }]));
    expect(result).toMatchObject({ status: "scored", score: 70, coverage: { applicableAxisCount: 4, notApplicableAxisCount: 1 } });
    expect(result.axes[4]).toMatchObject({ name: "收纳配置", status: "not_applicable", score: null });
  });

  it("does not turn unable evidence into zero or generate an incomplete total", () => {
    const result = aggregateS1V01(gate(), input([{ score: 100 }, { score: 80 }, { score: null, status: "unable_to_determine" }, { score: 40 }, { score: 20 }]));
    expect(result).toMatchObject({ status: "unable_to_determine", score: null, coverage: { unableAxisCount: 1 } });
  });

  it("keeps the G allow-list gate in front of any S1 total", () => {
    const result = aggregateS1V01(gate(false), input([{ score: 100 }, { score: 100 }, { score: 100 }, { score: 100 }, { score: 100 }]));
    expect(result).toMatchObject({ status: "blocked", score: null });
  });
});
