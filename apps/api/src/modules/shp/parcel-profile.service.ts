import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { item } from '../cst/cst.schema';
import { shippingAddress } from '../acc/address.schema';
import { itemWeightGrams } from '../inv/item-classes';
import { DEFAULT_COUNTRY_OF_ORIGIN, DEFAULT_HS_CODE, needsCustoms } from './shipping-options';
import type { Destination, ParcelProfile } from './carriers';
import { checkBox, chooseBox, shippingBox, type BoxProblem, type ShippingBox } from './boxes';

/** One line of the commercial invoice — per item, because customs is per item. */
export interface CustomsLine {
  itemId: string;
  serialNumber: string;
  description: string;
  /** What the COLLECTOR says it is worth. Never derived, never adjusted. */
  valueMinor: number;
  hsCode: string;
  countryOfOrigin: string;
  weightGrams: number;
  /** True when the weight is the class's typical figure, not a measured one. */
  weightEstimated: boolean;
}

/** What a set of items adds up to, physically. */
export interface ItemMeasurements {
  totalWeightGrams: number;
  /** True when ANY item's weight was estimated from its class. */
  anyEstimated: boolean;
  perItem: { itemId: string; serialNumber: string; description: string; weightGrams: number; estimated: boolean }[];
}

/**
 * Turning a set of item ids into a parcel.
 *
 * Every path that prices a shipment — quoting a hypothetical one, rating a real
 * one, re-rating one after its contents were edited — needs the same three
 * answers: what does this weigh, where is it going, and is it legal to send.
 * Having one place that computes them is what stops a quote and the subsequent
 * charge disagreeing about the same parcel.
 */
@Injectable()
export class ParcelProfileService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Load items and check they may be shipped by this owner.
   *
   * The checks are the same ones shipment creation always ran; they live here
   * now so the edit and merge paths cannot forget one.
   */
  async loadShippableItems(userId: string, itemIds: string[], tx?: Database) {
    const exec = tx ?? this.db;
    const ids = [...new Set(itemIds.filter(Boolean))];
    if (ids.length === 0) throw AppError.validation('Choose at least one item');

    const rows = await exec.select().from(item).where(inArray(item.id, ids));
    if (rows.length !== ids.length) throw AppError.validation('One of those items does not exist');

    for (const it of rows) {
      if (it.ownerId !== userId) throw AppError.forbidden(`Item ${it.serialNumber} is not yours`);
      if (it.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, `Item ${it.serialNumber} is on hold`, 409);
      if (it.lifecycleState !== 'stored') {
        throw new AppError(ErrorCode.CONFLICT, `Item ${it.serialNumber} is ${it.lifecycleState}, not stored`, 409);
      }
    }
    return rows;
  }

  /** What the parcel weighs, and how much of that figure anybody actually measured. */
  measure(items: (typeof item.$inferSelect)[]): ItemMeasurements {
    const perItem = items.map((it) => ({
      itemId: it.id,
      serialNumber: it.serialNumber,
      description: it.description ?? it.typeClass,
      weightGrams: itemWeightGrams(it),
      estimated: !(typeof it.weightGrams === 'number' && it.weightGrams > 0),
    }));
    return {
      totalWeightGrams: perItem.reduce((sum, i) => sum + i.weightGrams, 0),
      anyEstimated: perItem.some((i) => i.estimated),
      perItem,
    };
  }

  /**
   * The box that was chosen, and whether these contents fit in it.
   *
   * Every path that stores or prices a box asks the same question, so it is
   * answered once.
   */
  boxFor(
    boxSize: string | null | undefined,
    items: (typeof item.$inferSelect)[],
    measurements: ItemMeasurements,
  ): { box: ShippingBox | undefined; problems: BoxProblem[]; boxAutoSelected: boolean } {
    const contents = {
      totalWeightGrams: measurements.totalWeightGrams,
      typeClasses: items.map((i) => i.typeClass),
    };

    const chosen = shippingBox(boxSize);
    if (chosen) return { box: chosen, problems: checkBox(chosen, contents), boxAutoSelected: false };

    /**
     * Nobody picked one, so pick the one the warehouse would.
     *
     * This used to answer `undefined`, which meant no dimensions reached the
     * carrier, which meant the parcel was billed on weight alone plus a flat
     * 120 g — and a light-but-bulky parcel was under-quoted by whatever its
     * volume was worth. The quote was then the charge, so Bault absorbed the
     * difference on every unboxed shipment.
     *
     * The fix is not to make the collector choose. Most people have no idea what
     * a dimensional divisor is and should not have to: the warehouse was always
     * going to pick a box, and `chooseBox` picks the same one it would — the
     * smallest that fits. An explicit choice still wins, because a collector who
     * wants their card in a bigger box for their own reasons may have one.
     */
    return { box: chooseBox(contents), problems: [], boxAutoSelected: true };
  }

  /**
   * Resolve where the parcel is going.
   *
   * A saved address is preferred over free text because it carries a real
   * country and postal code, which is what a rate depends on. The formatted
   * single line is still stored for humans — it is simply no longer the only
   * thing stored.
   */
  async resolveDestination(
    userId: string,
    input: { addressId?: string; destinationAddress?: string; country?: string; postalCode?: string },
  ): Promise<{ destination: Destination; formatted: string; recipientName: string | null }> {
    if (input.addressId) {
      const [a] = await this.db
        .select()
        .from(shippingAddress)
        .where(eq(shippingAddress.id, input.addressId))
        .limit(1);
      if (!a || a.userId !== userId) throw AppError.notFound('Address not found');
      return {
        // The whole address, not two fields of it. A saved address already has
        // the street and city a carrier needs; throwing them away here is what
        // made a real rate impossible to ask for.
        destination: {
          country: a.country.toUpperCase(),
          postalCode: a.postalCode,
          name: a.recipient,
          street1: a.line1,
          ...(a.line2 ? { street2: a.line2 } : {}),
          city: a.city,
          // A US label is rated and routed by state; the rest where a country has one.
          ...(a.region ? { region: a.region } : {}),
          ...(a.phone ? { phone: a.phone } : {}),
        },
        formatted: [a.recipient, a.line1, a.line2, a.city, [a.region, a.postalCode].filter(Boolean).join(' '), a.country]
          .filter((part) => part && part.trim() !== '')
          .join(', '),
        recipientName: a.recipient,
      };
    }
    // Free text is still accepted, but it has to carry the two fields a carrier
    // needs. Guessing a country from a formatted string is how you end up
    // quoting a domestic rate for a parcel to Japan.
    if (!input.destinationAddress?.trim()) throw AppError.validation('A destination is required');
    if (!input.country?.trim() || !input.postalCode?.trim()) {
      throw AppError.validation('A destination country and postal code are required to quote a rate');
    }
    return {
      destination: { country: input.country.trim().toUpperCase(), postalCode: input.postalCode.trim() },
      formatted: input.destinationAddress.trim(),
      recipientName: null,
    };
  }

  /**
   * The customs declaration, one line per item.
   *
   * The total the collector declared is APPORTIONED across the items by weight
   * when they have not given per-item figures, which is the honest thing to do:
   * a single lump sum on a five-item parcel is not a declaration a broker can
   * use, and inventing per-item values out of nothing would be worse. Where the
   * collector does give per-item values, those are used verbatim.
   */
  buildCustomsLines(
    measurements: ItemMeasurements,
    declaredValueMinor: number,
    perItemValues?: Record<string, number>,
  ): CustomsLine[] {
    const total = measurements.totalWeightGrams || measurements.perItem.length || 1;
    let apportioned = 0;

    return measurements.perItem.map((m, index) => {
      const explicit = perItemValues?.[m.itemId];
      let valueMinor: number;
      if (typeof explicit === 'number' && explicit >= 0) {
        valueMinor = explicit;
      } else if (index === measurements.perItem.length - 1) {
        // The last line absorbs the rounding, so the invoice total always equals
        // the figure the collector declared rather than being a cent or two short.
        valueMinor = Math.max(0, declaredValueMinor - apportioned);
      } else {
        valueMinor = Math.round((declaredValueMinor * m.weightGrams) / total);
        apportioned += valueMinor;
      }
      return {
        itemId: m.itemId,
        serialNumber: m.serialNumber,
        description: m.description,
        valueMinor,
        hsCode: DEFAULT_HS_CODE,
        countryOfOrigin: DEFAULT_COUNTRY_OF_ORIGIN,
        weightGrams: m.weightGrams,
        weightEstimated: m.estimated,
      };
    });
  }

  /** Assemble the profile the carrier catalogue reasons about. */
  toProfile(args: {
    destination: Destination;
    measurements: ItemMeasurements;
    itemCount: number;
    declaredValueMinor: number;
    insuredValueMinor: number;
    signatureRequired: boolean;
    originFacilityCode?: string | null;
    /** The box the collector chose, if they chose one. */
    box?: ShippingBox;
  }): ParcelProfile {
    return {
      destination: args.destination,
      weightGrams: args.measurements.totalWeightGrams,
      dimensionsCm: args.box?.dimensionsCm,
      packagingGrams: args.box?.tareGrams,
      itemCount: args.itemCount,
      // A domestic parcel has no customs value at all, whatever was typed.
      customsValueMinor: needsCustoms(args.destination.country) ? args.declaredValueMinor : 0,
      insuredValueMinor: args.insuredValueMinor,
      signatureRequired: args.signatureRequired,
      originFacilityCode: args.originFacilityCode ?? null,
    };
  }
}
