// DO NOT EDIT. Vendored from platform-ops/packages/observability.
// Change it there and run: bash platform-ops/scripts/sync-observability.sh

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
  /** Whether the value came from the environment or the default. */
  readonly source: 'default' | 'environment';
}

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
  return flag.enabled;
}

/** The whole set, for the `/flags` endpoint and for startup logging. */
export function allFlags(): ResolvedFlag[] {
  return [...resolved.values()];
}
