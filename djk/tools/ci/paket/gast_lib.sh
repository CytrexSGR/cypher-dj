# gast_lib.sh: helpers shared by the guest scripts of the package checks (gast_smoke.sh, upgrade_gast.sh). Source it inside the VM.
# Needs URL (the studio page, default http://127.0.0.1:47300).

URL=${URL:-http://127.0.0.1:47300}

# kern_status: the transport state of the project arrangement from /proj/aktuell (kern.status: 0 stopped, 1 waiting, 2 playing, 3 a freeze or
# resample tap runs); empty when the studio does not answer. Not the beat of /lage: that clock runs free at the tempo with the transport
# stopped (measured: 128 bpm, advancing with no project playing), so it says nothing about playing.
kern_status() {
  curl -s --max-time 3 "$URL/proj/aktuell?noten=zahl" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["kern"]["status"])' 2>/dev/null
}

# transport_laeuft_warten [seconds]: returns 0 as soon as the transport reports playing (kern.status 2); 1 when it does not within
# the time (default 30 s).
transport_laeuft_warten() {
  local i
  for i in $(seq 1 $(( ${1:-30} * 2 ))); do
    [ "$(kern_status)" = 2 ] && return 0
    sleep 0.5
  done
  return 1
}

# demo_pegel: after `cypher-dj demo`. Waits until the transport reports running, then measures the master peak over a fixed window
# (PEGEL_FENSTER seconds, default 4) that starts at that moment (kern.status 2): sleep for the window, then ask /pegel for exactly that many seconds.
# Prints the peak in dBFS (max_db of the master) or "error" when the transport did not run or /pegel has no master.
demo_pegel() {
  local fenster=${PEGEL_FENSTER:-4}
  transport_laeuft_warten 30 || { echo error; return 1; }
  sleep "$fenster"
  python3 -I -c 'import json,sys
print(json.loads(sys.argv[1])["kanaele"]["master"]["max_db"])' "$(curl -s --max-time 20 "$URL/pegel?sek=$fenster")" 2>/dev/null || { echo error; return 1; }
}
