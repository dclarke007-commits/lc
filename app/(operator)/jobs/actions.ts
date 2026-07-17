'use server';

// Sole write path = Server Actions (AD-1). These verb-first actions call the
// lifecycle domain service — the ONE writer of Job.completion (AD-10). Typed AR15
// return { ok, data } | { ok:false, reason }; no thrown error crosses the
// boundary, no silent catch. The surface calls THIS (never lib/db or lifecycle
// directly): surfaces → actions → domain → db.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  getOwnerId,
  listJobs,
  getJob,
  getClient,
  getCapacitySettings,
  getMessageTemplates,
  listJobsFrom,
  listDispatchedMessages,
  findClientToken,
  type JobListItem,
} from '@/lib/db/queries';
import type { Job } from '@/lib/db/schema';
import { ok, fail, type ActionResult } from '@/lib/domain/result';
import {
  markCompleted,
  markNoShow,
  markCancelled,
  correctOutcome as correctOutcomeLifecycle,
} from '@/lib/domain/lifecycle';
import { reschedule } from '@/lib/domain/capacity';
import { proposeRebookSlot, needsRebookNudge } from '@/lib/domain/derive';
import {
  compose,
  rebookingDispatchNonce,
  type MessageDraft,
} from '@/lib/domain/compose';
import { deepLink, type DeliveryChannel } from '@/lib/delivery/deeplink';
import { recordDispatch } from '@/app/(operator)/draft/actions';
import { ensureClientToken } from '@/lib/domain/booking';
import { bookingBaseUrl } from '@/lib/domain/urls';
import { localDateKey, weekRangeOfDate, formatDateKey } from '@/lib/domain/clock';
import {
  DEFAULT_CAPACITY,
  type CapacityConfig,
} from '@/lib/domain/capacityConfig';
import { DEFAULT_TEMPLATE_BODIES } from '@/lib/domain/messageTemplateConfig';

/**
 * A jobs-surface row plus the Story 3.4 view-time nudge predicate (AC1). The surface
 * (zero domain import, AD-1) reads `needsRebookNudge`; the derive runs HERE in the
 * action layer over canonical rows (AD-7): no stored `nudge_due` flag.
 */
export interface JobRow extends JobListItem {
  needsRebookNudge: boolean;
}

/** Owner's jobs for the jobs surface (owner-scoped read), annotated with the nudge flag. */
export async function getOwnerJobs(): Promise<JobRow[]> {
  // Fail LOUD, not silent: an unresolved owner is a deploy-invariant violation.
  // Log and rethrow rather than masking it behind an empty list (a silent []
  // would read as "no jobs"). The RSC render surface shows the error boundary.
  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[jobs] getOwnerId failed (read path)', err);
    throw new Error('owner-unresolved');
  }
  const jobs = await listJobs(ownerId);
  // The two facts the predicate needs (AD-7): the jobs and the owner's dispatched
  // messages. needsRebookNudge flips false once a rebooking_nudge for the client is
  // dispatched at/after that job's completed_at — computed on read, never stored.
  const dispatched = await listDispatchedMessages(ownerId);
  return jobs.map((j) => ({
    ...j,
    needsRebookNudge: needsRebookNudge(
      { clientId: j.clientId, completion: j.completion, completedAt: j.completedAt },
      dispatched,
    ),
  }));
}

/**
 * NORMAL mark of a booked job's outcome (FR40). Reads jobId + outcome (must be
 * `completed` or `no-show`), resolves the owner fail-closed, then delegates to
 * lifecycle.markCompleted/markNoShow. Any other outcome is illegal-transition.
 */
export async function markOutcome(
  formData: FormData,
): Promise<ActionResult<Job>> {
  const jobId = String(formData.get('jobId') ?? '').trim();
  const outcome = String(formData.get('outcome') ?? '').trim();

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[jobs] getOwnerId failed', err);
    return fail('owner-unresolved');
  }

  let result: ActionResult<Job>;
  if (outcome === 'completed') {
    result = await markCompleted(ownerId, jobId);
  } else if (outcome === 'no-show') {
    result = await markNoShow(ownerId, jobId);
  } else {
    // Not a valid NORMAL mark — reject before touching the domain.
    return fail('illegal-transition');
  }
  if (!result.ok) return result;

  revalidatePath('/jobs');
  return ok(result.data);
}

/**
 * Explicit operator CORRECTION path (AD-10). Reads jobId + the target `to`,
 * resolves the owner fail-closed, and delegates to lifecycle.correctOutcome.
 * Legality is decided SOLELY by the lifecycle whitelist — this action adds no
 * separate source-state guard, so it does not itself guarantee the row is
 * terminal/completed; an illegal `to` comes back as illegal-transition. The
 * correction UI only surfaces this on terminal/completed rows.
 */
export async function correctOutcome(
  formData: FormData,
): Promise<ActionResult<Job>> {
  const jobId = String(formData.get('jobId') ?? '').trim();
  const to = String(formData.get('to') ?? '').trim();

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[jobs] getOwnerId failed', err);
    return fail('owner-unresolved');
  }

  const result = await correctOutcomeLifecycle(ownerId, jobId, to);
  if (!result.ok) return result;

  revalidatePath('/jobs');
  return ok(result.data);
}

/**
 * Cancel a booked job (FR41). Reads jobId, resolves the owner fail-closed, and
 * delegates to lifecycle.markCancelled (booked→cancelled). The freed slot
 * reappears in capacity automatically — room-left is derived-on-read (AD-7), so
 * there is no counter to adjust here. Typed AR15.
 */
export async function cancelJob(
  formData: FormData,
): Promise<ActionResult<Job>> {
  const jobId = String(formData.get('jobId') ?? '').trim();

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[jobs] getOwnerId failed', err);
    return fail('owner-unresolved');
  }

  const result = await markCancelled(ownerId, jobId);
  if (!result.ok) return result;

  revalidatePath('/jobs');
  return ok(result.data);
}

/**
 * Reschedule a booked job to a new date (FR41), atomically under the cap check.
 * Reads jobId + newDate, resolves the owner fail-closed, and delegates the
 * transaction + destination-week lock + cap re-check + move to capacity.reschedule
 * (AD-12/AD-2/AD-3). Writes nothing on reject. Typed AR15.
 */
export async function rescheduleJob(
  formData: FormData,
): Promise<ActionResult<Job>> {
  const jobId = String(formData.get('jobId') ?? '').trim();
  const newDate = String(formData.get('newDate') ?? '').trim();

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[jobs] getOwnerId failed', err);
    return fail('owner-unresolved');
  }

  const result = await reschedule({ ownerId, jobId, newDate });
  if (!result.ok) return result;

  revalidatePath('/jobs');
  return ok(result.data);
}

/** The rebooking proposal: the proposed slot (formatted, or null) + its ready draft. */
export interface RebookProposal {
  slot: string | null; // {slot} display string ("Mon, Aug 3"), or null when none open
  draft: MessageDraft | null; // the composed rebooking_nudge draft, or null when no slot
}

// Only a booked (upcoming) or completed job may be rebooked (FR10). The UI gate is
// cosmetic; the actions below enforce this so a hand-typed ?rebook=<cancelledId> can
// never produce a draft (code-review P2).
const REBOOKABLE_COMPLETIONS = new Set(['booked', 'completed']);

// bookingBaseUrl now lives in lib/domain/urls.ts (shared with Story 4.1's public
// link surface) — imported above.

/**
 * Story 3.3 — the one-tap rebooking PROPOSAL (FR10/FR11), mirroring
 * getConfirmationDraft's read-and-compose shape. Owner-scoped (AD-8, fail-closed).
 * Loads the tapped Job, its client, the operator capacity config (or domain defaults),
 * and this-week-forward jobs, then derives the proposed slot via the PURE
 * derive.proposeRebookSlot (cadence interval past the anchor, or soonest-open for a
 * one-time client; nearest-open alternative when the ideal is full — AC1/AC3). No slot
 * in range → ok({ slot:null, draft:null }) (the surface renders "no open slot", never
 * an error, AC3). Otherwise composes the operator's `rebooking_nudge` template (Story
 * 2.1, default body if unseeded) into a MessageDraft (Story 2.2, unchanged) and APPENDS
 * the client's stable per-client booking link (Story 3.1) to the body — satisfying FR11
 * without growing the template contract or leaking a raw {token}. This action STOPS at a
 * MessageDraft (AD-5: compose ≠ deliver): no send, no MessageLog, no dispatch. Typed AR15.
 */
export async function getRebookProposal(
  jobId: string,
): Promise<ActionResult<RebookProposal>> {
  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[jobs] getOwnerId failed (rebook)', err);
    return fail('owner-unresolved');
  }

  // Fail CLOSED (code-review P1), mirroring resolveBookingView: after owner resolution
  // ANY throw from the reads below — a corrupt settings.timezone makes localDateKey's
  // Intl.DateTimeFormat throw RangeError, a db read can fault — must NOT cross this
  // typed boundary as a 500 (AR15). Log and return a generic operator reason.
  try {
    const job = await getJob(ownerId, jobId);
    if (!job) return fail('job-not-found');

    // Enforce rebookable state (code-review P2): the surface's REBOOKABLE gate is
    // cosmetic — a hand-typed ?rebook=<cancelledOrNoShowId> must not yield a draft.
    if (!REBOOKABLE_COMPLETIONS.has(job.completion)) return fail('not-rebookable');

    const client = await getClient(ownerId, job.clientId);
    if (!client) return fail('client-not-found');

    // Config = the operator's persisted capacity, or the domain defaults on first-run
    // (single source, AR16). The timezone anchors "today" so the proposal never lands
    // on a past day (AD-9).
    const settings = await getCapacitySettings(ownerId);
    const config: CapacityConfig = settings
      ? {
          workingDays: settings.workingDays,
          perDayCap: settings.perDayCap,
          weeklyCeiling: settings.weeklyCeiling,
          defaultJobPriceCents: settings.defaultJobPriceCents,
          timezone: settings.timezone,
        }
      : DEFAULT_CAPACITY;

    const today = localDateKey(new Date(), config.timezone);
    const { monday } = weekRangeOfDate(today);
    const jobs = await listJobsFrom(ownerId, monday);

    // Pure derive (AD-7): computed on tap from canonical rows, never stored. Anchor is
    // the tapped job's own date.
    const { slot } = proposeRebookSlot({
      cadence: client.cadence,
      anchorDate: job.date,
      jobs,
      config,
      today,
    });

    // No open day in the bounded window: not an error (AC3). The surface renders "no
    // open slot in range."
    if (slot == null) return ok({ slot: null, draft: null });

    const formattedSlot = formatDateKey(slot);

    // Hardened base origin (code-review P4): fail closed in prod when APP_BASE_URL is
    // unset rather than emit a localhost link to a real client.
    const base = bookingBaseUrl();
    if (!base.ok) return base;

    // PURE READ (code-review P3 / AD-1): the link WRITE (mint-if-absent) happens in the
    // prepareRebook POST action, NOT here — this GET render must never insert a row.
    // Read the existing stable per-client link (Story 3.1); if prepareRebook has not
    // minted it yet, ask the operator to tap Rebook first.
    const link = await findClientToken(ownerId, client.id, 'book-client');
    if (!link) return fail('link-not-ready');
    const bookingUrl = `${base.data}/book/${encodeURIComponent(link.tokenValue)}`;

    // The operator's rebooking_nudge copy, or the domain default when unseeded (mirrors
    // getConfirmationDraft). compose/resolveTemplate stay UNCHANGED (Story 2.1/2.2).
    const templates = await getMessageTemplates(ownerId);
    const body =
      templates.find((t) => t.type === 'rebooking_nudge')?.body ??
      DEFAULT_TEMPLATE_BODIES.rebooking_nudge;

    const draft = compose(
      { name: client.name, phone: client.phone },
      formattedSlot,
      config.defaultJobPriceCents,
      { type: 'rebooking_nudge', body },
    );
    // Append the per-client link (FR11) — single blank-line separator. The template
    // contract is untouched: no {link}/{token} placeholder, so no raw token can leak.
    draft.body = `${draft.body}\n\n${bookingUrl}`;

    return ok({ slot: formattedSlot, draft });
  } catch (err) {
    console.error('[jobs] getRebookProposal failed (fail-closed)', err);
    return fail('rebook-failed');
  }
}

/**
 * Story 3.3 (code-review P3) — the WRITE half of one-tap rebooking, split off the GET
 * read path (AD-1: no write-on-render). A POST Server Action: resolve the owner and the
 * tapped Job fail-closed, enforce the SAME rebookable-state gate as getRebookProposal
 * (P2), then mint-if-absent the client's ONE stable per-client booking link (Story 3.1)
 * — THIS is the only place the link row is created — and redirect to the proposal panel.
 * The subsequent GET (getRebookProposal) then only READS that row. redirect() throws
 * NEXT_REDIRECT to end the action (its return type is `never`).
 */
export async function prepareRebook(formData: FormData): Promise<void> {
  const jobId = String(formData.get('jobId') ?? '').trim();

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[jobs] getOwnerId failed (prepareRebook)', err);
    redirect('/jobs?error=owner-unresolved');
  }

  const job = await getJob(ownerId, jobId);
  if (!job) redirect('/jobs?error=job-not-found');
  if (!REBOOKABLE_COMPLETIONS.has(job.completion)) {
    redirect('/jobs?error=not-rebookable');
  }

  // The link mint (insert-if-absent) — off the GET render path (P3). Stable read-or-
  // create (Story 3.1): a re-tap returns the same URL, never resurrects a revoked link.
  await ensureClientToken(ownerId, job.clientId);

  redirect(`/jobs?rebook=${encodeURIComponent(jobId)}`);
}

/**
 * Story 3.4 (Task 2) — SEND the rebooking nudge, logging the dispatch exactly like the
 * /draft surface (Story 2.3). This is NOT a second dispatch path: the deliverable body
 * is the SAME one getRebookProposal composes (3.3's rebooking_nudge draft + the appended
 * per-client link), and the once-only log is written by the SHARED recordDispatch
 * (upsertMessageDraft + markMessageDispatched). The deterministic per-job nonce
 * `rebook:<jobId>` makes it idempotent per anchor job — a re-tap re-opens WhatsApp/SMS but
 * writes NO second MessageLog row and stamps dispatched_at only once (AD-5). That single
 * dispatched `rebooking_nudge` row IS the "nudge sent" fact (no parallel log/column).
 * On success redirect()s to the wa.me/sms deep link so the tap both LOGS and OPENS.
 */
export async function sendRebook(formData: FormData): Promise<void> {
  const jobId = String(formData.get('jobId') ?? '').trim();
  const channel: DeliveryChannel =
    String(formData.get('channel') ?? '') === 'sms' ? 'sms' : 'whatsapp';
  // The slot the operator actually reviewed in the panel (hidden field). Used only to
  // GATE the send against send-time divergence (below) — never to COMPOSE the outgoing
  // body, which is always re-derived server-side, so a tampered value can't inject text.
  const reviewedSlot = String(formData.get('slot') ?? '').trim();

  const back = (extra: string): string =>
    `/jobs?rebook=${encodeURIComponent(jobId)}${extra}`;

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[jobs] getOwnerId failed (sendRebook)', err);
    redirect('/jobs?error=owner-unresolved');
  }

  const job = await getJob(ownerId, jobId);
  if (!job) redirect('/jobs?error=job-not-found');

  // Re-derive the SAME proposal the panel rendered (3.3 compose path) to get the exact
  // deliverable body incl. the appended per-client link — compose ≠ deliver (AD-5), so the
  // draft here carries no side effect. A phoneless client / no-open-slot yields the same
  // graceful reasons the panel shows, never a silent no-op.
  const proposal = await getRebookProposal(jobId);
  if (!proposal.ok) redirect(back(`&error=${encodeURIComponent(proposal.reason)}`));
  const { slot, draft } = proposal.data;
  if (!draft) redirect(back('&error=rebook-failed'));

  // PIN the reviewed slot (code-review 3.4): the re-derive above can return a DIFFERENT
  // open slot than the operator saw — a day rollover moved "today", or the ideal slot was
  // booked in the gap between render and tap. Rather than silently send a date they never
  // reviewed, bounce back so the panel re-renders the updated proposal and they confirm the
  // new slot. Legacy/absent reviewedSlot (no hidden field) skips the gate — never blocks.
  if (reviewedSlot && slot !== reviewedSlot) redirect(back('&error=slot-changed'));

  // Build the deliverable link BEFORE logging (Story 2.3 P1 — no phantom dispatch): only
  // stamp dispatched_at once a real link exists, so a phoneless tap never inflates fatigue.
  const link = deepLink(draft, channel);
  if (!link) redirect(back('&error=no-phone'));

  // The SHARED dispatch-logging path (Story 2.3): ONE row keyed on the per-job nonce,
  // message_type = rebooking_nudge, dispatched_at stamped once (idempotent on re-tap).
  const res = await recordDispatch(
    job.clientId,
    'rebooking_nudge',
    rebookingDispatchNonce(jobId),
  );
  if (!res.ok) redirect(back(`&error=${encodeURIComponent(res.reason)}`));

  redirect(link);
}
