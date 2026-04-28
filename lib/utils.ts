import type { ChannelSummary, ChannelType } from './types';

export function formatClock(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  const parts = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .filter((value, index) => value !== '00' || index > 0);

  return parts.length ? parts.join(':') : '00:00';
}

export function channelTypeLabel(type: ChannelType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function normalizeFilterName(value: string): string {
  return value.trim().toLowerCase();
}

export function filterChannels(channels: ChannelSummary[], nameFilter: string, typeFilter: string): ChannelSummary[] {
  const needle = normalizeFilterName(nameFilter);
  return channels.filter((channel) => {
    const nameOk = !needle || channel.name.toLowerCase().includes(needle);
    const typeOk = typeFilter === 'all' ? true : channel.type === typeFilter;
    return nameOk && typeOk;
  });
}

export function uid(): string {
  return `u_${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveTrackTitle(url: string, fallback = 'External Track'): string {
  const normalized = String(url || '').trim();
  if (!normalized) return fallback;
  if (normalized.startsWith('local://')) {
    const localName = normalized.replace('local://', '').trim();
    return localName || fallback;
  }

  try {
    const parsed = new URL(normalized);
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
    if (lastSegment) return lastSegment;
    // fallback to hostname when path segment isn't available (e.g., site root or short URLs)
    if (parsed.hostname) return parsed.hostname.replace('www.', '') || fallback;
    return fallback;
  } catch {
    return fallback;
  }
}
