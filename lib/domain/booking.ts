// Booking-surface domain orchestration (Story 3.1). The public route
// (app/book/[token]) calls resolveBookingView — it never touches lib/db or the
// crypto directly (AD-1: surface → domain → db). Two responsibilities:
//
//   • ensureClientToken  — Task 2: mint (sign, deterministic) + persist the ONE
//     stable per-client booking link.
//   • resolveBookingView — Tasks 3+4: turn a bearer token into a scoped, genuinely-
//     open-slot view, or a generic failure that reveals NOTHING.
//
// Security spine (AD-6): the token is the entire authorization. Verification is a
// FAIL-CLOSED chain — signature → revocation row → owner/client scope — and every
// slot read is owner-scoped on the value the token proved (AD-8). The genuinely-open
// predicate is Story 1.7's derive, never re-derived here (AD-2/AD-7).

import {
  getClientTokenSecret,
  signClientToken,
  verifyClientToken,
  type TokenCapability,
} from '@/lib/auth/clientToken';
import {
  findTokenByValue,
  upsertClientToken,
  getClient,
  getCapacitySettings,
  listJobsFrom,
} from '@/lib/db/queries';
import { DEFAULT_CAPACITY, type CapacityConfig } from '@/lib/domain/capacityConfig';
import { localDateKey, weekRangeOfDate } from '@/lib/domain/clock';
import { weekCapacity, nearestOpen } from '@/lib/domain/derive';

/** The per-client capability minted here (view one client's slots + book them, 3.2). */
const PER_CLIENT_CAPABILITY: TokenCapability = 'book-client';

/**
 * Mint + persist the ONE stable per-client booking link (Task 2). The signature is
 * deterministic over {clientId, ownerId, capability}, and the row upsert is idempotent
 * on (owner, client, capability), so calling this repeatedly for a client yields the
 * SAME token every time — one live link per client. Revoke later by deleting the row.
 * Returns the token string to embed in the client's URL.
 */
export async function ensureClientToken(
  ownerId: string,
  clientId: string,
): Promise<string> {
  const secret = getClientTokenSecret();
  const tokenValue = await signClientToken(
    { clientId, ownerId, capability: PER_CLIENT_CAPABILITY },
    secret,
  );
  const row = await upsertClientToken(
    ownerId,
    clientId,
    tokenValue,
    PER_CLIENT_CAPABILITY,
  );
  return row.tokenValue;
}

/** A genuinely-open day the client may book (day under cap AND week under ceiling). */
export interface OpenSlot {
  date: string; // operator-local 'YYYY-MM-DD'
  isoWeekday: number; // 1=Mon..7=Sun
}

/** The client-facing view: one client's open slots for the current operator week. */
export interface BookingView {
  clientName: string;
  timezone: string;
  weekStart: string; // Monday (inclusive)
  weekEnd: string; // next Monday (exclusive)
  openSlots: OpenSlot[]; // genuinely-open days this week (may be empty)
  nextOpen: string | null; // next open working day when this week has none
}

/**
 * Resolve outcome. On ANY failure the result is a bare { ok: false } — the caller
 * renders one generic invalid-link message. We never distinguish "unknown token"
 * from "revoked" from "no such client", so a bearer learns nothing about existence.
 */
export type ResolveResult = { ok: true; view: BookingView } | { ok: false };

const INVALID: ResolveResult = { ok: false };

/**
 * Turn a bearer token into a scoped open-slot view (Tasks 3+4), or INVALID. The chain
 * fails closed at every step:
 *   1. Signature — unforgeable proof of the claims (secret held server-side only).
 *   2. Capability — must be exactly the per-client booking capability.
 *   3. Revocation — a matching row must still exist (delete = revoke, even though the
 *      HMAC stays valid) and its columns must agree with the signed claims.
 *   4. Scope — read ONLY this client, owner-scoped (AD-8): a token for client A under
 *      owner O can never surface client B or another owner's rows.
 * Then it derives genuinely-open slots via Story 1.7 (AD-2/AD-7) — no mutation here
 * (booking is Story 3.2).
 */
export async function resolveBookingView(
  tokenValue: string | undefined | null,
): Promise<ResolveResult> {
  if (!tokenValue) return INVALID;

  // 1–2. Signature + capability. A weak/missing secret throws in getClientTokenSecret;
  // treat that as invalid (fail closed) rather than leaking a server error.
  let secret: string;
  try {
    secret = getClientTokenSecret();
  } catch {
    return INVALID;
  }
  const claims = await verifyClientToken(tokenValue, secret);
  if (!claims) return INVALID;
  if (claims.capability !== PER_CLIENT_CAPABILITY) return INVALID;
  if (!claims.clientId || !claims.ownerId) return INVALID;

  // 3. Revocation: the row must exist AND agree with the signed claims. A deleted row
  // (revoked link) or any mismatch fails closed here.
  const row = await findTokenByValue(tokenValue);
  if (
    !row ||
    row.ownerId !== claims.ownerId ||
    row.clientId !== claims.clientId ||
    row.capability !== claims.capability
  ) {
    return INVALID;
  }

  // 4. Scope: read ONLY this client, owner-scoped. Both predicates (owner AND id) are
  // enforced in the query, so a token can never resolve another owner's/client's row.
  const client = await getClient(claims.ownerId, claims.clientId);
  if (!client) return INVALID;

  // Genuinely-open slots: the operator's config + this-week-forward jobs, owner-scoped,
  // fed to the pure Story 1.7 derive. Defaults on first-run (no settings row) come from
  // the domain, never the DB (single source, AR16).
  const settings = await getCapacitySettings(claims.ownerId);
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
  const jobs = await listJobsFrom(claims.ownerId, monday);
  const week = weekCapacity(jobs, config, today);

  const openSlots: OpenSlot[] = week.days
    .filter((d) => d.open)
    .map((d) => ({ date: d.date, isoWeekday: d.isoWeekday }));

  // When this week has no open day, offer the single next open working day (FR28),
  // so a saturated week still points the client somewhere bookable.
  const nextOpen =
    openSlots.length === 0 ? (nearestOpen(jobs, config, today)[0] ?? null) : null;

  return {
    ok: true,
    view: {
      clientName: client.name,
      timezone: config.timezone,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      openSlots,
      nextOpen,
    },
  };
}
