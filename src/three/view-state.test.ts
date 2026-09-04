import { describe, expect, it } from "vitest";
import { DEFAULT_3D_LAYERS, viewStateForPreset } from "./view-state";

const state = () => ({ preset: "top" as const, layers: { ...DEFAULT_3D_LAYERS }, levelMode: "exploded" as const, wallMode: "translucent" as const, walkthrough: true });

describe("3D view presentation presets", () => {
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
