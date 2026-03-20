"use strict";

const fs = require("node:fs");
const path = require("node:path");

const HIGH_RISK_CVSS_THRESHOLD = 7.0;
const DEFAULT_POLICY_VERSION = "story-0.11-v1";
const DEFAULT_REQUIRED_CHECK = "supply-chain-security";
const ISO_8601_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const SUPPORTED_EXCEPTION_DECISIONS = {
  "dependency-alert-exception": new Set(["allow-temporary"]),
  "action-pinning-exception": new Set(["allow-temporary"]),
  "manual-triage-decision": new Set(["manual-triage-approved", "manual-triage-rejected"]),
};

function normalizeText(value, fallback = null) {
  if (value === null || value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeRepoKey(value) {
  return normalizeText(value, "repo")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function todayUtcYyyymmdd(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
  return directoryPath;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, payload) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function relativeToRepo(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath).replace(/\\/g, "/");
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasPopulatedObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseIsoDate(value) {
  const normalized = normalizeText(value);
  if (!normalized || !ISO_8601_TIMESTAMP_PATTERN.test(normalized)) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function getApprovedRecordValidationErrors(record) {
  if (!record || normalizeText(record.status) !== "approved") {
    return [];
  }

  const errors = [];
  const recordType = normalizeText(record.recordType);
  const decision = normalizeText(record.decision);
  const requiredFields = [
    "id",
    "recordType",
    "scope",
    "decision",
    "owner",
    "reason",
    "evidence",
    "requestedAt",
    "reviewedAt",
    "reviewer",
    "expiresAt",
  ];

  for (const fieldName of requiredFields) {
    if (!normalizeText(record[fieldName])) {
      errors.push(fieldName);
    }
  }

  if (!hasPopulatedObject(record.match)) {
    errors.push("match");
  }

  if (normalizeText(record.requestedAt) && parseIsoDate(record.requestedAt) === null) {
    errors.push("requestedAt(valid-iso-date)");
  }

  if (normalizeText(record.reviewedAt) && parseIsoDate(record.reviewedAt) === null) {
    errors.push("reviewedAt(valid-iso-date)");
  }

  if (normalizeText(record.expiresAt) && parseIsoDate(record.expiresAt) === null) {
    errors.push("expiresAt(valid-iso-date)");
  }

  const supportedDecisions = recordType ? SUPPORTED_EXCEPTION_DECISIONS[recordType] : null;
  if (!supportedDecisions) {
    errors.push("recordType(supported)");
  } else if (!supportedDecisions.has(decision)) {
    errors.push("decision(compatible-with-recordType)");
  }

  const match = hasPopulatedObject(record.match) ? record.match : {};
  if (recordType === "action-pinning-exception") {
    if (normalizeText(match.type) !== "uses") {
      errors.push("match.type(uses)");
    }

    if (!normalizeText(match.value)) {
      errors.push("match.value");
    }
  }

  if (recordType === "dependency-alert-exception" || recordType === "manual-triage-decision") {
    const hasAlertSelector = [
      normalizeText(match.ghsaId),
      normalizeText(match.cveId),
      normalizeText(match.package),
      normalizeText(match.manifestPath),
    ].some(Boolean);

    if (!hasAlertSelector) {
      errors.push("match(selector)");
    }
  }

  return Array.from(new Set(errors));
}

function isRecordActive(record, now = Date.now()) {
  if (!record || normalizeText(record.status) !== "approved") {
    return false;
  }

  if (getApprovedRecordValidationErrors(record).length > 0) {
    return false;
  }

  const expiry = parseIsoDate(record.expiresAt);
  return expiry !== null && expiry > now;
}

function isLocalActionReference(usesValue) {
  return usesValue.startsWith("./") || usesValue.startsWith(".\\");
}

function isFullLengthShaRef(usesValue) {
  if (isLocalActionReference(usesValue)) {
    return true;
  }

  const atIndex = usesValue.lastIndexOf("@");
  if (atIndex === -1) {
    return false;
  }

  return /^[a-f0-9]{40}$/i.test(usesValue.slice(atIndex + 1));
}

function collectWorkflowUses(workflowDirectory) {
  if (!fs.existsSync(workflowDirectory)) {
    return [];
  }

  const files = fs
    .readdirSync(workflowDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(yml|yaml)$/i.test(entry.name))
    .map((entry) => path.join(workflowDirectory, entry.name));

  const findings = [];

  for (const workflowPath of files) {
    const lines = fs.readFileSync(workflowPath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/);
      if (!match) {
        return;
      }

      findings.push({
        workflowFile: path.basename(workflowPath),
        workflowPath,
        lineNumber: index + 1,
        uses: match[1],
      });
    });
  }

  return findings;
}

function extractAlertIdentifiers(alert) {
  const advisory = alert.security_advisory || {};
  const identifiers = safeArray(advisory.identifiers);
  const ghsaId =
    normalizeText(advisory.ghsa_id) ||
    normalizeText(
      identifiers.find((identifier) => normalizeText(identifier.type) === "GHSA")?.value,
    );
  const cveIds = identifiers
    .filter((identifier) => normalizeText(identifier.type) === "CVE")
    .map((identifier) => normalizeText(identifier.value))
    .filter(Boolean);

  return {
    ghsaId,
    cveIds,
  };
}

function pickNvdMetric(metrics, source) {
  const candidates = safeArray(metrics);
  if (candidates.length === 0) {
    return null;
  }

  const metric = candidates[0];
  const cvssData = metric.cvssData || {};
  const score = Number(cvssData.baseScore);
  if (!Number.isFinite(score)) {
    return null;
  }

  return {
    score,
    source,
    vector: normalizeText(cvssData.vectorString),
  };
}

function extractNvdCvssScore(nvdPayload) {
  const vulnerability = safeArray(nvdPayload && nvdPayload.vulnerabilities)[0];
  const metrics = vulnerability && vulnerability.cve && vulnerability.cve.metrics;
  if (!metrics) {
    return null;
  }

  return (
    pickNvdMetric(metrics.cvssMetricV31, "nvd-v31") ||
    pickNvdMetric(metrics.cvssMetricV30, "nvd-v30") ||
    pickNvdMetric(metrics.cvssMetricV40, "nvd-v40") ||
    pickNvdMetric(metrics.cvssMetricV2, "nvd-v2")
  );
}

function matchActionException(record, finding) {
  if (normalizeText(record.recordType) !== "action-pinning-exception") {
    return false;
  }

  if (normalizeText(record.decision) !== "allow-temporary") {
    return false;
  }

  const match = record.match || {};
  if (normalizeText(match.type) !== "uses") {
    return false;
  }

  const targetUses = normalizeText(match.value);
  const targetRepo = normalizeText(match.repo);
  if (!targetUses) {
    return false;
  }

  if (targetRepo && normalizeRepoKey(targetRepo) !== normalizeRepoKey(finding.repo)) {
    return false;
  }

  return targetUses === finding.uses;
}

function matchAlertException(record, finding) {
  const recordType = normalizeText(record.recordType);
  const decision = normalizeText(record.decision);

  if (finding.triageRequired) {
    if (recordType !== "manual-triage-decision" || decision !== "manual-triage-approved") {
      return false;
    }
  } else if (recordType !== "dependency-alert-exception" || decision !== "allow-temporary") {
    return false;
  }

  const match = record.match || {};
  const targetRepo = normalizeText(match.repo);
  if (targetRepo && normalizeRepoKey(targetRepo) !== normalizeRepoKey(finding.repo)) {
    return false;
  }

  if (normalizeText(match.ghsaId) && normalizeText(match.ghsaId) !== finding.advisoryId) {
    return false;
  }

  if (normalizeText(match.cveId) && !finding.cveIds.includes(normalizeText(match.cveId))) {
    return false;
  }

  if (normalizeText(match.package) && normalizeText(match.package) !== finding.package) {
    return false;
  }

  if (
    normalizeText(match.manifestPath) &&
    normalizeText(match.manifestPath) !== finding.manifestPath
  ) {
    return false;
  }

  return true;
}

function findActiveException(finding, records, now = Date.now()) {
  return (
    safeArray(records).find((record) => {
      if (!isRecordActive(record, now)) {
        return false;
      }

      if (finding.type === "action-pinning") {
        return matchActionException(record, finding);
      }

      if (finding.type === "dependabot-alert") {
        return matchAlertException(record, finding);
      }

      return false;
    }) || null
  );
}

function collectExceptionValidationFindings({
  repo,
  exceptionRecords,
  exceptionsPath,
}) {
  return safeArray(exceptionRecords).flatMap((record, index) => {
    const validationErrors = getApprovedRecordValidationErrors(record);
    if (validationErrors.length === 0) {
      return [];
    }

    return [
      {
        type: "exception-validation",
        repo,
        package: null,
        manifestPath: normalizeText(exceptionsPath),
        currentVersion: null,
        fixedVersion:
          "Provide required approved exception metadata and a supported recordType/decision combination",
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
        reason: `Approved exception record ${normalizeText(record.id, `#${index + 1}`)} is invalid: ${validationErrors.join(", ")}`,
        recordId: normalizeText(record.id, `#${index + 1}`),
      },
    ];
  });
}

function evaluateActionPinningFindings({ repo, workflowEntries, exceptionRecords, now = Date.now() }) {
  return workflowEntries
    .filter((entry) => !isLocalActionReference(entry.uses) && !isFullLengthShaRef(entry.uses))
    .map((entry) => {
      const baseFinding = {
        type: "action-pinning",
        repo,
        package: null,
        manifestPath: entry.workflowFile,
        currentVersion: null,
        fixedVersion: "pin to full-length commit SHA",
        severity: "high",
        cvss: null,
        cvssSource: "policy",
        decision: "block",
        exceptionId: null,
        triageRequired: false,
        blocker: true,
        advisoryId: null,
        cveIds: [],
        workflowFile: entry.workflowFile,
        lineNumber: entry.lineNumber,
        uses: entry.uses,
        reason: "Unpinned GitHub Action reference",
      };
      const exceptionRecord = findActiveException(baseFinding, exceptionRecords, now);

      if (exceptionRecord) {
        return {
          ...baseFinding,
          decision: "allow-temporary",
          exceptionId: normalizeText(exceptionRecord.id),
          blocker: false,
          reason: "Temporary action pinning exception is active",
        };
      }

      return baseFinding;
    });
}

async function evaluateDependabotAlerts({
  repo,
  alerts,
  exceptionRecords,
  nvdLookup,
  now = Date.now(),
}) {
  const findings = [];

  for (const alert of safeArray(alerts)) {
    const advisory = alert.security_advisory || {};
    const vulnerability = alert.security_vulnerability || {};
    const dependency = alert.dependency || {};
    const dependencyPackage = dependency.package || vulnerability.package || {};
    const identifiers = extractAlertIdentifiers(alert);
    const advisoryScoreValue = advisory.cvss ? advisory.cvss.score : null;
    const advisoryScore = Number(advisoryScoreValue);
    let cvss =
      advisoryScoreValue === null || advisoryScoreValue === undefined || advisoryScoreValue === ""
        ? null
        : Number.isFinite(advisoryScore)
          ? advisoryScore
          : null;
    let cvssSource = cvss !== null ? "github-advisory-v3" : "none";

    if (cvss === null && typeof nvdLookup === "function") {
      for (const cveId of identifiers.cveIds) {
        const nvdMetric = await nvdLookup(cveId);
        if (nvdMetric && Number.isFinite(Number(nvdMetric.score))) {
          cvss = Number(nvdMetric.score);
          cvssSource = normalizeText(nvdMetric.source, "nvd");
          break;
        }
      }
    }

    const baseFinding = {
      type: "dependabot-alert",
      repo,
      package: normalizeText(dependencyPackage.name),
      manifestPath: normalizeText(dependency.manifest_path),
      currentVersion:
        normalizeText(dependencyPackage.version) ||
        normalizeText(dependency.requirements) ||
        null,
      fixedVersion: normalizeText(
        vulnerability.first_patched_version && vulnerability.first_patched_version.identifier,
      ),
      severity:
        normalizeText(advisory.severity) || normalizeText(vulnerability.severity) || "unknown",
      cvss,
      cvssSource,
      decision: "allow",
      exceptionId: null,
      triageRequired: false,
      blocker: false,
      advisoryId: identifiers.ghsaId,
      cveIds: identifiers.cveIds,
      workflowFile: null,
      lineNumber: null,
      uses: null,
      reason: "Alert is below blocking threshold",
    };

    if (cvss === null) {
      baseFinding.triageRequired = true;
      baseFinding.decision = "manual-triage-required";
      baseFinding.blocker = true;
      baseFinding.reason = "No GitHub Advisory or NVD CVSS score is available";
      const exceptionRecord = findActiveException(baseFinding, exceptionRecords, now);

      if (exceptionRecord && normalizeText(exceptionRecord.decision) === "manual-triage-approved") {
        baseFinding.decision = "manual-triage-approved";
        baseFinding.exceptionId = normalizeText(exceptionRecord.id);
        baseFinding.blocker = false;
        baseFinding.reason = "Manual triage approval is active";
      }

      findings.push(baseFinding);
      continue;
    }

    if (cvss >= HIGH_RISK_CVSS_THRESHOLD) {
      baseFinding.decision = "block";
      baseFinding.blocker = true;
      baseFinding.reason = `CVSS ${cvss.toFixed(1)} meets blocking threshold`;
      const exceptionRecord = findActiveException(baseFinding, exceptionRecords, now);

      if (exceptionRecord) {
        baseFinding.decision = "allow-temporary";
        baseFinding.exceptionId = normalizeText(exceptionRecord.id);
        baseFinding.blocker = false;
        baseFinding.reason = "Temporary dependency exception is active";
      }
    }

    findings.push(baseFinding);
  }

  return findings;
}

function summarizeFindings(findings) {
  const summary = {
    totalFindings: 0,
    blockingFindings: 0,
    manualTriageFindings: 0,
    exceptionBackedFindings: 0,
    exceptionValidationFindings: 0,
    configurationErrorFindings: 0,
    scanErrorFindings: 0,
    actionPinningFindings: 0,
    dependabotFindings: 0,
  };

  for (const finding of safeArray(findings)) {
    summary.totalFindings += 1;
    if (finding.blocker) {
      summary.blockingFindings += 1;
    }
    if (finding.triageRequired) {
      summary.manualTriageFindings += 1;
    }
    if (finding.exceptionId) {
      summary.exceptionBackedFindings += 1;
    }
    if (finding.type === "exception-validation") {
      summary.exceptionValidationFindings += 1;
    }
    if (finding.type === "configuration-error") {
      summary.configurationErrorFindings += 1;
    }
    if (finding.type === "scan-error") {
      summary.scanErrorFindings += 1;
    }
    if (finding.type === "action-pinning") {
      summary.actionPinningFindings += 1;
    }
    if (finding.type === "dependabot-alert") {
      summary.dependabotFindings += 1;
    }
  }

  return summary;
}

function buildEvidenceIndex({
  generatedAt,
  retentionDays,
  policyVersion,
  repositories,
  artifacts,
  ...rest
}) {
  return {
    generatedAt,
    retentionDays,
    policyVersion,
    repositories,
    artifacts,
    ...rest,
  };
}

module.exports = {
  DEFAULT_POLICY_VERSION,
  DEFAULT_REQUIRED_CHECK,
  HIGH_RISK_CVSS_THRESHOLD,
  buildEvidenceIndex,
  collectWorkflowUses,
  collectExceptionValidationFindings,
  ensureDirectory,
  evaluateActionPinningFindings,
  evaluateDependabotAlerts,
  extractAlertIdentifiers,
  extractNvdCvssScore,
  findActiveException,
  getApprovedRecordValidationErrors,
  isFullLengthShaRef,
  isRecordActive,
  normalizeRepoKey,
  normalizeText,
  readJsonFile,
  relativeToRepo,
  safeArray,
  summarizeFindings,
  todayUtcYyyymmdd,
  writeJsonFile,
};
