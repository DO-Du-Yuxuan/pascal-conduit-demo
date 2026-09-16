# 05: Route conduit on Beam faces and detect Beam collisions

**What to build:** Make Beam affect ordinary conduit drawing as a real host and obstacle. Users can route exposed conduit across Beam faces, while accidental entry into Beam volume becomes a blocking conflict.

**Blocked by:** 02 / Draw and save the first Beam

**Status:** resolved

## Required behavior

- [x] Extend physical host attachments to identify Beam, face, normal, local basis, Level, and local position without weakening existing Wall, Slab, or Ceiling evidence.
- [x] Expose Beam bottom, side, and end faces as conduit hosts. The top face touching Ceiling must not be targetable.
- [x] Allow the existing user-guided drawing flow to begin, continue, turn, and finish on Beam faces using the normal preview and confirmation rules.
- [x] Support transitions between adjacent exposed Beam faces and between Beam and other valid hosts using the established bend behavior.
- [x] Treat Beam-face conduit as exposed surface routing and never generate a Beam surface chase.
- [x] Add valid Beam solids to building-obstacle collision checks. Detect an intersection even when the pointer ray did not directly hit the Beam, including suspended and world-axis routing.
- [x] Permit contact only when the route is truthfully attached to the contacted Beam face or an explicit penetration bypass is active.
- [x] Show ordinary Beam-volume intersections as red conflicts and prevent point confirmation and route completion.
- [x] Ignore invalid imported Beam records for hosting and collision so corrupt geometry cannot affect valid routing.
- [x] Keep Beam/Wall, Beam/Column, and Beam/Beam building intersections legal and distinct from conduit collision.
- [x] Preserve existing device-port, open-end, branch, circuit, bend, stock-length, and non-Beam collision behavior.
- [x] Update the current Beam and routing contracts and README for the behavior delivered by this ticket.

## Verification

- [x] Test routing along every exposed Beam face, adjacent-face transitions, Beam-to-other-host transitions, top-face exclusion, and absence of Beam chases.
- [x] Test accidental Beam intersection from surface, suspended, and axis-locked routes, including collisions discovered without a direct mesh hit.
- [x] Test legal attached contact, legal building-member overlap, invalid Beam exclusion, red conflict presentation, and blocked confirmation/completion.
- [x] Run regression tests for existing host transitions, bends, route constraints, collisions, branching, open endpoints, and device ports.
- [x] Run the relevant focused tests, the full test suite, and the production build.

## Answer

Implemented Beam face attachments and analytic Beam-prism collision checks. The renderer exposes bottom, two sides, and both ends while rejecting the top; `beamRouteDiagnostics` is independent of mesh hit-testing and blocks ordinary Beam-volume intersections. Face-attached surface runs remain exposed and produce no Beam chase. Focused tests, full tests, build, and two-axis review are required before this ticket is committed.
