import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { userAccount } from '../acc/acc.schema';
import { facility } from '../inv/facility.schema';
import { fullName } from '../../shared/names';
import { shipment } from './shp.schema';
import { ShipmentService, type ShipmentActor } from './shipment.service';
import { DEFAULT_HS_CODE, needsCustoms } from './shipping-options';
import { destinationGuidance } from './destinations';
import type { CustomsLine } from './parcel-profile.service';

@Injectable()
export class CustomsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly shipments: ShipmentService,
  ) {}

  async invoice(shipmentId: string, actor: ShipmentActor) {
    const s = await this.shipments.loadFor(shipmentId, actor);
    if (!needsCustoms(s.destinationCountry)) {
      throw AppError.validation('A domestic parcel needs no customs declaration.');
    }

    const lines = ((s.customsLines as CustomsLine[]) ?? []).slice();
    if (lines.length === 0) {
      throw AppError.validation('This shipment has no customs lines. Re-enter its declared value.');
    }

    const [owner] = await this.db
      .select({
        username: userAccount.username,
        firstName: userAccount.firstName,
        lastName: userAccount.lastName,
        email: userAccount.email,
      })
      .from(userAccount)
      .where(eq(userAccount.id, s.userId))
      .limit(1);

    const [origin] = await this.db
      .select()
      .from(facility)
      .where(eq(facility.role, 'primary'))
      .limit(1);

    const totalValueMinor = lines.reduce((sum, l) => sum + l.valueMinor, 0);
    const totalWeightGrams = lines.reduce((sum, l) => sum + l.weightGrams, 0);

    return {
      shipmentCode: s.code,
      issuedFor: {
        username: owner?.username ?? null,
        name: fullName(owner?.firstName, owner?.lastName) || null,
      },
      shipper: origin
        ? {
            name: origin.name,
            line1: origin.line1,
            line2: origin.line2,
            city: origin.city,
            region: origin.region,
            postalCode: origin.postalCode,
            country: origin.country,
          }
        : null,
      consignee: {
        name: s.recipientName,
        address: s.destinationAddress,
        country: s.destinationCountry,
        postalCode: s.destinationPostalCode,
      },
      carrier: s.carrier,
      serviceLevel: s.serviceLevel,
      trackingNumber: s.trackingNumber,
      defaultHsCode: DEFAULT_HS_CODE,
      lines,
      totals: {
        lineCount: lines.length,
        valueMinor: totalValueMinor,
        weightGrams: totalWeightGrams,
        currency: s.currency,
      },
      declaration:
        'The values stated are those declared by the owner of the goods. Bault does not adjust, reduce or omit a declared value for any reason.',
      dutyNote:
        'Import duty, VAT and any brokerage the destination country charges are payable by the recipient on arrival.',
    };
  }

  async required(shipmentId: string, actor: ShipmentActor) {
    const s = await this.shipments.loadFor(shipmentId, actor);
    return {
      required: needsCustoms(s.destinationCountry),
      hasLines: ((s.customsLines as CustomsLine[]) ?? []).length > 0,
      declaredValueMinor: s.declaredValueMinor,
    };
  }

  async outstanding() {
    const rows = await this.db.select().from(shipment).where(eq(shipment.status, 'rates_selected'));
    return rows
      .filter((s) => needsCustoms(s.destinationCountry))
      .filter((s) => ((s.customsLines as CustomsLine[]) ?? []).length === 0)
      .map((s) => ({ id: s.id, code: s.code, country: s.destinationCountry }));
  }

  async readiness(shipmentId: string, actor: ShipmentActor) {
    const s = await this.shipments.loadFor(shipmentId, actor);
    const international = needsCustoms(s.destinationCountry);
    const lines = ((s.customsLines as CustomsLine[]) ?? []).slice();

    const warnings: { code: string; message: string }[] = [];

    if (international && lines.length === 0) {
      warnings.push({
        code: 'no_customs_lines',
        message:
          'This parcel is crossing a border and has no declared values on it. Re-enter the shipment’s declared value before it is dispatched.',
      });
    }

    const unvalued = lines.filter((l) => !(l.valueMinor > 0));
    if (unvalued.length > 0) {
      warnings.push({
        code: 'unvalued_items',
        message: `${unvalued.length} item(s) carry no declared value. Customs treats a zero-value line as an unanswered question, which is what holds a parcel.`,
      });
    }

    const estimated = lines.filter((l) => l.weightEstimated);
    if (estimated.length > 0) {
      warnings.push({
        code: 'estimated_weight',
        message: `${estimated.length} item(s) were never weighed, so the invoice uses the class’s typical weight. It is marked as an estimate rather than presented as measured.`,
      });
    }

    return {
      shipmentCode: s.code,
      destinationCountry: s.destinationCountry,
      international,
      ready: warnings.length === 0,
      warnings,
      declaredTotalMinor: lines.reduce((sum, l) => sum + l.valueMinor, 0),
      currency: s.currency,
      lineCount: lines.length,
      guidance: international
        ? destinationGuidance(s.destinationCountry)
        : { universal: [], specific: null },
    };
  }

}
