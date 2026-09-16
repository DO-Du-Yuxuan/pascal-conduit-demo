# Beam layout reference plane and authoring feedback

Status: ready-for-agent

Source decisions: `CONTEXT.md`, `docs/adr/0003-author-demo-beams-in-project-json.md`, and the implemented Beam contract in `docs/beam-authoring.md`

## Problem Statement

Beam authoring currently requires a visible Ceiling underside to establish the first point. Turning on the Ceiling layer makes top-down placement difficult because the Ceiling obscures the building below, while turning it off removes the surface required to start drawing. This forces the user to choose between seeing the plan clearly and being able to author a Beam.

The current two-click interaction is also unreliable. After the first point, the transient Beam solid can become the frontmost raycast target and prevent the Ceiling behind it from receiving the second click. The interface then appears to accept the start while silently refusing the endpoint. Existing coverage tests isolated helpers and completed-Beam editing but did not exercise the complete two-click creation flow with transient geometry in front of the authoring surface.

Beam orthogonal drawing and physical-surface snaps are difficult to discover. Orthogonal behavior is hidden behind a hold-only Shift modifier with no persistent state indicator. A physical snap changes the candidate coordinate and shows only a small text status; the pointer itself and the scene do not clearly distinguish a free point, a real surface snap, an explicit different-elevation crossing, or a rejected candidate. Transient Beams can also appear inconsistently transparent or solid, leaving the user unsure whether geometry has been committed.

## Solution

Add one shared per-Level **Layout reference plane** used by Beam authoring and eligible horizontal device-point placement. It is enabled and visible by default independently of the Ceiling layer. Its initial height comes from the largest-area Ceiling on that Level; when no Ceiling exists, it uses the identified 2700 mm derived default. Users can hide the plane or enter a different height, and the per-Level setting persists in the Overlay. Changing it affects only new and uncommitted geometry, never existing Beams or device points.

Use the plane as an interaction surface, not a building host or Beam elevation source. Beam points resolve their plan coordinates from it, while committed Beam elevation continues to come from the source Ceiling. A Beam normally cannot continue into a different-effective-elevation Ceiling region. Holding Ctrl on Windows/Linux or Command on macOS explicitly crosses that boundary while retaining the source Ceiling elevation; it never steps, splits, or retargets the Beam vertically.

Unify Beam start, pointer preview, and endpoint confirmation behind one Beam authoring session and one interaction plane. Make transient Beam geometry non-pickable for authoring so it cannot block its own endpoint. Keep direct visible-Ceiling authoring available when the Layout reference plane is hidden. When both the plane and Ceiling layer are unavailable, reject starting with a clear instruction rather than guessing an airborne point.

Turn orthogonal lock into a visible state. Shift toggles it rather than requiring an undiscoverable continuous hold. It defaults on when the Beam tool is first used, remembers its last state during the session, constrains the candidate to world X or Z within the plane, and never alters committed geometry retroactively.

Allow Wall, Column, existing Beam surfaces, and Ceiling polygon edges to be physical endpoint snap targets in addition to free Layout-reference-plane points. Give the pointer and preview a consistent state language: white crosshair for a free valid point, green centered snap cue plus scene reticle and target name for a physical snap, orange for an explicit Ctrl/Command elevation crossing, and red prohibited feedback plus a reason for an invalid candidate. Legal transient Beams remain translucent gray-blue, crossing previews are translucent orange, invalid previews are translucent red, committed Beams are solid gray, and selection adds solid orange emphasis. A transient preview never becomes visually solid.

## User Stories

1. As a Beam author, I want to draw while the Ceiling layer is hidden, so that I can see Walls, Columns, rooms, and existing construction from above.
2. As a Beam author, I want to draw from a top-down camera without a Ceiling blocking the model below, so that plan placement remains readable.
3. As a Beam author, I want one Layout reference plane on each Level, so that every floor can retain an appropriate editing height.
4. As a Beam author, I want the active Level's Layout reference plane enabled by default, so that Beam drawing works without setup.
5. As a Beam author, I want the plane to be independent of Ceiling visibility, so that hiding a rendering layer does not remove my authoring surface.
6. As a point-layout author, I want eligible horizontal device points to share the same plane, so that Beam and point placement use one understandable editing reference.
7. As a point-layout author, I want Wall-only devices to retain their existing host rules, so that a shared horizontal plane does not broaden every device's installation semantics.
8. As a Beam author, I want a Level with one or more Ceilings to choose a deterministic initial plane height, so that the plane does not jump unpredictably.
9. As a Beam author, I want the largest-area Ceiling's effective elevation to supply the initial plane height, so that the dominant space provides a useful default.
10. As a Beam author, I want a Level without Ceiling data to use an identified 2700 mm derived default, so that missing source data remains honest.
11. As a Beam author, I want the plane-height control to name whether its value came from a Ceiling or a derived default, so that I know the basis.
12. As a Beam author, I want to hide or show the plane, so that the editing aid does not add unwanted visual clutter.
13. As a Beam author, I want to enter a plane height explicitly, so that the authoring surface can match the view or installation context I need.
14. As a Beam author, I want a manually changed height to remain explicit rather than automatically following later Ceiling selection, so that my setting is stable.
15. As a Beam author, I want each Level's visibility and height retained when I switch Levels, so that settings do not leak between floors.
16. As a returning author, I want Layout reference plane settings restored from the Overlay, so that reopening construction work preserves my editing setup.
17. As a source-data owner, I do not want the Layout reference plane written into project JSON, so that an editor aid is never represented as a building node.
18. As a Beam author, I do not want moving the Layout reference plane to move existing Beams, so that adjusting an editor aid cannot alter building geometry.
19. As a point-layout author, I do not want moving the Layout reference plane to move existing device points, so that completed work remains stable.
20. As a Beam author, I want the Layout reference plane to affect the current preview and future creation only, so that its scope is predictable.
21. As a Beam author, I want Beam elevation to continue coming from the source Ceiling, so that the Layout reference plane does not silently change the building contract.
22. As a Beam author, I want the first point, pointer preview, and second point to use one consistent authoring surface, so that event handling does not change mid-operation.
23. As a Beam author, I want the second click to work when it lands visually on top of the transient Beam, so that the preview cannot block its own completion.
24. As a Beam author, I want the second click to work with the Ceiling layer hidden, so that the reference-plane workflow is complete rather than start-only.
25. As a Beam author, I want the second click to work in top, orthographic, perspective, and oblique views, so that camera choice does not determine whether creation succeeds.
26. As a Beam author, I want an invalid second point to keep the preview active and explain the rejection, so that silence is never mistaken for a broken click.
27. As a Beam author, I want visible Ceiling authoring to remain available when the Layout reference plane is hidden, so that I can still work directly from real geometry.
28. As a Beam author, I want a clear instruction when both the Layout reference plane and Ceiling layer are unavailable, so that the tool does not guess an airborne host.
29. As a Beam author, I want orthogonal lock enabled by default when I first use the tool, so that common straight placement is immediate.
30. As a Beam author, I want Shift to toggle orthogonal lock, so that I do not need to hold a hidden modifier throughout pointer movement.
31. As a Beam author, I want the panel to show whether orthogonal lock is on or off, so that the constraint is discoverable.
32. As a Beam author, I want brief pointer-adjacent confirmation when Shift changes the state, so that keyboard input has visible feedback.
33. As a Beam author, I want orthogonal lock to constrain the candidate to world X or Z on the Layout reference plane, so that the resulting axis is predictable.
34. As a Beam author, I want disabling orthogonal lock to permit a free angled Beam, so that non-orthogonal structure remains supported.
35. As a Beam author, I want the last orthogonal state remembered for the current session, so that consecutive Beams use my chosen workflow.
36. As a Beam author, I want a Wall's real physical surface to be a valid endpoint, so that a Beam can terminate visibly against a Wall.
37. As a Beam author, I want a Column surface to remain a valid endpoint, so that structural contact is precise.
38. As a Beam author, I want an existing Beam surface to remain a valid endpoint, so that new members can connect to authored structure.
39. As a Beam author, I want a Ceiling polygon edge to be a valid endpoint, so that a Beam can end exactly at the modeled Ceiling boundary.
40. As a Beam author, I want a free point on the Layout reference plane when no physical target is nearby, so that surface snaps do not prevent ordinary placement.
41. As a Beam author, I want a Wall endpoint to permit the existing small solid overlap needed to avoid a visible gap, while retaining the axis endpoint on the physical Wall face.
42. As a Beam author, I want a Ceiling-edge endpoint to stop exactly at that edge, so that it does not extend beyond the modeled region automatically.
43. As a Beam author, I want a white crosshair over a valid free point, so that I know a click will place ordinary geometry.
44. As a Beam author, I want the crosshair to gain a green center when a physical surface snap is active, so that the pointer itself confirms snapping.
45. As a Beam author, I want a green scene reticle and target name for a physical snap, so that I know which Wall, Column, Beam, or Ceiling edge owns the candidate.
46. As a Beam author, I want an orange pointer and preview while explicitly crossing a Ceiling elevation boundary, so that the override cannot be mistaken for normal placement.
47. As a Beam author, I want a red prohibited pointer and readable reason for an invalid candidate, so that rejection is immediate and actionable.
48. As a Beam author, I want pointer feedback to return to the ordinary state when I leave a snap or invalid region, so that stale feedback does not mislead me.
49. As a Beam author, I want physical-surface snaps distinguished from auxiliary alignment, so that real coordinate changes are not confused with a visual guide.
50. As a Beam author, I want a legal uncommitted Beam to remain translucent gray-blue, so that preview geometry cannot be mistaken for saved structure.
51. As a Beam author, I want an explicit different-elevation crossing preview to remain translucent orange, so that the exceptional path stays visible.
52. As a Beam author, I want an invalid preview to remain translucent red, so that invalidity is communicated without implying a committed object.
53. As a Beam author, I want a committed Beam to be solid gray, so that saved structure is visually distinct from preview.
54. As a Beam author, I want selection to add solid orange emphasis without changing commit status, so that selection and preview have separate visual meanings.
55. As a Beam author, I do not want an active preview to alternate between translucent and solid, so that visual state is stable.
56. As a Beam author, I want normal placement to stop before entering a different-effective-elevation Ceiling region, so that Beam elevation remains truthful by default.
57. As a Beam author, I want holding Ctrl or Command to explicitly cross a different-elevation Ceiling boundary, so that exceptional straight members remain possible.
58. As a Beam author, I want the crossing Beam to retain its source Ceiling elevation, so that it remains one straight rectangular member.
59. As a Beam author, I do not want an elevation crossing to step, slope, split, or adopt the target Ceiling height automatically, so that the override has one precise meaning.
60. As a Beam author, I want releasing Ctrl or Command to restore normal rejection immediately, so that the exceptional permission cannot be forgotten.
61. As a Beam author, I want the preview to state the retained elevation while crossing, so that I understand the submitted geometry.
62. As a downstream engineer, I want the README and Beam contract updated with the implemented reference-plane and feedback behavior, so that human and AI readers see current truth.

## Implementation Decisions

- Use `Layout reference plane`, `Orthogonal lock`, `Surface snap`, `Beam`, `Ceiling`, and `Explicit Ceiling elevation crossing` exactly as defined in the project glossary.
- Keep the existing `Installation reference plane` concept for a device's persisted mount relationship. The Layout reference plane is a shared authoring surface and must not be mislabeled as a Ceiling or building host.
- Store one Layout reference plane setting per Level in Overlay-owned editing state. Each setting records visibility, height, and enough basis information to distinguish a Ceiling-derived default, the 2700 mm derived fallback, and an explicit user value.
- Default every Level's Layout reference plane to visible. Select the largest-area valid Ceiling on that Level as the deterministic default-height source; fall back to 2.7 m when none exists.
- Once the user edits a Level's plane height, keep it explicit and stable. Changing Ceiling visibility, camera, selected Beam, or selected device must not rewrite it.
- Plane visibility and height affect only new or uncommitted placement. They never batch-move or rehost an existing Beam or device point.
- Eligible horizontal-placement device types may consume the shared plane interaction. Existing host eligibility remains authoritative; the plane does not make Wall-only devices horizontally mountable.
- Treat the Layout reference plane as an interaction surface only. Beam project data continues to record Ceiling relationships and source-Ceiling elevation evidence, never the plane as a Beam host.
- Use one Beam authoring session interface for start, live candidate, endpoint, constraint state, snap state, elevation-crossing state, validation, cancellation, and commit.
- Route all Layout-reference-plane pointer movement and clicks through that session. Keep visible-Ceiling hits as an alternate input when the plane is hidden.
- Make transient Beam preview geometry non-pickable during authoring or explicitly forward its events to the authoring surface. It must never become the frontmost object that suppresses endpoint confirmation.
- Do not depend on a scene-wide fallback sphere for normal two-click Beam creation. The owning authoring surface must handle both points directly.
- When neither a visible Layout reference plane nor a visible Ceiling provides a legal authoring surface, reject start with a user-facing instruction.
- Keep preview isolation: pointer movement, snap changes, Shift toggles, Ctrl/Command state, invalid clicks, and cancellation never mutate project JSON, Overlay persistence, dirty states, or history.
- Make Orthogonal lock a persistent state within the current app session. It defaults on for first Beam-tool activation, Shift toggles it, a visible control exposes the same state, and both keyboard and control updates produce immediate feedback.
- Orthogonal lock projects the current candidate to world X or Z in the active plane relative to the confirmed start. It does not modify committed Beams or replace Surface snap semantics.
- Extend Beam endpoint Surface snap candidates with valid Ceiling polygon edges. Continue using physical Wall, Column, and Beam surfaces; do not add centrelines or synthetic Beam endpoint snaps.
- A Wall-surface endpoint may use the established small solid overlap for clean visual junction while retaining physical-face evidence. A Ceiling-edge endpoint stops at the edge without automatic extension.
- Distinguish pointer states explicitly: free-valid, physical-snap, explicit-elevation-crossing, and invalid. Each state supplies cursor presentation, scene reticle where applicable, label/reason text, and preview color.
- Use a crosshair for Beam authoring. Free-valid is white; physical snap adds a green center and green reticle; explicit elevation crossing is orange; invalid uses a red prohibited form. Clear state immediately when the candidate changes.
- Use translucency exclusively for uncommitted Beam geometry: gray-blue valid, orange crossing, red invalid. Committed Beams are solid gray and selection supplies solid orange emphasis. Do not use opacity to encode validity separately from commit state.
- Reject crossing into a different-effective-elevation Ceiling by default. While Ctrl/Command is held, permit one straight Beam to continue at its source Ceiling elevation and record the explicit crossing evidence needed to reproduce and explain that decision.
- Ctrl/Command crossing is a hold-only exception, not a sticky mode. Releasing the key revalidates the active candidate under normal rules.
- Do not reinterpret explicit Ceiling elevation crossing as conduit penetration, Beam splitting, a stepped/sloped Beam, or adoption of the target Ceiling height.
- Update the living README and detailed Beam contract only when the implementation and executable tests establish the behavior.

## Testing Decisions

- Use the Beam authoring session as the primary high-level seam. Given current Level geometry, Ceiling regions/elevations, Layout reference plane state, confirmed start, pointer candidate, constraint keys, and snap candidates, assert the observable preview state, target evidence, rejection reason, and commit transaction.
- Through this seam test free points, Orthogonal lock on/off, angled candidates, physical Surface snaps, Ceiling-edge snaps, different-elevation rejection, Ctrl/Command crossing, retained source elevation, cancellation, and invalid-host behavior.
- Test Layout reference plane state through Overlay parsing and workspace transactions: per-Level defaults, largest-area Ceiling selection, 2700 mm fallback, explicit edits, independent visibility, export/import, legacy Overlay migration, and no movement of existing objects.
- Test that previews and rejected interactions do not mutate project JSON, Overlay persistence, dirty flags, or history; one successful Beam commit remains one chronological workspace operation.
- Add a focused mounted 3D interaction test for the complete two-click flow. Exercise Ceiling hidden with plane visible, Ceiling visible in top view, endpoint visually covered by the transient Beam, oblique view, and invalid second click with a visible reason.
- Assert that transient Beam geometry cannot consume or suppress the endpoint event. Test user-observable successful commit rather than a particular raycast implementation.
- Add thin UI tests for the plane visibility/height controls, visible Orthogonal-lock state, Shift toggle, pointer-state class/data contract, scene snap reticle, target/rejection labels, and consistent preview versus committed appearance.
- Test Wall, Column, Beam-surface, Ceiling-edge, and free-plane endpoint candidates. Preserve regression coverage that centreline and synthetic endpoint candidates are absent.
- Test Ctrl on Windows/Linux and Command on macOS as equivalent hold-only crossing modifiers, including release restoring rejection before commit.
- Test eligible horizontal device placement through the shared plane without broadening Wall-only device host eligibility or moving existing devices after a plane-height edit.
- Reuse existing Beam authoring, surface-picking, Beam positioning, device positioning, Overlay migration, workspace history, and 3D interaction tests as prior art.
- Do not assert private React state, helper names, exact mesh topology, renderer event-order internals, or precise color hex values. Assert accessible controls, semantic pointer/preview states, committed data, and visible results.
- Run focused tests during implementation, then the full test suite and production build because the change affects Overlay schema, 3D authoring, shared placement behavior, and display contracts.

## Out of Scope

- Moving existing Beams or device points when a Layout reference plane height changes.
- Writing Layout reference planes into project JSON or representing them as Ceiling, Slab, Beam, or other building nodes.
- Giving Wall-only devices new horizontal-plane installation eligibility.
- Multiple independently editable Layout reference planes on one Level.
- Automatically splitting a Level plane to match every Ceiling elevation region.
- Automatically switching the plane height as the pointer crosses rooms.
- Stepped, sloped, segmented, or automatically split Beams across different Ceiling elevations.
- Making Ctrl/Command elevation crossing a persistent toggle.
- Changing an existing Beam's elevation through the Layout reference plane.
- Adding Wall, Column, or Beam centrelines as new snap targets.
- Persistent Beam dimensions or reference-plane graphics in the 2D construction drawing.
- Changing conduit Tab penetration behavior or conflating it with Beam elevation crossing.
- Redesigning general camera controls, non-Beam route cursors, or unrelated device editing.

## Further Notes

- The observed endpoint bug is consistent with transient Beam geometry becoming the frontmost raycast target while neither the preview nor the obscured Ceiling owns a reliable endpoint handler. The required behavior deliberately specifies ownership and outcome rather than locking implementation to this diagnosis.
- The Layout reference plane solves an interaction problem; it must remain distinct from both the real Ceiling and a device's persisted Installation reference plane mount.
- Surface snap means the candidate coordinate resolves to a real physical face or edge. Orthogonal lock or an incompatible-target projection is auxiliary alignment and must not be labeled as a snap.
- README is the implemented-capability index, not a roadmap. Do not claim this optimization there until the tested workflow exists.
- This spec is ready for tracer-bullet ticket decomposition without reopening the confirmed design decisions.
