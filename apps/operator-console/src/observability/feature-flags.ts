/**
 * Feature flags.
 *
 * The point of a flag is to separate *deploying* code from *enabling* it. That
 * matters most for the thing the estate has not done yet: a risky migration.
 * Shipping the new path behind a flag that defaults to off means the deploy and
 * the switch are two decisions, made at different times, and the second one is
 * reversible without a rebuild.
 *
 * Deliberately not a service. LaunchDarkly and friends solve per-user targeting
 * and gradual rollout, neither of which this estate needs; what it needs is a
 * declared list, a default, and the ability to see what is on in a running
 * process. Anything more is a dependency and a network call in the request
 * path.
 *
 * Flags are read once at startup. A flag that changes under a running process
 * gives you two behaviours in one request and a bug nobody can reproduce; the
 * way to change one is to restart with a different value, which is also the
 * thing you can roll back.
 */

export interface FlagDefinition {
  /** `FLAG_` + this, upper-cased, is the environment variable. */
  readonly key: string;
  readonly description: string;
  readonly defaultValue: boolean;
  /**
   * When this flag is expected to be removed. A flag with no end date becomes
   * permanent configuration, and a codebase of permanent flags is a codebase
   * with 2^n behaviours nobody has tested.
   */
  readonly removeBy?: string;
}

export interface ResolvedFlag extends FlagDefinition {
  readonly enabled: boolean;
  /** Where the value came from. */
  readonly source: 'default' | 'environment' | 'remote';
}

export type RemoteFlagEvent =
  | { readonly kind: 'unavailable'; readonly error: string }
  | { readonly kind: 'recovered' }
  | { readonly kind: 'changed' };

export interface RemoteFlagOptions {
  /** Base URL of the Unleash server, without a trailing path. */
  readonly url: string;
  /** A client token, scoped to one environment. */
  readonly token: string;
  /** Identifies this service in the Unleash UI. */
  readonly appName: string;
  /** How often to poll, in milliseconds. */
  readonly refreshInterval?: number;
  readonly onEvent?: (event: RemoteFlagEvent) => void;
  /**
   * Stops the SDK registering and reporting which flags it read.
   *
   * Left on by default. Registration is what tells the server which services
   * read which flags and when one was last evaluated, which is the only
   * evidence that a flag is dead and can be removed. Turning it off saves one
   * request a minute to a service on the same network and costs the answer to
   * "is anything still reading this?".
   */
  readonly disableMetrics?: boolean;
  /**
   * Where the SDK caches the last flag set it received.
   *
   * That cache is read at startup when the server cannot be reached, so a
   * process that has talked to the server before comes back with the values it
   * last saw rather than the declared defaults. Only a process with no cache
   * falls all the way back. Worth pointing at a known directory in tests, and
   * at a writable one in a container whose temp directory is not.
   */
  readonly backupPath?: string;
}

type RemoteClient = {
  isEnabled(key: string, context?: unknown, fallback?: boolean): boolean;
  on(event: string, listener: (payload?: unknown) => void): unknown;
  destroy(): void;
};

let remote: RemoteClient | undefined;

const resolved = new Map<string, ResolvedFlag>();

function envName(key: string): string {
  return `FLAG_${key.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}`;
}

/**
 * Declares this service's flags. Call once, at startup, before anything reads
 * one.
 *
 * Returns the resolved set so a service can log it — knowing which flags were
 * on is most of the value when reading an incident timeline.
 */
export function registerFlags(definitions: readonly FlagDefinition[]): ResolvedFlag[] {
  for (const definition of definitions) {
    const raw = process.env[envName(definition.key)]?.trim().toLowerCase();
    const fromEnv = raw === 'true' || raw === '1' || raw === 'false' || raw === '0';

    resolved.set(definition.key, {
      ...definition,
      enabled: fromEnv ? raw === 'true' || raw === '1' : definition.defaultValue,
      source: fromEnv ? 'environment' : 'default',
    });
  }
  return [...resolved.values()];
}

/**
 * Reads a flag.
 *
 * Throws on an unregistered key rather than returning false: a typo that
 * silently disables a feature is far harder to find than one that fails at
 * startup.
 */
export function isEnabled(key: string): boolean {
  const flag = resolved.get(key);
  if (!flag) {
    throw new Error(
      `Unknown feature flag "${key}". Every flag must be declared in registerFlags().`
    );
  }
  if (remote) {
    return remote.isEnabled(key, undefined, flag.enabled);
  }
  return flag.enabled;
}

/**
 * Points the reader at an Unleash server, so a flag can be changed without a
 * deploy.
 *
 * The declared set stays the source of truth for *which* flags exist and what
 * they mean; the server only supplies values.
 *
 * Losing the flag service never becomes an outage, but what it degrades to
 * depends on whether this process has talked to the server before. The SDK
 * caches each flag set it receives to `backupPath`, reads that cache at
 * startup, and only falls back to the value `registerFlags` resolved when
 * there is no cache and no server. That order is deliberate and worth keeping:
 * a flag turned *off* to stop something misbehaving should stay off across a
 * restart, rather than reverting to a default that turns it back on.
 *
 * Resolves once the first flag set has been fetched, so a caller can await it
 * at startup and avoid serving one request from defaults and the next from the
 * server. It resolves rather than rejects on failure, for the same reason.
 *
 * The SDK is imported through a non-literal specifier, which `tsc` leaves
 * alone: this file is vendored into every repository, and most of them declare
 * flags without talking to a flag server. Turbopack is not fooled — it folds
 * the constant and resolves `unleash-client` — so a Next.js app that reads a
 * flag must declare the dependency, and `typescript.ignoreBuildErrors` will not
 * help because the failure comes from the bundler, not the compiler. A Nest or
 * plain `tsc` build never resolves it.
 */
export async function connectRemoteFlags(options: RemoteFlagOptions): Promise<boolean> {
  const moduleName = 'unleash-client';
  const { initialize } = (await import(moduleName)) as {
    initialize: (config: Record<string, unknown>) => RemoteClient;
  };

  const client = initialize({
    url: `${options.url.replace(/\/+$/, '')}/api`,
    appName: options.appName,
    customHeaders: { Authorization: options.token },
    refreshInterval: options.refreshInterval ?? 15_000,
    disableMetrics: options.disableMetrics ?? false,
    ...(options.backupPath ? { backupPath: options.backupPath } : {}),
  });

  let healthy = true;
  const report = options.onEvent ?? (() => undefined);

  const ready = await new Promise<boolean>((resolve) => {
    const settle = (value: boolean) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => settle(false), 5_000);
    client.on('synchronized', () => settle(true));
    client.on('error', () => settle(false));
  });

  client.on('error', (payload?: unknown) => {
    if (healthy) {
      report({
        kind: 'unavailable',
        error: payload instanceof Error ? payload.message : String(payload ?? 'unknown error'),
      });
    }
    healthy = false;
  });

  client.on('synchronized', () => {
    if (!healthy) report({ kind: 'recovered' });
    healthy = true;
  });

  client.on('changed', () => report({ kind: 'changed' }));

  remote = client;
  return ready;
}

/** Drops the remote source, so reads fall back to the declared values. */
export function disconnectRemoteFlags(): void {
  remote?.destroy();
  remote = undefined;
}

/** The whole set, for the `/flags` endpoint and for startup logging. */
export function allFlags(): ResolvedFlag[] {
  return [...resolved.values()].map((flag) =>
    remote
      ? { ...flag, enabled: remote.isEnabled(flag.key, undefined, flag.enabled), source: 'remote' }
      : flag
  );
}
