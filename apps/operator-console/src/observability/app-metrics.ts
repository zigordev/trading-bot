import * as client from 'prom-client';

import { registry } from './metrics.registry';

export const MESSAGE_SOURCES = ['merged', 'remote', 'local', 'default_locale'] as const;
export type MessageSource = (typeof MESSAGE_SOURCES)[number];

interface State {
  readonly messages: Map<MessageSource, number>;
}

const STATE = Symbol.for('operator-console.observability.app-metrics');

const shared = globalThis as typeof globalThis & { [STATE]?: State };

const state = (shared[STATE] ??= {
  messages: new Map(MESSAGE_SOURCES.map((source) => [source, 0])),
});

new client.Counter({
  name: 'trading_bot_operator_console_i18n_messages_total',
  help: 'Message loads by where the copy came from',
  labelNames: ['source'] as const,
  registers: [registry],
  collect() {
    this.reset();
    for (const [source, count] of state.messages) this.inc({ source }, count);
  },
});

export function recordMessageSource(source: MessageSource): void {
  state.messages.set(source, (state.messages.get(source) ?? 0) + 1);
}
