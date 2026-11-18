# SOLFALL Launcher 0.3.0: developer notes

Technical documentation for the launcher (player instructions: [README](../README.md)). Paths below are relative to
the repository root.

> **Solfall assets, logo and music are property of their owners and used with permission; not covered by the Apache-2.0 license.**
> Launcher code: Apache-2.0. News, roadmap and patch notes come from `content/news.json` (real content, maintained by
> Solfall; see the [content guide](CONTENT-GUIDE.md), also in [Spanish](CONTENT-GUIDE.es.md)).

Tauri v2: WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux. The launcher shows news, keeps itself up to date with
signed packages and, on **LAUNCH**, turns **the same window** into `https://play.solfall.online` (one webview, like 0.1.0).

**0.3.0 adds macOS (universal .dmg) and Linux (AppImage + .deb).** The Windows build is unchanged (Windows-only code stays
behind `cfg(windows)`). Fix found while testing: with *Update automatically* off the news fetch panicked (no TLS crypto
provider installed yet) and news never loaded; the provider is now installed at startup (all platforms). 0.2.1 fixed the 0.2.0 LAUNCH bug on Windows: [ROOT-CAUSE-0.2.1.md](ROOT-CAUSE-0.2.1.md).

## 1. Install details
Players download **one file** for your system from the latest GitHub release. The `.sig`, `.app.tar.gz` and `latest.json`
files in the release are for the launcher's auto-updater; you don't need them.

| System | Download |
|---|---|
| Windows 10/11 (64-bit) | `SOLFALL-Launcher_<version>_Windows_x64-setup.exe` |
| macOS 10.15 Catalina or newer (Intel and Apple Silicon, one universal app) | `SOLFALL-Launcher_<version>_macOS-universal.dmg` |
| Linux x86_64 (any distro) | `SOLFALL-Launcher_<version>_Linux_x86_64.AppImage` |
| Debian / Ubuntu (optional) | `SOLFALL-Launcher_<version>_Linux_amd64.deb` |

The release asset names are set in one place, Backend's `scripts/release-assets.mjs`; Tauri's own build output
(`SolfallLauncher_<version>_x64-setup.exe`, `SolfallLauncher_<version>_universal.dmg`, `SolfallLauncher.app`,
`SolfallLauncher_<version>_amd64.AppImage/.deb`) is renamed when the release is assembled. `productName` must stay
`SolfallLauncher` (Backend's guard and the updater depend on it).

### 1a. Windows
**Download only the `.exe`** from the latest GitHub release:
`SOLFALL-Launcher_<version>_Windows_x64-setup.exe`. The `.sig` and `latest.json` files next to it are for the launcher's
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

### 1b. macOS
1. Open `SOLFALL-Launcher_<version>_macOS-universal.dmg` and drag **SolfallLauncher.app** onto **Applications**. The bundle
   is named after `productName` (`SolfallLauncher.app`, also the Finder/Dock name via `CFBundleDisplayName`);
   `bundle.macOS.bundleName = "SOLFALL"` only sets `CFBundleName` (the menu-bar app name). Signing:
   `bundle.macOS.signingIdentity = "-"` (CI also sets `APPLE_SIGNING_IDENTITY=-`): Tauri ad-hoc signs the inner
   binaries and then the whole `.app` bundle; no certificate. In CI, Backend's `scripts/macos-adhoc.sh` then checks
   the architectures (`lipo`) and the ad-hoc signature (`codesign --verify --deep --strict`) and, if needed, re-signs
   with `codesign --force --deep -s -` and regenerates the `.dmg`, the `.app.tar.gz` and its updater signature.
   If that fallback runs, the job shows a `::warning::` and a step-summary note (the rebuilt `.dmg` lacks Tauri's background/layout).
2. **First open.** The app is ad-hoc signed but not notarized (no Apple Developer ID), so Gatekeeper asks once:
   * In **Applications**, **right-click (or Control-click) SolfallLauncher → Open**, then click **Open** in the dialog.
   * If macOS only offers *Move to Trash* / *Done* (macOS 15 Sequoia and newer): click **Done**, open
     **System Settings → Privacy & Security**, scroll to *Security*, click **Open Anyway** next to "SolfallLauncher was
     blocked…", confirm with your password, then open the app again.
   * Last resort (Terminal), only if the two steps above don't work:
     `xattr -dr com.apple.quarantine /Applications/SolfallLauncher.app`
   After that it opens normally, and updates install without asking again.
3. Notarization (no Gatekeeper prompt at all) needs the **Apple Developer Program, 99 USD a year**, plus a
   Developer ID certificate. That is Solfall's decision; the build is ready for it (`bundle.macOS.signingIdentity`).
4. **Supported Macs:** macOS **10.15 Catalina or newer** (`minimumSystemVersion` 10.15), Intel and Apple Silicon. Macs
   that can't run Catalina are excluded (Apple's Catalina list): MacBook older than Early 2015, MacBook Air and MacBook Pro
   older than Mid 2012, Mac mini and iMac older than Late 2012, Mac Pro older than Late 2013, and any Mac on 10.14 Mojave or older. The launcher uses the system **WKWebView** (Safari's engine), so the game runs on the
   Safari version that ships with that macOS. On Catalina/Big Sur (Safari 13–14) some newer web features may be
   missing or slower, and the music may need a click first (WKWebView autoplay policy). Keeping macOS updated helps.
5. Window: native traffic lights (close/minimise/zoom) at the top left, **⌃⌘F** or the green button for full screen,
   **⌘Q** quits, **⌘,** opens Settings, and copy/paste work in the login fields (Edit menu).

### 1c. Linux
* **AppImage (recommended, any distro):** `chmod +x SOLFALL-Launcher_<version>_Linux_x86_64.AppImage` and run it. It
  updates itself. It bundles GStreamer (so the music plays), hence its size (~120–190 MB, see §10). On some distros you
  need `libfuse2` (Ubuntu 22.04+: `sudo apt install libfuse2`).
* **.deb (Debian/Ubuntu):** `sudo apt install ./SOLFALL-Launcher_<version>_Linux_amd64.deb`. It uses the system WebKitGTK
  and GStreamer (it recommends `gstreamer1.0-plugins-base` + `gstreamer1.0-plugins-good`, enough for the MP3 music).
  Updates: the updater picks the `linux-x86_64-deb` entry of `latest.json` and installs the next .deb with
  `pkexec dpkg -i` (asks for your password). Not tested on the box (the 0.3.0 → 0.3.1 E2E covered the AppImage).
* **F11** toggles full screen in the launcher (needs a window manager, as on any desktop).

The delivered build works **without** any launcher server: the launcher base is a placeholder
(`https://solfall.example/launcher`; Solfall picks the host). It opens on **main** with the non-blocking notice
**"⚠ Updates unavailable"** and **LAUNCH enabled**. News: remote feed → cached copy → copy bundled at build time (§8).

## 2. Screens (0.3.0 Linux: [`screenshots/v0.3.0/`](../screenshots/v0.3.0/); 0.2.1: [`screenshots/v0.2.1/`](../screenshots/v0.2.1/); full 0.2.0 state set: [`screenshots/v0.2.0/`](../screenshots/v0.2.0/))
All 1440×900. **How they were captured:** the real Linux build (WebKitGTK, the Linux proxy for WebView2) on Xvfb,
no GPU. Installer pages: the real Windows installer running **under wine**. No screenshot comes from real Windows.

| State | File | How |
|---|---|---|
| **0.3.0** Linux main | [`v0.3.0/01-linux-main-update-ready-music-playing.png`](../screenshots/v0.3.0/01-linux-main-update-ready-music-playing.png) | real AppImage (E2E build): music playing without a click, "✓ Launcher 0.3.1 ready" |
| **0.3.0** Linux update | [`v0.3.0/02-linux-update-blocking.png`](../screenshots/v0.3.0/02-linux-update-blocking.png), [`03-linux-after-restart-0.3.1.png`](../screenshots/v0.3.0/03-linux-after-restart-0.3.1.png) | E2E 0.3.0 → 0.3.1 (see §5) |
| **0.3.0** Linux F11 | [`v0.3.0/04-linux-F11-fullscreen.png`](../screenshots/v0.3.0/04-linux-F11-fullscreen.png) | real: F11 → full screen (1600×1000 = the whole Xvfb screen, xfwm4), F11 again → 1440×900 |
| **0.3.0** Linux LAUNCH | [`v0.3.0/05-linux-launch-game-login-no-interaction.png`](../screenshots/v0.3.0/05-linux-launch-game-login-no-interaction.png) | real: same window at the game login screen, no interaction; 1 web process |
| macOS | none | no Mac available; see *NOT VERIFIED* |
| **0.2.1** main | [`v0.2.1/01-main.png`](../screenshots/v0.2.1/01-main.png) | real, delivered config, no badges; news from the bundled feed (the GitHub raw URL returns 404 until the repo is pushed) |
| **0.2.1** Settings | [`v0.2.1/02-settings.png`](../screenshots/v0.2.1/02-settings.png) | real; About has *Open logs folder*, no TEST row |
| **0.2.1** LAUNCH | [`v0.2.1/03-launch-same-window-login-screen.png`](../screenshots/v0.2.1/03-launch-same-window-login-screen.png) | real: the **same** window at the game login screen, no interaction; 1 window, 1 web process |
| **0.2.1** update | `v0.2.1/04…` | E2E 0.2.1 → 0.2.2 (see §5) |
| **0.2.1** icons | [`v0.2.1/10-icon-extracted-from-exe.png`](../screenshots/v0.2.1/10-icon-extracted-from-exe.png), [`11-lnk-and-uninstaller-icons.png`](../screenshots/v0.2.1/11-lnk-and-uninstaller-icons.png) (+ [`11-lnk-parsed.txt`](../screenshots/v0.2.1/11-lnk-parsed.txt)) | `wrestool`/`icotool` on the final exe; `.lnk` parsed with LnkParse3 after a wine install |
| **0.2.1** installer | [`v0.2.1/installer-wine/`](../screenshots/v0.2.1/installer-wine/) | footer "SOLFALL Launcher 0.2.1", no TEST label |
| main | [`01-main-delivered-config-no-server.png`](../screenshots/v0.2.0/01-main-delivered-config-no-server.png) | real, **delivered config**, no server: "Updates unavailable", bundled SAMPLE news, LAUNCH enabled |
| Settings | [`02-settings.png`](../screenshots/v0.2.0/02-settings.png) | real (⚙ next to LAUNCH, or ⚙ in the title bar) |
| Settings, listbox open | [`03-settings-listbox-open.png`](../screenshots/v0.2.0/03-settings-listbox-open.png) | real ("When the game launches") |
| launcher-update | [`04-launcher-update-downloading-100pct.png`](../screenshots/v0.2.0/04-launcher-update-downloading-100pct.png) | real, E2E 0.2.0→0.2.1 against the GitHub simulator (frame caught at 100 %, local download is fast) |
| ready | [`05-launcher-update-ready.png`](../screenshots/v0.2.0/05-launcher-update-ready.png) | real: "✓ Launcher 0.2.1 ready" + **Restart to apply** |
| update (blocking) | [`06-update-blocking-real.png`](../screenshots/v0.2.0/06-update-blocking-real.png) | real, during the 3 s grace after Restart to apply |
| after the restart | [`07-after-restart-0.2.1.png`](../screenshots/v0.2.0/07-after-restart-0.2.1.png) | real: "Launcher 0.2.1 · ✓ Up to date" |
| rejected update | [`08-negative-tampered-signature-rejected.png`](../screenshots/v0.2.0/08-negative-tampered-signature-rejected.png) | real: latest.json with another file's signature → "⚠ Update rejected (invalid signature)", LAUNCH enabled |
| game | [`09-game-login-screen-no-interaction.png`](../screenshots/v0.2.0/09-game-login-screen-no-interaction.png) | real: LAUNCH → game window at the play.solfall.online **login screen, no interaction** |
| error | [`10-error-game-offline.png`](../screenshots/v0.2.0/10-error-game-offline.png) | real: manifest says `game.status: "offline"` → SF-GAME-OFFLINE, RETRY + "Launch anyway →" |
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
  macOS: native traffic lights instead of these buttons, ⌃⌘F / green button for full screen. Linux: F11 in the launcher.
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
  on the local test key. Then rebuild and re-sign. Setup guide for the Solfall devs (EN + ES): [SECRETS-SETUP.md](../SECRETS-SETUP.md).
* **E2E test (Linux, done):** 0.2.0 → 0.2.1 through the backend's GitHub simulator (`serve.mjs --github-sim`,
  `latest/download` → 302 → `download/v0.2.1` → 302 → object host), with a manifest that has **no** `updates` key, so
  the compiled endpoint was exercised. Downloaded 192485880 B, "signature verified OK (minisign)", installed,
  restarted, "✓ Up to date". The AppImage on disk then had the 0.2.1 sha256. Negative: tampered signature →
  `The signature verification failed`, nothing installed, "⚠ Update rejected (invalid signature)". Logs: `evidence/v0.2.0/`.
* **E2E test 0.3.0 → 0.3.1 (Linux AppImage, done):** `latest.json` generated by Backend's `scripts/release-assets.mjs`
  (`collect --platform linux` on the real build output + `latest-json`), published with `gh-sim-publish.mjs --assets-dir`
  (9 assets; the Windows/macOS files were placeholders). The launcher picked `linux-x86_64-appimage`, downloaded
  192506360 B, "signature verified OK (minisign)", installed, restarted as 0.3.1, "✓ Up to date"; the AppImage on disk
  then had the 0.3.1 sha256. Both Linux signatures also pass `scripts/verify-updater-signatures.mjs --expect-version 0.3.1`.
  Log: `evidence/v0.3.0/linux-e2e-0.3.0-to-0.3.1-launch.log`.
* **E2E kit for Windows:** `e2e-windows/` ([README-E2E.md](../e2e-windows/README-E2E.md), installers 0.2.0/0.2.1, gh-sim state, tampered variant).
  E2E overrides exist only at **compile time** (`SOLFALL_LAUNCHER_BASE`, `SOLFALL_E2E_ALLOW_LOCALHOST` via
  `option_env!`) plus a `--config` overlay; a runtime environment variable is honoured only in debug builds.

## 6. Idle CPU and RAM (Linux proxy: WebKitGTK, software rendering, Xvfb; whole process tree; `bench/`)
| Build | Focused idle CPU (% of 1 core) | Minimised | PSS |
|---|---|---|---|
| 0.1.0 (before, `bench/v0.2.0/idle-before.jsonl`) | **100.9 %** | 0.1 % | 241 MB |
| 0.2.0 (after, `bench/v0.2.0/idle-final.jsonl`) | **7.8 %** | 0.0 % | 244 MB |
| 0.3.0 + animated fleet (prototype, `bench/v0.3.0/idle-fleet-DEFERRED.jsonl`, 36 × 10 s) | **17.5 %** avg (5.9–26.3) | 0.0 % | — |

The animated background (ships crossing, skirmishes) was built and measured for 0.3.0 but **not shipped**: focused idle
17.5 % (limit 10 %, target 8 %) and 14.3 % while unfocused on this box (limit 0 %). Deferred; the prototype is kept
outside the repo.

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
  sent to us. Steps: [SECRETS-SETUP.md](../SECRETS-SETUP.md) (also: enable release immutability before the first tag, never publish a
  "latest" release without `latest.json`).
* **Authenticode certificate** (paid): removes SmartScreen. Solfall's decision (store, signing, keys).
* New version: bump `version` in `src-tauri/tauri.conf.json` → tag `vX.Y.Z` → `.github/workflows/release.yml` (Backend)
  builds Windows, macOS (universal) and Linux in a matrix, signs, verifies every signature, writes one `latest.json` and
  creates a draft release → publish. Asset names live in one place, `scripts/release-assets.mjs`; `<v>` comes from
  the tag (`vX.Y.Z`, which must equal `version` in `tauri.conf.json`):
  `SOLFALL-Launcher_<v>_Windows_x64-setup.exe`, `SOLFALL-Launcher_<v>_macOS-universal.dmg`,
  `SOLFALL-Launcher_<v>_Linux_x86_64.AppImage`, `SOLFALL-Launcher_<v>_Linux_amd64.deb`, the macOS updater tarball
  `SOLFALL-Launcher_<v>_macOS-universal.app.tar.gz` (Tauri writes it as `SolfallLauncher.app.tar.gz`), each signed
  file + `.sig`, and `latest.json` (10 assets).
* **macOS Plan B** (only if the universal build fails): run the workflow with `mac_mode=split` (workflow_dispatch input,
  or the `SOLFALL_MAC_MODE` repository variable). It builds Apple Silicon and Intel separately and publishes
  `SOLFALL-Launcher_<v>_macOS-AppleSilicon.dmg` and `SOLFALL-Launcher_<v>_macOS-Intel.dmg` (+ one `.app.tar.gz` each;
  `darwin-aarch64` / `darwin-x86_64` in `latest.json` point to their own tarball; 13 assets). The player README
  documents only the universal `.dmg`; update it if Plan B is ever used.

## 9. Roadmap (not in 0.3.0)
* Animated background (ships crossing, skirmishes): over the CPU limit in 0.3.0 (§6); needs a cheaper renderer.
* macOS notarization (Apple Developer Program, 99 USD/year) and a Windows Authenticode certificate: Solfall's decision.
* A first real run on macOS and Windows of everything listed under *NOT VERIFIED* below.
* The game's own roadmap is in `content/news.json` (`links.roadmap` → https://solfall.online/#/roadmap).

## 10. Known limitations
* Snap Layouts on the custom maximise button: out of scope.
* Animated background (ships crossing, skirmishes, as on solfall.online): built, measured over the CPU limit, not shipped (§6).
* Linux AppImage GStreamer: `bundleMediaFramework` copies **every** plugin in the build machine's GStreamer directory
  (`linuxdeploy-plugin-gstreamer.sh` ignores `GSTREAMER_INCLUDE_BAD_PLUGINS`; it only honours `GSTREAMER_PLUGINS_DIR`).
  CI therefore uses Backend's `scripts/appimage-gstreamer.sh`: `curate` builds a core + base + good (+ alsa) plugin
  folder for `GSTREAMER_PLUGINS_DIR`, and `check` fails the build if the AppImage contains any -bad, -ugly or -libav
  plugin or lacks `libgstmpg123.so`. That set plays the music (checked on the box:
  `evidence/v0.3.0/appimage-base-good-only-theme-mp3.txt`, 126 MB AppImage).
* DPI: handled by WebView2; minimum window 1280×720. Layout at *UI scale* 125/150 % on the minimum window size was not checked (Settings columns scroll when space is short).
* Not implemented from the UI/UX spec: Licences & credits sub-view, UI sounds (no files delivered), "play in the system
  browser" option (the game always opens in a launcher window), the `.win-frame` CSS frame (native window shadow used instead).
* "Galaxy online · ping" = round-trip time of `manifest.json`, not the game server ping.
* Linux AppImage: needs `bundleMediaFramework` (overlay `src-tauri/tauri.linux-appimage.conf.json`) or the WebKit
  process crashes at the `<audio>` element; WebKitGTK cannot stream media from the app protocol, so music falls back to
  a Blob URL. Linux is only the test proxy.
* The installer has no licence page (the licence text is the devs' — placeholder in the spec).

### NOT VERIFIED on macOS (no Mac; the macOS code was type-checked on Linux with `tools/check-macos.sh`, no SDK, no binary)
* The universal build, the styled .dmg, ad-hoc signing, Gatekeeper first-open steps, `minimumSystemVersion` 10.15.
* Traffic lights + title bar padding, the app menu (About/Hide/Quit, Edit copy/paste, Window full screen), ⌘, and ⌃⌘F.
* LAUNCH in the same window on WKWebView, music autoplay (falls back to the first click), the `.app.tar.gz` update.

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

## 11. Layout and build
`src/` UI (static HTML/CSS/JS; `css/settings.css` = spec copy) · `src-tauri/` Rust · `branding/` installer hooks,
language file and active art · `tools/` (`assets.sh`, `set-pubkey.mjs`, `build-local.sh`, `bake-star.py`,
`measure-webview.ps1`) · `bench/` · `evidence/` · `e2e/`, `e2e-windows/` (test only).

* Windows (CI and locally): `npm ci` then `npx tauri build --bundles nsis` (`npm run build`).
* Cross-build from Linux: `npm run build:win` (cargo-xwin). Box scripts: `tools/build-local.sh win|win-e2e|linux|linux-rel|linux-e2e`.
* macOS: only on a Mac / macOS CI: `npx tauri build --target universal-apple-darwin` (overlay `src-tauri/tauri.macos.conf.json` is
  picked up automatically). Linux: `npx tauri build --config src-tauri/tauri.linux-appimage.conf.json`.
* Updater signing needs `TAURI_SIGNING_PRIVATE_KEY` (+ password) in the environment; never commit a private key.
