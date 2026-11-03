# Telegram downloads (tdl sidecar) — spec

## 1. Features
- New **Telegram** section, separate from HTTP/torrent downloads. It is driven by a bundled `tdl` binary (iyear/tdl, Go), started as a child process. tdl jobs are not `DownloadState`s, and they do not go into `downloadManager.ts`.
- **Login**: QR, phone code, or import from Telegram Desktop (`tdl login -T qr|code|desktop [-d <tdata dir>] [-p <passcode>]`). The account and session status show at the top of the screen. The section also offers Logout.
- **Clipboard offer**: copying a Telegram message link shows a notification: "Download this Telegram message?", or "N messages" when several are copied. Clicking it opens the Add dialog with the links filled in. A separate toggle controls this, so it works even when the general `watchClipboard` is off.
- **Media-type organisation**: Videos, Photos, Audio, Documents, Other, each with a count, plus All.
- **Batch**: (a) paste or copy many links: one tdl run with repeated `-u`. (b) Whole chat or range: `tdl chat export -c <chat> -T time|id|last -i <a,b> [--filter …]` writes JSON, the user reviews the list, then `tdl dl -f <json>` runs.
- **Job controls**: pause (kill the process), resume (rerun with `--continue --skip-same`), cancel, retry failed, remove, Show in Finder, open file.

## 2. Screen layout and components to reuse
`App.tsx` `CurrentScreen` gets a third branch: `view.name === 'telegram'` → `screens/TelegramScreen.tsx`.
- **Entry point**: in `components/downloads/Sidebar.tsx`, add `section('Telegram')` below "File type" with one item: a Telegram icon, the active-job count, and an onClick that calls `setView({name:'telegram', kind:null})`. Export the private `Item` and `labelClass` from that file and reuse them. Keep the collapsed state in localStorage under the same key, `lightning.sidebar`.
- **TelegramScreen**: a left nav, `components/telegram/TelegramSidebar.tsx`, built from the exported `Item`. Top entry: "← Downloads". Then a "Media" section with All, Videos, Photos, Audio and Documents. Each media entry uses `FileKindIcon` from `downloads/FileKindIcon.tsx`, mapped video, image, audio, document and other. The nav ends with a "Jobs" section: Active, Finished, Failed.
- **Toolbar**: same Tailwind and `ui/button`, `ui/input` (search) and `ui/tooltip` as `DownloadsScreen.tsx`. Buttons: "Add links" (`Plus`), "Export chat…" (`ListPlus`), "Pause all"/"Resume all", and an account chip that opens the login dialog.
- **List**: wrap it in `DownloadsTable` only if its store coupling allows (`tableLayout` and `sortBy` come from `useAppStore`). Otherwise use a plain flex list with `ROW_CLASS` and `stateEdge` from `downloads/rowHelpers.ts`.
  - Each row (`components/telegram/TelegramItemRow.tsx`) reuses `SizeCell`, `SpeedCell`, `EtaCell`, `StatusCell`, `AddedCell`, `ClippedText` and `cellClass` from `downloads/cells.tsx`, and `RowProgressLine` (it takes a `RowInfo`, which the row builds from a `TdlItem`).
  - Rows also reuse `RowActionsMenu`/`RowContextMenu` from `downloads/rowMenu.tsx` and `Checkbox` for multi-select.
  - A job with more than one item renders like a group, collapsible as in `GroupRows.tsx` (copy its chevron and folder header pattern, do not import it).
- **Dialogs**: on `ui/dialog`, styled like `MultiLinkDialog.tsx`.
  - `TelegramAddDialog`: a textarea of links, live-parsed with a "N valid / M ignored" count; a destination field through `chooseDestinationFolder`; a Start button.
  - `TelegramExportDialog`: a chat picker from `tdl chat ls -o json`, the range type, the range, and a filter. It previews the message list with kind checkboxes, then starts the job.
  - `TelegramLoginDialog`: mode tabs through `ui/toggle-group`. QR mode shows the ASCII QR in a monospace `<pre>`. Phone, code and 2FA prompts use `Input`.
- **Empty state**: if not logged in, a centred "Sign in to Telegram" card with the three modes. If the binary is missing, an error alert (`ui/alert`).
- If `sidebarHidden` is on, the section is reached through the app menu: add "Telegram" to `appMenu.ts`, which sends app command `open-telegram`.

## 3. Shared types (`src/shared/telegram.ts`)
```ts
type TgMediaKind = 'video'|'photo'|'audio'|'document'|'other'
type TdlJobStatus = 'queued'|'exporting'|'running'|'paused'|'completed'|'error'|'cancelled'
interface TdlItem { key: string /* `${chat}/${msg}` */; link?: string; fileName: string; media: TgMediaKind;
  received: number; total: number; speed: number; status: 'waiting'|'downloading'|'done'|'skipped'|'failed'; path?: string; error?: string }
interface TdlJob { id: string; source: {type:'links'; links: string[]} | {type:'export'; chat: string; range: string; file: string};
  dir: string; status: TdlJobStatus; items: TdlItem[]; createdAt: number; finishedAt?: number; error?: string; pid?: number }
interface TdlStatus { binary: boolean; version?: string; loggedIn: boolean; account?: string /* name/@user only */ }
type TdlLoginEvent = {type:'qr'; ascii: string} | {type:'prompt'; field:'phone'|'code'|'password'} | {type:'done'; account: string} | {type:'error'; message: string}
```
- `parseTelegramLinks(text): string[]` accepts `https://t.me/<user>/<id>`, `t.me/c/<chatId>/<id>`, `t.me/<user>/<topic>/<id>`, `telegram.me/...` and `?single`/`?comment=`. It splits on whitespace and newlines, de-duplicates, caps at 500 links, and drops `t.me/+invite`, `t.me/joinchat` and links with no message id.
- `mediaKindOf(fileName, mime?)`: MIME first (`video/*`→video, `image/*`→photo, `audio/*`→audio), then `fileKind()` from `renderer/src/utils/fileKind.ts` (move it to `src/shared/fileKind.ts` and re-export from the old path). Mapping: video→video, image→photo, audio→audio, document/archive→document, everything else→other. Telegram voice notes (.oga/.ogg) count as audio, round videos as video, stickers (.webp/.tgs) as photo/other.

## 4. IPC (add to `ipc-channels.ts` and `ipc-contract.ts`, preload `index.ts` and `globals.d.ts`)
Request/response:
- `tdlStatus` `tdl:status` → TdlStatus
- `tdlLoginStart` `tdl:login-start` (mode, {desktopDir?, passcode?}) → sessionId
- `tdlLoginAnswer` `tdl:login-answer` (sessionId, value) → void
- `tdlLoginCancel` `tdl:login-cancel` (sessionId)
- `tdlLogout` `tdl:logout`
- `tdlListChats` `tdl:list-chats` → {id, title, type}[]
- `tdlExportPreview` `tdl:export-preview` ({chat, rangeType, range, filter?}) → {file, items: TdlItem[]}
- `tdlStartJob` `tdl:start-job` ({links?: string[]; exportFile?: string; keys?: string[]; dir?: string}) → jobId. With `keys`, the main process writes a filtered copy of the export JSON.
- `tdlListJobs` `tdl:list-jobs` → TdlJob[]
- `tdlPauseJob`, `tdlResumeJob`, `tdlCancelJob`, `tdlRetryJob` `tdl:*-job` (id)
- `tdlRemoveJob` `tdl:remove-job` (id, {trashFiles?})
- `tdlRevealItem`, `tdlOpenItem` `tdl:reveal-item`/`tdl:open-item` (jobId, key) → boolean

Push events (not in IpcContract; update its header comment):
- `tdlJobUpdated` `tdl:job-updated` (TdlJob), throttled through `shared/uiThrottle.ts`
- `tdlLoginEvent` `tdl:login-event` (sessionId, TdlLoginEvent)
- App command `telegram-links`: JSON {links}; and `open-telegram`.

## 5. Settings keys
- In `AppPrefs`/`DEFAULT_PREFS` (`shared/types.ts`), sanitized in `main/settings.ts` `sanitizePrefs`:
  - `telegramWatchClipboard` (bool, default true once logged in, else ignored)
  - `telegramThreads` (1–16, default 4 → `-t`)
  - `telegramParallel` (1–8, default 2 → `-l`)
  - `telegramSkipSame` (true → `--skip-same`)
  - `telegramSortByKind` (false: after a file finishes, move it to `<dir>/Videos|Photos|Audio|Documents|Other`)
  - `telegramGroupAlbums` (true → `--group`)
  - `telegramTakeout` (false → `--takeout`)
  - `telegramUseProxy` (true: pass `--proxy` from the app's manual SOCKS/HTTP proxy prefs)
  - `telegramTemplate` (`shortText`, default tdl's)
- In `AppSettings` (absolute path, like `destinationDir`): `telegramDir`, default `<Downloads>/Lightning Telegram`.
- UI: a new `'Telegram'` entry in `SettingsDialog.tsx` `PAGES`, using the existing `Row` checkbox and number-field patterns. It holds the clipboard toggle, folder, threads/parallel, the toggles above, account status and Logout.

## 6. Main-process state model
- `main/telegram/tdlBinary.ts` resolves `process.resourcesPath/tdl/tdl[.exe]` (dev: `vendor/tdl/<platform>-<arch>/`) and runs `tdl version`. Every call adds `-n lightning --storage type=bolt,path=<userData>/tdl/storage` so tdl never touches `~/.tdl`.
- `main/telegram/tdlJobs.ts` (TdlJobManager):
  - The queue lets at most 1 tdl process run at a time. tdl's bolt storage locks, so parallelism comes from `-l` and `-t` inside one process.
  - Jobs persist to `<userData>/telegram-jobs.json` through `jsonFile.ts` `updateJson`, debounced.
  - On startup, `running` becomes `paused`.
  - Transitions: queued→running→completed|error|cancelled; running⇄paused. Resume and retry rerun with `--continue --skip-same` (retry restricted to failed keys via filtered `-u`/JSON). Export jobs go `exporting` first.
- `main/telegram/tdlProgress.ts` parses tdl's progress output. Spawn with `NO_COLOR=1` and a wide `COLUMNS`. Strip ANSI and read each line's file name, bytes done/total and speed. Fallback: for each item, poll the size of the `.tmp`/partial file in `dir` once per second. When the process exits, check the files on disk to settle `done` versus `failed`.
- `main/telegram/tdlLogin.ts` runs a login session: it spawns `tdl login`, turns stdout QR blocks and prompts into `TdlLoginEvent`s, and writes answers to stdin. Survey prompts may need a PTY (see Risks). When the process exits with 0, it calls `tdlStatus`.
- Completed items raise a Notification when `prefs.notifyCompleted` is on (batch: one notification per job). Clipboard watching happens in `clipboardWatcher.ts`: on each poll, `parseTelegramLinks(text)` runs before `downloadableLink`. If it finds links and `telegramWatchClipboard` is on, it shows a notification, and clicking it calls `offerTelegram(links, win)`. That function shows the window and sends `appCommand('telegram-links', JSON)`. `setEnabled` takes `{files, telegram}`, and `appBehavior.applyBehavior` passes both prefs.

## 7. Batch UX
- **Add dialog**: paste any text, links are pulled out and listed with chat/msg and a remove button, plus a duplicate badge for keys already in a job. Start creates one job with N items, run as `tdl dl -u … -u … -d dir`. More than 50 links are written to a temp export JSON and run with `-f` instead, because of command-line length limits on Windows.
- **Export dialog**: chat, then range, then a preview table with kind filter chips (Videos, Photos and so on) and select-all, then "Download N files (X GB)". The job shows as a collapsible group, and its header shows the summed progress.
- A notification for a multi-link copy says "Download 12 Telegram messages?".

## 8. Risks
- **License**: tdl is AGPL-3.0 (confirm). Ship it as a separate executable, unmodified, with its LICENSE and a source link in `resources/tdl/` and the About box. Do not link to it.
- **Signing and AV**: the sidecar must be codesigned and notarized on macOS. Add `binaries` to the mac config in `electron-builder.yml` and add the path to `asarUnpack`. Windows SmartScreen and AV may flag a Go binary.
- **Interactive login**: tdl uses TTY prompts and qrterminal. Without a PTY, prompts may not render. Spike this first; if it fails, add `node-pty` (native module, rebuilt by `install-app-deps`).
- **Progress parsing** depends on tdl's progress-bar format, which can break on upgrade. Pin the tdl version in `scripts/fetch-tdl.mjs` with sha256 checks, and keep the file-size fallback.
- tdl does not use Lightning's multi-network binding, DNS or limits. Say so in the UI ("Telegram downloads use the default connection"); only a proxy is passed through.
- **Account safety**: FLOOD_WAIT and bans from aggressive `-t`/`-l`/takeout. Clamp the values and surface FLOOD_WAIT seconds as an error reason. The session file is in plain text in userData: warn in Logout and delete the storage on Logout.
- **Clipboard privacy**: never log full links (use `redactUrl`), and don't offer links copied while the window is focused (keep the existing rule).

## 9. Implementation split (disjoint files; W2 lands first as the contract, then W1 and W3 run in parallel)
- **W2 — contract, settings, clipboard**:
  - new `src/shared/telegram.ts` (types, `parseTelegramLinks`, `mediaKindOf`)
  - new `src/shared/fileKind.ts`
  - `src/renderer/src/utils/fileKind.ts` (re-export)
  - `src/shared/ipc-channels.ts`, `src/shared/ipc-contract.ts`, `src/shared/types.ts`
  - `src/preload/index.ts`, `src/preload/globals.d.ts`
  - `src/main/settings.ts`, `src/main/clipboardWatcher.ts`, `src/main/appBehavior.ts`, `src/main/openLinks.ts` (`offerTelegram`), `src/main/appMenu.ts`
  - `src/renderer/src/components/SettingsDialog.tsx` (Telegram page)
  - new `e2e/telegramLinks.spec.ts`
- **W1 — sidecar and main process**:
  - new `src/main/telegram/{tdlBinary,tdlJobs,tdlProgress,tdlLogin,tdlExport}.ts`
  - new `src/main/ipc/telegramHandlers.ts` (uses the typed `handle` pattern from `handlers.ts`; registered from `src/main/index.ts` next to `registerIpcHandlers`; disposed on quit)
  - new `scripts/fetch-tdl.mjs`, `package.json` (script), `electron-builder.yml` (extraResources `vendor/tdl/${os}-${arch}` → `tdl`, signing), `.gitignore` (`vendor/`)
- **W3 — renderer**:
  - new `src/renderer/src/screens/TelegramScreen.tsx`
  - new `src/renderer/src/components/telegram/{TelegramSidebar,TelegramItemRow,TelegramJobGroup,TelegramAddDialog,TelegramExportDialog,TelegramLoginDialog,telegramRowInfo}.tsx`
  - new `src/renderer/src/store/useTelegramStore.ts` (zustand: jobs by id, status, filter kind/status, selection)
  - new `src/renderer/src/hooks/useTelegramEvents.ts`
  - `src/renderer/src/components/downloads/Sidebar.tsx` (export `Item`/`labelClass`, add the Telegram section)
  - `src/renderer/src/store/useAppStore.ts` (`View` adds `{name:'telegram'; kind: TgMediaKind|null}`)
  - `src/renderer/src/App.tsx` (route, the `telegram-links`/`open-telegram` commands, mount the dialogs)
