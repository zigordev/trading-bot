#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const HIGH_OR_CRITICAL = new Set(['high', 'critical']);
const ALLOWED_GHSA = new Set([
  // Temporary allowlist for NestJS 10 chain until platform-express is upgraded.
  'GHSA-XF7R-HGR6-V32P',
  'GHSA-V52C-386H-88MC',
  'GHSA-5528-5VMV-3XC2',
]);
const ALLOWED_CHAIN_PACKAGES = new Set([
  '@nestjs/core',
  '@nestjs/platform-express',
  '@nestjs/swagger',
  'multer',
]);

function normalizeSeverity(value) {
  return String(value ?? '').toLowerCase();
}

function parseGhsa(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/GHSA-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/i);
  return match ? match[0].toUpperCase() : null;
}

function isAllowedViaEntry(via) {
  if (typeof via === 'string') {
    return ALLOWED_CHAIN_PACKAGES.has(via);
  }

  if (!via || typeof via !== 'object') {
    return false;
  }

  const ghsa = parseGhsa(via.url) ?? parseGhsa(via.title) ?? parseGhsa(via.name) ?? null;
  if (ghsa && ALLOWED_GHSA.has(ghsa)) {
    return true;
  }

  if (typeof via.name === 'string' && ALLOWED_CHAIN_PACKAGES.has(via.name)) {
    return true;
  }

  return false;
}

function extractGhsaIds(viaList) {
  const ids = new Set();
  for (const via of viaList) {
    if (!via || typeof via !== 'object') continue;
    const ghsa = parseGhsa(via.url) ?? parseGhsa(via.title) ?? parseGhsa(via.name) ?? null;
    if (ghsa) ids.add(ghsa);
  }
  return ids;
}

function isHighOrCriticalVia(via, vulnerabilities) {
  if (typeof via === 'string') {
    const severity = normalizeSeverity(vulnerabilities?.[via]?.severity);
    return HIGH_OR_CRITICAL.has(severity);
  }

  if (!via || typeof via !== 'object') {
    return false;
  }

  const severity = normalizeSeverity(via.severity);
  return HIGH_OR_CRITICAL.has(severity);
}

function evaluateModernAudit(report) {
  const vulnerabilities = report?.vulnerabilities ?? {};
  const blockers = [];
  const ignored = [];

  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    const severity = normalizeSeverity(vulnerability?.severity);
    if (!HIGH_OR_CRITICAL.has(severity)) continue;

    const viaList = Array.isArray(vulnerability?.via) ? vulnerability.via : [];
    const viaGhsaIds = extractGhsaIds(viaList);
    const hasAllowedGhsa = [...viaGhsaIds].some((id) => ALLOWED_GHSA.has(id));
    const highCriticalViaList = viaList.filter((via) => isHighOrCriticalVia(via, vulnerabilities));
    const allHighCriticalViaAllowed =
      highCriticalViaList.length > 0 && highCriticalViaList.every(isAllowedViaEntry);
    const allViaAllowed = viaList.length > 0 && viaList.every(isAllowedViaEntry);

    const isAllowlisted =
      ALLOWED_CHAIN_PACKAGES.has(name) &&
      (hasAllowedGhsa || allHighCriticalViaAllowed || allViaAllowed);

    const issue = {
      name,
      severity,
      ghsa: [...viaGhsaIds],
      fixAvailable: vulnerability?.fixAvailable ?? false,
    };

    if (isAllowlisted) {
      ignored.push(issue);
    } else {
      blockers.push(issue);
    }
  }

  return { blockers, ignored };
}

function evaluateLegacyAudit(report) {
  const advisories = report?.advisories ?? {};
  const blockers = [];
  const ignored = [];

  for (const advisory of Object.values(advisories)) {
    const severity = normalizeSeverity(advisory?.severity);
    if (!HIGH_OR_CRITICAL.has(severity)) continue;

    const ghsa = parseGhsa(advisory?.url) ?? parseGhsa(advisory?.title) ?? null;
    const moduleName = advisory?.module_name ?? 'unknown';
    const issue = { name: moduleName, severity, ghsa: ghsa ? [ghsa] : [] };

    if (ALLOWED_CHAIN_PACKAGES.has(moduleName) && ghsa && ALLOWED_GHSA.has(ghsa)) {
      ignored.push(issue);
    } else {
      blockers.push(issue);
    }
  }

  return { blockers, ignored };
}

function printIssues(header, issues) {
  console.error(header);
  for (const issue of issues) {
    const ghsaSuffix = issue.ghsa.length ? ` ghsa=${issue.ghsa.join(',')}` : '';
    const fixSuffix =
      issue.fixAvailable && issue.fixAvailable !== false ? ' fix=available' : ' fix=none';
    console.error(`- ${issue.name} severity=${issue.severity}${ghsaSuffix}${fixSuffix}`);
  }
}

function runNpmAudit() {
  const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (audit.error) {
    console.error(`npm audit execution failed: ${audit.error.message}`);
    process.exit(1);
  }

  const stdout = audit.stdout?.trim() ?? '';
  if (!stdout) {
    console.error('npm audit produced no JSON output.');
    if (audit.stderr?.trim()) console.error(audit.stderr.trim());
    process.exit(audit.status ?? 1);
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    console.error('Failed to parse npm audit JSON output.');
    console.error(stdout);
    if (audit.stderr?.trim()) console.error(audit.stderr.trim());
    process.exit(audit.status ?? 1);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// registry.npmjs.org's advisories-bulk endpoint (what `npm audit` calls
// under the hood) is occasionally unavailable for a few minutes at a time.
// A report.error here means that call failed, not that the dependency tree
// is clean or dirty — worth a couple of retries before failing the build.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 20_000;

let report;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  report = runNpmAudit();
  if (!report?.error) break;

  const errorMessage = report.error.message ?? report.message ?? 'unknown error';
  if (attempt === MAX_ATTEMPTS) {
    console.error(`npm audit returned an error: ${errorMessage}`);
    process.exit(1);
  }

  console.error(
    `npm audit registry call failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${errorMessage} — retrying in ${RETRY_DELAY_MS / 1000}s`
  );
  await sleep(RETRY_DELAY_MS);
}

const result = report.vulnerabilities ? evaluateModernAudit(report) : evaluateLegacyAudit(report);

if (result.blockers.length > 0) {
  printIssues('Blocking high/critical vulnerabilities found:', result.blockers);
  if (result.ignored.length > 0) {
    printIssues('Ignored allowlisted vulnerabilities:', result.ignored);
  }
  process.exit(1);
}

if (result.ignored.length > 0) {
  printIssues('Ignored allowlisted vulnerabilities:', result.ignored);
}

console.log('npm audit gate passed (prod dependencies, high/critical).');
