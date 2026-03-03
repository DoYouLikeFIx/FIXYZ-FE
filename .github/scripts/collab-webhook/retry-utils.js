"use strict";

const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_SCHEDULE_MS = {
  github: [2000, 5000],
  jira: [2000, 5000],
};

function normalizeSource(source) {
  return source === "jira" ? "jira" : "github";
}

function resolveRetrySchedule(source) {
  return RETRY_SCHEDULE_MS[normalizeSource(source)];
}

function jitterDelayMs(baseDelayMs, rng = Math.random) {
  const randomValue = Math.min(1, Math.max(0, Number(rng())));
  const jitterFactor = 0.8 + randomValue * 0.4;
  return Math.round(baseDelayMs * jitterFactor);
}

function getRetryDelayMs(input) {
  const source = normalizeSource(input.source);
  const retryNumber = Number(input.retryNumber);
  if (!Number.isInteger(retryNumber) || retryNumber <= 0) {
    return 0;
  }

  const schedule = resolveRetrySchedule(source);
  const baseDelayMs = schedule[retryNumber - 1];
  if (!baseDelayMs) {
    return 0;
  }

  if (source === "github") {
    return jitterDelayMs(baseDelayMs, input.rng);
  }

  return baseDelayMs;
}

function getRetryDelayRangeMs(input) {
  const source = normalizeSource(input.source);
  const retryNumber = Number(input.retryNumber);
  const schedule = resolveRetrySchedule(source);
  const baseDelayMs = schedule[retryNumber - 1];
  if (!baseDelayMs) {
    return { min: 0, max: 0 };
  }

  if (source === "github") {
    return {
      min: Math.round(baseDelayMs * 0.8),
      max: Math.round(baseDelayMs * 1.2),
    };
  }

  return {
    min: baseDelayMs,
    max: baseDelayMs,
  };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHttpError(statusCode, responseBody) {
  const error = new Error(`MatterMost responded with status ${statusCode}`);
  error.statusCode = statusCode;
  error.responseBody = responseBody;
  return error;
}

function toLogRecord(base, additional) {
  return JSON.stringify(Object.assign({}, base, additional));
}

function pickLogger(logger) {
  const safeLogger = logger || {};
  return {
    info: typeof safeLogger.info === "function" ? safeLogger.info.bind(safeLogger) : () => {},
    warn: typeof safeLogger.warn === "function" ? safeLogger.warn.bind(safeLogger) : () => {},
    error: typeof safeLogger.error === "function" ? safeLogger.error.bind(safeLogger) : () => {},
  };
}

async function postMattermostWithRetry(options) {
  const source = normalizeSource(options.source);
  const webhookUrl = options.webhookUrl;
  const payload = options.payload;
  const entityKey = options.entityKey || "_";
  const maxAttempts = Number(options.maxAttempts || DEFAULT_MAX_ATTEMPTS);
  const timeoutMs = Number(options.timeoutMs || 10_000);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const rng = options.rng || Math.random;
  const sleepFn = options.sleepFn || defaultSleep;
  const logger = pickLogger(options.logger || console);

  if (!webhookUrl) {
    throw new Error("MATTERMOST_WEBHOOK_URL is required");
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload JSON is required");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch implementation is not available");
  }

  logger.info(
    toLogRecord(
      {
        event: "mattermost_post_start",
        source,
        entity_key: entityKey,
      },
      {
        max_attempts: maxAttempts,
        retry_contract:
          source === "github"
            ? "max_attempts=3;delays=2s,5s;jitter=+-20%"
            : "max_attempts=3;delays=2s,5s;no_jitter",
      },
    ),
  );

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      const retryNumber = attempt - 1;
      const delayMs = getRetryDelayMs({
        source,
        retryNumber,
        rng,
      });
      logger.info(
        toLogRecord(
          {
            event: "mattermost_retry_wait",
            source,
            entity_key: entityKey,
          },
          {
            retry_number: retryNumber,
            delay_ms: delayMs,
          },
        ),
      );
      await sleepFn(delayMs);
    }

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    try {
      const response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });
      const responseBody = await response.text();
      if (!response.ok) {
        throw createHttpError(response.status, responseBody.slice(0, 512));
      }

      logger.info(
        toLogRecord(
          {
            event: "mattermost_post_success",
            source,
            entity_key: entityKey,
          },
          {
            attempt,
            status_code: response.status,
          },
        ),
      );

      return {
        source,
        entityKey,
        attempt,
        statusCode: response.status,
      };
    } catch (error) {
      lastError = error;
      const classification =
        error && error.name === "AbortError"
          ? "timeout"
          : error && error.statusCode
            ? `http_${error.statusCode}`
            : "network_or_unknown";
      logger.warn(
        toLogRecord(
          {
            event: "mattermost_post_failure",
            source,
            entity_key: entityKey,
          },
          {
            attempt,
            classification,
            message: error && error.message ? error.message : "unknown error",
          },
        ),
      );
      if (attempt >= maxAttempts) {
        break;
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  const finalError = lastError || new Error("MatterMost post failed after retries");
  finalError.attempts = maxAttempts;
  throw finalError;
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  RETRY_SCHEDULE_MS,
  normalizeSource,
  getRetryDelayMs,
  getRetryDelayRangeMs,
  postMattermostWithRetry,
};

