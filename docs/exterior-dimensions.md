# Straight exterior dimensions

This feature is a read-only `derived-overlay-feature`. It does not create Pascal nodes, write JSON, or change Wall, Door, Window, Stair, Slab, Zone, Shelf, or Item geometry.

## Fixed upstream reference

Repository: `pascalorg/editor`  
Commit: `22c9472066398dae668b45e65c4785a56b3d0fb8`

| Upstream source | Upstream API/logic | Local equivalent |
| --- | --- | --- |
| `packages/core/src/registry/types.ts` | `FloorplanGeometry` `dimension`: start/end, outward `offsetNormal`, offset distance, extension overshoot, text | `DimensionSegment` and `ExteriorDimensions` |
| `packages/editor/src/components/editor-2d/renderers/floorplan-geometry-renderer.tsx` | Converts static floorplan primitives to SVG and deliberately routes interactive dimension primitives to the registry renderer | Local React SVG `ExteriorDimensions` overlay |
| `packages/nodes/src/shared/opening-placement-dimensions.ts` | `buildOpeningPlacementDimensions`; opening span is `position[0] ± width / 2` along the straight host Wall | Opening witness extraction in `buildExteriorDimensions` |
| `packages/nodes/src/wall/floorplan.ts` | `buildWallFloorplan`; straight-wall dimension line, extension lines, outward normal, upright label semantics | Ring-winding outward normal, `uprightDimensionAngle`, extension lines, split dimension line and ticks |

The local implementation intentionally derives the outward side from each union ring's winding rather than Pascal's selected-wall centroid heuristic. That is necessary for concave and disconnected exterior contours.

## Geometry pipeline

1. Select formal, valid physical Wall footprints for one Level.
2. Snap only derived union-input coordinates to `POSITION_TOLERANCE_M` (1 mm) to remove floating-point miter noise. Source footprints and nodes are never changed.
3. Union footprints with `polygon-clipping`.
4. Keep each Polygon's outer ring and count, but do not dimension, its inner rings.
5. Map union edges back to contributing Wall footprint edges and merge only contiguous collinear edges.
6. Reject runs contributed by curved Walls; never substitute a chord dimension.
7. Resolve Door and Window spans from their host Wall, wall-local `position[0]`, and schema `width`.
8. Project corners, wall junctions, and opening edges onto each straight run.
9. Generate the inner continuous chain and retain one mathematically traceable overall dimension per run.
10. For display, align envelope-facing horizontal/vertical chains by component side and replace their repeated run totals with one complete component width/height line on that side. Recessed concave runs and diagonal runs keep their local dimensions, so projection never changes their meaning.

Internal values remain metres. Labels use `Math.round(metres * 1000)` and have no suffix.

## Dependency

`polygon-clipping@0.15.7` is used only for Polygon/MultiPolygon wall-footprint union. Its license is MIT.

## Current opening limitation

Door and Window nodes provide the host Wall ID, wall-local center, width, and therefore reliable left/right physical opening spans required by dimensioning. The current plan renderer does not yet subtract Window openings, and its Door opening visualization is not a wall boolean cut. This does not change dimension values because the dimensions use Pascal opening data and the physical exterior Wall face, not rendered pixels. Invalid or off-run opening spans are excluded with diagnostics.

Curved exterior dimensions, interior dimensions, room clear dimensions, manual annotation movement, and JSON write-back are outside this feature.

The aligned two-tier presentation is intentionally separate from the measurement report: `buildExteriorDimensions` retains every run and value for audit and chain-sum checks, while `buildAlignedDimensionDisplay` only arranges those measurements for drawing. Component-frame overall values are derived from the exterior ring bounds; they never overwrite run values.
