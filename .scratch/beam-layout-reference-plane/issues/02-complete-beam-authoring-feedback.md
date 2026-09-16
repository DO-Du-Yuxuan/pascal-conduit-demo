# 02: Complete Beam constraints, Surface snaps, and authoring feedback

**What to build:** Make Beam drawing predictable and self-explanatory: orthogonal placement is visible and switchable, physical Surface snaps are precise, exceptional Ceiling-elevation crossing is explicit, and the pointer and Beam preview always communicate whether the next click will succeed.

**Blocked by:** 01 / Add the Layout reference plane and make Beam creation reliable

**Status:** claimed

- [ ] Add a visible Orthogonal lock state that defaults on the first time the Beam tool is used and remembers its last value for the current app session.
- [ ] Make Shift toggle Orthogonal lock instead of acting as an undiscoverable hold-only constraint. Provide both a visible control and brief pointer-adjacent feedback when the state changes.
- [ ] With Orthogonal lock enabled, constrain the live candidate to world X or Z in the active authoring plane relative to the confirmed start. With it disabled, permit free angled Beams.
- [ ] Support endpoint Surface snaps to real Wall, Column, and existing Beam surfaces, plus Ceiling polygon edges, while retaining free points on the Layout reference plane.
- [ ] Do not introduce Wall, Column, or Beam centreline snaps or synthetic endpoint snaps. Keep auxiliary alignment distinct from a physical Surface snap.
- [ ] Preserve the established small visual solid overlap when terminating against a Wall while retaining the axis endpoint on its physical face. Stop a Ceiling-edge endpoint exactly at the edge.
- [ ] Use a white crosshair for a valid free point; add a green centre, green scene reticle, and target name for a physical Surface snap.
- [ ] Use a red prohibited pointer, translucent red preview, and readable reason for an invalid candidate. Clear stale snap or error feedback immediately when the candidate changes.
- [ ] Keep an ordinary valid preview consistently translucent gray-blue, committed Beams solid gray, and selected committed Beams solid with orange emphasis. A transient Beam must never appear committed.
- [ ] Reject entering a different-effective-elevation Ceiling region by default.
- [ ] While Ctrl is held on Windows/Linux or Command is held on macOS, permit an explicit crossing that remains one straight Beam at the source Ceiling elevation. Do not step, slope, split, or adopt the target elevation.
- [ ] Show explicit crossing with an orange pointer and translucent orange preview, including a retained-elevation label. Releasing the modifier must immediately restore normal rejection.
- [ ] Ensure all constraint, snap, crossing, validation, pointer, and preview changes remain non-mutating until a successful commit.
- [ ] Add high-level authoring-session tests for orthogonal and angled candidates, all supported Surface snap targets, absent centreline/synthetic snaps, invalid candidates, modifier press/release, retained source elevation, cancellation, and one-operation commit.
- [ ] Add thin mounted UI tests for the Orthogonal-lock control and Shift toggle, semantic pointer states, reticle and labels, stable preview appearance, and Ctrl/Command behavior without asserting renderer internals or exact color values.
- [ ] Update the living README and detailed Beam contract for the complete implemented Beam authoring experience.
- [ ] Run relevant focused tests, the full test suite, and the production build.
