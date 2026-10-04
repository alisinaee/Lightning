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
