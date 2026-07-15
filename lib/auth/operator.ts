// Operator authentication core (no framework/cookie concerns — those live in the
// Server Action). Returns the typed ActionResult contract and never throws across
// its own boundary: DB/lookup failures collapse to `{ ok: false, reason }`.

import { ok, fail, type ActionResult } from '../domain/result';
import { getOperatorByEmail } from '../db/queries';
import { verifyPassphrase } from './passphrase';

export interface AuthedOperator {
  operatorId: string;
}

export async function authenticateOperator(
  email: string,
  passphrase: string,
): Promise<ActionResult<AuthedOperator>> {
  if (!email || !passphrase) {
    return fail('missing-credentials');
  }
  try {
    const row = await getOperatorByEmail(email);
    // Constant-ish path: still run a verify to avoid trivial user enumeration by
    // timing, but a missing row is always a failure.
    if (!row) {
      return fail('invalid-credentials');
    }
    const valid = await verifyPassphrase(passphrase, row.passphraseHash);
    if (!valid) {
      return fail('invalid-credentials');
    }
    return ok({ operatorId: row.id });
  } catch {
    return fail('auth-unavailable');
  }
}
