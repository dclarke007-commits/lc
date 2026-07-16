// Story 2.2 — compose → MessageDraft → deep-link. PURE unit tests (no DB):
//  - compose returns a channel-agnostic {recipient, body, type} with NO transport
//    detail inside (AC1/AD-5), fills placeholders, and is pure.
//  - the lib/delivery adapter renders wa.me/sms links with an encoded body and
//    normalizes phones (AC2); a draft round-trips to a link without itself carrying
//    one; no send happens without following the link (AC3).

import { describe, it, expect } from 'vitest';
import { compose, type MessageDraft } from '../lib/domain/compose';
import { deepLink, normalizePhone } from '../lib/delivery/deeplink';

const client = { name: 'Ana', phone: '(555) 123-4567' };
const bookingTpl = {
  type: 'booking_confirmation' as const,
  body: 'Hi {client}, {slot} for {amount}.',
};

// --- compose (AC1) --------------------------------------------------------

describe('compose → MessageDraft (AC1, AD-5)', () => {
  it('returns exactly {recipient, body, type} with no transport key', () => {
    const draft = compose(client, 'Tue 9am', 20000, bookingTpl);
    expect(Object.keys(draft).sort()).toEqual(['body', 'recipient', 'type']);
    // No transport detail may appear in ANY field (AR6): no url/wa.me/sms/http.
    const serialized = JSON.stringify(draft);
    expect(serialized).not.toMatch(/wa\.me|sms:|https?:|url/i);
  });

  it('fills placeholders and formats integer cents as USD (AR16)', () => {
    const draft = compose(client, 'Tue 9am', 20000, bookingTpl);
    expect(draft.body).toBe('Hi Ana, Tue 9am for $200.00.');
    expect(draft.recipient).toBe('(555) 123-4567'); // raw phone, un-normalized
    expect(draft.type).toBe('booking_confirmation');
  });

  it('a null amount resolves {amount} to blank — never a {token} leak (2.1 AC3)', () => {
    const draft = compose(
      client,
      '',
      null,
      { type: 'payment_reminder', body: 'You owe {amount}.' },
    );
    expect(draft.body).toBe('You owe.');
    expect(draft.body).not.toContain('{');
  });

  it('is pure — same inputs produce a deep-equal draft with no side effect', () => {
    const a = compose(client, 'Tue 9am', 20000, bookingTpl);
    const b = compose(client, 'Tue 9am', 20000, bookingTpl);
    expect(a).toEqual(b);
  });
});

// --- deep-link adapter (AC2, AC3) -----------------------------------------

describe('normalizePhone (Open gap 1)', () => {
  it('strips non-digits and adds the US country code to a 10-digit number', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('15551234567');
    expect(normalizePhone('555-123-4567')).toBe('15551234567');
  });

  it('passes through an already country-coded number', () => {
    expect(normalizePhone('+1 555 123 4567')).toBe('15551234567');
    expect(normalizePhone('15551234567')).toBe('15551234567');
  });

  it('returns null when no digits remain', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('no digits here')).toBeNull();
  });
});

describe('deepLink adapter (AC2, AC3)', () => {
  const draft: MessageDraft = {
    recipient: '555-123-4567',
    body: 'Hi Ana! See you Tue.',
    type: 'booking_confirmation',
  };

  it('renders a wa.me link with the normalized phone and encoded body', () => {
    expect(deepLink(draft, 'whatsapp')).toBe(
      'https://wa.me/15551234567?text=Hi%20Ana!%20See%20you%20Tue.',
    );
  });

  it('renders an sms: link with the encoded body', () => {
    expect(deepLink(draft, 'sms')).toBe(
      'sms:15551234567?&body=Hi%20Ana!%20See%20you%20Tue.',
    );
  });

  it('URL-encodes reserved characters in the body', () => {
    const d: MessageDraft = { ...draft, body: 'A & B? 50% off' };
    expect(deepLink(d, 'whatsapp')).toContain('text=A%20%26%20B%3F%2050%25%20off');
  });

  it('returns null (surface degrades) when the recipient has no phone', () => {
    const d: MessageDraft = { ...draft, recipient: 'no number' };
    expect(deepLink(d, 'whatsapp')).toBeNull();
    expect(deepLink(d, 'sms')).toBeNull();
  });

  it('the draft itself carries no link — transport lives only in the adapter', () => {
    // AC3 / AD-5: compose→draft has no url; the adapter RENDERS a link but the
    // draft never holds one, and rendering does not send (no side effect here).
    expect(JSON.stringify(draft)).not.toMatch(/wa\.me|sms:|https?:/i);
  });
});
