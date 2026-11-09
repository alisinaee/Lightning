# Lightning

## Upstream Plexo

When asked to check Plexo (the upstream repository we forked from) or to bring its bug fixes or core
changes into Lightning, read [docs/UPSTREAM-PLEXO.md](docs/UPSTREAM-PLEXO.md) first and follow it.
It covers the remotes, the fetch command (no tags), how to decide what is safe, the rename rules,
and how to verify and record the sync.

## Builds and the installed app

- Only one Lightning.app may exist on this Mac: `/Applications/Lightning.app`. After any build, delete
  the app bundles it leaves in `dist/` (`dist/mac`, `dist/mac-arm64`, and any other `*.app`). Keep the
  DMGs. Spotlight and the Dock otherwise pick up the stale copies.
- To install a new build, mount the DMG from `dist/`, copy `Lightning.app` into `/Applications`, then
  replace the old one. Don't leave copies in `~/Applications` or on the Desktop.
- Check with `mdfind "kMDItemFSName == 'Lightning.app'"`; it should list only `/Applications/Lightning.app`.
