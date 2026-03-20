"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectExceptionValidationFindings,
  evaluateActionPinningFindings,
  evaluateDependabotAlerts,
  extractNvdCvssScore,
  isFullLengthShaRef,
  isRecordActive,
} = require("../../.github/scripts/supply-chain/security-utils.cjs");

test("isFullLengthShaRef accepts full commit SHAs and rejects tag refs", () => {
  assert.equal(
    isFullLengthShaRef("actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5"),
    true,
  );
  assert.equal(isFullLengthShaRef("actions/checkout@v4"), false);
  assert.equal(isFullLengthShaRef("./.github/actions/local"), true);
});

test("isRecordActive rejects approved exception records missing required review metadata", () => {
  assert.equal(
    isRecordActive({
      id: "EXC-INVALID",
      recordType: "dependency-alert-exception",
      scope: "repository",
      match: {
        repo: "fixyz",
        ghsaId: "GHSA-high-risk",
      },
      decision: "allow-temporary",
      expiresAt: "2026-04-01T00:00:00Z",
      status: "approved",
    }, Date.parse("2026-03-20T00:00:00Z")),
    false,
  );
});

test("isRecordActive rejects approved exception records that do not use strict ISO timestamps", () => {
  assert.equal(
    isRecordActive({
      id: "EXC-NON-ISO",
      recordType: "dependency-alert-exception",
      scope: "repository",
      match: {
        repo: "fixyz",
        ghsaId: "GHSA-high-risk",
      },
      decision: "allow-temporary",
      owner: "platform-security",
      reason: "Timestamp format should be rejected",
      evidence: "Review note",
      requestedAt: "2026-03-20 00:00:00",
      reviewedAt: "2026-03-20T00:05:00Z",
      reviewer: "platform-security",
      expiresAt: "2026-04-01",
      status: "approved",
    }, Date.parse("2026-03-20T00:00:00Z")),
    false,
  );
});

test("collectExceptionValidationFindings blocks approved records with missing metadata", () => {
  const findings = collectExceptionValidationFindings({
    repo: "fixyz",
    exceptionsPath: ".github/security/dependency-exceptions.json",
    exceptionRecords: [
      {
        id: "EXC-INVALID",
        recordType: "dependency-alert-exception",
        scope: "repository",
        match: {
          repo: "fixyz",
          ghsaId: "GHSA-high-risk",
        },
        decision: "allow-temporary",
        expiresAt: "2026-04-01T00:00:00Z",
        status: "approved",
      },
    ],
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "exception-validation");
  assert.match(findings[0].reason, /owner/);
  assert.match(findings[0].reason, /reviewedAt/);
});

test("collectExceptionValidationFindings rejects blanket dependency exceptions without selectors", () => {
  const findings = collectExceptionValidationFindings({
    repo: "fixyz",
    exceptionsPath: ".github/security/dependency-exceptions.json",
    exceptionRecords: [
      {
        id: "EXC-BLANKET",
        recordType: "dependency-alert-exception",
        scope: "repository",
        match: {
          repo: "fixyz",
        },
        decision: "allow-temporary",
        owner: "platform-security",
        reason: "Too broad",
        evidence: "Review note",
        requestedAt: "2026-03-20T00:00:00Z",
        reviewedAt: "2026-03-20T00:05:00Z",
        reviewer: "platform-security",
        expiresAt: "2026-04-01T00:00:00Z",
        status: "approved",
      },
    ],
  });

  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /match\(selector\)/);
});

test("evaluateActionPinningFindings blocks unpinned actions and honors active exceptions", () => {
  const findings = evaluateActionPinningFindings({
    repo: "fixyz",
    workflowEntries: [
      {
        workflowFile: "ci.yml",
        workflowPath: "ci.yml",
        lineNumber: 10,
        uses: "actions/checkout@v4",
      },
      {
        workflowFile: "docs.yml",
        workflowPath: "docs.yml",
        lineNumber: 12,
        uses: "peaceiris/actions-gh-pages@v4",
      },
    ],
    exceptionRecords: [
      {
        id: "ACT-0001",
        recordType: "action-pinning-exception",
        scope: "repository",
        status: "approved",
        owner: "platform-security",
        reason: "Pending upstream immutable release reference",
        evidence: "Risk review approved",
        requestedAt: "2026-03-20T00:00:00Z",
        reviewedAt: "2026-03-20T00:05:00Z",
        reviewer: "platform-security",
        decision: "allow-temporary",
        expiresAt: "2026-04-01T00:00:00Z",
        match: {
          type: "uses",
          repo: "fixyz",
          value: "peaceiris/actions-gh-pages@v4",
        },
      },
    ],
    now: Date.parse("2026-03-20T00:00:00Z"),
  });

  assert.equal(findings.length, 2);
  assert.equal(findings[0].blocker, true);
  assert.equal(findings[1].blocker, false);
  assert.equal(findings[1].exceptionId, "ACT-0001");
});

test("evaluateActionPinningFindings re-blocks once a pinning exception expires", () => {
  const findings = evaluateActionPinningFindings({
    repo: "fixyz",
    workflowEntries: [
      {
        workflowFile: "ci.yml",
        workflowPath: "ci.yml",
        lineNumber: 10,
        uses: "actions/checkout@v4",
      },
    ],
    exceptionRecords: [
      {
        id: "ACT-0001",
        recordType: "action-pinning-exception",
        scope: "repository",
        status: "approved",
        owner: "platform-security",
        reason: "Pending upstream immutable release reference",
        evidence: "Risk review approved",
        requestedAt: "2026-03-20T00:00:00Z",
        reviewedAt: "2026-03-20T00:05:00Z",
        reviewer: "platform-security",
        decision: "allow-temporary",
        expiresAt: "2026-03-19T23:59:59Z",
        match: {
          type: "uses",
          repo: "fixyz",
          value: "actions/checkout@v4",
        },
      },
    ],
    now: Date.parse("2026-03-20T00:00:00Z"),
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].decision, "block");
  assert.equal(findings[0].blocker, true);
  assert.equal(findings[0].exceptionId, null);
});

test("extractNvdCvssScore prefers CVSS v3.1 metrics when present", () => {
  const score = extractNvdCvssScore({
    vulnerabilities: [
      {
        cve: {
          metrics: {
            cvssMetricV31: [
              {
                cvssData: {
                  baseScore: 7.4,
                  vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:L",
                },
              },
            ],
          },
        },
      },
    ],
  });

  assert.deepEqual(score, {
    score: 7.4,
    source: "nvd-v31",
    vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:L",
  });
});

test("evaluateDependabotAlerts uses GitHub CVSS first, NVD second, and manual triage when no score exists", async () => {
  const findings = await evaluateDependabotAlerts({
    repo: "fixyz",
    alerts: [
      {
        dependency: {
          manifest_path: "package-lock.json",
          package: {
            name: "axios",
            ecosystem: "npm",
          },
        },
        security_advisory: {
          ghsa_id: "GHSA-primary",
          severity: "high",
          cvss: {
            score: 9.1,
          },
          identifiers: [
            {
              type: "GHSA",
              value: "GHSA-primary",
            },
            {
              type: "CVE",
              value: "CVE-2026-1000",
            },
          ],
        },
        security_vulnerability: {
          package: {
            name: "axios",
            ecosystem: "npm",
          },
          first_patched_version: {
            identifier: "1.2.3",
          },
        },
      },
      {
        dependency: {
          manifest_path: "package-lock.json",
          package: {
            name: "left-pad",
            ecosystem: "npm",
          },
        },
        security_advisory: {
          ghsa_id: "GHSA-fallback",
          severity: "high",
          cvss: null,
          identifiers: [
            {
              type: "GHSA",
              value: "GHSA-fallback",
            },
            {
              type: "CVE",
              value: "CVE-2026-1001",
            },
          ],
        },
        security_vulnerability: {
          package: {
            name: "left-pad",
            ecosystem: "npm",
          },
          first_patched_version: {
            identifier: "1.0.1",
          },
        },
      },
      {
        dependency: {
          manifest_path: "package-lock.json",
          package: {
            name: "mystery",
            ecosystem: "npm",
          },
        },
        security_advisory: {
          ghsa_id: "GHSA-no-score",
          severity: "moderate",
          cvss: null,
          identifiers: [
            {
              type: "GHSA",
              value: "GHSA-no-score",
            },
          ],
        },
        security_vulnerability: {
          package: {
            name: "mystery",
            ecosystem: "npm",
          },
          first_patched_version: null,
        },
      },
    ],
    exceptionRecords: [
      {
        id: "TRIAGE-0002",
        recordType: "manual-triage-decision",
        scope: "repository",
        status: "approved",
        owner: "platform-security",
        reason: "Vendor advisory confirmed non-exploitable in current deployment",
        evidence: "Risk review approved",
        requestedAt: "2026-03-20T00:00:00Z",
        reviewedAt: "2026-03-20T00:05:00Z",
        reviewer: "platform-security",
        expiresAt: "2026-04-01T00:00:00Z",
        decision: "manual-triage-approved",
        match: {
          repo: "fixyz",
          ghsaId: "GHSA-no-score",
        },
      },
    ],
    nvdLookup: async (cveId) => {
      if (cveId === "CVE-2026-1001") {
        return {
          score: 7.2,
          source: "nvd-v31",
        };
      }
      return null;
    },
    now: Date.parse("2026-03-20T00:00:00Z"),
  });

  assert.equal(findings[0].cvssSource, "github-advisory-v3");
  assert.equal(findings[0].blocker, true);
  assert.equal(findings[1].cvssSource, "nvd-v31");
  assert.equal(findings[1].blocker, true);
  assert.equal(findings[2].decision, "manual-triage-approved");
  assert.equal(findings[2].blocker, false);
});

test("evaluateDependabotAlerts blocks no-score findings until manual triage is approved", async () => {
  const findings = await evaluateDependabotAlerts({
    repo: "fixyz",
    alerts: [
      {
        dependency: {
          manifest_path: "package-lock.json",
          package: {
            name: "mystery",
            ecosystem: "npm",
          },
        },
        security_advisory: {
          ghsa_id: "GHSA-no-score",
          severity: "moderate",
          cvss: null,
          identifiers: [
            {
              type: "GHSA",
              value: "GHSA-no-score",
            },
          ],
        },
        security_vulnerability: {
          package: {
            name: "mystery",
            ecosystem: "npm",
          },
          first_patched_version: null,
        },
      },
    ],
    exceptionRecords: [],
    nvdLookup: async () => null,
    now: Date.parse("2026-03-20T00:00:00Z"),
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].cvss, null);
  assert.equal(findings[0].cvssSource, "none");
  assert.equal(findings[0].decision, "manual-triage-required");
  assert.equal(findings[0].triageRequired, true);
  assert.equal(findings[0].blocker, true);
});

test("evaluateDependabotAlerts does not let manual-triage records suppress scored alerts", async () => {
  const findings = await evaluateDependabotAlerts({
    repo: "fixyz",
    alerts: [
      {
        dependency: {
          manifest_path: "package-lock.json",
          package: {
            name: "axios",
            ecosystem: "npm",
          },
        },
        security_advisory: {
          ghsa_id: "GHSA-primary",
          severity: "high",
          cvss: {
            score: 9.1,
          },
          identifiers: [
            {
              type: "GHSA",
              value: "GHSA-primary",
            },
          ],
        },
        security_vulnerability: {
          package: {
            name: "axios",
            ecosystem: "npm",
          },
          first_patched_version: {
            identifier: "1.2.3",
          },
        },
      },
    ],
    exceptionRecords: [
      {
        id: "TRIAGE-BOGUS",
        recordType: "manual-triage-decision",
        scope: "repository",
        status: "approved",
        owner: "platform-security",
        reason: "Incorrect record type for scored advisory suppression",
        evidence: "Review note",
        requestedAt: "2026-03-20T00:00:00Z",
        reviewedAt: "2026-03-20T00:05:00Z",
        reviewer: "platform-security",
        expiresAt: "2026-04-01T00:00:00Z",
        decision: "manual-triage-approved",
        match: {
          repo: "fixyz",
          ghsaId: "GHSA-primary",
        },
      },
    ],
    nvdLookup: async () => null,
    now: Date.parse("2026-03-20T00:00:00Z"),
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].decision, "block");
  assert.equal(findings[0].blocker, true);
  assert.equal(findings[0].exceptionId, null);
});
