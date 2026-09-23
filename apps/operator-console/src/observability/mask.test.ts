import { describe, expect, it } from 'vitest';

import { maskMessage, MESSAGE_LIMIT } from './mask';

describe('maskMessage', () => {
  it('masks email addresses and digits', () => {
    expect(maskMessage('Invite for jane.doe@example.com failed after 3 tries on order 12345')).toBe(
      'Invite for <email> failed after <n> tries on order <n>'
    );
  });

  it('collapses whitespace and caps the length', () => {
    const masked = maskMessage(`a\n\n  b ${'x'.repeat(2000)}`);

    expect(masked.startsWith('a b ')).toBe(true);
    expect(masked.length).toBe(MESSAGE_LIMIT);
  });

  it('turns anything that is not a string into text', () => {
    expect(maskMessage(undefined)).toBe('');
    expect(maskMessage({ toString: () => 'boom 42' })).toBe('boom <n>');
  });
});
