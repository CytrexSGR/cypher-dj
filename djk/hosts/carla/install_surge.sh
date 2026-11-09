#!/usr/bin/env bash
# Studio S5: Surge XT 1.3.4 LV2 (nativ, aus proben/05) nach ~/.local/lib/cypherdj/lv2 (außerhalb des Repos, wie die Kits).
set -euo pipefail
Q="$(cd "$(dirname "$0")/../../.." && pwd)/proben/05-plugins-instrumente/plug/Surge XT.lv2"
Z="$HOME/.local/lib/cypherdj/lv2"
[ -f "$Q/manifest.ttl" ] || { echo "Surge XT.lv2 fehlt: $Q" >&2; exit 2; }
mkdir -p "$Z"
rm -rf "$Z/Surge XT.lv2.neu"; cp -a "$Q" "$Z/Surge XT.lv2.neu"
rm -rf "$Z/Surge XT.lv2"; mv "$Z/Surge XT.lv2.neu" "$Z/Surge XT.lv2"
echo "Surge XT LV2 nach $Z/Surge XT.lv2 ($(du -sh "$Z/Surge XT.lv2" | cut -f1))"
