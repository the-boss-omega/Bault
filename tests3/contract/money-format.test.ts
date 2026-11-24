import { describe, expect, it } from 'vitest';
import { formatMinor } from '../../apps/api/src/shared/money';

describe('formatMinor, the API money printer', () => {
  it('groups thousands the way the web app does', () => {
    expect(formatMinor(275_000)).toBe('$2,750.00');
    expect(formatMinor(123_456_789)).toBe('$1,234,567.89');
    expect(formatMinor(99_999)).toBe('$999.99');
  });

  it('keeps the sign in front and the cents', () => {
    expect(formatMinor(-275_005)).toBe('-$2,750.05');
    expect(formatMinor(0)).toBe('$0.00');
    expect(formatMinor(5)).toBe('$0.05');
  });

  it('names another currency after the figure, grouped the same way', () => {
    expect(formatMinor(275_000, 'eur')).toBe('2,750.00 EUR');
  });
});
