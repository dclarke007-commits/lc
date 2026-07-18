// Story 5.3 — payment-reminder composition. PURE unit tests of the composition
// seam (paymentReminderDraft): no DB, no framework. The Server Action
// (draftPaymentReminder) is thin glue over this helper + the already-tested
// outstanding (5.2) and compose (2.2), so the invariants live here.

import { describe, it, expect } from 'vitest';
import { paymentReminderDraft } from '../lib/domain/compose';

// A reminder template body exercising both sanctioned placeholders a reminder uses.
const BODY = 'Hi {client}, a friendly reminder you have {amount} outstanding.';
const client = { name: 'Ann', phone: '+15551234567' };

describe('compose.paymentReminderDraft (Story 5.3, FR31)', () => {
  it('composes a payment_reminder draft with the owed amount, no slot', () => {
    const draft = paymentReminderDraft(client, 15000, BODY);
    expect(draft).not.toBeNull();
    expect(draft!.type).toBe('payment_reminder');
    expect(draft!.recipient).toBe('+15551234567');
    expect(draft!.body).toBe(
      'Hi Ann, a friendly reminder you have $150.00 outstanding.',
    );
  });

  it('blanks {slot} — a reminder is not slot-bound', () => {
    const draft = paymentReminderDraft(client, 15000, 'See you {slot}. Owe {amount}.');
    // {slot} resolves to blank (no time), collapsed cleanly by resolveTemplate.
    expect(draft!.body).toBe('See you. Owe $150.00.');
  });

  it('never leaks a raw {token}', () => {
    const draft = paymentReminderDraft(client, 15000, BODY);
    expect(draft!.body).not.toMatch(/[{}]/);
  });

  it('guards $0 — owes nothing → no draft', () => {
    expect(paymentReminderDraft(client, 0, BODY)).toBeNull();
  });

  it('guards a negative amount → no draft', () => {
    expect(paymentReminderDraft(client, -500, BODY)).toBeNull();
  });

  it('guards a non-integer amount → no draft (integer cents only)', () => {
    expect(paymentReminderDraft(client, 150.5, BODY)).toBeNull();
  });
});
