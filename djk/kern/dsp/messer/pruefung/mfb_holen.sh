#!/usr/bin/env bash
# Legt die Abnahme-Signale für Scheibe 14 an (nicht versioniert): 48 kHz, float32 LE, Stereo, ohne Kopf.
#   mfb60.f32     60 s MFB ab Sekunde 120 (Bänder gegen scipy)
#   mfb_ganz.f32  ganzer MFB-Track (Limiter)
#   stille60.f32  60 s Nullen (Negativ-Kontrolle Bänder)
set -euo pipefail
ziel="${1:?Aufruf: mfb_holen.sh <zielordner>}"
quelle="${MFB_QUELLE:-$HOME/cypher-dj/stems/mfbass/orig.mp3}"
mkdir -p "$ziel"
ffmpeg -v error -y -ss 120 -t 60 -i "$quelle" -ar 48000 -ac 2 -f f32le "$ziel/mfb60.f32"
ffmpeg -v error -y -i "$quelle" -ar 48000 -ac 2 -f f32le "$ziel/mfb_ganz.f32"
head -c $((48000 * 60 * 8)) /dev/zero > "$ziel/stille60.f32"
stat -c '%n %s' "$ziel/mfb60.f32" "$ziel/mfb_ganz.f32" "$ziel/stille60.f32"
