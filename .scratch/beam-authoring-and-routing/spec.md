# Beam authoring and conduit interaction

Status: ready-for-agent

Source decisions: `CONTEXT.md` and `docs/adr/0003-author-demo-beams-in-project-json.md`

## Problem Statement

The imported Pascal building model can describe Ceilings but has no Beam node or authoring workflow. A conduit designer therefore cannot record missing structural beams, position them precisely, mount devices or conduit on their exposed faces, detect conduit collisions with them, or express intentional beam penetrations. Treating every missing host as an installation reference plane loses the physical surfaces and obstructions required for truthful construction routing.

The Demo also treats the entire imported Pascal JSON as read-only and identifies its Overlay by a content hash. Beam authoring must deliberately and narrowly break the read-only contract without turning the Demo into a general building editor, losing unknown source data, or making a saved revision look like a different project. Human collaborators and AI agents must be able to discover the implemented behavior, data ownership, persistence model, and safety limits from maintained repository documentation.

## Solution

Add a Demo-authored `beam` extension node to the building project JSON. Beam is the only editable building-node kind; all other imported building nodes remain read-only. A Beam is a straight rectangular member defined by two plan endpoints, width, height, Level membership, host Ceiling identities, and a recorded effective Ceiling elevation with an explicit or derived basis. Its top follows its host Ceiling, using the identified 2700 mm derived default when the Ceiling has no explicit height. It may cross multiple same-elevation Ceilings and gaps between them, but it must intersect at least one Ceiling and cannot span conflicting Ceiling elevations.

Author Beam only in 3D. The first click selects a point on a Ceiling underside or snaps its plan position to a physical Wall, Column, or existing Beam surface. Pointer movement then shows a live full-volume preview using the current Beam width and height; the second click commits. Shift applies the established horizontal orthogonal constraint. The initial cross-section is 300 mm wide by 500 mm high, later Beam creations reuse the most recently used dimensions, and the tool stays active until explicitly exited.

Selecting a Beam exposes endpoint handles, whole-Beam translation, lateral nudge controls, width and height inputs, and live physical positioning dimensions. Numeric dimensions measure from real Beam faces or endpoint faces to the nearest reliable parallel Wall or neighboring Beam face. Dragging one endpoint of an angled Beam continuously recalculates the left and right side clearances at that endpoint. Pointer and numeric positioning use a 5 mm resolution. Numeric input follows the established device-point behavior and commits as one undoable operation on Enter or blur.

Render each exposed Beam bottom, side, and end surface as a physical host. All device types may mount on those exposed faces, and conduit may route along them without creating a chase. The top touching the Ceiling is not available as a Beam host. New conduit that intersects Beam volume is an invalid red conflict unless the user explicitly enters the established Tab penetration flow. An accepted passage creates an Overlay-owned Beam penetration and applies the existing conduit-diameter-plus-10-mm Demo clearance. Beam geometry remains intact in the project JSON; construction cutting is derived at runtime from the Overlay.

Beam edits never silently move conduit or devices. Objects keep their world geometry; attachments that no longer touch a valid Beam face become explicitly unhosted and conflicted. Existing penetration relationships are recalculated, obsolete penetrations are removed, and new intersections do not become penetrations automatically. Deleting a Beam is blocked while it still hosts devices. Once no device remains hosted, deletion preserves conduit and removes orphaned Beam penetrations.

Give successive project revisions a stable project identity. Export a new project JSON rather than overwriting the imported file, and export the independent construction Overlay separately. The project identity determines whether an Overlay belongs to the project; a content SHA identifies only a particular project revision. Preserve all unedited nodes and unknown source fields semantically, while allowing JSON whitespace and property order to change.

Show Beam footprints as a selectable, read-only 2D building layer without persistent Beam dimension text. Show Beam penetration symbols in the construction view and reveal their size and linked conduit only when selected. Maintain the README as the human-and-AI current-capability index, link a detailed Beam contract, identify Beam as a Demo extension rather than a Pascal Core kind, and state that the Demo makes no structural-safety or approval determination.

## User Stories

1. As a conduit designer, I want to draw a missing Beam in the building model, so that routing uses the actual obstruction and mounting surfaces.
2. As a conduit designer, I want Beam to be the only editable building-node kind, so that the Demo does not unexpectedly become a general building editor.
3. As a conduit designer, I want imported Walls, Slabs, Ceilings, Doors, Windows, and other building nodes to remain read-only, so that Beam authoring cannot accidentally alter the source layout.
4. As a downstream engineer, I want Beam identified as a documented Demo extension, so that I do not mistake it for a Pascal Core node.
5. As a downstream engineer, I want Beam data stored in project JSON, so that the building model retains the user-authored structural geometry independently of conduit construction state.
6. As a conduit designer, I want each Beam to belong to a Level, so that multi-level display and editing remain unambiguous.
7. As a conduit designer, I want a Beam to be a straight rectangular member, so that two endpoints plus width and height describe it predictably.
8. As a conduit designer, I want Beam coordinates and dimensions to use Pascal metres, so that the extension agrees with the surrounding project data.
9. As a conduit designer, I want the UI to display and accept millimetres, so that construction dimensions can be entered directly.
10. As a conduit designer, I want the Beam top to follow its host Ceiling, so that I do not enter a redundant vertical position.
11. As a conduit designer, I want an explicit Ceiling height to remain authoritative, so that Beam elevation follows actual project data.
12. As a conduit designer, I want a missing Ceiling height to resolve to a visibly derived 2700 mm default, so that Beam authoring remains usable without pretending the value was imported.
13. As a downstream engineer, I want the effective elevation value and its basis retained, so that explicit and derived evidence remain distinguishable.
14. As a conduit designer, I want a Beam to cross several same-elevation Ceilings, so that room-by-room Ceiling polygons do not split one structural member unnecessarily.
15. As a conduit designer, I want a Beam to cross Walls and uncovered gaps between same-level Ceilings, so that structural spans are not constrained by room boundaries.
16. As a conduit designer, I want a Beam crossing different effective Ceiling elevations to be rejected visibly, so that one straight member cannot acquire contradictory vertical geometry.
17. As a conduit designer, I want Beam drawing to begin in 3D, so that the chosen Ceiling and physical surroundings are visible.
18. As a conduit designer, I want the first click to establish the Beam axis start, so that drawing follows the familiar two-point construction model.
19. As a conduit designer, I want a full-volume Beam preview to follow the pointer after the first click, so that length, direction, width, and height are visible before commit.
20. As a conduit designer, I want the second click to commit the previewed Beam, so that pointer motion alone never changes project data.
21. As a conduit designer, I want Shift to constrain the preview to the Ceiling plane's horizontal axes, so that orthogonal Beam placement matches established drawing controls.
22. As a conduit designer, I want free angled Beams when Shift is not active, so that the model supports members that are not parallel or perpendicular to Walls.
23. As a conduit designer, I want Beam endpoints to snap to physical Wall, Column, and existing Beam surfaces, so that structural contacts are positioned without centreline overlap.
24. As a conduit designer, I want Beam surface snapping to use the actual model surface, so that an endpoint does not enter another solid by half its width.
25. As a conduit designer, I want a visible snap cue and target identity, so that I know which physical surface will receive the point.
26. As a conduit designer, I want the first Beam to default to 300 mm width and 500 mm height, so that a useful preview appears immediately.
27. As a conduit designer, I want later Beam creations to reuse the last dimensions, so that repeated authoring does not require re-entering the same section.
28. As a conduit designer, I want the Beam tool to stay active after commit, so that I can draw several Beams efficiently.
29. As a conduit designer, I want Escape to cancel an unfinished Beam before exiting the tool, so that cancellation remains predictable.
30. As a conduit designer, I want automatic Beam names that I can edit, so that new objects are identifiable without blocking creation on naming.
31. As a conduit designer, I want to drag either Beam endpoint independently, so that I can adjust its length and angle.
32. As a conduit designer, I want to drag the Beam body to translate the whole member in its Ceiling plane, so that relocation does not change its size or direction.
33. As a conduit designer, I want lateral controls to move a Beam perpendicular to its own axis, so that parallel placement is easy.
34. As a conduit designer, I want to edit Beam width and height numerically, so that its section matches known dimensions.
35. As a conduit designer, I want a selected Beam to show clearances from both side faces to the nearest reliable parallel Wall or Beam faces, so that lateral placement uses physical references.
36. As a conduit designer, I want a selected Beam to show clearances from its start and end faces to reliable surfaces along the Beam axis, so that its span can be positioned precisely.
37. As a conduit designer, I want positioning dimensions to terminate on physical faces rather than centrelines, so that entered values are construction clearances.
38. As a conduit designer, I want an angled Beam endpoint to show live left and right side clearances while I drag it, so that changing the angle does not hide the resulting relationships.
39. As a conduit designer, I want editing a side clearance to translate the whole Beam without changing its section or span, so that the requested distance has one predictable effect.
40. As a conduit designer, I want editing a start or end clearance to move only that endpoint, so that I can set the span numerically.
41. As a conduit designer, I want the nearest surface encountered in the dimension direction to be the default reference, so that the witness is deterministic.
42. As a conduit designer, I want a dimension omitted when no reliable parallel Wall or Beam face exists, so that the UI never invents a clearance.
43. As a conduit designer, I want drag and numeric movement resolved in 5 mm increments, so that edits are precise without excessive one-millimetre sensitivity.
44. As a conduit designer, I want an entered dimension to commit on Enter or input blur, so that Beam editing matches device-point editing.
45. As a conduit designer, I want each Beam edit to be one undoable operation, so that exact positioning remains reversible.
46. As a conduit designer, I want Beam and Overlay operations undone in actual chronological order, so that I do not need to understand their storage boundaries.
47. As a conduit designer, I want Beam endpoints that meet Walls, Columns, or other Beams to form a clean physical contact, so that the model does not show unintended gaps.
48. As a conduit designer, I want Beam solids to overlap Walls, Columns, or other Beams where their spans cross, so that normal structural junctions are not treated as errors.
49. As a conduit designer, I want building-member overlap to remain distinct from a conduit penetration, so that a Beam crossing a Wall never creates construction-hole data.
50. As a conduit designer, I want every exposed Beam bottom, side, and end face to be usable as a host, so that conduit and devices can occupy the surface I actually select.
51. As a conduit designer, I want the Beam top touching the Ceiling to be unavailable as a host, so that objects cannot occupy a surface with no physical clearance.
52. As a conduit designer, I want every device type to be placeable on an exposed Beam face, so that the Demo does not impose a separate Beam-only device catalog.
53. As a conduit designer, I want a Beam-mounted device orientation and ports to follow the selected face normal, so that its geometry and connections agree with the host.
54. As a conduit designer, I want conduit routed along a Beam face to remain surface-mounted, so that structural Beam chases are not created silently.
55. As a conduit designer, I want a new conduit that enters Beam volume normally to show a red conflict and refuse commit, so that accidental intersections cannot become accepted construction geometry.
56. As a conduit designer, I want Tab to explicitly enter the established penetration workflow, so that穿梁 uses the same deliberate action as穿墙.
57. As a conduit designer, I want an accepted Beam passage to preserve the frozen entry direction until exit, so that the hole and route stay collinear.
58. As a conduit designer, I want a Beam penetration diameter based on conduit diameter plus the existing 10 mm Demo clearance, so that hole sizing remains consistent.
59. As a conduit designer, I want Beam penetration data stored in the Overlay, so that the opening remains associated with the conduit construction plan.
60. As a conduit designer, I want runtime Beam cutting derived from the Overlay without rewriting Beam base geometry, so that the project model and construction intent have one owner each.
61. As a conduit designer, I want moving or resizing a Beam to leave existing conduit world geometry unchanged, so that the editor never silently reroutes work.
62. As a conduit designer, I want a conduit attachment that no longer reaches its Beam face to become explicitly invalid, so that saved topology does not claim a false host.
63. As a conduit designer, I want newly created Beam collisions after an edit to remain conflicts rather than automatic penetrations, so that only explicit Tab actions create holes.
64. As a conduit designer, I want obsolete Beam penetrations removed when geometry no longer intersects, so that construction data has no orphan holes.
65. As a conduit designer, I want moving or resizing a Beam to leave mounted devices at their world positions, so that the structure never silently moves equipment.
66. As a conduit designer, I want a device no longer touching its Beam to become explicitly unhosted, so that悬空 is visible rather than represented as a valid attachment.
67. As a conduit designer, I want connected conduit to remain unchanged when a device becomes unhosted through a Beam edit, so that neither equipment nor routing moves implicitly.
68. As a conduit designer, I want Beam deletion blocked while devices still claim it as their host, so that deleting structure cannot orphan equipment silently.
69. As a conduit designer, I want deleting an unoccupied Beam to preserve conduit and remove only orphaned Beam penetrations, so that deletion has a narrow, visible effect.
70. As a conduit designer, I want a separate 3D Beam layer enabled by default, so that authored structure is visible and controllable.
71. As a drawing reader, I want Beam footprints shown as gray building outlines in 2D, so that the plan communicates structural obstructions.
72. As a drawing reader, I want a separate 2D Beam layer control, so that I can reduce drawing clutter.
73. As a drawing reader, I want Beam selectable but not editable in 2D, so that properties remain inspectable without creating a second authoring workflow.
74. As a drawing reader, I do not want persistent Beam dimension text in 2D, so that the construction drawing remains readable.
75. As a drawing reader, I want Beam penetrations shown with simple symbols, so that conduit passages remain discoverable.
76. As a drawing reader, I want hole diameter and linked conduit shown only when a penetration is selected, so that detailed information is available without permanent clutter.
77. As a conduit designer, I want project JSON and construction Overlay exported independently, so that building and construction ownership remain explicit.
78. As a conduit designer, I want project export to download a new JSON file rather than overwrite my imported source, so that saving remains recoverable.
79. As a conduit designer, I want separate unsaved indicators for project and Overlay data, so that exporting one cannot imply the other was saved.
80. As a conduit designer, I want navigation away from either unsaved document to warn me, so that Beam or routing work is not lost.
81. As a conduit designer, I want successive exports of the same project to share a stable project identity, so that content edits do not break Overlay association.
82. As a conduit designer, I want the content SHA retained only as a revision fingerprint, so that I can detect changed building content without treating it as a new project.
83. As a conduit designer, I want importing a newer JSON with the same project identity to retain the current Overlay, so that Beam revisions do not erase construction work.
84. As a conduit designer, I want importing a different project identity to start a separate Overlay, so that construction data cannot leak between projects.
85. As a conduit designer, I want legacy project and Overlay files without project identity to migrate predictably, so that existing Demo work still opens.
86. As a source-data owner, I want all unedited nodes and unknown fields preserved semantically, so that Beam export does not discard Pascal or plugin data the Demo does not understand.
87. As a source-data owner, I accept changed whitespace and property order, so that export need not implement a text-preserving JSON patcher.
88. As a source-data owner, I want invalid imported Beam records preserved with diagnostics, so that the Demo does not destroy data it cannot render.
89. As a conduit designer, I want invalid Beams excluded from rendering, snapping, hosting, and collision, so that corrupt geometry cannot affect valid work.
90. As a conduit designer, I want new and edited Beams validated before commit, so that the authoring tools cannot create zero-length, non-positive, hostless, or contradictory geometry.
91. As a collaborator, I want the README to enumerate implemented Beam behavior, data ownership, persistence, and limits, so that I can evaluate which pieces belong in the company product.
92. As an AI agent, I want a linked current Beam contract and ADR, so that future changes preserve the accepted behavior and understand why the JSON boundary changed.
93. As a structural stakeholder, I want an explicit warning that Beam penetration is only a geometric construction expression, so that it is not mistaken for structural approval.
94. As a structural stakeholder, I want reinforcement, load paths, opening limits, and approval workflows declared out of scope, so that the Demo does not imply unsupported engineering conclusions.

## Implementation Decisions

- Use the glossary terms `Ceiling`, `Effective ceiling elevation`, `Beam`, `Beam face`, `Beam penetration`, `Beam positioning dimension`, `Project identity`, and `Unhosted device point` consistently.
- Introduce Beam as a documented Demo extension node in the project node collection. Do not add it to or present it as the upstream Pascal Core built-in kind union.
- Beam is the only editable building-node kind. Implement project editing through a narrow allowlist rather than exposing generic node mutation.
- A Beam records a stable ID, editable name, Level parent, two finite plan endpoints, positive width and height, host Ceiling identities, and the resolved effective Ceiling elevation with its explicit or derived basis. Maintain the Level's child relationship consistently when creating or deleting a Beam.
- Store plan endpoints, width, height, and elevation in metres. Present construction values in millimetres.
- Resolve effective Ceiling elevation from explicit Ceiling height when present; otherwise use the documented 2.7 m derived default. The resolved value and basis are system-maintained, not an independent user-editable Beam elevation.
- Require a Beam to intersect at least one Ceiling. Permit multiple intersected Ceilings and intervening gaps only when every participating Ceiling has the same effective elevation. Reject conflicting elevations rather than stepping, sloping, or splitting automatically.
- Give Beam its own 3D authoring session rather than reusing conduit route topology. Reuse the established surface-hit, pointer-frame coalescing, preview-versus-confirmed point, orthogonal constraint, cancellation, and accessible control conventions.
- The first click fixes the axis start and host context. Pointer movement creates a transient full-volume preview. The second click validates and commits the Beam. Preview state never mutates project JSON, Overlay, dirty state, or history.
- Use physical-surface snap candidates only for Beam authoring: Wall surfaces, Column surfaces, and existing Beam exposed surfaces. Do not offer Beam centreline or special endpoint snaps. Display the active target type and identity.
- Use 300 mm width and 500 mm height as initial Demo values, clearly not as structural standards. Retain the last-used width and height for subsequent Beams in the current editing session.
- Keep the Beam tool active after a successful commit. Escape cancels an unfinished Beam first and exits the tool when no unfinished Beam remains. Generate readable sequential names and allow later name editing.
- Provide one Beam-editing interface behind 3D selection: independent endpoint handles, whole-member planar translation, lateral nudge, name, width, height, length, and editable physical-clearance dimensions.
- Resolve all Beam pointer moves and numeric positioning to 5 mm increments. Treat each committed drag, nudge, or numeric submission as one workspace history operation.
- Derive positioning witnesses from physical surfaces. Side clearances use the first reliable parallel Wall or neighboring Beam face encountered to each side. End clearances use the first reliable Wall or Beam face along the Beam axis. Do not use centrelines, Column centres, or invented references.
- Recompute witnesses continuously during preview. For an angled Beam endpoint edit, calculate left and right side clearances using the candidate Beam direction at that endpoint. Omit any dimension whose reliable parallel witness cannot be established.
- Editing a side clearance translates the whole Beam laterally while preserving width, height, length, and direction. Editing an end clearance moves only the corresponding endpoint and may change length. Endpoint dragging may change both length and direction.
- Numeric dimension and size inputs use the established direct-commit interaction: Enter or blur validates and commits, with no separate confirmation button. Invalid values leave both documents and history unchanged.
- Permit solid intersections among Beams, Walls, and Columns as normal building junctions. Do not run conduit-penetration semantics or create construction holes for building-member intersections.
- Render Beam as a distinct oriented rectangular solid with six physical face definitions, but expose only the bottom, side, and end faces as authoring hosts. The top face touching Ceiling is not targetable.
- Extend host attachment vocabulary and serialization to include Beam without weakening the identity, face, normal, basis, Level, or local-position evidence required by existing hosts.
- Allow every current device type on every exposed Beam face. Orient its frame, display geometry, and physical ports from the selected face normal while preserving its existing device-type behavior.
- Beam edits preserve device and conduit world geometry. Revalidate every affected attachment after a preview and on commit; a relationship that no longer reaches the physical face becomes explicitly unhosted instead of retaining a stale host ID.
- Do not remove adjacent conduit when a Beam edit makes a mounted device unhosted. This is distinct from a direct user edit of a device point, which continues to follow the existing local-reconnection contract.
- Block Beam deletion while any device still has a valid attachment to it. Report the count and identities needed for the user to move or delete first.
- Treat Beam as a building obstacle for new conduit regardless of whether the pointer directly hit its mesh. Surface-attached conduit contact is legal; non-attached volume intersection is a conflict; an explicit active penetration bypass is legal.
- Reuse the established Tab entry-direction freeze and exit-host reattachment behavior for Beam. Generalize host-face intersection as needed rather than creating a Beam-specific keyboard mode.
- Do not create surface chases on Beam. Beam-face conduit is exposed surface routing.
- Persist Beam penetrations only in Overlay. Associate each penetration with the Beam and route element, retain entry/exit/direction evidence, and use the existing diameter plus 10 mm Demo clearance.
- Recompute affected penetration relationships after Beam edits. Remove records that no longer intersect, keep still-valid explicit penetrations, and mark newly created ordinary intersections as conflicts rather than synthesizing holes.
- Apply penetration cuts only to runtime/rendered Beam geometry. Do not mutate the Beam node into a permanently cut mesh or duplicate penetration ownership in project JSON.
- Deleting an unoccupied Beam removes its project node and relationships, invalidates or detaches affected conduit attachments, preserves conduit geometry, and removes Overlay penetrations whose host no longer exists.
- Add Beam to 3D and 2D building visibility controls, enabled by default. Render 2D Beam footprints as restrained gray outlines, permit selection and inspection, and keep all Beam authoring in 3D.
- Do not render permanent Beam name, width, height, length, or positioning dimensions in 2D. Show a compact Beam penetration symbol and reveal diameter and linked route only through selection.
- Introduce a stable top-level project identity when the first Beam edit makes a legacy project writable. Preserve it across subsequent exports and imports.
- Bind Overlay source ownership to project identity. Retain a content SHA as revision evidence, not identity. Migrate the active Overlay association when a legacy project first receives an identity.
- Importing the same project identity preserves the active Overlay and revalidates it against the new building revision. Importing a different identity initializes a separate Overlay after applying the existing unsaved-work protection.
- Export project JSON and Overlay independently through explicit controls and independent dirty states. Project export downloads a new file and never attempts an in-place overwrite of the imported source.
- Preserve every unedited source node, top-level field, plugin payload, metadata field, and unknown extension semantically. Exact whitespace, indentation, and property order are not part of the preservation contract.
- Parse Beam strictly enough to protect rendering and physical behavior while retaining invalid raw records. Invalid imported Beams produce precise diagnostics and remain excluded from rendering, snapping, hosting, dimensions, collision, and construction derivation.
- Use one chronological workspace history across project and Overlay transactions. A single command may update both documents atomically, and undo/redo must restore both sides together.
- Warn before leaving or replacing the workspace whenever either project or Overlay has unsaved changes. Exporting one document clears only its own dirty state.
- Keep the README as the current human-and-AI capability and data-ownership index. Add a detailed current Beam contract, update the Pascal support matrix to identify the extension, retain the ADR explaining the boundary change, and update all prior read-only statements in the same implementation change.
- State in user-facing documentation and the penetration interaction that the Demo does not evaluate structural loads, reinforcement, safe opening zones, allowable hole dimensions, edge clearances, codes, or approval.

## Testing Decisions

- Use one primary high-level Beam workspace transaction seam. It accepts current project data, Overlay data, history context, and an authoring command, and returns either an isolated preview, a structured rejection, or an atomic commit affecting one or both documents. Test observable geometry, identities, attachments, penetrations, diagnostics, dirty states, and undo data through this seam.
- Test creation from two points for orthogonal and angled Beams, including the 300 by 500 mm initial section, last-used dimensions, naming, Level membership, Ceiling association, and effective elevation basis.
- Test pointer preview isolation: starting, moving, snapping, cancelling, or producing an invalid preview must not mutate project data, Overlay data, dirty flags, or history.
- Test physical surface snapping for Wall, Column, and Beam surfaces, deterministic nearest-candidate selection, visible target metadata, and the absence of Beam centreline or special endpoint snapping.
- Test same-Ceiling, multiple same-elevation Ceiling, intervening-gap, no-Ceiling, and conflicting-elevation spans. Verify explicit Ceiling height wins and missing height is identified as a 2700 mm derived default.
- Test Beam geometry and face frames for horizontal and angled members: axis, width direction, top/bottom/side/end planes, normals, bases, bounds, and top-face exclusion.
- Test endpoint drag, whole-Beam translation, lateral nudge, width/height edit, name edit, and numeric length/clearance edits through the transaction seam.
- Test 5 mm quantization for positive and negative pointer movement, entered dimensions, angled endpoint motion, repeated nudges, and values near rounding boundaries.
- Test positioning witnesses against parallel Wall and neighboring Beam faces for both sides and both ends, including nearest-surface priority, angled Beam recalculation, witness changes during preview, and omission when no reliable parallel reference exists.
- Test that side-clearance edits translate the whole Beam without changing section, span, or angle; end-clearance edits move only the chosen endpoint; endpoint edits may change direction and update every displayed witness.
- Test rejection of zero-length, non-finite, non-positive section, hostless, conflicting-elevation, and otherwise invalid new or edited Beam geometry without partial mutation.
- Test legal Beam/Wall, Beam/Column, Beam/Beam endpoint contact and midspan overlap as building geometry that creates no conflict or penetration.
- Test all device types on bottom, side, and end Beam faces, with frame, orientation, dimensions, ports, and selection derived from the actual face. Test that the top face cannot host a device.
- Test Beam edits that leave a device attached, make it unhosted, or place it in a conflicted position. Assert that device and connected conduit world geometry remain unchanged and no direct-device local reconnection transaction runs.
- Test deletion rejection for one and multiple hosted devices, including a clear diagnostic, no project/Overlay mutation, and no history entry.
- Test successful deletion of an unoccupied Beam, preservation of conduit geometry, invalidation of obsolete conduit attachments, removal of orphaned Beam penetrations, and one atomic undo/redo entry.
- Test new conduit along every exposed Beam face and across adjacent face transitions using the established route semantics. Verify no Beam surface chase is created.
- Test ordinary conduit volume intersection from surface, suspended, and world-axis routing as a blocking conflict even when the pointer did not directly hit the Beam mesh.
- Test explicit Tab penetration through Beam at valid entry and exit points, frozen direction, exit-host reattachment, entry/exit evidence, route commit, and diameter-plus-10-mm hole size.
- Test penetration geometry for angled Beams and non-axis-aligned conduit. Verify runtime cutting follows the recorded direction and does not mutate project Beam geometry.
- Test Beam edits against still-valid, obsolete, and newly introduced intersections. Preserve explicit still-valid penetrations, remove obsolete records, and never promote a new collision to penetration automatically.
- Test project JSON round trips for Beam fields, project identity, Level relationships, Ceiling identities, effective elevation basis, unknown node kinds, unknown fields, plugin payloads, and metadata.
- Test that semantic values are preserved even when exported whitespace or property order changes.
- Test invalid imported Beam data for precise diagnostics, raw preservation on export, and exclusion from rendering, snapping, hosting, positioning dimensions, collision, and penetration derivation.
- Test project identity creation for legacy files, stability across multiple Beam edits and exports, and content-SHA changes between revisions.
- Test Overlay association migration from legacy SHA-only source metadata, same-project revision import, different-project import, and revalidation of Beam attachments after same-project replacement.
- Test independent project and Overlay dirty states, independent export clearing, unsaved-work warnings, and a transaction that dirties both documents.
- Test unified chronological history across alternating Beam and Overlay operations. Undo and redo must restore project nodes, Overlay attachments, conflicts, penetrations, identities, and dirty states consistently.
- Test 2D observable behavior through the existing plan integration seam: Beam layer visibility, gray footprint, selection, absence of persistent Beam dimensions, penetration symbol visibility, and selected-only penetration detail.
- Add thin 3D workspace integration tests only for behavior the domain seam cannot prove: tool activation, first/second click, live preview, Shift constraint, Escape lifecycle, continuous authoring, handles, accessible numeric inputs, layer controls, snap labels, and red conflict presentation.
- Do not test private React state, helper names, mesh implementation details, exact colors beyond established semantic tokens, animation frames, JSON whitespace, or property order.
- Reuse existing drawing, host transition, surface picking, device positioning, route collision, penetration, Overlay parsing, store history, scene-input, and 2D plan tests as prior art.
- Run focused tests during each implementation slice, then the full test suite and production build because this feature changes the parser boundary, shared building geometry, project/Overlay identity, 3D display, routing behavior, and 2D display.

## Out of Scope

- Editing any imported building-node kind other than Beam.
- Curved, segmented, sloped, tapered, haunched, arched, or non-rectangular Beams.
- Beams whose top steps across different Ceiling elevations.
- Automatic Beam layout, structural framing suggestions, or inference from Walls, Columns, Ceilings, imagery, or conduit.
- Beam centreline, special Beam endpoint, grid, arbitrary midpoint, perpendicular-foot, or configurable CAD object-snap modes beyond the confirmed physical-surface candidates.
- Manual selection or cycling of positioning-dimension reference objects.
- Persistent Beam width, height, name, length, or positioning annotations in 2D.
- 2D Beam creation, dragging, resizing, or numeric editing.
- Beam surface chases, notches, recesses, or embedded conduit.
- Structural load analysis, reinforcement modeling, safe-opening zones, code compliance, allowable hole checks, edge-distance checks, or approval workflow.
- Automatically moving, stretching, rerouting, reconnecting, or deleting conduit when a Beam changes.
- Automatically moving or deleting a device when its Beam host changes.
- Automatically converting a new Beam/conduit collision into a penetration.
- In-place overwrite of the imported project file or browser-specific file-system save APIs.
- Byte-for-byte preservation of input JSON formatting or property order.
- Folding Beam, conduit, devices, penetrations, and construction drawings into one combined persisted document.
- Treating Beam as an upstream Pascal Core built-in kind before the company schema adopts it.

## Further Notes

- The primary architectural seam is a workspace-level Beam transaction because one accepted action may change project JSON, Overlay attachment truth, penetration records, conflict diagnostics, dirty states, and unified history together. Implementing only a mesh transform or only a node mutation would leave the workspace inconsistent.
- Beam authoring should reuse the existing surface-hit and preview interaction concepts, but it is not a conduit route and must not inherit source-device, port, circuit, branch, or stock-length rules.
- Building-member overlap and conduit penetration are intentionally different domains. Beams may overlap Walls, Columns, and other Beams without construction-hole semantics; conduit may enter Beam volume only through an explicit penetration action.
- A device becoming unhosted because its Beam moved is intentionally different from the user directly moving that device. The former preserves all world geometry and exposes an invalid host; the latter continues to follow the existing device-positioning and local-reconnection contract.
- README must remain an index of implemented behavior rather than a roadmap. Add Beam claims there only in the implementation change that makes the tested behavior real.
- This spec is ready for implementation-ticket decomposition without reopening the confirmed product decisions.
