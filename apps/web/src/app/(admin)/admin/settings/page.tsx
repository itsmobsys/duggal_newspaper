import type { Metadata } from 'next';
import Link from 'next/link';
import { SettingsForm, type SettingDefinition } from '@/components/admin/SettingsForm';
import { adminServerFetch } from '@/lib/admin-server';
import styles from '@/components/admin/ops.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
};

interface SettingsResponse {
  values: Record<string, unknown>;
  definitions: SettingDefinition[];
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The newsroom API rejected the request.';
}

export default async function SettingsPage(): Promise<React.JSX.Element> {
  let data: SettingsResponse | null = null;
  let error: string | null = null;

  try {
    data = await adminServerFetch<SettingsResponse>('/admin/settings');
  } catch (caught) {
    if (isNextControlFlow(caught)) throw caught;
    error = errorText(caught);
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Settings</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Editorial switches, intake limits and the autonomous night desk - saved one key at a
            time.
          </p>
        </div>
      </div>

      {error ? (
        <div className={`alert alert--error ${styles.noticeBar}`} role="alert">
          <h3>Settings could not be loaded</h3>
          <p>{error}</p>
          <p className={styles.actionMessage}>Nothing has been changed.</p>
        </div>
      ) : null}

      {data ? <SettingsForm definitions={data.definitions} values={data.values} /> : null}

      <section
        className="panel"
        aria-labelledby="storage-note-heading"
        style={{ marginTop: 'var(--space-5)' }}
      >
        <h2 id="storage-note-heading">Storage is not a setting</h2>
        <p className={styles.groupNote} style={{ margin: 0 }}>
          Photo storage is configured by server environment variables (S3 credentials or the local
          fallback), so it cannot be edited here and no credentials are ever sent to this page. The
          diagnostics screen shows whether storage is configured and which mode the API is using.
        </p>
        <p className={styles.actionMessage}>
          <Link href="/admin/diagnostics">Open diagnostics →</Link>
        </p>
      </section>
    </>
  );
}
