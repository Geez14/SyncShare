/**
 * Simplified state manager - only tracks channels & user rosters
 * Media state and control sync happens via Socket.IO (WebRTC signaling)
 */
import type {
  ChannelConfig,
  ChannelRecord,
  ChannelStateResponse,
  ChannelSummary,
  ChannelType,
  JoinResponse,
  RuntimeConfig
} from './types';
import { getRuntimeConfig } from './runtime-config';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { logger } from './logger';

interface AppRuntimeState {
  channels: Map<string, ChannelRecord>;
  channelMembers: Map<string, Set<string>>;
  emptyChannelSince: Map<string, number>;
  runtimeConfig: RuntimeConfig;
  janitorStarted: boolean;
}

const stateKey = '__syncshare_next_state__';
const globalForState = globalThis as typeof globalThis & { [stateKey]?: AppRuntimeState };

function createState(): AppRuntimeState {
  return {
    channels: new Map(),
    channelMembers: new Map(),
    emptyChannelSince: new Map(),
    runtimeConfig: getRuntimeConfig(),
    janitorStarted: false
  };
}

export function getState(): AppRuntimeState {
  if (!globalForState[stateKey]) {
    globalForState[stateKey] = createState();
  }
  globalForState[stateKey]!.runtimeConfig = getRuntimeConfig();
  ensureMaintenanceLoops(globalForState[stateKey]!);
  return globalForState[stateKey]!;
}

function generateChannelId(): string {
  return String(Date.now()).slice(-6) + Math.random().toString(36).slice(2, 4);
}

function normalizePasscode(value: unknown): string {
  return String(value ?? '').trim();
}

function toChannelSummary(channel: ChannelRecord, userId?: string): ChannelSummary {
  const state = getState();
  const passcode = normalizePasscode(channel.config?.passcode);
  const members = state.channelMembers.get(channel.id) ?? new Set<string>();
  const memberCount = members.size;
  const capacity = state.runtimeConfig.channel_entry_limits[channel.type] ?? null;

  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    host: channel.host,
    passcodeRequired: Boolean(passcode),
    watching: memberCount,
    capacity,
    full: capacity !== null && memberCount >= capacity && userId !== channel.host
  };
}

function buildMediaSync(channel: ChannelRecord): Record<string, unknown> {
  return {
    src: channel.trackUrl,
    trackTitle: channel.trackTitle,
    currentTime: channel.media.currentTime,
    duration: channel.media.duration,
    playing: channel.media.playing,
    paused: !channel.media.playing,
    timestamp: channel.media.updatedAt,
    sourceMode: channel.media.sourceMode ?? 'url'
  };
}

async function deleteChannelFiles(channel: ChannelRecord): Promise<void> {
  if (!channel.trackUrl) return;

  try {
    // Extract filename from URL (e.g., "/uploads/1234567890_filename.ext" -> "1234567890_filename.ext")
    const filename = channel.trackUrl.split('/').pop();
    if (!filename) return;

    const uploadDir = join(process.cwd(), 'public', 'uploads');
    const filepath = join(uploadDir, filename);

    // Delete the file
    await unlink(filepath);
    logger.info('Uploaded file deleted during cleanup', { filename });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.error('Failed to delete uploaded file', { err });
    }
  }
}

function cleanupEmptyChannels(state: AppRuntimeState): void {
  const now = Date.now();
  const { empty_channel_ttl_seconds } = state.runtimeConfig.timing;
  const ttlMs = empty_channel_ttl_seconds * 1000;

  for (const [channelId, channel] of state.channels.entries()) {
    const members = state.channelMembers.get(channelId) ?? new Set<string>();
    if (members.size > 0) {
      state.emptyChannelSince.delete(channelId);
      continue;
    }

    const firstEmpty = state.emptyChannelSince.get(channelId);
    if (!firstEmpty) {
      state.emptyChannelSince.set(channelId, now);
      logger.info('Channel marked empty', {
        channelName: channel.name,
        channelId,
        ttlSeconds: empty_channel_ttl_seconds
      });
      continue;
    }

    const elapsedMs = now - firstEmpty;
    if (elapsedMs < ttlMs) {
      const remainingSeconds = Math.ceil((ttlMs - elapsedMs) / 1000);
      continue;
    }

    // Channel has been empty for >= TTL, delete it
    const elapsedSeconds = Math.round(elapsedMs / 1000);
    logger.info('Deleting empty channel after inactivity', {
      channelName: channel.name,
      channelId,
      elapsedSeconds
    });
    
    // Delete associated uploaded files
    deleteChannelFiles(channel).catch((err) => logger.error('File deletion failed during cleanup', { err }));
    
    state.channelMembers.delete(channelId);
    state.emptyChannelSince.delete(channelId);
    state.channels.delete(channelId);
  }
}

function ensureMaintenanceLoops(state: AppRuntimeState): void {
  if (!state.janitorStarted) {
    state.janitorStarted = true;
    const cleanupIntervalSeconds = state.runtimeConfig.timing.channel_cleanup_interval_seconds ?? 60;
    const emptyChannelTtlSeconds = state.runtimeConfig.timing.empty_channel_ttl_seconds ?? 300;
    const janitorMs = Math.max(5_000, Math.round(cleanupIntervalSeconds * 1000));

    logger.info('Channel janitor started', {
      emptyChannelTtlSeconds,
      emptyChannelTtlMinutes: Math.round(emptyChannelTtlSeconds / 60),
      cleanupIntervalSeconds
    });

    setInterval(() => {
      cleanupEmptyChannels(state);
    }, janitorMs).unref?.();
  }
}

export function listChannels(userId?: string): { mine: ChannelSummary[]; others: ChannelSummary[] } {
  const state = getState();
  const mine: ChannelSummary[] = [];
  const others: ChannelSummary[] = [];

  for (const channel of state.channels.values()) {
    const item = toChannelSummary(channel, userId);
    if (channel.host === userId) {
      mine.push(item);
    } else {
      others.push(item);
    }
  }

  return { mine, others };
}

export function getChannelState(channelId: string, userId?: string): ChannelStateResponse | null {
  const state = getState();
  const channel = state.channels.get(channelId);
  if (!channel) return null;

  const members = state.channelMembers.get(channelId) ?? new Set<string>();
  const summary = toChannelSummary(channel, userId);

  return {
    channel: summary,
    host: channel.host === userId,
    sync:
      channel.type === 'music' || channel.type === 'video'
        ? buildMediaSync(channel)
        : channel.type === 'stopwatch'
          ? {
              running: channel.running,
              startTime: channel.startTime,
              elapsed: channel.time
            }
          : { type: channel.type },
    members: members.size,
    membersList: Array.from(members).sort()
  };
}

export function createChannel(input: {
  userId: string;
  name: string;
  type: ChannelType;
  config: ChannelConfig;
}): ChannelSummary {
  const state = getState();
  const id = generateChannelId();
  const channel: ChannelRecord = {
    id,
    name: input.name || 'Untitled Channel',
    type: input.type,
    host: input.userId,
    config: input.config ?? {},
    trackUrl: '',
    trackTitle: 'Untitled',
    activeSourcePresent: false,
    time: 0,
    running: false,
    startTime: Date.now(),
    media: {
      currentTime: 0,
      duration: 0,
      playing: false,
      updatedAt: Date.now(),
      anchorTs: Date.now(),
      sourceMode: 'url',
      scheduleAt: null
    }
  };

  state.channels.set(id, channel);
  state.emptyChannelSince.delete(id);

  return toChannelSummary(channel, input.userId);
}

export function joinChannel(input: {
  channelId: string;
  userId: string;
  password?: string;
}): JoinResponse | { error: string; code: string; limit?: number } {
  const state = getState();
  const channel = state.channels.get(input.channelId);
  if (!channel) {
    return { error: 'Channel not found.', code: 'NOT_FOUND' };
  }

  const members = state.channelMembers.get(channel.id) ?? new Set<string>();
  const capacity = state.runtimeConfig.channel_entry_limits[channel.type];
  if (capacity !== null && capacity !== undefined && !members.has(input.userId) && members.size >= capacity) {
    return {
      error: `Room is full.`,
      code: 'CHANNEL_FULL',
      limit: capacity
    };
  }

  const requiredPasscode = normalizePasscode(channel.config?.passcode);
  if (requiredPasscode && normalizePasscode(input.password) !== requiredPasscode) {
    return { error: 'Invalid or missing passcode.', code: 'INVALID_PASSCODE' };
  }

  members.add(input.userId);
  state.channelMembers.set(channel.id, members);
  state.emptyChannelSince.delete(channel.id);

  return {
    channel: toChannelSummary(channel, input.userId),
    host: channel.host === input.userId,
    sync:
      channel.type === 'music' || channel.type === 'video'
        ? buildMediaSync(channel)
        : channel.type === 'stopwatch'
          ? {
              running: channel.running,
              startTime: channel.startTime,
              elapsed: channel.time
            }
          : { type: channel.type }
  };
}

export function leaveChannel(input: { channelId: string; userId: string }): boolean {
  const state = getState();
  const channel = state.channels.get(input.channelId);
  if (!channel) return false;

  const members = state.channelMembers.get(input.channelId);
  if (members) {
    members.delete(input.userId);
    if (members.size === 0) {
      state.channelMembers.delete(input.channelId);
    }
  }

  const remainingMembers = (state.channelMembers.get(input.channelId) ?? new Set<string>()).size;
  if (remainingMembers === 0) {
    state.emptyChannelSince.set(input.channelId, Date.now());
    logger.info('User left channel, cleanup timer started', {
      userId: input.userId,
      channelName: channel.name,
      channelId: input.channelId
    });
  } else {
    logger.info('User left channel', {
      userId: input.userId,
      channelName: channel.name,
      channelId: input.channelId,
      remainingMembers
    });
  }

  return true;
}

export function closeChannel(input: { channelId: string; userId: string }): boolean {
  const state = getState();
  const channel = state.channels.get(input.channelId);
  if (!channel || channel.host !== input.userId) return false;

  // Delete associated uploaded files
  deleteChannelFiles(channel).catch((err) => logger.error('File deletion failed on channel close', { err }));

  state.channelMembers.delete(input.channelId);
  state.emptyChannelSince.delete(input.channelId);
  state.channels.delete(input.channelId);
  return true;
}

export function updateChannel(input: {
  channelId: string;
  userId: string;
  type: ChannelType;
  action: string;
  payload?: Record<string, unknown>;
}): Record<string, unknown> | { error: string; code: string } {
  const state = getState();
  const channel = state.channels.get(input.channelId);
  if (!channel || channel.host !== input.userId) {
    return { error: 'Unauthorized.', code: 'UNAUTHORIZED' };
  }

  if (channel.type !== input.type) {
    return { error: 'Channel type mismatch.', code: 'TYPE_MISMATCH' };
  }

  const now = Date.now();
  const payload = input.payload ?? {};

  if (input.type === 'stopwatch') {
    if (input.action === 'start') {
      channel.running = true;
      channel.startTime = now - Number(channel.time || 0) * 1000;
    } else if (input.action === 'pause') {
      channel.running = false;
      channel.time = Math.max(0, (now - channel.startTime) / 1000);
    } else if (input.action === 'reset') {
      channel.running = false;
      channel.time = 0;
      channel.startTime = now;
    }

    return {
      type: 'stopwatch',
      action: input.action,
      status: 'ok',
      running: channel.running,
      startTime: channel.startTime,
      elapsed: channel.time
    };
  }

  if (input.type === 'music' || input.type === 'video') {
    if (input.action === 'load_track') {
      const trackUrl = String(payload.url ?? '').trim();
      if (!trackUrl) {
        return { error: 'Track URL is required.', code: 'INVALID_TRACK' };
      }

      channel.trackUrl = trackUrl;
      channel.trackTitle = String(payload.title ?? '').trim() || trackUrl.split('/').filter(Boolean).pop() || 'External Track';
      channel.activeSourcePresent = true;
      channel.media.currentTime = 0;
      channel.media.duration = 0;
      channel.media.playing = false;
      channel.media.updatedAt = now;
      channel.media.anchorTs = now;
      channel.media.scheduleAt = null;
      channel.media.sourceMode = String(payload.sourceMode ?? 'url') as 'url' | 'local';

      return {
        type: channel.type,
        action: input.action,
        status: 'ok',
        ...buildMediaSync(channel)
      };
    }

    if (input.action === 'set_metadata') {
      const nextDuration = Math.max(0, Number(payload.duration ?? channel.media.duration));
      const nextCurrentTime = Math.max(0, Number(payload.currentTime ?? channel.media.currentTime));

      if (String(payload.url ?? '').trim()) {
        channel.trackUrl = String(payload.url).trim();
        channel.activeSourcePresent = true;
      }

      const nextTitle = String(payload.title ?? '').trim();
      if (nextTitle) {
        channel.trackTitle = nextTitle;
      }

      channel.media.duration = nextDuration;
      channel.media.currentTime = nextCurrentTime;
      channel.media.playing = Boolean(payload.playing ?? channel.media.playing);
      channel.media.updatedAt = now;
      channel.media.anchorTs = now;

      if (channel.media.duration > 0 && channel.media.currentTime >= channel.media.duration) {
        channel.media.currentTime = channel.media.duration;
        channel.media.playing = false;
      }

      return {
        type: channel.type,
        action: input.action,
        status: 'ok',
        ...buildMediaSync(channel)
      };
    }

    const nextCurrentTime = Math.max(0, Number(payload.currentTime ?? channel.media.currentTime));
    const nextDuration = Math.max(0, Number(payload.duration ?? channel.media.duration));
    const requestedPaused = payload.paused;
    let playing = Boolean(payload.playing ?? channel.media.playing);
    if (requestedPaused !== undefined) {
      playing = !Boolean(requestedPaused);
    }

    channel.media.currentTime = nextCurrentTime;
    channel.media.duration = nextDuration;
    channel.media.playing = input.action === 'play' || input.action === 'pause' || input.action === 'seek' ? playing : channel.media.playing;
    channel.media.anchorTs = now;
    channel.media.updatedAt = now;
    channel.media.scheduleAt = null;
    channel.media.sourceMode = String(payload.sourceMode ?? channel.media.sourceMode ?? 'url') as 'url' | 'local';

    const title = String(payload.title ?? '').trim();
    if (title) {
      channel.trackTitle = title;
    }

    return {
      type: channel.type,
      action: input.action,
      status: 'ok',
      ...buildMediaSync(channel)
    };
  }

  return {
    type: channel.type,
    action: input.action,
    status: 'ok'
  };
}

export function toSummary(channelId: string, userId?: string): ChannelSummary | null {
  const channel = getState().channels.get(channelId);
  return channel ? toChannelSummary(channel, userId) : null;
}

export function buildRoomState(channelId: string, userId?: string): ChannelStateResponse | null {
  return getChannelState(channelId, userId);
}
