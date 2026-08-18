import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { userAccount } from '../acc/acc.schema';
import { facility } from './facility.schema';

/**
 * One receiving address, written out for one collector.
 *
 * The `careOf` line is the whole mechanism by which a parcel finds an account:
 * the facility receives mail for thousands of people, and the username on the
 * label is the only thing distinguishing them. It is generated here rather than
 * stored, because it is a function of the account and the facility and must not
 * be able to disagree with either.
 */
export interface InboundAddress {
  facilityId: string;
  code: string;
  name: string;
  role: 'primary' | 'forwarding';
  /** The exact line a seller must put on the parcel. */
  careOf: string;
  lines: string[];
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string | null;
  /** Destination sales-tax rate in basis points; 0 means the state levies none. */
  salesTaxBps: number;
  /** For a forwarding address: how long the onward leg usually takes. */
  forwardingDays: number | null;
}

@Injectable()
export class FacilityService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  listActive() {
    return this.db
      .select()
      .from(facility)
      .where(eq(facility.active, true))
      // Primary first: it is the default answer for most purchases, and a list
      // that opens with the exception teaches the exception.
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

  /**
   * Every address this collector may ship to, addressed to them.
   *
   * The username is read from the account rather than taken from the caller, so
   * the `C/O` line can never name somebody else — this is the string a person
   * pastes into a checkout, and getting it wrong sends their property to a
   * stranger's shelf.
   */
  async inboundAddressesFor(userId: string): Promise<InboundAddress[]> {
    const [account] = await this.db
      .select({ username: userAccount.username })
      .from(userAccount)
      .where(eq(userAccount.id, userId))
      .limit(1);
    if (!account) throw AppError.notFound('Account not found');

    const facilities = await this.listActive();
    return facilities.map((f) => ({
      facilityId: f.id,
      code: f.code,
      name: f.name,
      role: f.role,
      careOf: `Bault C/O ${account.username}`,
      lines: [f.line1, f.line2].filter((l): l is string => Boolean(l && l.trim())),
      city: f.city,
      region: f.region,
      postalCode: f.postalCode,
      country: f.country,
      phone: f.phone,
      salesTaxBps: f.salesTaxBps,
      forwardingDays: f.forwardingDays,
    }));
  }
}
