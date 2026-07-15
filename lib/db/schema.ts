// Drizzle schema. `lib/db` is the ONLY module that speaks SQL (AD-1).
//
// The `operator` row is the single owner. Its `id` is the AD-8 `owner_id` FK
// target every future entity (Client, Job, PendingRequest, Inquiry, MessageLog,
// Token) will reference. Surrogate uuid PK; timestamps stored UTC (AD-9).

import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  index,
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
  (t) => [
    uniqueIndex('operator_email_uq').on(t.email),
    // Single-operator invariant: an expression unique index on the constant
    // `(true)` allows at most one operator row regardless of email, so the AD-8
    // owner_id seam can never resolve to an arbitrary second tenant.
    uniqueIndex('operator_singleton').on(sql`(true)`),
  ],
);

export type Operator = typeof operator.$inferSelect;
export type NewOperator = typeof operator.$inferInsert;

// Cadence (FR15) — the raw signal Client stores; expectedNextDate is DERIVED on
// read (AD-7), never a column. Exactly these four values.
export const clientCadence = pgEnum('client_cadence', [
  'weekly',
  'biweekly',
  'monthly',
  'one-time',
]);

// Client.status stores ONLY active|provisional. `gone-cold` is DERIVED on read
// (AD-7) — it is never a stored value, so it is intentionally absent from this
// Postgres enum: the DB is physically incapable of persisting it.
export const clientStatus = pgEnum('client_status', ['active', 'provisional']);

export const client = pgTable(
  'client',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // AD-8 tenancy seam: every Client row carries the owner_id FK. Present from
    // v1 so the owner_id FILTER can be applied to every query without a later
    // schema rewrite. NOT NULL — an ownerless client is a cross-tenant leak.
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => operator.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    // Address is optional on create (AC-1 only mandates name + phone).
    address: text('address'),
    cadence: clientCadence('cadence').notNull(),
    // Operator-added clients are `active`; `provisional` is reserved for public
    // self-booking (Epic 4). `gone-cold` is never stored (AD-7).
    status: clientStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Reads are always owner-scoped (AD-8); index the filter column.
    index('client_owner_id_idx').on(t.ownerId),
  ],
);

export type Client = typeof client.$inferSelect;
export type NewClient = typeof client.$inferInsert;
