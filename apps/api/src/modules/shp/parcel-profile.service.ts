import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { item } from '../cst/cst.schema';
import { shippingAddress } from '../acc/address.schema';
import { itemWeightGrams } from '../inv/item-classes';
import type { CustomsDeclaration } from '@bault/adapters';
import {
  CUSTOMS_CONTENTS_TYPE,
  CUSTOMS_NON_DELIVERY,
  DEFAULT_COUNTRY_OF_ORIGIN,
  DEFAULT_HS_CODE,
  needsCustoms,
} from './shipping-options';
import type { Destination, ParcelProfile } from './carriers';
import { checkBox, chooseBox, shippingBox, type BoxProblem, type ShippingBox } from './boxes';

export interface CustomsLine {
  itemId: string;
  serialNumber: string;
  description: string;
  valueMinor: number;
  hsCode: string;
  countryOfOrigin: string;
  weightGrams: number;
  weightEstimated: boolean;
}

export function customsDeclarationFor(lines: readonly CustomsLine[], signer: string, currency = 'USD'): CustomsDeclaration {
  return {
    contentsType: CUSTOMS_CONTENTS_TYPE,
    signer,
    nonDelivery: CUSTOMS_NON_DELIVERY,
    currency,
    lines: lines.map((l) => ({
      description: l.description,
      quantity: 1,
      valueMinor: l.valueMinor,
      weightGrams: l.weightGrams,
      hsCode: l.hsCode,
      originCountry: l.countryOfOrigin,
    })),
  };
}

export interface ItemMeasurements {
  totalWeightGrams: number;
  anyEstimated: boolean;
  perItem: { itemId: string; serialNumber: string; description: string; weightGrams: number; estimated: boolean }[];
}

@Injectable()
export class ParcelProfileService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async loadShippableItems(userId: string, itemIds: string[], tx?: Database) {
    const ids = [...new Set(itemIds.filter(Boolean))];
    if (ids.length === 0) throw AppError.validation('Choose at least one item');

    const rows = tx
      ? await tx.select().from(item).where(inArray(item.id, ids)).orderBy(item.id).for('update')
      : await this.db.select().from(item).where(inArray(item.id, ids));
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

    return { box: chooseBox(contents), problems: [], boxAutoSelected: true };
  }

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
        destination: {
          country: a.country.toUpperCase(),
          postalCode: a.postalCode,
          name: a.recipient,
          street1: a.line1,
          city: a.city,
        },
        formatted: `${a.recipient}, ${a.line1}, ${a.city}, ${a.postalCode}, ${a.country}`,
        recipientName: a.recipient,
      };
    }
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

  toProfile(args: {
    destination: Destination;
    measurements: ItemMeasurements;
    itemCount: number;
    declaredValueMinor: number;
    insuredValueMinor: number;
    signatureRequired: boolean;
    originFacilityCode?: string | null;
    box?: ShippingBox;
  }): ParcelProfile {
    return {
      destination: args.destination,
      weightGrams: args.measurements.totalWeightGrams,
      dimensionsCm: args.box?.dimensionsCm,
      packagingGrams: args.box?.tareGrams,
      itemCount: args.itemCount,
      customsValueMinor: needsCustoms(args.destination.country) ? args.declaredValueMinor : 0,
      insuredValueMinor: args.insuredValueMinor,
      signatureRequired: args.signatureRequired,
      originFacilityCode: args.originFacilityCode ?? null,
    };
  }
}
