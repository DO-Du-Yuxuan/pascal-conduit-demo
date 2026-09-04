# Furniture floorPlan image alpha crop

This runtime-only feature removes transparent raster margins from `item.asset.floorPlanUrl` display without modifying the source PNG, Pascal JSON, Item transform, physical dimensions, center, rotation, local +Z, or orange footprint.

## Pipeline

1. Load the image with `HTMLImageElement` and anonymous CORS mode.
2. Draw it at natural pixel dimensions to an offscreen canvas.
3. Scan alpha values with the centralized `ALPHA_THRESHOLD = 16`.
4. Compute the inclusive minimum bounding box of pixels whose alpha is at least the threshold.
5. Compute `scaleX = targetWidth / cropWidth` and `scaleY = targetDepth / cropHeight` independently.
6. Map the crop bbox directly to the unchanged physical footprint with zero offset, so its left/right/top/bottom alpha extrema touch the four physical-frame edges.
7. Render through a nested SVG whose `viewBox` is the source pixel crop and whose aspect mapping is `none`.

This four-edge mode intentionally allows aspect-ratio deformation when the cropped PNG and physical footprint do not match. It guarantees that at least one threshold-valid pixel reaches each side of the physical footprint; it does not imply that an irregular silhouette fills all four corners.

## Cache and fallback

The cache key is `<floorPlanUrl>|alpha:16`. Pending requests are also cached, so concurrent Items sharing one URL perform one alpha scan.

The old whole-image rendering is retained when:

- the image cannot load;
- browser canvas APIs are unavailable;
- CORS or another security rule prevents `getImageData`;
- pixel data is invalid;
- no pixel reaches the alpha threshold.

The last condition emits `floorplan_image_empty_alpha`; other read failures emit `floorplan_image_crop_unavailable`. A successful crop whose content/physical aspect ratio difference exceeds 5% emits the non-blocking `floorplan_image_aspect_mismatch` diagnostic.

The Item inspector exposes natural dimensions, crop bbox, threshold, fallback reason, both aspect ratios, mismatch percentage, final draw dimensions, offsets, `scaleX`, `scaleY`, whether scaling happened to remain uniform, and whether four-edge fitting was applied.

## Global display units

The existing global unit selector now controls automatic dimensions, manual dimensions, Item and Shelf inspector lengths, canvas extent labels, and displayed Slab areas. Metric length is rounded to 1 mm and metric area uses m². Imperial length uses feet–inches rounded to 1/16 inch and area uses ft². All internal geometry remains metres and square metres.
