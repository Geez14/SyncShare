"use client";

import type { ChannelStateResponse, ChannelType } from '@/lib/types';
import { channelTypeLabel } from '@/lib/utils';

import MusicModule from './modules/music-module';
import StopwatchModule from './modules/stopwatch-module';
import VideoModule from './modules/video-module';
import VoiceModule from './modules/voice-module';

interface ChannelRoomProps {
  room: ChannelStateResponse;
  userId: string;
  onLeave: () => void;
  onClose: () => void;
  onControl: (action: string, payload?: Record<string, unknown>) => void;
  onAckSync: (syncId: string) => void;
}

function RoomModule(props: ChannelRoomProps) {
  const { room } = props;
  const baseProps = {
    isHost: room.host,
    onControl: props.onControl,
    onAckSync: props.onAckSync,
    channelId: room.channel.id,
    userId: props.userId
  };

  switch (room.channel.type) {
    case 'stopwatch':
      return <StopwatchModule isHost={room.host} sync={room.sync as { running?: boolean; startTime?: number; elapsed?: number }} onControl={(action) => props.onControl(action)} />;
    case 'music':
      return <MusicModule {...baseProps} sync={room.sync as Record<string, unknown>} />;
    case 'video':
      return <VideoModule {...baseProps} sync={room.sync as Record<string, unknown>} />;
    case 'voice':
      return (
        <VoiceModule
          isHost={room.host}
          userId={props.userId}
          members={room.members}
          channelMembers={room.membersList}
          channelId={room.channel.id}
          onMuteAll={() => props.onControl('mute_all')}
        />
      );
    default:
      return null;
  }
}

export default function ChannelRoom(props: ChannelRoomProps) {
  const { room } = props;

  return (
    <section className="rounded-3xl border border-border bg-panel p-5 shadow-glass md:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold text-text">{room.channel.name}</div>
          <div className="mt-1 text-sm text-muted">#{room.channel.id} · {channelTypeLabel(room.channel.type as ChannelType)} · {room.members} watching</div>
        </div>
        <div className="flex flex-wrap gap-3">
          {room.host ? (
            <button className="rounded-xl bg-danger px-4 py-2 font-semibold text-white transition hover:brightness-110" onClick={props.onClose}>Close Channel</button>
          ) : null}
          <button className="rounded-xl border border-border px-4 py-2 font-semibold text-text transition hover:bg-white/5" onClick={props.onLeave}>Exit to Lobby</button>
        </div>
      </div>

      {!room.host ? (
        <div className="mb-4 rounded-2xl border border-border bg-slate-950/80 px-4 py-3 text-sm text-muted">
          Viewer mode: host controls playback and session actions.
        </div>
      ) : null}

      <RoomModule {...props} />
    </section>
  );
}
