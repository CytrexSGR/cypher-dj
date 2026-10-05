#!/bin/sh
# Riegel des Vorhörers ohne JACK-Graph-Berührung: ein Ziel ohne „stumm“/„cypherdj-pruef-“ muss mit Rückgabe 3 enden,
# bevor ein JACK-Client entsteht; ein falscher Aufruf mit 2.
B=$1
"$B" --ausgang alsa_output.pci:playback_F --port 1 2>/dev/null; r=$?
[ $r -eq 3 ] || { echo "Riegel: erwartet 3, bekam $r"; exit 1; }
"$B" --unsinn 2>/dev/null; r=$?
[ $r -eq 2 ] || { echo "Aufruf: erwartet 2, bekam $r"; exit 1; }
echo "riegel ok"
