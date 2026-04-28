import fs from 'node:fs';
import path from 'node:path';

import type { RuntimeConfig } from './types';

const DEFAULT_CONFIG: RuntimeConfig = {
  channel_entry_limits: {
    stopwatch: 20,
    music: 8,
    video: 5,
    voice: 10
  },
  timing: {
    stopwatch_tick_seconds: 1,
    min_schedule_lead_ms: 1500,
    channel_cleanup_interval_seconds: 60,
    empty_channel_ttl_seconds: 300,
    media_tick_seconds: 1
  },
  rtc: {
    ice_servers: [
      {
        urls: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302'
        ]
      }
    ],
    turn_servers: []
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    debug: true
  }
};

function mergeDicts<T extends object>(base: T, incoming: unknown): T {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return { ...base };
  }

  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
    const baseValue = result[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      baseValue &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue)
    ) {
      result[key] = mergeDicts(baseValue as object, value);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

export function loadRuntimeConfig(): RuntimeConfig {
  const configPath = path.join(process.cwd(), 'config', 'runtime.json');

  try {
    if (!fs.existsSync(configPath)) {
      return structuredClone(DEFAULT_CONFIG);
    }

    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return structuredClone(DEFAULT_CONFIG);
    }

    return mergeDicts(structuredClone(DEFAULT_CONFIG) as object, parsed) as unknown as RuntimeConfig;
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

let cachedRuntimeConfig: RuntimeConfig | null = null;

export function getRuntimeConfig(): RuntimeConfig {
  if (!cachedRuntimeConfig) {
    cachedRuntimeConfig = loadRuntimeConfig();
  }

  return cachedRuntimeConfig;
}
