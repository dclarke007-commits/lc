// Story 2.1 — operator-editable message templates.
//
// Two halves:
//  - PURE unit tests for resolveTemplate (AC3) and validateTemplate — no DB.
//  - DB tests (AC1, AC2) against the Docker Postgres: seed idempotency,
//    (owner,type) uniqueness, and edit-persists-then-re-reads scoped to owner.
//    Requires `docker compose up` + migrations applied.

import { describe, it, expect, beforeAll, vi } from 'vitest';

// saveMessageTemplate calls revalidatePath — no request context in a unit test.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { sql } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { operator } from '../lib/db/schema';
import { seedOperator, seedMessageTemplates } from '../lib/db/seed';
import { getOwnerId, getMessageTemplates } from '../lib/db/queries';
import { saveMessageTemplate } from '../app/(operator)/templates/actions';
import { resolveTemplate } from '../lib/domain/compose';
import {
  validateTemplate,
  MESSAGE_TEMPLATE_TYPES,
} from '../lib/domain/messageTemplateConfig';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// --- PURE: resolveTemplate (AC3) ------------------------------------------

describe('resolveTemplate — no {token} ever leaks (AC3)', () => {
  it('substitutes all sanctioned placeholders when values are present', () => {
    expect(
      resolveTemplate('Hi {client}, {slot} for {amount}.', {
        client: 'Ana',
        slot: 'Tue 9am',
        amount: '$200',
      }),
    ).toBe('Hi Ana, Tue 9am for $200.');
  });

  it('blanks a missing value — never the literal {amount}', () => {
    const out = resolveTemplate('You owe {amount} total.', {});
    expect(out).not.toContain('{');
    expect(out).toBe('You owe total.');
  });

  it('treats an empty-string value the same as missing', () => {
    expect(resolveTemplate('You owe {amount}.', { amount: '' })).toBe('You owe.');
  });

  it('strips an unknown brace-token, never leaking it', () => {
    const out = resolveTemplate('Hi {client}{foo}!', { client: 'Ana' });
    expect(out).not.toContain('{');
    expect(out).toBe('Hi Ana!');
  });

  it('resolves a spaced/mixed-case token like { Amount }', () => {
    expect(resolveTemplate('Owe { Amount }.', { amount: '$5' })).toBe('Owe $5.');
  });

  it('leaves a body with no placeholders unchanged', () => {
    expect(resolveTemplate('Thanks for booking!', {})).toBe(
      'Thanks for booking!',
    );
  });

  it('collapses the double space a blanked token leaves behind', () => {
    // "{x}" is unknown → blank → "A  B" → collapsed to "A B".
    expect(resolveTemplate('A {x} B', {})).toBe('A B');
  });
});

// --- PURE: validateTemplate (AR15) ----------------------------------------

describe('validateTemplate (AR15)', () => {
  it('accepts a known type and trims the body', () => {
    const r = validateTemplate({ type: 'booking_confirmation', body: '  Hi  ' });
    expect(r).toEqual({ ok: true, data: { type: 'booking_confirmation', body: 'Hi' } });
  });

  it('rejects an unknown type (form tampering) with a machine reason', () => {
    const r = validateTemplate({ type: 'bogus', body: 'x' });
    expect(r).toEqual({ ok: false, reason: 'template-type-invalid' });
  });

  it('rejects a whitespace-only body', () => {
    const r = validateTemplate({ type: 'win_back', body: '   ' });
    expect(r).toEqual({ ok: false, reason: 'template-body-required' });
  });
});

// --- DB: seeding, uniqueness, edit persistence (AC1, AC2) ------------------

describe('message template persistence (AC1, AC2)', () => {
  let ownerId: string;

  beforeAll(async () => {
    // Clean slate; cascade also clears message_template (FK → operator).
    await db.execute(sql`truncate table ${operator} restart identity cascade`);
    await seedOperator();
    ownerId = await getOwnerId();
  });

  it('seeds exactly the four template types, idempotently (AC1)', async () => {
    const first = await seedMessageTemplates(ownerId);
    expect(first.inserted).toBe(4);

    // Re-running inserts nothing (the (owner,type) unique index + do-nothing).
    const second = await seedMessageTemplates(ownerId);
    expect(second.inserted).toBe(0);

    const rows = await getMessageTemplates(ownerId);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.type))).toEqual(
      new Set(MESSAGE_TEMPLATE_TYPES),
    );
    // Every seeded body carries only sanctioned tokens — no leak by construction.
    for (const r of rows) expect(r.body.length).toBeGreaterThan(0);
  });

  it('edit persists per owner and re-reads the new body (AC2)', async () => {
    const res = await saveMessageTemplate(
      form({ type: 'booking_confirmation', body: 'Fresh copy for {client}.' }),
    );
    expect(res.ok).toBe(true);

    const rows = await getMessageTemplates(ownerId);
    const bc = rows.find((r) => r.type === 'booking_confirmation');
    expect(bc?.body).toBe('Fresh copy for {client}.');
    // Still exactly four — an edit UPSERTs, never inserts a duplicate.
    expect(rows).toHaveLength(4);
  });

  it('rejects an unknown type and writes nothing', async () => {
    const res = await saveMessageTemplate(form({ type: 'bogus', body: 'x' }));
    expect(res).toEqual({ ok: false, reason: 'template-type-invalid' });
    const rows = await getMessageTemplates(ownerId);
    expect(rows).toHaveLength(4);
  });

  it('rejects an empty body and writes nothing', async () => {
    const res = await saveMessageTemplate(
      form({ type: 'win_back', body: '   ' }),
    );
    expect(res).toEqual({ ok: false, reason: 'template-body-required' });
  });
});
