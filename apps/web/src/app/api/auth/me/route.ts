import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

/** Used by the account menu; returns `{user:null}` when logged out. */
export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  return NextResponse.json({ user }, { headers: { 'cache-control': 'no-store' } });
}
