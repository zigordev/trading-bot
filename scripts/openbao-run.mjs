#!/usr/bin/env node

import { spawn } from 'node:child_process';

function die(message) {
  console.error(message);
  process.exit(1);
}

function normalize(value) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

async function fetchOpenBaoSecrets() {
  const addr = normalize(process.env.OPENBAO_ADDR);
  const token = normalize(process.env.OPENBAO_TOKEN);
  const mount = normalize(process.env.OPENBAO_KV_MOUNT);
  const path = normalize(process.env.OPENBAO_SECRET_PATH);
  const retries = 45;
  const retryDelayMs = 2000;

  if (!addr) die('OPENBAO_ADDR is required');
  if (!token) die('OPENBAO_TOKEN is required');
  if (!mount) die('OPENBAO_KV_MOUNT is required');
  if (!path) die('OPENBAO_SECRET_PATH is required');

  const mountSegment = mount.replace(/^\/+|\/+$/g, '');
  const pathSegment = path.replace(/^\/+|\/+$/g, '');
  const secretUrl = `${addr.replace(/\/+$/g, '')}/v1/${mountSegment}/data/${pathSegment}`;

  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(secretUrl, {
        method: 'GET',
        headers: {
          'X-Vault-Token': token,
        },
      });

      if (!response.ok) {
        const body = await response.text();
        lastError = `OpenBao returned ${response.status} for ${secretUrl}: ${body}`;
      } else {
        const payload = await response.json();
        const data = payload?.data?.data;
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          die(`OpenBao payload did not include kv-v2 data at ${mountSegment}/${pathSegment}`);
        }
        return data;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  die(`Failed to fetch OpenBao secrets after ${retries} attempts: ${lastError}`);
}

function enforceRequiredKeys(secrets) {
  const requiredRaw = process.env.OPENBAO_REQUIRED_KEYS;
  if (requiredRaw === undefined) {
    die('OPENBAO_REQUIRED_KEYS is required');
  }

  const required = requiredRaw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const missing = required.filter((key) => {
    const value = secrets[key];
    return value === undefined || value === null || `${value}`.trim().length === 0;
  });

  if (missing.length > 0) {
    die(
      `OpenBao secret path is missing required keys: ${missing.join(
        ', '
      )} (path=${process.env.OPENBAO_SECRET_PATH})`
    );
  }
}

function runCommandWithSecrets(argv, secrets) {
  if (argv.length === 0) {
    die('No command provided to openbao-run');
  }

  const env = {
    ...process.env,
  };

  for (const [key, value] of Object.entries(secrets)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      env[key] = String(value);
    }
  }

  const child = spawn(argv[0], argv.slice(1), {
    stdio: 'inherit',
    env,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

async function main() {
  const separator = process.argv.indexOf('--');
  const commandArgs = separator >= 0 ? process.argv.slice(separator + 1) : process.argv.slice(2);
  const secrets = await fetchOpenBaoSecrets();
  enforceRequiredKeys(secrets);
  runCommandWithSecrets(commandArgs, secrets);
}

main().catch((error) => {
  die(error instanceof Error ? error.message : String(error));
});
