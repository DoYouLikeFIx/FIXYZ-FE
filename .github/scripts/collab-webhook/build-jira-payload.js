"use strict";

const fs = require("node:fs");
const { buildJiraMattermostContext } = require("./notification-utils");

function usage() {
  process.stderr.write(
    "Usage: node .github/scripts/collab-webhook/build-jira-payload.js <jira-event.json>\n",
  );
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    usage();
    process.exitCode = 1;
    return;
  }

  const payloadRaw = fs.readFileSync(inputPath, "utf8");
  const event = JSON.parse(payloadRaw);
  const context = buildJiraMattermostContext({
    event,
    targetChannel: process.env.MATTERMOST_CHANNEL_KEY || "jira-default-channel",
    jiraBaseUrl: process.env.JIRA_BASE_URL || "",
    actor: process.env.JIRA_ACTOR || "",
  });

  process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

