#!/usr/bin/env bash
# Baut die eigenen Instrumente als VST3 und legt sie dorthin, wo der Carla-Wirt sie lädt (djk-instrumente --bass rb338).
# Aufruf: djk/instrumente/installiere.sh   Rückgabe 0 = installiert, sonst Fehler des Builds.
#
# Atomarer Tausch (Review R3): ZIEL/rb338.vst3 ist ein Symlink auf einen Versionsordner (ZIEL/.rb338-versionen/<stempel>/
# rb338.vst3). Ein neuer Stand wird fertig daneben abgelegt und dann mit rename(2) über den Symlink gelegt (mv -T); ein
# Wirt, der gerade startet, sieht entweder den alten oder den neuen Stand, nie ein fehlendes Bundle. Ein laufender Wirt
# behält seine gemappte .so (alte Versionsordner bleiben, die letzten 3 werden aufgehoben).
# Die einmalige Umstellung von einem echten Ordner auf den Symlink tauscht beide mit renameat2(RENAME_EXCHANGE) (atomar).
# Für Tests: CYPHERDJ_VST3_ZIEL (anderes Zielverzeichnis), RB338_QUELLE (fertiges Bundle statt cargo xtask).
set -euo pipefail
HIER=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
ZIEL=${CYPHERDJ_VST3_ZIEL:-$HOME/.local/lib/cypherdj/vst3}
cd "$HIER"
if [ -n "${RB338_QUELLE:-}" ]; then QUELLE=$RB338_QUELLE; else cargo xtask bundle rb338 --release; QUELLE="$HIER/target/bundled/rb338.vst3"; fi
[ -d "$QUELLE/Contents" ] || { echo "installiere: kein Bundle in $QUELLE" >&2; exit 1; }
VERS="$ZIEL/.rb338-versionen"; STEMPEL=$(date +%Y%m%dT%H%M%S).$$
BEGINN=$(date +%s)
mkdir -p "$VERS/$STEMPEL"
cp -r "$QUELLE" "$VERS/$STEMPEL/rb338.vst3"
ln -s ".rb338-versionen/$STEMPEL/rb338.vst3" "$ZIEL/rb338.vst3.neu"
if [ -L "$ZIEL/rb338.vst3" ] || [ ! -e "$ZIEL/rb338.vst3" ]; then
  mv -T "$ZIEL/rb338.vst3.neu" "$ZIEL/rb338.vst3"
else  # erste Umstellung: echter Ordner <-> Symlink atomar vertauschen, danach den alten Ordner entfernen
  python3 - "$ZIEL/rb338.vst3.neu" "$ZIEL/rb338.vst3" <<'P'
import ctypes, sys
libc = ctypes.CDLL(None, use_errno=True)
if libc.renameat2(-100, sys.argv[1].encode(), -100, sys.argv[2].encode(), 2) != 0:  # AT_FDCWD, RENAME_EXCHANGE
    raise OSError(ctypes.get_errno(), "renameat2 RENAME_EXCHANGE")
P
  rm -rf "$ZIEL/rb338.vst3.neu"
fi
# nur die letzten 3 Versionen behalten
ls -1d "$VERS"/*/ 2>/dev/null | sort | head -n -3 | while read -r alt; do rm -rf "$alt"; done
echo "installed: $ZIEL/rb338.vst3 -> $(readlink "$ZIEL/rb338.vst3")"
# Review R4: laufende Wirte spielen ihren alten Build weiter, bis sie neu gestartet werden
python3 - "$BEGINN" <<'P'
import glob, json, subprocess, sys, time
beginn, alt = int(sys.argv[1]), []
for f in sorted(glob.glob("/dev/shm/cypherdj*/wirt-*.json")):
    try:
        s = json.load(open(f))
    except (OSError, ValueError):
        continue
    if s.get("art") != "vst3:rb338" or not s.get("name"):
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
    print("no running wirt with the old rb338 build")
P
