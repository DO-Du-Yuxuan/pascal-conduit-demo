# 06: Create and display explicit Beam penetrations

**What to build:** Let a user deliberately pass conduit through a Beam with the established Tab workflow, persist the resulting construction opening in Overlay, and display the opening consistently in 3D and 2D.

**Blocked by:** 03 / Edit Beam geometry with 5 mm precision; 05 / Route conduit on Beam faces and detect Beam collisions

**Status:** resolved

## Required behavior

- [x] Reuse the established Tab penetration interaction for Beam rather than adding a Beam-specific mode or shortcut.
- [x] Freeze the entry direction, preview the straight passage through the oriented Beam volume, and reattach to the actual exit host after confirmation.
- [x] Reject incomplete or geometrically invalid entry/exit passages without committing route or penetration data.
- [x] Persist Beam penetration only in Overlay with stable Beam and route-element identity, entry, exit, direction, and derivation evidence.
- [x] Use conduit diameter plus the existing 10 mm Demo clearance for Beam penetration diameter.
- [x] Cut only runtime/rendered Beam geometry from Overlay penetration data. Do not write hole geometry into the project Beam node.
- [x] Support angled Beams and non-axis-aligned conduit passages with correctly oriented opening geometry.
- [x] Show a simple Beam penetration symbol in 2D. Reveal hole diameter and linked conduit only when selected; do not add permanent Beam dimension text.
- [x] Revalidate penetrations after Beam moves or resizes: retain still-valid explicit passages, remove obsolete ones, and leave newly introduced ordinary intersections as conflicts.
- [x] Remove orphan Beam penetration records when an unoccupied Beam is deleted while preserving conduit geometry.
- [x] Preserve existing Wall/Slab penetration behavior and continue to prohibit Beam surface chases.
- [x] Update Overlay migration/validation, the current Beam and routing contracts, README, and the structural-safety disclaimer for the behavior delivered here.

## Verification

- [x] Test valid and invalid Tab entry/exit flows, frozen direction, exit-host restoration, route commit, and Overlay round-trip.
- [x] Test diameter-plus-10-mm sizing, angled Beam cutting, non-axis-aligned passages, and unchanged project Beam geometry.
- [x] Test Beam edit revalidation for still-valid, obsolete, and newly created intersections, plus deletion cleanup and undo/redo across project and Overlay.
- [x] Test 2D symbol visibility, selection detail, layer behavior, and absence of permanent Beam dimensions.
- [x] Run Wall/Slab penetration and routing regression tests, the full test suite, and the production build.

## Answer

Tab uses its existing frozen-direction interaction to resolve an oriented Beam exit. The persisted Overlay-only penetration drives runtime cylindrical CSG cutting in 3D and a Beam-layer 2D symbol; selected Beams reveal only the linked segment and diameter. Editing or deleting a Beam revalidates or removes orphan Beam holes without changing route geometry.
