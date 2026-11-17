import { createHash } from 'node:crypto';
import { afterAll, describe, it, expect } from 'vitest';
import { BASE, SEED, signIn, type Client } from '../integration/helpers/http';
import { closeDb, sql } from '../integration/helpers/db';

afterAll(closeDb);

const balanceOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;

function deliver(event: { id: string; type: string; data: Record<string, unknown> }) {
  return fetch(`${BASE}/webhooks/payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  }).then((r) => r.status);
}

describe('concurrency: a PayPal cash-in is credited once', () => {
  it('credits once when the collector, the capture webhook and the approval webhook all arrive together', async () => {
    const collector = await signIn(SEED.collector2);
    const ROUNDS = 4;

    for (let round = 0; round < ROUNDS; round += 1) {
      const AMOUNT = 3_000 + round * 100;
      const before = await balanceOf(collector);
      const started = await collector.post('/finance/checkout/paypal', {
        amountMinor: AMOUNT,
        route: round % 2 === 0 ? 'card' : 'paypal_gs',
        idempotencyKey: `race-${Date.now()}-${round}-${Math.floor(Math.random() * 1e6)}`,
      });
      expect(started.status, `round ${round}`).toBe(201);
      const { paymentId, orderId } = started.body as { paymentId: string; orderId: string };

      const completed = (id: string) => ({
        id,
        type: 'PAYMENT.CAPTURE.COMPLETED',
        data: {
          id: `SBXC-${createHash('sha256').update(orderId).digest('hex').slice(0, 20)}`,
          status: 'COMPLETED',
          amount: { currency_code: 'USD', value: (AMOUNT / 100).toFixed(2) },
          custom_id: paymentId,
          supplementary_data: { related_ids: { order_id: orderId } },
        },
      });
      const approved = {
        id: `WH-approved-${paymentId}`,
        type: 'CHECKOUT.ORDER.APPROVED',
        data: { id: orderId, status: 'APPROVED', purchase_units: [{ custom_id: paymentId }] },
      };

      const results = await Promise.all([
        collector.post(`/finance/checkout/paypal/${paymentId}/capture`, {}).then((r) => r.status),
        collector.post(`/finance/checkout/paypal/${paymentId}/capture`, {}).then((r) => r.status),
        collector.post(`/finance/checkout/paypal/${paymentId}/capture`, {}).then((r) => r.status),
        deliver(completed(`WH-a-${paymentId}`)),
        deliver(completed(`WH-a-${paymentId}`)),
        deliver(completed(`WH-b-${paymentId}`)),
        deliver(approved),
        deliver(approved),
      ]);
      for (const status of results) expect(status, `round ${round}: ${results.join(',')}`).toBe(201);

      const [row] = await sql<{ n: number; total: string }>(
        `SELECT count(*)::int AS n, COALESCE(sum(amount), 0)::text AS total
           FROM ledger_record
          WHERE type = 'credit_topup' AND reference_type = 'external_payment' AND reference_id = $1`,
        [paymentId],
      );
      expect(row!.n, `round ${round}`).toBe(1);
      expect(Number(row!.total), `round ${round}`).toBe(AMOUNT);
      expect(await balanceOf(collector), `round ${round}`).toBe(before + AMOUNT);

      const [settled] = await sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM outbox_message WHERE event_type = 'topup_settled' AND aggregate_id = $1`,
        [paymentId],
      );
      expect(settled!.n, `round ${round}`).toBe(1);
    }
  }, 60_000);
});
