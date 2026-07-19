// Public-write rate limiting (retrospective action item — the previously-LOCKED gap on
// the unauthenticated book surface). This module is the per-key SLIDING-WINDOW THROTTLE
// layer; the durable provisional-row CAP is DB-backed (queries.countRecentPendingRequests).
//
// Both are DEFENSIVE soft ceilings, NOT invariants — capacity's advisory lock remains the
// one hard guarantee. This throttle is a cheap first line against a single source hammering
// the surface.
//
// LIMITATION (documented, accepted for the current single-tenant deployment): the window
// lives in ONE server instance's memory. It resets on cold start and does NOT span Fluid
// Compute instances, so under horizontal scale-out it is best-effort, not a distributed
// guarantee. A durable cross-instance limit belongs on a shared store (KV/Redis) and is
// the upgrade path when the app becomes multi-tenant / lower-trust. The DB-backed
// provisional-row cap is the layer that DOES survive instance churn.
//
// PURE + testable: `nowMs` is injected (no Date.now() here), so the window is deterministic
// under test. Framework-free (no next/headers) — IP extraction lives in requestIp.ts.

export interface ThrottleOptions {
  /** Max hits permitted within the window. */
  limit: number;
  /** Sliding-window length in milliseconds. */
  windowMs: number;
}

export interface ThrottleResult {
  allowed: boolean;
  /** When blocked, ms until the oldest in-window hit ages out (>= 0). 0 when allowed. */
  retryAfterMs: number;
}

// key -> ascending hit timestamps (ms) still within some caller's window. Pruned lazily.
const buckets = new Map<string, number[]>();

// Backstop against unbounded key growth from IP rotation: when the map crosses this many
// keys, drop every key whose newest hit predates `staleBefore`. This is a memory guard,
// not a correctness mechanism (a legitimate limiter never approaches it in single-tenant).
const MAX_KEYS = 10_000;

function pruneStale(staleBefore: number): void {
  for (const [key, hits] of buckets) {
    if (hits.length === 0 || hits[hits.length - 1] <= staleBefore) {
      buckets.delete(key);
    }
  }
}

/**
 * Record a hit for `key` at `nowMs` and report whether it is within `limit` over the
 * trailing `windowMs`. Sliding window: only timestamps strictly newer than
 * `nowMs - windowMs` count. A BLOCKED call does NOT record the hit (so a caller cannot
 * push its own retry horizon further out by retrying); an ALLOWED call records it.
 */
export function checkThrottle(
  key: string,
  nowMs: number,
  opts: ThrottleOptions,
): ThrottleResult {
  const windowStart = nowMs - opts.windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);

  if (hits.length >= opts.limit) {
    // Keep the pruned window so the bucket doesn't regrow unbounded on repeated blocks.
    buckets.set(key, hits);
    // Guard the empty-hits case (limit <= 0): hits[0] would be undefined → NaN. A blocked
    // window always has >= 1 hit for limit >= 1, but stay total for the generic module.
    const retryAfterMs = hits.length ? hits[0] + opts.windowMs - nowMs : 0;
    return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  hits.push(nowMs);
  buckets.set(key, hits);

  if (buckets.size > MAX_KEYS) {
    pruneStale(windowStart);
    // HARD bound: a flood of fresh (in-window) keys — e.g. rotated/​spoofed IPs — defeats
    // stale pruning (every key's newest hit is still in-window), so the map could grow
    // without limit and each call would re-run an O(n) prune. Evict oldest-inserted
    // entries outright until back under the ceiling, so memory/CPU can never blow up.
    if (buckets.size > MAX_KEYS) {
      const excess = buckets.size - MAX_KEYS;
      let dropped = 0;
      for (const k of buckets.keys()) {
        if (dropped++ >= excess) break;
        buckets.delete(k);
      }
    }
  }

  return { allowed: true, retryAfterMs: 0 };
}

/** Test-only: clear all windows so cases don't leak state into one another. */
export function __resetThrottle(): void {
  buckets.clear();
}
