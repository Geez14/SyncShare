import { NextResponse } from 'next/server';

import { createChannel, listChannels } from '@/lib/state';
import type { ChannelType } from '@/lib/types';

export const runtime = 'nodejs';

function isChannelType(value: unknown): value is ChannelType {
  return value === 'stopwatch' || value === 'music' || value === 'video' || value === 'voice';
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id') || undefined;
  return NextResponse.json(listChannels(userId));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    userId?: string;
    name?: string;
    type?: ChannelType;
    config?: Record<string, unknown>;
  } | null;

  const userId = String(body?.userId || '').trim();
  const name = String(body?.name || 'Untitled Channel').trim() || 'Untitled Channel';
  const type = body?.type;

  if (!userId) {
    return NextResponse.json({ error: 'userId is required.' }, { status: 400 });
  }

  if (!isChannelType(type)) {
    return NextResponse.json({ error: 'Invalid channel type.' }, { status: 400 });
  }

  const channel = createChannel({
    userId,
    name,
    type,
    config: body?.config || {}
  });

  return NextResponse.json({ channel });
}
