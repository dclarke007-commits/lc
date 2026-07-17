// Story 4.1 — the PUBLIC self-serve booking token SURFACE (mint → resolve → open
// slots), exercised against the Docker Postgres (serial, singleFork — see
// vitest.config.ts). The token is the ENTIRE authorization (AD-6), so this pins:
// exactly-one-public-token (the partial unique index), idempotent minting, the
// client-less open-slot view, durable revocation/rotation (D1), and a fail-closed
// resolve chain (signature → capability → revocation row, client_id IS NULL). Also
// pins CROSS-CAPABILITY isolation: a per-client token can never resolve on the public
// path and vice-versa. Do NOT end the shared pool here.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { isNull, and, eq } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { client, token, job, capacitySettings } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import {
  getOwnerId,
  getCapacitySettings,
  listJobsFrom,
  findTokenByValue,
  findPublicToken,
  insertPublicTokenIfAbsent,
} from '../lib/db/queries';
import {
  ensurePublicToken,
  rotatePublicToken,
  revokePublicToken,
  resolvePublicTokenClaims,
  resolvePublicBookingView,
} from '../lib/domain/publicToken';
import { ensureClientToken, resolveBookingView } from '../lib/domain/booking';
import {
  signPublicToken,
  getPublicTokenSecret,
  generateTokenNonce,
} from '../lib/auth/clientToken';
import { DEFAULT_CAPACITY, type CapacityConfig } from '../lib/domain/capacityConfig';
import { localDateKey, weekRangeOfDate } from '../lib/domain/clock';
import { weekCapacity } from '../lib/domain/derive';

let ownerId: string;

async function insertClient(name: string, phone: string): Promise<string> {
  const [row] = await db
    .insert(client)
    .values({ ownerId, name, phone, cadence: 'weekly' })
    .returning();
  return row.id;
}

/** The owner's effective config — settings row or the domain default (as the resolver does). */
async function effectiveConfig(): Promise<CapacityConfig> {
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

beforeAll(async () => {
  await seedOperator();
  ownerId = await getOwnerId();
});

// Isolate per test: a clean token table (the single-public-token invariant needs a
// clean slate) AND clean jobs + capacity settings, so deriveOwnerOpenWeek uses the
// valid DEFAULT_CAPACITY. Prior test files (capacity/rebook) intentionally leave an
// INVALID timezone in the shared owner's settings to prove fail-closed derive — which
// would otherwise make our happy-path view resolve null (serial shared DB). Owner and
// clients survive (owner is the singleton seed).
beforeEach(async () => {
  await db.delete(job);
  await db.delete(token);
  await db.delete(capacitySettings);
});

describe('Story 4.1 — public token mint (ensurePublicToken)', () => {
  it('mints exactly one stable public link, idempotent across calls', async () => {
    const first = await ensurePublicToken(ownerId);
    const second = await ensurePublicToken(ownerId);
    expect(first).toBe(second); // stable URL (D1 read-or-create)

    const rows = await db
      .select()
      .from(token)
      .where(and(eq(token.ownerId, ownerId), isNull(token.clientId)));
    expect(rows).toHaveLength(1); // exactly one public token
    expect(rows[0].clientId).toBeNull();
    expect(rows[0].capability).toBe('book-public');
  });

  it('DB enforces exactly one public token per owner (partial unique index)', async () => {
    await ensurePublicToken(ownerId);
    // A second raw insert of a DIFFERENT client-less token must conflict on
    // token_owner_public_uq and be swallowed by insertPublicTokenIfAbsent (returns the
    // existing row rather than creating a second).
    const existing = await findPublicToken(ownerId, 'book-public');
    const dup = await insertPublicTokenIfAbsent(
      ownerId,
      'a-different-token-value',
      'book-public',
      generateTokenNonce(),
    );
    expect(dup.tokenValue).toBe(existing!.tokenValue);

    const rows = await db
      .select()
      .from(token)
      .where(and(eq(token.ownerId, ownerId), isNull(token.clientId)));
    expect(rows).toHaveLength(1);
  });
});

describe('Story 4.1 — public open-slot view (resolvePublicBookingView)', () => {
  it('renders ONLY genuinely-open slots, matching the independent derive, with no client scope', async () => {
    const tokenValue = await ensurePublicToken(ownerId);
    const result = await resolvePublicBookingView(tokenValue);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The public view has NO clientName field (client-less).
    expect('clientName' in result.view).toBe(false);

    // Independently derive the expected open set the same way the resolver does.
    const config = await effectiveConfig();
    const today = localDateKey(new Date(), config.timezone);
    const { monday } = weekRangeOfDate(today);
    const jobs = await listJobsFrom(ownerId, monday);
    const week = weekCapacity(jobs, config, today);
    const expected = week.days.filter((d) => d.open).map((d) => d.date).sort();

    expect(result.view.openSlots.map((s) => s.date).sort()).toEqual(expected);
  });
});

describe('Story 4.1 — fail-closed resolve chain', () => {
  it('rejects tampered / forged / unknown / empty tokens', async () => {
    const valid = await ensurePublicToken(ownerId);

    await expect(resolvePublicTokenClaims(undefined)).resolves.toBeNull();
    await expect(resolvePublicTokenClaims('')).resolves.toBeNull();
    await expect(resolvePublicTokenClaims('not-a-token')).resolves.toBeNull();
    // Tamper the signature segment.
    const [body] = valid.split('.');
    await expect(
      resolvePublicTokenClaims(`${body}.deadbeefsignature`),
    ).resolves.toBeNull();
    // A validly-SIGNED token for an unknown owner (no persisted row) — fails at the
    // revocation-row guard even though its HMAC is valid.
    const secret = getPublicTokenSecret();
    const orphan = await signPublicToken(
      {
        ownerId: '00000000-0000-0000-0000-000000000000',
        capability: 'book-public',
        nonce: generateTokenNonce(),
      },
      secret,
    );
    await expect(resolvePublicTokenClaims(orphan)).resolves.toBeNull();
  });

  it('a per-client token NEVER resolves on the public path (cross-capability isolation)', async () => {
    const clientId = await insertClient('Ada', '555-0001');
    const clientToken = await ensureClientToken(ownerId, clientId);
    // Public resolver rejects it (wrong secret + capability guard).
    await expect(resolvePublicTokenClaims(clientToken)).resolves.toBeNull();
    const pubView = await resolvePublicBookingView(clientToken);
    expect(pubView.ok).toBe(false);
  });

  it('a public token NEVER resolves on the per-client path', async () => {
    const publicToken = await ensurePublicToken(ownerId);
    const clientView = await resolveBookingView(publicToken);
    expect(clientView.ok).toBe(false);
  });
});

describe('Story 4.1 — durable revocation & rotation (D1)', () => {
  it('revoke kills the link; a re-mint yields a NEW value the old link cannot resolve', async () => {
    const original = await ensurePublicToken(ownerId);
    expect((await resolvePublicBookingView(original)).ok).toBe(true);

    const removed = await revokePublicToken(ownerId);
    expect(removed).toBe(true);
    // Old value now fails closed (row deleted) even though its HMAC is still valid.
    expect((await resolvePublicBookingView(original)).ok).toBe(false);
    await expect(findTokenByValue(original)).resolves.toBeUndefined();

    // Re-mint: a fresh nonce → a genuinely NEW value; the old link stays dead.
    const reminted = await ensurePublicToken(ownerId);
    expect(reminted).not.toBe(original);
    expect((await resolvePublicBookingView(original)).ok).toBe(false);
    expect((await resolvePublicBookingView(reminted)).ok).toBe(true);
  });

  it('rotate issues a new link and immediately kills the old', async () => {
    const original = await ensurePublicToken(ownerId);
    const rotated = await rotatePublicToken(ownerId);
    expect(rotated).not.toBe(original);
    expect((await resolvePublicBookingView(original)).ok).toBe(false);
    expect((await resolvePublicBookingView(rotated)).ok).toBe(true);

    // Still exactly one public token after rotation.
    const rows = await db
      .select()
      .from(token)
      .where(and(eq(token.ownerId, ownerId), isNull(token.clientId)));
    expect(rows).toHaveLength(1);
  });
});

describe('Story 4.1 — weak/missing secret fails closed (Task 7)', () => {
  it('resolve fails closed and mint refuses when PUBLIC_TOKEN_SECRET is missing or weak', async () => {
    const valid = await ensurePublicToken(ownerId);
    const original = process.env.PUBLIC_TOKEN_SECRET;
    try {
      // Missing secret: resolve fails closed (getPublicTokenSecret throws → null), the
      // view is not-ok, and minting refuses to sign (never issues an unsigned link).
      process.env.PUBLIC_TOKEN_SECRET = '';
      await expect(resolvePublicTokenClaims(valid)).resolves.toBeNull();
      expect((await resolvePublicBookingView(valid)).ok).toBe(false);
      await expect(ensurePublicToken(ownerId)).rejects.toThrow();

      // Weak secret (< 32 chars): same fail-closed treatment.
      process.env.PUBLIC_TOKEN_SECRET = 'too-short';
      await expect(resolvePublicTokenClaims(valid)).resolves.toBeNull();
      expect((await resolvePublicBookingView(valid)).ok).toBe(false);
    } finally {
      process.env.PUBLIC_TOKEN_SECRET = original;
    }
  });
});
