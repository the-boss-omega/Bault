import { pgTable, text, boolean } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';

/**
 * Saved shipping addresses (ACC-07). Owned by the user; managed only through
 * /me/addresses (own-only access enforced in ProfileService).
 */
export const shippingAddress = pgTable('shipping_address', {
  id: pkId(),
  userId: text('user_id').notNull(),
  label: text('label').notNull(), // e.g. "Home", "Office"
  recipient: text('recipient').notNull(),
  line1: text('line1').notNull(),
  line2: text('line2'),
  city: text('city').notNull(),
  /** State or province. A US label is rated and routed by it. */
  region: text('region'),
  country: text('country').notNull(),
  postalCode: text('postal_code').notNull(),
  /** So a courier can reach the recipient. */
  phone: text('phone'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: createdAt(),
});
