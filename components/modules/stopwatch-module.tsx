"use client";

import { useEffect, useMemo, useState } from 'react';

import { formatClock } from '@/lib/utils';

export interface StopwatchSync {
  running?: boolean;
  startTime?: number;
  elapsed?: number;
}

interface StopwatchModuleProps {
  isHost: boolean;
  sync: StopwatchSync;
  onControl: (action: 'start' | 'pause' | 'reset') => void;
}

export default function StopwatchModule({ isHost, sync, onControl }: StopwatchModuleProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 250);
    return () => clearInterval(timer);
  }, []);

  const elapsed = useMemo(() => {
    const base = Number(sync.elapsed || 0);
    const running = Boolean(sync.running);
    const startTime = Number(sync.startTime || 0);

    if (!running || !startTime) {
      return base;
    }

    return Math.max(base, (Date.now() - startTime) / 1000);
  }, [sync.elapsed, sync.running, sync.startTime, tick]);

  return (
    <section className="rounded-2xl border border-border bg-[rgba(11,18,32,0.75)] p-6 shadow-glass">
      <div className="mb-2 text-sm uppercase tracking-[0.2em] text-accent">Stopwatch</div>
      <div className="mb-4 text-5xl font-semibold tabular-nums text-text">{formatClock(elapsed)}</div>
      <div className="mb-4 text-sm text-muted">Status: {sync.running ? 'Running' : 'Paused'}</div>
      {isHost ? (
        <div className="flex flex-wrap gap-3">
          <button className="rounded-xl bg-accent px-4 py-2 font-semibold text-slate-950 transition hover:brightness-110" onClick={() => onControl('start')}>Start</button>
          <button className="rounded-xl border border-border px-4 py-2 font-semibold text-text transition hover:bg-white/5" onClick={() => onControl('pause')}>Pause</button>
          <button className="rounded-xl border border-border px-4 py-2 font-semibold text-text transition hover:bg-white/5" onClick={() => onControl('reset')}>Reset</button>
        </div>
      ) : null}
    </section>
  );
}
