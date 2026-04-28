import type { ChannelStateResponse, ChannelSummary, ChannelType, JoinResponse, RuntimeConfig } from './types';

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

  const payload = (await response.json().catch(() => null)) as T;
  if (!response.ok) {
    throw payload ?? new Error('Request failed');
  }

  return payload;
}

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  return fetchJson<RuntimeConfig>('/api/runtime-config');
}

export async function listChannels(userId: string): Promise<{ mine: ChannelSummary[]; others: ChannelSummary[] }> {
  const params = new URLSearchParams({ user_id: userId });
  return fetchJson<{ mine: ChannelSummary[]; others: ChannelSummary[] }>(`/api/channels?${params.toString()}`);
}

export async function createChannel(input: {
  userId: string;
  name: string;
  type: ChannelType;
  config: Record<string, unknown>;
}): Promise<{ channel: ChannelSummary }> {
  return fetchJson<{ channel: ChannelSummary }>('/api/channels', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function joinChannel(input: {
  channelId: string;
  userId: string;
  password?: string;
}): Promise<JoinResponse> {
  return fetchJson<JoinResponse>(`/api/channels/${input.channelId}/join`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function leaveChannel(input: { channelId: string; userId: string }): Promise<{ ok: true }> {
  return fetchJson<{ ok: true }>(`/api/channels/${input.channelId}/leave`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function closeChannel(input: { channelId: string; userId: string }): Promise<{ ok: true }> {
  return fetchJson<{ ok: true }>(`/api/channels/${input.channelId}/close`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function controlChannel(input: {
  channelId: string;
  userId: string;
  type: ChannelType;
  action: string;
  payload?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  return fetchJson<Record<string, unknown>>(`/api/channels/${input.channelId}/control`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function getChannelState(channelId: string, userId?: string): Promise<ChannelStateResponse> {
  const params = new URLSearchParams();
  if (userId) params.set('user_id', userId);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return fetchJson<ChannelStateResponse>(`/api/channels/${channelId}${suffix}`);
}

export async function ackSync(input: { channelId: string; userId: string; syncId: string }): Promise<{ ok: true }> {
  return fetchJson<{ ok: true }>(`/api/channels/${input.channelId}/sync`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}
