// Pure domain module — maps a machine-readable ActionResult reason (AR15) to an
// operator-facing message. Lives below the surfaces so the RSC pages can render
// a server-side error banner with zero client JS (NFR1): the failing server-
// action wrapper redirects to `?error=<reason>`, the page reads it and calls
// this. No framework imports.

const CLIENT_ERROR_MESSAGES: Record<string, string> = {
  'name-required': 'Name is required.',
  'phone-required': 'Phone is required.',
  'cadence-invalid': 'Choose a valid cadence.',
  'id-required': 'Missing client id.',
  'client-not-found': 'That client no longer exists.',
  'owner-unresolved': 'No operator is set up. Run the operator seed.',
  'client-write-failed': 'Could not save — please try again.',
};

/** Human-readable text for an action reason. Unknown reasons get a safe fallback. */
export function clientErrorMessage(reason: string | undefined): string | null {
  if (!reason) return null;
  return CLIENT_ERROR_MESSAGES[reason] ?? 'Something went wrong — please try again.';
}
