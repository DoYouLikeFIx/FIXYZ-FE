"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getRetryDelayMs,
  getRetryDelayRangeMs,
  postMattermostWithRetry,
} = require("../../.github/scripts/collab-webhook/retry-utils");

test("GitHub retry delays apply +-20% jitter and Jira delays remain fixed", () => {
  assert.equal(getRetryDelayMs({ source: "github", retryNumber: 1, rng: () => 0 }), 1600);
  assert.equal(getRetryDelayMs({ source: "github", retryNumber: 1, rng: () => 1 }), 2400);
  assert.equal(getRetryDelayMs({ source: "github", retryNumber: 2, rng: () => 0 }), 4000);
  assert.equal(getRetryDelayMs({ source: "github", retryNumber: 2, rng: () => 1 }), 6000);
  assert.equal(getRetryDelayMs({ source: "jira", retryNumber: 1, rng: () => 0.5 }), 2000);
  assert.equal(getRetryDelayMs({ source: "jira", retryNumber: 2, rng: () => 0.5 }), 5000);
});

test("retry delay range helper matches deterministic verification contract", () => {
  assert.deepEqual(getRetryDelayRangeMs({ source: "github", retryNumber: 1 }), {
    min: 1600,
    max: 2400,
  });
  assert.deepEqual(getRetryDelayRangeMs({ source: "github", retryNumber: 2 }), {
    min: 4000,
    max: 6000,
  });
  assert.deepEqual(getRetryDelayRangeMs({ source: "jira", retryNumber: 1 }), {
    min: 2000,
    max: 2000,
  });
  assert.deepEqual(getRetryDelayRangeMs({ source: "jira", retryNumber: 2 }), {
    min: 5000,
    max: 5000,
  });
});

test("postMattermostWithRetry retries until success and records delay schedule", async () => {
  let attemptCounter = 0;
  const sleepCalls = [];
  const logCalls = [];
  const response = {
    ok: true,
    status: 200,
    text: async () => "ok",
  };

  const result = await postMattermostWithRetry({
    source: "github",
    webhookUrl: "https://mattermost.example/hooks/abc123",
    entityKey: "pr-15",
    payload: { text: "hello" },
    maxAttempts: 3,
    rng: () => 0.5,
    sleepFn: async (ms) => {
      sleepCalls.push(ms);
    },
    logger: {
      info: (entry) => logCalls.push(entry),
      warn: () => {},
      error: () => {},
    },
    fetchImpl: async () => {
      attemptCounter += 1;
      if (attemptCounter < 3) {
        return {
          ok: false,
          status: 502,
          text: async () => "temporary upstream error",
        };
      }
      return response;
    },
  });

  assert.equal(attemptCounter, 3);
  assert.deepEqual(sleepCalls, [2000, 5000]);
  assert.equal(result.attempt, 3);
  assert.equal(result.statusCode, 200);
  assert.ok(logCalls.some((line) => line.includes("mattermost_post_start")));
});

test("postMattermostWithRetry fails after max attempts with Jira fixed backoff", async () => {
  const sleepCalls = [];
  let attemptCounter = 0;

  await assert.rejects(
    async () =>
      postMattermostWithRetry({
        source: "jira",
        webhookUrl: "https://mattermost.example/hooks/abc123",
        entityKey: "FIX-55",
        payload: { text: "jira event" },
        maxAttempts: 3,
        sleepFn: async (ms) => {
          sleepCalls.push(ms);
        },
        logger: {
          info: () => {},
          warn: () => {},
          error: () => {},
        },
        fetchImpl: async () => {
          attemptCounter += 1;
          throw new Error("socket hang up");
        },
      }),
    (error) => {
      assert.equal(error.attempts, 3);
      assert.equal(error.message, "socket hang up");
      return true;
    },
  );

  assert.equal(attemptCounter, 3);
  assert.deepEqual(sleepCalls, [2000, 5000]);
});

