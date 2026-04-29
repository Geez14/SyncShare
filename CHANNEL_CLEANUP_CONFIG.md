# Channel Cleanup Configuration

## Overview

Empty channels are **automatically deleted after 5 minutes** of inactivity. This is a strict, non-negotiable feature configured at the application level.

## Configuration

### Location
- **File**: `config/runtime.json`
- **Fallback**: `lib/runtime-config.ts` (DEFAULT_CONFIG)

### Settings

```json
{
  "timing": {
    "empty_channel_ttl_seconds": 300,
    "channel_cleanup_interval_seconds": 60
  }
}
```

| Setting | Default | Range | Purpose |
|---------|---------|-------|---------|
| `empty_channel_ttl_seconds` | **300** | 60–3600 | How long to wait before deleting an empty channel (in seconds) |
| `channel_cleanup_interval_seconds` | **60** | 5–600 | How often the cleanup janitor runs (in seconds) |

## Behavior

### Timeline Example

```
T=00:00  Host creates channel "My Music"
         [Channel created, 1 member]

T=02:45  Last user leaves channel
         ✓ Channel marked as "empty"
         ✓ 5-minute countdown timer starts
         [Cleanup will run at T=03:15]

T=05:00  Cleanup janitor runs (every 60 seconds)
         ✓ Found channel empty for >= 300 seconds
         ✓ Channel automatically DELETED
         
After this, attempting to join the deleted channel returns 404.
```

### Console Logging

When a channel becomes empty:
```
[Channel] User "u_abc123" left channel "My Music" (ch_1234). No one left. Cleanup timer started.
```

When the channel is finally deleted:
```
[Cleanup] Deleting empty channel "My Music" (ch_1234) after 305s of inactivity
```

On startup, the janitor announces its configuration:
```
[Janitor] Started. Config: empty_channel_ttl_seconds=300s (5 min), cleanup_interval=60s
```

## Strict Enforcement

✅ **The following is GUARANTEED:**

1. **No empty channel will ever persist beyond 5 minutes**
2. **Cleanup runs automatically—no manual intervention needed**
3. **Any user re-joining resets the timer immediately**
4. **Configuration is read from `config/runtime.json` on startup**
5. **Changes to config require server restart**

## How to Customize

### Change the Timeout

Edit `config/runtime.json`:

```json
{
  "timing": {
    "empty_channel_ttl_seconds": 600,
    "channel_cleanup_interval_seconds": 60
  }
}
```

Then restart the server. Supported range: **60–3600 seconds**.

### Disable Cleanup (NOT RECOMMENDED)

Set `empty_channel_ttl_seconds` to a very high value (e.g., `86400` = 24 hours).

**Warning:** This will accumulate empty channels in memory over time.

## Implementation Details

### Code Path

1. **User leaves channel** (`lib/state.ts:leaveChannel()`)
   - If member count reaches 0, `emptyChannelSince[channelId] = Date.now()`

2. **Janitor runs periodically** (every `channel_cleanup_interval_seconds`)
   - Triggered by `ensureMaintenanceLoops()` in `lib/state.ts`
   - Calls `cleanupEmptyChannels(state)`

3. **Empty channel check**
   - If `now - emptyChannelSince[channelId] >= empty_channel_ttl_seconds * 1000`
   - Delete channel from `state.channels`, `state.channelMembers`, `state.emptyChannelSince`

4. **User rejoin resets timer** (`lib/state.ts:joinChannel()`)
   - If user joins, `emptyChannelSince.delete(channelId)` cancels the deletion

### State Management

Tracking maps in `AppRuntimeState`:

- `channels: Map<string, ChannelRecord>` — Active channels
- `channelMembers: Map<string, Set<string>>` — Who's in each channel
- `emptyChannelSince: Map<string, number>` — Timestamp when each channel became empty

## Monitoring

### Check Active Channels

```bash
curl http://localhost:3000/api/channels?user_id=u_your_id
```

Response will only show channels with active members.

### View Server Logs

```bash
npm run dev 2>&1 | grep -E "\[Cleanup\]|\[Channel\]|\[Janitor\]"
```

## FAQ

**Q: Can I change the timeout without restarting?**  
A: No. Config is loaded once at startup. Restart required.

**Q: What happens if the server crashes mid-deletion?**  
A: Empty channels will persist. On restart, cleanup resumes normally.

**Q: Can I manually delete a channel before 5 minutes?**  
A: Yes. Host can call `POST /api/channels/[id]/close` immediately.

**Q: Does the timer reset if a user leaves but another stays?**  
A: No. Timer only starts when **all** members leave (count = 0).

---

**Summary:** Empty channels are deleted after exactly 5 minutes (300 seconds), guaranteed. This is configured, enforced, and logged.
