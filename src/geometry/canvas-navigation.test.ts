import { describe, expect, it } from "vitest";
import { canvasWheelGesture, canvasWheelPanDelta, canvasWheelZoomFactor, TRACKPAD_PINCH_ZOOM_SENSITIVITY, zoomCanvasViewBox } from "./canvas-navigation";

describe("canvas navigation input", () => {
  it("always uses vertical wheel motion for zoom, including small high-resolution mouse deltas", () => {
    expect(canvasWheelGesture({ deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false })).toBe("zoom");
    expect(canvasWheelGesture({ deltaX: 2, deltaY: 8, deltaMode: 0, ctrlKey: false })).toBe("zoom");
    expect(canvasWheelGesture({ deltaX: 0, deltaY: 2, deltaMode: 0, ctrlKey: true })).toBe("zoom");
    expect(canvasWheelGesture({ deltaX: 8, deltaY: 0, deltaMode: 0, ctrlKey: false })).toBe("pan");
  });

  it("scales smoothly and anchors the zoom at the pointer location", () => {
    const view = { minX: 0, minZ: 0, width: 20, height: 10 }, factor = canvasWheelZoomFactor(-100, 0, 800), zoomed = zoomCanvasViewBox(view, { x: 5, z: 5 }, factor);
    expect(factor).toBeLessThan(1);
    expect(zoomed.width).toBeLessThan(view.width);
    expect((5 - zoomed.minX) / zoomed.width).toBeCloseTo(.25);
    expect((5 - zoomed.minZ) / zoomed.height).toBeCloseTo(.5);
  });

  it("converts trackpad pan deltas to rotated world coordinates at the current canvas scale", () => {
    const view = { minX: 0, minZ: 0, width: 20, height: 10 };
    const horizontal = canvasWheelPanDelta(40, 0, 0, 400, 200, view, 0);
    expect(horizontal.x).toBeCloseTo(-2);
    expect(horizontal.z).toBeCloseTo(0);
    const rotated = canvasWheelPanDelta(40, 0, 0, 400, 200, view, 90);
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.z).toBeCloseTo(2);
  });

  it("uses a stronger response for trackpad pinch zoom than a physical mouse wheel", () => {
    const mouse = canvasWheelZoomFactor(-20, 0, 800), pinch = canvasWheelZoomFactor(-20, 0, 800, TRACKPAD_PINCH_ZOOM_SENSITIVITY);
    expect(pinch).toBeLessThan(mouse);
  });

  it("prevents invalidly tiny or huge view boxes", () => {
    expect(zoomCanvasViewBox({ minX: 0, minZ: 0, width: 1, height: 1 }, { x: .5, z: .5 }, .000001).width).toBeCloseTo(.25);
    expect(zoomCanvasViewBox({ minX: 0, minZ: 0, width: 1, height: 1 }, { x: .5, z: .5 }, 100000).width).toBeCloseTo(1000);
  });
});
