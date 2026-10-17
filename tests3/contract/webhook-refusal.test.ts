import { beforeAll, describe, it, expect, vi } from 'vitest';
import { SandboxPaymentAdapter, type WebhookDelivery } from '@bault/adapters';

/**
 * Who hears about a payment webhook the API refuses.
 *
 * Both kinds are answered 400 `webhook_unverified`. Only one is reported:
 *
 *  - `malformed` (a header missing, a body that is not JSON) is a request
 *    somebody else got wrong. A warning in the log is enough.
 *  - `refused` (a signature the provider would not vouch for) is, for a
 *    genuine delivery, a stale PAYPAL_WEBHOOK_ID. Every delivery then fails
 *    quietly, and a payout PayPal refunds or reverses after paying it is never
 *    credited back, because that event arrives by webhook and nothing else
 *    re-checks a paid payout. So it goes to the error tracker.
 *
 * Unit-level: `TopupService` is built by hand with the sandbox adapter and a
 * recording reporter, so this needs no server, no database and no DSN.
 */

process.env.NODE_ENV = 'test';

let topups: typeof import('../../apps/api/src/modules/pay/topup.service');

beforeAll(async () => {
  await import('../../apps/api/node_modules/reflect-metadata/Reflect.js');
  topups = await import('../../apps/api/src/modules/pay/topup.service');
});

const FORGED: WebhookDelivery = {
  rawBody: JSON.stringify({ id: 'WH-forged', type: 'PAYMENT.PAYOUTS-ITEM.REFUNDED', data: {} }),
  headers: { 'paypal-transmission-sig': 'invalid' },
};
const GARBLED: WebhookDelivery = { rawBody: 'not json', headers: {} };

function service() {
  const reported: unknown[] = [];
  const nothing = {} as never;
  const svc = new topups.TopupService(nothing, new SandboxPaymentAdapter(), nothing, nothing, (error: unknown) => {
    reported.push(error);
  });
  const log = (svc as unknown as { logger: { error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void } }).logger;
  const errors = vi.spyOn(log, 'error').mockImplementation(() => undefined);
  const warnings = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
  return { svc, reported, errors, warnings };
}

describe('a payment webhook the API refuses', () => {
  it('is reported, and logged as an error naming the likely cause, when the signature is refused', async () => {
    const { svc, reported, errors } = service();
    await expect(svc.handleWebhook(FORGED)).rejects.toMatchObject({ status: 400, code: 'webhook_unverified' });

    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({ name: 'WebhookVerificationError', reason: 'refused' });
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]![0])).toMatch(/PAYPAL_WEBHOOK_ID/);
  });

  it('is only a warning, and not reported, when the delivery is malformed', async () => {
    const { svc, reported, errors, warnings } = service();
    await expect(svc.handleWebhook(GARBLED)).rejects.toMatchObject({ status: 400, code: 'webhook_unverified' });

    expect(reported).toHaveLength(0);
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).toHaveBeenCalledTimes(1);
  });

  it('is told apart by the sandbox the same way', async () => {
    const sandbox = new SandboxPaymentAdapter();
    await expect(sandbox.verifyWebhook(FORGED)).rejects.toMatchObject({ reason: 'refused' });
    await expect(sandbox.verifyWebhook(GARBLED)).rejects.toMatchObject({ reason: 'malformed' });
  });
});
