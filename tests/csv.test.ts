// Story 6.4 — RFC-4180 CSV serialization (data-ownership export, FR35). PURE unit
// tests: the escaping is the one thing that can silently corrupt an export, so it is
// proven here in isolation from the DB/action layers.

import { describe, it, expect } from 'vitest';
import { escapeCsvField, toCsv } from '../lib/domain/csv';

describe('csv.escapeCsvField (RFC 4180)', () => {
  it('leaves a plain field untouched', () => {
    expect(escapeCsvField('Jane Doe')).toBe('Jane Doe');
  });

  it('quote-wraps a field containing a comma', () => {
    expect(escapeCsvField('Doe, Jane')).toBe('"Doe, Jane"');
  });

  it('quote-wraps and doubles internal double-quotes', () => {
    expect(escapeCsvField('the "boss"')).toBe('"the ""boss"""');
  });

  it('quote-wraps a field containing a newline (CR or LF)', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('null / undefined → empty field, never the literal "null"', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('a number serializes exactly (integer cents stay integer)', () => {
    expect(escapeCsvField(20000)).toBe('20000');
    expect(escapeCsvField(0)).toBe('0');
  });
});

describe('csv.toCsv', () => {
  it('emits a header row + data rows, CRLF-terminated', () => {
    const csv = toCsv(
      ['name', 'phone'],
      [
        ['Ana', '555-1'],
        ['Bea', '555-2'],
      ],
    );
    expect(csv).toBe('name,phone\r\nAna,555-1\r\nBea,555-2');
  });

  it('escapes fields per row — a comma in one field never shifts columns', () => {
    const csv = toCsv(
      ['name', 'address'],
      [['Ana', '1 Main St, Apt 2']],
    );
    // The address is quote-wrapped, so the split stays name | address.
    expect(csv).toBe('name,address\r\nAna,"1 Main St, Apt 2"');
    // Structural check: exactly one CRLF (header + one data row).
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('header only (no rows) → just the header line', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b');
  });

  it('mixed null / number cells serialize correctly', () => {
    const csv = toCsv(
      ['id', 'price_cents', 'completed_at'],
      [['j1', 20000, null]],
    );
    expect(csv).toBe('id,price_cents,completed_at\r\nj1,20000,');
  });
});
