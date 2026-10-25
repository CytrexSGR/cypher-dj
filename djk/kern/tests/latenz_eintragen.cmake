# I08 Task 14 (Nachzug R2): latenz_eintragen.mjs bei fehlender Messdatei. Nach einem Fehllauf von cypherdj-latenz gibt es keine Datei (R1: sie wird vorher gelöscht);
# das ist der Normalfall und endet mit "Messung ohne Wert" und Ende-Code 3, nicht mit einem Stacktrace und Code 1.
# Aufruf: cmake -DMJS=<latenz_eintragen.mjs> -DDIR=<Arbeitsordner> -P latenz_eintragen.cmake
file(REMOVE "${DIR}/gibt_es_nicht.json")
execute_process(COMMAND node "${MJS}" "${DIR}/gibt_es_nicht.json" 1 1 software RESULT_VARIABLE rc OUTPUT_VARIABLE aus ERROR_VARIABLE fehler TIMEOUT 20)
if(NOT rc EQUAL 3)
  message(FATAL_ERROR "fehlende Datei: Ende-Code ${rc}, erwartet 3. stderr: ${fehler}")
endif()
if(NOT fehler MATCHES "Messung ohne Wert")
  message(FATAL_ERROR "fehlende Datei: Meldung 'Messung ohne Wert' fehlt. stderr: ${fehler}")
endif()
# Negativ-Kontrolle: eine Datei mit ok:false endet wie bisher mit 3 und nennt den Grund
file(WRITE "${DIR}/ohne_wert.json" "{\"ok\":false,\"grund\":\"quelle_unruhig\"}\n")
execute_process(COMMAND node "${MJS}" "${DIR}/ohne_wert.json" 1 1 software RESULT_VARIABLE rc2 ERROR_VARIABLE fehler2 TIMEOUT 20)
if(NOT rc2 EQUAL 3 OR NOT fehler2 MATCHES "quelle_unruhig")
  message(FATAL_ERROR "ok:false: Ende-Code ${rc2}, stderr: ${fehler2}")
endif()
