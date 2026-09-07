# Pascal Layout Auditor agent instructions

Before changing Parser, G1, G2, G3, evaluation UI, or shared geometry, read:

1. `docs/evaluation-semantic-contract.md`
2. `docs/rule-implementation-status.json`
3. `docs/evaluation-shared-change-log.md`
4. the relevant group index or handoff (`docs/g3-rule-index.md` for G3)

Mandatory rules:

- Do not infer object use from asset names when reliable `functionTags` exist.
- Do not reuse G3 usability parameters as G2 legal thresholds.
- Shared semantic, geometry, status, or display changes must update the semantic contract or shared change log in the same commit.
- Keep G1 data/geometry validity, G2 legal compliance, and G3 usability ownership separate; reuse evidence, not conclusions.
- Preserve explicit versus derived measurement basis, assumptions, confidence, and source object IDs.
- Run relevant tests and `npm run build`; shared changes require the full `npm test` suite.
- Historical audit documents are snapshots. Current truth is executable code, tests, `docs/rule-implementation-status.json`, and the semantic contract.

## Agent skills

### Issue tracker

Issues are tracked as local Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.
