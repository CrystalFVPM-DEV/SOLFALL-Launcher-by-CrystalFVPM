# 0.2.0 LAUNCH failure on Windows: root cause and fix (0.2.1)

**What happened (Voiden, real Windows, 0.2.0):** pressing LAUNCH opened a black WebView window, the game never
loaded, and the launcher stayed open behind it (two processes). 0.1.0 worked on the same PC.

## Diff 0.1.0 vs 0.2.0, point by point

The 0.1.0 source is not in git. It was reconstructed from the delivered binary
(`entrega/SolfallLauncher-0.1.0/…setup.exe` → 7z → `solfall-launcher.exe` → `strings`) and from the 0.1.0 docs.
The 0.2.0 source is staging commit `96daa70`.

| Point | 0.1.0 | 0.2.0 | Verdict |
|---|---|---|---|
| Game window | **same window** navigates to play.solfall.online (`launch_game` + `window.navigate`) | default `on_launch = "minimize"` → **new `game` WebviewWindow built inside a SYNCHRONOUS `#[tauri::command] fn launch_game`** | **Root cause (most likely, see below)** |
| Default on_launch | n/a (always same window) | `"minimize"` | That default put every user on the failing path |
| WebView2 user-data folder | Tauri default (`%LOCALAPPDATA%\online.solfall.launcher\EBWebView`) | same default for both windows (no `data_directory`) | Ruled out by code: identical |
| `additional_browser_args` | `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,Translate,AutofillServerCommunication` | same + `--autoplay-policy=no-user-gesture-required`, applied by `harden()` to **every** webview (main, game, popups) | Ruled out by code: identical across windows in the process, so no environment-options mismatch |
| GPU flags | none | none | Ruled out |
| CSP / init scripts in the game window | none | none (F11 is the native WebView2 `AcceleratorKeyPressed` handler; AUMID is set natively, not through script) | Ruled out |
| Top-level navigation | yes | yes (`WebviewUrl::External`, no iframe) | Not a factor |

## Root cause

0.2.0 `src-tauri/src/main.rs` (staging 96daa70):

```rust
#[tauri::command]
fn launch_game(app: AppHandle, url: String) -> Result<String, String> {   // ← synchronous
    …
    let b = WebviewWindowBuilder::new(&app, "game", WebviewUrl::External(u)) …;
    let g = harden(&app, b).build()…;                                     // ← builds a WebView2 here
    …
    _ => { let _ = main.minimize(); }                                     // ← never reached
```

The Tauri 2.12.5 docs for `WebviewWindowBuilder::new` (source: `tauri-2.12.5/src/webview/webview_window.rs`, "Known issues") say:

> On Windows, this function deadlocks when used in a synchronous command and event handlers, see the Webview2 issue
> (https://github.com/tauri-apps/wry/issues/583). You should use `async` commands and separate threads when creating windows.

Synchronous commands run on the main (UI) thread. Creating the WebView2 controller there waits on a message that the
blocked thread can't pump. That fits every symptom:
- The native window is created but its WebView2 controller never finishes initialising → **black window**.
- `build()` never returns, so `main.minimize()` is never called → **the launcher stays open behind it**.
- The WebView2 browser process is already running for the launcher, so you see **two processes**.
- 0.1.0 never created a second window → **it worked**.
- On Linux (WebKitGTK) the same code works, which is why our 0.2.0 Linux tests passed. The deadlock is specific to WebView2.

**Confirmed:** the code path above (by reading the 0.2.0 source). The documented Tauri known issue that applies to
exactly this pattern. Identical browser args and data folder for all webviews (by reading the code). The 0.1.0 binary
args match 0.2.0 minus autoplay. **Most likely, not reproduced:** that this deadlock is what Voiden saw. We can't run
WebView2 here. The autoplay arg is ruled out as a *mismatch* cause because every webview gets it. Whether WebView2
dislikes the flag itself is unproven, but 0.2.1's default path only ever creates one webview, so a mismatch can't arise.

## Fix in 0.2.1

1. **Default `on_launch = "replace"`**, as in 0.1.0: LAUNCH navigates the **same** launcher window to
   `https://play.solfall.online` top-level. The launcher document is discarded, leaving one webview and one heavy process.
   Settings saved by 0.2.0 (no `rev` field, `on_launch = "minimize"`) are migrated once to `"replace"` (`settings.rev = 2`).
2. `launch_game` is now **`async`**, so the optional "New window" modes no longer build the window on the UI thread.
3. Every webview still goes through `harden()`: the same explicit `data_directory`, and the same `WEBVIEW2_ARGS`.
4. F11 stays a **native** WebView2 `AcceleratorKeyPressed` handler. No script is injected into the game.
5. **Diagnostics:** a rotating log at `%LOCALAPPDATA%\SolfallLauncher\logs\launcher.log` (512 KB × 3 files). It records
   the version, OS, WebView2 runtime version, browser args, data dir, updater endpoints and pubkey kind, settings
   (`on_launch`, `close_action`, `rev`), every page-load start/finish per window, `NavigationCompleted` failures
   (WebErrorStatus), `ProcessFailed` (kind/reason/exit code), the `on_launch` choice at LAUNCH, and news-fetch results.
   It never logs cookies, tokens or anything typed in the game. Settings → About → **Open logs folder**.

What Voiden should send us if LAUNCH still fails: `launcher.log` from that folder.
