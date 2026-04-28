import { NextResponse } from 'next/server';

import { acknowledgeSync } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await context.params;
  const body = await request.json().catch(() => null) as {
    userId?: string;
    syncId?: string;
  } | null;

  const userId = String(body?.userId || '').trim();
  const syncId = String(body?.syncId || '').trim();

  if (!userId || !syncId) {
    return NextResponse.json({ error: 'userId and syncId are required.' }, { status: 400 });
  }

  const ok = acknowledgeSync({ channelId, userId, syncId });
  if (!ok) {
    return NextResponse.json({ error: 'Sync session not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
