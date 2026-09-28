---
status: accepted
---

# Replace spotlights with lighting junction boxes

The circular Lighting-system point is a lighting junction box, not a luminaire. Publish it as `LightingJunctionBox`; preserve its four independent horizontal lighting conduit ports so a blue route may arrive from a StrongCurrentBox and continue through any remaining open port. The original decision used 90 mm diameter and 100 mm depth defaults and stable node, port, and route IDs.

For compatibility with existing Project 4.0 files, accept `Spotlight` as an input alias for this point. Import it into the existing internal `luminaire` adapter without changing its ID, position, dimensions, ports, or connected route references. Export it as `LightingJunctionBox`, retaining other per-node fields. This narrow alias is the only automatic public-type conversion; older schema versions remain unsupported.

Lighting connections are represented by blue conduit routes. Do not create, edit, or display switch-to-lighting-junction-box logical groups. Discard legacy `LightingSystem.lightingControlGroups` during import and omit the field on export. Switch gang count is not derived from those discarded records.

The prior logical-group model was accepted in [ADR 0002](0002-model-lighting-controls-separately-from-circuits.md). It is superseded because a control association without a drawn route obscures the physical installation. Authors now express connections in the conduit geometry with the existing compatible physical ports and manual routing behavior. The Demo does not infer control wiring or auto-route it.

## Later default-size change

New lighting junction boxes now default to 60 mm diameter and 30 mm depth. This supersedes only the original default dimensions above; existing Project 4.0 objects keep their persisted dimensions, position, port IDs, and route connections during import and export. An unconnected box may change diameter, which moves its four port positions to the new disk edge while retaining device and port IDs and port metadata. Once any port is connected, diameter is locked so the physical route endpoint cannot move; depth remains editable because it does not move the horizontal ports.
