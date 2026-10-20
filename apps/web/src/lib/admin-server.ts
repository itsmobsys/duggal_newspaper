import { redirect } from 'next/navigation';
import { ApiError, apiFetch, type ApiFetchOptions } from './api';
import { getAdminSession } from './session';

/**
 * Server-side admin fetch. Admin pages render on the server (fast, no loading
 * spinners), so they call the API directly with the httpOnly session cookie and
 * the service signature. Mutations still go through the BFF so CSRF is checked.
 */
export async function adminServerFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');

  try {
    return await apiFetch<T>(path, { ...options, adminSession: session, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      redirect('/admin/login');
    }
    throw error;
  }
}

/** Read the signed-in operator for the admin shell. */
export async function getCurrentAdmin(): Promise<{
  id: string;
  email: string;
  name: string;
  role: string;
} | null> {
  const session = await getAdminSession();
  if (!session) return null;
  try {
    const result = await apiFetch<{
      user: { id: string; email: string; name: string; role: string };
    }>('/admin/me', { adminSession: session, cache: 'no-store' });
    return result.user;
  } catch {
    return null;
  }
}
