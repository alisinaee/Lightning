# Plan 008: Download torrents across every network

> **Executor instructions**: This plan stands alone and depends on no other plan. Execute phases in order (A → E), one reviewed change per phase. Read every file named in "Current state" before you edit it. Stop if you hit a STOP condition.
>
> **Drift check (first)**: `git diff --stat 92a3dc4..HEAD -- src/main src/shared src/preload src/renderer/src electron-builder.yml package.json e2e/fixtures.ts`. Every code reference names its function, so find it by name if lines have moved.

## Status

- **Priority**: feature; **Effort**: L (phase A done; B–E remain); **Category**: feature/architecture/security
- **Depends on**: nothing
- **Planned at**: `1200c96` (2026-10-01). **Revised** at `92a3dc4` (2026-10-02): the engine is now `webtorrent` with a two-line `connect` hook, not Plexo's own engine. See "Why webtorrent" below.

## Goal

The user pastes a `magnet:` link or a link to a `.torrent` file, or opens a `.torrent` file, and Plexo downloads it over **every enabled network at once**, as it already does for HTTP. Each peer connection is pinned to one network, so the swarm's bandwidth adds up across Wi-Fi, Ethernet and tethered phones. The screens, the network on/off controls, the block grid, pause, resume, and resume after a relaunch behave as they do for HTTP.

Plexo's job is combining networks, not competing with mature BitTorrent engines. webtorrent does the BitTorrent work; Plexo decides which network each peer uses and reports it.

```text
magnet / .torrent ─► probe (parse-torrent, or webtorrent fetching the metadata) ─► safeTorrentPaths()
                                                                         │
DownloadManager.start() ── request.infoHash ──► TorrentTransfer ─► one webtorrent client per download
                                                                         │
           webtorrent finds peers (trackers, DHT, PEX) and, for each one, calls our hook:
           connect({ host, port }) ─► pick a network ─► connectRoute(route, port)  ← existing per-network socket
                                                                         │
           wire 'piece' events ─► bytes per network ─► torrent 'verified' ─► block done, credited per network
```

## Why webtorrent (researched 2026-10-02)

- **Every download manager with torrent support embeds a mature engine.** FDM and Ghost Downloader 3 use libtorrent; Motrix Next/Rayburst, Persepolis and uGet use aria2; Gopeed uses anacrolix/torrent; KGet uses libktorrent. **None of them combines networks for a torrent.**
- **Other routes, rejected:**
  - aria2's `--multiple-interface` binds only by IP address (no `SO_BINDTODEVICE`), which fails on Linux, and it rotates blindly with no figures per network.
  - Node has no usable libtorrent binding. The only recent one, `@weejewel/libtorrent`, has 0 stars and compiles against a libtorrent installed system-wide.
  - A Go engine binary using anacrolix/torrent would work, but it means shipping a second language.
  - Writing Plexo's own engine means competing with mature implementations.
- **webtorrent 3.0.21** is the one mature, maintained Node engine: about 30k downloads a week, last release July 2026. Every outgoing TCP peer connection goes through one call, `net.connect(opts)` in `Torrent._drain()` (`lib/torrent.js`).
- **Proven in a throwaway test:**
  - A two-line patch adds a `connect` client option.
  - Three local seeders and one leecher alternated peers between two source addresses.
  - All three connections went through the hook.
  - The 32 MiB file's SHA-256 matched.
  - The wires' `piece` events credited the bytes to each address: 22.6 MB and 11.0 MB, which sum to the file.

## Decisions (made; change them only by asking)

1. **The engine is `webtorrent@3.0.21` (exact) in `dependencies`, with the `connect` patch carried by `patch-package`:**
   - `index.js` constructor: `this._connect = typeof opts.connect === 'function' ? opts.connect : null`
   - `lib/torrent.js` `_drain()`: `peer.conn = this.client._connect ? this.client._connect(opts) : net.connect(opts)`

   Opening an upstream PR for a `connect` option is a separate step the user decides on. It would also cover webtorrent's open proxy requests, issues #807 and #419.

2. **One webtorrent client per download, plus one client only for probing.** The download's client is created with:
   - `utp: false` (uTP sockets can't be routed)
   - `natUpnp: false` and `natPmp: false`
   - `lsd: false`
   - `webSeeds: false` (webtorrent fetches web seeds over HTTP itself, so they can't be routed)
   - `dht: true`
   - `connect` set to the transfer's hook

   No WebRTC peers are used: Plexo never sets `globalThis.WRTC`. `node-datachannel`, an 8.2 MB native N-API library, is still loaded at import through `simple-peer/lite`, so it ships. Removing it is a later size optimisation.

3. **Choosing the network for each peer** is the hook's whole job, `pickNetwork()` in `torrent/peers.ts`, pure and unit-tested:
   - Pick from the usable networks (status `on` or `unreachable`) that have an address of the peer's IP family, using `routesFor()`.
   - Choose the one with the fewest live peer connections; on a tie, the first in the list.
   - With no network able to route the peer, return a socket that fails at once, the same way `connectRoute` reports a vanished interface.
   - Set `client.maxConns` to `30 × usable networks` in `reconcile()`; webtorrent reads it on every `_drain`. Add the comment `// ponytail: fewest-connections-first; weight by measured speed per network if one is seen starving`.
4. **Incoming peers are dropped** (revised in phase C). They arrive on webtorrent's listening port, routed by the OS, and webtorrent's `wire` event doesn't expose the socket's local address, so nothing can tell which network one used. Only peers Plexo dialled itself, each through its own network, are kept.
5. **Pieces are blocks, and peers are streams.**
   - `BlockState` is a piece, with `blockSizeBytes = pieceLength` and a shorter last piece.
   - `ChunkState` is a peer connection, with `interfaceId` set to its network.
   - Bytes from each wire's `piece` events are held per piece and per network. On the torrent's `verified(index)` event, the piece's length is credited to `bytesByInterface`, split in proportion to what each network delivered, and the block is marked `completed`. Only verified pieces ever count.
6. **Pause destroys the download's client** (the files stay). **Resume**, including after a relaunch, creates a new client and adds the saved `metadata.torrent` with `bitfield` set to the completed blocks, **without** `skipVerify` (revised in phase C).
   - `skipVerify` marks _every_ piece done.
   - Without it, webtorrent trusts the bitfield but hash-checks up to two pieces per file, and re-checks a whole file if one fails. That's cheap, and safe after a relaunch.
   - On `ready`, any piece Plexo had as done that webtorrent didn't confirm goes back to pending, so nothing is published early.
   - webtorrent's own `pause()` is not used, because it only stops new connections.
7. **Upload while downloading, never after.** webtorrent's tit-for-tat runs as normal. At 100% the client is destroyed: no seeding. **Wires on a `usb`-kind network never upload**: on each such wire, `wire.unchoke` is replaced with a no-op before webtorrent can call it.
8. **Disk.**
   - The staging folder is `<destinationDir>/<name>.plexo/`, passed as webtorrent's `path`.
   - At completion, the torrent's top entry (the file, or the folder of a multi-file torrent) is renamed to `<destinationDir>/<name>` with `DownloadFile.publish`'s " (n)" rules, and the staging folder is removed.
   - No copying, and never twice the disk space.
9. **Paths inside a torrent are untrusted input.** `safeTorrentPaths()` (`torrent/paths.ts`) runs at probe time on what webtorrent will write, `file.path` from parse-torrent, after stripping the same reserved characters `fs-chunk-store` strips. The torrent is **refused** if:
   - any path is empty, absolute, or resolves outside the staging folder
   - two files collide when compared case-insensitively
   - on Windows, any segment is a reserved device name (`CON`, `NUL`, `COM1`…)
10. **v2-only torrents are refused** at probe time (no `pieces` in the info dictionary): "This torrent uses BitTorrent v2 only, which Plexo doesn't support yet."
11. **One download at a time stays.** A torrent counts as the one download.
12. **Plexo never makes itself the default magnet handler.** Phase E declares `magnet:` and `.torrent` in packaging and never calls `app.setAsDefaultProtocolClient`.
13. **Privacy.** When a torrent is ready to start, IdleScreen's footer says once: "Peers can see this computer's address on each network in use."

## Current state and conventions

- **Phase A's seam** (`src/main/download/transfer.ts`): a download's fetching sits behind `Transfer`, which has `reconcile()`, `tick(now)`, `running()`, `abort()`, `reset()`, `wake(pick, reconnect)` and `systemResumed(now)`.
  - `TransferTarget` (`state`, `requestPayload`, `blocks`, `file`, `stop`, `speedSamplesByChunk`) is the manager's own runtime object.
  - `TransferHost` gives the transfer `networks`, `reconcile()`, `failDownload()`, `failNetwork()` and `scheduleUpdate()`.
  - `HttpTransfer` (`httpTransfer.ts`) is the only implementation today. `DownloadManager.newRuntime()` builds it.
- **The manager** (`downloadManager.ts`): `start()` plans HTTP blocks inline, and `run()` publishes through `runtime.file.publish()` (`DownloadFile`). The manifest is version 5 with `SavedBlocks` progress.
- **Connections:** `connectRoute(route, port)` (`network/deviceBinding.ts`) returns a `net.Socket` pinned to one network (`SO_BINDTODEVICE` on Linux). `routesFor(iface, remotes)` (`network/routes.ts`) pairs addresses of the same IP family.
- **Probe and IPC:** `probeUrl` (`download/probe.ts`) is exposed in `ipc/handlers.ts`. The IPC surface is typed once in `shared/ipc-contract.ts`, with `ipc-channels.ts` and `preload/index.ts` alongside.
- **Renderer:** `IdleScreen.tsx` probes the link on a debounce and builds the start request; the link placeholder is `"https://"`. `NetworkRow.tsx` says "stream/streams", `BlockGrid.tsx` says "chunks", and `CompleteScreen.tsx` reveals `destinationPath`.
- **Loading code:** main is bundled as CommonJS with dependencies left external. ESM-only packages are loaded with `await import()`, as `koffi` is in `deviceBinding.ts`.
- **Install scripts:** `package.json` `allowScripts` lists the packages allowed to run install scripts. `node-datachannel` needs its `prebuild-install` to fetch its binary.
- **Tests:**
  - `PLEXO_E2E_INTERFACES=a=127.0.0.1,b=<LAN>` fakes the networks (`testKnobs.ts`, `e2e/fixtures.ts`). The fourth field `kind` accepts only `wifi` today.
  - `fast-check` is a devDependency.
  - Pure-logic specs live in `e2e/`.
  - A magnet link may carry `x.pe=host:port` peer addresses (BEP 9), which webtorrent connects to directly, so the e2e tests need no tracker.

## Commands

| Purpose | Command                                                     | Success  |
| ------- | ----------------------------------------------------------- | -------- |
| Full    | `npm run test:e2e`                                          | all pass |
| Static  | `npm run typecheck && npm run lint && npm run format:check` | exit 0   |
| Package | `npm run build:unpack`, then launch the unpacked app        | it runs  |

## Phase A: split the HTTP transfer out of the manager (no behaviour change) — DONE

Built on branch `torrent-phase-a`. What landed, which phases B–C build on:

1. **`src/main/download/transfer.ts`** holds the seam and what both sides share:
   - `Transfer` has seven members: `reconcile()`, `tick(now)`, `running()`, `abort()`, `reset()`, `wake(pick, reconnect)` and `systemResumed(now)`.
   - `TransferTarget` is the slice of the runtime a transfer works on: `state`, `requestPayload`, `blocks`, `file`, `stop` and `speedSamplesByChunk`. It is the manager's own runtime object, so a new `stop` controller for each run is seen at once.
   - `TransferHost` holds the manager's callbacks: `networks`, `reconcile()`, `failDownload()`, `failNetwork()` and `scheduleUpdate()`.
   - The shared helpers moved here unchanged: the speed sampling functions, `updateSpeeds`, `clearSpeeds`, `recomputeAggregates` and `delay`.
2. **`src/main/download/httpTransfer.ts`** (`HttpTransfer`) holds everything the plan listed: streams, attempts, hedges, retries, the stall and slow watchdogs, `ConcurrencyController`, `confirmSameBytes`, the HTTP constants and the HTTP-only runtime fields. The moved code is the same statements in the same order, with only `runtime.x` turned into `this.x`. `traffic()` became `trafficOf()` because it would otherwise clash with the `traffic` field.
3. **`DownloadManager`** keeps lifecycle, network statuses, persistence, updates and publishing. Each run tick calls `transfer.tick(now)`, and `reconcile` ends with `transfer.reconcile()`.
4. **Deliberately left for phase C, where the torrent transfer first needs them:**
   - **The staging file stays with the manager.** Every download has one, so `publish`, `discard` and `beforeResume` weren't added to `Transfer`. Phase C gives `DownloadFile` a folder variant with the same methods (`size`, `sync`, `publish`, `discard`) instead.
   - **The manifest has no `transfer` field yet.** A missing field will mean `'http'`, so adding it in phase C costs nothing.
   - **`start` still plans HTTP blocks inline.** Phase C branches there on `request.infoHash`.

   **Verified**: typecheck, lint and the full e2e suite (174 tests) pass, with no test edited. `downloadManager.ts` went from 2,168 lines to 936.

## Phase B: the engine in, and getting a torrent in (Start stays disabled for torrents) — DONE

> **Built** on branch `torrent-phase-b`. Two differences from the steps below:
>
> - **A `.torrent` file goes through the link field as its path.** The Open button (IPC `chooseTorrentFile`) and a drop on the window (`pathForFile` in the preload) both put the file's path in the field, and `probeUrl` reads any absolute path ending in `.torrent`. So there's no separate `openTorrentFile` probe.
> - **`ProbeResult.torrent`** is one optional object (`infoHash`, `pieceLength`, `files`), not separate fields. `StartDownloadRequest.infoHash` waits for phase C.
>
> **Verified**:
>
> - typecheck, lint and format pass
> - the full e2e suite passes: 187 tests, 174 old plus 13 new in `torrentPaths.spec.ts` and `torrentProbe.spec.ts`
> - **package check**: in `npm run build:unpack`, the packaged binary run in Node mode loads the patched webtorrent from `app.asar` and `node-datachannel` from `app.asar.unpacked`, and downloads through the `connect` hook

1. **Dependencies:**
   - `npm i -E webtorrent@3.0.21 parse-torrent@11.0.24` and `npm i -D -E patch-package`.
   - Add `node-datachannel` to `allowScripts`, and `patch-package` to `postinstall`.
   - Make the Decision 1 patch and save it as `patches/webtorrent+3.0.21.patch`.
2. **`torrent/engine.ts`:** `loadWebTorrent()` loads `webtorrent` once with `await import()`. `createClient({ connect? })` returns a client with Decision 2's options. Nothing else imports `webtorrent`.
3. **Package check:** `npm run build:unpack`, then launch. A torrent probe must work in the packaged app, which proves the ESM import and the `node-datachannel` binary load from the app archive. STOP if they don't.
4. **Types** (`shared/types.ts`):
   - `ProbeResult` gains `kind?: 'torrent'`, `infoHash?`, `files?: { path: string; length: number }[]` and `pieceLength?`. A torrent sets `supportsRanges: true`, `totalBytes` to the sum of its files, and `suggestedFileName` to its name.
   - `StartDownloadRequest` gains `infoHash?: string`.
5. **`torrent/metadata.ts`**, `probeTorrent(input)` for the three ways in:
   - **Magnet link:** add it to the probe client with `deselect: true` and a temporary `path`, wait for `metadata`, take `torrent.torrentFile`, then destroy it along with its store. Only one magnet probe runs at a time; a newer one cancels it. It times out after 3 minutes (shorter in tests, via `testKnobs`) with "No peers found for this magnet link."
   - **Link to a `.torrent`:** `probeUrl` sees `application/x-bittorrent`, or a path ending in `.torrent`, and fetches the body (at most 10 MB).
   - **Local file:** add a new IPC `openTorrentFile(path | null)`. With `null`, it shows an open dialog filtered to `.torrent`.

   Each way in parses with `parse-torrent`, refuses v2-only torrents, and runs `safeTorrentPaths()`. The `.torrent` bytes are kept in a cache keyed by info hash (at most 8 entries) for `start` to use in phase C; the renderer never holds them.

6. **`torrent/paths.ts`:** `safeTorrentPaths()` as Decision 9 says.
7. **IdleScreen:**
   - The placeholder becomes `"https:// or magnet:"`, and there's an "Open .torrent file…" button.
   - A `.torrent` dropped onto the window is opened through `webUtils.getPathForFile` in the preload.
   - "Finding peers…" shows while a magnet probe runs.
   - A torrent result shows its name, total size and "N files", and the privacy line.
   - Every network can be picked, and the streams picker is hidden.
   - **Start is disabled for torrents until phase C**, with the note "Torrent downloads arrive in the next update".
8. **Tests:**
   - `e2e/torrentPaths.spec.ts`: a fast-check property test. For any input, every output is relative, stays inside its base folder, has no empty, `.` or `..` segment, and the outputs are unique; or the call throws.
   - `e2e/torrentProbe.spec.ts`:
     - A `.torrent` served by `Origin` probes to the right name, size and files.
     - A magnet link with `x.pe` pointing at a webtorrent seeder in the test process probes the same way.
     - A local file probes the same way.
     - `../evil` paths and a v2-only torrent are refused.
     - A magnet link with no peers times out.

   **Verify**: the focused specs, the full suite, the static checks, and the package check.

## Phase C: the torrent transfer — DONE

> **Built** on branch `torrent-phase-c`. Differences from the steps below:
>
> - **Decisions 4 and 6 changed** as noted there: incoming peers are dropped, and resume runs without `skipVerify`.
> - **The staging folder is `StagingFolder`, a `DownloadFile` subclass** (`torrent/stagingFolder.ts`). Its `path` is the torrent's top entry, so the manager's publish, sync, discard and restore code works unchanged.
> - **Torrents are marked by `DownloadState.kind: 'torrent'`**, which restore reads, rather than a separate manifest `transfer` field. The `.torrent` is saved as `metadata.torrent` beside the manifest.
> - **A piece shows `downloading` once its first bytes arrive.** Its bytes count only on `verified`, split across networks by `creditPiece()`.
> - **The test swarm uses a local tracker** (`e2e/torrentSwarm.ts`) rather than `x.pe`. The USB test has an Ethernet control run, showing the same setup does upload when the network isn't USB.
> - **`checkEvents`** keeps its HTTP stream rules (one stream per block) for HTTP downloads only; for torrents it checks that every peer is on a known network. **`checkFinalState`** hashes a published folder with `treeSha`.
>
> **Verified**:
>
> - typecheck, lint and format pass
> - the full e2e suite passes; 7 download scenarios run in `torrent.spec.ts`

9. **`torrent/peers.ts`:** `pickNetwork()` (Decision 3) and `networkForLocalAddress()` (Decision 4), both pure, with unit tests in `e2e/torrentPeers.spec.ts`.
10. **`torrent/torrentTransfer.ts`** (`class TorrentTransfer implements Transfer`):
    - The run starts by creating the client, whose `connect` is the hook that calls `pickNetwork()` then `connectRoute()`, and adding the torrent (Decision 6).
    - **Each wire:** find its network (from the hook's address map, or the local address for incoming peers), record a `ChunkState`, apply the USB rule (Decision 7), and count `piece` bytes per network.
    - **`verified(index)`:** credit the piece (Decision 5).
    - **`reconcile()`:** set `client.maxConns`, and destroy the wires of networks that are off or offline.
    - **`tick()`:** refresh peer speeds and statuses. A network is `unreachable` when 5 or more of its connection attempts got no handshake in 60 s while other networks have peers.
    - **`wake()` and `systemResumed()`:** destroy the chosen networks' wires; webtorrent redials through the hook.
    - **`abort()`:** destroy the client.
    - **`running()`:** a promise that settles when the client is destroyed.
11. **The manager** creates a `TorrentTransfer` when `request.infoHash` is set:
    - it writes `metadata.torrent` beside the manifest
    - it adds `transfer: 'torrent'` to the manifest (a missing field means HTTP)
    - the staging folder and its publication follow Decision 8, through a folder variant of `DownloadFile` with the same `size`, `sync`, `publish` and `discard`
    - `start` calls `ensureDiskSpace` with the torrent's total size
12. **Tests** (`e2e/torrent.spec.ts`, with seeders in the test process reached through `x.pe` or `addPeer`):
    - single-file and multi-file torrents finish with each file's SHA-256 exact
    - with two networks, both deliver bytes
    - switching a network off mid-download leaves the rest to the other
    - pause, quit, relaunch and resume finishes without re-downloading the completed pieces
    - a peer on a `usb`-kind network is never unchoked (extend `testKnobs` so `kind` accepts `usb`)
    - nothing is written outside the staging folder

    **Verify**: as for phase B.

## Phase C2: choosing files — DONE

> **Built** on branch `torrent-phase-c2`, as follows:
>
> - **Choosing.** `StartDownloadRequest.selectedFiles` holds the chosen indexes, and is left out when every file is chosen. It's saved in the manifest with the rest of the request. `chosenFiles()` (`torrent/files.ts`) refuses an empty choice or an index that isn't in the torrent.
> - **Skipped pieces.** Pieces that only unchosen files need get a new block status, **`skipped`**, from `wantedPieces()`. They're recomputed on every start and restore, so the saved-progress format is unchanged.
> - **The manager** counts `skipped` as done (`isDone`), so completion, publishing and restore all treat it that way. `DownloadState.skippedBytes` lets the screens count progress against what was chosen (`wantedBytes()` in the renderer), while `totalBytes` stays the torrent's full size, which restore needs to rebuild the blocks.
> - **Disk.** The disk-space check counts only what's chosen, since skipped files are sparse. At publication `StagingFolder` removes the unchosen files (partly written by pieces at their edges) and any folders that leaves empty.
> - **Start screen.** A checklist with an "All files" box. The size shown is what will be fetched, and Start needs at least one file.
> - **Tests.** A property test of `wantedPieces` against a plain-definition reference, a download of chosen files only, the choice surviving a quit/relaunch/resume, and the checklist on the start screen.

13. A torrent with more than one file shows a checklist before Start, with everything checked. Unchecked files are `deselect()`ed. webtorrent still fetches pieces that cross into an unchecked file, and the bytes of those pieces stay in the staging folder and are removed at publication. Saved with the manifest, so a resume keeps the choice. Tests: a deselected file never appears in the destination, and the selected files are exact.

## Phase D: wording and screens — DONE

> **Built** on branch `torrent-phase-d`, as follows:
>
> - **Network rows** (`NetworkRow`, `peers` prop): "N peers", "Peer #N", and the badge reads "Piece #K". A peer row shows "—" for percent and what that peer has sent, since a piece counts only once verified and several peers may send parts of it. "Can't reach server" becomes "Can't reach peers".
> - **Block grid** (`BlockGrid`, `pieces` prop): "Piece #N" and "N pieces".
> - **Downloading screen**: the total peer count beside the progress.
> - **Complete screen**: "Peers" in place of "Streams", and "written in N pieces", counting only the pieces the chosen files needed. The subtitle carries "3 files", or "2 of 4 files" when some were skipped, from the new `DownloadState.files` (`{ chosen, total }`, set at start).
> - **Reveal** shows the published folder for a multi-file torrent, unchanged, since `showItemInFolder` works on folders.
> - **Tests**: `ui.spec.ts` has a full torrent journey through the UI (open a `.torrent`, untick a file, start, see peers and pieces, finish with "2 of 3 files"), and the HTTP journey now checks that HTTP keeps "streams" and "chunks".

14. When `state.kind === 'torrent'`:
    - `NetworkRow` says "peer/peers", and `BlockGrid` says "pieces".
    - The Downloading screen shows the total peer count.
    - `CompleteScreen` reveals the folder of a multi-file torrent and says "N files".

    The HTTP wording stays unchanged. Extend `e2e/ui.spec.ts` to cover both.

## Phase E: open magnet links and `.torrent` files from the OS

15. **Single instance:** call `app.requestSingleInstanceLock()`. On `second-instance`, restore and focus the window.
16. **Links from the OS:**
    - Collect links from `open-url`, `open-file`, `second-instance` argv and the first launch's `process.argv`.
    - Keep only `magnet:` links and existing `.torrent` paths.
    - Store the newest as `pendingLink`, push `linkReceived` to the renderer, and add an invoke `takePendingLink` (pull on mount, push afterwards).
    - The renderer puts the link in the draft, and the user clicks Start.
    - While a download is active, show a notification instead: "Plexo is busy. Finish or remove the current download first."
17. **Packaging** (`electron-builder.yml`): add `protocols: magnet` and `fileAssociations: torrent` (role Viewer). Never call `setAsDefaultProtocolClient`.
18. **Tests:**
    - argv with a `.torrent` fills the draft.
    - A second launch with a magnet link focuses the first window and fills its draft.
    - The parallel e2e launches still work.
    - Manual check on each OS.

## Docs (last)

README section "Torrents":

- the ways in
- every network is used
- upload happens only while downloading, never over USB-tethered networks, and there's no seeding after completion
- peers can see each network's address
- v2-only torrents aren't supported

## Scope

**In scope:**

- `src/main/download/**` (new `torrent/*`)
- `src/main/{index,testKnobs}.ts`, `src/main/ipc/handlers.ts`
- `src/shared/*`, `src/preload/index.ts`
- the renderer screens and components named above
- `electron-builder.yml`, `package.json`, `patches/`
- `e2e/`
- `README.md`

**Out of scope:**

- seeding after completion
- uTP
- WebRTC peers
- web seeds. This is the best follow-up: Plexo's HTTP transfer could fetch pieces from web seeds over every network.
- v2-only torrents
- creating torrents
- several downloads at once
- being the default magnet handler
- removing `node-datachannel` from the package

## STOP conditions

- An outgoing peer socket is opened without the hook, so without `connectRoute()`. Check: `net.connect` is reached only through the patched `_drain`, and uTP and web seeds stay off.
- A torrent path reaches the disk without `safeTorrentPaths()`, or a write lands outside the staging folder.
- Plexo uploads after completion, or unchokes a wire on a `usb`-kind network.
- The packaged build can't load `webtorrent` or `node-datachannel`.
- `patch-package` fails to apply after an install. Never upgrade webtorrent without redoing the patch and the hook test.

## Maintenance note

- Every new kind of download is a `Transfer`. Shared behaviour belongs in `DownloadManager`.
- Only `torrent/engine.ts` imports `webtorrent`.
- Every outgoing peer connection goes through the `connect` hook, so through `connectRoute()`.
- Every torrent path goes through `safeTorrentPaths()`.
- Keep `webtorrent` at an exact version: the patch is tied to it.
