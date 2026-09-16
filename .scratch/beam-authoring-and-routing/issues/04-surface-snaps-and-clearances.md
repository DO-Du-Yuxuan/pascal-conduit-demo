# 04: Position Beam from physical surfaces and clearances

**What to build:** Give Beam creation and editing construction-grade physical references: surface snaps and editable clearances to nearby Walls and Beams, including live dimensions while moving one endpoint of an angled Beam.

**Blocked by:** 03 / Edit Beam geometry with 5 mm precision

**Status:** resolved

## Required behavior

- [ ] Generate Beam-authoring snap candidates from actual Wall surfaces, Column surfaces, and exposed existing Beam surfaces.
- [ ] Do not provide Beam centreline, special Beam endpoint, Wall centreline, Column centre, or invented snap candidates.
- [ ] Resolve overlapping candidates deterministically and show the active target type and identity before confirmation.
- [ ] Terminate a snapped Beam endpoint at the physical surface rather than inserting it halfway into the target solid.
- [ ] For a selected Beam, derive left and right side clearances from Beam faces to the first reliable parallel Wall or neighboring Beam face encountered in each direction.
- [ ] Derive start and end clearances from the endpoint faces to the first reliable Wall or Beam face along the Beam axis.
- [ ] Use physical faces as witnesses and omit a dimension when no reliable parallel reference exists. Do not fabricate a value or silently switch to a centreline.
- [ ] Recompute all witnesses continuously during creation and editing previews.
- [ ] While one endpoint of an angled Beam moves, show live left and right side clearances using the candidate Beam direction at that endpoint.
- [ ] Editing a side clearance translates the whole Beam laterally while preserving section, span, and direction. Editing an end clearance moves only the corresponding endpoint.
- [ ] Accept explicit numeric clearance input with the established Enter/blur commit and 5 mm positioning resolution.
- [ ] Keep positioning dimensions transient and selected-only in 3D. Do not add persistent Beam dimensions to 2D.
- [ ] Update the current Beam contract and README for the precision behavior delivered by this ticket.

## Verification

- [ ] Test surface snapping to straight/curved Wall faces where supported, Column faces, and angled/orthogonal Beam faces, including ties and absence of centreline/endpoint snaps.
- [ ] Test left, right, start, and end witnesses; nearest-surface priority; missing-reference omission; and witness stability during numeric commits.
- [ ] Test angled endpoint movement with live side distances, side-clearance whole-Beam movement, end-clearance endpoint-only movement, and 5 mm quantization.
- [ ] Test preview isolation, invalid-value rejection, undo/redo, and project JSON persistence of the resulting geometry.
- [ ] Run the relevant focused tests, the full test suite, and the production build.

## Answer

Implemented physical Wall, Column, and valid Beam face snapping for creation and endpoint editing, with deterministic target identity cues and face-parameter 5 mm resolution. Selected 3D Beams now expose transient, witness-backed side and end clearances; side edits translate the full Beam and end edits move only their endpoint. No positioning data is persisted outside the edited Beam geometry.
