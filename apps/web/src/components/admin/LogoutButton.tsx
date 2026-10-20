'use client';

import { useState } from 'react';

export function LogoutButton(): React.JSX.Element {
  const [busy, setBusy] = useState(false);

  async function logout(): Promise<void> {
    setBusy(true);
    try {
      await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      // The local cookie is cleared by the BFF even when the API is asleep.
    } finally {
      window.location.assign('/admin/login');
    }
  }

  return (
    <button
      className="button button--ghost button--sm"
      type="button"
      onClick={logout}
      disabled={busy}
    >
      {busy ? 'Signing out...' : 'Sign out'}
    </button>
  );
}
