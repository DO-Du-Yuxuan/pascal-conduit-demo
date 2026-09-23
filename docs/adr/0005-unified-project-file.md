---
status: accepted
---

# Store building and construction data in one Project JSON

At adoption, the Demo opened and saved one `schemaVersion: "3.0"` Project JSON. ADR 0006 advances that same single-file contract incompatibly to 4.0 and rejects 3.0; the file-ownership decision below remains in force. Its `Site` owns one `Building`, ten system containers, and zero or more `Drawing` nodes. Building nodes stay read-only except the documented Beam authoring workflow. Devices, routes, ports, controls, construction records, and drawing layout belong to their system or drawing nodes and retain stable IDs. Unknown nodes and fields remain in the source tree through an open-save cycle.

The editor may use its existing Overlay structure in memory while authoring, but that is an adapter, not a separate file or source of truth. Save merges authored data into the original supported Project tree and preserves fields the editor does not understand. Old Project plus Overlay files require an external merge; the Demo rejects them as direct imports. A successful single-file save clears both internal dirty flags, while cancellation or failure clears neither.

This supersedes the separate file ownership and export decisions in ADR 0003 and ADR 0004. It keeps their physical modeling and Beam authoring constraints.

Drawings are optional and separately owned under Site. The current canvas targets the lexicographically first `construction-plan` Drawing for its Level; it creates one only when persistent drawing content is first saved. Other Drawings keep their nodes and layouts. An existing ManualLeader stays with its original Drawing. Automatic dimensions and annotations store source IDs, basis, assumptions, confidence, and presentation layout, while their measured values remain derived from current geometry.


## Version scope

The 3.0 version above records the format at the time this decision was accepted. [ADR 0006](0006-project-4-system-catalog.md) supersedes only the schema version and public system/type catalog: the current Demo accepts 4.0 only, with no 3.0 migration. This ADR remains authoritative for one-file ownership, stable identity, save behavior, and Overlay as an internal adapter.
