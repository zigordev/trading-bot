import { recordRumEvent, rumRejectedTotal, type RumEvent, type RumEventType } from './rum-metrics';

/**
 * Validation and rate limiting for the public RUM ingest endpoint.
 *
 * This endpoint cannot be authenticated — it is called by anonymous visitors
 * before they log in, and often during page unload. That makes it the most
 * exposed surface in the estate: an unauthenticated POST that writes to
 * Prometheus. Everything below exists because of that.
 */

/** A batch larger than this is truncated. The client flushes at 10. */
const MAX_EVENTS_PER_BATCH = 50;

/** Bodies larger than this are refused unread. 64 KB is far above a legitimate
 *  batch and far below anything that would tie up the process. */
export const MAX_BODY_BYTES = 64 * 1024;

const VALID_TYPES: ReadonlySet<string> = new Set([
  'performance',
  'error',
  'interaction',
  'navigation',
  'frustration',
]);

/**
 * A fixed-window rate limiter, per client, held in process memory.
 *
 * In memory rather than Redis because this must not add a dependency to four
 * web apps for a counter, and because each app runs a single Node process —
 * the limit is per instance, which is the right granularity when the instance
 * is what you are protecting. It is a floor, not a security boundary: a
 * distributed flood still needs the reverse proxy in front of it.
 */
class FixedWindowLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  /** True when the request is allowed. */
  take(key: string, now = Date.now()): boolean {
    // Sweep before inserting, so an attacker rotating keys cannot grow the map
    // without bound — that would turn a rate limiter into a memory leak.
    if (this.hits.size > 10_000) {
      for (const [existing, entry] of this.hits) {
        if (entry.resetAt <= now) this.hits.delete(existing);
      }
    }

    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count >= this.limit) return false;

    entry.count += 1;
    return true;
  }
}

/** 60 batches a minute per client. A page flushing every 30s uses two. */
const limiter = new FixedWindowLimiter(60, 60_000);

export type IngestOutcome =
  | { ok: true; accepted: number; rejected: number }
  | { ok: false; status: 400 | 413 | 429; reason: string };

/**
 * Identifies the caller for rate limiting.
 *
 * `x-forwarded-for` is trusted only as far as the first hop, because the whole
 * header is attacker-controlled when no proxy rewrites it — taking the last
 * entry, or the whole string, lets a caller mint a fresh identity per request
 * and bypass the limit entirely.
 */
export function clientKeyFrom(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return headers.get('x-real-ip')?.slice(0, 64) ?? 'unknown';
}

/**
 * Validates and records a batch.
 *
 * Rejections are counted rather than logged: a flood would otherwise turn into
 * a log flood, which is its own outage.
 */
export function ingestRumBatch(body: unknown, clientKey: string): IngestOutcome {
  if (!limiter.take(clientKey)) {
    rumRejectedTotal.inc({ reason: 'rate_limited' });
    return { ok: false, status: 429, reason: 'rate limited' };
  }

  if (typeof body !== 'object' || body === null) {
    rumRejectedTotal.inc({ reason: 'malformed' });
    return { ok: false, status: 400, reason: 'expected an object' };
  }

  const events = (body as { events?: unknown }).events;
  if (!Array.isArray(events)) {
    rumRejectedTotal.inc({ reason: 'malformed' });
    return { ok: false, status: 400, reason: 'expected an events array' };
  }

  let accepted = 0;
  let rejected = 0;

  for (const raw of events.slice(0, MAX_EVENTS_PER_BATCH)) {
    if (typeof raw !== 'object' || raw === null) {
      rejected += 1;
      rumRejectedTotal.inc({ reason: 'malformed' });
      continue;
    }

    const candidate = raw as Record<string, unknown>;
    const type = candidate.type;
    const name = candidate.name;

    if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
      rejected += 1;
      rumRejectedTotal.inc({ reason: 'unknown_type' });
      continue;
    }
    if (typeof name !== 'string' || name.length > 64) {
      rejected += 1;
      rumRejectedTotal.inc({ reason: 'bad_name' });
      continue;
    }

    const event: RumEvent = {
      type: type as RumEventType,
      name,
      value: typeof candidate.value === 'number' ? candidate.value : undefined,
      page: typeof candidate.page === 'string' ? candidate.page.slice(0, 512) : '/',
      navigationDepth:
        typeof candidate.navigationDepth === 'number' ? candidate.navigationDepth : undefined,
    };

    if (recordRumEvent(event)) {
      accepted += 1;
    } else {
      rejected += 1;
      rumRejectedTotal.inc({ reason: 'unrecordable' });
    }
  }

  if (events.length > MAX_EVENTS_PER_BATCH) {
    const dropped = events.length - MAX_EVENTS_PER_BATCH;
    rejected += dropped;
    rumRejectedTotal.inc({ reason: 'batch_too_large' }, dropped);
  }

  return { ok: true, accepted, rejected };
}
