// (a) proxy gate logic: `(operator)` paths are protected; `book/[token]` and the
// sign-in surface are public. Pure — no NextRequest / DB needed.
import { describe, it, expect } from 'vitest';
import { isPublicPath } from '../lib/auth/route-guard';

describe('isPublicPath — operator gate classification', () => {
  it('leaves the public client booking surface open (FR34)', () => {
    expect(isPublicPath('/book/abc123')).toBe(true);
    expect(isPublicPath('/book/some-signed-token')).toBe(true);
  });

  it('leaves the sign-in surface reachable while unauthenticated', () => {
    expect(isPublicPath('/sign-in')).toBe(true);
  });

  it('protects operator routes (dashboard root + nested)', () => {
    expect(isPublicPath('/ledger')).toBe(false);
    expect(isPublicPath('/schedule/today')).toBe(false);
  });

  it('does not treat lookalike prefixes as public', () => {
    expect(isPublicPath('/bookkeeping')).toBe(false);
    expect(isPublicPath('/sign-in-elsewhere')).toBe(false);
  });
});

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
