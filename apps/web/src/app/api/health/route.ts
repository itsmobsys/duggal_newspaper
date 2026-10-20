import { NextResponse } from 'next/server';
import { safeQueryOne } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Uptime check for the website. Deliberately does not call the Render API:
 * waking a sleeping service on a monitor hit would burn the free instance
 * hours and add nothing to the reader's experience.
 */
export async function GET(): Promise<NextResponse> {
  const row = await safeQueryOne<{ ok: number }>('SELECT 1 AS ok');
  const dbUp = row?.ok === 1;

  return NextResponse.json(
    {
      ok: dbUp,
      service: 'duggal-badmosh-web',
      checks: { database: dbUp ? 'ok' : 'unreachable' },
      time: new Date().toISOString(),
    },
    {
      status: dbUp ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
