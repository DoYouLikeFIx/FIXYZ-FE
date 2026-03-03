"use strict";

const crypto = require("node:crypto");

const SUPPRESSION_WINDOW_SECONDS = 600;

function normalizePart(value) {
  if (value === null || value === undefined) {
    return "_";
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : "_";
}

function parseEpochSeconds(value, fallbackSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 10_000_000_000) {
      return Math.floor(value / 1000);
    }
    if (value > 0) {
      return Math.floor(value);
    }
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }

  return fallbackSeconds;
}

function windowBucket10m(eventEpochSeconds) {
  const safeEpoch = Math.max(0, Number(eventEpochSeconds) || 0);
  return Math.floor(safeEpoch / SUPPRESSION_WINDOW_SECONDS);
}

function buildNormalizedDedupeKey(parts) {
  return [
    normalizePart(parts.source),
    normalizePart(parts.sourceProject),
    normalizePart(parts.targetChannel),
    normalizePart(parts.eventType),
    normalizePart(parts.entityId),
    normalizePart(parts.normalizedTargetStatus),
    normalizePart(parts.normalizedActor),
  ].join("+");
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function resolveDedupeIdentity(sourceEventId, normalizedDedupeKey) {
  const normalizedSourceEventId = normalizePart(sourceEventId);
  if (normalizedSourceEventId !== "_") {
    return {
      mode: "source_event_id",
      value: normalizedSourceEventId,
    };
  }

  return {
    mode: "normalized_key_hash",
    value: normalizedDedupeKey,
  };
}

function resolveGitHubEventId(event) {
  if (event && event.delivery_id) {
    return event.delivery_id;
  }
  if (event && event.workflow_run && event.workflow_run.id) {
    return event.workflow_run.id;
  }
  return null;
}

function resolveGitHubStatus(eventName, event) {
  if (eventName === "pull_request") {
    const state = normalizePart(event.pull_request && event.pull_request.state);
    if (event.pull_request && event.pull_request.merged) {
      return "merged";
    }
    return state;
  }

  if (eventName === "workflow_run") {
    return normalizePart(
      event.workflow_run && (event.workflow_run.conclusion || event.workflow_run.status),
    );
  }

  return normalizePart(event.action);
}

function resolveGitHubEntityId(eventName, event) {
  if (eventName === "pull_request") {
    return event.pull_request && (event.pull_request.number || event.pull_request.id);
  }

  if (eventName === "workflow_run") {
    return event.workflow_run && (event.workflow_run.id || event.workflow_run.check_suite_id);
  }

  return event.id || null;
}

function resolveGitHubEventUrl(eventName, event, repository) {
  if (eventName === "pull_request" && event.pull_request && event.pull_request.html_url) {
    return event.pull_request.html_url;
  }

  if (eventName === "workflow_run") {
    if (event.workflow_run && event.workflow_run.html_url) {
      return event.workflow_run.html_url;
    }
    if (event.workflow_run && event.workflow_run.id) {
      return `https://github.com/${repository}/actions/runs/${event.workflow_run.id}`;
    }
  }

  return `https://github.com/${repository}`;
}

function buildGitHubMessage(eventName, event, repository, actor, targetStatus, eventUrl) {
  const normalizedRepository = normalizePart(repository);
  const normalizedActor = normalizePart(actor);
  const normalizedStatus = normalizePart(targetStatus);

  if (eventName === "pull_request") {
    const prNumber = normalizePart(event.pull_request && event.pull_request.number);
    const action = normalizePart(event.action);
    return [
      `[GitHub] **PR #${prNumber} · ${action.toUpperCase()}**`,
      `- Repo: \`${normalizedRepository}\``,
      `- Actor: \`${normalizedActor}\``,
      `- Status: \`${normalizedStatus}\``,
      `- Link: ${eventUrl}`,
    ].join("\n");
  }

  if (eventName === "workflow_run") {
    const workflowName = normalizePart(event.workflow_run && event.workflow_run.name);
    const runNumber = normalizePart(event.workflow_run && event.workflow_run.run_number);
    return [
      `[GitHub] **Workflow · ${normalizedStatus.toUpperCase()}**`,
      `- Repo: \`${normalizedRepository}\``,
      `- Workflow: \`${workflowName}\``,
      `- Run: \`#${runNumber}\``,
      `- Actor: \`${normalizedActor}\``,
      `- Link: ${eventUrl}`,
    ].join("\n");
  }

  return [
    `[GitHub] **${normalizePart(eventName)}**`,
    `- Repo: \`${normalizedRepository}\``,
    `- Actor: \`${normalizedActor}\``,
    `- Status: \`${normalizedStatus}\``,
    `- Link: ${eventUrl}`,
  ].join("\n");
}

function buildGitHubMattermostContext(input) {
  const eventName = normalizePart(input.eventName);
  const event = input.event || {};
  const sourceProject = normalizePart(input.repository || (event.repository && event.repository.full_name));
  const targetChannel = normalizePart(input.targetChannel);
  const actor = normalizePart(input.actor || (event.sender && event.sender.login));
  const entityId = normalizePart(resolveGitHubEntityId(eventName, event));
  const targetStatus = resolveGitHubStatus(eventName, event);
  const eventType =
    eventName === "pull_request"
      ? `pull_request.${normalizePart(event.action)}`
      : eventName === "workflow_run"
        ? `workflow_run.${targetStatus}`
        : `${eventName}.${normalizePart(event.action)}`;
  const eventEpoch = parseEpochSeconds(
    (event.pull_request && (event.pull_request.updated_at || event.pull_request.created_at)) ||
      (event.workflow_run && (event.workflow_run.updated_at || event.workflow_run.created_at)) ||
      event.repository &&
        (event.repository.updated_at || event.repository.pushed_at || event.repository.created_at),
    input.fallbackEpochSeconds,
  );
  const eventUrl = resolveGitHubEventUrl(eventName, event, sourceProject);
  const sourceEventId = resolveGitHubEventId(event);
  const normalizedDedupeKey = buildNormalizedDedupeKey({
    source: "github",
    sourceProject,
    targetChannel,
    eventType,
    entityId,
    normalizedTargetStatus: targetStatus,
    normalizedActor: actor,
  });
  const dedupeIdentity = resolveDedupeIdentity(sourceEventId, normalizedDedupeKey);
  const dedupeHash = sha256Hex(dedupeIdentity.value);
  const bucket = windowBucket10m(eventEpoch);
  const cacheKey = `mm-dedupe-${dedupeHash}-${bucket}`;

  return {
    payload: {
      text: buildGitHubMessage(eventName, event, sourceProject, actor, targetStatus, eventUrl),
      props: {
        source: "github",
        source_project: sourceProject,
        target_channel: targetChannel,
        event_type: eventType,
        entity_id: entityId,
        target_status: targetStatus,
        actor,
        event_url: eventUrl,
      },
    },
    audit: {
      source: "github",
      source_project: sourceProject,
      target_channel: targetChannel,
      event_type: eventType,
      entity_id: entityId,
      normalized_target_status: targetStatus,
      normalized_actor: actor,
      source_event_id: normalizePart(sourceEventId),
      normalized_dedupe_key: normalizedDedupeKey,
      dedupe_mode: dedupeIdentity.mode,
      dedupe_hash: dedupeHash,
      window_bucket_10m: bucket,
      event_epoch: eventEpoch,
      suppression_window_seconds: SUPPRESSION_WINDOW_SECONDS,
      cache_key: cacheKey,
    },
    source: "github",
    entityKey: entityId,
    eventType,
    sourceEventId: normalizePart(sourceEventId),
    normalizedDedupeKey,
    dedupeMode: dedupeIdentity.mode,
    dedupeValue: dedupeIdentity.value,
    dedupeHash,
    windowBucket10m: bucket,
    cacheKey,
    eventEpoch,
  };
}

function extractJiraStatusChange(event) {
  const changelogItems = (event.changelog && event.changelog.items) || [];
  const statusChange = changelogItems.find((item) => item.field === "status");
  const previousStatus = normalizePart(statusChange && (statusChange.fromString || statusChange.from));
  const nextStatus = normalizePart(
    (statusChange && (statusChange.toString || statusChange.to)) ||
      event.issue &&
        event.issue.fields &&
        event.issue.fields.status &&
        (event.issue.fields.status.name || event.issue.fields.status.statusCategory && event.issue.fields.status.statusCategory.name),
  );

  return {
    previousStatus,
    nextStatus,
  };
}

function resolveJiraEventId(event) {
  if (event && event.delivery_id) {
    return event.delivery_id;
  }
  if (event && event.webhookEventId) {
    return event.webhookEventId;
  }
  return null;
}

function buildJiraMattermostContext(input) {
  const event = input.event || {};
  const issue = event.issue || {};
  const issueFields = issue.fields || {};
  const issueKey = normalizePart(issue.key || issue.id);
  const projectKey = normalizePart(issueFields.project && (issueFields.project.key || issueFields.project.id));
  const targetChannel = normalizePart(input.targetChannel);
  const summary = normalizePart(issueFields.summary);
  const assignee = normalizePart(issueFields.assignee && issueFields.assignee.displayName);
  const actor = normalizePart(
    (event.user && (event.user.displayName || event.user.name)) || input.actor,
  );
  const eventType = normalizePart(event.webhookEvent || event.issue_event_type_name || "jira.issue_transition");
  const status = extractJiraStatusChange(event);
  const eventEpoch = parseEpochSeconds(event.timestamp, input.fallbackEpochSeconds);
  const sourceEventId = resolveJiraEventId(event);
  const normalizedDedupeKey = buildNormalizedDedupeKey({
    source: "jira",
    sourceProject: projectKey,
    targetChannel,
    eventType,
    entityId: issueKey,
    normalizedTargetStatus: status.nextStatus,
    normalizedActor: actor,
  });
  const dedupeIdentity = resolveDedupeIdentity(sourceEventId, normalizedDedupeKey);
  const dedupeHash = sha256Hex(dedupeIdentity.value);
  const bucket = windowBucket10m(eventEpoch);
  const cacheKey = `mm-dedupe-${dedupeHash}-${bucket}`;
  const browseUrl =
    issueKey !== "_" && input.jiraBaseUrl
      ? `${String(input.jiraBaseUrl).replace(/\/+$/, "")}/browse/${issueKey}`
      : normalizePart(issue.self);

  return {
    payload: {
      text: [
        `[Jira] ${issueKey} ${status.previousStatus} -> ${status.nextStatus}`,
        `summary=${summary}`,
        `assignee=${assignee} actor=${actor}`,
        browseUrl,
      ].join("\n"),
      props: {
        source: "jira",
        source_project: projectKey,
        target_channel: targetChannel,
        event_type: eventType,
        entity_id: issueKey,
        previous_status: status.previousStatus,
        target_status: status.nextStatus,
        summary,
        assignee,
        actor,
        issue_url: browseUrl,
      },
    },
    audit: {
      source: "jira",
      source_project: projectKey,
      target_channel: targetChannel,
      event_type: eventType,
      entity_id: issueKey,
      normalized_target_status: status.nextStatus,
      normalized_actor: actor,
      source_event_id: normalizePart(sourceEventId),
      normalized_dedupe_key: normalizedDedupeKey,
      dedupe_mode: dedupeIdentity.mode,
      dedupe_hash: dedupeHash,
      window_bucket_10m: bucket,
      event_epoch: eventEpoch,
      suppression_window_seconds: SUPPRESSION_WINDOW_SECONDS,
      cache_key: cacheKey,
    },
    source: "jira",
    entityKey: issueKey,
    eventType,
    sourceEventId: normalizePart(sourceEventId),
    normalizedDedupeKey,
    dedupeMode: dedupeIdentity.mode,
    dedupeValue: dedupeIdentity.value,
    dedupeHash,
    windowBucket10m: bucket,
    cacheKey,
    eventEpoch,
  };
}

module.exports = {
  SUPPRESSION_WINDOW_SECONDS,
  normalizePart,
  parseEpochSeconds,
  windowBucket10m,
  buildNormalizedDedupeKey,
  sha256Hex,
  resolveDedupeIdentity,
  buildGitHubMattermostContext,
  buildJiraMattermostContext,
};
