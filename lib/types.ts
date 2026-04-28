export type ChannelType = 'stopwatch' | 'music' | 'video' | 'voice';

export interface ChannelConfig {
  private?: boolean;
  passcode?: string;
  [key: string]: unknown;
}

export interface MediaState {
  currentTime: number;
  duration: number;
  playing: boolean;
  updatedAt: number;
  anchorTs: number;
  scheduleAt?: number | null;
  sourceMode?: 'url' | 'local';
}

export interface ChannelRecord {
  id: string;
  name: string;
  type: ChannelType;
  host: string;
  config: ChannelConfig;
  trackUrl: string;
  trackTitle: string;
  activeSourcePresent: boolean;
  time: number;
  running: boolean;
  startTime: number;
  media: MediaState;
}

export interface ChannelSummary {
  id: string;
  name: string;
  type: ChannelType;
  host: string;
  passcodeRequired: boolean;
  watching: number;
  capacity: number | null;
  full: boolean;
}

export interface RuntimeConfig {
  channel_entry_limits: Record<ChannelType, number | null>;
  timing: {
    stopwatch_tick_seconds: number;
    min_schedule_lead_ms: number;
    channel_cleanup_interval_seconds: number;
    empty_channel_ttl_seconds: number;
    media_tick_seconds?: number;
  };
  rtc: {
    ice_servers: Array<Record<string, unknown>>;
    turn_servers?: Array<Record<string, unknown>>;
  };
  server: {
    host: string;
    port: number;
    debug: boolean;
  };
}

export interface JoinResponse {
  channel: ChannelSummary;
  host: boolean;
  sync: Record<string, unknown>;
}

export interface ChannelStateResponse {
  channel: ChannelSummary;
  host: boolean;
  sync: Record<string, unknown>;
  members: number;
  membersList: string[];
}

export interface SyncAckRecord {
  user: string;
  channel: string;
  issuedAt: number;
}

export interface VoiceSignal {
  channel: string;
  sender: string;
  target: string;
  type: string;
  payload?: unknown;
}
