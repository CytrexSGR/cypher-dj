#!/usr/bin/env bash
# Test for djk/start/systemlage.sh (the shared system check of djk-start and djk-doctor) and for the way djk-start uses it.
# Nothing real is touched: the script runs against stubs on a restricted PATH in a temp root; the djk-start function systemlage_pruefen is cut out
# of djk-start (the way test_kit_choice.sh cuts the erzeuger block) and run against stub scripts. No unit, no real start.
# Points:
#   S1 all stubs fine, limits 4194304 and 95: six lines in the fixed order, no PROBLEM, exit 0
#   S2 rtprio 0: echtzeit PROBLEM, the fix names `usermod -aG pipewire`; low memlock: the same
#   S3 no pactl: pactl PROBLEM, senke still present, exit 0
#   S4 no systemd-run: systemd_sitzung PROBLEM, echtzeit is NOTE "not checked", never OK
#   S5 pw-link fails: pipewire PROBLEM
#   S6 systemd-run hangs beyond SYSTEMLAGE_FRIST=1: back within 3 s with systemd_sitzung PROBLEM
#   S7 pw-jack missing: jack PROBLEM; no default sink: senke NOTE
#   D1..D4 djk-start function: echtzeit PROBLEM warns and continues; pipewire and pactl PROBLEM return 2 with the old sentences;
#          systemd_sitzung PROBLEM is silent
#   D5 fail closed: script missing, script exits 1, script prints three lines, an id missing: each returns 2 with "system check unavailable"
# Usage: djk/start/tests/test_systemlage.sh   (exit 0 all OK, 1 at least one FAIL)
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
START=$(cd "$HIER/.." && pwd)
SKRIPT="$START/systemlage.sh"
T=$(mktemp -d "${TMPDIR:-/tmp}/systemlage-test.XXXX")
trap 'rm -rf "$T"' EXIT
OK=0; FAIL=0
check() { if [ "$1" = 0 ]; then echo "OK   $2"; OK=$((OK + 1)); else echo "FAIL $2"; FAIL=$((FAIL + 1)); fi; }

# A restricted PATH: only the tools the script itself needs, plus stubs. A tool that is not linked here is "not installed".
BASIS="$T/basis"; STUBS="$T/stubs"; mkdir -p "$BASIS" "$STUBS"
for t in bash sed head timeout cat sleep id grep mktemp rm tr; do ln -s "$(command -v "$t")" "$BASIS/$t"; done
cat > "$STUBS/systemd-run" <<'STUB'
#!/usr/bin/env bash
[ -n "${STUB_SD_SCHLAF:-}" ] && exec sleep "$STUB_SD_SCHLAF"
[ "${STUB_SD_FEHLER:-0}" = 1 ] && exit 1
echo "${STUB_MEMLOCK-4194304}"; echo "${STUB_RT-95}"
STUB
cat > "$STUBS/pactl" <<'STUB'
#!/usr/bin/env bash
echo "${STUB_SENKE-alsa_output.test}"
STUB
cat > "$STUBS/pw-link" <<'STUB'
#!/usr/bin/env bash
[ "${STUB_PWLINK_FEHLER:-0}" = 1 ] && exit 1
exit 0
STUB
cat > "$T/pw-jack" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$STUBS"/* "$T/pw-jack"

# lage [VAR=wert ...] -- run systemlage.sh with the stubs; OHNE lists the stubs left out (a tool that is not installed)
lage() {
  local weg=" ${OHNE:-} " s
  local P="$T/pfad"; rm -rf "$P"; mkdir -p "$P"
  cp -P "$BASIS"/* "$P"/
  for s in systemd-run pactl pw-link; do [[ "$weg" == *" $s "* ]] || ln -s "$STUBS/$s" "$P/$s"; done
  env -i PATH="$P" HOME="$T" SYSTEMLAGE_PWJACK="${PWJACK-$T/pw-jack}" "$@" bash "$SKRIPT" 2>"$T/err"
}
zeile() { grep -P "^[A-Z]+\t$2\t" <<<"$1"; }   # $1 output, $2 id
status() { zeile "$1" "$2" | cut -f1; }

# S1
OUT=$(lage); RC=$?
[ "$RC" = 0 ]; check $? "S1 all fine: exit 0 (rc $RC)"
[ "$(printf '%s\n' "$OUT" | grep -c .)" = 6 ]; check $? "S1 six lines"
[ "$(printf '%s\n' "$OUT" | cut -f2 | paste -sd' ')" = "systemd_sitzung echtzeit pactl pipewire jack senke" ]; check $? "S1 ids in the fixed order"
! grep -q '^PROBLEM' <<<"$OUT"; check $? "S1 no PROBLEM"
[ "$(printf '%s\n' "$OUT" | awk -F'\t' 'NF==4' | wc -l)" = 6 ]; check $? "S1 every line has four tab separated fields"
grep -q 'default sink: alsa_output.test' <<<"$OUT"; check $? "S1 senke names the sink"

# S2
OUT=$(lage STUB_RT=0); RC=$?
[ "$(status "$OUT" echtzeit)" = PROBLEM ] && grep -q 'usermod -aG pipewire' <<<"$(zeile "$OUT" echtzeit)" && [ "$RC" = 0 ]; check $? "S2 rtprio 0: echtzeit PROBLEM with the usermod fix, exit 0"
OUT=$(lage STUB_MEMLOCK=1000)
[ "$(status "$OUT" echtzeit)" = PROBLEM ]; check $? "S2 low memlock: echtzeit PROBLEM"
OUT=$(lage STUB_MEMLOCK=unlimited STUB_RT=unlimited)
[ "$(status "$OUT" echtzeit)" = OK ]; check $? "S2 unlimited limits: OK"

# S3
OUT=$(OHNE=pactl lage); RC=$?
[ "$(status "$OUT" pactl)" = PROBLEM ] && [ -n "$(zeile "$OUT" senke)" ] && [ "$RC" = 0 ] && grep -q 'apt install pulseaudio-utils' <<<"$(zeile "$OUT" pactl)"
check $? "S3 no pactl: PROBLEM with fix, senke present, exit 0 (rc $RC)"
[ "$(printf '%s\n' "$OUT" | grep -c .)" = 6 ]; check $? "S3 still six lines"

# S4
OUT=$(OHNE=systemd-run lage); RC=$?
[ "$(status "$OUT" systemd_sitzung)" = PROBLEM ] && [ "$(status "$OUT" echtzeit)" = NOTE ] && grep -q 'not checked' <<<"$(zeile "$OUT" echtzeit)" && [ "$RC" = 0 ]
check $? "S4 no systemd-run: sitzung PROBLEM, echtzeit NOTE not checked (rc $RC)"
OUT=$(lage STUB_SD_FEHLER=1)
[ "$(status "$OUT" systemd_sitzung)" = PROBLEM ] && [ "$(status "$OUT" echtzeit)" = NOTE ]; check $? "S4 systemd-run fails: the same"

# S5
OUT=$(lage STUB_PWLINK_FEHLER=1)
[ "$(status "$OUT" pipewire)" = PROBLEM ]; check $? "S5 pw-link fails: pipewire PROBLEM"
OUT=$(OHNE=pw-link lage)
[ "$(status "$OUT" pipewire)" = PROBLEM ]; check $? "S5 no pw-link: pipewire PROBLEM"

# S6
T0=$SECONDS
OUT=$(lage STUB_SD_SCHLAF=20 SYSTEMLAGE_FRIST=1); RC=$?
DAUER=$((SECONDS - T0))
[ "$DAUER" -le 3 ] && [ "$(status "$OUT" systemd_sitzung)" = PROBLEM ] && [ "$RC" = 0 ]; check $? "S6 hanging systemd-run: back in ${DAUER}s with PROBLEM (rc $RC)"

# S7
OUT=$(PWJACK="$T/nicht-da" lage)
[ "$(status "$OUT" jack)" = PROBLEM ]; check $? "S7 no pw-jack: jack PROBLEM"
OUT=$(lage STUB_SENKE=)
[ "$(status "$OUT" senke)" = NOTE ]; check $? "S7 no default sink: senke NOTE"

# --ohne-senke: pactl is not asked for the default sink; the line stays, as a NOTE
P="$T/pfad"; OUT=$(env -i PATH="$P" HOME="$T" SYSTEMLAGE_PWJACK="$T/pw-jack" bash "$SKRIPT" --ohne-senke 2>/dev/null)
[ "$(printf '%s\n' "$OUT" | grep -c .)" = 6 ] && [ "$(status "$OUT" senke)" = NOTE ] && ! grep -q 'alsa_output.test' <<<"$OUT"; check $? "S8 --ohne-senke: six lines, senke NOTE, no sink asked"

# D: the function of djk-start, cut out and run against a stub script
FUNKTION=$(sed -n '/^systemlage_pruefen() {$/,/^}$/p' "$START/djk-start")
[ -n "$FUNKTION" ]; check $? "D0 djk-start holds the function systemlage_pruefen"
alles() { # $1 status of ids by name, e.g. "pactl=PROBLEM"
  local id
  declare -A S=([systemd_sitzung]=OK [echtzeit]=OK [pactl]=OK [pipewire]=OK [jack]=OK [senke]=OK)
  for kv in "$@"; do S[${kv%%=*}]=${kv#*=}; done
  local out=""
  for id in systemd_sitzung echtzeit pactl pipewire jack senke; do
    out+="printf '%s\\t%s\\t%s\\t%s\\n' '${S[$id]}' '$id' 'text of $id' 'fix of $id'"$'\n'
  done
  printf '%s' "$out"
}
fn_lauf() { # $1 stub body (or FEHLT)
  local H="$T/h"; rm -rf "$H"; mkdir -p "$H"
  [ "$1" = FEHLT ] || printf '%s\n' "$1" > "$H/systemlage.sh"
  printf '%s\n' "$FUNKTION" "systemlage_pruefen; echo \"rc=\$?\" >&3" > "$T/run.sh"
  ERR=$(env -i PATH="$BASIS" HIER="$H" DJK="$T" KERN_KONFIG="" bash "$T/run.sh" 3>"$T/rc" 2>&1 >/dev/null)
  RC=$(sed -n 's/^rc=//p' "$T/rc")
}

fn_lauf "$(alles echtzeit=PROBLEM)"
[ "$RC" = 0 ] && grep -q '^djk-start: warning: text of echtzeit$' <<<"$ERR" && grep -q '^  Fix: fix of echtzeit$' <<<"$ERR"; check $? "D1 echtzeit PROBLEM: warning on stderr, continues with rc 0 (rc $RC)"
fn_lauf "$(alles pipewire=PROBLEM)"
[ "$RC" = 2 ] && grep -q 'djk-start: PipeWire not reachable (pw-link failed)' <<<"$ERR"; check $? "D2 pipewire PROBLEM: rc 2 with the old sentence (rc $RC)"
fn_lauf "$(alles pactl=PROBLEM)"
[ "$RC" = 2 ] && grep -q 'djk-start: missing program pactl' <<<"$ERR"; check $? "D3 pactl PROBLEM: rc 2 with the old sentence (rc $RC)"
fn_lauf "$(alles systemd_sitzung=PROBLEM echtzeit=NOTE)"
[ "$RC" = 0 ] && [ -z "$ERR" ]; check $? "D4 systemd_sitzung PROBLEM: silent, rc 0 (rc $RC, err '$ERR')"
fn_lauf "$(alles)"
[ "$RC" = 0 ] && [ -z "$ERR" ]; check $? "D4 everything fine: silent, rc 0"

fn_lauf FEHLT
[ "$RC" = 2 ] && grep -q 'system check unavailable' <<<"$ERR"; check $? "D5 script missing: rc 2 with the sentence (rc $RC)"
fn_lauf "exit 1"
[ "$RC" = 2 ] && grep -q 'system check unavailable' <<<"$ERR"; check $? "D5 script exits 1: rc 2 with the sentence (rc $RC)"
fn_lauf "$(printf '%s\n' "printf 'OK\tsystemd_sitzung\tt\tf\n'" "printf 'OK\techtzeit\tt\tf\n'" "printf 'PROBLEM\tpactl\tt\tf\n'")"
[ "$RC" = 2 ] && grep -q 'system check unavailable' <<<"$ERR" && ! grep -q 'missing program pactl' <<<"$ERR"; check $? "D5 three lines only: rc 2, no later check ran (rc $RC)"
fn_lauf "$(alles | grep -v "'pipewire'")
printf 'OK\tpipewire2\tt\tf\n'"
[ "$RC" = 2 ] && grep -q 'system check unavailable' <<<"$ERR"; check $? "D5 six lines but an id missing: rc 2 (rc $RC)"
fn_lauf "$(alles pipewire=PROBLEM pactl=PROBLEM)"
[ "$RC" = 2 ] && grep -q 'missing program pactl' <<<"$ERR" && ! grep -q 'PipeWire not reachable' <<<"$ERR"; check $? "D5 pactl is checked before pipewire (the old order)"

fn_lauf "$(alles | sed "s/'OK' 'jack'/'MAYBE' 'jack'/")"
[ "$RC" = 2 ] && grep -q "unknown status 'MAYBE'" <<<"$ERR"; check $? "D6 unknown STATUS value: rc 2 with a sentence (rc $RC)"

echo "$OK ok, $FAIL failed"
[ "$FAIL" = 0 ]
