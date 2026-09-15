# 01: Establish editable project identity and workspace history

**What to build:** Give the Demo a narrow editable-project lifecycle that can save Beam-capable project revisions without confusing a changed file with a different project. This ticket establishes the persistence and transaction foundation used by every later Beam slice; it does not add Beam authoring itself.

**Blocked by:** None (can start immediately)

**Status:** resolved

## Required behavior

- [x] Add a stable project identity that is generated once for a legacy project when it first becomes writable and is preserved across later exports and imports.
- [x] Keep the content SHA as a revision fingerprint only; changing project content must not change project identity.
- [x] Bind Overlay ownership to project identity while preserving backward compatibility with existing SHA-only Overlay source metadata.
- [x] Importing a new revision with the same project identity retains and revalidates the active Overlay; importing a different identity starts a separate Overlay after normal unsaved-work protection.
- [x] Add an explicit project JSON export that downloads a new file and never overwrites the imported source file.
- [x] Preserve all unedited top-level data, nodes, unknown node kinds, plugin payloads, metadata, and unknown fields semantically. Whitespace and property order do not need to remain identical.
- [x] Track project and Overlay dirty states independently. Exporting one clears only that document's dirty state, and leaving with either dirty warns the user.
- [x] Establish one chronological workspace transaction/history interface capable of atomically changing project data, Overlay data, or both. Undo and redo must restore both documents and their dirty states consistently.
- [x] Keep every imported building-node kind read-only. The transaction interface must use an explicit editable-kind allowlist that later tickets can extend only with Beam.
- [x] Update the living documentation for the persistence behavior actually delivered by this ticket without claiming that Beam authoring already exists.

## Verification

- [x] Test legacy project identity creation, repeated export stability, changed content SHA, legacy Overlay migration, same-project re-import, and different-project import.
- [x] Test semantic preservation of unknown fields and nodes through project export and re-import.
- [x] Test independent dirty states, unload/import warnings, and chronological undo/redo across alternating project and Overlay transactions.
- [x] Run the relevant focused tests, the full test suite, and the production build.

## Comments

- Implemented stable project identity, independent project/Overlay export state, sidecar ownership migration and unified workspace transaction history. Focused tests, full `npm test` (357 tests), and `npm run build` passed. Two-axis code review found and verified fixes for current Overlay migration and shared history wiring.
