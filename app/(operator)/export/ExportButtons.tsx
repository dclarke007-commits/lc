'use client';

// Story 6.4 — the thin client trigger for the CSV export (FR35). The Server Action
// (AR17) does all the work: owner-scoped read + serialize. This component only calls
// it and turns the returned text into a browser download (a Blob + a transient anchor)
// — the one piece that genuinely needs the browser. No data, no SQL, no CSV logic here.

import { useState } from 'react';
import { exportClientsCsv, exportJobsCsv, type CsvExport } from './actions';
import type { ActionResult } from '@/lib/domain/result';

/** Turn the action's CSV text into a downloaded file, then release the object URL. */
function triggerDownload({ filename, content }: CsvExport): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type Kind = 'clients' | 'jobs';

export function ExportButtons() {
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(
    kind: Kind,
    action: () => Promise<ActionResult<CsvExport>>,
  ): Promise<void> {
    setBusy(kind);
    setError(null);
    try {
      const res = await action();
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      triggerDownload(res.data);
    } catch {
      // A network/transport failure calling the action — surface a generic reason
      // rather than leaving the operator staring at a spinner.
      setError('export-failed');
    } finally {
      setBusy(null);
    }
  }

  // Secondary (outlined) button: white fill, ink label. Sets color explicitly so
  // the global primary-button color (#fff) can't leave white-on-white text.
  const btn: React.CSSProperties = {
    padding: '0.5rem 0.85rem',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface)',
    color: 'var(--ink)',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 500,
  };

  return (
    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
      <button
        type="button"
        style={btn}
        disabled={busy !== null}
        onClick={() => run('clients', exportClientsCsv)}
      >
        {busy === 'clients' ? 'Exporting…' : 'Export clients (CSV)'}
      </button>
      <button
        type="button"
        style={btn}
        disabled={busy !== null}
        onClick={() => run('jobs', exportJobsCsv)}
      >
        {busy === 'jobs' ? 'Exporting…' : 'Export jobs (CSV)'}
      </button>
      {error && (
        <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>
          Export failed ({error}). Try again.
        </span>
      )}
    </div>
  );
}
