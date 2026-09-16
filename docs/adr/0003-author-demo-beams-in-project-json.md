---
status: accepted
---

# Author Demo beams in project JSON

The Demo may create, edit, and delete its documented `beam` extension nodes in the building project JSON, while every other imported building-node kind remains read-only and unknown source data is preserved. Successive exported versions share a stable project identity rather than using the changing content fingerprint as identity; saving produces a new project JSON file instead of overwriting the imported file.

Beam geometry belongs to the building model, but conduit, devices, construction state, and beam penetrations remain in the independent Overlay. Every Beam face may host surface-routed conduit, explicit passage through a Beam creates an Overlay penetration, and editing or deleting a Beam preserves existing conduit geometry rather than silently rerouting it.

A Beam follows the effective elevation of its host Ceiling and may cross multiple Ceilings only when their effective elevations agree; a missing Ceiling height resolves to the Demo's explicit `2700 mm` derived default. Only exposed bottom, side, and end faces host conduit. Project JSON and Overlay export independently, while undo follows the user's actual action order across both documents.

All device types may mount on an exposed Beam face. A later Beam edit never moves mounted devices or conduit implicitly: each keeps its world geometry, any no-longer-valid attachment becomes explicitly unhosted, and conflicts remain for manual correction. Deleting a Beam is blocked while it still hosts devices; otherwise deletion removes orphaned Beam penetrations but preserves conduit.

Beam authoring uses a default-visible per-Level Layout reference plane so it remains available when Ceiling geometry is hidden; this plane is Overlay-owned editing state and never changes committed geometry when moved. A Beam normally stops at a conflicting Ceiling elevation, but holding Ctrl or Command explicitly crosses that boundary while retaining the source Ceiling elevation, keeping the member straight rather than stepping or splitting it.
