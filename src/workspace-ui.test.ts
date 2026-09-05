// @ts-nocheck -- Vitest runs this Node-only source contract outside the browser bundle.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
const threeDSource = readFileSync(resolve(process.cwd(), "src/three/ThreeDWorkspace.tsx"), "utf8");
const pascalSceneSource = readFileSync(resolve(process.cwd(), "src/three/PascalScenePreview.tsx"), "utf8");
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

  it("does not turn drawing clicks into global scene selections in split view", () => {
    expect(threeDSource).toContain('if (tool === "select") onSelect(id)');
    expect(threeDSource).toContain("onPointerMissed={() => selectWhileBrowsing(null)}");
    expect(threeDSource).toContain("onSelect={selectWhileBrowsing}");
    expect(styles).toContain("contain:layout paint");
  });

  it("keeps Canvas camera and controls configuration stable across drawing renders", () => {
    expect(threeDSource).toContain("camera={projection === \"orthographic\" ? ORTHOGRAPHIC_CAMERA : PERSPECTIVE_CAMERA}");
    expect(threeDSource).toContain("dpr={CANVAS_DPR}");
    expect(threeDSource).toContain("gl={CANVAS_GL}");
    expect(threeDSource).toContain("mouseButtons={CONTROL_MOUSE_BUTTONS}");
    expect(threeDSource).toContain("colliderMeshes={NO_CAMERA_COLLIDERS}");
    expect(threeDSource).toContain("GROUND_CAMERA_CLEARANCE");
    expect(threeDSource).toContain("boundaryEnclosesCamera");
    expect(threeDSource).toContain("boundaryFriction={.12}");
    expect(threeDSource).toContain("minDistance={Math.max(.12, bounds.span * .01)}");
  });

  it("does not render a height-changing 3D workspace footer", () => {
    expect(threeDSource).not.toContain('<footer className="three-d-status">');
    expect(styles).not.toContain(".three-d-status");
  });

  it("reports wall and slab shallow-cut fallback in the left editor panel", () => {
    expect(pascalSceneSource).toContain("subtractHorizontalChases");
    expect(pascalSceneSource).toContain("subtractWallChases");
    expect(threeDSource).toContain("onChaseFallback={reportChaseFallback}");
    expect(threeDSource).toContain("宿主浅槽切割失败");
  });
});
