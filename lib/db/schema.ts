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
  integer,
  boolean,
  date,
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

// Capacity settings (Story 1.3, FR1) — the operator's availability model: which
// weekdays are worked, the per-day cap, the hard weekly ceiling (14), the default
// job price, and the single operator-local timezone (AD-9). Exactly one row per
// owner (owner-scoped, AD-8). Business DEFAULTS are NOT DB column defaults — they
// live in the domain (lib/domain/capacityConfig.ts) as the single source (AR16),
// so downstream stories never re-hardcode 3/14/Mon–Sat. Money is integer cents,
// USD (AR16). Timestamps stored UTC (AD-9).
export const capacitySettings = pgTable(
  'capacity_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // AD-8 tenancy seam: every settings row carries the owner_id FK, scoped on
    // read and write. NOT NULL — an ownerless config is a cross-tenant leak.
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => operator.id, { onDelete: 'restrict' }),
    // ISO weekday ints: 1=Mon .. 7=Sun. Default Mon–Sat lives in the domain.
    workingDays: integer('working_days').array().notNull(),
    perDayCap: integer('per_day_cap').notNull(),
    weeklyCeiling: integer('weekly_ceiling').notNull(),
    // Money as integer cents, USD (AR16). Default $200 = 20000 lives in domain.
    defaultJobPriceCents: integer('default_job_price_cents').notNull(),
    // IANA timezone name — the operator's single local clock (AD-9).
    timezone: text('timezone').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Single-row-per-owner invariant: at most one settings row per owner. The
    // action UPSERTs on this conflict target.
    uniqueIndex('capacity_settings_owner_uq').on(t.ownerId),
    // Reads are always owner-scoped (AD-8); index the filter column.
    index('capacity_settings_owner_id_idx').on(t.ownerId),
  ],
);

export type CapacitySettingsRow = typeof capacitySettings.$inferSelect;
export type NewCapacitySettings = typeof capacitySettings.$inferInsert;

// Job lifecycle status (AD-2). `booked|completed|no-show` consume capacity;
// `cancelled` does not — but capacity.consumesSlot() is the ONE predicate that
// decides that (never re-derive the set elsewhere). Insert-as-`booked`; the
// completed/no-show/cancelled transitions land in Stories 1.5/1.6.
export const jobCompletion = pgEnum('job_completion', [
  'booked',
  'completed',
  'no-show',
  'cancelled',
]);

// Payment state (Epic 5 ledger). A new booking is `owed` until marked paid.
export const jobPayment = pgEnum('job_payment', ['paid', 'owed']);

// Job (Story 1.4, FR9/FR39) — a booked slot. A row in `jobs` ALWAYS represents
// consumed capacity per consumesSlot (AD-2). Inserted only by
// capacity.commitBooking inside one transaction under the day-scoped advisory
// lock (AD-3). `date` is the operator-local scheduled CALENDAR day (no tz — a
// cleaning is "on the 20th"); per-day and weekly-14 counts are calendar
// arithmetic over it. `created_at`/`completed_at` are instants → UTC (AD-9).
export const job = pgTable(
  'job',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // AD-8 tenancy seam — owner_id FK on every row, scoped on every query.
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => operator.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => client.id, { onDelete: 'restrict' }),
    // Operator-local scheduled calendar day, 'YYYY-MM-DD'. NOT an instant.
    date: date('date', { mode: 'string' }).notNull(),
    completion: jobCompletion('completion').notNull().default('booked'),
    payment: jobPayment('payment').notNull().default('owed'),
    // FR39 override flag — true when the booking was committed past a full cap.
    // Feeds the overbooking counter-metric. Never a separate insert path (AD-2).
    overridden: boolean('overridden').notNull().default(false),
    // Money as integer cents, USD (AR16). Defaulted from capacity config at
    // commit time (domain single source), never a DB column default.
    priceCents: integer('price_cents').notNull(),
    // AD-12 idempotency — per booking-attempt key (operator-direct: a hidden
    // per-form nonce). A repeat submit with the same key returns the same Job.
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    // Set when the job is marked completed (Story 1.5); null while `booked`.
    completedAt: timestamp('completed_at', {
      withTimezone: true,
      mode: 'string',
    }),
  },
  (t) => [
    // Reads are owner-scoped (AD-8). The (owner, date) composite serves the
    // per-day and weekly-14 capacity counts inside commitBooking.
    index('job_owner_date_idx').on(t.ownerId, t.date),
    index('job_client_id_idx').on(t.clientId),
    // AD-12: at most one Job per (owner, idempotency_key) — the DB backstop for
    // idempotent commitBooking. A repeat attempt can never create a second row.
    uniqueIndex('job_owner_idempotency_uq').on(t.ownerId, t.idempotencyKey),
  ],
);

export type Job = typeof job.$inferSelect;
export type NewJob = typeof job.$inferInsert;

// Message template type (Story 2.1, FR20). The FOUR outbound templates are a
// fixed, CLOSED set — booking confirmation, rebooking nudge, win-back check-in,
// payment reminder — not user-addable (Simplicity gate). Modeled as a Postgres
// enum so the DB is physically incapable of persisting a fifth type.
export const messageTemplateType = pgEnum('message_template_type', [
  'booking_confirmation',
  'rebooking_nudge',
  'win_back',
  'payment_reminder',
]);

// MessageTemplate (Story 2.1, FR20) — the operator's editable outbound copy, one
// row per (owner, type). `body` is the raw template string carrying the three
// sanctioned placeholders {client}/{slot}/{amount}; lib/domain/compose.ts's
// resolveTemplate substitutes them (never leaking a raw {token}, AC3). Templates
// are DATA, transport-agnostic (AD-5): no wa.me/sms concern lives here. Default
// copy is SEEDED (lib/db/seed.ts), never a DB column default. `updated_at` is a
// UTC instant (AD-9). Owner-scoped on every read/write (AD-8).
export const messageTemplate = pgTable(
  'message_template',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // AD-8 tenancy seam: owner_id FK on every row, scoped on read and write.
    // NOT NULL — an ownerless template is a cross-tenant leak.
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => operator.id, { onDelete: 'restrict' }),
    type: messageTemplateType('type').notNull(),
    // The editable template string with {client}/{slot}/{amount} placeholders.
    body: text('body').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Exactly one template per type per owner — the four are a closed set. The
    // seed and the save action both UPSERT on this conflict target.
    uniqueIndex('message_template_owner_type_uq').on(t.ownerId, t.type),
    // Reads are always owner-scoped (AD-8); index the filter column.
    index('message_template_owner_id_idx').on(t.ownerId),
  ],
);

export type MessageTemplate = typeof messageTemplate.$inferSelect;
export type NewMessageTemplate = typeof messageTemplate.$inferInsert;

// MessageLog (Story 2.3, FR21/AR6/AD-5) — the once-per-send dispatch record that
// feeds the nudge-fatigue counter honestly. AD-5, verbatim: dispatch is recorded
// ONCE on the operator's explicit send tap (idempotent per draft), never on render;
// `drafted_at` is distinguished from `dispatched_at`, and ONLY `dispatched_at` feeds
// nudge-fatigue (§2, derived on read — AD-7). The row's mere existence is "drafted"
// (`drafted_at` set, `dispatched_at` null); `dispatched_at IS NOT NULL` is "dispatched".
//
// Idempotency (DEV DECISION — Option B, unique row per draft): every row carries a
// per-draft `draft_nonce` (AD-12 pattern, mirroring `job.idempotency_key`). The send
// tap is a form POST carrying the nonce the preview render minted; a re-tap resubmits
// the SAME nonce → keys to the SAME row → the dispatch guard sees it already stamped
// and no second dispatch is ever written. `resulting_job_ref` is the FR13 attribution
// column now (Structural Seed) — declared, populated by later stories, nullable.
// Owner-scoped on every read/write (AD-8). Timestamps are UTC instants (AD-9).
export const messageLog = pgTable(
  'message_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // AD-8 tenancy seam: owner_id FK on every row, scoped on read and write.
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => operator.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => client.id, { onDelete: 'restrict' }),
    // Message KIND (not a channel, AD-5) — aligns exactly with Story 2.1's closed
    // template set; the same Postgres enum, so a fifth type is unpersistable.
    messageType: messageTemplateType('message_type').notNull(),
    // AD-12 per-draft idempotency nonce (Option B). One row per (owner, nonce).
    draftNonce: text('draft_nonce').notNull(),
    // Set when the draft is materialized; the row's existence IS "drafted". NOT NULL.
    draftedAt: timestamp('drafted_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    // NULL until the operator's explicit send tap; ONLY this feeds nudge-fatigue.
    dispatchedAt: timestamp('dispatched_at', {
      withTimezone: true,
      mode: 'string',
    }),
    // FR13 attribution — a column now (Structural Seed), populated by later stories.
    // set null on job delete: an optional backref must never block job lifecycle.
    resultingJobRef: uuid('resulting_job_ref').references(() => job.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    // Option B invariant: at most one MessageLog row per (owner, draft_nonce). The
    // send action UPSERTs on this target so a re-tap can never insert a second row.
    uniqueIndex('message_log_owner_nonce_uq').on(t.ownerId, t.draftNonce),
    // Nudge-fatigue derive reads dispatched rows grouped per client; index (owner,
    // client) so the per-client-per-week count is served without a scan.
    index('message_log_owner_client_idx').on(t.ownerId, t.clientId),
    // Reads are always owner-scoped (AD-8); index the filter column.
    index('message_log_owner_id_idx').on(t.ownerId),
  ],
);

export type MessageLog = typeof messageLog.$inferSelect;
export type NewMessageLog = typeof messageLog.$inferInsert;
