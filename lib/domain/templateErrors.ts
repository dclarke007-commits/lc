// Pure domain module — maps a machine-readable template ActionResult reason
// (AR15) to an operator-facing message. Mirrors capacityErrors.ts / clientErrors.ts:
// the failing server-action wrapper redirects to `?error=<reason>`, the templates
// RSC reads it and calls this to render a server-side banner (zero client JS, NFR1).
// No framework imports.

const TEMPLATE_ERROR_MESSAGES: Record<string, string> = {
  'template-type-invalid': 'That template type is not recognized.',
  'template-body-required': 'Template text cannot be empty.',
  'template-body-too-long': 'Template text is too long.',
  'owner-unresolved': 'No operator is set up. Run the operator seed.',
  'template-write-failed': 'Could not save — please try again.',
};

/** Human-readable text for a template action reason. Unknown → safe fallback. */
export function templateErrorMessage(reason: string | undefined): string | null {
  if (!reason) return null;
  // Own-property check, not `[reason] ?? fallback`: a tampered ?error=__proto__/
  // constructor would otherwise return a truthy inherited object/function that the
  // RSC renders as a React child → 500 (code-review 2026-07-16).
  if (!Object.hasOwn(TEMPLATE_ERROR_MESSAGES, reason)) {
    return 'Something went wrong — please try again.';
  }
  return TEMPLATE_ERROR_MESSAGES[reason];
}
