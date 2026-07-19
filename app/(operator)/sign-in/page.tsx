'use client';

// Operator-only sign-in. No client login for anyone else (AD-6). Minimal client
// JS: a form that invokes the `signIn` Server Action and reacts to the typed
// result. The session cookie is set server-side inside the action.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from './actions';

export default function SignInPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await signIn(formData);
      if (result.ok) {
        router.replace('/dashboard');
        router.refresh();
      } else {
        setError(result.reason);
      }
    });
  }

  return (
    <main style={{ padding: '1.5rem', maxWidth: 360 }}>
      <h1 style={{ fontSize: '1.25rem' }}>Sign in</h1>
      <form action={onSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
        <label style={{ display: 'grid', gap: '0.25rem' }}>
          <span>Email</span>
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label style={{ display: 'grid', gap: '0.25rem' }}>
          <span>Passphrase</span>
          <input
            name="passphrase"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
        {error && (
          <p role="alert" style={{ color: '#b00020', margin: 0 }}>
            {error === 'invalid-credentials'
              ? 'Invalid email or passphrase.'
              : `Sign-in failed (${error}).`}
          </p>
        )}
      </form>
    </main>
  );
}
