import { NextResponse } from 'next/server';

import { updateChannel } from '@/lib/state';
import type { ChannelType } from '@/lib/types';

export const runtime = 'nodejs';

function isChannelType(value: unknown): value is ChannelType {
  return value === 'stopwatch' || value === 'music' || value === 'video' || value === 'voice';
}

export async function POST(request: Request, context: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await context.params;
  const body = await request.json().catch(() => null) as {
    userId?: string;
    type?: ChannelType;
    action?: string;
    payload?: Record<string, unknown>;
  } | null;

  const userId = String(body?.userId || '').trim();
  const action = String(body?.action || '').trim();
  const type = body?.type;

  if (!userId) {
    return NextResponse.json({ error: 'userId is required.' }, { status: 400 });
  }

  if (!action) {
    return NextResponse.json({ error: 'action is required.' }, { status: 400 });
  }

  if (!isChannelType(type)) {
    return NextResponse.json({ error: 'Invalid channel type.' }, { status: 400 });
  }

  const result = updateChannel({
    channelId,
    userId,
    type,
    action,
    payload: body?.payload || {}
  });

  if ('error' in result) {
    return NextResponse.json(result, { status: result.code === 'UNAUTHORIZED' ? 403 : 400 });
  }

  return NextResponse.json(result);
}
