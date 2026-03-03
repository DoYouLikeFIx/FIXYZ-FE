"use strict";

const fs = require("node:fs");
const {
  buildGitHubMattermostContext,
} = require("./notification-utils");

function writeOutput(key, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    process.stdout.write(`${key}=${value}\n`);
    return;
  }

  fs.appendFileSync(outputPath, `${key}<<__BMAD__\n${value}\n__BMAD__\n`);
}

function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is required");
  }

  const rawEvent = fs.readFileSync(eventPath, "utf8");
  const event = JSON.parse(rawEvent);
  const context = buildGitHubMattermostContext({
    eventName: process.env.GITHUB_EVENT_NAME,
    event,
    repository: process.env.GITHUB_REPOSITORY || (event.repository && event.repository.full_name),
    targetChannel: process.env.MATTERMOST_CHANNEL_KEY || process.env.GITHUB_REPOSITORY || "_",
    actor: process.env.GITHUB_ACTOR || (event.sender && event.sender.login),
  });

  writeOutput("payload_json", JSON.stringify(context.payload));
  writeOutput("audit_json", JSON.stringify(context.audit));
  writeOutput("event_type", context.eventType);
  writeOutput("entity_key", context.entityKey);
  writeOutput("normalized_dedupe_key", context.normalizedDedupeKey);
  writeOutput("dedupe_mode", context.dedupeMode);
  writeOutput("dedupe_value", context.dedupeValue);
  writeOutput("dedupe_hash", context.dedupeHash);
  writeOutput("window_bucket_10m", String(context.windowBucket10m));
  writeOutput("cache_key", context.cacheKey);
}

if (require.main === module) {
  main();
}

