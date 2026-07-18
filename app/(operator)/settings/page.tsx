// Capacity settings surface (RSC). Auth-gated by proxy.ts (Story 1.1). Operator
// surfaces stay dynamic — never `use cache` (AD-13). This surface calls ACTIONS
// only — it never imports lib/db (surfaces → actions → domain → db). Phone-first,
// minimal styling matching the clients pages, zero client JS (NFR1): the form
// posts to a thin server-action wrapper that redirects with ?error / ?saved.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOwnerCapacity, saveCapacitySettings } from './actions';
import { capacityErrorMessage } from '@/lib/domain/capacityErrors';

export const dynamic = 'force-dynamic';

// Common IANA timezones offered in the picker (phone-first, zero-JS <select> —
// NFR1). Server-side validation (`timezone-invalid`) still accepts ANY valid
// IANA zone; the operator's persisted zone is always merged in below so a value
// outside this list is never silently dropped on save.
const COMMON_TIMEZONES: string[] = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
];

// ISO weekday ints 1=Mon .. 7=Sun (matches lib/domain/clock.ts).
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

const field: React.CSSProperties = { display: 'block', marginBottom: '0.75rem' };
const input: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.6rem',
  fontSize: '1rem',
  marginTop: '0.25rem',
  boxSizing: 'border-box',
};

// Thin server-action wrapper so the native <form action> gets a void return.
// The typed { ok, data } | { ok:false, reason } contract lives in the action. On
// failure redirect to ?error=<reason>; on success ?saved=1 (zero client JS, NFR1).
async function save(formData: FormData): Promise<void> {
  'use server';
  const result = await saveCapacitySettings(formData);
  if (!result.ok) redirect(`/settings?error=${result.reason}`);
  redirect('/settings?saved=1');
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const config = await getOwnerCapacity();
  const sp = await searchParams;
  const errorMsg = capacityErrorMessage(sp.error);
  const saved = sp.saved === '1';
  const workingDaySet = new Set(config.workingDays);
  // Merge the persisted zone in (deduped) so a stored value outside the common
  // list is still selectable and never silently reset on the next save.
  const timezoneOptions = COMMON_TIMEZONES.includes(config.timezone)
    ? COMMON_TIMEZONES
    : [config.timezone, ...COMMON_TIMEZONES];

  return (
    <main style={{ padding: '1.5rem', maxWidth: 640 }}>
      <p style={{ margin: '0 0 1rem' }}>
        <Link href="/clients">&larr; Clients</Link>
      </p>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 1rem' }}>
        Availability & caps
      </h1>

      {errorMsg && (
        <p
          role="alert"
          style={{
            color: '#b00020',
            background: '#fde8e8',
            padding: '0.6rem 0.8rem',
            borderRadius: 4,
            margin: '0 0 1rem',
          }}
        >
          {errorMsg}
        </p>
      )}

      {saved && !errorMsg && (
        <p
          role="status"
          style={{
            color: '#0a5c2b',
            background: '#e6f4ea',
            padding: '0.6rem 0.8rem',
            borderRadius: 4,
            margin: '0 0 1rem',
          }}
        >
          Saved.
        </p>
      )}

      <form action={save} style={{ maxWidth: 420 }}>
        <fieldset style={{ ...field, border: 0, padding: 0, margin: '0 0 1rem' }}>
          <legend style={{ padding: 0 }}>Working days</legend>
          {WEEKDAYS.map((d) => (
            <label
              key={d.value}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                marginRight: '0.9rem',
                padding: '0.3rem 0',
              }}
            >
              <input
                type="checkbox"
                name="workingDays"
                value={d.value}
                defaultChecked={workingDaySet.has(d.value)}
              />
              {d.label}
            </label>
          ))}
        </fieldset>

        <label style={field}>
          Per-day cap
          <input
            style={input}
            name="perDayCap"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            defaultValue={config.perDayCap}
            required
          />
        </label>

        <label style={field}>
          Weekly ceiling
          <input
            style={input}
            name="weeklyCeiling"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            defaultValue={config.weeklyCeiling}
            required
          />
        </label>

        <label style={field}>
          Default job price (USD)
          <input
            style={input}
            name="defaultJobPrice"
            type="number"
            inputMode="decimal"
            min={0}
            step={0.01}
            defaultValue={(config.defaultJobPriceCents / 100).toFixed(2)}
            required
          />
        </label>

        <label style={field}>
          Timezone
          <select style={input} name="timezone" defaultValue={config.timezone} required>
            {timezoneOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          style={{ padding: '0.7rem 1.2rem', fontSize: '1rem' }}
        >
          Save settings
        </button>
      </form>
    </main>
  );
}
