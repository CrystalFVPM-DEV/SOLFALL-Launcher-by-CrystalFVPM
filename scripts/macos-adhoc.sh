#!/usr/bin/env bash
# Verificación de la firma AD-HOC y de las arquitecturas del bundle macOS — la usa release.yml (jobs macOS) DESPUÉS de
# `tauri build` y ANTES de recoger/verificar los artefactos del updater.
#
#   macos-adhoc.sh --app <SolfallLauncher.app> --dmg <.dmg> --tar <SolfallLauncher.app.tar.gz> --archs "x86_64 arm64" \
#                  --version X.Y.Z [--volname SolfallLauncher]
#
# 1. lipo -archs Contents/MacOS/<CFBundleExecutable> == --archs (universal: x86_64 + arm64; plan B: una sola).
# 2. codesign --verify --deep --strict --verbose=2 sobre el .app y firma "adhoc" (sin Team ID). tauri-bundler 2.10.x
#    firma de dentro hacia fuera (frameworks/binarios y luego el .app) con signingIdentity "-", así que lo normal es que
#    pase tal cual.
# 3. Si NO pasa: `codesign --force --deep -s -` sobre el .app, se re-verifica y se REGENERAN, en este orden:
#    - el .app.tar.gz (mismo layout que tauri-bundler: "SolfallLauncher.app/..." en la raíz, sin AppleDouble),
#    - el .dmg con hdiutil (UDZO, .app + enlace a /Applications; se pierde el fondo/posiciones del dmg de Tauri, que
#      exige Finder/AppleScript: aviso ::warning::),
#    - la firma del updater: `npx tauri signer sign --app-version X.Y.Z` (tauri-cli 2.12.x escribe entonces
#      "version:X.Y.Z" en el trusted comment, como `tauri build`; tauri-plugin-updater 2.14 rechaza una firma sin la
#      versión anunciada). Si el CLI no soporta --app-version o la firma resultante no lleva version:X.Y.Z -> FALLA
#      (nunca se publica un .app.tar.gz con una firma que no corresponda o sin versión).
#    Al usar este camino de respaldo: anotación ::warning:: visible y una sección de aviso en $GITHUB_STEP_SUMMARY
#    (si la variable no está definida o no se puede escribir, sólo la anotación). En el camino normal, nada.
# 4. Siempre: el .app dentro del .app.tar.gz y dentro del .dmg verifica con codesign y tiene el MISMO CDHash que el .app
#    verificado (la firma minisign se calcula sobre ese tarball final).
# Comandos: codesign, lipo, hdiutil, tar, npx y PLISTBUDDY (por defecto /usr/libexec/PlistBuddy); los tests los
# sustituyen por stubs en PATH.
set -euo pipefail
die() { echo "::error::$*" >&2; exit 1; }
APP="" DMG="" TAR="" ARCHS="" VERSION="" VOLNAME=SolfallLauncher
while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP=$2 ;; --dmg) DMG=$2 ;; --tar) TAR=$2 ;; --archs) ARCHS=$2 ;; --version) VERSION=$2 ;; --volname) VOLNAME=$2 ;;
    *) die "opción desconocida: $1" ;;
  esac; shift 2
done
[ -n "$APP" ] && [ -n "$DMG" ] && [ -n "$TAR" ] && [ -n "$ARCHS" ] && [ -n "$VERSION" ] || die "uso: $0 --app A --dmg D --tar T --archs \"...\" --version X.Y.Z"
PLISTBUDDY=${PLISTBUDDY:-/usr/libexec/PlistBuddy}
[ -d "$APP" ] || die "no existe $APP (¿productName distinto de SolfallLauncher?)"
[ -f "$DMG" ] || die "no existe $DMG"
[ -f "$TAR" ] || die "no existe $TAR"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

exe=$("$PLISTBUDDY" -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist") || die "no se pudo leer CFBundleExecutable de $APP/Contents/Info.plist"
BIN="$APP/Contents/MacOS/$exe"
[ -f "$BIN" ] || die "no existe el binario $BIN"
got=$(lipo -archs "$BIN" | tr ' ' '\n' | grep . | LC_ALL=C sort | tr '\n' ' ')
want=$(printf '%s\n' "$ARCHS" | tr ' ' '\n' | grep . | LC_ALL=C sort | tr '\n' ' ')
[ "$got" = "$want" ] || die "lipo -archs $BIN = [${got% }], se esperaba [${want% }]"
echo "OK lipo: $exe = ${got% }"

verify_app() { # verify_app <app>: codesign estricto + ad-hoc
  codesign --verify --deep --strict --verbose=2 "$1" > "$WORK/verify.log" 2>&1 || return 1
  codesign -dv --verbose=4 "$1" > "$WORK/info.log" 2>&1 || return 1
  grep -q '^Signature=adhoc' "$WORK/info.log" || return 1
  if grep -q '^TeamIdentifier=' "$WORK/info.log" && ! grep -q '^TeamIdentifier=not set' "$WORK/info.log"; then return 1; fi
}
fallback_notice() { # aviso visible del camino de respaldo (anotación + resumen del job)
  local msg="macOS ad-hoc re-sign fallback ran: dmg rebuilt without Tauri background/layout"
  echo "::warning title=macOS ad-hoc re-sign fallback::⚠️ $msg ($(basename "$DMG"); $(basename "$APP") re-signed with codesign --force --deep -s -; updater signature regenerated with --app-version $VERSION)"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "## ⚠️ $msg"
      echo
      echo "- \`$(basename "$APP")\` did not pass \`codesign --verify --deep --strict\` as built by Tauri, so it was re-signed with \`codesign --force --deep -s -\`."
      echo "- \`$(basename "$DMG")\` was rebuilt with \`hdiutil\` (UDZO): it does NOT have Tauri's dmg background, window size or icon positions."
      echo "- \`$(basename "$TAR")\` was regenerated and re-signed with \`tauri signer sign --app-version $VERSION\`."
      echo
    } >> "$GITHUB_STEP_SUMMARY" 2>/dev/null || echo "::warning::no se pudo escribir en GITHUB_STEP_SUMMARY ($GITHUB_STEP_SUMMARY)"
  fi
}
cdhash() { codesign -dv --verbose=4 "$1" 2>&1 | sed -n 's/^CDHash=//p' | head -1; }

FIXED=0
if verify_app "$APP"; then
  echo "OK codesign --verify --deep --strict: $APP (ad-hoc, firmado por tauri build)"
else
  echo "::warning::$APP no pasa codesign --verify --deep --strict o no es ad-hoc; se re-firma con codesign --force --deep -s -"
  sed 's/^/    /' "$WORK/verify.log" || true
  codesign --force --deep -s - "$APP"
  verify_app "$APP" || { sed 's/^/    /' "$WORK/verify.log"; die "$APP sigue sin verificar tras codesign --force --deep -s -"; }
  echo "OK re-firmado ad-hoc (deep): $APP"
  FIXED=1
fi
APP_CDHASH=$(cdhash "$APP"); [ -n "$APP_CDHASH" ] || die "no se pudo leer el CDHash de $APP"

if [ "$FIXED" = 1 ]; then
  # (a) .app.tar.gz con el mismo layout que tauri-bundler (append_dir_all("SolfallLauncher.app", app))
  rm -f "$TAR" "$TAR.sig"
  COPYFILE_DISABLE=1 tar -czf "$TAR" -C "$(dirname "$APP")" "$(basename "$APP")"
  echo "regenerado $TAR"
  # (b) .dmg con hdiutil
  mkdir -p "$WORK/dmgroot"
  cp -R "$APP" "$WORK/dmgroot/"
  ln -s /Applications "$WORK/dmgroot/Applications"
  rm -f "$DMG"
  hdiutil create -volname "$VOLNAME" -srcfolder "$WORK/dmgroot" -ov -format UDZO "$DMG" >/dev/null
  echo "::warning::$DMG regenerado con hdiutil (sin el fondo/posiciones del dmg de Tauri)"
  # (c) firma del updater con la versión en el trusted comment
  npx tauri signer sign --help > "$WORK/signer-help.txt" 2>&1 || die "npx tauri signer sign --help falló"
  grep -q -- '--app-version' "$WORK/signer-help.txt" || die "este tauri-cli no soporta 'signer sign --app-version': no se puede re-firmar $TAR con version:$VERSION (tauri-plugin-updater 2.14 lo rechazaría). NO se publica."
  [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] || die "falta TAURI_SIGNING_PRIVATE_KEY para re-firmar $TAR"
  npx tauri signer sign --app-version "$VERSION" "$TAR" > "$WORK/sign.log" 2>&1 || { sed 's/^/    /' "$WORK/sign.log"; die "tauri signer sign falló"; }
  echo "re-firmado (updater) $TAR con --app-version $VERSION"
  fallback_notice
fi

# El .sig del tarball final debe existir y llevar version:<VERSION> en el trusted comment
[ -f "$TAR.sig" ] || die "falta $TAR.sig"
tc=$(base64 -d < "$TAR.sig" 2>/dev/null | sed -n 's/^trusted comment: //p' | head -1)
case "$tc" in
  *"version:$VERSION") echo "OK $TAR.sig: trusted comment \"$tc\"" ;;
  *) die "$TAR.sig no lleva version:$VERSION en el trusted comment (\"$tc\"); tauri-plugin-updater 2.14 lo rechazaría. NO se publica." ;;
esac

# El .app del tarball y el del dmg son el verificado
mkdir -p "$WORK/untar"; tar -xzf "$TAR" -C "$WORK/untar"
T_APP="$WORK/untar/$(basename "$APP")"
[ -d "$T_APP" ] || die "$TAR no contiene $(basename "$APP") en la raíz"
verify_app "$T_APP" || die "el .app dentro de $TAR no verifica con codesign --deep --strict"
[ "$(cdhash "$T_APP")" = "$APP_CDHASH" ] || die "el .app dentro de $TAR no es el verificado (CDHash distinto)"
echo "OK $TAR contiene el .app verificado (CDHash $APP_CDHASH)"
mkdir -p "$WORK/mnt"
hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$WORK/mnt" "$DMG" >/dev/null || die "no se pudo montar $DMG"
rc=0
if [ ! -d "$WORK/mnt/$(basename "$APP")" ]; then echo "::error::$DMG no contiene $(basename "$APP")" >&2; rc=1
elif ! verify_app "$WORK/mnt/$(basename "$APP")"; then echo "::error::el .app dentro de $DMG no verifica con codesign --deep --strict" >&2; rc=1
elif [ "$(cdhash "$WORK/mnt/$(basename "$APP")")" != "$APP_CDHASH" ]; then echo "::error::el .app dentro de $DMG no es el verificado (CDHash distinto)" >&2; rc=1
fi
hdiutil detach "$WORK/mnt" >/dev/null || hdiutil detach -force "$WORK/mnt" >/dev/null || true
[ "$rc" = 0 ] || exit 1
echo "OK $DMG contiene el .app verificado"
echo "macOS ad-hoc: OK (re-firmado: $([ "$FIXED" = 1 ] && echo sí || echo no))"
