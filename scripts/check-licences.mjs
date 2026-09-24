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
 * Usage: node scripts/check-licences.mjs [workspace-root]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Permissive licences that impose no obligation beyond attribution.
export const ALLOWED = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
  'Zlib',
]);

// Named rather than pattern-matched, so adding one is a deliberate act with a
// reviewer attached.
export const ALLOWED_PACKAGES = new Set([
  // Dual-licensed or non-SPDX strings that are permissive in practice.
  'argparse',
  'caniuse-lite',
  'spdx-exceptions',
  'spdx-license-ids',
]);

/**
 * Packages whose licence is not permissive but whose obligations are met.
 *
 * Each entry needs the reason written down, because "we allow-listed it" is
 * not an answer anyone can audit later.
 */
export const ALLOWED_WITH_REASON = new Map([
  [
    '@img/sharp-libvips',
    'LGPL-3.0-or-later. sharp loads libvips as a shared library and does not ' +
      'statically link it, so the LGPL obligations are attribution and the ' +
      'ability to relink — not source disclosure for our own code. The ' +
      'prebuilt binaries are shipped unmodified.',
  ],
]);

const LOCAL_SPEC = /^(?:file:|link:|workspace:|portal:)/;

/** True when the package is covered by a written exception above. */
export function hasReasonedException(name) {
  for (const prefix of ALLOWED_WITH_REASON.keys()) {
    if (name === prefix || name.startsWith(`${prefix}-`)) return true;
  }
  return false;
}

export function readTree(root) {
  try {
    return JSON.parse(
      execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        // `npm ls` exits non-zero on peer warnings while still printing valid
        // JSON, so the output matters more than the status.
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    );
  } catch (error) {
    if (!error.stdout) throw error;
    return JSON.parse(error.stdout);
  }
}

export function installedPackages(tree) {
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
  return seen;
}

/**
 * Licences are read from the installed tree, not from the registry.
 *
 * `npm view` is one network round trip per package — several minutes for a
 * thousand packages, and it reports what the registry says *now* rather than
 * what is actually installed. The `package.json` on disk is the artefact that
 * ships.
 */
/** The workspace directories declared by this repository, `apps/*` expanded. */
export function workspaceDirs(root) {
  const manifestPath = join(root, 'package.json');
  if (!existsSync(manifestPath)) return [];
  const declared = JSON.parse(readFileSync(manifestPath, 'utf8')).workspaces ?? [];
  const patterns = Array.isArray(declared) ? declared : (declared.packages ?? []);
  const dirs = [];
  for (const pattern of patterns) {
    if (!pattern.endsWith('/*')) {
      dirs.push(pattern);
      continue;
    }
    const parent = pattern.slice(0, -2);
    if (!existsSync(join(root, parent))) continue;
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(`${parent}/${entry.name}`);
    }
  }
  return dirs;
}

function manifestsOf(root, dirs) {
  const out = [];
  for (const dir of ['', ...dirs]) {
    const path = join(root, dir, 'package.json');
    if (!existsSync(path)) continue;
    try {
      out.push(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      continue;
    }
  }
  return out;
}

export function declaredProduction(root, dirs) {
  const manifests = manifestsOf(root, dirs);
  const own = new Set(manifests.map((manifest) => manifest.name).filter(Boolean));
  const names = new Set();
  for (const manifest of manifests) {
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      if (own.has(name)) continue;
      if (typeof spec === 'string' && LOCAL_SPEC.test(spec)) continue;
      names.add(name);
    }
  }
  return names;
}

/** Where npm actually put a package: hoisted at the root, or under a workspace. */
export function resolveManifest(root, dirs, name) {
  const candidates = [
    join(root, 'node_modules', name, 'package.json'),
    ...dirs.map((w) => join(root, w, 'node_modules', name, 'package.json')),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

export function licenceOf(root, dirs, name) {
  const manifest = resolveManifest(root, dirs, name);
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

export function isPermissive(licence) {
  // `(MIT OR Apache-2.0)` passes if either half is allowed.
  const parts = licence.replace(/[()]/g, '').split(/\s+OR\s+|\s+AND\s+/);
  return parts.some((part) => ALLOWED.has(part.trim()));
}

export function audit({ declared, installed, licenceFor }) {
  const offenders = [];
  let checked = 0;
  let exempted = 0;
  let unreadable = 0;

  for (const [spec, { name }] of installed) {
    if (ALLOWED_PACKAGES.has(name) || hasReasonedException(name)) {
      exempted += 1;
      continue;
    }
    const licence = licenceFor(name);
    if (!licence) {
      unreadable += 1;
      continue;
    }
    checked += 1;
    if (!isPermissive(licence)) offenders.push(`${spec} — ${licence}`);
  }

  const present = new Set([...installed.values()].map((entry) => entry.name));
  const missing = [...declared].filter((name) => !present.has(name)).sort();

  return { offenders: offenders.sort(), checked, exempted, unreadable, missing };
}

export function report({ declared, installed, offenders, checked, exempted, unreadable, missing }) {
  const out = [];
  const err = [];

  if (declared > 0 && installed === 0) {
    err.push(
      `Licence check inspected nothing: ${declared} production dependencies are declared and none are installed.`,
      'Run `npm ci` before the licence gate — a gate that reads an empty tree passes everything.'
    );
    return { code: 1, out, err };
  }

  if (missing.length > 0) {
    err.push('Declared production dependencies missing from the installed tree:');
    for (const name of missing) err.push(`- ${name}`);
    err.push('\nThe tree is partial, so this check has not seen every licence that ships.');
    return { code: 1, out, err };
  }

  if (installed > 0 && checked === 0) {
    err.push(
      `Licence check inspected nothing: ${installed} packages are in the tree and not one had a readable licence.`,
      'That is a broken install, not a clean bill of health.'
    );
    return { code: 1, out, err };
  }

  if (offenders.length > 0) {
    err.push('Production dependencies with a non-allow-listed licence:');
    for (const offender of offenders) err.push(`- ${offender}`);
    err.push('\nAdd the licence to ALLOWED, or the package to ALLOWED_PACKAGES with a reason.');
    return { code: 1, out, err };
  }

  if (declared === 0) {
    out.push('Licence check passed: this repository declares no production dependencies.');
    return { code: 0, out, err };
  }

  const aside = [
    exempted > 0 ? `${exempted} allow-listed by name` : null,
    unreadable > 0 ? `${unreadable} with no manifest to read` : null,
  ].filter(Boolean);

  out.push(
    `Licence check passed: ${checked} of ${installed} production packages, all permissive` +
      `${aside.length > 0 ? ` (${aside.join(', ')})` : ''}.`
  );
  return { code: 0, out, err };
}

export function main(argv) {
  const root = argv[2] ?? process.cwd();
  const dirs = workspaceDirs(root);
  const installed = installedPackages(readTree(root));
  const declared = declaredProduction(root, dirs);
  const result = audit({
    declared,
    installed,
    licenceFor: (name) => licenceOf(root, dirs, name),
  });
  const { code, out, err } = report({
    ...result,
    declared: declared.size,
    installed: installed.size,
  });
  for (const line of out) console.log(line);
  for (const line of err) console.error(line);
  return code;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main(process.argv);
}
