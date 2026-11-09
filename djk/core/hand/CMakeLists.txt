# Hand-Weg (Scheibe 19): eigenständiges CMake-Projekt, baut und testet allein (ROADMAP §3, Bibliotheks-Nähte).
# Strang A (Scheibe 35) bindet es mit add_subdirectory ein und linkt cypherdj::hand; Tests, Werkzeuge und der
# JACK-Prüfclient entstehen nur, wenn dieses Projekt oben steht (HAND_TESTS).
# Quellen und Tests werden eingesammelt (GLOB): jede Task des Plans fügt Dateien hinzu, ohne diese Datei zu ändern.
cmake_minimum_required(VERSION 3.21)
project(cypherdj_hand CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE AND PROJECT_IS_TOP_LEVEL)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()

option(HAND_TESTS "Tests, Werkzeuge, JACK-Prüfclient" ${PROJECT_IS_TOP_LEVEL})
option(HAND_SANITIZE "ASan und UBSan für alle Ziele dieses Projekts (ADR 002)" OFF)

set(D ${CMAKE_CURRENT_SOURCE_DIR})
set(WARN -Wall -Wextra -Wno-missing-field-initializers)
set(SAN)
if(HAND_SANITIZE)
  set(SAN -fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=undefined)
endif()
function(hand_ziel ziel)
  target_compile_options(${ziel} PRIVATE ${WARN} ${SAN})
  target_link_options(${ziel} PRIVATE ${SAN})
endfunction()

# Stellwerk (Scheibe 11) liefert Regler-Tabelle, Kurve und Griff. Bindet der Kern beide ein, gibt es das Ziel schon.
if(NOT TARGET cypherdj::stellwerk)
  add_subdirectory(${D}/../signalbox ${CMAKE_CURRENT_BINARY_DIR}/signalbox)
endif()

file(GLOB QUELLEN CONFIGURE_DEPENDS ${D}/src/*.cpp)
add_library(cypherdj_hand STATIC ${QUELLEN})
target_include_directories(cypherdj_hand PUBLIC include PRIVATE src)
target_link_libraries(cypherdj_hand PUBLIC cypherdj::stellwerk)
hand_ziel(cypherdj_hand)
add_library(cypherdj::hand ALIAS cypherdj_hand)

if(NOT HAND_TESTS)
  return()
endif()

enable_testing()
set(KONFIG ${D}/../../config/controller CACHE PATH "Ordner der Controller-Mappings (djk/config/controller)")
set(VERTRAG_TEXT ${D}/../../../docs/architecture/INTERFACES.md CACHE FILEPATH "INTERFACES.md")

file(GLOB TESTDATEIEN CONFIGURE_DEPENDS ${D}/tests/test_*.cpp)
foreach(f ${TESTDATEIEN})
  get_filename_component(n ${f} NAME_WE)
  if(HAND_SANITIZE AND n STREQUAL "test_realtime")
    continue()   # ersetzt malloc; verträgt sich nicht mit ASan
  endif()
  add_executable(hand_${n} ${f})
  target_include_directories(hand_${n} PRIVATE tests src)
  target_link_libraries(hand_${n} cypherdj_hand cypherdj::stellwerk_sim)
  target_compile_definitions(hand_${n} PRIVATE HAND_TESTDATEN="${D}/tests/mappings" HAND_KONFIG="${KONFIG}")
  hand_ziel(hand_${n})
  add_test(NAME ${n} COMMAND hand_${n})
endforeach()

# §7.2: das Beispiel im Test ist bytegleich das Beispiel im Vertrag
# Das python3 aus dem PATH (System, mit numpy) vorgeben: seit 2026-10-03 liegt ein uv-Python 3.11 ohne numpy in
# ~/.local/bin, FindPython nahm es dort als ersten Treffer, und die Python-Tests brachen am Import ab (2026-10-11).
if(NOT DEFINED Python3_EXECUTABLE)
  find_program(CYPHERDJ_PYTHON3 NAMES python3)
  if(CYPHERDJ_PYTHON3)
    set(Python3_EXECUTABLE ${CYPHERDJ_PYTHON3})
  endif()
endif()
find_package(Python3 COMPONENTS Interpreter)
if(Python3_FOUND AND EXISTS ${VERTRAG_TEXT} AND EXISTS ${D}/tests/mappings/beispiel_7_2.json)
  add_test(NAME beispiel_gleich_vertrag
           COMMAND sh -c "\"${Python3_EXECUTABLE}\" \"${D}/tool/example_off_contract.py\" \"${VERTRAG_TEXT}\" | cmp - \"${D}/tests/mappings/beispiel_7_2.json\"")
endif()

# L3 (Paket 0.3): alle Namenslisten (Tasten, Deck-Aktionen, Regler) gegeneinander, ohne Build, rein Text (< 1 s)
if(Python3_FOUND AND EXISTS ${D}/../../contract/check_name_lists.py)
  add_test(NAME namenslisten_gegen_vertrag
           COMMAND "${Python3_EXECUTABLE}" "${D}/../../contract/check_name_lists.py" --wurzel "${D}/../../..")
endif()

# Werkzeug: Mapping-Dateien prüfen (auch für Scheibe 40); jede Datei unter djk/config/controller/ lädt ohne Fehler
if(EXISTS ${D}/tool/hand_check.cpp)
  add_executable(hand_check tool/hand_check.cpp)
  target_link_libraries(hand_check cypherdj_hand)
  hand_ziel(hand_check)
  file(GLOB MAPPINGS CONFIGURE_DEPENDS ${KONFIG}/*.json)
  foreach(f ${MAPPINGS})
    get_filename_component(n ${f} NAME_WE)
    add_test(NAME mapping_${n} COMMAND hand_check ${f})
  endforeach()
endif()

# Instrument-Kontrolle der Latenz-Auswertung mit synthetischen Läufen bekannter Wahrheit
if(Python3_FOUND AND EXISTS ${D}/check/test_evaluation.py)
  add_test(NAME auswertung_instrument COMMAND ${Python3_EXECUTABLE} ${D}/check/test_evaluation.py)
endif()

# JACK-Prüfclient (nur mit libjack): misst Senden bis Ereignis-Sample über die Bibliothek
find_package(PkgConfig)
if(PkgConfig_FOUND)
  pkg_check_modules(JACK IMPORTED_TARGET jack)
endif()
if(JACK_FOUND AND EXISTS ${D}/check/hand_check.cpp)
  add_executable(hand_check check/hand_check.cpp)
  target_link_libraries(hand_check cypherdj_hand PkgConfig::JACK)
  hand_ziel(hand_check)
endif()
