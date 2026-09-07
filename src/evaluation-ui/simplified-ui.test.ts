// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
const appStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const evaluationStyles = readFileSync(resolve(process.cwd(), "src/evaluation.css"), "utf8");
const s1PanelSource = appSource.slice(appSource.indexOf("function S1Panel("), appSource.indexOf("function LegacyS1Panel("));

describe("simplified evaluation and layer controls", () => {
  it("keeps a single designer-facing report path without duplicate report filters", () => {
    expect(appSource).not.toContain("返回规则评价");
    expect(appSource).not.toContain("综合报告 V0.1");
    expect(appSource).not.toContain("unified-filters");
    expect(appSource).toContain("重新检查");
    expect(appSource).toContain("selectedGroup={selectedGroup}");
    expect(appSource).toContain('group === "all" || reportHasSourceGroup(unifiedReport, group)');
    expect(appSource).toContain('G1: "G1 基础成图"');
    expect(appSource).toContain('G2: "G2 技术安全"');
    expect(appSource).toContain('G3: "G3 功能使用"');
    expect(appSource).toContain('G4: "G4 客户需求"');
    expect(appSource).toContain("继续检查基础方案");
    expect(appSource).toContain("使用 Bellevue Demo 需求");
    expect(appSource).toContain("不检查客户需求");
    expect(appSource).toContain('className="evaluation-settings"');
    expect(appSource).toContain('open={!report}');
    expect(appSource).toContain('if (!node) return null');
    expect(appSource).toContain('className="developer-tools"');
    expect(appSource).toContain('className="floating-layer-panel"');
    expect(appSource).toContain("displayEvaluationMetric");
    expect(appSource).not.toContain('roomOrZone = finding.location.roomOrZoneIds.join');
    expect(s1PanelSource).toContain("动线效率");
    expect(s1PanelSource).toContain("动静分区");
    expect(s1PanelSource).toContain("空间利用");
    expect(s1PanelSource).toContain("开始评分");
    expect(s1PanelSource).toContain("评分中");
    expect(s1PanelSource).toContain("evaluation-spinner");
    expect(s1PanelSource).toContain("evaluation-run-progress");
    expect(s1PanelSource).toContain("if (!gate?.allowed && !report && !runState.running && !error) return null");
    expect(s1PanelSource).not.toContain("S1 PERFORMANCE");
    expect(s1PanelSource).toContain("住宅设计表现");
    expect(s1PanelSource).toContain("<S1Radar aggregate={aggregate} />");
    expect(appSource).toContain('className="s1-radar-axis-label"');
    expect(s1PanelSource).toContain('className="s1-axis-details"');
    expect(s1PanelSource).not.toContain("尚未纳入 S1 总分");
    expect(s1PanelSource).not.toContain("五轴基础权重均为 20%");
    expect(s1PanelSource).toContain("实际距离");
    expect(s1PanelSource).toContain("绕行程度");
    expect(s1PanelSource).toContain("路线得分");
    expect(s1PanelSource).not.toContain("公共动线穿越私密空间");
    expect(s1PanelSource).not.toContain("常用路径交汇与冲突");
    expect(s1PanelSource).not.toContain("家具使用空间测量");
    expect(appSource).toContain("measureS1HighFrequencyPaths(");
    expect(appSource).toContain("scoreS1HighFrequencyPaths(");
    expect(appSource).toContain("scoreS1ActivityZoning(");
    expect(appSource).toContain("scoreS1SpaceUtilization(");
    expect(appSource).not.toContain("measureS1FunctionalRelationships(");
    expect(appSource).toContain("S1PathOverlay");
  });

  it("keeps evaluation layers separate while exposing construction drawing layers", () => {
    expect(appSource).toContain('layerGroup("建筑图层"');
    expect(appSource).toContain('layerGroup("管线图层"');
    expect(appSource).toContain('constructionAnnotations: "点位名称与离地高度"');
    expect(appSource).toContain('pointPositionDimensions: "点位定位尺寸"');
    expect(appSource).toContain('aria-label="点位标注比例"');
    expect(appSource).not.toContain('<summary>开发信息</summary>');
    expect(appSource).toContain('boxes: next, centers: next, axes: next');
    expect(appSource).toContain("评价辅助图层");
    expect(appSource).toContain("显示400毫米基本通行范围");
    expect(appSource).toContain("400毫米单人基本通行范围");
    expect(appSource).not.toContain("已连接路径");
    expect(appSource).not.toContain("路径中断");
    expect(appSource).toContain('zones: "空间名称"');
    expect(appSource).toContain('slabs: "楼板"');
  });

  it("uses a compact designer visual system without changing report or radar data", () => {
    expect(appStyles).toContain("Designer workspace visual system");
    expect(appStyles).toContain("Visual pass 2: make the plan the primary working surface");
    expect(appStyles).toContain("grid-template-columns:312px minmax(0,1fr)");
    expect(evaluationStyles).toContain("Designer report visual system");
    expect(evaluationStyles).toContain(".s1-radar-result{fill:#1d8a8b36;stroke:#167d80");
    expect(evaluationStyles).toContain(".unified-finding.status-issue{background:#fff8f7");
    expect(evaluationStyles).toContain(".evaluation-group-tabs{display:flex");
    expect(evaluationStyles).toContain("Visual pass 3: make the next designer action obvious in report cards");
    expect(appSource).toContain('fill="#fdfbf6"');
    expect(appSource).toContain('closest("details")?.removeAttribute("open")');
    expect(appSource).toContain('viewBox: computeViewBox(nodes, focus.levelId!, visibility.dimensions)');
    expect(appSource).not.toContain('viewBox: focus.viewBox!');
  });

  it("presents the existing status counts in the v0.2 designer overview", () => {
    expect(appSource).toContain('className="floating-layer-panel"');
    expect(appSource).toContain('className="evaluation-overview"');
    expect(appSource).toContain('className="evaluation-donut"');
    expect(appSource).toContain("selectedCounts?.issue");
    expect(appSource).toContain("selectedCounts?.unable_to_determine");
    expect(appSource).toContain("selectedCounts?.pass");
    expect(appSource).toContain("selectedCounts?.not_applicable");
    expect(appSource).toContain("selectedStatusLabel.issue");
    expect(appSource).toContain("selectedStatusLabel.unable_to_determine");
    expect(appSource).toContain("selectedStatusLabel.pass");
    expect(appSource).toContain("selectedStatusLabel.not_applicable");
    expect(appSource).toContain("evaluationStatusLabel[finding.rawRuleResult.status]");
    expect(appStyles).toContain("UI v0.2: use the existing controls more efficiently without changing behavior");
    expect(evaluationStyles).toContain("UI v0.2: designer-facing report hierarchy, using only existing evaluation results");
    expect(appStyles).toContain("UI v0.3: one designer sidebar, a clear canvas, and on-demand layer controls.");
    expect(appSource).toContain('className="sidebar-resizer"');
  });
});
