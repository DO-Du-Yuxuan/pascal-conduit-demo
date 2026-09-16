# 02: Draw and save the first Beam

**What to build:** Let a user create a valid straight rectangular Beam in 3D, see it in both views, export it in project JSON, and re-import it without loss. This is the first complete Beam tracer bullet; precise physical snapping and post-creation editing belong to later tickets.

**Blocked by:** 01 / Establish editable project identity and workspace history

**Status:** resolved

## Required behavior

- [ ] Introduce Beam as a documented Demo extension node and the only editable building-node kind; do not present it as a Pascal Core built-in kind.
- [ ] Model Beam with stable identity, editable name, Level parent, two finite plan endpoints, positive width and height, host Ceiling identities, and a recorded effective Ceiling elevation with explicit or derived basis.
- [ ] Keep project geometry in metres while presenting Beam dimensions in millimetres.
- [ ] Resolve Beam top elevation from explicit Ceiling height, otherwise use the identified 2700 mm derived default and retain that basis honestly.
- [ ] Permit a Beam to cross multiple same-elevation Ceilings and gaps between them. Require at least one Ceiling intersection and reject spans across conflicting effective elevations.
- [ ] Add a dedicated 3D Beam tool: the first click on a Ceiling underside fixes the axis start, pointer motion shows a full-volume preview, and the second click validates and commits.
- [ ] Support free angled drawing and the established Shift horizontal orthogonal constraint. Preview movement must not mutate project data, Overlay data, dirty states, or history.
- [ ] Start with a 300 mm width and 500 mm height, reuse the most recently used section for later Beams in the session, and clearly avoid presenting these values as structural standards.
- [ ] Keep the Beam tool active after commit. Escape cancels an unfinished Beam first and exits the tool when no unfinished Beam remains.
- [ ] Generate readable sequential names and expose Beam selection and inspection.
- [ ] Render the Beam as an oriented rectangular solid in 3D with a separately controllable Beam layer enabled by default.
- [ ] Render a selectable gray Beam footprint through a separately controllable 2D building layer. Do not show persistent Beam dimensions or provide 2D editing.
- [ ] Export Beam through project JSON and restore the same geometry, identity, Level/Ceiling relationships, elevation basis, and name on re-import.
- [ ] Preserve invalid imported Beam records and report precise diagnostics, but exclude them from rendering and interaction. Prevent the authoring tool from committing invalid new Beams.
- [ ] Commit creation as one workspace history operation with working undo and redo.
- [ ] Update README, the detailed Beam contract, Viewer boundary documentation, Pascal support documentation, and ADR references for only the behavior now implemented.

## Verification

- [ ] Test orthogonal and angled creation, preview isolation, cancellation, continuous authoring, defaults, last-used section, naming, and undo/redo.
- [ ] Test explicit and derived Ceiling elevation, same-elevation multi-Ceiling spans, gaps, missing hosts, and conflicting elevations.
- [ ] Test project JSON round-trip, Level relationships, stable project identity, unknown-field preservation, and invalid Beam diagnostics.
- [ ] Test observable 3D and 2D layer, rendering, selection, and absence of 2D editing/dimension text.
- [ ] Run the relevant focused tests, the full test suite, and the production build.

## Answer

Implemented the first Beam tracer bullet: project-owned Demo Beam records, Ceiling-elevation validation and diagnostics, 3D authoring/preview/layer, selectable 2D footprint/layer, project workspace undo/redo, and contract documentation. Focused tests, full test suite, and production build passed before commit.
