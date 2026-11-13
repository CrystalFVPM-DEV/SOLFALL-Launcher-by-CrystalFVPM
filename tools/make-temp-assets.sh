#!/bin/bash
# Generates the TEMPORARY branding sources (icon + NSIS bitmaps) from the low-res reference emblem
# and the spec palette (void #05070d / holo #5ce1ff / sun #ffc247). Product will send final assets;
# tools/assets.sh prefers them automatically when they land in /workspace/solfall/spec/{icon,installer}/.
set -e
cd "$(dirname "$0")/.."
REF=${1:-/workspace/solfall/user-assets/solfall-logo-lowres.webp}
T=branding/temp
mkdir -p $T
# 1) Emblem: 128 px reference -> 1024 px (Lanczos + light unsharp), circular alpha mask.
convert "$REF" -alpha off -filter Lanczos -resize 1024x1024 -unsharp 0x1.2+0.6+0.02 /tmp/emblem-up.png
convert -size 1024x1024 xc:black -fill white -draw "circle 512,512 512,86" -blur 0x2 /tmp/emblem-mask.png
convert /tmp/emblem-up.png /tmp/emblem-mask.png -alpha off -compose CopyOpacity -composite \
  -define png:color-type=6 $T/icon-source-TEMPORARY.png
# 2) NSIS header 150x57 (24-bit BMP): void background, holo rule, emblem at right.
convert -size 150x57 xc:'#05070d' \
  -fill '#0a1019' -draw "rectangle 0,0 150,40" \
  -fill '#5ce1ff' -draw "rectangle 0,54 150,55" -fill '#ffc247' -draw "rectangle 0,56 60,56" \
  \( $T/icon-source-TEMPORARY.png -resize 46x46 \) -geometry +100+5 -composite \
  -alpha off -type TrueColor BMP3:$T/header-TEMPORARY.bmp
# 3) NSIS sidebar 164x314 (24-bit BMP): void->deep gradient, sun glow, emblem, holo edge, "TEMPORARY" tag.
convert -size 164x314 gradient:'#0a1019'-'#05070d' \
  \( -size 328x328 radial-gradient:'rgba(255,140,30,0.5)'-'rgba(255,140,30,0)' -geometry -82+150 \) -compose over -composite \
  \( $T/icon-source-TEMPORARY.png -resize 120x120 \) -geometry +22+70 -compose over -composite \
  -fill '#5ce1ff' -draw "rectangle 162,0 163,314" \
  -fill '#ffc247' -font DejaVu-Sans-Bold -pointsize 15 -gravity north -annotate +0+212 'S O L F A L L' \
  -fill '#758ea1' -font DejaVu-Sans -pointsize 8 -gravity south -annotate +0+8 'TEMPORARY ARTWORK' \
  -alpha off -type TrueColor BMP3:$T/sidebar-TEMPORARY.bmp
identify $T/*
