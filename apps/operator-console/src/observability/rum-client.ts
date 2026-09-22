/**
 * Real User Monitoring, in the browser.
 *
 * Tracks what gpool's original client tracked — Core Web Vitals, JavaScript
 * errors, clicks, navigation, and frustration signals (rage clicks, dead
 * clicks, excessive scrolling) — for every UI in the estate rather than one.
 *
 * **What it deliberately does not send.** The original sent
 * `location.href` including the query string, the full `userAgent`, the
 * `id`, `className` and visible `textContent` of whatever was clicked, the
 * user's id, and error stack traces. None of that survives here:
 *
 * - Query strings and fragments carry session tokens and personal data.
 *   Only the path is sent, and the server normalises it further.
 * - Button text is user-visible copy, which routinely contains names and
 *   email addresses.
 * - The user id made every event personally identifying for a signal that is
 *   aggregate by nature.
 * - Stack traces can contain values from the code that threw.
 */

import {
  onCLS,
  onFCP,
  onINP,
  onLCP,
  onTTFB,
  type CLSMetricWithAttribution,
  type FCPMetricWithAttribution,
  type INPMetricWithAttribution,
  type LCPMetricWithAttribution,
  type TTFBMetricWithAttribution,
} from 'web-vitals/attribution';

import { maskMessage } from './mask';

export type RumEventType = 'performance' | 'error' | 'interaction' | 'navigation' | 'frustration';

interface StackFrame {
  file: string;
  line: number;
  column: number;
}

interface ErrorDetail {
  type: string;
  message: string;
  frame?: StackFrame;
}

interface OutboundEvent {
  type: RumEventType;
  name: string;
  value?: number;
  page: string;
  navigationDepth?: number;
  traceId?: string;
  rating?: 'poor';
  target?: string;
  error?: ErrorDetail;
}

type VitalMetric =
  | CLSMetricWithAttribution
  | FCPMetricWithAttribution
  | INPMetricWithAttribution
  | LCPMetricWithAttribution
  | TTFBMetricWithAttribution;

export interface RumOptions {
  /** Where beacons are posted. Same-origin by default, which is what keeps the
   *  endpoint free of CORS and the payload free of credentials. */
  endpoint?: string;
  /** Flush after this many events. */
  batchSize?: number;
  /** Flush at least this often, in milliseconds. */
  flushIntervalMs?: number;
}

const RAGE_CLICK_THRESHOLD = 3;
const DEAD_CLICK_MS = 500;
const BUSY_WINDOW_MS = 1000;
const MUTATION_MEMORY_MS = 2000;
const MAX_TRACKED_MUTATIONS = 1000;
const SLOW_LOAD_MS = 3000;
const MAX_PATH_DEPTH = 20;
const MAX_ERROR_DETAILS = 10;
const TARGET_LIMIT = 120;
const TRACE_LINKED: ReadonlySet<string> = new Set(['FCP', 'LCP', 'TTFB']);
const TRACEPARENT = /^00-([0-9a-f]{32})-[0-9a-f]{16}-01$/;
const FRAME = /(https?:\/\/[^\s()]+?):(\d+):(\d+)/;

function pageTraceId(): string | undefined {
  const traceparent = document.querySelector('meta[name="traceparent"]')?.getAttribute('content');
  return traceparent ? TRACEPARENT.exec(traceparent)?.[1] : undefined;
}

function targetOf(metric: VitalMetric): string | undefined {
  switch (metric.name) {
    case 'LCP':
      return metric.attribution.target;
    case 'INP':
      return metric.attribution.interactionTarget;
    case 'CLS':
      return metric.attribution.largestShiftTarget;
    default:
      return undefined;
  }
}

function ownFrame(url: string | undefined, line: number, column: number): StackFrame | undefined {
  if (!url || !line || !column) return undefined;
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.origin !== window.location.origin) return undefined;
    if (!parsed.pathname.startsWith('/_next/static/')) return undefined;
    return { file: parsed.pathname, line, column };
  } catch {
    return undefined;
  }
}

function topFrame(stack: unknown): StackFrame | undefined {
  if (typeof stack !== 'string') return undefined;
  for (const line of stack.split('\n')) {
    const match = FRAME.exec(line);
    if (!match) continue;
    const frame = ownFrame(match[1], Number(match[2]), Number(match[3]));
    if (frame) return frame;
  }
  return undefined;
}

function describeError(
  error: unknown,
  fallback: { message?: string; frame?: StackFrame } = {}
): ErrorDetail {
  const type = error instanceof Error && error.name ? error.name : 'Error';
  const raw =
    error instanceof Error ? error.message : typeof error === 'string' ? error : fallback.message;
  const message = maskMessage(raw);
  const frame = (error instanceof Error ? topFrame(error.stack) : undefined) ?? fallback.frame;
  return frame ? { type, message, frame } : { type, message };
}

function leavesThePage(control: Element): boolean {
  if (!(control instanceof HTMLAnchorElement) || !control.hasAttribute('href')) return false;
  if (control.hasAttribute('download')) return true;
  if (control.target && control.target !== '_self') return true;
  return !/^https?:$/.test(control.protocol);
}

class RumClient {
  private readonly endpoint: string;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;

  private events: OutboundEvent[] = [];
  private navigationDepth = 0;
  private clickTimestamps: number[] = [];
  private recentMutations: { target: Node; at: number }[] = [];
  private lastScrollAt = -Infinity;
  private errorDetailsSent = 0;
  private flushTimer?: ReturnType<typeof setInterval>;
  private started = false;

  constructor(options: RumOptions = {}) {
    this.endpoint = options.endpoint ?? '/rum/events';
    this.batchSize = options.batchSize ?? 10;
    this.flushIntervalMs = options.flushIntervalMs ?? 30_000;
  }

  start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;

    this.trackWebVitals();
    this.trackErrors();
    this.trackNavigation();
    this.trackInteractions();
    this.trackScrolling();

    this.flushTimer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.flushTimer.unref?.();

    // `visibilitychange` rather than `unload`: mobile browsers routinely kill a
    // backgrounded tab without ever firing unload, and those sessions are the
    // slow ones you most want to see.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush(true);
    });
  }

  /** Only the path, never the query string or fragment. */
  private currentPage(): string {
    return window.location.pathname || '/';
  }

  private record(event: Omit<OutboundEvent, 'page'>): void {
    this.events.push({ ...event, page: this.currentPage() });
    if (this.events.length >= this.batchSize) void this.flush();
  }

  // --- Core Web Vitals ------------------------------------------------------

  private trackWebVitals(): void {
    const traceId = pageTraceId();
    const report = (metric: VitalMetric) => {
      const poor = metric.rating === 'poor';
      const target = poor ? targetOf(metric)?.slice(0, TARGET_LIMIT) : undefined;
      this.record({
        type: 'performance',
        name: metric.name,
        value: metric.value,
        ...(traceId && TRACE_LINKED.has(metric.name) ? { traceId } : {}),
        ...(poor ? { rating: 'poor' as const } : {}),
        ...(target ? { target } : {}),
      });
    };

    onCLS(report);
    onFCP(report);
    onINP(report);
    onLCP(report);
    onTTFB(report);

    if (!('PerformanceObserver' in window)) return;
    this.observe('navigation', (entries) => {
      for (const entry of entries as PerformanceNavigationTiming[]) {
        this.record({
          type: 'performance',
          name: 'DOMContentLoaded',
          value: entry.domContentLoadedEventEnd - entry.startTime,
        });
        this.record({
          type: 'performance',
          name: 'Load',
          value: entry.loadEventEnd - entry.startTime,
        });
      }
    });
  }

  private observe(type: string, handler: (entries: PerformanceEntryList) => void): void {
    try {
      new PerformanceObserver((list) => handler(list.getEntries())).observe({
        type,
        buffered: true,
      } as PerformanceObserverInit);
    } catch {
      // An entry type this browser does not implement is not an error.
    }
  }

  // --- Errors ---------------------------------------------------------------

  private trackErrors(): void {
    window.addEventListener('error', (event) => {
      this.recordError('JavaScript Error', event.error, {
        message: event.message,
        frame: ownFrame(event.filename, event.lineno, event.colno),
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      this.recordError('Unhandled Promise Rejection', event.reason);
    });

    window.addEventListener('load', () => {
      const nav = performance.getEntriesByType('navigation')[0] as
        PerformanceNavigationTiming | undefined;
      const loadTime = nav ? nav.loadEventEnd - nav.startTime : 0;
      if (loadTime > SLOW_LOAD_MS) {
        this.record({ type: 'frustration', name: 'Slow Page Load', value: loadTime });
      }
    });
  }

  private recordError(
    name: string,
    error: unknown,
    fallback?: { message?: string; frame?: StackFrame }
  ): void {
    if (this.errorDetailsSent >= MAX_ERROR_DETAILS) {
      this.record({ type: 'error', name });
      return;
    }
    this.errorDetailsSent += 1;
    this.record({ type: 'error', name, error: describeError(error, fallback) });
  }

  // --- Navigation -----------------------------------------------------------

  private trackNavigation(): void {
    this.navigationDepth = 1;
    this.record({ type: 'navigation', name: 'Page View', navigationDepth: 1 });

    // The App Router exposes no router events, so the path is polled. Patching
    // `history.pushState` would be more precise but breaks when two libraries
    // do it, and this is a once-a-second string comparison.
    let lastPath = this.currentPage();
    const timer = setInterval(() => {
      const path = this.currentPage();
      if (path === lastPath) return;
      lastPath = path;
      this.navigationDepth = Math.min(this.navigationDepth + 1, MAX_PATH_DEPTH);
      this.record({
        type: 'navigation',
        name: 'Route Change',
        navigationDepth: this.navigationDepth,
      });
    }, 1000);
    timer.unref?.();
  }

  // --- Interactions and frustration ----------------------------------------

  private trackInteractions(): void {
    new MutationObserver((records) => {
      const now = performance.now();
      for (const record of records) this.recentMutations.push({ target: record.target, at: now });
      const cutoff = now - MUTATION_MEMORY_MS;
      let stale = 0;
      while (stale < this.recentMutations.length && this.recentMutations[stale].at < cutoff) {
        stale += 1;
      }
      stale = Math.max(stale, this.recentMutations.length - MAX_TRACKED_MUTATIONS);
      if (stale > 0) this.recentMutations.splice(0, stale);
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    document.addEventListener(
      'scroll',
      (event) => {
        this.lastScrollAt = event.timeStamp;
      },
      { capture: true, passive: true }
    );

    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const control = target?.closest('button, a, [role="button"]');
      if (!control) return;

      const now = Date.now();
      const recent = this.clickTimestamps.filter((ts) => now - ts < 1000);
      this.clickTimestamps = [...recent, now].filter((ts) => now - ts < 5000);

      if (recent.length >= RAGE_CLICK_THRESHOLD) {
        this.record({ type: 'frustration', name: 'Rage Click' });
      }

      this.record({ type: 'interaction', name: 'Click' });

      if (leavesThePage(control)) return;

      // A dead click is one after which nothing on the page changed. The
      // original compared a DOM snapshot; a MutationObserver says the same
      // thing without serialising the document on every click.
      const clickedAt = event.timeStamp;
      window.setTimeout(() => {
        if (document.visibilityState === 'hidden' || this.lastScrollAt >= clickedAt) return;
        if (!this.pageChangedSince(clickedAt)) {
          this.record({ type: 'frustration', name: 'Dead Click' });
        }
      }, DEAD_CLICK_MS);
    });

    document.addEventListener('submit', () => {
      this.record({ type: 'interaction', name: 'Form Submit' });
    });
  }

  private pageChangedSince(since: number): boolean {
    const busy = new Map<Node, number>();
    for (const { target, at } of this.recentMutations) {
      if (at < since && since - at <= BUSY_WINDOW_MS) busy.set(target, (busy.get(target) ?? 0) + 1);
    }
    return this.recentMutations.some(
      ({ target, at }) => at >= since && (busy.get(target) ?? 0) < 2
    );
  }

  private trackScrolling(): void {
    let distance = 0;
    let lastY = window.scrollY;

    window.addEventListener(
      'scroll',
      () => {
        distance += Math.abs(window.scrollY - lastY);
        lastY = window.scrollY;
      },
      { passive: true }
    );

    const timer = setInterval(() => {
      // Ten viewport heights of scrolling inside 30s is someone hunting for
      // something they cannot find.
      if (distance > window.innerHeight * 10) {
        this.record({ type: 'frustration', name: 'Excessive Scrolling' });
      }
      distance = 0;
    }, 30_000);
    timer.unref?.();
  }

  // --- Transport ------------------------------------------------------------

  private async flush(onUnload = false): Promise<void> {
    if (this.events.length === 0) return;

    const batch = this.events;
    this.events = [];
    const payload = JSON.stringify({ events: batch });

    if (onUnload && typeof navigator.sendBeacon === 'function') {
      // Beacons are queued by the browser and survive the navigation; a normal
      // request at this point is cancelled.
      navigator.sendBeacon(this.endpoint, new Blob([payload], { type: 'application/json' }));
      return;
    }

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
        // Never attach cookies to a telemetry beacon.
        credentials: 'omit',
      });
    } catch {
      // Requeue, but bounded — a server that is down must not turn into an
      // ever-growing array in every open tab.
      if (!onUnload && this.events.length < this.batchSize * 5) {
        this.events.unshift(...batch);
      }
    }
  }

  /**
   * Records a product event — "Pool Created", "Invitation Accepted".
   *
   * The name only. The original took a `metadata` object and call sites put
   * real data in it: one passed the invitee's `email`, another a pool's name.
   * None of that could become a Prometheus label, so all it ever did was ship
   * personal data to a public endpoint. The name must also appear in the app's
   * server-side allow-list, or it is counted as `other`.
   */
  trackEvent(name: string): void {
    this.record({ type: 'interaction', name });
  }

  trackError(error: unknown): void {
    this.recordError('Custom Error', error);
  }
}

let instance: RumClient | null = null;

/** Starts RUM once per page. Safe to call from every render. */
export function initRum(options?: RumOptions): void {
  if (typeof window === 'undefined' || instance) return;
  instance = new RumClient(options);
  instance.start();
}

/** Records a product event by name. A no-op before `initRum` or on the server. */
export function trackEvent(name: string): void {
  instance?.trackEvent(name);
}

export function trackError(error: unknown): void {
  instance?.trackError(error);
}
