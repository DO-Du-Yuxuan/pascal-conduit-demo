import { describe, expect, it } from "vitest";
import { clampSplitRatio } from "./workspace-layout";

describe("2D and 3D workspace layout", () => {
  it("clamps the draggable divider to 25-75 percent", () => {
    expect(clampSplitRatio(10)).toBe(25);
    expect(clampSplitRatio(45)).toBe(45);
    expect(clampSplitRatio(90)).toBe(75);
  });
});
