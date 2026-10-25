# I08 Task 14 (Nachzug R1): ein fehlgeschlagener Lauf von cypherdj-latenz lässt eine alte Ausgabedatei nicht stehen.
# Aufruf: cmake -DBIN=<cypherdj-latenz> -DDIR=<Arbeitsordner> -P latenz_alte_datei.cmake. Läuft ohne JACK-Server: der Lauf scheitert
# (Ende-Code 2), das genügt, denn die Datei muss vor dem Verbinden weg sein.
set(datei "${DIR}/alt.json")
file(WRITE "${datei}" "{\"ok\":true,\"samples\":480.000}\n")
set(ENV{JACK_NO_START_SERVER} 1)
execute_process(COMMAND "${BIN}" kein:ziel kein:quelle 20 "${datei}" RESULT_VARIABLE rc OUTPUT_QUIET ERROR_QUIET TIMEOUT 20)
if(NOT rc EQUAL 2)
  message(FATAL_ERROR "Ende-Code ${rc}, erwartet 2 (Lauf muss scheitern)")
endif()
if(EXISTS "${datei}")
  message(FATAL_ERROR "alte Ausgabedatei ${datei} steht nach dem fehlgeschlagenen Lauf noch da")
endif()
