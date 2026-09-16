# Pascal Conduit Routing Demo agent instructions

Before changing the Pascal parser, shared building geometry, 3D Viewer, or measurement behavior, read the relevant current contract:

1. `README.md` for the Demo boundary and user-facing behavior.
2. `docs/3d-readonly-viewer.md` for Viewer changes.
3. `docs/manual-measurement.md` for 2D measurement changes.
4. the applicable decision in `docs/adr/` for conduit routing or lighting-control changes.

Mandatory rules:

- Preserve imported Pascal JSON non-destructively. Only the explicitly supported Beam authoring workflow and stable project identity may change exported project JSON; all other imported building nodes remain read-only.
- Keep conduit data in its independent Overlay sidecar; do not write routing, device, or construction state into Pascal JSON.
- Treat `README.md` as the living human-and-AI index of implemented Demo capabilities and data ownership. Any change to user-visible behavior, persistence, or feature boundaries must update the README and the applicable detailed contract in the same change; record hard-to-reverse trade-offs in an ADR.
- Preserve explicit versus derived measurement basis, assumptions, confidence, and source object IDs in construction drawing output.
- Run relevant tests and `npm run build`; shared parser, geometry, or display changes require the full `npm test` suite.
- Current truth is executable code, tests, the README, and the current Demo contracts above.

## Agent skills

### Issue tracker

Issues are tracked as local Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.
