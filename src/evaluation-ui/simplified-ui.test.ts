// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
const appStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("active workspace UI", () => {
  it("keeps legacy evaluation UI and Bellevue requirements out of the application", () => {
    expect(appSource).not.toContain("./evaluation.css");
    expect(appSource).not.toContain("Bellevue requirements demo.json");
    expect(appSource).not.toContain("function EvaluationPanel(");
    expect(appSource).not.toContain("function S1Panel(");
    expect(appSource).not.toContain("runFoundationEvaluation");
    expect(appSource).not.toContain("buildEvaluationHandoff");
    expect(appSource).not.toContain("EvaluationHighlight");
  });

  it("keeps architectural and construction drawing layer controls", () => {
    expect(appSource).toContain('layerGroup("建筑图层"');
    expect(appSource).toContain('layerGroup("施工图层"');
    expect(appSource).toContain('conduitReceptacle: "插座施工图"');
    expect(appSource).toContain('conduitLighting: "灯位接线盒施工图"');
    expect(appSource).toContain('conduitNetwork: "弱电施工图"');
    expect(appSource).toContain('conduitSprinkler: "消防施工图"');
    expect(appSource).toContain('aria-label="全部施工图"');
    expect(appSource).toContain('conduits: "管道"');
    expect(appSource).toContain('aria-label="点位标注比例"');
    expect(appSource).toContain('zones: "空间名称"');
    expect(appSource).toContain('slabs: "楼板"');
  });

  it("keeps the plan as the primary workspace surface", () => {
    expect(appStyles).toContain("Designer workspace visual system");
    expect(appStyles).toContain("Visual pass 2: make the plan the primary working surface");
    expect(appStyles).toContain("grid-template-columns:312px minmax(0,1fr)");
    expect(appStyles).toContain("UI v0.3: one designer sidebar, a clear canvas, and on-demand layer controls.");
  });
});
