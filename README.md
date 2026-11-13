# SOLFALL Launcher 0.2.1 (Windows)

> **Solfall assets, logo and music are property of their owners and used with permission; not covered by the Apache-2.0 license.**
> Launcher code: Apache-2.0. News, roadmap and patch notes come from `content/news.json` (real content, maintained by Solfall; see `docs/CONTENT-GUIDE.md`).


Tauri v2 + WebView2 (the Edge engine built into Windows 10/11). The launcher shows news, keeps itself up to date with
signed packages and, on **LAUNCH**, turns **the same window** into `https://play.solfall.online` (one webview, like 0.1.0).

**0.2.1 fixes the 0.2.0 LAUNCH bug on Windows** (black window, launcher left open). Root cause and evidence: `docs/ROOT-CAUSE-0.2.1.md`.

## 1. Install (players)
**Download only the `.exe`** from the latest GitHub release:
`SolfallLauncher_<version>_x64-setup.exe`. The `.sig` and `latest.json` files next to it are for the launcher's
auto-updater; you don't need them. Guides, scripts and this README stay in the repository, not in the download.

**WebView2 decision:** the installer uses `bundle.windows.webviewInstallMode = embedBootstrapper`. The WebView2
bootstrapper (~1.8 MB) is inside the installer, so it works on Windows machines without WebView2 (Windows 10 without
Edge updates, stripped images). Those machines need internet the first time, to download the runtime. It's a single
`.exe` of about 9 MB. The alternative, `offlineInstaller`, adds ~127 MB to every download for the rare offline PC
without WebView2, so we didn't use it. Windows 11, and Windows 10 with current updates, already have WebView2 and skip that step.

1. Double-click the installer. It installs **per user** (no admin) into `%LOCALAPPDATA%\SolfallLauncher\`. If WebView2
   is missing, the embedded bootstrapper installs it (internet needed once).
2. **SmartScreen ("Windows protected your PC")** is expected: there is no Authenticode signature (Solfall's decision,
   see §8). Click **More info → Run anyway**.
3. Shortcuts are called **SOLFALL** (Start menu + optional desktop). Uninstall: *Settings → Apps → SolfallLauncher*
   (the uninstaller can also delete launcher settings and data).
4. Upgrading from 0.1.x/0.2.0: old shortcuts (`SolfallLauncher.lnk`, `Solfall Launcher.lnk`, a `SolfallLauncher` Start-menu
   folder) are removed and **SOLFALL.lnk** is recreated with the emblem (`%LOCALAPPDATA%\SolfallLauncher\solfall.ico`);
   the installer then calls `SHChangeNotify(SHCNE_ASSOCCHANGED)` so Explorer refreshes icons. If Windows still shows the old
   sun, its icon cache is stale: sign out and in again (or unpin/re-pin).

The delivered build works **without** any launcher server: the launcher base is a placeholder
(`https://solfall.example/launcher`; Solfall picks the host). It opens on **main** with the non-blocking notice
**"⚠ Updates unavailable"** and **LAUNCH enabled**. News: remote feed → cached copy → copy bundled at build time (§8).

## 2. Screens (0.2.1: `screenshots/v0.2.1/`; full 0.2.0 state set: `screenshots/v0.2.0/`)
All 1440×900. **How they were captured:** the real Linux build (WebKitGTK, the Linux proxy for WebView2) on Xvfb,
no GPU. Installer pages: the real Windows installer running **under wine**. No screenshot comes from real Windows.

| State | File | How |
|---|---|---|
| **0.2.1** main | `v0.2.1/01-main.png` | real, delivered config, no badges; news from the bundled feed (the GitHub raw URL returns 404 until the repo is pushed) |
| **0.2.1** Settings | `v0.2.1/02-settings.png` | real; About has *Open logs folder*, no TEST row |
| **0.2.1** LAUNCH | `v0.2.1/03-launch-same-window-login-screen.png` | real: the **same** window at the game login screen, no interaction; 1 window, 1 web process |
| **0.2.1** update | `v0.2.1/04…` | E2E 0.2.1 → 0.2.2 (see §5) |
| **0.2.1** icons | `v0.2.1/10-icon-extracted-from-exe.png`, `11-lnk-and-uninstaller-icons.png` (+ `11-lnk-parsed.txt`) | `wrestool`/`icotool` on the final exe; `.lnk` parsed with LnkParse3 after a wine install |
| **0.2.1** installer | `v0.2.1/installer-wine/` | footer "SOLFALL Launcher 0.2.1", no TEST label |
| main | `01-main-delivered-config-no-server.png` | real, **delivered config**, no server: "Updates unavailable", bundled SAMPLE news, LAUNCH enabled |
| Settings | `02-settings.png` | real (⚙ next to LAUNCH, or ⚙ in the title bar) |
| Settings, listbox open | `03-settings-listbox-open.png` | real ("When the game launches") |
| launcher-update | `04-launcher-update-downloading-100pct.png` | real, E2E 0.2.0→0.2.1 against the GitHub simulator (frame caught at 100 %, local download is fast) |
| ready | `05-launcher-update-ready.png` | real: "✓ Launcher 0.2.1 ready" + **Restart to apply** |
| update (blocking) | `06-update-blocking-real.png` | real, during the 3 s grace after Restart to apply |
| after the restart | `07-after-restart-0.2.1.png` | real: "Launcher 0.2.1 · ✓ Up to date" |
| rejected update | `08-negative-tampered-signature-rejected.png` | real: latest.json with another file's signature → "⚠ Update rejected (invalid signature)", LAUNCH enabled |
| game | `09-game-login-screen-no-interaction.png` | real: LAUNCH → game window at the play.solfall.online **login screen, no interaction** |
| error | `10-error-game-offline.png` | real: manifest says `game.status: "offline"` → SF-GAME-OFFLINE, RETRY + "Launch anyway →" |
| installer (wine) | `installer-wine/01-welcome … 04-finish`, `05-uninstall-confirm`, `06-uninstall-finish` | real installer under wine 10 (a fake WebView2 registry value was added so the install step does not try to download WebView2; without it the page `03-…aborted…` would be shown, which is wine-only) |

Rules: a failure of `manifest.json`, `news.json` or `latest.json` **never** blocks the game (non-blocking notice, LAUNCH
enabled). The full **error** state appears only if the game does not answer (one `HEAD` `no-cors` request without
cookies to the game URL; it does not load or touch the game) or if the manifest says `game.status ≠ online`.

## 3. Settings
Opened with ⚙ (title bar or next to LAUNCH), closed with **Back** or **Esc**. Every change is saved immediately to
`%APPDATA%\online.solfall.launcher\settings.json` ("✓ Saved").

| Section | Setting | Default |
|---|---|---|
| General | Start with Windows (tauri-plugin-autostart, starts with `--minimised`) · Start minimised to the tray | off · off |
| | Close button: **Quit** / In tray | Quit |
| | When the game launches: **Use this window** / New window · minimise launcher / · keep it open / · hide to the tray / · close launcher | **Use this window** (0.2.0 settings are migrated once) |
| | Start the game full screen | off |
| | Tray icon menu: Open launcher · Launch Solfall · Check for updates · Quit | (info) |
| Updates | Update the launcher automatically · Channel **Stable** (shown, disabled) · version · last checked · Check now | on |
| Display | Window size (min 1280×720; disabled while maximised) · Remember size & maximised · UI scale (Match Windows/100/125/150 %) · Reduce motion (follows Windows until changed) | 1440×900 · on · Match Windows · follow OS |
| Audio | Volume · Music · Music volume | 80 % · **off** · 60 % |
| About | version, solfall.online, Discord, **Open logs folder**, the assets line (a *Build* row appears only in debug builds or with `SOLFALL_DEBUG=1`) | |

Music: when on, it starts on launch (WebView2 runs with `--autoplay-policy=no-user-gesture-required`); if the engine still
blocks it, it starts on the first click/key. The ♪ button in the title bar and "Now playing" toggle it; the state persists.

## 4. Window, taskbar, keys
* Custom title bar (46×52 controls; close hover `#ff6b7a`, pressed `#e2566a`): minimise, **maximise/restore**, close.
  **F11** = fullscreen in the launcher and in the game window (WebView2 accelerator key handler on Windows; no extra IPC).
* AUMID **`online.solfall.launcher`** is set on the process (`SetCurrentProcessExplicitAppUserModelID`), on **every**
  window (`PKEY_AppUserModel_ID` via `SHGetPropertyStoreForWindow`) and on the **SOLFALL** `.lnk` (NSIS), so the launcher,
  the game window and the pinned shortcut group as one "SOLFALL" taskbar button.
* Icon: one pipeline (`tools/assets.sh`): `tauri icon` from `spec/icon/solfall-icon-1024.png`, then `icons/icon.ico` is
  overwritten with `spec/icon/solfall.ico` verbatim. Installer art: `spec/installer/header.bmp` + `sidebar.bmp` verbatim.
  **All assets are FINAL** (`branding/active/SOURCES.txt`); no temporary asset is used.
* Animations: transform/opacity only, paused when the window is unfocused, minimised or hidden, and off with
  `prefers-reduced-motion` or *Reduce motion*.
* Links open in the **system browser**. Source, in order: `links` in news.json → manifest `links` → `src/js/config.js`
  (the one place to edit; `null` = hidden). Discord = `links.discord`, falling back to the constant
  `https://discord.gg/scyet8grSR`. Roadmap tab = `links.roadmap` (`https://solfall.online/#/roadmap`); *Patch notes →* =
  the newest patch item's `url` or `links.patch_notes`; hidden when neither exists. The Log tab is gone. `open_link` (Rust)
  accepts only `https://` on solfall.online, discord.gg, discord.com, patreon.com, github.com (+ subdomains), so a remote
  feed can't open other schemes or hosts.

## 5. Updates (GitHub Releases)
* Compiled endpoint (`src-tauri/tauri.conf.json`):
  `https://github.com/CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM/releases/latest/download/latest.json`.
  The launcher **always** checks (unless *Update automatically* is off). If the manifest offers an endpoint it is
  accepted only if it is `https://github.com/CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM/releases/…`; otherwise the
  compiled endpoint is used. No `dangerousInsecureTransportProtocol` in the delivered config.
* Download in the background (LAUNCH stays enabled) → minisign signature check with the embedded pubkey →
  "Restart to apply" → 3 s blocking state (Cancel goes back) → passive NSIS install → relaunch. If the game was
  launched, the restart is offered when the window is closed.
* **Production pubkey:** minisign key id `D78F00A86CB044C7` (set with the command below on 2026-11-13).
  E2E/test builds embed a separate test pubkey through `src-tauri/tauri.e2e.conf.json` only.
* **Production key swap (one line):** `npm run set-pubkey -- %USERPROFILE%\.tauri\solfall.key.pub`. It rewrites only
  `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` (the single place it lives), refuses private keys and warns
  on the local test key. Then rebuild and re-sign. Setup guide for the Solfall devs (EN + ES): `SECRETS-SETUP.md` in the repo.
* **E2E test (Linux, done):** 0.2.0 → 0.2.1 through the backend's GitHub simulator (`serve.mjs --github-sim`,
  `latest/download` → 302 → `download/v0.2.1` → 302 → object host), with a manifest that has **no** `updates` key, so
  the compiled endpoint was exercised. Downloaded 192485880 B, "signature verified OK (minisign)", installed,
  restarted, "✓ Up to date". The AppImage on disk then had the 0.2.1 sha256. Negative: tampered signature →
  `The signature verification failed`, nothing installed, "⚠ Update rejected (invalid signature)". Logs: `evidence/v0.2.0/`.
* **E2E kit for Windows:** `e2e-windows/` (README-E2E.md, installers 0.2.0/0.2.1, gh-sim state, tampered variant).
  E2E overrides exist only at **compile time** (`SOLFALL_LAUNCHER_BASE`, `SOLFALL_E2E_ALLOW_LOCALHOST` via
  `option_env!`) plus a `--config` overlay; a runtime environment variable is honoured only in debug builds.

## 6. Idle CPU and RAM (Linux proxy: WebKitGTK, software rendering, Xvfb; whole process tree; `bench/`)
| Build | Focused idle CPU (% of 1 core) | Minimised | PSS |
|---|---|---|---|
| 0.1.0 (before, `bench/v0.2.0/idle-before.jsonl`) | **100.9 %** | 0.1 % | 241 MB |
| 0.2.0 (after, `bench/v0.2.0/idle-final.jsonl`) | **7.8 %** | 0.0 % | 244 MB |

What changed: the star's 160 px drop-shadow filter is baked into PNGs (`tools/bake-star.py`, RMSE 0.77 % vs the CSS
filter), the rock drift is a low-rate stepper that only runs while focused and visible, and the glow pulse (which
repaints ~70 % of the window) runs only on Windows, where WebView2 composites it on the GPU (static on Linux).
After LAUNCH (game login screen, Linux): PSS 248 MB → 832 MB (that is the game page). **Not measured on Windows.**

Measure on Windows (compare with the current prototype):
```powershell
.\tools\measure-webview.ps1 -ProcessName solfall-launcher -Label launcher-idle -Seconds 60
# press LAUNCH, wait ~30 s on the login screen WITHOUT touching anything
.\tools\measure-webview.ps1 -ProcessName solfall-launcher -Label launcher-game -Seconds 60
```
It sums Working Set / Private Bytes and CPU of the whole tree (including `msedgewebview2.exe`) into `measure-results.csv`.

## 7. Login and navigation
* Discord login happens inside the game window (OAuth on `discord.com`, captcha on `hcaptcha.com`); the session cookie
  stays in the launcher's WebView2 profile (`%LOCALAPPDATA%\online.solfall.launcher\`).
* Navigation allowlist: `play.solfall.online`, `discord.com`, `discordapp.com`, `hcaptcha.com` (+ subdomains). Anything
  else opens in the system browser.
* **Google sign-in does not work inside the launcher**: Google blocks OAuth in embedded webviews
  (`Error 403: disallowed_useragent`). Options for Solfall: Discord only in the launcher, or system-browser login + deep link.
* No login or any interaction with the game happened in our tests: only loaded up to the login screen.

## 8. Backend: where news and updates live
The launcher reads `<base>/manifest.json` (game status, links, `min_launcher_version`, kill switch). Updates come from
GitHub Releases (`latest.json` + installer + `.sig` in each release).
* **News** (schema v3, `content/news.schema.json`): at startup Rust fetches
  `https://raw.githubusercontent.com/CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM/main/content/news.json`
  (3 s connect / 5 s total timeout, 512 KB max, `If-None-Match` with the cached ETag; the URL is fixed and can't be set
  from the page). It is done in Rust because GitHub raw rejects the CORS preflight. The UI validates the feed, drops
  invalid items and hides empty sections. It falls back to the cached copy, then to `src/js/news.bundled.json`, which
  `tools/bundle-news.mjs` (Tauri `beforeBuildCommand`) generates from `content/news.json` on every build after running
  the Backend's `scripts/validate-content.mjs`.
* CSP (launcher UI only): `connect-src` adds `https://raw.githubusercontent.com`; `img-src` adds `https://solfall.online`
  and `https://raw.githubusercontent.com`. When the real launcher host replaces `solfall.example`, add it to `connect-src`.
* **Updater key** (free): signs every release so installed launchers accept only genuine updates. The private key and its
  password go into the Solfall repo's Actions secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`)
  plus an offline backup. **If it is lost, installed launchers can no longer update themselves.** Only the `.pub` is
  sent to us. Steps: `SECRETS-SETUP.md` (also: enable release immutability before the first tag, never publish a
  "latest" release without `latest.json`).
* **Authenticode certificate** (paid): removes SmartScreen. Solfall's decision (store, signing, keys).
* New version: bump `version` in `src-tauri/tauri.conf.json` → tag `vX.Y.Z` → `.github/workflows/release.yml` builds
  (`npm ci` + `npx tauri build --bundles nsis`), signs, writes `latest.json`, creates a draft release → publish.

## 9. Known limitations
* Snap Layouts on the custom maximise button: out of scope.
* Animated background (ships crossing, skirmishes, as on solfall.online): planned for 0.2.2, not in 0.2.1.
* DPI: handled by WebView2; minimum window 1280×720. Layout at *UI scale* 125/150 % on the minimum window size was not checked (Settings columns scroll when space is short).
* Not implemented from the UI/UX spec: Licences & credits sub-view, UI sounds (no files delivered), "play in the system
  browser" option (the game always opens in a launcher window), the `.win-frame` CSS frame (native window shadow used instead).
* "Galaxy online · ping" = round-trip time of `manifest.json`, not the game server ping.
* Linux AppImage: needs `bundleMediaFramework` (overlay `src-tauri/tauri.linux-appimage.conf.json`) or the WebKit
  process crashes at the `<audio>` element; WebKitGTK cannot stream media from the app protocol, so music falls back to
  a Blob URL. Linux is only the test proxy.
* The installer has no licence page (the licence text is the devs' — placeholder in the spec).

### NOT VERIFIED (no Windows machine; built with cargo-xwin, tested on Linux and under wine)
* **The 0.2.1 LAUNCH fix on WebView2** (same-window navigation is the 0.1.0 path; the async "New window" modes are also untested on Windows).
* The diagnostic log on Windows (`%LOCALAPPDATA%\SolfallLauncher\logs\`), the WebView2 `ProcessFailed`/`NavigationCompleted` hooks, and *Open logs folder*.
* That Start menu, taskbar and desktop show the emblem after the upgrade (resources, `.lnk` IconLocation and uninstaller verified; Windows' icon cache isn't).
* AUMID taskbar grouping (process / windows / `.lnk`; under wine the `.lnk` property is not written).
* F11 and maximise inside the **game** window on Windows (works in the launcher on Linux; the game window uses the
  WebView2 accelerator handler, which only exists on Windows).
* WebView2 autoplay of the music (flag set; on Linux music plays after the Blob fallback).
* Installer look on real Windows (only wine), SmartScreen, the NSIS update/relaunch, WebView2 bootstrap.
* RAM and CPU on Windows/WebView2, including the cost of the Windows-only glow pulse.
* Start with Windows (autostart registry entry), tray icon and menu, UI scale (WebView2 zoom), DPI scaling.

## 10. Layout and build
`src/` UI (static HTML/CSS/JS; `css/settings.css` = spec copy) · `src-tauri/` Rust · `branding/` installer hooks,
language file and active art · `tools/` (`assets.sh`, `set-pubkey.mjs`, `build-local.sh`, `bake-star.py`,
`measure-webview.ps1`) · `bench/` · `evidence/` · `e2e/`, `e2e-windows/` (test only).

* Windows (CI and locally): `npm ci` then `npx tauri build --bundles nsis` (`npm run build`).
* Cross-build from Linux: `npm run build:win` (cargo-xwin). Box scripts: `tools/build-local.sh win|win-e2e|linux|linux-e2e`.
* Updater signing needs `TAURI_SIGNING_PRIVATE_KEY` (+ password) in the environment; never commit a private key.
