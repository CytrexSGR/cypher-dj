#!/usr/bin/env bash
# systemlage.sh: the system checks that djk-start and djk-doctor share, so the two cannot drift.
# Usage: systemlage.sh [--kern-konfig FILE] [--ohne-senke]
# Output: exactly one line per check on stdout, tab separated: STATUS<TAB>ID<TAB>TEXT<TAB>FIX (FIX may be empty).
#   STATUS is OK, NOTE or PROBLEM. IDs in this order: systemd_sitzung, echtzeit, pactl, pipewire, jack, senke.
# --ohne-senke: the senke line is a NOTE and pactl is not asked for the default sink (djk-start does not need it).
# Always exits 0: a broken system is a PROBLEM line, never a crash. Every external call is bounded by `timeout`.
# Environment: SYSTEMLAGE_FRIST (seconds for the systemd-run probe, default 15), SYSTEMLAGE_PWJACK (default /usr/bin/pw-jack).
# Reads `speicher_budget_mib` from --kern-konfig (default: config/kern.toml next to this script's djk folder), default 3800.
set -uo pipefail
HIER=$(cd "${BASH_SOURCE[0]%/*}" 2>/dev/null && pwd) || HIER=.
DJK=${DJK:-$HIER/..}
KONFIG=""; OHNE_SENKE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --kern-konfig) KONFIG=${2-}; shift 2 || shift;;
    --ohne-senke) OHNE_SENKE=1; shift;;
    *) shift;;
  esac
done
KONFIG=${KONFIG:-$DJK/config/kern.toml}
FRIST=${SYSTEMLAGE_FRIST:-15}
[[ "$FRIST" =~ ^[0-9]+$ ]] || FRIST=15
PWJACK=${SYSTEMLAGE_PWJACK:-/usr/bin/pw-jack}

zeile() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "${4-}"; }
TMP=$(mktemp "${TMPDIR:-/tmp}/systemlage.XXXXXX" 2>/dev/null) || TMP=""
trap '[ -n "$TMP" ] && rm -f "$TMP"' EXIT

# 1 and 2: the user manager's limits, as the units will get them. One probe serves both lines. The output goes to a file, not a pipe, so a hung
# probe whose children keep the pipe open cannot hold this script past the timeout.
SITZUNG=1; M=""; R=""
if ! command -v systemd-run >/dev/null 2>&1; then
  SITZUNG=0
  zeile PROBLEM systemd_sitzung "systemd-run is not available, so there is no systemd user session to start the studio units in" \
    "install systemd and log in through a normal desktop or login session"
elif [ -z "$TMP" ] || ! timeout "$FRIST" systemd-run --user --pipe --quiet bash -c 'ulimit -l; ulimit -r' >"$TMP" 2>/dev/null; then
  SITZUNG=0
  zeile PROBLEM systemd_sitzung "the systemd user session did not answer (systemd-run --user failed or took longer than ${FRIST} s)" \
    "log in through a normal login session, or run: systemctl --user status"
else
  M=$(sed -n 1p "$TMP"); R=$(sed -n 2p "$TMP")
  zeile OK systemd_sitzung "the systemd user session answers" ""
fi

if [ "$SITZUNG" = 0 ]; then
  zeile NOTE echtzeit "real-time limits not checked (no systemd user session)" ""
elif ! [[ "$M" =~ ^([0-9]+|unlimited)$ && "$R" =~ ^([0-9]+|unlimited)$ ]]; then
  zeile NOTE echtzeit "real-time limits not checked (the probe printed no limits)" ""
else
  BUDGET=$(sed -n 's/^speicher_budget_mib *= *\([0-9][0-9]*\).*/\1/p' "$KONFIG" 2>/dev/null | head -n 1)
  BUDGET=${BUDGET:-3800}
  if [ "$R" = 0 ] || { [ "$M" != unlimited ] && [ "$M" -lt $((BUDGET * 1024)) ]; }; then
    zeile PROBLEM echtzeit "the user services get memlock ${M} KiB and rtprio ${R}, but the core needs memlock of at least $((BUDGET * 1024)) KiB (its budget of ${BUDGET} MiB) and rtprio above 0; it will run without real-time priority and decks may refuse to load." \
      "sudo usermod -aG pipewire \"\$USER\", then sudo systemctl restart user@\$(id -u) (or reboot). Check: systemd-run --user --pipe --quiet bash -c 'ulimit -l; ulimit -r' (4194304 and 95)."
  else
    zeile OK echtzeit "real-time limits are fine (memlock ${M} KiB, rtprio ${R})" ""
  fi
fi

# 3 pactl
if command -v pactl >/dev/null 2>&1; then
  PACTL=1
  zeile OK pactl "pactl is installed" ""
else
  PACTL=0
  zeile PROBLEM pactl "missing program pactl (Ubuntu package pulseaudio-utils)" "sudo apt install pulseaudio-utils"
fi

# 4 PipeWire
if command -v pw-link >/dev/null 2>&1 && timeout 15 pw-link -o >/dev/null 2>&1; then
  zeile OK pipewire "PipeWire answers" ""
else
  zeile PROBLEM pipewire "PipeWire is not reachable (pw-link failed)" "start it: systemctl --user start pipewire pipewire-pulse wireplumber"
fi

# 5 JACK layer
if [ -x "$PWJACK" ]; then
  zeile OK jack "the PipeWire JACK layer is installed ($PWJACK)" ""
else
  zeile PROBLEM jack "missing program $PWJACK (the JACK layer of PipeWire)" "sudo apt install pipewire-jack"
fi

# 6 default sink
if [ "$OHNE_SENKE" = 1 ]; then
  zeile NOTE senke "default sink not checked here" ""
elif [ "$PACTL" = 0 ]; then
  zeile NOTE senke "default sink not checked (pactl is missing)" ""
else
  SENKE=$(timeout 5 pactl get-default-sink 2>/dev/null | head -n 1)
  if [ -n "$SENKE" ]; then
    zeile OK senke "default sink: $SENKE" ""
  else
    zeile NOTE senke "no default sink" "the studio's silent sink is used"
  fi
fi
exit 0
