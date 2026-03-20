"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const REPO_CONTEXTS = [
  {
    repoKey: "fixyz",
    repoSlug: "DoYouLikeFIx/FIXYZ",
    directoryHints: ["FIXYZ"],
    packageNameHints: ["FIXYZ"],
    highRiskPackage: "axios",
    highRiskManifestPath: "package-lock.json",
    highRiskEcosystem: "npm",
    highRiskFixedVersion: "1.13.2",
    fallbackPackage: "left-pad",
    fallbackManifestPath: "package-lock.json",
    fallbackEcosystem: "npm",
    fallbackFixedVersion: "1.1.4",
  },
  {
    repoKey: "fixyz-be",
    repoSlug: "DoYouLikeFIx/FIXYZ-BE",
    directoryHints: ["BE", "FIXYZ-BE"],
    packageNameHints: ["BE"],
    highRiskPackage: "org.springframework:spring-web",
    highRiskManifestPath: "build.gradle",
    highRiskEcosystem: "maven",
    highRiskFixedVersion: "6.1.15",
    fallbackPackage: "org.yaml:snakeyaml",
    fallbackManifestPath: "build.gradle",
    fallbackEcosystem: "maven",
    fallbackFixedVersion: "2.3",
  },
  {
    repoKey: "fixyz-fe",
    repoSlug: "DoYouLikeFIx/FIXYZ-FE",
    directoryHints: ["FE", "FIXYZ-FE"],
    packageNameHints: ["FIXYZ-FE"],
    highRiskPackage: "axios",
    highRiskManifestPath: "pnpm-lock.yaml",
    highRiskEcosystem: "npm",
    highRiskFixedVersion: "1.13.2",
    fallbackPackage: "left-pad",
    fallbackManifestPath: "pnpm-lock.yaml",
    fallbackEcosystem: "npm",
    fallbackFixedVersion: "1.1.4",
  },
  {
    repoKey: "fixyz-mob",
    repoSlug: "DoYouLikeFIx/FIXYZ-MOB",
    directoryHints: ["MOB", "FIXYZ-MOB"],
    packageNameHints: ["FIXYZ-MOB"],
    highRiskPackage: "axios",
    highRiskManifestPath: "package-lock.json",
    highRiskEcosystem: "npm",
    highRiskFixedVersion: "1.13.2",
    fallbackPackage: "left-pad",
    fallbackManifestPath: "package-lock.json",
    fallbackEcosystem: "npm",
    fallbackFixedVersion: "1.1.4",
  },
];

function readPackageMetadata(repoRoot) {
  const packageJsonPath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return {
      packageName: "",
      repositoryUrl: "",
    };
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const repository =
    packageJson.repository && typeof packageJson.repository === "object"
      ? packageJson.repository.url
      : packageJson.repository;

  return {
    packageName: String(packageJson.name || "").trim().toUpperCase(),
    repositoryUrl: String(repository || "").trim().toUpperCase(),
  };
}

function resolveRepoContext({
  explicitRepoKey = "",
  repoDirectory = "",
  packageName = "",
  repositoryUrl = "",
}) {
  const normalizedExplicitRepoKey = String(explicitRepoKey || "").trim().toLowerCase();
  if (normalizedExplicitRepoKey) {
    const explicitContext = REPO_CONTEXTS.find(
      (candidate) => candidate.repoKey === normalizedExplicitRepoKey,
    );
    if (explicitContext) {
      return explicitContext;
    }
  }

  const hints = [repoDirectory, packageName, repositoryUrl]
    .filter(Boolean)
    .map((value) => String(value).trim().toUpperCase());

  const context = REPO_CONTEXTS.find((candidate) => {
    const slugHint = candidate.repoSlug.toUpperCase();
    return hints.some(
      (hint) =>
        candidate.directoryHints.includes(hint) ||
        candidate.packageNameHints.includes(hint) ||
        hint.includes(slugHint),
    );
  });

  if (context) {
    return context;
  }

  throw new Error(
    `Unsupported repo test context: directory=${repoDirectory || "<empty>"} package=${packageName || "<empty>"}`,
  );
}

function getRepoContext() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const { packageName, repositoryUrl } = readPackageMetadata(repoRoot);

  return resolveRepoContext({
    explicitRepoKey: process.env.TEST_REPO_KEY,
    repoDirectory: path.basename(repoRoot).toUpperCase(),
    packageName,
    repositoryUrl,
  });
}

function createApprovedExceptionRecords(repoContext) {
  return [
    {
      id: "EXC-0001",
      recordType: "dependency-alert-exception",
      scope: "repository",
      match: {
        repo: repoContext.repoKey,
        package: repoContext.highRiskPackage,
        ghsaId: "GHSA-high-risk",
      },
      decision: "allow-temporary",
      owner: "security@example.com",
      reason: "Temporary mitigation pending upstream release",
      evidence: "Risk review approved",
      requestedAt: "2026-03-20T00:00:00Z",
      reviewedAt: "2026-03-20T00:10:00Z",
      reviewer: "platform-security",
      expiresAt: "2026-04-01T00:00:00Z",
      status: "approved",
    },
    {
      id: "TRIAGE-0001",
      recordType: "manual-triage-decision",
      scope: "repository",
      match: {
        repo: repoContext.repoKey,
        ghsaId: "GHSA-manual-triage",
      },
      decision: "manual-triage-approved",
      owner: "security@example.com",
      reason: "Vendor advisory confirmed non-exploitable in current deployment",
      evidence: "Linked review note",
      requestedAt: "2026-03-20T00:00:00Z",
      reviewedAt: "2026-03-20T00:05:00Z",
      reviewer: "platform-security",
      expiresAt: "2026-04-01T00:00:00Z",
      status: "approved",
    },
  ];
}

function createAlert({
  repoContext,
  advisoryId,
  packageName,
  manifestPath,
  ecosystem,
  fixedVersion,
  cvssScore,
  cveId = null,
}) {
  const identifiers = [
    {
      type: "GHSA",
      value: advisoryId,
    },
  ];

  if (cveId) {
    identifiers.push({
      type: "CVE",
      value: cveId,
    });
  }

  return {
    dependency: {
      manifest_path: manifestPath,
      package: {
        name: packageName,
        ecosystem,
      },
    },
    security_advisory: {
      ghsa_id: advisoryId,
      severity: "high",
      cvss: cvssScore === null ? null : { score: cvssScore },
      identifiers,
    },
    security_vulnerability: {
      package: {
        name: packageName,
        ecosystem,
      },
      severity: "high",
      first_patched_version: fixedVersion ? { identifier: fixedVersion } : null,
    },
    repo: repoContext.repoKey,
  };
}

function createHighRiskAlert(repoContext, advisoryId = "GHSA-high-risk") {
  return [
    createAlert({
      repoContext,
      advisoryId,
      packageName: repoContext.highRiskPackage,
      manifestPath: repoContext.highRiskManifestPath,
      ecosystem: repoContext.highRiskEcosystem,
      fixedVersion: repoContext.highRiskFixedVersion,
      cvssScore: 8.8,
    }),
  ];
}

function createNvdFallbackAlert(repoContext, advisoryId = "GHSA-nvd-retry") {
  return [
    createAlert({
      repoContext,
      advisoryId,
      packageName: repoContext.fallbackPackage,
      manifestPath: repoContext.fallbackManifestPath,
      ecosystem: repoContext.fallbackEcosystem,
      fixedVersion: repoContext.fallbackFixedVersion,
      cvssScore: null,
      cveId: "CVE-2026-1001",
    }),
  ];
}

function buildBaselineInvocation({
  alertsPayload,
  exceptionRecords,
  exceptionRegistryContent = null,
  evidenceRunId,
  extraEnv = {},
  branchProtectionFixture = "branch-protection.json",
  outputBaseRoot,
  useAlertsFixture = true,
  useNvdFixture = true,
}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fixyz-supply-chain-"));
  const repoContext = getRepoContext();
  const baseRoot =
    outputBaseRoot || path.join(tempRoot, "docs", "ops", "security-scan", "20260320");
  const outputRoot = path.join(baseRoot, evidenceRunId);
  const exceptionsPath = path.join(tempRoot, ".github", "security", "dependency-exceptions.json");
  const alertsPath = path.join(tempRoot, `${evidenceRunId}-alerts.json`);

  fs.mkdirSync(path.dirname(exceptionsPath), { recursive: true });
  if (typeof exceptionRegistryContent === "string") {
    fs.writeFileSync(exceptionsPath, exceptionRegistryContent);
  } else {
    fs.writeFileSync(
      exceptionsPath,
      JSON.stringify(
        {
          policyVersion: "story-0.11-v1",
          records: exceptionRecords,
        },
        null,
        2,
      ),
    );
  }

  if (useAlertsFixture) {
    fs.writeFileSync(alertsPath, JSON.stringify(alertsPayload, null, 2));
  }

  const env = {
    ...process.env,
    REPO_SLUG: repoContext.repoSlug,
    DEFAULT_BRANCH: "main",
    EVIDENCE_DATE: "20260320",
    EVIDENCE_RUN_ID: evidenceRunId,
    OUTPUT_ROOT_BASE: baseRoot,
    EXCEPTIONS_PATH: exceptionsPath,
    ...extraEnv,
  };

  if (useAlertsFixture) {
    env.DEPENDABOT_ALERTS_FIXTURE = alertsPath;
  } else {
    delete env.DEPENDABOT_ALERTS_FIXTURE;
  }

  if (useNvdFixture) {
    env.NVD_FIXTURE = path.join(__dirname, "fixtures", "nvd-cves.json");
  } else {
    delete env.NVD_FIXTURE;
  }

  if (branchProtectionFixture) {
    env.BRANCH_PROTECTION_FIXTURE = path.join(__dirname, "fixtures", branchProtectionFixture);
  } else {
    delete env.BRANCH_PROTECTION_FIXTURE;
  }

  delete env.BRANCH_PROTECTION_TOKEN;

  return {
    repoContext,
    outputRoot,
    cwd: path.resolve(__dirname, "..", ".."),
    env,
  };
}

function runBaseline(options) {
  const invocation = buildBaselineInvocation(options);
  const result = spawnSync(process.execPath, [".github/scripts/supply-chain/run-security-baseline.cjs"], {
    cwd: invocation.cwd,
    encoding: "utf8",
    env: invocation.env,
  });

  return {
    repoContext: invocation.repoContext,
    result,
    outputRoot: invocation.outputRoot,
  };
}

async function runBaselineAsync(options) {
  const invocation = buildBaselineInvocation(options);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [".github/scripts/supply-chain/run-security-baseline.cjs"], {
      cwd: invocation.cwd,
      env: invocation.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({
        repoContext: invocation.repoContext,
        outputRoot: invocation.outputRoot,
        result: {
          status,
          stdout,
          stderr,
        },
      });
    });
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function withHttpServer(handler, callback) {
  const server = http.createServer(handler);

  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  const { port } = server.address();

  try {
    return await callback({
      baseUrl: `http://127.0.0.1:${port}`,
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

test("resolveRepoContext accepts standalone repository names and package metadata", () => {
  assert.equal(
    resolveRepoContext({
      repoDirectory: "FIXYZ-BE",
    }).repoKey,
    "fixyz-be",
  );
  assert.equal(
    resolveRepoContext({
      repoDirectory: "any-folder",
      packageName: "BE",
    }).repoKey,
    "fixyz-be",
  );
  assert.equal(
    resolveRepoContext({
      repoDirectory: "FIXYZ-FE",
    }).repoKey,
    "fixyz-fe",
  );
});

test("run-security-baseline writes machine-readable evidence from fixtures", () => {
  const repoContext = getRepoContext();
  const { result, outputRoot } = runBaseline({
    alertsPayload: readJson(path.join(__dirname, "fixtures", "dependabot-alerts.json")),
    exceptionRecords: createApprovedExceptionRecords(repoContext),
    evidenceRunId: "fixture-run",
  });

  assert.equal(result.status, 1);

  const index = readJson(path.join(outputRoot, "index.json"));
  const summary = readJson(path.join(outputRoot, `scan-summary-${repoContext.repoKey}.json`));
  const branchProtection = readJson(
    path.join(outputRoot, `branch-protection-${repoContext.repoKey}.json`),
  );

  assert.equal(index.retentionDays, 90);
  assert.equal(index.snapshotId, "fixture-run");
  assert.equal(index.scope, "repository-local");
  assert.deepEqual(index.repositories, [repoContext.repoKey]);
  assert.equal(summary.summary.blockingFindings, 1);
  assert.equal(summary.summary.exceptionBackedFindings, 2);
  assert.equal(summary.summary.branchProtectionStatus, "bound");
  assert.equal(branchProtection.status, "bound");
  assert.equal(branchProtection.actionsPermissions.shaPinningRequired, true);
});

test("run-security-baseline exits cleanly when alerts are remediated", () => {
  const { repoContext, result, outputRoot } = runBaseline({
    alertsPayload: [],
    exceptionRecords: [],
    evidenceRunId: "green-run",
  });

  assert.equal(result.status, 0);

  const summary = readJson(path.join(outputRoot, `scan-summary-${repoContext.repoKey}.json`));
  const branchProtection = readJson(
    path.join(outputRoot, `branch-protection-${repoContext.repoKey}.json`),
  );

  assert.equal(summary.summary.totalFindings, 0);
  assert.equal(summary.summary.blockingFindings, 0);
  assert.equal(summary.summary.status, "pass");
  assert.equal(branchProtection.status, "bound");
});

test("run-security-baseline blocks invalid approved exception records", () => {
  const repoContext = getRepoContext();
  const { result, outputRoot } = runBaseline({
    alertsPayload: createHighRiskAlert(repoContext, "GHSA-invalid-exception"),
    exceptionRecords: [
      {
        id: "EXC-INVALID",
        recordType: "dependency-alert-exception",
        scope: "repository",
        match: {
          repo: repoContext.repoKey,
          ghsaId: "GHSA-invalid-exception",
        },
        decision: "allow-temporary",
        expiresAt: "2026-04-01T00:00:00Z",
        status: "approved",
      },
    ],
    evidenceRunId: "invalid-exception-run",
  });

  assert.equal(result.status, 1);

  const summary = readJson(path.join(outputRoot, `scan-summary-${repoContext.repoKey}.json`));
  const validationFinding = summary.findings.find((finding) => finding.type === "exception-validation");
  const alertFinding = summary.findings.find((finding) => finding.type === "dependabot-alert");

  assert.equal(summary.summary.exceptionValidationFindings, 1);
  assert.equal(validationFinding.recordId, "EXC-INVALID");
  assert.equal(alertFinding.blocker, true);
  assert.equal(alertFinding.exceptionId, null);
  assert.equal(alertFinding.manifestPath, repoContext.highRiskManifestPath);
});

test("run-security-baseline fails branch-protection audit in GitHub Actions when proof is missing", () => {
  const { repoContext, result, outputRoot } = runBaseline({
    alertsPayload: [],
    exceptionRecords: [],
    evidenceRunId: "missing-branch-proof",
    branchProtectionFixture: null,
    extraEnv: {
      GITHUB_ACTIONS: "true",
    },
  });

  assert.equal(result.status, 1);

  const summary = readJson(path.join(outputRoot, `scan-summary-${repoContext.repoKey}.json`));
  const branchProtection = readJson(
    path.join(outputRoot, `branch-protection-${repoContext.repoKey}.json`),
  );

  assert.equal(summary.summary.blockingFindings, 0);
  assert.equal(summary.summary.status, "blocked");
  assert.equal(branchProtection.status, "operator-action-required");
});

test("run-security-baseline logs an actionable branch-protection failure summary", () => {
  const { result } = runBaseline({
    alertsPayload: [],
    exceptionRecords: [],
    evidenceRunId: "missing-branch-proof-logs",
    branchProtectionFixture: null,
    extraEnv: {
      GITHUB_ACTIONS: "true",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[supply-chain-security\] repo=/);
  assert.match(result.stdout, /status=blocked/);
  assert.match(result.stdout, /::error title=Branch Protection Audit Failed::/);
  assert.match(result.stderr, /Branch protection audit/);
  assert.match(result.stderr, /BRANCH_PROTECTION_TOKEN is not configured/);
  assert.match(result.stderr, /tokenConfigured=false/);
  assert.match(result.stderr, /Failing workflow: branch protection audit is not bound/);
});

test("run-security-baseline keeps local manual runs audit-pending when branch proof is missing", () => {
  const { repoContext, result, outputRoot } = runBaseline({
    alertsPayload: [],
    exceptionRecords: [],
    evidenceRunId: "local-audit-pending",
    branchProtectionFixture: null,
  });

  assert.equal(result.status, 0);

  const summary = readJson(path.join(outputRoot, `scan-summary-${repoContext.repoKey}.json`));
  const branchProtection = readJson(
    path.join(outputRoot, `branch-protection-${repoContext.repoKey}.json`),
  );
  const index = readJson(path.join(outputRoot, "index.json"));

  assert.equal(summary.summary.blockingFindings, 0);
  assert.equal(summary.summary.status, "audit-pending");
  assert.equal(branchProtection.status, "operator-action-required");
  assert.equal(index.snapshotId, "local-audit-pending");
});

test("run-security-baseline keeps same-day reruns in separate snapshot directories", () => {
  const repoContext = getRepoContext();
  const baseRoot = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "fixyz-supply-chain-reruns-")),
    "docs",
    "ops",
    "security-scan",
    "20260320",
  );

  const firstRun = runBaseline({
    alertsPayload: createHighRiskAlert(repoContext, "GHSA-run-one"),
    exceptionRecords: [],
    evidenceRunId: "run-one",
    outputBaseRoot: baseRoot,
  });
  const secondRun = runBaseline({
    alertsPayload: [],
    exceptionRecords: [],
    evidenceRunId: "run-two",
    outputBaseRoot: baseRoot,
  });

  assert.equal(firstRun.result.status, 1);
  assert.equal(secondRun.result.status, 0);

  const firstSummary = readJson(
    path.join(firstRun.outputRoot, `scan-summary-${firstRun.repoContext.repoKey}.json`),
  );
  const secondSummary = readJson(
    path.join(secondRun.outputRoot, `scan-summary-${secondRun.repoContext.repoKey}.json`),
  );

  assert.equal(firstSummary.summary.blockingFindings, 1);
  assert.equal(secondSummary.summary.totalFindings, 0);
  assert.equal(fs.existsSync(path.join(baseRoot, "run-one", "index.json")), true);
  assert.equal(fs.existsSync(path.join(baseRoot, "run-two", "index.json")), true);
});

test("run-security-baseline surfaces upstream non-JSON failures clearly", async () => {
  await withHttpServer((request, response) => {
    if (request.url.includes("/dependabot/alerts")) {
      response.writeHead(503, { "Content-Type": "text/plain" });
      response.end("upstream alerts unavailable");
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("not found");
  }, async ({ baseUrl }) => {
    const { result, outputRoot } = await runBaselineAsync({
      alertsPayload: [],
      exceptionRecords: [],
      evidenceRunId: "non-json-error",
      useAlertsFixture: false,
      extraEnv: {
        ALERTS_TOKEN: "integration-test-token",
        GITHUB_API_URL: baseUrl,
        REQUEST_MAX_ATTEMPTS: "1",
        REQUEST_RETRY_BASE_MS: "1",
      },
    });

    const repoContext = getRepoContext();

    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[supply-chain-security\] repo=/);
    assert.match(result.stderr, /Blocking findings/);
    assert.match(result.stderr, /scan-error/);
    assert.equal(fs.existsSync(path.join(outputRoot, "index.json")), true);

    const summary = readJson(path.join(outputRoot, `scan-summary-${repoContext.repoKey}.json`));
    const rawAlerts = readJson(path.join(outputRoot, `dependabot-alerts-${repoContext.repoKey}.json`));

    assert.equal(summary.summary.scanErrorFindings, 1);
    assert.equal(summary.summary.status, "blocked");
    assert.match(summary.findings[0].reason, /Dependency security scan failed/);
    assert.match(summary.findings[0].reason, /503 Service Unavailable while requesting/);
    assert.match(summary.findings[0].reason, /upstream alerts unavailable/);
    assert.doesNotMatch(summary.findings[0].reason, /SyntaxError|Unexpected token/);
    assert.equal(rawAlerts.status, "capture-failed");
    assert.match(rawAlerts.reason, /503 Service Unavailable/);
  });
});

test("run-security-baseline retries transient NVD failures before succeeding", async () => {
  const repoContext = getRepoContext();
  let requestCount = 0;

  await withHttpServer((request, response) => {
    if (!request.url.startsWith("/nvd")) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "not found" }));
      return;
    }

    requestCount += 1;

    if (requestCount === 1) {
      response.writeHead(503, { "Content-Type": "text/plain" });
      response.end("temporary NVD outage");
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        vulnerabilities: [
          {
            cve: {
              metrics: {
                cvssMetricV31: [
                  {
                    cvssData: {
                      baseScore: 7.2,
                      vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:L",
                    },
                  },
                ],
              },
            },
          },
        ],
      }),
    );
  }, async ({ baseUrl }) => {
    const { result, outputRoot } = await runBaselineAsync({
      alertsPayload: createNvdFallbackAlert(repoContext),
      exceptionRecords: [],
      evidenceRunId: "nvd-retry",
      useNvdFixture: false,
      extraEnv: {
        NVD_API_URL: `${baseUrl}/nvd`,
        REQUEST_MAX_ATTEMPTS: "2",
        REQUEST_RETRY_BASE_MS: "1",
      },
    });

    assert.equal(result.status, 1);
    assert.equal(requestCount, 2);

    const summary = readJson(path.join(outputRoot, `scan-summary-${repoContext.repoKey}.json`));
    const alertFinding = summary.findings.find((finding) => finding.type === "dependabot-alert");

    assert.equal(alertFinding.cvssSource, "nvd-v31");
    assert.equal(alertFinding.cvss, 7.2);
    assert.equal(alertFinding.blocker, true);
  });
});

test("run-security-baseline follows Dependabot cursor pagination without using the page parameter", async () => {
  const repoContext = getRepoContext();
  const requests = [];

  await withHttpServer((request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    requests.push({
      pathname: requestUrl.pathname,
      searchParams: new URLSearchParams(requestUrl.searchParams.toString()),
    });

    if (requestUrl.searchParams.has("page")) {
      response.writeHead(400, { "Content-Type": "text/plain" });
      response.end("page query is not supported");
      return;
    }

    if (requestUrl.searchParams.get("after") === "cursor-1") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("[]");
      return;
    }

    response.writeHead(200, {
      "Content-Type": "application/json",
      Link: `<http://127.0.0.1:${response.socket.localPort}${requestUrl.pathname}?state=open&per_page=100&after=cursor-1>; rel="next"`,
    });
    response.end("[]");
  }, async ({ baseUrl }) => {
    const { result, outputRoot } = await runBaselineAsync({
      alertsPayload: [],
      exceptionRecords: [],
      evidenceRunId: "cursor-pagination",
      useAlertsFixture: false,
      extraEnv: {
        ALERTS_TOKEN: "integration-test-token",
        GITHUB_API_URL: baseUrl,
        REQUEST_MAX_ATTEMPTS: "1",
        REQUEST_RETRY_BASE_MS: "1",
      },
    });

    assert.equal(result.status, 0);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].searchParams.has("page"), false);
    assert.equal(requests[1].searchParams.has("page"), false);
    assert.equal(requests[1].searchParams.get("after"), "cursor-1");

    const summary = readJson(path.join(outputRoot, `scan-summary-${repoContext.repoKey}.json`));
    assert.equal(summary.summary.blockingFindings, 0);
    assert.equal(summary.summary.status, "pass");
  });
});

test("run-security-baseline retains evidence when the exception registry JSON is invalid", () => {
  const repoContext = getRepoContext();
  const { result, outputRoot } = runBaseline({
    alertsPayload: [],
    exceptionRecords: [],
    exceptionRegistryContent: "{ invalid-json",
    evidenceRunId: "invalid-exception-registry",
  });

  assert.equal(result.status, 1);

  const index = readJson(path.join(outputRoot, "index.json"));
  const summary = readJson(path.join(outputRoot, `scan-summary-${repoContext.repoKey}.json`));
  const branchProtection = readJson(
    path.join(outputRoot, `branch-protection-${repoContext.repoKey}.json`),
  );

  assert.equal(index.snapshotId, "invalid-exception-registry");
  assert.equal(summary.summary.configurationErrorFindings, 1);
  assert.equal(summary.summary.status, "blocked");
  assert.match(summary.findings[0].reason, /Exception registry could not be parsed/);
  assert.equal(branchProtection.status, "bound");
});
