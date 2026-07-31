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
  city: text('city').notNull(),
  country: text('country').notNull(),
  postalCode: text('postal_code').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: createdAt(),
});
