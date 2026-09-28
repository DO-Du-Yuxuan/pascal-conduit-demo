import { describe, expect, it } from "vitest";
import { applyViewPresetRequest, DEFAULT_3D_LAYERS, viewStateForPreset } from "./view-state";

const state = () => ({ preset: "top" as const, layers: { ...DEFAULT_3D_LAYERS }, levelMode: "exploded" as const, wallMode: "translucent" as const, walkthrough: true });

describe("3D view presentation presets", () => {
  it("reapplies repeated camera preset commands even when the preset value is unchanged", () => {
    const first = applyViewPresetRequest({ preset: "exterior", commandId: -1, revision: 0 }, 10, "top");
    const repeated = applyViewPresetRequest(first, 11, "top");

    expect(first).toEqual({ preset: "top", commandId: 10, revision: 1 });
    expect(repeated).toEqual({ preset: "top", commandId: 11, revision: 2 });
    expect(applyViewPresetRequest(repeated, 11, "top")).toBe(repeated);
  });

  it("resets the exterior preset to a fully visible stacked scene", () => {
    expect(viewStateForPreset(state(), "exterior")).toMatchObject({ preset: "exterior", levelMode: "stacked", wallMode: "up", walkthrough: false, layers: DEFAULT_3D_LAYERS });
  });

  it("uses display-only cutaway states for interior and ceiling views", () => {
    expect(viewStateForPreset(state(), "interior")).toMatchObject({ levelMode: "solo", wallMode: "cutaway", layers: { roofs: false, ceilings: false } });
    expect(viewStateForPreset(state(), "ceiling")).toMatchObject({ levelMode: "solo", wallMode: "cutaway", layers: { roofs: false, ceilings: true } });
  });

  it("keeps the floor surface visible for the floor view", () => {
    expect(viewStateForPreset(state(), "floor")).toMatchObject({ wallMode: "up", layers: { floors: true, roofs: false, ceilings: false } });
  });
});
