"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  collectExceptionValidationFindings,
  DEFAULT_POLICY_VERSION,
  DEFAULT_REQUIRED_CHECK,
  buildEvidenceIndex,
  collectWorkflowUses,
  ensureDirectory,
  evaluateActionPinningFindings,
  evaluateDependabotAlerts,
  extractNvdCvssScore,
  normalizeRepoKey,
  normalizeText,
  readJsonFile,
  relativeToRepo,
  summarizeFindings,
  todayUtcYyyymmdd,
  writeJsonFile,
} = require("./security-utils.cjs");

const GITHUB_API_VERSION = process.env.GITHUB_API_VERSION || "2026-03-10";
const GITHUB_API_URL = process.env.GITHUB_API_URL || "https://api.github.com";
const NVD_API_URL = process.env.NVD_API_URL || "https://services.nvd.nist.gov/rest/json/cves/2.0";

function readPositiveNumberEnv(name, fallback) {
  const parsed = Number(process.env[name] || String(fallback));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const REQUEST_TIMEOUT_MS = readPositiveNumberEnv("REQUEST_TIMEOUT_MS", 15000);
const REQUEST_MAX_ATTEMPTS = Math.max(1, Math.floor(readPositiveNumberEnv("REQUEST_MAX_ATTEMPTS", 3)));
const REQUEST_RETRY_BASE_MS = readPositiveNumberEnv("REQUEST_RETRY_BASE_MS", 750);

function sanitizePathSegment(value, fallback) {
  const normalized = normalizeText(value, fallback);
  const sanitized = String(normalized)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || fallback;
}

function normalizeEvidenceDate(value, fallback) {
  const normalized = normalizeText(value);
  return normalized && /^\d{8}$/.test(normalized) ? normalized : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(attempt) {
  return REQUEST_RETRY_BASE_MS * Math.max(1, 2 ** (attempt - 1));
}

function parseResponsePayload(text, contentType) {
  if (!text) {
    return {};
  }

  const trimmed = text.trim();
  const normalizedType = normalizeText(contentType, "");
  const shouldParseJson =
    /json/i.test(normalizedType) || trimmed.startsWith("{") || trimmed.startsWith("[");

  if (!shouldParseJson) {
    return trimmed;
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const parseError = new Error(`Invalid JSON response: ${error.message}`);
    parseError.cause = error;
    throw parseError;
  }
}

function extractErrorDetail(payload, fallbackText) {
  if (payload && typeof payload === "object") {
    return normalizeText(payload.message, JSON.stringify(payload));
  }

  return normalizeText(payload, normalizeText(fallbackText, "<empty response>"));
}

function shouldRetryRequest(error) {
  if (!error) {
    return false;
  }

  if (error.name === "AbortError" || error instanceof TypeError) {
    return true;
  }

  const status = Number(error.status);
  if (!Number.isFinite(status)) {
    return false;
  }

  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return true;
  }

  if (status !== 403) {
    return false;
  }

  const responseHeaders = error.responseHeaders;
  const rateLimitRemaining =
    responseHeaders && typeof responseHeaders.get === "function"
      ? responseHeaders.get("x-ratelimit-remaining")
      : null;
  const retryAfter =
    responseHeaders && typeof responseHeaders.get === "function"
      ? responseHeaders.get("retry-after")
      : null;
  const message = extractErrorDetail(error.payload, "");

  return rateLimitRemaining === "0" || Boolean(retryAfter) || /rate limit/i.test(message);
}

function defaultEvidenceRunId(date = new Date()) {
  const explicitRunId = normalizeText(process.env.EVIDENCE_RUN_ID);
  if (explicitRunId) {
    return sanitizePathSegment(explicitRunId, "manual-run");
  }

  const githubRunId = normalizeText(process.env.GITHUB_RUN_ID);
  const githubRunAttempt = normalizeText(process.env.GITHUB_RUN_ATTEMPT);
  if (githubRunId && githubRunAttempt) {
    return sanitizePathSegment(`${githubRunId}-${githubRunAttempt}`, "github-run");
  }

  if (githubRunId) {
    return sanitizePathSegment(githubRunId, "github-run");
  }

  return sanitizePathSegment(
    date.toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z"),
    "manual-run",
  );
}

async function requestJson(url, token) {
  const isGitHubRequest = url.startsWith(GITHUB_API_URL);
  const headers = {
    Accept: isGitHubRequest ? "application/vnd.github+json" : "application/json",
    "User-Agent": "fixyz-supply-chain-baseline",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (isGitHubRequest) {
    headers["X-GitHub-Api-Version"] = GITHUB_API_VERSION;
  }

  let lastError = null;

  for (let attempt = 1; attempt <= REQUEST_MAX_ATTEMPTS; attempt += 1) {
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers,
        signal: abortController.signal,
      });
      const text = await response.text();
      const payload = parseResponsePayload(text, response.headers.get("content-type"));

      if (!response.ok) {
        const error = new Error(
          `${response.status} ${response.statusText} while requesting ${url}: ${extractErrorDetail(payload, text)}`,
        );
        error.status = response.status;
        error.payload = payload;
        error.responseHeaders = response.headers;
        throw error;
      }

      if (payload && typeof payload === "object") {
        return payload;
      }

      if (payload === null || payload === undefined || payload === "") {
        return {};
      }

      throw new Error(`Unexpected non-JSON response while requesting ${url}: ${payload}`);
    } catch (error) {
      lastError =
        error.name === "AbortError"
          ? Object.assign(
              new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms while requesting ${url}`),
              { name: "AbortError" },
            )
          : error;

      if (attempt < REQUEST_MAX_ATTEMPTS && shouldRetryRequest(lastError)) {
        await sleep(getRetryDelayMs(attempt));
        continue;
      }

      throw lastError;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw lastError || new Error(`Request failed for ${url}`);
}

function extractNextLink(linkHeaderValue) {
  const linkHeader = normalizeText(linkHeaderValue, "");
  if (!linkHeader) {
    return null;
  }

  for (const segment of linkHeader.split(",")) {
    const trimmed = segment.trim();
    const match = trimmed.match(/^<([^>]+)>;\s*rel="([^"]+)"$/);
    if (match && match[2] === "next") {
      return match[1];
    }
  }

  return null;
}

async function requestJsonWithHeaders(url, token) {
  const isGitHubRequest = url.startsWith(GITHUB_API_URL);
  const headers = {
    Accept: isGitHubRequest ? "application/vnd.github+json" : "application/json",
    "User-Agent": "fixyz-supply-chain-baseline",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (isGitHubRequest) {
    headers["X-GitHub-Api-Version"] = GITHUB_API_VERSION;
  }

  let lastError = null;

  for (let attempt = 1; attempt <= REQUEST_MAX_ATTEMPTS; attempt += 1) {
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers,
        signal: abortController.signal,
      });
      const text = await response.text();
      const payload = parseResponsePayload(text, response.headers.get("content-type"));

      if (!response.ok) {
        const error = new Error(
          `${response.status} ${response.statusText} while requesting ${url}: ${extractErrorDetail(payload, text)}`,
        );
        error.status = response.status;
        error.payload = payload;
        error.responseHeaders = response.headers;
        throw error;
      }

      return {
        payload:
          payload === null || payload === undefined || payload === ""
            ? {}
            : payload,
        headers: response.headers,
      };
    } catch (error) {
      lastError =
        error.name === "AbortError"
          ? Object.assign(
              new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms while requesting ${url}`),
              { name: "AbortError" },
            )
          : error;

      if (attempt < REQUEST_MAX_ATTEMPTS && shouldRetryRequest(lastError)) {
        await sleep(getRetryDelayMs(attempt));
        continue;
      }

      throw lastError;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw lastError || new Error(`Request failed for ${url}`);
}

async function loadDependabotAlerts(repoSlug, token) {
  const fixturePath = normalizeText(process.env.DEPENDABOT_ALERTS_FIXTURE);
  if (fixturePath) {
    return readJsonFile(path.resolve(fixturePath));
  }

  if (!token) {
    throw new Error("ALERTS_TOKEN or GITHUB_TOKEN is required to query Dependabot alerts");
  }

  const alerts = [];
  let nextUrl = new URL(`${GITHUB_API_URL}/repos/${repoSlug}/dependabot/alerts`);
  nextUrl.searchParams.set("state", "open");
  nextUrl.searchParams.set("per_page", "100");

  while (nextUrl) {
    const { payload, headers } = await requestJsonWithHeaders(nextUrl.toString(), token);
    const pageItems = Array.isArray(payload) ? payload : [];
    alerts.push(...pageItems);
    nextUrl = extractNextLink(headers.get("link"));
  }

  return alerts;
}

async function buildNvdLookup() {
  const fixturePath = normalizeText(process.env.NVD_FIXTURE);
  const fixture = fixturePath ? readJsonFile(path.resolve(fixturePath)) : null;
  const cache = new Map();

  return async function lookup(cveId) {
    if (cache.has(cveId)) {
      return cache.get(cveId);
    }

    let result = null;

    if (fixture && fixture[cveId]) {
      result = extractNvdCvssScore(fixture[cveId]);
    } else {
      const url = new URL(NVD_API_URL);
      url.searchParams.set("cveId", cveId);
      const payload = await requestJson(url.toString(), "");
      result = extractNvdCvssScore(payload);
    }

    cache.set(cveId, result);
    return result;
  };
}

async function captureBranchProtectionEvidence({
  repoSlug,
  branch,
  expectedRequiredCheck,
  token,
}) {
  const fixturePath = normalizeText(process.env.BRANCH_PROTECTION_FIXTURE);
  const now = new Date().toISOString();
  let protectionPayload = null;
  let permissionsPayload = null;
  let captureMethod = "github-rest-api";
  let status = "operator-action-required";
  let failureReason = null;

  if (fixturePath) {
    captureMethod = "fixture";
    const fixture = readJsonFile(path.resolve(fixturePath));
    protectionPayload = fixture.branchProtection || fixture;
    permissionsPayload = fixture.actionsPermissions || null;
  } else if (!token) {
    captureMethod = "pending-secret";
    failureReason = "BRANCH_PROTECTION_TOKEN is not configured";
  } else {
    try {
      protectionPayload = await requestJson(
        `${GITHUB_API_URL}/repos/${repoSlug}/branches/${branch}/protection`,
        token,
      );
    } catch (error) {
      failureReason = error.message;
      captureMethod = "github-rest-api";
    }

    try {
      permissionsPayload = await requestJson(
        `${GITHUB_API_URL}/repos/${repoSlug}/actions/permissions`,
        token,
      );
    } catch (error) {
      permissionsPayload = {
        enabled: null,
        allowed_actions: null,
        sha_pinning_required: null,
        status: "capture-failed",
        reason: error.message,
      };
    }
  }

  const requiredStatusChecks = [];
  if (protectionPayload && protectionPayload.required_status_checks) {
    const checks = protectionPayload.required_status_checks;
    for (const context of checks.contexts || []) {
      requiredStatusChecks.push(normalizeText(context));
    }
    for (const check of checks.checks || []) {
      if (normalizeText(check.context)) {
        requiredStatusChecks.push(normalizeText(check.context));
      }
    }
  }

  const uniqueChecks = Array.from(new Set(requiredStatusChecks.filter(Boolean)));

  if (protectionPayload) {
    status = uniqueChecks.includes(expectedRequiredCheck) ? "bound" : "unbound";
  }

  return {
    repo: normalizeRepoKey(repoSlug.split("/")[1] || repoSlug),
    branch,
    capturedAt: now,
    captureMethod,
    requiredChecks: uniqueChecks,
    enforceAdmins:
      protectionPayload && protectionPayload.enforce_admins
        ? Boolean(protectionPayload.enforce_admins.enabled)
        : null,
    status,
    expectedRequiredCheck,
    actionsPermissions: permissionsPayload
      ? {
          enabled: permissionsPayload.enabled,
          allowedActions: permissionsPayload.allowed_actions,
          shaPinningRequired: permissionsPayload.sha_pinning_required,
          status:
            normalizeText(permissionsPayload.status) ||
            (permissionsPayload.sha_pinning_required === true ? "captured" : "unknown"),
          reason: normalizeText(permissionsPayload.reason),
        }
      : {
          enabled: null,
          allowedActions: null,
          shaPinningRequired: null,
          status: token ? "capture-failed" : "operator-action-required",
          reason: token ? failureReason : "BRANCH_PROTECTION_TOKEN is not configured",
        },
    reason: failureReason,
  };
}

function emitGithubOutput(name, value) {
  const outputPath = normalizeText(process.env.GITHUB_OUTPUT);
  if (!outputPath) {
    return;
  }

  fs.appendFileSync(outputPath, `${name}=${String(value)}\n`, "utf8");
}

function appendStepSummary(lines) {
  const summaryPath = normalizeText(process.env.GITHUB_STEP_SUMMARY);
  if (!summaryPath) {
    return;
  }

  fs.appendFileSync(summaryPath, `${lines.join("\n")}\n`, "utf8");
}

function escapeGithubCommandData(value) {
  return String(value)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

function escapeGithubCommandProperty(value) {
  return escapeGithubCommandData(value)
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");
}

function emitGithubAnnotation(level, title, message, properties = {}) {
  if (!normalizeText(process.env.GITHUB_ACTIONS)) {
    return;
  }

  const normalizedLevel = normalizeText(level, "notice").toLowerCase();
  const propertyEntries = [["title", normalizeText(title, "Supply Chain Security")]]
    .concat(Object.entries(properties))
    .filter(([, value]) => value !== null && value !== undefined && String(value).length > 0)
    .map(([key, value]) => `${key}=${escapeGithubCommandProperty(value)}`);
  const propertySegment = propertyEntries.length > 0 ? ` ${propertyEntries.join(",")}` : "";
  const escapedMessage = escapeGithubCommandData(message);

  console.log(`::${normalizedLevel}${propertySegment}::${escapedMessage}`);
}

function formatFindingForConsole(finding) {
  const segments = [normalizeText(finding.type, "finding")];

  if (normalizeText(finding.package)) {
    segments.push(`package=${finding.package}`);
  }

  if (normalizeText(finding.manifestPath)) {
    segments.push(`manifest=${finding.manifestPath}`);
  }

  if (normalizeText(finding.workflowFile)) {
    segments.push(`workflow=${finding.workflowFile}`);
  }

  if (finding.cvss !== null && finding.cvss !== undefined && Number.isFinite(Number(finding.cvss))) {
    segments.push(`cvss=${Number(finding.cvss).toFixed(1)}`);
  }

  segments.push(normalizeText(finding.reason, "No reason provided"));
  return segments.join(" | ");
}

function logRunOutcome({
  repoKey,
  repoSlug,
  branch,
  finalStatus,
  summary,
  findings,
  branchProtection,
  expectedRequiredCheck,
  outputDirectoryRelative,
  failOnBranchProtectionAudit,
  branchProtectionTokenConfigured,
}) {
  const summaryLine =
    `[supply-chain-security] repo=${repoKey} status=${finalStatus} ` +
    `blockingFindings=${summary.blockingFindings} branchProtectionStatus=${branchProtection.status} ` +
    `evidence=${outputDirectoryRelative}`;

  console.log(summaryLine);

  const blockingFindings = findings.filter((finding) => finding.blocker);
  if (blockingFindings.length > 0) {
    console.error("[supply-chain-security] Blocking findings:");
    blockingFindings.slice(0, 5).forEach((finding, index) => {
      console.error(`  ${index + 1}. ${formatFindingForConsole(finding)}`);
    });

    if (blockingFindings.length > 5) {
      console.error(`  ...and ${blockingFindings.length - 5} more blocking finding(s)`);
    }

    const firstBlockingFinding = formatFindingForConsole(blockingFindings[0]);
    const blockingAnnotationMessage =
      `Detected ${blockingFindings.length} blocking finding(s) for ${repoSlug}@${branch}. ` +
      `First finding: ${firstBlockingFinding}. Evidence: ${outputDirectoryRelative}`;
    emitGithubAnnotation("error", "Supply Chain Security Blocked", blockingAnnotationMessage);
    console.error(
      `[supply-chain-security] Failing workflow: detected ${blockingFindings.length} blocking finding(s)`,
    );
  }

  if (branchProtection.status !== "bound") {
    const branchProtectionReason =
      normalizeText(branchProtection.reason) ||
      normalizeText(branchProtection.actionsPermissions && branchProtection.actionsPermissions.reason) ||
      `Expected required check '${expectedRequiredCheck}' is not bound on branch '${branch}'`;
    const branchProtectionLine =
      `[supply-chain-security] Branch protection audit for ${repoSlug}@${branch} ` +
      `returned status=${branchProtection.status}; expectedCheck=${expectedRequiredCheck}; ` +
      `tokenConfigured=${branchProtectionTokenConfigured}; reason=${branchProtectionReason}`;

    if (failOnBranchProtectionAudit) {
      console.error(branchProtectionLine);
      emitGithubAnnotation(
        "error",
        "Branch Protection Audit Failed",
        `Expected required check '${expectedRequiredCheck}' is not verifiably bound for ${repoSlug}@${branch}. ` +
          `Status=${branchProtection.status}. Reason: ${branchProtectionReason}. Evidence: ${outputDirectoryRelative}`,
      );
      console.error(
        `[supply-chain-security] Failing workflow: branch protection audit is not bound to '${expectedRequiredCheck}'`,
      );
    } else {
      console.log(branchProtectionLine);
      emitGithubAnnotation(
        "warning",
        "Branch Protection Audit Pending",
        `Required check '${expectedRequiredCheck}' is not yet proven bound for ${repoSlug}@${branch}. ` +
          `Status=${branchProtection.status}. Reason: ${branchProtectionReason}. Evidence: ${outputDirectoryRelative}`,
      );
    }
  }

  appendStepSummary([
    "## Supply Chain Security Result",
    `- Repository: \`${repoSlug}\``,
    `- Branch: \`${branch}\``,
    `- Final status: \`${finalStatus}\``,
    `- Blocking findings: \`${summary.blockingFindings}\``,
    `- Branch protection status: \`${branchProtection.status}\``,
    `- Evidence directory: \`${outputDirectoryRelative}\``,
    "",
    "### Top Blocking Findings",
    ...(blockingFindings.length > 0
      ? blockingFindings
          .slice(0, 5)
          .map((finding) => `- ${formatFindingForConsole(finding)}`)
      : ["- None"]),
    "",
    "### Branch Protection Audit",
    `- Expected required check: \`${expectedRequiredCheck}\``,
    `- Token configured: \`${branchProtectionTokenConfigured}\``,
    `- Status: \`${branchProtection.status}\``,
    `- Reason: ${normalizeText(branchProtection.reason) || normalizeText(branchProtection.actionsPermissions && branchProtection.actionsPermissions.reason) || "None"}`,
  ]);
}

function createBlockingErrorFinding({
  type,
  repo,
  manifestPath = null,
  fixedVersion,
  reason,
  metadata = {},
}) {
  return {
    type,
    repo,
    package: null,
    manifestPath,
    currentVersion: null,
    fixedVersion,
    severity: "high",
    cvss: null,
    cvssSource: "policy",
    decision: "block",
    exceptionId: null,
    triageRequired: false,
    blocker: true,
    advisoryId: null,
    cveIds: [],
    workflowFile: null,
    lineNumber: null,
    uses: null,
    reason,
    ...metadata,
  };
}

async function main() {
  const repoRoot = process.cwd();
  const nowDate = new Date();
  const now = nowDate.getTime();
  const repoSlug =
    normalizeText(process.env.REPO_SLUG) ||
    normalizeText(process.env.GITHUB_REPOSITORY) ||
    path.basename(repoRoot);
  const repoKey = normalizeRepoKey(repoSlug.split("/")[1] || repoSlug);
  const defaultBranch = normalizeText(process.env.DEFAULT_BRANCH, "main");
  const evidenceDate = normalizeEvidenceDate(
    process.env.EVIDENCE_DATE,
    todayUtcYyyymmdd(nowDate),
  );
  const evidenceRunId = defaultEvidenceRunId(nowDate);
  const outputBaseRoot = path.resolve(
    normalizeText(
      process.env.OUTPUT_ROOT_BASE,
      path.join(repoRoot, "docs", "ops", "security-scan", evidenceDate),
    ),
  );
  const outputRoot = path.resolve(
    normalizeText(process.env.OUTPUT_ROOT, path.join(outputBaseRoot, evidenceRunId)),
  );
  const outputDirectoryRelative = relativeToRepo(repoRoot, outputRoot);
  const outputBaseDirectoryRelative = relativeToRepo(repoRoot, outputBaseRoot);
  const policyVersion = normalizeText(process.env.POLICY_VERSION, DEFAULT_POLICY_VERSION);
  const expectedRequiredCheck = normalizeText(
    process.env.EXPECTED_REQUIRED_CHECK,
    DEFAULT_REQUIRED_CHECK,
  );
  const retentionDays = Number(process.env.RETENTION_DAYS || "90");
  const alertsToken =
    normalizeText(process.env.ALERTS_TOKEN) || normalizeText(process.env.GITHUB_TOKEN);
  const branchProtectionToken = normalizeText(process.env.BRANCH_PROTECTION_TOKEN);
  const exceptionsPath = path.resolve(
    normalizeText(
      process.env.EXCEPTIONS_PATH,
      path.join(repoRoot, ".github", "security", "dependency-exceptions.json"),
    ),
  );
  ensureDirectory(outputRoot);
  emitGithubOutput("output_directory", outputDirectoryRelative);
  emitGithubOutput("output_base_directory", outputBaseDirectoryRelative);
  const workflowEntries = collectWorkflowUses(path.join(repoRoot, ".github", "workflows"));
  const exceptionsRelativePath = relativeToRepo(repoRoot, exceptionsPath);
  let exceptionRegistry = { policyVersion, records: [] };
  const preflightFindings = [];

  if (fs.existsSync(exceptionsPath)) {
    try {
      exceptionRegistry = readJsonFile(exceptionsPath);
    } catch (error) {
      preflightFindings.push(
        createBlockingErrorFinding({
          type: "configuration-error",
          repo: repoKey,
          manifestPath: exceptionsRelativePath,
          fixedVersion: "Repair the repository-local exception registry JSON before rerunning",
          reason: `Exception registry could not be parsed: ${error.message}`,
          metadata: {
            configPath: exceptionsRelativePath,
          },
        }),
      );
    }
  }

  const actionPinningFindings = evaluateActionPinningFindings({
    repo: repoKey,
    workflowEntries,
    exceptionRecords: exceptionRegistry.records,
    now,
  });
  const exceptionValidationFindings = collectExceptionValidationFindings({
    repo: repoKey,
    exceptionRecords: exceptionRegistry.records,
    exceptionsPath: exceptionsRelativePath,
  });
  let branchProtection = null;

  try {
    branchProtection = await captureBranchProtectionEvidence({
      repoSlug,
      branch: defaultBranch,
      expectedRequiredCheck,
      token: branchProtectionToken,
    });
  } catch (error) {
    branchProtection = {
      repo: repoKey,
      branch: defaultBranch,
      capturedAt: nowDate.toISOString(),
      captureMethod: "capture-failed",
      requiredChecks: [],
      enforceAdmins: null,
      status: "capture-failed",
      expectedRequiredCheck,
      actionsPermissions: {
        enabled: null,
        allowedActions: null,
        shaPinningRequired: null,
        status: "capture-failed",
        reason: error.message,
      },
      reason: error.message,
    };
  }

  let dependabotAlerts = [];
  let dependabotFindings = [];
  let rawAlertsArtifact = [];

  try {
    dependabotAlerts = await loadDependabotAlerts(repoSlug, alertsToken);
    rawAlertsArtifact = dependabotAlerts;
    const nvdLookup = await buildNvdLookup();
    dependabotFindings = await evaluateDependabotAlerts({
      repo: repoKey,
      alerts: dependabotAlerts,
      exceptionRecords: exceptionRegistry.records,
      nvdLookup,
      now,
    });
  } catch (error) {
    rawAlertsArtifact = {
      status: "capture-failed",
      scanner: "github-dependabot-alerts",
      capturedAt: nowDate.toISOString(),
      reason: error.message,
    };
    dependabotFindings = [
      createBlockingErrorFinding({
        type: "scan-error",
        repo: repoKey,
        fixedVersion: "Restore Dependabot/NVD access or provide a valid authenticated token before rerunning",
        reason: `Dependency security scan failed: ${error.message}`,
        metadata: {
          scanner: "github-dependabot-alerts",
        },
      }),
    ];
  }

  const failOnBranchProtectionAudit =
    normalizeText(
      process.env.FAIL_ON_BRANCH_PROTECTION_AUDIT_ERROR,
      process.env.GITHUB_ACTIONS === "true" ? "true" : "false",
    ) === "true";
  const findings = [
    ...preflightFindings,
    ...dependabotFindings,
    ...actionPinningFindings,
    ...exceptionValidationFindings,
  ];
  const summary = summarizeFindings(findings);
  const finalStatus =
    summary.blockingFindings > 0 ||
    (failOnBranchProtectionAudit && branchProtection.status !== "bound")
      ? "blocked"
      : branchProtection.status === "bound"
        ? "pass"
        : "audit-pending";

  const scanSummaryPath = path.join(outputRoot, `scan-summary-${repoKey}.json`);
  const exceptionsExportPath = path.join(outputRoot, `exceptions-${repoKey}.json`);
  const branchProtectionPath = path.join(outputRoot, `branch-protection-${repoKey}.json`);
  const rawAlertsPath = path.join(outputRoot, `dependabot-alerts-${repoKey}.json`);
  const indexPath = path.join(outputRoot, "index.json");

  writeJsonFile(scanSummaryPath, {
    repo: repoKey,
    workflow: expectedRequiredCheck,
    scanner: "github-dependabot-alerts+workflow-action-pinning",
    branch: defaultBranch,
    scannedAt: nowDate.toISOString(),
    findings,
    summary: {
      ...summary,
      branchProtectionStatus: branchProtection.status,
      status: finalStatus,
    },
  });
  writeJsonFile(exceptionsExportPath, {
    repo: repoKey,
    generatedAt: nowDate.toISOString(),
    sourcePath: exceptionsRelativePath,
    records: exceptionRegistry.records || [],
  });
  writeJsonFile(branchProtectionPath, branchProtection);
  writeJsonFile(rawAlertsPath, rawAlertsArtifact);
  writeJsonFile(
    indexPath,
    buildEvidenceIndex({
      generatedAt: nowDate.toISOString(),
      retentionDays,
      policyVersion,
      snapshotId: evidenceRunId,
      scope: "repository-local",
      repositories: [repoKey],
      artifacts: [
        relativeToRepo(repoRoot, scanSummaryPath),
        relativeToRepo(repoRoot, exceptionsExportPath),
        relativeToRepo(repoRoot, branchProtectionPath),
        relativeToRepo(repoRoot, rawAlertsPath),
      ],
    }),
  );
  emitGithubOutput("blocking_findings", summary.blockingFindings);
  emitGithubOutput("branch_protection_status", branchProtection.status);
  emitGithubOutput("final_status", finalStatus);
  logRunOutcome({
    repoKey,
    repoSlug,
    branch: defaultBranch,
    finalStatus,
    summary,
    findings,
    branchProtection,
    expectedRequiredCheck,
    outputDirectoryRelative,
    failOnBranchProtectionAudit,
    branchProtectionTokenConfigured: Boolean(branchProtectionToken),
  });

  if (summary.blockingFindings > 0) {
    process.exitCode = 1;
    return;
  }

  if (failOnBranchProtectionAudit && branchProtection.status !== "bound") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
