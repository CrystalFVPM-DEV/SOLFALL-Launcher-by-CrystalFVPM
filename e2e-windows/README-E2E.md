# Windows update E2E test (0.2.1 → 0.2.2) — TEST ONLY

> These two installers are **not the delivery**. They are built with `tools/build-local.sh win-e2e 0.2.1|0.2.2`, i.e.
> the delivered `tauri.conf.json` **plus** the overlay `src-tauri/tauri.e2e.conf.json` (updater endpoint =
> local GitHub simulator on `http://127.0.0.1:8788`, `dangerousInsecureTransportProtocol: true`) and two
> **compile-time** variables: `SOLFALL_LAUNCHER_BASE=http://127.0.0.1:8787/launcher` and `SOLFALL_E2E_ALLOW_LOCALHOST=1`.
> The delivered installer (`dist/windows/`) has none of these. Signed with the **TEST-ONLY** updater key
> (pubkey id `B8AC8CD75A1001F5`) — TEST-key build, not for public release.

**What changed since 0.1.x:** there is no runtime override any more. `setx SOLFALL_LAUNCHER_BASE …` **does nothing** in a
release build (the variable is read at compile time via `option_env!`; the runtime variable is honoured only in debug
builds). The endpoint is baked into the E2E binaries, so you only need to start the two local servers.

| File | sha256 |
|---|---|
| see `SHA256SUMS.txt` (written by `make-kit.sh`) | |

Kit contents:
* `installers/0.2.1/`, `installers/0.2.2/` — NSIS installers + `.sig`.
* `root/launcher/` — `manifest.json` **without** an `updates` key (so the launcher falls back to its compiled
  endpoint, exactly like production with GitHub Releases) and `news.json` (sample data, marked `[SAMPLE]`).
* `gh-sim/` — state for the backend's GitHub Releases simulator: published release `v0.2.2` with the 0.2.2 installer,
  its `.sig` and `latest.json` (platform `windows-x86_64`, URL `…/releases/download/v0.2.2/…`). Verified with
  `manifests.mjs verify-tauri` against the TEST pubkey.
* `gh-sim-tampered/` — same release, but `latest.json` carries the signature of a different file (negative test).

## Steps (PowerShell, Windows 10/11 x64, Node ≥ 18, a copy of `backend/` from the PoC repo)
1. Install 0.2.1: double-click `installers\0.2.1\SolfallLauncher_0.2.1_x64-setup.exe`
   (SmartScreen: **More info → Run anyway**; expected, there is no Authenticode signature). It installs per-user into
   `%LOCALAPPDATA%\SolfallLauncher\`. Close the launcher if it opens.
2. Terminal A (launcher base: manifest + news):
   `node <backend>\server\serve.mjs --root <kit>\root --port 8787 --host 127.0.0.1`
3. Terminal B (GitHub Releases simulator; `latest/download` → 302 → `download/v0.2.2` → 302 → object host on :8789):
   `node <backend>\server\serve.mjs --github-sim --gh-root <kit>\gh-sim --port 8788`
4. Start **SOLFALL** from the Start menu. Expected, in order:
   * A: `GET /launcher/manifest.json -> 200`, `GET /launcher/news.json -> 200`;
   * B: `GET 127.0.0.1:8788/CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM/releases/latest/download/latest.json -> 302`,
     then `…/download/v0.2.2/latest.json -> 302`, `localhost:8789/… -> 200`;
   * UI **launcher-update**: "Launcher 0.2.2 downloading in background · N %" (LAUNCH stays enabled);
   * B: `…/download/v0.2.2/SolfallLauncher_0.2.2_x64-setup.exe -> 302`, `localhost:8789/… -> 200`;
   * UI **ready**: "✓ Launcher 0.2.2 ready" + **Restart to apply**;
   * click it → blocking **update** state (3 s grace, Cancel goes back) → passive NSIS install → relaunch;
   * after the relaunch: "Launcher 0.2.2 · ✓ Up to date" (Settings → About also shows 0.2.2).
   * diagnostics: Settings → About → **Open logs folder** (`%LOCALAPPDATA%\SolfallLauncher\logs\launcher.log`) has the
     WebView2 version, args, page loads, the update steps and the LAUNCH choice. Please send it with any failure.
5. Negative test: reinstall 0.2.1, restart terminal B with `--gh-root <kit>\gh-sim-tampered`, open the launcher →
   it downloads, **rejects** the signature and stays on main with **"⚠ Update rejected (invalid signature)"**, LAUNCH enabled.
6. Servers off → "⚠ Updates unavailable", LAUNCH enabled (never blocks the game).

While the E2E build is installed, please also check (all NOT VERIFIED on our side, no Windows machine):
* taskbar: the launcher window, the game window and the pinned/Start-menu shortcut group under one **SOLFALL** button
  (AUMID `online.solfall.launcher`);
* **F11** toggles fullscreen in the launcher **and** in the game window; the maximise button works;
* Settings → Audio → Music on: the theme plays (WebView2 runs with `--autoplay-policy=no-user-gesture-required`);
* the installer pages look like `screenshots/v0.2.1/installer-wine/` (those were captured under wine);
* RAM: `tools\measure-webview.ps1` (see [developer notes §6](../docs/DEVELOPERS.md#6-idle-cpu-and-ram-linux-proxy-webkitgtk-software-rendering-xvfb-whole-process-tree-bench)).

Reproduce the kit data on the Linux box: `e2e-windows/make-kit.sh` (needs the two E2E builds).
Linux run of the same flow (done, logs in `evidence/v0.2.1/`): `e2e/v0.2.1/make-e2e.sh root|publish [--tamper]`.
