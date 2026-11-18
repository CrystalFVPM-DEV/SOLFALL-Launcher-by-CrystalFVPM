#!/usr/bin/env bash
# GStreamer del AppImage de Linux (bundleMediaFramework) — lo usa .github/workflows/release.yml (job linux).
#
# Por qué: el plugin gstreamer de linuxdeploy que trae tauri-bundler 2.10.x (linuxdeploy-plugin-gstreamer.sh) copia
# TODOS los archivos de GSTREAMER_PLUGINS_DIR (por defecto /usr/lib/<triplete>/gstreamer-1.0) y NO lee
# GSTREAMER_INCLUDE_BAD_PLUGINS (sólo aparece en su texto de ayuda). Así que lo que haya instalado en el runner acaba
# en el AppImage. Este script:
#   curate <dir>       arma <dir> SÓLO con los plugins de los paquetes CURATE_PKGS (core + base + good + alsa, todos de
#                      las fuentes gst-plugins-base/-good, LGPL) según `dpkg -L`; falla si falta libgstmpg123.so (MP3)
#                      o si alguno está en la denylist. El workflow exporta GSTREAMER_PLUGINS_DIR=<dir>.
#   check <AppImage>   extrae el AppImage (unsquashfs con el offset del runtime; si no hay unsquashfs,
#                      --appimage-extract) y FALLA si algún plugin empaquetado pertenece a DENY_PKGS (plugins-bad, libav,
#                      plugins-ugly; listas sacadas de los .deb con `apt-get download` + `dpkg-deb -c`, así no hace falta
#                      instalarlos, más una denylist fija de respaldo), si alguno NO pertenece a ALLOW_PKGS (procedencia:
#                      sólo gst core/base/good/alsa/gl/x), si falta libgstmpg123.so o si falta gst-plugin-scanner.
# Tests: GST_PKG_DEBS=<dir con los .deb> hace que las listas salgan de `dpkg-deb -c <dir>/<pkg>_*.deb` (y, en curate,
# los archivos de GST_PKG_ROOT=<raíz con los .deb extraídos>) en vez de dpkg -L / apt-get download.
set -euo pipefail

CURATE_PKGS=${CURATE_PKGS:-"libgstreamer1.0-0 gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-alsa"}
ALLOW_PKGS=${ALLOW_PKGS:-"libgstreamer1.0-0 gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-alsa gstreamer1.0-gl gstreamer1.0-x"}
DENY_PKGS=${DENY_PKGS:-"gstreamer1.0-plugins-bad gstreamer1.0-libav gstreamer1.0-plugins-ugly"}
REQUIRED_PLUGIN=libgstmpg123.so   # decoder MP3 (theme.mp3); en -good desde GStreamer 1.18 (22.04 trae 1.20)
# Respaldo fijo (por si una lista dinámica viniera vacía): libav + plugins -bad/-ugly conocidos (códecs con patentes o
# licencias problemáticas y los más grandes).
STATIC_DENY="libgstlibav.so libgstopenh264.so libgstx265.so libgstfaad.so libgstvoaacenc.so libgstvoamrwbenc.so
libgstdtsdec.so libgstde265.so libgstrtmp.so libgstrtmp2.so libgstwebrtc.so libgstsrtp.so libgstdtls.so libgsthls.so
libgstdash.so libgstmpegtsdemux.so libgstmpegtsmux.so libgstmpegpsdemux.so libgstnvcodec.so libgstva.so libgstmsdk.so
libgstx264.so libgsta52dec.so libgstasf.so libgstdvdread.so libgstmpeg2dec.so libgstrealmedia.so libgstsid.so
libgstcdio.so libgstdvdlpcmdec.so libgstdvdsub.so"

read -r -a CURATE <<< "$CURATE_PKGS"; read -r -a ALLOW <<< "$ALLOW_PKGS"; read -r -a DENY <<< "$DENY_PKGS"
read -r -d '' -a STATIC <<< "$STATIC_DENY" || true

die() { echo "::error::$*" >&2; exit 1; }
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

# Imprime los paths (absolutos, /usr/...) de los plugins (.so directamente en .../gstreamer-1.0/) de un paquete.
pkg_plugins() {
  local pkg=$1 deb
  if [ -n "${GST_PKG_DEBS:-}" ]; then
    deb=$(find "$GST_PKG_DEBS" -maxdepth 1 -name "${pkg}_*.deb" | sort | tail -1)
    [ -n "$deb" ] || die "no hay ${pkg}_*.deb en $GST_PKG_DEBS"
    dpkg-deb -c "$deb" | awk '{print $NF}' | sed 's#^\./#/#'
  elif dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed'; then
    dpkg -L "$pkg"
  else
    mkdir -p "$WORK/debs"
    (cd "$WORK/debs" && apt-get download "$pkg" >/dev/null 2>&1) || die "apt-get download $pkg falló (¿apt-get update?)"
    deb=$(find "$WORK/debs" -maxdepth 1 -name "${pkg}_*.deb" | sort | tail -1)
    [ -n "$deb" ] || die "apt-get download $pkg no dejó ningún .deb"
    dpkg-deb -c "$deb" | awk '{print $NF}' | sed 's#^\./#/#'
  fi | grep -E '^/usr/lib/([^/]+/)?gstreamer-1\.0/[^/]+\.so$' || true
}
names_of() { local p; for p in "$@"; do pkg_plugins "$p"; done | sed 's#.*/##' | LC_ALL=C sort -u; }

curate() {
  local out=$1 root=${GST_PKG_ROOT:-} pkg f n count=0
  [ -n "$out" ] || die "uso: curate <dir>"
  rm -rf "$out"; mkdir -p "$out"
  names_of "${DENY[@]}" > "$WORK/deny.txt"; printf '%s\n' "${STATIC[@]}" >> "$WORK/deny.txt"
  for pkg in "${CURATE[@]}"; do
    pkg_plugins "$pkg" > "$WORK/p.txt"
    [ -s "$WORK/p.txt" ] || die "$pkg no aporta plugins (¿instalado?)"
    while IFS= read -r f; do
      n=$(basename "$f")
      grep -qxF "$n" "$WORK/deny.txt" && die "$n de $pkg está en la denylist (-bad/-libav/-ugly)"
      [ -f "$root$f" ] || die "falta $root$f (de $pkg)"
      cp -L "$root$f" "$out/$n"; count=$((count + 1))
    done < "$WORK/p.txt"
  done
  [ -f "$out/$REQUIRED_PLUGIN" ] || die "falta $REQUIRED_PLUGIN (decoder MP3) en los plugins curados"
  [ "$count" -ge 20 ] || die "sólo $count plugins curados; algo raro en $CURATE_PKGS"
  echo "GStreamer curado: $count plugins de [$CURATE_PKGS] en $out (incluye $REQUIRED_PLUGIN)"
}

extract_gst() { # extract_gst <AppImage> <dest> : extrae sólo usr/lib/gstreamer* (sin FUSE)
  local img=$1 dest=$2 off
  img=$(readlink -f "$img")
  if command -v unsquashfs >/dev/null 2>&1; then
    off=$(env -u APPIMAGE_EXTRACT_AND_RUN "$img" --appimage-offset) || die "no se pudo leer el offset de $img"
    unsquashfs -q -n -f -d "$dest" -o "$off" "$img" usr/lib/gstreamer-1.0 usr/lib/gstreamer1.0 >/dev/null \
      || die "unsquashfs falló sobre $img"
  else
    mkdir -p "$dest.x"; (cd "$dest.x" && env -u APPIMAGE_EXTRACT_AND_RUN "$img" --appimage-extract 'usr/lib/gstreamer*' >/dev/null) \
      || die "--appimage-extract falló sobre $img"
    mv "$dest.x/squashfs-root" "$dest"
  fi
}

check() {
  local img=$1 pdir bad=0 n
  [ -f "$img" ] || die "no existe el AppImage $img"
  extract_gst "$img" "$WORK/root"
  pdir=$WORK/root/usr/lib/gstreamer-1.0
  [ -d "$pdir" ] || die "$img no trae usr/lib/gstreamer-1.0 (¿bundleMediaFramework desactivado?)"
  find "$pdir" -maxdepth 1 -type f -name '*.so' -printf '%f\n' | LC_ALL=C sort > "$WORK/bundled.txt"
  [ -s "$WORK/bundled.txt" ] || die "$img: usr/lib/gstreamer-1.0 vacío"
  if find "$pdir" -mindepth 2 -name '*.so' | grep -q .; then die "$img: hay .so en subcarpetas de usr/lib/gstreamer-1.0"; fi
  [ -f "$WORK/root/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner" ] || die "$img: falta gst-plugin-scanner"
  : > "$WORK/deny.txt"
  for p in "${DENY[@]}"; do names_of "$p" | sed "s/\$/ $p/" >> "$WORK/deny.txt"; done
  for n in "${STATIC[@]}"; do echo "$n denylist-fija" >> "$WORK/deny.txt"; done
  [ "$(grep -c 'gstreamer1.0-plugins-bad$' "$WORK/deny.txt")" -ge 50 ] || die "la lista de gstreamer1.0-plugins-bad salió sospechosamente corta"
  names_of "${ALLOW[@]}" > "$WORK/allow.txt"
  grep -qxF "$REQUIRED_PLUGIN" "$WORK/allow.txt" || die "la allowlist no incluye $REQUIRED_PLUGIN"
  while IFS= read -r n; do
    if grep -q "^$n " "$WORK/deny.txt"; then
      echo "::error::$img contiene $n (de $(grep "^$n " "$WORK/deny.txt" | head -1 | cut -d' ' -f2))" >&2; bad=$((bad + 1))
    elif ! grep -qxF "$n" "$WORK/allow.txt"; then
      echo "::error::$img contiene $n, que no es de [$ALLOW_PKGS]" >&2; bad=$((bad + 1))
    fi
  done < "$WORK/bundled.txt"
  grep -qxF "$REQUIRED_PLUGIN" "$WORK/bundled.txt" || { echo "::error::$img NO contiene $REQUIRED_PLUGIN (sin él no suena theme.mp3)" >&2; bad=$((bad + 1)); }
  [ "$bad" -eq 0 ] || die "$bad problema(s) de GStreamer en $(basename "$img"); NO se publica"
  echo "OK $(basename "$img"): $(wc -l < "$WORK/bundled.txt") plugins GStreamer, todos de [$ALLOW_PKGS]; ninguno de [$DENY_PKGS]; $REQUIRED_PLUGIN presente"
}

case "${1:-}" in
  curate) shift; curate "${1:-}" ;;
  check) shift; check "${1:?uso: check <AppImage>}" ;;
  *) die "uso: $0 curate <dir> | check <AppImage>" ;;
esac
