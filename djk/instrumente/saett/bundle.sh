#!/usr/bin/env bash
# Baut Cypher Saett und legt das VST3-Bundle an; mit --installiere auch nach ~/.local/lib/cypherdj/vst3/.
set -euo pipefail
cd "$(dirname "$0")"
ARGS=(); INST=0; for a in "$@"; do [ "$a" = --installiere ] && INST=1 || ARGS+=("$a"); done
cargo build --release "${ARGS[@]}" 2>&1 | grep -v '^\s*$' | tail -2
B="target/bundled/Cypher Saett.vst3/Contents/x86_64-linux"
mkdir -p "$B"
cp ../target/release/libcypher_saett.so "$B/Cypher Saett.so"
echo "Bundle: $(dirname "$(dirname "$B")")"
[ "$INST" = 1 ] && { mkdir -p ~/.local/lib/cypherdj/vst3; rm -rf ~/.local/lib/cypherdj/vst3/"Cypher Saett.vst3"; cp -r "target/bundled/Cypher Saett.vst3" ~/.local/lib/cypherdj/vst3/; echo "installiert: ~/.local/lib/cypherdj/vst3/Cypher Saett.vst3"; } || true
