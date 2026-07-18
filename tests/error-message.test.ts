import { describe, it, expect } from 'vitest';
import {
  safeErrorMessage,
  DEFAULT_ERROR_MESSAGE,
} from '@/lib/domain/errorMessage';
import { capacityErrorMessage } from '@/lib/domain/capacityErrors';
import { clientErrorMessage } from '@/lib/domain/clientErrors';
import { lifecycleErrorMessage } from '@/lib/domain/lifecycleErrors';
import { templateErrorMessage } from '@/lib/domain/templateErrors';
import { bookingErrorMessage } from '@/lib/domain/bookingErrors';

// Epic-2 retro action item: the prototype-key crash class, killed app-wide via
// the shared safeErrorMessage guard. A tampered `?error=__proto__` etc. must NOT
// return an inherited object/function (which the RSC would render → 500).

const PROTO_KEYS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];

describe('safeErrorMessage', () => {
  const map: Record<string, string> = { 'real-reason': 'A real message.' };

  it('returns null for undefined/empty reason', () => {
    expect(safeErrorMessage(map, undefined)).toBeNull();
    expect(safeErrorMessage(map, '')).toBeNull();
  });

  it('returns the mapped message for a known own-property reason', () => {
    expect(safeErrorMessage(map, 'real-reason')).toBe('A real message.');
  });

  it('returns the fallback for an unknown reason', () => {
    expect(safeErrorMessage(map, 'nope')).toBe(DEFAULT_ERROR_MESSAGE);
  });

  it('honors a custom fallback', () => {
    expect(safeErrorMessage(map, 'nope', 'custom')).toBe('custom');
  });

  it('returns a plain string (never an inherited value) for prototype keys', () => {
    for (const key of PROTO_KEYS) {
      const out = safeErrorMessage(map, key);
      expect(typeof out).toBe('string');
      expect(out).toBe(DEFAULT_ERROR_MESSAGE);
    }
  });
});

describe('all five error-message maps are prototype-key safe', () => {
  const mappers = {
    capacity: capacityErrorMessage,
    client: clientErrorMessage,
    lifecycle: lifecycleErrorMessage,
    template: templateErrorMessage,
    booking: bookingErrorMessage,
  };

  for (const [name, fn] of Object.entries(mappers)) {
    for (const key of PROTO_KEYS) {
      it(`${name}ErrorMessage("${key}") → safe string`, () => {
        const out = fn(key);
        expect(typeof out).toBe('string');
        expect(out).toBe(DEFAULT_ERROR_MESSAGE);
      });
    }
  }
});
