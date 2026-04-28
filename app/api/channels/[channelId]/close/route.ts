import { NextResponse } from 'next/server';

import { closeChannel } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await context.params;
  const body = await request.json().catch(() => null) as { userId?: string } | null;
  const userId = String(body?.userId || '').trim();

  if (!userId) {
    return NextResponse.json({ error: 'userId is required.' }, { status: 400 });
  }

  const ok = closeChannel({ channelId, userId });
  if (!ok) {
    return NextResponse.json({ error: 'Not authorized or channel not found.' }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
