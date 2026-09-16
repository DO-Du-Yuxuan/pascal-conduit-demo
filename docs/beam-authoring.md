# Demo Beam authoring

`beam` is a Pascal Conduit Routing Demo extension, not a Pascal Core node kind. It is the only editable building node: all imported Pascal nodes and unknown fields remain read-only and are preserved verbatim. Beam geometry is stored in project JSON; conduit, devices, construction state, and future Beam penetrations remain in the independent Overlay.

## First authoring slice

The 3D **梁** tool starts on a Ceiling underside. Click once to fix the plan axis start, move to see a transient full-volume solid, then click again to create one rectangular Beam. Free angles are allowed; holding Shift on the pointer constrains the current segment horizontally or vertically. Escape first cancels an unfinished Beam and then returns to selection; after a successful creation the tool remains active.

The model keeps metres. The UI exposes width and height in millimetres, beginning at 300 × 500 mm and retaining the last section used during the browser session. These are authoring defaults, never structural standards. Names are generated as `梁 1`, `梁 2`, and so on.

A Beam has a stable id, readable name, direct Level parent, finite start/end plan points, positive width and height, intersected Ceiling ids, and `{ meters, basis }` effective Ceiling elevation. An explicit Ceiling height supplies `explicit-ceiling-height`; otherwise the record honestly stores the `derived-default-2700mm` basis. A Beam may span multiple same-elevation Ceilings and gaps, but must intersect at least one Ceiling and cannot cross conflicting effective elevations.

Invalid imported Beam records remain in raw project JSON and receive parser diagnostics. They are excluded from 2D/3D rendering and selection. New invalid candidates only remain preview state and never affect project JSON, Overlay, dirty flags, or workspace history.

## Views, persistence, and limits

3D renders a selectable oriented gray solid on a default-on Beam layer. The 2D building layer renders only its selectable gray footprint: no persistent dimension text and no 2D editing. Creating a Beam is one project workspace transaction, so shared undo/redo restores the project document and its independent dirty state.

Project export and re-import retain Beam geometry, identity, name, Level/Ceiling relationships, elevation value and basis. This slice does not snap to physical edges, edit Beam geometry, route conduit onto/around Beams, model penetrations, or mount devices; those additions are intentionally deferred.

The governing durable choice is [ADR 0003](adr/0003-author-demo-beams-in-project-json.md).
