#!/bin/bash
# Idle CPU/RAM of the launcher UI (Linux proxy: WebKitGTK, Xvfb, no GPU). Same method as v0.1.x:
# fresh profile, no launcher server (delivered config), wait 45 s, measure 30 s; then minimised 20 s.
# Usage: bench/idle.sh <binary> <label>   -> prints two JSON lines
cd "$(dirname "$0")/.."
export DISPLAY=:99
pgrep -f "Xvfb :99" >/dev/null || { Xvfb :99 -screen 0 1440x900x24 -nolisten tcp >/dev/null 2>&1 & sleep 1; }
pgrep -f "xfwm4 --display=:99" >/dev/null || { xfwm4 --display=:99 --compositor=off >/dev/null 2>&1 & sleep 1; }
rm -rf test-server/profile
SOLFALL_LAUNCHER_BASE=${SOLFALL_LAUNCHER_BASE:-https://solfall.example/launcher} test-server/run-linux.sh "$1" /tmp/idle-$2.log &
sleep 40
W=$(xdotool search --name "^(SOLFALL|Solfall Launcher)$" | tail -1); xdotool windowactivate $W 2>/dev/null; xdotool windowfocus $W 2>/dev/null; sleep 5
P=$(pgrep -f "^$1" | head -1); [ -z "$P" ] && P=$(pgrep -nf "$(basename $1)")
python3 bench/measure-pid.py "$2-focused" $P 30
xdotool windowminimize $W; sleep 3
python3 bench/measure-pid.py "$2-minimised" $P 20
kill $P 2>/dev/null; sleep 1
