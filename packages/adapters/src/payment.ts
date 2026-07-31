/**
 * Payment adapter (T020, Principle XIII).
 *
 * The platform stores ONLY provider tokens/refs — never raw card data. Every
 * method deals in opaque references. Swap `SandboxPaymentAdapter` for a real
 * Stripe implementation without touching the core.
 */
export interface ChargeRequest {
  userId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  /** Provider-side payment-method token; NEVER a PAN/CVV. */
  paymentMethodToken?: string;
}

export interface ProviderResult {
  providerRef: string;
  status: 'succeeded' | 'pending' | 'failed';
}

export interface WebhookEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface PaymentAdapter {
  createCharge(req: ChargeRequest): Promise<ProviderResult>;
  createTopup(req: ChargeRequest): Promise<ProviderResult>;
  createPayout(req: ChargeRequest & { destinationToken: string }): Promise<ProviderResult>;
  /** Verify a signed webhook and return the parsed event (idempotent by event id). */
  verifyWebhook(rawBody: string, signature: string): WebhookEvent;
}

/** Deterministic in-memory sandbox for local dev and contract tests. */
export class SandboxPaymentAdapter implements PaymentAdapter {
  async createCharge(req: ChargeRequest): Promise<ProviderResult> {
    return { providerRef: `sbx_charge_${req.idempotencyKey}`, status: 'succeeded' };
  }
  async createTopup(req: ChargeRequest): Promise<ProviderResult> {
    return { providerRef: `sbx_topup_${req.idempotencyKey}`, status: 'succeeded' };
  }
  async createPayout(req: ChargeRequest & { destinationToken: string }): Promise<ProviderResult> {
    return { providerRef: `sbx_payout_${req.idempotencyKey}`, status: 'succeeded' };
  }
  verifyWebhook(rawBody: string, _signature: string): WebhookEvent {
    const parsed = JSON.parse(rawBody) as Partial<WebhookEvent>;
    return { id: parsed.id ?? 'sbx_evt', type: parsed.type ?? 'unknown', data: parsed.data ?? {} };
  }
}
