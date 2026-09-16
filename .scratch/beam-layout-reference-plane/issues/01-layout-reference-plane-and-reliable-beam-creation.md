# 01: Add the Layout reference plane and make Beam creation reliable

**What to build:** Let a user complete the ordinary two-click Beam workflow from a clear top-down or oblique view even when the Ceiling layer is hidden. Add one persistent Layout reference plane per Level, expose its basic controls, and make the transient Beam preview incapable of swallowing the endpoint click.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Add one Overlay-owned Layout reference plane setting per Level with visibility, height, and basis information; do not write the plane into project JSON.
- [x] Default the plane to visible. Derive its initial height from the largest-area valid Ceiling on the Level, or use an identified 2700 mm derived fallback when the Level has no Ceiling.
- [x] Allow the user to show or hide the active Level's plane and enter its height explicitly. Preserve independent settings across Level changes and Overlay export/import, including legacy Overlay migration.
- [x] Keep a manually entered height explicit and stable. Changing the plane must affect only active previews and future placement, never move existing Beams or device points.
- [x] Treat the plane as an interaction surface rather than a Beam host. A committed Beam must retain its source-Ceiling elevation and evidence.
- [x] Route Beam start, pointer preview, validation, endpoint confirmation, cancellation, and commit through one authoring session with observable candidate and rejection states.
- [x] Make transient Beam preview geometry non-pickable or forward its events so it cannot block the second click.
- [x] Complete two-click Beam creation while the Ceiling layer is hidden and the Layout reference plane is visible, including top and oblique camera views.
- [x] Preserve direct drawing on visible Ceiling geometry when the Layout reference plane is hidden.
- [x] When neither the Layout reference plane nor visible Ceiling geometry offers an authoring surface, reject the start with a clear instruction.
- [x] Keep pointer movement, invalid clicks, cancellation, and preview updates free of project/Overlay mutations, dirty-state changes, and history entries. Commit one accepted Beam as one workspace operation.
- [x] Add a mounted interaction regression covering an endpoint visually obscured by the preview, Ceiling hidden and visible cases, top and oblique views, and an invalid second click that retains the preview and explains the rejection.
- [x] Add focused persistence and workspace tests for per-Level defaults, derived fallback, explicit edits, migration, non-destructive project JSON behavior, and immobility of existing geometry.
- [x] Update implemented-behavior documentation required by the repository contract, without claiming the later interaction-polish or device-sharing tickets.
- [x] Run relevant focused tests, the full test suite, and the production build.

## Answer

Added Overlay-owned Layout reference plane persistence/default resolution, active-Level visibility and height controls, and the 3D interaction plane. Beam previews are non-pickable; accepted Beams retain the existing Ceiling evidence path. Added focused layout-plane persistence tests; full test suite and production build pass.
