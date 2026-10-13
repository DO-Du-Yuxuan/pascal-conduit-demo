import { describe, expect, it } from "vitest";
import { BUILDER_CANVAS_PRESENTATION, getBuilderPresentation, sourceDimension } from "./builder-presentation";

describe("Builder Studio presentation contract", () => {
  it("exposes the Studio canvas, palette, lighting, exposure and soft edge defaults", () => {
    const studio = getBuilderPresentation();
    expect(studio).toMatchObject({
      background: "#ffffff",
      ground: "#f4f4f2",
      colors: {
        wall: "#e9e5db",
        floor: "#d8d2c4",
        ceiling: "#f1ede4",
        roof: "#c4bba6",
        glazing: "#cdd8df",
        ink: "#1a1d24",
      },
      glazingOpacity: 0.25,
      lighting: {
        ambient: { intensity: 0.15 },
        hemisphere: { intensity: 0.6 },
        key: { position: [10, 10, 10], intensity: 4 },
        fill: { position: [-10, 10, -10], intensity: 0.75 },
      },
      toneMappingExposure: 0.9,
      edge: { thresholdAngle: 20, opacity: 0.5, radiusPx: 1 },
    });
    expect(BUILDER_CANVAS_PRESENTATION).toEqual({
      gl: { antialias: true, powerPreference: "high-performance" },
      dpr: [1, 1.25],
      shadows: true,
      shadowMap: "PCFShadowMap",
      toneMapping: "ACESFilmicToneMapping",
    });
  });

  it("keeps valid source dimensions unchanged and rejects only non-drawable sizes", () => {
    expect(sourceDimension(0.012, 0.1)).toBe(0.012);
    expect(sourceDimension(0, 0.1)).toBeNull();
    expect(sourceDimension(-0.1, 0.1)).toBeNull();
    expect(sourceDimension(undefined, 0.08)).toBe(0.08);
  });
});
