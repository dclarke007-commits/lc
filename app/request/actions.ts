'use server';

// The ONLY public endpoint for the tokenless homepage request. Throttles per-IP, then
// delegates to the plain-module core (submitPublicRequestNoToken) and redirect-masks the
// typed result: success and every failure reason collapse to a generic ?sent / ?error
// state so no machine reason (validation, cap, unseeded owner) is ever revealed. The core
// lives in ./request (NOT 'use server') so it is not separately callable.

import { redirect } from 'next/navigation';
import { submitPublicRequestNoToken } from './request';
import { getRequestIp } from '@/lib/security/requestIp';
import { checkThrottle } from '@/lib/security/rateLimit';

// Per-IP first line for this unauthenticated write; the durable per-owner provisional-row
// cap lives in the core. Distinct key prefix keeps its budget separate from the /book path.
const REQUEST_THROTTLE = { limit: 10, windowMs: 60_000 };

export async function submitPublicRequest(formData: FormData): Promise<void> {
  const ip = await getRequestIp();
  if (!checkThrottle(`request:submit:${ip}`, Date.now(), REQUEST_THROTTLE).allowed) {
    redirect('/request?error=too-many');
  }

  const result = await submitPublicRequestNoToken(formData);
  if (result.ok) redirect('/request?sent=1');

  if (result.reason === 'rate-limited') redirect('/request?error=too-many');
  redirect('/request?error=invalid'); // all other reasons → one generic message
}
