import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { fullName, isValidNamePart, normalizeNamePart } from '../../shared/names';
import { userAccount } from './acc.schema';
import { shippingAddress } from './address.schema';
import { toCountryCode } from '../shp/countries';
import { normalizeRegion } from '../shp/regions';
import { MfaService } from './mfa/mfa.service';

export interface ProfileView {
  id: string;
  email: string;
  pendingEmail: string | null;
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
  mfaMethod: 'totp' | 'email' | null;
  mfaRequired: boolean;
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

export const ADDRESS_LINE2_MAX = 100;

const PHONE = /^(?=(?:.*\d){6})[0-9+\- ]{6,20}$/;

// eslint-disable-next-line no-control-regex -- control characters are exactly what this rejects
const MARKUP_OR_CONTROL = /[<>\u0000-\u001f\u007f]/;

const ADDRESS_TEXT = {
  label: { name: 'label', max: 60 },
  recipient: { name: 'recipient', max: 120 },
  line1: { name: 'street address', max: 120 },
  city: { name: 'city', max: 80 },
  postalCode: { name: 'postal code', max: 16 },
} as const;

type AddressTextField = keyof typeof ADDRESS_TEXT;

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
    const mfaMethod = await this.mfa.enabledMethod(u.id);
    return {
      id: u.id,
      email: u.email,
      pendingEmail: u.pendingEmail,
      username: u.username,
      role: u.role,
      status: u.status,
      firstName: u.firstName,
      lastName: u.lastName,
      fullName: fullName(u.firstName, u.lastName),
      nameReviewRequired: u.nameReviewRequired,
      termsVersion: u.termsVersion,
      termsAcceptedAt: u.termsAcceptedAt,
      mfaEnabled: mfaMethod !== null,
      mfaMethod,
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

  async listAddresses(userId: string) {
    const rows = await this.db
      .select()
      .from(shippingAddress)
      .where(eq(shippingAddress.userId, userId))
      .orderBy(sql`${shippingAddress.createdAt} desc`);
    return rows.map(addressView);
  }

  async addAddress(userId: string, dto: AddressInput) {
    const country = toCountryCode(dto.country) ?? dto.country;
    const region = regionFor(country, dto.region);
    return this.db.transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.update(shippingAddress).set({ isDefault: false }).where(eq(shippingAddress.userId, userId));
      }
      const [row] = await tx
        .insert(shippingAddress)
        .values({
          userId,
          label: addressText('label', dto.label),
          recipient: addressText('recipient', dto.recipient),
          line1: addressText('line1', dto.line1),
          line2: line2Of(dto.line2),
          city: addressText('city', dto.city),
          region,
          country,
          postalCode: addressText('postalCode', dto.postalCode),
          phone: phoneOf(dto.phone),
          isDefault: dto.isDefault ?? false,
        })
        .returning();
      if (!row) throw AppError.validation('Failed to add address');
      return addressView(row);
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
      for (const f of ['label', 'recipient', 'line1', 'city', 'postalCode'] as const) {
        if (patch[f] === undefined) continue;
        set[f] = addressText(f, patch[f]);
      }
      if (patch.country !== undefined) set.country = toCountryCode(patch.country) ?? patch.country;
      if (patch.country !== undefined || patch.region !== undefined) {
        const country = (set.country as string | undefined) ?? existing.country;
        set.region = regionFor(country, patch.region !== undefined ? patch.region : existing.region);
      }
      if (patch.line2 !== undefined) set.line2 = line2Of(patch.line2);
      if (patch.phone !== undefined) set.phone = phoneOf(patch.phone);
      if (patch.isDefault !== undefined) set.isDefault = patch.isDefault;
      if (Object.keys(set).length === 0) throw AppError.validation('Nothing to update');

      if (patch.isDefault) {
        await tx.update(shippingAddress).set({ isDefault: false }).where(eq(shippingAddress.userId, userId));
      }
      await tx.update(shippingAddress).set(set as never).where(eq(shippingAddress.id, id));
      const [row] = await tx.select().from(shippingAddress).where(eq(shippingAddress.id, id)).limit(1);
      if (!row) throw AppError.notFound('Address not found');
      return addressView(row);
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

function addressView(row: typeof shippingAddress.$inferSelect) {
  return {
    id: row.id,
    label: row.label,
    recipient: row.recipient,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    region: row.region,
    country: row.country,
    postalCode: row.postalCode,
    phone: row.phone,
    isDefault: row.isDefault,
  };
}

function regionFor(country: string, value: string | null | undefined): string | null {
  const result = normalizeRegion(country, value);
  if ('problem' in result) throw AppError.validation(result.problem);
  return result.region;
}

function addressText(field: AddressTextField, value: string): string {
  const { name, max } = ADDRESS_TEXT[field];
  const text = value.trim().replace(/\s+/g, ' ');
  if (text === '') throw AppError.validation(`The ${name} is required.`);
  if (text.length > max) throw AppError.validation(`The ${name} can be at most ${max} characters.`);
  if (MARKUP_OR_CONTROL.test(value.trim())) {
    throw AppError.validation(`The ${name} cannot contain < or > or control characters.`);
  }
  return text;
}

function line2Of(value: string | null | undefined): string | null {
  const line = (value ?? '').trim();
  if (line.length > ADDRESS_LINE2_MAX) {
    throw AppError.validation(`The apartment, suite or unit line is at most ${ADDRESS_LINE2_MAX} characters`);
  }
  if (MARKUP_OR_CONTROL.test(line)) {
    throw AppError.validation('The apartment, suite or unit line cannot contain < or > or control characters.');
  }
  return line || null;
}

function phoneOf(value: string | null | undefined): string | null {
  const phone = (value ?? '').trim();
  if (!phone) return null;
  if (!PHONE.test(phone)) {
    throw AppError.validation('A phone number is 6 to 20 characters of digits, spaces, plus and dashes');
  }
  return phone;
}
