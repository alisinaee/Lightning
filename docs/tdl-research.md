# iyear/tdl research (checked 2026-11-03)

Sources: GitHub API (repo, README, docs/content/en), docs.iyear.me/tdl, release v0.20.4 assets (sha256 checked against tdl_checksums.txt), and `tdl --help` from the macOS arm64 binary.

## 1) Release and assets
- Latest release: v0.20.4 (published 2026-08-23). Binary reports `Version: 0.20.4`, built with go1.25.8.
- darwin arm64: `tdl_MacOS_arm64.tar.gz`
- darwin amd64: `tdl_MacOS_64bit.tar.gz` (note: "64bit", not "amd64")
- windows: `tdl_Windows_64bit.zip`, `tdl_Windows_arm64.zip` (also 32bit, armv5/6/7)
- linux: `tdl_Linux_64bit.tar.gz`, `tdl_Linux_arm64.tar.gz` (also 32bit, armv5/6/7, riscv64, loong64)
- Checksums: `tdl_checksums.txt` (sha256). macOS arm64 sha256: 7ea79e68c3f46a5dccdbd0356220a3a689cc00d715fbce9dcabde7f18bb99365

## 2) Commands (verified against `tdl --help`)
Login (`-n NS` selects namespace, default `default`):
- Desktop import: `tdl login` (auto-finds client), `tdl login -d /path/to/TelegramDesktop`, `tdl login -p PASSCODE` (`-T desktop` is the default)
- QR: `tdl login -T qr`
- Phone + code: `tdl login -T code`

`tdl dl` (alias `download`):
- `-u, --url` telegram message links (StringSlice: repeat the flag or comma-separate)
- `-f, --file` official desktop-client JSON export (repeatable)
- `-d, --dir` output dir (default `downloads`, created if missing)
- `-t, --threads` threads per task (default 4)
- `-l, --limit` concurrent tasks (default 2). Global flag, not a per-file cap.
- `--template` name template (default `{{ .DialogID }}_{{ .MessageID }}_{{ filenamify .FileName }}`)
- `--skip-same` skip if same name (without ext) and size
- `--continue` resume last download without prompt; `--restart` restart last download without prompt
- `--takeout` takeout session (lower flood-wait limits)
- `--group` auto-detect albums and download all parts
- `--proxy protocol://user:pass@host:port` (global)
- `-n, --ns` namespace (global)
- Also: `-i/--include`, `-e/--exclude` (comma-separated extensions, matched on file name only), `--desc`, `--rewrite-ext`, `--serve` with `--port` (default 8080), `--delay`, `--debug`

`tdl chat ls`:
- `tdl chat ls`, `tdl chat ls -o json` (`-o table|json`), `-f EXPR` filter (`-f -` lists fields)

`tdl chat export`:
- `-c, --chat` chat id or domain (empty = Saved Messages)
- `-o, --output` JSON path (default `tdl-export.json`)
- `-T, --type time|id|last` (default time); `-i, --input ints` range for the type (unix ts pair, id pair, or count)
- `-f, --filter` expression (`-f -` lists fields)
- `--topic ID`, `--reply POST_ID`, `--with-content`, `--all` (include non-media), `--raw`

## 3) Batch download
Yes. Pass several `-u` links, or export chats to JSON with `tdl chat export` and feed them with `-f` (repeatable, mixable with `-u`). Concurrency: `-l` (tasks) x `-t` (threads per task). Restarts are resumable via `--continue`. A plain shell loop over links also works.

## 4) Machine-readable output and exit codes
- No JSON/line progress mode for `dl`. Progress is a go-pretty tracker (pkg/prog) that redraws the terminal; the only progress-related flag is `--disable-progress-ps` ("may cause display issues"). Plan to parse logs, not stdout.
- Logs: `~/.tdl/log/latest.log` (zap console encoder, not JSON). `--debug` raises the level.
- Only `chat ls -o json` and `chat export` produce JSON (files/stdout, not progress).
- Exit codes (source: main.go): 0 on success, 1 on any returned error (incl. Ctrl+C / interrupt, `bbolt` lock contention).
- Caveat: per-file download errors are logged, not returned (core/downloader/downloader.go), so `tdl dl` can exit 0 even when some files failed. Check the log or file counts.

## 5) Licence
- AGPL-3.0 (LICENSE file and GitHub metadata). Practical meaning: free to use and run; if you modify it and let others use it over a network, you must offer them the modified source under AGPL. Redistributing binaries requires source availability. Not legal advice.

## Operational notes (from docs/troubleshooting)
- Upstream recommends the official client session and low `-t`/`-l` to reduce ban risk; avoid logging the same account into many devices at once.
- Desktop client conflicts: re-login with `tdl login` and answer YES to logout.
- Session migration: `tdl backup` / `tdl recover`.
