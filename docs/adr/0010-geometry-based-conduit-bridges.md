# Plan conduit bridges from physical geometry

- Status: Accepted
- Date: 2026-10-10
- Supersedes the slab eligibility restrictions in ADR 0009 (supported floor arcs).

## Context

The bridge planner rejected valid red, blue and network conduit crossings because they lacked a common slab attachment, were close to an automatic stock joint, or needed more than eight independent bridges. Its angle-independent profile also produced bridges that still collided at oblique crossings. Host identity is construction evidence, not proof that a geometrically feasible crossing is impossible.

## Decision

Use physical conduit geometry to plan bridges for new straight electrical, lighting and network runs. Hosts guide the outward avoidance direction rather than authorize a bridge. Do not infer or persist a host merely to make a crossing eligible. Compute the span from crossing angle and pipe radii, aiming for 10 mm clearance, and retain physical collision validation.

Treat collinear pieces joined by automatic stock couplings as a continuous available run for bridge placement. Replace only draft pieces and couplings covered by a bridge, preserving outer endpoint connections and updating fitting and construction-record references. Existing persisted obstacles are never moved. Stop iterative planning when no further bridge is possible or no progress is made, rather than at a fixed bridge count.

Keep the Project 4.0 `ConduitElbow`/`bridge` representation. `riseMm` remains a positive displacement magnitude; the saved crest coordinates determine its direction. Retain separate straight-obstacle and fitting-obstacle IDs and the legacy singular segment anchor. Fitting obstacles include saved sweep arcs and saved bridge profiles; both retain their physical collision volumes.

## Consequences

- Missing, distinct or non-floor hosts no longer reject otherwise feasible crossings.
- Shallow crossings may need longer bridges; real endpoints, physical overlap and unavailable space still limit placement.
- Parallel overlap, self-crossing drafts and collisions on newly planned sweep arcs remain blocking rather than silently rerouted.
- Bridge bodies participate in Beam collision checks, including their crest; ordinary face attachment cannot waive intrusion by the crest.
- Fire-water and fire-signal retain their current behavior. HVAC control conduits reuse electrical bridge geometry, collision and construction rules while retaining HVACSystem ownership and their dedicated thermostat/FCU ports.
- Existing saved bridge geometry and imported Building data are not rewritten.
- A bridge cannot replace a confirmed penetration channel with an elevated pipe while leaving the old opening record behind. Unaffected openings must remain owned by a retained straight piece containing the full physical channel.
