// Story 3.6 — win-back action, against the Docker Postgres (serial, singleFork — see
// vitest.config.ts). Win-back is a pure CONSUMER of the spine: it wires Story 3.5's
// gone-cold derivation → Story 2.1/2.2's compose → Story 2.3's idempotent dispatch. The
// seams under test:
//
//   • getWinBackDraft(clientId) — owner-scoped read: gone-cold GATE (re-derived, AD-7) +
//     compose the `win_back` check-in draft (empty slot / null amount → {slot}/{amount}
//     blank, no {token} leak; NO booking link, NO transport key). Composing dispatches
//     nothing (compose ≠ deliver, AD-5).
//   • sendWinBack(formData) — the send tap: re-derives the same draft, records ONE
//     dispatched `win_back` MessageLog via the SHARED recordDispatch (nonce winback:<id>),
//     idempotent on re-tap, then redirects to the wa.me/sms deep link.
//
// Clock: the gone-cold gate reads the wall clock to anchor "today". We fake ONLY Date
// (real timers, so the pg driver is untouched) pinned to a Monday, so the derivation is
// deterministic (mirrors tests/rebook.test.ts).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db/client';
import {
  operator,
  client,
  capacitySettings,
  job,
  messageTemplate,
  messageLog,
  token,
} from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId } from '../lib/db/queries';
import {
  getWinBackDraft,
  sendWinBack,
} from '../app/(operator)/clients/actions';

// A fixed Monday noon UTC. In America/Chicago (CDT, -5) that is 07:00 local on
// 2026-07-20, so today = '2026-07-20'.
const FIXED_MONDAY = new Date('2026-07-20T12:00:00.000Z');

let ownerId: string;

type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'one-time';

async function insertClient(
  name: string,
  phone: string,
  cadence: Cadence,
): Promise<string> {
  const [row] = await db
    .insert(client)
    .values({ ownerId, name, phone, cadence })
    .returning();
  return row.id;
}

/** A COMPLETED job on `date` — the lapse basis (Story 1.5 lifecycle). */
async function insertCompletedJob(clientId: string, date: string): Promise<void> {
  await db.insert(job).values({
    ownerId,
    clientId,
    date,
    completion: 'completed',
    completedAt: `${date}T18:00:00.000Z`,
    priceCents: 20000,
    idempotencyKey: `done-${clientId}-${date}`,
  });
}

/** A future BOOKED job on `date` (live/consuming → suppresses gone-cold). */
async function insertBookedJob(clientId: string, date: string): Promise<void> {
  await db.insert(job).values({
    ownerId,
    clientId,
    date,
    completion: 'booked',
    priceCents: 20000,
    idempotencyKey: `book-${clientId}-${date}`,
  });
}

async function setCaps(): Promise<void> {
  await db.delete(capacitySettings);
  await db.insert(capacitySettings).values({
    ownerId,
    workingDays: [1, 2, 3, 4, 5, 6, 7],
    perDayCap: 3,
    weeklyCeiling: 14,
    defaultJobPriceCents: 20000,
    timezone: 'America/Chicago',
  });
}

/** Seed a custom win_back template body so we can prove {slot}/{amount} blank out. */
async function seedWinBackTemplate(body: string): Promise<void> {
  await db
    .insert(messageTemplate)
    .values({ ownerId, type: 'win_back', body })
    .onConflictDoUpdate({
      target: [messageTemplate.ownerId, messageTemplate.type],
      set: { body },
    });
}

/** MessageLog rows for a given draft nonce (owner-scoped). */
async function logRows(nonce: string) {
  return db
    .select()
    .from(messageLog)
    .where(and(eq(messageLog.ownerId, ownerId), eq(messageLog.draftNonce, nonce)));
}

/** Invoke a redirecting server action and return the NEXT_REDIRECT digest string. */
async function callSend(clientId: string, channel = 'whatsapp'): Promise<string> {
  const fd = new FormData();
  fd.set('client', clientId);
  fd.set('channel', channel);
  try {
    await sendWinBack(fd);
  } catch (e) {
    const digest = (e as { digest?: string })?.digest;
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) {
      return digest;
    }
    throw e;
  }
  throw new Error('sendWinBack did not redirect');
}

describe('Win-back action (Story 3.6)', () => {
  beforeAll(async () => {
    await db.execute(
      sql`truncate table ${token}, ${messageLog}, ${messageTemplate}, ${job}, ${capacitySettings}, ${client}, ${operator} restart identity cascade`,
    );
    await seedOperator();
    ownerId = await getOwnerId();
    await setCaps();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_MONDAY);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    // Isolate each test: clear clients/jobs/logs/templates (cascade), keep operator + caps.
    await db.execute(
      sql`truncate table ${token}, ${messageLog}, ${messageTemplate}, ${job}, ${client} restart identity cascade`,
    );
  });

  // --- getWinBackDraft: gate + compose (AC1) ---------------------------------------

  it('composes a win_back check-in draft for a gone-cold client', async () => {
    // weekly, last completed 2026-07-01 → expected 07-08 → today 07-20 → gone-cold.
    const id = await insertClient('Cold Clara', '+15551230001', 'weekly');
    await insertCompletedJob(id, '2026-07-01');

    const res = await getWinBackDraft(id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const draft = res.data;
    expect(draft.type).toBe('win_back');
    expect(draft.recipient).toBe('+15551230001');
    expect(draft.body).toContain('Clara'); // {client} filled
    // A check-in carries NO transport key — compose ≠ deliver (AD-5).
    expect(draft.body).not.toContain('wa.me');
    expect(draft.body).not.toContain('sms:');
    expect(draft.body).not.toContain('http');
  });

  it('unfilled {slot}/{amount} blank out — never a literal {token}', async () => {
    // A custom template that DOES reference slot/amount; a check-in has neither.
    await seedWinBackTemplate(
      'Hi {client}, your {slot} slot at {amount} is open — come back!',
    );
    const id = await insertClient('Cold Cora', '+15551230002', 'weekly');
    await insertCompletedJob(id, '2026-07-01');

    const res = await getWinBackDraft(id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // No brace-token survives (Story 2.1 AC3): assert no residual braces at all.
    expect(res.data.body).not.toMatch(/[{}]/);
    expect(res.data.body).toContain('Cora');
  });

  it('composing does NOT dispatch — no MessageLog row is written on the read', async () => {
    const id = await insertClient('Cold Cleo', '+15551230003', 'weekly');
    await insertCompletedJob(id, '2026-07-01');

    await getWinBackDraft(id);
    const rows = await logRows(`winback:${id}`);
    expect(rows).toHaveLength(0);
  });

  it('refuses a client who is NOT gone-cold (a future booking suppresses it)', async () => {
    const id = await insertClient('Active Ana', '+15551230004', 'weekly');
    await insertCompletedJob(id, '2026-07-01');
    await insertBookedJob(id, '2026-07-25'); // future live booking → not cold

    const res = await getWinBackDraft(id);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('not-gone-cold');
  });

  it('refuses a one-time client (never gone-cold via cadence)', async () => {
    const id = await insertClient('Onetime Otto', '+15551230005', 'one-time');
    await insertCompletedJob(id, '2026-07-01');

    const res = await getWinBackDraft(id);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('not-gone-cold');
  });

  // --- sendWinBack: dispatch once, idempotent (AC2) --------------------------------

  it('send tap logs ONE dispatched win_back row and opens the deep link', async () => {
    const id = await insertClient('Cold Cody', '+15551230006', 'weekly');
    await insertCompletedJob(id, '2026-07-01');

    const digest = await callSend(id, 'whatsapp');
    expect(digest).toContain('wa.me'); // redirected to the WhatsApp deep link

    const rows = await logRows(`winback:${id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].messageType).toBe('win_back');
    expect(rows[0].dispatchedAt).toBeTruthy();
  });

  it('a re-tap does NOT double-log — one row, same dispatched_at (idempotent per client)', async () => {
    const id = await insertClient('Cold Cass', '+15551230007', 'weekly');
    await insertCompletedJob(id, '2026-07-01');

    await callSend(id);
    const first = await logRows(`winback:${id}`);
    expect(first).toHaveLength(1);
    const firstStamp = first[0].dispatchedAt;

    await callSend(id); // re-tap (browser back → resubmit)
    const second = await logRows(`winback:${id}`);
    expect(second).toHaveLength(1); // still exactly one row
    expect(second[0].dispatchedAt).toBe(firstStamp); // stamped once
  });

  it('send refuses a non-gone-cold client — bounces back with an error, no dispatch', async () => {
    const id = await insertClient('Active Abe', '+15551230008', 'weekly');
    await insertCompletedJob(id, '2026-07-01');
    await insertBookedJob(id, '2026-07-25'); // future booking → not cold

    const digest = await callSend(id);
    expect(digest).toContain('not-gone-cold');
    const rows = await logRows(`winback:${id}`);
    expect(rows).toHaveLength(0); // never dispatched
  });

  it('send refuses a client with no usable phone — no phantom dispatch', async () => {
    // A gone-cold client whose phone cannot form a deep link (empty after normalize).
    const id = await insertClient('Cold No-Phone', '   ', 'weekly');
    await insertCompletedJob(id, '2026-07-01');

    const digest = await callSend(id);
    expect(digest).toContain('no-phone');
    const rows = await logRows(`winback:${id}`);
    expect(rows).toHaveLength(0); // link built BEFORE logging (Story 2.3 P1)
  });
});
