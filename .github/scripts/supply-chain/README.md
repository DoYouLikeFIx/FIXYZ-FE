# Supply Chain Security Scripts

## Files

- `security-utils.cjs`: policy helpers for Dependabot alert evaluation, exception matching, workflow action pinning checks, and artifact contracts
- `run-security-baseline.cjs`: repository-local supply-chain scan runner that writes machine-readable evidence under `docs/ops/security-scan/<YYYYMMDD>/<snapshot-id>/`

## Security

- Do not hardcode GitHub or NVD credentials in source.
- `ALERTS_TOKEN` defaults to `GITHUB_TOKEN` in GitHub Actions, but a dedicated `DEPENDABOT_ALERTS_TOKEN` secret can be supplied if alert export requires elevated access.
- `BRANCH_PROTECTION_TOKEN` is required to capture live branch-protection and GitHub Actions permissions evidence.
- Approved exception records must include the required review metadata before they can suppress a blocking finding.
- GitHub Actions runs fail closed when branch-protection proof cannot be captured.
- Upstream scan failures still emit machine-readable evidence snapshots with blocking `scan-error` findings.

## Local Validation

```bash
pnpm run lint:supply-chain
pnpm run test:supply-chain
```
