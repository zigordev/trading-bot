import { NextResponse } from 'next/server';

import { health } from '@/observability/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(health());
}
