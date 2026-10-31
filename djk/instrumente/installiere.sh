#!/usr/bin/env bash
# Baut ein eigenes Instrument als VST3 und legt es dorthin, wo der Carla-Wirt es lädt (djk-instrumente --bass rb338,
# --melodie baukasten).
# Aufruf: djk/instrumente/installiere.sh [rb338|baukasten]   (ohne Angabe: rb338)   Rückgabe 0 = installiert, 2 = Aufruf,
# sonst Fehler des Builds.
#
# Atomarer Tausch (Review R3): ZIEL/rb338.vst3 ist ein Symlink auf einen Versionsordner (ZIEL/.rb338-versionen/<stempel>/
# rb338.vst3). Ein neuer Stand wird fertig daneben abgelegt und dann mit rename(2) über den Symlink gelegt (mv -T); ein
# Wirt, der gerade startet, sieht entweder den alten oder den neuen Stand, nie ein fehlendes Bundle. Ein laufender Wirt
# behält seine gemappte .so (alte Versionsordner bleiben, die letzten 3 werden aufgehoben).
# Die einmalige Umstellung von einem echten Ordner auf den Symlink tauscht beide mit renameat2(RENAME_EXCHANGE) (atomar).
# Für Tests: CYPHERDJ_VST3_ZIEL (anderes Zielverzeichnis), RB338_QUELLE / BAUKASTEN_QUELLE (fertiges Bundle statt cargo xtask).
set -euo pipefail
INSTRUMENT=${1:-rb338}
case "$INSTRUMENT" in rb338|baukasten) ;; *) echo "installiere: unknown instrument '$INSTRUMENT' (rb338 or baukasten)" >&2; exit 2;; esac
QV=${INSTRUMENT^^}_QUELLE
HIER=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
ZIEL=${CYPHERDJ_VST3_ZIEL:-$HOME/.local/lib/cypherdj/vst3}
cd "$HIER"
if [ -n "${!QV:-}" ]; then QUELLE=${!QV}; else cargo xtask bundle "$INSTRUMENT" --release; QUELLE="$HIER/target/bundled/$INSTRUMENT.vst3"; fi
[ -d "$QUELLE/Contents" ] || { echo "installiere: kein Bundle in $QUELLE" >&2; exit 1; }
VERS="$ZIEL/.$INSTRUMENT-versionen"; STEMPEL=$(date +%Y%m%dT%H%M%S).$$
BEGINN=$(date +%s)
mkdir -p "$VERS/$STEMPEL"
cp -r "$QUELLE" "$VERS/$STEMPEL/$INSTRUMENT.vst3"
ln -s ".$INSTRUMENT-versionen/$STEMPEL/$INSTRUMENT.vst3" "$ZIEL/$INSTRUMENT.vst3.neu"
if [ -L "$ZIEL/$INSTRUMENT.vst3" ] || [ ! -e "$ZIEL/$INSTRUMENT.vst3" ]; then
  mv -T "$ZIEL/$INSTRUMENT.vst3.neu" "$ZIEL/$INSTRUMENT.vst3"
else  # erste Umstellung: echter Ordner <-> Symlink atomar vertauschen, danach den alten Ordner entfernen
  python3 - "$ZIEL/$INSTRUMENT.vst3.neu" "$ZIEL/$INSTRUMENT.vst3" <<'P'
import ctypes, sys
libc = ctypes.CDLL(None, use_errno=True)
if libc.renameat2(-100, sys.argv[1].encode(), -100, sys.argv[2].encode(), 2) != 0:  # AT_FDCWD, RENAME_EXCHANGE
    raise OSError(ctypes.get_errno(), "renameat2 RENAME_EXCHANGE")
P
  rm -rf "$ZIEL/$INSTRUMENT.vst3.neu"
fi
# nur die letzten 3 Versionen behalten
ls -1d "$VERS"/*/ 2>/dev/null | sort | head -n -3 | while read -r alt; do rm -rf "$alt"; done
echo "installed: $ZIEL/$INSTRUMENT.vst3 -> $(readlink "$ZIEL/$INSTRUMENT.vst3")"
# Review R4: laufende Wirte spielen ihren alten Build weiter, bis sie neu gestartet werden
python3 - "$BEGINN" "$INSTRUMENT" <<'P'
import glob, json, subprocess, sys, time
beginn, instrument, alt = int(sys.argv[1]), sys.argv[2], []
for f in sorted(glob.glob("/dev/shm/cypherdj*/wirt-*.json")):
    try:
        s = json.load(open(f))
    except (OSError, ValueError):
        continue
    if s.get("art") != f"vst3:{instrument}" or not s.get("name"):
        continue
    u = s["name"] + ".service"
    if subprocess.run(["systemctl", "--user", "is-active", "--quiet", u]).returncode != 0:
        continue
    t = subprocess.run(["systemctl", "--user", "show", "-p", "ActiveEnterTimestampMonotonic", "--value", u],
                       capture_output=True, text=True).stdout.strip()
    # Startzeit gegen den Beginn dieser Installation: Monotonic -> Epoche über /proc/uptime
    try:
        gestartet = time.time() - float(open("/proc/uptime").read().split()[0]) + int(t) / 1e6
    except ValueError:
        gestartet = 0
    if gestartet < beginn:
        alt.append(u)
if alt:
    print("running wirts still play the OLD build until restarted (not restarted here, the studio is yours):")
    for u in alt:
        print(f"  {u}   restart: systemctl --user restart {u}")
else:
    print(f"no running wirt with the old {instrument} build")
P
