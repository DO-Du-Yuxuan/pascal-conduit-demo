// @ts-nocheck -- Vitest runs this Node-only source contract outside the browser bundle.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("conduit workspace UI contract", () => {
  it("keeps separate 2D, split and 3D view controls", () => {
    expect(source).toContain("2D 平面");
    expect(source).toContain("2D + 3D");
    expect(source).toContain("3D 查看");
  });

  it("provides a collapsible 2D overlay panel and an accessible divider", () => {
    expect(source).toContain("two-d-floating-panel");
    expect(source).toContain("调整 2D 与 3D 视图宽度");
    expect(styles).toContain("--split-ratio");
    expect(styles).toContain(".workspace-split-divider");
  });

  it("renders the transient 3D route preview in the 2D plan overlay", () => {
    expect(source).toContain("state.preview");
    expect(source).toContain("conduit-plan-preview");
    expect(source).toContain("preview.plan.segments.map");
  });
});
