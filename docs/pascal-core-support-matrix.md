# Pascal Core support matrix

Upstream truth is pinned to `pascalorg/editor` commit `22c9472066398dae668b45e65c4785a56b3d0fb8`. The authoritative union and plugin lists reviewed were `packages/core/src/schema/types.ts`, `packages/core/src/schema/index.ts`, and `packages/nodes/src/index.ts`. Each row was also checked against its Schema and NodeDefinition; `FP` means a `packages/nodes/src/<kind>/floorplan.ts` exists at that commit. The machine-readable source is `src/coverage/pascalCoreManifest.ts` plus `src/coverage/currentDemoMatrix.ts`.

Status columns: `P` parse recognition, `R` raw preservation, `T` transform, `F` floorplan, `I` inspector, `D` diagnostics, `X` tests. `partial` is deliberate: this Demo uses a permissive passthrough parser rather than the upstream discriminated Zod union.

| Kind | Upstream Schema / Definition | Important variants or enums | Expected strategy | P | R | T | F | I/D/X | Current gap |
|---|---|---|---|---|---|---|---|---|---|
| site | `schema/nodes/site.ts` / `site/definition.ts` | surface polygon, terrain | container | partial | complete | n/a | intentionally hidden | partial/partial/none | none for plan container |
| building | `schema/nodes/building.ts` / `building/definition.ts` | — | container | partial | complete | n/a | intentionally hidden | partial/partial/none | none for plan container |
| elevator | `schema/nodes/elevator.ts` / `elevator/definition.ts` FP | shaft solid/glass; door center/left/right | standalone, source-dependent | partial | complete | none | none | partial/partial/none | building-scoped level projection |
| level | `schema/nodes/level.ts` / `level/definition.ts` | level index | container | partial | complete | n/a | intentionally hidden | partial/partial/none | none for container |
| column | `schema/nodes/column.ts` / `column/definition.ts` FP | 6 styles; 5 cross-sections; shaft/base/capital enums | standalone | partial | complete | none | none | partial/partial/none | Pascal footprint builder |
| wall | `schema/nodes/wall.ts` / `wall/definition.ts` FP | treatment side; trim profiles | standalone | partial | complete | n/a | Pascal-equivalent | partial/complete/complete | upstream Schema validation remains partial |
| fence | `schema/nodes/fence.ts` / `fence/definition.ts` FP | slat, rail, privacy, horizontal | standalone | partial | complete | none | none | partial/partial/none | segment footprint |
| cabinet | `schema/nodes/cabinet.ts` / `cabinet/definition.ts` FP | run tier; front style; 16 compartment kinds | standalone | partial | complete | none | none | partial/partial/none | run/module layout |
| cabinet-module | `schema/nodes/cabinet.ts` / `cabinet/definition.ts` FP | base/tall; standard/corner-filler | hosted | partial | complete | none | none | partial/partial/none | cabinet parent frame |
| item | `schema/nodes/item.ts` / `item/definition.ts` FP | asset source; attachTo; controls/effects | standalone, hosted | partial | complete | complete | exact accepted matrix | partial/complete/complete | upstream full Schema validation |
| zone | `schema/nodes/zone.ts` / `zone/definition.ts` FP | color, metadata | standalone | partial | complete | n/a | Pascal-equivalent polygon | partial/partial/none | dedicated coverage tests |
| slab | `schema/nodes/slab.ts` / `slab/definition.ts` FP | elevation; autoFromWalls; holes | standalone | partial | complete | n/a | Pascal-equivalent evenodd polygon | partial/partial/complete | raw polygon + hole rendering |
| ceiling | `schema/nodes/ceiling.ts` / `ceiling/definition.ts` FP | height; autoFromWalls | view-specific | partial | complete | n/a | intentionally hidden | partial/partial/complete | Ceiling数据用于顶面/天花视图，不在当前平面布置图默认渲染。 |
| roof | `schema/nodes/roof.ts` / `roof/definition.ts` FP | child segments | standalone | partial | complete | none | none | partial/partial/none | parent/segment composition |
| roof-segment | `schema/nodes/roof-segment.ts` / `roof-segment/definition.ts` FP | hip, gable, shed, gambrel, dutch, mansard, flat | hosted, source-dependent | partial | complete | none | none | partial/partial/none | roof-local transform and shape |
| shelf | `schema/nodes/shelf.ts` / `shelf/definition.ts` FP | wall-shelf, bookshelf, open-rack, cubby | standalone | partial | complete | complete | Pascal-equivalent | complete/complete/complete | upstream full Schema validation |
| stair | `schema/nodes/stair.ts` / `stair/definition.ts` FP | straight, curved, spiral; railing/landing/opening | standalone, source-dependent | partial | complete | complete | Pascal-equivalent; accepted spiral symbol | partial/partial/complete | no Pascal editor handles/chrome |
| stair-segment | `schema/nodes/stair-segment.ts` / `stair-segment/definition.ts` | stair/landing; front/left/right | parent-emitted | partial | complete | parent cumulative | parent-emitted | partial/partial/complete | emitted once by parent Stair |
| scan | `schema/nodes/scan.ts` / `scan/definition.ts` | scale, opacity | helper-view-specific | partial | complete | n/a | intentionally hidden | partial/partial/none | optional scan mode |
| guide | `schema/nodes/guide.ts` / `guide/definition.ts` | scale reference | helper-view-specific | partial | complete | n/a | intentionally hidden | partial/partial/none | optional guide mode |
| spawn | `schema/nodes/spawn.ts` / `spawn/definition.ts` FP | rotation | helper-view-specific, symbol-only | partial | complete | n/a | intentionally hidden | partial/partial/none | optional helper layer |
| window | `schema/nodes/window.ts` / `window/definition.ts` FP | 10 window types | hosted | partial | complete | partial | demo custom symbol | partial/partial/none | variant-specific Pascal symbols |
| door | `schema/nodes/door.ts` / `door/definition.ts` FP | 10 door types; category; track | hosted | partial | complete | partial | demo custom symbol | partial/partial/none | variant/opening Pascal symbols |
| box-vent | `schema/nodes/box-vent.ts` / `box-vent/definition.ts` FP | box, cap, dome | hosted | partial | complete | none | none | partial/partial/none | roof-segment host frame |
| ridge-vent | `schema/nodes/ridge-vent.ts` / `ridge-vent/definition.ts` FP | standard, shingled, metal | hosted | partial | complete | none | none | partial/partial/none | ridge host geometry |
| turbine-vent | `schema/nodes/turbine-vent.ts` / `turbine-vent/definition.ts` FP | globe, cylinder | hosted | partial | complete | none | none | partial/partial/none | roof host frame |
| cupola | `schema/nodes/cupola.ts` / `cupola/definition.ts` FP | dome, pyramid | hosted | partial | complete | none | none | partial/partial/none | roof host frame |
| eyebrow-vent | `schema/nodes/eyebrow-vent.ts` / `eyebrow-vent/definition.ts` FP | scoop, half-round, slant-box | hosted | partial | complete | none | none | partial/partial/none | roof host frame |
| gutter | `schema/nodes/gutter.ts` / `gutter/definition.ts` FP | k-style, half-round, box | hosted | partial | complete | none | none | partial/partial/none | roof edge host geometry |
| chimney | `schema/nodes/chimney.ts` / `chimney/definition.ts` FP | square/round; cap/shoulder/band/cricket enums | hosted | partial | complete | none | none | partial/partial/none | roof-segment transform/cutout |
| solar-panel | `schema/nodes/solar-panel.ts` / `solar-panel/definition.ts` FP | flush, tilted | hosted | partial | complete | none | none | partial/partial/none | roof host frame |
| skylight | `schema/nodes/skylight.ts` / `skylight/definition.ts` FP | flat, walk-on, lantern, opening, sliding | hosted | partial | complete | none | none | partial/partial/none | roof opening/operation state |
| dormer | `schema/nodes/dormer.ts` / `dormer/definition.ts` FP | roof type; window shape | hosted | partial | complete | none | none | partial/partial/none | roof host and cutout |
| downspout | `schema/nodes/downspout.ts` / `downspout/definition.ts` | auto/round/rect; terminal | hosted, source-dependent | partial | complete | none | none | partial/partial/none | gutter outlet/roof segment projection |
| duct-segment | `schema/nodes/duct-segment.ts` / `duct-segment/definition.ts` FP | round/rect/oval; material; supply/return | standalone | partial | complete | none | none | partial/partial/none | point-chain floorplan |
| duct-fitting | `schema/nodes/duct-fitting.ts` / `duct-fitting/definition.ts` FP | elbow/tee/cross/reducer/transition | standalone | partial | complete | none | none | partial/partial/none | fitting ports/shape |
| duct-terminal | `schema/nodes/duct-terminal.ts` / `duct-terminal/definition.ts` FP | register/diffuser/grille; floor/ceiling/wall | standalone | partial | complete | none | none | partial/partial/none | terminal footprint |
| hvac-equipment | `schema/nodes/hvac-equipment.ts` / `hvac-equipment/definition.ts` FP | furnace/air-handler/condenser | standalone | partial | complete | none | none | partial/partial/none | equipment footprint/ports |
| lineset | `schema/nodes/lineset.ts` / `lineset/definition.ts` FP | suction/liquid diameters | standalone | partial | complete | none | none | partial/partial/none | routed line geometry |
| liquid-line | `schema/nodes/liquid-line.ts` / `liquid-line/definition.ts` FP | diameter | standalone | partial | complete | none | none | partial/partial/none | routed line geometry |
| pipe-segment | `schema/nodes/pipe-segment.ts` / `pipe-segment/definition.ts` FP | material; waste/vent | standalone | partial | complete | none | none | partial/partial/none | point-chain floorplan |
| pipe-fitting | `schema/nodes/pipe-fitting.ts` / `pipe-fitting/definition.ts` FP | elbow/wye/sanitary-tee/cross | standalone | partial | complete | none | none | partial/partial/none | fitting ports/shape |
| pipe-trap | `schema/nodes/pipe-trap.ts` / `pipe-trap/definition.ts` FP | material | standalone | partial | complete | none | none | partial/partial/none | trap symbol/footprint |

## Evidence and invariants

- Raw preservation is complete because `nodeSchema.passthrough()` and `parseProject()` copy every recognized object field; unknown plugin nodes are retained rather than rejected.
- No kind has `schemaRecognition: complete`: this Demo does not import Pascal's fixed-commit `AnyNode` Zod union.
- `complete` transform/test claims carry direct file/function/test evidence in the machine manifest; slab and stair coverage is exercised by dedicated geometry tests.
- The render registry mirrors current dispatch conditions without changing SVG geometry. Missing expected renderers become errors; containers and view-specific helpers do not.

## Recommended implementation batches

1. Common interior plan objects: curved stair, straight stair + stair-segment parent emitter, door/window variants, column, cabinet/module, slab, ceiling, fence, elevator.
2. Roof graph and hosted accessories: roof/segment first, then skylight, dormer, chimney, gutter/downspout, solar panel, vents and cupola.
3. MEP: duct segment/fitting/terminal and HVAC equipment, then lineset/liquid line, then pipe segment/fitting/trap.
4. Optional editor layers: scan, guide and spawn.

These are audit recommendations only; this change adds no new renderer.
