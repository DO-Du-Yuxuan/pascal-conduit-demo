import { describe, expect, it } from "vitest";
import { clampSplitRatio, visibleTwoDCanvasIds } from "./workspace-layout";

describe("2D and 3D workspace layout", () => {
  it("clamps the draggable divider to 25-75 percent", () => {
    expect(clampSplitRatio(10)).toBe(25);
    expect(clampSplitRatio(45)).toBe(45);
    expect(clampSplitRatio(90)).toBe(75);
  });

  it("shows only the first 2D canvas in split mode", () => {
    expect(visibleTwoDCanvasIds([1, 2, 3], "split")).toEqual([1]);
    expect(visibleTwoDCanvasIds([1, 2, 3], "2d")).toEqual([1, 2, 3]);
  });
});
