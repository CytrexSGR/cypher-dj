# djk/kern: der Echtzeit-Kern. Nur Strang A schreibt hier, eine Scheibe zugleich (ROADMAP §8.2).
# Quellen und Tests werden eingesammelt (CONFIGURE_DEPENDS): neue Dateien unter src/ und tests/test_*.cpp kommen beim
# nächsten Bau ohne Änderung dieser Datei hinzu. src/main.cpp ist das Programm, alles andere unter src/ die Bibliothek.
# Scheibe 08: Fremdquellen aus djk/third_party (toml++, nlohmann/json), Vertrag aus djk/vertrag (osc_adressen.h),
# Mutationen für die Fehlerfälle der Abnahme, ThreadSanitizer-Bau für den Befehlsring.
cmake_minimum_required(VERSION 3.28)
project(cypherdj_kern LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()
option(CYPHERDJ_SANITIZE "ASan und UBSan (ADR 002)" OFF)
option(CYPHERDJ_TSAN "ThreadSanitizer für den Befehlsring (Scheibe 08)" OFF)
option(CYPHERDJ_MUTATION_RING_RELAXED "Fehlerfall: Ring ohne Release/Acquire (nur mit CYPHERDJ_TSAN)" OFF)
if(CYPHERDJ_SANITIZE)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address,undefined)
endif()
if(CYPHERDJ_TSAN)
  add_compile_options(-fsanitize=thread -fno-omit-frame-pointer)
  add_link_options(-fsanitize=thread)
endif()
if(CYPHERDJ_MUTATION_RING_RELAXED)
  add_compile_definitions(CYPHERDJ_MUTATION_RING_RELAXED=1)
endif()

find_package(PkgConfig REQUIRED)
pkg_check_modules(JACK REQUIRED IMPORTED_TARGET jack)
pkg_check_modules(CRYPTO REQUIRED IMPORTED_TARGET libcrypto)  # Scheibe 31: sha256 im Lader (OpenSSL 3.0.13)
pkg_check_modules(RUBBERBAND REQUIRED IMPORTED_TARGET rubberband)  # Keylock: R3 offline (loop_stretch.cpp, in kernbib seit Slice 3; aufgerufen nur aus dem Render-Faden des Netzes)
find_package(Threads REQUIRED)
set(DJK ${CMAKE_CURRENT_SOURCE_DIR}/..)
# Scheibe 25: die beiden Bibliotheken, die im Callback zusammentreffen (ROADMAP §3 Bibliotheks-Nähte). Ihre Tests bauen
# nur, wenn sie allein gebaut werden; hier entstehen nur cypherdj::dsp (Scheibe 04, mit dem Messer und Master-Limiter aus
# 14) und cypherdj::stellwerk (Scheibe 11).
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/dsp dsp)
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/stellwerk stellwerk)
# Scheibe 35: Hand-Bibliothek (Scheibe 19, djk/kern/hand): Mapping, MIDI-Übersetzer, Naht zum Stellwerk. Ohne ihre Tests.
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/hand hand)
# Befund B12 (Scheibe 25): djk/kern/dsp/messer legt cypherdj_ebur128 selbst an, djk/third_party ebenso; beide zusammen
# brechen die Konfiguration ab („another target with the same name already exists“). Solange messer keinen Wächter
# `if(NOT TARGET cypherdj_ebur128)` trägt (fremdes Territorium), holt der Kern aus third_party nur die beiden
# Kopf-Bibliotheken, die er braucht (dieselben Zeilen wie djk/third_party/CMakeLists.txt); ebur128 kommt aus messer.
if(TARGET cypherdj_ebur128)
  add_library(cypherdj_json INTERFACE)
  target_include_directories(cypherdj_json SYSTEM INTERFACE ${DJK}/third_party)
  add_library(cypherdj::json ALIAS cypherdj_json)
  add_library(cypherdj_toml INTERFACE)
  target_include_directories(cypherdj_toml SYSTEM INTERFACE ${DJK}/third_party)
  add_library(cypherdj::toml ALIAS cypherdj_toml)
else()
  add_subdirectory(${DJK}/third_party third_party)
endif()

file(GLOB KERN_QUELLEN CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp)
list(REMOVE_ITEM KERN_QUELLEN ${CMAKE_CURRENT_SOURCE_DIR}/src/main.cpp)
add_library(cypherdj_kernbib STATIC ${KERN_QUELLEN})
target_include_directories(cypherdj_kernbib PUBLIC include ${DJK}/vertrag)
target_link_libraries(cypherdj_kernbib PUBLIC PkgConfig::JACK Threads::Threads cypherdj::dsp cypherdj::stellwerk
                      cypherdj_dsp_messer cypherdj::hand PRIVATE cypherdj::toml cypherdj::json PkgConfig::CRYPTO PkgConfig::RUBBERBAND)  # messer: Master-Limiter (14); Scheibe 31: Lader, fassung.json; Keylock Slice 3: loop_stretch
target_compile_options(cypherdj_kernbib PRIVATE -Wall -Wextra)

add_executable(cypherdj-kern src/main.cpp)
target_link_libraries(cypherdj-kern PRIVATE cypherdj_kernbib)
target_compile_options(cypherdj-kern PRIVATE -Wall -Wextra)

# Programme mit Mutation: dieselben Quellen, ein Schalter. Fehlerfälle der Abnahmen (nie ausliefern).
function(kern_mutation name schalter)
  add_executable(${name} src/main.cpp ${KERN_QUELLEN})
  target_include_directories(${name} PRIVATE include ${DJK}/vertrag)
  target_compile_definitions(${name} PRIVATE ${schalter}=1)
  target_link_libraries(${name} PRIVATE PkgConfig::JACK Threads::Threads cypherdj::toml cypherdj::dsp
                        cypherdj::stellwerk cypherdj_dsp_messer cypherdj::json PkgConfig::CRYPTO cypherdj::hand PkgConfig::RUBBERBAND)  # 25, 31, 35; Keylock Slice 3: KERN_QUELLEN enthält netz_loop.cpp und loop_stretch.cpp
endfunction()
kern_mutation(cypherdj-kern-mutation CYPHERDJ_MUTATION_KLICK_BLOCKANFANG)       # Scheibe 01: Klick auf den Blockanfang
kern_mutation(cypherdj-kern-mutation-rampe CYPHERDJ_MUTATION_RAMPE_IN_SAMPLES)  # Scheibe 08: Rampe in Samples statt Beats
kern_mutation(cypherdj-kern-mutation-begin CYPHERDJ_MUTATION_ERZ_BEGIN_IGNORIERT)  # MVP 2 Scheibe 3: begin/end ignoriert

enable_testing()
file(GLOB KERN_TESTS CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_*.cpp)
# Scheibe 25: test_mixer prüft die Zuweisungstabelle (Wege bitgleich, Blende, Crossfader, PFL/Cue) am Mixer ohne den
# Master-Limiter dahinter; den Limiter, seinen Vorhalt und den verzögerten Cue prüft test_limiter25 am Betriebs-Mixer.
list(REMOVE_ITEM KERN_TESTS ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_mixer.cpp)
foreach(pfad ${KERN_TESTS})
  get_filename_component(t ${pfad} NAME_WE)
  add_executable(${t} ${pfad})
  target_include_directories(${t} PRIVATE tests)
  target_link_libraries(${t} PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  target_compile_definitions(${t} PRIVATE CYPHERDJ_DJK="${DJK}")
  add_test(NAME ${t} COMMAND ${t})
endforeach()
# Audit F17: ein Rückfall in den Netz-Livelock hängt den Test, statt rot zu werden; die Frist macht ihn rot.
set_tests_properties(test_netz_selbst_abo PROPERTIES TIMEOUT 20)

# Keylock Slice 1: test_loop_stretch kommt seit Slice 3 aus dem Einsammeln der Tests oben (loop_stretch.cpp liegt in kernbib).
# Keylock Slice 3: test_netz_keylock und test_netz_keylock_kern ebenso. Die test_mutation-Ziele mit expliziten Quellenlisten
# binden netz*.cpp nicht ein und brauchen weder keylock_render.cpp noch loop_stretch.cpp noch librubberband.

# Tests gegen eine Mutation gebaut müssen scheitern (WILL_FAIL): so ist gezeigt, dass sie den Fehlerfall sehen.
# Angelegt erst, wenn die Testdatei und alle Quellen da sind (die Tasks des Plans bringen sie nacheinander).
function(test_mutation name test schalter)
  foreach(q tests/${test}.cpp ${ARGN})
    if(NOT EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/${q})
      return()
    endif()
  endforeach()
  add_executable(${name} tests/${test}.cpp ${ARGN})
  target_include_directories(${name} PRIVATE include tests ${DJK}/vertrag)
  target_compile_definitions(${name} PRIVATE ${schalter}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(${name} PRIVATE PkgConfig::JACK Threads::Threads cypherdj::dsp cypherdj::stellwerk
                        cypherdj_dsp_messer cypherdj::json PkgConfig::CRYPTO cypherdj::hand)  # Scheibe 25, 31, 35
  add_test(NAME ${name} COMMAND ${name})
  set_tests_properties(${name} PROPERTIES WILL_FAIL TRUE)
endfunction()
test_mutation(test_klick_mutation test_klick CYPHERDJ_MUTATION_KLICK_BLOCKANFANG src/klick.cpp src/uhr.cpp)
test_mutation(test_tempoplan_mutation test_tempoplan CYPHERDJ_MUTATION_RAMPE_IN_SAMPLES src/tempoplan.cpp src/uhr.cpp)
test_mutation(test_befehle_mutation test_befehle CYPHERDJ_MUTATION_TAKT_AUS_KARTE
              src/kern.cpp src/erzeuger.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/kern_stellwerk.cpp src/mixer.cpp src/beatfx.cpp src/teile.cpp src/klick.cpp src/tempoplan.cpp
              src/uhr.cpp  # Scheibe 25: kern.cpp braucht Stellwerk-Anbindung, Mixer und Schatten
              src/kern_deck.cpp src/deck.cpp src/lader.cpp src/fassung.cpp  # Scheibe 31: und die Decks
              src/kern_hand.cpp src/hand_ein.cpp)  # Scheibe 35: Kern-Hand
test_mutation(test_ausgang_mutation test_ausgang CYPHERDJ_MUTATION_OHNE_RIEGEL)
# Plan 2026-09-27 (Strudel Stufe 1), Fehlerfall: Erzeuger-Einsatz am Blockanfang statt am Sample des Beats.
test_mutation(test_erzeuger_mutation test_erzeuger CYPHERDJ_MUTATION_ERZ_BLOCKANFANG src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
# K2 Task 1.2, Fehlerfall: Kick-Auslöser am Blockanfang statt am Sample.
test_mutation(test_erzeuger_duck_mutation test_erzeuger_duck CYPHERDJ_MUTATION_DUCK_BLOCKANFANG src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
# Plan MVP 2 (ADR 025), Fehlerfall: Loop-Position ab dem Einsatz statt aus dem Beat (Box läuft neben dem Raster).
test_mutation(test_loopbox_mutation test_loopbox CYPHERDJ_MUTATION_LOOP_AB_START src/loopbox.cpp src/loop.cpp src/uhr.cpp)
# Plan MVP 2 Scheibe 2 (ADR 025 Folgeplan), Fehlerfall: Mitschnitt-Einsatz am Blockanfang statt ab ab_sample.
test_mutation(test_loopbox_mitschnitt_mutation test_loopbox CYPHERDJ_MUTATION_MITSCHNITT_BLOCKANFANG src/loopbox.cpp src/loop.cpp src/uhr.cpp)
# Plan Grid, Fehlerfall: die Box ignoriert den Raster-Versatz (spielt ungedreht).
test_mutation(test_loopbox_versatz_mutation test_loopbox CYPHERDJ_MUTATION_LOOP_OHNE_VERSATZ src/loopbox.cpp src/loop.cpp src/uhr.cpp)
# Plan Tempo-Folge: Box liest bei Tempo ≠ 128 aus den Samples statt aus dem Beat (läuft neben der Uhr).
test_mutation(test_loopbox_tempo_mutation test_loopbox CYPHERDJ_MUTATION_LOOP_TEMPO_STARR src/loopbox.cpp src/loop.cpp src/uhr.cpp)
# Keylock (Plan 2026-09-30, Slice 2): die Box benutzt die vorgerenderte Variante nie (bleibt im Varispeed, Schritt bpm/128).
test_mutation(test_loopbox_variante_mutation test_loopbox CYPHERDJ_MUTATION_LOOP_VARIANTE_IGNORIERT src/loopbox.cpp src/loop.cpp src/uhr.cpp)
# Plan 3 (Beat-FX), Fehlerfall: LFO-Phase ab dem ersten Block statt aus dem absoluten Beat.
test_mutation(test_beatfx_mutation test_beatfx CYPHERDJ_MUTATION_FX_LFO_AB_START src/beatfx.cpp)

# Scheibe 18, Messgerät der Abschuss-Serien (tests/neustart/): JACK-Aufnehmer mit vier Kanälen am Ziel. Liegt in einem
# Unterordner, den das Einsammeln der Tests oben nicht erfasst.
add_executable(cypherdj-aufnehmer4 tests/neustart/aufnehmer4.cpp)
target_link_libraries(cypherdj-aufnehmer4 PRIVATE PkgConfig::JACK)
target_compile_options(cypherdj-aufnehmer4 PRIVATE -Wall -Wextra)

# Scheibe 18: Diagnose des Neustart-Zustands (nur lesend, SCHNITTSTELLEN §6.3) und die Vergleichsmessung der Kosten des
# Echtzeit-Fachs (kein Test). Beide in Unterordnern, die das Einsammeln oben nicht erfasst.
add_executable(cypherdj-zustand src/werkzeuge/zustand.cpp)
target_link_libraries(cypherdj-zustand PRIVATE cypherdj_kernbib)
target_compile_options(cypherdj-zustand PRIVATE -Wall -Wextra)
add_executable(neustart_kosten tests/neustart/kosten.cpp)
target_link_libraries(neustart_kosten PRIVATE cypherdj_kernbib)
# Scheibe 18: der Test des Selbst-Wächters muss einen Wächter erkennen, der meldet, aber nicht tötet
test_mutation(test_selbstwaechter_mutation test_selbstwaechter CYPHERDJ_MUTATION_WAECHTER_OHNE_KILL src/selbstwaechter.cpp)
test_mutation(test_selbstwaechter_mutation_rand test_selbstwaechter CYPHERDJ_MUTATION_WAECHTER_GRENZE_AB_SEIT src/selbstwaechter.cpp)  # Slice 2 MINOR-1
# Scheibe 25, Fehlerfall der Abnahme: Griff der Hand am Blockanfang statt am Versatz (09 Probe b naiv_block). Der Kern
# damit fährt hand_gewinnt rot (Abbruch-Quittung bei Sample 1 619 968 statt 1 620 000); test_kern_hand gegen dieselbe
# Mutation muss scheitern.
kern_mutation(cypherdj-kern-mutation-hand CYPHERDJ_MUTATION_HAND_BLOCKANFANG)
test_mutation(test_kern_hand_mutation test_kern_hand CYPHERDJ_MUTATION_HAND_BLOCKANFANG
              src/kern.cpp src/erzeuger.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/kern_stellwerk.cpp src/mixer.cpp src/beatfx.cpp src/teile.cpp src/klick.cpp src/tempoplan.cpp src/uhr.cpp
              src/kern_deck.cpp src/deck.cpp src/lader.cpp src/fassung.cpp  # Scheibe 31
              src/kern_hand.cpp src/hand_ein.cpp)  # Scheibe 35
# Scheibe 25, Fehlerfall der Abnahme „Limiter im Master“ (MVP, Lücken und Entscheide): Master ohne Limiter. test_limiter25
# gegen diese Mutation muss scheitern (heißes Signal über −1 dBTP); cypherdj-kern-mutation-limiter für die Messung an der
# Fassung (tests/limiter/).
kern_mutation(cypherdj-kern-mutation-limiter CYPHERDJ_MUTATION_OHNE_LIMITER)
test_mutation(test_limiter25_mutation test_limiter25 CYPHERDJ_MUTATION_OHNE_LIMITER src/mixer.cpp src/beatfx.cpp)
# K2 Task 1.5: Duck ohne Wirkung auf den Kanälen. test_mixer_duck (vom Glob angelegt) gegen diese Mutation muss scheitern.
test_mutation(test_mixer_duck_mutation test_mixer_duck CYPHERDJ_MUTATION_DUCK_AUS src/mixer.cpp src/beatfx.cpp)
# K2 Task 2.2: Rückweg fx/2 ohne Hall in der Summe. test_mixer_hall (vom Glob angelegt) gegen diese Mutation muss scheitern.
test_mutation(test_mixer_hall_mutation test_mixer_hall CYPHERDJ_MUTATION_HALL_TOT src/mixer.cpp src/beatfx.cpp)
# K2 Task 3.3: Kleber in der Summe abgeschaltet. test_mixer_kleber (vom Glob angelegt) gegen diese Mutation muss scheitern.
test_mutation(test_mixer_kleber_mutation test_mixer_kleber CYPHERDJ_MUTATION_KLEBER_AUS src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_kleber_in_summe_mutation test_mixer_kleber CYPHERDJ_MUTATION_KLEBER_IN_SUMME src/mixer.cpp src/beatfx.cpp)
# K2 Umbau: Kleber beim Ausschalten sofort überspringen (Gain-Stufe). test_mixer_kleber (Fall i) muss dagegen scheitern.
test_mutation(test_mixer_kleber_sofort_aus_mutation test_mixer_kleber CYPHERDJ_MUTATION_KLEBER_SOFORT_AUS src/mixer.cpp src/beatfx.cpp)
# K2 Task 1.5: Kern-Verdrahtung. Der Auslöser geht ohne Sample-Versatz an den Mixer; test_kern_duck muss scheitern.
test_mutation(test_kern_duck_mutation test_kern_duck CYPHERDJ_MUTATION_DUCK_VERSATZ_NULL
              src/kern.cpp src/erzeuger.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/kern_stellwerk.cpp src/mixer.cpp src/beatfx.cpp src/teile.cpp src/klick.cpp src/tempoplan.cpp src/uhr.cpp
              src/kern_deck.cpp src/deck.cpp src/lader.cpp src/fassung.cpp
              src/kern_hand.cpp src/hand_ein.cpp)
# Scheibe 25: test_mixer am Mixer ohne Limiter (siehe oben beim Einsammeln der Tests); kein WILL_FAIL.
add_executable(test_mixer tests/test_mixer.cpp src/mixer.cpp src/beatfx.cpp)
target_include_directories(test_mixer PRIVATE include tests)
target_compile_definitions(test_mixer PRIVATE CYPHERDJ_MUTATION_OHNE_LIMITER=1)
target_link_libraries(test_mixer PRIVATE cypherdj::dsp cypherdj::stellwerk cypherdj_dsp_messer)
add_test(NAME test_mixer COMMAND test_mixer)
# Scheibe 25: Master-Limiter an einer echten Fassung (Werkzeug, kein Test; tests/limiter/messe.sh)
foreach(v IN ITEMS kern_limiter_fassung kern_limiter_fassung_ohne)
  add_executable(${v} tests/limiter/limiter_fassung.cpp src/mixer.cpp src/beatfx.cpp)
  target_include_directories(${v} PRIVATE include)
  target_link_libraries(${v} PRIVATE cypherdj::dsp cypherdj::stellwerk cypherdj_dsp_messer)
endforeach()
target_compile_definitions(kern_limiter_fassung_ohne PRIVATE CYPHERDJ_MUTATION_OHNE_LIMITER=1)
# Scheibe 25: Vergleichsmessung der Zykluskosten ohne JACK (kein Test; die Messung im Callback macht
# tests/ziel/kosten25.sh). Liegt in einem Unterordner, den das Einsammeln der Tests nicht erfasst.
add_executable(kern_kosten25 tests/kosten/kosten25.cpp)
target_link_libraries(kern_kosten25 PRIVATE cypherdj_kernbib)

# Scheibe 31: Selbsttest der Klick-Fassung (tests/deck/klick_fassung.py, das Material der Deck-Tests und der Abnahme).
find_package(Python3 REQUIRED COMPONENTS Interpreter)
add_test(NAME test_klick_fassung COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/deck/test_klick_fassung.py)
# Scheibe 31, Fehlerfall des Drift-Messers (wie 03 Probe 4a --drift 1e-5): Lesekopf 1e-5 zu schnell. test_deck gegen die
# Mutation muss scheitern; der Kern damit ist das Gegenstück für den Drift-Lauf am Ziel.
test_mutation(test_deck_mutation test_deck CYPHERDJ_MUTATION_DECK_DRIFT src/deck.cpp src/fassung.cpp)
# Plan Grid, Fehlerfall: setze_raster verschiebt nur die Linien, nicht den Ton (der Quell-Beat unter dem Kopf springt).
test_mutation(test_deck_raster_mutation test_deck CYPHERDJ_MUTATION_RASTER_OHNE_KOPF src/deck.cpp src/fassung.cpp)
kern_mutation(cypherdj-kern-mutation-drift CYPHERDJ_MUTATION_DECK_DRIFT)
# Scheibe 31, Fehlerfall der Abnahme: Deck-Start am Blockanfang statt am Sample des Ziel-Beats. test_kern_deck gegen die
# Mutation muss scheitern (Klick und Quittung 2 am Blockanfang); der Kern damit fährt start_quell_beat rot.
kern_mutation(cypherdj-kern-mutation-start CYPHERDJ_MUTATION_START_BLOCKANFANG)
test_mutation(test_kern_deck_mutation test_kern_deck CYPHERDJ_MUTATION_START_BLOCKANFANG
              src/kern.cpp src/erzeuger.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/kern_stellwerk.cpp src/kern_deck.cpp src/mixer.cpp src/beatfx.cpp src/teile.cpp src/klick.cpp
              src/tempoplan.cpp src/uhr.cpp src/deck.cpp src/lader.cpp src/fassung.cpp src/kern_hand.cpp src/hand_ein.cpp)
# Scheibe 31: Vergleichsmessung der Zykluskosten ohne JACK mit vier spielenden Decks (kein Test; die Messung im Callback
# macht tests/deck/ziel_lauf.py --art kosten).
add_executable(kern_kosten31 tests/kosten/kosten31.cpp)
target_link_libraries(kern_kosten31 PRIVATE cypherdj_kernbib)
target_compile_definitions(kern_kosten31 PRIVATE CYPHERDJ_DJK="${DJK}")
# Scheibe 31, ASan-Bau: Material in Decks bei Programmende ist kein Leck des Laufs (tests/lsan_decks.supp)
if(CYPHERDJ_SANITIZE)
  foreach(t test_kern_deck test_kern_deck_neustart test_kern_midi test_kern_deck_hand test_kern_pegel)  # Scheibe 35: enden mit geladenem Deck
    if(TEST ${t})
      set_tests_properties(${t} PROPERTIES ENVIRONMENT
                           "LSAN_OPTIONS=suppressions=${CMAKE_CURRENT_SOURCE_DIR}/tests/lsan_decks.supp")
    endif()
  endforeach()
endif()

# Scheibe 35: Instrument-Kontrolle der Auswertung am Ziel (tests/hand/auswertung_hand.py) an künstlichen Läufen bekannter
# Wahrheit: richtig, Folgeblock, erster Wert wirkt, 1 ms Versatz, leer, Ruhe mit und ohne Griff.
add_test(NAME test_auswertung_hand COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/hand/test_auswertung_hand.py)

# Scheibe 35, Fehlerfall der Abnahme (Plan 35 E2): das MIDI-Ereignis wirkt am Anfang des Folgeblocks statt an seinem
# Versatz (sample = s0 + n, wie 19 M01). test_kern_midi gegen diese Mutation muss scheitern (Griff bei 142 848 statt
# 142 777); cypherdj-kern-mutation-folgeblock ist der Kern für den Fehlerfall am Ziel.
set(KERN_QUELLEN35 src/kern.cpp src/erzeuger.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/kern_stellwerk.cpp src/kern_deck.cpp src/kern_hand.cpp src/hand_ein.cpp src/mixer.cpp src/beatfx.cpp
    src/teile.cpp src/klick.cpp src/tempoplan.cpp src/uhr.cpp src/deck.cpp src/lader.cpp src/fassung.cpp)
kern_mutation(cypherdj-kern-mutation-folgeblock CYPHERDJ_MUTATION_HAND_FOLGEBLOCK)
test_mutation(test_kern_midi_mutation test_kern_midi CYPHERDJ_MUTATION_HAND_FOLGEBLOCK ${KERN_QUELLEN35})
test_mutation(test_kern_erzeuger_mutation test_kern_erzeuger CYPHERDJ_MUTATION_ERZ_BLOCKANFANG ${KERN_QUELLEN35})
# Plan fx-wege Slice 2, Fehlerfall der Reihenfolge: FX2 liefe vor FX1. test_kern_fx (Fall 8) muss dagegen scheitern.
test_mutation(test_kern_fx_reihenfolge_mutation test_kern_fx CYPHERDJ_MUTATION_FX_EINHEITEN_VERTAUSCHT ${KERN_QUELLEN35})
# Ohr T17, Fehlerfall FX-Routing: der Weg wird ohne Gleiten getauscht und die Echo-Leitung sofort geleert. test_kern_fx_routing
# (Fall 2, Sprung im Umschaltfenster) muss dagegen scheitern.
test_mutation(test_kern_fx_routing_hart_mutation test_kern_fx_routing CYPHERDJ_MUTATION_FX_ROUTING_HART ${KERN_QUELLEN35})
# Kern für den Fehlerfall am Ziel (Task 9 Step 3): Erzeuger-Einsatz am Blockanfang
kern_mutation(cypherdj-kern-mutation-erz CYPHERDJ_MUTATION_ERZ_BLOCKANFANG)
# Plan MVP 2: Fehlerfall Loop-Position ab dem Einsatz (Test) und falsches Raster 22 501 (Kern für den Durchstich, Task 11)
test_mutation(test_kern_loop_mutation test_kern_loop CYPHERDJ_MUTATION_LOOP_AB_START ${KERN_QUELLEN35})
# Plan Tempo-Folge: dieselbe Mutation am Kern-Befehl (Box bei 130 BPM auf dem 128er-Raster).
test_mutation(test_kern_loop_tempo_mutation test_kern_loop CYPHERDJ_MUTATION_LOOP_TEMPO_STARR ${KERN_QUELLEN35})
kern_mutation(cypherdj-kern-mutation-loop CYPHERDJ_MUTATION_LOOP_SPB)
# Plan MVP 2 Scheibe 2 (ADR 025 Folgeplan), Fehlerfall der Abnahme: Mitschnitt-Einsatz am Blockanfang des Blocks mit
# ab_sample statt an ab_sample selbst (Task 9 Ziel-Beleg: cypherdj-kern-mutation-mitschnitt für den Fehlerfall am Ziel).
test_mutation(test_kern_mitschnitt_mutation test_kern_mitschnitt CYPHERDJ_MUTATION_MITSCHNITT_BLOCKANFANG ${KERN_QUELLEN35})
test_mutation(test_kern_mitschnitt_ring_mutation test_kern_mitschnitt CYPHERDJ_MUTATION_MITSCHNITT_VERLIERBAR ${KERN_QUELLEN35})  # Scheibe 3 E4: voller Ring verliert /e/mitschnitt
kern_mutation(cypherdj-kern-mutation-mitschnitt CYPHERDJ_MUTATION_MITSCHNITT_BLOCKANFANG)

# Scheibe 35, Task 3, Fehlerfall: Kodierung des Encoders vertauscht (zweierkomplement <-> versatz64), die Raste läuft in
# die falsche Richtung. test_kern_mixer gegen diese Mutation muss scheitern.
test_mutation(test_kern_mixer_mutation test_kern_mixer CYPHERDJ_MUTATION_HAND_KODIERUNG ${KERN_QUELLEN35})

# Scheibe 35, Task 5, Fehlerfall: „Start sofort ohne Phase“ (Deck-Taste startet am Griff am Frame der Position, ohne
# Quantisierung und Phase). test_kern_deck_hand gegen diese Mutation muss scheitern.
kern_mutation(cypherdj-kern-mutation-ohne-phase CYPHERDJ_MUTATION_HAND_OHNE_PHASE)  # der Kern für den Fehlerfall am Ziel
kern_mutation(cypherdj-kern-mutation-verbinder CYPHERDJ_MUTATION_HAND_VERBINDER_NUR_START)  # Task 7: Verbinder nur beim Start
test_mutation(test_kern_deck_hand_mutation test_kern_deck_hand CYPHERDJ_MUTATION_HAND_OHNE_PHASE ${KERN_QUELLEN35})
# Plan Grid, Fehlerfall am Kern: Raster-Versatz ohne Kopf (Ton bleibt, Klicks nach der Änderung weiter auf dem Beat).
test_mutation(test_kern_deck_raster_mutation test_kern_deck_raster CYPHERDJ_MUTATION_RASTER_OHNE_KOPF ${KERN_QUELLEN35})

# Scheibe 35, Task 6, Fehlerfall: „Stopp nur melden“ (/e/taste geht hinaus, ki_stopp wird nicht gerufen).
# test_kern_stopp gegen diese Mutation muss scheitern.
test_mutation(test_kern_stopp_mutation test_kern_stopp CYPHERDJ_MUTATION_HAND_STOPP_MELDEN ${KERN_QUELLEN35})

# Scheibe 35, Task 8, Fehlerfall: /k/mapping quittiert, tauscht aber nicht. test_kern_mapping gegen diese Mutation muss
# scheitern (CC 1/24 bleibt ohne Wirkung).
kern_mutation(cypherdj-kern-mutation-mapping CYPHERDJ_MUTATION_MAPPING_NICHT_TAUSCHEN)  # der Kern für den Fehlerfall am Ziel
test_mutation(test_kern_mapping_mutation test_kern_mapping CYPHERDJ_MUTATION_MAPPING_NICHT_TAUSCHEN ${KERN_QUELLEN35})

# Scheibe 35, /pegel: der Kern für den Fehlerfall am Ziel (0 /pegel) und der Test gegen dieselbe Mutation (muss scheitern).
kern_mutation(cypherdj-kern-mutation-kein-pegel CYPHERDJ_MUTATION_KEIN_PEGEL)
test_mutation(test_kern_pegel_mutation test_kern_pegel CYPHERDJ_MUTATION_KEIN_PEGEL ${KERN_QUELLEN35})
