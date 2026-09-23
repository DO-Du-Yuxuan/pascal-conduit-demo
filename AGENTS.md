# Pascal Conduit Routing Demo agent instructions

Before changing project import/export, building geometry, the 3D Viewer, or measurement behavior, read `README.md`, `docs/unified-project-json.md`, and the applicable detailed contract in `docs/`. Read the relevant decision in `docs/adr/` for routing, HVAC, or project ownership changes. `CONTEXT.md` records the domain vocabulary.

Mandatory rules:

- The public project format is one Project JSON (schema 4.0). Site owns the Building, ten system containers, and Drawings. The Overlay is an internal editing model, not a separate file to import or export.
- Preserve imported project data non-destructively, including valid future nodes and fields. Only the explicitly supported Beam authoring workflow may edit imported building nodes; other imported building nodes remain read-only. Preserve stable project and node IDs.
- Treat `README.md` as the living index of implemented capabilities and data ownership. Update it and the applicable detailed contract with any user-visible behavior or persistence change. Record hard-to-reverse trade-offs in an ADR.
- Preserve explicit versus derived measurement basis, assumptions, confidence, and source object IDs in construction drawing output.
- Run relevant tests and `npm run build`; shared parser, geometry, or display changes require the full `npm test` suite.
- Current truth is executable code, tests, the README, and the current Demo contracts above.
