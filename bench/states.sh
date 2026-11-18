#!/bin/bash
# 0.4.0 CPU per window state (Linux proxy: WebKitGTK SOFTWARE rendering — WEBKIT_DISABLE_DMABUF_RENDERER=1, Xvfb :99,
# xfwm4 without compositor, NO GPU). Same method as bench/idle.sh: fresh profile, launcher base unreachable (delivered
# config), wait 40 s, then bench/measure-pid.py (whole process tree, % of ONE core, reads /proc only) per state.
# Usage: [SETTINGS_JSON='{...}'] [FOCUSED_ONLY=1] bench/states.sh <binary> <label> [seconds=60] [focused_repeats=3]
# States: focused ×N · unfocused-xclock (the 0.3.0 fleet.sh step, kept to show its flaw: xclock is not installed, so
# nothing took focus) · unfocused (an xmessage window really takes focus) · minimised · game (on_launch=keep, LAUNCH
# pressed in the launcher, play.solfall.online left on its login screen untouched, launcher brought back to the front;
# the launcher page's own WebKitWebProcess is measured separately from the tree, which then includes the game page).
cd "$(dirname "$0")/.."; R=$PWD
TS=${TEST_SERVER:-/workspace/solfall-launcher/test-server}
export DISPLAY=:99
pgrep -f "Xvfb :99" >/dev/null || { Xvfb :99 -screen 0 1440x900x24 -nolisten tcp >/dev/null 2>&1 & sleep 1; }
pgrep -f "xfwm4 --display=:99" >/dev/null || { xfwm4 --display=:99 --compositor=off >/dev/null 2>&1 & sleep 1; }
S=${3:-60}; N=${4:-3}; L=${LOG_DIR:-/tmp}/states-$2.log
rm -rf $TS/profile; mkdir -p $TS/profile/config/online.solfall.launcher
echo "${SETTINGS_JSON:-{\"on_launch\":\"keep\",\"rev\":2\}}" > $TS/profile/config/online.solfall.launcher/settings.json
SOLFALL_LAUNCHER_BASE=https://solfall.example/launcher $TS/run-linux.sh "$1" $L &
sleep 40
W=$(xdotool search --name "^(SOLFALL|Solfall Launcher)$" | head -1)
P=$(pgrep -nf "^$1"); [ -z "$P" ] && P=$(pgrep -nf "$(basename $1)")
M="python3 $R/bench/measure-pid.py"
focus() { xdotool windowmap $W 2>/dev/null; xdotool windowactivate $W 2>/dev/null; xdotool windowfocus $W 2>/dev/null; sleep 3; }
tag() { python3 -c "import json,sys; d=json.loads(sys.argv[1]); d['active_window']=sys.argv[2]; d['bg_log']=sys.argv[3]; print(json.dumps(d))" "$1" "$(xdotool getactivewindow getwindowname 2>/dev/null)" "$(grep -o '\[ui\] bg [a-z]*[ a-z0-9-]*' $L | tail -1 | cut -c6-)"; }
focus
for i in $(seq 1 $N); do tag "$($M $2-focused-$i $P $S)"; done
[ -n "$FOCUSED_ONLY" ] && { kill $P 2>/dev/null; sleep 2; exit 0; }
xclock -geometry 200x200+1200+700 >/dev/null 2>&1 & XC=$!; sleep 2; xdotool search --class xclock | tail -1 | xargs -r xdotool windowactivate; sleep 3
tag "$($M $2-unfocused-xclock $P $S)"; kill $XC 2>/dev/null
focus; xmessage -geometry 300x80+1100+780 "focus thief" & XM=$!; sleep 2; xdotool search --class xmessage | tail -1 | xargs -r xdotool windowactivate; sleep 3
tag "$($M $2-unfocused $P $S)"; kill $XM 2>/dev/null
focus; xdotool windowminimize $W; sleep 3
tag "$($M $2-minimised $P $S)"
focus; LP=$(pgrep -P $P -f WebKitWebProcess | head -1)
xdotool mousemove --window $W 232 740 click 1; sleep 25   # LAUNCH (launcher button only; nothing is clicked in the game)
focus
tag "$($M $2-game-open-tree $P $S)"
tag "$($M $2-game-open-launcher-webprocess $LP $S)"
kill $P 2>/dev/null; sleep 2
