import { pgTable, text, boolean, uuid } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';
import { userAccount } from './acc.schema';

export const shippingAddress = pgTable('shipping_address', {
  id: pkId(),
  userId: uuid('user_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  label: text('label').notNull(),
  recipient: text('recipient').notNull(),
  line1: text('line1').notNull(),
  city: text('city').notNull(),
  region: text('region'),
  country: text('country').notNull(),
  postalCode: text('postal_code').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: createdAt(),
});
