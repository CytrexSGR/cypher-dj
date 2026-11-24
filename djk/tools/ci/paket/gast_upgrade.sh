# gast_upgrade.sh: the guest side of check_upgrade.sh. Runs inside the VM as `tester`, prints "K key=value" lines (judged by verdict_upgrade.py
# on the host), everything else is the log. The data phases are upgrade_gast.sh (vorher / nachher) with upgrade_vergleich.py.
set -uo pipefail
OLD=$(ls $HOME/cypher-dj_*.deb | sort -V | head -1); NEW=$(ls $HOME/cypher-dj_*.deb | sort -V | tail -1)
URL=http://127.0.0.1:47300
k() { echo "K $1=$2"; }
H1=(-H content-type:application/json -H x-djk-quelle:cypher)
units() { k "$1_units_active" "$(systemctl --user list-units 'cypherdj-*' --no-legend --state=active | wc -l)"; k "$1_units_failed" "$(systemctl --user list-units 'cypherdj-*' --no-legend --state=failed | wc -l)"; }
up() { cypher-dj start > /tmp/start-$1.log 2>&1; k "$1_start_rc" $?; for i in $(seq 1 60); do curl -s --max-time 3 -o /dev/null $URL/lage && break; sleep 2; done; }

echo "== provisioning: pipewire, pipewire-pulse, wireplumber, linger, dummy sink"
sudo apt-get update -qq >/dev/null 2>&1
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq pipewire pipewire-pulse wireplumber >/dev/null 2>&1
sudo loginctl enable-linger tester
echo "== install the old package"
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ./$(basename "$OLD") > /tmp/install-old.log 2>&1; k old_install_rc $?
k old_version "$(dpkg-query -W -f='${Version}' cypher-dj)"
sudo usermod -aG pipewire tester; sudo systemctl restart user@$(id -u)
for i in $(seq 1 30); do systemctl --user is-active pipewire.socket >/dev/null 2>&1 && break; sleep 1; done
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user start pipewire.socket pipewire-pulse.socket wireplumber 2>/dev/null; sleep 3
pactl load-module module-null-sink sink_name=smoke_stumm channels=2 channel_map=front-left,front-right >/dev/null; pactl set-default-sink smoke_stumm
rm -rf ~/cypherdj ~/.config/cypherdj ~/.cache/cypherdj; mkdir -p ~/upgrade/out

echo "== user data with the old package: preset, then project and take (upgrade_gast.sh vorher)"
up pre
PRESET=$(python3 -I -c 'import json; print(json.dumps({"name":"upgrade preset","geraet":"rb338","beschreibung":{"art":"lead","unterart":"mono","charakter":["bright"],"genre":["electro"],"einsatz":["intro"],"energie":3,"text":"A bright electro lead made before the upgrade."},"werte":{"lautstaerke":0.25,"cutoff":3000,"resonanz":0.3}}))')
curl -s "${H1[@]}" -X POST $URL/presets -d "$PRESET" > /tmp/preset-save.json; k preset_save_http_ok "$(python3 -I -c 'import json;d=json.load(open("/tmp/preset-save.json"));print(1 if d.get("slug") and "fehler" not in d else 0)')"
cat /tmp/preset-save.json; echo
PPATH=$(python3 -I -c 'import json;d=json.load(open("/tmp/preset-save.json"));print("%s/%s/%s" % (d["herkunft"], d["geraet"], d["slug"]))')
k preset_id "$PPATH"
curl -s "$URL/presets/$PPATH" > /tmp/preset-before.json; k preset_read_before_http "$(curl -s -o /dev/null -w '%{http_code}' "$URL/presets/$PPATH")"
bash ~/upgrade_gast.sh vorher ~/upgrade/out; k vorher_rc $?
cat ~/upgrade/out/notes-vorher.txt | tail -12
cp ~/cypherdj/werke/projekte/upgrade-probe/project.json /tmp/probe-before.json
( find "$HOME" -type f -name 'upgrade-preset*' -not -path '*/.cache/*' -exec sha256sum {} + | cut -d' ' -f1 | sort ) > /tmp/presets-before.txt; k preset_files_before "$(wc -l < /tmp/presets-before.txt)"

echo "== install the new package over it"
date +%FT%T > /tmp/upgrade-time
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ./$(basename "$NEW") > /tmp/install-new.log 2>&1; k new_install_rc $?
k new_version "$(dpkg-query -W -f='${Version}' cypher-dj)"
k compare_gt "$(dpkg --compare-versions "$(dpkg-query -W -f='${Version}' cypher-dj)" gt "$(dpkg-deb -f $OLD Version)" && echo 1 || echo 0)"
k opt_not_root "$(find /opt/cypher-dj ! -user root | wc -l)"

echo "== after the upgrade: project, take, snapshots, demo (upgrade_gast.sh nachher)"
bash ~/upgrade_gast.sh nachher ~/upgrade/out; k nachher_rc $?
tail -14 ~/upgrade/out/notes-nachher.txt

echo "== services come back, preset is still there"
up post; units post
k post_http "$(curl -s -o /dev/null -w '%{http_code}' $URL/)"
k preset_read_after_http "$(curl -s -o /dev/null -w '%{http_code}' "$URL/presets/$PPATH")"
curl -s "$URL/presets/$PPATH" > /tmp/preset-after.json
k preset_values_equal "$(python3 -I - <<'PY'
import json
a = json.load(open("/tmp/preset-before.json")); b = json.load(open("/tmp/preset-after.json"))
print(1 if a == b and a.get("werte", {}).get("cutoff") == 3000 else 0)
PY
)"
k preset_found_by_search "$(curl -s "${H1[@]}" -X POST $URL/presets/suche -d '{"text":"upgrade preset"}' | grep -c 'upgrade')"
k project_opens_http "$(curl -s "${H1[@]}" -o /dev/null -w '%{http_code}' -X POST $URL/proj/oeffnen -d '{"slug":"upgrade-probe"}')"
k project_has_take "$(curl -s "$URL/proj/aktuell?noten=zahl" | python3 -I -c 'import json,sys;d=json.load(sys.stdin);print(sum(len(s.get("clips",[])) for s in d["projekt"]["spuren"]))')"

( find "$HOME" -type f -name 'upgrade-preset*' -not -path '*/.cache/*' -exec sha256sum {} + | cut -d' ' -f1 | sort ) > /tmp/presets-after.txt
k preset_files_identical "$(cmp -s /tmp/presets-before.txt /tmp/presets-after.txt && [ -s /tmp/presets-after.txt ] && echo 1 || echo 0)"
# the user's project model: equal to the state before the upgrade apart from wiedergabe_rev (the playback counter every open and play bumps)
k project_model_equal "$(python3 -I - <<'PY'
import json, os
a = json.load(open("/tmp/probe-before.json")); b = json.load(open(os.path.expanduser("~/cypherdj/werke/projekte/upgrade-probe/project.json")))
diff = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
print(1 if diff == ["wiedergabe_rev"] or diff == [] else 0)
PY
)"
echo "== user journal since the upgrade"
S=$(cat /tmp/upgrade-time)
k journal_eacces "$(journalctl --user --since "$S" --no-pager 2>/dev/null | grep -ciE 'EACCES|EROFS|Permission denied|Read-only file system')"
k journal_unit_errors "$(journalctl --user --since "$S" -u 'cypherdj-*' -p err --no-pager -q 2>/dev/null | wc -l)"
journalctl --user --since "$S" -u 'cypherdj-*' -p err --no-pager -q 2>/dev/null | head -10
cypher-dj stop > /tmp/stop.log 2>&1; k stop_rc $?
mkdir -p ~/upgrade/out; for f in vorher.txt nachher-1.txt nachher-2.txt nachher-3.txt; do [ -f ~/upgrade/out/$f ] && echo "SNAP $f $(wc -l < ~/upgrade/out/$f) lines"; done
