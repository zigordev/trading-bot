import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Messages } from './translator';

const loadLocalMessages = vi.hoisted(() => vi.fn<() => Promise<Messages | null>>());
const loadRemoteMessages = vi.hoisted(() => vi.fn<() => Promise<Messages | null>>());

vi.mock('./local', () => ({ loadLocalMessages }));
vi.mock('./remote', () => ({ loadRemoteMessages }));

import { loadMessages } from './messages';

describe('loadMessages', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    delete (globalThis as Record<symbol, unknown>)[
      Symbol.for('operator-console.i18n.listLengthReported')
    ];
  });

  const merge = async (local: Messages, remote: Messages) => {
    loadLocalMessages.mockResolvedValue(local);
    loadRemoteMessages.mockResolvedValue(remote);
    return loadMessages('en');
  };

  it('layers the export over the committed copy key by key', async () => {
    const messages = await merge(
      { console: { header: { title: 'Operator console', env: 'local' } } },
      { console: { header: { title: 'Consola de operador' } } }
    );

    expect(messages).toEqual({
      console: { header: { title: 'Consola de operador', env: 'local' } },
    });
  });

  it('keeps the fields of a list entry the export did not carry', async () => {
    const messages = await merge(
      { console: { steps: [{ step: '01', title: 'Pause', text: 'Stops new entries.' }] } },
      { console: { steps: [{ text: 'Detiene nuevas entradas.' }] } }
    );

    expect(messages).toEqual({
      console: { steps: [{ step: '01', title: 'Pause', text: 'Detiene nuevas entradas.' }] },
    });
  });

  it('keeps the committed list when the export carries fewer entries', async () => {
    const messages = await merge(
      { console: { bullets: ['one', 'two', 'three'] } },
      { console: { bullets: ['uno', 'dos'] } }
    );

    expect(messages).toEqual({ console: { bullets: ['one', 'two', 'three'] } });
  });

  it('keeps the committed list when the export carries more entries', async () => {
    const messages = await merge(
      { console: { bullets: ['one', 'two'] } },
      { console: { bullets: ['uno', 'dos', 'tres'] } }
    );

    expect(messages).toEqual({ console: { bullets: ['one', 'two'] } });
  });

  it('names the list it kept, once per process', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await merge({ console: { bullets: ['one', 'two'] } }, { console: { bullets: ['uno'] } });
    await merge({ console: { bullets: ['one', 'two'] } }, { console: { bullets: ['uno'] } });

    const mismatches = stdout.mock.calls
      .map(([line]) => JSON.parse(String(line)))
      .filter((record) => record.event === 'i18n.list_length_mismatch');

    expect(mismatches).toEqual([
      expect.objectContaining({ key: 'console.bullets', committed: 2, remote: 1 }),
    ]);
  });

  it('takes the export list when it matches the committed one entry for entry', async () => {
    const messages = await merge(
      { console: { bullets: ['one', 'two'] } },
      { console: { bullets: ['uno', 'dos'] } }
    );

    expect(messages).toEqual({ console: { bullets: ['uno', 'dos'] } });
  });

  it('counts the source every load resolved to', async () => {
    const { registry } = await import('@/observability/metrics.registry');

    const count = async (source: string) => {
      const text = await registry.metrics();
      const line = new RegExp(
        `^trading_bot_operator_console_i18n_messages_total\\{source="${source}"\\} (\\d+)`,
        'm'
      ).exec(text);
      if (!line) throw new Error(`no i18n counter series for source="${source}"`);
      return Number(line[1]);
    };

    const before = { merged: await count('merged'), local: await count('local') };

    await merge({ console: { title: 'Operator console' } }, { console: { title: 'Consola' } });
    loadRemoteMessages.mockResolvedValue(null);
    await loadMessages('en');

    expect(await count('merged')).toBe(before.merged + 1);
    expect(await count('local')).toBe(before.local + 1);
  });
});
