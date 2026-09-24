import { SpanKind } from '@opentelemetry/api';
import { ATTR_HTTP_ROUTE, ATTR_URL_FULL } from '@opentelemetry/semantic-conventions';

import type { Context, HrTime } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';

const NEXT_SPAN_TYPE_ATTRIBUTE = 'next.span_type';
const NEXT_BUBBLE_ATTRIBUTE = 'next.bubble';
const HTTP_METHOD_ATTRIBUTE = 'http.method';
const HTTP_TARGET_ATTRIBUTE = 'http.target';
const REQUEST_SPAN_TYPE = 'BaseServer.handleRequest';
const FETCH_SPAN_NAME = /^fetch ([A-Za-z]+) (\S+)$/;

export const REDISPATCH_HOLD_MS = 2_000;
export const REDISPATCH_HOLD_LIMIT = 512;

export function normaliseFetchSpan(name: string): { name: string; url: string } | undefined {
  const match = FETCH_SPAN_NAME.exec(name);
  if (!match) return undefined;

  const [, method = '', target = ''] = match;
  if (!method || !target) return undefined;

  return { name: `fetch ${method.toUpperCase()} ${upstreamOf(target)}`, url: target };
}

export function isRequestSpan(span: ReadableSpan): boolean {
  if (span.kind !== SpanKind.SERVER) return false;
  return span.attributes[NEXT_SPAN_TYPE_ATTRIBUTE] === REQUEST_SPAN_TYPE;
}

export function isRedispatchPass(span: ReadableSpan): boolean {
  if (!isRequestSpan(span)) return false;
  if (span.attributes[NEXT_BUBBLE_ATTRIBUTE] !== true) return false;

  const route = span.attributes[ATTR_HTTP_ROUTE];
  return typeof route !== 'string' || route.length === 0;
}

export function requestSpanKey(span: ReadableSpan): string {
  const method = span.attributes[HTTP_METHOD_ATTRIBUTE];
  const target = span.attributes[HTTP_TARGET_ATTRIBUTE];
  const asText = (value: unknown) => (typeof value === 'string' ? value : '');

  return `${asText(method)} ${asText(target)}`;
}

export class FetchSpanNameProcessor implements SpanProcessor {
  onStart(span: Span, _parentContext: Context): void {
    const normalised = normaliseFetchSpan(span.name);
    if (!normalised) return;

    span.updateName(normalised.name);
    if (typeof span.attributes[ATTR_URL_FULL] !== 'string') {
      span.setAttribute(ATTR_URL_FULL, normalised.url);
    }
  }

  onEnd(_span: ReadableSpan): void {}

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

export class RedispatchedRequestSpanFilter implements SpanProcessor {
  private readonly held: { key: string; span: ReadableSpan; heldAt: number }[] = [];
  private sweepTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly delegate: SpanProcessor,
    private readonly holdMs: number = REDISPATCH_HOLD_MS,
    private readonly holdLimit: number = REDISPATCH_HOLD_LIMIT
  ) {}

  onStart(span: Span, parentContext: Context): void {
    this.delegate.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    this.sweep(Date.now());

    if (isRedispatchPass(span)) {
      this.hold(span);
      return;
    }

    if (isRequestSpan(span)) this.claim(span);
    this.delegate.onEnd(span);
  }

  shutdown(): Promise<void> {
    this.releaseAll();
    return this.delegate.shutdown();
  }

  forceFlush(): Promise<void> {
    this.releaseAll();
    return this.delegate.forceFlush();
  }

  private hold(span: ReadableSpan): void {
    this.held.push({ key: requestSpanKey(span), span, heldAt: Date.now() });
    while (this.held.length > this.holdLimit) this.releaseOldest();
    this.schedule();
  }

  private claim(span: ReadableSpan): void {
    const key = requestSpanKey(span);

    for (let index = this.held.length - 1; index >= 0; index -= 1) {
      const candidate = this.held[index];
      if (!candidate || candidate.key !== key) continue;
      if (!endedFirst(candidate.span.endTime, span.endTime)) continue;

      this.held.splice(index, 1);
      return;
    }
  }

  private sweep(now: number): void {
    while (this.held.length > 0) {
      const oldest = this.held[0];
      if (!oldest || now - oldest.heldAt < this.holdMs) return;
      this.releaseOldest();
    }
  }

  private releaseAll(): void {
    if (this.sweepTimer) clearTimeout(this.sweepTimer);
    this.sweepTimer = undefined;
    while (this.held.length > 0) this.releaseOldest();
  }

  private releaseOldest(): void {
    const oldest = this.held.shift();
    if (oldest) this.delegate.onEnd(oldest.span);
  }

  private schedule(): void {
    if (this.sweepTimer || this.held.length === 0) return;

    const timer = setTimeout(() => {
      this.sweepTimer = undefined;
      this.sweep(Date.now());
      this.schedule();
    }, this.holdMs);
    timer.unref?.();
    this.sweepTimer = timer;
  }
}

function endedFirst(pass: HrTime, request: HrTime): boolean {
  const [passSeconds = 0, passNanos = 0] = pass;
  const [requestSeconds = 0, requestNanos = 0] = request;

  if (passSeconds !== requestSeconds) return passSeconds < requestSeconds;
  return passNanos <= requestNanos;
}

function upstreamOf(target: string): string {
  try {
    return new URL(target).host;
  } catch {
    const [withoutQuery = target] = target.split('?');
    return withoutQuery;
  }
}
