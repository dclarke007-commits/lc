// Pure domain module — maps a machine-readable template ActionResult reason
// (AR15) to an operator-facing message. Mirrors capacityErrors.ts / clientErrors.ts:
// the failing server-action wrapper redirects to `?error=<reason>`, the templates
// RSC reads it and calls this to render a server-side banner (zero client JS, NFR1).
// No framework imports.

const TEMPLATE_ERROR_MESSAGES: Record<string, string> = {
  'template-type-invalid': 'That template type is not recognized.',
  'template-body-required': 'Template text cannot be empty.',
  'owner-unresolved': 'No operator is set up. Run the operator seed.',
  'template-write-failed': 'Could not save — please try again.',
};

/** Human-readable text for a template action reason. Unknown → safe fallback. */
export function templateErrorMessage(reason: string | undefined): string | null {
  if (!reason) return null;
  return (
    TEMPLATE_ERROR_MESSAGES[reason] ?? 'Something went wrong — please try again.'
  );
}
