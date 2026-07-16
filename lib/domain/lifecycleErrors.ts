// Pure domain module — maps a machine-readable lifecycle ActionResult reason
// (AR15) to an operator-facing message. Mirrors bookingErrors.ts/capacityErrors.ts:
// the failing server-action wrapper redirects to `?error=<reason>`, the jobs RSC
// reads it and renders a server-side banner with zero client JS (NFR1). No
// framework imports.

const LIFECYCLE_ERROR_MESSAGES: Record<string, string> = {
  'job-not-found': 'That job could not be found.',
  'illegal-transition': 'That change is not allowed from the job’s current state.',
  'lifecycle-write-failed': 'Could not update the job — please try again.',
  'owner-unresolved': 'No operator is set up. Run the operator seed.',
};

/** Human-readable text for a lifecycle action reason. Unknown → safe fallback. */
export function lifecycleErrorMessage(
  reason: string | undefined,
): string | null {
  if (!reason) return null;
  return (
    LIFECYCLE_ERROR_MESSAGES[reason] ??
    'Something went wrong — please try again.'
  );
}
