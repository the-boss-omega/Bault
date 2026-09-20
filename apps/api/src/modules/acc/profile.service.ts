import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { fullName, isValidNamePart, normalizeNamePart } from '../../shared/names';
import { userAccount } from './acc.schema';
import { shippingAddress } from './address.schema';
import { toCountryCode } from '../shp/countries';

/**
 * What a user sees about themselves.
 *
 * `intakeId` is deliberately ABSENT. The OW- code is retired from every
 * user-facing workflow: nothing asks a customer to quote one, so returning it
 * here would only invite its reuse. It still exists on the row, and admins can
 * still read it through `GET /admin/users` for troubleshooting a pre-printed
 * label — that is the one surface it survives on.
 */
export interface ProfileView {
  id: string;
  email: string; // a user always sees their OWN email (PII rule guards OTHER users' data)
  username: string; // immutable, read-only (Requirement 4.1)
  role: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
  /** Derived from the two parts above with `fullName()` — never stored. */
  fullName: string;
  /** True while the legacy-name migration's split is still unconfirmed. */
  nameReviewRequired: boolean;
}

export interface AddressInput {
  label: string;
  recipient: string;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  country: string;
  postalCode: string;
  phone?: string | null;
  isDefault?: boolean;
}

/** Every address field is individually editable (Requirement 4.2). */
export type AddressPatch = Partial<AddressInput>;

/**
 * Own-profile read/update (T033) + saved shipping addresses (ACC-07). Returns the
 * caller's own record — including their own PII, which is legitimate. Cross-user
 * PII exposure is what the PII interceptor guards for non-admins (Principle IX).
 * Address access is strictly own-only: every query filters by the caller's id.
 */
/** An optional field left blank is absent, not an empty string on the label. */
function blankToNull(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

@Injectable()
export class ProfileService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async get(userId: string): Promise<ProfileView> {
    const [u] = await this.db
      .select()
      .from(userAccount)
      .where(eq(userAccount.id, userId))
      .limit(1);
    if (!u) throw AppError.notFound('Profile not found');
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      role: u.role,
      status: u.status,
      firstName: u.firstName,
      lastName: u.lastName,
      fullName: fullName(u.firstName, u.lastName),
      nameReviewRequired: u.nameReviewRequired,
    };
  }

  /**
   * Only the two name parts are writable. `username` is never in the SET clause —
   * there is no code path anywhere that updates it after registration (Req 4.1) —
   * and there is no separate display name that could drift out of step with these.
   *
   * A name the owner has just confirmed clears `nameReviewRequired`, which is the
   * only way the flag set by the legacy-name migration (0004) is ever cleared by
   * the person it describes.
   */
  async update(userId: string, patch: { firstName: string; lastName: string }): Promise<ProfileView> {
    const first = normalizeNamePart(patch.firstName);
    const last = normalizeNamePart(patch.lastName);
    if (!isValidNamePart(first) || !isValidNamePart(last)) {
      throw AppError.validation('First name and last name are both required');
    }
    await this.db
      .update(userAccount)
      .set({ firstName: first, lastName: last, nameReviewRequired: false })
      .where(eq(userAccount.id, userId));
    return this.get(userId);
  }

  // ---------------------------------------------------------------------------
  // Shipping addresses (ACC-07) — own-only.
  // ---------------------------------------------------------------------------

  listAddresses(userId: string) {
    return this.db
      .select()
      .from(shippingAddress)
      .where(eq(shippingAddress.userId, userId))
      .orderBy(sql`${shippingAddress.createdAt} desc`);
  }

  async addAddress(userId: string, dto: AddressInput) {
    return this.db.transaction(async (tx) => {
      // A new default demotes any existing default (single default per user).
      if (dto.isDefault) {
        await tx.update(shippingAddress).set({ isDefault: false }).where(eq(shippingAddress.userId, userId));
      }
      const [row] = await tx
        .insert(shippingAddress)
        .values({
          userId,
          label: dto.label,
          recipient: dto.recipient,
          line1: dto.line1,
          line2: blankToNull(dto.line2),
          city: dto.city,
          region: blankToNull(dto.region),
          phone: blankToNull(dto.phone),
          // Stored as the code the carrier rules read, whatever shape it arrived
          // in — the validator has already established it resolves to one.
          country: toCountryCode(dto.country) ?? dto.country,
          postalCode: dto.postalCode,
          isDefault: dto.isDefault ?? false,
        })
        .returning();
      if (!row) throw AppError.validation('Failed to add address');
      return row;
    });
  }

  /**
   * Edit a saved address (Requirement 4.2). Own-only; promoting an address to the
   * default demotes the previous one so exactly one default survives.
   */
  async updateAddress(userId: string, id: string, patch: AddressPatch) {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(shippingAddress)
        .where(and(eq(shippingAddress.id, id), eq(shippingAddress.userId, userId)))
        .limit(1);
      if (!existing) throw AppError.notFound('Address not found');

      const set: Record<string, unknown> = {};
      for (const f of ['label', 'recipient', 'line1', 'city', 'country', 'postalCode'] as const) {
        if (patch[f] === undefined) continue;
        set[f] = f === 'country' ? (toCountryCode(patch[f]!) ?? patch[f]) : patch[f];
      }
      for (const f of ['line2', 'region', 'phone'] as const) {
        if (patch[f] !== undefined) set[f] = blankToNull(patch[f]);
      }
      if (patch.isDefault !== undefined) set.isDefault = patch.isDefault;
      if (Object.keys(set).length === 0) throw AppError.validation('Nothing to update');

      if (patch.isDefault) {
        await tx.update(shippingAddress).set({ isDefault: false }).where(eq(shippingAddress.userId, userId));
      }
      await tx.update(shippingAddress).set(set as never).where(eq(shippingAddress.id, id));
      const [row] = await tx.select().from(shippingAddress).where(eq(shippingAddress.id, id)).limit(1);
      if (!row) throw AppError.notFound('Address not found');
      return row;
    });
  }

  /** Delete an address; only the owner may delete it. */
  async deleteAddress(userId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(shippingAddress)
      .where(and(eq(shippingAddress.id, id), eq(shippingAddress.userId, userId)))
      .limit(1);
    if (!row) throw AppError.notFound('Address not found');
    await this.db.delete(shippingAddress).where(eq(shippingAddress.id, id));
    return { deleted: true };
  }
}
