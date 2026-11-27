# gast_smoke.sh: the guest side of check_deb.sh. Runs inside the VM as `tester`, prints "K key=value" lines for the machine-readable
# result (judged by verdict_smoke.py on the host), everything else is the log.
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
DEB=$(ls $HOME/*.deb | head -1)
URL=http://127.0.0.1:47300
. "$HIER/gast_lib.sh"
k() { echo "K $1=$2"; }
rxb() { awk 'NR>2 && $1!="lo:" {s+=$2} END{print s}' /proc/net/dev; }
k deb_sha256 "$(sha256sum "$DEB" | cut -d' ' -f1)"

echo "== provisioning (as the 0.3 acceptance: only pipewire, pipewire-pulse, wireplumber; the package pulls the rest)"
sudo apt-get update -qq >/dev/null 2>&1
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq pipewire pipewire-pulse wireplumber >/dev/null 2>&1; k provision_rc $?
sudo loginctl enable-linger tester
for c in gcc g++ cc cargo cmake rustc make node pactl; do command -v $c >/dev/null && echo "before install: $c present" || echo "before install: $c absent"; done

echo "== install"
R0=$(rxb); T0=$(date +%s)
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ./$(basename "$DEB") > /tmp/install.log 2>&1; k install_rc $?
k install_s $(( $(date +%s) - T0 )); k install_download_mib $(( ($(rxb) - R0) / 1048576 ))
touch /tmp/stamp; sleep 1
tail -3 /tmp/install.log
k installed_version "$(dpkg-query -W -f='${Version}' cypher-dj)"
k opt_files "$(find /opt/cypher-dj | wc -l)"; k opt_mb "$(du -sm /opt/cypher-dj | cut -f1)"

echo "== compilers made unusable (a package must not need one)"
for f in gcc g++ cpp cc c++ ld as x86_64-linux-gnu-gcc x86_64-linux-gnu-g++ x86_64-linux-gnu-cpp x86_64-linux-gnu-ld x86_64-linux-gnu-as; do
  p=$(command -v $f) && sudo chmod a-x "$(readlink -f "$p")"; done
for c in gcc g++ cc ld as; do command -v $c >/dev/null && ! $c --version >/dev/null 2>&1 && echo "$c: not executable"; done

echo "== real-time fix and dummy sink"
sudo usermod -aG pipewire tester; sudo systemctl restart user@$(id -u)
for i in $(seq 1 30); do systemctl --user is-active pipewire.socket >/dev/null 2>&1 && break; sleep 1; done
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user start pipewire.socket pipewire-pulse.socket wireplumber 2>/dev/null; sleep 3
pactl load-module module-null-sink sink_name=smoke_stumm channels=2 channel_map=front-left,front-right >/dev/null; pactl set-default-sink smoke_stumm
k rt_probe "$(systemd-run --user --pipe bash -c 'echo memlock=$(ulimit -l) rtprio=$(ulimit -r)' 2>/dev/null)"

echo "== cypher-dj start"
T0=$(date +%s); cypher-dj start > /tmp/start.log 2>&1; k start_rc $?; k start_s $(( $(date +%s) - T0 ))
for i in $(seq 1 60); do curl -s --max-time 3 -o /dev/null "$URL/lage" && break; sleep 2; done
k http_code "$(curl -s -o /dev/null -w '%{http_code}' $URL/)"
k units_active "$(systemctl --user list-units 'cypherdj-*' --no-legend --state=active | wc -l)"
k units_failed "$(systemctl --user list-units 'cypherdj-*' --no-legend --state=failed | wc -l)"
k start_warn_lines "$(grep -ci warn /tmp/start.log)"

echo "== cypher-dj demo, master level"
cypher-dj demo > /tmp/demo.log 2>&1; k demo_rc $?
# a fixed window that starts once the transport reports running (gast_lib.sh); the same code read -11.8 and -24.4 dBFS with a window right after `demo`
k master_max_db "$(demo_pegel)"

echo "== sounds on the null sink, measured with parec (live project: the strudel module sits in container C = pad/1)"
T=$(cat "$HOME/.config/cypherdj/hand.token" 2>/dev/null)
H1=(-H content-type:application/json -H x-djk-quelle:cypher ${T:+-H "authorization: Bearer $T"})
SINKMON="$(pactl get-default-sink).monitor"
mess() {   # mess <label>: 3 s of the sink monitor through parec, prints "peak rms" in dBFS (FL and FR together)
  local f=/tmp/m-$1.raw; timeout 6 parec -d "$SINKMON" --rate=48000 --format=s16le --channels=2 --channel-map=front-left,front-right > $f 2>/dev/null &
  local p=$!; sleep 4; kill $p 2>/dev/null; wait $p 2>/dev/null
  python3 -I - $f <<'PY'
import sys, numpy as np
d = np.fromfile(sys.argv[1], dtype="<i2").reshape(-1, 2).astype(float) / 32768
d = d[-48000 * 3:]
print("%.1f %.1f" % (20 * np.log10(max(abs(d).max(), 1e-9)), 20 * np.log10(max(np.sqrt((d ** 2).mean()), 1e-9))))
PY
}
strudel() { python3 -I -c 'import json,sys; print(json.dumps({"text": sys.argv[2], "strom": int(sys.argv[1])}))' "$1" "$2" | curl -s "${H1[@]}" -X POST $URL/strudel -d @- >> /tmp/sound.log; echo >> /tmp/sound.log; }
# a transport started by the demo belongs to Andreas: stop it the way a click on the page does, then open the live project
curl -s -o /dev/null -X POST -H content-type:application/json -H x-djk-quelle:andreas -d '{"aktion":"stopp"}' $URL/proj/transport; sleep 1
curl -s "${H1[@]}" -X POST $URL/live/oeffnen -d '{}' >> /tmp/sound.log; echo >> /tmp/sound.log
curl -s -H content-type:application/json -H x-djk-quelle:andreas -X POST $URL/regler -d '{"pfad":"pad/1/fader","nach":-6,"ab":"jetzt"}' >> /tmp/sound.log; echo >> /tmp/sound.log
sleep 2
k sound_silence_before_db "$(mess before | cut -d' ' -f1)"
sound() {   # sound <key> <strom> <pattern>: play, measure, stop, wait for the tail, measure again
  strudel "$2" "$3"; sleep 6
  read pk rms <<<"$(mess $1)"; k ${1}_peak_db "$pk"; k ${1}_rms_db "$rms"
  strudel "$2" silence; sleep 8
  read pk rms <<<"$(mess ${1}_after)"; k ${1}_after_peak_db "$pk"
}
sound strudel 1 's("bd*4")'
sound rb338 2 'note("c2 c2 eb2 g2")'
curl -s "${H1[@]}" -X POST $URL/graph -d '{"kanal":"erz/5","name":"bass-acid"}' >> /tmp/sound.log; echo >> /tmp/sound.log
sound baukasten 5 'note("c2 c2 eb2 g2")'
sound modular_melodie 3 'note("c4 e4 g4 b4")'    # informational: the Cypher Modular on the melody channel is quiet by design
cat /tmp/sound.log

echo "== tour.sh"
bash ~/tour.sh $URL > /tmp/tour.log 2>&1; k tour_rc $?
cat /tmp/tour.log
k tour_steps "$(grep -cE '^[a-z_]+ +[0-9]{3} ' /tmp/tour.log)"
k tour_2xx "$(grep -cE '^[a-z_]+ +2[0-9]{2} ' /tmp/tour.log)"
k tour_failed_steps "$(grep -E '^[a-z_]+ +[0-9]{3} ' /tmp/tour.log | grep -vE '^[a-z_]+ +2[0-9]{2} ' | awk '{print $1":"$2}' | paste -sd, -)"

echo "== no writes into /opt/cypher-dj, no permission errors"
k opt_newer "$(find /opt/cypher-dj -newer /tmp/stamp | wc -l)"
k opt_not_root "$(find /opt/cypher-dj ! -user root | wc -l)"
k journal_eacces "$(journalctl --user --no-pager 2>/dev/null | grep -ciE 'EACCES|EROFS|Permission denied|Read-only file system')"

echo "== cypher-dj mcp + probe"
cypher-dj mcp | tee /tmp/mcp.json; node=$(python3 -I -c 'import json;print(json.load(open("/tmp/mcp.json"))["cypher-dj"]["command"])'); hand=$(python3 -I -c 'import json;print(json.load(open("/tmp/mcp.json"))["cypher-dj"]["args"][0])')
$node ~/mcp_probe.mjs "$node" "$hand" > /tmp/probe.log 2>&1; k mcp_rc $?; cat /tmp/probe.log
k mcp_tools "$(sed -n 's/^tools: //p' /tmp/probe.log)"
k mcp_skills "$(sed -n 's/^skills: //p' /tmp/probe.log)"
k opt_newer_after_mcp "$(find /opt/cypher-dj -newer /tmp/stamp | wc -l)"

echo "== stop"
cypher-dj stop > /tmp/stop.log 2>&1; k stop_rc $?
