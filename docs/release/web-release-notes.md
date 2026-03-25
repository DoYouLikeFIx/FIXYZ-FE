# Web Release Notes Guide

This file is the checked-in entry point for FE release notes. Candidate-specific notes must live under `docs/release/candidates/v<semver>/web-release-notes.md` so each FE candidate keeps its own immutable evidence trail.

Do not record candidate-specific approval state, dates, or commit SHAs in this file. Put those details in the generated candidate file instead.

## Generate Candidate Notes

Run the scaffold command after the FE release gate passes:

```bash
pnpm run release:notes
```

The command reads the FE version from `package.json`, creates the candidate directory under `docs/release/candidates/v<package-version>/`, and refreshes the draft candidate pack until the release notes are finalized with a non-draft approval status.

Current FE package version path:

- `docs/release/candidates/v0.1.0/web-release-notes.md`

## What Belongs In The Generated File

- candidate metadata for the exact FE candidate under review
- links to the candidate checklist and shared test matrix
- links to CI and Playwright evidence for that candidate
- links to candidate-specific upstream Story 10.1 and Story 10.4 evidence records
- approval outcome and reviewer notes for that version only

## Template Contract

Every generated candidate file should include these sections:

- `## Candidate`
- `## Included Scope`
- `## Evidence Summary`
- `## Known Risks / Follow-ups`
- `## Approval`
