import type { ThreeDLayerVisibility } from "./ThreeDWorkspace";

export type ThreeDViewPreset = "exterior" | "interior" | "floor" | "ceiling" | "top" | "front" | "back" | "left" | "right" | "isometric";
export type ThreeDLevelMode = "stacked" | "exploded" | "solo";
export type ThreeDWallMode = "up" | "cutaway" | "down" | "translucent";

export const DEFAULT_3D_LAYERS: ThreeDLayerVisibility = {
  walls: true, floors: true, ceilings: false, roofs: false, openings: false, furniture: false, zones: false,
};

export type ThreeDViewState = Pick<
  { preset: ThreeDViewPreset; layers: ThreeDLayerVisibility; levelMode: ThreeDLevelMode; wallMode: ThreeDWallMode; walkthrough: boolean },
  "preset" | "layers" | "levelMode" | "wallMode" | "walkthrough"
>;

/** View presets only affect temporary presentation state, never JSON or evaluation data. */
export function viewStateForPreset(current: ThreeDViewState, preset: Extract<ThreeDViewPreset, "exterior" | "interior" | "floor" | "ceiling">): ThreeDViewState {
  if (preset === "exterior") return { ...current, preset, layers: { ...DEFAULT_3D_LAYERS }, wallMode: "up", levelMode: "stacked", walkthrough: false };
  if (preset === "interior") return { ...current, preset, layers: { ...current.layers, roofs: false, ceilings: false, walls: true }, wallMode: "cutaway", levelMode: "solo", walkthrough: false };
  if (preset === "floor") return { ...current, preset, layers: { ...current.layers, roofs: false, ceilings: false, floors: true }, wallMode: "up", walkthrough: false };
  return { ...current, preset, layers: { ...current.layers, roofs: false, ceilings: true, walls: true }, wallMode: "cutaway", levelMode: "solo", walkthrough: false };
}
