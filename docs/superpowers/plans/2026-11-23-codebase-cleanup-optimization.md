# Codebase Cleanup, Structure & Performance Optimization Plan

> **For agentic workers:** Executed by parallel Gemini 4 Hydrogen swarm workers on disjoint file sets, followed by full verification (`npm run typecheck`, `npm run lint`, `npm run format:check`, and smoke tests).

**Goal:** Clean up code duplication, split monolithic files into focused modules, and optimize hot-path CPU/memory/I/O overhead across `src/main`, `src/preload`, `src/renderer`, and `src/shared` without breaking any existing functionality or uncommitted WIP changes.

**Architecture:** We partition the work into 4 disjoint worker domains (`worker-main-ipc`, `worker-main-download`, `worker-renderer-perf`, `worker-renderer-settings`) so that parallel **Gemini 4 Hydrogen** workers never touch the same file. Every extraction preserves existing exports, IPC contracts, and `data-*` E2E selectors.

**Tech Stack:** Electron 44, TypeScript 5.9, React 19, Zustand 5, Tailwind CSS 4, Playwright E2E.

## Global Constraints
- Zero behavioral regressions; preserve all uncommitted WIP changes currently in the working tree.
- Disjoint file sets across parallel workers.
- All files must pass `npm run typecheck` and `npm run lint`.

---

### Task 1: Main Process IPC, Preload Subscriptions, Settings Cache & Parallel File Checks (`worker-main-ipc`)

**Files:**
- Create: `src/main/ipc/ipcHelpers.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/main/ipc/youtubeHandlers.ts`
- Modify: `src/main/ipc/telegramHandlers.ts`
- Modify: `src/main/localApi.ts`
- Modify: `src/main/settings.ts`
- Modify: `src/main/download/history.ts`
- Modify: `src/main/youtube/jobs.ts`
- Modify: `src/main/telegram/tdlJobs.ts`
- Modify: `src/preload/index.ts`
- Modify: `e2e/zz-click.spec.ts`

- [ ] **Step 1: Create `src/main/ipc/ipcHelpers.ts` and deduplicate IPC handlers & preload**
  - Extract shared `handle`, `sendToWindow`, `createJobThrottler` (replacing duplicated `pending` + `uiUpdateDelay` push/flush logic in `youtubeHandlers.ts` and `telegramHandlers.ts`), and `showAppNotification` (unifying `Notification` + click-to-focus in `youtubeHandlers.ts` and `telegramHandlers.ts`).
  - Share log-opening helper between `openLogFolder` and `openLogs` in `src/main/ipc/handlers.ts`.
  - In `src/main/ipc/handlers.ts` (`openDownloadedFile`), avoid calling `manager.listDownloads()` (which clones all active downloads and blocks); check `manager.liveStates().find(s => s.id === id)?.destinationPath` first, falling back to `listHistory()`.
  - In `src/preload/index.ts`, replace the 16 identical `ipcRenderer.on` + `removeListener` subscription wrappers with a single typed `subscribe<T>(channel, callback)` helper.

- [ ] **Step 2: Deduplicate `readJsonBody` in `src/main/localApi.ts`**
  - Extract a `readJsonBody(req)` helper for the 4x duplicated `readBody` + `JSON.parse` + object guard in `src/main/localApi.ts`.

- [ ] **Step 3: Cache sanitized settings in `src/main/settings.ts` and parallelize `isFileGone` loops**
  - In `src/main/settings.ts`, cache the sanitized `AppSettings` in memory after load (updating/invalidating the cache in `saveSettings` and any direct file writes/tests) to eliminate repeated disk reads on startup and every notification/job check.
  - In `src/main/download/history.ts` (`removeMissingFromHistory`), `src/main/youtube/jobs.ts` (`removeMissingFinished`), and `src/main/telegram/tdlJobs.ts` (`removeMissingFinished`), parallelize the sequential `await isFileGone(...)` check using `Promise.all` (matching `listHistory` in `history.ts`).
  - In `src/main/youtube/jobs.ts`, share `optionCookies` from `src/main/youtube/cookies.ts` (if already exported or export it cleanly), remove redundant `existsSync` before `rm(..., { force: true })` in `removeJob`, and add a `dispose()` method on `YoutubeJobManager` (and clear `offers` TTL timers in `youtubeHandlers.dispose()`).
  - Fix the unused `import { join } from 'node:path'` in `e2e/zz-click.spec.ts` so `npm run typecheck:e2e` passes cleanly.

---

### Task 2: Decompose & Optimize `DownloadManager` and `HttpTransfer` (`worker-main-download`)

**Files:**
- Create: `src/main/download/manifestStore.ts`
- Create: `src/main/download/downloadHelpers.ts`
- Create: `src/main/download/httpHelpers.ts`
- Modify: `src/main/download/downloadManager.ts`
- Modify: `src/main/download/httpTransfer.ts`

- [ ] **Step 1: Eliminate redundant `structuredClone` & optimize `sampleSpeeds` in `src/main/download/downloadManager.ts`**
  - Remove redundant `structuredClone` calls in `takeUpdate` (immediately serialized by `webContents.send`), `listDownloads` (returned via `ipcMain.handle` or internal read-only callers; keep shallow copy where needed), and `persistNow` (immediately passed synchronously to `JSON.stringify`).
  - Optimize `sampleSpeeds`: avoid per-second `values.slice(-PEAK_SAMPLES)` allocation when array length is within `PEAK_SAMPLES` (push in-place and shift when `> PEAK_SAMPLES`), and avoid repeated O(n) `state.networks.find` inside the loop.
  - Track pending `scheduleUpdate` timeout handle on `RuntimeFields` and clear it when a runtime is cancelled/removed/suspended so timer closures are released immediately.

- [ ] **Step 2: Extract pure helpers from `downloadManager.ts` into `manifestStore.ts` and `downloadHelpers.ts`**
  - Extract pure manifest/leftover helpers (`isCurrentManifest`, `partialLeftovers`, `isNotFound`) into `src/main/download/manifestStore.ts`.
  - Extract pure state/unit helpers (`sampleSpeeds`, `newHttpNetwork`, `newTorrentNetwork`, `isDone`, `unitsOf`, `choiceOf`, `choosePieces`, `unchosenPaths`, `formatGigabytes`, `webLink`, `headersForLink`, `ensureDiskSpace`) into `src/main/download/downloadHelpers.ts` (re-exporting any symbols imported by other modules or tests).

- [ ] **Step 3: Extract pure helpers from `httpTransfer.ts` into `httpHelpers.ts`**
  - Extract `compareSamples` and pure stream/retry helpers (`unlessAborted`, `retryDelayMs`, `splittable`, `concurrencyFor`, `pickedStreams`, `median`, `newStream`, `requestedVersion`) into `src/main/download/httpHelpers.ts` (re-exporting any symbols imported externally).

---

### Task 3: Renderer Hot-Path Performance, Shared/Utils Deduplication & Screen Cleanups (`worker-renderer-perf`)

**Files:**
- Create: `src/renderer/src/hooks/useSelectionShortcuts.ts`
- Modify: `src/renderer/src/components/AppSidebar.tsx`
- Modify: `src/renderer/src/components/BlockGrid.tsx`
- Modify: `src/renderer/src/components/StatusMenu.tsx`
- Modify: `src/renderer/src/components/NewDownloadDialog.tsx`
- Modify: `src/renderer/src/components/MultiLinkDialog.tsx`
- Modify: `src/renderer/src/components/FileKindIcon.tsx`
- Modify: `src/renderer/src/components/downloads/DownloadRow.tsx`
- Modify: `src/renderer/src/components/downloads/GroupFileRow.tsx`
- Modify: `src/renderer/src/components/downloads/TelegramItemRow.tsx`
- Modify: `src/renderer/src/components/downloads/rowHelpers.ts`
- Modify: `src/renderer/src/components/telegram/telegramRowInfo.tsx`
- Modify: `src/renderer/src/screens/DownloadsScreen.tsx`
- Modify: `src/renderer/src/screens/YouTubeScreen.tsx`
- Modify: `src/renderer/src/screens/TelegramScreen.tsx`
- Modify: `src/renderer/src/screens/CompleteScreen.tsx`
- Modify: `src/renderer/src/store/useAppStore.ts`
- Modify: `src/renderer/src/utils/downloadList.ts`
- Modify: `src/renderer/src/utils/format.ts`
- Modify: `src/renderer/src/utils/requestDraft.ts`
- Modify: `src/shared/trayModel.ts`
- Modify: `src/shared/trayPanel.ts`
- Modify: `src/shared/checksum.ts`
- Delete: `src/renderer/src/utils/fileKind.ts`
- Delete: `src/renderer/src/utils/statusMenu.ts`

- [ ] **Step 1: Optimize `AppSidebar`, `BlockGrid`, and `DownloadsScreen` hot paths**
  - In `AppSidebar.tsx`, remove the unnecessary `.sort()` before `buildEntries`/`countEntries` and compute sidebar badge counts via a selector or memoized derived state that only triggers re-renders when counts actually change.
  - Create `src/renderer/src/hooks/useSelectionShortcuts.ts` (handling `Escape` and `Cmd/Ctrl+A` via a ref for selectable IDs so the `window` `keydown` listener is not torn down and re-attached on every progress tick) and use it in `DownloadsScreen.tsx`, `YouTubeScreen.tsx`, and `TelegramScreen.tsx`.
  - In `DownloadsScreen.tsx`:
    - Fix the dependency-less `useEffect` that queries `document.querySelectorAll('[data-hit="true"]')` on every render; guard on `matchCount > 0` and add `[matchIndex, matchCount, shown]` dependencies.
    - Remove the redundant `JSON.stringify` `visualsKey` computation and unused `visualsKey` prop on `DownloadRow` and `GroupFileRow` (and unused `selecting` prop on `GroupFileRow`), using `useNetworkVisuals()` directly.
    - Memoize the action eligibility filters (`pausable`, `resumable`, `retryable`, `removable`, `trashable`, `cancelable`, and `*All`).
    - Replace the inline Pause all / Resume all / Retry all tooltip button with `<PauseAllButton>` from `ListTopBar.tsx`.
  - In `BlockGrid.tsx`, memoize `activeRows` on `[blocks, cols]` and `visualByInterfaceId` on `[groups, visuals]` before the early return so hovering or scrolling large torrents doesn't rescan all blocks.

- [ ] **Step 2: Deduplicate `StatusMenu` & `@shared/trayModel` and clean up `shared/` vs `renderer/utils/`**
  - In `src/shared/trayModel.ts`, export `rankRunning` (and use it in `trayModel.ts` and `trayPanel.ts`). In `StatusMenu.tsx`, reuse `percentOf`, `summarizeActivity`, and `rankRunning` from `@shared/trayModel`, then delete `src/renderer/src/utils/statusMenu.ts`.
  - Point all imports of `utils/fileKind` (`AppSidebar.tsx`, `DownloadsScreen.tsx`, `FileKindIcon.tsx`, `telegramRowInfo.tsx`, `useAppStore.ts`, `downloadList.ts`) directly to `@shared/fileKind` and delete `src/renderer/src/utils/fileKind.ts`.
  - In `src/renderer/src/utils/format.ts`, delegate `connectionsOf` to `connectionsOnly` from `@shared/networks`.
  - In `TelegramItemRow.tsx` and `CompleteScreen.tsx`, use `revealLabel()` from `components/downloads/rowHelpers.ts` and remove unused `FINDER` / `REVEAL_LABEL`.
  - Remove verified-unused dead code: `setColumnWidth` and `setShowSourceHost` from `useAppStore.ts`, `summaryOf` from `utils/downloadList.ts`, `draftIsEmpty` from `utils/requestDraft.ts`, and `checksumLabel` from `shared/checksum.ts`.

- [ ] **Step 3: Clean up `YouTubeScreen`, `NewDownloadDialog`, and `MultiLinkDialog`**
  - In `YouTubeScreen.tsx`, avoid rendering duplicate `yt-dlp missing` badges when `!status.binary` (only show the outline version badge when `status === null || status.binary`).
  - In `NewDownloadDialog.tsx` and `MultiLinkDialog.tsx`, memoize `subnetConflict` and `duplicateByUrl`.

---

### Task 4: Modularize `SettingsDialog.tsx` into Focused Section Components (`worker-renderer-settings`)

**Files:**
- Create: `src/renderer/src/components/settings/SettingsControls.tsx`
- Create: `src/renderer/src/components/settings/StatusBarSettings.tsx`
- Create: `src/renderer/src/components/settings/TelegramSettings.tsx`
- Create: `src/renderer/src/components/settings/NetworkSettings.tsx`
- Create: `src/renderer/src/components/settings/AppearanceSettings.tsx`
- Modify: `src/renderer/src/components/SettingsDialog.tsx`

- [ ] **Step 1: Extract shared controls into `SettingsControls.tsx`**
  - Move shared primitive setting controls (`Row`, `NumberField`, and shared prop types) from `SettingsDialog.tsx` into `src/renderer/src/components/settings/SettingsControls.tsx`.

- [ ] **Step 2: Extract `StatusBarSettings`, `TelegramSettings`, `NetworkSettings`, and `AppearanceSettings`**
  - Extract the status bar / menu bar page into `src/renderer/src/components/settings/StatusBarSettings.tsx`.
  - Extract the Telegram page into `src/renderer/src/components/settings/TelegramSettings.tsx`.
  - Extract the Network & Proxy page (`ProxyField`, `VpnSetting`, network section) into `src/renderer/src/components/settings/NetworkSettings.tsx`.
  - Extract the Appearance page into `src/renderer/src/components/settings/AppearanceSettings.tsx`.
  - Wire them cleanly in `SettingsDialog.tsx`, preserving all `data-setting` attributes, RTL layout behavior, search navigation, and uncommitted WIP changes.
