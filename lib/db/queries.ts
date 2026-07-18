// Owner-scoped query helpers. AD-8: the owner_id FILTER (the value, not just the
// column) is present in every query from v1. Since v1 is single-operator, the
// value is resolved from the one seeded operator row. Later stories add a value
// SOURCE (e.g. from the session), never a query retrofit.

import {
  eq,
  and,
  asc,
  desc,
  gte,
  isNull,
  isNotNull,
  inArray,
  sql,
} from 'drizzle-orm';
import { db } from './client';
import type { LedgerJob } from '@/lib/domain/derive';
import {
  operator,
  client,
  capacitySettings,
  job,
  messageTemplate,
  messageLog,
  token,
  pendingRequest,
  inquiry,
} from './schema';
import type {
  Operator,
  Client,
  CapacitySettingsRow,
  Job,
  MessageTemplate,
  MessageLog,
  Token,
  PendingRequest,
  Inquiry,
} from './schema';

/**
 * Resolve the single owner's id — the AD-8 owner_id value every future query
 * filters on. Throws only in the genuinely un-seeded state (a deploy invariant
 * violation); callers in Server Actions convert failures to the result contract.
 */
export async function getOwnerId(): Promise<string> {
  // Deterministic read: the singleton index caps this at one row, but ORDER BY
  // guarantees a stable answer even mid-migration rather than an arbitrary pick.
  const [row] = await db
    .select({ id: operator.id })
    .from(operator)
    .orderBy(asc(operator.createdAt), asc(operator.id))
    .limit(1);
  if (!row) throw new Error('No operator seeded — run the operator seed.');
  return row.id;
}

/** Look up the owner by identity (email), owner-scoped by construction. */
export async function getOperatorByEmail(
  email: string,
): Promise<Operator | undefined> {
  const [row] = await db
    .select()
    .from(operator)
    .where(eq(operator.email, email))
    .limit(1);
  return row;
}

// --- Client reads (AD-8: every SELECT carries the owner_id FILTER value) ---

// Canonical UUID shape. `client.id` is a Postgres `uuid` column, so a malformed
// path param (e.g. /clients/not-a-uuid/edit) would make Postgres throw 22P02 and
// surface a 500. We short-circuit to "not found" instead — the surface's stated
// contract is notFound() for a bad/other-owner id.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * List the owner's clients. The `owner_id` filter is on the VALUE (not merely
 * the column) from day one, so a row belonging to any other owner is physically
 * unreachable through this path. Newest first.
 */
export async function listClients(ownerId: string): Promise<Client[]> {
  return db
    .select()
    .from(client)
    .where(eq(client.ownerId, ownerId))
    .orderBy(desc(client.createdAt), asc(client.id));
}

/**
 * Read one client by id, owner-scoped. Both predicates are required: an id that
 * belongs to a different owner returns undefined, never another tenant's row.
 */
export async function getClient(
  ownerId: string,
  id: string,
): Promise<Client | undefined> {
  // A non-UUID id can never match a real row — treat as "not found" rather than
  // letting Postgres throw an invalid-uuid error into RSC render.
  if (!UUID_RE.test(id)) return undefined;
  const [row] = await db
    .select()
    .from(client)
    .where(and(eq(client.ownerId, ownerId), eq(client.id, id)))
    .limit(1);
  return row;
}

// --- Capacity settings (Story 1.3, AD-8: owner_id FILTER value applied) ---

/**
 * Read the owner's single capacity-settings row. Owner-scoped by the owner_id
 * VALUE (not merely the column). Returns undefined on first view (no row yet) —
 * the action layer substitutes DEFAULT_CAPACITY so defaults live in ONE place.
 */
export async function getCapacitySettings(
  ownerId: string,
): Promise<CapacitySettingsRow | undefined> {
  const [row] = await db
    .select()
    .from(capacitySettings)
    .where(eq(capacitySettings.ownerId, ownerId))
    .limit(1);
  return row;
}

// --- Job reads (Story 1.5, AD-8: owner_id FILTER value on every query) ---

/**
 * A job row plus its client's name — the shape the jobs surface renders. Kept as
 * a projection (not the raw Job) so the surface never needs a second lookup.
 */
export interface JobListItem {
  id: string;
  clientId: string;
  date: string;
  completion: string;
  completedAt: string | null;
  payment: string;
  clientName: string;
}

/**
 * List the owner's jobs with the client's name, newest scheduled date first. The
 * owner_id filter is on the VALUE (AD-8); the client join is also owner-scoped, so
 * no other tenant's row is reachable through this path.
 */
export async function listJobs(ownerId: string): Promise<JobListItem[]> {
  return db
    .select({
      id: job.id,
      clientId: job.clientId,
      date: job.date,
      completion: job.completion,
      completedAt: job.completedAt,
      payment: job.payment,
      clientName: client.name,
    })
    .from(job)
    .innerJoin(
      client,
      and(eq(job.clientId, client.id), eq(client.ownerId, ownerId)),
    )
    .where(eq(job.ownerId, ownerId))
    .orderBy(desc(job.date), asc(job.id));
}

/**
 * A job row shaped for the CSV data-export (Story 6.4, FR35/AR17). Carries the
 * human-meaningful columns the operator owns — the client's NAME (not just the id),
 * the scheduled day, lifecycle + payment state, the frozen amount, and the timestamps.
 * Owner-scoped on the VALUE (AD-8) on BOTH the job filter AND the client join, so no
 * other tenant's row is reachable (AR9). Its own projection so `listJobs`/`JobListItem`
 * (the jobs page) and `listJobsForMetrics` (the dashboard derives) stay lean.
 */
export interface JobExportRow {
  id: string;
  clientName: string;
  date: string;
  completion: string;
  payment: string;
  priceCents: number;
  completedAt: string | null;
  createdAt: string;
}

export async function listJobsForExport(
  ownerId: string,
): Promise<JobExportRow[]> {
  return db
    .select({
      id: job.id,
      clientName: client.name,
      date: job.date,
      completion: job.completion,
      payment: job.payment,
      priceCents: job.priceCents,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
    })
    .from(job)
    .innerJoin(
      client,
      and(eq(job.clientId, client.id), eq(client.ownerId, ownerId)),
    )
    .where(eq(job.ownerId, ownerId))
    .orderBy(desc(job.date), asc(job.id));
}

/** The minimal Job projection derive-on-read needs (Story 1.7): date + status. */
export interface JobDateStatus {
  date: string;
  completion: string;
}

/**
 * The owner's jobs projected for the ledger's "who owes" aggregation (Story 5.2):
 * completion (eligibility gate), payment (owed gate), the frozen priceCents amount,
 * and the client id/name for grouping. Owner-scoped on the VALUE (AD-8); the client
 * join is owner-scoped too, so no other tenant's row is reachable. Kept as its own
 * projection so `listJobs`/`JobListItem` stays lean. `derive.outstanding` does the
 * filtering/summing on read — this query does no aggregation (AD-7).
 */
export async function listLedgerJobs(ownerId: string): Promise<LedgerJob[]> {
  return db
    .select({
      clientId: job.clientId,
      clientName: client.name,
      completion: job.completion,
      payment: job.payment,
      priceCents: job.priceCents,
    })
    .from(job)
    .innerJoin(
      client,
      and(eq(job.clientId, client.id), eq(client.ownerId, ownerId)),
    )
    .where(eq(job.ownerId, ownerId));
}

/**
 * Lean, name-free projection every DASHBOARD metric + the clients-surface lapse
 * annotation reads (Story 6.1; absorbs the Epic-5 retro perf debt). One owner-scoped
 * query with NO client-name join — the goneCold/repeat/lapse/revenue derives never
 * read the name (unlike `listJobs`/`JobListItem`, kept for the jobs page which does).
 * Carries exactly the fields the derives consume: `clientId` (grouping/follow-on
 * match), `completion` (eligibility/lapse), scheduled `date` (lapse basis), the UTC
 * instants `completedAt`/`createdAt` (addendum-F repeat-rate, AR19 — never the
 * scheduled date as a substitute), and the frozen `priceCents` (revenue). Owner-scoped
 * on the VALUE (AD-8). Aggregation stays in `derive` on read (AD-7); this query sums
 * nothing. Wrap in React `cache()` at the call site to de-dupe within one render.
 */
export interface JobMetricsRow {
  clientId: string;
  completion: string;
  date: string;
  completedAt: string | null;
  createdAt: string;
  priceCents: number;
}

export async function listJobsForMetrics(
  ownerId: string,
): Promise<JobMetricsRow[]> {
  return db
    .select({
      clientId: job.clientId,
      completion: job.completion,
      date: job.date,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      priceCents: job.priceCents,
    })
    .from(job)
    .where(eq(job.ownerId, ownerId));
}

/**
 * The owner's jobs scheduled on or after `fromDateKey` ('YYYY-MM-DD') — the
 * bounded window derive (Story 1.7) reads to compute room-left/day-maxed for the
 * current week and scan forward for nearest-open. Owner-scoped on the VALUE
 * (AD-8); served by the (owner, date) index. Only the two fields derive uses are
 * selected — no client join, no history before this week.
 */
export async function listJobsFrom(
  ownerId: string,
  fromDateKey: string,
): Promise<JobDateStatus[]> {
  return db
    .select({ date: job.date, completion: job.completion })
    .from(job)
    .where(and(eq(job.ownerId, ownerId), gte(job.date, fromDateKey)))
    .orderBy(asc(job.date));
}

/**
 * Read one job by id, owner-scoped. Both predicates are required: an id that
 * belongs to a different owner returns undefined, never another tenant's row.
 */
export async function getJob(
  ownerId: string,
  id: string,
): Promise<Job | undefined> {
  // A non-UUID id can never match a real row — treat as "not found" rather than
  // letting Postgres throw an invalid-uuid error into RSC render.
  if (!UUID_RE.test(id)) return undefined;
  const [row] = await db
    .select()
    .from(job)
    .where(and(eq(job.ownerId, ownerId), eq(job.id, id)))
    .limit(1);
  return row;
}

// --- Message templates (Story 2.1, AD-8: owner_id FILTER value on every query) ---

/**
 * Read the owner's message templates (Story 2.1, FR20). Owner-scoped on the
 * VALUE (AD-8), so no other tenant's copy is reachable. Ordered by `type` for a
 * stable surface render; the four rows exist once the seed has run. The action
 * layer maps these onto the closed type set (defaults fill any not-yet-seeded).
 */
export async function getMessageTemplates(
  ownerId: string,
): Promise<MessageTemplate[]> {
  return db
    .select()
    .from(messageTemplate)
    .where(eq(messageTemplate.ownerId, ownerId))
    .orderBy(asc(messageTemplate.type));
}

// --- Message log (Story 2.3, AD-8 owner-scoped; AD-5 drafted vs dispatched) ---

/** The dispatched-message projection the nudge-fatigue derive reads (Story 2.3). */
export interface DispatchedMessage {
  clientId: string;
  messageType: string;
  dispatchedAt: string; // UTC — non-null by construction (query filters IS NOT NULL)
  // Story 3.4/FR13: the Job this dispatched message produced, or null. Feeds the pure
  // rebookingConversion derive (booked = rows with a non-null ref). Nudge-fatigue ignores it.
  resultingJobRef: string | null;
}

/**
 * Materialize a "drafted" MessageLog row (drafted_at set, dispatched_at null) keyed
 * on the per-draft nonce (Option B). Idempotent: a repeat with the same (owner,
 * nonce) — e.g. a resubmitted send form — inserts NO second row (ON CONFLICT DO
 * NOTHING on the unique target), then returns the existing row. This is ONLY the
 * drafted write; it never touches dispatched_at (AD-5: no dispatch on draft).
 */
export async function upsertMessageDraft(
  ownerId: string,
  clientId: string,
  messageType: MessageLog['messageType'],
  draftNonce: string,
  resultingJobRef: string | null = null,
): Promise<MessageLog> {
  await db
    .insert(messageLog)
    .values({ ownerId, clientId, messageType, draftNonce, resultingJobRef })
    .onConflictDoNothing({
      target: [messageLog.ownerId, messageLog.draftNonce],
    });
  const [row] = await db
    .select()
    .from(messageLog)
    .where(
      and(eq(messageLog.ownerId, ownerId), eq(messageLog.draftNonce, draftNonce)),
    )
    .limit(1);
  return row;
}

/**
 * Stamp dispatched_at ONCE on the (owner, nonce) row — the operator's explicit send
 * tap (AC2/AD-5). Guard `dispatched_at IS NULL`: the first tap wins and returns the
 * stamped row; a re-tap matches zero rows and returns undefined, so the caller
 * treats it as an idempotent no-op (no second timestamp, no second row).
 */
export async function markMessageDispatched(
  ownerId: string,
  draftNonce: string,
): Promise<MessageLog | undefined> {
  const [row] = await db
    .update(messageLog)
    .set({ dispatchedAt: sql`now()` })
    .where(
      and(
        eq(messageLog.ownerId, ownerId),
        eq(messageLog.draftNonce, draftNonce),
        isNull(messageLog.dispatchedAt),
      ),
    )
    .returning();
  return row;
}

/**
 * Read one MessageLog row by (owner, nonce) — used to return the EXISTING dispatch
 * timestamp on an idempotent re-tap (when markMessageDispatched no-ops). Owner-scoped.
 */
export async function getMessageLogByNonce(
  ownerId: string,
  draftNonce: string,
): Promise<MessageLog | undefined> {
  const [row] = await db
    .select()
    .from(messageLog)
    .where(
      and(eq(messageLog.ownerId, ownerId), eq(messageLog.draftNonce, draftNonce)),
    )
    .limit(1);
  return row;
}

/**
 * The owner's DISPATCHED messages (dispatched_at IS NOT NULL) — the canonical rows
 * the nudge-fatigue derive (Story 2.3, AD-7) counts per client per operator-local
 * week. Owner-scoped on the VALUE (AD-8). Drafts never sent (null dispatched_at) are
 * excluded here, so an unsent draft can never inflate fatigue.
 */
export async function listDispatchedMessages(
  ownerId: string,
): Promise<DispatchedMessage[]> {
  const rows = await db
    .select({
      clientId: messageLog.clientId,
      messageType: messageLog.messageType,
      dispatchedAt: messageLog.dispatchedAt,
      resultingJobRef: messageLog.resultingJobRef,
    })
    .from(messageLog)
    .where(
      and(eq(messageLog.ownerId, ownerId), isNotNull(messageLog.dispatchedAt)),
    );
  // dispatchedAt is non-null by the WHERE filter; assert the projection type.
  return rows as DispatchedMessage[];
}

/**
 * Story 3.4 (Task 3, FR13) — attribute a resulting booking back to the nudge that
 * most likely produced it (DEV DECISION: time-window heuristic, best-effort). Guarded
 * owner-scoped UPDATE: set `resulting_job_ref = jobId` on the SINGLE most-recent
 * dispatched `rebooking_nudge` for `(ownerId, clientId)` that is still UNATTRIBUTED
 * (`resulting_job_ref IS NULL`) and was dispatched on/after `sinceIso` (the caller's
 * ATTRIBUTION_WINDOW). Idempotent-safe: a nudge already carrying a ref is excluded, so a
 * second booking never steals a link; when no nudge qualifies the UPDATE matches zero
 * rows and returns undefined (a booking with no preceding nudge simply attributes nothing).
 * Owner-scoped (AD-8). The inner sub-select picks newest-first, LIMIT 1, so exactly one
 * row is ever touched.
 */
export async function attributeRebookingNudge(
  ownerId: string,
  clientId: string,
  jobId: string,
  sinceIso: string,
): Promise<MessageLog | undefined> {
  const target = db
    .select({ id: messageLog.id })
    .from(messageLog)
    .where(
      and(
        eq(messageLog.ownerId, ownerId),
        eq(messageLog.clientId, clientId),
        eq(messageLog.messageType, 'rebooking_nudge'),
        isNull(messageLog.resultingJobRef),
        isNotNull(messageLog.dispatchedAt),
        gte(messageLog.dispatchedAt, sinceIso),
      ),
    )
    .orderBy(desc(messageLog.dispatchedAt))
    .limit(1);

  const [row] = await db
    .update(messageLog)
    .set({ resultingJobRef: jobId })
    .where(
      // Re-assert `resulting_job_ref IS NULL` in the UPDATE itself (code-review 3.4):
      // the sub-select saw it null, but a concurrent booking may have attributed this
      // same newest nudge in the gap before this UPDATE lands. Guarding here makes the
      // write lose that race cleanly (0 rows, returns undefined) instead of clobbering
      // the first booking's attribution. Best-effort metric; this just prevents an
      // already-credited nudge from being silently re-pointed at a second job.
      and(
        eq(messageLog.ownerId, ownerId),
        inArray(messageLog.id, target),
        isNull(messageLog.resultingJobRef),
      ),
    )
    .returning();
  return row;
}

// --- Tokens (Story 3.1, AD-6 capability + AD-8 owner-scoped) ---
// SQL only (AD-1): signing/verification lives in lib/auth/clientToken.ts and the
// generate/resolve orchestration in lib/domain/booking.ts. These helpers just
// persist and look up the server-side token row that makes a credential revocable.

/**
 * The one live per-client token row, or undefined. Owner-scoped read (AD-8) on the
 * (owner, client, capability) unique key — the read half of ensureClientToken's
 * read-or-create: an existing link is returned verbatim (stable URL, D1), so a re-mint
 * never re-signs and can never resurrect a rotated/revoked value.
 */
export async function findClientToken(
  ownerId: string,
  clientId: string,
  capability: Token['capability'],
): Promise<Token | undefined> {
  const [row] = await db
    .select()
    .from(token)
    .where(
      and(
        eq(token.ownerId, ownerId),
        eq(token.clientId, clientId),
        eq(token.capability, capability),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Create the per-client token row ONLY if one does not already exist (race-safe first
 * mint). `onConflictDoNothing` + `returning()` yields the just-inserted row, or nothing
 * when a concurrent insert won the (owner, client, capability) unique key — in which
 * case we return the existing row. NEVER overwrites an existing link (that is
 * rotateClientTokenRow's job), so the URL stays stable on every re-mint (D1).
 */
export async function insertClientTokenIfAbsent(
  ownerId: string,
  clientId: string,
  tokenValue: string,
  capability: Token['capability'],
  nonce: string,
): Promise<Token> {
  const [row] = await db
    .insert(token)
    .values({ ownerId, clientId, tokenValue, capability, nonce })
    .onConflictDoNothing({
      target: [token.ownerId, token.clientId, token.capability],
    })
    .returning();
  if (row) return row;
  // Lost the first-mint race — the concurrent insert is the live link. It exists by
  // the unique-key conflict we just hit, so this read is guaranteed to find it.
  const existing = await findClientToken(ownerId, clientId, capability);
  return existing as Token;
}

/**
 * Rotate the per-client link: overwrite `token_value` + `nonce` with a freshly-signed,
 * fresh-nonce value (creating the row if absent). Durable revoke-and-reissue (D1): the
 * old `token_value` is replaced, so the previously-issued (possibly leaked) link stops
 * resolving forever, while the client gets a new working link. Owner-scoped (AD-8).
 */
export async function rotateClientTokenRow(
  ownerId: string,
  clientId: string,
  tokenValue: string,
  capability: Token['capability'],
  nonce: string,
): Promise<Token> {
  const [row] = await db
    .insert(token)
    .values({ ownerId, clientId, tokenValue, capability, nonce })
    .onConflictDoUpdate({
      target: [token.ownerId, token.clientId, token.capability],
      set: { tokenValue, nonce },
    })
    .returning();
  return row;
}

/**
 * Revoke the per-client link by deleting its row — verification then fails closed even
 * though the HMAC is still valid. Returns true if a row was removed. Owner-scoped (AD-8).
 * Durable (D1): because the token now embeds a persisted random nonce, a later re-mint
 * (ensureClientToken) creates a NEW nonce → a NEW value; the deleted link never returns.
 */
export async function deleteClientToken(
  ownerId: string,
  clientId: string,
  capability: Token['capability'],
): Promise<boolean> {
  const result = await db
    .delete(token)
    .where(
      and(
        eq(token.ownerId, ownerId),
        eq(token.clientId, clientId),
        eq(token.capability, capability),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Resolve a token row by its unique string — the ONE lookup that is NOT owner-scoped
 * by argument, because the token string is itself how we DISCOVER the owner (like
 * getOperatorByEmail resolving identity before scoping). The unique index makes this
 * O(1); the returned row carries the owner_id that every downstream query then filters
 * on. Returns undefined for an unknown/revoked token — the caller fails closed.
 */
export async function findTokenByValue(
  tokenValue: string,
): Promise<Token | undefined> {
  const [row] = await db
    .select()
    .from(token)
    .where(eq(token.tokenValue, tokenValue))
    .limit(1);
  return row;
}

// --- Public token (Story 4.1, AD-6) — the ONE client-less booking token ------
// Siblings of the per-client helpers above, for the lone public token whose
// client_id IS NULL. Because client_id is NULL, the (owner, client, capability)
// unique key cannot dedupe them (NULLs distinct) — so these use the PARTIAL unique
// index token_owner_public_uq (owner, capability WHERE client_id IS NULL) as the
// conflict arbiter (targetWhere), guaranteeing exactly one public token per owner.

/**
 * The one live public token row, or undefined. Owner-scoped read (AD-8) on the
 * client-less rows only (client_id IS NULL) — the read half of ensurePublicToken's
 * read-or-create, returning the existing link verbatim (stable URL, D1).
 */
export async function findPublicToken(
  ownerId: string,
  capability: Token['capability'],
): Promise<Token | undefined> {
  const [row] = await db
    .select()
    .from(token)
    .where(
      and(
        eq(token.ownerId, ownerId),
        isNull(token.clientId),
        eq(token.capability, capability),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Create the public token row ONLY if one does not already exist (race-safe first
 * mint). `onConflictDoNothing` on the PARTIAL index (targetWhere client_id IS NULL)
 * + `returning()` yields the just-inserted row, or nothing when a concurrent insert
 * won — in which case we return the existing row. NEVER overwrites (that is
 * rotatePublicTokenRow's job), so the URL stays stable on every re-mint (D1).
 */
export async function insertPublicTokenIfAbsent(
  ownerId: string,
  tokenValue: string,
  capability: Token['capability'],
  nonce: string,
): Promise<Token> {
  const [row] = await db
    .insert(token)
    .values({ ownerId, clientId: null, tokenValue, capability, nonce })
    .onConflictDoNothing({
      target: [token.ownerId, token.capability],
      where: isNull(token.clientId),
    })
    .returning();
  if (row) return row;
  // Lost the first-mint race — the concurrent insert is the live link. It exists by the
  // conflict we just hit; but if it was revoked in the interim (F3), re-mint upstream
  // rather than cast undefined to Token.
  const existing = await findPublicToken(ownerId, capability);
  if (!existing) {
    throw new Error('public token vanished after insert conflict (concurrent revoke)');
  }
  return existing;
}

/**
 * Rotate the public link: overwrite `token_value` + `nonce` with a freshly-signed,
 * fresh-nonce value (creating the row if absent) on the PARTIAL-index conflict.
 * Durable revoke-and-reissue (D1): the old `token_value` is replaced, so the
 * previously-issued (possibly leaked) link stops resolving forever. Owner-scoped.
 */
export async function rotatePublicTokenRow(
  ownerId: string,
  tokenValue: string,
  capability: Token['capability'],
  nonce: string,
  // Heal-only guard (F2): when provided, the upsert UPDATE only fires if the row still
  // holds this value — so a concurrent rotatePublicToken (which already changed it) WINS
  // and the heal becomes a no-op (returns undefined) instead of clobbering the fresh
  // link back to a stale value. Omitted for a genuine rotate (always overwrite).
  expectedTokenValue?: string,
): Promise<Token | undefined> {
  const [row] = await db
    .insert(token)
    .values({ ownerId, clientId: null, tokenValue, capability, nonce })
    .onConflictDoUpdate({
      target: [token.ownerId, token.capability],
      targetWhere: isNull(token.clientId),
      set: { tokenValue, nonce },
      ...(expectedTokenValue
        ? { setWhere: eq(token.tokenValue, expectedTokenValue) }
        : {}),
    })
    .returning();
  return row;
}

/**
 * Revoke the public link by deleting its (client-less) row — verification then fails
 * closed even though the HMAC is still valid. Returns true if a row was removed.
 * Owner-scoped (AD-8). Durable (D1): a later ensurePublicToken mints a NEW nonce → a
 * NEW value; the deleted link never returns.
 */
export async function deletePublicToken(
  ownerId: string,
  capability: Token['capability'],
): Promise<boolean> {
  const result = await db
    .delete(token)
    .where(
      and(
        eq(token.ownerId, ownerId),
        isNull(token.clientId),
        eq(token.capability, capability),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

// --- Public new-client booking request (Story 4.2, FR6/AR5/AR12) --------------
// The ONE transactional write for a stranger's self-serve submission: a provisional
// Client + a PendingRequest (NO capacity — AD-4/AR5) + at most one `link` Inquiry per
// token-visit session (AR12). All three are one atomic unit keyed on the per-render
// session nonce: the `link` inquiry insert is the idempotency CLAIM — if it conflicts
// (a double-tap of the same rendered form), the whole transaction rolls back, so one
// session yields EXACTLY one client + one pending request + one inquiry (never a
// duplicate stranger). SQL + the transaction live here (AD-1/AD-2), mirroring how
// commitBooking owns the capacity write; the domain core just calls this once.

export interface PublicBookingRequestInput {
  ownerId: string;
  name: string;
  phone: string;
  address: string | null;
  requestedDate: string; // 'YYYY-MM-DD', re-validated against the open set by the core
  sessionNonce: string; // the per-render visit nonce (AR12 dedup key)
}

export type PublicBookingRequestResult =
  | {
      created: true;
      client: Client;
      request: PendingRequest;
      // The `link` inquiry, or undefined when this session already logged one (a
      // different-day resubmit in the same visit still records a new request but no
      // second inquiry — AR12 one-per-session holds).
      inquiry: Inquiry | undefined;
    }
  // A repeat submit of the SAME (session, day) — idempotent no-op: nothing new was
  // written, the identical request already stands.
  | { created: false };

// Internal sentinel: thrown to roll the transaction back when this exact (owner,
// session, day) request already exists (a same-form same-day double-tap). Never
// escapes this fn.
class DuplicatePublicSession extends Error {}

/**
 * Atomically record a new-client public booking request (Story 4.2). Idempotency is
 * split across two keys so no legitimate request is ever lost while AR12 still holds:
 *   • Client + PendingRequest key on (owner, session_nonce, DATE): a true double-tap of
 *     the same rendered form + same day collapses to one; a back-button resubmit of a
 *     DIFFERENT day in the same session is recorded as a distinct request.
 *   • The `link` Inquiry keys on (owner, session_nonce) only (partial unique, source=
 *     'link'): at most one per token-visit session (AR12) — a different-day resubmit
 *     adds a request but NOT a second inquiry (it just conflicts and is skipped).
 * The provisional Client is `status:'provisional'`, `cadence:'one-time'` (the stranger
 * form collects no cadence; the column is NOT NULL with no DB default — AD-7 reserves
 * `provisional` for exactly this). NEVER inserts a Job and NEVER touches capacity (AR5).
 */
export async function insertPublicBookingRequest(
  input: PublicBookingRequestInput,
): Promise<PublicBookingRequestResult> {
  const { ownerId, name, phone, address, requestedDate, sessionNonce } = input;
  try {
    return await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(client)
        .values({
          ownerId,
          name,
          phone,
          address,
          cadence: 'one-time',
          status: 'provisional',
        })
        .returning();

      // The request is the idempotency CLAIM now (keyed on owner+nonce+date). A same-
      // session same-day conflict yields no row → roll the whole submission back (undo
      // the provisional client we just inserted) so a double-tap can never duplicate.
      const [req] = await tx
        .insert(pendingRequest)
        .values({ ownerId, clientId: c.id, date: requestedDate, sessionNonce })
        .onConflictDoNothing({
          target: [pendingRequest.ownerId, pendingRequest.sessionNonce, pendingRequest.date],
        })
        .returning();

      if (!req) throw new DuplicatePublicSession();

      // AR12: one `link` inquiry per session (partial unique, source='link'). On a
      // different-day resubmit within the same session this conflicts → no row → we do
      // NOT roll back (the new request must stand); the first inquiry already counts.
      const [inq] = await tx
        .insert(inquiry)
        .values({ ownerId, clientId: c.id, source: 'link', sessionNonce })
        .onConflictDoNothing({
          target: [inquiry.ownerId, inquiry.sessionNonce],
          where: eq(inquiry.source, 'link'),
        })
        .returning();

      return { created: true, client: c, request: req, inquiry: inq };
    });
  } catch (err) {
    if (err instanceof DuplicatePublicSession) return { created: false };
    throw err;
  }
}

// --- Approval queue (Story 4.3, FR36/AD-2/AD-8) -------------------------------
// The operator's pending-request queue: list the owner's `pending` rows (joined to
// the provisional client for the row display), re-read one under the mutation, and
// the guarded status transition that is the concurrency/idempotency backstop for the
// STATUS field (the capacity backstop is commitBooking's advisory lock). Capacity is
// NEVER touched here — approve routes through commitBooking (AD-2); this module only
// reads the queue and moves the status flag.

/** A pending-request row plus its provisional client's contact fields — the shape the queue surface renders (no second lookup). */
export interface PendingRequestListItem {
  id: string;
  clientId: string;
  date: string;
  createdAt: string;
  clientName: string;
  clientPhone: string;
  clientAddress: string | null;
}

/**
 * List the owner's PENDING new-client requests (Story 4.3, AC1), joined to the
 * provisional client for name/phone/address. The owner_id filter is on the VALUE
 * (AD-8) on BOTH the request AND the join (mirrors listJobs), so no other tenant's
 * row is reachable through this path. Oldest-first (FIFO queue): the operator works
 * the longest-waiting stranger first. Excludes approved/declined/withdrawn.
 */
export async function listPendingRequests(
  ownerId: string,
): Promise<PendingRequestListItem[]> {
  return db
    .select({
      id: pendingRequest.id,
      clientId: pendingRequest.clientId,
      date: pendingRequest.date,
      createdAt: pendingRequest.createdAt,
      clientName: client.name,
      clientPhone: client.phone,
      clientAddress: client.address,
    })
    .from(pendingRequest)
    .innerJoin(
      client,
      and(eq(pendingRequest.clientId, client.id), eq(client.ownerId, ownerId)),
    )
    .where(
      and(
        eq(pendingRequest.ownerId, ownerId),
        eq(pendingRequest.status, 'pending'),
      ),
    )
    .orderBy(asc(pendingRequest.createdAt), asc(pendingRequest.id));
}

/**
 * Read one pending-request row by id, owner-scoped (UUID-guarded like getClient).
 * The approve action re-reads it under the mutation to recover clientId/date and to
 * re-check it is still pending. Both predicates are required: an id that belongs to a
 * different owner returns undefined, never another tenant's row.
 */
export async function getPendingRequest(
  ownerId: string,
  id: string,
): Promise<PendingRequest | undefined> {
  // A non-UUID id can never match a real row — treat as "not found" rather than
  // letting Postgres throw an invalid-uuid error into the action.
  if (!UUID_RE.test(id)) return undefined;
  const [row] = await db
    .select()
    .from(pendingRequest)
    .where(and(eq(pendingRequest.ownerId, ownerId), eq(pendingRequest.id, id)))
    .limit(1);
  return row;
}

/**
 * Guarded status transition (Story 4.3) — the concurrency/idempotency backstop for
 * the STATUS field. UPDATE status=`to` WHERE owner=ownerId AND id=id AND status=`from`,
 * `.returning()` the row or undefined. A request already moved off `from` (already
 * approved/declined) matches ZERO rows → undefined, which the action treats as a stale
 * no-op — never a double transition. Owner-scoped (AD-8); a non-UUID id never matches.
 */
export async function setPendingRequestStatus(
  ownerId: string,
  id: string,
  from: PendingRequest['status'],
  to: PendingRequest['status'],
): Promise<PendingRequest | undefined> {
  if (!UUID_RE.test(id)) return undefined;
  const [row] = await db
    .update(pendingRequest)
    .set({ status: to })
    .where(
      and(
        eq(pendingRequest.ownerId, ownerId),
        eq(pendingRequest.id, id),
        eq(pendingRequest.status, from),
      ),
    )
    .returning();
  return row;
}

// --- Manual inquiry log (Story 4.4, FR37/AR12, AD-8 owner-scoped) --------------
// The operator's MANUAL inquiry log — phone/walk-in/referral/other. Distinct from the
// 4.2 auto-`link` path (insertPublicBookingRequest): a manual log carries NO visit
// session (session_nonce = null) and an OPTIONAL clientId (an anonymous verbal inquiry
// references no client record; a known-contact log references an existing one). Owner-
// scoped on write and read (AD-8). The `link` source is NEVER written through here — it
// is server-only provenance (AR12), minted solely inside the 4.2 submission transaction;
// the action layer whitelists the four manual sources before calling this.

export interface InsertInquiryInput {
  ownerId: string;
  source: Inquiry['source'];
  // Optional: a bare manual log has no client (null); a known-contact log references one.
  clientId?: string | null;
}

/**
 * Insert one manual inquiry (Story 4.4). `session_nonce` is ALWAYS null (a manual log
 * carries no token-visit session — that is the 4.2 `link` path's dedup key). `clientId`
 * defaults to null when absent. Owner-scoped (AD-8). Returns the inserted row.
 */
export async function insertInquiry(input: InsertInquiryInput): Promise<Inquiry> {
  const { ownerId, source, clientId = null } = input;
  const [row] = await db
    .insert(inquiry)
    .values({ ownerId, source, clientId, sessionNonce: null })
    .returning();
  return row;
}

/** The minimal Inquiry projection the distinct-inquiry derive (AR12/FR24) + tests read. */
export interface InquiryListItem {
  id: string;
  source: string;
  clientId: string | null;
  createdAt: string;
}

/**
 * List the owner's inquiries (both auto-`link` and manual), newest first. Owner-scoped
 * on the VALUE (AD-8), so no other tenant's inquiry is reachable. Only the four fields
 * the distinct-inquiry denominator needs are projected — no client join.
 */
export async function listInquiries(ownerId: string): Promise<InquiryListItem[]> {
  return db
    .select({
      id: inquiry.id,
      source: inquiry.source,
      clientId: inquiry.clientId,
      createdAt: inquiry.createdAt,
    })
    .from(inquiry)
    .where(eq(inquiry.ownerId, ownerId))
    .orderBy(desc(inquiry.createdAt), asc(inquiry.id));
}
