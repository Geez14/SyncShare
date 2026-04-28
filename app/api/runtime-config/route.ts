import { NextResponse } from 'next/server';

import { getRuntimeState } from '@/lib/state';

export const runtime = 'nodejs';

export async function GET() {
  const runtimeConfig = getRuntimeState();
  return NextResponse.json({
    channel_entry_limits: runtimeConfig.channel_entry_limits,
    timing: {
      stopwatch_tick_seconds: runtimeConfig.timing.stopwatch_tick_seconds,
      min_schedule_lead_ms: runtimeConfig.timing.min_schedule_lead_ms
    },
    rtc: {
      ice_servers: runtimeConfig.rtc.ice_servers
    }
  });
}
