'use client';

// Zero-heavy form (NFR1): posts directly to the Server Action. `visit` is a per-render
// session nonce (AR12) so a double-submit of the same day dedups to one request. Client
// component only to mint the nonce once per mount; no other interactivity required.
import { useState } from 'react';
import { submitPublicRequest } from './actions';

export function RequestForm() {
  // Mint once per mount. crypto.randomUUID is available in the browser.
  const [visit] = useState(() => crypto.randomUUID());
  return (
    <form
      action={submitPublicRequest}
      className="request-form"
      style={{ display: 'grid', gap: '1rem' }}
    >
      <input type="hidden" name="visit" value={visit} />
      <label>
        Name
        <input name="name" required maxLength={200} autoComplete="name" />
      </label>
      <label>
        Phone
        <input name="phone" required maxLength={200} autoComplete="tel" inputMode="tel" />
      </label>
      <label>
        Address (optional)
        <input name="address" maxLength={200} autoComplete="street-address" />
      </label>
      <label>
        Preferred date
        <input name="date" type="date" required />
      </label>
      <button type="submit">Request a clean</button>
    </form>
  );
}
