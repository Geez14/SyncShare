"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSocket } from '@/lib/use-socket';
import { useWebRTC } from '@/lib/use-webrtc';

interface StreamModuleProps {
  isHost: boolean;
  channelId: string;
  userId: string;
  membersList: string[];
  onControl: (action: string, payload?: Record<string, unknown>) => void;
}

export default function StreamModule({
  isHost,
  channelId,
  userId,
  membersList,
  onControl
}: StreamModuleProps) {
  const { socket, isConnected } = useSocket();
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const [streamEnabled, setStreamEnabled] = useState(false);
  const [streamPaused, setStreamPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [remoteStreamCount, setRemoteStreamCount] = useState(0);

  // Use WebRTC for live camera streaming (with proper dependency management)
  const { startLocalMedia, sendOffer, remoteStreams, closeAll, connectionState } = useWebRTC({
    socket,
    channelId,
    userId,
    isHost,
    mediaConstraints: { audio: true, video: { width: 1280, height: 720 } }
  });

  // Register with Socket.IO (only when socket/connection changes)
  useEffect(() => {
    if (!socket || !isConnected) return;
    socket.emit('user:ready', { userId, channelId });
  }, [socket, isConnected, userId, channelId]);

  // Toggle streaming (only changes when streamEnabled changes OR when called)
  const toggleStream = useCallback(async () => {
    if (streamEnabled) {
      // Stop streaming
      setStreamEnabled(false);
      setStreamPaused(false);
      closeAll();
      onControl('stream_stopped', { userId });
      return;
    }

    // Start streaming
    setIsLoading(true);
    try {
      await startLocalMedia({ audio: true, video: { width: 1280, height: 720 } });
      setStreamEnabled(true);

      // Send offer to each peer
      const otherMembers = membersList.filter((m) => m !== userId);
      for (const peerId of otherMembers) {
        await sendOffer(peerId);
      }

      onControl('stream_started', { userId });
    } catch (err) {
      alert(`Stream error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setStreamEnabled(false);
    } finally {
      setIsLoading(false);
    }
  }, [streamEnabled, startLocalMedia, sendOffer, membersList, userId, closeAll, onControl]);

  // Toggle pause (only when streamEnabled or streamPaused changes)
  const togglePause = useCallback(() => {
    if (!streamEnabled) return;
    setStreamPaused(!streamPaused);
    onControl('stream_paused', { paused: !streamPaused, userId });
  }, [streamEnabled, streamPaused, onControl, userId]);

  // Update remote stream count (only when remoteStreams changes)
  useEffect(() => {
    setRemoteStreamCount(remoteStreams.size);
  }, [remoteStreams]);

  // Bind remote stream to video element (only when remoteStreams changes)
  useEffect(() => {
    if (!remoteVideoRef.current || remoteStreams.size === 0) return;

    const firstStream = Array.from(remoteStreams.values())[0];
    if (firstStream && remoteVideoRef.current.srcObject !== firstStream) {
      remoteVideoRef.current.srcObject = firstStream;
    }
  }, [remoteStreams]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamEnabled) {
        closeAll();
      }
    };
  }, []); // Only run on unmount

  return (
    <section className="rounded-2xl border border-border bg-[rgba(11,18,32,0.75)] p-6 shadow-glass">
      <div className="mb-3 text-sm uppercase tracking-[0.2em] text-accent">Live Stream (WebRTC)</div>

      <div className="grid gap-4 md:grid-cols-2 mb-4">
        {/* Local video preview (host only) */}
        {isHost && streamEnabled && (
          <div className="overflow-hidden rounded-xl border border-border bg-black">
            <video
              ref={localVideoRef}
              className="aspect-video w-full bg-black"
              autoPlay
              muted
              playsInline
            />
            <div className="p-2 text-center text-xs text-slate-300">Your Camera</div>
          </div>
        )}

        {/* Remote stream */}
        <div className="overflow-hidden rounded-xl border border-border bg-black">
          <video
            ref={remoteVideoRef}
            className="aspect-video w-full bg-black"
            autoPlay
            playsInline
          />
          {remoteStreamCount > 0 ? (
            <div className="p-2 text-center text-xs text-green-400">
              ✓ Connected ({remoteStreamCount} {remoteStreamCount === 1 ? 'peer' : 'peers'})
            </div>
          ) : (
            <div className="p-2 text-center text-xs text-slate-500">
              {isHost ? 'Start broadcast to show stream' : 'Waiting for host...'}
            </div>
          )}
        </div>
      </div>

      {isHost ? (
        <div className="space-y-3">
          <button
            className="w-full rounded-xl px-4 py-3 font-semibold transition text-white"
            style={{
              backgroundColor: streamEnabled ? '#ff4444' : '#22c55e',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.7 : 1
            }}
            onClick={toggleStream}
            disabled={isLoading}
          >
            {isLoading ? '📹 Connecting...' : streamEnabled ? '📹 Stop Stream' : '📹 Start Stream'}
          </button>

          {streamEnabled && (
            <>
              <button
                className="w-full rounded-xl px-4 py-3 font-semibold transition text-white"
                style={{
                  backgroundColor: streamPaused ? '#ff6666' : '#3b82f6',
                  cursor: 'pointer'
                }}
                onClick={togglePause}
              >
                {streamPaused ? '▶️ Resume' : '⏸️ Pause'}
              </button>

              <div className="rounded-xl border border-green-600 bg-green-950 p-3">
                <div className="text-sm text-green-200 text-center">
                  ✓ Broadcasting to {membersList.length - 1} {membersList.length - 1 === 1 ? 'viewer' : 'viewers'}
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="text-center">
          {remoteStreamCount > 0 ? (
            <div className="rounded-xl border border-green-600 bg-green-950 p-3">
              <div className="text-sm text-green-200">✓ Connected to stream</div>
              <div className="text-xs text-green-300 mt-1">Connection: {connectionState}</div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-slate-950 p-3">
              <div className="text-sm text-slate-400">Waiting for host to start broadcasting...</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
