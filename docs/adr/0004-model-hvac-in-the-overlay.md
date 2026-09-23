---
status: accepted
---

# Model HVAC air distribution in the Overlay

Central-air-conditioning Indoor air-handling units, their non-branching rectangular Supply and Return ducts, Duct outlets, Wall penetrations, and one-to-one Thermostat points belong exclusively to the independent Overlay. This preserves imported Pascal JSON as read-only while keeping physical air paths and logical thermostat control relationships separate, just as the Demo separates conduit geometry from lighting controls.

The first HVAC version deliberately shares one rectangular Duct section across an Indoor air-handling unit and both of its routes, permits only fixed 90-degree rectangular elbows, and uses explicit manual placement, axis locks, Ctrl Wall penetrations, and 3D-only editing. These restrictions avoid silently inventing fittings, transitions, branches, reroutes, or construction decisions that the author did not make.

## Supersession

ADR 0006 updates the current public schema to Project 4.0 and its specific type catalog; this historical decision does not authorize retired generic public types. See [0006-project-4-system-catalog.md](0006-project-4-system-catalog.md).

ADR 0005 replaces the separate Project/Overlay file ownership and export decision in this record. The physical modeling, authoring limits, and reconnection behavior remain applicable; the Overlay is now an internal editor adapter and its authored content is saved in the unified Project JSON.
