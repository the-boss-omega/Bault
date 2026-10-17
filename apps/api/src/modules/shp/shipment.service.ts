import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
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

/** Who is asking. Staff may act on any shipment; a collector only on their own. */
export type ShipmentActor = Pick<AuthUser, 'id' | 'role'>;

/**
 * What a day of waiting is worth, in minor units, when Bault chooses for you.
 *
 * An explicit number rather than a hidden preference. At $2.50 a day, saving $30
 * is worth about twelve days and saving $2 is worth less than one, which is
 * close to how most people actually feel about a parcel, and is at least
 * arguable in public, which "we picked the cheap one" is not.
 */
const DAY_OF_WAITING_MINOR = 250;

/** An id that can be compared with a uuid column without the query failing. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything a collector can say about a parcel before it is priced. */
export interface ShipmentOptionsInput {
  rush?: boolean;
  insuredValueMinor?: number;
  declaredValueMinor?: number;
  signatureRequired?: boolean;
  addOns?: string[];
  customerNotes?: string;
  serviceMode?: 'simple' | 'personalised';
  perItemCustomsValues?: Record<string, number>;
  /** A key from `SHIPPING_BOXES`. Null or absent: Bault picks the smallest box that fits. */
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

/** A rate, plus everything needed to decide whether to take it. */
export interface QuotedRate extends Rate {
  serviceKey: string;
  /** Empty when the service can carry this parcel. */
  problems: ServiceProblem[];
  eligible: boolean;
  transitDaysMin: number;
  transitDaysMax: number;
  maxInsuredValueMinor: number;
  /** What Bault adds on top: handling, insurance, add-ons. */
  handlingMinor: number;
  insurancePremiumMinor: number;
  addOnsMinor: number;
  /**
   * What the member's tier pays towards this rate, and the parts it pays for.
   * Null for a non-member. The gross figures above are unchanged by it.
   */
  membershipCover: AppliedShippingCover | null;
  coveredMinor: number;
  /** Carrier + everything above, LESS the cover. This is what the wallet is asked for. */
  totalMinor: number;
  /** True when this is what "choose for me" would take. */
  recommended: boolean;
}

export interface Quote {
  destination: { country: string; postalCode: string };
  totalWeightGrams: number;
  /**
   * The box this was priced in.
   *
   * An unchosen box is the one the warehouse would reach for, so the quote
   * carries real dimensions. Null only when nothing in the catalogue takes
   * these contents.
   */
  boxSize: string | null;
  /** True when Bault picked the box rather than the collector. */
  boxAutoSelected: boolean;
  /** True when any item's weight came from its class rather than a scale. */
  weightEstimated: boolean;
  itemCount: number;
  insuredValueMinor: number;
  declaredValueMinor: number;
  signatureRequired: boolean;
  needsCustoms: boolean;
  rates: QuotedRate[];
  optionProblems: { field: string; message: string }[];
}

/**
 * Shipment creation, quoting, rating and payment.
 *
 * A quote depends on where the parcel is going, what it weighs, what it is
 * worth and what has been asked for; services that cannot legally carry it say
 * so with the rule they failed; and the price includes the insurance premium and
 * add-ons as well as the carrier's line.
 *
 * A rate can be selected without being paid for. A shipment the wallet cannot
 * cover is HELD (`awaiting_payment`, for {@link PAYMENT_WINDOW_DAYS}) instead of
 * driving the wallet negative, and its items are freed if it is never paid.
 */
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

  /**
   * Statuses in which a shipment still has a claim on its items.
   *
   * Anything not on this list has either gone (the items left with it) or been
   * called off (they are free again).
   */
  static readonly OPEN_STATUSES = [
    'requested',
    'awaiting_payment',
    'rates_selected',
    'picking',
    'packed',
    'labeled',
  ] as const;

  /**
   * Refuse to put an item into two parcels at once.
   *
   * An item in an open shipment stays `stored` until it is physically
   * dispatched, so `stored` alone does not mean free. Cancelling and merging
   * also rely on this: they only mean something if being IN a shipment does.
   */
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

  /** The service catalogue, so the SPA can show limits before anything is chosen. */
  services() {
    return {
      services: CARRIER_SERVICES,
      addOns: SHIPMENT_ADD_ONS,
      boxes: SHIPPING_BOXES,
      maxInsuredValueMinor: MAX_INSURED_VALUE_MINOR,
      signatureRequiredAboveMinor: SIGNATURE_REQUIRED_ABOVE_MINOR,
      paymentWindowDays: PAYMENT_WINDOW_DAYS,
      /**
       * What cancelling costs once a rate has been selected, published so the
       * warning shown BEFORE the cancel button can name the figure.
       */
      restockingFeeMinor: RESTOCKING_FEE_MINOR,
    };
  }

  /* ------------------------------------------------------------------
     Quoting: pricing a parcel that does not exist yet
     ------------------------------------------------------------------ */

  /**
   * What would this cost?
   *
   * Nothing is created and nothing is charged, so "how much would it be to send
   * these three?" can be answered without committing to sending them.
   */
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
    // The signature is forced rather than merely validated, so a quote shows the
    // real price of the cover the collector asked for.
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

    // The same lines `create` will freeze, so the carrier rates the parcel with
    // the declaration it will travel under.
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

  /**
   * Price every service against this parcel, eligible or not.
   *
   * Ineligible services are RETURNED rather than filtered away, each carrying
   * the rule it failed. A collector who wanted the cheap option and cannot have
   * it is owed the reason: "ePacket insures up to $500.00" is actionable, and
   * an option that silently vanished is not.
   */
  private async priceServices(
    profile: ParcelProfile,
    addOnKeys: string[],
    rush: boolean,
    cover: ShippingCover | null = null,
    customsLines: readonly CustomsLine[] | null = null,
  ): Promise<QuotedRate[]> {
    const { amount: baseHandling } = await this.pricing.price('shipping');
    /**
     * Rush is a BAULT charge, not a carrier one.
     *
     * What rush buys is the warehouse moving a parcel to the front of the
     * queue, so it is priced here and the carrier's rate and estimate are left
     * alone.
     */
    const rushMinor = rush ? ((await this.pricing.tryPrice('shipping_rush'))?.amount.amount ?? 0) : 0;
    const handling = { amount: baseHandling.amount + rushMinor };
    const premium = insurancePremiumMinor(profile.insuredValueMinor);
    const addOnPrices = await this.priceAddOns(addOnKeys);
    const addOnsMinor = Object.values(addOnPrices).reduce((a, b) => a + b, 0);

    /**
     * What a member's tier pays, apart from postage (which depends on the rate).
     *
     * Insurance is covered up to the tier's cap and no further: a $3,000 parcel
     * on a $1,000 cap has the premium on $1,000 paid and pays the difference
     * ("insurance above your tier's cap" is on the published not-covered list).
     * Rush is covered outright where the tier includes it. A tracker is covered
     * while the tier has one left this cycle.
     */
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
      // Where the parcel physically leaves from. A real carrier prices on the
      // origin/destination pair, so quoting without it prices a different
      // shipment than the one that gets bought.
      origin,
      items: [{ weightGrams: profile.weightGrams }],
      // The box, chosen or predicted. The carrier bills dimensional weight from
      // these itself, so nothing here scales its price a second time.
      dimensionsCm: profile.dimensionsCm,
      packagingGrams: profile.packagingGrams,
      rush,
      signatureRequired: profile.signatureRequired,
      // Rated WITH its declaration: the label is bought against this quote, and
      // a carrier cannot add customs to a shipment after it has been rated.
      customs:
        customsLines && customsLines.length > 0
          ? customsDeclarationFor(customsLines, origin?.name ?? 'Bault')
          : undefined,
    });

    const quoted: QuotedRate[] = [];
    for (const service of CARRIER_SERVICES) {
      // Matched through the catalogue's explicit provider names, not by
      // comparing display names with EasyPost's service codes. See `rateFor`.
      const rate = rateFor(service, carrierRates);
      if (!rate) continue; // the adapter does not sell it to this destination
      const problems = checkService(service, profile);
      const carrierCost = service.flatCostMinor !== undefined ? service.flatCostMinor : rate.costMinor;

      // The postage credit meets the carrier's line, and never more than it.
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
        // The catalogue's names, whatever the carrier calls it: these are what
        // the collector selects by and what the shipment stores, and
        // `findService` resolves them. The provider's own ids ride along above.
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
   * The address parcels ship FROM: the primary storage facility.
   *
   * Read from the facility table rather than configured separately, so it is the
   * same address collectors are told to post to and there is one place to change
   * it. A forwarding site stores nothing, so it is never the origin of a vault
   * shipment. The one exception is direct overnight, which never entered the
   * vault and leaves from the forwarding site it arrived at, named by `code`.
   *
   * Left undefined when the facility still carries a placeholder street, which
   * makes the real adapter refuse with a sentence naming the problem instead of
   * quoting against a fictional origin.
   */
  private async originAddress(code?: string) {
    const [site] = await this.db
      .select()
      .from(facility)
      .where(
        and(code ? eq(facility.code, code) : eq(facility.role, 'primary'), eq(facility.active, true)),
      )
      .limit(1);
    if (!site || /placeholder|SET REAL ADDRESS/i.test(site.line1)) return undefined;
    return {
      name: site.name,
      street1: site.line1,
      city: site.city,
      region: site.region,
      postalCode: site.postalCode,
      country: site.country.toUpperCase(),
    };
  }

  /** Each add-on's price, keyed by its fee action, because a tier covers them one by one. */
  private async priceAddOns(keys: string[]): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};
    for (const key of keys) {
      const addOn = shipmentAddOn(key);
      if (!addOn) continue;
      // The catalogue price is the fallback; a pricing rule wins where one
      // exists, because Principle VI makes the rules the source of truth.
      const resolved = await this.pricing.tryPrice(addOnFeeAction(key));
      prices[addOnFeeAction(key)] = resolved?.amount.amount ?? addOn.priceMinor;
    }
    return prices;
  }

  /**
   * "Choose for me."
   *
   * The mode most people want: the collector states the outcome (how fast, how
   * covered) and the platform picks the carrier.
   *
   * The rule is neither "cheapest" nor "fastest", because both are wrong on
   * their own. Cheapest sends a $3,000 card by the slowest boat to save $2;
   * fastest charges $525 for a parcel that would have arrived comfortably for
   * $310. So a day of waiting is given an explicit PRICE and the two are added
   * up, which turns an unstatable preference into an arithmetic one and makes
   * the choice explicable to the collector afterwards.
   */
  private pickBest(rates: QuotedRate[]): QuotedRate | null {
    const eligible = rates.filter((r) => r.eligible);
    if (eligible.length === 0) return null;
    /**
     * Postage credit counts as money here, because it is money: a member's
     * monthly credit spent on this parcel is credit the next one does not have.
     * Scored on the net total alone, every covered service would tie and the
     * fastest would win. Adding the credit back means a member is recommended
     * what anybody would be, and simply pays less for it.
     */
    const score = (r: QuotedRate) =>
      r.totalMinor + (r.membershipCover?.postageMinor ?? 0) + r.transitDaysMax * DAY_OF_WAITING_MINOR;
    return eligible.reduce((best, r) => (score(r) < score(best) ? r : best), eligible[0]!);
  }

  /* ------------------------------------------------------------------
     Creating
     ------------------------------------------------------------------ */

  async create(userId: string, input: CreateShipmentInput) {
    // A negative balance blocks new shipments (PAY-10).
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

    // The checks above, again, with the items locked, so two clicks on Create
    // cannot put the same cards on two parcels.
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
          // The street and city a carrier needs, frozen as quoted. See the column.
          destinationDetail: { ...destination, name: input.recipientName?.trim() || destination.name },
          serviceMode: input.serviceMode === 'simple' ? 'simple' : 'personalised',
          rushFlag: input.rush ?? false,
          declaredValueMinor,
          insuredValueMinor,
          signatureRequired,
          addOns: addOns.length > 0 ? addOns.map((key) => ({ key })) : null,
          // Stored, because picking a service re-rates from the shipment row,
          // and the parcel must be charged in the box it was quoted in.
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

  /* ------------------------------------------------------------------
     Reading
     ------------------------------------------------------------------ */

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

  /**
   * The shape the tracking list and the detail drawer both render.
   *
   * Kept in one place so a field can never be present in the list and missing
   * from the drawer.
   */
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
      /**
       * How it ends and, for a hand delivery, the price somebody worked out.
       * The SPA's quotes panel filters on `fulfilmentMethod` and shows
       * `quoteMinor` with an Accept button.
       */
      fulfilmentMethod: s.fulfilmentMethod,
      quoteMinor: s.quoteMinor,
      quoteNotes: s.quoteNotes,
      trackingNumber: s.trackingNumber,
      /**
       * The carrier refused this shipment's label at dispatch: nothing was
       * bought, and a fresh rate is what moves it on. Null otherwise.
       */
      labelRefused: ShipmentService.labelRefusal(s),
      estimatedDeliveryAt: s.estimatedDeliveryAt,
      rush: s.rushFlag,
      cost: s.cost,
      currency: s.currency,
      itemIds,
      /**
       * What is printed on each item's label, so the packing bench can match a
       * real scan to a card. The ids above appear on no label.
       */
      items: itemIds.map((id) => labels.get(id) ?? { id, serialNumber: null, barcode: null, description: null }),
      /** A direct-overnight shipment's contents are a parcel, and this is the one. */
      directParcel: direct ? { code: direct.code, trackingNumber: direct.trackingNumber } : null,
      destinationAddress: s.destinationAddress,
      destinationCountry: s.destinationCountry,
      destinationPostalCode: s.destinationPostalCode,
      declaredValueMinor: s.declaredValueMinor,
      insuredValueMinor: s.insuredValueMinor,
      insurancePremiumMinor: s.insurancePremiumMinor,
      signatureRequired: s.signatureRequired,
      addOns: (s.addOns as { key: string }[]) ?? [],
      // What the parcel goes out in, so whoever packs it uses the box it was priced in.
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

  /**
   * Load a shipment on behalf of a caller.
   *
   * A shipment carries the destination address and can be made to charge its
   * owner's wallet, so it is never addressable by id alone. `notFound` rather
   * than `forbidden` on a miss, because telling a stranger that some other
   * collector's shipment id exists is itself a leak.
   */
  async loadFor(shipmentId: string, actor: ShipmentActor) {
    const s = await this.load(shipmentId);
    const staff = actor.role === 'warehouse_operator' || actor.role === 'admin';
    if (!staff && s.userId !== actor.id) throw AppError.notFound('Shipment not found');
    return s;
  }

  /** The parcel profile for a shipment that already exists. */
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

  /**
   * What dispatch buys: the rate that was charged, and the parcel it was for.
   *
   * The rate carries the carrier's ids, because a real carrier sells a label
   * only against the rate it quoted. The parcel is built from the same
   * `profileOf` that priced the shipment, so the label and the charge describe
   * the same parcel. The one deliberate difference is the weight: the operator
   * has just put the parcel on a scale, and a measured figure beats every
   * estimate this system made before it was packed.
   */
  async labelRequest(s: typeof shipment.$inferSelect, measuredWeightGrams?: number) {
    const { profile, measurements } = await this.profileOf(s);
    const contentsGrams = measurements.totalWeightGrams;
    const packagingGrams = profile.packagingGrams;
    // The scale weighs the box too; take the box back out so it is not counted twice.
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

  /** The rate a shipment was charged for, with the carrier's handles when it has them. */
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

  /** A direct-overnight shipment: booked against a parcel, with no items by design. */
  static isDirect(s: Pick<typeof shipment.$inferSelect, 'serviceKey' | 'itemIds'>): boolean {
    return s.serviceKey === DIRECT_OVERNIGHT_KEY && ((s.itemIds as string[]) ?? []).length === 0;
  }

  /**
   * What a direct-overnight label is bought for: a parcel that never became items.
   *
   * There is nothing in the vault to build a profile from (`itemIds` is empty
   * by design), which is why `labelRequest` cannot serve it. The parcel is the
   * contents: it leaves from the forwarding site it arrived at, as one envelope
   * weighing what the scale says.
   */
  async directLabelRequest(s: typeof shipment.$inferSelect, measuredWeightGrams: number) {
    const request: RateRequest = {
      destination: destinationOf(s),
      origin: await this.originAddress(DIRECT_OVERNIGHT_FACILITY),
      items: [{ weightGrams: Math.max(1, measuredWeightGrams) }],
      // The scale weighed the envelope with the cards in it.
      packagingGrams: 0,
      rush: s.rushFlag,
      signatureRequired: s.signatureRequired,
    };
    return { rate: ShipmentService.chargedRate(s), request };
  }

  /**
   * The parcel each direct shipment was booked for, by shipment id.
   *
   * Read from the parcel's own append-only trail: booking a direct shipment
   * writes a `direct_shipped` event naming the shipment, and that event is the
   * link, so there is no column to drift from it.
   */
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

  /**
   * What is printed on each item's label, by id, so whoever packs a shipment
   * can check what they scan against what the shipment holds.
   */
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

  /** Rates for a real shipment, with the same constraint annotations a quote has. */
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

  /**
   * What the member's tier can pay towards this shipment's rate.
   *
   * A shipment re-rated after its label was refused already spent cover on the
   * refused rate, and that cover goes back to the cycle when the new rate is
   * settled. Priced without it, the member would be quoted as if this parcel
   * had used their allowance twice. So, while it is still the cycle the cover
   * came out of, it is counted as available again here.
   */
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

  /* ------------------------------------------------------------------
     Choosing a service, and paying for it
     ------------------------------------------------------------------ */

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

  /**
   * "Choose for me", applied.
   *
   * Same settlement path as an explicit choice. The only difference is who
   * decided, which is recorded on the shipment so a late parcel can be answered
   * for honestly.
   */
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

  /**
   * A rate can be chosen only before anything was charged, and only for a
   * parcel a carrier is taking.
   *
   * A paid (`rates_selected`) shipment is refused, because its price is agreed
   * and paid, with one exception: the carrier refused its label at dispatch.
   * Nothing was bought, the rate it holds is the one just turned down, and
   * without a fresh one the only way out would be a paid cancellation; `settle`
   * then settles the difference against what was paid. A hand-delivery or
   * show-pickup request is refused because a carrier rate is far cheaper than
   * what was quoted for it.
   */
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

  /**
   * The carrier's refusal of this shipment's label, when that is where it stands.
   *
   * Written by dispatch (`labelPurchase.state = 'refused'` on the fulfilment
   * record) when the carrier answered no to the stored rate, so nothing was
   * bought. Only a paid carrier parcel with no tracking number counts: a direct
   * overnight parcel has one flat price and no rate to choose again.
   */
  static labelRefusal(s: typeof shipment.$inferSelect): { at: string | null; reason: string | null } | null {
    if (s.status !== 'rates_selected' || s.trackingNumber || s.fulfilmentMethod !== 'carrier') return null;
    if (ShipmentService.isDirect(s)) return null;
    const purchase = (s.fulfillment as { labelPurchase?: { state?: string; startedAt?: string; lastError?: string } } | null)
      ?.labelPurchase;
    if (purchase?.state !== 'refused') return null;
    return { at: purchase.startedAt ?? null, reason: purchase.lastError ?? null };
  }

  /**
   * Freeze the price and try to pay it.
   *
   * If the wallet cannot cover the total the shipment is HELD rather than
   * charged, because driving a wallet negative to buy postage would block every
   * other service the collector has. They are told, the parcel waits
   * `PAYMENT_WINDOW_DAYS`, and the items are released if nothing happens.
   */
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
      // What a real carrier will actually sell at dispatch: THIS rate, by id.
      providerShipmentId: rate.providerShipmentId ?? null,
      providerRateId: rate.providerRateId ?? null,
      // Stored so a HELD shipment spends the same cover when it is paid later.
      membershipCover: rate.membershipCover,
      cost: rate.totalMinor,
      insurancePremiumMinor: rate.insurancePremiumMinor,
      currency: rate.currency,
      estimatedDeliveryAt,
      updatedAt: now,
    };

    /**
     * One transaction, under the shipment lock and then the wallet lock, so two
     * clicks on a service cannot both find the money and charge it, and the
     * expiry sweep cannot cancel a parcel while it is being paid for.
     */
    return this.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(shipment).where(eq(shipment.id, s.id)).for('update').limit(1);
      if (!cur) throw AppError.notFound('Shipment not found');
      ShipmentService.assertRateSelectable(cur);
      if (cur.status === 'rates_selected') return this.reRate(tx, cur, rate, common, estimatedDeliveryAt);

      const balance = await this.ledger.balanceOf(s.userId, tx);
      if (balance.amount < rate.totalMinor) {
        // A held parcel keeps the deadline it was first given: choosing again
        // does not buy another week.
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

      // The cover as spent, with the cycle it came out of, so a cancellation
      // gives it back to the right one.
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

  /**
   * A fresh rate for a paid shipment whose label the carrier refused.
   *
   * What is already paid is `cost`. The difference is settled here, in the
   * shipment's transaction and under the wallet lock: a cheaper rate's comes
   * back as a `shipping_refund`, a dearer one's is charged, and a wallet that
   * cannot cover it refuses the change and leaves the shipment as it was. The
   * cover the refused rate spent goes back to its cycle before the new rate's
   * is spent, the order a cancellation followed by a new choice would take.
   */
  private async reRate(
    tx: Database,
    cur: typeof shipment.$inferSelect,
    rate: QuotedRate,
    common: Partial<typeof shipment.$inferInsert>,
    estimatedDeliveryAt: Date,
  ) {
    const userId = cur.userId;
    const currency = cur.currency ?? DEFAULT_CURRENCY;
    // The shipment, then the wallet, then the member's cycle.
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
      // Credited against the shipment, as a cancellation's refund is, so a later
      // cancellation refunds what is paid now and not the first charge.
      await this.ledger.record(
        { userId, type: 'shipping_refund', amount: -differenceMinor, direction: 'credit', currency, referenceType: 'shipment', referenceId: cur.id },
        tx,
      );
    }

    const [updated] = await tx
      .update(shipment)
      // The refusal is answered: a clean fulfilment record for the next dispatch.
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

  /**
   * One charge for the whole parcel, with every component in the snapshot.
   *
   * A single line on the statement, because that is what the collector bought,
   * but the snapshot carries the carrier's cost, Bault's handling, the insurance
   * premium and the add-ons separately, so "what am I actually paying for" has
   * an answer that survives a pricing change (Principle V).
   */
  private async chargeFor(tx: Database, s: typeof shipment.$inferSelect, rate: QuotedRate) {
    // A parcel the tier paid for entirely is not a $0.00 line on the statement.
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
          // What the member's tier paid, so the charge explains its own total.
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

  /**
   * Settle a held shipment once the wallet can cover it.
   *
   * The price is NOT re-quoted. It was frozen when the service was chosen, and
   * re-pricing it on payment day would mean a collector who funded their wallet
   * on Friday paid a different figure from the one they agreed to on Monday
   * (Principle V).
   */
  async pay(shipmentId: string, actor: ShipmentActor) {
    await this.loadFor(shipmentId, actor);

    // Everything below under the shipment lock, then the wallet lock (see
    // `settle`), so two Pay clicks cannot charge the parcel twice.
    return this.db.transaction(async (tx) => {
      const [s] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).for('update').limit(1);
      if (!s) throw AppError.notFound('Shipment not found');
      if (s.status !== 'awaiting_payment') {
        throw new AppError(ErrorCode.CONFLICT, 'This shipment is not awaiting payment', 409);
      }
      if (!s.cost || !s.carrier || !s.serviceLevel) {
        throw AppError.validation('This shipment has no agreed price');
      }
      // The items were checked when the rate was chosen, up to a week ago.
      // Whatever has happened to them since, a parcel is not paid for unless
      // they are still the collector's, on the shelf and not on hold.
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
      // The cover the member saw when the rate was chosen, spent now that the
      // money is. If it has gone meanwhile this refuses instead of charging more.
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
