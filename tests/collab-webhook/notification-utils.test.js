"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePart,
  buildNormalizedDedupeKey,
  buildGitHubMattermostContext,
  buildJiraMattermostContext,
  SUPPRESSION_WINDOW_SECONDS,
} = require("../../.github/scripts/collab-webhook/notification-utils");

test("normalizePart maps null and blank values to underscore", () => {
  assert.equal(normalizePart(null), "_");
  assert.equal(normalizePart(undefined), "_");
  assert.equal(normalizePart(""), "_");
  assert.equal(normalizePart("   "), "_");
  assert.equal(normalizePart(" ready "), "ready");
});

test("buildNormalizedDedupeKey follows source+project+channel+event+entity+status+actor contract", () => {
  const key = buildNormalizedDedupeKey({
    source: "github",
    sourceProject: "DoYouLikeFix/FIXYZ",
    targetChannel: "dev-alerts",
    eventType: "pull_request.opened",
    entityId: 42,
    normalizedTargetStatus: "open",
    normalizedActor: "yeongjae",
  });

  assert.equal(
    key,
    "github+DoYouLikeFix/FIXYZ+dev-alerts+pull_request.opened+42+open+yeongjae",
  );
});

test("GitHub pull_request context falls back to normalized hash when source event id is unavailable", () => {
  const updatedAt = "2026-03-03T00:00:00.000Z";
  const context = buildGitHubMattermostContext({
    eventName: "pull_request",
    repository: "DoYouLikeFix/FIXYZ",
    targetChannel: "fix-delivery",
    actor: "yeongjae",
    event: {
      action: "opened",
      pull_request: {
        number: 15,
        state: "open",
        merged: false,
        html_url: "https://github.com/DoYouLikeFix/FIXYZ/pull/15",
        updated_at: updatedAt,
      },
      sender: {
        login: "yeongjae",
      },
    },
  });

  assert.equal(context.dedupeMode, "normalized_key_hash");
  assert.match(context.cacheKey, /^mm-dedupe-[a-f0-9]{64}-\d+$/);
  assert.equal(
    context.windowBucket10m,
    Math.floor(new Date(updatedAt).getTime() / 1000 / SUPPRESSION_WINDOW_SECONDS),
  );
  assert.match(context.payload.text, /\[GitHub\] \*\*PR #15 · OPENED\*\*/);
  assert.match(context.payload.text, /Actor: `yeongjae`/);
  assert.match(context.payload.text, /Repo: `DoYouLikeFix\/FIXYZ`/);
});

test("GitHub workflow_run context prioritizes source event id when available", () => {
  const context = buildGitHubMattermostContext({
    eventName: "workflow_run",
    repository: "DoYouLikeFix/FIXYZ",
    targetChannel: "fix-delivery",
    actor: "github-actions[bot]",
    event: {
      action: "completed",
      workflow_run: {
        id: 987654321,
        run_number: 91,
        name: "Publish API Docs to GitHub Pages",
        conclusion: "success",
        html_url: "https://github.com/DoYouLikeFix/FIXYZ/actions/runs/987654321",
        updated_at: "2026-03-03T00:10:00.000Z",
      },
    },
  });

  assert.equal(context.dedupeMode, "source_event_id");
  assert.equal(context.dedupeValue, "987654321");
  assert.equal(context.sourceEventId, "987654321");
  assert.match(context.payload.text, /\[GitHub\] \*\*Workflow · SUCCESS\*\*/);
  assert.match(context.payload.text, /Workflow: `Publish API Docs to GitHub Pages`/);
  assert.match(context.payload.text, /Run: `#91`/);
});

test("Jira transition context maps previous/new status and preserves dedupe contract", () => {
  const context = buildJiraMattermostContext({
    targetChannel: "fix-delivery",
    jiraBaseUrl: "https://fixyz.atlassian.net",
    event: {
      webhookEvent: "jira:issue_updated",
      timestamp: 1_772_462_400_000,
      issue: {
        id: "20025",
        key: "FIX-25",
        self: "https://fixyz.atlassian.net/rest/api/3/issue/20025",
        fields: {
          summary: "Publish collaboration release status to MatterMost",
          project: { key: "FIX" },
          status: { name: "Done" },
          assignee: { displayName: "Dana Kim" },
        },
      },
      changelog: {
        items: [
          {
            field: "status",
            fromString: "In Progress",
            toString: "Done",
          },
        ],
      },
      user: {
        displayName: "Quinn QA",
      },
    },
  });

  assert.equal(context.audit.source, "jira");
  assert.equal(context.audit.entity_id, "FIX-25");
  assert.equal(context.audit.normalized_target_status, "Done");
  assert.equal(context.audit.normalized_actor, "Quinn QA");
  assert.equal(context.audit.suppression_window_seconds, 600);
  assert.match(context.payload.text, /\[Jira\] FIX-25 In Progress -> Done/);
  assert.match(context.payload.text, /assignee=Dana Kim actor=Quinn QA/);
  assert.match(context.payload.text, /https:\/\/fixyz\.atlassian\.net\/browse\/FIX-25/);
});
