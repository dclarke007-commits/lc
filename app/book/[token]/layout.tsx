import type { ReactNode } from 'react';

// Public booking shell — the one un-authenticated surface (AD-6). No nav, no
// account: just the brand and the booking card a stranger meets after scanning
// the QR. Kept deliberately calm and single-purpose (NFR2 — booking under ~60s).
export default function BookLayout({ children }: { children: ReactNode }) {
  return (
    <div className="public-shell">
      <div className="public-shell__brand">
        <span className="brand__mark" aria-hidden="true">
          &#10022;
        </span>
        <span className="brand" style={{ gap: 0 }}>
          Loves<span className="brand__love">Cleaning</span>
        </span>
      </div>
      {children}
    </div>
  );
}
