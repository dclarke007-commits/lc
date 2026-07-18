// Pure domain module — NO framework imports, NO db (AD-1/AD-7). RFC-4180 CSV
// serialization for the data-ownership export (Story 6.4, FR35/NFR5). The export
// Server Action (AR17) owns the owner-scoped READS; this module owns only the
// text encoding, so the one thing that can silently corrupt an export — a field
// carrying a comma, quote, or newline — is isolated here and unit-tested.

// CSV FORMULA INJECTION (CWE-1236): a spreadsheet (Excel/Sheets) evaluates a cell whose
// text begins with = + - @ (or a control char TAB/CR) as a FORMULA, even inside a quoted
// CSV field — so `=HYPERLINK(...)` or a DDE payload executes on open. Our export carries
// STRANGER-controlled text: a public self-booking (Story 4.2) sets `client.name`/`address`
// from untrusted form input. Neutralize by prefixing a single quote, which forces the
// spreadsheet to treat the value as text. Deliberate, minimal collateral: a phone like
// `+1555…` gains a leading `'` (and Excel then keeps it as text — the correct behavior for
// a phone anyway, not a number). Applied BEFORE RFC-4180 quoting so both layers compose.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

function neutralizeFormula(s: string): string {
  return FORMULA_TRIGGER.test(s) ? `'${s}` : s;
}

/**
 * Escape one field for CSV. Two layers compose:
 *   1. FORMULA neutralization (neutralizeFormula) — a leading =/+/-/@/control char is
 *      prefixed with `'` so a spreadsheet never executes stranger-controlled text as a
 *      formula (CWE-1236). This is a value-safety change, applied to the raw text first.
 *   2. RFC-4180 quoting — the (possibly neutralized) field is quote-WRAPPED iff it
 *      contains a comma, double-quote, CR, or LF; inside the wrap every `"` is doubled.
 *      Without this a name like `Doe, Jane` or a multi-line address shifts later columns.
 * `null`/`undefined` serialize to an empty field (never the literal "null"). Numbers
 * stringify plainly (integer cents stay exact — no float formatting here).
 */
export function escapeCsvField(value: string | number | null | undefined): string {
  const raw = value == null ? '' : String(value);
  const s = neutralizeFormula(raw);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Serialize a header row + data rows to an RFC-4180 CSV string. Fields are escaped
 * (escapeCsvField), joined with commas, and rows are terminated with CRLF (`\r\n`)
 * — the RFC line ending, which every spreadsheet reads and which survives a field
 * that itself contains a bare `\n`. No trailing newline; no BOM (the caller may
 * prepend one for Excel if needed). Pure: a function of its inputs only.
 */
export function toCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvField).join(','))
    .join('\r\n');
}
