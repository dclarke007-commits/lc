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
  // Win-back action reasons, Story 3.6. The win-back only applies to a client the
  // Story-3.5 derivation currently flags gone-cold; a stale/hand-typed id fails here.
  'not-gone-cold':
    'That client is not currently flagged gone-cold — no win-back needed.',
  'no-phone': 'This client has no usable phone number — add one to send.',
  'win-back-failed': 'Could not build the win-back message — please try again.',
  'template-type-invalid': 'Could not send — please try again.',
  'draft-nonce-missing': 'Could not send — please try again.',
  'dispatch-log-failed': 'Could not record the send — please try again.',
};

/** Human-readable text for an action reason. Unknown reasons get a safe fallback. */
export function clientErrorMessage(reason: string | undefined): string | null {
  if (!reason) return null;
  return CLIENT_ERROR_MESSAGES[reason] ?? 'Something went wrong — please try again.';
}
