import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { SHIPPING_ADAPTER } from '../../shared/adapters/adapters.module';
import type { ShippingAdapter, Rate, RateRequest } from '@bault/adapters';
import { PricingService } from '../prc/pricing.service';
import { LedgerService, DEFAULT_CURRENCY } from '../pay/ledger.service';
import { WalletService } from '../pay/wallet.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { charge } from '../pay/pay.schema';
import { userAccount } from '../acc/acc.schema';
import { isPlaceholderAddress } from '../inv/facility-address';
import { facility } from '../inv/facility.schema';
import { parcel, parcelEvent } from '../inv/parcel.schema';
import { item } from '../cst/cst.schema';
import { newShipmentCode } from '../../shared/ids';
import { fullName } from '../../shared/names';
import { shipment } from './shp.schema';
import type { AuthUser } from '../sec/auth-context';
import { ParcelProfileService, customsDeclarationFor, type CustomsLine } from './parcel-profile.service';
import { SHIPPING_BOXES } from './boxes';
import {
  CARRIER_SERVICES,
  DIRECT_OVERNIGHT_FACILITY,
  DIRECT_OVERNIGHT_KEY,
  checkService,
  destinationOf,
  findService,
  rateFor,
  type CarrierService,
  type ParcelProfile,
  type ServiceProblem,
} from './carriers';
import {
  MAX_INSURED_VALUE_MINOR,
  PAYMENT_WINDOW_DAYS,
  RESTOCKING_FEE_MINOR,
  SHIPMENT_ADD_ONS,
  SIGNATURE_REQUIRED_ABOVE_MINOR,
  addOnFeeAction,
  checkOptions,
  insurancePremiumMinor,
  needsCustoms,
  shipmentAddOn,
  signatureForced,
} from './shipping-options';
import { formatMinor } from '../../shared/money';
import { UNLIMITED } from '../mem/tiers';
import {
  MembershipService,
  type AppliedShippingCover,
  type ShippingCover,
} from '../mem/membership.service';

export type ShipmentActor = Pick<AuthUser, 'id' | 'role'>;

const DAY_OF_WAITING_MINOR = 250;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ShipmentOptionsInput {
  rush?: boolean;
  insuredValueMinor?: number;
  declaredValueMinor?: number;
  signatureRequired?: boolean;
  addOns?: string[];
  customerNotes?: string;
  serviceMode?: 'simple' | 'personalised';
  perItemCustomsValues?: Record<string, number>;
  boxSize?: string | null;
}

export interface CreateShipmentInput extends ShipmentOptionsInput {
  itemIds: string[];
  addressId?: string;
  destinationAddress?: string;
  destinationCountry?: string;
  destinationPostalCode?: string;
  recipientName?: string;
}

export interface QuotedRate extends Rate {
  serviceKey: string;
  problems: ServiceProblem[];
  eligible: boolean;
  transitDaysMin: number;
  transitDaysMax: number;
  maxInsuredValueMinor: number;
  handlingMinor: number;
  insurancePremiumMinor: number;
  addOnsMinor: number;
  membershipCover: AppliedShippingCover | null;
  coveredMinor: number;
  totalMinor: number;
  recommended: boolean;
}

export interface Quote {
  destination: { country: string; postalCode: string };
  totalWeightGrams: number;
  boxSize: string | null;
  boxAutoSelected: boolean;
  weightEstimated: boolean;
  itemCount: number;
  insuredValueMinor: number;
  declaredValueMinor: number;
  signatureRequired: boolean;
  needsCustoms: boolean;
  rates: QuotedRate[];
  optionProblems: { field: string; message: string }[];
}

@Injectable()
export class ShipmentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(SHIPPING_ADAPTER) private readonly shipping: ShippingAdapter,
    private readonly pricing: PricingService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
    private readonly profiles: ParcelProfileService,
    private readonly outbox: OutboxService,
    private readonly memberships: MembershipService,
  ) {}

  static readonly OPEN_STATUSES = [
    'requested',
    'awaiting_payment',
    'rates_selected',
    'picking',
    'packed',
    'labeled',
  ] as const;

  async assertItemsFree(userId: string, itemIds: string[], exceptShipmentId?: string, tx?: Database) {
    const open = await (tx ?? this.db)
      .select({ id: shipment.id, code: shipment.code, itemIds: shipment.itemIds })
      .from(shipment)
      .where(
        and(
          eq(shipment.userId, userId),
          inArray(shipment.status, [...ShipmentService.OPEN_STATUSES]),
        ),
      );

    const claimed = new Map<string, string>();
    for (const s of open) {
      if (s.id === exceptShipmentId) continue;
      for (const id of (s.itemIds as string[]) ?? []) claimed.set(id, s.code ?? s.id);
    }
    for (const id of itemIds) {
      const owner = claimed.get(id);
      if (owner) {
        throw new AppError(ErrorCode.CONFLICT, `That item is already on shipment ${owner}`, 409);
      }
    }
  }

  services() {
    return {
      services: CARRIER_SERVICES,
      addOns: SHIPMENT_ADD_ONS,
      boxes: SHIPPING_BOXES,
      maxInsuredValueMinor: MAX_INSURED_VALUE_MINOR,
      signatureRequiredAboveMinor: SIGNATURE_REQUIRED_ABOVE_MINOR,
      paymentWindowDays: PAYMENT_WINDOW_DAYS,
      restockingFeeMinor: RESTOCKING_FEE_MINOR,
    };
  }

  async quote(userId: string, input: CreateShipmentInput): Promise<Quote> {
    const items = await this.profiles.loadShippableItems(userId, input.itemIds);
    const { destination } = await this.profiles.resolveDestination(userId, {
      addressId: input.addressId,
      destinationAddress: input.destinationAddress,
      country: input.destinationCountry,
      postalCode: input.destinationPostalCode,
    });
    const measurements = this.profiles.measure(items);

    const insuredValueMinor = Math.max(0, input.insuredValueMinor ?? 0);
    const declaredValueMinor = Math.max(0, input.declaredValueMinor ?? 0);
    const signatureRequired = Boolean(input.signatureRequired) || signatureForced(insuredValueMinor);
    const addOns = input.addOns ?? [];

    const { box, problems: boxProblems, boxAutoSelected } = this.profiles.boxFor(input.boxSize, items, measurements);
    const optionProblems = [
      ...checkOptions({
        insuredValueMinor,
        signatureRequired,
        customsValueMinor: declaredValueMinor,
        destinationCountry: destination.country,
        addOns,
      }),
      ...boxProblems,
    ];

    const profile = this.profiles.toProfile({
      destination,
      measurements,
      itemCount: items.length,
      declaredValueMinor,
      insuredValueMinor,
      signatureRequired,
      box,
    });

    const customsLines = needsCustoms(destination.country)
      ? this.profiles.buildCustomsLines(measurements, declaredValueMinor, input.perItemCustomsValues)
      : null;

    const rates = await this.priceServices(
      profile,
      addOns,
      input.rush ?? false,
      await this.memberships.shippingCover(userId),
      customsLines,
    );

    return {
      destination,
      totalWeightGrams: measurements.totalWeightGrams,
      boxSize: box?.key ?? null,
      boxAutoSelected,
      weightEstimated: measurements.anyEstimated,
      itemCount: items.length,
      insuredValueMinor,
      declaredValueMinor,
      signatureRequired,
      needsCustoms: needsCustoms(destination.country),
      rates,
      optionProblems,
    };
  }

  private async priceServices(
    profile: ParcelProfile,
    addOnKeys: string[],
    rush: boolean,
    cover: ShippingCover | null = null,
    customsLines: readonly CustomsLine[] | null = null,
  ): Promise<QuotedRate[]> {
    const { amount: baseHandling } = await this.pricing.price('shipping');
    const rushMinor = rush ? ((await this.pricing.tryPrice('shipping_rush'))?.amount.amount ?? 0) : 0;
    const handling = { amount: baseHandling.amount + rushMinor };
    const premium = insurancePremiumMinor(profile.insuredValueMinor);
    const addOnPrices = await this.priceAddOns(addOnKeys);
    const addOnsMinor = Object.values(addOnPrices).reduce((a, b) => a + b, 0);

    const rushCovered = cover?.rushIncluded ? rushMinor : 0;
    const insuranceCovered =
      cover && profile.insuredValueMinor > 0 && cover.insuredShipmentsLeft > 0
        ? Math.min(premium, insurancePremiumMinor(Math.min(profile.insuredValueMinor, cover.insuredValueCapMinor)))
        : 0;
    const addOnsCovered: Record<string, number> = {};
    for (const [action, minor] of Object.entries(addOnPrices)) {
      const left = cover?.addOnsLeft[action];
      if (left !== undefined && (left === UNLIMITED || left > 0)) addOnsCovered[action] = minor;
    }

    const origin = await this.originAddress();
    const carrierRates = await this.shipping.getRates({
      destination: profile.destination,
      origin,
      items: [{ weightGrams: profile.weightGrams }],
      dimensionsCm: profile.dimensionsCm,
      packagingGrams: profile.packagingGrams,
      rush,
      signatureRequired: profile.signatureRequired,
      customs:
        customsLines && customsLines.length > 0
          ? customsDeclarationFor(customsLines, origin?.name ?? 'Bault')
          : undefined,
    });

    const quoted: QuotedRate[] = [];
    for (const service of CARRIER_SERVICES) {
      const rate = rateFor(service, carrierRates);
      if (!rate) continue;
      const problems = checkService(service, profile);
      const carrierCost = service.flatCostMinor !== undefined ? service.flatCostMinor : rate.costMinor;

      const postageCovered = cover ? Math.min(cover.postageCreditLeftMinor, carrierCost) : 0;
      const addOnsCoveredMinor = Object.values(addOnsCovered).reduce((a, b) => a + b, 0);
      const coveredMinor = postageCovered + insuranceCovered + rushCovered + addOnsCoveredMinor;
      const membershipCover: AppliedShippingCover | null =
        cover && coveredMinor > 0
          ? {
              tier: cover.tier,
              insuredShipment: insuranceCovered > 0,
              insuranceMinor: insuranceCovered,
              postageMinor: postageCovered,
              rushMinor: rushCovered,
              addOns: addOnsCovered,
            }
          : null;

      quoted.push({
        ...rate,
        carrier: service.carrier,
        serviceLevel: service.serviceLevel,
        costMinor: carrierCost,
        serviceKey: service.key,
        problems,
        eligible: problems.length === 0,
        transitDaysMin: service.transitDaysMin,
        transitDaysMax: service.transitDaysMax,
        maxInsuredValueMinor: service.maxInsuredValueMinor,
        handlingMinor: handling.amount,
        insurancePremiumMinor: premium,
        addOnsMinor,
        membershipCover,
        coveredMinor,
        totalMinor: carrierCost + handling.amount + premium + addOnsMinor - coveredMinor,
        recommended: false,
      });
    }

    const best = this.pickBest(quoted);
    return quoted
      .map((q) => ({ ...q, recommended: best !== null && q.serviceKey === best.serviceKey }))
      .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.totalMinor - b.totalMinor);
  }

  /**
   * Where a label says the parcel comes from: the named facility, or else the oldest active primary one that has a
   * real address (a facility still carrying the seed's placeholder is passed over, and so the order is a fixed one
   * now that an administrator can add more than the seed's two).
   */
  private async originAddress(code?: string) {
    const sites = await this.db
      .select()
      .from(facility)
      .where(
        and(code ? eq(facility.code, code) : eq(facility.role, 'primary'), eq(facility.active, true)),
      )
      .orderBy(asc(facility.createdAt), asc(facility.code));
    const site = sites.find((s) => !isPlaceholderAddress(s.line1));
    if (!site) return undefined;
    return {
      name: site.name,
      street1: site.line1,
      city: site.city,
      region: site.region,
      postalCode: site.postalCode,
      country: site.country.toUpperCase(),
    };
  }

  private async priceAddOns(keys: string[]): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};
    for (const key of keys) {
      const addOn = shipmentAddOn(key);
      if (!addOn) continue;
      const resolved = await this.pricing.tryPrice(addOnFeeAction(key));
      prices[addOnFeeAction(key)] = resolved?.amount.amount ?? addOn.priceMinor;
    }
    return prices;
  }

  private pickBest(rates: QuotedRate[]): QuotedRate | null {
    const eligible = rates.filter((r) => r.eligible);
    if (eligible.length === 0) return null;
    const score = (r: QuotedRate) =>
      r.totalMinor + (r.membershipCover?.postageMinor ?? 0) + r.transitDaysMax * DAY_OF_WAITING_MINOR;
    return eligible.reduce((best, r) => (score(r) < score(best) ? r : best), eligible[0]!);
  }

  async create(userId: string, input: CreateShipmentInput) {
    await this.wallet.assertNotBlocked(userId);

    const items = await this.profiles.loadShippableItems(userId, input.itemIds);
    await this.assertItemsFree(userId, items.map((i) => i.id));
    const { destination, formatted, recipientName } = await this.profiles.resolveDestination(userId, {
      addressId: input.addressId,
      destinationAddress: input.destinationAddress,
      country: input.destinationCountry,
      postalCode: input.destinationPostalCode,
    });

    const insuredValueMinor = Math.max(0, input.insuredValueMinor ?? 0);
    const declaredValueMinor = Math.max(0, input.declaredValueMinor ?? 0);
    const signatureRequired = Boolean(input.signatureRequired) || signatureForced(insuredValueMinor);
    const addOns = input.addOns ?? [];

    const problems = checkOptions({
      insuredValueMinor,
      signatureRequired,
      customsValueMinor: declaredValueMinor,
      destinationCountry: destination.country,
      addOns,
    });
    if (problems.length > 0) throw AppError.validation(problems[0]!.message, { problems });

    const measurements = this.profiles.measure(items);
    const { box, problems: boxProblems } = this.profiles.boxFor(input.boxSize, items, measurements);
    if (boxProblems.length > 0) {
      throw AppError.validation(boxProblems[0]!.message, { problems: boxProblems });
    }
    const customsLines = needsCustoms(destination.country)
      ? this.profiles.buildCustomsLines(measurements, declaredValueMinor, input.perItemCustomsValues)
      : null;

    const [created] = await this.db.transaction(async (tx) => {
      await this.profiles.loadShippableItems(userId, input.itemIds, tx);
      await this.assertItemsFree(userId, items.map((i) => i.id), undefined, tx);
      return tx
        .insert(shipment)
        .values({
          code: newShipmentCode(),
          userId,
          itemIds: items.map((i) => i.id),
          destinationAddress: formatted,
          recipientName: input.recipientName?.trim() || recipientName,
          destinationCountry: destination.country,
          destinationPostalCode: destination.postalCode,
          destinationDetail: { ...destination, name: input.recipientName?.trim() || destination.name },
          serviceMode: input.serviceMode === 'simple' ? 'simple' : 'personalised',
          rushFlag: input.rush ?? false,
          declaredValueMinor,
          insuredValueMinor,
          signatureRequired,
          addOns: addOns.length > 0 ? addOns.map((key) => ({ key })) : null,
          boxSize: box?.key ?? null,
          customsLines,
          customerNotes: input.customerNotes?.trim() || null,
          status: 'requested',
          currency: DEFAULT_CURRENCY,
        })
        .returning();
    });
    if (!created) throw AppError.validation('Failed to create shipment');
    return created;
  }

  async listFor(actor: ShipmentActor) {
    const staff = actor.role === 'warehouse_operator' || actor.role === 'admin';

    const rows = await this.db
      .select({
        shipment,
        username: userAccount.username,
        firstName: userAccount.firstName,
        lastName: userAccount.lastName,
      })
      .from(shipment)
      .leftJoin(userAccount, eq(userAccount.id, shipment.userId))
      .where(staff ? undefined : eq(shipment.userId, actor.id))
      .orderBy(desc(shipment.createdAt));

    const labels = await this.itemLabels(rows.flatMap((r) => (r.shipment.itemIds as string[]) ?? []));
    const parcels = await this.directParcels(
      rows.filter((r) => ShipmentService.isDirect(r.shipment)).map((r) => r.shipment.id),
    );
    return rows.map((row) =>
      this.toTrackingView(
        row.shipment,
        { username: row.username, accountName: fullName(row.firstName, row.lastName) },
        labels,
        parcels,
      ),
    );
  }

  private toTrackingView(
    s: typeof shipment.$inferSelect,
    owner: { username: string | null; accountName: string },
    labels: Map<string, { id: string; serialNumber: string; barcode: string; description: string | null }>,
    parcels: Awaited<ReturnType<ShipmentService['directParcels']>>,
  ) {
    const itemIds = (s.itemIds as string[]) ?? [];
    const direct = parcels.get(s.id);
    return {
      id: s.id,
      code: s.code,
      status: s.status,
      username: owner.username,
      customerName: owner.accountName || null,
      recipientName: s.recipientName ?? (owner.accountName || null),
      carrier: s.carrier,
      serviceLevel: s.serviceLevel,
      serviceKey: s.serviceKey,
      serviceMode: s.serviceMode,
      fulfilmentMethod: s.fulfilmentMethod,
      quoteMinor: s.quoteMinor,
      quoteNotes: s.quoteNotes,
      trackingNumber: s.trackingNumber,
      labelRefused: ShipmentService.labelRefusal(s),
      estimatedDeliveryAt: s.estimatedDeliveryAt,
      rush: s.rushFlag,
      cost: s.cost,
      currency: s.currency,
      itemIds,
      items: itemIds.map((id) => labels.get(id) ?? { id, serialNumber: null, barcode: null, description: null }),
      directParcel: direct ? { code: direct.code, trackingNumber: direct.trackingNumber } : null,
      destinationAddress: s.destinationAddress,
      destinationCountry: s.destinationCountry,
      destinationPostalCode: s.destinationPostalCode,
      declaredValueMinor: s.declaredValueMinor,
      insuredValueMinor: s.insuredValueMinor,
      insurancePremiumMinor: s.insurancePremiumMinor,
      signatureRequired: s.signatureRequired,
      addOns: (s.addOns as { key: string }[]) ?? [],
      boxSize: s.boxSize,
      customerNotes: s.customerNotes,
      groupId: s.groupId,
      paymentDueAt: s.paymentDueAt,
      cancelledAt: s.cancelledAt,
      cancelReason: s.cancelReason,
      restockingFeeMinor: s.restockingFeeMinor,
      mergedIntoShipmentId: s.mergedIntoShipmentId,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      fulfilledAt: s.fulfilledAt,
    };
  }

  private async load(shipmentId: string) {
    const [s] = await this.db.select().from(shipment).where(eq(shipment.id, shipmentId)).limit(1);
    if (!s) throw AppError.notFound('Shipment not found');
    return s;
  }

  async loadFor(shipmentId: string, actor: ShipmentActor) {
    const s = await this.load(shipmentId);
    const staff = actor.role === 'warehouse_operator' || actor.role === 'admin';
    if (!staff && s.userId !== actor.id) throw AppError.notFound('Shipment not found');
    return s;
  }

  async profileOf(s: typeof shipment.$inferSelect) {
    const items = await this.profiles.loadShippableItems(s.userId, (s.itemIds as string[]) ?? []);
    const measurements = this.profiles.measure(items);
    return {
      items,
      measurements,
      profile: this.profiles.toProfile({
        destination: destinationOf(s),
        measurements,
        itemCount: items.length,
        declaredValueMinor: s.declaredValueMinor,
        insuredValueMinor: s.insuredValueMinor,
        signatureRequired: s.signatureRequired,
        box: this.profiles.boxFor(s.boxSize, items, measurements).box,
      }),
    };
  }

  async labelRequest(s: typeof shipment.$inferSelect, measuredWeightGrams?: number) {
    const { profile, measurements } = await this.profileOf(s);
    const contentsGrams = measurements.totalWeightGrams;
    const packagingGrams = profile.packagingGrams;
    const measuredContents =
      measuredWeightGrams && measuredWeightGrams > 0
        ? Math.max(1, measuredWeightGrams - (packagingGrams ?? 0))
        : contentsGrams;

    const origin = await this.originAddress();
    const customsLines = (s.customsLines as CustomsLine[] | null) ?? [];
    const request: RateRequest = {
      destination: destinationOf(s),
      origin,
      items: [{ weightGrams: measuredContents }],
      rush: s.rushFlag,
      dimensionsCm: profile.dimensionsCm,
      packagingGrams,
      signatureRequired: s.signatureRequired,
      customs: customsLines.length > 0 ? customsDeclarationFor(customsLines, origin?.name ?? 'Bault') : undefined,
    };
    return { rate: ShipmentService.chargedRate(s), request };
  }

  private static chargedRate(s: typeof shipment.$inferSelect): Rate {
    return {
      carrier: s.carrier ?? '',
      serviceLevel: s.serviceLevel ?? '',
      costMinor: s.cost ?? 0,
      currency: s.currency ?? DEFAULT_CURRENCY,
      estimatedDays: 0,
      providerShipmentId: s.providerShipmentId ?? undefined,
      providerRateId: s.providerRateId ?? undefined,
    };
  }

  static isDirect(s: Pick<typeof shipment.$inferSelect, 'serviceKey' | 'itemIds'>): boolean {
    return s.serviceKey === DIRECT_OVERNIGHT_KEY && ((s.itemIds as string[]) ?? []).length === 0;
  }

  async directLabelRequest(s: typeof shipment.$inferSelect, measuredWeightGrams: number) {
    const request: RateRequest = {
      destination: destinationOf(s),
      origin: await this.originAddress(DIRECT_OVERNIGHT_FACILITY),
      items: [{ weightGrams: Math.max(1, measuredWeightGrams) }],
      packagingGrams: 0,
      rush: s.rushFlag,
      signatureRequired: s.signatureRequired,
    };
    return { rate: ShipmentService.chargedRate(s), request };
  }

  async directParcels(shipmentIds: readonly string[], tx?: Database) {
    const out = new Map<string, { id: string; code: string; trackingNumber: string | null; status: string; facilityId: string }>();
    if (shipmentIds.length === 0) return out;
    const shipmentIdOf = sql<string>`${parcelEvent.metadata} ->> 'shipmentId'`;
    const rows = await (tx ?? this.db)
      .select({
        shipmentId: shipmentIdOf,
        id: parcel.id,
        code: parcel.code,
        trackingNumber: parcel.trackingNumber,
        status: parcel.status,
        facilityId: parcel.facilityId,
      })
      .from(parcelEvent)
      .innerJoin(parcel, sql`${parcel.id}::text = ${parcelEvent.parcelId}`)
      .where(and(eq(parcelEvent.eventType, 'direct_shipped'), inArray(shipmentIdOf, [...shipmentIds])));
    for (const r of rows) out.set(r.shipmentId, r);
    return out;
  }

  private async itemLabels(itemIds: readonly string[]) {
    const ids = [...new Set(itemIds)].filter((id) => UUID.test(id));
    const out = new Map<string, { id: string; serialNumber: string; barcode: string; description: string | null }>();
    if (ids.length === 0) return out;
    const rows = await this.db
      .select({ id: item.id, serialNumber: item.serialNumber, barcode: item.barcode, description: item.description })
      .from(item)
      .where(inArray(item.id, ids));
    for (const r of rows) out.set(r.id, r);
    return out;
  }

  async rates(shipmentId: string, actor: ShipmentActor): Promise<QuotedRate[]> {
    const s = await this.loadFor(shipmentId, actor);
    const { profile } = await this.profileOf(s);
    const addOnKeys = ((s.addOns as { key: string }[]) ?? []).map((a) => a.key);
    return this.priceServices(
      profile,
      addOnKeys,
      s.rushFlag,
      await this.coverFor(s),
      (s.customsLines as CustomsLine[] | null) ?? null,
    );
  }

  private async coverFor(s: typeof shipment.$inferSelect): Promise<ShippingCover | null> {
    const cover = await this.memberships.shippingCover(s.userId);
    const spent = ShipmentService.labelRefusal(s) ? ((s.membershipCover as AppliedShippingCover | null) ?? null) : null;
    if (!cover || !spent || spent.tier !== cover.tier) return cover;
    const state = await this.memberships.current(s.userId);
    if (!spent.spentInPeriodId || spent.spentInPeriodId !== state?.period?.id) return cover;
    const addOnsLeft = { ...cover.addOnsLeft };
    for (const action of Object.keys(spent.addOns ?? {})) {
      const left = addOnsLeft[action];
      if (left !== undefined && left !== UNLIMITED) addOnsLeft[action] = left + 1;
    }
    return {
      ...cover,
      insuredShipmentsLeft: cover.insuredShipmentsLeft + (spent.insuredShipment ? 1 : 0),
      postageCreditLeftMinor: cover.postageCreditLeftMinor + Math.max(0, spent.postageMinor ?? 0),
      addOnsLeft,
    };
  }

  async selectRate(shipmentId: string, carrier: string, serviceLevel: string, actor: ShipmentActor) {
    const s = await this.loadFor(shipmentId, actor);
    ShipmentService.assertRateSelectable(s);

    const service = findService(carrier, serviceLevel);
    if (!service) throw AppError.validation('Unknown carrier or service');

    const quoted = await this.rates(shipmentId, actor);
    const rate = quoted.find((r) => r.serviceKey === service.key);
    if (!rate) throw AppError.validation('Selected carrier/service not available');
    if (!rate.eligible) {
      throw AppError.validation(rate.problems[0]!.message, { problems: rate.problems });
    }

    return this.settle(s, rate, service);
  }

  async selectRecommended(shipmentId: string, actor: ShipmentActor) {
    ShipmentService.assertRateSelectable(await this.loadFor(shipmentId, actor));
    const quoted = await this.rates(shipmentId, actor);
    const best = quoted.find((r) => r.recommended);
    if (!best) {
      throw AppError.validation(
        'No carrier can take this parcel as it stands. Adjust the insurance, the value or the destination.',
      );
    }
    const s = await this.loadFor(shipmentId, actor);
    return this.settle({ ...s, serviceMode: 'simple' }, best, findService(best.carrier, best.serviceLevel)!, {
      serviceMode: 'simple',
    });
  }

  private static assertRateSelectable(s: typeof shipment.$inferSelect) {
    const reRating = s.status === 'rates_selected' && ShipmentService.labelRefusal(s) !== null;
    if (s.status !== 'requested' && s.status !== 'awaiting_payment' && !reRating) {
      throw new AppError(
        ErrorCode.CONFLICT,
        s.status === 'rates_selected'
          ? 'This shipment is already paid for. Cancel it to choose a different service.'
          : 'Shipment already in progress',
        409,
      );
    }
    if (s.mergedIntoShipmentId) {
      throw new AppError(ErrorCode.CONFLICT, 'This request was merged into another', 409);
    }
    if (s.fulfilmentMethod !== 'carrier') {
      throw new AppError(ErrorCode.CONFLICT, 'This shipment is not going by carrier, so it has no carrier rate.', 409);
    }
  }

  static labelRefusal(s: typeof shipment.$inferSelect): { at: string | null; reason: string | null } | null {
    if (s.status !== 'rates_selected' || s.trackingNumber || s.fulfilmentMethod !== 'carrier') return null;
    if (ShipmentService.isDirect(s)) return null;
    const purchase = (s.fulfillment as { labelPurchase?: { state?: string; startedAt?: string; lastError?: string } } | null)
      ?.labelPurchase;
    if (purchase?.state !== 'refused') return null;
    return { at: purchase.startedAt ?? null, reason: purchase.lastError ?? null };
  }

  private async settle(
    s: typeof shipment.$inferSelect,
    rate: QuotedRate,
    service: CarrierService,
    extra: { serviceMode?: 'simple' } = {},
  ) {
    const now = new Date();
    const estimatedDeliveryAt = new Date(now.getTime() + rate.estimatedDays * 86_400_000);

    const common = {
      ...extra,
      carrier: rate.carrier,
      serviceLevel: rate.serviceLevel,
      serviceKey: service.key,
      providerShipmentId: rate.providerShipmentId ?? null,
      providerRateId: rate.providerRateId ?? null,
      membershipCover: rate.membershipCover,
      cost: rate.totalMinor,
      insurancePremiumMinor: rate.insurancePremiumMinor,
      currency: rate.currency,
      estimatedDeliveryAt,
      updatedAt: now,
    };

    return this.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(shipment).where(eq(shipment.id, s.id)).for('update').limit(1);
      if (!cur) throw AppError.notFound('Shipment not found');
      ShipmentService.assertRateSelectable(cur);
      if (cur.status === 'rates_selected') return this.reRate(tx, cur, rate, common, estimatedDeliveryAt);

      const balance = await this.ledger.balanceOf(s.userId, tx);
      if (balance.amount < rate.totalMinor) {
        const paymentDueAt = cur.paymentDueAt ?? new Date(now.getTime() + PAYMENT_WINDOW_DAYS * 86_400_000);
        await tx
          .update(shipment)
          .set({ ...common, status: 'awaiting_payment', paymentDueAt })
          .where(eq(shipment.id, s.id));
        return {
          status: 'awaiting_payment' as const,
          carrier: rate.carrier,
          serviceLevel: rate.serviceLevel,
          cost: rate.totalMinor,
          currency: rate.currency,
          shortfallMinor: rate.totalMinor - balance.amount,
          paymentDueAt,
          estimatedDeliveryAt,
        };
      }

      const spentCover = rate.membershipCover
        ? await this.memberships.spendShippingCover(tx, s.userId, rate.membershipCover)
        : null;
      await this.chargeFor(tx, s, rate);
      await tx
        .update(shipment)
        .set({ ...common, membershipCover: spentCover, status: 'rates_selected', paymentDueAt: null })
        .where(eq(shipment.id, s.id));
      return {
        status: 'rates_selected' as const,
        carrier: rate.carrier,
        serviceLevel: rate.serviceLevel,
        cost: rate.totalMinor,
        currency: rate.currency,
        estimatedDeliveryAt,
      };
    });
  }

  private async reRate(
    tx: Database,
    cur: typeof shipment.$inferSelect,
    rate: QuotedRate,
    common: Partial<typeof shipment.$inferInsert>,
    estimatedDeliveryAt: Date,
  ) {
    const userId = cur.userId;
    const currency = cur.currency ?? DEFAULT_CURRENCY;
    await this.ledger.lockWallet(userId, tx);
    const refusedCover = (cur.membershipCover as AppliedShippingCover | null) ?? null;
    if (refusedCover) await this.memberships.returnShippingCover(tx, userId, refusedCover);
    const spentCover = rate.membershipCover
      ? await this.memberships.spendShippingCover(tx, userId, rate.membershipCover)
      : null;

    const paidMinor = cur.cost ?? 0;
    const differenceMinor = rate.totalMinor - paidMinor;
    if (differenceMinor > 0) {
      const balance = await this.ledger.balanceOf(userId, tx);
      if (balance.amount < differenceMinor) {
        throw new AppError(
          ErrorCode.INSUFFICIENT_BALANCE,
          `That service costs ${formatMinor(differenceMinor)} more than the one already paid for, and the wallet holds ${formatMinor(balance.amount)}. Top up, or choose a cheaper service.`,
          409,
          { shortfallMinor: differenceMinor - balance.amount },
        );
      }
      const [c] = await tx
        .insert(charge)
        .values({
          userId,
          actionType: 'shipping',
          pricingRuleSnapshot: {
            rateChangeAfterRefusedLabel: true,
            previousService: cur.serviceKey,
            previousTotal: paidMinor,
            service: rate.serviceKey,
            newTotal: rate.totalMinor,
            carrierCost: rate.costMinor,
            handling: rate.handlingMinor,
            insurancePremium: rate.insurancePremiumMinor,
            addOns: rate.addOnsMinor,
            membershipCover: rate.membershipCover ?? null,
          },
          amount: differenceMinor,
          currency,
          paymentMeans: 'wallet',
          status: 'settled',
          referenceId: cur.id,
        })
        .returning({ id: charge.id });
      if (!c) throw AppError.validation('Failed to charge the difference');
      await this.ledger.record(
        { userId, type: 'service_charge', amount: differenceMinor, direction: 'debit', currency, referenceType: 'charge', referenceId: c.id },
        tx,
      );
    } else if (differenceMinor < 0) {
      await this.ledger.record(
        { userId, type: 'shipping_refund', amount: -differenceMinor, direction: 'credit', currency, referenceType: 'shipment', referenceId: cur.id },
        tx,
      );
    }

    const [updated] = await tx
      .update(shipment)
      .set({ ...common, membershipCover: spentCover, status: 'rates_selected', paymentDueAt: null, fulfillment: null })
      .where(and(eq(shipment.id, cur.id), eq(shipment.status, 'rates_selected')))
      .returning({ id: shipment.id });
    if (!updated) throw new AppError(ErrorCode.CONFLICT, 'This shipment has moved on.', 409);
    return {
      status: 'rates_selected' as const,
      carrier: rate.carrier,
      serviceLevel: rate.serviceLevel,
      cost: rate.totalMinor,
      currency: rate.currency,
      estimatedDeliveryAt,
      differenceMinor,
    };
  }

  private async chargeFor(tx: Database, s: typeof shipment.$inferSelect, rate: QuotedRate) {
    if (rate.totalMinor <= 0) return;
    const [c] = await tx
      .insert(charge)
      .values({
        userId: s.userId,
        actionType: 'shipping',
        pricingRuleSnapshot: {
          carrierCost: rate.costMinor,
          handling: rate.handlingMinor,
          insurancePremium: rate.insurancePremiumMinor,
          addOns: rate.addOnsMinor,
          service: rate.serviceKey,
          insuredValueMinor: s.insuredValueMinor,
          membershipCover: rate.membershipCover ?? null,
        },
        amount: rate.totalMinor,
        currency: rate.currency,
        paymentMeans: 'wallet',
        status: 'settled',
        referenceId: s.id,
      })
      .returning({ id: charge.id });
    if (!c) throw AppError.validation('Failed to create shipping charge');

    await this.ledger.record(
      {
        userId: s.userId,
        type: 'service_charge',
        amount: rate.totalMinor,
        direction: 'debit',
        currency: rate.currency,
        referenceType: 'charge',
        referenceId: c.id,
      },
      tx,
    );
  }

  async pay(shipmentId: string, actor: ShipmentActor) {
    await this.loadFor(shipmentId, actor);

    return this.db.transaction(async (tx) => {
      const [s] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).for('update').limit(1);
      if (!s) throw AppError.notFound('Shipment not found');
      if (s.status !== 'awaiting_payment') {
        throw new AppError(ErrorCode.CONFLICT, 'This shipment is not awaiting payment', 409);
      }
      if (!s.cost || !s.carrier || !s.serviceLevel) {
        throw AppError.validation('This shipment has no agreed price');
      }
      await this.profiles.loadShippableItems(s.userId, (s.itemIds as string[]) ?? [], tx);
      const balance = await this.ledger.balanceOf(s.userId, tx);
      if (balance.amount < s.cost) {
        throw new AppError(
          ErrorCode.CONFLICT,
          `Short by ${formatMinor(s.cost - balance.amount)}. Top up the wallet and try again.`,
          409,
        );
      }

      const service = findService(s.carrier, s.serviceLevel);
      const storedCover = (s.membershipCover as AppliedShippingCover | null) ?? null;
      const spentCover = storedCover ? await this.memberships.spendShippingCover(tx, s.userId, storedCover) : null;
      await this.chargeFor(tx, s, {
        carrier: s.carrier!,
        serviceLevel: s.serviceLevel!,
        serviceKey: service?.key ?? s.serviceKey ?? 'unknown',
        costMinor: s.cost! - s.insurancePremiumMinor,
        currency: s.currency ?? DEFAULT_CURRENCY,
        estimatedDays: 0,
        problems: [],
        eligible: true,
        transitDaysMin: 0,
        transitDaysMax: 0,
        maxInsuredValueMinor: 0,
        handlingMinor: 0,
        insurancePremiumMinor: s.insurancePremiumMinor,
        addOnsMinor: 0,
        membershipCover: storedCover,
        coveredMinor: 0,
        totalMinor: s.cost!,
        recommended: false,
      });
      await tx
        .update(shipment)
        .set({ status: 'rates_selected', membershipCover: spentCover, paymentDueAt: null, updatedAt: new Date() })
        .where(eq(shipment.id, s.id));
      return { status: 'rates_selected' as const, paid: s.cost };
    });
  }

  async track(shipmentId: string, actor: ShipmentActor) {
    const s = await this.loadFor(shipmentId, actor);
    const [owner] = await this.db
      .select({
        username: userAccount.username,
        firstName: userAccount.firstName,
        lastName: userAccount.lastName,
      })
      .from(userAccount)
      .where(eq(userAccount.id, s.userId))
      .limit(1);
    return this.toTrackingView(
      s,
      { username: owner?.username ?? null, accountName: fullName(owner?.firstName, owner?.lastName) },
      await this.itemLabels((s.itemIds as string[]) ?? []),
      ShipmentService.isDirect(s) ? await this.directParcels([s.id]) : new Map(),
    );
  }
}
