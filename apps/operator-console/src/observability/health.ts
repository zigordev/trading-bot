import { recordHealth } from './health-metrics';

export type ComponentStatus = 'down' | 'unknown' | 'up';
export type ComponentName = 'tolgee';

type Components = Partial<Record<ComponentName, { readonly status: ComponentStatus }>>;

export interface HealthBody {
  readonly status: 'degraded' | 'ok';
  readonly service: string;
  readonly release: string;
  readonly components: Components;
}

const STATE = Symbol.for('operator-console.observability.health');

const shared = globalThis as typeof globalThis & {
  [STATE]?: Record<ComponentName, ComponentStatus>;
};

const state = (shared[STATE] ??= { tolgee: 'unknown' });

export function reportComponent(name: ComponentName, status: ComponentStatus): void {
  state[name] = status;
}

function watched(): ComponentName[] {
  return process.env.TOLGEE_API_URL?.trim() ? ['tolgee'] : [];
}

export function health(): HealthBody {
  const components: Components = Object.fromEntries(
    watched().map((name) => [name, { status: state[name] }])
  );
  const status = Object.values(components).some((component) => component.status === 'down')
    ? ('degraded' as const)
    : ('ok' as const);
  recordHealth(status, components as Record<string, { status: string }>);

  return {
    status,
    service: process.env.OTEL_SERVICE_NAME?.trim() || 'trading-bot-operator-console',
    release: process.env.NEXT_PUBLIC_RELEASE ?? 'dev',
    components,
  };
}
