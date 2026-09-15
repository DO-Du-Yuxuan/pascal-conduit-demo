# Sensor Points

**Status:** ready-for-agent

## Problem Statement

The author needs to locate sensors in the model without pretending that they are powered devices, weak-current outlets, or conduit endpoints. Sensors must be independently visible in 2D and 3D, and their actual purpose must be editable in the construction drawing.

## Solution

Add a standalone Sensor point to the independent construction Overlay. A Sensor point has no physical port, circuit, or routing system. It can be placed on a wall, slab, ceiling, installation reference plane, or in free space. Its dedicated Sensor layer controls its 2D and 3D display. Its editable purpose defaults to `传感器` and is the text used in 2D annotations and the installation schedule.

## User Stories

1. As a construction author, I want to choose a Sensor point in the 3D point-placement tool, so that I can place a sensor without creating a conduit device.
2. As a construction author, I want to place a Sensor point on a wall, slab, ceiling, installation reference plane, or free space, so that missing model hosts do not block layout work.
3. As a construction author, I want a newly placed Sensor point to have no route port or circuit, so that it cannot be mistakenly connected to a conduit.
4. As a construction author, I want a dedicated Sensor layer, so that sensors can be shown or hidden independently of receptacle, lighting, network, sprinkler, and conduit layers.
5. As a construction author, I want the Sensor layer to control matching 2D and 3D visibility, so that the two views agree.
6. As a construction author, I want the Sensor layer enabled by default, so that newly placed sensors are visible without configuration.
7. As a construction author, I want a clear, single 3D sensor symbol which follows its wall, floor, or ceiling host orientation, so that I can identify placement direction.
8. As a construction author, I want a clear, single 2D sensor symbol distinct from luminaires and sprinklers, so that I can read plans reliably.
9. As a construction author, I want each new sensor to show `传感器` by default in its 2D construction text, so that the plan is useful immediately.
10. As a construction author, I want to double-click the 2D sensor text and change its purpose, so that a single point type can represent smoke, leak, temperature, occupancy, and other sensors.
11. As a construction author, I want an empty edited purpose to fall back to `传感器`, so that the drawing never presents an unnamed sensor.
12. As a construction author, I want the edited purpose to appear in the 3D property name and 2D installation schedule, so that both views use one source of truth.
13. As a construction author, I want Sensor points included in existing point-position dimensions and installation-height schedules, so that their installation locations are constructible.
14. As a construction author, I want to select, move, resize, and delete a Sensor point using existing point interactions, so that sensor editing stays consistent with other device points.
15. As a construction author importing an older Overlay, I want it to remain valid without sensor data, so that the feature is backward compatible.

## Implementation Decisions

- Model Sensor point as a new standalone device-point kind rather than as a weak-current or other routing system device.
- Give it an empty port set and empty routing-system set. Route-start, endpoint, branch, target-port, and conduit-insertion interactions must exclude it.
- Extend Overlay display settings with a dedicated sensor visibility flag. Older documents receive the flag as enabled during parsing.
- Keep the persisted Overlay document compatible with existing schema versions by treating sensor-specific fields and visibility as optional inputs with normalized defaults.
- Use the existing device-name field as the editable sensor purpose. Normalize empty or whitespace-only sensor names to `传感器` at the point where labels are derived and when edits are committed.
- Extend the shared device display seam to give Sensor points their own 3D geometry and their own 2D symbol.
- Extend construction-plan visibility, annotation, schedule, and dimension derivation so Sensor points participate only when the Sensor layer is visible.
- Sensor points on every supported mount, including non-wall locations, generate an editable 2D text panel as well as participating in the installation schedule and point symbol display.
- Do not attach Sensor points to circuits, controls, ports, routes, or automatic rerouting.

## Testing Decisions

- Test Overlay parsing and creation as the highest data seam: Sensor points retain their host/free-space mount, have no ports or routing systems, and legacy Overlay data receives enabled sensor visibility.
- Test placement eligibility and route exclusion through existing device-domain behavior tests.
- Test 2D plan rendering through the existing render integration harness: dedicated layer visibility hides/shows the sensor symbol, and the symbol is distinct and labeled as a sensor.
- Test 2D construction annotation/schedule derivation through existing plan-model tests: default and edited purposes are shown and only visible-layer Sensor points participate.
- Test 3D workspace source-level interaction coverage alongside existing point-tool UI tests: the type is selectable, its single-selection name can be edited, and the dedicated 3D visibility control is wired to Overlay state.
- Run the full test suite, production build, and whitespace check before commit.

## Out of Scope

- Sensor subtype catalogs, manufacturer data, sensing range, coverage geometry, alarms, controls, or automation logic.
- Power, weak-current, conduit, circuit, port, or routing relationships.
- Automatic sensor placement, collision clearance, or generated route suggestions.
- New keyboard shortcuts.
- Changes to Pascal building JSON, Parser outputs, shared building geometry, or G1/G2/G3/S1 evaluation semantics.

## Further Notes

- The canonical term is **Sensor point**, as recorded in `CONTEXT.md`.
- The architectural seam is the existing independent construction Overlay: it owns point persistence and visibility, while the 2D/3D renderers derive presentation from that state. This keeps a Sensor point out of the routed-device model instead of duplicating a parallel annotation system.
