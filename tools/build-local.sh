#!/bin/bash
# Local builds (Linux box). Logs in build-logs/. The only private key used is the TEST-ONLY one in keys/ (gitignored), for E2E.
#   tools/build-local.sh win            -> Windows NSIS, release config (PRODUCTION pubkey), UNSIGNED (no private key on
#                                          this box; createUpdaterArtifacts off) -> dist/verify-unsigned/ (not for distribution)
#   tools/build-local.sh win-e2e [ver]  -> Windows NSIS E2E kit (gh-sim endpoint, http allowed) 0.2.1 or 0.2.2
#   tools/build-local.sh linux          -> Linux raw binary, release config, unsigned
# E2E builds embed the TEST-ONLY pubkey via src-tauri/tauri.e2e.conf.json and are signed with keys/TEST-ONLY-updater.key.
#   tools/build-local.sh linux-e2e [ver]-> Linux AppImage E2E 0.2.1 or 0.2.2
set -e
cd "$(dirname "$0")/.."; source ~/tools/env.sh; mkdir -p build-logs
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
testkey() { export TAURI_SIGNING_PRIVATE_KEY="$(cat keys/TEST-ONLY-updater.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""; }
UNSIGNED=(--config src-tauri/tauri.verify-unsigned.conf.json)
unset SOLFALL_LAUNCHER_BASE SOLFALL_E2E_ALLOW_LOCALHOST
V=${2:-0.2.1}; E2E=(--config src-tauri/tauri.e2e.conf.json); [ "$V" = 0.2.2 ] && E2E+=(--config src-tauri/tauri.e2e-0.2.2.conf.json)
e2eenv() { testkey; export SOLFALL_LAUNCHER_BASE=http://127.0.0.1:8787/launcher SOLFALL_E2E_ALLOW_LOCALHOST=1; }
case $1 in
  win) N=src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis; rm -rf $N
       npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis "${UNSIGNED[@]}" > build-logs/win.log 2>&1
       mkdir -p dist/verify-unsigned && for f in $N/SolfallLauncher_*_x64-setup.exe; do cp "$f" "dist/verify-unsigned/$(basename "${f%.exe}")-UNSIGNED-VERIFY-ONLY.exe"; done ;;
  win-e2e) e2eenv; npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis "${E2E[@]}" > build-logs/win-e2e-$V.log 2>&1 ;;
  linux) npx tauri build --no-bundle "${UNSIGNED[@]}" > build-logs/linux.log 2>&1 ;;
  linux-e2e) e2eenv; npx tauri build --bundles appimage "${E2E[@]}" --config src-tauri/tauri.linux-appimage.conf.json > build-logs/linux-e2e-$V.log 2>&1 ;;
esac
echo "BUILD $1 $V OK"
