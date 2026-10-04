#!/usr/bin/env bash
# Runs Plexo in dev mode with four fake networks (Wi-Fi, Ethernet, USB phone, and a VPN), all
# bound to 127.0.0.1, so the networks menu, Auto scheduler and the "Use VPN for downloads"
# setting can be tried by hand. Settings go to a throwaway folder, not your real ones.
#
# 1. In another terminal:  node scripts/fake-server.mjs
# 2. Run this script.
# 3. Download links like  http://127.0.0.1:8099/a.rar?mb=200
#
# Entry format: id=address=subnet=kind=display name  (kind: ethernet, wifi, usb or vpn).
set -euo pipefail
cd "$(dirname "$0")/.."

export PLEXO_USER_DATA="${PLEXO_USER_DATA:-$HOME/Library/Application Support/Plexo-fake-test}"
export PLEXO_E2E_INTERFACES="Wi-Fi=127.0.0.1==wifi=Wi-Fi,Ethernet=127.0.0.1==ethernet=Ethernet,Phone=127.0.0.1==usb=iPhone USB,FakeVPN=127.0.0.1==vpn=Fake VPN"
exec npm run dev
