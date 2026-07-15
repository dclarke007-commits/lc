// Operator authentication core (no framework/cookie concerns — those live in the
// Server Action). Returns the typed ActionResult contract and never throws across
// its own boundary: DB/lookup failures collapse to `{ ok: false, reason }`.

import { ok, fail, type ActionResult } from '../domain/result';
import { getOperatorByEmail } from '../db/queries';
import { verifyPassphrase } from './passphrase';

export interface AuthedOperator {
  operatorId: string;
}

// Fixed decoy hash (valid scrypt format, matching N/keylen of real hashes). On the
// unknown-email path we run verifyPassphrase against this and discard the result,
// so a known vs. unknown email costs the same scrypt work — no timing enumeration.
const DECOY_PASSPHRASE_HASH =
  'scrypt$N=16384$61b084f8bf3518221bac4f564b89a13e$61c216439caa573bd16249c0e1b5e09980a4f7b308a4f8729ba8164cd2c93f53b1adc06c5d432c8615841deae40a1e9e85a6e9aeff233221b3f46aac31a73d04';

export async function authenticateOperator(
  email: string,
  passphrase: string,
): Promise<ActionResult<AuthedOperator>> {
  if (!email || !passphrase) {
    return fail('missing-credentials');
  }
  try {
    const row = await getOperatorByEmail(email);
    // Both paths run one full scrypt verify so unknown and known emails take the
    // same time (no email-enumeration timing side channel). The unknown-email
    // path verifies against a fixed decoy hash and discards the result.
    if (!row) {
      await verifyPassphrase(passphrase, DECOY_PASSPHRASE_HASH);
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
