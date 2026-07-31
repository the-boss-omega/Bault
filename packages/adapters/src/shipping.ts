/**
 * Shipping adapter (T020) — ShipStation / Easyship behind one interface.
 * Provides carrier rates, label purchase, and tracking. Rush handling is a flag.
 */
export interface RateRequest {
  destination: { country: string; postalCode: string };
  items: { weightGrams: number }[];
  rush: boolean;
}

export interface Rate {
  carrier: string;
  serviceLevel: string;
  costMinor: number;
  currency: string;
  estimatedDays: number;
}

export interface LabelResult {
  trackingNumber: string;
  labelObjectKey: string;
  costMinor: number;
  currency: string;
}

export interface TrackingStatus {
  trackingNumber: string;
  status: 'in_transit' | 'delivered' | 'exception' | 'unknown';
}

export interface ShippingAdapter {
  getRates(req: RateRequest): Promise<Rate[]>;
  buyLabel(rate: Rate, req: RateRequest): Promise<LabelResult>;
  getTracking(trackingNumber: string): Promise<TrackingStatus>;
}

export class SandboxShippingAdapter implements ShippingAdapter {
  async getRates(req: RateRequest): Promise<Rate[]> {
    const base = req.rush ? 3500 : 1500;
    return [
      { carrier: 'DHL', serviceLevel: req.rush ? 'Express' : 'Standard', costMinor: base, currency: 'USD', estimatedDays: req.rush ? 1 : 4 },
      { carrier: 'USPS', serviceLevel: 'Standard', costMinor: 900, currency: 'USD', estimatedDays: 6 },
    ];
  }
  async buyLabel(rate: Rate): Promise<LabelResult> {
    return {
      trackingNumber: `SBX${Math.floor(Date.now() / 1000)}`,
      labelObjectKey: `labels/sbx-${rate.carrier}.pdf`,
      costMinor: rate.costMinor,
      currency: rate.currency,
    };
  }
  async getTracking(trackingNumber: string): Promise<TrackingStatus> {
    return { trackingNumber, status: 'in_transit' };
  }
}
