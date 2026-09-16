# 07: Mount devices on Beam and preserve truth after Beam changes

**What to build:** Allow every current device type to use exposed Beam faces, then make Beam edit and deletion behavior preserve device and conduit world geometry without retaining false host relationships.

**Blocked by:** 03 / Edit Beam geometry with 5 mm precision; 06 / Create and display explicit Beam penetrations

**Status:** resolved

## Required behavior

- [x] Allow every current device type to be placed on exposed Beam bottom, side, and end faces. Keep the top face touching Ceiling unavailable.
- [x] Derive device orientation, physical frame, display geometry, and every port position from the selected Beam face normal and basis.
- [x] Persist Beam host identity and face evidence through Overlay export/import and backward-compatible migration.
- [x] When a Beam moves or resizes, keep mounted devices and all connected conduit at their existing world coordinates.
- [x] Revalidate affected attachments atomically. A device or conduit point no longer touching its Beam face must lose the stale attachment and become explicitly unhosted/conflicted.
- [x] Do not invoke direct-device local reconnection, remove adjacent conduit, stretch conduit, move devices, or create automatic replacement routes as a side effect of Beam editing.
- [x] Keep still-valid device and conduit attachments unchanged after Beam edits.
- [x] Block Beam deletion while one or more devices still have valid attachments to it. Report the count and useful device identities; do not mutate either document or history on rejection.
- [x] After users move or delete hosted devices, allow Beam deletion to preserve remaining device/conduit world geometry and apply the penetration cleanup already established.
- [x] Make Beam edit, attachment invalidation, conflicts, penetration updates, dirty states, and history one atomic workspace transaction with exact undo/redo.
- [x] Complete the living README capability index, detailed Beam contract, Viewer boundary, Pascal extension support documentation, ADR references, and explicit disclaimer that the Demo does not determine loads, reinforcement, safe hole zones, codes, or structural approval.

## Verification

- [x] Test every device type on bottom, side, and end faces, including orientation, frame, ports, rendering, selection, and Overlay round-trip; test top-face rejection.
- [x] Test Beam edits that keep attachments valid and edits that unhost devices/conduit while preserving every world coordinate and connection geometry.
- [x] Test that Beam-driven unhosting does not execute direct-device local reconnection or silently modify connected routes.
- [x] Test deletion rejection for one and multiple hosted devices, successful deletion after hosts are cleared, penetration cleanup, atomic dirty states, and undo/redo.
- [x] Run complete Beam creation, editing, precision positioning, surface routing, penetration, device, persistence, 2D/3D display, migration, and documentation regression checks.
- [x] Run the full test suite and production build, and leave README describing only behavior verified by executable tests.

## Answer

Implemented Beam mounting for every current device type on bottom, side, and end faces, with top-face rejection. Device frames, ports, and 3D display derive from Beam face normal and basis. Beam edits preserve device and conduit world geometry, atomically clear stale Beam attachments and invalid passages, and mark the changed Overlay dirty; still-valid attachments remain intact. Beam deletion now rejects valid hosted devices with their count and identities, then preserves remaining conduit while cleaning only orphaned Beam penetrations after hosts are cleared.

Verification: focused Beam/device tests; `npm test` (53 files, 390 tests); `npm run build`; and dual-axis code review with all findings fixed.
