import { NextResponse } from 'next/server';

import { buildRoomState, toSummary } from '@/lib/state';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await context.params;
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id') || undefined;

  const state = buildRoomState(channelId, userId);
  if (!state) {
    return NextResponse.json({ error: 'Channel not found.' }, { status: 404 });
  }

  return NextResponse.json(state);
}

export async function PATCH(request: Request, context: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await context.params;
  const body = await request.json().catch(() => null) as { userId?: string } | null;
  const summary = toSummary(channelId, body?.userId);

  if (!summary) {
    return NextResponse.json({ error: 'Channel not found.' }, { status: 404 });
  }

  return NextResponse.json({ channel: summary });
}
