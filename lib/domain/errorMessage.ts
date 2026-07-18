// Pure domain helper — the shared safe lookup behind every operator-facing
// error-message map (AR15). Uses an own-property check, NOT `map[reason] ?? fallback`:
// a tampered `?error=__proto__` / `constructor` / `toString` would otherwise return a
// truthy inherited object/function that the RSC renders as a React child → 500
// (code-review 2026-07-16; Epic-2 retro action item — kills the crash class app-wide).
// No framework imports.

export const DEFAULT_ERROR_MESSAGE = 'Something went wrong — please try again.';

/**
 * Look up an operator-facing message for a machine reason.
 * - `undefined`/empty reason → null (no banner).
 * - Unknown or prototype-key reason → `fallback` (never an inherited value).
 */
export function safeErrorMessage(
  messages: Record<string, string>,
  reason: string | undefined,
  fallback: string = DEFAULT_ERROR_MESSAGE,
): string | null {
  if (!reason) return null;
  if (!Object.hasOwn(messages, reason)) return fallback;
  return messages[reason];
}
