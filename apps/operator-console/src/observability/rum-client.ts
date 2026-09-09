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
 *
 * Everything sent is either a bounded enum or a number. That is what makes an
 * unauthenticated ingest endpoint acceptable: there is nothing worth stealing
 * in the payload and nothing unbounded in it.
 */

export type RumEventType = 'performance' | 'error' | 'interaction' | 'navigation' | 'frustration';

interface OutboundEvent {
  type: RumEventType;
  name: string;
  value?: number;
  page: string;
  navigationDepth?: number;
}

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
const SLOW_LOAD_MS = 3000;
const MAX_PATH_DEPTH = 20;

class RumClient {
  private readonly endpoint: string;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;

  private events: OutboundEvent[] = [];
  private navigationDepth = 0;
  private clickTimestamps: number[] = [];
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
    if (!('PerformanceObserver' in window)) return;

    this.observe('largest-contentful-paint', (entries) => {
      const last = entries.at(-1) as
        (PerformanceEntry & { renderTime?: number; loadTime?: number }) | undefined;
      if (!last) return;
      this.record({
        type: 'performance',
        name: 'LCP',
        value: last.renderTime || last.loadTime || last.startTime,
      });
    });

    // INP, which replaced First Input Delay as a Core Web Vital in March 2024.
    // FID timed only the delay before the *first* interaction's handler
    // started, ignoring how long it ran and every later interaction — a page
    // could score perfectly while every click after the first took a second.
    // `durationThreshold: 40` skips interactions too fast to be worth a beacon.
    try {
      let worst = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          interactionId?: number;
        })[]) {
          if (!entry.interactionId || entry.duration <= worst) continue;
          worst = entry.duration;
          this.record({ type: 'performance', name: 'INP', value: entry.duration });
        }
      }).observe({
        type: 'event',
        buffered: true,
        durationThreshold: 40,
      } as PerformanceObserverInit);
    } catch {
      // Safari has no `event` timing entries yet.
    }

    let cls = 0;
    this.observe('layout-shift', (entries) => {
      for (const entry of entries as (PerformanceEntry & {
        value?: number;
        hadRecentInput?: boolean;
      })[]) {
        if (!entry.hadRecentInput) cls += entry.value ?? 0;
      }
      this.record({ type: 'performance', name: 'CLS', value: cls });
    });

    this.observe('navigation', (entries) => {
      for (const entry of entries as PerformanceNavigationTiming[]) {
        this.record({
          type: 'performance',
          name: 'TTFB',
          value: entry.responseStart - entry.requestStart,
        });
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
    // The counter is the signal; the message and stack are not sent. Diagnosing
    // a specific error is the job of a error tracker, not of a Prometheus
    // counter, and stack traces can carry values from the code that threw.
    window.addEventListener('error', () => {
      this.record({ type: 'error', name: 'JavaScript Error' });
    });

    window.addEventListener('unhandledrejection', () => {
      this.record({ type: 'error', name: 'Unhandled Promise Rejection' });
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

      // A dead click is one after which nothing on the page changed. The
      // original compared a DOM snapshot; a MutationObserver says the same
      // thing without serialising the document on every click.
      let mutated = false;
      const observer = new MutationObserver(() => {
        mutated = true;
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      window.setTimeout(() => {
        observer.disconnect();
        if (!mutated) this.record({ type: 'frustration', name: 'Dead Click' });
      }, DEAD_CLICK_MS);
    });

    document.addEventListener('submit', () => {
      this.record({ type: 'interaction', name: 'Form Submit' });
    });
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
