import { describe, expect, it } from 'vitest';
import { bpsToPercent, formatLedgerAmount, formatPercent, formatUsd, formatUsdSigned } from '../../apps/web/src/shared/money';
import { percentOff } from '../../apps/web/src/shared/tiers';

const MINUS = '−';

describe('every money sign is built in one place', () => {
  it('writes a negative amount with a true minus sign, as the ledger rows do', () => {
    expect(formatUsd(-500)).toBe(`${MINUS}$5.00`);
    expect(formatUsdSigned(-500)).toBe(`${MINUS}$5.00`);
    expect(formatLedgerAmount(500, 'debit')).toBe(`${MINUS}$5.00`);
    expect(formatUsd(-500)).not.toContain('-');
  });

  it('keeps a plus only where a sign is asked for', () => {
    expect(formatUsd(500)).toBe('$5.00');
    expect(formatUsdSigned(500)).toBe('+$5.00');
    expect(formatLedgerAmount(500, 'credit')).toBe('+$5.00');
    expect(formatUsd(275_000)).toBe('$2,750.00');
  });
});

describe('every percentage is written one way', () => {
  it.each([
    [300, '3%'],
    [100, '1%'],
    [250, '2.5%'],
    [125, '1.25%'],
    [5, '0.05%'],
  ])('%i basis points read %s', (bps, text) => {
    expect(formatPercent(bps)).toBe(text);
    expect(`${bpsToPercent(bps)}%`).toBe(text);
    expect(`${percentOff(bps)}%`).toBe(text);
  });
});
