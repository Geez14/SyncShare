import { NextResponse } from 'next/server';

import { getState } from '@/lib/state';

export const runtime = 'nodejs';

export async function GET() {
  const config = getState().runtimeConfig;
  return NextResponse.json({
    channel_entry_limits: config.channel_entry_limits,
    timing: {
      stopwatch_tick_seconds: config.timing.stopwatch_tick_seconds,
      min_schedule_lead_ms: config.timing.min_schedule_lead_ms
    },
    rtc: {
      ice_servers: config.rtc.ice_servers
    }
  });
}
