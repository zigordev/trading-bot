import { describe, it, expect } from 'vitest';

import {
  formatCount,
  formatDuration,
  formatPercent,
  formatPrice,
  formatScore,
  formatTimestamp,
  formatUsd,
  truncateMiddle,
} from './format';

describe('formatUsd', () => {
  it('formats positive, negative and zero', () => {
    expect(formatUsd(12.34)).toBe('$12.34');
    expect(formatUsd(-12.34)).toBe('-$12.34');
    expect(formatUsd(0)).toBe('$0.00');
  });
  it('signed option adds + for positive', () => {
    expect(formatUsd(10, { signed: true })).toBe('+$10.00');
    expect(formatUsd(-10, { signed: true })).toBe('-$10.00');
    expect(formatUsd(0, { signed: true })).toBe('$0.00');
  });
  it('compact notation', () => {
    expect(formatUsd(12_345, { compact: true })).toBe('$12.3K');
  });
  it('handles null/NaN', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(Number.NaN)).toBe('—');
  });
});

describe('formatPrice', () => {
  it('scales fraction digits by magnitude', () => {
    expect(formatPrice(0.0004567)).toBe('0.000457');
    expect(formatPrice(0.4567)).toBe('0.456700');
    expect(formatPrice(12.345)).toBe('12.3450');
    expect(formatPrice(12345)).toBe('12,345.00');
  });
});

describe('formatPercent', () => {
  it('includes % and signed option', () => {
    expect(formatPercent(12.345)).toBe('12.35%');
    expect(formatPercent(12, { signed: true })).toBe('+12.00%');
    expect(formatPercent(-12, { signed: true })).toBe('-12.00%');
  });
});

describe('formatCount', () => {
  it('group-separates', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
  });
});

describe('formatScore', () => {
  it('two fraction digits', () => {
    expect(formatScore(1.2345)).toBe('1.23');
    expect(formatScore(1)).toBe('1.00');
  });
});

describe('formatDuration', () => {
  it('covers ranges', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(3_400)).toBe('3.40s');
    expect(formatDuration(72_000)).toBe('1m 12s');
    expect(formatDuration(3_900_000)).toBe('1h 5m');
  });
});

describe('formatTimestamp', () => {
  const now = new Date('2026-04-24T12:00:00Z');
  it('relative', () => {
    expect(formatTimestamp('2026-04-24T11:59:20Z', { style: 'relative', now })).toBe('just now');
    expect(formatTimestamp('2026-04-24T11:30:00Z', { style: 'relative', now })).toBe('30m ago');
  });
  it('null → dash', () => {
    expect(formatTimestamp(null)).toBe('—');
  });
});

describe('truncateMiddle', () => {
  it('preserves short values', () => {
    expect(truncateMiddle('abc')).toBe('abc');
  });
  it('truncates long', () => {
    expect(truncateMiddle('0123456789abcdef')).toBe('012345…cdef');
  });
});
