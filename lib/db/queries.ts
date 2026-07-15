// Owner-scoped query helpers. AD-8: the owner_id FILTER (the value, not just the
// column) is present in every query from v1. Since v1 is single-operator, the
// value is resolved from the one seeded operator row. Later stories add a value
// SOURCE (e.g. from the session), never a query retrofit.

import { eq, asc } from 'drizzle-orm';
import { db } from './client';
import { operator } from './schema';
import type { Operator } from './schema';

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
