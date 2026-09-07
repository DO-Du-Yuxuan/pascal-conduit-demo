# Device point precision placement and user-guided conduit routing

Status: implemented

Implementation update (2026-09-07): during implementation the user replaced preview-plus-confirm positioning with 3D dimension guides and direct commit on Enter or input blur. Wall-device horizontal positioning now uses the nearest opening edge, falling back to a wall end, rather than another device point. Ctrl/Command multi-selection applies both suspended elevation and wall-device bottom-edge height edits to eligible selected devices.

Source decisions: `CONTEXT.md` and `docs/adr/0001-device-first-routing-and-manual-local-reconnection.md`

## Problem Statement

Device points are currently placed at the raw position hit by the pointer, and a user cannot subsequently position them with reliable construction dimensions. Wall-mounted devices do not expose a minimal horizontal and vertical edge clearance, floor-mounted devices do not expose stable clearances to nearby walls, and devices that should be fixed below ceilings or beams cannot be placed honestly when those hosts are absent from the imported building JSON.

Conduit drawing is also imprecise at connection boundaries. Host projection and orthogonal drawing exist, but there is no unified object-snap behavior for compatible device ports, open conduit endpoints, legal branch locations, or host edges and corners. A pointer can therefore suggest a visually plausible location without establishing the intended physical relationship.

Moving a connected device point is unsafe with the current data model because device centers, ports, conduit endpoints, fittings, chases, penetrations, and topology references store related but separate geometry. Updating only the device position can leave a route that is topologically connected but geometrically detached. The user needs a small, predictable editing workflow that preserves the unaffected network and makes every disconnected state explicit.

## Solution

Make device points the primary objects that users place precisely before or while connecting conduit. Initial placement remains pointer-driven, but selecting or placing a device point exposes only the minimum useful 3D edge-clearance dimensions. Editing a dimension previews and then moves only the selected device point. Wall devices use a bottom-edge height and a horizontal edge clearance to the nearest suitable same-wall device or, when none exists, the nearest wall end. Floor and installation-reference-plane devices use edge clearances to a stable near-orthogonal pair of wall faces.

When a ceiling or beam is absent from the building model, expose a per-level installation reference plane at a default elevation of 2700 mm above the finished floor. The plane is an explicit editing aid, not a fabricated building host. It enables users to place luminaires and sprinkler heads and to change their elevations individually or through Ctrl/Command multi-selection.

Keep conduit routing user-guided. The user selects a valid source, confirms intermediate route points, and connects to a compatible device port, open conduit endpoint, or legal branch. Object snaps refine the preview route point while host-surface orthogonal constraints and explicit world-axis locks retain priority. There is no numeric conduit-length entry and no automatic route generation.

When a connected device point moves, remove all conduit legs directly adjacent to that device up to the nearest stable connection boundary. Show a short disappearance animation, leave truthful open conduit endpoints and unconnected device ports, and let the user manually redraw only the missing local legs. Moving the device and removing its local dependencies is one atomic, undoable operation. Incomplete reconnection may be saved, but it must be diagnosed explicitly.

## User Stories

1. As a conduit designer, I want device points to be distinct from connection ports and route points, so that each kind of object has predictable editing behavior.
2. As a conduit designer, I want to place a device point approximately with the pointer, so that initial layout remains fast.
3. As a conduit designer, I want placement to respect each device type's supported installation context, so that invalid point positions are rejected visibly.
4. As a conduit designer, I want only the selected or currently placed device point to show positioning dimensions, so that the 3D workspace stays readable.
5. As a conduit designer, I want positioning dimensions to disappear when the device point is no longer selected, so that dimensions do not clutter the model.
6. As a conduit designer, I want dimensions to use device edges rather than the center, so that I can enter construction clearances without calculating half the device size.
7. As a conduit designer, I want a wall device's vertical dimension to measure from the finished floor to its bottom edge, so that mounting height matches site practice.
8. As a conduit designer, I want a wall device's horizontal dimension to measure between device edges when a nearby device point exists on the same wall, so that aligned socket, switch, and network groups can be spaced directly.
9. As a conduit designer, I want the nearest suitable same-wall device point to remain fixed when I edit the selected device's horizontal clearance, so that only the highlighted device moves.
10. As a conduit designer, I want the horizontal dimension to fall back to the nearest wall end when there is no suitable same-wall device point, so that every wall device has a useful positioning reference.
11. As a conduit designer, I want an established horizontal reference to remain stable while editing, so that the dimension does not jump to another object as the selected device moves.
12. As a conduit designer, I want a deleted, moved-to-another-wall, or otherwise invalid reference device to fall back to a valid nearest wall end, so that an old reference cannot corrupt later edits.
13. As a conduit designer, I want floor device points to show edge clearances to two nearby, near-orthogonal wall faces, so that their plan position can be entered without world-coordinate calculations.
14. As a conduit designer, I want installation-reference-plane device points to use the same two-direction plan positioning behavior, so that suspended devices can be located consistently.
15. As a conduit designer, I want the chosen wall references to remain stable after placement, so that later numeric edits have an unambiguous basis.
16. As a conduit designer, I want the system to show only one reliable dimension when a second near-orthogonal reference cannot be established, so that the UI never invents a measurement.
17. As a conduit designer, I want editing a dimension to preview the device at its proposed location before committing, so that I can catch an invalid value.
18. As a conduit designer, I want invalid, non-finite, out-of-host, or geometrically impossible values to be rejected without changing the device or network, so that numeric editing is safe.
19. As a conduit designer, I want changing a device size to update edge dimensions and physical ports consistently, so that size editing cannot leave stale connection geometry.
20. As a conduit designer, I want a missing ceiling or beam to be represented honestly, so that an editing aid is never mistaken for imported building data.
21. As a conduit designer, I want each level to offer an installation reference plane at 2700 mm above its finished floor by default, so that I can place top-mounted equipment immediately.
22. As a conduit designer, I want the active installation reference plane to be visible and lightly distinguished from building geometry, so that I know where a suspended point will land.
23. As a conduit designer, I want luminaires and sprinkler heads to be placeable on the active installation reference plane, so that missing ceiling and beam geometry does not block layout work.
24. As a conduit designer, I want a reference-plane-mounted device to retain its level and explicit elevation without a fabricated ceiling or beam host ID, so that exported Overlay data remains truthful.
25. As a conduit designer, I want to edit the elevation of one selected suspended device point, so that exceptional mounting heights are supported.
26. As a conduit designer, I want Ctrl on Windows/Linux or Command on macOS to add device points to a multi-selection, so that I can edit several suspended devices together.
27. As a conduit designer, I want a multi-selection elevation edit to affect only eligible reference-plane device points, so that wall and floor devices are not moved accidentally.
28. As a conduit designer, I want all eligible selected suspended device points to move to the entered elevation as one operation, so that their mounting plane remains consistent.
29. As a conduit designer, I want mixed or partially ineligible multi-selections to explain which devices will not move before commit, so that bulk editing is predictable.
30. As a conduit designer, I want conduit drawing to remain controlled by my confirmed route points, so that the system does not choose a route for me.
31. As a conduit designer, I want no numeric conduit-length entry in this MVP, so that connection work remains focused on devices and topology rather than drafting every segment length.
32. As a conduit designer, I want Space to retain its existing selection-tool shortcut, so that the new feature does not conflict with established controls.
33. As a conduit designer, I want the pointer to snap to compatible device ports, so that completed routes have exact physical connections.
34. As a conduit designer, I want the pointer to snap to open conduit endpoints, so that I can reconnect a locally removed leg precisely.
35. As a conduit designer, I want the pointer to snap to legal positions on an existing segment when branching is supported, so that branch topology and geometry agree.
36. As a conduit designer, I want the pointer to snap to host edges and corners, so that guided route points can align with meaningful building geometry.
37. As a conduit designer, I want an active snap to show a small type-specific marker and readable target label, so that I know what will be confirmed.
38. As a conduit designer, I want incompatible ports and illegal branch positions to be excluded or visibly rejected, so that proximity alone cannot create an invalid connection.
39. As a conduit designer, I want object snapping to affect the preview route point before it becomes a confirmed route point, so that moving the pointer never writes permanent route geometry.
40. As a conduit designer, I want host-surface orthogonal mode to take priority over an incompatible snap candidate, so that snapping cannot silently create a diagonal segment.
41. As a conduit designer, I want a world X, Y, or Z lock to take priority over an incompatible snap candidate, so that an explicit axis constraint is preserved.
42. As a conduit designer, I want a non-collinear snap target to produce an auxiliary alignment point rather than a false connection, so that I can confirm a turn and continue toward the target.
43. As a conduit designer, I want a target on the active constrained line to snap and connect directly, so that a redundant intermediate point is unnecessary.
44. As a conduit designer, I want existing host transitions and Tab penetration behavior to continue working with snapping, so that precision improvements do not regress established drawing flows.
45. As a conduit designer, I want Enter to continue completing only already confirmed route points, so that the live preview is never silently committed.
46. As a conduit designer, I want an explicitly completed route that does not reach a device to remain a visible open conduit endpoint, so that phased construction remains possible.
47. As a conduit designer, I want incomplete or unrooted connections to remain saveable with explicit diagnostics, so that work can continue without pretending it is complete.
48. As a conduit designer, I want moving one unconnected device point to leave all unrelated objects unchanged, so that precise edits are local.
49. As a conduit designer, I want moving a connected terminal device to remove its directly adjacent conduit leg, so that no stretched or detached pipe remains.
50. As a conduit designer, I want moving a device inserted between two conduit legs to remove both adjacent legs, so that both sides become truthful open endpoints.
51. As a conduit designer, I want moving a multi-port panel to remove every directly adjacent conduit leg, so that no old port coordinate remains connected.
52. As a conduit designer, I want local removal to stop at the nearest stable port, fitting, confirmed route point, or open route endpoint, so that the rest of the circuit is preserved.
53. As a conduit designer, I want fittings, chases, penetrations, and port references owned only by removed local legs to be removed or repaired atomically, so that there are no orphan construction records.
54. As a conduit designer, I want affected local conduit to highlight and then disappear with a brief animation, so that I understand what the move changed.
55. As a conduit designer, I want the disappearance animation to be presentation-only, so that saved state does not depend on animation timing.
56. As a conduit designer, I want the moved device's affected ports to become explicitly unconnected, so that topology never claims a geometric connection that no longer exists.
57. As a conduit designer, I want every preserved network-side boundary to become an open conduit endpoint, so that I have an exact place from which to redraw.
58. As a conduit designer, I want to redraw each missing local leg with the normal user-guided drawing workflow, so that no special automatic route is imposed.
59. As a conduit designer, I want multiple missing legs to be reconnectable in any order, so that moving a panel does not trap me in a forced sequence.
60. As a conduit designer, I want the interface to report outstanding unconnected device ports and open conduit endpoints, so that I can see unfinished local reconnections.
61. As a conduit designer, I want one undo action to restore the previous device position and every locally removed dependency, so that a mistaken move is completely reversible.
62. As a conduit designer, I want redo to repeat the complete move-and-remove transaction, so that history remains coherent.
63. As a conduit designer, I want Overlay export and re-import to preserve device positioning references, installation reference elevations, open endpoints, and connection truth, so that the edit survives a session boundary.
64. As a product owner, I want all of these changes confined to the independent conduit Overlay and 3D editing experience, so that Pascal JSON, Parser, Evaluation Handoff, and G1-G4/S1 conclusions remain unchanged.

## Implementation Decisions

- Use the glossary terms `Device point`, `Confirmed route point`, `Preview route point`, `Installation reference plane`, and `Local reconnection` consistently. A connection port and a route control point must never be modeled or labeled as a device point.
- Preserve the current device-first rooted-network rules: a normal route starts from a compatible source device, connected device port, existing branch, or open conduit endpoint. Explicit open endpoints remain valid intermediate construction state.
- Keep routing user-guided. Do not introduce numeric conduit-length entry, automatic end-to-end routing, automatic local reconnection, or suggested replacement routes.
- Keep Space bound to the selection tool. Keep left click as route-point confirmation, Enter as completion from confirmed route points only, Shift as the established host-surface orthogonal control, the arrow controls as world-axis locks, and Tab as the established penetration workflow.
- Introduce one snap-candidate resolution layer before route-point confirmation. It collects eligible candidates, ranks them deterministically within a screen-space tolerance, applies the active host/axis constraint, and returns either a true snap, an auxiliary alignment point, or no snap.
- The initial snap vocabulary is limited to compatible device ports, open conduit endpoints, legal existing-segment branch positions, and host edges or corners. Device centers, arbitrary device edges, grids, generic midpoints, perpendicular feet, projected extensions, and free intersections are not snap targets in this MVP.
- Constraint priority is explicit world-axis lock first, host-surface orthogonal constraint second, and unconstrained object snap last. A candidate that cannot satisfy the active constraint may contribute an auxiliary alignment point but must not be reported as connected.
- Snap presentation must identify the candidate type and target object without changing Overlay data until the point or connection is confirmed.
- Add stable positioning references for device points. A reference records its basis and source object identity so that numeric editing does not continuously switch to whichever object becomes closest.
- A wall device's vertical value is the clear distance from the level's finished floor to the device's bottom edge.
- A wall device's horizontal value is the clear edge-to-edge distance to the nearest suitable same-wall device point. If none exists, it is the clear distance from the nearest device edge to the nearest valid end of that wall face.
- Editing an inter-device clearance moves only the selected device point. The reference device remains fixed. When the reference device is deleted, moved off the wall, or otherwise becomes invalid, the selected device falls back to a valid nearest wall end reference.
- Floor and installation-reference-plane devices use clear distances from their footprint edges to a stable nearby pair of near-orthogonal wall faces. When only one reliable reference exists, expose one dimension and do not synthesize a second.
- Dimension text and editable controls exist only in the 3D placement/selection state. They do not add permanent positioning dimensions to the 2D construction annotations.
- Dimension editing is preview-first. No Overlay mutation occurs until the proposed device position and applicable host/reference constraints validate and the user confirms it.
- Device movement must be implemented as a domain transaction, not as a mesh transform. It recalculates the device position, mount/reference data, frame, orientation where applicable, and every physical port position.
- Device size changes must use the same device-geometry rebuilding capability so that edge dimensions and port positions cannot become stale.
- Add a per-level installation reference plane with a default elevation of 2700 mm above the level's finished floor. The plane is editor-owned Overlay metadata or equivalent explicit editing state and must not create a ceiling, beam, slab, or other Pascal building node.
- A device placed on an installation reference plane records an explicit level and elevation/reference relationship without a fabricated host attachment. Its world position remains available for rendering and routing.
- The active installation reference plane is visible only when relevant to placement or editing and is visually distinct from real building surfaces.
- Ctrl additive selection and macOS Command additive selection select multiple device points without changing established camera input. Bulk elevation editing applies only to eligible installation-reference-plane devices and commits as one history entry.
- Moving a connected device performs manual local reconnection semantics from ADR-0001. It removes every directly adjacent conduit leg up to the nearest stable connection boundary and never stretches or automatically replaces conduit.
- Stable local-reconnection boundaries are the nearest other physical port, fitting, confirmed route point retained as an editable route boundary, or open conduit endpoint. Removal must not traverse that boundary or delete unrelated upstream/downstream network geometry.
- Local removal must reconcile both directions of topology: removed segment IDs disappear from device, fitting, junction-box, and circuit references; preserved boundary points become open endpoints; affected moved-device ports become unconnected.
- Construction features that belong solely to removed route elements, including bends/fittings, surface chases, and penetrations, are removed. Shared or preserved records are retained with valid references.
- The moved-device commit and all local dependency removal form one atomic Overlay revision and one undo/redo history entry.
- The disappearance effect briefly highlights and fades/shrinks the removed local geometry. The transaction result is authoritative immediately; animation state is transient presentation state and is never serialized.
- After movement, the application may retain an incomplete circuit, unconnected device ports, and open conduit endpoints. Diagnostics must state these conditions; they must not be normalized into a false connected state.
- Manual reconnection reuses the existing open-end and device-port route-start/finish workflow, route planning, bend-radius rules, collision validation, branching restrictions, stock-length splitting, chase generation, and penetration behavior.
- Persist any new Overlay fields through schema validation, normalization, export, import, and backward migration. Older Overlay documents without positioning references or installation planes must continue to load; derived defaults must be identified as derived rather than imported facts.
- Do not write device-point edits, installation reference planes, snaps, positioning references, or conduit changes into the imported Pascal JSON.
- Do not modify Parser, Evaluation Handoff, shared evaluation geometry, or G1-G4/S1 evidence and conclusions. The feature belongs to the independent conduit Overlay and editor.
- Update the Overlay version only if required by persisted schema changes, and provide migration tests for every supported earlier version.
- Update user-facing shortcut and conduit-workflow documentation in the same implementation change, while preserving the established meaning of Space and Enter.

## Testing Decisions

- Prefer one high-level domain seam: a device-point placement/edit transaction that accepts the current scene references, Overlay, selected device IDs, and proposed dimension/elevation change, then returns either a non-mutating preview, a validated atomic commit, or a structured rejection. Test externally observable geometry, topology, diagnostics, and history payloads through this seam rather than its helper functions.
- Test that wall-device edge dimensions select a same-wall neighboring device when available, fall back to the nearest valid wall end, remain stable while moving, and never move the reference device.
- Test bottom-edge height against the finished floor, including non-zero and negative level elevations, and verify that device size changes alter the edge measurement correctly.
- Test floor/reference-plane dimensions against a near-orthogonal wall pair, deterministic tie handling, one-reference fallback, and refusal to invent a dimension when geometry is insufficient.
- Test preview isolation: numeric editing must not mutate the Overlay, physical ports, connected segments, construction features, or undo history until confirmation.
- Test validated commits for single-device movement, eligible multi-selection elevation changes, mixed-selection rejection/exclusion reporting, invalid numeric input, host-bound violations, and reference invalidation.
- Test installation reference planes across multiple levels, the 2700 mm default, explicit elevation changes, honest absence of building host IDs, Overlay export/import, and backward loading when plane metadata is absent.
- Test physical device reconstruction for every device type: center/basis, frame/orientation, edge footprint, all port positions, port IDs, and connected-state handling after position or size changes.
- Test manual local reconnection for a terminal device, a device inserted between two legs, a multi-port source panel, an 86 box with occupied peer ports, a luminaire, and a sprinkler head attached through a tee/short branch.
- Test that local removal stops at the nearest stable boundary and preserves all unrelated circuit segments, ports, fittings, devices, chases, penetrations, and circuit identity.
- Test that moved-device ports and preserved open conduit endpoints report disconnected truth, with no stale segment IDs on either side of the relationship.
- Test that the move plus local removal produces a single undo snapshot and that undo/redo restores/reapplies the entire geometry and topology exactly.
- Test snap resolution as user-visible behavior: compatible device port, open endpoint, legal branch point, wall edge, and wall corner; deterministic priority for overlapping candidates; incompatible system/occupied port/illegal branch rejection; and clear target metadata.
- Test constraint composition: world-axis lock wins, then host-surface orthogonal mode; collinear targets connect; non-collinear targets yield only an auxiliary alignment point; cancellation or mode changes do not confirm the preview.
- Reuse existing drawing behavior tests as prior art for confirmed-versus-preview route points, Enter completion, orthogonal host axes, world-axis projection, and Tab penetration.
- Reuse existing device/network tests as prior art for port ownership, rooted circuits, open endpoints, segment-mounted devices, terminal devices, 86-box port behavior, network branching restrictions, and sprinkler tee insertion.
- Reuse existing routing/collision tests as prior art for shared-port contact, collision diagnostics, 200 mm tangent sweeps, cross-system bridge bends, stock-length splitting, chases, and penetrations.
- Add thin 3D workspace integration tests only for wiring that the domain seam cannot prove: selected-only dimension visibility, editable value submission, Ctrl/Command multi-selection, installation-plane visibility, snap markers/labels, disappearance animation, and unchanged Space shortcut.
- Do not assert private React state, helper names, DOM implementation structure, or exact animation frames. Assert user-visible state, accessible controls, committed Overlay behavior, and stable domain results.
- Run the relevant focused tests during development, then the full `npm test` suite and `npm run build` because the Overlay schema, routing topology, 3D interaction, and shared editor display are all affected.

## Out of Scope

- Automatic end-to-end conduit routing or route suggestions.
- Automatic replacement of conduit removed after a device point moves.
- Numeric entry of conduit segment lengths, absolute XYZ route coordinates, or CAD-style dynamic route input.
- Rebinding Space to route-point confirmation.
- Free dragging of an already placed device point.
- Permanent 2D positioning dimensions; existing 2D point annotations remain separate.
- Center-based or user-switchable center/edge dimension modes; MVP dimensions use device edges.
- More than the minimal selected-device dimensions described above.
- Grid snaps, arbitrary midpoints, perpendicular feet, extension-line intersections, tangent snaps, or a full configurable CAD object-snap palette.
- Automatic reference switching during an active edit.
- Fabricating ceiling, beam, slab, or other building host nodes when source JSON lacks them.
- Modeling hangers, rods, suspension hardware, beam-bottom offsets, ceiling assemblies, or construction tolerances.
- Editing the Pascal building model, wall geometry, floor datums, ceiling geometry, or beam geometry.
- Moving a complete circuit or translating existing conduit to follow a device.
- Silently repairing incomplete circuits or treating proximity as a physical connection.
- Changing evaluation rules, legal thresholds, G1-G4/S1 semantics, or Evaluation Handoff data.

## Further Notes

- `CONTEXT.md` is authoritative for terminology, and ADR-0001 is authoritative for the decision to use device-first, user-guided routing and manual local reconnection.
- Existing code already distinguishes preview route points from confirmed route points and already supports host-surface orthogonal drawing, world-axis locks, Tab penetration, physical device ports, rooted circuits, open endpoints, route collision checks, and atomic history snapshots. The implementation should deepen these seams rather than create a parallel routing model.
- Current device geometry is distributed across the device center, mount, frame, orientation, ports, connected segment endpoints, fittings, chases, penetrations, and circuit references. Any implementation that edits only the rendered mesh or center coordinate is incomplete.
- The existing ability to shift an 86 box while preserving an already built conduit serves a different purpose: it releases an occupied peer hole. It must not be generalized into connected-device movement, which follows manual local reconnection semantics.
- A device inserted into an otherwise incompatible host through a conduit segment is an existing behavior that needs explicit regression coverage. This spec does not broaden manual host eligibility beyond current device rules.
- The short disappearance animation should be subtle and fast; exact duration and easing are presentation details, provided the removed scope is clear and the saved transaction is not delayed by the animation.
- This spec is ready for implementation-ticket decomposition without reopening the confirmed product decisions.
