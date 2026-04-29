"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '@/lib/use-socket';
import { useWebRTC } from '@/lib/use-webrtc';

interface VoiceModuleProps {
  isHost: boolean;
  userId: string;
  members: number;
  channelMembers: string[];
  onMuteAll: () => void;
  channelId: string;
}

export default function VoiceModule({
  isHost,
  userId,
  members,
  channelMembers,
  onMuteAll,
  channelId
}: VoiceModuleProps) {
  const { socket, isConnected } = useSocket();
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const startedRef = useRef(false);
  const offeredPeersRef = useRef<Set<string>>(new Set());
  const localStreamRef = useRef<MediaStream | null>(null);
  const [selfMuted, setSelfMuted] = useState(false);
  const [forcedMuted, setForcedMuted] = useState(false);
  const [hostMutedMembers, setHostMutedMembers] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const voiceConstraints = useMemo<MediaStreamConstraints>(() => ({ audio: true, video: false }), []);
  const membersList = useMemo(() => {
    return [...new Set(channelMembers.length ? channelMembers : [userId])].sort();
  }, [channelMembers, userId]);

  // Use WebRTC for voice connection
  const { startLocalMedia, sendOffer, remoteStreams, closeAll, connectionState } = useWebRTC({
    socket,
    channelId,
    userId,
    isHost: true,
    mediaConstraints: voiceConstraints
  });

  // Register user room for targeted WebRTC and voice mute signaling.
  useEffect(() => {
    if (!socket || !isConnected) return;
    socket.emit('user:ready', { userId, channelId });
  }, [socket, isConnected, userId, channelId]);

  // Start local microphone once.
  useEffect(() => {
    if (!isConnected || startedRef.current) return;
    let cancelled = false;

    const init = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const stream = await startLocalMedia(voiceConstraints);
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStreamRef.current = stream;
        startedRef.current = true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not access microphone');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [isConnected, startLocalMedia, voiceConstraints]);

  // Offer voice connection to new members once.
  useEffect(() => {
    if (!isConnected || !startedRef.current) return;

    const peers = membersList.filter((member) => member !== userId);
    const activePeers = new Set(peers);
    offeredPeersRef.current.forEach((peerId) => {
      if (!activePeers.has(peerId)) {
        offeredPeersRef.current.delete(peerId);
      }
    });

    const sendPendingOffers = async () => {
      for (const peerId of peers) {
        if (offeredPeersRef.current.has(peerId)) continue;
        offeredPeersRef.current.add(peerId);
        try {
          await sendOffer(peerId);
        } catch {
          offeredPeersRef.current.delete(peerId);
        }
      }
    };

    void sendPendingOffers();
  }, [isConnected, membersList, userId, sendOffer]);

  // Apply incoming remote streams to hidden audio elements.
  useEffect(() => {
    remoteStreams.forEach((stream, peerId) => {
      const audioElement = audioElementsRef.current.get(peerId);
      if (!audioElement) return;

      if (audioElement.srcObject !== stream) {
        audioElement.srcObject = stream;
      }
      audioElement.muted = hostMutedMembers.has(peerId);
      void audioElement.play().catch(() => {
        // Browser autoplay policies can block; user interaction later should unblock.
      });
    });
  }, [remoteStreams, hostMutedMembers]);

  // Receive host force-mute events on targeted participant.
  useEffect(() => {
    if (!socket) return;

    const onForceMute = (data: { channelId: string; target: string; muted: boolean }) => {
      if (data.channelId !== channelId || data.target !== userId) return;
      setForcedMuted(Boolean(data.muted));
    };

    socket.on('voice:force-mute', onForceMute);
    return () => {
      socket.off('voice:force-mute', onForceMute);
    };
  }, [socket, channelId, userId]);

  const effectiveSelfMuted = selfMuted || forcedMuted;

  useEffect(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !effectiveSelfMuted;
    });
  }, [effectiveSelfMuted]);

  const toggleParticipantMute = useCallback(
    (participantId: string) => {
      if (!socket || participantId === userId) return;
      setHostMutedMembers((prev) => {
        const next = new Set(prev);
        const shouldMute = !next.has(participantId);
        if (shouldMute) next.add(participantId);
        else next.delete(participantId);

        const audioElement = audioElementsRef.current.get(participantId);
        if (audioElement) {
          audioElement.muted = shouldMute;
        }

        socket.emit('voice:mute-user', {
          channelId,
          from: userId,
          to: participantId,
          muted: shouldMute
        });

        return next;
      });
    },
    [socket, channelId, userId]
  );

  const handleMuteAll = useCallback(() => {
    if (!socket) return;
    setHostMutedMembers((prev) => {
      const next = new Set(prev);
      membersList.forEach((member) => {
        if (member === userId) return;
        next.add(member);
        const audioElement = audioElementsRef.current.get(member);
        if (audioElement) {
          audioElement.muted = true;
        }
        socket.emit('voice:mute-user', {
          channelId,
          from: userId,
          to: member,
          muted: true
        });
      });
      return next;
    });
    onMuteAll();
  }, [socket, membersList, userId, channelId, onMuteAll]);

  const toggleSelfMute = useCallback(() => {
    if (forcedMuted) {
      return;
    }
    setSelfMuted((prev) => !prev);
  }, [forcedMuted]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      closeAll();
      audioElementsRef.current.clear();
      offeredPeersRef.current.clear();
      startedRef.current = false;
      localStreamRef.current = null;
    };
  }, []);

  const getMemberStatus = (member: string) => {
    if (member === userId) {
      if (forcedMuted) return 'Muted by host';
      return effectiveSelfMuted ? 'Muted' : 'Live';
    }
    if (hostMutedMembers.has(member)) return 'Muted by host';
    return remoteStreams.has(member) ? 'Connected' : 'Connecting';
  };

  return (
    <section className="rounded-2xl border border-border bg-[rgba(11,18,32,0.75)] p-6 shadow-glass">
      <div className="mb-3 text-sm uppercase tracking-[0.2em] text-accent">Voice Call</div>
      <div className="mb-2 text-lg font-semibold text-text">Voice Room</div>
      <div className="mb-4 text-sm text-muted">
        Members connected: {members} {isLoading ? '(initializing...)' : ''}
      </div>

      {error ? <div className="mb-4 rounded-xl border border-danger bg-slate-950 p-3 text-sm text-danger">{error}</div> : null}

      {Array.from(remoteStreams.keys()).map((peerId) => (
        <audio
          key={`audio-${peerId}`}
          autoPlay
          playsInline
          className="hidden"
          ref={(element) => {
            if (!element) {
              audioElementsRef.current.delete(peerId);
              return;
            }
            audioElementsRef.current.set(peerId, element);
            const stream = remoteStreams.get(peerId);
            if (stream && element.srcObject !== stream) {
              element.srcObject = stream;
            }
            element.muted = hostMutedMembers.has(peerId);
          }}
        />
      ))}

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {membersList.map((member) => {
          const isSelf = member === userId;
          const isMuted = isSelf ? effectiveSelfMuted : hostMutedMembers.has(member);
          return (
            <article key={member} className="rounded-2xl border border-border bg-slate-950 p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs uppercase tracking-[0.2em] text-accent">{isSelf ? 'You' : 'Participant'}</div>
                <div className={`h-2 w-2 rounded-full ${remoteStreams.has(member) || isSelf ? 'bg-accent' : 'bg-muted'}`} />
              </div>
              <div className="mb-3 text-sm font-semibold text-text">{member}</div>

              {isHost && !isSelf ? (
                <button
                  onClick={() => toggleParticipantMute(member)}
                  className="w-full rounded-xl border border-border px-3 py-2 text-xs font-semibold text-text transition hover:bg-white/5"
                >
                  {isMuted ? 'Unmute Participant' : 'Mute Participant'}
                </button>
              ) : null}

              {isSelf ? (
                <button
                  onClick={toggleSelfMute}
                  disabled={forcedMuted}
                  className="w-full rounded-xl border border-border px-3 py-2 text-xs font-semibold text-text transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {forcedMuted ? 'Muted by Host' : effectiveSelfMuted ? 'Unmute Myself' : 'Mute Myself'}
                </button>
              ) : null}

              <div className="mt-2 text-xs text-muted">{getMemberStatus(member)}</div>
            </article>
          );
        })}
      </div>

      {isHost ? (
        <div className="space-y-2">
          <button
            onClick={handleMuteAll}
            className="w-full rounded-xl bg-danger px-4 py-2 font-semibold text-white transition hover:brightness-110"
          >
            Mute All
          </button>
          <div className="text-xs text-muted">Connection state: {connectionState}</div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-slate-950 p-3 text-xs text-muted">
          Use self-mute while speaking. Host moderation can force mute participants.
        </div>
      )}
    </section>
  );
}
