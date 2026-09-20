import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { loadEnv } from '@bault/config';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { consignmentEvent } from '../dis/consignment-event.schema';
import { facility } from '../inv/facility.schema';

/**
 * The two pieces of published content that are DATA rather than prose.
 *
 * The audit scored "blog, show schedule, buying guides" and "direct human
 * support — phone, email, named owners" as missing, and they are missing in
 * different ways that deserve different answers.
 *
 * Guides and tutorials are WRITING. They live in the SPA next to the FAQ, under
 * the same rule that module already holds itself to: nothing is invented, and an
 * entry is either true of Bault or it is not present. Nothing about them needs a
 * database.
 *
 * These two do. The show calendar is real rows — Bault genuinely has a table at
 * particular shows on particular dates, and that is exactly the schedule the
 * reference publishes. And contact details have to come from CONFIGURATION,
 * because a phone number written into source is a phone number that is wrong in
 * every deployment but one. Where nothing is configured this says so plainly
 * rather than printing a plausible-looking placeholder somebody might dial.
 */
@Injectable()
export class ContentService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * The show calendar.
   *
   * Every active show, past ones included — a calendar that silently drops
   * yesterday is a calendar you cannot use to check what you missed. `open`
   * says whether consignments are still being taken, which is the only thing a
   * reader actually needs to decide from.
   */
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
      /** Still accepting consignments. */
      open: show.requestDeadline.getTime() > now,
      /** Already happened. */
      past: (show.endsAt ?? show.startsAt).getTime() < now,
    }));
  }

  /**
   * How to reach a person.
   *
   * Every field is optional and every one is read from the environment. A
   * deployment that has not configured a phone number gets `null` and a page
   * that says the channel is not published — never a placeholder. The one route
   * that is ALWAYS available is the helpdesk, because it is built and does not
   * depend on anybody having filled in a variable.
   */
  contact() {
    const env = loadEnv();
    const clean = (value: string) => (value.trim() === '' ? null : value.trim());

    /**
     * Named owners, from `SUPPORT_TEAM` as `Name|Role;Name|Role`.
     *
     * The reference publishes who answers, and it is the part that makes a
     * support page read as a company rather than a form. Parsed leniently: a
     * malformed entry is dropped rather than breaking the page.
     */
    const team = (env.SUPPORT_TEAM ?? '')
      .split(';')
      .map((entry: string) => entry.split('|'))
      .filter((parts: string[]) => parts[0] !== undefined && parts[0].trim() !== '')
      .map((parts: string[]) => ({ name: parts[0]!.trim(), role: (parts[1] ?? '').trim() || null }));

    return {
      /** Always true: the helpdesk exists regardless of configuration. */
      helpdesk: true,
      email: clean(env.SUPPORT_EMAIL ?? ''),
      phone: clean(env.SUPPORT_PHONE ?? ''),
      hours: clean(env.SUPPORT_HOURS ?? ''),
      team,
    };
  }

  /**
   * The facilities, as published addresses.
   *
   * Included here because "where are you, actually" is the other half of the
   * question a contact page answers, and the rows already exist. The
   * per-collector `C/O username` line is NOT here — that is
   * `GET /me/inbound-addresses` and is nobody else's business.
   */
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
      /** Guidance only — Bault is not the seller and remits nobody's tax. */
      salesTaxPpm: f.salesTaxPpm,
      forwardingDays: f.forwardingDays,
    }));
  }
}
