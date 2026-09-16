# 03: Share the Layout reference plane with eligible device placement and integrate

**What to build:** Let eligible horizontal device points use the same per-Level Layout reference plane as Beam authoring without changing device host semantics, then verify and document the complete feature as one coherent Demo capability.

**Blocked by:** 02 / Complete Beam constraints, Surface snaps, and authoring feedback

**Status:** resolved

- [x] Use the active Level's shared Layout reference plane for eligible horizontal device-point placement rather than maintaining a competing authoring-plane experience.
- [x] Preserve existing device host eligibility. Wall-only devices must remain Wall-only, and the Layout reference plane must not be persisted as a physical device host.
- [x] Keep each device's persisted Installation reference plane relationship distinct from the shared Layout reference plane authoring aid.
- [x] Apply plane visibility and height changes only to active previews and future points; never move or rehost existing device points.
- [x] Preserve the established device placement behavior when the shared Layout reference plane is hidden or unavailable, with clear feedback when placement has no legal surface.
- [x] Test eligible horizontal devices through the shared plane, Wall-only rejection, per-Level switching, Overlay round-trip, and the stability of existing device points after plane edits.
- [x] Recheck Beam creation, editing, project JSON round-trip, Overlay ownership, workspace history, Ceiling-hidden authoring, Surface snaps, Orthogonal lock, and explicit elevation crossing as an integrated workflow.
- [x] Ensure project JSON remains non-destructive except for the already-supported Beam authoring contract and that conduit data remains exclusively in its Overlay sidecar.
- [x] Finish the README and applicable detailed contracts so humans and later agents can identify the Layout reference plane, supported consumers, ownership boundaries, controls, modifiers, visual states, and out-of-scope behavior.
- [x] Record any newly discovered hard-to-reverse trade-off in an ADR rather than silently expanding the feature contract.
- [x] Run relevant focused tests, the full test suite, and the production build; resolve all regressions before marking the ticket complete.

## Answer

Eligible luminaire, sprinkler-head, and sensor placement now consumes the visible per-Level Layout reference plane as an interaction aid. New devices remain persisted against their distinct Installation reference plane relation, preserving host eligibility and keeping the shared Layout plane out of project JSON and device host attachments. Focused tests, full suite (398 tests), and production build pass; no new irreversible trade-off was introduced.
