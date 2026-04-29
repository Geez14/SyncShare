# SyncShare — Next.js Frontend

A real-time media synchronization platform built with **Next.js 15** (App Router) and **TypeScript**. Allows a host to share media playback (music, video, stopwatch, voice) with multiple clients in real-time.

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ (with npm)
- **Next.js** 15.5.15
- Backend running (Flask server on `http://localhost:5000`)

### Install & Run

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Build for production
npm run build

# Start production server
npm run start

# Run type checking & linting
npm run type-check
npm run lint
```

The app will be available at **http://localhost:3000**.

---

## 📁 Project Structure

```
├── app/                          # Next.js App Router
│   ├── api/
│   │   └── channels/             # API routes for channel/media control
│   │       └── [channelId]/
│   │           ├── control/      # POST endpoint for media actions
│   │           ├── sync/         # GET endpoint for state snapshots
│   │           └── join/         # POST endpoint for joining
│   └── page.tsx                  # Root page
│
├── components/
│   ├── modules/                  # Media-type modules
│   │   ├── music-module.tsx      # Music playback (host: full control, joinee: volume only)
│   │   ├── video-module.tsx      # Video playback (URL, YouTube, local file)
│   │   ├── stopwatch-module.tsx  # Stopwatch/timer
│   │   └── voice-module.tsx      # Voice chat roster
│   ├── ui/
│   │   ├── channel-join.tsx      # Join flow UI
│   │   ├── control-panel.tsx     # Host control panel
│   │   └── status-display.tsx    # Sync status & diagnostics
│   └── syncshare-app.tsx         # Main app container
│
├── lib/
│   ├── state.ts                  # In-memory channel & media state store
│   ├── types.ts                  # TypeScript interfaces
│   ├── runtime-config.ts         # Config loading from backend
│   └── utils.ts                  # Formatting, helpers, title derivation
│
├── config/
│   └── runtime.json              # Runtime configuration (loaded from backend)
│
├── tailwind.config.ts            # Tailwind CSS config
├── tsconfig.json                 # TypeScript config
└── package.json                  # Dependencies & scripts
```

---

## 🏗️ Architecture

### State Management

**In-Memory Store** ([lib/state.ts](lib/state.ts))

- Centralized channel/media state using `Map<string, Channel>`
- Server-authoritative media snapshots via `buildMediaSnapshot()`
- Auto-maintenance loops:
  - **Media tick** (~1s): advances playback time, clamps at duration
  - **Cleanup janitor** (~60s): removes empty/expired channels

**Per-Channel State**

```typescript
interface Channel {
  id: string;
  hostId: string;
  createdAt: number;
  media: {
    [moduleType: string]: Media;  // 'music', 'video', 'stopwatch', 'voice'
  };
  voiceRoster: Set<string>;
}

interface Media {
  playing: boolean;
  currentTime: number;
  duration: number;
  title: string;
  url?: string;
  sourceMode?: 'url' | 'youtube' | 'local';
  paused?: boolean;
}
```

### API Routes

All routes live under [app/api/channels/](app/api/channels):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `[channelId]/sync` | GET | Fetch latest channel state snapshot |
| `[channelId]/join` | POST | Add user to channel roster |
| `[channelId]/leave` | POST | Remove user from channel roster |
| `[channelId]/control` | POST | Execute media action (play, pause, seek, load track, etc.) |

**Control Actions**

Supported actions in `POST control`:

- `play` — Start or resume playback
- `pause` — Pause with optional currentTime
- `seek` — Jump to specific time
- `load_track` — Load new media (URL, YouTube ID, or local file data)
- `schedule_start` — Schedule playback at future time
- `set_metadata` — Update duration/title without playback reset
- `start_voice` — Add to voice roster
- `stop_voice` — Remove from voice roster

### Components

**Media Modules** ([components/modules/](components/modules))

Each module handles its own UI and event emission:

- **Music Module** ([music-module.tsx](components/modules/music-module.tsx))
  - Host: File upload, play/pause, seek, schedule start
  - Joinee: Volume slider only
  - Supports MP3, WAV, OGG, FLAC (via HTML5 Audio)
  - Extracts duration from uploaded files

- **Video Module** ([video-module.tsx](components/modules/video-module.tsx))
  - Host: URL input, file upload, YouTube ID input, play/pause, seek
  - Joinee: View-only with audio (no manual controls)
  - YouTube: Embed via `youtube-nocookie.com` with conservative reload logic
  - Local files: Plays from blob URL
  - Extracts duration from uploaded files

- **Stopwatch Module** ([stopwatch-module.tsx](components/modules/stopwatch-module.tsx))
  - Simple timer: start, pause, reset
  - Host controls; joinee views

- **Voice Module** ([voice-module.tsx](components/modules/voice-module.tsx))
  - Roster of active speakers
  - Join/leave voice toggle
  - Real-time presence updates

### Client-Server Sync

**Polling Model**

- Clients poll `GET /api/channels/[id]/sync` every ~250ms
- Server returns authoritative media state + voice roster
- Client displays received state without local correction

**Host Media Handlers**

Media elements emit:

- `onLoadedMetadata`: Broadcasts real duration (new `set_metadata` action)
- `onEnded`: Auto-pauses and syncs end-of-media state

This ensures accurate duration tracking and prevents timers from advancing past media end.

---

## 🎵 Media Features

### Music Module

**Host Actions**

- File Upload: Select local audio → extracts duration → loads on all clients
- Play/Pause/Seek: Control playback globally
- Schedule Start: Queue playback to start at specific time

**Joinee View**

- Volume slider only (no seek/play controls)
- Receives real-time playback updates

**Metadata Extraction**

```typescript
async function fileToDuration(file: File): Promise<number> {
  const audio = new Audio();
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    };
    audio.src = url;
  });
}
```

### Video Module

**Host Actions**

- URL Input: Paste direct video URL
- YouTube: Paste video ID → auto-embeds
- File Upload: Select local video
- Play/Pause/Seek: Control globally

**Joinee View**

- Direct video (`<video>`) or YouTube embed (no audio mute)
- View-only (no controls)

**Duration & End-State Handling**

- `onLoadedMetadata`: Syncs real file duration to server
- `onEnded`: Broadcasts auto-pause at exactly media duration
- Joined video displays clamped to duration: `Math.min(predictedTime, duration)`

**YouTube Optimization**

- Removed `mute=1` flag (was silencing autoplay)
- Conservative embed reload:
  - Only reload if start time drifted >8s, or >20s since last set, or iframe disappeared
  - Prevents adblocker spam (`ERR_BLOCKED_BY_CLIENT`)

**Title Fallback**

URLs must have meaningful titles:

```typescript
function deriveTrackTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
    if (lastSegment) return lastSegment;
    if (parsed.hostname) return parsed.hostname.replace('www.', '') || 'Unknown';
    return 'Unknown';
  } catch {
    return 'Unknown';
  }
}
```

---

## ⚙️ Configuration

**Runtime Config** ([config/runtime.json](config/runtime.json))

```json
{
  "channel_entry_limits": {
    "stopwatch": 20,
    "music": 5,
    "video": 3,
    "voice": 10
  },
  "timing": {
    "stopwatch_tick_seconds": 0.1,
    "min_schedule_lead_ms": 500,
    "channel_cleanup_interval_seconds": 60,
    "empty_channel_ttl_seconds": 3600
  }
}
```

Loaded at app startup. Adjust limits based on capacity and use case.

---

## 🔄 Sync Model

### Server Authority

- Server computes media time: `currentTime = startedAtMs ? (now - baseTimeMs) / 1000 : 0`
- Server clamps time: `currentTime = Math.min(currentTime, duration)` (never past end)
- Server auto-pauses if end reached: `if (ended) media.playing = false`
- Clients display: `displayTime = Math.min(predictedTime, duration)`

### Drift Tolerance

- Default: 500ms. If joinee's reported position differs by >500ms from server, request is rejected.
- Prevents rogue clients from corrupting global state.

### New `set_metadata` Action

Updates duration/title **without** resetting playback state:

```typescript
if (input.action === 'set_metadata') {
  media.duration = Math.max(0, input.duration);
  media.title = input.title || media.title;
  if (media.duration > 0 && media.currentTime >= media.duration) {
    media.currentTime = media.duration;
    media.playing = false;
  }
}
```

Fired by host media elements after `onLoadedMetadata`.

---

## 🛠️ Development

### Type Checking

```bash
npm run type-check
```

Validates all TypeScript without emitting.

### Linting

```bash
npm run lint
```

Uses ESLint configuration from `package.json`.

### Building

```bash
npm run build
```

Emits optimized Next.js output to `.next/` folder. No errors or warnings = production-ready.

### Testing Locally

1. **Start backend**: `cd /path/to/SyncShare && gunicorn -k eventlet -w 1 -b 0.0.0.0:5000 wsgi:application`
2. **Start Next.js dev server**: `npm run dev` (this directory)
3. **Open browser**: http://localhost:3000
4. **Create/join channel**: Follow UI flow

---

## 📚 Documentation

For detailed architecture and debugging, see:

- [AI_FUTURE_AGENTS.md](AI_FUTURE_AGENTS.md) — Video/embed handling rationale, testing checklist, future enhancements
- [AI_MANIFEST.md](../AI_MANIFEST.md) — Event contracts, invariants, deployment assumptions

---

## 🐛 Known Limitations

- **Single-Worker Design**: All state lives in memory; restart loses channels. Multi-worker deployments require Redis.
- **No Persistent Storage**: Channels expire after 1 hour of inactivity.
- **YouTube Autoplay Policy**: Browsers may mute/block autoplay without user gesture. Manual unmute may be required on first visit.
- **Limited CORS**: Backend CORS origins must be pre-configured in `config/runtime.json`.

---

## 🎬 Next Steps

- **Deploy**: Build (`npm run build`), then run on production server with process manager (PM2, systemd, etc.)
- **Add WebRTC**: Integrate Peerjs or Mediasoup for true peer-to-peer voice/video
- **Persistent State**: Connect to Redis for multi-worker horizontal scaling
- **Analytics**: Log sync events for performance monitoring
- **Mobile**: Optimize UI/touch interactions for mobile clients

---

## 📄 License

See main repository license.
