import { Color } from "three";

/** Matches dsphere selection-manager and wall-materials selection profiles. */
export function selectionAppearance(baseColor: string, selected: boolean, opacity?: number) {
  const tint = new Color("#818cf8");
  return {
    color: selected ? new Color(baseColor).lerp(tint, .32) : baseColor,
    emissive: selected ? new Color("#000000").lerp(tint, .7) : "#000000",
    emissiveIntensity: selected ? .42 : 0,
    ...(opacity === undefined ? {} : { opacity: selected && opacity < 1 ? Math.min(1, opacity + .08) : opacity }),
  };
}
