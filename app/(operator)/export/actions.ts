'use server';

// Story 6.4 — CSV data export (FR35, AR17/AR9). "So the operator owns the data, not
// rents it." A Server Action is the export path (AR17); SQL lives only in lib/db (AD-1),
// serialization only in lib/domain/csv (AD-7). Every read is owner-scoped on the VALUE
// (AD-8/AR9) — the export returns ONLY the signed-in owner's rows. Return contract
// (AR15): { ok, data } | { ok: false, reason } — no thrown error crosses the boundary.
//
// "Streaming" (AR17) here means the action produces the full CSV text for the owner's
// rows and hands it to the client, which triggers a browser download (ExportButtons).
// v1 is a single operator with modest row counts, so a materialized string is correct
// and simple; a true chunked stream would be a Route Handler and is not needed yet.

import { requireOwnerId } from '@/lib/auth/requireOwnerId';
import {
  listClients,
  listJobsForExport,
} from '@/lib/db/queries';
import { getOwnerCapacity } from '@/app/(operator)/settings/actions';
import { toCsv } from '@/lib/domain/csv';
import { localDateKey } from '@/lib/domain/clock';
import { ok, fail, type ActionResult } from '@/lib/domain/result';

/** The downloadable payload the client turns into a file. `content` is the RFC-4180
 *  CSV text; `filename` is date-stamped in the operator's local timezone (AD-9). */
export interface CsvExport {
  filename: string;
  content: string;
}

/** Resolve the owner FAIL-CLOSED into the AR15 contract (a user-triggered export must
 *  never surface a raw 500 — it returns a reason the UI can show). */
async function resolveOwner(): Promise<
  { ok: true; ownerId: string } | { ok: false; reason: string }
> {
  try {
    return { ok: true, ownerId: await requireOwnerId() };
  } catch (err) {
    console.error('[export] requireOwnerId failed', err);
    return { ok: false, reason: 'owner-unresolved' };
  }
}

/** Today's operator-local date-key, for the export filename. */
async function localToday(): Promise<string> {
  const config = await getOwnerCapacity(); // carries the operator tz (AD-9)
  return localDateKey(new Date(), config.timezone);
}

/**
 * Export the owner's CLIENTS as CSV (FR35). Owner-scoped read (AR9); serialized via the
 * pure `toCsv` (RFC-4180 escaping, so a name/address with a comma or newline never
 * corrupts a column). Columns are the human-meaningful client record — the id is
 * included so a power user can join it against the jobs export. Fail-closed (AR15).
 */
export async function exportClientsCsv(): Promise<ActionResult<CsvExport>> {
  const owner = await resolveOwner();
  if (!owner.ok) return fail(owner.reason);

  try {
    const clients = await listClients(owner.ownerId);
    const content = toCsv(
      ['id', 'name', 'phone', 'address', 'cadence', 'status', 'created_at'],
      clients.map((c) => [
        c.id,
        c.name,
        c.phone,
        c.address, // null → empty field (escapeCsvField)
        c.cadence,
        c.status,
        c.createdAt,
      ]),
    );
    return ok({ filename: `clients-${await localToday()}.csv`, content });
  } catch (err) {
    console.error('[export] clients export failed', err);
    return fail('export-failed');
  }
}

/**
 * Export the owner's JOBS as CSV (FR35). Owner-scoped read (AR9, both the job filter and
 * the client join). Carries the client NAME (not just the id), the scheduled day,
 * lifecycle + payment state, the frozen `price_cents` (integer cents — the operator owns
 * their financial history), and the timestamps. Serialized via `toCsv`. Fail-closed (AR15).
 */
export async function exportJobsCsv(): Promise<ActionResult<CsvExport>> {
  const owner = await resolveOwner();
  if (!owner.ok) return fail(owner.reason);

  try {
    const jobs = await listJobsForExport(owner.ownerId);
    const content = toCsv(
      [
        'id',
        'client_name',
        'date',
        'completion',
        'payment',
        'price_cents',
        'completed_at',
        'created_at',
      ],
      jobs.map((j) => [
        j.id,
        j.clientName,
        j.date,
        j.completion,
        j.payment,
        j.priceCents,
        j.completedAt, // null → empty field
        j.createdAt,
      ]),
    );
    return ok({ filename: `jobs-${await localToday()}.csv`, content });
  } catch (err) {
    console.error('[export] jobs export failed', err);
    return fail('export-failed');
  }
}
