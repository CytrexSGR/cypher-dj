#!/bin/sh
# Riegel des Vorhörers ohne JACK-Graph-Berührung: ein Ziel ohne „stumm“/„cypherdj-pruef-“ muss mit Rückgabe 3 enden,
# bevor ein JACK-Client entsteht; ein falscher Aufruf mit 2.
B=$1
"$B" --ausgang alsa_output.pci:playback_F --port 1 2>/dev/null; r=$?
[ $r -eq 3 ] || { echo "Riegel: erwartet 3, bekam $r"; exit 1; }
"$B" --unsinn 2>/dev/null; r=$?
[ $r -eq 2 ] || { echo "Aufruf: erwartet 2, bekam $r"; exit 1; }
# S7: genau der Nur-Cue-Eingang des EIGENEN Kerns passiert den Riegel ohne --ton-frei (Review S7 M1), und nur, wenn
# der laufende Kern es in kern-faehigkeiten.json meldet (Review-Kern m1): PID lebt, comm "cypherdj-kern", nur_cue "erz/8".
# Ein Attrappen-Kern (sleep unter dem Namen cypherdj-kern) liefert eine lebende PID mit dem richtigen comm.
T=$(mktemp -d)
cp "$(command -v sleep)" "$T/cypherdj-kern"
"$T/cypherdj-kern" 300 & KP=$!
cp "$(command -v sleep)" "$T/anderer"
"$T/anderer" 300 & AP=$!
trap 'kill $KP $AP 2>/dev/null; rm -rf "$T"' EXIT
sleep 0.2
tot=999999; while kill -0 $tot 2>/dev/null; do tot=$((tot+1)); done
printf '{"pid": %d, "nur_cue": "erz/8"}\n' $KP > "$T/gut.json"
printf '{"pid": %d}\n' $KP > "$T/ohne_nur_cue.json"
printf '{"pid": %d, "nur_cue": "erz/7"}\n' $KP > "$T/falscher_kanal.json"
printf '{"pid": %d, "nur_cue": "erz/8"}\n' $tot > "$T/tot.json"
printf '{"pid": %d, "nur_cue": "erz/8"}\n' $AP > "$T/falsches_comm.json"
printf 'kaputt' > "$T/kaputt.json"
F=$T/gut.json
ok() { env $1 "$B" --riegel-pruefen --faehigkeiten "$F" --ausgang "$2" --port 1 2>/dev/null; r=$?; [ $r -eq 0 ] || { echo "$1 $2: erwartet 0, bekam $r"; exit 1; }; }
nein() { env $1 "$B" --riegel-pruefen --faehigkeiten "$F" --ausgang "$2" --port 1 2>/dev/null; r=$?; [ $r -eq 3 ] || { echo "$1 $2: erwartet 3, bekam $r"; exit 1; }; }
ok   CYPHERDJ_INSTANZ= cypherdj-kern:rueck_erz_8_
ok   CYPHERDJ_INSTANZ=i cypherdj-kern-i:rueck_erz_8_
nein CYPHERDJ_INSTANZ= cypherdj-kern:rueck_erz_2_          # Bass-Wirt: geht in den Master
nein CYPHERDJ_INSTANZ= cypherdj-kern:rueck_erz_1_
nein CYPHERDJ_INSTANZ= cypherdj-kern:rueck_erz_            # ohne Nummer
nein CYPHERDJ_INSTANZ= cypherdj-kern-i:rueck_erz_8_        # fremde Instanz (Betrieb -> Pruefkern)
nein CYPHERDJ_INSTANZ=i cypherdj-kern:rueck_erz_8_         # fremde Instanz (Pruefinstanz -> Betriebskern)
nein CYPHERDJ_INSTANZ= cypherdj-kernel:rueck_erz_8_
nein CYPHERDJ_INSTANZ= cypherdj-kern:master_
nein CYPHERDJ_INSTANZ= alsa_output.usb-FIIO_FIIO_KA11-01.analog-stereo:playback_F
# Review-Kern m1: ohne passende Faehigkeiten-Datei bleibt der Riegel zu, auch mit --ton-frei
for f in fehlt.json ohne_nur_cue.json falscher_kanal.json tot.json falsches_comm.json kaputt.json; do
  env CYPHERDJ_INSTANZ= "$B" --riegel-pruefen --faehigkeiten "$T/$f" --ausgang cypherdj-kern:rueck_erz_8_ --port 1 2>/dev/null; r=$?
  [ $r -eq 3 ] || { echo "Faehigkeiten $f: erwartet 3, bekam $r"; exit 1; }
done
env CYPHERDJ_INSTANZ= "$B" --riegel-pruefen --ton-frei --faehigkeiten "$T/ohne_nur_cue.json" --ausgang cypherdj-kern:rueck_erz_8_ --port 1 2>/dev/null; r=$?
[ $r -eq 3 ] || { echo "Faehigkeiten + --ton-frei: erwartet 3, bekam $r"; exit 1; }
# --name: nur [a-z0-9-]{1,40}, sonst 2 (Review S7 m4)
"$B" --riegel-pruefen --name cypherdj-vorhoerer-mt --port 1 2>/dev/null; r=$?
[ $r -eq 0 ] || { echo "--name gueltig: erwartet 0, bekam $r"; exit 1; }
for n in 'Gross' 'a_b' 'a b' '' cypherdj-kern cypherdj-notbahn cypherdj-vorhoere; do
  "$B" --riegel-pruefen --name "$n" --port 1 2>/dev/null; r=$?
  [ $r -eq 2 ] || { echo "--name '$n': erwartet 2, bekam $r"; exit 1; }
done
echo "riegel ok"
