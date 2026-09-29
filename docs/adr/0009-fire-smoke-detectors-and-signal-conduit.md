---
status: accepted
---

# ADR 0009: Model fire smoke detectors and signal conduit

## Context

The fire authoring tools previously covered sprinkler heads and water pipes only. Smoke detectors need physical signal connections while remaining distinct from HVAC temperature/humidity sensors and Electrical network endpoints.

## Decision

Publish a `SmokeDetector` device under `FireProtectionSystem`, with stable four-way `fire-signal` ports on a 60 mm circular base and 30 mm depth. Its placement and editable diameter follow `LightingJunctionBox`: ceiling or exposed Beam face, a free base may change diameter, and any connected port locks diameter while retaining stable node and port IDs.

Represent the white, 20 mm signal path with fire-owned `FireSignalConduit` segments and specific `FireSignalConduitElbow` / `FireSignalConduitConnector` fittings. Use a dedicated `fire-signal` routing-system value so ports and routes cannot connect to Electrical network conduits or HVAC control conduits. These routes connect smoke detectors or may end at any confirmed spatial point. A non-wall endpoint stays open and can be used to continue the route. A wall stop is persisted as `endTermination: "wall"` on the final segment, without a port, and is not enumerated as an open endpoint. Existing wall-terminated routes keep this behavior. Fire signal routes do not use Circuits, and are not branchable.

Keep the Project JSON schema at 4.0. This adds concrete 4.0 node types; projects without them continue to load unchanged. Existing imported nodes and unknown fields retain their current non-destructive round-trip behavior.

## Consequences

- Smoke-detector identity and signal ports remain stable across resize, save, and reload.
- Fire signal conduit geometry follows the shared route planner while system IDs keep it electrically separate from network and HVAC white conduit.
- Open spatial endpoints are discoverable for continuation; the wall termination marker remains part of the persisted route contract and endpoint discovery treats it as sealed.
- FireProtectionSystem owns the smoke devices, signal route segments, fittings, surface chases, and penetrations; it never gains a Circuit.
