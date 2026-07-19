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
    // action UPSERTs on this conflict target. This single-column unique index
    // ALSO serves every owner-scoped read (AD-8) — a separate non-unique
    // owner_id index would be fully redundant (Epic-1 retro cleanup).
    uniqueIndex('capacity_settings_owner_uq').on(t.ownerId),
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
    // AD-12: at most one *consuming* Job per (owner, idempotency_key) — the DB
    // backstop for idempotent commitBooking. Scoped to consuming completions
    // (code-review 2026-07-16, story 3.2): a deterministic client-confirm key
    // `book:<client>:<date>` persists on a row after it is cancelled; without the
    // partial predicate that dead key would forever block re-booking the same day
    // (cancel → rebook is the core Epic-3 flow). Cancelled rows are excluded, so a
    // fresh booking can reuse the key while two live bookings still can't collide.
    uniqueIndex('job_owner_idempotency_uq')
      .on(t.ownerId, t.idempotencyKey)
      .where(sql`${t.completion} in ('booked', 'completed', 'no-show')`),
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

// Token capability (Story 3.1, AD-6) — what a token bearer may do. A bearer can do
// EXACTLY what its capability scopes, nothing more. Declared as a closed enum so a
// new capability is a deliberate schema change, not an ambient string.
export const tokenCapability = pgEnum('token_capability', [
  // v1: view THIS ONE client's open slots (+ book that one client, Story 3.2).
  'book-client',
  // Seam for Epic 4's single public self-booking token — a DISTINCT capability,
  // declared now so the capability boundary never needs a retrofit.
  'book-public',
]);

// Token (Story 3.1, FR3/FR34, AD-6) — a signed, unguessable per-client booking
// credential. The token STRING is the entire authorization decision on client
// surfaces: no client login, no session, no account (FR34). Signing/verification
// lives in lib/auth/clientToken.ts (HMAC-SHA256, mirroring the operator session in
// lib/auth/session.ts — one audited crypto path, NFR7). The token is a DETERMINISTIC
// signature over {client_id, owner_id, capability}, so exactly one stable link
// exists per client (idempotent re-mint). This row is the server-side record that
// makes the credential REVOCABLE: delete the row and verification fails closed even
// though the HMAC is still valid.
export const token = pgTable(
  'token',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // AD-8 tenancy seam: every token row carries the owner_id FK, present in every
    // query. NOT NULL — an ownerless token is a cross-tenant leak.
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => operator.id, { onDelete: 'restrict' }),
    // The ONE client this token is scoped to. NULLABLE seam: the future public token
    // (Epic 4) is scoped to no single client. Per-client tokens (this story) ALWAYS
    // set it. onDelete cascade: a removed client's booking link must die with it.
    clientId: uuid('client_id').references(() => client.id, {
      onDelete: 'cascade',
    }),
    // The signed, unguessable token STRING (base64url(payload).base64url(hmac)).
    // Stored + UNIQUE so resolution is an O(1) lookup and re-minting is idempotent.
    tokenValue: text('token_value').notNull(),
    // Per-link random nonce, folded INTO the signed payload (code-review D1,
    // 2026-07-16). Without it the signature is a pure function of
    // {client,owner,capability}, so a re-mint reproduces a revoked (deleted) link
    // verbatim — revocation isn't durable. The nonce is generated once, PERSISTED
    // here, and reused on every idempotent re-mint (so the link stays stable);
    // rotating it (rotateClientToken) mints a genuinely new link and kills the old.
    // App-set to match the signed payload — deliberately NO DB default.
    nonce: text('nonce').notNull(),
    // What the bearer may do — exactly one capability (AD-6). Stored AND carried in
    // the HMAC claim; verification requires the two to agree.
    capability: tokenCapability('capability').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // O(1) resolution by token string; UNIQUE makes re-minting the same per-client
    // token idempotent (the upsert does nothing on conflict).
    uniqueIndex('token_value_uq').on(t.tokenValue),
    // Reads are always owner-scoped (AD-8); index the filter column.
    index('token_owner_id_idx').on(t.ownerId),
    // One live per-client link: at most one token per (owner, client, capability).
    // (Per-client rows set client_id; the lone public token, Epic 4, has none.)
    uniqueIndex('token_owner_client_capability_uq').on(
      t.ownerId,
      t.clientId,
      t.capability,
    ),
    // Exactly ONE public token per owner (Story 4.1, AD-6). The index above CANNOT
    // enforce this: Postgres treats NULL client_id values as DISTINCT, so multiple
    // book-public rows (all client_id NULL) would coexist under it. This PARTIAL
    // unique index scopes to the client-less rows only — at most one per
    // (owner, capability) where client_id IS NULL. The public insert/rotate upsert
    // uses this as the conflict arbiter (targetWhere client_id IS NULL).
    uniqueIndex('token_owner_public_uq')
      .on(t.ownerId, t.capability)
      .where(sql`${t.clientId} is null`),
  ],
);

export type Token = typeof token.$inferSelect;
export type NewToken = typeof token.$inferInsert;

// PendingRequest lifecycle (Story 4.2, FR6/FR36, AD-4/AR5). A new-client public
// request starts `pending` and NEITHER reserves NOR consumes capacity (AD-4): there
// is no Job, no cap decrement, no lock — a row here is a stranger's *request*, not a
// booking. The operator's approval queue (Story 4.3, FR36) transitions it: `approved`
// runs commitBooking (the first approval on a shared slot wins), `declined` leaves the
// slot untouched. `withdrawn` is a seam for a future client-cancel. Declared closed so
// a fifth state is a deliberate schema change.
export const pendingRequestStatus = pgEnum('pending_request_status', [
  'pending',
  'approved',
  'declined',
  'withdrawn',
]);

// PendingRequest (Story 4.2, FR6/AR5) — a new client's self-serve booking request,
// awaiting operator approval. CRITICAL INVARIANT (AR5): this row holds NO capacity —
// several pending requests may target the SAME day (no slot-uniqueness constraint),
// and capacity is consumed ONLY when Story 4.3's approval calls commitBooking (AD-2).
// `client_id` points at the provisional Client minted in the same submission. `date`
// is the operator-local calendar day the stranger picked from the offered open set
// (re-validated server-side, never trusted). Owner-scoped on every read/write (AD-8);
// created_at is a UTC instant (AD-9).
export const pendingRequest = pgTable(
  'pending_request',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // AD-8 tenancy seam: owner_id FK on every row, resolved from the public token
    // (no session on the public surface). NOT NULL — an ownerless request is a leak.
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => operator.id, { onDelete: 'restrict' }),
    // The provisional Client created in the same submission (Story 4.2).
    clientId: uuid('client_id')
      .notNull()
      .references(() => client.id, { onDelete: 'restrict' }),
    // Operator-local scheduled calendar day, 'YYYY-MM-DD' — NOT an instant. The day
    // the stranger requested; the approval (4.3) re-checks the cap against it.
    date: date('date', { mode: 'string' }).notNull(),
    status: pendingRequestStatus('status').notNull().default('pending'),
    // The per-render token-visit session nonce (AR12). Scopes request idempotency to
    // (owner, nonce, date): a true double-tap of the SAME rendered form + SAME day
    // collapses to one request, while a back-button resubmit of a DIFFERENT day in the
    // same session is correctly recorded as a distinct request (never a silent lost
    // booking) — even though the `link` Inquiry is still deduped to one per session.
    sessionNonce: text('session_nonce').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // The approval queue (4.3) reads the owner's `pending` rows; the composite
    // serves that owner-scoped-by-status read.
    index('pending_request_owner_status_idx').on(t.ownerId, t.status),
    index('pending_request_client_id_idx').on(t.clientId),
    // Idempotency: at most one request per (owner, session_nonce, date). Deliberately
    // NOT unique on (owner, date) alone — DIFFERENT visitors (distinct nonces) MAY
    // target the same slot (FR36/AR5); only a same-visit same-day resubmit collapses.
    uniqueIndex('pending_request_owner_session_date_uq').on(
      t.ownerId,
      t.sessionNonce,
      t.date,
    ),
  ],
);

export type PendingRequest = typeof pendingRequest.$inferSelect;
export type NewPendingRequest = typeof pendingRequest.$inferInsert;

// Inquiry provenance (Story 4.2 AC2 / Story 4.4, FR37/AR12). Every inquiry carries a
// source; a link visit that begins a booking auto-logs at most ONE `link` inquiry per
// token-visit session (AR12), while phone/walk-in/referral/other are the operator's
// manual logs (Story 4.4). Closed enum so an unlisted source is unpersistable.
export const inquirySource = pgEnum('inquiry_source', [
  'phone',
  'walk-in',
  'link',
  'referral',
  'other',
]);

// Inquiry (Story 4.2 AC2, FR37/AR12) — the inquiry→booking conversion denominator.
// A `link` inquiry is auto-logged on a public new-client submission and DEDUPED to at
// most one per token-visit session (AR12): `session_nonce` is the per-render visit
// nonce embedded in the form, and the PARTIAL unique index below (source='link') makes
// a double-tap of the same rendered form key to the SAME would-be row — the second
// insert conflicts, which the submission transaction uses to stay fully idempotent
// (one client + one pending request + one inquiry per session). Manual logs (Story 4.4)
// carry no session_nonce (nullable). Owner-scoped (AD-8); created_at UTC (AD-9).
export const inquiry = pgTable(
  'inquiry',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // AD-8 tenancy seam: owner_id FK on every row. NOT NULL — an ownerless inquiry
    // would double-count into the wrong tenant's conversion metric.
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => operator.id, { onDelete: 'restrict' }),
    // The provisional Client for a `link` inquiry; null for a bare manual log (4.4).
    // set null on delete: an inquiry is a historical fact that must outlive the client.
    clientId: uuid('client_id').references(() => client.id, {
      onDelete: 'set null',
    }),
    source: inquirySource('source').notNull(),
    // The per-render dedup nonce (AR12). A `link` inquiry sets the token-visit session
    // nonce (Story 4.2); a MANUAL log sets a per-render SUBMIT nonce (Epic 4 retro action
    // item — dedups a double-tapped manual log). Nullable: a manual log that carries no
    // nonce is simply never deduped (each is a distinct inquiry). One column, two partial
    // indexes below (source='link' vs source<>'link') keep the two dedup scopes disjoint.
    sessionNonce: text('session_nonce'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Reads are owner-scoped (AD-8); the conversion derive (FR24/AR19) reads per owner.
    index('inquiry_owner_id_idx').on(t.ownerId),
    // AR12 invariant: at most one `link` inquiry per (owner, session_nonce). PARTIAL —
    // scoped to link rows only (manual logs have a null nonce and must not collide),
    // and the submission insert uses it as the ON CONFLICT DO NOTHING arbiter.
    uniqueIndex('inquiry_owner_session_link_uq')
      .on(t.ownerId, t.sessionNonce)
      .where(sql`${t.source} = 'link'`),
    // Epic 4 retro action item: at most one MANUAL inquiry per (owner, submit_nonce).
    // PARTIAL — scoped to non-`link` rows (disjoint from the link index above, so the two
    // dedup arbiters never collide), and the manual insert uses it as the ON CONFLICT DO
    // NOTHING arbiter (queries.insertInquiry). A null nonce is exempt (Postgres treats NULLs
    // as distinct in a unique index), so pre-existing/nonce-less manual logs never conflict.
    uniqueIndex('inquiry_owner_submit_manual_uq')
      .on(t.ownerId, t.sessionNonce)
      .where(sql`${t.source} <> 'link'`),
  ],
);

export type Inquiry = typeof inquiry.$inferSelect;
export type NewInquiry = typeof inquiry.$inferInsert;
