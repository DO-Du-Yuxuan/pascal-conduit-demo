# Record curved bridge obstacles without weakening collision checks

- Status: Accepted
- Date: 2026-09-28

## Context

Bridge planning used only straight segments as candidate obstacles, even though the physical collision validator also models sweep elbows as arcs. A new floor route could therefore collide with a large floor elbow but have no bridge candidate to resolve it. Treating the fitting as a segment ID would blur the distinction between a fitting and the adjoining conduit segments.

## Decision

Allow bridge candidates over electrical sweep arcs only when the complete arc and its pipe radius are verified on one same-level slab top, then keep that arc in ordinary collision validation so the bridge must still achieve its physical clearance. Persist exact arc identity in optional `bridge.obstacleFittingIds`; keep `obstacleSegmentIds` limited to actual straight obstacles. Because the existing Project 4.0 bridge field requires `obstacleSegmentId`, an arc-only bridge uses a real adjacent segment as its compatibility anchor while the fitting ID names the actual obstacle.

## Consequences

- Existing bridge consumers can continue reading the required singular segment field.
- New consumers can distinguish straight crossings from curved fitting crossings.
- Non-floor arcs, unsupported/malformed slab geometry, and arcs without a real adjacent segment are not bridge candidates; their physical collisions continue to block commit.
