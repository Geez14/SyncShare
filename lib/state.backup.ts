import type {
  ChannelConfig,
  ChannelRecord,
  ChannelStateResponse,
  ChannelSummary,
  ChannelType,
  JoinResponse,
  MediaState,
  RuntimeConfig,
  SyncAckRecord,
  VoiceSignal
} from './types';
import { getRuntimeConfig } from './runtime-config';

interface AppRuntimeState {
  channels: Map<string, ChannelRecord>;
  voicePresence: Map<string, Set<string>>;
  channelMembers: Map<string, Set<string>>;
  userSidMap: Map<string, string>;
  sidUserMap: Map<string, string>;
  pendingSyncAcks: Map<string, SyncAckRecord>;
  latestSyncSessions: Map<string, string>;
  pendingIceCandidates: Map<string, VoiceSignal[]>;
  legacyVoiceSignalAllowance: Set<string>;
  emptyChannelSince: Map<string, number>;
  runtimeConfig: RuntimeConfig;
  janitorStarted: boolean;
  maintenanceStarted: boolean;
}

const stateKey = '__syncshare_next_state__';
const globalForState = globalThis as typeof globalThis & {
  [stateKey]?: AppRuntimeState;
};

function createState(): AppRuntimeState {
  return {
    channels: new Map(),
    voicePresence: new Map(),
    channelMembers: new Map(),
    userSidMap: new Map(),
    sidUserMap: new Map(),
    pendingSyncAcks: new Map(),
    latestSyncSessions: new Map(),
    pendingIceCandidates: new Map(),
    legacyVoiceSignalAllowance: new Set(),
    emptyChannelSince: new Map(),
    runtimeConfig: getRuntimeConfig(),
    janitorStarted: false,
    maintenanceStarted: false
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

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
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

function clearChannelSyncState(state: AppRuntimeState, channelId: string): void {
  for (const [syncId, pending] of state.pendingSyncAcks.entries()) {
    if (pending.channel === channelId) {
      state.pendingSyncAcks.delete(syncId);
    }
  }

  for (const [key, value] of state.latestSyncSessions.entries()) {
    if (key.startsWith(`${channelId}:`) || value.startsWith(`${channelId}:`)) {
      state.latestSyncSessions.delete(key);
    }
  }
}

function clearUserSyncState(state: AppRuntimeState, userId: string): void {
  for (const [syncId, pending] of state.pendingSyncAcks.entries()) {
    if (pending.user === userId) {
      state.pendingSyncAcks.delete(syncId);
    }
  }

  for (const [key, value] of state.latestSyncSessions.entries()) {
    if (key.endsWith(`:${userId}`) || value.endsWith(`:${userId}`)) {
      state.latestSyncSessions.delete(key);
    }
  }
}

function issueSyncSession(state: AppRuntimeState, channelId: string, userId: string): string {
  const syncId = crypto.randomUUID();
  state.pendingSyncAcks.set(syncId, {
    user: userId,
    channel: channelId,
    issuedAt: Date.now()
  });
  state.latestSyncSessions.set(`${channelId}:${userId}`, syncId);
  return syncId;
}

function getMediaState(channel: ChannelRecord): MediaState {
  return channel.media ?? {
    currentTime: 0,
    duration: 0,
    playing: false,
    updatedAt: Date.now(),
    anchorTs: Date.now(),
    sourceMode: 'url'
  };
}

function buildMediaSnapshot(channel: ChannelRecord, now = Date.now(), action?: string): Record<string, unknown> {
  const media = getMediaState(channel);
  const activeSourcePresent = Boolean(channel.activeSourcePresent);
  const sourceMode = media.sourceMode ?? 'url';
  const hasTrackReference = Boolean(String(channel.trackUrl || '').trim());
  const hasActiveStream = Boolean(activeSourcePresent && (hasTrackReference || sourceMode === 'local'));

  let currentTime = Number(media.currentTime || 0);
  const duration = Number(media.duration || 0);
  const effectivePlaying = Boolean(media.playing && activeSourcePresent);

  if (effectivePlaying) {
    const anchorTs = Number(media.anchorTs || now);
    currentTime += Math.max(0, now - anchorTs) / 1000;
  }

  if (duration > 0) {
    currentTime = Math.min(currentTime, duration);
  }

  const ended = duration > 0 && currentTime >= duration;
  if (ended) {
    media.playing = false;
  }

  const effectivePlayingAfterClamp = Boolean(media.playing && activeSourcePresent && !ended);

  media.currentTime = Math.max(0, currentTime);
  media.anchorTs = now;
  media.updatedAt = now;

  const snapshot: Record<string, unknown> = {
    type: channel.type,
    playing: effectivePlayingAfterClamp,
    paused: !effectivePlayingAfterClamp,
    currentTime: media.currentTime,
    duration,
    anchorTs: now,
    timestamp: now,
    serverNowMs: now,
    src: channel.trackUrl,
    trackTitle: channel.trackTitle || 'Untitled',
    startAt: media.scheduleAt ?? 0,
    sourceMode,
    activeSourcePresent,
    hasActiveStream
  };

  if (action) {
    snapshot.action = action;
  }

  return snapshot;
}

function buildStopwatchSync(channel: ChannelRecord): Record<string, unknown> {
  const now = Date.now();
  const elapsed = channel.running ? Math.max(0, (now - channel.startTime) / 1000) : Number(channel.time || 0);

  return {
    type: 'stopwatch',
    running: channel.running,
    startTime: channel.startTime,
    elapsed
  };
}

function tickChannels(state: AppRuntimeState): void {
  const now = Date.now();

  for (const channel of state.channels.values()) {
    if (channel.type === 'stopwatch') {
      if (channel.running) {
        channel.time = Math.max(0, (now - channel.startTime) / 1000);
      }
      continue;
    }

    if (channel.type !== 'music' && channel.type !== 'video') {
      continue;
    }

    const media = getMediaState(channel);
    if (media.scheduleAt && now >= media.scheduleAt) {
      media.playing = true;
      media.scheduleAt = null;
      media.anchorTs = now;
      media.updatedAt = now;
    }

    if (!media.playing || !channel.activeSourcePresent) {
      continue;
    }

    const predicted = media.currentTime + Math.max(0, now - media.anchorTs) / 1000;
    media.currentTime = media.duration > 0 ? Math.min(media.duration, predicted) : predicted;
    if (media.duration > 0 && media.currentTime >= media.duration) {
      media.playing = false;
    }
    media.anchorTs = now;
    media.updatedAt = now;
  }
}

function cleanupEmptyChannels(state: AppRuntimeState): void {
  const now = Date.now();
  const { channel_cleanup_interval_seconds, empty_channel_ttl_seconds } = state.runtimeConfig.timing;
  void channel_cleanup_interval_seconds;

  for (const [channelId, channel] of state.channels.entries()) {
    const members = state.channelMembers.get(channelId) ?? new Set<string>();
    if (members.size > 0) {
      state.emptyChannelSince.delete(channelId);
      continue;
    }

    const firstEmpty = state.emptyChannelSince.get(channelId);
    if (!firstEmpty) {
      state.emptyChannelSince.set(channelId, now);
      continue;
    }

    if (now - firstEmpty < empty_channel_ttl_seconds * 1000) {
      continue;
    }

    channel.activeSourcePresent = false;
    channel.running = false;
    if (channel.media) {
      channel.media.playing = false;
    }

    state.voicePresence.delete(channelId);
    state.channelMembers.delete(channelId);
    state.emptyChannelSince.delete(channelId);
    clearChannelSyncState(state, channelId);
    state.channels.delete(channelId);
  }
}

function ensureMaintenanceLoops(state: AppRuntimeState): void {
  if (!state.maintenanceStarted) {
    state.maintenanceStarted = true;
    const tickMs = Math.max(250, Math.round((state.runtimeConfig.timing.media_tick_seconds ?? state.runtimeConfig.timing.stopwatch_tick_seconds ?? 1) * 1000));

    setInterval(() => {
      tickChannels(state);
    }, tickMs).unref?.();
  }

  if (!state.janitorStarted) {
    state.janitorStarted = true;
    const janitorMs = Math.max(5_000, Math.round((state.runtimeConfig.timing.channel_cleanup_interval_seconds ?? 60) * 1000));

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

export function getChannelRecord(channelId: string): ChannelRecord | null {
  return getState().channels.get(channelId) ?? null;
}

export function getChannelState(channelId: string, userId?: string): ChannelStateResponse | null {
  const state = getState();
  const channel = state.channels.get(channelId);
  if (!channel) return null;

  const members = state.channelMembers.get(channelId) ?? new Set<string>();
  const summary = toChannelSummary(channel, userId);
  const sync = channel.type === 'stopwatch' ? buildStopwatchSync(channel) : buildMediaSnapshot(channel);

  return {
    channel: summary,
    host: channel.host === userId,
    sync,
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
  const now = Date.now();
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
    startTime: now,
    media: {
      currentTime: 0,
      duration: 0,
      playing: false,
      updatedAt: now,
      anchorTs: now,
      sourceMode: 'url',
      scheduleAt: null
    }
  };

  state.channels.set(id, channel);
  state.emptyChannelSince.delete(id);
  clearChannelSyncState(state, id);

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
      error: `Room is full: ${channel.type.charAt(0).toUpperCase() + channel.type.slice(1)} channel is completely occupied (${capacity}/${capacity}).`,
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

  if (channel.host === input.userId) {
    channel.activeSourcePresent = true;
  }

  let sync: Record<string, unknown> = {};
  if (channel.type === 'stopwatch') {
    sync = buildStopwatchSync(channel);
  } else {
    sync = buildMediaSnapshot(channel, Date.now(), 'server_sync');

    if (channel.host !== input.userId) {
      const syncId = issueSyncSession(state, channel.id, input.userId);
      sync.syncSessionId = syncId;
      sync.syncId = syncId;
      sync.requiresAck = true;
      sync.syncToleranceMs = 500;
    }
  }

  return {
    channel: toChannelSummary(channel, input.userId),
    host: channel.host === input.userId,
    sync
  };
}

export function acknowledgeSync(input: { channelId: string; userId: string; syncId: string }): boolean {
  const state = getState();
  const pending = state.pendingSyncAcks.get(input.syncId);
  if (!pending) return false;
  if (pending.user !== input.userId || pending.channel !== input.channelId) return false;

  const latest = state.latestSyncSessions.get(`${input.channelId}:${input.userId}`);
  if (latest !== input.syncId) return false;

  state.pendingSyncAcks.delete(input.syncId);
  return true;
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

  if (channel.host === input.userId) {
    channel.activeSourcePresent = false;
    if (channel.type === 'stopwatch') {
      channel.running = false;
    } else {
      channel.media.playing = false;
    }
  }

  for (const [voiceChannelId, members] of state.voicePresence.entries()) {
    if (members.delete(input.userId) && members.size === 0) {
      state.voicePresence.delete(voiceChannelId);
    }
  }

  clearUserSyncState(state, input.userId);

  if ((state.channelMembers.get(input.channelId) ?? new Set<string>()).size === 0) {
    state.emptyChannelSince.set(input.channelId, Date.now());
  }

  return true;
}

export function closeChannel(input: { channelId: string; userId: string }): boolean {
  const state = getState();
  const channel = state.channels.get(input.channelId);
  if (!channel || channel.host !== input.userId) return false;

  state.voicePresence.delete(input.channelId);
  state.channelMembers.delete(input.channelId);
  state.emptyChannelSince.delete(input.channelId);
  clearChannelSyncState(state, input.channelId);
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

  if (input.type === 'stopwatch') {
    if (input.action === 'start') {
      const elapsed = Number(channel.time || 0);
      channel.running = true;
      channel.startTime = now - elapsed * 1000;
    } else if (input.action === 'pause') {
      channel.running = false;
      channel.time = Math.max(0, (now - channel.startTime) / 1000);
    } else if (input.action === 'reset') {
      channel.running = false;
      channel.time = 0;
      channel.startTime = now;
    }

    return buildStopwatchSync(channel);
  }

  if (input.type === 'music' || input.type === 'video') {
    const payload = input.payload ?? {};
    const media = getMediaState(channel);

    if (input.action === 'load_track') {
      const trackUrl = String(payload.url ?? '').trim();
      if (!trackUrl) {
        return { error: 'Track URL is required.', code: 'INVALID_TRACK' };
      }

      channel.trackUrl = trackUrl;
      channel.trackTitle = String(payload.title ?? '').trim() || trackUrl.split('/').filter(Boolean).pop() || 'External Track';
      media.currentTime = 0;
      media.duration = 0;
      media.playing = false;
      media.anchorTs = now;
      media.updatedAt = now;
      media.scheduleAt = null;
      media.sourceMode = String(payload.sourceMode ?? 'url') as 'url' | 'local';
      channel.activeSourcePresent = true;

      return buildMediaSnapshot(channel, now, input.action);
    }

    if (input.action === 'set_metadata') {
      const nextDuration = Number(payload.duration ?? media.duration);
      const nextCurrentTime = Number(payload.currentTime ?? media.currentTime);
      const nextTitle = String(payload.title ?? '').trim();

      if (String(payload.url ?? '').trim()) {
        channel.trackUrl = String(payload.url).trim();
      }
      if (nextTitle) {
        channel.trackTitle = nextTitle;
      }

      media.duration = Math.max(0, nextDuration);
      media.currentTime = Math.max(0, nextCurrentTime);
      media.playing = Boolean(payload.playing ?? media.playing);
      media.anchorTs = now;
      media.updatedAt = now;

      if (media.duration > 0 && media.currentTime >= media.duration) {
        media.currentTime = media.duration;
        media.playing = false;
      }

      return buildMediaSnapshot(channel, now, input.action);
    }

    if (input.action === 'schedule_start') {
      if (input.type !== 'music') {
        return { error: 'Scheduling is only supported for music channels.', code: 'INVALID_ACTION' };
      }

      let startAt = Number(payload.startAt ?? 0);
      if (!isPositiveNumber(startAt)) {
        return { error: 'A valid future start time is required.', code: 'INVALID_ACTION' };
      }

      const minAllowed = now + state.runtimeConfig.timing.min_schedule_lead_ms;
      if (startAt < minAllowed) {
        startAt = minAllowed;
      }

      media.scheduleAt = startAt;
      media.playing = false;
      media.anchorTs = now;
      media.updatedAt = now;
      media.currentTime = Math.max(0, Number(payload.currentTime ?? media.currentTime));
      media.duration = Math.max(0, Number(payload.duration ?? media.duration));
      media.sourceMode = String(payload.sourceMode ?? media.sourceMode ?? 'url') as 'url' | 'local';

      return buildMediaSnapshot(channel, now, input.action);
    }

    const currentTime = Math.max(0, Number(payload.currentTime ?? media.currentTime));
    const duration = Math.max(0, Number(payload.duration ?? media.duration));
    const requestedPaused = payload.paused;
    let playing = Boolean(payload.playing ?? media.playing);
    if (requestedPaused !== undefined) {
      playing = !Boolean(requestedPaused);
    }

    media.currentTime = currentTime;
    media.duration = duration;
    media.playing = input.action === 'play' || input.action === 'pause' || input.action === 'seek' || input.action === 'time_sync' || input.action === 'media_sync'
      ? playing
      : media.playing;
    media.anchorTs = now;
    media.updatedAt = now;
    media.scheduleAt = null;
    media.sourceMode = String(payload.sourceMode ?? media.sourceMode ?? 'url') as 'url' | 'local';

    const title = String(payload.title ?? '').trim();
    if (title) {
      channel.trackTitle = title;
    }

    return buildMediaSnapshot(channel, now, input.action);
  }

  if (input.type === 'voice') {
    if (input.action === 'mute_all') {
      return { type: 'voice', action: 'mute_all', ok: true };
    }

    return { error: 'Unsupported voice action.', code: 'INVALID_ACTION' };
  }

  return { error: 'Unsupported action.', code: 'INVALID_ACTION' };
}

export function createVoiceJoin(input: { channelId: string; userId: string }): string[] {
  const state = getState();
  const members = state.voicePresence.get(input.channelId) ?? new Set<string>();
  const peers = Array.from(members);
  members.add(input.userId);
  state.voicePresence.set(input.channelId, members);
  return peers;
}

export function buildRoomState(channelId: string, userId?: string): ChannelStateResponse | null {
  return getChannelState(channelId, userId);
}

export function getRuntimeState(): RuntimeConfig {
  return getState().runtimeConfig;
}

export function clearUserPresence(userId: string): void {
  const state = getState();
  for (const [channelId, members] of state.channelMembers.entries()) {
    if (members.delete(userId) && members.size === 0) {
      state.channelMembers.delete(channelId);
      state.emptyChannelSince.set(channelId, Date.now());
    }
  }

  for (const [channelId, members] of state.voicePresence.entries()) {
    if (members.delete(userId) && members.size === 0) {
      state.voicePresence.delete(channelId);
    }
  }

  clearUserSyncState(state, userId);
}

export function toSummary(channelId: string, userId?: string): ChannelSummary | null {
  const channel = getState().channels.get(channelId);
  return channel ? toChannelSummary(channel, userId) : null;
}
