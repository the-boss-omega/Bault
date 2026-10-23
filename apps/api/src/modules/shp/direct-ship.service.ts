import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { LedgerService, DEFAULT_CURRENCY } from '../pay/ledger.service';
import { WalletService } from '../pay/wallet.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { charge } from '../pay/pay.schema';
import { parcel, parcelEvent } from '../inv/parcel.schema';
import { facility } from '../inv/facility.schema';
import { newShipmentCode } from '../../shared/ids';
import { shipment } from './shp.schema';
import { ParcelProfileService } from './parcel-profile.service';
import { carrierService, DIRECT_OVERNIGHT_FACILITY, DIRECT_OVERNIGHT_KEY, DOMESTIC_COUNTRY } from './carriers';
import { insurancePremiumMinor, signatureForced, MAX_INSURED_VALUE_MINOR } from './shipping-options';
import { formatMinor } from '../../shared/money';

@Injectable()
export class DirectShipService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
    private readonly profiles: ParcelProfileService,
    private readonly outbox: OutboxService,
  ) {}

  terms() {
    const service = carrierService(DIRECT_OVERNIGHT_KEY);
    return {
      available: Boolean(service),
      facilityCode: DIRECT_OVERNIGHT_FACILITY,
      flatCostMinor: service?.flatCostMinor ?? 0,
      maxItems: service?.maxItems ?? 0,
      country: DOMESTIC_COUNTRY,
      transitDays: service?.transitDaysMax ?? 1,
      maxInsuredValueMinor: MAX_INSURED_VALUE_MINOR,
    };
  }

  async eligibility(userId: string, parcelId: string) {
    const { row, site } = await this.loadParcel(userId, parcelId);
    const reasons: string[] = [];

    if (row.status !== 'received') {
      reasons.push(
        row.status === 'expected'
          ? 'It has not arrived yet.'
          : `It is already ${row.status} — direct shipping only works before it is opened.`,
      );
    }
    if (row.forwardedAt) reasons.push('It has already been forwarded to the vault.');
    if (site?.code !== DIRECT_OVERNIGHT_FACILITY) {
      reasons.push(`It is at ${site?.name ?? 'another site'}, not the ${DIRECT_OVERNIGHT_FACILITY} facility.`);
    }
    return { eligible: reasons.length === 0, reasons, ...this.terms() };
  }

  private async loadParcel(userId: string, parcelId: string) {
    const [row] = await this.db.select().from(parcel).where(eq(parcel.id, parcelId)).limit(1);
    if (!row) throw AppError.notFound('Parcel not found');
    if (row.ownerId !== userId) throw AppError.notFound('Parcel not found');
    const [site] = await this.db.select().from(facility).where(eq(facility.id, row.facilityId)).limit(1);
    return { row, site };
  }

  async request(
    userId: string,
    parcelId: string,
    input: {
      addressId?: string;
      destinationAddress?: string;
      destinationCountry?: string;
      destinationPostalCode?: string;
      recipientName?: string;
      cardCount: number;
      insuredValueMinor?: number;
      customerNotes?: string;
    },
  ) {
    await this.wallet.assertNotBlocked(userId);

    const service = carrierService(DIRECT_OVERNIGHT_KEY);
    if (!service) throw AppError.validation('Direct overnight is not configured');

    const { eligible, reasons } = await this.eligibility(userId, parcelId);
    if (!eligible) throw new AppError(ErrorCode.CONFLICT, reasons[0]!, 409);

    if (!Number.isInteger(input.cardCount) || input.cardCount < 1) {
      throw AppError.validation('Say how many items are in it');
    }
    if (service.maxItems !== undefined && input.cardCount > service.maxItems) {
      throw AppError.validation(
        `Direct overnight carries at most ${service.maxItems} cards. Let this one forward to the vault instead.`,
      );
    }

    const { destination, formatted, recipientName } = await this.profiles.resolveDestination(userId, {
      addressId: input.addressId,
      destinationAddress: input.destinationAddress,
      country: input.destinationCountry,
      postalCode: input.destinationPostalCode,
    });
    if (destination.country !== DOMESTIC_COUNTRY) {
      throw AppError.validation('Direct overnight is domestic only.');
    }

    const insuredValueMinor = Math.min(Math.max(0, input.insuredValueMinor ?? 0), MAX_INSURED_VALUE_MINOR);
    const premium = insurancePremiumMinor(insuredValueMinor);
    const total = service.flatCostMinor! + premium;

    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(parcel).where(eq(parcel.id, parcelId)).for('update').limit(1);
      if (!locked || locked.ownerId !== userId) throw AppError.notFound('Parcel not found');
      if (locked.status !== 'received' || locked.forwardedAt) {
        throw new AppError(ErrorCode.CONFLICT, `It is already ${locked.status} — direct shipping only works before it is opened.`, 409);
      }
      const balance = await this.ledger.balanceOf(userId, tx);
      if (balance.amount < total) {
        throw new AppError(
          ErrorCode.CONFLICT,
          `Direct overnight is ${formatMinor(total)} and your balance is ${formatMinor(balance.amount)}. Top up first — this one cannot wait, the parcel is sitting at the dock.`,
          409,
        );
      }

      const [created] = await tx
        .insert(shipment)
        .values({
          code: newShipmentCode(),
          userId,
          itemIds: [],
          destinationAddress: formatted,
          recipientName: input.recipientName?.trim() || recipientName,
          destinationCountry: destination.country,
          destinationPostalCode: destination.postalCode,
          destinationDetail: destination,
          carrier: service.carrier,
          serviceLevel: service.serviceLevel,
          serviceKey: service.key,
          serviceMode: 'personalised',
          rushFlag: true,
          insuredValueMinor,
          insurancePremiumMinor: premium,
          signatureRequired: signatureForced(insuredValueMinor),
          customerNotes:
            [input.customerNotes?.trim(), `Direct from ${DIRECT_OVERNIGHT_FACILITY}, ${input.cardCount} card(s)`]
              .filter(Boolean)
              .join(' · '),
          cost: total,
          currency: DEFAULT_CURRENCY,
          status: 'rates_selected',
          estimatedDeliveryAt: new Date(now.getTime() + service.transitDaysMax * 86_400_000),
        })
        .returning();
      if (!created) throw AppError.validation('Failed to create the shipment');

      const [c] = await tx
        .insert(charge)
        .values({
          userId,
          actionType: 'shipping',
          pricingRuleSnapshot: {
            service: service.key,
            flat: service.flatCostMinor,
            insurancePremium: premium,
            fromFacility: DIRECT_OVERNIGHT_FACILITY,
            cardCount: input.cardCount,
          },
          amount: total,
          currency: DEFAULT_CURRENCY,
          paymentMeans: 'wallet',
          status: 'settled',
          referenceId: created.id,
        })
        .returning({ id: charge.id });
      if (!c) throw AppError.validation('Failed to charge for the shipment');

      await this.ledger.record(
        {
          userId,
          type: 'service_charge',
          amount: total,
          direction: 'debit',
          currency: DEFAULT_CURRENCY,
          referenceType: 'charge',
          referenceId: c.id,
        },
        tx,
      );

      await tx
        .update(parcel)
        .set({ status: 'processed', processedAt: now, updatedAt: now })
        .where(eq(parcel.id, parcelId));

      await tx.insert(parcelEvent).values({
        parcelId,
        eventType: 'direct_shipped',
        fromStatus: 'received',
        toStatus: 'processed',
        actorId: userId,
        notes: `Shipped direct from ${DIRECT_OVERNIGHT_FACILITY} without entering the vault`,
        metadata: { shipmentId: created.id, shipmentCode: created.code, cardCount: input.cardCount },
      });

      await this.outbox.emit(tx, {
        aggregateType: 'shipment',
        aggregateId: created.id,
        eventType: 'direct_ship_booked',
        payload: {
          userId,
          shipmentCode: created.code,
          facility: DIRECT_OVERNIGHT_FACILITY,
          costMinor: total,
        },
      });

      return {
        shipmentId: created.id,
        shipmentCode: created.code,
        costMinor: total,
        estimatedDeliveryAt: created.estimatedDeliveryAt,
      };
    });
  }
}
