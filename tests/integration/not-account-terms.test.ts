import { describe, it, expect } from 'vitest';
import { Client, SEED, signIn } from './helpers/http';

/**
 * The figures the legal documents and the FAQ point at.
 *
 * The numbers the daily sweeps use are environment variables, so a document
 * that stated them as prose would go false, unnoticed, the moment
 * `WALLET_DEBT_INTEREST_BPS` changed. The documents say the current figures are
 * shown in the app, and this is where the app gets them: from the same
 * configuration and constants the charging code reads.
 *
 * Requires a running API.
 */
describe('NOT published account terms', () => {
  it('is public, so the terms can be read before signing up', async () => {
    const res = await new Client().get('/content/account-terms');
    expect(res.status).toBe(200);
    expect(res.body.termsVersion).toBe('2026-10-draft-1');
  });

  it('publishes the debt policy the sweeps apply', async () => {
    const { debt } = (await new Client().get('/content/account-terms')).body;
    expect(Number.isInteger(debt.graceDays)).toBe(true);
    expect(debt.graceDays).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(debt.interestBpsPerDay)).toBe(true);
    expect(Number.isInteger(debt.suspendBelowMinor)).toBe(true);
    expect(debt.suspendBelowMinor).toBeLessThanOrEqual(0);
  });

  it('publishes the cash-out schedule that is charged, not a copy of it', async () => {
    const terms = (await new Client().get('/content/account-terms')).body;
    const collector = await signIn(SEED.collector);
    const quote = (await collector.get('/finance/cash-out-quote?amountMinor=5000')).body;
    expect(terms.cashOut).toEqual(quote.schedule);
  });

  it('publishes the fixed fees and the escrow terms', async () => {
    const terms = (await new Client().get('/content/account-terms')).body;
    expect(terms.chargebackFeeMinor).toBeGreaterThan(0);
    expect(terms.shipping.restockingFeeMinor).toBeGreaterThan(0);
    expect(terms.escrow.feeBps).toBeGreaterThan(0);
    const escrow = (await (await signIn(SEED.collector)).get('/escrow/terms')).body;
    expect(terms.escrow.minimumValueMinor).toBe(escrow.minimumValueMinor);
  });
});
