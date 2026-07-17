// Pure domain module — maps a machine-readable capacity ActionResult reason
// (AR15) to an operator-facing message. Mirrors clientErrors.ts: the failing
// server-action wrapper redirects to `?error=<reason>`, the settings RSC reads
// it and calls this to render a server-side banner with zero client JS (NFR1).
// No framework imports.

const CAPACITY_ERROR_MESSAGES: Record<string, string> = {
  'working-days-required': 'Choose at least one working day.',
  'working-day-invalid': 'Working days are invalid.',
  'per-day-cap-invalid': 'Per-day cap must be a whole number above zero.',
  'weekly-ceiling-invalid': 'Weekly ceiling must be a whole number above zero.',
  'ceiling-below-per-day': 'Weekly ceiling cannot be below the per-day cap.',
  'price-invalid': 'Default price must be zero or more.',
  'timezone-invalid': 'Enter a valid timezone (e.g. America/Chicago).',
  'owner-unresolved': 'No operator is set up. Run the operator seed.',
  'capacity-write-failed': 'Could not save — please try again.',
};

/** Human-readable text for a capacity action reason. Unknown → safe fallback. */
export function capacityErrorMessage(reason: string | undefined): string | null {
  if (!reason) return null;
  return (
    CAPACITY_ERROR_MESSAGES[reason] ?? 'Something went wrong — please try again.'
  );
}
