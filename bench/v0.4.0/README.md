# 0.4.0 animated background: CPU per window state (Linux proxy)

Box: Xvfb :99 1440×900, xfwm4 without compositor, WebKitGTK 2.54 with `WEBKIT_DISABLE_DMABUF_RENDERER=1`
(**software rendering, no GPU**), release binary, fresh profile, launcher base unreachable. Script: `bench/states.sh`
(whole process tree, % of ONE core, `/proc` only, 60 s per state). Files:

* `states.jsonl`: 0.4.0 final — focused ×3, `unfocused-xclock` (the 0.3.0 method, see below), unfocused, minimised,
  game window open (tree incl. the game page, and the launcher page's own WebKitWebProcess).
* `settings.jsonl`: 0.4.0 focused with *Performance mode* on / *Animated background* off.
* `prototype-0.3.0-transcribed.txt`: the deferred 0.3.0 prototype and plain 0.3.0 re-measured on this box on
  18-11-2026 with the same script (raw JSON lines were lost with a box reset; values copied from the console output).

## Why the 0.3.0 prototype read 14.3 % "unfocused"
`bench/v0.3.0` came from a script that took focus away with `xclock … ; xdotool search --class xclock | xargs -r
xdotool windowactivate`. `xclock` is not installed on this box, so nothing was activated: the launcher stayed the active
window, no `blur` fired, and the fleet kept flying during the "unfocused" sample. Re-run of the prototype build:
`unfocused-xclock` 24.8 % with the launcher still active and no blur in the log, versus 0.0 % with a window that really
takes focus (`xmessage`), where `blur` and the pause were logged. The 0.3.0 pause logic was not leaking; the sample
was mislabelled. 0.4.0 keeps the flawed step in `states.sh` (labelled) next to the real one, and adds native focus /
minimise / game-window events from Rust as a second source.
