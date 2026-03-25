import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const feRoot = resolve(testDir, '../../..');
const repoRoot = resolve(feRoot, '..');

const readFeText = (relativePath: string) =>
  readFileSync(resolve(feRoot, relativePath), 'utf8');

const readRepoText = (relativePath: string) =>
  readFileSync(resolve(repoRoot, relativePath), 'utf8');

describe('web release readiness pack', () => {
  it('links the release pack from the FE README and exposes the release gate commands', () => {
    const readme = readFeText('README.md');

    expect(readme).toContain('## Release readiness pack');
    expect(readme).toContain('docs/release/web-readiness-checklist.md');
    expect(readme).toContain('docs/release/web-test-matrix.md');
    expect(readme).toContain('docs/release/web-release-notes.md');
    expect(readme).toContain('docs/release/candidates/v<package-version>/web-readiness-checklist.md');
    expect(readme).toContain('pnpm run e2e:release');
    expect(readme).toContain('pnpm run release:check');
    expect(readme).toContain('pnpm run release:notes');
  });

  it('keeps the FE env example aligned with the live release gate variables', () => {
    const envExample = readFeText('.env.example');

    expect(envExample).toContain('LIVE_API_BASE_URL=');
    expect(envExample).toContain('LIVE_REGISTER_PASSWORD=');
    expect(envExample).toContain('LIVE_INVALID_PASSWORD=');
    expect(envExample).toContain('LIVE_LOGIN_EMAIL=');
    expect(envExample).toContain('LIVE_LOGIN_PASSWORD=');
    expect(envExample).toContain('LIVE_LOGIN_TOTP_SECRET=');
    expect(envExample).toContain('LIVE_CHANNEL_DB_CONTAINER=');
    expect(envExample).toContain('PLAYWRIGHT_FE_PORT=');
    expect(envExample).toContain('VITE_DEV_PROXY_TARGET=');
  });

  it('defines the release matrix and checklist links for the critical FE journeys', () => {
    const { version } = JSON.parse(readFeText('package.json')) as {
      version: string;
    };
    const matrix = readFeText('docs/release/web-test-matrix.md');
    const checklistGuide = readFeText('docs/release/web-readiness-checklist.md');
    const candidateChecklist = readFeText(
      `docs/release/candidates/v${version}/web-readiness-checklist.md`,
    );
    const notesGuide = readFeText('docs/release/web-release-notes.md');
    const candidateNotes = readFeText(
      `docs/release/candidates/v${version}/web-release-notes.md`,
    );
    const playwrightSummary = readFeText(
      `docs/release/candidates/v${version}/playwright-release-summary.md`,
    );
    const story101Evidence = readFeText(
      `docs/release/candidates/v${version}/upstream-story-10.1-evidence.md`,
    );
    const story104Evidence = readFeText(
      `docs/release/candidates/v${version}/upstream-story-10.4-evidence.md`,
    );
    const rootReadme = readRepoText('README.md');

    expect(matrix).toContain('pnpm run release:check');
    expect(matrix).toContain('e2e/live/auth-live.spec.ts');
    expect(matrix).toContain('e2e/live/order-session-live.spec.ts');
    expect(matrix).toContain('e2e/live/notification-center-live.spec.ts');
    expect(matrix).toContain('e2e/live/notification-stream-live.spec.ts');
    expect(matrix).toContain('e2e/live/portfolio-dashboard-live.spec.ts');

    expect(checklistGuide).toContain('docs/release/candidates/v<semver>/web-readiness-checklist.md');
    expect(checklistGuide).toContain('playwright-release-summary.md');
    expect(checklistGuide).toContain('upstream-story-10.1-evidence.md');
    expect(checklistGuide).toContain('upstream-story-10.4-evidence.md');

    expect(candidateChecklist).toContain('README.md');
    expect(candidateChecklist).toContain('BE/README.md');
    expect(candidateChecklist).toContain('FE/README.md');
    expect(candidateChecklist).toContain('FE/.env.example');
    expect(candidateChecklist).toContain('BE/application-local.yml.template');
    expect(candidateChecklist).toContain('Portfolio boundary and bootstrap');
    expect(candidateChecklist).toContain('[upstream-story-10.1-evidence.md](./upstream-story-10.1-evidence.md)');
    expect(candidateChecklist).toContain('[upstream-story-10.4-evidence.md](./upstream-story-10.4-evidence.md)');
    expect(candidateChecklist).not.toContain('playwright-report/index.html');
    expect(candidateChecklist).not.toContain('_bmad-output/implementation-artifacts/10-1-7-plus-1-acceptance-ci-gate.md');
    expect(candidateChecklist).not.toContain('_bmad-output/implementation-artifacts/10-4-full-stack-smoke-and-rehearsal.md');

    expect(notesGuide).toContain('pnpm run release:notes');
    expect(notesGuide).toContain('docs/release/candidates/v<semver>/web-release-notes.md');
    expect(notesGuide).toContain(`docs/release/candidates/v${version}/web-release-notes.md`);

    expect(candidateNotes).toContain(`Version: \`${version}\``);
    expect(candidateNotes).toContain('Release checklist: `./web-readiness-checklist.md`');
    expect(candidateNotes).toContain('Test matrix: `../../web-test-matrix.md`');
    expect(candidateNotes).toContain('Playwright evidence summary: `./playwright-release-summary.md`');
    expect(candidateNotes).toContain('Story 10.1 upstream evidence: `./upstream-story-10.1-evidence.md`');
    expect(candidateNotes).toContain('Story 10.4 upstream evidence: `./upstream-story-10.4-evidence.md`');
    expect(candidateNotes).toContain('Approval status: `Draft - pending validation evidence`');

    expect(playwrightSummary).toContain('This markdown file is the checked-in, repository-stable evidence record for reviewers.');
    expect(playwrightSummary).toContain('Raw `playwright-report/` output is intentionally not tracked in git.');
    expect(playwrightSummary).toContain('`e2e/live/portfolio-dashboard-live.spec.ts`');
    expect(story101Evidence).toContain('Status: `Pending upstream completion`');
    expect(story101Evidence).not.toContain('_bmad-output/implementation-artifacts/10-1-7-plus-1-acceptance-ci-gate.md');
    expect(story104Evidence).toContain('Status: `Pending upstream completion`');
    expect(story104Evidence).not.toContain('_bmad-output/implementation-artifacts/10-4-full-stack-smoke-and-rehearsal.md');

    expect(rootReadme).toContain('Frontend release checklist');
    expect(rootReadme).toContain('Frontend release notes template');
  });

  it('guards the root README reviewer contract required by AC5', () => {
    const rootReadme = readRepoText('README.md');

    expect(rootReadme).toContain('[![API Docs]');
    expect(rootReadme).toContain('[![Docs Publish]');
    expect(rootReadme).toContain('[![Supply Chain Security]');

    expect(rootReadme).toContain('## Quick Start');
    expect(rootReadme).toContain('## Architecture Diagram');
    expect(rootReadme).toContain('## Reviewer Paths');
    expect(rootReadme).toContain('### Banking interviewer path');
    expect(rootReadme).toContain('### FinTech interviewer path');
    expect(rootReadme).toContain('## Architecture Decisions');
    expect(rootReadme).toContain('## Environment Variables');
    expect(rootReadme).toContain('docker exec channel-service curl -fsS http://localhost:18080/actuator/health');
    expect(rootReadme).not.toContain('curl http://localhost:8080/actuator/health');

    expect(rootReadme).toContain('BE/application-local.yml.template');
    expect(rootReadme).toContain('[Backend runtime guide](./BE/README.md)');
    expect(rootReadme).toContain('[Frontend runtime guide](./FE/README.md)');
    expect(rootReadme).toContain('[Shared environment defaults](./.env.example)');
  });
});
