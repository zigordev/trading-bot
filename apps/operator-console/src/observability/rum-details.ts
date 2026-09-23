import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { SourceMapConsumer, type RawSourceMap } from 'source-map-js';

import { writeLogRecord } from './json-logger';
import { maskMessage } from './mask';

export interface StackFrame {
  file: string;
  line: number;
  column: number;
}

export interface ClientErrorDetail {
  type: string;
  message: string;
  frame?: StackFrame;
}

const STATIC_PREFIX = /^\/(?:_next\/static|assets)\//;
const STATIC_FILE = /^\/(?:_next\/static|assets)\/(?:[\w\-.~%@[\]]+\/)*[\w\-.~%@[\]]+\.js$/;
const ERROR_TYPE = /^[A-Z][A-Za-z]{0,48}$/;
const SELECTOR = /^[\w\-.#>:()[\]="' ,*+~^$|]+$/;
const SELECTOR_LIMIT = 120;
const FILE_LIMIT = 300;
const MAX_POSITION = 10_000_000;
const DEDUP_WINDOW_MS = 10 * 60_000;
const MAX_FINGERPRINTS = 500;
const MAX_CACHED_MAPS = 20;

export class RecentKeys {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly windowMs: number,
    private readonly limit: number
  ) {}

  firstSince(key: string, now = Date.now()): boolean {
    const last = this.seen.get(key);
    if (last !== undefined && now - last < this.windowMs) return false;

    this.seen.delete(key);
    this.seen.set(key, now);
    while (this.seen.size > this.limit) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
    return true;
  }

  clear(): void {
    this.seen.clear();
  }
}

const isPosition = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_POSITION;

function sanitizeFrame(raw: unknown): StackFrame | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;

  const { file, line, column } = raw as Record<string, unknown>;
  if (typeof file !== 'string' || file.length > FILE_LIMIT || !STATIC_FILE.test(file)) {
    return undefined;
  }
  if (file.split('/').includes('..')) return undefined;
  if (!isPosition(line) || !isPosition(column)) return undefined;

  return { file, line, column };
}

export function sanitizeErrorDetail(raw: unknown): ClientErrorDetail | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;

  const candidate = raw as Record<string, unknown>;
  const type =
    typeof candidate.type === 'string' && ERROR_TYPE.test(candidate.type)
      ? candidate.type
      : 'Error';
  const message = maskMessage(candidate.message) || 'no message';
  const frame = sanitizeFrame(candidate.frame);

  return frame ? { type, message, frame } : { type, message };
}

export function sanitizeTarget(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;

  const target = raw.trim().slice(0, SELECTOR_LIMIT);
  return target && SELECTOR.test(target) ? target : undefined;
}

let sourceMapRoot = path.resolve(process.cwd(), '.next', 'static');
const consumers = new Map<string, SourceMapConsumer | null>();

export function setSourceMapRoot(root: string): void {
  sourceMapRoot = path.resolve(root);
  consumers.clear();
}

async function consumerFor(file: string): Promise<SourceMapConsumer | null> {
  let relative: string;
  try {
    relative = decodeURIComponent(file.replace(STATIC_PREFIX, ''));
  } catch {
    return null;
  }

  const mapPath = path.resolve(sourceMapRoot, `${relative}.map`);
  if (!mapPath.startsWith(`${sourceMapRoot}${path.sep}`)) return null;
  if (consumers.has(mapPath)) return consumers.get(mapPath) ?? null;

  let consumer: SourceMapConsumer | null;
  try {
    const raw = JSON.parse(await readFile(mapPath, 'utf8')) as RawSourceMap;
    consumer = new SourceMapConsumer(raw);
  } catch {
    consumer = null;
  }

  consumers.set(mapPath, consumer);
  while (consumers.size > MAX_CACHED_MAPS) {
    const oldest = consumers.keys().next().value;
    if (oldest === undefined) break;
    consumers.delete(oldest);
  }
  return consumer;
}

function cleanSource(source: string): string {
  return source
    .replace(/^[a-z]+:\/\/\/?/i, '')
    .replace(/^\[project\]\//, '')
    .replace(/^_N_E\//, '')
    .replace(/^(?:\.\.?\/)+/, '')
    .replace(/^apps\/web\//, '');
}

export async function resolveFrame(frame: StackFrame): Promise<string> {
  const fallback = `${frame.file}:${frame.line}:${frame.column}`;
  const consumer = await consumerFor(frame.file);
  if (!consumer) return fallback;

  const original = consumer.originalPositionFor({ line: frame.line, column: frame.column - 1 });
  if (!original.source || original.line == null) return fallback;

  return `${cleanSource(original.source)}:${original.line}:${(original.column ?? 0) + 1}`;
}

const errorKeys = new RecentKeys(DEDUP_WINDOW_MS, MAX_FINGERPRINTS);
const vitalKeys = new RecentKeys(DEDUP_WINDOW_MS, MAX_FINGERPRINTS);

export async function logClientError(
  detail: ClientErrorDetail,
  page: string,
  now = Date.now()
): Promise<void> {
  const where = detail.frame
    ? `${detail.frame.file}:${detail.frame.line}:${detail.frame.column}`
    : '';
  if (!errorKeys.firstSince(`${detail.type}|${detail.message}|${where}|${page}`, now)) return;

  const source = detail.frame ? await resolveFrame(detail.frame) : undefined;
  writeLogRecord('warn', {
    event: 'rum.client_error',
    page,
    error: { name: detail.type, message: detail.message },
    ...(source ? { source } : {}),
  });
}

export function logPoorVital(
  metric: string,
  value: number,
  target: string | undefined,
  page: string,
  now = Date.now()
): void {
  if (!vitalKeys.firstSince(`${metric}|${target ?? ''}|${page}`, now)) return;

  writeLogRecord('info', {
    event: 'rum.vital_poor',
    page,
    metric,
    value: metric === 'CLS' ? Number(value.toFixed(3)) : Math.round(value),
    ...(target ? { target } : {}),
  });
}

export function resetRumDetails(): void {
  errorKeys.clear();
  vitalKeys.clear();
  consumers.clear();
}
