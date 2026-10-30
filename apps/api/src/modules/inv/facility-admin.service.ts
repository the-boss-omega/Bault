import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { pgErrorCode } from '../../shared/errors/pg-error';
import { regionRequired } from '../shp/regions';
import { toCountryCode } from '../shp/countries';
import { isPlaceholderAddress } from './facility-address';
import { facility } from './facility.schema';

type FacilityRow = typeof facility.$inferSelect;

/** A facility as the administrator sees it: the row, where it forwards to by code, and whether its address is still the seed's. */
export interface AdminFacility {
  id: string;
  code: string;
  name: string;
  role: 'primary' | 'forwarding';
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string | null;
  salesTaxBps: number;
  forwardsToFacilityId: string | null;
  forwardsToCode: string | null;
  forwardingDays: number | null;
  active: boolean;
  placeholder: boolean;
}

export interface NewFacility {
  code: string;
  name: string;
  role: 'primary' | 'forwarding';
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postalCode: string;
  country: string;
  phone?: string | null;
  salesTaxBps?: number;
  forwardsToFacilityId?: string | null;
  forwardingDays?: number | null;
  active?: boolean;
}

/** What may change once a facility exists. Its code and its role are what parcels, shelves and forwarding legs were written against. */
export type FacilityChanges = Partial<Omit<NewFacility, 'code' | 'role'>>;

const text = (value: string | null | undefined) => (value ?? '').trim();
const optional = (value: string | null | undefined) => text(value) || null;

@Injectable()
export class FacilityAdminService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(): Promise<AdminFacility[]> {
    const rows = await this.db
      .select()
      .from(facility)
      .orderBy(asc(facility.role), asc(facility.code));
    return rows.map((row) => present(row, rows));
  }

  async create(input: NewFacility): Promise<AdminFacility> {
    const code = text(input.code).toUpperCase();
    const country = toCountryCode(input.country);
    if (!country) throw AppError.validation('Choose the facility’s country from the list.');
    const region = text(input.region);
    if (!region && regionRequired(country)) {
      throw AppError.validation('This country needs a state or region on its addresses.');
    }

    return this.db.transaction(async (tx) => {
      const all = await tx.select().from(facility).for('update');
      if (all.some((f) => f.code === code)) throw takenCode(code);

      const forwarding = input.role === 'forwarding';
      const target = forwarding ? primaryNamed(all, input.forwardsToFacilityId) : null;
      if (forwarding && input.forwardingDays == null) {
        throw AppError.validation(
          'Say how many business days a parcel takes to reach the primary facility.',
        );
      }
      if (input.active !== false && target && !target.active) {
        throw AppError.conflict(
          ErrorCode.CONFLICT,
          `${target.name} is not active, so a facility that forwards to it cannot be either.`,
        );
      }

      try {
        const [created] = await tx
          .insert(facility)
          .values({
            code,
            name: text(input.name),
            role: input.role,
            line1: text(input.line1),
            line2: optional(input.line2),
            city: text(input.city),
            region,
            postalCode: text(input.postalCode),
            country,
            phone: optional(input.phone),
            salesTaxBps: input.salesTaxBps ?? 0,
            forwardsToFacilityId: target?.id ?? null,
            forwardingDays: forwarding ? (input.forwardingDays ?? null) : null,
            active: input.active ?? true,
          })
          .returning();
        return present(created!, [...all, created!]);
      } catch (error) {
        if (pgErrorCode(error) === '23505') throw takenCode(code);
        throw error;
      }
    });
  }

  async update(id: string, changes: FacilityChanges): Promise<AdminFacility> {
    return this.db.transaction(async (tx) => {
      const all = await tx.select().from(facility).for('update');
      const current = all.find((f) => f.id === id);
      if (!current) throw AppError.notFound('Facility not found');

      const country =
        changes.country === undefined ? current.country : toCountryCode(changes.country);
      if (!country) throw AppError.validation('Choose the facility’s country from the list.');
      const region = changes.region === undefined ? current.region : text(changes.region);
      if (!region && regionRequired(country)) {
        throw AppError.validation('This country needs a state or region on its addresses.');
      }

      const forwarding = current.role === 'forwarding';
      const target = forwarding
        ? primaryNamed(
            all,
            changes.forwardsToFacilityId === undefined
              ? current.forwardsToFacilityId
              : changes.forwardsToFacilityId,
          )
        : null;
      const active = changes.active ?? current.active;

      if (active && target && !target.active) {
        throw AppError.conflict(
          ErrorCode.CONFLICT,
          `${target.name} is not active, so a facility that forwards to it cannot be either.`,
        );
      }
      if (current.active && !active) {
        const stillForwarding = all.filter(
          (f) => f.active && f.forwardsToFacilityId === current.id,
        );
        if (stillForwarding.length > 0) {
          throw AppError.conflict(
            ErrorCode.CONFLICT,
            `${stillForwarding.map((f) => f.name).join(', ')} still forwards to ${current.name}: switch that off, or point it elsewhere, first.`,
          );
        }
        const otherPrimary = all.some(
          (f) => f.id !== current.id && f.role === 'primary' && f.active,
        );
        if (current.role === 'primary' && !otherPrimary) {
          throw AppError.conflict(
            ErrorCode.CONFLICT,
            'This is the only active primary facility: customers would have nowhere to send a parcel. Add the new one first.',
          );
        }
      }

      const [updated] = await tx
        .update(facility)
        .set({
          ...(changes.name !== undefined ? { name: text(changes.name) } : {}),
          ...(changes.line1 !== undefined ? { line1: text(changes.line1) } : {}),
          ...(changes.line2 !== undefined ? { line2: optional(changes.line2) } : {}),
          ...(changes.city !== undefined ? { city: text(changes.city) } : {}),
          ...(changes.postalCode !== undefined ? { postalCode: text(changes.postalCode) } : {}),
          ...(changes.phone !== undefined ? { phone: optional(changes.phone) } : {}),
          ...(changes.salesTaxBps !== undefined ? { salesTaxBps: changes.salesTaxBps } : {}),
          ...(forwarding
            ? {
                forwardsToFacilityId: target?.id ?? null,
                ...(changes.forwardingDays !== undefined
                  ? { forwardingDays: changes.forwardingDays }
                  : {}),
              }
            : {}),
          country,
          region,
          active,
          updatedAt: new Date(),
        })
        .where(eq(facility.id, id))
        .returning();
      return present(
        updated!,
        all.map((f) => (f.id === id ? updated! : f)),
      );
    });
  }
}

function present(row: FacilityRow, all: readonly FacilityRow[]): AdminFacility {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    role: row.role,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    country: row.country,
    phone: row.phone,
    salesTaxBps: row.salesTaxBps,
    forwardsToFacilityId: row.forwardsToFacilityId,
    forwardsToCode: all.find((f) => f.id === row.forwardsToFacilityId)?.code ?? null,
    forwardingDays: row.forwardingDays,
    active: row.active,
    placeholder: isPlaceholderAddress(row.line1),
  };
}

/** The primary facility a forwarding one hands its parcels to: named, existing, and primary (a leg is not forwarded twice). */
function primaryNamed(all: readonly FacilityRow[], id: string | null | undefined): FacilityRow {
  if (!id)
    throw AppError.validation('Say which primary facility this one forwards its parcels to.');
  const target = all.find((f) => f.id === id);
  if (!target) throw AppError.validation('The facility it forwards to does not exist.');
  if (target.role !== 'primary') {
    throw AppError.validation(
      'A forwarding facility hands its parcels to a primary one, not to another forwarding facility.',
    );
  }
  return target;
}

function takenCode(code: string): AppError {
  return AppError.conflict(ErrorCode.CONFLICT, `A facility with the code ${code} already exists.`, {
    code,
  });
}
