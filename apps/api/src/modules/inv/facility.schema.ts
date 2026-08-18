import { pgEnum, pgTable, text, integer, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

/**
 * A physical place that receives parcels on a collector's behalf.
 *
 * Bault had no such thing. Items appeared in a vault because a warehouse
 * operator typed them into a form, which meant the entire inbound half of the
 * product — a collector buying from a third-party seller and having it shipped
 * somewhere — had nowhere to exist.
 *
 * Two roles, and the distinction is the whole point of having more than one:
 *
 *   `primary`    Where goods are stored. A parcel that lands here stays here.
 *   `forwarding` A receiving point that holds nothing. Everything that lands
 *                here is forwarded to the primary facility, which costs money
 *                and takes days — and is worth it when the destination state
 *                charges no sales tax and the origin state does.
 *
 * `sales_tax_bps` is what makes the second address worth using at all, and it is
 * stored per facility rather than hard-coded so a rate change is a data change.
 * It is recorded for GUIDANCE only: Bault is not the seller and does not collect
 * or remit anybody's sales tax. It exists so the app can tell a collector what a
 * purchase would cost them at each address instead of leaving them to work it out.
 */
export const facilityRole = pgEnum('facility_role', ['primary', 'forwarding']);

export const facility = pgTable(
  'facility',
  {
    id: pkId(),
    /** Short stable code used in labels and URLs, e.g. "NJ", "DE". */
    code: text('code').notNull(),
    name: text('name').notNull(),
    role: facilityRole('role').notNull(),

    line1: text('line1').notNull(),
    line2: text('line2'),
    city: text('city').notNull(),
    /** State / province. Kept separate because the tax guidance is state-level. */
    region: text('region').notNull(),
    postalCode: text('postal_code').notNull(),
    country: text('country').notNull().default('US'),
    phone: text('phone'),

    /**
     * The destination state's sales-tax rate in basis points (625 = 6.25%).
     * Zero means the address is in a state that levies none — which is the
     * entire reason a forwarding facility earns its forwarding cost.
     */
    salesTaxBps: integer('sales_tax_bps').notNull().default(0),

    /** Where a forwarding facility sends what it receives. Null for `primary`. */
    forwardsToFacilityId: text('forwards_to_facility_id'),
    /** Typical transit time to the primary facility, shown as guidance. */
    forwardingDays: integer('forwarding_days'),

    /**
     * Whether the address may be given out. A facility is never deleted — parcels
     * reference it forever — so closing one is a flag, not a removal.
     */
    active: boolean('active').notNull().default(true),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ facilityCodeUnique: uniqueIndex('facility_code_unique').on(t.code) }),
);
