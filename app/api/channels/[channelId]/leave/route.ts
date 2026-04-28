import { NextResponse } from 'next/server';

import { leaveChannel } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await context.params;
  const body = await request.json().catch(() => null) as { userId?: string } | null;
  const userId = String(body?.userId || '').trim();

  if (!userId) {
    return NextResponse.json({ error: 'userId is required.' }, { status: 400 });
  }

  const ok = leaveChannel({ channelId, userId });
  if (!ok) {
    return NextResponse.json({ error: 'Channel not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
