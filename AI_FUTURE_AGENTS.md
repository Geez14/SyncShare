# Future Agent Handover — SyncShare

Purpose
- This file is a short, actionable plan and set of guidelines for future agents working on the SyncShare codebase. It captures recent fixes, why they were made, and concrete next steps to avoid regressions.

Recent short-term fixes (what was changed)
- `components/modules/video-module.tsx`
  - Added conservative embed reload logic to avoid setting `iframe.src` on every sync update. The iframe is now updated only when there is a meaningful change (start time changed by >8s, source changed, or a >20s cooldown expired).
  - Title derivation improved and defaults to `Unknown` when not available.
- `components/modules/music-module.tsx`
  - For joiners (non-hosts), the music UI was simplified: removed playback controls; only the volume control is visible to joinees. Host retains full controls.
- `lib/utils.ts`
  - `deriveTrackTitle()` now falls back to the hostname if there is no path segment, so UIs show a friendly label (e.g., `youtube.com`) instead of raw errors or long URLs.

Why these changes
- Rapid repeated iframe reloads were triggering client-side blocked requests (e.g., adblockers), producing noisy errors like `ERR_BLOCKED_BY_CLIENT` in the browser console. Avoiding unnecessary reloads reduces noise and prevents looping retries.
- Many URLs (YouTube short links, roots) do not contain usable pathname segments; hostname fallback avoids empty or confusing names shown to users.
- UX: viewers (joinees) should not have playback controls — host is authoritative — but a local volume slider is a reasonable client-only control.

Guidelines for future agents
1. Iframe / Embed Handling
   - Never assign `iframe.src` on every sync tick. Instead: compare meaningful parameters (source URL + start time). Use thresholds (e.g., start time drift > 8s) and a cooldown window (e.g., 20s) to gate reloads.
   - If `iframe` operations still cause blocked requests, treat those as *client-side adblock/extension behavior*. Do not attempt to circumvent user-installed blockers from the app.

2. Title derivation
   - Use `deriveTrackTitle()` (see `lib/utils.ts`) for client display. If path segment not available, fall back to `hostname` (strip `www.`) or `Unknown`.
   - Avoid displaying raw IDs, stack traces, or URL fragments in the UI.

3. Joinee controls
   - Keep host as the authoritative controller for playback and seeking.
   - For joiners, only expose client-only controls (e.g., volume). If you add more client-only controls later, keep them purely client-side and do not emit control events to the server.

4. Testing and Reproduction
   - Reproduce blocked-resource errors with and without common adblock/privacy extensions enabled; expect blocked endpoints such as `www.youtube-nocookie.com/youtubei/v1/log_event` when blocked.
   - Test the following scenarios in a clean browser profile (no extensions) and in a blocked profile:
     1. Load a YouTube URL (short and full forms) as host — verify viewers receive the embed and do not trigger reload loops.
     2. Load a direct MP4 URL — verify video element playback and seeks work and that title fallback uses filename or `Unknown`.
     3. Load a local file (via `File` input) as host — verify mirrored playback if Rtc paths used.
   - Use the dev server and network throttling to simulate slow environments.

5. Instrumentation and observability
   - Add a small debug flag (DEV-only) that logs when we decide to reload an embed (include reason: source change / start drift / cooldown expired). Place logs behind a `if (process.env.NODE_ENV !== 'production')` guard.
   - Do not log raw SDP or PII.

6. Future enhancements (non-blocking suggestions)
   - Consider an optional server-side oEmbed or metadata proxy to fetch friendly titles for third-party sources (use cautiously; privacy concerns apply). This helps present nicer names without relying on client parsing.
   - If repeated blocked requests remain a problem for end users you control, consider replacing YouTube embeds with server-side preview cards linking to the video instead of auto-loading embeds.

Pointers to code
- Main app shell: `components/syncshare-app.tsx`
- Video logic and embed handling: `components/modules/video-module.tsx`
- Music logic: `components/modules/music-module.tsx`
- Utility helpers (title derivation): `lib/utils.ts`
- In-memory runtime orchestration: `lib/state.ts`

Quick developer checklist (for the agent executing changes)
- Run tests and lint (if present) and a dev server:

```bash
cd nextjs-app
npm install
npm run dev
```

- Reproduce video playback from both YouTube and direct video URLs in a clean browser and with blocker extensions enabled.
- Add minimal DEV logging if necessary to diagnose embed reload decisions.

If you want, I can:
- Add the suggested DEV logging toggle now (small, local change).
- Run a build and smoke-test for compile errors.

---
Generated: for future agents as a concise handoff and guidance document. If you prefer a different filename or additional checklist items, tell me where to place them and I'll add them.