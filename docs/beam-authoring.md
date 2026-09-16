# Demo Beam authoring

`beam` is a Pascal Conduit Routing Demo extension, not a Pascal Core node kind. It is the only editable building node: all imported Pascal nodes and unknown fields remain read-only and are preserved verbatim. Beam geometry is stored in project JSON; conduit, devices, construction state, and future Beam penetrations remain in the independent Overlay.

## First authoring slice

The 3D **梁** tool starts on a Ceiling underside. Click once to fix the plan axis start, move to see a transient full-volume solid, then click again to create one rectangular Beam. Free angles are allowed; holding Shift on the pointer constrains the current segment horizontally or vertically. Escape first cancels an unfinished Beam and then returns to selection; after a successful creation the tool remains active.

## Layout reference plane

The Beam tool also has one Overlay-owned **Layout reference plane** per Level. It is visible by default, derives its height from the largest valid Ceiling polygon on that Level (or the identified 2700 mm fallback), and can be hidden or given an explicit millimetre height in the Beam panel. These settings survive Overlay export/import and do not enter Pascal project JSON. The plane supplies only the active two-click interaction coordinates: accepted Beams still validate against Ceiling geometry and retain their Ceiling ids, elevation and basis. Changing the plane never moves an existing Beam or device point. When a transient Beam is shown it is deliberately non-pickable, so it cannot intercept the second authoring click.

Beam authoring uses a persistent **Orthogonal lock** state. Shift toggles that state while the Beam tool is active; when on, the live candidate resolves to world X or Z from the confirmed start, and when off it remains freely angled. Endpoints may use only physical Wall, Column, existing Beam faces, or a Ceiling polygon edge; centrelines are not targets. A normal candidate cannot cross into a Ceiling region with a different effective elevation. Ctrl on Windows/Linux, or Command on macOS, makes that exceptional crossing explicit: the committed Beam remains one straight member at its start Ceiling elevation and records that explicit crossing rather than stepping or adopting the target height.

The model keeps metres. The UI exposes width and height in millimetres, beginning at 300 × 500 mm and retaining the last section used during the browser session. These are authoring defaults, never structural standards. Names are generated as `梁 1`, `梁 2`, and so on.

A Beam has a stable id, readable name, direct Level parent, finite start/end plan points, positive width and height, intersected Ceiling ids, and `{ meters, basis }` effective Ceiling elevation. An explicit Ceiling height supplies `explicit-ceiling-height`; otherwise the record honestly stores the `derived-default-2700mm` basis. A Beam may span multiple same-elevation Ceilings and gaps, but must intersect at least one Ceiling and cannot cross conflicting effective elevations.

Invalid imported Beam records remain in raw project JSON and receive parser diagnostics. They are excluded from 2D/3D rendering and selection. New invalid candidates only remain preview state and never affect project JSON, Overlay, dirty flags, or workspace history.

## Views, persistence, and limits

3D renders a selectable oriented gray solid on a default-on Beam layer. The 2D building layer renders only its selectable gray footprint: no persistent dimension text and no 2D editing. Creating a Beam is one project workspace transaction, so shared undo/redo restores the project document and its independent dirty state.

Project export and re-import retain Beam geometry, identity, name, Level/Ceiling relationships, elevation value and basis. This slice does not snap to physical edges, route conduit onto/around Beams, model penetrations, or mount devices; those additions are intentionally deferred.

## 3D geometry editing

Selecting a Beam in 3D exposes independent endpoint handles plus direct fields for name, width, height, and length. Dragging its body translates the whole member in the Ceiling plane without changing its span, direction, or section. The two lateral 5 mm controls translate the whole member perpendicular to its own axis without changing its span or section. An endpoint edit changes only that endpoint, so it may change length and direction. Values commit on Enter or blur; every accepted edit is one project workspace history entry and recomputes Ceiling identities, effective elevation, and its explicit/derived basis.

All coordinates and dimensions are quantized to 5 mm, including negative positions and angled members. Invalid hostless or contradictory-elevation candidates remain transient and do not change project JSON, Overlay, dirty state, or history. Normal intersections with Walls, Columns, and other Beams remain legal building geometry and never create conduit collision or penetration data. 2D remains inspection-only.

## Physical positioning references

Beam authoring snaps only to exposed physical surfaces of Walls (including supported curved-wall segments), Columns, and existing Beams. It never offers a Wall/Column centreline, Beam centreline, or a synthetic endpoint target. The transient 3D cue names the selected target kind and id, and snaps the Beam axis point to the physical face rather than halfway into a solid.

Selected Beams show only reliable physical-face witnesses: left/right dimensions look for the nearest parallel Wall or Beam face, while start/end dimensions look for the first Wall or Beam face along the Beam axis. Missing witnesses are omitted. These dimensions recompute for preview geometry, including angled endpoint changes; their direct millimetre fields commit at 5 mm precision. A side-clearance edit translates the complete Beam, while an end-clearance edit moves only that endpoint. These selected-only dimensions are not written to project JSON or Overlay and never appear in 2D.

## Conduit hosts and collision (current slice)

The exposed **bottom**, two **sides**, and two **ends** of a valid Beam are ordinary conduit hosts. Every attachment records the Beam id, named face, outward normal, local basis, Level, and local position; the Ceiling-adjacent top is intentionally not pickable. Existing guided drawing, bends, turns, and completion therefore work across adjacent Beam faces and between Beam and other hosts without changing the source building model.

Beam-face conduit is exposed surface work: it never creates a `surface-chase`. Independently of what the cursor ray hit, valid Beam prisms participate in analytic route collision checks for surface, suspended, and world-axis segments. A full run truthfully attached to one exposed Beam face is legal; entry into the member volume is a red blocking conflict unless an active explicit penetration bypass owns that Beam. Invalid imported Beams are excluded from both hosting and collision. Building-member intersections (Beam/Wall, Beam/Column, Beam/Beam) remain building geometry, not conduit conflicts.

## Explicit Beam penetrations

The existing Tab workflow also serves Beams: it freezes the incoming conduit direction and resolves the far exit against the oriented Beam prism, retaining face, normal, Level, local basis, and local position as attachment evidence. A confirmed opening is Overlay-only and stores the stable Beam id, route-element id, entry/exit, direction, and the conduit diameter plus the Demo's 10 mm clearance. No project Beam node receives hole geometry or a surface chase.

When a Beam is edited, the Overlay revalidates its explicit passages against the new physical prism; holes whose exit no longer lies on the frozen ray or whose linked route has disappeared are removed, leaving any newly ordinary Beam intersection to the normal red collision rule. This is a demonstrative construction record, not structural approval.

The governing durable choice is [ADR 0003](adr/0003-author-demo-beams-in-project-json.md).

## Devices and safe Beam changes

Every current Demo device type may mount on a Beam bottom, side, or end face; the ceiling-adjacent top remains unavailable. Its Overlay attachment retains the Beam id, face, normal, local basis and Level, so export/import preserves the authored relationship. Device frames, presentation, and ports use that face evidence (including a luminaire on a Beam side or end), rather than assuming a horizontal Ceiling plane.

Editing a Beam is one workspace transaction. It preserves every mounted device, port, conduit point, and connected route at its existing world coordinate. Attachments that no longer touch an exposed Beam face are cleared rather than followed, stretched, rerouted, or locally reconnected; valid attachments remain unchanged. A Beam with one or more still-valid mounted devices cannot be deleted and names those devices in the rejection. Once those hosts are moved or deleted, Beam deletion keeps the remaining conduit geometry and removes only that Beam's orphaned penetrations.

This is authoring and construction-record evidence only. The Demo does not determine member loads, reinforcement, safe hole zones, code compliance, or structural approval.
