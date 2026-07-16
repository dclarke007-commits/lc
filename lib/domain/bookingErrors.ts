// Pure domain module — maps a machine-readable booking ActionResult reason (AR15)
// to an operator-facing message. Mirrors capacityErrors.ts: the failing
// server-action wrapper redirects to `?error=<reason>`, the bookings RSC reads it
// and renders a server-side banner with zero client JS (NFR1). No framework
// imports. `day-maxed`/`week-full` are the FR9 capacity reasons.

const BOOKING_ERROR_MESSAGES: Record<string, string> = {
  'day-maxed': 'That day is full. Turn on override to book past the cap.',
  'week-full': 'That week is full (14 jobs). Turn on override to book past it.',
  'client-not-found': 'Pick a client from your list.',
  'date-invalid': 'Choose a valid date.',
  'idempotency-key-missing': 'Something went wrong — please try again.',
  'owner-unresolved': 'No operator is set up. Run the operator seed.',
  'booking-failed': 'Could not book — please try again.',
};

/** Human-readable text for a booking action reason. Unknown → safe fallback. */
export function bookingErrorMessage(reason: string | undefined): string | null {
  if (!reason) return null;
  return (
    BOOKING_ERROR_MESSAGES[reason] ?? 'Something went wrong — please try again.'
  );
}
