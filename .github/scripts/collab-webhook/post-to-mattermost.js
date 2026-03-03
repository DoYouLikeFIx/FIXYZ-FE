"use strict";

const { postMattermostWithRetry } = require("./retry-utils");

function parsePayload() {
  const raw = process.env.PAYLOAD_JSON;
  if (!raw) {
    throw new Error("PAYLOAD_JSON is required");
  }
  return JSON.parse(raw);
}

async function main() {
  const source = process.env.WEBHOOK_SOURCE || "github";
  const payload = parsePayload();
  const webhookUrl = process.env.MATTERMOST_WEBHOOK_URL;
  const entityKey = process.env.ENTITY_KEY || "_";

  await postMattermostWithRetry({
    source,
    webhookUrl,
    payload,
    entityKey,
    maxAttempts: 3,
    timeoutMs: Number(process.env.MATTERMOST_TIMEOUT_MS || 10_000),
    logger: console,
  });
}

if (require.main === module) {
  main().catch((error) => {
    const details = {
      event: "mattermost_post_final_failure",
      message: error && error.message ? error.message : "Unknown failure",
      attempts: error && error.attempts ? error.attempts : 0,
    };
    console.error(JSON.stringify(details));
    process.exitCode = 1;
  });
}

