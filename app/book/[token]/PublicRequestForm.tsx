// Story 4.2 — the NEW-CLIENT public request form. A zero-JS RSC `<form action>` (NFR1):
// a stranger enters name/phone/(optional) address and picks one of the operator's
// genuinely-open days, then submits to the submitPublicRequest Server Action. Minimal by
// design (NFR7/NFR2 — booking under ~60s): exactly the FR6 fields, nothing more. The
// route token and the per-render visit nonce ride as hidden inputs — the nonce makes a
// double-tap idempotent (AR12); owner/client identity is resolved server-side from the
// token, never a form field (AR7/AD-6).

import { submitPublicRequest } from './actions';

// isoWeekday (1=Mon..7=Sun) → short label. Index 0 unused (weekdays are 1-based).
const WEEKDAY_LABEL = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const fieldStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.6rem 0.75rem',
  border: '1px solid #ddd',
  borderRadius: 8,
  fontSize: '1rem',
  marginTop: '0.25rem',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  margin: '0.75rem 0',
  color: '#333',
  fontSize: '0.95rem',
};

const submitStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.75rem 1rem',
  border: 'none',
  borderRadius: 8,
  background: '#1a7f37',
  color: '#fff',
  fontSize: '1rem',
  fontWeight: 600,
  cursor: 'pointer',
  marginTop: '1rem',
};

/**
 * @param token   the route token (hidden input; server re-resolves owner/identity)
 * @param visit   per-render token-visit session nonce (hidden; AR12 dedup key)
 * @param openSlots the operator's genuinely-open days — the ONLY selectable dates
 * @param formatDate  the shared date formatter (passed in; the surface owns clock fmt)
 */
export function PublicRequestForm({
  token,
  visit,
  openSlots,
  formatDate,
}: {
  token: string;
  visit: string;
  openSlots: { date: string; isoWeekday: number }[];
  formatDate: (dateKey: string) => string;
}) {
  return (
    <form action={submitPublicRequest}>
      {/* Identity is collected FRESH (new client). owner_id + the provisional client
          are derived/created server-side; only these carry no trust. */}
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="visit" value={visit} />

      <label style={labelStyle}>
        Your name
        <input
          style={fieldStyle}
          type="text"
          name="name"
          required
          autoComplete="name"
        />
      </label>

      <label style={labelStyle}>
        Phone
        <input
          style={fieldStyle}
          type="tel"
          name="phone"
          required
          autoComplete="tel"
        />
      </label>

      <label style={labelStyle}>
        Service address <span style={{ color: '#888' }}>(optional)</span>
        <input
          style={fieldStyle}
          type="text"
          name="address"
          autoComplete="street-address"
        />
      </label>

      <label style={labelStyle}>
        Preferred day
        <select style={fieldStyle} name="date" required defaultValue="">
          <option value="" disabled>
            Choose an open day…
          </option>
          {openSlots.map((slot) => (
            <option key={slot.date} value={slot.date}>
              {WEEKDAY_LABEL[slot.isoWeekday]} · {formatDate(slot.date)}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" style={submitStyle}>
        Request this day
      </button>
    </form>
  );
}
