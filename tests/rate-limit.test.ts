// Public-write per-IP throttle (retrospective action item). Pure sliding-window unit
// tests — `nowMs` is injected, so no clock mocking. Each case resets shared module state.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// setup.ts globally replaces checkThrottle with an always-allow stub for wrapper-action
// tests; pull the ACTUAL sliding-window implementation here to test it for real.
const { checkThrottle, __resetThrottle } = await vi.importActual<
  typeof import('../lib/security/rateLimit')
>('../lib/security/rateLimit');

const OPTS = { limit: 3, windowMs: 1000 };

describe('checkThrottle — per-key sliding window', () => {
  beforeEach(() => __resetThrottle());

  it('allows up to the limit within the window, then blocks', () => {
    const key = 'ip-a';
    expect(checkThrottle(key, 0, OPTS).allowed).toBe(true);
    expect(checkThrottle(key, 10, OPTS).allowed).toBe(true);
    expect(checkThrottle(key, 20, OPTS).allowed).toBe(true);
    const blocked = checkThrottle(key, 30, OPTS);
    expect(blocked.allowed).toBe(false);
    // Oldest in-window hit was at t=0; it ages out at t=1000, so retry ≈ 970ms from t=30.
    expect(blocked.retryAfterMs).toBe(970);
  });

  it('a blocked call does not consume budget or push the retry horizon out', () => {
    const key = 'ip-b';
    checkThrottle(key, 0, OPTS);
    checkThrottle(key, 0, OPTS);
    checkThrottle(key, 0, OPTS);
    // Two blocked retries at t=100, t=200 must not extend the window past the t=0 hits.
    checkThrottle(key, 100, OPTS);
    const second = checkThrottle(key, 200, OPTS);
    expect(second.allowed).toBe(false);
    // Still measured from the original t=0 hit → ages out at 1000, retry = 800 from t=200.
    expect(second.retryAfterMs).toBe(800);
  });

  it('slides: once the window passes, the key is allowed again', () => {
    const key = 'ip-c';
    checkThrottle(key, 0, OPTS);
    checkThrottle(key, 0, OPTS);
    checkThrottle(key, 0, OPTS);
    expect(checkThrottle(key, 500, OPTS).allowed).toBe(false); // still within window
    // At t=1001 all three t=0 hits have aged out (strictly-greater-than window start).
    expect(checkThrottle(key, 1001, OPTS).allowed).toBe(true);
  });

  it('keys are independent — one IP hitting the cap does not throttle another', () => {
    expect(checkThrottle('x', 0, OPTS).allowed).toBe(true);
    expect(checkThrottle('x', 0, OPTS).allowed).toBe(true);
    expect(checkThrottle('x', 0, OPTS).allowed).toBe(true);
    expect(checkThrottle('x', 0, OPTS).allowed).toBe(false);
    // A different key starts with a full budget.
    expect(checkThrottle('y', 0, OPTS).allowed).toBe(true);
  });
});
