// Pure domain module — NO framework imports, NO db (AD-1/AD-7). RFC-4180 CSV
// serialization for the data-ownership export (Story 6.4, FR35/NFR5). The export
// Server Action (AR17) owns the owner-scoped READS; this module owns only the
// text encoding, so the one thing that can silently corrupt an export — a field
// carrying a comma, quote, or newline — is isolated here and unit-tested.

/**
 * Escape one field per RFC 4180. A field is quote-WRAPPED iff it contains a comma,
 * a double-quote, CR, or LF; inside the wrap, every `"` is doubled. Without this, a
 * client name like `Doe, Jane` or an address with a newline would shift every later
 * column. `null`/`undefined` serialize to an empty field (never the literal "null").
 * Numbers stringify plainly (integer cents stay exact — no float formatting here).
 */
export function escapeCsvField(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
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
