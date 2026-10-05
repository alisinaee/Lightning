#!/usr/bin/env bash
# Runs Lightning in dev mode with four fake networks (Wi-Fi, Ethernet, USB phone, and a VPN), all
# bound to 127.0.0.1, so the networks menu, Auto scheduler and the "Use VPN for downloads"
# setting can be tried by hand. Settings go to a throwaway folder, not your real ones.
#
# 1. In another terminal:  node scripts/fake-server.mjs
# 2. Run this script.
# 3. Download links like  http://127.0.0.1:8099/a.rar?mb=200 (the server's control page, at
#    http://127.0.0.1:8099/, has live speed sliders, scenarios and ready-made links).
# Every request this copy makes carries X-Lightning-Network: <network id>, so the server can throttle
# the four fake networks separately even though they share 127.0.0.1.
#
# Entry format: id=address=subnet=kind=display name  (kind: ethernet, wifi, usb or vpn).
set -euo pipefail
cd "$(dirname "$0")/.."

export LIGHTNING_USER_DATA="${LIGHTNING_USER_DATA:-$HOME/Library/Application Support/Lightning-fake-test}"
export LIGHTNING_E2E_INTERFACES="Wi-Fi=127.0.0.1==wifi=Wi-Fi,Ethernet=127.0.0.1==ethernet=Ethernet,Phone=127.0.0.1==usb=Phone (USB),FakeVPN=127.0.0.1==vpn=FakeVPN"
echo "Control page: http://127.0.0.1:8099/   (start: node scripts/fake-server.mjs)"
echo "Log file:     $LIGHTNING_USER_DATA/logs/lightning.log   (watch: tail -f \"\$LIGHTNING_USER_DATA/logs/lightning.log\")"
exec npm run dev
