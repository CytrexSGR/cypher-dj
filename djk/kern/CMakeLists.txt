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
# Bungee (MPL-2.0) als zweite Keylock-Maschine neben R3 (Umbauplan 2026-10-09-bungee-umbau, S0). Aus: kein Bungee gebaut,
# keylock_maschine = "bungee" liefert dann keinen Dehner (Keylock aus), R3 unverändert.
option(CYPHERDJ_BUNGEE "Bungee als Keylock-Maschine (djk/third_party/bungee)" OFF)
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
# src/dehner_bungee.cpp gehört nicht in KERN_QUELLEN (die Mutationsziele mit eigener Quellenliste kennen Bungee nicht): nur die
# Bibliothek und die Ziele, die Bungee ausdrücklich brauchen, binden sie (mit CYPHERDJ_BUNGEE und cypherdj::bungee).
list(REMOVE_ITEM KERN_QUELLEN ${CMAKE_CURRENT_SOURCE_DIR}/src/dehner_bungee.cpp)
set(KERN_BUNGEE_QUELLE)
if(CYPHERDJ_BUNGEE)
  include(${DJK}/third_party/bungee.cmake)
  set(KERN_BUNGEE_QUELLE ${CMAKE_CURRENT_SOURCE_DIR}/src/dehner_bungee.cpp)
endif()
add_library(cypherdj_kernbib STATIC ${KERN_QUELLEN} ${KERN_BUNGEE_QUELLE})
if(CYPHERDJ_BUNGEE)
  target_compile_definitions(cypherdj_kernbib PUBLIC CYPHERDJ_BUNGEE=1)
  target_link_libraries(cypherdj_kernbib PUBLIC cypherdj::bungee)
endif()
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
if(NOT CYPHERDJ_BUNGEE)
  list(FILTER KERN_TESTS EXCLUDE REGEX "test_[a-z_]*bungee")  # Tests der Bungee-Maschine bauen nur mit CYPHERDJ_BUNGEE
endif()
foreach(pfad ${KERN_TESTS})
  get_filename_component(t ${pfad} NAME_WE)
  add_executable(${t} ${pfad})
  target_include_directories(${t} PRIVATE tests)
  target_link_libraries(${t} PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  target_compile_definitions(${t} PRIVATE CYPHERDJ_DJK="${DJK}")
  add_test(NAME ${t} COMMAND ${t})
endforeach()
# Keylock Task 1b (Prüfung F3): test_dehner misst die Lage gegen eine nackte Rubber-Band-Instanz (Referenz „rohes R3“).
target_link_libraries(test_dehner PRIVATE PkgConfig::RUBBERBAND)
# Keylock Task 2: test_deck_keylock misst die Lage ebenso gegen rohes R3 (keylock_mess.h).
target_link_libraries(test_deck_keylock PRIVATE PkgConfig::RUBBERBAND)
# Keylock Task 2.5: test_kern_keylock_faeden misst Tonhöhe und Lage mit keylock_mess.h (bindet Rubber Band ein).
target_link_libraries(test_kern_keylock_faeden PRIVATE PkgConfig::RUBBERBAND)
# Keylock Task 7: test_loopbox_keylock misst die Lage der Box gegen rohes R3 (keylock_mess.h).
target_link_libraries(test_loopbox_keylock PRIVATE PkgConfig::RUBBERBAND)
# Keylock Task 6a: test_deck_geplant misst mit keylock_mess.h (bindet Rubber Band ein).
target_link_libraries(test_deck_geplant PRIVATE PkgConfig::RUBBERBAND)
# Task 2.5c: Speichersperre des Keylock-Baus in eigenen Prozessen (frischer Speicher), Vergleich mit Stand 2.5b
add_test(NAME test_kern_keylock_faeden_sperre COMMAND test_kern_keylock_faeden sperre)
add_test(NAME test_kern_keylock_faeden_sperre_alt COMMAND test_kern_keylock_faeden sperre_alt)
# Audit F17: ein Rückfall in den Netz-Livelock hängt den Test, statt rot zu werden; die Frist macht ihn rot.
set_tests_properties(test_netz_selbst_abo PROPERTIES TIMEOUT 20)

# Keylock Slice 3/4: loop_stretch.cpp und keylock_render.cpp (REC-Umrechnung) liegen in kernbib. Die test_mutation-Ziele mit
# expliziten Quellenlisten binden netz*.cpp nicht ein und brauchen weder keylock_render.cpp noch loop_stretch.cpp noch
# librubberband. Task 7: die Keylock-Varianten der Boxen und ihre Tests (test_keylock_rampe, test_netz_keylock,
# test_netz_keylock_kern, test_loop_stretch, test_loop_stretch_lage) sind ausgebaut; die Box prüft test_loopbox_keylock.

# Tests gegen eine Mutation gebaut müssen scheitern (WILL_FAIL): so ist gezeigt, dass sie den Fehlerfall sehen.
# Angelegt erst, wenn die Testdatei und alle Quellen da sind (die Tasks des Plans bringen sie nacheinander).
# Argumente nach dem Schalter: Quellen; Einträge der Form PkgConfig::X sind Bibliotheken zum Binden (Keylock Task 1:
# PkgConfig::RUBBERBAND für Ziele mit src/dehner.cpp).
function(test_mutation name test schalter)
  set(tm_quellen)
  set(tm_libs)
  foreach(q ${ARGN})
    if(q MATCHES "^(PkgConfig|cypherdj)::")
      list(APPEND tm_libs ${q})
    else()
      list(APPEND tm_quellen ${q})
    endif()
  endforeach()
  foreach(q tests/${test}.cpp ${tm_quellen})
    if(NOT EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/${q})
      return()
    endif()
  endforeach()
  add_executable(${name} tests/${test}.cpp ${tm_quellen})
  target_include_directories(${name} PRIVATE include tests ${DJK}/vertrag)
  target_compile_definitions(${name} PRIVATE ${schalter}=1 CYPHERDJ_DJK="${DJK}")
  if(CYPHERDJ_BUNGEE AND "src/dehner_bungee.cpp" IN_LIST tm_quellen)  # nur die Ziele, die Bungee ausdrücklich einbinden
    target_compile_definitions(${name} PRIVATE CYPHERDJ_BUNGEE=1)
  endif()
  target_link_libraries(${name} PRIVATE PkgConfig::JACK Threads::Threads cypherdj::dsp cypherdj::stellwerk
                        cypherdj_dsp_messer cypherdj::json PkgConfig::CRYPTO cypherdj::hand ${tm_libs})  # Scheibe 25, 31, 35
  add_test(NAME ${name} COMMAND ${name})
  set_tests_properties(${name} PROPERTIES WILL_FAIL TRUE)
endfunction()
test_mutation(test_klick_mutation test_klick CYPHERDJ_MUTATION_KLICK_BLOCKANFANG src/klick.cpp src/uhr.cpp)
test_mutation(test_tempoplan_mutation test_tempoplan CYPHERDJ_MUTATION_RAMPE_IN_SAMPLES src/tempoplan.cpp src/uhr.cpp)
test_mutation(test_befehle_mutation test_befehle CYPHERDJ_MUTATION_TAKT_AUS_KARTE
              src/kern.cpp src/erzeuger.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/kern_stellwerk.cpp src/mixer.cpp src/beatfx.cpp src/teile.cpp src/klick.cpp src/tempoplan.cpp
              src/uhr.cpp  # Scheibe 25: kern.cpp braucht Stellwerk-Anbindung, Mixer und Schatten
              src/kern_deck.cpp src/deck.cpp src/lader.cpp src/fassung.cpp  # Scheibe 31: und die Decks
              src/kern_hand.cpp src/hand_ein.cpp  # Scheibe 35: Kern-Hand
              stub/dehner_stub.cpp)  # Keylock Task 2: kern_deck.cpp ruft die Fabrik (Vertrag 13)
test_mutation(test_ausgang_mutation test_ausgang CYPHERDJ_MUTATION_OHNE_RIEGEL)
# Plan 2026-09-27 (Strudel Stufe 1), Fehlerfall: Erzeuger-Einsatz am Blockanfang statt am Sample des Beats.
test_mutation(test_erzeuger_mutation test_erzeuger CYPHERDJ_MUTATION_ERZ_BLOCKANFANG src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
# K2 Task 1.2, Fehlerfall: Kick-Auslöser am Blockanfang statt am Sample.
test_mutation(test_erzeuger_duck_mutation test_erzeuger_duck CYPHERDJ_MUTATION_DUCK_BLOCKANFANG src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
# Glanz 2.5.1 (F46), Fehlerfall: Erzeuger-Stimmen ohne Rampe an begin/end.
test_mutation(test_erzeuger_rampe_mutation test_erzeuger CYPHERDJ_MUTATION_ERZ_OHNE_RAMPE src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
# Glanz 2.5.2 (F16), Fehlerfall: Stimmenraub ohne Suche nach einer freien Stimme.
test_mutation(test_erzeuger_raub_mutation test_erzeuger CYPHERDJ_MUTATION_ERZ_OHNE_FREIE src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
# Glanz 2.4.1 (F11), Fehlerfall: Kit-Tausch schneidet klingende Stimmen hart ab.
test_mutation(test_erzeuger_tausch_mutation test_erzeuger CYPHERDJ_MUTATION_KIT_TAUSCH_HART src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
# Prüfung Slice 2.5/2.4, Fix A: zu wenige Ausklang-Plätze (Raub + Kit-Tausch zusammen brauchen 2 · ERZ_STIMMEN).
test_mutation(test_erzeuger_ausklangplaetze_mutation test_erzeuger CYPHERDJ_MUTATION_ERZ_AUSKLANG_PLAETZE src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
# Prüfung Slice 2.5/2.4, Fix B: Raub wählt die jüngste statt der ältesten Stimme.
test_mutation(test_erzeuger_raubwahl_mutation test_erzeuger CYPHERDJ_MUTATION_ERZ_RAUB_JUENGSTE src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
# Prüfung Slice 2.5/2.4, Fix B: jeder Ausklang landet auf Platz 0 und überschreibt den vorigen.
test_mutation(test_erzeuger_ausklangplatz_mutation test_erzeuger CYPHERDJ_MUTATION_ERZ_AUSKLANG_PLATZ0 src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
# Plan MVP 2 (ADR 025), Fehlerfall: Loop-Position ab dem Einsatz statt aus dem Beat (Box läuft neben dem Raster).
test_mutation(test_loopbox_mutation test_loopbox CYPHERDJ_MUTATION_LOOP_AB_START src/loopbox.cpp src/loop.cpp src/uhr.cpp)
# Plan MVP 2 Scheibe 2 (ADR 025 Folgeplan), Fehlerfall: Mitschnitt-Einsatz am Blockanfang statt ab ab_sample.
test_mutation(test_loopbox_mitschnitt_mutation test_loopbox CYPHERDJ_MUTATION_MITSCHNITT_BLOCKANFANG src/loopbox.cpp src/loop.cpp src/uhr.cpp)
# Plan Grid, Fehlerfall: die Box ignoriert den Raster-Versatz (spielt ungedreht).
test_mutation(test_loopbox_versatz_mutation test_loopbox CYPHERDJ_MUTATION_LOOP_OHNE_VERSATZ src/loopbox.cpp src/loop.cpp src/uhr.cpp)
# Plan Tempo-Folge: Box liest bei Tempo ≠ 128 aus den Samples statt aus dem Beat (läuft neben der Uhr).
test_mutation(test_loopbox_tempo_mutation test_loopbox CYPHERDJ_MUTATION_LOOP_TEMPO_STARR src/loopbox.cpp src/loop.cpp src/uhr.cpp)
# Welle 2 Slice 2.2: Fehlerfall des Blend-Bausteins (Umzielen ab dem alten Ziel statt ab dem Ist-Wert, Klasse F27).
test_mutation(test_blende_mutation test_blende CYPHERDJ_MUTATION_BLENDE_ABBRUCH)
# Welle 2 F15, Fehlerfall: Loop-Box ohne Hülle (harter Einsatz und Stopp, Ausklang bei /k/set/neu). test_loopbox muss scheitern.
test_mutation(test_loopbox_huelle_mutation test_loopbox CYPHERDJ_MUTATION_LOOP_OHNE_HUELLE src/loopbox.cpp src/loop.cpp src/uhr.cpp)
# Welle 2 F13, Fehlerfall: Laden in eine laufende Box tauscht hart. test_loopbox muss scheitern.
test_mutation(test_loopbox_laden_mutation test_loopbox CYPHERDJ_MUTATION_LOOP_LADEN_HART src/loopbox.cpp src/loop.cpp src/uhr.cpp)
# Keylock Task 3b: ein neuer Abonnent bekommt den Stand des Knopfs nicht (/e/regler keylock beim ersten /k/hallo): test_netz_deck rot.
add_executable(test_netz_deck_knopf_mutation tests/test_netz_deck.cpp ${KERN_QUELLEN})
target_include_directories(test_netz_deck_knopf_mutation PRIVATE include tests ${DJK}/vertrag)
target_compile_definitions(test_netz_deck_knopf_mutation PRIVATE CYPHERDJ_MUTATION_KEYLOCK_HALLO_OHNE_KNOPF=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_deck_knopf_mutation PRIVATE PkgConfig::JACK Threads::Threads cypherdj::toml cypherdj::dsp cypherdj::stellwerk
                      cypherdj_dsp_messer cypherdj::json PkgConfig::CRYPTO cypherdj::hand PkgConfig::RUBBERBAND)
add_test(NAME test_netz_deck_knopf_mutation COMMAND test_netz_deck_knopf_mutation)
set_tests_properties(test_netz_deck_knopf_mutation PROPERTIES WILL_FAIL TRUE)
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
              src/kern_hand.cpp src/hand_ein.cpp  # Scheibe 35
              stub/dehner_stub.cpp)  # Keylock Task 2: Fabrik ohne Rubber Band
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
              src/kern_hand.cpp src/hand_ein.cpp
              stub/dehner_stub.cpp)
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
# Keylock Task 4.1: ziel_lauf.py darf nicht blind bestehen (stille Aufnahme, abgewiesener Befehl), ohne JACK.
add_test(NAME test_ziel_lauf COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/deck/test_ziel_lauf.py)
# Scheibe 31, Fehlerfall des Drift-Messers (wie 03 Probe 4a --drift 1e-5): Lesekopf 1e-5 zu schnell. test_deck gegen die
# Mutation muss scheitern; der Kern damit ist das Gegenstück für den Drift-Lauf am Ziel.
test_mutation(test_deck_mutation test_deck CYPHERDJ_MUTATION_DECK_DRIFT src/deck.cpp src/fassung.cpp src/uhr.cpp)  # Welle 3: deck.cpp liest die Karte
# Plan Grid, Fehlerfall: setze_raster verschiebt nur die Linien, nicht den Ton (der Quell-Beat unter dem Kopf springt).
test_mutation(test_deck_raster_mutation test_deck CYPHERDJ_MUTATION_RASTER_OHNE_KOPF src/deck.cpp src/fassung.cpp src/uhr.cpp)  # Welle 3: deck.cpp liest die Karte
# Welle 2 F10, Fehlerfall: Start aus dem Stand ohne Einblende. test_deck gegen diese Mutation muss scheitern.
test_mutation(test_deck_ein_mutation test_deck CYPHERDJ_MUTATION_DECK_OHNE_EIN src/deck.cpp src/fassung.cpp src/uhr.cpp)  # Welle 3: deck.cpp liest die Karte
# Welle 3 Task 1, Fehlerfall: Deck liest ein Frame je Sample wie bis Welle 2, das Tempo zählt nicht. test_deck_varispeed muss scheitern.
test_mutation(test_deck_varispeed_mutation test_deck_varispeed CYPHERDJ_MUTATION_DECK_VARISPEED_STARR src/deck.cpp src/fassung.cpp src/uhr.cpp)

# Keylock in Echtzeit, Task 1 (Plan 2026-10-06-keylock-echtzeit.md): Dehner. Der Stub (außerhalb von src/, Vertrag 13)
# liefert die Fabrik ohne Rubber Band; sein Test bindet NICHT dehner.cpp.
add_executable(test_dehner_stub tests/dehner_stub_pruef.cpp stub/dehner_stub.cpp)
target_include_directories(test_dehner_stub PRIVATE include tests)
add_test(NAME test_dehner_stub COMMAND test_dehner_stub)
# Fehlerfälle: Regler aus (c = 0) und Faktor am Fensteranfang statt in der Mitte (Prüfer M1); beide müssen test_dehner
# scheitern lassen (Faktor am Anfang: Tests 2, 5, 10; Regler aus: Tests 5 und 12, Ansatz in der Rampe; Task 1c; seit
# Keylock 4.6/4.6b über je Klick ±12 gegen das Soll bzw. Test 12 gegen das Ideal gleicher Klickform, nicht mehr am Mittel). Quellen:
# dehner.cpp mit librubberband, uhr.cpp für die Karte.
test_mutation(test_dehner_ohne_regler_mutation test_dehner CYPHERDJ_MUTATION_DEHNER_OHNE_REGLER
              src/dehner.cpp src/uhr.cpp PkgConfig::RUBBERBAND)
test_mutation(test_dehner_faktor_anfang_mutation test_dehner CYPHERDJ_MUTATION_DEHNER_FAKTOR_ANFANG
              src/dehner.cpp src/uhr.cpp PkgConfig::RUBBERBAND)
# Keylock Task 5b: die gehörte Quellposition je Sample in einem double (Stand Task 5): dehner_p_summe rot.
test_mutation(test_dehner_p_je_sample_mutation test_dehner CYPHERDJ_MUTATION_DEHNER_P_JE_SAMPLE
              src/dehner.cpp src/uhr.cpp PkgConfig::RUBBERBAND)
# Keylock Task 6b (W2, Plan Task 6 Abschnitt 8): Fehlerfälle des Dehner-Wechsels. Rot gemessen (task6b w2/mutation_*.txt):
# WECHSEL_ZAEHLT_NUR (Atom zählt, die Quelle bleibt): W1b, dazu W2-Grenze, W3-Kontrolle, W3b Zone 3; SPAET_ANNEHMEN (auch
# hinter p_gleich_bis angenommen): W2, W3b Zone 3; WECHSEL_ALLOKIERT (Kopie mit new im Callback): W4; UEBERSCHRIEBEN_AUS
# (Überschriebene nicht gezählt): W3b Zone 1, W4, W5. Die übrigen Tests von test_dehner bleiben dabei grün. Nur unter TSan
# sichtbar und darum nicht hier: CYPHERDJ_MUTATION_DEHNER_WECHSEL_OHNE_DREIFACH (`test_dehner wechsel_faeden 300`, W5).
test_mutation(test_dehner_wechsel_zaehlt_nur_mutation test_dehner CYPHERDJ_MUTATION_DEHNER_WECHSEL_ZAEHLT_NUR
              src/dehner.cpp src/uhr.cpp PkgConfig::RUBBERBAND)
test_mutation(test_dehner_wechsel_spaet_annehmen_mutation test_dehner CYPHERDJ_MUTATION_PLAN_WECHSEL_SPAET_ANNEHMEN
              src/dehner.cpp src/uhr.cpp PkgConfig::RUBBERBAND)
test_mutation(test_dehner_wechsel_allokiert_mutation test_dehner CYPHERDJ_MUTATION_DEHNER_WECHSEL_ALLOKIERT
              src/dehner.cpp src/uhr.cpp PkgConfig::RUBBERBAND)
test_mutation(test_dehner_wechsel_ueberschrieben_aus_mutation test_dehner CYPHERDJ_MUTATION_DEHNER_WECHSEL_UEBERSCHRIEBEN_AUS
              src/dehner.cpp src/uhr.cpp PkgConfig::RUBBERBAND)
# Fix-Runde W2 (Q1): der Vorbereiter übernimmt die gemeldete Annahme nicht, die Erneuerung setzt mit dem alten Band an: W6 rot.
test_mutation(test_dehner_erneuerung_alte_quelle_mutation test_dehner CYPHERDJ_MUTATION_DEHNER_ERNEUERUNG_ALTE_QUELLE
              src/dehner.cpp src/uhr.cpp PkgConfig::RUBBERBAND)
# Fix-Runde W2 (S1, Prüfung X3): wechsel_holen vor uebernehmen: der Auftrag für die gerade wartende Epoche verfehlt, W3 rot.
test_mutation(test_dehner_wechsel_vor_uebernehmen_mutation test_dehner CYPHERDJ_MUTATION_DEHNER_WECHSEL_VOR_UEBERNEHMEN
              src/dehner.cpp src/uhr.cpp PkgConfig::RUBBERBAND)
# Fix-Runde W2 (Q3/S5): Lücken-Formel aus be2a7ef0, zählt über den Nummern-Überlauf ein Überschreiben zu viel: W7 rot.
test_mutation(test_dehner_luecke_alt_mutation test_dehner CYPHERDJ_MUTATION_DEHNER_LUECKE_ALT
              src/dehner.cpp src/uhr.cpp PkgConfig::RUBBERBAND)
if(CYPHERDJ_BUNGEE)
  # Umbauplan Bungee S1: der Dehner mit Bungee; Fehlerfälle: Karte am Korn k+1 (Lage, Referenz), Sprung ohne reset (Referenz)
  target_link_libraries(test_dehner_bungee PRIVATE PkgConfig::RUBBERBAND)  # keylock_mess.h bindet Rubber Band ein
  # S2: der Kern mit Bungee; Fehlerfall: niemand treibt die Dehner (alle Kern-Quellen samt dehner_bungee.cpp, wie kern_keylock_faeden_mutation)
  target_link_libraries(test_kern_keylock_bungee PRIVATE PkgConfig::RUBBERBAND)
  add_executable(test_kern_keylock_bungee_kein_antrieb_mutation tests/test_kern_keylock_bungee.cpp ${KERN_QUELLEN} src/dehner_bungee.cpp)
  target_include_directories(test_kern_keylock_bungee_kein_antrieb_mutation PRIVATE include tests ${DJK}/vertrag)
  target_compile_definitions(test_kern_keylock_bungee_kein_antrieb_mutation PRIVATE CYPHERDJ_MUTATION_KEIN_ANTRIEB=1 CYPHERDJ_BUNGEE=1
                             CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_kern_keylock_bungee_kein_antrieb_mutation PRIVATE PkgConfig::JACK Threads::Threads cypherdj::toml
                        cypherdj::dsp cypherdj::stellwerk cypherdj_dsp_messer cypherdj::json PkgConfig::CRYPTO cypherdj::hand
                        PkgConfig::RUBBERBAND cypherdj::bungee)
  add_test(NAME test_kern_keylock_bungee_kein_antrieb_mutation COMMAND test_kern_keylock_bungee_kein_antrieb_mutation deck)
  set_tests_properties(test_kern_keylock_bungee_kein_antrieb_mutation PROPERTIES WILL_FAIL TRUE TIMEOUT 120)
  foreach(m BUNGEE_KORN_EINS_SPAET BUNGEE_OHNE_RESET)
    string(TOLOWER ${m} mk)
    test_mutation(test_dehner_${mk}_mutation test_dehner_bungee CYPHERDJ_MUTATION_${m}
                  src/dehner.cpp src/dehner_bungee.cpp src/uhr.cpp PkgConfig::RUBBERBAND cypherdj::bungee)
  endforeach()
endif()
kern_mutation(cypherdj-kern-mutation-drift CYPHERDJ_MUTATION_DECK_DRIFT)
# Scheibe 31, Fehlerfall der Abnahme: Deck-Start am Blockanfang statt am Sample des Ziel-Beats. test_kern_deck gegen die
# Mutation muss scheitern (Klick und Quittung 2 am Blockanfang); der Kern damit fährt start_quell_beat rot.
kern_mutation(cypherdj-kern-mutation-start CYPHERDJ_MUTATION_START_BLOCKANFANG)
test_mutation(test_kern_deck_mutation test_kern_deck CYPHERDJ_MUTATION_START_BLOCKANFANG
              src/kern.cpp src/erzeuger.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/kern_stellwerk.cpp src/kern_deck.cpp src/mixer.cpp src/beatfx.cpp src/teile.cpp src/klick.cpp
              src/tempoplan.cpp src/uhr.cpp src/deck.cpp src/lader.cpp src/fassung.cpp src/kern_hand.cpp src/hand_ein.cpp
              stub/dehner_stub.cpp)  # Keylock Task 2: Fabrik ohne Rubber Band
# Scheibe 31: Vergleichsmessung der Zykluskosten ohne JACK mit vier spielenden Decks (kein Test; die Messung im Callback
# macht tests/deck/ziel_lauf.py --art kosten).
add_executable(kern_kosten31 tests/kosten/kosten31.cpp)
target_link_libraries(kern_kosten31 PRIVATE cypherdj_kernbib)
target_compile_definitions(kern_kosten31 PRIVATE CYPHERDJ_DJK="${DJK}")
# Keylock Task 7 Step 1a (Gate G1 offline): N Dehner mit echten Arbeits-Threads und Callback-Takt, Band BoxBand (kein Test)
add_executable(kern_kosten_dehner_n tests/kosten/kosten_dehner_n.cpp)
target_link_libraries(kern_kosten_dehner_n PRIVATE cypherdj_kernbib)
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
set(KERN_QUELLEN35_OHNE_DEHNER src/kern.cpp src/erzeuger.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/kern_stellwerk.cpp src/kern_deck.cpp src/kern_hand.cpp src/hand_ein.cpp src/mixer.cpp src/beatfx.cpp
    src/teile.cpp src/klick.cpp src/tempoplan.cpp src/uhr.cpp src/deck.cpp src/lader.cpp src/fassung.cpp)
# Keylock Task 2 (Vertrag 13): kern_deck.cpp ruft die Fabrik dehner_neu; ohne Rubber Band liefert der Stub nullptr.
set(KERN_QUELLEN35 ${KERN_QUELLEN35_OHNE_DEHNER} stub/dehner_stub.cpp)
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
# Glanz 2.7 (F19), Fehlerfall: MIDI-Ströme ohne Vorhalt (Note am Sample des Beats, Surge 11,35 ms hinter dem Kit).
test_mutation(test_kern_instrument_mutation test_kern_instrument CYPHERDJ_MUTATION_MIDI_OHNE_VORHALT ${KERN_QUELLEN35})
test_mutation(test_erzeuger_midi_mutation test_erzeuger_midi CYPHERDJ_MUTATION_MIDI_OHNE_VORHALT src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
# Glanz 2.7 Prüfung R2/R3, Fehlerfall: Fenster-Ersetzen ohne gesendet_bis, ein spätes Fenster bringt schon gesendete MIDI-Noten
# doppelt (test_kern_instrument K1 2 statt 1 Note-On, K2 1024 -> 256; test_erzeuger_midi Fall 6: 14 doppelt). Seit Re-Prüfung N2
# trägt gesendet_bis den Schutz allein (das frühere MIDI-jetzt aus Sample + neuem Vorhalt ist entfernt).
test_mutation(test_kern_instrument_schutz_mutation test_kern_instrument CYPHERDJ_MUTATION_MIDI_FENSTER_OHNE_SCHUTZ ${KERN_QUELLEN35})
test_mutation(test_erzeuger_midi_schutz_mutation test_erzeuger_midi CYPHERDJ_MUTATION_MIDI_FENSTER_OHNE_SCHUTZ src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
# Re-Prüfung N1, Fehlerfall: leeren() setzt gesendet_bis nicht zurück, nach /k/set/neu schweigen die MIDI-Ströme (Fall 7: 0 statt 8).
test_mutation(test_kern_instrument_leeren_mutation test_kern_instrument CYPHERDJ_MUTATION_LEEREN_OHNE_GESENDET ${KERN_QUELLEN35})
# Prüfung R3, Fehlerfall am Quantum-Wechsel 256 -> 1024: Off am selben Sample wie das On.
test_mutation(test_kern_instrument_off_mutation test_kern_instrument CYPHERDJ_MUTATION_MIDI_OFF_AM_ON ${KERN_QUELLEN35})
test_mutation(test_erzeuger_midi_off_mutation test_erzeuger_midi CYPHERDJ_MUTATION_MIDI_OFF_AM_ON src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
# Glanz 2.7 Prüfung R5, Fehlerfall: Vorhalt fest 537 statt 2 · n + 25 (test_kern_instrument Fall 6, Quantum 128 und 512).
test_mutation(test_kern_instrument_fest_mutation test_kern_instrument CYPHERDJ_MUTATION_MIDI_VORHALT_FEST ${KERN_QUELLEN35})
# Kern für die Gegenprobe am Prüfstand (Task 2.7.2 Step 4)
kern_mutation(cypherdj-kern-mutation-midi CYPHERDJ_MUTATION_MIDI_OHNE_VORHALT)
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
# Welle 2 Prüfung 2.3 (M1), Fehlerfall: Hand-Start 5000 Samples zu spät, phasentreu. Mit der F10-Einblende zählt der Test
# ab dem zweiten Klick; das Einsatz-Sample (erstes Sample ≠ 0 am Ring) muss den späten Start trotzdem sehen.
test_mutation(test_kern_deck_hand_spaet_mutation test_kern_deck_hand CYPHERDJ_MUTATION_HAND_START_SPAET ${KERN_QUELLEN35})
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

# Keylock Task 2: Fehlerfälle gegen test_deck_keylock. Der Test fährt auch einen Kern-Neustart (Test 8, Zustandsdatei) und
# braucht darum alle Kern-Quellen samt dehner.cpp und Rubber Band.
function(deck_keylock_mutation name schalter)
  add_executable(${name} tests/test_deck_keylock.cpp ${KERN_QUELLEN})
  target_include_directories(${name} PRIVATE include tests ${DJK}/vertrag)
  target_compile_definitions(${name} PRIVATE ${schalter}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(${name} PRIVATE PkgConfig::JACK Threads::Threads cypherdj::toml cypherdj::dsp cypherdj::stellwerk
                        cypherdj_dsp_messer cypherdj::json PkgConfig::CRYPTO cypherdj::hand PkgConfig::RUBBERBAND)
  add_test(NAME ${name} COMMAND ${name})
  set_tests_properties(${name} PROPERTIES WILL_FAIL TRUE)
endfunction()
# Der Ring klingt nach dem Einschwingen sofort, ohne 960-Frame-Blende aus der Varispeed-Brücke: Test 3 keylock_bruecke rot.
deck_keylock_mutation(test_deck_keylock_ohne_bruecke_mutation CYPHERDJ_MUTATION_KEYLOCK_OHNE_BRUECKE)
# Nach dem Neustart setzt das Deck nicht an (der Ring bleibt still, Varispeed): Test 8 keylock_neustart rot.
deck_keylock_mutation(test_deck_keylock_neustart_mutation CYPHERDJ_MUTATION_KEYLOCK_NEUSTART_OHNE_ANSATZ)
# Keylock Task 2b (Prüfung): Anker 1920 Frames daneben (40 ms, ganze Perioden des 1-kHz-Sinus): Test 2, 3, 6, 8 rot.
deck_keylock_mutation(test_deck_keylock_anker_mutation CYPHERDJ_MUTATION_KEYLOCK_ANKER_DANEBEN)
# Ereignis in einer laufenden Keylock-Blende bricht sie hart ab (Stand Task 2): Test 15 rot.
deck_keylock_mutation(test_deck_keylock_blende_hart_mutation CYPHERDJ_MUTATION_KEYLOCK_BLENDE_HART)
# Kein Blick voraus auf den Ring, er reißt hart (Stand Task 2): Test 12 rot.
deck_keylock_mutation(test_deck_keylock_unterlauf_hart_mutation CYPHERDJ_MUTATION_KEYLOCK_UNTERLAUF_HART)
# Das Eingefrorene ohne Stopp-Rampe (Stand Task 2): Test 16 rot.
deck_keylock_mutation(test_deck_keylock_alt_ohne_stopp_mutation CYPHERDJ_MUTATION_KEYLOCK_ALT_OHNE_STOPP)
# Laden, Tausch und Entladen warten nie auf Platz in der Rückgabeliste (Stand Task 2): Test 17 rot.
deck_keylock_mutation(test_deck_keylock_rueck_mutation CYPHERDJ_MUTATION_KEYLOCK_RUECK_OHNE_WARTEN)
# Füllschleife des Dehners ohne Obergrenze bzw. ohne Abbruch bei wartendem Ansatz: je Test 13 rot (13b bzw. 13a).
deck_keylock_mutation(test_deck_keylock_fuellen_grenze_mutation CYPHERDJ_MUTATION_DEHNER_FUELLEN_OHNE_GRENZE)
# Keylock Task 7 (Detailschnitt 7a Abschnitt 7): Fehlerfälle gegen test_loopbox_keylock, je Ziel nur der betroffene Test
# (Argument). Gegenprobe, dass die übrigen grün bleiben: jedes Mutationsziel über alle Tests (task-07/step5_mutationen.txt).
function(box_keylock_mutation name schalter test)
  add_executable(${name} tests/test_loopbox_keylock.cpp ${KERN_QUELLEN})
  target_include_directories(${name} PRIVATE include tests ${DJK}/vertrag)
  target_compile_definitions(${name} PRIVATE ${schalter}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(${name} PRIVATE PkgConfig::JACK Threads::Threads cypherdj::toml cypherdj::dsp cypherdj::stellwerk
                        cypherdj_dsp_messer cypherdj::json PkgConfig::CRYPTO cypherdj::hand PkgConfig::RUBBERBAND)
  add_test(NAME ${name} COMMAND ${name} ${test})
  set_tests_properties(${name} PROPERTIES WILL_FAIL TRUE TIMEOUT 300)
endfunction()
box_keylock_mutation(test_box_keylock_band_ohne_wickeln_mutation CYPHERDJ_MUTATION_BOX_BAND_OHNE_WICKELN naht_wickeln)
box_keylock_mutation(test_box_keylock_anker_ohne_versatz_mutation CYPHERDJ_MUTATION_BOX_ANKER_OHNE_VERSATZ lage)
box_keylock_mutation(test_box_keylock_start_mit_bruecke_mutation CYPHERDJ_MUTATION_BOX_START_MIT_BRUECKE einsatz_aus_stille)
box_keylock_mutation(test_box_keylock_ohne_vorlauf_mutation CYPHERDJ_MUTATION_BOX_OHNE_VORLAUF einsatz_aus_stille)
box_keylock_mutation(test_box_keylock_leihe_ohne_warten_mutation CYPHERDJ_MUTATION_BOX_LEIHE_OHNE_WARTEN leihe_voll)
box_keylock_mutation(test_box_keylock_laden_direkt_mutation CYPHERDJ_MUTATION_BOX_LADEN_DIREKT laden_leihe)
box_keylock_mutation(test_box_keylock_einfrieren_ohne_vari_mutation CYPHERDJ_MUTATION_BOX_EINFRIEREN_OHNE_VARI einfrieren_in_bruecke)
box_keylock_mutation(test_box_keylock_spaet_ohne_ansatz_mutation CYPHERDJ_MUTATION_BOX_SPAET_OHNE_ANSATZ dehner_spaet)
box_keylock_mutation(test_box_keylock_schwanz_vari_mutation CYPHERDJ_MUTATION_BOX_SCHWANZ_VARI set_neu_schwanz)
box_keylock_mutation(test_box_keylock_laden_linear_mutation CYPHERDJ_MUTATION_BOX_LADEN_LINEAR laden_klingend)
box_keylock_mutation(test_box_keylock_aus_ignoriert_mutation CYPHERDJ_MUTATION_BOX_KEYLOCK_AUS_IGNORIERT aus_ist_varispeed)
box_keylock_mutation(test_box_keylock_basis_ring_hoerbar_mutation CYPHERDJ_MUTATION_BOX_BASIS_RING_HOERBAR basis_bitgleich)
box_keylock_mutation(test_box_keylock_karte_fremd_mutation CYPHERDJ_MUTATION_BOX_KARTE_FREMD allokation)
# Keylock 7b.1: auf der Basis blendet ein klingender Ring linear in den Direktweg (Stand Task 7, Teilauslöschung): T10 rot.
box_keylock_mutation(test_box_keylock_basis_wechsel_mutation CYPHERDJ_MUTATION_KEYLOCK_BASIS_WECHSEL rampe_tonhoehe)
# Keylock 7b.2: Start aus Stille ohne Vorlage (Stand Task 7: Box öffnet erst bei E, Kanten-Einblende, Band ohne Stille): T4a rot.
box_keylock_mutation(test_box_keylock_start_ohne_vorlage_mutation CYPHERDJ_MUTATION_BOX_START_OHNE_VORLAGE einsatz_aus_stille)
# Keylock 7b.7: Bandstart 8 Frames daneben -> T5 lage rot bei jedem Tempo (Grenze ±2 gegen gleich gespeistes rohes R3).
box_keylock_mutation(test_box_keylock_bandstart_8_mutation CYPHERDJ_MUTATION_DEHNER_BANDSTART_8 lage)
# Keylock 7c.1: Einsatz vor s_h + 1408 (Rampe in der Wartezeit), Start aus Stille bleibt gesetzt (Stand 7b): T4d rot.
box_keylock_mutation(test_box_keylock_still_nach_umziel_mutation CYPHERDJ_MUTATION_BOX_STILL_NACH_UMZIEL einsatz_aus_stille)
# Keylock 7c.2: Ereignis in der Vorlage schaltet den Ring hart ab (Stand 7b): T18 rot.
box_keylock_mutation(test_box_keylock_vorlage_stumm_mutation CYPHERDJ_MUTATION_BOX_VORLAGE_STUMM ereignis_in_vorlage)
# Keylock 7c.3: Raster in der wartenden Box nimmt einen neuen Platz der Leihe (Stand 7b): T14b rot.
box_keylock_mutation(test_box_keylock_raster_neuer_platz_mutation CYPHERDJ_MUTATION_BOX_RASTER_NEUER_PLATZ raster_wartend)
# Keylock 7c.4: Knopf aus auf der Basis friert ein (Stand 7b) bzw. die Blende in den Direktweg ist linear: T19 rot.
box_keylock_mutation(test_box_keylock_aus_basis_einfrieren_mutation CYPHERDJ_MUTATION_KEYLOCK_AUS_BASIS_EINFRIEREN basis_knopf_blende)
box_keylock_mutation(test_box_keylock_basis_linear_mutation CYPHERDJ_MUTATION_KEYLOCK_BASIS_LINEAR basis_knopf_blende)
# Keylock 7b.3: /zustand/box mit vertauschten Zählern -> test_kern_box_keylock k4 rot.
add_executable(test_kern_box_keylock_zaehler_mutation tests/test_kern_box_keylock.cpp ${KERN_QUELLEN})
target_include_directories(test_kern_box_keylock_zaehler_mutation PRIVATE include tests ${DJK}/vertrag)
target_compile_definitions(test_kern_box_keylock_zaehler_mutation PRIVATE CYPHERDJ_MUTATION_BOX_ZAEHLER_VERTAUSCHT=1
                           CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_kern_box_keylock_zaehler_mutation PRIVATE PkgConfig::JACK Threads::Threads cypherdj::toml
                      cypherdj::dsp cypherdj::stellwerk cypherdj_dsp_messer cypherdj::json PkgConfig::CRYPTO cypherdj::hand
                      PkgConfig::RUBBERBAND)
add_test(NAME test_kern_box_keylock_zaehler_mutation COMMAND test_kern_box_keylock_zaehler_mutation k4)
set_tests_properties(test_kern_box_keylock_zaehler_mutation PROPERTIES WILL_FAIL TRUE TIMEOUT 300)
# Keylock Task 2.5: Fehlerfälle gegen test_kern_keylock_faeden (Kern mit echten Fäden, alle Kern-Quellen samt dehner.cpp).
# Je Ziel nur der betroffene Test (Argument), damit der rote Lauf nicht die übrigen mitfährt.
function(kern_keylock_faeden_mutation name schalter test)
  add_executable(${name} tests/test_kern_keylock_faeden.cpp ${KERN_QUELLEN})
  target_include_directories(${name} PRIVATE include tests ${DJK}/vertrag)
  target_compile_definitions(${name} PRIVATE ${schalter}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(${name} PRIVATE PkgConfig::JACK Threads::Threads cypherdj::toml cypherdj::dsp cypherdj::stellwerk
                        cypherdj_dsp_messer cypherdj::json PkgConfig::CRYPTO cypherdj::hand PkgConfig::RUBBERBAND)
  add_test(NAME ${name} COMMAND ${name} ${test})
  set_tests_properties(${name} PROPERTIES WILL_FAIL TRUE TIMEOUT 120)
endfunction()
# Pflicht aus der Nachprüfung (N3) verletzt: der Arbeits-Thread füllt nur bei spielendem Deck -> quittung rot.
kern_keylock_faeden_mutation(test_kern_keylock_faeden_nur_laufend_mutation CYPHERDJ_MUTATION_KEYLOCK_FUELLE_NUR_LAUFEND quittung)
# Ohne Wächter -> waechter rot; Arbeits-Thread von Deck 1 hält nach rund 1 s an -> waechter rot (Meldung im gesunden Teil).
kern_keylock_faeden_mutation(test_kern_keylock_faeden_ohne_waechter_mutation CYPHERDJ_MUTATION_KEYLOCK_OHNE_WAECHTER waechter)
kern_keylock_faeden_mutation(test_kern_keylock_faeden_haelt_mutation CYPHERDJ_MUTATION_KEYLOCK_FADEN_HAELT waechter)
# Herunterfahren ohne Wecken und ohne Frist im Warten: hängt -> stopp rot (Frist 2 s im Test).
kern_keylock_faeden_mutation(test_kern_keylock_faeden_stopp_mutation CYPHERDJ_MUTATION_KEYLOCK_STOPP_OHNE_WECKEN stopp)
# Scheitern von SCHED_FIFO verschluckt -> prio rot.
kern_keylock_faeden_mutation(test_kern_keylock_faeden_prio_mutation CYPHERDJ_MUTATION_KEYLOCK_PRIO_STILL prio)
# Task 2.5b: Dehner gestellt, obwohl die Fäden nicht anlegbar waren (Stand 2.5) -> startfehler rot; spätes Anhängen ohne
# Ansatz für ein laufendes Deck -> spaet rot.
kern_keylock_faeden_mutation(test_kern_keylock_faeden_vorgabe_mutation CYPHERDJ_MUTATION_KEYLOCK_VORGABE_VOR_FAEDEN startfehler)
kern_keylock_faeden_mutation(test_kern_keylock_faeden_spaet_mutation CYPHERDJ_MUTATION_KEYLOCK_SPAET_OHNE_ANSATZ spaet)
# Keylock Task 3: der Regler keylock erreicht die Decks nicht (nur die Boxen) bzw. die Boxen nicht (nur die Decks) -> knopf rot.
kern_keylock_faeden_mutation(test_kern_keylock_faeden_knopf_decks_mutation CYPHERDJ_MUTATION_KEYLOCK_KNOPF_NUR_BOXEN knopf)
kern_keylock_faeden_mutation(test_kern_keylock_faeden_knopf_boxen_mutation CYPHERDJ_MUTATION_KEYLOCK_KNOPF_OHNE_BOXEN knopf)
# Keylock Task 5: im Loop die Leer-Epoche (Stand vor Task 5) -> loop rot (Varispeed, Ring nicht hörbar).
kern_keylock_faeden_mutation(test_kern_keylock_faeden_loop_leer_mutation CYPHERDJ_MUTATION_KEYLOCK_LOOP_LEER loop)
# Keylock Task 3b (Prüfung MINOR 2): das späte Anhängen übersieht einen Knopf, der schon aus steht -> knopf_spaet rot.
kern_keylock_faeden_mutation(test_kern_keylock_faeden_knopf_spaet_mutation CYPHERDJ_MUTATION_KEYLOCK_UEBERNEHMEN_OHNE_KNOPF knopf_spaet)
# Keylock Task 3b (Prüfung MINOR 3): Zähler im DECK-Ereignis vertauscht -> zaehler rot.
kern_keylock_faeden_mutation(test_kern_keylock_faeden_zaehler_mutation CYPHERDJ_MUTATION_KEYLOCK_ZAEHLER_VERTAUSCHT zaehler)
deck_keylock_mutation(test_deck_keylock_fuellen_abbruch_mutation CYPHERDJ_MUTATION_DEHNER_FUELLEN_OHNE_ABBRUCH)
# Keylock Task 2c: Einschwingen wieder 768 (nur am Sinus gemessen): Test 14 rot.
deck_keylock_mutation(test_deck_keylock_einschwing_768_mutation CYPHERDJ_MUTATION_KEYLOCK_EINSCHWING_768)
# Keylock Task 2d: Einfrieren ohne Stopp-Gain (N1): Test 20 rot; ohne Mindestlänge 128 (Vertrag 8): Test 19 rot;
# zweites Entladen ohne Quittung 7 für das erste (N2): Test 17 rot.
deck_keylock_mutation(test_deck_keylock_einfrieren_stopp_mutation CYPHERDJ_MUTATION_KEYLOCK_EINFRIEREN_OHNE_STOPP)
deck_keylock_mutation(test_deck_keylock_alt_min_mutation CYPHERDJ_MUTATION_KEYLOCK_ALT_OHNE_MIN)
deck_keylock_mutation(test_deck_keylock_entladen_still_mutation CYPHERDJ_MUTATION_KEYLOCK_ENTLADEN_STILL)
# Keylock Task 5 (Loop auf dem Deck): im Loop die Leer-Epoche wie vor Task 5 (Varispeed): Test 23 bis 27 rot; das Band wickelt
# hart ohne die 128-Frame-Blende des Direktwegs: Test 28 rot; das Band wickelt nicht: Test 23, 24, 26, 28 rot.
deck_keylock_mutation(test_deck_keylock_loop_leer_mutation CYPHERDJ_MUTATION_KEYLOCK_LOOP_LEER)
deck_keylock_mutation(test_deck_keylock_loop_naht_hart_mutation CYPHERDJ_MUTATION_KEYLOCK_LOOP_NAHT_HART)
deck_keylock_mutation(test_deck_keylock_loop_ohne_wickeln_mutation CYPHERDJ_MUTATION_KEYLOCK_LOOP_OHNE_WICKELN)
# Keylock Task 5b: Raster beendet den Loop erst nach dem Ansatz (Stand Task 5): Test 29 rot; Varispeed-Naht wickelt auf das
# gerundete Frame (Stand vor 5b): Test 30 rot. LOOP_NAHT_HART macht seit 5b auch Test 31 rot (Naht im Ring, Rauschen).
deck_keylock_mutation(test_deck_keylock_raster_loop_mutation CYPHERDJ_MUTATION_KEYLOCK_RASTER_LOOP_NACH_ANSATZ)
deck_keylock_mutation(test_deck_keylock_naht_rundet_mutation CYPHERDJ_MUTATION_DECK_NAHT_RUNDET)
# Loop-Drift (08.10.): Fehlerfall alte Rundung, jeder Durchlauf die feste Länge round(L_beats · fpb) in Deck und Band;
# test_deck_keylock Test 33 (loop_beatraster) rot.
deck_keylock_mutation(test_deck_keylock_loop_rundung_mutation CYPHERDJ_MUTATION_LOOP_RUNDUNG_FEST)
# Loop-Drift Prüfung 08.10.: F4 Anker ohne Wicklung -> Test 35 rot; F3 Tausch ohne Umrechnung der Länge -> Test 36 rot
deck_keylock_mutation(test_deck_keylock_anker_ohne_wickel_mutation CYPHERDJ_MUTATION_KEYLOCK_ANKER_OHNE_WICKEL)
deck_keylock_mutation(test_deck_keylock_tausch_ohne_lx_mutation CYPHERDJ_MUTATION_TAUSCH_OHNE_LX)
# F1 Durchlauf bleibt beim Kopf vor dem Loop-Anfang (Stand 8ca44597) -> Test 35 rot
deck_keylock_mutation(test_deck_keylock_loop_kopf_mutation CYPHERDJ_MUTATION_LOOP_KOPF_OHNE_DURCHLAUF)
# F2 /k/deck/loop ohne exakte Länge, F5 Grenzprüfung mit round statt ceil: test_kern_loop_drift rot
test_mutation(test_kern_loop_drift_ohne_lx_mutation test_kern_loop_drift CYPHERDJ_MUTATION_KERN_LOOP_OHNE_LX ${KERN_QUELLEN35})
test_mutation(test_kern_loop_drift_grenze_mutation test_kern_loop_drift CYPHERDJ_MUTATION_KERN_LOOP_GRENZE_LF ${KERN_QUELLEN35})
# Keylock 7b.1: dasselbe am Deck (Stand Task 7): Test 32 rot.
deck_keylock_mutation(test_deck_keylock_basis_wechsel_mutation CYPHERDJ_MUTATION_KEYLOCK_BASIS_WECHSEL)
# Keylock 7c.4: Knopf aus auf der Basis friert ein bzw. lineare Blende in den Direktweg (Stand 7b): Test 32 rot.
deck_keylock_mutation(test_deck_keylock_aus_basis_einfrieren_mutation CYPHERDJ_MUTATION_KEYLOCK_AUS_BASIS_EINFRIEREN)
deck_keylock_mutation(test_deck_keylock_basis_linear_mutation CYPHERDJ_MUTATION_KEYLOCK_BASIS_LINEAR)
# Keylock Task 6a (Detailschnitt 6a, Abschnitt 8): Fehlerfälle gegen test_deck_geplant, je Ziel nur der betroffene Test (Argument).
function(deck_geplant_mutation name schalter test)
  add_executable(${name} tests/test_deck_geplant.cpp ${KERN_QUELLEN})
  target_include_directories(${name} PRIVATE include tests ${DJK}/vertrag)
  target_compile_definitions(${name} PRIVATE ${schalter}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(${name} PRIVATE PkgConfig::JACK Threads::Threads cypherdj::toml cypherdj::dsp cypherdj::stellwerk
                        cypherdj_dsp_messer cypherdj::json PkgConfig::CRYPTO cypherdj::hand PkgConfig::RUBBERBAND)
  add_test(NAME ${name} COMMAND ${name} ${test})
  set_tests_properties(${name} PROPERTIES WILL_FAIL TRUE TIMEOUT 300)
endfunction()
# 6a-1: das herausgelöste deck_lies ohne die Naht-Blende (bestehender Schalter): die Prüfsummen des Stands vorher sehen es.
deck_geplant_mutation(test_deck_geplant_naht_hart_mutation CYPHERDJ_MUTATION_KEYLOCK_LOOP_NAHT_HART band_bitgleich)
# 6a-2/6a-3 (Detailschnitt 6a, Abschnitt 3.8 und 8): je Schalter genau sein Test rot (Gegenprobe über alle Tests: Ablage 6a).
# Stand vor 6a (kein Plan, jeder Start über die Brücke): P4a und der Kern-Weg K6a rot.
deck_geplant_mutation(test_deck_geplant_start_aus_mutation CYPHERDJ_MUTATION_PLAN_START_AUS start_stand)
deck_geplant_mutation(test_deck_geplant_kern_start_aus_mutation CYPHERDJ_MUTATION_PLAN_START_AUS kern)
# Am Ziel trotz Plan neuer Ansatz (Brücke): P4a rot.
deck_geplant_mutation(test_deck_geplant_ausfuehrung_friert_mutation CYPHERDJ_MUTATION_PLAN_AUSFUEHRUNG_FRIERT start_stand)
# s_h = n0 + ANSATZ_FRIST, kein Start aus Stille, keine Vorlage: P4a rot.
deck_geplant_mutation(test_deck_geplant_ohne_vorlage_mutation CYPHERDJ_MUTATION_PLAN_START_OHNE_VORLAGE start_stand)
# 3.8 Punkt 1: Einblende über den schon klingenden Ring (Kerbe): P4b rot.
deck_geplant_mutation(test_deck_geplant_mit_ein_mutation CYPHERDJ_MUTATION_PLAN_START_MIT_EIN ohne_kerbe)
# 3.8 Punkt 2 (7c.1): aus_stille(false) nach dem Umzug des Einsatzes fehlt: P4c rot.
deck_geplant_mutation(test_deck_geplant_still_umziel_mutation CYPHERDJ_MUTATION_PLAN_START_STILL_NACH_UMZIEL rampe_wartezeit)
# 3.8 Punkt 3 (7c.2): Ereignis in der Vorlage schaltet hart stumm: P4d rot.
deck_geplant_mutation(test_deck_geplant_vorlage_stumm_mutation CYPHERDJ_MUTATION_PLAN_VORLAGE_STUMM ereignis_in_vorlage)
# 3.8 Punkt 4 (7c.3): Neuanker im wartenden Deck nimmt einen neuen Platz: P4e rot.
deck_geplant_mutation(test_deck_geplant_raster_platz_mutation CYPHERDJ_MUTATION_PLAN_RASTER_NEUER_PLATZ raster_wartend)
# 2.3 Punkt 2: der Planer ignoriert die Basis: Negativ-Kontrolle a (Basis bitgleich) rot.
deck_geplant_mutation(test_deck_geplant_basis_planen_mutation CYPHERDJ_MUTATION_PLAN_BASIS_PLANEN negativ)
# 6a Fix-Runde 1: je Fund ein Schalter, der seinen Test rot macht.
# F1/Q1 offener LEER-Auftrag nimmt den eben gebauten Plan zurück (Stand 9f78da53): stopp_dann_plan rot.
deck_geplant_mutation(test_deck_geplant_leer_nimmt_plan_mutation CYPHERDJ_MUTATION_PLAN_LEER_NIMMT_PLAN stopp_dann_plan)
# Q2 volle 960er Ausblende beim Verwerfen (der Einsatz klingt darin): kern_abbruch rot.
deck_geplant_mutation(test_deck_geplant_vorlage_voll_mutation CYPHERDJ_MUTATION_PLAN_VORLAGE_VOLL kern_abbruch)
# Q3 deck_planen verwirft den Plan einer gestrichenen Aktion nicht: kern_abbruch rot.
deck_geplant_mutation(test_deck_geplant_kern_ohne_verwerfen_mutation CYPHERDJ_MUTATION_PLAN_KERN_OHNE_VERWERFEN kern_abbruch)
# Q3 kein Selbstfall am Ziel (Aktion am Ziel nicht ausgeführt): ziel_ohne_start rot.
deck_geplant_mutation(test_deck_geplant_ohne_selbstfall_mutation CYPHERDJ_MUTATION_PLAN_OHNE_SELBSTFALL ziel_ohne_start)
# F3 kein früher Ansatz unter dem vollen Vorlauf (Stand 9f78da53, volle Brücke): fruehansatz rot.
deck_geplant_mutation(test_deck_geplant_ohne_fruehansatz_mutation CYPHERDJ_MUTATION_PLAN_OHNE_FRUEHANSATZ fruehansatz)
# F4 keine Untergrenze des Faktors (52 BPM wird geplant): geplant_negativ rot.
deck_geplant_mutation(test_deck_geplant_ohne_f_min_mutation CYPHERDJ_MUTATION_PLAN_OHNE_F_MIN negativ)
# Q2 Gegenprobe zum Vorschlag der Prüfung: Ausblende min(960, s_t − s) lässt bei 60 BPM den Einsatz im Ring (Klickmitte E − 326):
# kern_abbruch rot. Darum DECK_VORLAGE_AUS = 128.
deck_geplant_mutation(test_deck_geplant_vorlage_bis_einsatz_probe CYPHERDJ_PROBE_VORLAGE_BIS_EINSATZ kern_abbruch)
# 6a Fix-Runde 2: je Fund ein Schalter, der seinen Test rot macht.
# F3-R1 still mit verkürzter Vorlage (Regel von e0968ef9, wie die Box): band_scan rot.
deck_geplant_mutation(test_deck_geplant_still_kurze_vorlage_mutation CYPHERDJ_MUTATION_PLAN_STILL_KURZE_VORLAGE band_scan)
# Q2-1 der Plan fällt bei der Stopp-Taste erst am Ziel (deck_planen ohne ki_gestoppt): kern_hand_stopp rot.
deck_geplant_mutation(test_deck_geplant_ki_stopp_spaet_mutation CYPHERDJ_MUTATION_PLAN_KI_STOPP_SPAET kern_hand_stopp)
# Doppel-1 Knopf aus in der Vorlage mit 960er Ausblende: knopf_vorlage rot.
deck_geplant_mutation(test_deck_geplant_knopf_voll_mutation CYPHERDJ_MUTATION_PLAN_KNOPF_VOLL knopf_vorlage)
# Q2-R1 die Restzone wird breiter (volle 960er Ausblende beim Verwerfen): restzone rot.
deck_geplant_mutation(test_deck_geplant_restzone_voll_mutation CYPHERDJ_MUTATION_PLAN_VORLAGE_VOLL restzone)
# Keylock 6a Fix-Runde 2 an der Box: Start aus Stille auch mit verkürzter Vorlage (Stand 4c275c66): T20 band_scan rot.
box_keylock_mutation(test_box_keylock_still_kurze_vorlage_mutation CYPHERDJ_MUTATION_BOX_STILL_KURZE_VORLAGE band_scan)
# Keylock 6b W3 (Plan Task 6, 3.6): Prüfbau mit Generationszähler der Leihe (CYPHERDJ_PRUEF_GEN), je Ziel ein Test (Argument).
# Weitere Schalter nach dem Test (Mutationen); WILL_FAIL setzt der Aufrufer.
function(deck_geplant_pruef name test)
  add_executable(${name} tests/test_deck_geplant.cpp ${KERN_QUELLEN})
  target_include_directories(${name} PRIVATE include tests ${DJK}/vertrag)
  target_compile_definitions(${name} PRIVATE CYPHERDJ_PRUEF_GEN=1 CYPHERDJ_DJK="${DJK}")
  foreach(sch ${ARGN})
    target_compile_definitions(${name} PRIVATE ${sch}=1)
  endforeach()
  target_link_libraries(${name} PRIVATE PkgConfig::JACK Threads::Threads cypherdj::toml cypherdj::dsp cypherdj::stellwerk
                        cypherdj_dsp_messer cypherdj::json PkgConfig::CRYPTO cypherdj::hand PkgConfig::RUBBERBAND)
  add_test(NAME ${name} COMMAND ${name} ${test})
  set_tests_properties(${name} PROPERTIES TIMEOUT 600)
endfunction()
# Step 5: Generationszähler am Platz (leihe_gen grün nur im Prüfbau, sonst übersprungen).
deck_geplant_pruef(test_deck_geplant_pruef_gen leihe_gen)
# Step 5: der zweite Freigabeweg ohne Wirkung (abgelöstes Band erst mit der nächsten Epoche frei): leihe_wechsel rot.
deck_geplant_mutation(test_deck_geplant_leihe_alt_bleibt_mutation CYPHERDJ_MUTATION_PLAN_LEIHE_ALT_BLEIBT leihe_wechsel)
# Keylock 6b W3 Step 6 (Plan Task 6, Abschnitt 8): je Schalter sein Test rot (Gegenprobe der übrigen: Ablage w3/step6).
# Am Ziel trotz Plan der heutige Weg (Brücke): P1 rot.
deck_geplant_mutation(test_deck_geplant_w_ausfuehrung_friert_mutation CYPHERDJ_MUTATION_PLAN_AUSFUEHRUNG_FRIERT sprung_sinus)
# Kein Sprung im Band (off_neu = off): P1m und P3 rot (P1 bleibt grün, Blindheit von P1).
deck_geplant_mutation(test_deck_geplant_ohne_sprung_mutation CYPHERDJ_MUTATION_PLAN_OHNE_SPRUNG sprung_marke)
deck_geplant_mutation(test_deck_geplant_ohne_sprung_klick_mutation CYPHERDJ_MUTATION_PLAN_OHNE_SPRUNG hotcue_klick)
# Harter Schnitt (x = 0): P2 rot über den Rest-RMS.
deck_geplant_mutation(test_deck_geplant_ohne_blende_mutation CYPHERDJ_MUTATION_PLAN_OHNE_BLENDE sprung_gegenphase)
# p_sw aus dem Ziel-Sample (linear mit dem Tempo beim Planen): P9 rot.
deck_geplant_mutation(test_deck_geplant_p_sw_sample_mutation CYPHERDJ_MUTATION_PLAN_P_SW_AUS_SAMPLE karte_neu)
# kl_plan_traegt prüft f_neu, Loop und Anfrage nicht: P17 rot.
deck_geplant_mutation(test_deck_geplant_ohne_pruefung_mutation CYPHERDJ_MUTATION_PLAN_OHNE_PRUEFUNG ziel_weicht_ab)
# Abbruch verwirft den Plan nicht bzw. friert immer ein (kein Gegenwechsel): P8 rot.
deck_geplant_mutation(test_deck_geplant_abbruch_ignoriert_mutation CYPHERDJ_MUTATION_PLAN_ABBRUCH_IGNORIERT abbruch_spaet)
deck_geplant_mutation(test_deck_geplant_rueckwechsel_aus_mutation CYPHERDJ_MUTATION_PLAN_RUECKWECHSEL_AUS abbruch_spaet)
# Abgelöstes Band erst mit der nächsten Epoche frei: P13 rot (die Leihe läuft voll).
deck_geplant_mutation(test_deck_geplant_leihe_alt_bleibt_folge_mutation CYPHERDJ_MUTATION_PLAN_LEIHE_ALT_BLEIBT folge)
# plan_uebernehmen setzt einen anderen Anker: P3u (Unterlauf nach dem Ziel) rot.
deck_geplant_mutation(test_deck_geplant_anker_alt_mutation CYPHERDJ_MUTATION_PLAN_ANKER_ALT hotcue_klick)
# Kein Plan für Loop an: P5 rot.
deck_geplant_mutation(test_deck_geplant_loop_leer_plan_mutation CYPHERDJ_MUTATION_PLAN_LOOP_LEER loop_an)
# Lebensdauer (3.6) im Prüfbau: P20 grün; Altband mit der Annahme frei (Entwurf): P20 rot.
deck_geplant_pruef(test_deck_geplant_pruef_platz platz_generation)
deck_geplant_pruef(test_deck_geplant_pruef_frueh_frei_mutation platz_generation CYPHERDJ_MUTATION_PLAN_LEIHE_FRUEH_FREI)
set_tests_properties(test_deck_geplant_pruef_frueh_frei_mutation PROPERTIES WILL_FAIL TRUE)
# Fund aus P20: ein veralteter Eintrag des zweiten Freigabewegs gibt einen neu verliehenen Platz frei: frei_veraltet rot.
deck_geplant_mutation(test_deck_geplant_frei_veraltet_mutation CYPHERDJ_MUTATION_PLAN_FREI_VERALTET frei_veraltet)
# Gemessen 09.10.: P20 im Prüfbau sieht den Fund FREI_VERALTET nicht (gen 0, Leser 0: reihum vergebene Plätze machen den Ablauf selten);
# ihn trägt der deterministische Test frei_veraltet (test_deck_geplant_frei_veraltet_mutation), kein Prüfbau-Ziel dafür.
# Fund aus P20: ein wieder genommener Platz trägt die Wechsel-Felder seines alten PlanBands: platz_wieder rot.
deck_geplant_mutation(test_deck_geplant_platz_alt_mutation CYPHERDJ_MUTATION_PLAN_PLATZ_ALT platz_wieder)
deck_geplant_pruef(test_deck_geplant_pruef_platz_alt_mutation platz_generation CYPHERDJ_MUTATION_PLAN_PLATZ_ALT)
set_tests_properties(test_deck_geplant_pruef_platz_alt_mutation PROPERTIES WILL_FAIL TRUE)
# Fund aus P20: geplanter Sprung vor den Materialanfang, das Deck behielt den alten Kopf: sprung_vor_anfang rot.
deck_geplant_mutation(test_deck_geplant_kopf_negativ_mutation CYPHERDJ_MUTATION_PLAN_KOPF_NEGATIV sprung_vor_anfang)
# Fix-Runde W3 S1: ein Ereignis kurz vor dem Ziel eines angenommenen Plans schaltet den Ring hart stumm (Stand 37fc3db4): ereignis_fenster rot.
deck_geplant_mutation(test_deck_geplant_ereignis_stumm_mutation CYPHERDJ_MUTATION_PLAN_EREIGNIS_STUMM ereignis_fenster)
# Fix-Runde W3 S4: Prüfbau vergibt die Plätze wie der Betrieb (erster freier); dazu die Variante reihum (CYPHERDJ_PRUEF_REIHUM), in der ein
# freigegebener Platz länger frei bleibt. P20x (Ereignisse im Planfenster) in beiden.
deck_geplant_pruef(test_deck_geplant_pruef_platz_reihum platz_generation CYPHERDJ_PRUEF_REIHUM)
deck_geplant_pruef(test_deck_geplant_pruef_fenster platz_fenster)
deck_geplant_pruef(test_deck_geplant_pruef_fenster_reihum platz_fenster CYPHERDJ_PRUEF_REIHUM)
deck_geplant_pruef(test_deck_geplant_pruef_frueh_frei_reihum_mutation platz_generation CYPHERDJ_PRUEF_REIHUM CYPHERDJ_MUTATION_PLAN_LEIHE_FRUEH_FREI)
set_tests_properties(test_deck_geplant_pruef_frueh_frei_reihum_mutation PROPERTIES WILL_FAIL TRUE)
# Leckprüfung P20 (S4b): das abgelöste Band bleibt bis zur nächsten Epoche, die Leihe läuft voll: P20 rot.
deck_geplant_mutation(test_deck_geplant_leihe_alt_bleibt_p20_mutation CYPHERDJ_MUTATION_PLAN_LEIHE_ALT_BLEIBT platz_generation)
