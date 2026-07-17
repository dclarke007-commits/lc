// Operator passphrase hashing with node:crypto scrypt (no auth framework).
// Server/Node-runtime only (used by the seed and the signIn action).
// Stored format:  scrypt$N=<n>$<saltHex>$<derivedKeyHex>

import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type BinaryLike,
  type ScryptOptions,
} from 'node:crypto';

function scrypt(
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const KEYLEN = 64;
const SCRYPT_N = 16384; // cost; N=16384 is the node default, kept explicit for verify.

export async function hashPassphrase(passphrase: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(passphrase, salt, KEYLEN, {
    N: SCRYPT_N,
  })) as Buffer;
  return `scrypt$N=${SCRYPT_N}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassphrase(
  passphrase: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1].replace('N=', ''));
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  if (!Number.isFinite(n) || salt.length === 0 || expected.length === 0) {
    return false;
  }
  const derived = (await scrypt(passphrase, salt, expected.length, {
    N: n,
  })) as Buffer;
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
