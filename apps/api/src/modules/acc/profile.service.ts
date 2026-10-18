import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { fullName, isValidNamePart, normalizeNamePart } from '../../shared/names';
import { userAccount } from './acc.schema';
import { shippingAddress } from './address.schema';
import { toCountryCode } from '../shp/countries';
import { MfaService } from './mfa/mfa.service';

export interface ProfileView {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  nameReviewRequired: boolean;
  termsVersion: string | null;
  termsAcceptedAt: Date | null;
  mfaEnabled: boolean;
  mfaRequired: boolean;
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

export type AddressPatch = Partial<AddressInput>;

@Injectable()
export class ProfileService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly mfa: MfaService,
  ) {}

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
      termsVersion: u.termsVersion,
      termsAcceptedAt: u.termsAcceptedAt,
      mfaEnabled: await this.mfa.isEnabled(u.id),
      mfaRequired: this.mfa.requiredFor(u.role),
    };
  }

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

  listAddresses(userId: string) {
    return this.db
      .select()
      .from(shippingAddress)
      .where(eq(shippingAddress.userId, userId))
      .orderBy(sql`${shippingAddress.createdAt} desc`);
  }

  async addAddress(userId: string, dto: AddressInput) {
    return this.db.transaction(async (tx) => {
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
          country: toCountryCode(dto.country) ?? dto.country,
          postalCode: dto.postalCode,
          isDefault: dto.isDefault ?? false,
        })
        .returning();
      if (!row) throw AppError.validation('Failed to add address');
      return row;
    });
  }

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
