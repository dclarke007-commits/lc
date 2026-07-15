// Drizzle schema. `lib/db` is the ONLY module that speaks SQL (AD-1).
//
// The `operator` row is the single owner. Its `id` is the AD-8 `owner_id` FK
// target every future entity (Client, Job, PendingRequest, Inquiry, MessageLog,
// Token) will reference. Surrogate uuid PK; timestamps stored UTC (AD-9).

import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const operator = pgTable(
  'operator',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    passphraseHash: text('passphrase_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex('operator_email_uq').on(t.email)],
);

export type Operator = typeof operator.$inferSelect;
export type NewOperator = typeof operator.$inferInsert;
