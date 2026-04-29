"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { deriveTrackTitle, formatClock } from '@/lib/utils';
import { useSocket } from '@/lib/use-socket';

interface MusicSync {
  currentTime?: number;
  duration?: number;
  paused?: boolean;
  playing?: boolean;
  timestamp?: number;
  src?: string;
  trackTitle?: string;
}

interface MusicModuleProps {
  isHost: boolean;
  sync: MusicSync | any;
  onControl: (action: string, payload?: Record<string, unknown>) => void;
  channelId: string;
  userId: string;
}

export default function MusicModule({
  isHost,
  sync,
  onControl,
  channelId,
  userId
}: MusicModuleProps) {
  const { socket } = useSocket();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastAppliedRef = useRef<{ src?: string; paused?: boolean; time?: number }>({});
  const [url, setUrl] = useState('');
  const [volume, setVolume] = useState(1);
  const [uiTick, setUiTick] = useState(0);
  const [currentTime, setCurrentTime] = useState(Number(sync.currentTime || 0));
  const [trackTitle, setTrackTitle] = useState(sync.trackTitle || 'Untitled');

  // Tick for UI updates (1 second interval)
  useEffect(() => {
    const timer = setInterval(() => setUiTick((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync audio state from server - only respond to actual state changes
  useEffect(() => {
    const element = audioRef.current;
    if (!element || !sync.src) return;

    if (lastAppliedRef.current.src !== sync.src) {
      element.src = sync.src;
      element.load();
      lastAppliedRef.current.src = sync.src;
      lastAppliedRef.current.time = undefined;
    }

    const predictedTime = sync.paused
      ? Number(sync.currentTime || 0)
      : Number(sync.currentTime || 0) + (Date.now() - Number(sync.timestamp || 0)) / 1000;

    if (Math.abs((element.currentTime || 0) - predictedTime) > 2) {
      element.currentTime = Math.max(0, predictedTime);
      lastAppliedRef.current.time = predictedTime;
    }

    element.volume = volume;
    if (sync.paused) {
      if (!element.paused) {
        element.pause();
      }
      lastAppliedRef.current.paused = true;
    } else if (element.paused) {
      element.play().catch(() => undefined);
      lastAppliedRef.current.paused = false;
    }

    setCurrentTime(predictedTime);
    setTrackTitle(sync.trackTitle || deriveTrackTitle(sync.src) || 'Untitled');
  }, [sync.src, sync.currentTime, sync.duration, sync.paused, sync.timestamp, sync.trackTitle, volume]);

  const duration = useMemo(() => Number(sync.duration || 0), [sync.duration]);
  const displayTime = duration > 0 
    ? Math.min(sync.paused ? Number(sync.currentTime || 0) : currentTime, duration)
    : currentTime;
  const displayClock = useMemo(() => formatClock(displayTime), [displayTime, uiTick]);
  const displayDuration = useMemo(() => formatClock(duration), [duration, uiTick]);

  const loadTrack = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    onControl('load_track', {
      url: trimmed,
      title: deriveTrackTitle(trimmed) || 'External Track',
      sourceMode: 'url'
    });
    setUrl('');
  };

  return (
    <section className="rounded-2xl border border-border bg-[rgba(11,18,32,0.75)] p-6 shadow-glass">
      <div className="mb-3 text-sm uppercase tracking-[0.2em] text-accent">Music</div>
      <div className="mb-2 text-lg font-semibold text-text">Track: {trackTitle}</div>
      <div className="mb-2 text-sm text-muted">Status: {sync.paused ? 'Paused' : 'Playing'}</div>
      
      <audio
        ref={audioRef}
        className="hidden"
        controls={false}
        onLoadedMetadata={() => {
          if (!isHost || !audioRef.current) return;
          const duration = audioRef.current.duration;
          if (duration && Number.isFinite(duration)) {
            onControl('set_metadata', {
              duration,
              currentTime: audioRef.current.currentTime || 0,
              title: trackTitle
            });
          }
        }}
        onEnded={() => {
          if (!isHost) return;
          onControl('pause', {
            currentTime: duration,
            duration,
            paused: true,
            timestamp: Date.now()
          });
        }}
      />

      {isHost ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              className="w-full rounded-xl border border-border bg-slate-900 px-4 py-3 text-text outline-none placeholder:text-slate-500 focus:border-accent"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste audio URL (MP3, OGG, WAV)"
            />
            <button
              className="rounded-xl bg-accent px-4 py-3 font-semibold text-slate-950 transition hover:brightness-110"
              onClick={() => loadTrack()}
            >
              Load URL
            </button>
          </div>

          {/* TODO: File upload will be re-enabled once S3 bucket credentials are configured */}

          <div className="grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-center">
            <span className="text-sm text-muted">{displayClock}</span>
            <input
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800"
              type="range"
              min="0"
              max={Math.max(1, duration)}
              step="0.1"
              value={Math.min(displayTime, Math.max(1, duration))}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (audioRef.current) audioRef.current.currentTime = next;
                onControl('seek', {
                  currentTime: next,
                  duration,
                  paused: sync.paused,
                  timestamp: Date.now()
                });
              }}
            />
            <span className="text-sm text-muted">{displayDuration}</span>
          </div>

          <div className="grid gap-3 md:grid-cols-[auto_1fr] md:items-center">
            <span className="text-sm text-muted">Volume</span>
            <input
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => {
                const next = Number(e.target.value);
                setVolume(next);
                if (audioRef.current) audioRef.current.volume = next;
              }}
            />
          </div>

          <button
            className="w-full rounded-xl bg-accent px-4 py-3 font-semibold text-slate-950 transition hover:brightness-110"
            onClick={() =>
              onControl(sync.paused ? 'play' : 'pause', {
                currentTime: audioRef.current?.currentTime || 0,
                duration,
                paused: !sync.paused,
                timestamp: Date.now()
              })
            }
          >
            {sync.paused ? 'Play' : 'Pause'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-slate-950 p-4">
            <div className="mb-2 text-sm text-muted">
              {sync.src ? 'Track loaded' : 'Waiting for host to load track'}
            </div>
            <div className="text-lg font-semibold text-text">{trackTitle}</div>
            <div className="mt-2 text-sm text-muted">
              {formatClock(displayTime)} / {formatClock(duration)}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[auto_1fr] md:items-center">
            <span className="text-sm text-muted">Volume</span>
            <input
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => {
                const next = Number(e.target.value);
                setVolume(next);
                if (audioRef.current) audioRef.current.volume = next;
              }}
            />
          </div>

          <audio ref={audioRef} className="hidden" controls={false} />
        </div>
      )}
    </section>
  );
}
