# Parser × evaluator handoff

## Freeze scope

This document freezes the current parser and plan-geometry baseline for later integration with a layout evaluator. It does not define, implement, or imply any G1/G2/G3/G4/S1/S2 scoring rule.

The project is a read-only Pascal JSON floor-plan auditor. Its stable responsibilities are:

- accept a Pascal JSON document and preserve every recognized raw node;
- retain the original Pascal node ID as the application node ID;
- resolve parent ancestry and level membership where the hierarchy is valid;
- derive the 2D geometry already used by the demo: item transforms, Shelf footprints, physical wall footprints, slabs, Zones, stairs, openings, exterior dimensions, and measurement snap segments;
- report malformed or unsupported input through diagnostics rather than fabricating geometry.

## Commands and input

| Purpose | Command / entry point |
|---|---|
| Start locally | `npm run dev` |
| Production build | `npm run build` |
| Run tests | `npm test` |
| Raw parser entry | `src/parser/parse.ts` → `parseProject(raw)` |
| Default representative Pascal input | `sample-data/Bellevue demo.json` |
| Browser import | top-bar **导入 JSON** control in `src/main.tsx` |
| Evaluator-facing handoff projection | `src/parser/evaluation-handoff.ts` → `buildEvaluationHandoff(parsed)` |

`parseProject` takes a parsed JSON value, not a filename. The UI reads an imported file as text, calls `JSON.parse`, then calls `parseProject`.

## Key code and responsibilities

| Path | Responsibility |
|---|---|
| `src/parser/schema.ts` | Permissive Zod envelope validation: top-level `nodes`, node `id`/`type`, and passthrough of all Pascal fields. |
| `src/parser/parse.ts` | Non-destructive conversion from raw Pascal JSON to `Parsed`. |
| `src/types.ts` | Current runtime definitions: `NodeData`, `Parsed`, diagnostics, transform and matrix types. |
| `src/parser/evaluation-handoff.ts` | Additive handoff projection for future evaluators; does not alter parser nodes. |
| `src/geometry/transform.ts` | Ancestor-level resolution, item/world transforms, opening placement, dimensions, viewer pan/zoom math. |
| `src/geometry/walls/` | Wall physical thickness, straight/curved footprints, miters, validation, and reports. |
| `src/geometry/zone.ts` | Zone polygon conversion, label point and stable color. |
| `src/geometry/slab.ts` | Slab polygon/hole paths and areas. |
| `src/geometry/stairs.ts`, `src/geometry/spiral-stair.ts` | Straight, curved and spiral stair plan geometry. |
| `src/geometry/shelf.ts` | Shelf schema defaults, transform and footprint/divider derivation. |
| `src/diagnostics/check.ts` | Input-level diagnostics. |
| `src/coverage/` | Runtime coverage audit and rendered-node registry; useful for support diagnostics, not scoring. |

## Current parser result

`parseProject` returns this actual top-level structure:

```ts
type Parsed = {
  nodes: Record<string, NodeData>;
  raw: unknown;
  diagnostics: Diagnostic[];
};
```

`NodeData` is intentionally passthrough-shaped. Every recognized node contains its dictionary key as `node.id`; all source fields remain available on the same object. This is the fidelity-preserving parser contract.

For evaluator integration, use the additive `buildEvaluationHandoff(parsed)` projection instead of replacing `Parsed`. Its machine-readable definition is [parser-normalized-plan.schema.json](parser-normalized-plan.schema.json), and a representative fixture is [sample-normalized-plan.json](../fixtures/evaluation/sample-normalized-plan.json).

The handoff top level is:

```text
schemaVersion, source, units,
levels, zones, spaces, slabs, ceilings,
walls, doors, windows,
items, furniture, equipment, columns, shelves, stairs, shafts,
relationships, unclassifiedNodes, diagnostics
```

Every emitted entity has both `id` and `rawPascalId`; currently they are identical and equal the original Pascal node key. Do not replace these with names.

## Object fields emitted today

| Object | Current handoff fields |
|---|---|
| Level | ID, raw Pascal ID, name, ordinal (`level`), parent, visibility. |
| Zone | Base fields, controlled `spaceFunctionCode` and resolved display name, color, closed outline in `[x,z]`, signed-area magnitude in m². |
| Space | Derived one-to-one from a Zone, with `sourceZoneId` and `source: "derived-from-zone"`; Pascal has no independently parsed `space` node in this demo. |
| Wall | Start/end centerline, physical thickness or 0.1 m Pascal default, height, curve offset, front/back side metadata, level, and additive footprint validation status/codes/area for evaluator safety. |
| Door | Host wall, raw wall-local position, resolved world point/tangent when resolvable, width/height, side, opening and frame fields, type, hinge/swing/slide/track/panel metadata. |
| Window | Same host/placement/dimension information as Door plus window type, awning, casement and sill fields. |
| Item | Canonical projection of every Pascal `item`: asset metadata, authoritative `functionTags`, final dimensions (`asset.dimensions × item.scale`), explicit opening directions/depth/use clearance, raw and resolved transform, vertical range and floor-plan URL. Evaluation semantics should read this collection. |
| Furniture | Compatibility view of Item whose category is neither structural column nor an appliance category. Category does not determine product use. |
| Equipment | Compatibility view of Item with a legacy appliance category. Category does not determine product use. |
| Column | Pascal `item` whose `asset.category === "columns"`. Some assets may be mislabeled upstream, so retain the original item/asset data for review. |
| Shelf | Style, physical dimensions, row/column count, child item IDs, `functionTags`, scale, explicit operation metadata, raw/resolved transform and vertical range. |
| Stair | Stair type, source/destination level IDs, width, rise, step count, spiral radius/sweep when present. |
| Shaft | Raw `shaft` nodes only when present, plus polygon and height where supplied. The current reference sample has none. |
| Other nodes | Preserved under `Parsed.nodes`; reported as `unclassifiedNodes` in the handoff rather than silently discarded. |

## Units, coordinates, contours, and identity

- **Length:** meters in source and handoff. UI formatting can use mm or ft/in but does not change source geometry.
- **Area:** square meters in geometry/handoff; UI can display square feet.
- **Angles:** radians in Pascal and handoff. UI-only labels may show degrees.
- **Plan coordinates:** Pascal Level-plane `[x,z]` pairs. SVG currently uses `[x,z] → [x,y]` with no world scale, mirror, or axis swap.
- **Default viewer orientation:** clockwise 90° for the current data set. This is a view transform, not a mutation of the parsed world coordinates.
- **Contours:** Zone and Slab outlines are source polygons in Level-plane coordinates. Slab holes are retained. A Space contour is only available where a Zone exists.
- **Level ownership:** `resolveAncestorLevelId` follows `parentId` upward and detects missing parents/cycles. Evaluators should treat missing level IDs as unresolved, not as Level 0.

## Relationships currently computed

The handoff exports only relationships supported by present parser/geometry evidence:

- `parentChild`: direct `parentId` edges.
- `levelMembership`: resolved ancestor level for nodes with a valid chain.
- `hostedOpenings`: Door/Window → host Wall edges from `wallId` or parent linkage.
- `wallConnections`: wall endpoints coincident within `1e-6 m`.
- Zone-derived Space ownership: `space.sourceZoneId`.

The demo does **not** currently calculate a general room graph, robust contains/intersects/adjacent/distance relations, egress connectivity, door passability, or space-to-furniture assignment. Those must be added by the evaluator layer with explicit tolerances and confidence handling.

## Important limits and assumptions

1. `parseProject` validates the Pascal envelope and node identity but deliberately does not fully validate every Pascal kind/variant. Unknown fields are preserved.
2. Doors and Windows are resolved against a straight host-wall tangent in `resolveWallOpeningTransform`; curved-wall opening placement is not reliable enough for evaluation use.
3. Wall footprints support straight and curved walls with miter logic, but invalid/self-intersecting/outlier footprints remain diagnostics. The current reference contains invalid walls; do not assume every source Wall is an evaluable boundary.
4. Zone polygons are authoring regions, not a guaranteed architectural room partition. They can overlap, omit rooms, or fail to match walls/slabs.
5. `Space` is a Zone-derived convenience projection only. There is no reliable parser output for independent Pascal spaces, adjacency, enclosed-room detection, or occupancy.
6. `items` is the canonical evaluator collection. `functionTags` is the authoritative use taxonomy for Item/Shelf; asset name, display name, style, tags and legacy category remain trace/debug evidence and must not create product-use semantics. Furniture/equipment/column are compatibility category views only.
7. Item placement resolves Level, nested item, Shelf and wall-side ancestry already used by rendering. Unsupported parent chains, missing parents, and cycles return an error status rather than invented coordinates.
8. Viewer rotation, image cropping, labels, measurements, and exterior dimensions are presentation/derived layers. They must not be mistaken for source geometry.

## Recommended evaluator entry point

Use this sequence:

```ts
const parsed = parseProject(rawPascalJson);
const handoff = buildEvaluationHandoff(parsed);

if (parsed.diagnostics.some((item) => item.severity === "error")) {
  // keep the result inspectable, but lower evaluator confidence or stop by policy
}
```

Then evaluate only entities whose geometry/transform status is explicit and valid. Preserve `rawPascalId` in every evaluator finding so results can be traced back to the imported JSON and to the UI inspector.

Do not use renderer visibility or pixel bounds as architectural evidence. Use the raw/derived Level-plane data in the handoff projection.
