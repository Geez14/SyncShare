import type { ChannelStateResponse, ChannelSummary, ChannelType, JoinResponse, RuntimeConfig } from './types';

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

  const payload = (await response.json().catch(() => null)) as T | null;

  if (!response.ok) {
    if (response.status === 413) {
      throw new Error('Request too large. Try uploading the file to an external host or use a smaller file.');
    }
    if (response.status === 403) {
      throw new Error('Unauthorized. Your session may have expired. Please rejoin the channel.');
    }
    if (response.status === 404) {
      throw new Error('Not found. The channel or resource may have been removed.');
    }

    // Fall back to any JSON error payload, or a generic message
    throw (payload as unknown) ?? new Error('Request failed');
  }

  return payload as T;
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
