#!/usr/bin/env bash
# Builds Cypher Labor and lays out the VST3 bundle; with --installiere also into ~/.local/lib/cypherdj/vst3/.
set -euo pipefail
cd "$(dirname "$0")"
ARGS=(); INST=0; for a in "$@"; do [ "$a" = --installiere ] && INST=1 || ARGS+=("$a"); done
cargo build --release "${ARGS[@]}" 2>&1 | grep -v '^\s*$' | tail -2
B="target/bundled/Cypher Labor.vst3/Contents/x86_64-linux"
mkdir -p "$B"
cp "${CARGO_TARGET_DIR:-../target}/release/libcypher_labor.so" "$B/Cypher Labor.so"
echo "Bundle: $(dirname "$(dirname "$B")")"
[ "$INST" = 1 ] && { mkdir -p ~/.local/lib/cypherdj/vst3; rm -rf ~/.local/lib/cypherdj/vst3/"Cypher Labor.vst3"; cp -r "target/bundled/Cypher Labor.vst3" ~/.local/lib/cypherdj/vst3/; echo "installed: ~/.local/lib/cypherdj/vst3/Cypher Labor.vst3"; } || true
