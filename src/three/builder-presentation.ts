/** Visual defaults sampled from Builder's viewer scene themes and material roles.
 * These are presentation only: they never rewrite Project JSON dimensions or
 * material fields. The demo uses the Studio theme unless a caller opts in.
 */
export type BuilderPresentationId = "studio";

export type BuilderPresentation = {
  id: BuilderPresentationId;
  background: string;
  ground: string;
  colors: {
    wall: string;
    floor: string;
    ceiling: string;
    roof: string;
    joinery: string;
    glazing: string;
    furnishing: string;
    beam: string;
    ink: string;
  };
  glazingOpacity: number;
  lighting: {
    ambient: { color: string; intensity: number };
    hemisphere: { sky: string; ground: string; intensity: number };
    key: { color: string; position: [number, number, number]; intensity: number };
    fill: { color: string; position: [number, number, number]; intensity: number };
  };
  toneMappingExposure: number;
  edge: { thresholdAngle: number; opacity: number; radiusPx: number };
};

const STUDIO: BuilderPresentation = {
  id: "studio",
  background: "#ffffff",
  ground: "#f4f4f2",
  colors: {
    wall: "#e9e5db",
    floor: "#d8d2c4",
    ceiling: "#f1ede4",
    roof: "#c4bba6",
    joinery: "#c4bba6",
    glazing: "#cdd8df",
    furnishing: "#d2ccbe",
    beam: "#e9e5db",
    ink: "#1a1d24",
  },
  glazingOpacity: 0.25,
  lighting: {
    ambient: { color: "#ffffff", intensity: 0.15 },
    hemisphere: { sky: "#ffffff", ground: "#aaa49a", intensity: 0.6 },
    key: { color: "#ffffff", position: [10, 10, 10], intensity: 4 },
    fill: { color: "#ffffff", position: [-10, 10, -10], intensity: 0.75 },
  },
  toneMappingExposure: 0.9,
  // Builder's post pass detects screen-space depth and normal discontinuities.
  // The screen-space ink pass consumes these values; geometry overlays are not used.
  edge: { thresholdAngle: 20, opacity: 0.5, radiusPx: 1 },
};

export function getBuilderPresentation(_id: BuilderPresentationId = "studio"): BuilderPresentation {
  return STUDIO;
}

/** Renderer settings for the main R3F Canvas; Canvas consumers can spread them. */
export const BUILDER_CANVAS_PRESENTATION = {
  gl: { antialias: true, powerPreference: "high-performance" as const },
  dpr: [1, 1.25] as [number, number],
  shadows: true,
  shadowMap: "PCFShadowMap" as const,
  toneMapping: "ACESFilmicToneMapping" as const,
};

/** Keep any positive source dimension at its saved value; reject only geometry
 * that cannot be drawn. The supplied fallback applies only when the field is
 * absent or invalid, never as a minimum-size inflation.
 */
export function sourceDimension(value: unknown, fallback: number): number | null {
  const resolved = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return resolved > 0 ? resolved : null;
}
