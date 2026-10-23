export interface ShipAddress {
  country: string;
  postalCode: string;
  name?: string;
  company?: string;
  street1?: string;
  street2?: string;
  city?: string;
  region?: string;
  phone?: string;
  email?: string;
}

export const DEFAULT_PACKAGING_GRAMS = 120;

export const DIM_DIVISOR = 167;

export const CM3_PER_IN3 = 16.387;

export const GRAMS_PER_LB = 453.592;

export const GRAMS_PER_OZ = 28.3495;

export type BillingIncrement = 'ounce' | 'pound' | 'continuous';

export function billableGrams(
  actualGrams: number,
  dimGrams: number,
  increment: BillingIncrement,
): number {
  const greater = Math.max(actualGrams, dimGrams);
  if (increment === 'continuous') return greater;
  const unit = increment === 'pound' ? GRAMS_PER_LB : GRAMS_PER_OZ;
  return Math.max(1, Math.ceil(greater / unit)) * unit;
}

export function dimensionalGrams(dims?: { length: number; width: number; height: number }): number {
  if (!dims) return 0;
  const cubicInches = (dims.length * dims.width * dims.height) / CM3_PER_IN3;
  return Math.round((cubicInches / DIM_DIVISOR) * GRAMS_PER_LB);
}

export interface RateRequest {
  destination: ShipAddress;
  origin?: ShipAddress;
  items: { weightGrams: number }[];
  rush: boolean;
  services?: { carrier: string; serviceLevel: string }[];
  dimensionsCm?: { length: number; width: number; height: number };
  packagingGrams?: number;
  signatureRequired?: boolean;
  customs?: CustomsDeclaration;
}

export interface CustomsLineItem {
  description: string;
  quantity: number;
  valueMinor: number;
  weightGrams: number;
  hsCode: string;
  originCountry: string;
}

export interface CustomsDeclaration {
  contentsType: 'merchandise' | 'gift' | 'documents' | 'returned_goods' | 'sample' | 'other';
  contentsExplanation?: string;
  signer: string;
  nonDelivery: 'return' | 'abandon';
  currency: string;
  lines: CustomsLineItem[];
}

export interface ShippingCallOptions {
  signal?: AbortSignal;
  idempotencyKey?: string;
}

export class LabelNotPurchasedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabelNotPurchasedError';
  }

  static is(err: unknown): err is LabelNotPurchasedError {
    return err instanceof LabelNotPurchasedError || (err instanceof Error && err.name === 'LabelNotPurchasedError');
  }
}

export interface Rate {
  carrier: string;
  serviceLevel: string;
  costMinor: number;
  currency: string;
  estimatedDays: number;
  providerShipmentId?: string;
  providerRateId?: string;
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
  getRates(req: RateRequest, opts?: ShippingCallOptions): Promise<Rate[]>;
  buyLabel(rate: Rate, req: RateRequest, opts?: ShippingCallOptions): Promise<LabelResult>;
  getTracking(trackingNumber: string): Promise<TrackingStatus>;
}

interface SandboxService {
  carrier: string;
  serviceLevel: string;
  international: boolean;
  baseMinor: number;
  perKgMinor: number;
  estimatedDays: number;
  flatMinor?: number;
  signatureMinor?: number;
  increment: BillingIncrement;
}

const SANDBOX_SERVICES: readonly SandboxService[] = [
  { carrier: 'USPS', serviceLevel: 'Ground Advantage', international: false, baseMinor: 550, perKgMinor: 420, estimatedDays: 4, signatureMinor: 340, increment: 'ounce' },
  { carrier: 'USPS', serviceLevel: 'Priority Mail', international: false, baseMinor: 980, perKgMinor: 690, estimatedDays: 2, signatureMinor: 340, increment: 'pound' },
  { carrier: 'FedEx', serviceLevel: '2Day', international: false, baseMinor: 1_850, perKgMinor: 890, estimatedDays: 2, signatureMinor: 590, increment: 'pound' },
  { carrier: 'FedEx', serviceLevel: 'Direct Overnight', international: false, baseMinor: 0, perKgMinor: 0, estimatedDays: 1, flatMinor: 10_000, signatureMinor: 0, increment: 'continuous' },
  { carrier: 'ePacket', serviceLevel: 'International', international: true, baseMinor: 1_150, perKgMinor: 1_400, estimatedDays: 16, increment: 'ounce' },
  { carrier: 'ePost', serviceLevel: 'International', international: true, baseMinor: 1_950, perKgMinor: 2_100, estimatedDays: 11, signatureMinor: 620, increment: 'pound' },
  { carrier: 'FedEx', serviceLevel: 'International Priority', international: true, baseMinor: 4_200, perKgMinor: 3_400, estimatedDays: 3, signatureMinor: 590, increment: 'pound' },
];

const ORIGIN_COUNTRY = 'US';

function distanceMultiplier(country: string): number {
  const c = country.toUpperCase();
  if (c === ORIGIN_COUNTRY) return 1;
  if (['CA', 'MX'].includes(c)) return 1.25;
  if (['GB', 'IE', 'FR', 'DE', 'NL', 'BE', 'ES', 'IT', 'PT', 'DK', 'SE', 'NO', 'FI', 'AT', 'CH', 'PL', 'CZ', 'HU', 'GR', 'LU'].includes(c)) return 1.6;
  return 2.1;
}

function trackingFromKey(key: string): string {
  return `SBX${key.replace(/[^A-Za-z0-9]/g, '').slice(-12).toUpperCase()}`;
}

export class SandboxShippingAdapter implements ShippingAdapter {
  async getRates(req: RateRequest): Promise<Rate[]> {
    const international = req.destination.country.toUpperCase() !== ORIGIN_COUNTRY;
    const actualGrams = req.items.reduce((sum, i) => sum + Math.max(0, i.weightGrams), 0);

    const packagedGrams = actualGrams + (req.packagingGrams ?? DEFAULT_PACKAGING_GRAMS);

    const dimGrams = dimensionalGrams(req.dimensionsCm);

    const wanted = req.services;
    const multiplier = distanceMultiplier(req.destination.country);

    return SANDBOX_SERVICES.filter((s) => s.international === international)
      .filter((s) => !wanted || wanted.some((w) => w.carrier === s.carrier && w.serviceLevel === s.serviceLevel))
      .map((s) => {
        const billableKg = billableGrams(packagedGrams, dimGrams, s.increment) / 1000;
        const signature = req.signatureRequired ? (s.signatureMinor ?? 0) : 0;
        const cost =
          s.flatMinor !== undefined
            ? s.flatMinor + signature
            : Math.round((s.baseMinor + s.perKgMinor * billableKg) * multiplier) + signature;
        return {
          carrier: s.carrier,
          serviceLevel: s.serviceLevel,
          costMinor: cost,
          currency: 'USD',
          estimatedDays: s.estimatedDays,
        };
      })
      .sort((a, b) => a.costMinor - b.costMinor);
  }

  private readonly bought = new Map<string, LabelResult>();

  async buyLabel(rate: Rate, _req?: RateRequest, opts: ShippingCallOptions = {}): Promise<LabelResult> {
    if (opts.signal?.aborted) throw new Error('Label purchase abandoned before it was sent');
    const key = opts.idempotencyKey;
    const already = key ? this.bought.get(key) : undefined;
    if (already) return already;
    const label: LabelResult = {
      trackingNumber: key ? trackingFromKey(key) : `SBX${Math.floor(Date.now() / 1000)}`,
      labelObjectKey: `labels/sbx-${rate.carrier}.pdf`,
      costMinor: rate.costMinor,
      currency: rate.currency,
    };
    if (key) this.bought.set(key, label);
    return label;
  }

  async getTracking(trackingNumber: string): Promise<TrackingStatus> {
    return { trackingNumber, status: 'in_transit' };
  }
}
