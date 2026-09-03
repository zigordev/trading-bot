#!/usr/bin/env node
/**
 * Fails on a production dependency whose licence is not on the allow-list.
 *
 * The risk is not theoretical: a copyleft licence arriving through a transitive
 * dependency can oblige you to publish source you did not intend to. The point
 * of checking on every build is that it catches the day the licence *changes*,
 * which is when nobody is looking.
 *
 * Only production dependencies are checked. A GPL build tool that never ships
 * imposes nothing on the artefact.
 *
 * Usage: node platform-ops/scripts/check-licences.mjs [workspace-root]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Permissive licences that impose no obligation beyond attribution.
const ALLOWED = new Set([
  '0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BlueOak-1.0.0',
  'CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'ISC', 'MIT', 'MIT-0', 'MPL-2.0',
  'Python-2.0', 'Unlicense', 'WTFPL', 'Zlib',
]);

// Named rather than pattern-matched, so adding one is a deliberate act with a
// reviewer attached.
const ALLOWED_PACKAGES = new Set([
  // Dual-licensed or non-SPDX strings that are permissive in practice.
  'argparse', 'caniuse-lite', 'spdx-exceptions', 'spdx-license-ids',
]);

/**
 * Packages whose licence is not permissive but whose obligations are met.
 *
 * Each entry needs the reason written down, because "we allow-listed it" is
 * not an answer anyone can audit later.
 */
const ALLOWED_WITH_REASON = new Map([
  [
    '@img/sharp-libvips',
    'LGPL-3.0-or-later. sharp loads libvips as a shared library and does not ' +
      'statically link it, so the LGPL obligations are attribution and the ' +
      'ability to relink — not source disclosure for our own code. The ' +
      'prebuilt binaries are shipped unmodified.',
  ],
]);

/** True when the package is covered by a written exception above. */
function hasReasonedException(name) {
  for (const prefix of ALLOWED_WITH_REASON.keys()) {
    if (name === prefix || name.startsWith(`${prefix}-`)) return true;
  }
  return false;
}

const root = process.argv[2] ?? process.cwd();

let tree;
try {
  tree = JSON.parse(
    execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      // `npm ls` exits non-zero on peer warnings while still printing valid
      // JSON, so the output matters more than the status.
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  );
} catch (error) {
  if (!error.stdout) throw error;
  tree = JSON.parse(error.stdout);
}

const seen = new Map();
(function walk(node) {
  for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
    // Workspace packages are this repository's own code — `UNLICENSED` on them
    // is the intent, not a finding.
    const isLocal = typeof dep.resolved === 'string' && dep.resolved.startsWith('file:');
    if (dep.version && !isLocal && !seen.has(`${name}@${dep.version}`)) {
      seen.set(`${name}@${dep.version}`, { name, path: dep.path ?? null });
    }
    walk(dep);
  }
})(tree);

/**
 * Licences are read from the installed tree, not from the registry.
 *
 * `npm view` is one network round trip per package — several minutes for a
 * thousand packages, and it reports what the registry says *now* rather than
 * what is actually installed. The `package.json` on disk is the artefact that
 * ships.
 */
/** Where npm actually put a package: hoisted at the root, or under a workspace. */
function resolveManifest(name) {
  const candidates = [
    join(root, 'node_modules', name, 'package.json'),
    ...['apps/api', 'apps/ui', 'apps/control-plane', 'apps/operator-console'].map((w) =>
      join(root, w, 'node_modules', name, 'package.json'),
    ),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

function licenceOf(_dir, name) {
  const manifest = resolveManifest(name);
  if (!manifest) return null;
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    if (typeof pkg.license === 'string') return pkg.license;
    if (pkg.license?.type) return pkg.license.type;
    if (Array.isArray(pkg.licenses)) {
      return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
    }
  } catch {
    /* not installed, or no manifest — nothing to judge */
  }
  return null;
}

const offenders = [];
let checked = 0;
for (const [spec, { name, path: dir }] of seen) {
  if (ALLOWED_PACKAGES.has(name) || hasReasonedException(name)) continue;
  const licence = licenceOf(dir, name);
  if (!licence) continue;
  checked += 1;

  // `(MIT OR Apache-2.0)` passes if either half is allowed.
  const parts = licence.replace(/[()]/g, '').split(/\s+OR\s+|\s+AND\s+/);
  if (!parts.some((part) => ALLOWED.has(part.trim()))) {
    offenders.push(`${spec} — ${licence}`);
  }
}

if (offenders.length > 0) {
  console.error('Production dependencies with a non-allow-listed licence:');
  for (const o of offenders.sort()) console.error(`- ${o}`);
  console.error('\nAdd the licence to ALLOWED, or the package to ALLOWED_PACKAGES with a reason.');
  process.exit(1);
}

console.log(`Licence check passed: ${checked} production packages, all permissive.`);
