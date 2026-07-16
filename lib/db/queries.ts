// Owner-scoped query helpers. AD-8: the owner_id FILTER (the value, not just the
// column) is present in every query from v1. Since v1 is single-operator, the
// value is resolved from the one seeded operator row. Later stories add a value
// SOURCE (e.g. from the session), never a query retrofit.

import { eq, and, asc, desc, gte } from 'drizzle-orm';
import { db } from './client';
import {
  operator,
  client,
  capacitySettings,
  job,
  messageTemplate,
} from './schema';
import type {
  Operator,
  Client,
  CapacitySettingsRow,
  Job,
  MessageTemplate,
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

/** The minimal Job projection derive-on-read needs (Story 1.7): date + status. */
export interface JobDateStatus {
  date: string;
  completion: string;
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
