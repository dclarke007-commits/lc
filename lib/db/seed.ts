// One-row, idempotent operator seed (AR9 / AD-8). Establishes the single owner
// whose id is the owner_id every future row references. Credentials come from env
// (never hardcoded). Re-running MUST NOT create a second row — enforced by the
// unique index on email + onConflictDoNothing.

import 'dotenv/config';
import { asc } from 'drizzle-orm';
import { db, pool } from './client';
import { operator, messageTemplate } from './schema';
import { hashPassphrase } from '../auth/passphrase';
import {
  MESSAGE_TEMPLATE_TYPES,
  DEFAULT_TEMPLATE_BODIES,
} from '../domain/messageTemplateConfig';

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
    .orderBy(asc(operator.createdAt), asc(operator.id))
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

  // Lost a race on the unique index — read the winner back (deterministic).
  const [row] = await db
    .select({ id: operator.id })
    .from(operator)
    .orderBy(asc(operator.createdAt), asc(operator.id))
    .limit(1);
  return { ownerId: row.id, created: false };
}

/**
 * Seed the four default message templates (Story 2.1, FR20) for the owner.
 * Idempotent: the (owner_id, type) unique index + onConflictDoNothing guarantee
 * re-running never duplicates a row, and never overwrites copy the operator has
 * since edited. Default bodies come from the domain single source
 * (DEFAULT_TEMPLATE_BODIES), never hardcoded here.
 */
export async function seedMessageTemplates(
  ownerId: string,
): Promise<{ inserted: number }> {
  const rows = MESSAGE_TEMPLATE_TYPES.map((type) => ({
    ownerId,
    type,
    body: DEFAULT_TEMPLATE_BODIES[type],
  }));

  const inserted = await db
    .insert(messageTemplate)
    .values(rows)
    .onConflictDoNothing({
      target: [messageTemplate.ownerId, messageTemplate.type],
    })
    .returning({ id: messageTemplate.id });

  return { inserted: inserted.length };
}

// Allow `pnpm db:seed` (tsx lib/db/seed.ts) as a standalone entrypoint. Seeds the
// operator, then rides that owner_id to seed the four default templates.
const isDirectRun =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  seedOperator()
    .then(async (r) => {
      const templates = await seedMessageTemplates(r.ownerId);
      console.log(
        `Operator seed: ownerId=${r.ownerId} created=${r.created}; ` +
          `templates inserted=${templates.inserted}`,
      );
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
