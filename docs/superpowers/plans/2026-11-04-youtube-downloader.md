# YouTube Downloader Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Integrate a dedicated YouTube Downloader section into the Lightning desktop application, allowing users to probe video/playlist URLs, select resolution and audio formats, download high-quality videos (up to 4K/8K) or audio-only streams, and track progress seamlessly inside Lightning's download engine and UI.

**Architecture:**

- **Backend (Main process):** Standalone `yt-dlp` binary engine paired with `ffmpeg` (for DASH video+audio muxing). Wrapped in a strongly-typed service `src/main/youtube/` that manages binary resolution, metadata extraction (`--dump-single-json`), download process spawning with structured progress events, and integration with Lightning's proxy and network preferences.
- **IPC Layer:** Extended `IpcChannels` and `IpcContract` defining `youtube:probe`, `youtube:start`, `youtube:check-engine`, and `youtube:update-engine`.
- **Frontend (Renderer):** Dedicated `YouTubeScreen` component accessible via the navigation sidebar, featuring URL input with auto-paste, a rich video metadata preview card, quality/format selectors, and live progress integration into Lightning's universal store and table.

**Tech Stack:**

- Engine: `yt-dlp` (standalone cross-platform executable) + `ffmpeg-static`
- Backend: Electron 44, Node.js child_process streams, TypeScript
- Frontend: React 19, Tailwind CSS, Lucide icons, Zustand (`useAppStore`)
- Packaging: `electron-builder` `extraResources`

---

## Global Constraints

- Never block the Electron main process: all `yt-dlp` interactions must run asynchronously via spawned subprocesses with non-blocking stdout stream parsing.
- Preserve existing download system contracts: YouTube downloads must emit standard `DownloadUpdate` events so they appear in notifications, tray status, and the main download table.
- Honor user network preferences: pass configured HTTP/HTTPS/SOCKS proxies to `yt-dlp` via `--proxy`.
- Cross-platform support: support macOS (arm64/x64), Windows (x64), and Linux (x64/arm64).
- Offline-resilient: if `yt-dlp` binary is missing or needs update, provide clean UI indicators and automatic self-update triggers (`yt-dlp -U`).

## Review Focus

1. **YouTube URL Parsing & Validation**: Input of non-YouTube URLs or malformed links must fail gracefully with actionable error messages without crashing the probe handler.
2. **Format Availability**: Videos with missing audio in high resolutions (DASH 1080p, 4K) must automatically be muxed with the best audio track via ffmpeg without user intervention.
3. **Download Cancellation / Pause**: User cancelling or pausing a YouTube download must terminate the `yt-dlp` child process immediately without leaving orphaned background processes.
4. **Proxy & VPN Integration**: If Lightning's "Use VPN" or custom proxy setting is active, `yt-dlp` must route through the configured proxy rather than leaking traffic directly.
5. **Disk Space Verification**: Pre-check destination disk space against `filesize_approx` before initiating large 4K video downloads.

---

## Task Decomposition

### Task 1: Engine & Binary Management (`src/main/youtube/engine.ts`)

**Files:**

- Create: `src/main/youtube/engine.ts`
- Create: `src/main/youtube/types.ts`
- Test: `tests/unit/youtube-engine.test.ts`

- [x] Define YouTube metadata types in `src/main/youtube/types.ts`: `YoutubeVideoMeta`, `YoutubeFormatOption`, `YoutubeProbeResult`, `YoutubeDownloadOptions`.
- [x] Implement `resolveYtDlpPath()`: locates bundled `yt-dlp` in `process.resourcesPath/bin` or falls back to system PATH / user app data.
- [x] Implement `checkEngineStatus()`: queries `yt-dlp --version` and checks for ffmpeg presence.
- [x] Implement `updateEngine()`: triggers `yt-dlp -U` to self-update the binary to the latest YouTube cipher fixes.
- [x] Write unit tests verifying path resolution, version extraction, and error handling when binary is missing.

---

### Task 2: Metadata Extraction & Format Selection (`src/main/youtube/probe.ts`)

**Files:**

- Create: `src/main/youtube/probe.ts`
- Modify: `src/main/youtube/types.ts`
- Test: `tests/unit/youtube-probe.test.ts`

- [x] Implement `probeYoutubeUrl(url: string, proxy?: string): Promise<YoutubeProbeResult>`:
  - Runs `yt-dlp --dump-single-json --no-warnings --no-playlist [proxy-flags] <url>`.
  - Parses JSON output into simplified format options:
    - Best Video + Audio muxed (720p, 1080p, 1440p, 2160p/4K).
    - Audio-only (MP3 / M4A / Opus).
  - Extracts title, thumbnail, duration, channel name, and estimated file sizes.
- [x] Implement URL safety sanitizer to prevent shell argument injection.
- [x] Write unit tests for JSON parser against sample yt-dlp metadata responses.

---

### Task 3: Download Runner & Progress Streamer (`src/main/youtube/downloader.ts`)

**Files:**

- Create: `src/main/youtube/downloader.ts`
- Modify: `src/main/download/downloadManager.ts`
- Test: `tests/unit/youtube-downloader.test.ts`

- [x] Implement `startYtDlpDownload(options: YoutubeDownloadOptions, onProgress: (p: DownloadProgress) => void): ChildProcess`:
  - Spawns `yt-dlp` with `--newline --progress-template "%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s"`.
  - Configures output template: `<dest>/%(title)s [%(id)s].%(ext)s`.
  - Passes proxy configuration if set.
- [x] Wire process signals (`SIGTERM` / `taskkill`) to cancellation and pause handles.
- [x] Hook into `DownloadManager` so the YouTube job is assigned a UUID, registered in active downloads list, and emits standard `downloadUpdated` events.
- [x] Add cleanup logic on exit or failure to remove incomplete `.part` files if cancelled.

---

### Task 4: Shared IPC Contract & Preload Bridge (`src/shared/`, `src/preload/`)

**Files:**

- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`

- [x] Add channels in `src/shared/ipc-channels.ts`:
  - `youtubeProbe: 'youtube:probe'`
  - `youtubeStart: 'youtube:start'`
  - `youtubeStatus: 'youtube:status'`
  - `youtubeUpdate: 'youtube:update'`
- [x] Update `IpcContract` with parameter and return types for each YouTube channel.
- [x] Register IPC handlers in `src/main/ipc/handlers.ts` calling `src/main/youtube/`.
- [x] Expose `probeYoutube`, `startYoutubeDownload`, `getYoutubeEngineStatus`, `updateYoutubeEngine` on `window.lightning` in `src/preload/index.ts`.

---

### Task 5: Renderer Store & Navigation (`src/renderer/src/store/`)

**Files:**

- Modify: `src/renderer/src/store/useAppStore.ts`
- Modify: `src/renderer/src/App.tsx`

- [x] Update `View` type in `useAppStore.ts`:
  ```typescript
  export type View = { name: 'list' } | { name: 'download'; id: string } | { name: 'youtube' }
  ```
- [x] Add `youtube` state slice:
  - `activeUrl: string`
  - `probeState: 'idle' | 'loading' | 'ready' | 'error'`
  - `currentProbe: YoutubeProbeResult | null`
  - `engineStatus: { ready: boolean; version?: string; error?: string }`
- [x] Update `CurrentScreen` in `src/renderer/src/App.tsx` to render `<YouTubeScreen />` when `view.name === 'youtube'`.

---

### Task 6: Sidebar Navigation Item (`src/renderer/src/components/downloads/Sidebar.tsx`)

**Files:**

- Modify: `src/renderer/src/components/downloads/Sidebar.tsx`
- Create: `src/renderer/src/components/YoutubeBadge.tsx`

- [x] Add YouTube navigation item to `Sidebar.tsx` with a distinct icon (Lucide `Youtube` / Play-in-rectangle icon) below Torrents/Groups.
- [x] Show count of active YouTube downloads on the sidebar button.
- [x] Implement `YoutubeBadge.tsx` to display next to YouTube downloads in the main download list table.

---

### Task 7: YouTube Screen Component (`src/renderer/src/screens/YouTubeScreen.tsx`)

**Files:**

- Create: `src/renderer/src/screens/YouTubeScreen.tsx`
- Create: `src/renderer/src/components/youtube/FormatSelector.tsx`
- Create: `src/renderer/src/components/youtube/VideoPreviewCard.tsx`

- [x] Build `YouTubeScreen.tsx`:
  - Search/URL bar with automatic clipboard paste button ("Paste Link").
  - Engine status banner (if `yt-dlp` needs update or is downloading).
- [x] Build `VideoPreviewCard.tsx`:
  - High-res thumbnail preview with duration badge.
  - Channel avatar / name, video title, upload date, view count.
- [x] Build `FormatSelector.tsx`:
  - Quick presets: "Best Video (1080p/4K MP4)", "Best Audio (MP3/M4A)", "Custom Quality".
  - Dropdown listing resolutions with exact video codecs and estimated sizes.
  - "Start Download" action button triggering IPC and navigating to download detail view.

---

### Task 8: Build & Packaging Configuration (`electron-builder.yml`)

**Files:**

- Modify: `electron-builder.yml`
- Create: `scripts/download-yt-dlp.mjs`
- Modify: `package.json`

- [x] Create prebuild script `scripts/download-yt-dlp.mjs` to fetch official standalone binaries for macOS, Windows, and Linux into `build/bin/`.
- [x] Add `extraResources` entry in `electron-builder.yml` to bundle `bin/yt-dlp` into packaged distributions.
- [x] Run `npm run build:mac` and verify binary permissions and codesign integrity.

---

### Task 9: AI Agent & MCP Tool Integration

**Files:**

- Create: `src/main/youtube/mcpBridge.ts`
- Modify: `src/main/index.ts`

- [x] Expose YouTube downloader tools for local AI agents:
  - `youtube_search_and_probe`: Find video and fetch resolutions.
  - `youtube_download`: Trigger download with specific quality.
  - `youtube_get_transcript`: Extract subtitles/transcript for agent summarization.
