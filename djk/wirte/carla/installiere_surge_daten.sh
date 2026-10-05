#!/usr/bin/env bash
# Studio S5.3: Surge XT 1.3.4 Daten (Werkspatches, Wavetables) aus dem offiziellen Linux-.deb, nur ENTPACKT
# (kein dpkg -i, kein root). Ziel ~/.local/share/cypherdj/surge-daten/usr/share/surge-xt, Download ~223 MB.
set -euo pipefail
URL=https://github.com/surge-synthesizer/releases-xt/releases/download/1.3.4/surge-xt-linux-x64-1.3.4.deb
C="$HOME/.cache/cypherdj"; Z="$HOME/.local/share/cypherdj/surge-daten"; DEB="$C/surge-xt-linux-x64-1.3.4.deb"
mkdir -p "$C"
if [ ! -f "$DEB" ]; then
  curl -fL --retry 3 -o "$DEB.teil" "$URL"
  mv "$DEB.teil" "$DEB"
fi
echo "deb: $(stat -c %s "$DEB") bytes, sha256 $(sha256sum "$DEB" | cut -c1-16)"
rm -rf "$Z.neu"; mkdir -p "$Z.neu"; dpkg-deb -x "$DEB" "$Z.neu"
D="$Z.neu/usr/share/surge-xt"
[ -d "$D/patches_factory" ] || { echo "patches_factory missing in $D" >&2; ls "$Z.neu/usr/share" >&2; exit 2; }
rm -rf "$Z"; mv "$Z.neu" "$Z"
echo "factory patches: $(find "$Z/usr/share/surge-xt/patches_factory" -name '*.fxp' | wc -l) · wavetables: $(find "$Z/usr/share/surge-xt/wavetables" -type f | wc -l)"
