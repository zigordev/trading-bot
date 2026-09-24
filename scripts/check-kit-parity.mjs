#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCHEMA = 1;
export const KIT_REPO = 'zigordev/platform-ops';
export const KIT_REF = 'main';
export const KIT_PATH = 'packages/observability';
export const MANIFEST_PATH = `${KIT_PATH}/kit.manifest.json`;
export const PROFILES_PATH = `${KIT_PATH}/kit.profiles.json`;
export const CONFIG_NAME = 'observability.kit.json';

const KIT_EXTENSIONS = ['.ts', '.tsx'];
const RULES = ['alias', 'js-import-extension', 'exempt'];
const RELATIVE_JS_IMPORT = /(\bfrom\s+['"])(\.\.?\/[^'"]+)\.js(['"])/g;
const RELATIVE_IMPORT = /\bfrom\s+['"]\.\/([^'"]+)['"]/g;

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function stripJsImportExtensions(text) {
  return text.replace(RELATIVE_JS_IMPORT, '$1$2$3');
}

export function relativeImports(text) {
  return [...text.matchAll(RELATIVE_IMPORT)].map((match) => match[1].replace(/\.js$/, ''));
}

export function profileFiles(profile) {
  return [...(profile.kit ?? []), ...(profile.local ?? [])];
}

export function profileClosure(kitDir, profiles) {
  const gaps = [];
  for (const [name, profile] of Object.entries(profiles)) {
    const carried = new Set(profileFiles(profile));
    for (const file of profile.kit ?? []) {
      const full = join(kitDir, file);
      if (!existsSync(full)) {
        gaps.push(`${name} requires ${file}, which the kit does not have`);
        continue;
      }
      for (const target of relativeImports(readFileSync(full, 'utf8'))) {
        const resolved = KIT_EXTENSIONS.map((ext) => `${target}${ext}`).find((candidate) =>
          existsSync(join(kitDir, candidate))
        );
        if (!resolved) continue;
        if (!carried.has(resolved)) {
          gaps.push(`${name} carries ${file}, which imports ${resolved}, which it does not carry`);
        }
      }
    }
  }
  return gaps.sort();
}

export function kitFileNames(kitDir) {
  return readdirSync(kitDir)
    .filter((name) => KIT_EXTENSIONS.some((ext) => name.endsWith(ext)))
    .filter((name) => statSync(join(kitDir, name)).isFile())
    .sort();
}

export function buildManifest(kitDir, profiles) {
  const files = {};
  for (const name of kitFileNames(kitDir)) {
    files[name] = sha256(readFileSync(join(kitDir, name)));
  }
  const sortedProfiles = {};
  for (const key of Object.keys(profiles).sort()) {
    const profile = profiles[key];
    sortedProfiles[key] = { kit: [...(profile.kit ?? [])].sort() };
    if (profile.local?.length) sortedProfiles[key].local = [...profile.local].sort();
  }
  const manifest = { schema: SCHEMA, files, profiles: sortedProfiles };
  return { ...manifest, digest: manifestDigest(manifest) };
}

export function manifestDigest({ files, profiles }) {
  const lines = [];
  for (const name of Object.keys(files).sort()) {
    lines.push(`f\t${name}\t${files[name]}`);
  }
  for (const key of Object.keys(profiles).sort()) {
    for (const name of [...(profiles[key].kit ?? [])].sort()) {
      lines.push(`p\t${key}\t${name}`);
    }
    for (const name of [...(profiles[key].local ?? [])].sort()) {
      lines.push(`l\t${key}\t${name}`);
    }
  }
  return sha256(`${lines.join('\n')}\n`);
}

export function serialiseManifest(manifest) {
  const { schema, digest, files, profiles } = manifest;
  return `${JSON.stringify({ schema, digest, files, profiles }, null, 2)}\n`;
}

export function validateConfig(config) {
  const problems = [];
  if (config.schema !== SCHEMA) {
    problems.push(`schema is ${JSON.stringify(config.schema)}, expected ${SCHEMA}`);
  }
  if (!config.pinned || typeof config.pinned.digest !== 'string') {
    problems.push('pinned.digest is missing');
  }
  if (!config.pinned || !config.pinned.files || !config.pinned.profiles) {
    problems.push('pinned.files and pinned.profiles are both required');
  } else if (typeof config.pinned.digest === 'string') {
    const recomputed = manifestDigest(config.pinned);
    if (recomputed !== config.pinned.digest) {
      problems.push(
        `pinned.digest ${config.pinned.digest.slice(0, 12)} does not describe pinned.files and pinned.profiles, which hash to ${recomputed.slice(0, 12)} — run --repin instead of editing the pin`
      );
    }
  }
  if (!Array.isArray(config.copies) || config.copies.length === 0) {
    problems.push('copies must list at least one vendored directory');
  }
  for (const copy of config.copies ?? []) {
    if (!copy.path) problems.push('a copy has no path');
    if (!copy.profile) problems.push(`copy ${copy.path} has no profile`);
    else if (config.pinned?.profiles && !config.pinned.profiles[copy.profile]) {
      problems.push(`copy ${copy.path} names unknown profile ${copy.profile}`);
    }
  }
  for (const deviation of config.deviations ?? []) {
    if (!RULES.includes(deviation.rule)) {
      problems.push(`deviation ${deviation.id ?? '(unnamed)'} uses unknown rule ${deviation.rule}`);
    }
    if (!deviation.reason) {
      problems.push(`deviation ${deviation.id ?? '(unnamed)'} has no reason`);
    }
    if (deviation.rule === 'alias' && !deviation.kitFile) {
      problems.push(`alias deviation ${deviation.id ?? '(unnamed)'} has no kitFile`);
    }
  }
  return problems;
}

function deviationsFor(config, copyPath) {
  const index = new Map();
  for (const deviation of config.deviations ?? []) {
    if (deviation.copy !== copyPath) continue;
    for (const file of deviation.files ?? [deviation.file]) {
      if (!file) continue;
      const list = index.get(file) ?? [];
      list.push(deviation);
      index.set(file, list);
    }
  }
  return index;
}

function kitNameFor(file, deviations) {
  const alias = (deviations ?? []).find((d) => d.rule === 'alias');
  return alias ? alias.kitFile : file;
}

function normalise(text, deviations) {
  let out = text;
  for (const deviation of deviations ?? []) {
    if (deviation.rule === 'js-import-extension') out = stripJsImportExtensions(out);
  }
  return out;
}

function expired(deviation, now) {
  if (!deviation.expires) return false;
  const when = Date.parse(`${deviation.expires}T00:00:00Z`);
  return Number.isFinite(when) && when < now;
}

export function checkCopies(root, config, now = Date.now()) {
  const findings = [];
  const pinned = config.pinned;
  const used = new Set();

  for (const copy of config.copies) {
    const dir = resolve(root, copy.path);
    if (!existsSync(dir)) {
      findings.push({ level: 'error', kind: 'missing-copy', copy: copy.path });
      continue;
    }
    const profile = pinned.profiles[copy.profile];
    const local = new Set(profile.local ?? []);
    const index = deviationsFor(config, copy.path);
    const present = new Set(
      readdirSync(dir).filter((name) => KIT_EXTENSIONS.some((ext) => name.endsWith(ext)))
    );

    for (const required of profileFiles(profile)) {
      const found = [...present].some(
        (name) => name === required || kitNameFor(name, index.get(name)) === required
      );
      if (!found) {
        findings.push({ level: 'error', kind: 'missing', copy: copy.path, file: required });
      }
    }

    for (const name of [...present].sort()) {
      if (local.has(name)) continue;
      const deviations = index.get(name);
      const kitName = kitNameFor(name, deviations);
      const expectedHash = pinned.files[kitName];
      if (!expectedHash) continue;

      for (const deviation of deviations ?? []) used.add(deviation);

      const exemption = (deviations ?? []).find((d) => d.rule === 'exempt');
      if (exemption) {
        if (expired(exemption, now)) {
          findings.push({
            level: 'error',
            kind: 'expired-exemption',
            copy: copy.path,
            file: name,
            id: exemption.id,
            expires: exemption.expires,
          });
        } else {
          findings.push({
            level: 'notice',
            kind: 'exempt',
            copy: copy.path,
            file: name,
            id: exemption.id,
          });
        }
        continue;
      }

      const text = readFileSync(join(dir, name), 'utf8');
      const raw = sha256(Buffer.from(text));
      const actual = sha256(Buffer.from(normalise(text, deviations)));

      if (actual !== expectedHash) {
        findings.push({
          level: 'error',
          kind: 'drift',
          copy: copy.path,
          file: name,
          kitFile: kitName,
          expected: expectedHash,
          actual,
        });
      } else if (raw === expectedHash) {
        for (const deviation of deviations ?? []) {
          if (deviation.rule !== 'js-import-extension') continue;
          findings.push({
            level: 'error',
            kind: 'stale-deviation',
            copy: copy.path,
            file: name,
            id: deviation.id,
          });
        }
      }
    }
  }

  for (const deviation of config.deviations ?? []) {
    if (!used.has(deviation)) {
      findings.push({ level: 'error', kind: 'unused-deviation', id: deviation.id });
    }
  }

  return findings;
}

export async function fetchLiveManifest(config, { timeoutMs = 8000, fetchImpl = fetch } = {}) {
  const repo = config.kit?.repo ?? KIT_REPO;
  const ref = config.kit?.ref ?? KIT_REF;
  const path = config.kit?.manifest ?? MANIFEST_PATH;
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return { url, error: `HTTP ${response.status}` };
    return { url, manifest: await response.json() };
  } catch (error) {
    return { url, error: error?.message ?? String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export function compareToLive(config, live) {
  if (live.error)
    return { kind: 'unreachable', level: 'notice', detail: live.error, url: live.url };
  const digest = live.manifest?.digest;
  if (typeof digest !== 'string') {
    return { kind: 'unreachable', level: 'notice', detail: 'no digest in manifest', url: live.url };
  }
  if (digest === config.pinned.digest) return { kind: 'current', level: 'ok', url: live.url };

  const behind = [];
  const added = [];
  const pinnedFiles = config.pinned.files;
  const liveFiles = live.manifest.files ?? {};
  for (const name of Object.keys(liveFiles).sort()) {
    if (!(name in pinnedFiles)) added.push(name);
    else if (liveFiles[name] !== pinnedFiles[name]) behind.push(name);
  }
  return { kind: 'behind', level: 'notice', behind, added, digest, url: live.url };
}

function paint(level, text) {
  const colour = { error: 31, notice: 33, ok: 32 }[level] ?? 90;
  return process.stdout.isTTY ? `\u001b[${colour}m${text}\u001b[0m` : text;
}

function annotate(level, message) {
  if (!process.env.GITHUB_ACTIONS) return;
  process.stdout.write(`::${level === 'error' ? 'error' : 'notice'}::${message}\n`);
}

export function describeFinding(finding) {
  switch (finding.kind) {
    case 'missing-copy':
      return `${finding.copy}: directory does not exist`;
    case 'missing':
      return `${finding.copy}: ${finding.file} is required by the profile and is not vendored`;
    case 'drift':
      return `${finding.copy}/${finding.file}: differs from the kit's ${finding.kitFile}`;
    case 'expired-exemption':
      return `${finding.copy}/${finding.file}: exemption ${finding.id} expired on ${finding.expires}`;
    case 'exempt':
      return `${finding.copy}/${finding.file}: exempt (${finding.id})`;
    case 'stale-deviation':
      return `${finding.copy}/${finding.file}: deviation ${finding.id} no longer applies — remove it`;
    case 'unused-deviation':
      return `deviation ${finding.id} matches no vendored file — remove it`;
    default:
      return JSON.stringify(finding);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function runSelf(root) {
  const kitDir = join(root, KIT_PATH);
  const profiles = readJson(join(root, PROFILES_PATH));
  const manifestFile = join(root, MANIFEST_PATH);
  const rebuilt = buildManifest(kitDir, profiles);

  if (!existsSync(manifestFile)) {
    return { ok: false, reason: `${MANIFEST_PATH} does not exist — run npm run kit:manifest` };
  }
  const committed = readFileSync(manifestFile, 'utf8');
  if (committed !== serialiseManifest(rebuilt)) {
    const previous = JSON.parse(committed);
    const changed = Object.keys(rebuilt.files).filter(
      (name) => previous.files?.[name] !== rebuilt.files[name]
    );
    const removed = Object.keys(previous.files ?? {}).filter((name) => !(name in rebuilt.files));
    return {
      ok: false,
      reason: `${MANIFEST_PATH} is stale — run npm run kit:manifest`,
      changed,
      removed,
      digest: rebuilt.digest,
    };
  }

  const gaps = profileClosure(kitDir, profiles);
  if (gaps.length > 0) {
    return { ok: false, reason: `${PROFILES_PATH} is not self-contained`, gaps };
  }

  const unprofiled = kitFileNames(kitDir).filter(
    (name) =>
      !name.endsWith('.test.ts') &&
      !name.startsWith('index.') &&
      !Object.values(profiles).some((profile) => profileFiles(profile).includes(name))
  );
  return { ok: true, digest: rebuilt.digest, count: Object.keys(rebuilt.files).length, unprofiled };
}

export async function main(argv, { root = process.cwd(), fetchImpl = fetch } = {}) {
  const self = argv.includes('--self');
  const offline = argv.includes('--offline');
  const strictRemote = argv.includes('--strict-remote');

  if (self) {
    const result = runSelf(root);
    if (!result.ok) {
      process.stdout.write(`${paint('error', '✗')} ${result.reason}\n`);
      for (const name of result.changed ?? []) process.stdout.write(`    changed: ${name}\n`);
      for (const name of result.removed ?? []) process.stdout.write(`    removed: ${name}\n`);
      for (const gap of result.gaps ?? []) process.stdout.write(`    ${gap}\n`);
      annotate('error', result.reason);
      return 1;
    }
    process.stdout.write(
      `${paint('ok', '✓')} kit manifest current — ${result.count} files, digest ${result.digest.slice(0, 12)}\n`
    );
    for (const name of result.unprofiled) {
      process.stdout.write(`${paint('notice', '–')} ${name} belongs to no profile\n`);
    }
    return 0;
  }

  const configPath = join(root, CONFIG_NAME);
  if (!existsSync(configPath)) {
    process.stdout.write(`${paint('error', '✗')} ${CONFIG_NAME} not found in ${root}\n`);
    return 1;
  }
  const config = readJson(configPath);

  if (argv.includes('--repin')) {
    const live = await fetchLiveManifest(config, { fetchImpl });
    if (live.error) {
      process.stdout.write(`${paint('error', '✗')} ${live.url}: ${live.error}\n`);
      return 1;
    }
    const { digest, files, profiles } = live.manifest;
    const next = { ...config, pinned: { digest, files, profiles } };
    writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
    process.stdout.write(`${paint('ok', '✓')} repinned to ${digest.slice(0, 12)}\n`);
    return 0;
  }

  const problems = validateConfig(config);
  if (problems.length > 0) {
    process.stdout.write(`${paint('error', '✗')} ${CONFIG_NAME} is not usable\n`);
    for (const problem of problems) process.stdout.write(`    ${problem}\n`);
    return 1;
  }

  const findings = checkCopies(root, config);
  let failed = 0;
  for (const finding of findings) {
    const mark = finding.level === 'error' ? '✗' : '–';
    process.stdout.write(`${paint(finding.level, mark)} ${describeFinding(finding)}\n`);
    if (finding.level === 'error') {
      failed += 1;
      annotate('error', describeFinding(finding));
    }
  }
  if (failed === 0) {
    const copies = config.copies.map((copy) => copy.path).join(', ');
    process.stdout.write(`${paint('ok', '✓')} vendored kit matches the pin — ${copies}\n`);
  }

  if (!offline) {
    const live = await fetchLiveManifest(config, { fetchImpl });
    const verdict = compareToLive(config, live);
    if (verdict.kind === 'current') {
      process.stdout.write(`${paint('ok', '✓')} pinned at the kit's current digest\n`);
    } else if (verdict.kind === 'unreachable') {
      process.stdout.write(
        `${paint('notice', '–')} could not read the live kit manifest (${verdict.detail})\n`
      );
    } else {
      const summary = `behind the kit: ${verdict.behind.length} changed, ${verdict.added.length} added — re-vendor and repin to ${verdict.digest.slice(0, 12)}`;
      process.stdout.write(`${paint('notice', '–')} ${summary}\n`);
      for (const name of [...verdict.behind, ...verdict.added]) {
        process.stdout.write(`    ${name}\n`);
      }
      annotate('notice', summary);
      if (strictRemote) failed += 1;
    }
  }

  return failed > 0 ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
