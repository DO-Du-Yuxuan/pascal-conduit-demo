---
status: accepted
---

# Accept legacy project trees at the file-opening boundary

The 4.0-only opening rule blocked existing Pascal building files, including the reported 2026-10-13 scene with 25 lowercase building nodes and no schemaVersion. A user should be able to open an existing building and author construction systems without manually rewriting the file.

Add a separate `importProjectJson` adapter before the strict 4.0 decoder. It accepts unversioned Pascal trees and explicitly identified 1.0 / 2.0 / 3.0 trees whose converted content passes the current full contract. Normalize only known building type aliases, preserve persisted project and node IDs, and add missing empty system containers with deterministic collision-safe IDs. Keep all geometry, units, plugin data and unknown fields. Reuse legacy projectId when no Demo project identity exists; otherwise derive the fallback from the stable Site ID. Do not create drawings or infer construction routes.

All migration operates on a copy and must pass the strict 4.0 decoder before replacing the workspace. Unversioned inputs must retain the original lowercase `site` root signature so a canonical `Site` project with a missing version is not silently repaired. An existing 4.0 file gets no repair or migration. Unknown versions, broken relationships, standalone Overlay files and retired construction entities without an explicit safe mapping remain errors. Supporting a legacy version does not promise every historic entity can be migrated.

Editing and saving continue to use one 4.0 Project JSON, with the Overlay as an internal adapter. Import shows a conversion diagnostic; the source disk file is not automatically rewritten. Saving the converted project makes its public building types and system shell 4.0, so consumers expecting the old shape must retain their original file or adopt 4.0. This supersedes only the import rejection policy in ADR 0005 and ADR 0006, preserving their ownership and entity catalog decisions.
