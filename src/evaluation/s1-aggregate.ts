import type { S1GateResult } from "./s1";
import type { S1ActivityZoningReport } from "./s1-activity-zoning";
import type { S1HighFrequencyPathScoreSummary } from "./s1-high-frequency-path-scoring";
import type { S1SpaceOrganizationReport } from "./s1-space-organization";
import type { S1SpaceUtilizationReport } from "./s1-space-utilization";
import type { S1StorageConfigurationReport } from "./s1-storage-configuration";

export const S1_V01_AXIS_DEFINITIONS = [
  { axisId: "space_organization", metricId: "S1-SO", name: "空间组织", weight: 0.2 },
  { axisId: "path_efficiency", metricId: "S1-HPE", name: "动线效率", weight: 0.2 },
  { axisId: "activity_zoning", metricId: "S1-DZ", name: "动静分区", weight: 0.2 },
  { axisId: "space_utilization", metricId: "S1-LY", name: "空间利用", weight: 0.2 },
  { axisId: "storage_configuration", metricId: "S1-SN", name: "收纳配置", weight: 0.2 },
] as const;

export type S1AxisId = typeof S1_V01_AXIS_DEFINITIONS[number]["axisId"];
export type S1AggregateAxisStatus = "scored" | "not_applicable" | "unable_to_determine";
export type S1AggregateStatus = "scored" | "not_applicable" | "unable_to_determine" | "blocked";
export type S1AggregateAxis = { axisId: S1AxisId; metricId: string; name: string; baseWeight: number; status: S1AggregateAxisStatus; score: number | null; ruleIds: string[]; diagnostics: string[] };
export type S1AggregateInput = {
  spaceOrganization: S1SpaceOrganizationReport;
  highFrequencyPathEfficiency: S1HighFrequencyPathScoreSummary;
  activityZoning: S1ActivityZoningReport;
  spaceUtilization: S1SpaceUtilizationReport;
  storageConfiguration: S1StorageConfigurationReport;
};
export type S1AggregateReport = {
  metricId: "S1";
  metricName: "S1 设计性能";
  ruleVersion: "v0.1-demo";
  gate: S1GateResult;
  status: S1AggregateStatus;
  score: number | null;
  axes: S1AggregateAxis[];
  coverage: { totalAxisCount: number; applicableAxisCount: number; notApplicableAxisCount: number; unableAxisCount: number; coverageLabel: string };
  diagnostics: string[];
};

const roundOne = (value: number) => Math.round(value * 10) / 10;
const normalizeStatus = (status: string, score: number | null): S1AggregateAxisStatus => status === "not_applicable" ? "not_applicable" : status === "scored" && score !== null ? "scored" : "unable_to_determine";

export function aggregateS1V01(gate: S1GateResult, input: S1AggregateInput): S1AggregateReport {
  const sources: Array<{ report: { status: string; score: number | null }; ruleIds: string[]; diagnostics: string[] }> = [
    { report: input.spaceOrganization, ruleIds: input.spaceOrganization.rules.map((rule) => rule.ruleId), diagnostics: input.spaceOrganization.rules.flatMap((rule) => rule.status === "unable_to_determine" ? [rule.explanation] : []) },
    { report: input.highFrequencyPathEfficiency, ruleIds: input.highFrequencyPathEfficiency.sceneScores.map((scene) => scene.scene), diagnostics: input.highFrequencyPathEfficiency.sceneScores.flatMap((scene) => scene.status === "unable_to_determine" ? scene.diagnostics : []) },
    { report: input.activityZoning, ruleIds: [input.activityZoning.dz01.ruleId, input.activityZoning.dz02.ruleId], diagnostics: [input.activityZoning.dz01, input.activityZoning.dz02].flatMap((rule) => rule.status === "unable_to_determine" ? rule.diagnostics : []) },
    { report: input.spaceUtilization, ruleIds: [input.spaceUtilization.ly01.ruleId, input.spaceUtilization.ly02.ruleId], diagnostics: [input.spaceUtilization.ly01, input.spaceUtilization.ly02].flatMap((rule) => rule.status === "unable_to_determine" ? rule.diagnostics : []) },
    { report: input.storageConfiguration, ruleIds: [input.storageConfiguration.sn01.ruleId, input.storageConfiguration.sn02.ruleId, input.storageConfiguration.sn03.ruleId], diagnostics: [input.storageConfiguration.sn01, input.storageConfiguration.sn02, input.storageConfiguration.sn03].flatMap((rule) => rule.status === "unable_to_determine" ? rule.diagnostics : []) },
  ];
  const axes = S1_V01_AXIS_DEFINITIONS.map((definition, index) => {
    const source = sources[index]!;
    return { ...definition, baseWeight: definition.weight, status: normalizeStatus(source.report.status, source.report.score), score: source.report.score, ruleIds: source.ruleIds, diagnostics: source.diagnostics } satisfies S1AggregateAxis;
  });
  const applicable = axes.filter((axis) => axis.status === "scored"), unable = axes.filter((axis) => axis.status === "unable_to_determine"), notApplicable = axes.filter((axis) => axis.status === "not_applicable");
  const coverage = { totalAxisCount: axes.length, applicableAxisCount: applicable.length, notApplicableAxisCount: notApplicable.length, unableAxisCount: unable.length, coverageLabel: `${applicable.length} / ${axes.length} axes applicable` };
  if (!gate.allowed) return { metricId: "S1", metricName: "S1 设计性能", ruleVersion: "v0.1-demo", gate, status: "blocked", score: null, axes, coverage, diagnostics: [`G1–G4 准入未通过：${gate.blockingResults.map((item) => `${item.ruleId} (${item.status})`).join("、") || "存在未解决状态"}。`] };
  if (unable.length) return { metricId: "S1", metricName: "S1 设计性能", ruleVersion: "v0.1-demo", gate, status: "unable_to_determine", score: null, axes, coverage, diagnostics: ["部分设计性能指标缺少可靠证据，暂不生成完整 S1 总分。", ...unable.flatMap((axis) => axis.diagnostics)] };
  if (!applicable.length) return { metricId: "S1", metricName: "S1 设计性能", ruleVersion: "v0.1-demo", gate, status: "not_applicable", score: null, axes, coverage, diagnostics: ["五个 S1 轴均不适用，未生成总分。"] };
  return { metricId: "S1", metricName: "S1 设计性能", ruleVersion: "v0.1-demo", gate, status: "scored", score: roundOne(applicable.reduce((sum, axis) => sum + axis.score!, 0) / applicable.length), axes, coverage, diagnostics: notApplicable.length ? [`${coverage.coverageLabel}；不适用轴已从总分分母排除。`] : ["五个正式 S1 轴均有可靠分数，按等权平均生成总分。"] };
}
