// @ts-expect-error -- Vitest executes this Node-only source read outside the browser bundle.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { editingAxesDisplayRotation } from "./BuilderAxisIndicator";

const component = readFileSync(new URL("./BuilderAxisIndicator.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./ThreeDWorkspace.tsx", import.meta.url), "utf8");

describe("Builder XYZ direction indicator", () => {
  it("shows editing X after Building rotation rather than the viewer's unrotated X", () => {
    const display = new Matrix4().compose(new Vector3(12, 4, -7), new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)), new Vector3(1, 1, 1));
    const x = new Vector3(1, 0, 0).applyQuaternion(editingAxesDisplayRotation(display));
    expect(x.x).toBeCloseTo(0);
    expect(x.y).toBeCloseTo(0);
    expect(x.z).toBeCloseTo(-1);
  });

  it("ignores translation and scale and preserves all three orthogonal editing axes", () => {
    const rotation = new Quaternion().setFromEuler(new Euler(.2, .5, -.1));
    const displayed = editingAxesDisplayRotation(new Matrix4().compose(new Vector3(20, 100, -10), rotation, new Vector3(2, 3, 4)));
    for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const) {
      expect(new Vector3(...axis).applyQuaternion(displayed).distanceTo(new Vector3(...axis).applyQuaternion(rotation))).toBeLessThan(1e-10);
    }
  });

  it("keeps the passive HUD above the existing ink pass and outside transformed scene geometry", () => {
    expect(component).toContain('alignment="bottom-left"');
    expect(component).toContain('renderPriority={2}');
    expect(component).toContain('<GizmoViewport disabled');
    expect(component).not.toContain('onClick=');
    expect(workspace.indexOf('<BuilderAxisIndicator')).toBeGreaterThan(workspace.indexOf('<BuilderInk />'));
    expect(workspace).toContain('<BuilderAxisIndicator displayMatrix={displayTransform.displayMatrix} />');
  });
});
