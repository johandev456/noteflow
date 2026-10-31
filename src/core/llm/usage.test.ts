import { describe, expect, it } from 'vitest';
import { addUsage, emptyUsage, estimateCost, formatTokens } from './usage';

describe('usage', () => {
  it('accumulates tokens and calls', () => {
    const u = addUsage(addUsage(emptyUsage(), 100, 20), 50, 5);
    expect(u).toEqual({ inputTokens: 150, outputTokens: 25, calls: 2 });
  });

  it('estimates cost from per-million prices', () => {
    const u = { inputTokens: 1_000_000, outputTokens: 500_000, calls: 1 };
    expect(estimateCost(u, { inputPerM: 0.2, outputPerM: 1 })).toBeCloseTo(0.7);
  });

  it('returns null when prices are unset', () => {
    expect(estimateCost(emptyUsage(), { inputPerM: 0, outputPerM: 0 })).toBeNull();
  });

  it('formats token counts', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1250)).toBe('1.3k');
  });
});
