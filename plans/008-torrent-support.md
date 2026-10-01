# Plan 008: Download torrents across every network

> **Executor instructions**: This plan stands alone and depends on no other plan. Execute phases in order (A → E), one reviewed change per phase. Each phase ships on its own. Read every file named in "Current state" before you edit it. Stop if you hit a STOP condition.
>
> **Drift check (first)**: `git diff --stat 1200c96..HEAD -- src/main src/shared src/preload src/renderer/src electron-builder.yml package.json e2e/fixtures.ts e2e/origin.ts`. Line numbers below are at `1200c96`; every reference also names its function, so find it by name if the lines have moved.

## Status

- **Priority**: feature; **Effort**: XL (five phases); **Fix risk**: MEDIUM-HIGH (phase A moves most of `downloadManager.ts`); **Category**: feature/architecture/security
- **Depends on**: nothing
- **Planned at**: `1200c96`, 2026-10-01

## Goal

The user pastes a `magnet:` link, a link to a `.torrent` file, or opens a `.torrent` file, and Plexo downloads it over **every enabled network at once**, the same way it combines networks for HTTP today. Each peer connection is pinned to one network, so the swarm's bandwidth adds up across Wi-Fi, Ethernet and tethered phones. The screens, the network on/off controls, the block grid, pause, resume, and resume after a relaunch all behave as they do for an HTTP download.

```text
magnet / .torrent ─► metadata (ut_metadata or parse-torrent)
                       │
torrent-discovery ─────┼─► peer addresses ─► peer pool ─► assign each peer to ONE network
(trackers, DHT, PEX)   │                                        │
                       │                 connectRoute(route, peerPort)  ← existing per-network socket
                       │                                        │
                       └─► picker (rarest first, endgame) ◄─ bittorrent-protocol Wire
                                        │
                     piece complete ─► SHA-1 check ─► write at file offsets ─► block grid colours
```

## Decisions (made; change them only by asking)

1. **Build on the WebTorrent project's protocol packages, not on `webtorrent` itself, and not from scratch.**
   - Runtime dependencies, exact versions:
     - `bittorrent-protocol@5.0.9`: the wire protocol, a duplex stream
     - `torrent-discovery@11.0.21`: trackers and DHT
     - `parse-torrent@11.0.24`: `.torrent` files and magnet links
     - `ut_metadata@5.0.1`: fetching a magnet's metadata from peers
     - `ut_pex@5.0.2`: peer exchange
   - Measured on 2026-10-01: the set comes to 103 packages and 17 MB, with no required native code (`bufferutil` and `utf-8-validate` are optional). All are MIT, ESM-only, and published in 2026.
   - `webtorrent@3.0.21` is rejected for runtime use. Its `lib/torrent.js:2125` calls `net.connect(opts)` directly, so its peers can't be pinned to a network without forking it. It also adds 176 packages and 37 MB, including native `utp-native` (unchanged since 2022) and `fs-native-extensions`, a listening server, UPnP, and its own piece scheduler and storage. It **is** allowed as a devDependency, as a real-client seeder in e2e.
   - Writing BitTorrent from scratch is rejected: bencode, the wire protocol, extensions, trackers and DHT are months of compatibility work that doesn't help Plexo's actual feature.
2. **Every peer connection goes through `connectRoute()`** (`src/main/network/deviceBinding.ts:67`). One peer connects over exactly one network, never two. Clients reject a duplicate peer ID anyway. Trackers, DHT and metadata fetching use the default route.
3. **One manager, two transfers.** `DownloadManager` keeps everything both kinds share: the runtimes map, manifests, updates, network list and statuses, pause, resume, cancel, keeping the computer awake, notifications and publishing. The HTTP stream and attempt machinery moves to `httpTransfer.ts` (phase A, no behaviour change). The torrent engine is `torrentTransfer.ts`. There is no second manager and no second IPC surface.
4. **Pieces are blocks, and peers are streams.**
   - `BlockState` is a piece: `bytesByInterface` per piece colours `BlockGrid` by network unchanged.
   - `ChunkState` is a peer connection, with `interfaceId` set to its network. While the peer is fetching a piece, `rangeStart`/`rangeEnd` are that piece's range. While it fetches nothing, they are `0`/`null`. `hedge: true` marks a peer racing in endgame.
   - `DownloadUpdate` already sends only the blocks that changed, so torrents with 100k pieces are fine.
5. **A piece counts only once its SHA-1 matches.** Pieces are assembled in memory, hashed with `node:crypto`, and only then written. A partly received piece is dropped on pause, which costs at most one piece per active peer. Torrents that are v2-only (BEP 52, no `pieces` field) are refused with "This torrent uses BitTorrent v2 only, which Plexo doesn't support yet." Hybrid torrents use their v1 hashes.
6. **Upload while downloading, never after.**
   - Peers choke a client that never uploads, so Plexo answers requests over the connections it already has, using standard tit-for-tat: unchoke the 4 peers that gave the most in the last 10 s, plus one optimistic unchoke every 30 s.
   - There's no listening port and no UPnP or NAT-PMP.
   - Seeding stops at 100%, and the download completes like an HTTP one.
   - **Peers on a `usb`-kind network are never unchoked**, because tethered data is metered.
7. **All files are downloaded.** There's no file selection in this plan.
8. **Disk layout.**
   - A single-file torrent stages as `<name>.plexo` and is published by rename, exactly like HTTP.
   - A multi-file torrent stages as the folder `<name>.plexo/`, with every file at its final relative path, and is published by one `rename` of the folder to `<name>`, using the same " (1)" suffix rules as `DownloadFile.publish` (`downloadFile.ts`). There is no copying, and it never needs twice the disk space.
9. **File paths inside a torrent are untrusted input.** One function, `safeTorrentPaths()`, turns the torrent's `name` and every file path into safe relative paths before anything touches the disk:
   - It splits on `/` and `\`, then drops empty, `.` and `..` segments.
   - It replaces `<>:"|?*`, control characters, and trailing dots and spaces with `_`.
   - It prefixes Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, with any extension) with `_`.
   - It shortens each segment to 255 bytes, keeping the extension.
   - An empty `name` becomes the info hash.
   - It **refuses** the torrent if two files end up with the same path compared case-insensitively, or if any final path resolves outside the staging folder.
   - `parse-torrent` already strips `..` by joining from the root, but it does not do the rest.
10. **One download at a time stays.** A torrent counts as the one download (`hasActiveDownload`, `downloadManager.ts:639`).
11. **Plexo never makes itself the default magnet handler.** Phase E declares `magnet:` and `.torrent` in the app's packaging so the OS can offer Plexo, but it never calls `app.setAsDefaultProtocolClient`, which would take links away from a client the user already has.
12. **Privacy.** When a torrent is ready to start, IdleScreen's footer says once: "Peers can see this computer's address on each network in use."

## Current state and conventions

- **The download manager is `src/main/download/downloadManager.ts`** (2,168 lines at `1200c96`). The runtime type `DownloadRuntime` (`:131`) mixes shared state with HTTP-only state (`chunkRuntimes`, `workers`, `attempts`, `hedgesByBlock`, `acceptedVersions`, `refreshesByBlock`, `avoidNetworkByBlock`, `traffic`, `holdUntil`, `concurrency`). The manifest is `PersistedDownload` (`:189-206`, version 5), and the blocks are saved by `savedProgress.ts`.
- **The key methods:**
  - `start` (`:648`) resolves the host, plans blocks, reserves the destination and starts `run`.
  - `run` (`:1013`) ticks every 500 ms, calls `reconcile`, and when every block is complete publishes through `runtime.file.publish` (`:1058`).
  - `reconcile` (`:1135`): the top half keeps the network list and statuses; the bottom half, from `const canSplit`, starts and retires HTTP streams.
  - `pause` (`:729`), `resume`, `resumeAfterVerifying` (`:769`), `setNetworkEnabled` (`:834`), `networksChanged` (`:867`) and `systemResumed` mix shared state changes with HTTP stream handling (`wake`, `chunkRuntimes`).
- **Connections:** `connectRoute(route, port)` (`deviceBinding.ts:67`) returns a `net.Socket` bound to one network. `routesFor(iface, remotes)` (`routes.ts:43`) picks the local address with the same IP family as the remote.
- **Disk:** `DownloadFile` (`downloadFile.ts`) writes at explicit offsets (`writer(position)`) and publishes by rename with a " (n)" suffix loop. `reserveDestinationPath` (`paths.ts:55`) claims the final name. `ensureDiskSpace` is at `downloadManager.ts:454`.
- **Probe:** `probeUrl` (`probe.ts:131`) is exposed at `ipc/handlers.ts:136`. `startDownload` is at `handlers.ts:155`. Types are in `shared/types.ts` (`ProbeResult`, `StartDownloadRequest`, `DownloadState`, `ChunkState`, `BlockState`). The IPC surface is typed once in `shared/ipc-contract.ts`, with `ipc-channels.ts` and `preload/index.ts` alongside.
- **Renderer:**
  - `IdleScreen.tsx` probes the link on a debounce (`:99`) and builds the start request (`:199`). The link placeholder is `"https://"` (`:234`).
  - `NetworkRow.tsx:148` says "stream/streams".
  - `BlockGrid.tsx:207` says "chunks".
  - `CompleteScreen.tsx:44` reveals `destinationPath`.
- **Main entry:** `src/main/index.ts` has no single-instance lock and no `open-url` or `open-file` handling. `electron-builder.yml` has no `protocols` or `fileAssociations`.
- **Loading code:** main is bundled as CommonJS with dependencies left external. `koffi` is already loaded with a dynamic `await import('koffi')` (`deviceBinding.ts`). The torrent packages are ESM-only and must be loaded the same way.
- **Tests:**
  - `PLEXO_E2E_INTERFACES=a=127.0.0.1,b=<LAN>` fakes the networks (`testKnobs.ts:46`, `e2e/fixtures.ts:35-43`). The fourth field `kind` accepts only `wifi` today.
  - `e2e/origin.ts` is the HTTP test server. `fast-check` is already a devDependency.
  - Pure-logic specs such as `plan.spec.ts` and `scheduler.spec.ts` live in `e2e/`.

## Commands

| Purpose | Command                                                     | Success  |
| ------- | ----------------------------------------------------------- | -------- |
| Full    | `npm run test:e2e`                                          | all pass |
| Static  | `npm run typecheck && npm run lint && npm run format:check` | exit 0   |
| Package | `npm run build:unpack`, then launch the unpacked app        | it runs  |

Each phase names its own focused spec.

## Phase A: split the HTTP transfer out of the manager (no behaviour change)

1. **Add the seam** in a new `src/main/download/transfer.ts`. Start from this, and keep it this small. Add a member only when moving the code needs it.

   ```ts
   export interface Transfer {
     /** Brings its connections in line with the networks that may carry traffic now. */
     reconcile(usable: DownloadNetwork[]): void
     /** Called every run tick: watchdogs, sizing. */
     tick(now: number): void
     /** Drops every connection; resolves when all have settled. */
     stop(): Promise<void>
     /** Networks changed or the computer woke: get connections going again. */
     wake(pick: (networkId: string) => boolean, reconnect: (networkId: string) => boolean): void
     /** Anything to check before a resume (HTTP: the file still exists). */
     beforeResume(): Promise<string | null>
     /** Moves the finished bytes into place; returns the published path. */
     publish(
       destinationPath: string,
       beforeAttempt: (candidate: string) => Promise<void>
     ): Promise<string>
     discard(): Promise<void>
   }
   ```

2. **Move to `httpTransfer.ts`** (`class HttpTransfer implements Transfer`):
   - Methods: `wake`, `backOff`, the bottom half of `reconcile` (from `const canSplit`), `liveStreams`, `traffic`, `startStreams`, `adjustStreams`, `refreshStuckConnections`, `markUnreachable`, `isSilent`, `isCrawling`, `abortAttempt`, `attemptPosition`, `otherAttemptsPosition`, `goIdle`, `beginAttempt`, `endAttempt`, `executeAttempt`, `onNetworkProgress`, `onAttemptProgress`, `finishAttempt`, `finishCompleted`, `finishStopped`, `finishAborted`, `finishFailed`, `letGo`, `concurrencySnapshot`, `addStreams`, `retireStreams`, `removeStream`, `runWorker`, `confirmSameBytes`.
   - The HTTP constants: retry, slow, silent, hedge and `SCHEDULER_POLICY`.
   - The HTTP-only runtime fields listed under "Current state", and `file: DownloadFile`.

   The transfer reaches back into the manager only through a small `host` object passed to its constructor: `state`, `blocks`, `scheduleUpdate()`, `persist()`, `failDownload(message, discard?)`, `failNetwork(network, message)`, `notify(title, body)`.

3. **Stay in `DownloadManager`:**
   - `restorePersistedDownloads`, `getCurrentDownload`, `hasActiveDownload`, and `start`. `start` builds the transfer; the HTTP-specific parts (host resolution, `planDownload`) move behind a `createHttpTransfer(request)` call.
   - `pause`, `resume` and `resumeAfterVerifying`, which call `transfer.stop()` / `transfer.beforeResume()`.
   - `setNetworkEnabled`, `networksChanged`, `systemResumed`, `keepAwake`, `cancel`, `remove` and `suspendAll`.
   - `run`, the tick loop, which calls `transfer.tick` and `transfer.publish`, then completes.
   - `stopRun`, `failDownload`, `failNetwork`, `network`, the top half of `reconcile` (it then calls `transfer.reconcile(usable)`), `notify`, `recomputeAggregates`, `scheduleUpdate`, `pushUpdate`, `takeUpdate`, `schedulePersistence`, `persistNow` and `removePersistedDownload`.
   - The speed helpers (`updateSpeeds`, `sampleSpeeds`, `clearSpeeds`) and `speedSamplesByChunk`, because peers have speeds too.

4. **Manifest:** add `transfer: 'http' | 'torrent'` to `PersistedDownloadBase`. A missing field means `'http'`, so existing manifests load unchanged. Keep `version: 5`.

5. **Where a method mixes both kinds**, split it at that line. The split is mechanical: the same statements run in the same order.

   **Verify**: the full suite and the static checks pass, with **no test edited** apart from import paths. Also `wc -l src/main/download/downloadManager.ts` should come in under 1,000.

## Phase B: torrent metadata and getting a torrent in (no transfer yet)

6. **Dependencies:** `npm i -E bittorrent-protocol@5.0.9 torrent-discovery@11.0.21 parse-torrent@11.0.24 ut_metadata@5.0.1 ut_pex@5.0.2` and `npm i -D -E webtorrent@3.0.21`. Load every one of them with `await import()` inside `src/main/download/torrent/`, never with a top-level `import`. Run `npm run build:unpack` and check that a packaged build can load them before going further.

7. **Types** (`shared/types.ts`):
   - `ProbeResult` gains `kind: 'http' | 'torrent'` and, for torrents, `infoHash: string`, `files: { path: string; length: number }[]` (already made safe) and `pieceLength: number`. A torrent sets `supportsRanges: true` and `totalBytes` to the sum of its files.
   - `StartDownloadRequest` gains `infoHash?: string`.
   - `DownloadState` gains `kind?: 'torrent'` and `fileCount?: number`.

8. **Metadata cache** (`src/main/download/torrent/metadata.ts`):
   - The main process keeps a `Map<infoHash, Buffer>` of probed info dictionaries, holding at most 8 entries with the oldest dropped first.
   - `start` looks the torrent up by `infoHash` and writes it to `<userData>/downloads/<id>/metadata.torrent`, so a resume never needs peers to rebuild it. The renderer never holds the bytes.

9. **Ways in.** All three give the same `ProbeResult`:
   - **Magnet link:** `probeUrl` sends `magnet:` links to `probeMagnet`.
     - It runs `torrent-discovery` and `ut_metadata` over the default route and checks the fetched info dictionary against the info hash, which `ut_metadata` does.
     - At most one magnet probe runs at a time. A new `probeUrl` or `startDownload` call aborts the previous one, which also destroys its discovery and wires.
     - After 3 minutes with no metadata it fails with "No peers found for this magnet link."
   - **Link to a `.torrent`:** the existing HTTP probe runs first. If the response is `application/x-bittorrent`, or the path ends in `.torrent`, and it's under 10 MB, fetch the body and parse it as a torrent.
   - **Local file:** add a new IPC `openTorrentFile(path: string | null)`. With `null`, it shows an open dialog filtered to `.torrent`. IdleScreen gets an "Open .torrent file…" text button and accepts a `.torrent` dropped onto the window (`webUtils.getPathForFile` in the preload).

10. **Safe paths** (`src/main/download/torrent/paths.ts`): implement `safeTorrentPaths(name, files)` exactly as Decision 9 says. Every way in runs it inside the probe, so an unsafe torrent fails at the probe with a clear message.

11. **IdleScreen:**
    - The placeholder becomes `"https:// or magnet:"`. A link starting with `magnet:` is trimmed and probed like any other.
    - While a magnet probe runs, the label is "Finding peers…".
    - A torrent result shows its name, total size and "N files".
    - Every network can be picked; the single-network rule for unsplittable HTTP doesn't apply. The streams picker is hidden.
    - The footer shows the privacy line from Decision 12.

12. **Tests** (`e2e/torrentPaths.spec.ts` and `e2e/torrentProbe.spec.ts`):
    - Property test (fast-check) for `safeTorrentPaths`. For arbitrary segment arrays, including `..`, `/`, `\`, NUL, reserved names and long Unicode, each output path is relative, resolves inside a base folder, has no empty or `.`/`..` segment, has every segment at most 255 bytes, and the outputs are unique, or the call throws on a collision.
    - Probing a `.torrent` served by `Origin` returns `kind: 'torrent'` with the right files and size. A torrent with `../evil` paths is refused, and a v2-only torrent is refused.
    - A magnet probe against a local tracker and seeder (step 18) returns the metadata. A magnet with no peers fails after the timeout; shorten it with a `testKnobs` entry.

    **Verify**: the focused specs, the full suite, and the static checks.

## Phase C: the torrent transfer

All new code goes in `src/main/download/torrent/`.

13. **`storage.ts`:**
    - Map a piece to its file ranges (`{ fileIndex, offset, length }[]`).
    - At start, create the staging file, or the staging folder with every file inside it, each truncated to its length so it's sparse.
    - `writePiece(index, buffer)` writes each range at its offset. `readBlock(index, offset, length)` reads ranges back for uploads.
    - `sync()` fsyncs every open file before each checkpoint and before publishing.
    - `publish()` renames the staging file or folder (Decision 8). Generalise `DownloadFile.publish`'s name loop so it works on a folder rather than duplicating it.
    - Open files with a small handle cache: at most 64 open, least recently used closed first.

14. **`picker.ts`** (pure, unit-tested):
    - Rarest first among the pieces the peer has and we don't, with random tie-breaks.
    - A peer finishes a started piece before beginning a new one.
    - Requests are 16 KiB blocks, with up to 32 outstanding per peer.
    - In endgame (every remaining block requested), request the remaining blocks from every unchoked peer that has them, and `cancel` the duplicates when one arrives.
    - At most `max(8, floor(256 MiB / pieceLength))` pieces are in flight at once, which bounds memory.
    - A block request unanswered for 30 s goes back to the pool.

15. **`peers.ts`, the network assignment:**
    - Discovered addresses (from `torrent-discovery` and `ut_pex`) go into one queue, without duplicates.
    - On each tick, each usable network opens connections from the queue until it has **30** connected or connecting peers.
    - The route is `routesFor(iface, [{ address, family }])[0]`. When a network has no route of that IP family, the address stays in the queue for another network.
    - `socket = connectRoute(route, port)`, then `socket.pipe(wire).pipe(socket)`, `wire.use(ut_pex)` and `wire.handshake(infoHash, peerId, { dht: true })`.
    - A peer that fails to connect or handshake waits 5 minutes before it's tried again, on any network.
    - The peer ID is `-PX` + major/minor version digits + `-` + 12 random bytes.
    - Add the comment `// ponytail: fixed 30 peers per network; size it by throughput (concurrency.ts) if one network is measured starving` above the constant.

16. **`torrentTransfer.ts`** (`class TorrentTransfer implements Transfer`):
    - `reconcile(usable)` destroys the wires of networks that left `usable` and lets the next tick fill the ones that joined.
    - Every peer is a `ChunkState` (Decision 4) with `interfaceId` set to its network.
    - A network's status:
      - `on` while it has at least one handshaken peer, or the swarm has none to give
      - `unreachable` when it has made at least 5 connection attempts and none handshook in 60 s while other networks did
      - `failed` is not used for torrents
    - **A verified piece:** credit its bytes to `bytesByInterface` by the network that delivered each block, mark the block `completed`, send `have` to every peer, and schedule an update and a checkpoint.
    - **A piece whose hash fails:** discard it, add 1 to `retries` on every network that delivered part of it, and ban every peer that sent part of it for the rest of the download.
    - **Upload** follows Decision 6. Peers on `usb`-kind networks stay choked.
    - `stop()` destroys every wire and the discovery.
    - `beforeResume()` checks that the staging file or folder exists, and returns the same "partial download file is unavailable" message as HTTP.
    - Saving uses the existing `saveBlocks`/`restoreBlocks`, and only verified pieces ever have bytes. On restore the manifest's `transfer: 'torrent'` creates a `TorrentTransfer` from `metadata.torrent`.
    - `start` calls `ensureDiskSpace` with the torrent's total size.

17. **The manager** creates a `TorrentTransfer` when `request.infoHash` is set. The block size is `pieceLength`, and the last piece may be shorter. `fileName` is the torrent's safe name.

18. **e2e harness** (`e2e/torrentSwarm.ts`):
    - Start a `bittorrent-tracker` `Server` on 127.0.0.1, which comes in through `torrent-discovery`.
    - Start 1–3 `webtorrent` seeders that seed `seededBytes` files, each announcing only to that tracker with `dht: false, lsd: false`.
    - Add a "corrupt seeder", a small `bittorrent-protocol` server that serves wrong bytes for one piece.
    - Extend `testKnobs.testInterfaces` so the `kind` field also accepts `usb`.

19. **Tests** (`e2e/torrent.spec.ts`):
    - A single-file and a multi-file torrent complete, and each file's SHA-256 is exact.
    - With two networks, both networks have delivered bytes (`bytesByInterface`).
    - Switching one network off mid-download moves the work to the other, and the file is still exact.
    - Pause, quit, relaunch and resume finishes the download, and the seeders upload fewer bytes in total than the file's size times 1.1.
    - With the corrupt seeder present, the file is exact, the corrupt peer is banned, and `retries` is greater than 0.
    - A peer on a `usb`-kind network is never unchoked: the seeder's `wire.peerChoking` toward Plexo stays true.
    - Nothing is written outside the staging folder: list the destination folder before and after.

    **Verify**: the focused spec, the full suite, the static checks, and the package check.

## Phase D: wording and screens

20. When `state.kind === 'torrent'`:
    - `NetworkRow` says "peer/peers" instead of "stream/streams", and `BlockGrid`'s readout says "pieces" instead of "chunks".
    - The Downloading screen shows the total peer count.
    - `CompleteScreen` reveals the folder for a multi-file torrent and says "N files".

    The HTTP wording stays unchanged. Extend `e2e/ui.spec.ts` to cover both.

## Phase E: open magnet links and `.torrent` files from the OS

21. **Single instance:** call `app.requestSingleInstanceLock()` first; the second instance quits. On `second-instance`, restore and focus the window.
22. **Links from the OS:**
    - Collect links from `open-url` (macOS `magnet:`), `open-file` (macOS `.torrent`), `second-instance` argv, and the first launch's `process.argv` (Windows and Linux).
    - Keep only `magnet:` links and existing `.torrent` paths.
    - Store the newest as `pendingLink`, push `linkReceived` to the renderer, and add an invoke `takePendingLink` (pull on mount, push afterwards), so a link that arrives on a cold start isn't lost.
    - The renderer puts it in the draft, and the user clicks Start.
    - If a download is active, show a `Notification`: "Plexo is busy. Finish or remove the current download first." The link is dropped.
23. **Packaging** (`electron-builder.yml`): add `protocols: [{ name: Magnet link, schemes: [magnet] }]` and `fileAssociations: [{ ext: torrent, name: Torrent, role: Viewer }]`. Don't call `setAsDefaultProtocolClient` (Decision 11).
24. **Tests:**
    - Launching with a `.torrent` path in argv fills the draft.
    - A second launch with a magnet link focuses the first window and fills its draft.
    - The parallel e2e launches, each with its own userData, still work under the lock.
    - **Manual on macOS, Windows and Linux:** clicking a magnet link in a browser offers Plexo, and double-clicking a `.torrent` file opens it.

## Docs (last)

Add a README section "Torrents":

- the three ways in
- downloads use every network
- upload happens only while downloading, and never over USB-tethered networks
- there's no seeding after completion
- peers can see each network's address
- v2-only torrents and file selection aren't supported yet

## Scope

**In scope**:

- `src/main/download/**` (new `transfer.ts`, `httpTransfer.ts`, `torrent/*`)
- `src/main/index.ts`, `src/main/ipc/handlers.ts`, `src/main/testKnobs.ts`
- `src/shared/{types,ipc-contract,ipc-channels}.ts`, `src/preload/index.ts`
- `src/renderer/src/{App.tsx,store/useAppStore.ts,screens/IdleScreen.tsx,screens/DownloadingScreen.tsx,screens/CompleteScreen.tsx,components/NetworkRow.tsx,components/BlockGrid.tsx}`
- `electron-builder.yml`, `package.json`
- `e2e/` (the new specs and `torrentSwarm.ts`)
- `README.md`

**Out of scope**:

- Choosing files
- Seeding after completion
- Listening for incoming peers, and UPnP or NAT-PMP
- uTP
- WebRTC peers
- Web seeds (BEP 19). This is the best follow-up: Plexo's HTTP transfer could fetch pieces from web seeds over every network.
- v2-only torrents
- Creating torrents
- Several downloads at once
- Making Plexo the default magnet handler

## STOP conditions

- Phase A needs any test edited beyond import paths, or changes the order of any observable step. Report what moved instead.
- Any peer socket is opened without `connectRoute()`, or one peer is connected over two networks.
- Any write lands outside the staging file or folder, or a torrent path reaches the disk without going through `safeTorrentPaths()`.
- A piece is written, counted or saved before its hash matches.
- Plexo uploads after completion, or unchokes a peer on a `usb`-kind network.
- The packaged build can't load the ESM packages through `await import()`.
- `webtorrent` ends up in `dependencies` rather than `devDependencies`.

## Maintenance note

- Every new kind of download is a `Transfer`. Shared behaviour belongs in `DownloadManager`, never copied into a transfer.
- Every outgoing peer connection goes through `connectRoute()`.
- Every path that comes from a torrent goes through `safeTorrentPaths()`.
- When upgrading the torrent packages, re-check that `bittorrent-protocol`'s `Wire` still accepts any duplex stream, and keep the versions exact.
