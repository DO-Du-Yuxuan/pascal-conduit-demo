# 03: Edit Beam geometry with 5 mm precision

**What to build:** Let a user select a Beam and change its geometry predictably through direct manipulation and numeric values, with the same direct-commit interaction used by device-point positioning.

**Blocked by:** 02 / Draw and save the first Beam

**Status:** resolved

## Required behavior

- [ ] Show independent start and end handles for a selected Beam. Dragging one endpoint may change length and direction without moving the other endpoint.
- [ ] Allow dragging the Beam body to translate the complete Beam in the Ceiling plane without changing width, height, length, or direction.
- [ ] Provide lateral controls that translate the complete Beam perpendicular to its own axis.
- [ ] Provide editable Beam name, width, height, and length values. Numeric values commit on Enter or input blur without a separate confirmation button.
- [ ] Resolve pointer movement, lateral nudges, and numeric positioning to 5 mm increments, including positive, negative, angled, and rounding-boundary cases.
- [ ] Show live full-volume preview during every drag or numeric edit. Preview must not mutate either persisted document or history.
- [ ] Recompute intersected Ceilings and effective elevation during preview. Permit same-elevation spans and gaps; reject hostless or conflicting-elevation results without partial mutation.
- [ ] Permit normal solid overlap with Walls, Columns, and other Beams. Building-member overlap must not create collision or penetration records.
- [ ] Treat each accepted drag, nudge, size change, name change, or numeric change as one chronological workspace history operation.
- [ ] Make project export and re-import preserve the edited geometry and its evidence.
- [ ] Keep all editing in 3D; 2D selection may inspect the updated Beam but cannot modify it.
- [ ] Update the current Beam contract and README for the editing behavior delivered by this ticket.

## Verification

- [ ] Test endpoint drag, whole-Beam translation, lateral movement, width/height/length/name edits, live preview, validation, and 5 mm quantization.
- [ ] Test angled Beam edits, same-elevation host recomputation, rejected conflicting elevations, legal building-member overlaps, and exact undo/redo restoration.
- [ ] Test project export/re-import after each edit class and confirm Overlay data is untouched when no attachment relationship exists.
- [ ] Add thin 3D interaction tests for handles and accessible numeric controls without asserting private component state.
- [ ] Run the relevant focused tests, the full test suite, and the production build.

## Answer

Implemented 5 mm-quantized Beam geometry edits in 3D: independent endpoint handles, body translation, lateral nudges, and direct name/section/span fields. Live previews recompute host evidence without mutating project history or Overlay; accepted changes are project-only workspace transactions and survive export/re-import.
