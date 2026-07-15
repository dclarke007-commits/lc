'use server';

// Sole write path = Server Actions (AD-1). Verb-first name `signIn`.
// Return contract: { ok, data } | { ok: false, reason } — no thrown error crosses
// the boundary, no silent catch (AR15).

import { cookies } from 'next/headers';
import { authenticateOperator } from '@/lib/auth/operator';
import { signSession, SESSION_COOKIE } from '@/lib/auth/session';
import { ok, fail, type ActionResult } from '@/lib/domain/result';

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function signIn(
  formData: FormData,
): Promise<ActionResult<{ operatorId: string }>> {
  const email = String(formData.get('email') ?? '').trim();
  const passphrase = String(formData.get('passphrase') ?? '');

  const secret = process.env.SESSION_SECRET;
  if (!secret) return fail('session-misconfigured');

  const authed = await authenticateOperator(email, passphrase);
  if (!authed.ok) return authed;

  try {
    const token = await signSession(
      { sub: authed.data.operatorId, iat: Math.floor(Date.now() / 1000) },
      secret,
    );
    const jar = await cookies();
    jar.set(SESSION_COOKIE, token, {
      httpOnly: true,
      // Secure everywhere except local http dev so sign-in works locally.
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });
    return ok({ operatorId: authed.data.operatorId });
  } catch {
    return fail('session-write-failed');
  }
}
