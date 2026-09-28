import { describe, expect, it } from "vitest";
import { canToggleRouteOrthogonal, hvacEmptyCanvasRouteAction, routeModeAfterAxisButton, routeModeAfterShift, shouldHandleWorldAxisArrow } from "./routing-shortcuts";

describe("3D route keyboard shortcut eligibility", () => {
  it("toggles orthogonal mode for active standard, branch, HVAC duct and HVAC control routes", () => {
    for (const tool of ["draw", "branch", "hvac-duct", "hvac-supply", "hvac-return", "hvac-control"]) {
      expect(canToggleRouteOrthogonal(tool), tool).toBe(true);
    }
  });

  it("lets authors set orthogonal mode before starting a route but ignores unrelated tools", () => {
    expect(canToggleRouteOrthogonal("draw")).toBe(true);
    expect(canToggleRouteOrthogonal("branch")).toBe(true);
    expect(canToggleRouteOrthogonal("hvac-control")).toBe(true);
    expect(canToggleRouteOrthogonal("select")).toBe(false);
  });

  it("allows XYZ arrow locks before or during route authoring and Down always unlocks", () => {
    for (const key of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) {
      expect(shouldHandleWorldAxisArrow(key, true, "hvac-control"), key).toBe(true);
    }
    expect(shouldHandleWorldAxisArrow("ArrowLeft", false, "draw")).toBe(true);
    expect(shouldHandleWorldAxisArrow("ArrowLeft", false, "select")).toBe(false);
    expect(shouldHandleWorldAxisArrow("ArrowDown", false, "select")).toBe(true);
  });

  it("clears a world-axis lock and enables orthogonal mode when Shift is pressed", () => {
    expect(routeModeAfterShift(false, "x")).toEqual({ orthogonal: true, worldAxis: null });
    expect(routeModeAfterShift(true, null)).toEqual({ orthogonal: false, worldAxis: null });
  });

  it("keeps the HVAC panel's orthogonal and world-axis modes mutually exclusive", () => {
    expect(routeModeAfterAxisButton("x", null)).toEqual({ orthogonal: false, worldAxis: "x" });
    expect(routeModeAfterAxisButton("y", "x")).toEqual({ orthogonal: false, worldAxis: "y" });
    expect(routeModeAfterAxisButton("x", "x")).toEqual({ orthogonal: false, worldAxis: null });
    expect(routeModeAfterShift(false, "z")).toEqual({ orthogonal: true, worldAxis: null });
  });

  it("confirms blank-space clicks only for started HVAC drafts with an active world axis", () => {
    expect(hvacEmptyCanvasRouteAction("hvac-control", true, "y")).toBe("control-waypoint");
    expect(hvacEmptyCanvasRouteAction("hvac-supply", true, "x")).toBe("duct-point");
    expect(hvacEmptyCanvasRouteAction("hvac-return", true, "z")).toBe("duct-point");
    expect(hvacEmptyCanvasRouteAction("hvac-control", false, "x")).toBeNull();
    expect(hvacEmptyCanvasRouteAction("hvac-supply", false, "x")).toBeNull();
    expect(hvacEmptyCanvasRouteAction("hvac-control", true, null)).toBeNull();
    expect(hvacEmptyCanvasRouteAction("select", true, "x")).toBeNull();
  });
});
