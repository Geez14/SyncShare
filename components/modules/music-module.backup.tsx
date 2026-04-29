"use client";

import { useEffect, useMemo, useRef, useState } from 'react';

import { deriveTrackTitle, formatClock } from '@/lib/utils';
import { useSocket, uploadFileViaSocket, type FileUploadProgress } from '@/lib/use-socket';

interface MusicSync {
  currentTime?: number;
  duration?: number;
  paused?: boolean;
  playing?: boolean;
  timestamp?: number;
  src?: string;
  trackTitle?: string;
  syncId?: string;
  syncSessionId?: string;
  requiresAck?: boolean;
  syncToleranceMs?: number;
  sourceMode?: string;
  activeSourcePresent?: boolean;
  hasActiveStream?: boolean;
  startAt?: number;
  action?: string;
}

interface MusicModuleProps {
  isHost: boolean;
  sync: MusicSync | any;
  onControl: (action: string, payload?: Record<string, unknown>) => void;
  onAckSync?: (syncId: string) => void;
  channelId: string;
  userId: string;
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

async function fileToDuration(file: File): Promise<number> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve) => {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        resolve(duration);
        URL.revokeObjectURL(objectUrl);
      };
      audio.onerror = () => {
        resolve(0);
        URL.revokeObjectURL(objectUrl);
      };
      audio.src = objectUrl;
    });
  } catch {
    URL.revokeObjectURL(objectUrl);
    return 0;
  }
}

export default function MusicModule({ isHost, sync, onControl, onAckSync, channelId, userId }: MusicModuleProps) {
  const { socket } = useSocket();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState('');
  const [volume, setVolume] = useState(1);
  const [currentTick, setCurrentTick] = useState(0);
  const [currentTime, setCurrentTime] = useState(Number(sync.currentTime || 0));
  const [trackTitle, setTrackTitle] = useState(sync.trackTitle || 'Untitled');
  const [uploadProgress, setUploadProgress] = useState<FileUploadProgress | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTick((value) => value + 1), 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const element = audioRef.current;
    if (!element || !sync.src) return;

    if (element.src !== sync.src) {
      element.src = sync.src;
      element.load();
    }

    const predictedRaw = sync.paused
      ? Number(sync.currentTime || 0)
      : Number(sync.currentTime || 0) + (Date.now() - Number(sync.timestamp || Date.now())) / 1000;
    const predicted = duration > 0 ? Math.min(predictedRaw, duration) : predictedRaw;

    if (Number.isFinite(predicted) && Math.abs((element.currentTime || 0) - predicted) > 1) {
      element.currentTime = Math.max(0, predicted);
    }

    element.muted = false;
    element.volume = volume;

    if (sync.paused) {
      element.pause();
    } else {
      element.play().catch(() => undefined);
    }

    setCurrentTime(predicted);
    setTrackTitle(sync.trackTitle || deriveTrackTitle(sync.src));

    if (sync.requiresAck && (sync.syncId || sync.syncSessionId)) {
      onAckSync?.(String(sync.syncId || sync.syncSessionId));
    }
  }, [sync, currentTick, volume, onAckSync]);

  const duration = useMemo(() => Number(sync.duration || 0), [sync.duration, currentTick]);
  const displayTime = duration > 0 ? Math.min(sync.paused ? Number(sync.currentTime || 0) : currentTime, duration) : (sync.paused ? Number(sync.currentTime || 0) : currentTime);

  const loadTrack = async (file?: File | null) => {
    if (file) {
      if (!socket) {
        alert('Socket connection not ready. Please refresh the page.');
        return;
      }

      try {
        setUploadProgress({ transferId: '', totalChunks: 1, uploadedChunks: 0, filename: file.name });
        const dataUrl = await uploadFileViaSocket(socket, file, channelId, userId, (progress) => {
          setUploadProgress(progress);
        });

        const fileDuration = await fileToDuration(file);
        onControl('load_track', {
          url: dataUrl,
          title: file.name,
          sourceMode: 'local',
          duration: fileDuration,
          currentTime: 0,
          paused: true
        });
        setUrl('');
        setTrackTitle(file.name);
        setUploadProgress(null);
        return;
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Failed to upload audio');
        setUploadProgress(null);
        return;
      }
    }

    const trimmed = url.trim();
    if (!trimmed) return;
    onControl('load_track', {
      url: trimmed,
      title: deriveTrackTitle(trimmed),
      sourceMode: 'url'
    });
  };

  return (
    <section className="rounded-2xl border border-border bg-[rgba(11,18,32,0.75)] p-6 shadow-glass">
      <div className="mb-3 text-sm uppercase tracking-[0.2em] text-accent">Music</div>
      <div className="mb-2 text-lg font-semibold text-text">Current Track: {trackTitle}</div>
      <div className="mb-2 text-sm text-muted">Status: {sync.paused ? 'Paused' : 'Playing'}</div>
      <audio
        ref={audioRef}
        className="hidden"
        controls={false}
        onLoadedMetadata={() => {
          if (!isHost) return;
          const element = audioRef.current;
          if (!element) return;
          const nextDuration = Number.isFinite(element.duration) ? element.duration : duration;
          if (nextDuration > 0 && Number.isFinite(nextDuration)) {
            onControl('set_metadata', {
              duration: nextDuration,
              currentTime: Number(element.currentTime || 0),
              title: trackTitle,
              url: sync.src,
              sourceMode: sync.sourceMode || 'url'
            });
          }
        }}
        onEnded={() => {
          if (!isHost) return;
          const element = audioRef.current;
          const endedAt = Number(element?.duration || duration || 0);
          onControl('pause', {
            currentTime: endedAt,
            duration: endedAt,
            paused: true,
            timestamp: Date.now(),
            title: trackTitle,
            sourceMode: sync.sourceMode || 'url'
          });
        }}
      />

      {isHost ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input className="w-full rounded-xl border border-border bg-slate-900 px-4 py-3 text-text outline-none ring-0 placeholder:text-slate-500 focus:border-accent" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste audio URL" />
            <button className="rounded-xl bg-accent px-4 py-3 font-semibold text-slate-950 transition hover:brightness-110" onClick={() => loadTrack()}>Load URL</button>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted transition hover:border-accent hover:text-text disabled:opacity-50">
              {uploadProgress ? `Uploading: ${uploadProgress.uploadedChunks}/${uploadProgress.totalChunks}` : 'Choose Local Audio'}
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                disabled={Boolean(uploadProgress)}
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  void loadTrack(file);
                  event.target.value = '';
                }}
              />
            </label>
            <button className="rounded-xl border border-border px-4 py-3 font-semibold text-text transition hover:bg-white/5 disabled:opacity-50" disabled={Boolean(uploadProgress)} onClick={() => onControl(sync.paused ? 'play' : 'pause', {
              currentTime: Number(audioRef.current?.currentTime || 0),
              duration: Number(audioRef.current?.duration || sync.duration || 0),
              paused: !sync.paused,
              timestamp: Date.now(),
              title: trackTitle,
              sourceMode: sync.sourceMode || 'url'
            })}>{sync.paused ? 'Play' : 'Pause'}</button>
          </div>

          <div className="grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-center">
            <span className="text-sm text-muted">{formatClock(displayTime)}</span>
            <input
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800"
              type="range"
              min="0"
              max={Math.max(1, duration)}
              step="0.1"
              value={Math.min(displayTime, Math.max(1, duration))}
              onChange={(event) => {
                const next = Number(event.target.value);
                setCurrentTime(next);
                if (audioRef.current) {
                  audioRef.current.currentTime = next;
                }
                onControl('seek', {
                  currentTime: next,
                  duration,
                  paused: sync.paused,
                  timestamp: Date.now(),
                  title: trackTitle,
                  sourceMode: sync.sourceMode || 'url'
                });
              }}
            />
            <span className="text-sm text-muted">{formatClock(duration)}</span>
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
              onChange={(event) => {
                const next = Number(event.target.value);
                setVolume(next);
                if (audioRef.current) audioRef.current.volume = next;
              }}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input type="datetime-local" className="w-full rounded-xl border border-border bg-slate-900 px-4 py-3 text-text outline-none focus:border-accent" onChange={(event) => {
              const value = event.target.value;
              if (!value) return;
              const startAt = new Date(value).getTime();
              if (Number.isFinite(startAt)) {
                onControl('schedule_start', {
                  startAt,
                  currentTime: Number(audioRef.current?.currentTime || 0),
                  duration,
                  sourceMode: sync.sourceMode || 'url'
                });
              }
            }} />
            <span className="rounded-xl border border-border px-4 py-3 text-sm text-muted">Schedule start</span>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-slate-950 p-4">
            <div className="mb-2 text-sm text-muted">{sync.src ? 'Track loaded' : 'Waiting for host track'}</div>
            <div className="text-lg font-semibold text-text">{trackTitle}</div>
            <div className="mt-2 text-sm text-muted">{formatClock(displayTime)} / {formatClock(duration)}</div>
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
              onChange={(event) => {
                const next = Number(event.target.value);
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
