// Pure domain module — maps a machine-readable jobs-surface ActionResult reason
// (AR15) to an operator-facing message. Covers every reason the /jobs actions can
// return: lifecycle marks + cancel (mark*/markCancelled) AND reschedule (a
// capacity op surfaced on the same page, Story 1.6). Mirrors bookingErrors.ts:
// the failing server-action wrapper redirects to `?error=<reason>`, the jobs RSC
// reads it and renders a server-side banner with zero client JS (NFR1). No
// framework imports.

const LIFECYCLE_ERROR_MESSAGES: Record<string, string> = {
  'job-not-found': 'That job could not be found.',
  'illegal-transition': 'That change is not allowed from the job’s current state.',
  'lifecycle-write-failed': 'Could not update the job — please try again.',
  'owner-unresolved': 'No operator is set up. Run the operator seed.',
  // Reschedule (capacity) reasons, Story 1.6.
  'not-reschedulable': 'Only a booked job can be rescheduled.',
  'date-invalid': 'Choose a valid date.',
  'non-working-day': 'That is not one of your working days.',
  'date-past': 'That date has already passed.',
  'day-maxed': 'That day is already full — pick another date.',
  'week-full': 'That week is already full — pick another week.',
  'reschedule-failed': 'Could not reschedule the job — please try again.',
};

/** Human-readable text for a jobs-surface action reason. Unknown → safe fallback. */
export function lifecycleErrorMessage(
  reason: string | undefined,
): string | null {
  if (!reason) return null;
  return (
    LIFECYCLE_ERROR_MESSAGES[reason] ??
    'Something went wrong — please try again.'
  );
}
