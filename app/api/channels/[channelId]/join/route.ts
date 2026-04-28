import { NextResponse } from 'next/server';

import { joinChannel } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await context.params;
  const body = await request.json().catch(() => null) as {
    userId?: string;
    password?: string;
  } | null;

  const userId = String(body?.userId || '').trim();
  if (!userId) {
    return NextResponse.json({ error: 'userId is required.' }, { status: 400 });
  }

  const result = joinChannel({
    channelId,
    userId,
    password: body?.password
  });

  if ('error' in result) {
    return NextResponse.json(result, { status: result.code === 'CHANNEL_FULL' ? 409 : 400 });
  }

  return NextResponse.json(result);
}
