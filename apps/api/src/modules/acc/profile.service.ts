import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { userAccount } from './acc.schema';
import { shippingAddress } from './address.schema';

export interface ProfileView {
  id: string;
  email: string; // a user always sees their OWN email (PII rule guards OTHER users' data)
  username: string; // immutable, read-only (Requirement 4.1)
  intakeId: string;
  role: string;
  status: string;
  displayName: string | null;
}

export interface AddressInput {
  label: string;
  recipient: string;
  line1: string;
  city: string;
  country: string;
  postalCode: string;
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
      intakeId: u.intakeId,
      role: u.role,
      status: u.status,
      displayName: u.displayName,
    };
  }

  /**
   * Only the display name is writable. `username` is never in the SET clause —
   * there is no code path anywhere that updates it after registration (Req 4.1).
   */
  async update(userId: string, patch: { displayName?: string }): Promise<ProfileView> {
    await this.db.update(userAccount).set({ displayName: patch.displayName }).where(eq(userAccount.id, userId));
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
          city: dto.city,
          country: dto.country,
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
        if (patch[f] !== undefined) set[f] = patch[f];
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
