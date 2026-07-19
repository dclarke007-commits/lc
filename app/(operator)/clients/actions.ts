'use server';

// Sole write path = Server Actions (AD-1). Verb-first names `createClient` /
// `editClient`. Client CRUD is NOT capacity-consuming, so it does NOT route
// through commitBooking (that is booking, Story 1.4).
//
// Return contract (AR15): { ok, data } | { ok: false, reason }. No thrown error
// crosses the boundary; no silent catch. Only lib/db speaks SQL (AD-1) — this
// action reaches it directly; surfaces never do.

import { requireOwnerId } from '@/lib/auth/requireOwnerId';
import { cache } from 'react';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { client } from '@/lib/db/schema';
import type { Client } from '@/lib/db/schema';
import {
  listClients,
  getClient,
  listJobsForMetrics,
  getCapacitySettings,
  getMessageTemplates,
} from '@/lib/db/queries';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import { goneCold, expectedNextDate, type DeriveJob } from '@/lib/domain/derive';
import {
  compose,
  winBackDispatchNonce,
  type MessageDraft,
} from '@/lib/domain/compose';
import { deepLink, type DeliveryChannel } from '@/lib/delivery/deeplink';
import { recordDispatch } from '@/app/(operator)/draft/actions';
import { localDateKey } from '@/lib/domain/clock';
import {
  DEFAULT_CAPACITY,
  type CapacityConfig,
} from '@/lib/domain/capacityConfig';
import { DEFAULT_TEMPLATE_BODIES } from '@/lib/domain/messageTemplateConfig';

// The four allowed cadence values (FR15). Kept in lockstep with the pgEnum.
const CADENCES = ['weekly', 'biweekly', 'monthly', 'one-time'] as const;
type Cadence = (typeof CADENCES)[number];

function isCadence(v: string): v is Cadence {
  return (CADENCES as readonly string[]).includes(v);
}

/**
 * Validate + normalise the shared client fields. Minimal rules (NFR7): name and
 * phone must be non-empty once trimmed; cadence must be one of the four. On any
 * failure returns a machine-readable reason and the action writes NOTHING (AC3).
 */
function readFields(formData: FormData):
  | { ok: true; name: string; phone: string; address: string | null; cadence: Cadence }
  | { ok: false; reason: string } {
  const name = String(formData.get('name') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const addressRaw = String(formData.get('address') ?? '').trim();
  const cadence = String(formData.get('cadence') ?? '').trim();

  if (!name) return { ok: false, reason: 'name-required' };
  if (!phone) return { ok: false, reason: 'phone-required' };
  if (!isCadence(cadence)) return { ok: false, reason: 'cadence-invalid' };

  return { ok: true, name, phone, address: addressRaw || null, cadence };
}

/**
 * Owner-scoped read for the RSC list surface. The surface calls this action
 * instead of importing lib/db (dependency direction: surfaces → actions → db).
 * owner_id is resolved here, so the filter value is always applied.
 */
export async function listOwnerClients(): Promise<Client[]> {
  const ownerId = await requireOwnerId();
  return listClients(ownerId);
}

/** Owner-scoped single read for the edit surface (populates the form). */
export async function getOwnerClient(id: string): Promise<Client | undefined> {
  const ownerId = await requireOwnerId();
  return getClient(ownerId, id);
}

export async function createClient(
  formData: FormData,
): Promise<ActionResult<Client>> {
  const fields = readFields(formData);
  if (!fields.ok) return fail(fields.reason);

  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch (err) {
    // AR15: fail closed, but leave a trace in the platform logs.
    console.error('[clients] requireOwnerId failed', err);
    return fail('owner-unresolved');
  }

  try {
    const [row] = await db
      .insert(client)
      .values({
        ownerId,
        name: fields.name,
        phone: fields.phone,
        address: fields.address,
        cadence: fields.cadence,
        status: 'active', // operator-added clients are active (provisional = Epic 4)
      })
      .returning();
    revalidatePath('/clients');
    return ok(row);
  } catch (err) {
    // AR15: fail closed, but leave a trace in the platform logs.
    console.error('[clients] client write failed', err);
    return fail('client-write-failed');
  }
}

export async function editClient(
  formData: FormData,
): Promise<ActionResult<Client>> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return fail('id-required');

  const fields = readFields(formData);
  if (!fields.ok) return fail(fields.reason);

  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch (err) {
    // AR15: fail closed, but leave a trace in the platform logs.
    console.error('[clients] requireOwnerId failed', err);
    return fail('owner-unresolved');
  }

  try {
    // UPDATE scoped by owner_id AND id: a row outside this owner is never
    // touched — the WHERE matches nothing and `returning()` comes back empty.
    const [row] = await db
      .update(client)
      .set({
        name: fields.name,
        phone: fields.phone,
        address: fields.address,
        cadence: fields.cadence,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(client.ownerId, ownerId), eq(client.id, id)))
      .returning();

    if (!row) return fail('client-not-found');
    revalidatePath('/clients');
    return ok(row);
  } catch (err) {
    // AR15: fail closed, but leave a trace in the platform logs.
    console.error('[clients] client write failed', err);
    return fail('client-write-failed');
  }
}

// --- Story 3.6: win-back on a gone-cold client (wires 3.5 → 2.1/2.2/2.3) ---------
//
// This story BUILDS only the thin entry point + `draftWinBack`/`sendWinBack` callers.
// The gone-cold input is Story 3.5's PURE view-time derivation (derive.goneCold), read
// here in the action layer over canonical rows (AD-7) — never re-derived, never stored.
// A win-back is a CHECK-IN: no slot/amount to sell, so compose gets an empty slot + null
// amount (unfilled {slot}/{amount} blank out per Story 2.1 AC3) and NO booking link is
// appended (contrast Story 3.3's rebooking, FR11). Dispatch rides Story 2.3's idempotent
// recordDispatch — no new compose/template/adapter/log path (AD-5).

/** A client list row annotated with the Story-3.5 view-time gone-cold derivation. */
export interface ClientRow extends Client {
  goneCold: boolean;
}

/** The operator's persisted capacity, or the domain defaults on first-run (AR16). Only the timezone matters here (anchors "today", AD-9). */
async function resolveConfig(ownerId: string): Promise<CapacityConfig> {
  const settings = await getCapacitySettings(ownerId);
  return settings
    ? {
        workingDays: settings.workingDays,
        perDayCap: settings.perDayCap,
        weeklyCeiling: settings.weeklyCeiling,
        defaultJobPriceCents: settings.defaultJobPriceCents,
        timezone: settings.timezone,
      }
    : DEFAULT_CAPACITY;
}

/**
 * Per-request de-duped read of the owner's jobs (Epic-5 retro perf debt, Story 6.1).
 * `listOwnerClientsWithLapse` (the client list) and `deriveWinBack` (the win-back
 * panel) both run during the SAME /clients render; React `cache()` collapses their
 * two reads into one DB round-trip per request. It is request-scoped (NOT `use cache`
 * — an operator surface stays live, AD-13), so a later render re-reads fresh rows.
 */
const jobsForMetrics = cache((ownerId: string) => listJobsForMetrics(ownerId));

/** Group the owner's jobs into per-client DeriveJob projections (date + completion). */
function jobsByClient(
  jobs: { clientId: string; date: string; completion: string }[],
): Map<string, DeriveJob[]> {
  const map = new Map<string, DeriveJob[]>();
  for (const j of jobs) {
    const list = map.get(j.clientId) ?? [];
    list.push({ date: j.date, completion: j.completion });
    map.set(j.clientId, list);
  }
  return map;
}

/**
 * Owner-scoped client list for the RSC surface, each annotated with the Story-3.5
 * `goneCold` derivation (AC1 entry point). goneCold is computed HERE on read from the
 * owner's canonical jobs + each client's cadence (AD-7) — no stored flag, no cron. The
 * surface reads the boolean; it never imports derive or lib/db.
 */
export async function listOwnerClientsWithLapse(): Promise<ClientRow[]> {
  const ownerId = await requireOwnerId();
  const clients = await listClients(ownerId);

  // Fail-OPEN on the lapse annotation only (code review 2026-07-17): the derivation reads
  // below — a corrupt settings.timezone makes localDateKey's Intl.DateTimeFormat throw, a
  // listJobs read can fault — must NOT 500 the whole /clients surface (getWinBackDraft
  // already guards its own copy of this, AD-8/AR15). On any throw, render the client list
  // UN-annotated (goneCold: false) rather than taking the page down.
  try {
    const config = await resolveConfig(ownerId);
    const today = localDateKey(new Date(), config.timezone);
    const byClient = jobsByClient(await jobsForMetrics(ownerId));
    return clients.map((c) => ({
      ...c,
      goneCold: goneCold(c.cadence, byClient.get(c.id) ?? [], today),
    }));
  } catch (err) {
    console.error('[clients] lapse annotation failed (fail-open, unannotated list)', err);
    return clients.map((c) => ({ ...c, goneCold: false }));
  }
}

/** The gone-cold gate + composed draft + per-cold-spell dispatch nonce, from ONE set of reads. */
interface WinBackContext {
  draft: MessageDraft;
  nonce: string;
}

/**
 * Derive the win-back context for ONE client (code review 2026-07-17): the gone-cold gate,
 * the composed `win_back` check-in draft, AND the per-cold-spell dispatch nonce — all from
 * ONE set of canonical reads (AD-7). Owner-scoped, fail-closed (AD-8). Both getWinBackDraft
 * (the surface read) and sendWinBack (the send tap) route through here, so the gate and the
 * nonce are derived from the SAME rows — no divergence, no double gone-cold computation.
 */
async function deriveWinBack(
  clientId: string,
): Promise<ActionResult<WinBackContext>> {
  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch (err) {
    console.error('[clients] requireOwnerId failed (win-back)', err);
    return fail('owner-unresolved');
  }

  // Fail CLOSED (mirrors getRebookProposal): any throw from the reads below — a corrupt
  // settings.timezone makes localDateKey's Intl.DateTimeFormat throw, a db read can fault —
  // must not cross this typed boundary as a 500 (AR15).
  try {
    const c = await getClient(ownerId, clientId);
    if (!c) return fail('client-not-found');

    // Gone-cold gate (AD-7): the win-back only applies to a currently-cold client. Re-derived
    // from canonical rows on the tap — the same view-time computation the list rendered.
    const config = await resolveConfig(ownerId);
    const today = localDateKey(new Date(), config.timezone);
    const clientJobs =
      jobsByClient(await jobsForMetrics(ownerId)).get(clientId) ?? [];
    if (!goneCold(c.cadence, clientJobs, today)) return fail('not-gone-cold');

    // The operator's win_back copy, or the domain default when unseeded (mirrors the
    // rebooking/confirmation drafts). compose/resolveTemplate stay UNCHANGED (2.1/2.2). A
    // check-in has no slot/price → empty slot + null amount blank the {slot}/{amount} tokens.
    const templates = await getMessageTemplates(ownerId);
    const body =
      templates.find((t) => t.type === 'win_back')?.body ??
      DEFAULT_TEMPLATE_BODIES.win_back;

    const draft = compose(
      { name: c.name, phone: c.phone },
      '',
      null,
      { type: 'win_back', body },
    );

    // Per-cold-spell idempotency key (code review 2026-07-17): gone-cold passed above, so
    // expectedNextDate is non-null. Keying the nonce on it — not just clientId — makes a
    // fresh cold spell (a client who completed a new job then relapsed) advance to a NEW
    // nonce → a NEW dispatch row, instead of collapsing every future win-back into one
    // lifetime row. A re-tap WITHIN the same spell keeps the same nonce (idempotent).
    const expected = expectedNextDate(c.cadence, clientJobs);
    const nonce = winBackDispatchNonce(clientId, expected ?? '');

    return ok({ draft, nonce });
  } catch (err) {
    console.error('[clients] getWinBackDraft failed (fail-closed)', err);
    return fail('win-back-failed');
  }
}

/**
 * The win-back check-in draft for ONE gone-cold client (AC1) — a thin read over
 * deriveWinBack returning only the composed MessageDraft (the surface renders it; the
 * dispatch nonce stays internal to the send path). Owner-scoped, fail-closed (AD-8),
 * re-derives gone-cold server-side (never trusts the surface): a hand-typed
 * ?winback=<activeClientId> yields `not-gone-cold`. STOPS at a MessageDraft (AD-5:
 * compose ≠ deliver): no send, no MessageLog, no dispatch.
 */
export async function getWinBackDraft(
  clientId: string,
): Promise<ActionResult<MessageDraft>> {
  const res = await deriveWinBack(clientId);
  if (!res.ok) return res;
  return ok(res.data.draft);
}

/**
 * SEND the win-back check-in (AC2), logging the dispatch via the SHARED Story 2.3 path —
 * NOT a second dispatch path. Re-derives the SAME context getWinBackDraft composes (so the
 * gone-cold gate holds at send time too) plus the per-cold-spell dispatch nonce, builds the
 * wa.me/sms deep link, then records ONE dispatched `win_back` MessageLog row keyed on that
 * nonce (`winback:<clientId>:<expectedNextDate>` — idempotent within a cold spell: a re-tap
 * re-opens the chat but never double-logs; a fresh spell logs anew, AD-5). The link is built
 * BEFORE logging (Story 2.3 P1 — no phantom dispatch): a phoneless tap never stamps
 * dispatched_at. On success redirect()s to the deep link so the single tap both LOGS and
 * OPENS. No autonomous send (FR19) — only the operator's tap fires.
 */
export async function sendWinBack(formData: FormData): Promise<void> {
  const clientId = String(formData.get('client') ?? '').trim();
  const channel: DeliveryChannel =
    String(formData.get('channel') ?? '') === 'sms' ? 'sms' : 'whatsapp';

  const back = (extra: string): string =>
    `/clients?winback=${encodeURIComponent(clientId)}${extra}`;

  // Re-derive the SAME context the panel rendered (gone-cold gate + draft + per-cold-spell
  // nonce), all from one set of reads. compose ≠ deliver (AD-5): this read carries no side
  // effect. A non-cold / missing client yields the same graceful reason the panel shows.
  const ctxRes = await deriveWinBack(clientId);
  if (!ctxRes.ok) redirect(back(`&error=${encodeURIComponent(ctxRes.reason)}`));
  const { draft, nonce } = ctxRes.data;

  // Build the deliverable link BEFORE logging (Story 2.3 P1 — no phantom dispatch): only
  // stamp dispatched_at once a real link exists, so a phoneless tap never inflates fatigue.
  const link = deepLink(draft, channel);
  if (!link) redirect(back('&error=no-phone'));

  // The SHARED dispatch-logging path (Story 2.3): ONE row keyed on the per-cold-spell nonce,
  // message_type = win_back, dispatched_at stamped once (idempotent on re-tap within spell).
  const res = await recordDispatch(clientId, 'win_back', nonce);
  if (!res.ok) redirect(back(`&error=${encodeURIComponent(res.reason)}`));

  redirect(link);
}
