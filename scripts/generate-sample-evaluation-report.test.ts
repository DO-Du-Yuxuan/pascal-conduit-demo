import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateG1Foundation } from "../src/evaluation/evaluate";
import type { EvaluationHandoff } from "../src/parser/evaluation-handoff";

describe.skipIf(process.env.GENERATE_SAMPLE_REPORT !== "1")("sample evaluation report generator", () => {
  it("writes a reproducible report from the normalized handoff fixture", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const input = resolve(root, "fixtures/evaluation/sample-normalized-plan.json");
    const output = resolve(root, "fixtures/evaluation/sample-g1-report.json");
    const handoff = JSON.parse(readFileSync(input, "utf8")) as EvaluationHandoff;
    const report = evaluateG1Foundation(handoff, "2026-07-20T00:00:00.000Z");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    expect(report.rules.length).toBeGreaterThan(0);
    expect(readFileSync(output, "utf8")).toContain('"pascalSourceIds"');
  });
});

