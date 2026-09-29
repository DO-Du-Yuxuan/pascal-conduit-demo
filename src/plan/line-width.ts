/** Converts a saved conduit diameter into model-space width plus a screen-readable floor. */
export function planConduitStrokeWidth(diameterMm: number, scale: number, minimumScreenWidthPx = 1.8): number {
  const diameterMeters = Number.isFinite(diameterMm) ? Math.max(0, diameterMm) / 1000 : 0;
  const pixelsPerMeter = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return Math.max(diameterMeters, Math.max(0, minimumScreenWidthPx) / pixelsPerMeter);
}

/** Keeps a small colored outline around a white core without inflating the physical pipe envelope. */
export function planOutlinedConduitStrokeWidths(diameterMm: number, scale: number, minimumOuterScreenWidthPx = 1.8, outlineScreenWidthPx = .8, minimumCoreScreenWidthPx = .5) {
  const pixelsPerMeter = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const outerWidth = planConduitStrokeWidth(diameterMm, pixelsPerMeter, minimumOuterScreenWidthPx);
  const innerWidth = Math.min(outerWidth, Math.max(Math.max(0, minimumCoreScreenWidthPx) / pixelsPerMeter, outerWidth - Math.max(0, outlineScreenWidthPx) / pixelsPerMeter));
  return { outerWidth, innerWidth };
}
