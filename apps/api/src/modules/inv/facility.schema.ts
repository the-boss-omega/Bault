import { pgEnum, pgTable, text, integer, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

export const facilityRole = pgEnum('facility_role', ['primary', 'forwarding']);

export const facility = pgTable(
  'facility',
  {
    id: pkId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    role: facilityRole('role').notNull(),

    line1: text('line1').notNull(),
    line2: text('line2'),
    city: text('city').notNull(),
    region: text('region').notNull(),
    postalCode: text('postal_code').notNull(),
    country: text('country').notNull().default('US'),
    phone: text('phone'),

    salesTaxBps: integer('sales_tax_bps').notNull().default(0),

    forwardsToFacilityId: text('forwards_to_facility_id'),
    forwardingDays: integer('forwarding_days'),

    active: boolean('active').notNull().default(true),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ facilityCodeUnique: uniqueIndex('facility_code_unique').on(t.code) }),
);
