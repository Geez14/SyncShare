"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { deriveTrackTitle, formatClock } from '@/lib/utils';
import { useSocket } from '@/lib/use-socket';

interface VideoSync {
  currentTime?: number;
  duration?: number;
  paused?: boolean;
  playing?: boolean;
  timestamp?: number;
  src?: string;
  trackTitle?: string;
}

interface VideoModuleProps {
  isHost: boolean;
  sync: VideoSync | any;
  onControl: (action: string, payload?: Record<string, unknown>) => void;
  channelId: string;
  userId: string;
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

export default function VideoModule({
  isHost,
  sync,
  onControl,
  channelId,
  userId
}: VideoModuleProps) {
  const { socket } = useSocket();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastAppliedRef = useRef<{ src?: string; paused?: boolean; time?: number }>({});
  const lastEmbedSrcRef = useRef('');
  const lastEmbedSetAtRef = useRef(0);
  const [url, setUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uiTick, setUiTick] = useState(0);
  const [currentTime, setCurrentTime] = useState(Number(sync.currentTime || 0));
  const [title, setTitle] = useState(sync.trackTitle || 'Untitled');

  // Tick for UI updates (1 second interval) - NO dependency issues here
  useEffect(() => {
    const timer = setInterval(() => setUiTick((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync video state from server - only respond to actual state changes
  useEffect(() => {
    const video = videoRef.current;
    const iframe = iframeRef.current;
    if (!sync.src) return;

    setTitle(sync.trackTitle || deriveTrackTitle(sync.src) || 'Unknown Video');

    const predictedTime = sync.paused
      ? Number(sync.currentTime || 0)
      : Number(sync.currentTime || 0) + (Date.now() - Number(sync.timestamp || 0)) / 1000;

    setCurrentTime(predictedTime);

    // Handle YouTube embeds
    if (isYouTubeUrl(sync.src)) {
      if (iframe) {
        const embed = embedUrl(sync.src, predictedTime);
        const now = Date.now();
        const lastEmbed = lastEmbedSrcRef.current || '';

        let lastStart = 0,
          newStart = 0;
        try {
          lastStart = Number(new URL(lastEmbed).searchParams.get('start') || 0);
        } catch {}
        try {
          newStart = Number(new URL(embed).searchParams.get('start') || 0);
        } catch {}

        const shouldReload =
          !lastEmbed || Math.abs(newStart - lastStart) > 8 || now - lastEmbedSetAtRef.current > 20000 || !iframe.src.includes('youtube');
        if (shouldReload) {
          iframe.src = embed;
          lastEmbedSrcRef.current = embed;
          lastEmbedSetAtRef.current = now;
        }
      }
      if (video) video.pause();
      return;
    }

    // Handle direct video playback
    if (!video) return;
    if (lastAppliedRef.current.src !== sync.src) {
      video.src = sync.src;
      video.load();
      lastAppliedRef.current.src = sync.src;
      lastAppliedRef.current.time = undefined;
    }

    if (Math.abs((video.currentTime || 0) - predictedTime) > 2) {
      video.currentTime = Math.max(0, predictedTime);
      lastAppliedRef.current.time = predictedTime;
    }

    if (sync.paused) {
      if (!video.paused) {
        video.pause();
      }
      lastAppliedRef.current.paused = true;
    } else if (video.paused) {
      video.play().catch(() => undefined);
      lastAppliedRef.current.paused = false;
    }
  }, [sync.src, sync.currentTime, sync.duration, sync.paused, sync.timestamp, sync.trackTitle]);

  const duration = useMemo(() => Number(sync.duration || 0), [sync.duration]);
  const displayTime = duration > 0 ? Math.min(sync.paused ? Number(sync.currentTime || 0) : currentTime, duration) : currentTime;
  const displayClock = useMemo(() => formatClock(displayTime), [displayTime, uiTick]);
  const displayDuration = useMemo(() => formatClock(duration), [duration, uiTick]);

  const loadVideo = async (file?: File | null) => {
    if (file) {
      // Upload file to server
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`/api/channels/${channelId}/upload`, {
          method: 'POST',
          body: formData
        });

        if (!res.ok) {
          const error = await res.json();
          alert(`Upload failed: ${error.error}`);
          return;
        }

        const data = await res.json();
        onControl('load_track', {
          url: data.url,
          title: deriveTrackTitle(data.filename) || 'Uploaded Video',
          sourceMode: 'upload'
        });
      } catch {
        alert('Upload failed. Make sure your file is under 100MB.');
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
      return;
    }

    const trimmed = url.trim();
    if (!trimmed) return;

    onControl('load_track', {
      url: trimmed,
      title: deriveTrackTitle(trimmed) || 'External Video',
      sourceMode: 'url'
    });
    setUrl('');
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    onControl(sync.paused ? 'play' : 'pause', {
      currentTime: video?.currentTime || displayTime,
      duration,
      paused: !sync.paused,
      timestamp: Date.now()
    });
  };

  const activeEmbed = Boolean(sync.src && isYouTubeUrl(sync.src));

  return (
    <section className="rounded-2xl border border-border bg-[rgba(11,18,32,0.75)] p-6 shadow-glass">
      <div className="mb-3 text-sm uppercase tracking-[0.2em] text-accent">Video</div>
      <div className="mb-2 text-lg font-semibold text-text">Media: {title}</div>
      <div className="mb-4 text-sm text-muted">
        {displayClock} / {displayDuration}
      </div>

      {isHost ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              className="w-full rounded-xl border border-border bg-slate-900 px-4 py-3 text-text outline-none focus:border-accent"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste video or YouTube URL"
            />
            <button
              className="rounded-xl bg-accent px-4 py-3 font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-50"
              onClick={() => loadVideo()}
              disabled={isUploading}
            >
              Load Video
            </button>
          </div>

          <div className="flex gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) loadVideo(file);
              }}
              disabled={isUploading}
            />
            <button
              className="rounded-xl bg-slate-800 px-4 py-3 font-semibold text-text transition hover:bg-slate-700 disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? 'Uploading...' : 'Upload Video'}
            </button>
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
              onChange={(e) => {
                const next = Number(e.target.value);
                if (videoRef.current) videoRef.current.currentTime = next;
                onControl('seek', {
                  currentTime: next,
                  duration,
                  paused: sync.paused,
                  timestamp: Date.now()
                });
              }}
            />
          </div>

          <button
            className="w-full rounded-xl bg-accent px-4 py-3 font-semibold text-slate-950 transition hover:brightness-110"
            onClick={togglePlayback}
          >
            {sync.paused ? 'Play' : 'Pause'}
          </button>
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
                  if (!isHost && videoRef.current) {
                    const duration = videoRef.current.duration;
                    if (duration && Number.isFinite(duration)) {
                      onControl('set_metadata', {
                        duration,
                        currentTime: videoRef.current.currentTime || 0,
                        title
                      });
                    }
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
            )}
          </div>
          <div className="text-sm text-muted">Viewer mode: host controls playback.</div>
        </div>
      )}

      {isHost && !activeEmbed ? (
        <video
          ref={videoRef}
          className="hidden"
          playsInline
          controls={false}
          muted={false}
          onLoadedMetadata={() => {
            if (videoRef.current) {
              const duration = videoRef.current.duration;
              if (duration && Number.isFinite(duration)) {
                onControl('set_metadata', {
                  duration,
                  currentTime: videoRef.current.currentTime || 0,
                  title
                });
              }
            }
          }}
          onEnded={() => {
            onControl('pause', {
              currentTime: duration,
              duration,
              paused: true,
              timestamp: Date.now()
            });
          }}
        />
      ) : null}
    </section>
  );
}
