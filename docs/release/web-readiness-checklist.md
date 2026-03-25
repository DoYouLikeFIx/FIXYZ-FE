# Web Release Readiness Checklist Guide

This file is the checked-in entry point for FE release checklists. Candidate-specific completed checklists must live under `docs/release/candidates/v<semver>/web-readiness-checklist.md` so release metadata and evidence stay scoped to the exact FE candidate.

Do not record candidate-specific SHAs, dates, or approval state in this guide. Put those details in the candidate file instead.

## Generate Candidate Pack

Run the scaffold command after the FE release gate passes:

```bash
pnpm run release:notes
```

The command reads the FE version from `package.json`, creates the candidate directory under `docs/release/candidates/v<package-version>/`, and refreshes the draft candidate pack until the generated release notes are finalized with a non-draft approval status.

Current FE package version path:

- `docs/release/candidates/v0.1.0/web-readiness-checklist.md`

## Candidate Companion Files

Each candidate directory should keep these reviewer-facing evidence records together:

- `web-readiness-checklist.md`
- `web-release-notes.md`
- `playwright-release-summary.md`
- `upstream-story-10.1-evidence.md`
- `upstream-story-10.4-evidence.md`

## Checklist Contract

Every candidate checklist should include these sections:

- `## Candidate Metadata`
- `## Automated Release Gate`
- `## Critical Journey Evidence`
- `## Documentation Consistency`
- `## Upstream Release Evidence`
- `## Signoff`
