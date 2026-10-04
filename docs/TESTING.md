# Testing Plexo without real downloads

Everything here uses a fake file server on your own computer. Nothing touches the internet.

## 1. Start the fake server

```
node scripts/fake-server.mjs          # port 8099 (or: node scripts/fake-server.mjs 8199)
```

It prints a control page and sample links for every address of this computer. Open
`http://127.0.0.1:8099/` in a browser. There you can:

- drag a speed slider per network, live, while a download is running (Unlimited / Block buttons too);
- press a scenario button (table below);
- copy a list of links of mixed sizes (pick the host, how many links, then "copy all").

Any path is a file of zeros: `http://127.0.0.1:8099/anything.rar?mb=200`. Options on the link:
`&kbps=500` caps each connection, `&fail=2` answers 500 to the first 2 requests of that link,
`&norange=1` makes a server that can't resume or split.

The server tells networks apart by the `X-Plexo-Network` header (fake-network copy) or, in the real
app, by the source address (Wi-Fi 192.168.x.x versus the VPN tunnel 198.18.x.x). A network only
shows on the page after its first request, so start one download on each network before pressing a
scenario. (Scenarios use "the first / second network seen"; or add `?a=<name>&b=<name>` to
`/__scenario?name=...`.)

## 2. Two ways to run Plexo

- **Fake networks** (dev copy, separate settings folder): `scripts/dev-fake-networks.sh`.
  Gives you Wi-Fi, Ethernet, Phone (USB) and FakeVPN, all on 127.0.0.1. Use links with `127.0.0.1`.
- **Real app** (the packaged one): use the links with your Wi-Fi address (and, with the VPN on,
  the tunnel address). This is the truest test of "VPN off means never used".

## 3. The log

Fake copy: `~/Library/Application Support/Plexo-fake-test/logs/plexo.log`.
Real app: `~/Library/Application Support/Plexo/logs/plexo.log`. Watch it with `tail -f <that file>`
(or send it to Claude). Lines look like `time LEVEL [scope] message`. Look for:

- `[network] appeared: / gone:` a network came or went
- `[download] start / pause / resume / complete`, `enabled|disabled <network> for <file>`
- `[download] error <file>: <reason>` why a download failed
- `[renderer]` warnings and errors from the window; `[process]` crashes

The Auto planner's own decisions are logged by that feature's code, if it logs them.

## 4. Challenges

Use files of 200 MB or more so you have time to act. "Plan" means the per-network split Plexo shows.

| Challenge                                | Do this                                                                                               | Expect                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Auto picks fastest for the biggest files | Start a group of mixed sizes on 2 networks; scenario `swap` or set one network 6000 and the other 500 | The big files go to the fast network, small ones may take the slow one |
| Wi-Fi collapses mid-download             | Scenario `wifi-collapse` (Wi-Fi 6000 then 300 KB/s after 20 s)                                        | After a while the plan changes; the speed moves to the other network   |
| Recovery                                 | Scenario `wifi-recover` (300 then 6000 after 20 s)                                                    | Wi-Fi is used again after it recovers                                  |
| Flapping does not thrash                 | Scenario `flap` (fast/slow every 4 s)                                                                 | The plan does not change every 4 s; few changes over a minute          |
| A network dies                           | Scenario `lan-dies` (503 after 25 s)                                                                  | Files move to the other network and keep going; nothing is lost        |
| VPN off, never used                      | Scenario `vpn-fast` with "Use VPN for downloads" off                                                  | The VPN network carries 0 bytes (control page shows 0 MB/s for it)     |
| VPN on, used                             | Same scenario, setting on                                                                             | The faster VPN carries the big files                                   |
| One network only                         | Turn the others off, start a group                                                                    | Everything runs on that network, no errors                             |
| Manual connections per file              | Set connections for a file by hand                                                                    | That file keeps your number and Auto leaves it alone                   |
| Pause and resume a group                 | Pause the group, wait, resume                                                                         | Files continue from where they were, same bytes                        |
| Restart mid-group                        | Quit Plexo while downloading, open it again                                                           | Downloads come back paused or resume; no restart from zero             |
| Server without resume                    | Link with `&norange=1`                                                                                | One connection only, it still completes (a restart starts over)        |
| Retries                                  | Link with `&fail=3`                                                                                   | Fails a few times, then succeeds; the log shows the errors             |
| Server blocks a network                  | Press Block on a network's slider                                                                     | Its files move away, no endless error loop                             |

After each one press **reset** on the control page.

## 5. Quick checks of the server itself

```
curl -s 'http://127.0.0.1:8099/__state'                       # who is connected, speeds
curl -s 'http://127.0.0.1:8099/__speed?net=Wi-Fi&kbps=500'    # 0 = unlimited, -1 = block
curl -s 'http://127.0.0.1:8099/__scenario?name=flap'
curl -s 'http://127.0.0.1:8099/__reset'
```

## 6. The Test lab (Debug button)

The title bar has a **Debug** button. It opens the **Test lab**, a resizable panel on the right
that runs automatic test plans against the real app: the real download manager, groups, Auto
planner, networks and settings. The main window stays visible and usable, so you can watch the
groups list while a plan runs. Nothing here needs `scripts/fake-server.mjs`: the lab has its own
server inside Plexo and its own pretend networks.

How it works:

- **Server** (`src/main/debug/fakeServer.ts`): an HTTP server on `127.0.0.1` (first free port from 18000) with speed shared per network (named by the `X-Plexo-Network` header), counters per
  network and per file, and faults: `fail=N`, `status=429&retryAfter=S&times=K`, `cut=<bytes>`,
  `stall=1`, `slowstart=<ms>`, `wrongrange=1`, `norange=1`, `forMs=<ms>`. A file's bytes are a
  pattern of its path and offset, so every finished file is checked **byte for byte**.
- **Simulated networks** (`src/main/debug/simNetworks.ts`): Wi-Fi, Ethernet, Phone and a Fake VPN
  replace the real list while a run is going (also in a packaged build). Plans add and remove
  them to simulate a connection dropping and returning. A banner "Test lab: simulated networks
  are active" shows in the window with a Stop / Restore button. The real networks always come
  back when a run ends, is stopped, or the app quits.
- **Cleanup**: every plan removes its downloads, groups and test files (a temp folder), restores
  the settings it changed, and then checks that nothing is left behind, even after a failure or Stop.

How to run: open Debug, press **Run** on a plan or **Run all** (plan 16 needs you and is skipped
by Run all). **Stop** ends the run and cleans up. Headless: `LAB_PLANS=0,1,2,9,10 npx playwright
test e2e/lab.spec.ts` (the default; `LAB_PLANS=all` runs everything but 16, `LAB_PLANS=16` runs
the restart plan, `LAB_VERBOSE=1` prints each report).

Where the report is: at the end of each plan the panel shows PASS / FAIL, every step and every
check (expected against actual), and a **Copy report** button. The same is written to the log file
(see section 3) as lines tagged `[lab]`: `info` for each step and check, `error` for failures.

| #   | Plan                              | What it asserts                                                                                                    |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 0   | Self-check (Easy)                 | Server runs, 4 pretend networks listed (VPN not selectable), one small file byte-exact over Wi-Fi                  |
| 1   | Integrity across many connections | 3 files over 3 networks are byte-exact and every network's counters show it carried data                           |
| 2   | Pause and resume torture          | 10 pauses (some doubled) at random moments: byte-exact, progress never backwards, one staging file                 |
| 3   | Server fault gauntlet             | 503s, 429 + Retry-After (waited), cut mid-piece, stalled headers, wrong Content-Range (fails safe), no ranges      |
| 4   | Network drops and returns         | Ethernet removed mid-file: no error, no restart, no more data over it; returns and is used again                   |
| 5   | Auto: Wi-Fi collapse              | Plan log notes the slowdown within 20 s, Wi-Fi's share falls, finishes before a stuck file would                   |
| 6   | Auto: recovery and swap           | Fast and slow networks swap: Auto re-plans and beats the first-assignment estimate                                 |
| 7   | Auto: flapping must not thrash    | A network flapping every 4 s for a minute causes at most 6 plan actions; all files finish                          |
| 8   | Auto: a network dies              | Blocked and removed network: its file moves to another, nothing ever fails, plan log notes it                      |
| 9   | VPN setting proof                 | With Use VPN off the VPN gets 0 requests (Auto and manual "all networks"); on, Auto uses it                        |
| 10  | Manual per-file connections       | The server confirms each file touched only its chosen networks; a mid-run switch takes effect                      |
| 11  | Pinning in Auto                   | A file pinned to the slowest network uses only it; others are not pushed onto it                                   |
| 12  | Group edits while running         | Add links, remove a running file, Auto/Manual/Auto, pause/resume: counts consistent, no orphans                    |
| 13  | Concurrency and queue limits      | Never more than 2 ordinary downloads at once, roughly FIFO; Auto lanes may exceed the limit                        |
| 14  | Speed limit and slow mode         | Measured speed within 25% of the limit; rises when removed; Slow mode likewise                                     |
| 15  | Cancel and cleanup                | Cancel, remove and remove-group leave no partial files, no listed items, no open connections                       |
| 16  | Restart recovery (needs you)      | Group paused, you quit and reopen Plexo, press Verify: group, paused downloads and plan are back, then it finishes |
