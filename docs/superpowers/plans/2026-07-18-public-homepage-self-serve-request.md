# Public Homepage + Self-Serve Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public marketing homepage at `/` for the Love's Cleaning service, plus a tokenless self-serve "request a clean" form that mints a provisional client + pending request + inquiry without an operator-issued booking link.

**Architecture:** `/` becomes a public (ungated) marketing page; the operator dashboard moves to `/dashboard`. A new tokenless request path reuses Story 4.2's atomic write (`insertPublicBookingRequest`) but derives `owner_id` from the single-owner lookup (`getOwnerId`) instead of a token, and never touches capacity (AR5). Layering stays surface → action → domain/db (AD-1); only the action is a callable Server Action (redirect-masked).

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), React 19, TypeScript strict, Drizzle ORM + Postgres, Vitest (serial, DB-backed), native-crypto session.

## Global Constraints

- **AD-1 layering:** surface → action → domain → db. Only `lib/db` speaks SQL; new cores are plain modules (NOT `'use server'`) so only the action is a public endpoint.
- **AD-6 / AR7:** `owner_id` NEVER comes from a form field. Tokenless path derives it from `getOwnerId()` (single-owner v1).
- **AR5 / AD-4:** a public request NEVER consumes capacity — no `commitBooking`, no Job, no advisory capacity lock. Only provisional client + pending request + inquiry.
- **AR12:** the write is idempotent per visit-session nonce.
- **Fail-closed masking:** the action returns ONE generic redirect state on both success and every failure reason; raw machine reasons are never surfaced.
- **AD-13:** public surfaces are `dynamic`, never `use cache`.
- **Field bound:** `MAX_FIELD = 200` on name/phone/address (already enforced in `readPublicFields`).
- **Provisional cap:** `PROVISIONAL_MAX_PER_WINDOW = 30` per `PROVISIONAL_WINDOW_MS = 10 * 60 * 1000`, per owner.
- **Per-IP throttle:** `{ limit: 10, windowMs: 60_000 }` via `checkThrottle` + `getRequestIp`, distinct key prefix.
- **Tests are serial + DB-backed:** each mutating test must restore any `process.env` it changes in `afterEach` (singleFork shares process.env across files).
- **Commit message trailer:** end every commit body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Add `web` inquiry source (enum + partial-unique index + migration)

Adds the `web` provenance value so homepage self-serve inquiries are attributable separately from operator-shared `link` inquiries, and gives `web` its own AR12 dedup index (the existing `inquiry_owner_session_link_uq` is partial on `source='link'` and will NOT dedup `web`).

**Files:**
- Modify: `lib/db/schema.ts:470-518` (enum values + new partial unique index)
- Create: `drizzle/0013_public_web_inquiry.sql` (generated)
- Test: `tests/schema-web-source.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `inquirySource` now includes `'web'`; a partial unique index `inquiry_owner_session_web_uq` on `(owner_id, session_nonce) where source = 'web'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/schema-web-source.test.ts
import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db/client';
import { operator, client, inquiry } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

describe('web inquiry source', () => {
  it('accepts source=web and dedups per (owner, session_nonce) for web', async () => {
    const [op] = await db.insert(operator).values({
      email: `web-src-${Date.now()}@t.test`, passphraseHash: 'x',
    }).returning();
    const [c] = await db.insert(client).values({
      ownerId: op.id, name: 'N', phone: 'P', cadence: 'one-time', status: 'provisional',
    }).returning();
    const nonce = `n-${Date.now()}`;

    const first = await db.insert(inquiry)
      .values({ ownerId: op.id, clientId: c.id, source: 'web', sessionNonce: nonce })
      .onConflictDoNothing({
        target: [inquiry.ownerId, inquiry.sessionNonce],
        where: sql`${inquiry.source} = 'web'`,
      }).returning();
    const second = await db.insert(inquiry)
      .values({ ownerId: op.id, clientId: c.id, source: 'web', sessionNonce: nonce })
      .onConflictDoNothing({
        target: [inquiry.ownerId, inquiry.sessionNonce],
        where: sql`${inquiry.source} = 'web'`,
      }).returning();

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0); // AR12 dedup for web
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/schema-web-source.test.ts`
Expected: FAIL — `invalid input value for enum inquiry_source: "web"` (enum lacks `web`).

- [ ] **Step 3: Add `web` to the enum and a matching partial unique index**

In `lib/db/schema.ts`, add `'web'` to the `inquirySource` enum:

```ts
export const inquirySource = pgEnum('inquiry_source', [
  'phone',
  'walk-in',
  'link',
  'web',
  'referral',
  'other',
]);
```

In the `inquiry` table definition (the index list, next to `inquiry_owner_session_link_uq`), add:

```ts
    // AR12 (homepage self-serve): at most one `web` inquiry per (owner, session_nonce).
    // PARTIAL, mirrors the `link` index — the two sources dedup independently.
    uniqueIndex('inquiry_owner_session_web_uq')
      .on(t.ownerId, t.sessionNonce)
      .where(sql`${t.source} = 'web'`),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm drizzle-kit generate --name public_web_inquiry`
Expected: creates `drizzle/0013_public_web_inquiry.sql` containing `ALTER TYPE "inquiry_source" ADD VALUE 'web'` and `CREATE UNIQUE INDEX "inquiry_owner_session_web_uq" ...`.

> If the generator emits the enum ADD VALUE and the index in one transactional file, split so the `ALTER TYPE ... ADD VALUE` is committed before the index uses it (Postgres cannot use a new enum value in the same transaction that adds it). If needed, hand-edit `0013_*.sql` to two statements with the enum add first; verify by applying to a clean DB in Step 5.

- [ ] **Step 5: Apply the migration and verify the test passes**

Run: `pnpm drizzle-kit migrate && pnpm vitest run tests/schema-web-source.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts drizzle/0013_public_web_inquiry.sql drizzle/meta tests/schema-web-source.test.ts
git commit -m "feat(db): add web inquiry source + AR12 dedup index for self-serve requests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Parametrize `insertPublicBookingRequest` with `source`

The atomic write currently hard-codes the inquiry `source: 'link'` and the ON CONFLICT `where source='link'`. Add an optional `source` so the tokenless homepage path can write `'web'` through the SAME transaction (DRY), token path unchanged (defaults to `'link'`).

**Files:**
- Modify: `lib/db/queries.ts:748-760` (`PublicBookingRequestInput` type), `lib/db/queries.ts:800-880` (`insertPublicBookingRequest` body)
- Test: `tests/public-booking-request.test.ts` (extend if present; else create)

**Interfaces:**
- Consumes: `inquirySource` from Task 1 (`'web'`).
- Produces: `PublicBookingRequestInput` gains `source?: 'link' | 'web'` (default `'link'`). `insertPublicBookingRequest(input)` writes the inquiry with `input.source ?? 'link'` and the matching partial-unique conflict target.

- [ ] **Step 1: Write the failing test**

```ts
// tests/public-booking-request.test.ts  (add this test; keep existing ones)
import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db/client';
import { operator, inquiry } from '@/lib/db/schema';
import { insertPublicBookingRequest } from '@/lib/db/queries';
import { eq } from 'drizzle-orm';

describe('insertPublicBookingRequest source param', () => {
  it('writes a web-source inquiry when source=web', async () => {
    const [op] = await db.insert(operator).values({
      email: `ins-web-${Date.now()}@t.test`, passphraseHash: 'x',
    }).returning();

    const res = await insertPublicBookingRequest({
      ownerId: op.id, name: 'Web Stranger', phone: '555', address: null,
      requestedDate: '2026-08-01', sessionNonce: `wn-${Date.now()}`, source: 'web',
    });

    expect(res.created).toBe(true);
    const rows = await db.select().from(inquiry).where(eq(inquiry.ownerId, op.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('web');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/public-booking-request.test.ts -t "source=web"`
Expected: FAIL — either a type error on the unknown `source` field, or the inquiry is written as `'link'` (assertion `toBe('web')` fails).

- [ ] **Step 3: Add `source` to the input type**

In `lib/db/queries.ts`, extend `PublicBookingRequestInput` (near line 748):

```ts
export interface PublicBookingRequestInput {
  ownerId: string;
  name: string;
  phone: string;
  address: string | null;
  requestedDate: string;
  sessionNonce: string;
  cap?: { sinceIso: string; max: number };
  /** Inquiry provenance for this public write. Defaults to 'link' (token path). */
  source?: 'link' | 'web';
}
```

- [ ] **Step 4: Use `source` in the inquiry insert**

In `insertPublicBookingRequest`, destructure `source` and use it for BOTH the value and the partial-index conflict `where`:

```ts
  const { ownerId, name, phone, address, requestedDate, sessionNonce, cap, source } =
    input;
  const inquirySrc = source ?? 'link';
```

Then the inquiry insert becomes:

```ts
      const [inq] = await tx
        .insert(inquiry)
        .values({ ownerId, clientId: c.id, source: inquirySrc, sessionNonce })
        .onConflictDoNothing({
          target: [inquiry.ownerId, inquiry.sessionNonce],
          where: eq(inquiry.source, inquirySrc),
        })
        .returning();
```

(The `pendingRequest` insert and its conflict target are unchanged — that dedup is source-agnostic.)

- [ ] **Step 5: Run the full public-booking-request suite**

Run: `pnpm vitest run tests/public-booking-request.test.ts`
Expected: PASS — the new `source=web` test AND all pre-existing token-path (`link`) tests still green (default keeps token behavior identical).

- [ ] **Step 6: Commit**

```bash
git add lib/db/queries.ts tests/public-booking-request.test.ts
git commit -m "feat(db): parametrize insertPublicBookingRequest source (link|web), default link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Export `readPublicFields` + cap constants for reuse

The tokenless core (Task 4) needs the exact same field validation/normalisation and cap constants the token path uses. Export them from the existing module so there is ONE validator (DRY), no behavior change.

**Files:**
- Modify: `app/book/[token]/request.ts` (change `function readPublicFields` → `export function`; export the two constants)
- Test: existing `app/book/[token]/request.test.ts` (must stay green — no new test)

**Interfaces:**
- Produces:
  - `export function readPublicFields(formData: FormData): { ok: true; name: string; phone: string; address: string | null; date: string; sessionNonce: string } | { ok: false; reason: string }`
  - `export const PROVISIONAL_WINDOW_MS: number`
  - `export const PROVISIONAL_MAX_PER_WINDOW: number`

- [ ] **Step 1: Add exports (no logic change)**

In `app/book/[token]/request.ts`:
- Change `const PROVISIONAL_WINDOW_MS = ...` → `export const PROVISIONAL_WINDOW_MS = ...`
- Change `const PROVISIONAL_MAX_PER_WINDOW = ...` → `export const PROVISIONAL_MAX_PER_WINDOW = ...`
- Change `function readPublicFields(` → `export function readPublicFields(`

> `request.ts` is NOT a `'use server'` module (see its header comment), so adding non-async exports does NOT create new endpoints. Do not add any `'use server'` directive.

- [ ] **Step 2: Typecheck + run the existing request suite**

Run: `pnpm tsc --noEmit && pnpm vitest run "app/book/[token]/request.test.ts"`
Expected: PASS — behavior unchanged; exports are additive.

- [ ] **Step 3: Commit**

```bash
git add "app/book/[token]/request.ts"
git commit -m "refactor: export readPublicFields + provisional cap constants for reuse

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Tokenless request core `submitPublicRequestNoToken`

The unit-testable core for the homepage/`/request` path. Owner from `getOwnerId()`, same field validation + provisional cap, writes with `source: 'web'`, NO token resolution and NO open-slot derive (there is no per-client offered set — the date is a stated preference; capacity is still never consumed per AR5).

**Files:**
- Create: `app/request/request.ts`
- Test: `app/request/request.test.ts`

**Interfaces:**
- Consumes: `getOwnerId` (`lib/db/queries.ts:48`, `(): Promise<string>`, throws if unseeded), `insertPublicBookingRequest` + `countRecentPendingRequests` (`lib/db/queries.ts`), `readPublicFields` + `PROVISIONAL_WINDOW_MS` + `PROVISIONAL_MAX_PER_WINDOW` (Task 3), `ok`/`fail`/`ActionResult` (`lib/domain/result`).
- Produces: `export async function submitPublicRequestNoToken(formData: FormData): Promise<ActionResult<{ created: boolean }>>`.

- [ ] **Step 1: Write the failing tests**

```ts
// app/request/request.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import { operator, client, pendingRequest, inquiry, job } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { submitPublicRequestNoToken } from './request';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

async function seedOwner() {
  await db.delete(operator); // serial DB — single-owner isolation for this file
  const [op] = await db.insert(operator).values({
    email: `req-${Date.now()}@t.test`, passphraseHash: 'x',
  }).returning();
  return op.id;
}

describe('submitPublicRequestNoToken', () => {
  beforeEach(async () => { await db.delete(operator); });

  it('creates provisional client + pending request + web inquiry, no capacity', async () => {
    const ownerId = await seedOwner();
    const res = await submitPublicRequestNoToken(
      fd({ name: 'Sam', phone: '555-1', address: '1 St', date: '2026-08-04', visit: 's1' }),
    );
    expect(res.ok).toBe(true);

    const clients = await db.select().from(client).where(eq(client.ownerId, ownerId));
    const reqs = await db.select().from(pendingRequest).where(eq(pendingRequest.ownerId, ownerId));
    const inqs = await db.select().from(inquiry).where(eq(inquiry.ownerId, ownerId));
    const jobs = await db.select().from(job).where(eq(job.ownerId, ownerId));

    expect(clients).toHaveLength(1);
    expect(clients[0].status).toBe('provisional');
    expect(reqs).toHaveLength(1);
    expect(inqs).toHaveLength(1);
    expect(inqs[0].source).toBe('web');
    expect(jobs).toHaveLength(0); // AR5 — never consumes capacity
  });

  it('is idempotent within one visit session (double-submit same day)', async () => {
    await seedOwner();
    const same = { name: 'Sam', phone: '555-1', address: '1 St', date: '2026-08-04', visit: 'dup' };
    const a = await submitPublicRequestNoToken(fd(same));
    const b = await submitPublicRequestNoToken(fd(same));
    expect(a.ok && b.ok).toBe(true);
    const reqs = await db.select().from(pendingRequest);
    expect(reqs).toHaveLength(1); // one row, not two
  });

  it('rejects missing required fields with a masked-able reason', async () => {
    await seedOwner();
    const res = await submitPublicRequestNoToken(fd({ name: '', phone: '', date: '' }));
    expect(res.ok).toBe(false);
  });

  it('fails closed when no operator is seeded', async () => {
    await db.delete(operator);
    const res = await submitPublicRequestNoToken(
      fd({ name: 'Sam', phone: '555', date: '2026-08-04', visit: 'x' }),
    );
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run app/request/request.test.ts`
Expected: FAIL — `Cannot find module './request'` / `submitPublicRequestNoToken is not a function`.

- [ ] **Step 3: Write the core**

```ts
// app/request/request.ts
// Tokenless NEW-CLIENT public request core (homepage self-serve). Mirror of the
// token path (app/book/[token]/request.ts) with two differences: (1) owner_id comes
// from the single-owner lookup getOwnerId() — NEVER a form field (AR7/AD-6); (2) there
// is no per-client offered slot set, so the date is stored as a stated preference and
// no open-week derive runs. Capacity is STILL never consumed (AR5): the write mints only
// a provisional client + pending request + one `web` inquiry, idempotent per visit (AR12).
//
// A plain module (NOT 'use server') so it is unit-testable and is NOT itself a public
// endpoint — only app/request/actions.ts registers the redirect-masked Server Action.

import { getOwnerId, insertPublicBookingRequest, countRecentPendingRequests } from '@/lib/db/queries';
import {
  readPublicFields,
  PROVISIONAL_WINDOW_MS,
  PROVISIONAL_MAX_PER_WINDOW,
} from '@/app/book/[token]/request';
import { ok, fail, type ActionResult } from '@/lib/domain/result';

export async function submitPublicRequestNoToken(
  formData: FormData,
): Promise<ActionResult<{ created: boolean }>> {
  // Single-owner v1: owner_id is resolved server-side, never from the form (AR7/AD-6).
  // getOwnerId throws when unseeded — fail closed to a generic reason (never a raw 500).
  let ownerId: string;
  try {
    ownerId = await getOwnerId();
  } catch (err) {
    console.error('[request] no operator seeded (fail-closed)');
    return fail('invalid');
  }

  const fields = readPublicFields(formData);
  if (!fields.ok) return fail(fields.reason);

  // Provisional-row cap pre-check (load-shed). Fail-closed on a count error — the same
  // discipline as the token path: an induced count error must not widen the flood window.
  const capSinceIso = new Date(Date.now() - PROVISIONAL_WINDOW_MS).toISOString();
  try {
    const recent = await countRecentPendingRequests(ownerId, capSinceIso);
    if (recent >= PROVISIONAL_MAX_PER_WINDOW) return fail('rate-limited');
  } catch (err) {
    console.error('[request] provisional-row count failed (fail-closed)');
    return fail('invalid');
  }

  try {
    const result = await insertPublicBookingRequest({
      ownerId,
      name: fields.name,
      phone: fields.phone,
      address: fields.address,
      requestedDate: fields.date, // stated preference; no open-set validation (no token view)
      sessionNonce: fields.sessionNonce,
      source: 'web',
      cap: { sinceIso: capSinceIso, max: PROVISIONAL_MAX_PER_WINDOW },
    });
    if (!result.created && result.reason === 'rate-limited') return fail('rate-limited');
    return ok({ created: result.created }); // duplicate (same session+day) is still success
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown';
    console.error('[request] write failed (fail-closed):', detail);
    return fail('invalid');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/request/request.test.ts`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add app/request/request.ts app/request/request.test.ts
git commit -m "feat(request): tokenless new-client request core (owner from getOwnerId, web inquiry)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Open `/` and `/request` in the route guard

Make the marketing homepage and request route reachable without an operator session, while keeping everything else (including the moved `/dashboard`) gated.

**Files:**
- Modify: `lib/auth/route-guard.ts`
- Test: `tests/route-guard.test.ts` (extend if present; else create)

**Interfaces:**
- Consumes: nothing.
- Produces: `isPublicPath('/') === true`, `isPublicPath('/request') === true`, `isPublicPath('/dashboard') === false`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/route-guard.test.ts  (add these cases; keep existing)
import { describe, it, expect } from 'vitest';
import { isPublicPath } from '@/lib/auth/route-guard';

describe('isPublicPath — homepage + request', () => {
  it('opens the public homepage and request route', () => {
    expect(isPublicPath('/')).toBe(true);
    expect(isPublicPath('/request')).toBe(true);
  });
  it('keeps the moved dashboard and operator routes gated', () => {
    expect(isPublicPath('/dashboard')).toBe(false);
    expect(isPublicPath('/clients')).toBe(false);
    expect(isPublicPath('/settings')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/route-guard.test.ts -t "homepage"`
Expected: FAIL — `isPublicPath('/')` is `false` (only `/book`, `/sign-in` open today).

- [ ] **Step 3: Add `/` and `/request` to the exact public set**

In `lib/auth/route-guard.ts`:

```ts
// `/` (marketing homepage) and `/request` (self-serve) are matched EXACTLY — never as
// prefixes — so opening them cannot accidentally open a gated child route.
const PUBLIC_EXACT = new Set(['/', '/sign-in', '/request']);
```

Leave `PUBLIC_PREFIXES = ['/book']` and the rest of the function unchanged. (`/` is only ever an exact match here; `isPublicPath('/dashboard')` still falls through to `false`.)

- [ ] **Step 4: Run the guard suite**

Run: `pnpm vitest run tests/route-guard.test.ts`
Expected: PASS — new cases green AND existing `/book` / `/sign-in` cases still green.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/route-guard.ts tests/route-guard.test.ts
git commit -m "feat(auth): open / and /request in the public route guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Move the operator dashboard to `/dashboard`

Free `/` for the public homepage by moving the dashboard page into a `/dashboard` segment and repointing the sign-in redirect. The moved page's logic is unchanged (it still reads the session and redirects to `/sign-in` when absent — defense-in-depth AD-6).

**Files:**
- Move: `app/(operator)/page.tsx` → `app/(operator)/dashboard/page.tsx` (also move its co-located `export/` dir if the import is relative — see Step 2)
- Modify: `app/(operator)/sign-in/page.tsx:21` (`router.replace('/')` → `router.replace('/dashboard')`)
- Test: manual (Task 9) + the guard test from Task 5 already asserts `/dashboard` is gated.

**Interfaces:**
- Consumes: `isPublicPath` behavior from Task 5.
- Produces: dashboard served at `/dashboard`; unauthenticated `/dashboard` → `/sign-in`; post-sign-in lands on `/dashboard`.

- [ ] **Step 1: Move the page file**

```bash
git mv "app/(operator)/page.tsx" "app/(operator)/dashboard/page.tsx"
```

- [ ] **Step 2: Fix the co-located import**

The dashboard imports `./export/ExportButtons` (relative). Choose ONE:
- Move the folder too: `git mv "app/(operator)/export" "app/(operator)/dashboard/export"` and keep `import { ExportButtons } from './export/ExportButtons';`, OR
- Leave `export/` where it is and change the import to `import { ExportButtons } from '../export/ExportButtons';`.

Prefer moving the folder (keeps the dashboard's pieces together). After choosing, grep for any other route importing `export/ExportButtons`:

Run: `grep -rn "export/ExportButtons" app`
Expected: only the dashboard references it; if another route does, use the `../` import form instead of moving.

- [ ] **Step 3: Repoint the sign-in redirect**

In `app/(operator)/sign-in/page.tsx` line ~21:

```ts
        router.replace('/dashboard');
```

Then grep for any other `'/'` redirect/link that means "the dashboard":

Run: `grep -rn "replace('/')\|redirect('/')\|href=\"/\"" app/\(operator\)`
Expected: none remain that mean the dashboard. (The session cookie `path: '/'` in `sign-in/actions.ts:44` is cookie SCOPE — leave it as `/`.)

- [ ] **Step 4: Typecheck + build**

Run: `pnpm tsc --noEmit`
Expected: PASS (no dangling imports).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(operator): move dashboard to /dashboard, sign-in lands there

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Request action + `/request` page (form + thank-you)

The redirect-masked Server Action and the standalone `/request` page. The action is the ONLY public endpoint for this path; it throttles per-IP, delegates to the Task 4 core, and maps every outcome to a generic redirect state.

**Files:**
- Create: `app/request/actions.ts`
- Create: `app/request/page.tsx`
- Create: `app/request/RequestForm.tsx` (client component: renders the form + a per-render `visit` nonce)
- Test: `app/request/actions.test.ts` (redirect-mask behavior)

**Interfaces:**
- Consumes: `submitPublicRequestNoToken` (Task 4), `getRequestIp` (`@/lib/security/requestIp`), `checkThrottle` (`@/lib/security/rateLimit`), `generateTokenNonce` (`@/lib/auth/clientToken`).
- Produces: `export async function submitPublicRequest(formData: FormData): Promise<void>` (redirects). Page reads `?sent=1` / `?error=...` to render banners.

- [ ] **Step 1: Write the failing test**

```ts
// app/request/actions.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { operator } from '@/lib/db/schema';

// Capture redirect target (next/navigation redirect throws NEXT_REDIRECT).
const redirectMock = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); });
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirectMock(u) }));
vi.mock('@/lib/security/requestIp', () => ({ getRequestIp: async () => '1.2.3.4' }));

import { submitPublicRequest } from './actions';

function fd(e: Record<string, string>): FormData {
  const f = new FormData(); for (const [k, v] of Object.entries(e)) f.set(k, v); return f;
}

describe('submitPublicRequest (redirect mask)', () => {
  beforeEach(async () => { redirectMock.mockClear(); await db.delete(operator); });

  it('redirects to ?sent=1 on success', async () => {
    await db.insert(operator).values({ email: `a-${Date.now()}@t.test`, passphraseHash: 'x' });
    await expect(
      submitPublicRequest(fd({ name: 'Sam', phone: '555', date: '2026-08-04', visit: 'v1' })),
    ).rejects.toThrow('REDIRECT:/request?sent=1');
  });

  it('masks a validation failure as ?error=invalid (never the raw reason)', async () => {
    await db.insert(operator).values({ email: `b-${Date.now()}@t.test`, passphraseHash: 'x' });
    await expect(
      submitPublicRequest(fd({ name: '', phone: '', date: '' })),
    ).rejects.toThrow('REDIRECT:/request?error=invalid');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/request/actions.test.ts`
Expected: FAIL — `Cannot find module './actions'`.

- [ ] **Step 3: Write the action**

```ts
// app/request/actions.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run app/request/actions.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Write the form (client component with a per-render visit nonce)**

```tsx
// app/request/RequestForm.tsx
'use client';

// Zero-heavy form (NFR1): posts directly to the Server Action. `visit` is a per-render
// session nonce (AR12) so a double-submit of the same day dedups to one request. Client
// component only to mint the nonce once per mount; no other interactivity required.
import { useState } from 'react';
import { submitPublicRequest } from './actions';

export function RequestForm() {
  // Mint once per mount. crypto.randomUUID is available in the browser.
  const [visit] = useState(() => crypto.randomUUID());
  return (
    <form action={submitPublicRequest} className="request-form">
      <input type="hidden" name="visit" value={visit} />
      <label>Name<input name="name" required maxLength={200} autoComplete="name" /></label>
      <label>Phone<input name="phone" required maxLength={200} autoComplete="tel" inputMode="tel" /></label>
      <label>Address (optional)<input name="address" maxLength={200} autoComplete="street-address" /></label>
      <label>Preferred date<input name="date" type="date" required /></label>
      <button type="submit">Request a clean</button>
    </form>
  );
}
```

- [ ] **Step 6: Write the `/request` page**

```tsx
// app/request/page.tsx
// Standalone self-serve request surface (also linked from the homepage CTA). Public
// (opened in the route guard). Renders the form + a masked banner from the redirect state.
import { RequestForm } from './RequestForm';

export const dynamic = 'force-dynamic';

export default async function RequestPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const banner =
    sp.sent === '1'
      ? { kind: 'ok', text: "Thanks — we've got your request and will be in touch to confirm a time." }
      : sp.error === 'too-many'
        ? { kind: 'warn', text: 'That was a lot of requests just now — please try again in a minute.' }
        : sp.error === 'invalid'
          ? { kind: 'warn', text: "We couldn't submit that — please check your details and try again." }
          : null;

  return (
    <main style={{ padding: '1.5rem', maxWidth: 480 }}>
      <h1>Request a clean</h1>
      {banner && (
        <p role="status" className={`banner banner--${banner.kind}`}>{banner.text}</p>
      )}
      {sp.sent === '1' ? null : <RequestForm />}
    </main>
  );
}
```

> Banner/element styling: reuse the client-temperament tokens already in `app/globals.css` (the same CSS vars `app/book/[token]/page.tsx` uses — e.g. `--surface`, `--line`, `--ink`, `--radius-sm`, and the amber/green signal vars). Confirm exact names in `app/globals.css` before styling; do not introduce new hard-coded colors.

- [ ] **Step 7: Typecheck + full suite**

Run: `pnpm tsc --noEmit && pnpm vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/request/actions.ts app/request/actions.test.ts app/request/page.tsx app/request/RequestForm.tsx
git commit -m "feat(request): redirect-masked self-serve action + /request page & form

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Public marketing homepage `app/page.tsx`

The public `/` landing page describing the Love's Cleaning service, client-temperament styling, phone-first, with the request form inline plus a discreet operator sign-in link.

**Files:**
- Create: `app/page.tsx`
- Test: manual (Task 9). No unit test — static content component.

**Interfaces:**
- Consumes: `RequestForm` (Task 7).
- Produces: the `/` route (top-level, outside `(operator)`, ungated per Task 5).

- [ ] **Step 1: Write the homepage**

```tsx
// app/page.tsx
// PUBLIC marketing homepage for the Love's Cleaning SERVICE (not the operator tool).
// Ungated (route guard opens '/'). Client-temperament styling — calm light surface,
// amber primary CTA (green is reserved for paid/confirmed elsewhere, unused here).
// Phone-first single scroll. The self-serve request form is inline (Task 7 core).
import Link from 'next/link';
import { RequestForm } from './request/RequestForm';

export const metadata = {
  title: "Love's Cleaning — a spotless home, no hassle",
  description:
    "Reliable home cleaning from a local, trusted cleaner. Request a clean online and we'll confirm a time.",
};

export default function HomePage() {
  return (
    <main className="marketing">
      {/* Hero */}
      <section className="hero">
        <h1>Love&apos;s Cleaning — a spotless home, no hassle.</h1>
        <p>Reliable, thorough cleaning from a local cleaner you can count on.</p>
        <a href="#request" className="cta-primary">Book a clean →</a>
      </section>

      {/* Services */}
      <section aria-labelledby="services-h">
        <h2 id="services-h">What we clean</h2>
        <ul className="cards">
          <li><strong>Regular clean</strong><span>Weekly or fortnightly upkeep that keeps the whole home fresh.</span></li>
          <li><strong>Deep clean</strong><span>A top-to-bottom reset — the corners a quick tidy always misses.</span></li>
          <li><strong>Move-out clean</strong><span>Hand the keys back spotless and get the deposit back.</span></li>
        </ul>
      </section>

      {/* Why us */}
      <section aria-labelledby="why-h">
        <h2 id="why-h">Why Love&apos;s Cleaning</h2>
        <ul className="cards">
          <li><strong>Dependable</strong><span>Show-up-on-time, same trusted cleaner every visit.</span></li>
          <li><strong>Thorough</strong><span>A real checklist, not a rushed once-over.</span></li>
          <li><strong>Local</strong><span>A neighbour, not a faceless agency.</span></li>
        </ul>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-h">
        <h2 id="how-h">How it works</h2>
        <ol className="steps">
          <li>Send a request with your details and a preferred day.</li>
          <li>We confirm a time that works for both of us.</li>
          <li>We clean — you come home to a spotless place.</li>
        </ol>
      </section>

      {/* Request form (CTA target) */}
      <section id="request" aria-labelledby="request-h">
        <h2 id="request-h">Request a clean</h2>
        <p>Tell us how to reach you and when you&apos;d like us — we&apos;ll be in touch to confirm.</p>
        <RequestForm />
      </section>

      <footer className="marketing-footer">
        <p>Serving the local area. Questions? Get in touch.</p>
        <Link href="/sign-in" className="operator-link">Operator sign-in</Link>
      </footer>
    </main>
  );
}
```

> Styling: add the `.marketing`, `.hero`, `.cta-primary`, `.cards`, `.steps`, `.marketing-footer`, `.operator-link` rules to `app/globals.css` using the EXISTING client-temperament CSS variables (calm light `--surface`-family + amber signal var for `.cta-primary`, dark ink on amber for its text). Do NOT hard-code hex values — reference the tokens already defined for the client/book surface. Keep it phone-first (single column, generous tap targets ≥44px). Confirm the exact token names in `app/globals.css` first.

- [ ] **Step 2: Typecheck + build**

Run: `pnpm tsc --noEmit && pnpm build`
Expected: PASS — `/` and `/request` appear as routes; `/dashboard` present; build clean.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx app/globals.css
git commit -m "feat(marketing): public homepage for the Love's Cleaning service at /

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: End-to-end verification + security review handoff

Prove the whole flow works against a running app (not just unit tests), then hand off for the mandatory security review of the new public write.

**Files:** none (verification only).

- [ ] **Step 1: Migrate + seed + start the dev server**

Run: `pnpm drizzle-kit migrate && pnpm db:seed && pnpm dev`
Expected: server ready; operator seeded (`operator@lovescleaning.test`).

- [ ] **Step 2: Verify the public homepage (unauthenticated)**

- Open `/` in a fresh/incognito browser (no session cookie).
- Expected: the marketing homepage renders (NOT a redirect to `/sign-in`), hero + services + form visible.

- [ ] **Step 3: Verify the self-serve request writes correctly**

- Submit the form with name/phone/date.
- Expected: redirect to `/request?sent=1` with the thank-you banner.
- Verify rows: `psql` (or a throwaway query) — exactly one new `client` (status `provisional`), one `pending_request`, one `inquiry` with `source='web'`, and ZERO new `job` rows (AR5). Confirm the new request appears in the operator's `/requests` queue after signing in.

- [ ] **Step 4: Verify idempotency + the dashboard move**

- Re-submit the SAME form without reloading (same `visit` nonce) → still `?sent=1`, still exactly one `pending_request` (no duplicate).
- Hit `/dashboard` unauthenticated → redirected to `/sign-in`. Sign in → land on `/dashboard`, dashboard renders. Hit `/` while signed in → still the public homepage (fine).

- [ ] **Step 5: Merge base + run the full gate**

Run: `pnpm tsc --noEmit && pnpm vitest run && pnpm build`
Expected: all green.

- [ ] **Step 6: Security review (mandatory — new public write surface)**

Dispatch a security review of the diff (per project discipline — every public-write change gets one). Focus: `owner_id` never sourced from the form; fail-closed masking on every branch of `submitPublicRequest`; per-IP throttle + per-owner provisional cap both active on the tokenless path; field bounds; the `web` partial-unique dedup; the route guard opens ONLY `/` and `/request` (no gated route widened). Address findings before opening the PR.

- [ ] **Step 7: Open the PR**

```bash
git push -u origin feat/public-homepage
gh pr create --fill --base main
```

---

## Self-Review

**Spec coverage:**
- §1 Routing → Tasks 5 (guard) + 6 (dashboard move) + 8 (homepage at `/`). ✓
- §2 Homepage content → Task 8 (all six sections + operator sign-in link). ✓
- §3 Self-serve backend (tokenless core, owner derivation, action, form placement) → Tasks 3 (export validator), 4 (core, owner via `getOwnerId`), 7 (action + form on `/request`), 8 (form inline on homepage). ✓
- §4 Security (rate limit, provisional cap, field bounds, masking, gate) → Tasks 4 + 7 + 5, verified in Task 9 Step 6. ✓
- §5 Data model (`web` source + migration) → Tasks 1 + 2. ✓
- §6 Testing → Tasks 1–7 each carry tests; Task 9 is manual E2E. ✓
- §7 Out of scope respected (no CMS, no multi-owner, no slot offering, no notifications). ✓

**Deviations from spec (intentional, lower-risk):**
- Spec proposed a new `getSingleOwnerId()`; the codebase already has `getOwnerId()` (queries.ts:48) with the exact single-owner semantics — Task 4 reuses it (DRY). No new query.
- Spec left "tokenless insert overload vs shared body" open; Task 2 keeps ONE transactional body by adding an optional `source` param (default `'link'`), so the token path is byte-for-byte unchanged and the `web` path reuses it.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; every test step shows the assertion and the expected run output. Styling steps reference concrete existing tokens in `app/globals.css` with an instruction to confirm names — not a placeholder, a bounded lookup.

**Type consistency:** `submitPublicRequestNoToken(formData): Promise<ActionResult<{created:boolean}>>`, `insertPublicBookingRequest` input `source?: 'link'|'web'`, `readPublicFields` export signature, `isPublicPath` cases, and `getOwnerId(): Promise<string>` are used identically across Tasks 2/4/5/7. ✓
