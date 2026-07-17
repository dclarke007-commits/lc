// Pure domain module — NO framework imports (dependency rule: domain sits below
// actions/surfaces). The single Server Action return contract (AR15).
//
// Every Server Action returns this discriminated union. No thrown error may cross
// the action boundary, and there are no silent catches: a failure is an explicit
// `{ ok: false, reason }` with a machine-readable reason.

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(reason: string): ActionResult<never> {
  return { ok: false, reason };
}
