import { describe, expect, it } from "vitest";
import { compassArrowRotation } from "./transform";

describe("canvas compass", () => {
  it("rotates in the same direction as the plan relative to its north-up baseline", () => {
    expect(compassArrowRotation(90, 90)).toBe(0);
    expect(compassArrowRotation(180, 90)).toBe(90);
    expect(compassArrowRotation(0, 90)).toBe(-90);
  });
});
