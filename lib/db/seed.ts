// One-row, idempotent operator seed (AR9 / AD-8). Establishes the single owner
// whose id is the owner_id every future row references. Credentials come from env
// (never hardcoded). Re-running MUST NOT create a second row — enforced by the
// unique index on email + onConflictDoNothing.

import 'dotenv/config';
import { db, pool } from './client';
import { operator } from './schema';
import { hashPassphrase } from '../auth/passphrase';

export interface SeedResult {
  ownerId: string;
  created: boolean;
}

export async function seedOperator(): Promise<SeedResult> {
  const email = process.env.OPERATOR_EMAIL;
  const passphrase = process.env.OPERATOR_PASSPHRASE;
  if (!email || !passphrase) {
    throw new Error('OPERATOR_EMAIL and OPERATOR_PASSPHRASE must be set to seed.');
  }

  const existing = await db
    .select({ id: operator.id })
    .from(operator)
    .limit(1);

  // Idempotent: if any operator already exists, do nothing (single-owner v1).
  if (existing.length > 0) {
    return { ownerId: existing[0].id, created: false };
  }

  const passphraseHash = await hashPassphrase(passphrase);
  const inserted = await db
    .insert(operator)
    .values({ email, passphraseHash })
    .onConflictDoNothing({ target: operator.email })
    .returning({ id: operator.id });

  if (inserted.length > 0) {
    return { ownerId: inserted[0].id, created: true };
  }

  // Lost a race on the unique index — read the winner back.
  const [row] = await db.select({ id: operator.id }).from(operator).limit(1);
  return { ownerId: row.id, created: false };
}

// Allow `pnpm db:seed` (tsx lib/db/seed.ts) as a standalone entrypoint.
const isDirectRun =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  seedOperator()
    .then((r) => {
      console.log(
        `Operator seed: ownerId=${r.ownerId} created=${r.created}`,
      );
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Operator seed failed:', err);
      process.exit(1);
    });
}
