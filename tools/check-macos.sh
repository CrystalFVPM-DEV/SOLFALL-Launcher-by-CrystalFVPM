#!/bin/bash
# Type-check (cargo check, NO link, NO binary) the macOS code paths on the Linux box, without an Apple SDK.
# The C parts of objc2-exception-helper / ring are compiled against tiny stub headers (tools/macos-check-stubs);
# the result proves the Rust code for aarch64/x86_64-apple-darwin compiles. Real builds happen on macOS CI only.
set -e; cd "$(dirname "$0")/../src-tauri"; source ~/tools/env.sh
RD=$(clang -print-resource-dir); S=$(cd ../tools/macos-check-stubs && pwd)
for t in aarch64-apple-darwin x86_64-apple-darwin; do
  T=${t//-/_}; tt=$([ $t = x86_64-apple-darwin ] && echo x86_64-apple-macos10.15 || echo arm64-apple-macos11)
  env CC_$T=clang CFLAGS_$T="--target=$tt -ffreestanding -nostdlibinc -isystem $RD/include -isystem $S" cargo check --release --target $t
done
