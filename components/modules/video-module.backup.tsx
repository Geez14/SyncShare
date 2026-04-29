"use client";

import { useEffect, useMemo, useRef, useState } from 'react';

import { deriveTrackTitle, formatClock } from '@/lib/utils';
import { useSocket, uploadFileViaSocket, type FileUploadProgress } from '@/lib/use-socket';

interface VideoSync {
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
  action?: string;
}

interface VideoModuleProps {
  isHost: boolean;
  sync: VideoSync | any;
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
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        resolve(duration);
        URL.revokeObjectURL(objectUrl);
      };
      video.onerror = () => {
        resolve(0);
        URL.revokeObjectURL(objectUrl);
      };
      video.src = objectUrl;
    });
  } catch {
    URL.revokeObjectURL(objectUrl);
    return 0;
  }
}

function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('youtu.be') || parsed.hostname.includes('youtube.com');
  } catch {
    return false;
  }
}

function youtubeId(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.replace('/', '');
    }
    if (parsed.hostname.includes('youtube.com')) {
      return parsed.searchParams.get('v') || '';
    }
  } catch {
    return '';
  }
  return '';
}

function embedUrl(url: string, startSeconds = 0): string {
  const id = youtubeId(url);
  if (!id) return '';
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&controls=1&start=${Math.max(0, Math.floor(startSeconds))}&rel=0`;
}

export default function VideoModule({ isHost, sync, onControl, onAckSync, channelId, userId }: VideoModuleProps) {
  const { socket } = useSocket();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const lastEmbedSrcRef = useRef('');
  const lastEmbedSetAtRef = useRef(0);
  const [url, setUrl] = useState('');
  const [currentTick, setCurrentTick] = useState(0);
  const [currentTime, setCurrentTime] = useState(Number(sync.currentTime || 0));
  const [title, setTitle] = useState(sync.trackTitle || 'Untitled');
  const [uploadProgress, setUploadProgress] = useState<FileUploadProgress | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTick((value) => value + 1), 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const iframe = iframeRef.current;
    if (!sync.src) return;

    // set title (prefer explicit trackTitle, else derive from URL with hostname fallback)
    try {
      const derived = sync.trackTitle || deriveTrackTitle(String(sync.src || ''), 'Unknown');
      setTitle(derived || 'Unknown');
    } catch {
      setTitle('Unknown');
    }

    const predictedRaw = sync.paused
      ? Number(sync.currentTime || 0)
      : Number(sync.currentTime || 0) + (Date.now() - Number(sync.timestamp || Date.now())) / 1000;
    const predicted = duration > 0 ? Math.min(predictedRaw, duration) : predictedRaw;
    setCurrentTime(predicted);

    if (sync.requiresAck && (sync.syncId || sync.syncSessionId)) {
      onAckSync?.(String(sync.syncId || sync.syncSessionId));
    }

    // Handle YouTube embeds more conservatively to avoid rapid reload loops that trigger blocked network requests
    if (isYouTubeUrl(sync.src)) {
      if (iframe) {
        try {
          const embed = embedUrl(sync.src, predicted);
          const now = Date.now();
          const lastEmbed = lastEmbedSrcRef.current || '';

          // parse start seconds for comparison
          let lastStart = 0;
          let newStart = 0;
          try {
            lastStart = Number(new URL(lastEmbed).searchParams.get('start') || 0);
          } catch {}
          try {
            newStart = Number(new URL(embed).searchParams.get('start') || 0);
          } catch {}

          const shouldReload = !lastEmbed || Math.abs(newStart - lastStart) > 8 || (now - lastEmbedSetAtRef.current) > 20000 || !iframe.src.includes('youtube');
          if (shouldReload) {
            iframe.src = embed;
            lastEmbedSrcRef.current = embed;
            lastEmbedSetAtRef.current = now;
          }
        } catch {
          // ignore embed URL parsing errors
        }
      }

      if (video) video.pause();
      return;
    }

    if (!video) return;
    if (video.src !== sync.src) {
      video.src = sync.src;
      video.load();
    }

    if (Number.isFinite(predicted) && Math.abs((video.currentTime || 0) - predicted) > 1) {
      video.currentTime = Math.max(0, predicted);
    }

    if (sync.paused) {
      video.pause();
    } else {
      video.play().catch(() => undefined);
    }
  }, [sync, currentTick, onAckSync]);

  const duration = useMemo(() => Number(sync.duration || 0), [sync.duration, currentTick]);
  const displayTime = duration > 0 ? Math.min(sync.paused ? Number(sync.currentTime || 0) : currentTime, duration) : (sync.paused ? Number(sync.currentTime || 0) : currentTime);

  const loadVideo = async (file?: File | null) => {
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
        setTitle(file.name);
        setUrl('');
        setUploadProgress(null);
        return;
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Failed to upload video');
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

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) {
      onControl(sync.paused ? 'play' : 'pause', {
        currentTime: displayTime,
        duration,
        paused: !sync.paused,
        timestamp: Date.now(),
        url: sync.src,
        title
      });
      return;
    }

    if (video.paused) {
      video.play().catch(() => undefined);
      onControl('play', {
        currentTime: Number(video.currentTime || 0),
        duration: Number(video.duration || duration || 0),
        paused: false,
        timestamp: Date.now(),
        url: sync.src,
        title
      });
    } else {
      video.pause();
      onControl('pause', {
        currentTime: Number(video.currentTime || 0),
        duration: Number(video.duration || duration || 0),
        paused: true,
        timestamp: Date.now(),
        url: sync.src,
        title
      });
    }
  };

  const activeEmbed = Boolean(sync.src && isYouTubeUrl(sync.src));

  return (
    <section className="rounded-2xl border border-border bg-[rgba(11,18,32,0.75)] p-6 shadow-glass">
      <div className="mb-3 text-sm uppercase tracking-[0.2em] text-accent">Video</div>
      <div className="mb-2 text-lg font-semibold text-text">Current Media: {title}</div>
      <div className="mb-4 text-sm text-muted">{formatClock(displayTime)} / {formatClock(duration)}</div>

      {isHost ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input className="w-full rounded-xl border border-border bg-slate-900 px-4 py-3 text-text outline-none focus:border-accent" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste video or YouTube URL" />
            <button className="rounded-xl bg-accent px-4 py-3 font-semibold text-slate-950 transition hover:brightness-110" onClick={() => loadVideo()}>Load Video</button>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted transition hover:border-accent hover:text-text disabled:opacity-50">
              {uploadProgress ? `Uploading: ${uploadProgress.uploadedChunks}/${uploadProgress.totalChunks}` : 'Choose Local Video'}
              <input
                type="file"
                accept="video/*"
                className="hidden"
                disabled={Boolean(uploadProgress)}
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  void loadVideo(file);
                  event.target.value = '';
                }}
              />
            </label>
            <button className="rounded-xl border border-border px-4 py-3 font-semibold text-text transition hover:bg-white/5 disabled:opacity-50" disabled={Boolean(uploadProgress)} onClick={togglePlayback}>{sync.paused ? 'Play' : 'Pause'}</button>
          </div>

          <div className="grid gap-3 md:grid-cols-[auto_1fr] md:items-center">
            <span className="text-sm text-muted">Seek</span>
            <input
              type="range"
              min="0"
              max={Math.max(1, duration)}
              step="0.1"
              value={Math.min(displayTime, Math.max(1, duration))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800"
              onChange={(event) => {
                const next = Number(event.target.value);
                if (videoRef.current) {
                  videoRef.current.currentTime = next;
                }
                onControl('seek', {
                  currentTime: next,
                  duration,
                  paused: sync.paused,
                  timestamp: Date.now(),
                  url: sync.src,
                  title
                });
              }}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-border bg-black">
            {activeEmbed ? (
              <iframe ref={iframeRef} className="aspect-video w-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
            ) : (
              <video
                ref={videoRef}
                className="aspect-video w-full bg-black"
                playsInline
                controls={false}
                muted={false}
                onLoadedMetadata={() => {
                  if (!isHost) return;
                  const element = videoRef.current;
                  if (!element) return;
                  const nextDuration = Number.isFinite(element.duration) ? element.duration : duration;
                  if (nextDuration > 0 && Number.isFinite(nextDuration)) {
                    onControl('set_metadata', {
                      duration: nextDuration,
                      currentTime: Number(element.currentTime || 0),
                      title,
                      url: sync.src,
                      sourceMode: sync.sourceMode || 'url'
                    });
                  }
                }}
                onEnded={() => {
                  if (!isHost) return;
                  const element = videoRef.current;
                  const endedAt = Number(element?.duration || duration || 0);
                  onControl('pause', {
                    currentTime: endedAt,
                    duration: endedAt,
                    paused: true,
                    timestamp: Date.now(),
                    url: sync.src,
                    title,
                    sourceMode: sync.sourceMode || 'url'
                  });
                }}
              />
            )}
          </div>
          <div className="text-sm text-muted">Viewer mode: host controls playback. Local controls are disabled.</div>
        </div>
      )}

      {!isHost ? null : (
        <video
          ref={videoRef}
          className="hidden"
          playsInline
          controls={false}
          muted={false}
          onLoadedMetadata={() => {
            if (!isHost) return;
            const element = videoRef.current;
            if (!element) return;
            const nextDuration = Number.isFinite(element.duration) ? element.duration : duration;
            if (nextDuration > 0 && Number.isFinite(nextDuration)) {
              onControl('set_metadata', {
                duration: nextDuration,
                currentTime: Number(element.currentTime || 0),
                title,
                url: sync.src,
                sourceMode: sync.sourceMode || 'url'
              });
            }
          }}
          onEnded={() => {
            if (!isHost) return;
            const element = videoRef.current;
            const endedAt = Number(element?.duration || duration || 0);
            onControl('pause', {
              currentTime: endedAt,
              duration: endedAt,
              paused: true,
              timestamp: Date.now(),
              url: sync.src,
              title,
              sourceMode: sync.sourceMode || 'url'
            });
          }}
        />
      )}
    </section>
  );
}
