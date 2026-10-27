import { NextResponse } from 'next/server';
import { getConfig, getConfigStatus } from '../../../lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Deployment smoke check. Reports config presence only — never secret values. */
export async function GET() {
  return NextResponse.json({ ok: true, ...getConfigStatus(getConfig()) });
}
