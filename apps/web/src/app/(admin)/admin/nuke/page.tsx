import type { Metadata } from 'next';
import { NukePanel } from '@/components/admin/NukePanel';
import { adminServerFetch } from '@/lib/admin-server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Site takedown',
  robots: { index: false, follow: false },
};

interface NukeResponse {
  active: boolean;
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The newsroom API rejected the request.';
}

/**
 * The takedown switch. Deliberately boring and hard to hit by accident: the
 * action is a two-step confirmation with the operator's own password.
 */
export default async function NukePage(): Promise<React.JSX.Element> {
  let data: NukeResponse | null = null;
  let error: string | null = null;

  try {
    data = await adminServerFetch<NukeResponse>('/admin/nuke');
  } catch (caught) {
    if (isNextControlFlow(caught)) throw caught;
    error = errorText(caught);
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Site takedown</h1>
          <p className="muted">
            Masks every public page with a maintenance notice. The console, the API, media files,
            feeds and scheduled publishing keep working.
          </p>
        </div>
      </div>

      {error ? (
        <div className="alert alert--error" role="alert">
          <h3>The switch could not be read</h3>
          <p>{error}</p>
        </div>
      ) : null}

      {data ? (
        <NukePanel active={data.active} />
      ) : (
        <p className="muted">The takedown state is unavailable right now.</p>
      )}
    </>
  );
}
