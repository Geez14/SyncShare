"use client";

import { useMemo } from 'react';

interface VoiceModuleProps {
  isHost: boolean;
  userId: string;
  members: number;
  channelMembers: string[];
  onMuteAll: () => void;
}

export default function VoiceModule({ isHost, userId, members, channelMembers, onMuteAll }: VoiceModuleProps) {
  const sortedMembers = useMemo(() => {
    return [...new Set(channelMembers.length ? channelMembers : [userId])].sort();
  }, [channelMembers, userId]);

  return (
    <section className="rounded-2xl border border-border bg-[rgba(11,18,32,0.75)] p-6 shadow-glass">
      <div className="mb-3 text-sm uppercase tracking-[0.2em] text-accent">Voice</div>
      <div className="mb-2 text-lg font-semibold text-text">Voice Room</div>
      <div className="mb-4 text-sm text-muted">Members connected: {members}</div>

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sortedMembers.map((member) => (
          <article key={member} className="rounded-2xl border border-border bg-slate-950 p-4">
            <div className="mb-2 text-xs uppercase tracking-[0.2em] text-accent">Participant</div>
            <div className="text-sm font-semibold text-text">{member}</div>
          </article>
        ))}
      </div>

      {isHost ? (
        <button className="rounded-xl bg-danger px-4 py-2 font-semibold text-white transition hover:brightness-110" onClick={onMuteAll}>Mute All</button>
      ) : (
        <div className="text-sm text-muted">This migration keeps room presence and mute moderation in the UI layer.</div>
      )}
    </section>
  );
}
