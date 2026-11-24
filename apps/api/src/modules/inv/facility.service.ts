import { Inject, Injectable } from '@nestjs/common';
import { loadEnv } from '@bault/config';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { userAccount } from '../acc/acc.schema';
import { isPlaceholderAddress } from './facility-address';
import { facility } from './facility.schema';

export interface InboundAddress {
  code: string;
  name: string;
  role: 'primary' | 'forwarding';
  careOf: string;
  lines: string[];
  city: string;
  region: string;
  postalCode: string;
  country: string;
  salesTaxBps: number;
  forwardingDays: number | null;
  placeholder: boolean;
}

@Injectable()
export class FacilityService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  listActive() {
    return this.db
      .select()
      .from(facility)
      .where(eq(facility.active, true))
      .orderBy(asc(facility.role), asc(facility.code));
  }

  async byCode(code: string) {
    const [row] = await this.db.select().from(facility).where(eq(facility.code, code)).limit(1);
    if (!row) throw AppError.notFound(`No facility with code ${code}`);
    return row;
  }

  async byId(id: string) {
    const [row] = await this.db.select().from(facility).where(eq(facility.id, id)).limit(1);
    if (!row) throw AppError.notFound('Facility not found');
    return row;
  }

  async inboundAddressesFor(userId: string, opts: { staff?: boolean } = {}): Promise<InboundAddress[]> {
    const [account] = await this.db
      .select({ username: userAccount.username })
      .from(userAccount)
      .where(eq(userAccount.id, userId))
      .limit(1);
    if (!account) throw AppError.notFound('Account not found');

    const inProduction = loadEnv().NODE_ENV === 'production';
    const facilities = (await this.listActive()).filter(
      (f) => opts.staff || !inProduction || !isPlaceholderAddress(f.line1),
    );
    return facilities.map((f) => ({
      code: f.code,
      name: f.name,
      role: f.role,
      careOf: `Card Embassy C/O ${account.username}`,
      lines: [f.line1, f.line2].filter((l): l is string => Boolean(l && l.trim())),
      city: f.city,
      region: f.region,
      postalCode: f.postalCode,
      country: f.country,
      salesTaxBps: f.salesTaxBps,
      forwardingDays: f.forwardingDays,
      placeholder: isPlaceholderAddress(f.line1),
    }));
  }
}
