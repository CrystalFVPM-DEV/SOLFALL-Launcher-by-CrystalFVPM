#!/bin/bash
# Rebuilds the Windows E2E kit data (run on the Linux box after tools/build-local.sh win-e2e 0.2.1 / 0.2.2).
#   root/launcher/   -> manifest.json (NO "updates" key: the launcher uses its compiled endpoint) + news.json
#   gh-sim/          -> GitHub Releases simulator state: release v0.2.2 = installer + .sig + latest.json (windows-x86_64)
#   gh-sim-tampered/ -> same, but latest.json carries the signature of OTHER content (negative test)
set -e
cd "$(dirname "$0")"; H=$(pwd); B=/workspace/solfall-launcher-poc/backend
OWN=CrystalFVPM-DEV; REPO=SOLFALL-Launcher-by-CrystalFVPM; EXE=$H/installers/0.2.2/SolfallLauncher_0.2.2_x64-setup.exe
mkdir -p root/launcher
cp ../e2e/v0.2.0/root/launcher/manifest.json root/launcher/manifest.json
cp ../src/js/news.bundled.json root/launcher/news.json
for G in gh-sim gh-sim-tampered; do
  node $B/updates/github-releases/gh-sim-publish.mjs --root $H/$G --reset >/dev/null
  T=$(mktemp -d)
  node $B/scripts/manifests.mjs tauri --version 0.2.2 --notes "Launcher 0.2.2 (local E2E)" \
     --platform windows-x86_64=$EXE --base-url http://127.0.0.1:8788/$OWN/$REPO/releases/download/v0.2.2 --out $T >/dev/null
  if [ $G = gh-sim-tampered ]; then
    python3 - "$T/latest.json" "$H/installers/0.2.1/SolfallLauncher_0.2.1_x64-setup.exe.sig" <<'PY'
import json,sys; p,s=sys.argv[1:]; j=json.load(open(p)); o=open(s).read().strip()
for v in j['platforms'].values(): v['signature']=o
json.dump(j,open(p,'w'),indent=2)
PY
  fi
  node $B/updates/github-releases/gh-sim-publish.mjs --root $H/$G --release v0.2.2 --installer $EXE --latest-json $T/latest.json >/dev/null
  rm -rf $T
done
node $B/scripts/manifests.mjs verify-tauri --manifest gh-sim/v0.2.2/latest.json --platform windows-x86_64 --file $EXE --pubkey ../keys/TEST-ONLY-updater.key.pub
sha256sum installers/*/* > SHA256SUMS.txt; cat SHA256SUMS.txt
