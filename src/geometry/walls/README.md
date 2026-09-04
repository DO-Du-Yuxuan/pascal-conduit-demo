# Experimental Pascal wall geometry

This module is intentionally isolated from furniture, openings, stairs, zones,
canvas transforms, import, and auto-fit code. The UI consumes it only when the
`精确墙体（实验）` visibility flag is enabled; the default wall rendering remains
the prior line renderer.

The implementation is a TypeScript adaptation of the Pascal Editor source at
commit `22c9472066398dae668b45e65c4785a56b3d0fb8`:

- `thickness.ts`: `DEFAULT_WALL_THICKNESS` and wall thickness resolution.
- `curve.ts`: `normalizeWallCurveOffset`, curve frames and surface polygon.
- `miter.ts`: endpoint grouping, T-junction passthrough, angular ordering and
  miter intersection limits.
- `footprint.ts`: straight footprints and the Editor's end-left/end-right
  boundary swap; curved footprints use 24 surface segments.

`validation.ts` adds local defensive diagnostics. It neither changes source
wall data nor silently falls back to an alternate shape. Invalid experimental
walls are rendered in red by the caller and expose their codes for inspection.
