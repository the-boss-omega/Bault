import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { loadEnv } from '@bault/config';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { consignmentEvent } from '../dis/consignment-event.schema';
import { facility } from '../inv/facility.schema';

@Injectable()
export class ContentService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async shows() {
    const rows = await this.db
      .select()
      .from(consignmentEvent)
      .where(eq(consignmentEvent.active, true))
      .orderBy(sql`${consignmentEvent.startsAt} asc`);

    const now = Date.now();
    return rows.map((show) => ({
      id: show.id,
      name: show.name,
      venue: show.venue,
      city: show.city,
      startsAt: show.startsAt,
      endsAt: show.endsAt,
      requestDeadline: show.requestDeadline,
      capacity: show.capacity,
      notes: show.notes,
      open: show.requestDeadline.getTime() > now,
      past: (show.endsAt ?? show.startsAt).getTime() < now,
    }));
  }

  contact() {
    const env = loadEnv();
    const clean = (value: string) => (value.trim() === '' ? null : value.trim());

    const team = (env.SUPPORT_TEAM ?? '')
      .split(';')
      .map((entry: string) => entry.split('|'))
      .filter((parts: string[]) => parts[0] !== undefined && parts[0].trim() !== '')
      .map((parts: string[]) => ({ name: parts[0]!.trim(), role: (parts[1] ?? '').trim() || null }));

    return {
      helpdesk: true,
      email: clean(env.SUPPORT_EMAIL ?? ''),
      phone: clean(env.SUPPORT_PHONE ?? ''),
      hours: clean(env.SUPPORT_HOURS ?? ''),
      team,
    };
  }

  async locations() {
    const rows = await this.db
      .select()
      .from(facility)
      .where(and(eq(facility.active, true)))
      .orderBy(facility.role);

    return rows.map((f) => ({
      code: f.code,
      name: f.name,
      role: f.role,
      city: f.city,
      region: f.region,
      country: f.country,
      salesTaxBps: f.salesTaxBps,
      forwardingDays: f.forwardingDays,
    }));
  }
}
