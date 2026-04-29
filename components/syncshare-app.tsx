"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import ChannelRoom from '@/components/channel-room';
import { ackSync, closeChannel, controlChannel, createChannel, getChannelState, getRuntimeConfig, joinChannel, leaveChannel, listChannels } from '@/lib/client-api';
import type { ChannelStateResponse, ChannelSummary, ChannelType, RuntimeConfig } from '@/lib/types';
import { channelTypeLabel, filterChannels, uid } from '@/lib/utils';

const CHANNEL_TYPES: ChannelType[] = ['stopwatch', 'music', 'video', 'voice'];

export default function SyncShareApp() {
  const [userId, setUserId] = useState('');
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [mine, setMine] = useState<ChannelSummary[]>([]);
  const [others, setOthers] = useState<ChannelSummary[]>([]);
  const [room, setRoom] = useState<ChannelStateResponse | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | ChannelType>('all');
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState<ChannelType>('stopwatch');
  const [createPrivate, setCreatePrivate] = useState(false);
  const [createPasscode, setCreatePasscode] = useState('');

  const [passcodeOpen, setPasscodeOpen] = useState(false);
  const [passcodeValue, setPasscodeValue] = useState('');
  const [pendingJoin, setPendingJoin] = useState<ChannelSummary | null>(null);

  const [closeOpen, setCloseOpen] = useState(false);
  const lobbyTimer = useRef<number | null>(null);
  const roomTimer = useRef<number | null>(null);
  const LOBBY_REFRESH_MS = 10_000;
  const ROOM_REFRESH_MS = 5_000;

  const filteredMine = useMemo(() => filterChannels(mine, search, typeFilter), [mine, search, typeFilter]);
  const filteredOthers = useMemo(() => filterChannels(others, search, typeFilter), [others, search, typeFilter]);

  async function refreshLobby() {
    if (!userId || room) return;
    try {
      const payload = await listChannels(userId);
      setMine(payload.mine || []);
      setOthers(payload.others || []);
    } catch {
      // Keep polling quiet when the app is booting.
    }
  }

  async function refreshRoomState(channelId = room?.channel.id) {
    if (!userId || !channelId) return;
    try {
      const payload = await getChannelState(channelId, userId);
      setRoom(payload);
    } catch (error) {
      setRoom(null);
      toast.error('Channel ended or is unavailable.');
      void refreshLobby();
    }
  }

  useEffect(() => {
    const stored = localStorage.getItem('syncshare_uid');
    const nextUserId = stored || uid();
    localStorage.setItem('syncshare_uid', nextUserId);
    setUserId(nextUserId);

    void (async () => {
      try {
        const config = await getRuntimeConfig();
        setRuntimeConfig(config);
      } catch {
        setRuntimeConfig(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!userId) return;

    void refreshLobby();
    if (lobbyTimer.current) {
      window.clearInterval(lobbyTimer.current);
    }

    if (!room) {
      lobbyTimer.current = window.setInterval(() => {
        void refreshLobby();
      }, LOBBY_REFRESH_MS);
    }

    return () => {
      if (lobbyTimer.current) {
        window.clearInterval(lobbyTimer.current);
        lobbyTimer.current = null;
      }
    };
  }, [userId, room]);

  useEffect(() => {
    if (!room) {
      if (roomTimer.current) {
        window.clearInterval(roomTimer.current);
        roomTimer.current = null;
      }
      return;
    }

    void refreshRoomState(room.channel.id);
    if (roomTimer.current) {
      window.clearInterval(roomTimer.current);
    }
    roomTimer.current = window.setInterval(() => {
      void refreshRoomState(room.channel.id);
    }, ROOM_REFRESH_MS);

    return () => {
      if (roomTimer.current) {
        window.clearInterval(roomTimer.current);
        roomTimer.current = null;
      }
    };
  }, [room?.channel.id, userId]);

  async function openChannel(channel: ChannelSummary, password?: string) {
    try {
      const join = await joinChannel({ channelId: channel.id, userId, password });
      if ('channel' in join) {
        const nextRoom = await getChannelState(channel.id, userId);
        setRoom(nextRoom);
        setPasscodeOpen(false);
        setPendingJoin(null);
        setPasscodeValue('');
        setCreateOpen(false);
        toast.success(`Joined ${channel.name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to join channel.';
      toast.error(message);
    }
  }

  async function handleCreate() {
    try {
      const channel = await createChannel({
        userId,
        name: createName.trim() || 'Untitled Channel',
        type: createType,
        config: {
          private: createPrivate,
          passcode: createPasscode.trim()
        }
      });

      setCreateOpen(false);
      setCreateStep(1);
      setCreateName('');
      setCreatePrivate(false);
      setCreatePasscode('');

      await openChannel(channel.channel, createPasscode.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create channel.';
      toast.error(message);
    }
  }

  function startRoomFlow(channel: ChannelSummary) {
    if (channel.full) {
      toast.error('This room is full.');
      return;
    }

    if (channel.passcodeRequired) {
      setPendingJoin(channel);
      setPasscodeOpen(true);
      setPasscodeValue('');
      return;
    }

    void openChannel(channel, '');
  }

  async function submitPasscode() {
    if (!pendingJoin) return;
    const value = passcodeValue.trim();
    if (!value) {
      toast.error('Passcode is required.');
      return;
    }

    await openChannel(pendingJoin, value);
  }

  async function handleLeave() {
    if (!room) return;
    try {
      await leaveChannel({ channelId: room.channel.id, userId });
    } finally {
      setRoom(null);
      setPendingJoin(null);
      await refreshLobby();
    }
  }

  async function handleClose() {
    if (!room) return;
    try {
      await closeChannel({ channelId: room.channel.id, userId });
      toast.success('Channel closed.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to close channel.');
    } finally {
      setRoom(null);
      await refreshLobby();
    }
  }

  async function handleControl(action: string, payload?: Record<string, unknown>) {
    if (!room) return;

    try {
      const result = await controlChannel({
        channelId: room.channel.id,
        userId,
        type: room.channel.type,
        action,
        payload
      });

      setRoom((current) => {
        if (!current) return current;
        return {
          ...current,
          sync: result
        };
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed.');
    }
  }

  async function handleAckSync(syncId: string) {
    if (!room || !syncId) return;
    try {
      await ackSync({ channelId: room.channel.id, userId, syncId });
    } catch {
      // best effort only
    }
  }

  const brandLimit = runtimeConfig?.channel_entry_limits?.[room?.channel.type || 'stopwatch'] ?? null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 md:px-6 lg:px-8">
      <header className="top-4 z-20 mb-6 rounded-2xl border border-border bg-[rgba(17,26,46,0.8)] px-4 py-4 shadow-glass backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-2xl font-bold text-accent">SyncShare</div>
            <div className="text-sm text-muted">Live Collaboration</div>
          </div>
          <div className="rounded-full border border-border bg-slate-950/70 px-4 py-2 text-sm text-muted">
            User: <span className="font-semibold text-text">{userId || 'loading...'}</span>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="grid flex-1 place-items-center rounded-3xl border border-border bg-panel/80 p-12 text-muted shadow-glass">
          Loading runtime configuration...
        </div>
      ) : room ? (
        <div className="space-y-4">
          <ChannelRoom
            room={room}
            userId={userId}
            onLeave={() => {
              void handleLeave();
            }}
            onClose={() => setCloseOpen(true)}
            onControl={(action, payload) => {
              void handleControl(action, payload);
            }}
            onAckSync={(syncId) => {
              void handleAckSync(syncId);
            }}
          />
          <div className="rounded-2xl border border-border bg-[rgba(11,18,32,0.75)] px-4 py-3 text-sm text-muted">
            Active channel limit: {brandLimit ?? 'unlimited'}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-3xl border border-border bg-panel p-4 shadow-glass md:p-5">
            <div className="grid gap-3 md:grid-cols-[1.5fr_0.8fr_auto]">
              <input className="rounded-xl border border-border bg-slate-900 px-4 py-3 text-text outline-none focus:border-accent" placeholder="Search channels by name" value={search} onChange={(event) => setSearch(event.target.value)} />
              <select className="rounded-xl border border-border bg-slate-900 px-4 py-3 text-text outline-none focus:border-accent" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'all' | ChannelType)}>
                <option value="all">All types</option>
                {CHANNEL_TYPES.map((type) => (
                  <option key={type} value={type}>{channelTypeLabel(type)}</option>
                ))}
              </select>
              <button className="rounded-xl bg-accent px-5 py-3 font-semibold text-slate-950 transition hover:brightness-110" onClick={() => {
                setCreateStep(1);
                setCreateOpen(true);
              }}>Create Channel</button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-3xl border border-border bg-panel p-5 shadow-glass">
              <h2 className="mb-4 text-lg font-semibold text-accent">My Channels</h2>
              <div className="space-y-3">
                {filteredMine.length ? filteredMine.map((channel) => (
                  <article key={channel.id} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-[rgba(11,18,32,0.65)] p-4">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-text">{channel.name}</div>
                      <div className="text-sm text-muted">#{channel.id} · {channelTypeLabel(channel.type)} · {channel.watching}{channel.capacity ? `/${channel.capacity}` : ''} watching</div>
                    </div>
                    <button className="rounded-xl bg-accent px-4 py-2 font-semibold text-slate-950 transition hover:brightness-110" onClick={() => startRoomFlow(channel)} disabled={channel.full}>
                      {channel.full ? 'Full' : 'Join'}
                    </button>
                  </article>
                )) : (
                  <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted">No channels owned by you.</div>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-border bg-panel p-5 shadow-glass">
              <h2 className="mb-4 text-lg font-semibold text-accent">Public Channels</h2>
              <div className="space-y-3">
                {filteredOthers.length ? filteredOthers.map((channel) => (
                  <article key={channel.id} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-[rgba(11,18,32,0.65)] p-4">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-text">{channel.name}</div>
                      <div className="text-sm text-muted">#{channel.id} · {channelTypeLabel(channel.type)} · {channel.passcodeRequired ? 'Passcode' : 'Open'} · {channel.watching}{channel.capacity ? `/${channel.capacity}` : ''} watching</div>
                    </div>
                    <button className="rounded-xl border border-border px-4 py-2 font-semibold text-text transition hover:bg-white/5" onClick={() => startRoomFlow(channel)} disabled={channel.full}>
                      {channel.full ? 'Full' : 'Join'}
                    </button>
                  </article>
                )) : (
                  <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted">No public channels found.</div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {createOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl border border-border bg-[rgba(17,26,46,0.96)] p-6 shadow-glass">
            {createStep === 1 ? (
              <>
                <h3 className="text-xl font-semibold text-text">Create Channel: Step 1</h3>
                <div className="mt-5 space-y-4">
                  <div>
                    <label className="mb-2 block text-sm text-muted">Name</label>
                    <input className="w-full rounded-xl border border-border bg-slate-900 px-4 py-3 text-text outline-none focus:border-accent" value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="My Sync Channel" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-muted">Type</label>
                    <select className="w-full rounded-xl border border-border bg-slate-900 px-4 py-3 text-text outline-none focus:border-accent" value={createType} onChange={(event) => setCreateType(event.target.value as ChannelType)}>
                      {CHANNEL_TYPES.map((type) => <option key={type} value={type}>{channelTypeLabel(type)}</option>)}
                    </select>
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button className="rounded-xl border border-border px-4 py-2 font-semibold text-text transition hover:bg-white/5" onClick={() => {
                    setCreateOpen(false);
                    setCreateStep(1);
                  }}>Cancel</button>
                  <button className="rounded-xl bg-accent px-4 py-2 font-semibold text-slate-950 transition hover:brightness-110" onClick={() => setCreateStep(2)}>Next</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-xl font-semibold text-text">Create Channel: Step 2</h3>
                <div className="mt-5 space-y-4">
                  <label className="flex items-center gap-3 rounded-2xl border border-border bg-slate-950 px-4 py-3 text-sm text-text">
                    <input type="checkbox" checked={createPrivate} onChange={(event) => setCreatePrivate(event.target.checked)} />
                    Private Channel
                  </label>
                  <div>
                    <label className="mb-2 block text-sm text-muted">Passcode (optional)</label>
                    <input className="w-full rounded-xl border border-border bg-slate-900 px-4 py-3 text-text outline-none focus:border-accent" value={createPasscode} onChange={(event) => setCreatePasscode(event.target.value)} placeholder="Set passcode" />
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button className="rounded-xl border border-border px-4 py-2 font-semibold text-text transition hover:bg-white/5" onClick={() => setCreateStep(1)}>Back</button>
                  <button className="rounded-xl border border-border px-4 py-2 font-semibold text-text transition hover:bg-white/5" onClick={() => {
                    setCreateOpen(false);
                    setCreateStep(1);
                  }}>Cancel</button>
                  <button className="rounded-xl bg-accent px-4 py-2 font-semibold text-slate-950 transition hover:brightness-110" onClick={() => void handleCreate()}>Create</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {passcodeOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-border bg-[rgba(17,26,46,0.96)] p-6 shadow-glass">
            <h3 className="text-xl font-semibold text-text">Enter Channel Passcode</h3>
            <p className="mt-2 text-sm text-muted">This channel is protected. Enter the access code to continue.</p>
            <div className="mt-5">
              <input
                className="w-full rounded-xl border border-border bg-slate-900 px-4 py-3 text-text outline-none focus:border-accent"
                type="password"
                autoComplete="off"
                value={passcodeValue}
                onChange={(event) => setPasscodeValue(event.target.value)}
                placeholder="Passcode"
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button className="rounded-xl border border-border px-4 py-2 font-semibold text-text transition hover:bg-white/5" onClick={() => {
                setPasscodeOpen(false);
                setPendingJoin(null);
              }}>Cancel</button>
              <button className="rounded-xl bg-accent px-4 py-2 font-semibold text-slate-950 transition hover:brightness-110" onClick={() => void submitPasscode()}>Join</button>
            </div>
          </div>
        </div>
      ) : null}

      {closeOpen && room ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-border bg-[rgba(17,26,46,0.96)] p-6 shadow-glass">
            <h3 className="text-xl font-semibold text-text">Close Channel</h3>
            <p className="mt-2 text-sm text-muted">This will immediately disconnect all viewers and end the session for everyone.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button className="rounded-xl border border-border px-4 py-2 font-semibold text-text transition hover:bg-white/5" onClick={() => setCloseOpen(false)}>Cancel</button>
              <button className="rounded-xl bg-danger px-4 py-2 font-semibold text-white transition hover:brightness-110" onClick={() => {
                setCloseOpen(false);
                void handleClose();
              }}>Yes, Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
