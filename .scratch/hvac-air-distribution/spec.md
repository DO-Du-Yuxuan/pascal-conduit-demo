# HVAC air-distribution authoring

**Status:** in progress

Add Overlay-owned central-air-conditioning indoor units, one non-branching rectangular supply route and one non-branching rectangular return route per unit, face-mounted duct outlets, Ctrl-created Wall penetrations, and a one-to-one wall-mounted thermostat control relationship.

## Confirmed decisions

- Pascal JSON remains read-only; HVAC persists only in the Overlay.
- A unit defaults to `600 × 1000 × 300 mm`; its shared supply/return duct section defaults to `1000 × 300 mm`.
- Connected units cannot move or yaw-rotate. Their shared section remains editable and propagates to routes; casing length is locked while connected.
- Routes use only straight segments and fixed 90-degree elbows, no branches. Only terminal segment length is editable.
- Ctrl creates an Overlay-owned rectangular Wall penetration, with fixed section dimensions plus 50 mm in each opening dimension.
- Outlets inherit supply/return identity from their owner duct; may share a face; and must fit completely inside that face.
- Thermostats are wall-mounted 86 panels with a one-to-one relationship to an indoor unit; 2D and 3D show the relationship like lighting controls.
- 2D stays read-only, shows the four HVAC object types and a true 3D length dimension for each duct segment; only thermostat position dimensions/text are emitted.

## Issues

- [01 Overlay HVAC model](issues/01-overlay-hvac-model.md)
- [02 3D HVAC authoring](issues/02-3d-hvac-authoring.md)
- [03 HVAC plan rendering](issues/03-hvac-plan-rendering.md)
- [04 Documentation and regression coverage](issues/04-documentation-and-regression-coverage.md)
