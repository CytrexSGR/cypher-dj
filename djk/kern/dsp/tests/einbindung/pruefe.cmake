# ctest ruft: cmake -DQUELLE=<djk/kern/dsp> -DBAU=<ordner> -P pruefe.cmake
execute_process(COMMAND ${CMAKE_COMMAND} -S ${QUELLE}/tests/einbindung -B ${BAU} -G Ninja -DDSP_QUELLE=${QUELLE}
                RESULT_VARIABLE r)
if(r)
  message(FATAL_ERROR "Konfiguration der Einbindung gescheitert: ${r}")
endif()
execute_process(COMMAND ${CMAKE_COMMAND} --build ${BAU} RESULT_VARIABLE r)
if(r)
  message(FATAL_ERROR "Bau der Einbindung gescheitert: ${r}")
endif()
# Negativ-Kontrolle: als Unterprojekt baut die Bibliothek keine Tests mit
if(EXISTS ${BAU}/dsp/test_werte)
  message(FATAL_ERROR "Unterprojekt hat Tests gebaut (CYPHERDJ_DSP_TESTS muss dort aus sein)")
endif()
execute_process(COMMAND ${BAU}/einbindung RESULT_VARIABLE r)
if(r)
  message(FATAL_ERROR "einbindung lief rot: ${r}")
endif()
