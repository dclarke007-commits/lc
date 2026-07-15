'use server';

// Sole write path = Server Actions (AD-1). Verb-first names `createClient` /
// `editClient`. Client CRUD is NOT capacity-consuming, so it does NOT route
// through commitBooking (that is booking, Story 1.4).
//
// Return contract (AR15): { ok, data } | { ok: false, reason }. No thrown error
// crosses the boundary; no silent catch. Only lib/db speaks SQL (AD-1) — this
// action reaches it directly; surfaces never do.

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { client } from '@/lib/db/schema';
import type { Client } from '@/lib/db/schema';
import { getOwnerId, listClients, getClient } from '@/lib/db/queries';
import { ok, fail, type ActionResult } from '@/lib/domain/result';

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
  const ownerId = await getOwnerId();
  return listClients(ownerId);
}

/** Owner-scoped single read for the edit surface (populates the form). */
export async function getOwnerClient(id: string): Promise<Client | undefined> {
  const ownerId = await getOwnerId();
  return getClient(ownerId, id);
}

export async function createClient(
  formData: FormData,
): Promise<ActionResult<Client>> {
  const fields = readFields(formData);
  if (!fields.ok) return fail(fields.reason);

  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    // AR15: fail closed, but leave a trace in the platform logs.
    console.error('[clients] getOwnerId failed', err);
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
    ownerId = await getOwnerId();
  } catch (err) {
    // AR15: fail closed, but leave a trace in the platform logs.
    console.error('[clients] getOwnerId failed', err);
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
