#!/bin/bash
# ONE command to (re)generate every icon size and the NSIS bitmaps from one source each.
#   tools/assets.sh            -> prefers FINAL assets from $SOLFALL_SPEC_DIR (default /workspace/solfall/spec):
#                                   icon/*.png (largest, 1:1, ideally 1024 px)  icon/solfall.ico (optional)
#                                   installer/header.bmp (150x57)  installer/sidebar.bmp (164x314)
#                                 and falls back to branding/temp/*-TEMPORARY.* for anything missing.
# Output: branding/active/ (what the build uses) + branding/active/SOURCES.txt (final vs TEMPORARY),
#         src-tauri/icons/* via `tauri icon`, and a multi-size icon.ico (16/24/32/48/64/128/256).
set -e
cd "$(dirname "$0")/.."
SPEC=${SOLFALL_SPEC_DIR:-/workspace/solfall/spec}
A=branding/active; mkdir -p $A; : > $A/SOURCES.txt
pick() { # name final temp
  if [ -n "$2" ] && [ -f "$2" ]; then echo "$1: FINAL      $2" >> $A/SOURCES.txt; echo "$2";
  else echo "$1: TEMPORARY  $3" >> $A/SOURCES.txt; echo "$3"; fi; }
FINAL_PNG=$(ls "$SPEC"/icon/*1024*.png 2>/dev/null | head -1 || true)   # 1:1 master (not the contact sheet)
ICON=$(pick icon "$FINAL_PNG" branding/temp/icon-source-TEMPORARY.png)
HEADER=$(pick header "$SPEC/installer/header.bmp" branding/temp/header-TEMPORARY.bmp)
SIDEBAR=$(pick sidebar "$SPEC/installer/sidebar.bmp" branding/temp/sidebar-TEMPORARY.bmp)
FINAL_ICO=""; [ -f "$SPEC/icon/solfall.ico" ] && FINAL_ICO="$SPEC/icon/solfall.ico"
read W H < <(identify -format "%w %h\n" "$ICON"); [ "$W" = "$H" ] || { echo "icon source must be 1:1 (is ${W}x${H})"; exit 1; }
cp "$ICON" $A/icon.png
# NSIS/MUI2 needs 24-bit BMP3 at exact sizes; normalise whatever arrives.
bmp() { # src WxH dst — Product's BMP3 24-bit files are copied verbatim; anything else is normalised.
  if [ "$(identify -format '%m %wx%h %z' "$1")" = "BMP3 $2 8" ] && [ "$(head -c 30 "$1" | tail -c 2 | od -An -tu2 | tr -d ' ')" = 24 ]; then cp "$1" "$3";
  else convert "$1" -resize "$2!" -alpha off -type TrueColor BMP3:"$3"; fi; }
bmp "$HEADER" 150x57 $A/header.bmp
bmp "$SIDEBAR" 164x314 $A/sidebar.bmp
npx --no-install tauri icon $A/icon.png -o src-tauri/icons > /tmp/tauri-icon.log 2>&1 || { cat /tmp/tauri-icon.log; exit 1; }
rm -rf src-tauri/icons/android src-tauri/icons/ios
SIZES="16 24 32 48 64 128 256"; PNGDIR="$SPEC/icon/png"; have_all=1
for n in $SIZES; do [ -f "$PNGDIR/solfall-$n.png" ] || have_all=0; done
if [ "$ICON" != branding/temp/icon-source-TEMPORARY.png ] && [ $have_all = 1 ]; then
  # Product's per-size pixel-art PNGs for the PNG icons Tauri lists (no resampling).
  cp "$PNGDIR/solfall-32.png" src-tauri/icons/32x32.png; cp "$PNGDIR/solfall-64.png" src-tauri/icons/64x64.png
  cp "$PNGDIR/solfall-128.png" src-tauri/icons/128x128.png; cp "$PNGDIR/solfall-256.png" src-tauri/icons/128x128@2x.png
fi
if [ -n "$FINAL_ICO" ]; then
  # spec/icon/README: `tauri icon` resamples the .ico and loses the hand-simplified 16/24/32 → OVERWRITE with solfall.ico.
  cp "$FINAL_ICO" src-tauri/icons/icon.ico; echo "ico: FINAL      $FINAL_ICO (verbatim, overwrites tauri icon output)" >> $A/SOURCES.txt
elif [ $have_all = 1 ]; then
  convert $(for n in $SIZES; do echo "$PNGDIR/solfall-$n.png"; done) src-tauri/icons/icon.ico
  echo "ico: FINAL      $PNGDIR/solfall-{16..256}.png (assembled, not resampled)" >> $A/SOURCES.txt
else
  convert $A/icon.png -background none -define icon:auto-resize=256,128,64,48,32,24,16 src-tauri/icons/icon.ico
  echo "ico: TEMPORARY  generated from icon source (16/24/32/48/64/128/256)" >> $A/SOURCES.txt
fi
cp src-tauri/icons/icon.ico $A/installer.ico
cat $A/SOURCES.txt
identify src-tauri/icons/icon.ico | awk '{print "  ico entry:", $3}'
