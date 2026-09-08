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

/**
 * The commercial invoice.
 *
 * A parcel crossing a border without one is a parcel sitting in a bonded
 * warehouse while somebody emails about it, and Bault produced no customs
 * paperwork of any kind — no declared value, no description, no HS code, no
 * country of origin, no shipper details.
 *
 * Two things about this are deliberate and worth stating, because they are
 * policy rather than formatting.
 *
 * **The declared value is the collector's.** It is carried through from what
 * they entered, per item, and is never adjusted. Under-declaring to reduce
 * somebody's duty is customs fraud committed in their name, and a platform that
 * quietly rounds a $3,000 slab down to $50 has made its customer the one who
 * signed for it.
 *
 * **It is generated, not stored.** The invoice is a VIEW of the shipment's
 * frozen customs lines. Storing a rendered document would create a second
 * version of the truth that could drift from the shipment it describes.
 */
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

    // Shipped from wherever the goods are stored — the primary facility. The
    // shipper of record is Bault, acting for the collector, which is why both
    // appear on the document.
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
      /** Collectible trading cards — printed matter, other. */
      defaultHsCode: DEFAULT_HS_CODE,
      lines,
      totals: {
        lineCount: lines.length,
        valueMinor: totalValueMinor,
        weightGrams: totalWeightGrams,
        currency: s.currency,
      },
      /**
       * Printed on the document because it is the answer to the question every
       * collector asks, and the answer is always the same one.
       */
      declaration:
        'The values stated are those declared by the owner of the goods. Bault does not adjust, reduce or omit a declared value for any reason.',
      /** Whoever receives it owes any duty and tax the destination levies. */
      dutyNote:
        'Import duty, VAT and any brokerage the destination country charges are payable by the recipient on arrival.',
    };
  }

  /** Whether this shipment needs paperwork at all — used to show the tab or not. */
  async required(shipmentId: string, actor: ShipmentActor) {
    const s = await this.shipments.loadFor(shipmentId, actor);
    return {
      required: needsCustoms(s.destinationCountry),
      hasLines: ((s.customsLines as CustomsLine[]) ?? []).length > 0,
      declaredValueMinor: s.declaredValueMinor,
    };
  }

  /** Staff-facing: every shipment whose paperwork is not complete. */
  async outstanding() {
    const rows = await this.db.select().from(shipment).where(eq(shipment.status, 'rates_selected'));
    return rows
      .filter((s) => needsCustoms(s.destinationCountry))
      .filter((s) => ((s.customsLines as CustomsLine[]) ?? []).length === 0)
      .map((s) => ({ id: s.id, code: s.code, country: s.destinationCountry }));
  }

  /**
   * Everything a collector needs to know BEFORE the parcel leaves, in one call.
   *
   * The invoice above answers "what did you declare". This answers the question
   * that comes first and had nowhere to be asked: "am I about to send this
   * somewhere it will get stuck, and what will it cost the person receiving it".
   *
   * Three things it deliberately does and does not do.
   *
   * It REPORTS rather than blocks. A missing declared value or an estimated
   * weight is surfaced as a warning the collector can act on, not an error that
   * refuses the shipment — Bault is not in a position to know that an estimate
   * is wrong, only that it is an estimate, and refusing on that basis would
   * ground parcels nobody had a problem with.
   *
   * It never states a duty figure. Thresholds and rates are set by the
   * destination and change; the guidance carries the authority's own link so the
   * collector reads the current number from the body that sets it. See
   * `destinations.ts`.
   *
   * It names what Bault does NOT do at the destination. A collector planning
   * around a clearance step Bault does not perform is exactly who this exists
   * for, and telling them afterwards is telling them too late.
   */
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
      /** Nothing here refuses the shipment; every entry is actionable advice. */
      ready: warnings.length === 0,
      warnings,
      declaredTotalMinor: lines.reduce((sum, l) => sum + l.valueMinor, 0),
      currency: s.currency,
      lineCount: lines.length,
      /** Universal notes always; the destination's own only where one is written. */
      guidance: international
        ? destinationGuidance(s.destinationCountry)
        : { universal: [], specific: null },
    };
  }

}
