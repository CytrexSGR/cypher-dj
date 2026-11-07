# djk/kern: der Echtzeit-Kern. Nur Strang A schreibt hier, eine Scheibe zugleich (ROADMAP §8.2).
# Quellen und Tests werden eingesammelt (CONFIGURE_DEPENDS): neue Dateien unter src/ und tests/test_*.cpp kommen beim
# nächsten Bau ohne Änderung dieser Datei hinzu. src/main.cpp ist das Programm, alles andere unter src/ die Bibliothek.
# Scheibe 08: Fremdquellen aus djk/third_party (toml++, nlohmann/json), Vertrag aus djk/vertrag (osc_adressen.h),
# Mutationen für die Fehlerfälle der Abnahme, ThreadSanitizer-Bau für den Befehlsring.
# Mutation programs share the objects their switch does not touch: see cmake/README.md and cmake/mutation_geteilt.cmake.
cmake_minimum_required(VERSION 3.28)
project(cypherdj_kern LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()
# ccache is used as compiler launcher when it is installed; never required (not found: plain compiler). Switch off with
# -DCYPHERDJ_CCACHE=OFF. The shared build of the mutation targets (cmake/README.md) works with and without it.
option(CYPHERDJ_CCACHE "Use ccache as compiler launcher when found" ON)
if(CYPHERDJ_CCACHE AND NOT CMAKE_CXX_COMPILER_LAUNCHER)
  find_program(CCACHE_PROGRAM ccache)
  if(CCACHE_PROGRAM)
    set(CMAKE_CXX_COMPILER_LAUNCHER ${CCACHE_PROGRAM})
    set(CMAKE_C_COMPILER_LAUNCHER ${CCACHE_PROGRAM})
    message(STATUS "ccache: ${CCACHE_PROGRAM}")
  endif()
endif()
option(CYPHERDJ_SANITIZE "ASan und UBSan (ADR 002)" OFF)
# Bungee (MPL-2.0) als zweite Keylock-Maschine neben R3 (Umbauplan 2026-10-09-bungee-umbau, S0). Aus: kein Bungee gebaut,
# keylock_maschine = "bungee" liefert dann keinen Dehner (Keylock aus), R3 unverändert.
# Paket 1.13 Warp, Slice 2: Bungee ist Pflicht im Betriebs-Bau (Vorgabe ON): das Warp-Werk rechnet COMPLEX und TONES damit. Ein Bau mit OFF lädt
# keine Wiedergabe mit diesen Modi (Grund warp_maschine_fehlt), statt sie still als RE-PITCH zu spielen.
option(CYPHERDJ_BUNGEE "Bungee als Keylock-Maschine und Warp-Maschine (djk/third_party/bungee)" ON)
option(CYPHERDJ_TSAN "ThreadSanitizer für den Befehlsring (Scheibe 08)" OFF)
option(CYPHERDJ_MUTATION_RING_RELAXED "Fehlerfall: Ring ohne Release/Acquire (nur mit CYPHERDJ_TSAN)" OFF)
if(CYPHERDJ_SANITIZE)
  # UBSan must abort (not just print): a run that only prints "runtime error" ends green and nobody reads it (A3 review: the out-of-bounds gate_[] read)
  add_compile_options(-fsanitize=address,undefined -fno-sanitize-recover=undefined -fno-omit-frame-pointer)
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

# Cypher Hall (Rust, djk/instrumente/hall_ffi) für fx/2, seit 2026-10-11 statt Faust zita_rev1: cargo baut die statische
# Bibliothek; sie hängt an cypherdj::dsp, damit jedes Ziel, das mixer.cpp übersetzt, sie mitbekommt.
find_program(CARGO cargo REQUIRED)
# rustc version for the golden test (test_mixer_golden.cpp): the digest depends on the compiler of the hall and compressor
# libraries. Asked in the Rust workspace so a rust-toolchain file there applies, as it does for cargo.
execute_process(COMMAND rustc --version WORKING_DIRECTORY ${DJK}/instrumente OUTPUT_VARIABLE RUSTC_VERSION_ZEILE
                RESULT_VARIABLE RUSTC_VERSION_RC OUTPUT_STRIP_TRAILING_WHITESPACE)
if(RUSTC_VERSION_RC EQUAL 0 AND RUSTC_VERSION_ZEILE MATCHES "^rustc ([0-9][^ ]*)")
  set(GOLDEN_RUSTC_VERSION ${CMAKE_MATCH_1})
else()
  set(GOLDEN_RUSTC_VERSION "unknown")
endif()
set(HALL_FFI_DIR ${DJK}/instrumente)
set(HALL_FFI_LIB ${HALL_FFI_DIR}/target/release/libhall_ffi.a)
# Seit 2026-10-11 trägt dieselbe Bibliothek auch Cypher Komp (komp_dsp): zwei Rust-Staticlibs kollidieren im Binary
# (und Baukasten-Graphen der Erzeuger-Ströme).
# D1 K2a: dazu die RB-338 (rb_dsp, cypher_rb_* in hall_ffi/src/rb.rs); ohne rb_dsp hier baute eine Änderung dort nicht neu.
# Baukasten S3a: dazu baukasten_dsp mit saett_dsp und eq_dsp (cypher_bk_* in hall_ffi/src/baukasten.rs).
file(GLOB HALL_FFI_QUELLEN CONFIGURE_DEPENDS ${HALL_FFI_DIR}/hall_ffi/src/*.rs ${HALL_FFI_DIR}/hall_dsp/src/*.rs
     ${HALL_FFI_DIR}/komp_dsp/src/*.rs ${HALL_FFI_DIR}/rb_dsp/src/*.rs ${HALL_FFI_DIR}/hall_ffi/Cargo.toml
     ${HALL_FFI_DIR}/baukasten_dsp/src/*.rs ${HALL_FFI_DIR}/saett_dsp/src/*.rs ${HALL_FFI_DIR}/eq_dsp/src/*.rs
     ${HALL_FFI_DIR}/hall_dsp/Cargo.toml ${HALL_FFI_DIR}/komp_dsp/Cargo.toml ${HALL_FFI_DIR}/rb_dsp/Cargo.toml
     ${HALL_FFI_DIR}/baukasten_dsp/Cargo.toml ${HALL_FFI_DIR}/saett_dsp/Cargo.toml ${HALL_FFI_DIR}/eq_dsp/Cargo.toml)
# touch danach: cargo schreibt die .a nicht neu, wenn sich nur die mtime einer Quelle ändert (gemessen 2026-10-15 an
# rb_dsp/Cargo.toml); ohne touch liefe die Regel dann bei jedem Bau erneut.
add_custom_command(OUTPUT ${HALL_FFI_LIB}
  COMMAND ${CARGO} build --release --quiet -p hall_ffi --manifest-path ${HALL_FFI_DIR}/Cargo.toml
  COMMAND ${CMAKE_COMMAND} -E touch ${HALL_FFI_LIB}
  DEPENDS ${HALL_FFI_QUELLEN} COMMENT "cargo: hall_ffi" VERBATIM)
add_custom_target(cypherdj_hall_ffi_bau DEPENDS ${HALL_FFI_LIB})
add_library(cypherdj_hall_ffi STATIC IMPORTED GLOBAL)
set_target_properties(cypherdj_hall_ffi PROPERTIES IMPORTED_LOCATION ${HALL_FFI_LIB})
add_dependencies(cypherdj_hall_ffi cypherdj_hall_ffi_bau)
target_link_libraries(cypherdj_hall_ffi INTERFACE ${CMAKE_DL_LIBS} Threads::Threads m)
target_link_libraries(cypherdj_dsp INTERFACE cypherdj_hall_ffi)

file(GLOB KERN_QUELLEN CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp)
list(REMOVE_ITEM KERN_QUELLEN ${CMAKE_CURRENT_SOURCE_DIR}/src/main.cpp)
# src/dehner_bungee.cpp gehört nicht in KERN_QUELLEN (die Mutationsziele mit eigener Quellenliste kennen Bungee nicht): nur die
# Bibliothek und die Ziele, die Bungee ausdrücklich brauchen, binden sie (mit CYPHERDJ_BUNGEE und cypherdj::bungee).
list(REMOVE_ITEM KERN_QUELLEN ${CMAKE_CURRENT_SOURCE_DIR}/src/dehner_bungee.cpp)
# Paket 1.13 Slice 2: ebenso die Bungee-Maschine des Warp-Werks; src/warp_werk.cpp (Pool, Ringe, Fäden) kennt Bungee nicht und bleibt in KERN_QUELLEN
list(REMOVE_ITEM KERN_QUELLEN ${CMAKE_CURRENT_SOURCE_DIR}/src/warp_werk_bungee.cpp)
set(KERN_BUNGEE_QUELLE)
if(CYPHERDJ_BUNGEE)
  include(${DJK}/third_party/bungee.cmake)
  set(KERN_BUNGEE_QUELLE ${CMAKE_CURRENT_SOURCE_DIR}/src/dehner_bungee.cpp ${CMAKE_CURRENT_SOURCE_DIR}/src/warp_werk_bungee.cpp)
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

# Mutation programs: the same sources, one switch. Failure cases of the acceptances (never ship).
#
# Fast build (cmake/mutation_geteilt.cmake): every helper below that builds a mutation program (kern_mutation, test_mutation,
# test_bk_attrappe, deck_keylock_mutation, box_keylock_mutation, kern_keylock_faeden_mutation, deck_geplant_mutation,
# deck_geplant_pruef, and the few direct kern_mut_exe calls) hands its sources to kern_mut_exe(). That compiles one object per
# (source, flag signature) and shares it between all mutation targets of the same signature; a target compiles itself, with its
# switch, only the units the switch can touch (its name occurs in the unit or in a file of its include closure, determined at
# configure time, unplaceable means touched). Call signatures of the helpers are unchanged. The equivalence of the units and flags
# against the old per-target build is proven for every target by messungen/2026-11-05-bau-schnell/aequivalenz.sh. A new switch
# needs nothing special: it is classified automatically; if the scan cannot place it, its target compiles everything itself.
# -DCYPHERDJ_MUTATION_GETEILT=OFF restores the old build (every target compiles all its sources). The libraries of the kern
# mutation programs (the same list in every helper):
set(KERN_MUT_LIBS PkgConfig::JACK Threads::Threads cypherdj::toml cypherdj::dsp cypherdj::stellwerk cypherdj_dsp_messer cypherdj::json
    PkgConfig::CRYPTO cypherdj::hand PkgConfig::RUBBERBAND)  # 25, 31, 35; Keylock Slice 3: KERN_QUELLEN contains netz_loop.cpp and loop_stretch.cpp
include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/mutation_geteilt.cmake)
function(kern_mutation name schalter)
  kern_mut_exe(${name} QUELLEN src/main.cpp ${KERN_QUELLEN} SCHALTER ${schalter} INCLUDES include ${DJK}/vertrag LIBS ${KERN_MUT_LIBS})
endfunction()
kern_mutation(cypherdj-kern-mutation CYPHERDJ_MUTATION_KLICK_BLOCKANFANG)       # Scheibe 01: Klick auf den Blockanfang
kern_mutation(cypherdj-kern-mutation-rampe CYPHERDJ_MUTATION_RAMPE_IN_SAMPLES)  # Scheibe 08: Rampe in Samples statt Beats
kern_mutation(cypherdj-kern-mutation-begin CYPHERDJ_MUTATION_ERZ_BEGIN_IGNORIERT)  # MVP 2 Scheibe 3: begin/end ignoriert
kern_mutation(cypherdj-kern-mutation-bk-rampe CYPHERDJ_MUTATION_BK_RAMPE_TOTZONE)  # S23: slow ramps on graph knobs never reach the graph (live probe spur_bk_messen.py must go red)

enable_testing()
file(GLOB KERN_TESTS CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_*.cpp)
# Scheibe 25: test_mixer prüft die Zuweisungstabelle (Wege bitgleich, Blende, Crossfader, PFL/Cue) am Mixer ohne den
# Master-Limiter dahinter; den Limiter, seinen Vorhalt und den verzögerten Cue prüft test_limiter25 am Betriebs-Mixer.
list(REMOVE_ITEM KERN_TESTS ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_mixer.cpp)
# Baukasten S3b Task 2: die Attrappe definiert cypher_bk_* selbst und darf hall_ffi nicht linken (eigenes Ziel weiter unten).
list(REMOVE_ITEM KERN_TESTS ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_erzeuger_bk_werk_attrappe.cpp)
if(NOT CYPHERDJ_BUNGEE)
  list(FILTER KERN_TESTS EXCLUDE REGEX "test_([a-z_]*bungee|warp_werk)")  # Tests der Bungee-Maschine und des Warp-Werks bauen nur mit CYPHERDJ_BUNGEE
endif()
# Fix L5 (K3): unter Kernel 7.0 bricht die TSan-Laufzeit mit Adress-Zufälligkeit oft schon beim Start ab („FATAL:
# ThreadSanitizer: unexpected memory mapping“). Die TSan-Läufe des Freeze starten darum über setarch -R.
if(CYPHERDJ_TSAN)
  find_program(SETARCH setarch REQUIRED)
  set(TSAN_START ${SETARCH} ${CMAKE_HOST_SYSTEM_PROCESSOR} -R)
endif()
foreach(pfad ${KERN_TESTS})
  get_filename_component(t ${pfad} NAME_WE)
  add_executable(${t} ${pfad})
  target_include_directories(${t} PRIVATE tests)
  target_link_libraries(${t} PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  target_compile_definitions(${t} PRIVATE CYPHERDJ_DJK="${DJK}")
  # mehrkern plan: the HallPool and its callers run under TSan too (test_hall_pool, test_arr_returns, test_hall_zustand)
  if(CYPHERDJ_TSAN AND (t STREQUAL "test_freeze_tsan" OR t STREQUAL "test_arr_auto_tsan" OR t STREQUAL "test_hall_pool" OR t STREQUAL "test_arr_returns" OR t STREQUAL "test_hall_zustand"))
    add_test(NAME ${t} COMMAND ${TSAN_START} $<TARGET_FILE:${t}>)
    set_tests_properties(${t} PROPERTIES FAIL_REGULAR_EXPRESSION "ThreadSanitizer")   # jede TSan-Zeile ist ein Befund
  else()
    add_test(NAME ${t} COMMAND ${t})
  endif()
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
# mehrkern Task 3: the HallPool stress case must fail, not hang
set_tests_properties(test_hall_pool PROPERTIES TIMEOUT 120)
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
  set(tm_defs CYPHERDJ_DJK="${DJK}")
  if(CYPHERDJ_BUNGEE AND ("src/dehner_bungee.cpp" IN_LIST tm_quellen OR "src/arr_wiedergabe.cpp" IN_LIST tm_quellen OR "src/warp_werk.cpp" IN_LIST tm_quellen))  # nur die Ziele, die Bungee ausdrücklich einbinden;
    list(APPEND tm_defs CYPHERDJ_BUNGEE=1)   # Paket 1.13 Slice 2: der Lader fragt es nur (Maschinen-Tor für complex und tones), er bindet Bungee nicht
  endif()
  kern_mut_exe(${name} QUELLEN tests/${test}.cpp ${tm_quellen} SCHALTER ${schalter} DEFS ${tm_defs}
               INCLUDES include tests ${DJK}/vertrag
               LIBS PkgConfig::JACK Threads::Threads cypherdj::dsp cypherdj::stellwerk
                    cypherdj_dsp_messer cypherdj::json PkgConfig::CRYPTO cypherdj::hand ${tm_libs})  # Scheibe 25, 31, 35
  add_test(NAME ${name} COMMAND ${name})
  set_tests_properties(${name} PROPERTIES WILL_FAIL TRUE)
endfunction()
# D1 K1: Quellen des Moduls Arrangement (arrangement.h); die Ziele mit eigener Quellenliste brauchen sie, sobald der Kern
# das Modul hält (Slice 8). Wächst mit den Slices 4 bis 7.
set(ARR_QUELLEN src/arrangement.cpp src/arr_stimmen.cpp src/arr_ausgang.cpp src/arr_noten.cpp src/arr_metronom.cpp
    src/arr_freeze.cpp  # Paket K3: Freeze
    src/arr_auto.cpp    # Automation Slice 1: fader lane per sample, blend (ADR 032)
    src/arr_returns.cpp # 1.10 Slice 3: Cypher Hall of the return strips
    src/hall_pool.cpp   # mehrkern task 4: the return Halls compute on the HallPool
    src/arr_inserts.cpp # 1.10 slice 4a: pooled compressor inserts of the strips
    src/arr_warp.cpp)   # Paket 1.13 Slice 2: Seite des Arrangements am Warp-Werk (nur die Schnittstelle warp_werk.h, kein Bungee)
list(APPEND ARR_QUELLEN src/arr_bk_senke.cpp src/arr_kit_senke.cpp src/arr_intern_senke.cpp src/arr_rb_senke.cpp src/arr_wirt_senke.cpp
     src/arr_rack_senke.cpp)   # 1.9 U6: instrument rack. D1 K2b: Senken (RB-338 über cypherdj::dsp -> libhall_ffi.a, Wirt-Slots)
test_mutation(test_klick_mutation test_klick CYPHERDJ_MUTATION_KLICK_BLOCKANFANG src/klick.cpp src/uhr.cpp)
test_mutation(test_tempoplan_mutation test_tempoplan CYPHERDJ_MUTATION_RAMPE_IN_SAMPLES src/tempoplan.cpp src/uhr.cpp)
test_mutation(test_befehle_mutation test_befehle CYPHERDJ_MUTATION_TAKT_AUS_KARTE
              src/kern.cpp src/erzeuger.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/kern_stellwerk.cpp src/kern_arr.cpp ${ARR_QUELLEN} src/mixer.cpp src/beatfx.cpp src/teile.cpp src/klick.cpp src/tempoplan.cpp
              src/uhr.cpp  # Scheibe 25: kern.cpp braucht Stellwerk-Anbindung, Mixer und Schatten
              src/kern_deck.cpp src/kern_mix.cpp src/deck.cpp src/lader.cpp src/fassung.cpp  # Scheibe 31: und die Decks
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
# Baukasten S3a Task 2: Fehlerfälle des Erzeuger-Stroms mit Graph (test_erzeuger_bk).
test_mutation(test_erzeuger_bk_vorhalt_mutation test_erzeuger_bk CYPHERDJ_MUTATION_BK_VORHALT src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
test_mutation(test_erzeuger_bk_hart_mutation test_erzeuger_bk CYPHERDJ_MUTATION_BK_HART src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
test_mutation(test_erzeuger_bk_kit_spielt_mutation test_erzeuger_bk CYPHERDJ_MUTATION_BK_KIT_SPIELT src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
test_mutation(test_erzeuger_bk_off_blockanfang_mutation test_erzeuger_bk CYPHERDJ_MUTATION_BK_OFF_BLOCKANFANG src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
test_mutation(test_erzeuger_bk_ohne_klemme_mutation test_erzeuger_bk CYPHERDJ_MUTATION_BK_OHNE_KLEMME src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
test_mutation(test_erzeuger_bk_fade_konstant_mutation test_erzeuger_bk CYPHERDJ_MUTATION_BK_FADE_KONSTANT src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
test_mutation(test_erzeuger_bk_alle_aus_mutation test_erzeuger_bk CYPHERDJ_MUTATION_BK_ALLE_AUS src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
test_mutation(test_erzeuger_bk_zweiter_wechsel_leck_mutation test_erzeuger_bk CYPHERDJ_MUTATION_BK_ZWEITER_WECHSEL_LECK src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
# Baukasten S3c Task 4: Kanal-Graph im Mixer. test_mixer_bk gegen diese Mutationen muss scheitern.
test_mutation(test_mixer_bk_blende_aus_mutation test_mixer_bk CYPHERDJ_MUTATION_BK_KANAL_BLENDE_AUS src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_bk_klemme_aus_mutation test_mixer_bk CYPHERDJ_MUTATION_BK_KANAL_KLEMME_AUS src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_bk_takt_aus_mutation test_mixer_bk CYPHERDJ_MUTATION_BK_KANAL_TAKT_AUS src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_bk_doppel_alt_mutation test_mixer_bk CYPHERDJ_MUTATION_BK_KANAL_DOPPEL_ALT src/mixer.cpp src/beatfx.cpp)
# Baukasten S6 Task 1: effect graphs on the send returns fx/3, fx/4. test_mixer_bk against these must fail.
test_mutation(test_mixer_bk_send_rueckgabe_aus_mutation test_mixer_bk CYPHERDJ_MUTATION_BK_SEND_RUECKGABE_AUS src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_bk_send_rueckweg_ignoriert_mutation test_mixer_bk CYPHERDJ_MUTATION_BK_SEND_RUECKWEG_IGNORIERT src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_bk_send_rueckweg_w_mutation test_mixer_bk CYPHERDJ_MUTATION_BK_SEND_RUECKWEG_W src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_bk_send_bus_vertauscht_mutation test_mixer_bk CYPHERDJ_MUTATION_BK_SEND_BUS_VERTAUSCHT src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_bk_send_blende_aus_mutation test_mixer_bk CYPHERDJ_MUTATION_BK_SEND_BLENDE_AUS src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_bk_send_klemme_aus_mutation test_mixer_bk CYPHERDJ_MUTATION_BK_SEND_KLEMME_AUS src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_bk_send_gate_wie_hall_mutation test_mixer_bk CYPHERDJ_MUTATION_BK_SEND_GATE_WIE_HALL src/mixer.cpp src/beatfx.cpp)
# Baukasten S14: send graphs report their own knob rows (fx/3/bk, fx/4/bk). test_mixer_bk (w) must fail against each.
foreach(mut NUTZT_DECK_REGLER ZEILE_VERTAUSCHT OHNE_REGLER WAECHTER_ALT)
  string(TOLOWER ${mut} mut_klein)
  test_mutation(test_mixer_bk_send_${mut_klein}_mutation test_mixer_bk CYPHERDJ_MUTATION_BK_SEND_${mut} src/mixer.cpp src/beatfx.cpp)
endforeach()
# Baukasten S3b Task 1: Fehlerfälle des Graph-Werks (test_graph_werk).
test_mutation(test_graph_werk_ohne_stehlen_mutation test_graph_werk CYPHERDJ_MUTATION_GW_OHNE_STEHLEN src/graph_werk.cpp)
test_mutation(test_graph_werk_spaet_gueltig_mutation test_graph_werk CYPHERDJ_MUTATION_GW_SPAET_GUELTIG src/graph_werk.cpp)
test_mutation(test_graph_werk_auftrag_besetzt_mutation test_graph_werk CYPHERDJ_MUTATION_GW_AUFTRAG_BESETZT src/graph_werk.cpp)
test_mutation(test_graph_werk_falsches_s_mutation test_graph_werk CYPHERDJ_MUTATION_GW_FALSCHES_S src/graph_werk.cpp)
test_mutation(test_graph_werk_kein_rueckfall_mutation test_graph_werk CYPHERDJ_MUTATION_GW_KEIN_RUECKFALL src/graph_werk.cpp)
test_mutation(test_graph_werk_verwerfen_rechnet_mutation test_graph_werk CYPHERDJ_MUTATION_GW_VERWERFEN_RECHNET src/graph_werk.cpp)
# Fall 5 fährt in ctest 5000 statt 50 000 Zyklen (CYPHERDJ_GW_ZYKLEN); ein hängender Stub (halt ohne los) hängt ctest nicht bis zum Vorgabe-Timeout.
foreach(t test_graph_werk test_graph_werk_ohne_stehlen_mutation test_graph_werk_spaet_gueltig_mutation test_graph_werk_auftrag_besetzt_mutation
          test_graph_werk_falsches_s_mutation test_graph_werk_kein_rueckfall_mutation test_graph_werk_verwerfen_rechnet_mutation)
  if(TEST ${t})
    set_tests_properties(${t} PROPERTIES ENVIRONMENT "CYPHERDJ_GW_ZYKLEN=5000" TIMEOUT 120)
  endif()
endforeach()
# Baukasten S3b Task 2: Erzeuger mit Graph-Werk. test_erzeuger_bk_werk mit echtem Graphen (hall_ffi); die Attrappe ohne
# hall_ffi, nur mit den Quellen, die der Erzeuger braucht (Review F2 N3), und ihre Fehlerfälle.
test_mutation(test_erzeuger_bk_werk_rampe_spaet_mutation test_erzeuger_bk_werk CYPHERDJ_MUTATION_BK_WERK_RAMPE_SPAET
              src/erzeuger.cpp src/kit.cpp src/uhr.cpp src/graph_werk.cpp)
test_mutation(test_erzeuger_bk_werk_ausklang_stumm_mutation test_erzeuger_bk_werk CYPHERDJ_MUTATION_BK_WERK_AUSKLANG_STUMM
              src/erzeuger.cpp src/kit.cpp src/uhr.cpp src/graph_werk.cpp)
function(test_bk_attrappe name schalter)
  kern_mut_exe(${name} QUELLEN tests/test_erzeuger_bk_werk_attrappe.cpp src/erzeuger.cpp src/kit.cpp src/uhr.cpp src/graph_werk.cpp
               SCHALTER ${schalter}
               INCLUDES include tests ${DJK}/vertrag   # nur Köpfe (mixer.h), nichts gelinkt
                 $<TARGET_PROPERTY:cypherdj::dsp,INTERFACE_INCLUDE_DIRECTORIES> $<TARGET_PROPERTY:cypherdj_dsp_messer,INTERFACE_INCLUDE_DIRECTORIES>
                 $<TARGET_PROPERTY:cypherdj::stellwerk,INTERFACE_INCLUDE_DIRECTORIES>
               LIBS Threads::Threads cypherdj::json)
  if(CYPHERDJ_TSAN)
    add_test(NAME ${name} COMMAND ${TSAN_START} $<TARGET_FILE:${name}>)
  else()
    add_test(NAME ${name} COMMAND ${name})
  endif()
  set_tests_properties(${name} PROPERTIES TIMEOUT 60)
  if(schalter)
    set_tests_properties(${name} PROPERTIES WILL_FAIL TRUE)
  elseif(CYPHERDJ_TSAN)
    set_tests_properties(${name} PROPERTIES FAIL_REGULAR_EXPRESSION "ThreadSanitizer")
  endif()
endfunction()
test_bk_attrappe(test_erzeuger_bk_werk_attrappe "")
test_bk_attrappe(test_erzeuger_bk_werk_spaet_verbraucht_mutation CYPHERDJ_MUTATION_BK_WERK_SPAET_VERBRAUCHT)
test_bk_attrappe(test_erzeuger_bk_werk_noten_trotz_besetzt_mutation CYPHERDJ_MUTATION_BK_WERK_NOTEN_TROTZ_BESETZT)
test_bk_attrappe(test_erzeuger_bk_werk_wechsel_sofort_mutation CYPHERDJ_MUTATION_BK_WERK_WECHSEL_SOFORT)
# Baukasten S5r Task 3: Graph-Regler. Die Attrappe sieht alle vier Fehlerfälle (nicht gemeldet, an besetztem Platz, falscher Kanal,
# getauschter Graph ohne Wert); test_erzeuger_bk (ohne Werk) und test_kern_kanal_graph (Kern bis Mixer) die drei übrigen.
foreach(mut NICHT_GEMELDET TROTZ_BESETZT FALSCHER_KANAL TAUSCH_05)
  string(TOLOWER ${mut} mut_klein)
  test_bk_attrappe(test_erzeuger_bk_werk_regler_${mut_klein}_mutation CYPHERDJ_MUTATION_BK_REGLER_${mut})
endforeach()
foreach(mut NICHT_GEMELDET FALSCHER_KANAL TAUSCH_05)
  string(TOLOWER ${mut} mut_klein)
  test_mutation(test_erzeuger_bk_regler_${mut_klein}_mutation test_erzeuger_bk CYPHERDJ_MUTATION_BK_REGLER_${mut} src/erzeuger.cpp src/kit.cpp src/uhr.cpp)
endforeach()
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
kern_mut_exe(test_netz_deck_knopf_mutation QUELLEN tests/test_netz_deck.cpp ${KERN_QUELLEN} SCHALTER CYPHERDJ_MUTATION_KEYLOCK_HALLO_OHNE_KNOPF
             DEFS CYPHERDJ_DJK="${DJK}" INCLUDES include tests ${DJK}/vertrag LIBS ${KERN_MUT_LIBS})
add_test(NAME test_netz_deck_knopf_mutation COMMAND test_netz_deck_knopf_mutation)
set_tests_properties(test_netz_deck_knopf_mutation PROPERTIES WILL_FAIL TRUE)
# Plan 3 (Beat-FX), Fehlerfall: LFO-Phase ab dem ersten Block statt aus dem absoluten Beat.
test_mutation(test_beatfx_mutation test_beatfx CYPHERDJ_MUTATION_FX_LFO_AB_START src/beatfx.cpp)

# Scheibe 18, Messgerät der Abschuss-Serien (tests/neustart/): JACK-Aufnehmer mit vier Kanälen am Ziel. Liegt in einem
# Unterordner, den das Einsammeln der Tests oben nicht erfasst.
add_executable(cypherdj-aufnehmer4 tests/neustart/aufnehmer4.cpp)
target_link_libraries(cypherdj-aufnehmer4 PRIVATE PkgConfig::JACK)
target_compile_options(cypherdj-aufnehmer4 PRIVATE -Wall -Wextra)

# Scheibe 18: Diagnose des Neustart-Zustands (nur lesend, INTERFACES §6.3) und die Vergleichsmessung der Kosten des
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
              src/kern.cpp src/erzeuger.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/kern_stellwerk.cpp src/kern_arr.cpp ${ARR_QUELLEN} src/mixer.cpp src/beatfx.cpp src/teile.cpp src/klick.cpp src/tempoplan.cpp src/uhr.cpp
              src/kern_deck.cpp src/kern_mix.cpp src/deck.cpp src/lader.cpp src/fassung.cpp  # Scheibe 31
              src/kern_hand.cpp src/hand_ein.cpp  # Scheibe 35
              stub/dehner_stub.cpp)  # Keylock Task 2: Fabrik ohne Rubber Band
# Scheibe 25, Fehlerfall der Abnahme „Limiter im Master“ (MVP, Lücken und Entscheide): Master ohne Limiter. test_limiter25
# gegen diese Mutation muss scheitern (heißes Signal über −1 dBTP); cypherdj-kern-mutation-limiter für die Messung an der
# Fassung (tests/limiter/).
kern_mutation(cypherdj-kern-mutation-limiter CYPHERDJ_MUTATION_OHNE_LIMITER)
test_mutation(test_limiter25_mutation test_limiter25 CYPHERDJ_MUTATION_OHNE_LIMITER src/mixer.cpp src/beatfx.cpp)
# K2 Task 1.5: Duck ohne Wirkung auf den Kanälen. test_mixer_duck (vom Glob angelegt) gegen diese Mutation muss scheitern.
test_mutation(test_mixer_duck_mutation test_mixer_duck CYPHERDJ_MUTATION_DUCK_AUS src/mixer.cpp src/beatfx.cpp)
# Sleep state of silent strips: without the ruhig() and holder checks only the zero input decides, so a strip with a colour tail or a
# noise colour move sleeps although it makes sound. test_mixer_schlaf (from the glob) against this mutation must fail.
test_mutation(test_mixer_schlaf_mutation test_mixer_schlaf CYPHERDJ_MUTATION_SCHLAF_OHNE_RUHIG src/mixer.cpp src/beatfx.cpp)
# K2 Task 2.2: Rückweg fx/2 ohne Hall in der Summe. test_mixer_hall (vom Glob angelegt) gegen diese Mutation muss scheitern.
test_mutation(test_mixer_hall_mutation test_mixer_hall CYPHERDJ_MUTATION_HALL_TOT src/mixer.cpp src/beatfx.cpp)
# Package 1.15 task A0: test_mixer_golden (digest recorded at base 2f26eeb9) against three mixer mutations must fail.
# The definitions below belong to the mutation targets from the start (kern_mut_exe shares the unchanged objects between targets, so
# a later target_compile_definitions() would reach only the units the target compiles itself; _kmg_pruefe rejects that).
foreach(g test_mixer_golden_duck_aus_mutation test_mixer_golden_nur_cue_aus_mutation test_mixer_golden_fx_einheiten_mutation)
  set(KMG_DEFS_${g} "CYPHERDJ_RUSTC_VERSION=\"${GOLDEN_RUSTC_VERSION}\"" CYPHERDJ_GOLDEN_MUTANT=1)
endforeach()
test_mutation(test_mixer_golden_duck_aus_mutation test_mixer_golden CYPHERDJ_MUTATION_DUCK_AUS src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_golden_nur_cue_aus_mutation test_mixer_golden CYPHERDJ_MUTATION_NUR_CUE_AUS src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_golden_fx_einheiten_mutation test_mixer_golden CYPHERDJ_MUTATION_FX_EINHEITEN_VERTAUSCHT src/mixer.cpp src/beatfx.cpp)
# On another toolchain string these cannot tell a mutation from compiler noise: the test then exits 77 (SKIP) instead of falling
# back to a tolerance. On the recorded toolchain they stay WILL_FAIL (digest differs, exit 1).
foreach(g test_mixer_golden test_mixer_golden_duck_aus_mutation test_mixer_golden_nur_cue_aus_mutation
        test_mixer_golden_fx_einheiten_mutation)
  if(TARGET ${g})
    if(g STREQUAL "test_mixer_golden")
      target_compile_definitions(${g} PRIVATE CYPHERDJ_RUSTC_VERSION="${GOLDEN_RUSTC_VERSION}")
    else()
      set_tests_properties(${g} PROPERTIES SKIP_RETURN_CODE 77)   # definitions: KMG_DEFS_ above
    endif()
  endif()
endforeach()
# Package 1.15 task A3: gate and utility in the channel strip. Each test against its mutation must fail (WILL_FAIL):
#   gate behind the compressor (G5), sidechain key = the own input (G3), utility called although neutral (U1 only: a neutral call is
#   bit-identical to the input, so the golden digest cannot see it; measured 2026-11-03),
#   mix-tool slots not carried on at the end of the block (review obligation 1).
test_mutation(test_mixer_gate_nach_komp_mutation test_mixer_gate CYPHERDJ_MUTATION_GATE_NACH_KOMP src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_gate_sc_eigen_mutation test_mixer_gate CYPHERDJ_MUTATION_GATE_SC_EIGEN src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_utility_immer_mutation test_mixer_utility CYPHERDJ_MUTATION_UTIL_IMMER src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_wz_nachfuehren_mutation test_mixer_wz_nachfuehren CYPHERDJ_MUTATION_WZ_OHNE_NACHFUEHREN src/mixer.cpp src/beatfx.cpp)
# A3 fix round (reviews of 2026-11-03): each of these was a mutation the first version's tests let through.
test_mutation(test_mixer_utility_gate_ohne_guard_mutation test_mixer_utility CYPHERDJ_MUTATION_GATE_OHNE_GUARD src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_gate_start_zu_mutation test_mixer_gate CYPHERDJ_MUTATION_GATE_START_ZU src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_gate_kein_reset_mutation test_mixer_gate CYPHERDJ_MUTATION_GATE_KEIN_RESET src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_gate_f01_ohne_werkzeuge_mutation test_mixer_gate CYPHERDJ_MUTATION_F01_OHNE_WERKZEUGE src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_gate_wz_wert_nur_w_mutation test_mixer_gate CYPHERDJ_MUTATION_WZ_WERT_NUR_W src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_gate_util_nach_gate_mutation test_mixer_gate CYPHERDJ_MUTATION_UTIL_NACH_GATE src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_wz_felder_hold_attack_mutation test_mixer_wz_felder CYPHERDJ_MUTATION_WZ_HOLD_ATTACK_VERTAUSCHT src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_wz_felder_phaser_dc_mutation test_mixer_wz_felder CYPHERDJ_MUTATION_WZ_PHASER_DC_VERTAUSCHT src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_gate_leeren_vor_setze_mutation test_mixer_gate CYPHERDJ_MUTATION_GATE_LEEREN_VOR_SETZE src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_gate_f01_ohne_gate_mutation test_mixer_gate CYPHERDJ_MUTATION_F01_OHNE_GATE src/mixer.cpp src/beatfx.cpp)
# Package 1.15 task A4: multiband compressor on the buses. Each of these must turn exactly the named test red:
#   the three the task names (bands in the wrong order, makeup applied when bypassed, crossfade length 0) and the ones the A3 reviews call for:
#   field constants swapped, D1 order (before the utility, behind the fader), D6 no reset on the way back, D9 slot value only, F01 guard
#   without the multiband, and a multiband that swallows a NaN. The index guard (mb_[k - 14] for a source) has no registered mutant: its
#   error case is undefined behaviour, shown by hand under CYPHERDJ_SANITIZE (CYPHERDJ_MUTATION_MB_OHNE_GUARD).
test_mutation(test_mixer_multiband_baender_mutation test_mixer_multiband CYPHERDJ_MUTATION_MB_BAENDER_VERTAUSCHT src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_makeup_umgehen_mutation test_mixer_multiband CYPHERDJ_MUTATION_MB_MAKEUP_BEI_UMGEHEN src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_ausgleich_aus_mutation test_mixer_multiband CYPHERDJ_MUTATION_MB_AUSGLEICH_AUS src/mixer.cpp src/beatfx.cpp)   # mb-ausgleich fix: M3b
test_mutation(test_mixer_multiband_blende_null_mutation test_mixer_multiband CYPHERDJ_MUTATION_MB_BLENDE_NULL src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_vor_util_mutation test_mixer_multiband CYPHERDJ_MUTATION_MB_VOR_UTIL src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_nach_fader_mutation test_mixer_multiband CYPHERDJ_MUTATION_MB_NACH_FADER src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_kein_reset_mutation test_mixer_multiband CYPHERDJ_MUTATION_MB_KEIN_RESET src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_f01_ohne_mutation test_mixer_multiband CYPHERDJ_MUTATION_MB_F01_OHNE src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_nan_verschluckt_mutation test_mixer_multiband CYPHERDJ_MUTATION_MB_NAN_VERSCHLUCKT src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_wz_wert_nur_w_mutation test_mixer_multiband CYPHERDJ_MUTATION_WZ_WERT_NUR_W src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_wz_felder_mb_grenzen_mutation test_mixer_wz_felder CYPHERDJ_MUTATION_MB_GRENZEN_VERTAUSCHT src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_wz_felder_mb_attack_release_mutation test_mixer_wz_felder CYPHERDJ_MUTATION_MB_ATTACK_RELEASE_VERTAUSCHT src/mixer.cpp src/beatfx.cpp)
# A4 M5 fix (crossover change by crossfade of two objects): the old behaviour, the dynamics not handed over, the newest target lost.
test_mutation(test_mixer_multiband_grenze_sofort_mutation test_mixer_multiband_grenzen CYPHERDJ_MUTATION_MB_GRENZE_SOFORT src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_dynamik_nicht_kopiert_mutation test_mixer_multiband_grenzen CYPHERDJ_MUTATION_MB_DYNAMIK_NICHT_KOPIERT src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_vormerken_verloren_mutation test_mixer_multiband_grenzen CYPHERDJ_MUTATION_MB_VORMERKEN_VERLOREN src/mixer.cpp src/beatfx.cpp)
# fix round 1: the warm-up must not restart at every new target; the guard must reset the second object too; the dynamics are carried over whole
test_mutation(test_mixer_multiband_warm_neu_start_mutation test_mixer_multiband_grenzen CYPHERDJ_MUTATION_MB_WARM_NEU_START src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_f01_nur_erstes_mutation test_mixer_multiband CYPHERDJ_MUTATION_MB_F01_NUR_ERSTES src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_dynamik_nur_rampen_mutation test_mixer_multiband_grenzen CYPHERDJ_MUTATION_MB_DYNAMIK_NUR_RAMPEN src/mixer.cpp src/beatfx.cpp)
# fix round 2: the warm-up rule (anchor, both crossovers, big steps only pending)
test_mutation(test_mixer_multiband_klass_nur_tief_mutation test_mixer_multiband_einlauf CYPHERDJ_MUTATION_MB_KLASSE_NUR_TIEF src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_vergleich_letztes_ziel_mutation test_mixer_multiband_einlauf CYPHERDJ_MUTATION_MB_VERGLEICH_LETZTES_ZIEL src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_gross_angewendet_mutation test_mixer_multiband_einlauf CYPHERDJ_MUTATION_MB_GROSS_ANGEWENDET src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_einlauf_warm_neu_start_mutation test_mixer_multiband_einlauf CYPHERDJ_MUTATION_MB_WARM_NEU_START src/mixer.cpp src/beatfx.cpp)
# Package 1.15 task A5a: the latency account. Each of these must turn test_mixer_latenzkonto red (WILL_FAIL):
#   the four the task names (PFL ring without + L, metronome undelayed, bus_sum_ not merged, the merge in front of the hall return), a ring
#   read one sample off, (fix round 1) the clamp removed, the same value clearing the lines, no check in front of the metronome line, the PFL ring not
#   cleared by F01, the send-graph return after the merge, a PFL ring sized for vh = 84, a PFL ring that was not enlarged (stable red only through the wrong delay; under CYPHERDJ_SANITIZE the bounds check aborts), and the F01 guard without the delay lines / without the check in front of them.
foreach(mut F01_PFL_RING_AUCH_L0 PFL_RING_VH84 KLEMME_AUS GLEICHER_WERT_LEERT METRO_OHNE_PRUEFUNG F01_OHNE_PFL_RING SEND_NACH_MERGE PFL_RING_KLEIN PFL_OHNE_L METRO_OHNE BUS_SUM_UEBERSPRUNGEN MERGE_VOR_HALL RING_PLUS_EINS F01_OHNE_RINGE F01_ERST_NACH_RING)
  string(TOLOWER ${mut} mut_klein)
  test_mutation(test_mixer_latenzkonto_${mut_klein}_mutation test_mixer_latenzkonto CYPHERDJ_MUTATION_LATENZ_${mut} src/mixer.cpp src/beatfx.cpp)
endforeach()
# Package 1.15 task A5b: the channel limiter. Each of these must turn test_mixer_kanal_limiter red (WILL_FAIL): the limiter in front of the fader (L3, L7), no crossfade
#   (L5), lim/an 0 without the delay (the task names A5a's test_mixer_latenzkonto C1; it is also red here via L2/L4), the F01 guard without the limiter reset (F), the
#   ceiling/release handed over once (L6), the reduction reported with lim/an 0 (G), L without the true-peak delay (B, L4), no warm-up (L5 with L = 962).
#   Fix round 1: no leeren() on the switch-off (R), warm-up of L/2 (L5 fine), all buses on lim_[0] (I), an overshoot window a crossfade longer (U), a reduction reported in the warm-up (W).
foreach(mut VOR_FADER BLENDE_NULL F01_OHNE DECKE_EINMAL RED_BEI_AUS L_OHNE_ECHTSPITZE WARM_OHNE AUS_OHNE_VERZOEGERUNG AUS_OHNE_LEEREN WARM_HALB GETEILT FENSTER_LANG RED_WARM)
  string(TOLOWER ${mut} mut_klein)
  test_mutation(test_mixer_kanal_limiter_${mut_klein}_mutation test_mixer_kanal_limiter CYPHERDJ_MUTATION_LIM_${mut} src/mixer.cpp src/beatfx.cpp)
endforeach()
test_mutation(test_mixer_latenzkonto_lim_aus_ohne_verzoegerung_mutation test_mixer_latenzkonto CYPHERDJ_MUTATION_LIM_AUS_OHNE_VERZOEGERUNG src/mixer.cpp src/beatfx.cpp)
# K2 Task 3.3: Kleber in der Summe abgeschaltet. test_mixer_kleber (vom Glob angelegt) gegen diese Mutation muss scheitern.
test_mutation(test_mixer_kleber_mutation test_mixer_kleber CYPHERDJ_MUTATION_KLEBER_AUS src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_kleber_in_summe_mutation test_mixer_kleber CYPHERDJ_MUTATION_KLEBER_IN_SUMME src/mixer.cpp src/beatfx.cpp)
# K2 Umbau: Kleber beim Ausschalten sofort überspringen (Gain-Stufe). test_mixer_kleber (Fall i) muss dagegen scheitern.
test_mutation(test_mixer_kleber_sofort_aus_mutation test_mixer_kleber CYPHERDJ_MUTATION_KLEBER_SOFORT_AUS src/mixer.cpp src/beatfx.cpp)
# K2 Task 1.5: Kern-Verdrahtung. Der Auslöser geht ohne Sample-Versatz an den Mixer; test_kern_duck muss scheitern.
test_mutation(test_kern_duck_mutation test_kern_duck CYPHERDJ_MUTATION_DUCK_VERSATZ_NULL
              src/kern.cpp src/erzeuger.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/kern_stellwerk.cpp src/kern_arr.cpp ${ARR_QUELLEN} src/mixer.cpp src/beatfx.cpp src/teile.cpp src/klick.cpp src/tempoplan.cpp src/uhr.cpp
              src/kern_deck.cpp src/kern_mix.cpp src/deck.cpp src/lader.cpp src/fassung.cpp
              src/kern_hand.cpp src/hand_ein.cpp
              stub/dehner_stub.cpp)
# Scheibe 25: test_mixer am Mixer ohne Limiter (siehe oben beim Einsammeln der Tests); kein WILL_FAIL.
add_executable(test_mixer tests/test_mixer.cpp src/mixer.cpp src/beatfx.cpp)
target_include_directories(test_mixer PRIVATE include tests)
target_compile_definitions(test_mixer PRIVATE CYPHERDJ_MUTATION_OHNE_LIMITER=1)
target_link_libraries(test_mixer PRIVATE cypherdj::dsp cypherdj::stellwerk cypherdj_dsp_messer)
add_test(NAME test_mixer COMMAND test_mixer)
# S7 (Plan Mediathek-Browser): Nur-Cue im Mixer und seine Aktivierung im Kern müssen fehlen dürfen, ohne dass es keiner merkt.
add_executable(test_mixer_nur_cue_mutation tests/test_mixer.cpp src/mixer.cpp src/beatfx.cpp)
target_include_directories(test_mixer_nur_cue_mutation PRIVATE include tests)
target_compile_definitions(test_mixer_nur_cue_mutation PRIVATE CYPHERDJ_MUTATION_OHNE_LIMITER=1 CYPHERDJ_MUTATION_NUR_CUE_AUS=1)
target_link_libraries(test_mixer_nur_cue_mutation PRIVATE cypherdj::dsp cypherdj::stellwerk cypherdj_dsp_messer)
add_test(NAME test_mixer_nur_cue_mutation COMMAND test_mixer_nur_cue_mutation)
set_tests_properties(test_mixer_nur_cue_mutation PROPERTIES WILL_FAIL TRUE)
# kern.cpp mutiert als eigenes Objekt vor der Bibliothek: der Linker nimmt dieses kern.o, nicht das aus cypherdj_kernbib
add_executable(test_kern_vorhoeren_mutation tests/test_kern_vorhoeren.cpp src/kern.cpp)
target_include_directories(test_kern_vorhoeren_mutation PRIVATE include tests)
target_compile_definitions(test_kern_vorhoeren_mutation PRIVATE CYPHERDJ_MUTATION_KERN_OHNE_NUR_CUE=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_kern_vorhoeren_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_kern_vorhoeren_mutation COMMAND test_kern_vorhoeren_mutation)
set_tests_properties(test_kern_vorhoeren_mutation PROPERTIES WILL_FAIL TRUE)
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
# Das python3 aus dem PATH (System, mit numpy) vorgeben: seit 2026-10-03 liegt ein uv-Python 3.11 ohne numpy in
# ~/.local/bin, FindPython nahm es dort als ersten Treffer, und die Python-Tests brachen am Import ab (2026-10-11).
if(NOT DEFINED Python3_EXECUTABLE)
  find_program(CYPHERDJ_PYTHON3 NAMES python3)
  if(CYPHERDJ_PYTHON3)
    set(Python3_EXECUTABLE ${CYPHERDJ_PYTHON3})
  endif()
endif()
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
# Hörbares Ziehen (Scrub), Fehlerfall: die Leseposition springt je Block auf die Hand, keine stetige Rate. test_deck_scrub muss scheitern.
test_mutation(test_deck_scrub_mutation test_deck_scrub CYPHERDJ_MUTATION_SCRUB_OHNE_GLAETTUNG src/deck.cpp src/fassung.cpp src/uhr.cpp)

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
  kern_mut_exe(test_kern_keylock_bungee_kein_antrieb_mutation   # Slice 2: warp_werk.cpp liegt in KERN_QUELLEN und braucht die Maschine
               QUELLEN tests/test_kern_keylock_bungee.cpp ${KERN_QUELLEN} src/dehner_bungee.cpp src/warp_werk_bungee.cpp
               SCHALTER CYPHERDJ_MUTATION_KEIN_ANTRIEB DEFS CYPHERDJ_BUNGEE=1 CYPHERDJ_DJK="${DJK}"
               INCLUDES include tests ${DJK}/vertrag LIBS ${KERN_MUT_LIBS} cypherdj::bungee)
  add_test(NAME test_kern_keylock_bungee_kein_antrieb_mutation COMMAND test_kern_keylock_bungee_kein_antrieb_mutation deck)
  set_tests_properties(test_kern_keylock_bungee_kein_antrieb_mutation PROPERTIES WILL_FAIL TRUE TIMEOUT 120)
  foreach(m BUNGEE_KORN_EINS_SPAET BUNGEE_OHNE_RESET)
    string(TOLOWER ${m} mk)
    test_mutation(test_dehner_${mk}_mutation test_dehner_bungee CYPHERDJ_MUTATION_${m}
                  src/dehner.cpp src/dehner_bungee.cpp src/uhr.cpp PkgConfig::RUBBERBAND cypherdj::bungee)
  endforeach()
  # Paket 1.13 Warp, Slice 2: Fehlerfälle des Warp-Werks (das Werk wird als eigenes Objekt mutiert), jede macht ihren Fall in test_warp_werk rot
  foreach(m SOLL_NACH_SCHREIBE RING_VOLL_DREHT)
    string(TOLOWER ${m} mk)
    test_mutation(test_warp_werk_${mk}_mutation test_warp_werk CYPHERDJ_MUTATION_WARP_${m} src/warp_werk.cpp src/warp_werk_bungee.cpp src/uhr.cpp cypherdj::bungee)
  endforeach()
  # Paket 1.13 Warp, Slice 5: Fehlerfälle von Transpose/Detune im Werk (PITCH_VERGESSEN bricht Fall 1, HOP_FEST Fall 3)
  foreach(m PITCH_VERGESSEN HOP_FEST)
    string(TOLOWER ${m} mk)
    test_mutation(test_warp_werk_pitch_${mk}_mutation test_warp_werk_pitch CYPHERDJ_MUTATION_WARP_${m} src/warp_werk.cpp src/warp_werk_bungee.cpp src/uhr.cpp cypherdj::bungee)
  endforeach()
  # Task 3 Step 6, ohne die Quelle anzufassen: die Reihenfolge der ersten Fassung (schreibe vor soll) mit dem engen Fenster. Kein Test, denn der Verlust tritt nur in einem Teil
  # der Läufe auf (ein ctest-Ziel wäre unzuverlässig): der Plan fährt das Ziel fünfmal von Hand
  add_executable(test_warp_werk_soll_nach_schreibe_eng tests/test_warp_werk.cpp src/warp_werk.cpp src/warp_werk_bungee.cpp src/uhr.cpp)
  target_include_directories(test_warp_werk_soll_nach_schreibe_eng PRIVATE include tests ${DJK}/vertrag)
  target_compile_definitions(test_warp_werk_soll_nach_schreibe_eng PRIVATE CYPHERDJ_MUTATION_WARP_SOLL_NACH_SCHREIBE_ENG=1 CYPHERDJ_BUNGEE=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_warp_werk_soll_nach_schreibe_eng PRIVATE PkgConfig::JACK Threads::Threads cypherdj::dsp cypherdj::stellwerk cypherdj_dsp_messer cypherdj::json
                        PkgConfig::CRYPTO cypherdj::hand cypherdj::bungee)
endif()
kern_mutation(cypherdj-kern-mutation-drift CYPHERDJ_MUTATION_DECK_DRIFT)
# Scheibe 31, Fehlerfall der Abnahme: Deck-Start am Blockanfang statt am Sample des Ziel-Beats. test_kern_deck gegen die
# Mutation muss scheitern (Klick und Quittung 2 am Blockanfang); der Kern damit fährt start_quell_beat rot.
kern_mutation(cypherdj-kern-mutation-start CYPHERDJ_MUTATION_START_BLOCKANFANG)
test_mutation(test_kern_deck_mutation test_kern_deck CYPHERDJ_MUTATION_START_BLOCKANFANG
              src/kern.cpp src/erzeuger.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/kern_stellwerk.cpp src/kern_arr.cpp ${ARR_QUELLEN} src/kern_deck.cpp src/kern_mix.cpp src/mixer.cpp src/beatfx.cpp src/teile.cpp src/klick.cpp
              src/tempoplan.cpp src/uhr.cpp src/deck.cpp src/lader.cpp src/fassung.cpp src/kern_hand.cpp src/hand_ein.cpp
              stub/dehner_stub.cpp)  # Keylock Task 2: Fabrik ohne Rubber Band
# Scheibe 31: Vergleichsmessung der Zykluskosten ohne JACK mit vier spielenden Decks (kein Test; die Messung im Callback
# macht tests/deck/ziel_lauf.py --art kosten).
add_executable(kern_kosten31 tests/kosten/kosten31.cpp)
target_link_libraries(kern_kosten31 PRIVATE cypherdj_kernbib)
# Hörbares Ziehen, Fehlerfall der Messung am Master: die Position springt je Zyklus auf die Hand. test_kern_deck_scrub_messung muss scheitern.
add_executable(test_kern_deck_scrub_messung_mutation tests/test_kern_deck_scrub_messung.cpp src/deck.cpp)
target_include_directories(test_kern_deck_scrub_messung_mutation PRIVATE include tests)
target_compile_definitions(test_kern_deck_scrub_messung_mutation PRIVATE CYPHERDJ_MUTATION_SCRUB_OHNE_GLAETTUNG=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_kern_deck_scrub_messung_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_kern_deck_scrub_messung_mutation COMMAND test_kern_deck_scrub_messung_mutation)
set_tests_properties(test_kern_deck_scrub_messung_mutation PROPERTIES WILL_FAIL TRUE)
# Hörbares Ziehen, Negativ-Kontrolle: Summe über das Master-Bitmuster einer festen Deck-Folge ohne Ziehen; vor und nach dem Ziehen gleich.
add_executable(kern_deck_bitdump tests/kosten/deck_bitdump.cpp)
target_link_libraries(kern_deck_bitdump PRIVATE cypherdj_kernbib)
target_compile_definitions(kern_deck_bitdump PRIVATE CYPHERDJ_DJK="${DJK}")
# Hörbares Ziehen: Vergleichsmessung der Zykluskosten ohne JACK mit und ohne Ziehen (kein Test; Zahlen in den Bericht).
add_executable(kern_kosten_scrub tests/kosten/kosten_scrub.cpp)
target_link_libraries(kern_kosten_scrub PRIVATE cypherdj_kernbib)
target_compile_definitions(kern_kosten_scrub PRIVATE CYPHERDJ_DJK="${DJK}")
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

# L3 (Paket 0.3): alle Namenslisten (Tasten, Deck-Aktionen, Regler) gegeneinander. Der Hand-Unterordner baut seine Tests
# nur allein (HAND_TESTS), also steht der Test auch hier; rein Text, ohne Build.
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/../vertrag/pruefe_namenslisten.py)
  add_test(NAME namenslisten_gegen_vertrag
           COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/../vertrag/pruefe_namenslisten.py"
                   --wurzel "${CMAKE_CURRENT_SOURCE_DIR}/../..")
  set_tests_properties(namenslisten_gegen_vertrag PROPERTIES SKIP_RETURN_CODE 77)   # public repo: English contract only
endif()

# 1.10 slice 4a T1: the generated insert files equal what docs/schnittstellen/insert_module.json produces, and its ranges equal
# presets/geraete.ts (the plugin ranges). Text only, no build. The C++ side is test_insert_vertrag in the stellwerk project.
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/../vertrag/erzeuge_insert.py)
  add_test(NAME insert_vokabular_aktuell
           COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/../vertrag/erzeuge_insert.py" --pruefe)
endif()

# 1.10 slice 5 U2a (plan E20): the generated key rule files equal what docs/schnittstellen/schluessel_regeln.json produces. Text only, no build. The C++ side of the cells is
# test_arr_schluessel case 10 (every cell and every case of the file against the loader).
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/../vertrag/erzeuge_schluessel.py)
  add_test(NAME schluessel_regeln_aktuell
           COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/../vertrag/erzeuge_schluessel.py" --pruefe)
endif()

# Scheibe 35, Fehlerfall der Abnahme (Plan 35 E2): das MIDI-Ereignis wirkt am Anfang des Folgeblocks statt an seinem
# Versatz (sample = s0 + n, wie 19 M01). test_kern_midi gegen diese Mutation muss scheitern (Griff bei 142 848 statt
# 142 777); cypherdj-kern-mutation-folgeblock ist der Kern für den Fehlerfall am Ziel.
set(KERN_QUELLEN35_OHNE_DEHNER src/kern.cpp src/erzeuger.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/kern_stellwerk.cpp src/kern_arr.cpp ${ARR_QUELLEN} src/kern_deck.cpp src/kern_mix.cpp src/kern_hand.cpp src/hand_ein.cpp src/mixer.cpp src/beatfx.cpp
    src/teile.cpp src/klick.cpp src/tempoplan.cpp src/uhr.cpp src/deck.cpp src/lader.cpp src/fassung.cpp)
# Keylock Task 2 (Vertrag 13): kern_deck.cpp ruft die Fabrik dehner_neu; ohne Rubber Band liefert der Stub nullptr.
set(KERN_QUELLEN35 ${KERN_QUELLEN35_OHNE_DEHNER} stub/dehner_stub.cpp)
kern_mutation(cypherdj-kern-mutation-folgeblock CYPHERDJ_MUTATION_HAND_FOLGEBLOCK)
test_mutation(test_kern_midi_mutation test_kern_midi CYPHERDJ_MUTATION_HAND_FOLGEBLOCK ${KERN_QUELLEN35})
# D1 K1: erz/4 reserviert; mit dem Rückweg rueck_erz_4 wie vorher muss test_kern_arr_erz4 scheitern
test_mutation(test_kern_arr_erz4_mutation test_kern_arr_erz4 CYPHERDJ_MUTATION_ARR_RUECK_ERZ4 ${KERN_QUELLEN35}
              src/arr_wiedergabe.cpp)
# D1 K1 Review: ARR_ALT ohne Platz bei vollem Ereignisring (verloren wie melde); test_kern_arr Fall 10 muss scheitern
test_mutation(test_kern_arr_ring_mutation test_kern_arr CYPHERDJ_MUTATION_ARR_ALT_OHNE_PLATZ ${KERN_QUELLEN35}
              src/arr_wiedergabe.cpp)
# D1 K1 Review: ein wartender Start, der ohne Einsatz endet, bliebe ohne Endquittung; test_kern_arr Fall 11 muss scheitern
test_mutation(test_kern_arr_quittung_mutation test_kern_arr CYPHERDJ_MUTATION_ARR_START_ID_UEBERSCHRIEBEN ${KERN_QUELLEN35}
              src/arr_wiedergabe.cpp)
test_mutation(test_kern_erzeuger_mutation test_kern_erzeuger CYPHERDJ_MUTATION_ERZ_BLOCKANFANG ${KERN_QUELLEN35})
# Plan fx-wege Slice 2, Fehlerfall der Reihenfolge: FX2 liefe vor FX1. test_kern_fx (Fall 8) muss dagegen scheitern.
test_mutation(test_kern_fx_reihenfolge_mutation test_kern_fx CYPHERDJ_MUTATION_FX_EINHEITEN_VERTAUSCHT ${KERN_QUELLEN35})
# Ohr T17, Fehlerfall FX-Routing: der Weg wird ohne Gleiten getauscht und die Echo-Leitung sofort geleert. test_kern_fx_routing
# (Fall 2, Sprung im Umschaltfenster) muss dagegen scheitern.
test_mutation(test_kern_fx_routing_hart_mutation test_kern_fx_routing CYPHERDJ_MUTATION_FX_ROUTING_HART ${KERN_QUELLEN35})
# Baukasten S3c Task 5: Befehl /k/kanal/graph. test_kern_kanal_graph (Kern bis Mixer) muss gegen jede dieser Mutationen sauber
# scheitern (PRUEF, kein Absturz): Graph nicht gesetzt, Graph im KI-Stopp oder bei falschem Kanal nicht zurückgegeben (Leck),
# KI-Stopp ohne Riegel, abgelöste Graphen nicht abgeholt, abgeholte doppelt gemeldet (Doppel-Free im Netz-Faden),
# ein Burst über die Ablage nicht sofort abgeholt (Leck).
# S14: case 16 of test_kern_kanal_graph calls Kern::regler_setzen / regler_uebernehmen (kern_zustand.cpp), which the common mutation source list does not carry
set(KERN_QUELLEN35_KG ${KERN_QUELLEN35} src/kern_zustand.cpp src/kern_deck_zustand.cpp)
foreach(mut NICHT_SETZEN KI_LECK KI_OFFEN BEREICH_LECK NICHT_ABHOLEN DOPPELT BURST_LECK)
  string(TOLOWER ${mut} mut_klein)
  test_mutation(test_kern_kanal_graph_${mut_klein}_mutation test_kern_kanal_graph CYPHERDJ_MUTATION_KANAL_GRAPH_${mut} ${KERN_QUELLEN35_KG})
endforeach()
# Baukasten S6 Task 2: fx/3, fx/4 in the core command. Only the send path is mutated: graph not set, leaked on KI stop,
# fx/<n> out-of-range leak, fx/3 <-> fx/4 swapped; test_kern_kanal_graph (cases 10..14) must fail against each.
foreach(mut NICHT_GESETZT KI_LECK BEREICH_LECK FALSCHER_BUS)
  string(TOLOWER ${mut} mut_klein)
  test_mutation(test_kern_kanal_graph_fx_${mut_klein}_mutation test_kern_kanal_graph CYPHERDJ_MUTATION_FX_GRAPH_${mut} ${KERN_QUELLEN35_KG})
endforeach()
# S14: fx/3 never hears deck/3/bk/* (case 14, case 15).
test_mutation(test_kern_kanal_graph_send_nutzt_deck_regler_mutation test_kern_kanal_graph CYPHERDJ_MUTATION_BK_SEND_NUTZT_DECK_REGLER ${KERN_QUELLEN35_KG})
# S14: the kern ctor maps fx/3|4/bk/<n> to rows 18, 19; case 15 must fail when it skips them, shifts them or the rows are swapped.
foreach(mut KERN_OHNE_ZEILE KERN_ZEILE_FALSCH ZEILE_VERTAUSCHT OHNE_REGLER)
  string(TOLOWER ${mut} mut_klein)
  test_mutation(test_kern_kanal_graph_send_${mut_klein}_mutation test_kern_kanal_graph CYPHERDJ_MUTATION_BK_SEND_${mut} ${KERN_QUELLEN35_KG})
endforeach()
# S14 task 3 (pin): graph knob values that arrive by regler_setzen / regler_uebernehmen must reach the send graph (case 16).
test_mutation(test_kern_kanal_graph_bk_zustand_ohne_wert_mutation test_kern_kanal_graph CYPHERDJ_MUTATION_BK_ZUSTAND_OHNE_WERT ${KERN_QUELLEN35_KG})
# Baukasten S5r Task 3: die Graph-Regler bis in den Effekt-Graphen (Fall 9); nicht gemeldet, falscher Kanal, Tausch ohne Wert.
foreach(mut NICHT_GEMELDET FALSCHER_KANAL TAUSCH_05)
  string(TOLOWER ${mut} mut_klein)
  test_mutation(test_kern_kanal_graph_regler_${mut_klein}_mutation test_kern_kanal_graph CYPHERDJ_MUTATION_BK_REGLER_${mut} ${KERN_QUELLEN35_KG})
endforeach()
# S23 case 17: a plan of chained ramps on a graph knob must reach the graph; the failure case drops a change below 0.005 inside one block (slow ramps stand still).
test_mutation(test_kern_kanal_graph_bk_rampe_totzone_mutation test_kern_kanal_graph CYPHERDJ_MUTATION_BK_RAMPE_TOTZONE ${KERN_QUELLEN35_KG})
# Dasselbe im Netz: netz_erz.cpp mutiert als eigenes Objekt vor der Bibliothek (Muster test_netz_arr_erz4_mutation);
# test_netz_erz muss scheitern, wenn kein_eingang, die Latenz oder der Kanalbereich nicht mehr geprüft werden.
foreach(mut NETZ_EINGANG_OFFEN NETZ_LATENZ_OFFEN NETZ_BEREICH_OFFEN)
  string(TOLOWER ${mut} mut_klein)
  add_executable(test_netz_erz_kanal_graph_${mut_klein}_mutation tests/test_netz_erz.cpp src/netz_erz.cpp)
  target_include_directories(test_netz_erz_kanal_graph_${mut_klein}_mutation PRIVATE include tests)
  target_compile_definitions(test_netz_erz_kanal_graph_${mut_klein}_mutation PRIVATE CYPHERDJ_MUTATION_KANAL_GRAPH_${mut}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_netz_erz_kanal_graph_${mut_klein}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_netz_erz_kanal_graph_${mut_klein}_mutation COMMAND test_netz_erz_kanal_graph_${mut_klein}_mutation)
  set_tests_properties(test_netz_erz_kanal_graph_${mut_klein}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# Baukasten S10 Task 3: lade_bk übergibt die Sample-Wurzel <bk_ordner>/samples; test_netz_erz muss scheitern, wenn sie nicht
# übergeben wird oder ohne /samples ankommt.
foreach(mut OHNE_WURZEL WURZEL_OHNE_SAMPLES)
  string(TOLOWER ${mut} mut_klein)
  add_executable(test_netz_erz_bk_sampler_${mut_klein}_mutation tests/test_netz_erz.cpp src/netz_erz.cpp)
  target_include_directories(test_netz_erz_bk_sampler_${mut_klein}_mutation PRIVATE include tests)
  target_compile_definitions(test_netz_erz_bk_sampler_${mut_klein}_mutation PRIVATE CYPHERDJ_MUTATION_BK_SAMPLER_${mut}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_netz_erz_bk_sampler_${mut_klein}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_netz_erz_bk_sampler_${mut_klein}_mutation COMMAND test_netz_erz_bk_sampler_${mut_klein}_mutation)
  set_tests_properties(test_netz_erz_bk_sampler_${mut_klein}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# Baukasten S12 task 1: `bk:` (empty name) replays the stored non-graph target; test_netz_erz must fail when the stored target
# is overwritten by graph targets, the stored kanal is ignored, a missing target is answered with success, or the replay is gone.
foreach(mut LEER_VORHER_UEBERSCHRIEBEN LEER_KANAL_EINGANG LEER_OHNE_VORHER_ERFOLG LEER_OHNE_REPLAY)
  string(TOLOWER ${mut} mut_klein)
  add_executable(test_netz_erz_bk_${mut_klein}_mutation tests/test_netz_erz.cpp src/netz_erz.cpp)
  target_include_directories(test_netz_erz_bk_${mut_klein}_mutation PRIVATE include tests)
  target_compile_definitions(test_netz_erz_bk_${mut_klein}_mutation PRIVATE CYPHERDJ_MUTATION_BK_${mut}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_netz_erz_bk_${mut_klein}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_netz_erz_bk_${mut_klein}_mutation COMMAND test_netz_erz_bk_${mut_klein}_mutation)
  set_tests_properties(test_netz_erz_bk_${mut_klein}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# Baukasten S16: the net-thread graph mirror; test_netz_graph must fail when a change applies without its quittung, a refusal
# applies, a kit/midi announce keeps the graph, frage skips empty slots, or a quittung matches by id alone.
foreach(mut OHNE_QUITTUNG AUCH_AUF_6 KIT_BLEIBT FRAGE_NUR_BELEGT OHNE_QUELLE)
  string(TOLOWER ${mut} mut_klein)
  add_executable(test_netz_graph_${mut_klein}_mutation tests/test_netz_graph.cpp src/netz_graph.cpp)
  target_include_directories(test_netz_graph_${mut_klein}_mutation PRIVATE include tests)
  target_compile_definitions(test_netz_graph_${mut_klein}_mutation PRIVATE CYPHERDJ_MUTATION_GRAPH_${mut}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_netz_graph_${mut_klein}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_netz_graph_${mut_klein}_mutation COMMAND test_netz_graph_${mut_klein}_mutation)
  set_tests_properties(test_netz_graph_${mut_klein}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
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

# S19 (MIDI learn): failure cases of the learn table; every one of these tests must fail (WILL_FAIL).
# slot 1 is acknowledged but not swapped (test_kern_lernen case 5)
test_mutation(test_kern_lernen_tausch_mutation test_kern_lernen CYPHERDJ_MUTATION_LERN_NICHT_TAUSCHEN ${KERN_QUELLEN35})
# hand_in events without a slot-0 entry also reach the learn table (case 3)
test_mutation(test_kern_lernen_hand_in_mutation test_kern_lernen CYPHERDJ_MUTATION_LERN_AUCH_HAND_IN ${KERN_QUELLEN35})
# one allocation per translated midi_ein_1 event: the allocation guard of test_kern_midi case 3 must fire
test_mutation(test_kern_midi_lern_alloc_mutation test_kern_midi CYPHERDJ_MUTATION_LERN_ALLOKIERT ${KERN_QUELLEN35})
# the net thread always answers slot 0 for geraet "lernen" (test_netz_lernen case 7); own object as in test_netz_ein_mutation
add_executable(test_netz_lernen_slot_mutation tests/test_netz_lernen.cpp src/netz.cpp)
target_include_directories(test_netz_lernen_slot_mutation PRIVATE include tests ${DJK}/vertrag)
target_compile_definitions(test_netz_lernen_slot_mutation PRIVATE CYPHERDJ_MUTATION_LERN_FALSCHER_SLOT=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_lernen_slot_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_lernen_slot_mutation COMMAND test_netz_lernen_slot_mutation)
set_tests_properties(test_netz_lernen_slot_mutation PROPERTIES WILL_FAIL TRUE)
# S19 capture: failure cases (each must fail)
test_mutation(test_kern_lernen_dauerhaft_mutation test_kern_lernen CYPHERDJ_MUTATION_LERN_DAUERHAFT ${KERN_QUELLEN35})      # stays armed after the report
test_mutation(test_kern_lernen_belegt_mutation test_kern_lernen CYPHERDJ_MUTATION_LERN_OHNE_BELEGT ${KERN_QUELLEN35})        # belegt always 0
test_mutation(test_kern_lernen_weitergereicht_mutation test_kern_lernen CYPHERDJ_MUTATION_LERN_WEITERGEREICHT ${KERN_QUELLEN35})  # captured CC also moves the knob
test_mutation(test_kern_lernen_frist_mutation test_kern_lernen CYPHERDJ_MUTATION_LERN_OHNE_FRIST ${KERN_QUELLEN35})          # no timeout
test_mutation(test_kern_lernen_nie_scharf_mutation test_kern_lernen CYPHERDJ_MUTATION_LERN_NIE_SCHARF ${KERN_QUELLEN35})      # acknowledged, never armed
# the net thread swaps kanal and nr on the wire (test_netz_lernen case 16); own object as above
add_executable(test_netz_lernen_gelernt_mutation tests/test_netz_lernen.cpp src/netz.cpp)
target_include_directories(test_netz_lernen_gelernt_mutation PRIVATE include tests ${DJK}/vertrag)
target_compile_definitions(test_netz_lernen_gelernt_mutation PRIVATE CYPHERDJ_MUTATION_LERN_GELERNT_VERTAUSCHT=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_lernen_gelernt_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_lernen_gelernt_mutation COMMAND test_netz_lernen_gelernt_mutation)
set_tests_properties(test_netz_lernen_gelernt_mutation PROPERTIES WILL_FAIL TRUE)

# Scheibe 35, /pegel: der Kern für den Fehlerfall am Ziel (0 /pegel) und der Test gegen dieselbe Mutation (muss scheitern).
kern_mutation(cypherdj-kern-mutation-kein-pegel CYPHERDJ_MUTATION_KEIN_PEGEL)
test_mutation(test_kern_pegel_mutation test_kern_pegel CYPHERDJ_MUTATION_KEIN_PEGEL ${KERN_QUELLEN35})

# Keylock Task 2: Fehlerfälle gegen test_deck_keylock. Der Test fährt auch einen Kern-Neustart (Test 8, Zustandsdatei) und
# braucht darum alle Kern-Quellen samt dehner.cpp und Rubber Band.
function(deck_keylock_mutation name schalter)
  kern_mut_exe(${name} QUELLEN tests/test_deck_keylock.cpp ${KERN_QUELLEN} SCHALTER ${schalter} DEFS CYPHERDJ_DJK="${DJK}"
               INCLUDES include tests ${DJK}/vertrag LIBS ${KERN_MUT_LIBS})
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
  kern_mut_exe(${name} QUELLEN tests/test_loopbox_keylock.cpp ${KERN_QUELLEN} SCHALTER ${schalter} DEFS CYPHERDJ_DJK="${DJK}"
               INCLUDES include tests ${DJK}/vertrag LIBS ${KERN_MUT_LIBS})
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
kern_mut_exe(test_kern_box_keylock_zaehler_mutation QUELLEN tests/test_kern_box_keylock.cpp ${KERN_QUELLEN}
             SCHALTER CYPHERDJ_MUTATION_BOX_ZAEHLER_VERTAUSCHT DEFS CYPHERDJ_DJK="${DJK}"
             INCLUDES include tests ${DJK}/vertrag LIBS ${KERN_MUT_LIBS})
add_test(NAME test_kern_box_keylock_zaehler_mutation COMMAND test_kern_box_keylock_zaehler_mutation k4)
set_tests_properties(test_kern_box_keylock_zaehler_mutation PROPERTIES WILL_FAIL TRUE TIMEOUT 300)
# Keylock Task 2.5: Fehlerfälle gegen test_kern_keylock_faeden (Kern mit echten Fäden, alle Kern-Quellen samt dehner.cpp).
# Je Ziel nur der betroffene Test (Argument), damit der rote Lauf nicht die übrigen mitfährt.
function(kern_keylock_faeden_mutation name schalter test)
  kern_mut_exe(${name} QUELLEN tests/test_kern_keylock_faeden.cpp ${KERN_QUELLEN} SCHALTER ${schalter} DEFS CYPHERDJ_DJK="${DJK}"
               INCLUDES include tests ${DJK}/vertrag LIBS ${KERN_MUT_LIBS})
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
  kern_mut_exe(${name} QUELLEN tests/test_deck_geplant.cpp ${KERN_QUELLEN} SCHALTER ${schalter} DEFS CYPHERDJ_DJK="${DJK}"
               INCLUDES include tests ${DJK}/vertrag LIBS ${KERN_MUT_LIBS})
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
  kern_mut_exe(${name} QUELLEN tests/test_deck_geplant.cpp ${KERN_QUELLEN} SCHALTER CYPHERDJ_PRUEF_GEN ${ARGN}
               DEFS CYPHERDJ_DJK="${DJK}" INCLUDES include tests ${DJK}/vertrag LIBS ${KERN_MUT_LIBS})
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
# Effekt-Sektion 2026-10-11: ein neuer Abonnent bekommt den gemerkten Stand der Regler und Boxen nicht: test_netz_deck rot.
kern_mut_exe(test_netz_deck_stand_mutation QUELLEN tests/test_netz_deck.cpp ${KERN_QUELLEN} SCHALTER CYPHERDJ_MUTATION_HALLO_OHNE_STAND
             DEFS CYPHERDJ_DJK="${DJK}" INCLUDES include tests ${DJK}/vertrag LIBS ${KERN_MUT_LIBS})
add_test(NAME test_netz_deck_stand_mutation COMMAND test_netz_deck_stand_mutation)
set_tests_properties(test_netz_deck_stand_mutation PROPERTIES WILL_FAIL TRUE)

# 1.15 A5c: the first /k/hallo of a generation carries /e/kanal_limiter; without it test_netz_kanal_limiter (H1, H2) must fail.
add_executable(test_netz_kanal_limiter_mutation tests/test_netz_kanal_limiter.cpp src/netz.cpp)   # netz.cpp mutated as its own object before the library (pattern test_kern_arr_ki_mutation)
target_include_directories(test_netz_kanal_limiter_mutation PRIVATE include tests)
target_compile_definitions(test_netz_kanal_limiter_mutation PRIVATE CYPHERDJ_MUTATION_HALLO_OHNE_KANAL_LIMITER=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_kanal_limiter_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_kanal_limiter_mutation COMMAND test_netz_kanal_limiter_mutation)
set_tests_properties(test_netz_kanal_limiter_mutation PROPERTIES WILL_FAIL TRUE)

# D1 K1: Fehlerfälle des Moduls Arrangement und des Wiedergabe-Laders (WILL_FAIL: der Test muss sie sehen)
test_mutation(test_arr_transport_vorhalt_mutation test_arr_transport CYPHERDJ_MUTATION_ARR_START_OHNE_VORHALT ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_transport_naht_mutation test_arr_transport CYPHERDJ_MUTATION_ARR_NAHT_BLOCKANFANG ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_transport_klammer_mutation test_arr_transport CYPHERDJ_MUTATION_ARR_KLAMMER_OHNE_START ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_transport_hinter_kopf_mutation test_arr_transport CYPHERDJ_MUTATION_ARR_KLAMMER_HINTER_KOPF ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_transport_naht_zyklus_mutation test_arr_transport CYPHERDJ_MUTATION_ARR_KLAMMER_NAHT_ZYKLUS ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_clips_einsatz_mutation test_arr_clips CYPHERDJ_MUTATION_ARR_CLIP_BLOCKANFANG ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_clips_einstieg_mutation test_arr_clips CYPHERDJ_MUTATION_ARR_EINSTIEG_OHNE_RAMPE ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_clips_naht_mutation test_arr_clips CYPHERDJ_MUTATION_ARR_NAHT_HART ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_clips_tausch_mutation test_arr_clips CYPHERDJ_MUTATION_ARR_TAUSCH_OHNE_BINDUNG ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_mixer_mute_mutation test_arr_mixer CYPHERDJ_MUTATION_ARR_MUTE_HART ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_mixer_pan_mutation test_arr_mixer CYPHERDJ_MUTATION_ARR_PAN_LINEAR ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_gruppen_ziel_mutation test_arr_gruppen CYPHERDJ_MUTATION_ARR_ZIEL_IGNORIERT ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_gruppen_hart_mutation test_arr_gruppen CYPHERDJ_MUTATION_ARR_ZIEL_HART ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_gruppen_pm_mutation test_arr_gruppen CYPHERDJ_MUTATION_ARR_PM_FADER_AUS ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_gruppen_mute_mutation test_arr_gruppen CYPHERDJ_MUTATION_ARR_MUTE_HART ${ARR_QUELLEN} src/uhr.cpp)
# 1.10 Slice 3 Task 5a: sends and return strips
test_mutation(test_arr_returns_hall_tot_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_HALL_TOT ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_returns_hall_ohne_ausklang_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_HALL_OHNE_AUSKLANG ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_returns_hall_setze_jeden_block_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_HALL_SETZE_JEDEN_BLOCK ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_returns_hall_erste_entprellt_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_HALL_ERSTE_ENTPRELLT ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_returns_hall_kein_kredit_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_HALL_KEIN_KREDIT ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_returns_hall_zufall_uhr_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_HALL_ZUFALL_UHR ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_returns_hall_state_im_snapshot_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_HALL_STATE_IM_SNAPSHOT ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_returns_hall_ohne_join_mutation test_arr_returns CYPHERDJ_MUTATION_HALL_OHNE_JOIN ${ARR_QUELLEN} src/uhr.cpp)   # mehrkern task 4: returns_pool_bitgleich must go red
test_mutation(test_arr_returns_send_pre_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_SEND_PRE ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_returns_send_ohne_mute_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_SEND_OHNE_MUTE ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_returns_send_ohne_gruppen_blende_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_SEND_OHNE_GRUPPEN_BLENDE ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_returns_ret_nach_pm_fader_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_RET_NACH_PM_FADER ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_returns_ret_solo_aus_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_RET_SOLO_AUS ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_returns_ruhe_schneidet_ab_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_RUHE_SCHNEIDET_AB ${ARR_QUELLEN} src/uhr.cpp)
# 1.10 slice 4a T2: insert chains in the strip (test_arr_inserts; the loader case needs arr_wiedergabe.cpp). Each mutation turns its named case red (INS_GRUPPE_UEBERSPRUNGEN also case 6, which counts the group stage in its checks).
test_mutation(test_arr_inserts_nach_fader_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_NACH_FADER ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)       # case 1
test_mutation(test_arr_inserts_pre_nach_fader_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_PRE_NACH_FADER ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp) # case 3
test_mutation(test_arr_inserts_pre_ohne_mute_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_PRE_OHNE_MUTE ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 3
test_mutation(test_arr_inserts_tausch_leert_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_TAUSCH_LEERT ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)     # case 4
test_mutation(test_arr_inserts_nan_durchlass_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_NAN_DURCHLASS ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 5
test_mutation(test_arr_inserts_bypass_sprung_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_BYPASS_SPRUNG ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 2
test_mutation(test_arr_inserts_gruppe_uebersprungen_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_GRUPPE_UEBERSPRUNGEN ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 8
test_mutation(test_arr_inserts_gruppe_pre_nach_fader_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_GRUPPE_PRE_NACH_FADER ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 8
test_mutation(test_arr_inserts_ret_vor_hall_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_RET_VOR_HALL ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 9
test_mutation(test_arr_inserts_pm_nach_fader_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_PM_NACH_FADER ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 10
test_mutation(test_arr_inserts_sc_ignoriert_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_SC_IGNORIERT ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 12 sidechain_kick
test_mutation(test_arr_inserts_sc_nach_kette_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_SC_NACH_KETTE ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 12 sc_vor_kette
test_mutation(test_arr_inserts_sc_nan_durchlass_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_SC_NAN_DURCHLASS ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 12 sc_nan
test_mutation(test_arr_inserts_pre_sprung_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_PRE_SPRUNG ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 13
test_mutation(test_arr_inserts_nan_nur_proben_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_NAN_NUR_PROBEN ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 14
test_mutation(test_arr_inserts_gruppe_leer_laeuft_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_GRUPPE_LEER_LAEUFT ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 15
test_mutation(test_arr_inserts_mix0_gr_steht_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_MIX0_GR_STEHT ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 15
# 1.10 slice 4b T12: eq and saturator inserts (test_arr_inserts_4b). Each mutation turns its named case red.
test_mutation(test_arr_inserts_4b_eq_band_vertauscht_mutation test_arr_inserts_4b CYPHERDJ_MUTATION_INS_EQ_BAND_VERTAUSCHT ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)       # case 2 (and the b8 binding of case 1)
test_mutation(test_arr_inserts_4b_saett_aus_nach_drive_mutation test_arr_inserts_4b CYPHERDJ_MUTATION_INS_SAETT_AUS_NACH_DRIVE ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp) # case 4
test_mutation(test_arr_inserts_4b_pool_plus_eins_mutation test_arr_inserts_4b CYPHERDJ_MUTATION_INS_POOL_PLUS_EINS ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)           # case 5
test_mutation(test_arr_inserts_4b_nan_durchlass_mutation test_arr_inserts_4b CYPHERDJ_MUTATION_INS_NAN_DURCHLASS ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)               # case 8
test_mutation(test_arr_inserts_4b_komp_hash_nach_fader_mutation test_arr_inserts_4b_komp_hash CYPHERDJ_MUTATION_INS_NACH_FADER ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # negative control: the komp-only result of 4a changes with the stage after the fader
# Master limiter insert (test_arr_inserts_lim): the stage ignores the decke row and stays at -1 dB; the -6 dB assertion of case 1 goes red.
test_mutation(test_arr_inserts_lim_decke_fest_mutation test_arr_inserts_lim CYPHERDJ_MUTATION_INS_LIM_DECKE_FEST ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 1
# 1.10 slice 4b T13: latency compensation (test_arr_pdc). Each mutation turns its named case red.
test_mutation(test_arr_pdc_fehlt_mutation test_arr_pdc CYPHERDJ_MUTATION_PDC_FEHLT_TABELLE ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)           # case 1 (four paths), 2, 3, 4, 5, 7
test_mutation(test_arr_pdc_doppelt_mutation test_arr_pdc CYPHERDJ_MUTATION_PDC_DOPPELT ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)               # case 1: the send path delayed twice
test_mutation(test_arr_pdc_nur_bei_an_mutation test_arr_pdc CYPHERDJ_MUTATION_PDC_NUR_BEI_AN ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)         # case 2: the delay depends on the project flag an
test_mutation(test_arr_pdc_bypass_ohne_latenz_mutation test_arr_pdc CYPHERDJ_MUTATION_INS_BYPASS_OHNE_LATENZ ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 2: a stage that is fully off does not delay
test_mutation(test_arr_pdc_block_neu_mutation test_arr_pdc CYPHERDJ_MUTATION_PDC_BLOCK_NEU ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)           # case 6: the ring is dropped at every block
test_mutation(test_arr_pdc_metronom_mutation test_arr_pdc CYPHERDJ_MUTATION_METRONOM_PDC_FEHLT ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)       # case 7: the click ignores the latency
test_mutation(test_arr_pdc_allokation_mutation test_arr_pdc CYPHERDJ_MUTATION_PDC_ALLOKATION ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)               # case 9: the ring code allocates in the callback
# 1.10 slice 4c T15: rack macros (test_arr_rack). Each mutation turns its named case red.
test_mutation(test_arr_rack_vertauscht_mutation test_arr_rack CYPHERDJ_MUTATION_MAKRO_VERTAUSCHT ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)       # case 1: von and bis swapped
test_mutation(test_arr_rack_row_gewinnt_mutation test_arr_rack CYPHERDJ_MUTATION_MAKRO_ROW_GEWINNT ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)     # case 2: a written row wins over the macro
test_mutation(test_arr_rack_spaet_mutation test_arr_rack CYPHERDJ_MUTATION_MAKRO_SPAET ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)                   # case 3: the move acts one block late
test_mutation(test_arr_rack_limit_17_mutation test_arr_rack CYPHERDJ_MUTATION_MAKRO_LIMIT_17 ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)             # case 4: the 17th target is cut silently
test_mutation(test_arr_rack_bleibt_mutation test_arr_rack CYPHERDJ_MUTATION_MAKRO_BLEIBT ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)                 # case 5: the override stays after the rack has gone
# 1.10 slice 5 U1: structural sidechain key track post, track order, key buffer zeroing (test_arr_schluessel). Each mutation turns its named case red.
test_mutation(test_arr_schluessel_post_vor_fader_mutation test_arr_schluessel CYPHERDJ_MUTATION_SC_POST_VOR_FADER ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)       # case 2 (AK14 core, post case), 3, 5
test_mutation(test_arr_schluessel_ordnung_fest_mutation test_arr_schluessel CYPHERDJ_MUTATION_SC_ORDNUNG_FEST ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)           # case 4: the order is ignored
test_mutation(test_arr_schluessel_struktur_ignoriert_mutation test_arr_schluessel CYPHERDJ_MUTATION_SC_STRUKTUR_IGNORIERT ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 2 (post at fader 0), 1, 4, 5
test_mutation(test_arr_schluessel_kein_nullen_mutation test_arr_schluessel CYPHERDJ_MUTATION_SC_KEIN_NULLEN ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)             # cases 6, 14, 15: the buffer keeps the block before
# 1.10 slice 5 U2a: key rules as data, group and return sources, silent-source cases.
test_mutation(test_arr_schluessel_gruppe_nach_kette_mutation test_arr_schluessel CYPHERDJ_MUTATION_SC_GRUPPE_NACH_KETTE ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # cases 11, 12: the group pre key is the chain output
test_mutation(test_arr_schluessel_tabelle_offen_mutation test_arr_schluessel CYPHERDJ_MUTATION_SC_TABELLE_OFFEN ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)           # case 10: the loader does not consult the table
test_mutation(test_arr_schluessel_ret_pre_nach_kette_mutation test_arr_schluessel CYPHERDJ_MUTATION_SC_RET_PRE_NACH_KETTE ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 13b: the return pre key is the chain output
# 1.10 slice 5 U2b: DJ sources and key alignment (test_arr_schluessel cases 16 to 21)
test_mutation(test_arr_schluessel_dj_null_mutation test_arr_schluessel CYPHERDJ_MUTATION_SC_DJ_NULL ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)               # case 16: the DJ pointers are ignored
test_mutation(test_arr_schluessel_kein_versatz_mutation test_arr_schluessel CYPHERDJ_MUTATION_SC_KEIN_VERSATZ ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)       # cases 18, 19: no key ring
test_mutation(test_arr_schluessel_versatz_eine_stufe_mutation test_arr_schluessel CYPHERDJ_MUTATION_SC_VERSATZ_EINE_STUFE ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 19: the delay of the nearest stage, not the path sum
# 1.10 slice 4c T15: the export carries the rack macros (test_render_rack). render.cpp as its own mutated object: rack/... is no mixer control of the render (the export
# refuses the rows with `regler`); the test itself drops the rack rows at macro 1 (the 6 dB case goes red).
add_executable(test_render_rack_ohne_rack_pfad_mutation tests/test_render_rack.cpp src/render.cpp)
target_include_directories(test_render_rack_ohne_rack_pfad_mutation PRIVATE include tests)
target_compile_definitions(test_render_rack_ohne_rack_pfad_mutation PRIVATE CYPHERDJ_MUTATION_RENDER_OHNE_RACK_PFAD=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_render_rack_ohne_rack_pfad_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_render_rack_ohne_rack_pfad_mutation COMMAND test_render_rack_ohne_rack_pfad_mutation)
set_tests_properties(test_render_rack_ohne_rack_pfad_mutation PROPERTIES WILL_FAIL TRUE)
add_executable(test_render_rack_ohne_rack_zeilen_mutation tests/test_render_rack.cpp)
target_include_directories(test_render_rack_ohne_rack_zeilen_mutation PRIVATE include tests)
target_compile_definitions(test_render_rack_ohne_rack_zeilen_mutation PRIVATE CYPHERDJ_MUTATION_RENDER_OHNE_RACK_ZEILEN=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_render_rack_ohne_rack_zeilen_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_render_rack_ohne_rack_zeilen_mutation COMMAND test_render_rack_ohne_rack_zeilen_mutation)
set_tests_properties(test_render_rack_ohne_rack_zeilen_mutation PROPERTIES WILL_FAIL TRUE)
# 1.10 slice 4a seam S4: the page's own request through the real loader (daten/wiedergabe_ketten.json). The old page key `master` for the PM chain turns case 1 red.
test_mutation(test_arr_naht_seite_pm_umbenannt_mutation test_arr_naht_seite CYPHERDJ_MUTATION_NAHT_PM_UMBENANNT ${ARR_QUELLEN} src/arr_wiedergabe.cpp src/uhr.cpp)   # case 1
# 1.10 slice 4a seam S3: an export built without the insert rows is >= 6 dB too loud; test_render_ketten (project of daten/wiedergabe_ketten.json) must go red
add_executable(test_render_ketten_ohne_ins_zeilen_mutation tests/test_render_ketten.cpp)
target_include_directories(test_render_ketten_ohne_ins_zeilen_mutation PRIVATE include tests)
target_compile_definitions(test_render_ketten_ohne_ins_zeilen_mutation PRIVATE CYPHERDJ_MUTATION_RENDER_OHNE_INS_ZEILEN=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_render_ketten_ohne_ins_zeilen_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_render_ketten_ohne_ins_zeilen_mutation COMMAND test_render_ketten_ohne_ins_zeilen_mutation)
set_tests_properties(test_render_ketten_ohne_ins_zeilen_mutation PROPERTIES WILL_FAIL TRUE)

test_mutation(test_arr_noten_vorausblick_mutation test_arr_noten CYPHERDJ_MUTATION_ARR_OHNE_VORAUSBLICK ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_noten_tausch_mutation test_arr_noten CYPHERDJ_MUTATION_ARR_TAUSCH_OHNE_NOTE_AUS ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_noten_fenster_mutation test_arr_noten CYPHERDJ_MUTATION_ARR_FENSTER_LINEAR ${ARR_QUELLEN} src/uhr.cpp)
# Automation Slice 1 T5: the cursor of AutoLane is not searched anew after a backward jump (seam, start): the lane test must go red
test_mutation(test_arr_auto_lane_cursor_mutation test_arr_auto_lane CYPHERDJ_MUTATION_ARR_AUTO_CURSOR_ALT)
# Automation Slice 1 T6a/T6b: the core evaluation of the lane (test_arr_auto) goes red under each of these
test_mutation(test_arr_auto_cursor_mutation test_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_CURSOR_ALT ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_auto_beat_linear_mutation test_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_BEAT_LINEAR ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_auto_blende_hart_mutation test_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_BLENDE_HART ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_auto_grund_mutation test_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_GRUND_UEBERSCHRIEBEN ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_auto_lane_null_mutation test_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_LANE_NULL ${ARR_QUELLEN} src/uhr.cpp)   # slice 2: lane 0 taken as the fader lane
# Automation slice 2 task 3: pan, mute and solo lanes in the core
test_mutation(test_arr_auto_pan_blende_hart_mutation test_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_PAN_BLENDE_HART ${ARR_QUELLEN} src/uhr.cpp)   # pan stop without the 480 blend
# Slice 2 optimisation: the look-ahead inside a hold window changes nothing but the cost (test_arr_auto_vorausschau, seam on/off). Each error case makes it red.
test_mutation(test_arr_auto_vorausschau_cursor_mutation test_arr_auto_vorausschau CYPHERDJ_MUTATION_ARR_AUTO_VORAUS_CURSOR ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_auto_vorausschau_naht_mutation test_arr_auto_vorausschau CYPHERDJ_MUTATION_ARR_AUTO_VORAUS_NAHT ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_auto_vorausschau_tol_mutation test_arr_auto_vorausschau CYPHERDJ_MUTATION_ARR_AUTO_VORAUS_TOL ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_auto_ziele_mute_hart_mutation test_arr_auto_ziele CYPHERDJ_MUTATION_ARR_MUTE_HART ${ARR_QUELLEN} src/uhr.cpp)   # AK7: a mute lane edge without the 480 fade
test_mutation(test_arr_auto_ziele_grund_mutation test_arr_auto_ziele CYPHERDJ_MUTATION_ARR_AUTO_GRUND_UEBERSCHRIEBEN ${ARR_QUELLEN} src/uhr.cpp)   # base mute overwritten by the lane value
test_mutation(test_arr_auto_ziele_geraet_erstes_sample_mutation test_arr_auto_ziele CYPHERDJ_MUTATION_ARR_GERAET_ERSTES_SAMPLE ${ARR_QUELLEN} src/uhr.cpp)   # slice 2 task 4: the device lane value at the first running sample of the block
test_mutation(test_arr_auto_ziele_pan_blende_hart_mutation test_arr_auto_ziele CYPHERDJ_MUTATION_ARR_AUTO_PAN_BLENDE_HART ${ARR_QUELLEN} src/uhr.cpp)   # pan lane deleted without the blend
# 1.12 Automation slice 3 task 2: the lane override in the Arrangement (test_arr_auto_eingriff); each error case makes it red
test_mutation(test_arr_auto_eingriff_ohne_blende_mutation test_arr_auto_eingriff CYPHERDJ_MUTATION_ARR_AUTO_UEBER_OHNE_BLENDE ${ARR_QUELLEN} src/uhr.cpp)   # the grip without the 480 source blend
test_mutation(test_arr_auto_eingriff_tausch_loescht_mutation test_arr_auto_eingriff CYPHERDJ_MUTATION_ARR_AUTO_UEBER_TAUSCH_LOESCHT ${ARR_QUELLEN} src/uhr.cpp)   # a snapshot swap with the lane still there clears the override
test_mutation(test_arr_auto_eingriff_im_stopp_mutation test_arr_auto_eingriff CYPHERDJ_MUTATION_ARR_AUTO_UEBER_IM_STOPP ${ARR_QUELLEN} src/uhr.cpp)   # D5: a grip while the transport stands overrides
test_mutation(test_arr_auto_eingriff_freigabe_im_stopp_mutation test_arr_auto_eingriff CYPHERDJ_MUTATION_ARR_AUTO_FREIGABE_IM_STOPP ${ARR_QUELLEN} src/uhr.cpp)   # D6: the re-enable is refused while stopped
test_mutation(test_arr_auto_eingriff_kern_setze_ohne_war_mutation test_arr_auto_eingriff_kern CYPHERDJ_MUTATION_ARR_AUTO_SETZE_OHNE_WAR ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # the page path sets the Stellwerk value although the lane has not played
test_mutation(test_arr_auto_eingriff_zwei_ueberschreibt_mutation test_arr_auto_eingriff CYPHERDJ_MUTATION_ARR_AUTO_UEBER_ZWEI_UEBERSCHREIBT ${ARR_QUELLEN} src/uhr.cpp)   # a second change in a block overwrites the first (jump)
test_mutation(test_arr_auto_eingriff_kern_pickup_immer_mutation test_arr_auto_eingriff_kern CYPHERDJ_MUTATION_ARR_AUTO_UEBER_PICKUP_IMMER ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # the pickup stays true while overridden: every step falls back to the lane value
test_mutation(test_arr_auto_eingriff_kern_nachreichen_griff_mutation test_arr_auto_eingriff_kern CYPHERDJ_MUTATION_ARR_AUTO_UEBER_NACHREICHEN_GRIFF ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # the touches of teile_nachreichen count as grips
# 1.12 Automation slice 3 task 3: /k/arr/auto in the core (test_kern_arr_auto) and in the net thread (test_netz_arr_auto); each error case must make it red
test_mutation(test_kern_arr_auto_cypher_mutation test_kern_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_CYPHER_UEBERSTEUERT ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # D9: the core lets cypher override
test_mutation(test_kern_arr_auto_im_stopp_mutation test_kern_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_UEBER_IM_STOPP ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # D5: the stopped transport takes the override from the command
test_mutation(test_kern_arr_auto_ohne_abgleich_mutation test_kern_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_OHNE_ABGLEICH ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # lost events are not re-reported
test_mutation(test_kern_arr_auto_abgleich_vergisst_mutation test_kern_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_ABGLEICH_VERGISST ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # the re-report forgets the rest when the event ring of the core is full
add_executable(test_netz_arr_auto_cypher_mutation tests/test_netz_arr_auto.cpp src/netz_arr.cpp)   # D9: the net thread lets cypher override; own object as test_netz_arr_erz4_mutation
target_include_directories(test_netz_arr_auto_cypher_mutation PRIVATE include tests)
target_compile_definitions(test_netz_arr_auto_cypher_mutation PRIVATE CYPHERDJ_MUTATION_ARR_AUTO_CYPHER_UEBERSTEUERT=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_arr_auto_cypher_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_arr_auto_cypher_mutation COMMAND test_netz_arr_auto_cypher_mutation)
set_tests_properties(test_netz_arr_auto_cypher_mutation PROPERTIES WILL_FAIL TRUE)
# 1.12 Automation slice 3 task 7: /k/arr/arm and /e/auto_punkt in the core (test_kern_arr_arm) and in the net thread (test_netz_arr_arm); each error case must make it red
test_mutation(test_kern_arr_arm_arm_cypher_mutation test_kern_arr_arm CYPHERDJ_MUTATION_ARR_ARM_CYPHER ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # any source arms (core)
test_mutation(test_kern_arr_arm_ohne_arm_mutation test_kern_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_OHNE_ARM ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # points without any arm
test_mutation(test_kern_arr_arm_alle_spuren_mutation test_kern_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_ALLE_SPUREN ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # one armed track arms them all
test_mutation(test_kern_arr_arm_im_stopp_mutation test_kern_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_IM_STOPP ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # points while the transport stands
test_mutation(test_kern_arr_arm_ohne_drossel_mutation test_kern_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_OHNE_DROSSEL ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # no 50 Hz cap
test_mutation(test_kern_arr_arm_ohne_nachzuegler_mutation test_kern_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_OHNE_NACHZUEGLER ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # no trailing value, the last value of a gesture is lost
test_mutation(test_kern_arr_arm_nachzuegler_erster_mutation test_kern_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_NACHZUEGLER_ERSTER ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # the trailing value is the first of the window, not the newest
test_mutation(test_kern_arr_arm_beat_jetzt_mutation test_kern_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_BEAT_JETZT ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # the beat is taken at the end of the block, not at the grip sample
test_mutation(test_kern_arr_arm_beat_linear_mutation test_kern_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_BEAT_LINEAR ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # the beat ignores the tempo ramp
test_mutation(test_kern_arr_arm_beat_ohne_naht_mutation test_kern_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_BEAT_OHNE_NAHT ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # the beat behind the loop seam keeps the old origin
test_mutation(test_kern_arr_arm_stopp_verwirft_mutation test_kern_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_STOPP_VERWIRFT ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # a held point is dropped at the stop
test_mutation(test_kern_arr_arm_arm_aus_behaelt_mutation test_kern_arr_arm CYPHERDJ_MUTATION_ARR_ARM_AUS_BEHAELT ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # a disarm keeps the held point
test_mutation(test_kern_arr_arm_paarung_erster_mutation test_kern_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_PAARUNG_ERSTER ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # beat of the first grip with the value at the end of the sub-block
test_mutation(test_kern_arr_arm_arm_aus_fenster_neu_mutation test_kern_arr_arm CYPHERDJ_MUTATION_ARR_ARM_AUS_FENSTER_NEU ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # a disarm forgets the rate window
test_mutation(test_kern_arr_arm_voll_verwirft_mutation test_kern_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_VOLL_VERWIRFT ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # a point that finds the event ring full is dropped
add_executable(test_netz_arr_arm_cypher_mutation tests/test_netz_arr_arm.cpp src/netz_arr.cpp)   # the net thread lets every source arm; own object as test_netz_arr_auto_cypher_mutation
target_include_directories(test_netz_arr_arm_cypher_mutation PRIVATE include tests)
target_compile_definitions(test_netz_arr_arm_cypher_mutation PRIVATE CYPHERDJ_MUTATION_ARR_ARM_CYPHER=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_arr_arm_cypher_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_arr_arm_cypher_mutation COMMAND test_netz_arr_arm_cypher_mutation)
set_tests_properties(test_netz_arr_arm_cypher_mutation PROPERTIES WILL_FAIL TRUE)
test_mutation(test_arr_metronom_takt_mutation test_arr_metronom CYPHERDJ_MUTATION_ARR_METRONOM_KERN_TAKT ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_wiedergabe_ref_mutation test_arr_wiedergabe CYPHERDJ_MUTATION_ARR_CACHE_OHNE_REF src/arr_wiedergabe.cpp)
# Paket 1.13 Warp, Slice 1: Fehlerfälle des gewarpten Weges (RE-PITCH) und des /2-Laders; jeder muss den Test rot machen (WILL_FAIL)
test_mutation(test_arr_warp_tausch_mutation test_arr_warp CYPHERDJ_MUTATION_ARR_WARP_TAUSCH_GLEICH ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_warp_naht_mutation test_arr_warp CYPHERDJ_MUTATION_ARR_NAHT_HART ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_warp_dateiende_mutation test_arr_warp CYPHERDJ_MUTATION_ARR_WARP_OHNE_DATEIENDE ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_warp_blockanfang_mutation test_arr_warp CYPHERDJ_MUTATION_ARR_WARP_BLOCKANFANG ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_warp_neustart_mutation test_arr_warp CYPHERDJ_MUTATION_ARR_WARP_NEUSTART_URSPRUNG ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_warp_ausklang_mutation test_arr_warp CYPHERDJ_MUTATION_ARR_WARP_AUSKLANG_URSPRUNG ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_warp_unveraendert_naht_mutation test_arr_warp_unveraendert CYPHERDJ_MUTATION_ARR_NAHT_HART ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_warp_unveraendert_einstieg_mutation test_arr_warp_unveraendert CYPHERDJ_MUTATION_ARR_EINSTIEG_OHNE_RAMPE ${ARR_QUELLEN} src/uhr.cpp)
# Paket 1.13 Warp, Slice 4 (Task 5): BEATS im Callback; jeder Fehlerfall muss test_arr_warp_beats rot machen (WILL_FAIL)
test_mutation(test_arr_warp_beats_kuerzen_mutation test_arr_warp_beats CYPHERDJ_MUTATION_ARR_BEATS_OHNE_KUERZBLENDE ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_warp_beats_varispeed_mutation test_arr_warp_beats CYPHERDJ_MUTATION_ARR_BEATS_VARISPEED ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_warp_beats_luecke_mutation test_arr_warp_beats CYPHERDJ_MUTATION_ARR_BEATS_LUECKE_SPIELT ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_warp_beats_ausklang_mutation test_arr_warp_beats CYPHERDJ_MUTATION_ARR_BEATS_AUSKLANG_WARP ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_warp_beats_gleich_loop_mutation test_arr_warp_beats CYPHERDJ_MUTATION_ARR_WARP_GLEICH_OHNE_LOOP ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_warp_beats_gleich_huelle_mutation test_arr_warp_beats CYPHERDJ_MUTATION_ARR_WARP_GLEICH_OHNE_HUELLE ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_warp_beats_gleich_einheiten_mutation test_arr_warp_beats CYPHERDJ_MUTATION_ARR_WARP_GLEICH_OHNE_EINHEITEN ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_warp_beats_gleich_zahl_mutation test_arr_warp_beats CYPHERDJ_MUTATION_ARR_WARP_GLEICH_OHNE_ZAHL ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_warp_lader_v1_mutation test_arr_warp_lader CYPHERDJ_MUTATION_ARR_WARP_IN_V1 src/arr_wiedergabe.cpp)
test_mutation(test_arr_warp_lader_steigend_mutation test_arr_warp_lader CYPHERDJ_MUTATION_ARR_WARP_OHNE_STEIGEND src/arr_wiedergabe.cpp)
test_mutation(test_arr_warp_lader_grenze_mutation test_arr_warp_lader CYPHERDJ_MUTATION_ARR_WARP_OHNE_GRENZE src/arr_wiedergabe.cpp)
test_mutation(test_arr_warp_lader_pitch_grenze_mutation test_arr_warp_lader CYPHERDJ_MUTATION_ARR_WARP_PITCH_OHNE_GRENZE src/arr_wiedergabe.cpp)
test_mutation(test_arr_warp_lader_gesamt_mutation test_arr_warp_lader CYPHERDJ_MUTATION_ARR_WARP_OHNE_GESAMT src/arr_wiedergabe.cpp)
test_mutation(test_arr_warp_lader_beats_steigend_mutation test_arr_warp_lader CYPHERDJ_MUTATION_ARR_BEATS_OHNE_STEIGEND src/arr_wiedergabe.cpp)
# Paket 1.13 Warp, Slice 3a (Task 4): viele Marker. ERSTES_SEGMENT macht jede Abbildung mit mehr als zwei Markern falsch (Referenzdatei und Abspielen).
test_mutation(test_warp_abbildung_erstes_segment_mutation test_warp_abbildung CYPHERDJ_MUTATION_ARR_WARP_ERSTES_SEGMENT)
# Paket 1.13 Warp, Slice 2: COMPLEX und TONES im Arrangement (test_warp_werk_arr, automatisch eingesammelt): jede Mutation macht ihren Fall rot (WILL_FAIL)
if(CYPHERDJ_BUNGEE)
  set(WARP_WERK_QUELLEN src/warp_werk.cpp src/warp_werk_bungee.cpp cypherdj::bungee)
  # AK33 F4: a gain-only edit on a sounding RE-PITCH, BEATS or plain clip ramps the gain; the old voice swap must turn test_arr_gain_tausch red (WILL_FAIL).
  # The test builds a warp engine for its COMPLEX control case, so the mutation target links the engine sources
  test_mutation(test_arr_gain_tausch_neu_mutation test_arr_gain_tausch CYPHERDJ_MUTATION_ARR_GAIN_TAUSCH_NEU ${ARR_QUELLEN} src/uhr.cpp ${WARP_WERK_QUELLEN})
  # Nachbesserung 3 (Ereignisse im Frist-Fenster, Fälle 10 bis 13): OHNE_DECKUNG bis NAHT_VORFILTER. Nachbesserung 4 (eine Regel für Tausch und Karte, Fall 14):
  # ZWEIMAL_ANSETZEN entfällt (die Regel ist weg), TAUSCH_FREI bis UNGEHOERT kommen dazu (Fall 15). OHNE_PLATZTAUSCH, KETTE_LANG, BRUECKE_BLEIBT und
  # ENDE_ALTE_KARTE macht test_warp_werk_arr nicht rot (gemessen im dritten Beweislauf der Nachbesserung 4): sie haben nur Ziele gegen die Zufallsfolgen (unten)
  # Nachbesserung 5 (Prüfung 5): PLATZ_OHNE_KLANG, SPAET_STILL, EINSATZ_OHNE_SPAET (Fall 16), OHNE_VORRANG (Fall 7 und 10 bei 2 361), STOPP_WARTET_HART (Fall 17);
  # BRUECKE_MINUS_EINS (fable m2) fängt nur der verdichtete Generator der Zufallsfolgen (unten)
  set(WARP_WERK_MUTATIONEN OHNE_VORAUSBLICK START_OHNE_FRIST NAHT_ALLE TAUSCH_HART OHNE_BLENDE KARTE_IGNORIERT OHNE_NACHHOLEN VORFILTER
      OHNE_DECKUNG DECKUNG_ORTLOS KARTE_VOR_EINSATZ KARTE_WARTET STOPP_VOR_EINSATZ EINSTIEG_STUMM EINSTIEG_NAECHSTE EINSTIEG_DOPPELT NAHT_VORFILTER
      TAUSCH_FREI REPITCH_DECKT EINSTIEG_LUECKE GAIN_SPRUNG UEBERGANG_LOCH UNGEHOERT
      PLATZ_OHNE_KLANG SPAET_STILL EINSATZ_OHNE_SPAET OHNE_VORRANG STOPP_WARTET_HART PITCH_GLEICH)
  foreach(m ${WARP_WERK_MUTATIONEN})
    string(TOLOWER ${m} mk)
    test_mutation(test_warp_werk_arr_${mk}_mutation test_warp_werk_arr CYPHERDJ_MUTATION_ARR_WARP_WERK_${m} ${ARR_QUELLEN} src/uhr.cpp ${WARP_WERK_QUELLEN})
  endforeach()
  # Slice 3a (Task 15, E-K B4.2): dieselbe Lage mit 4096 Markern je Clip, 0 Allokationen in Callback und Werk
  if(TARGET test_kern_arr_warp_alloc)
    add_test(NAME test_kern_arr_warp_alloc_4096 COMMAND test_kern_arr_warp_alloc)
    set_tests_properties(test_kern_arr_warp_alloc_4096 PROPERTIES ENVIRONMENT "ALLOC_MARKER=4096")
  endif()
  test_mutation(test_warp_werk_viele_erstes_segment_mutation test_warp_werk_viele CYPHERDJ_MUTATION_ARR_WARP_ERSTES_SEGMENT ${ARR_QUELLEN} src/uhr.cpp ${WARP_WERK_QUELLEN})
  # Nachbesserung 4: die Zufallsfolgen (test_warp_werk_folgen, synchrone Attrappe, ohne Bungee) gegen die Mutationen, die sie in 300 Folgen fangen (die übrigen
  # fängt test_warp_werk_arr); CYPHERDJ_FOLGEN setzt die Zahl der Folgen. Langlauf: Ziel warp_werk_folgen_lang (50 000 Folgen, kein ctest). DECKT_VOR_EINSATZ und
  # NACHHOLEN_UEBER_ENDE fand der erste Langlauf; die Seeds 22894 und 9601 laufen in jedem Aufruf mit
  foreach(m TAUSCH_HART KARTE_IGNORIERT OHNE_NACHHOLEN OHNE_DECKUNG KARTE_VOR_EINSATZ TAUSCH_FREI REPITCH_DECKT BRUECKE_BLEIBT EINSTIEG_LUECKE OHNE_VORAUSBLICK
            START_OHNE_FRIST VORFILTER KARTE_WARTET EINSTIEG_DOPPELT ENDE_ALTE_KARTE DECKT_VOR_EINSATZ NACHHOLEN_UEBER_ENDE
            SPAET_STILL)   # Nachbesserung 5: ein später Einsatz schweigt; die Folgen mit spät (vorher ausgenommen, jetzt gedeckt) werden rot
    string(TOLOWER ${m} mk)
    test_mutation(test_warp_werk_folgen_${mk}_mutation test_warp_werk_folgen CYPHERDJ_MUTATION_ARR_WARP_WERK_${m} ${ARR_QUELLEN} src/uhr.cpp)
    if(TEST test_warp_werk_folgen_${mk}_mutation)
      set_tests_properties(test_warp_werk_folgen_${mk}_mutation PROPERTIES ENVIRONMENT CYPHERDJ_FOLGEN=300)
    endif()
  endforeach()
  # Nachbesserung 5 (Prüfung 5): der verdichtete Generator (17 bis 32 Spuren, Ereignisse über alle Spuren, gemeinsame Grenzen, Klammern auf der Grenze, Karten 2 048 bis
  # 2 700 Samples vor der Grenze) als eigener Test mit 1 000 Folgen; gegen den Stand vor der Nachbesserung 10 rote von 302 (Löcher bei Platzmangel). Die Mutationen der
  # Klasse „Platz ohne Klang“ und fable m2 (BRUECKE_MINUS_EINS: der Wächter −1 gegen negative Clip-Starts) fängt er, der Plan-Generator nicht
  # Seeds 2 001 bis 3 000: in 1 bis 2 000 liegen die bekannten roten Folgen 160 (Flanke 14) und 1260 (fable m3), siehe Kopf des Tests. Als Mutationsziel nur
  # BRUECKE_MINUS_EINS (2 rote von 1 002; m2 hat keinen Fall in test_warp_werk_arr); PLATZ_OHNE_KLANG, EINSATZ_OHNE_SPAET und STOPP_WARTET_HART fängt der verdichtete
  # Generator nur mit 1 von 1 002 (Seeds 1 bis 1 000) oder gar nicht (2 001 bis 3 000): ihre Ziele sind Fall 16 und 17
  if(TARGET test_warp_werk_folgen)
    add_test(NAME test_warp_werk_folgen_dicht COMMAND test_warp_werk_folgen 1000 2001 --dicht)
  endif()
  # Slice 5 (D7): Ereignis transpose (Tausch der Tonhöhe an Werk-Clips) mit dem Zeugen der Tonhöhe; der Standard-Generator bleibt derselbe (Gewicht 0 ohne --transpose)
  if(TARGET test_warp_werk_folgen)
    add_test(NAME test_warp_werk_folgen_transpose COMMAND test_warp_werk_folgen 600 3001 --transpose)
  endif()
  foreach(m PITCH_GLEICH)
    string(TOLOWER ${m} mk)
    test_mutation(test_warp_werk_folgen_${mk}_mutation test_warp_werk_folgen CYPHERDJ_MUTATION_ARR_WARP_WERK_${m} ${ARR_QUELLEN} src/uhr.cpp)
    if(TEST test_warp_werk_folgen_${mk}_mutation)
      set_tests_properties(test_warp_werk_folgen_${mk}_mutation PROPERTIES ENVIRONMENT "CYPHERDJ_FOLGEN=300;CYPHERDJ_FOLGEN_TRANSPOSE=1;CYPHERDJ_FOLGEN_SEED0=3001")
    endif()
  endforeach()
  foreach(m BRUECKE_MINUS_EINS)
    string(TOLOWER ${m} mk)
    test_mutation(test_warp_werk_folgen_dicht_${mk}_mutation test_warp_werk_folgen CYPHERDJ_MUTATION_ARR_WARP_WERK_${m} ${ARR_QUELLEN} src/uhr.cpp)
    if(TEST test_warp_werk_folgen_dicht_${mk}_mutation)
      set_tests_properties(test_warp_werk_folgen_dicht_${mk}_mutation PROPERTIES ENVIRONMENT "CYPHERDJ_FOLGEN=1000;CYPHERDJ_FOLGEN_DICHT=1;CYPHERDJ_FOLGEN_SEED0=2001")
    endif()
  endforeach()
  # OHNE_PLATZTAUSCH und KETTE_LANG fängt kein Fall von test_warp_werk_arr (gemessen im Beweislauf der Nachbesserung 4), die Zufallsfolgen erst in 2 000 Folgen
  # (erste rote Seeds 898 und 414)
  foreach(m OHNE_PLATZTAUSCH KETTE_LANG)
    string(TOLOWER ${m} mk)
    test_mutation(test_warp_werk_folgen_${mk}_mutation test_warp_werk_folgen CYPHERDJ_MUTATION_ARR_WARP_WERK_${m} ${ARR_QUELLEN} src/uhr.cpp)
    if(TEST test_warp_werk_folgen_${mk}_mutation)
      set_tests_properties(test_warp_werk_folgen_${mk}_mutation PROPERTIES ENVIRONMENT CYPHERDJ_FOLGEN=2000)
    endif()
  endforeach()
  # AK15 durch das Arrangement (Tausch mit anderer Quelle): liest() ohne die Stimmen lässt den Faden ein freigegebenes Audio lesen (Absturz, rc 139)
  test_mutation(test_warp_werk_tausch_quelle_liest_ohne_stimme_mutation test_warp_werk_tausch_quelle CYPHERDJ_MUTATION_WARP_LIEST_OHNE_STIMME
                ${ARR_QUELLEN} src/uhr.cpp ${WARP_WERK_QUELLEN})
  add_custom_target(warp_werk_folgen_lang COMMAND test_warp_werk_folgen 50000 1 DEPENDS test_warp_werk_folgen USES_TERMINAL)
  # Kosten des Vorausblicks bei 4 096 Clips (kein Test; Task 5 Step 10)
  add_executable(kern_kosten_vorausblick tests/kosten/kosten_vorausblick.cpp)
  target_include_directories(kern_kosten_vorausblick PRIVATE tests)
  target_link_libraries(kern_kosten_vorausblick PRIVATE cypherdj_kernbib)
  # Nachbesserung 5: Kosten der Deckung später Einsätze (kein Test; Task 5 Step 10)
  add_executable(kern_kosten_deckung tests/kosten/kosten_deckung.cpp)
  target_include_directories(kern_kosten_deckung PRIVATE tests)
  target_link_libraries(kern_kosten_deckung PRIVATE cypherdj_kernbib)
endif()
# Paket 1.13 Warp, Slice 2: ohne Maschine lehnt der Lader complex und tones mit warp_maschine_fehlt ab (grün, darum WILL_FAIL aus); die Mutation nimmt sie an (rot)
test_mutation(test_arr_warp_lader_ohne_maschine test_arr_warp_lader CYPHERDJ_TEST_OHNE_MASCHINE src/arr_wiedergabe.cpp)
set_tests_properties(test_arr_warp_lader_ohne_maschine PROPERTIES WILL_FAIL FALSE)
test_mutation(test_arr_warp_lader_maschine_still_mutation test_arr_warp_lader CYPHERDJ_MUTATION_ARR_WARP_MASCHINE_STILL src/arr_wiedergabe.cpp)
test_mutation(test_arr_wiedergabe_konto_mutation test_arr_wiedergabe CYPHERDJ_MUTATION_ARR_OHNE_KONTO src/arr_wiedergabe.cpp)
test_mutation(test_arr_wiedergabe_ordner_mutation test_arr_wiedergabe CYPHERDJ_MUTATION_ARR_ORDNER_ROH src/arr_wiedergabe.cpp)
test_mutation(test_arr_wiedergabe_bereich_mutation test_arr_wiedergabe CYPHERDJ_MUTATION_ARR_GAIN_ALT src/arr_wiedergabe.cpp)
test_mutation(test_arr_wiedergabe_endlich_mutation test_arr_wiedergabe CYPHERDJ_MUTATION_ARR_OHNE_ENDLICH src/arr_wiedergabe.cpp)
test_mutation(test_arr_wiedergabe_schnappschuss_mutation test_arr_wiedergabe CYPHERDJ_MUTATION_ARR_SCHNAPPSCHUSS_OFFEN src/arr_wiedergabe.cpp)
test_mutation(test_arr_wiedergabe_audio_kopf_mutation test_arr_wiedergabe CYPHERDJ_MUTATION_ARR_AUDIO_KOPF_OFFEN src/arr_wiedergabe.cpp)
# 1.12 slice 5 U8a T8.2 / T8.4: the gain envelope of the voice (test_arr_huellkurve); each error case makes it red
# integration of AK33 F4 (in-place gain edit) with the gain envelope: the in-place branch must rebind the envelope cursor (test_arr_gain_tausch_hk)
test_mutation(test_arr_gain_tausch_hk_bindung_mutation test_arr_gain_tausch_hk CYPHERDJ_MUTATION_ARR_GAIN_HK_BINDUNG_OHNE ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_huellkurve_cursor_mutation test_arr_huellkurve CYPHERDJ_MUTATION_ARR_HK_CURSOR_ALT ${ARR_QUELLEN} src/uhr.cpp)   # the pool slot keeps its cursor: the loop wrap reads the end of the table
test_mutation(test_arr_huellkurve_tausch_hart_mutation test_arr_huellkurve CYPHERDJ_MUTATION_ARR_HK_TAUSCH_HART ${ARR_QUELLEN} src/uhr.cpp)   # a table change at a swap jumps instead of gliding
test_mutation(test_arr_huellkurve_ausklang_mutation test_arr_huellkurve CYPHERDJ_MUTATION_ARR_HK_AUSKLANG_OHNE ${ARR_QUELLEN} src/uhr.cpp)   # the tail copy ignores the envelope
test_mutation(test_arr_huellkurve_blockanfang_mutation test_arr_huellkurve CYPHERDJ_MUTATION_ARR_WARP_BLOCKANFANG ${ARR_QUELLEN} src/uhr.cpp)   # the clip beat stands on the sub-block start (steep ramp)
# 1.12 slice 5 U8b T8.3: the same checks through RE-PITCH and BEATS voices (test_arr_huellkurve)
test_mutation(test_arr_huellkurve_warp_ohne_mutation test_arr_huellkurve CYPHERDJ_MUTATION_ARR_HK_WARP_OHNE ${ARR_QUELLEN} src/uhr.cpp)   # a warped voice ignores the envelope
# 1.12 slice 5 U8b T8.3: the gain envelope through the warp werk voices (test_warp_werk_huellkurve, built only with Bungee like every warp_werk test)
if(CYPHERDJ_BUNGEE)
  test_mutation(test_warp_werk_huellkurve_schnellpfad_mutation test_warp_werk_huellkurve CYPHERDJ_MUTATION_ARR_HK_WERK_SCHNELLPFAD ${ARR_QUELLEN} src/uhr.cpp ${WARP_WERK_QUELLEN})   # the fast path ignores the envelope
  test_mutation(test_warp_werk_huellkurve_bindung_mutation test_warp_werk_huellkurve CYPHERDJ_MUTATION_ARR_HK_WERK_BINDUNG_OHNE ${ARR_QUELLEN} src/uhr.cpp ${WARP_WERK_QUELLEN})   # the cursor stays on the old table at a swap
  test_mutation(test_warp_werk_huellkurve_tausch_hart_mutation test_warp_werk_huellkurve CYPHERDJ_MUTATION_ARR_HK_TAUSCH_HART ${ARR_QUELLEN} src/uhr.cpp ${WARP_WERK_QUELLEN})   # the factor jumps at a table swap
  test_mutation(test_warp_werk_huellkurve_cursor_mutation test_warp_werk_huellkurve CYPHERDJ_MUTATION_ARR_HK_CURSOR_ALT ${ARR_QUELLEN} src/uhr.cpp ${WARP_WERK_QUELLEN})   # the pool slot keeps its cursor
  test_mutation(test_warp_werk_huellkurve_bruecke_mutation test_warp_werk_huellkurve CYPHERDJ_MUTATION_ARR_HK_BRUECKE_OHNE ${ARR_QUELLEN} src/uhr.cpp ${WARP_WERK_QUELLEN})   # the bridge does not keep the factor
endif()
# 1.12 slice 5 U8b T8.5: the null test with a gain envelope (test_arr_huellkurve_null). A bug that live and render share (a voice path that ignores the envelope) is found by case 3
# (the render without the envelope against the live run with it must be red); the mutated voice code is linked ahead of the library (the pattern of the null tests above)
foreach(m ARR_HK_WARP_OHNE:arr_stimmen ARR_HK_WERK_SCHNELLPFAD:arr_warp)
  string(REPLACE ":" ";" mp ${m})
  list(GET mp 0 mdef)
  list(GET mp 1 mquelle)
  string(TOLOWER ${mdef} mname)
  add_executable(test_arr_huellkurve_null_${mname}_mutation tests/test_arr_huellkurve_null.cpp src/${mquelle}.cpp)
  target_include_directories(test_arr_huellkurve_null_${mname}_mutation PRIVATE include tests)
  target_compile_definitions(test_arr_huellkurve_null_${mname}_mutation PRIVATE CYPHERDJ_MUTATION_${mdef}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_arr_huellkurve_null_${mname}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_arr_huellkurve_null_${mname}_mutation COMMAND test_arr_huellkurve_null_${mname}_mutation)
  set_tests_properties(test_arr_huellkurve_null_${mname}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# 1.12 slice 5 U8a T8.1: the reader of gain_hk (test_arr_auto_lader); each error case makes it red
test_mutation(test_arr_auto_lader_hk_pruefung_mutation test_arr_auto_lader CYPHERDJ_MUTATION_ARR_HK_OHNE_PRUEFUNG src/arr_wiedergabe.cpp)   # /1 takes gain_hk, no value is checked
test_mutation(test_arr_auto_lader_hk_konto_mutation test_arr_auto_lader CYPHERDJ_MUTATION_ARR_HK_NICHT_GEBUCHT src/arr_wiedergabe.cpp)   # the hk points are not in je_bereich: not booked, not locked
# 1.12 slice 5 U9 T9.1: the reader of `relativ` lanes (test_arr_auto_lader)
test_mutation(test_arr_auto_lader_rel_eindeutig_mutation test_arr_auto_lader CYPHERDJ_MUTATION_ARR_REL_OHNE_EINDEUTIG src/arr_wiedergabe.cpp)   # an absolute and a relative lane of one target count as "twice"
# 1.12 slice 5 U9 T9.2, T9.3: the value stack (test_arr_auto_stapel); each error case makes it red
test_mutation(test_arr_auto_stapel_klemme_mutation test_arr_auto_stapel CYPHERDJ_MUTATION_ARR_AUTO_REL_OHNE_KLEMME ${ARR_QUELLEN} src/uhr.cpp)   # the stack is not clamped to the range of the target
test_mutation(test_arr_auto_stapel_blende_mutation test_arr_auto_stapel CYPHERDJ_MUTATION_ARR_AUTO_REL_OHNE_BLENDE ${ARR_QUELLEN} src/uhr.cpp)   # the summand is added after the 480 blend: a hard step
test_mutation(test_arr_auto_stapel_uebersteuerung_mutation test_arr_auto_stapel CYPHERDJ_MUTATION_ARR_AUTO_REL_BEI_UEBERSTEUERUNG ${ARR_QUELLEN} src/uhr.cpp)   # the relative lane stays on the hand value
test_mutation(test_arr_auto_stapel_cursor_mutation test_arr_auto_stapel CYPHERDJ_MUTATION_ARR_AUTO_CURSOR_ALT ${ARR_QUELLEN} src/uhr.cpp)   # the relative cursor is not searched anew after the loop seam
test_mutation(test_arr_auto_ziele_rel_klemme_mutation test_arr_auto_ziele CYPHERDJ_MUTATION_ARR_AUTO_REL_OHNE_KLEMME ${ARR_QUELLEN} src/uhr.cpp)   # device stack not clamped
test_mutation(test_arr_auto_vorausschau_rel_mutation test_arr_auto_vorausschau CYPHERDJ_MUTATION_ARR_AUTO_REL_VORAUS_OHNE ${ARR_QUELLEN} src/uhr.cpp)   # the look-ahead of a stack ignores the relative lane
test_mutation(test_kanten_erz4_mutation test_kanten CYPHERDJ_MUTATION_ARR_KANTE_ERZ4 src/kanten.cpp)
# D1 K1 (A10): das Netz wartet aufs Laden; netz_arr.cpp mutiert als eigenes Objekt vor der Bibliothek (Muster
# test_kern_vorhoeren_mutation). test_netz_arr_luecke muss scheitern (/uhr-Lücke so lang wie das Laden).
add_executable(test_netz_arr_luecke_mutation tests/test_netz_arr_luecke.cpp src/netz_arr.cpp)
target_include_directories(test_netz_arr_luecke_mutation PRIVATE include tests)
target_compile_definitions(test_netz_arr_luecke_mutation PRIVATE CYPHERDJ_MUTATION_ARR_NETZ_WARTET=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_arr_luecke_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_arr_luecke_mutation COMMAND test_netz_arr_luecke_mutation)
set_tests_properties(test_netz_arr_luecke_mutation PROPERTIES WILL_FAIL TRUE)
# D1 K1 Fix 9: Ergebnis bei 1 s vollem Ergebnisring verworfen (ohne Endquittung); test_arr_lader Fall 5 muss scheitern
add_executable(test_arr_lader_ergebnis_mutation tests/test_arr_lader.cpp src/arr_lader.cpp)
target_include_directories(test_arr_lader_ergebnis_mutation PRIVATE include tests)
target_compile_definitions(test_arr_lader_ergebnis_mutation PRIVATE CYPHERDJ_MUTATION_ARR_ERGEBNIS_VERWORFEN=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_arr_lader_ergebnis_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_arr_lader_ergebnis_mutation COMMAND test_arr_lader_ergebnis_mutation)
set_tests_properties(test_arr_lader_ergebnis_mutation PROPERTIES WILL_FAIL TRUE)
# D1 K1 Fix 6: der Deck-Lader bucht das Konto erst nach dem Sperren (wie vorher); test_arr_lader Fall 4 muss scheitern
add_executable(test_arr_lader_konto_mutation tests/test_arr_lader.cpp src/lader.cpp)
target_include_directories(test_arr_lader_konto_mutation PRIVATE include tests)
target_compile_definitions(test_arr_lader_konto_mutation PRIVATE CYPHERDJ_MUTATION_LADER_KONTO_SPAET=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_arr_lader_konto_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_arr_lader_konto_mutation COMMAND test_arr_lader_konto_mutation)
set_tests_properties(test_arr_lader_konto_mutation PROPERTIES WILL_FAIL TRUE)
# Paket 1.13 Warp, Slice 2: der Lade-Faden gibt einen abgelösten Schnappschuss nicht frei, solange das Warp-Werk ihn liest (arr_lader.cpp mutiert als eigenes
# Objekt vor der Bibliothek): ohne die Frage an das Werk wird Fall 6 rot
add_executable(test_arr_lader_werk_mutation tests/test_arr_lader.cpp src/arr_lader.cpp)
target_include_directories(test_arr_lader_werk_mutation PRIVATE include tests)
target_compile_definitions(test_arr_lader_werk_mutation PRIVATE CYPHERDJ_MUTATION_ARR_LADER_OHNE_WERK=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_arr_lader_werk_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_arr_lader_werk_mutation COMMAND test_arr_lader_werk_mutation)
set_tests_properties(test_arr_lader_werk_mutation PROPERTIES WILL_FAIL TRUE)
# D1 K1: /erz/strom auf erz/4 ohne Riegel; netz_erz.cpp mutiert als eigenes Objekt, test_netz_arr muss scheitern
add_executable(test_netz_arr_erz4_mutation tests/test_netz_arr.cpp src/netz_erz.cpp)
target_include_directories(test_netz_arr_erz4_mutation PRIVATE include tests)
target_compile_definitions(test_netz_arr_erz4_mutation PRIVATE CYPHERDJ_MUTATION_ARR_ERZ4_FREI=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_arr_erz4_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_arr_erz4_mutation COMMAND test_netz_arr_erz4_mutation)
set_tests_properties(test_netz_arr_erz4_mutation PROPERTIES WILL_FAIL TRUE)
# D1 K1: Hand-Zielart arr/start_stopp ohne DJ-Quant; test_kern_arr_hand (Fall 3) muss scheitern
test_mutation(test_kern_arr_hand_mutation test_kern_arr_hand CYPHERDJ_MUTATION_ARR_HAND_IMMER_SOFORT ${KERN_QUELLEN35}
              src/arr_wiedergabe.cpp)
# D1 K1 Fix 7: ein zweiter /k/arr/stopp überschreibt die erste id ohne Endquittung; test_kern_arr Fall 11f muss scheitern
test_mutation(test_kern_arr_stopp_mutation test_kern_arr CYPHERDJ_MUTATION_ARR_STOPP_ID_UEBERSCHRIEBEN ${KERN_QUELLEN35}
              src/arr_wiedergabe.cpp)
# D1 K1 Fix 10: voller Wartepuffer führt sofort aus (überholt); test_kern_arr Fall 12 muss scheitern
test_mutation(test_kern_arr_warte_mutation test_kern_arr CYPHERDJ_MUTATION_ARR_WARTE_VORZIEHEN ${KERN_QUELLEN35}
              src/arr_wiedergabe.cpp)
# D1 K1 Fix 4 (Spec 6.27): KI-Stopp prüft nur laden und start; test_kern_arr_ki Fall 7 muss scheitern. Seit K1-Fix-2
# fährt Fall 8 das Netz mit: kern_arr.cpp mutiert als eigenes Objekt vor der Bibliothek (Muster test_netz_arr_luecke).
add_executable(test_kern_arr_ki_mutation tests/test_kern_arr_ki.cpp src/kern_arr.cpp)
target_include_directories(test_kern_arr_ki_mutation PRIVATE include tests)
target_compile_definitions(test_kern_arr_ki_mutation PRIVATE CYPHERDJ_MUTATION_ARR_KI_NUR_LADEN_START=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_kern_arr_ki_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_kern_arr_ki_mutation COMMAND test_kern_arr_ki_mutation)
set_tests_properties(test_kern_arr_ki_mutation PROPERTIES WILL_FAIL TRUE)
# 1.15 A6 (mix meters): kern_mix.cpp / netz_loop.cpp mutated as their own object before the library (pattern test_kern_arr_ki_mutation).
#   every block instead of 10 Hz, 4864 instead of 4800 samples, every channel instead of the ones with a running tool, mid/high swapped, wire order swapped,
#   A5c: the limiter is not a criterion (a bus whose only tool is the limiter publishes nothing)
foreach(m JEDER_BLOCK ALLE_KANAELE BAND_VERTAUSCHT ABSTAND_4864 OHNE_LIMITER_KRITERIUM)
  string(TOLOWER ${m} ml)
  add_executable(test_kern_mix_zustand_${ml}_mutation tests/test_kern_mix_zustand.cpp src/kern_mix.cpp)
  target_include_directories(test_kern_mix_zustand_${ml}_mutation PRIVATE include tests)
  target_compile_definitions(test_kern_mix_zustand_${ml}_mutation PRIVATE CYPHERDJ_MUTATION_MIX_${m}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_kern_mix_zustand_${ml}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_kern_mix_zustand_${ml}_mutation COMMAND test_kern_mix_zustand_${ml}_mutation)
  set_tests_properties(test_kern_mix_zustand_${ml}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
add_executable(test_netz_mix_zustand_mutation tests/test_netz_mix_zustand.cpp src/netz_loop.cpp)
target_include_directories(test_netz_mix_zustand_mutation PRIVATE include tests ${DJK}/vertrag)
target_compile_definitions(test_netz_mix_zustand_mutation PRIVATE CYPHERDJ_MUTATION_MIX_FELDER_VERTAUSCHT=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_mix_zustand_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_mix_zustand_mutation COMMAND test_netz_mix_zustand_mutation)
set_tests_properties(test_netz_mix_zustand_mutation PROPERTIES WILL_FAIL TRUE)
add_executable(test_netz_ins_gr_mutation tests/test_netz_ins_gr.cpp src/netz_loop.cpp)
target_include_directories(test_netz_ins_gr_mutation PRIVATE include tests ${DJK}/vertrag)
target_compile_definitions(test_netz_ins_gr_mutation PRIVATE CYPHERDJ_MUTATION_INS_GR_NICHT_GEROUTET=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_ins_gr_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_ins_gr_mutation COMMAND test_netz_ins_gr_mutation)
set_tests_properties(test_netz_ins_gr_mutation PROPERTIES WILL_FAIL TRUE)   # 1.10 slice 4a S2: a dropped INS_GR must turn test_netz_ins_gr red
# the Mixer getters (mixer.h): sign, band index, "ran in the last block" (the range guard is shown under CYPHERDJ_SANITIZE, not here)
test_mutation(test_mixer_mix_reduktion_vorzeichen_mutation test_mixer_mix_reduktion CYPHERDJ_MUTATION_MIX_GATE_VORZEICHEN src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_mix_reduktion_ohne_lief_mutation test_mixer_mix_reduktion CYPHERDJ_MUTATION_MIX_GATE_OHNE_LIEF src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_mix_reduktion_band_mutation test_mixer_mix_reduktion CYPHERDJ_MUTATION_MIX_MB_BAND_VERSCHOBEN src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_mix_reduktion_gate_oberkante_mutation test_mixer_mix_reduktion CYPHERDJ_MUTATION_MIX_GATE_OBERKANTE src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_mix_reduktion_mb_oberkante_mutation test_mixer_mix_reduktion CYPHERDJ_MUTATION_MIX_MB_OBERKANTE src/mixer.cpp src/beatfx.cpp)
if(CYPHERDJ_SANITIZE)   # the range guards: without them UBSan/ASan abort on the out-of-bounds read (in a plain build the read may pass by luck)
  test_mutation(test_mixer_mix_reduktion_gate_guard_mutation test_mixer_mix_reduktion CYPHERDJ_MUTATION_MIX_GATE_OHNE_GUARD src/mixer.cpp src/beatfx.cpp)
  test_mutation(test_mixer_mix_reduktion_mb_guard_mutation test_mixer_mix_reduktion CYPHERDJ_MUTATION_MIX_MB_OHNE_GUARD src/mixer.cpp src/beatfx.cpp)
endif()
# 1.15 A7b (spectrum path): mixer.cpp / netz.cpp mutated as their own object before the library (pattern test_kern_arr_ki_mutation); each must turn
# test_mixer_spektrum red: cut 0 (stale samples stay), generation never bumped, tap writes while the selector is 0, tap on the neighbour channel (mixer.cpp);
# leeren() only instead of verwerfe_bis(), no second generation read, tag from the current selection (netz.cpp)
foreach(m SPEK_SCHNITT_NULL SPEK_GEN_STUMM SPEK_IMMER_SCHREIBEN SPEK_TAP_VERSCHOBEN SPEK_CUE_OHNE_ABGRIFF SPEK_OHNE_UNGERADE)
  string(TOLOWER ${m} ml)
  add_executable(test_mixer_spektrum_${ml}_mutation tests/test_mixer_spektrum.cpp src/mixer.cpp)
  target_include_directories(test_mixer_spektrum_${ml}_mutation PRIVATE include tests)
  target_compile_definitions(test_mixer_spektrum_${ml}_mutation PRIVATE CYPHERDJ_MUTATION_${m}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_mixer_spektrum_${ml}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_mixer_spektrum_${ml}_mutation COMMAND test_mixer_spektrum_${ml}_mutation)
  set_tests_properties(test_mixer_spektrum_${ml}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
foreach(m SPEKTRUM_NUR_LEEREN SPEKTRUM_OHNE_G1 SPEKTRUM_ETIKETT_AKTUELL SPEKTRUM_OHNE_TAKT SPEKTRUM_OHNE_NEULESEN)
  string(TOLOWER ${m} ml)
  add_executable(test_mixer_spektrum_${ml}_mutation tests/test_mixer_spektrum.cpp src/netz.cpp)
  target_include_directories(test_mixer_spektrum_${ml}_mutation PRIVATE include tests)
  target_compile_definitions(test_mixer_spektrum_${ml}_mutation PRIVATE CYPHERDJ_MUTATION_${m}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_mixer_spektrum_${ml}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_mixer_spektrum_${ml}_mutation COMMAND test_mixer_spektrum_${ml}_mutation)
  set_tests_properties(test_mixer_spektrum_${ml}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# D1 K1 Fix-2 Punkt 2 (§4.7): das Netz prüft im KI-Stopp den Bereich vor ki_gestoppt (wie vorher); Fall 8 muss scheitern
add_executable(test_kern_arr_ki_bereich_mutation tests/test_kern_arr_ki.cpp src/netz_arr.cpp)
target_include_directories(test_kern_arr_ki_bereich_mutation PRIVATE include tests)
target_compile_definitions(test_kern_arr_ki_bereich_mutation PRIVATE CYPHERDJ_MUTATION_ARR_KI_NACH_BEREICH=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_kern_arr_ki_bereich_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_kern_arr_ki_bereich_mutation COMMAND test_kern_arr_ki_bereich_mutation)
set_tests_properties(test_kern_arr_ki_bereich_mutation PROPERTIES WILL_FAIL TRUE)
# D1 K1 (A10): cost of a cycle with a playing arrangement against the situation without (the numbers go into the report; only the hash cases below are ctest cases)
add_executable(kern_kosten_arr tests/kosten/kosten_arr.cpp)
target_link_libraries(kern_kosten_arr PRIVATE cypherdj_kernbib)
# NOTE: the reference hash is bit-exact and bound to this host (DJ-Maschine, Ryzen 7800X3D, gcc and glibc as installed there): libm ifunc dispatch can differ on another CPU or glibc.
# If kosten_arr_hash fails on another machine or after a toolchain change, measure the reference again before suspecting the code. PASS_REGULAR_EXPRESSION ignores the exit
# code on purpose: the hash covers the audio, and the lane self-check may exit 2 in the control run.
# Output hash of the arrangement lane (KOSTEN_HASH=1): FNV-1a over the production master and the master out, 2000 warm-up + 3000 measured cycles (blocks=5000). The reference values
# are those of the probe of 2026-11-06 on main bccde012 (Hall fork-join probe, unchanged Hall path). The control mutes track 3: it passes only if a hash line was printed (the lane
# self-check may exit 2, ctest ignores the exit code with PASS_REGULAR_EXPRESSION) AND neither reference value appears, so a crash or a missing line cannot pass it.
add_test(NAME kosten_arr_hash COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 $<TARGET_FILE:kern_kosten_arr> 3000 arr32ins)
set_tests_properties(kosten_arr_hash PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32ins pm=dc9cc27c4c3f4649 out=dc14fb5e7fa2cd46 blocks=5000" TIMEOUT 120)
# mehrkern task 4: the same lane with the Halls on a HallPool of 3 workers must give exactly the same hash.
# The deadline is 1 s: no take-back, no self switch-off from wake jitter (SCHED_OTHER). The single HASH line (stdout) carries everything, so no ordering of stdout and stderr is relied on:
# the reference hash, pool_jobs > 0 (Hall blocks computed ON a worker: a pool that is merely attached cannot pass), no late and no taken-back job, the pool still on.
add_test(NAME kosten_arr_hash_pool COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 KOSTEN_HALL_FAEDEN=3 KOSTEN_HALL_FRIST_US=1000000 $<TARGET_FILE:kern_kosten_arr> 3000 arr32ins)
set_tests_properties(kosten_arr_hash_pool PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32ins pm=dc9cc27c4c3f4649 out=dc14fb5e7fa2cd46 blocks=5000 pool_jobs=[1-9][0-9]* hall_jobs=[1-9][0-9]* pool_spaet=0 pool_zurueck=0 pool_an=1" TIMEOUT 120)
# Control of the line above: the pool is built but never attached (KOSTEN_HALL_POOL_UNBENUTZT). The hash is the same and pool_jobs is 0, so kosten_arr_hash_pool would be red on it.
add_test(NAME kosten_arr_hash_pool_unbenutzt COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 KOSTEN_HALL_FAEDEN=3 KOSTEN_HALL_FRIST_US=1000000 KOSTEN_HALL_POOL_UNBENUTZT=1 $<TARGET_FILE:kern_kosten_arr> 3000 arr32ins)
set_tests_properties(kosten_arr_hash_pool_unbenutzt PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32ins pm=dc9cc27c4c3f4649 out=dc14fb5e7fa2cd46 blocks=5000 pool_jobs=0 hall_jobs=[1-9][0-9]*" TIMEOUT 120)
add_test(NAME kosten_arr_hash_kontrolle COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 KOSTEN_ARR32_STUMM=3 $<TARGET_FILE:kern_kosten_arr> 3000 arr32ins)
set_tests_properties(kosten_arr_hash_kontrolle PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32ins pm=[0-9a-f]+ out=[0-9a-f]+ blocks=5000"
                     FAIL_REGULAR_EXPRESSION "pm=dc9cc27c4c3f4649;out=dc14fb5e7fa2cd46" TIMEOUT 120)
target_compile_definitions(kern_kosten_arr PRIVATE CYPHERDJ_DJK="${DJK}")   # 1.9: the lane arr32kit reads the repo test kits
# 1.10 Slice 3 Task 1: cost of Cypher Hall as a return effect (no ctest test, the numbers go into the report)
add_executable(kern_kosten_hall tests/kosten/kosten_hall.cpp)
target_include_directories(kern_kosten_hall PRIVATE tests)
target_link_libraries(kern_kosten_hall PRIVATE cypherdj_kernbib)
# 1.10 slice 4b T11: cost per instance of the native insert kinds komp, eq, saett (pool sizes are decided from these numbers). The two ctest runs are the
# harness self-check: a short run must pass (it counts the instances it measured), and the build with CYPHERDJ_MUTATION_KOSTEN_INS_EINS (one instance when
# more are asked) must abort (WILL_FAIL).
add_executable(kern_kosten_ins tests/kosten/kosten_ins.cpp)
target_link_libraries(kern_kosten_ins PRIVATE cypherdj_kernbib)
add_test(NAME kosten_ins_selbstpruefung COMMAND ${CMAKE_COMMAND} -E env KOSTEN_INS_ANZAHL=0,1,12 KOSTEN_INS_FAELLE=komp,eq_mix,saett $<TARGET_FILE:kern_kosten_ins> 300 1)
add_executable(kern_kosten_ins_mutation tests/kosten/kosten_ins.cpp)
target_compile_definitions(kern_kosten_ins_mutation PRIVATE CYPHERDJ_MUTATION_KOSTEN_INS_EINS=1)
target_link_libraries(kern_kosten_ins_mutation PRIVATE cypherdj_kernbib)
add_test(NAME kosten_ins_selbstpruefung_mutation COMMAND ${CMAKE_COMMAND} -E env KOSTEN_INS_ANZAHL=0,1,12 KOSTEN_INS_FAELLE=komp,eq_mix,saett $<TARGET_FILE:kern_kosten_ins_mutation> 300 1)
set_tests_properties(kosten_ins_selbstpruefung_mutation PROPERTIES WILL_FAIL TRUE)
# D1 K2b: Fehlerfälle der Senken (RB-338 intern, Wirt-Slots) und ihrer Verdrahtung im Kern (WILL_FAIL)
test_mutation(test_arr_rb_senke_reihenfolge_mutation test_arr_rb_senke CYPHERDJ_MUTATION_ARR_RB_REIHENFOLGE ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_rb_senke_tausch_mutation test_arr_rb_senke CYPHERDJ_MUTATION_ARR_RB_TAUSCH_OHNE_PARAMETER ${ARR_QUELLEN}
              src/uhr.cpp)
test_mutation(test_arr_rb_senke_versatz_mutation test_arr_rb_senke CYPHERDJ_MUTATION_ARR_RB_VERSATZ_NULL ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_rb_senke_zuruecksetzen_mutation test_arr_rb_senke CYPHERDJ_MUTATION_ARR_RB_OHNE_ZURUECKSETZEN ${ARR_QUELLEN}
              src/uhr.cpp)
test_mutation(test_arr_rb_senke_ruhe_mutation test_arr_rb_senke CYPHERDJ_MUTATION_ARR_RB_RUHE_SOFORT ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_rb_senke_blende_mutation test_arr_rb_senke CYPHERDJ_MUTATION_ARR_RB_OHNE_BLENDE ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_rb_senke_blende_hart_mutation test_arr_rb_senke CYPHERDJ_MUTATION_ARR_RB_BLENDE_HART ${ARR_QUELLEN}
              src/uhr.cpp)   # Fix F3: harter Schnitt am Anfang des Blendblocks, Fall 5 (Rampe) rot
test_mutation(test_arr_rb_senke_auto_lane_vor_vorgabe_mutation test_arr_rb_senke_auto CYPHERDJ_MUTATION_ARR_RB_LANE_VOR_VORGABE ${ARR_QUELLEN}
              src/uhr.cpp)   # slice 2 task 4: the lane value applied before the defaults, case 1 red
test_mutation(test_arr_rb_senke_auto_spur_null_mutation test_arr_rb_senke_auto CYPHERDJ_MUTATION_ARR_RB_SPUR_NULL ${ARR_QUELLEN}
              src/uhr.cpp)   # fix round 1: the track index filed as 0, case 9 red
test_mutation(test_arr_rb_senke_auto_rel_klemme_mutation test_arr_rb_senke_auto CYPHERDJ_MUTATION_ARR_AUTO_REL_OHNE_KLEMME ${ARR_QUELLEN}
              src/uhr.cpp)   # 1.12 slice 5 U9: the summand sum is not clamped to 0..1, case 10b red
test_mutation(test_arr_rb_senke_wechsel_mutation test_arr_rb_senke CYPHERDJ_MUTATION_ARR_SPURWECHSEL_HART ${ARR_QUELLEN}
              src/uhr.cpp)   # Fix F2: Spurwechsel ohne Ausblende und Zurücksetzen, Fall 6 rot
test_mutation(test_kern_arr_rb_mutation test_kern_arr_rb CYPHERDJ_MUTATION_ARR_OHNE_RB_SENKE ${KERN_QUELLEN35} src/arr_wiedergabe.cpp)
test_mutation(test_kern_arr_wirt_vorhalt_mutation test_kern_arr_wirt CYPHERDJ_MUTATION_ARR_WIRT_OHNE_VORHALT ${KERN_QUELLEN35}
              src/arr_wiedergabe.cpp)
test_mutation(test_kern_arr_wirt_leeren_mutation test_kern_arr_wirt CYPHERDJ_MUTATION_ARR_MIDI_LEER_SPAET ${KERN_QUELLEN35}
              src/arr_wiedergabe.cpp)
test_mutation(test_kern_arr_wirt_wechsel_mutation test_kern_arr_wirt CYPHERDJ_MUTATION_ARR_SPURWECHSEL_HART ${KERN_QUELLEN35}
              src/arr_wiedergabe.cpp)   # Fix F2: Wirt-Slot verlassen ohne CC 123 und Ausblende, Fall 6 rot
test_mutation(test_kern_arr_wirt_achse_mutation test_kern_arr_wirt CYPHERDJ_MUTATION_ARR_A4_ACHSE_ALT ${KERN_QUELLEN35}
              src/arr_wiedergabe.cpp)   # Fix F7: offene A4-Messungen über /k/set/neu behalten, Fall 7 rot
test_mutation(test_kern_arr_wirt_nachreichen_mutation test_kern_arr_wirt CYPHERDJ_MUTATION_ARR_MIDI_LEER_NACH_NACHREICHEN
              ${KERN_QUELLEN35} src/arr_wiedergabe.cpp)   # Fix F1: Leeren hinter arr_nachreichen(), Fall 5 rot
test_mutation(test_kern_arr_wirt_rueckweg_mutation test_kern_arr_wirt CYPHERDJ_MUTATION_ARR_WIRT_OHNE_RUECKWEG ${KERN_QUELLEN35}
              src/arr_wiedergabe.cpp)
test_mutation(test_kern_arr_wirt_a4_mutation test_kern_arr_wirt CYPHERDJ_MUTATION_ARR_A4_BLOCKANFANG ${KERN_QUELLEN35}
              src/arr_wiedergabe.cpp)
test_mutation(test_kanten_arr_zu_mutation test_kanten CYPHERDJ_MUTATION_ARR_KANTEN_ZU src/kanten.cpp)
test_mutation(test_kanten_riegel_mutation test_kanten CYPHERDJ_MUTATION_KANTEN_OHNE_RIEGEL src/kanten.cpp)
test_mutation(test_midi_ausgabe_mutation test_midi_ausgabe CYPHERDJ_MUTATION_MIDI_UNSORTIERT src/kanten.cpp)
# D1 K2b (Spec 6.28, A10): Messpunkt A4 über zwei Fäden; unter -DCYPHERDJ_TSAN=ON der Lauf für A10 (Ablage)
test_mutation(test_kern_arr_wirt_faden_mutation test_kern_arr_wirt_faden CYPHERDJ_MUTATION_ARR_A4_BLOCKANFANG ${KERN_QUELLEN35}
              src/arr_wiedergabe.cpp)

# ---- Paket K3 (Spec D1 2.5, 3.1, A7): Freeze, Render, Ring-Mitschnitt, Null-Test
# Freeze-Abgriff nach dem Fader bzw. Loop-Klammer im Freeze nicht ausgesetzt: test_arr_freeze (Fall 1 bzw. 2) muss scheitern
test_mutation(test_arr_freeze_fader_mutation test_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_NACH_FADER ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_freeze_loop_mutation test_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_LOOP_BLEIBT ${ARR_QUELLEN} src/uhr.cpp)
# Fix L10: start_beat des Nutzers nach dem Freeze nicht zurückgesetzt: test_arr_freeze (Fall 6) muss scheitern
test_mutation(test_arr_freeze_start_beat_mutation test_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_START_BEAT_BLEIBT ${ARR_QUELLEN}
              src/uhr.cpp)
# Freeze-Rückgabe bei vollem Ereignisring verloren (Leck): test_kern_arr_freeze (Fall 5) muss scheitern
test_mutation(test_kern_arr_freeze_mutation test_kern_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_VERLIERBAR ${KERN_QUELLEN35}
              src/arr_wiedergabe.cpp)
# Fix 2/P2: statische Prüfung der Echtzeit-Quellen von Arrangement und Freeze (keine Sperr- und Warte-Köpfe, kein .wait,
# kein .acquire, Fix 3/Q1: kein std::atomic_wait/atomic_flag_wait samt _explicit), weil der Wächter Futex-Primitive ohne
# Kernel-Eintritt nicht sieht (alloc_abfang.h); Positiv-Kontrolle je Form im Lauf
add_test(NAME test_echtzeit_quellen COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_echtzeit_quellen.py)
# Fix 2/P1: nur vier Warteplätze wie vor dem Fix, die nächste Rückgabe (auch die des laufenden Freeze) geht verloren:
# test_kern_arr_freeze (Fall 9 a und b) muss scheitern
test_mutation(test_kern_arr_freeze_verwerfen_mutation test_kern_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_RUECKGABE_VERWERFEN
              ${KERN_QUELLEN35} src/arr_wiedergabe.cpp)
# Fix 3/Q2: wartende Freeze-Rückgaben vorn eingehängt (LIFO statt ihrer Reihenfolge, kern.h freeze_kopf_):
# test_kern_arr_freeze (Fall 9 a und b, Reihenfolge der ARR_FREEZE-Ereignisse) muss scheitern
test_mutation(test_kern_arr_freeze_lifo_mutation test_kern_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_LIFO
              ${KERN_QUELLEN35} src/arr_wiedergabe.cpp)
# Freeze überholt ein wartendes Laden (Reihenfolge hinter arr_warte_): test_kern_arr_freeze (Fall 6) muss scheitern
test_mutation(test_kern_arr_freeze_ueberholt_mutation test_kern_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_UEBERHOLT
              ${KERN_QUELLEN35} src/arr_wiedergabe.cpp)
# Spec 6.33: Prüfung des Tempo-Plans entfernt bzw. kein Abbruch bei Rampe: test_kern_arr_freeze (Fall 7 a bzw. d) muss scheitern
test_mutation(test_kern_arr_freeze_rampe_pruefung_mutation test_kern_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_OHNE_RAMPENPRUEFUNG
              ${KERN_QUELLEN35} src/arr_wiedergabe.cpp)
test_mutation(test_kern_arr_freeze_rampe_abbruch_mutation test_kern_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_RAMPE_OHNE_ABBRUCH
              ${KERN_QUELLEN35} src/arr_wiedergabe.cpp)
# Fix L1: /k/set/neu lässt einen laufenden oder wartenden Freeze weiterlaufen: test_kern_arr_freeze (Fall 8 a, b) muss scheitern
test_mutation(test_kern_arr_freeze_set_neu_mutation test_kern_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_SET_NEU_BLEIBT
              ${KERN_QUELLEN35} src/arr_wiedergabe.cpp)
# Abgebrochener Freeze wird trotzdem Datei: netz_arr_freeze.cpp mutiert als eigenes Objekt vor der Bibliothek;
# test_netz_arr_freeze (Fall 6) muss scheitern
add_executable(test_netz_arr_freeze_mutation tests/test_netz_arr_freeze.cpp src/netz_arr_freeze.cpp)
target_include_directories(test_netz_arr_freeze_mutation PRIVATE include tests)
target_compile_definitions(test_netz_arr_freeze_mutation PRIVATE CYPHERDJ_MUTATION_ARR_FREEZE_ABBRUCH_SCHREIBT=1
                           CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_arr_freeze_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_arr_freeze_mutation COMMAND test_netz_arr_freeze_mutation)
set_tests_properties(test_netz_arr_freeze_mutation PROPERTIES WILL_FAIL TRUE)
# Spec 6.25: eine vorhandene Freeze-Datei still ersetzt (rename statt RENAME_NOREPLACE): test_netz_arr_freeze (Fall 9) rot
add_executable(test_netz_arr_freeze_ersetzt_mutation tests/test_netz_arr_freeze.cpp src/arr_freeze_datei.cpp)
target_include_directories(test_netz_arr_freeze_ersetzt_mutation PRIVATE include tests)
target_compile_definitions(test_netz_arr_freeze_ersetzt_mutation PRIVATE CYPHERDJ_MUTATION_ARR_FREEZE_ERSETZT=1
                           CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_arr_freeze_ersetzt_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_arr_freeze_ersetzt_mutation COMMAND test_netz_arr_freeze_ersetzt_mutation)
set_tests_properties(test_netz_arr_freeze_ersetzt_mutation PROPERTIES WILL_FAIL TRUE)
# Fix L12: Schreibfehler ohne Grund (errno verworfen): test_arr_freeze_datei muss scheitern
test_mutation(test_arr_freeze_datei_errno_mutation test_arr_freeze_datei CYPHERDJ_MUTATION_ARR_FREEZE_OHNE_ERRNO
              src/arr_freeze_datei.cpp)
# Spec 6.29 (Fix L4: getrennt): Puffer anlegen zurück im Netz-Faden bzw. Datei schreiben zurück im Netz-Faden;
# test_netz_arr_freeze_uhr muss gegen jede allein scheitern (Fenster Anlegen bzw. Schreiben)
foreach(m ANLEGEN SCHREIBEN)
  string(TOLOWER ${m} klein)
  add_executable(test_netz_arr_freeze_uhr_${klein}_mutation tests/test_netz_arr_freeze_uhr.cpp src/netz_arr_freeze.cpp)
  target_include_directories(test_netz_arr_freeze_uhr_${klein}_mutation PRIVATE include tests)
  target_compile_definitions(test_netz_arr_freeze_uhr_${klein}_mutation PRIVATE CYPHERDJ_MUTATION_ARR_FREEZE_${m}_IM_NETZ=1
                             CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_netz_arr_freeze_uhr_${klein}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_netz_arr_freeze_uhr_${klein}_mutation COMMAND test_netz_arr_freeze_uhr_${klein}_mutation)
  set_tests_properties(test_netz_arr_freeze_uhr_${klein}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# A10 (Spec 6.29): test_freeze_tsan läuft im eigenen Bau mit -DCYPHERDJ_TSAN=ON ohne Befund; die Gegenprobe (Zeiger ohne
# Ring an den Kern-Faden) gibt es nur dort, TSan muss sie melden. Fix L5: beide über setarch -R; die Gegenprobe besteht nur,
# wenn TSan das Rennen meldet („reported N warnings“), nicht bei irgendeinem Fehlschlag (vorher WILL_FAIL: auch der
# Startabbruch der TSan-Laufzeit galt als bestanden).
if(CYPHERDJ_TSAN)
  add_executable(test_freeze_tsan_ohne_ring tests/test_freeze_tsan.cpp)
  target_include_directories(test_freeze_tsan_ohne_ring PRIVATE include tests)
  target_compile_definitions(test_freeze_tsan_ohne_ring PRIVATE CYPHERDJ_TSAN_OHNE_RING=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_freeze_tsan_ohne_ring PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_freeze_tsan_ohne_ring COMMAND ${TSAN_START} $<TARGET_FILE:test_freeze_tsan_ohne_ring>)
  set_tests_properties(test_freeze_tsan_ohne_ring PROPERTIES PASS_REGULAR_EXPRESSION
                       "ThreadSanitizer: reported [1-9][0-9]* warnings")
endif()
# K2b-Rest (a): ein Platz je Spur für die verlassene Senke (wie vor dem Re-Review): test_kern_arr_wirt (Fall 8) muss scheitern
test_mutation(test_kern_arr_wirt_weg_mutation test_kern_arr_wirt CYPHERDJ_MUTATION_ARR_WEG_EIN_PLATZ ${KERN_QUELLEN35}
              src/arr_wiedergabe.cpp)
# K2b-Rest (b): eine im selben Zyklus zurückgekehrte interne Spur geht durch den Zweig weg verloren: test_arr_rb_senke (Fall 7)
test_mutation(test_arr_rb_senke_zurueck_mutation test_arr_rb_senke CYPHERDJ_MUTATION_ARR_RB_ZURUECK_VERLOREN ${ARR_QUELLEN}
              src/uhr.cpp)
# Render (Spec 6.20, 6.24): render.cpp bzw. kern.cpp mutiert als eigenes Objekt vor der Bibliothek; test_render muss gegen
# beide scheitern (Regler-Quelle projekt ohne erz/4 neutral: still, Fall 6; der Kern hängt seine RB-338 nicht ein: die
# interne Spur schweigt, Fall 5); Fix L3: ohne Obergrenze für bis − von (Fall 1: 2048 + 1e-6 und 1e9 kein Aufruffehler);
# Fix L6: Ring-Leser ohne Marge für den Block im Flug (Fall 4: CAP − 8192 + 1 Frames angenommen); Fix L9: WAV ersetzt ein
# vorhandenes Ziel still (Fall 3 rot); Fix 2/P4: WAV verschränkt den ganzen Export in einer Kopie (Fall 8 rot)
# 1.15 A5b: the export aligned with the master limiter only, without the latency account L of the bus limiters (Fall 2 red)
# 1.10 slice 4a T6: ins/… is no mixer control of the render: the export has no inserts (Fall 12 red)
foreach(m RENDER_ERZ4_NICHT_NEUTRAL:render ARR_OHNE_RB_SENKE:kern RENDER_OHNE_OBERGRENZE:render RING_OHNE_MARGE:ring_mitschnitt
          WAV_ERSETZT:wav WAV_GANZE_KOPIE:wav ARR_RENDER_OHNE_HALL_SOFORT:render RENDER_OHNE_KANAL_LATENZ:render RENDER_OHNE_INS:render
          RENDER_RACK_OHNE_SURGE_PRUEFUNG:render)   # 1.9 U6 T6.4: a rack with a Surge member is not refused (case 1 red)
  string(REPLACE ":" ";" mq ${m})
  list(GET mq 0 schalter)
  list(GET mq 1 quelle)
  string(TOLOWER ${schalter} klein)
  add_executable(test_render_${klein}_mutation tests/test_render.cpp src/${quelle}.cpp)
  target_include_directories(test_render_${klein}_mutation PRIVATE include tests)
  target_compile_definitions(test_render_${klein}_mutation PRIVATE CYPHERDJ_MUTATION_${schalter}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_render_${klein}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_render_${klein}_mutation COMMAND test_render_${klein}_mutation)
  set_tests_properties(test_render_${klein}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# 1.10 Slice 3 Task 7: an allocation in the return loop must turn the allocation guard red (arr_returns.cpp as its own mutated object before the library)
add_executable(test_kern_arr_returns_alloc_mutation tests/test_kern_arr_returns_alloc.cpp src/arr_returns.cpp)
target_include_directories(test_kern_arr_returns_alloc_mutation PRIVATE include tests)
target_compile_definitions(test_kern_arr_returns_alloc_mutation PRIVATE CYPHERDJ_MUTATION_ARR_RET_ALLOC=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_kern_arr_returns_alloc_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_kern_arr_returns_alloc_mutation COMMAND test_kern_arr_returns_alloc_mutation)
set_tests_properties(test_kern_arr_returns_alloc_mutation PROPERTIES WILL_FAIL TRUE)
# 1.10 slice 4b T13/T14: the export of the production tap with latency stages (test_render_pdc, collected automatically). The export that does not skip the largest
# path latency (render.cpp as its own object before the library) must turn case 1 red; a start that does not wait for the EQ smoothing (render.cpp) and a delay ring that
# drops its history at every block (arr_ausgang.cpp likewise) case 2.
foreach(m RENDER_OHNE_PDC_VORHALT:render RENDER_OHNE_EINSCHWINGEN:render PDC_BLOCK_NEU:arr_ausgang)
  string(REPLACE ":" ";" mq ${m})
  list(GET mq 0 schalter)
  list(GET mq 1 quelle)
  string(TOLOWER ${schalter} klein)
  add_executable(test_render_pdc_${klein}_mutation tests/test_render_pdc.cpp src/${quelle}.cpp)
  target_include_directories(test_render_pdc_${klein}_mutation PRIVATE include tests)
  target_compile_definitions(test_render_pdc_${klein}_mutation PRIVATE CYPHERDJ_MUTATION_${schalter}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_render_pdc_${klein}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_render_pdc_${klein}_mutation COMMAND test_render_pdc_${klein}_mutation)
  set_tests_properties(test_render_pdc_${klein}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# Null-Test (A7) am Offline-Kern: render.cpp bzw. nulltest.cpp mutiert als eigenes Objekt vor der Bibliothek; test_nulltest
# (Fall 1) muss gegen beide scheitern (Master ohne Limiter-Vorhalt ausgerichtet; Messfenster bis an die Naht)
foreach(m RENDER_OHNE_VORHALT:render NULL_OHNE_NAHTRAND:nulltest)
  string(REPLACE ":" ";" mq ${m})
  list(GET mq 0 schalter)
  list(GET mq 1 quelle)
  string(TOLOWER ${schalter} klein)
  add_executable(test_nulltest_${klein}_mutation tests/test_nulltest.cpp src/${quelle}.cpp)
  target_include_directories(test_nulltest_${klein}_mutation PRIVATE include tests)
  target_compile_definitions(test_nulltest_${klein}_mutation PRIVATE CYPHERDJ_MUTATION_${schalter}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_nulltest_${klein}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_nulltest_${klein}_mutation COMMAND test_nulltest_${klein}_mutation)
  set_tests_properties(test_nulltest_${klein}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# Paket 1.13 Warp, Slice 1: der Null-Test mit gewarpten Spuren (test_arr_warp_null, automatisch eingesammelt) gegen eine Gegenprobe, die
# einen Warp nicht anfasst (render.cpp mutiert als eigenes Objekt vor der Bibliothek, Muster der Schleife oben): Fall 2 muss rot werden
add_executable(test_arr_warp_null_render_gegenprobe_warp_blind_mutation tests/test_arr_warp_null.cpp src/render.cpp)
target_include_directories(test_arr_warp_null_render_gegenprobe_warp_blind_mutation PRIVATE include tests)
target_compile_definitions(test_arr_warp_null_render_gegenprobe_warp_blind_mutation PRIVATE CYPHERDJ_MUTATION_RENDER_GEGENPROBE_WARP_BLIND=1
                           CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_arr_warp_null_render_gegenprobe_warp_blind_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_arr_warp_null_render_gegenprobe_warp_blind_mutation COMMAND test_arr_warp_null_render_gegenprobe_warp_blind_mutation)
set_tests_properties(test_arr_warp_null_render_gegenprobe_warp_blind_mutation PROPERTIES WILL_FAIL TRUE)
# Paket 1.13 Warp, Slice 4 (Task 6): die Gegenprobe eines BEATS-Clips verschiebt auch die Einheiten (Fall 8); ohne das bleibt sie blind
add_executable(test_arr_warp_null_render_gegenprobe_beats_blind_mutation tests/test_arr_warp_null.cpp src/render.cpp)
target_include_directories(test_arr_warp_null_render_gegenprobe_beats_blind_mutation PRIVATE include tests)
target_compile_definitions(test_arr_warp_null_render_gegenprobe_beats_blind_mutation PRIVATE CYPHERDJ_MUTATION_RENDER_GEGENPROBE_BEATS_BLIND=1
                           CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_arr_warp_null_render_gegenprobe_beats_blind_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_arr_warp_null_render_gegenprobe_beats_blind_mutation COMMAND test_arr_warp_null_render_gegenprobe_beats_blind_mutation)
set_tests_properties(test_arr_warp_null_render_gegenprobe_beats_blind_mutation PROPERTIES WILL_FAIL TRUE)
# Automation Slice 1 T7: the counter-check of the null test with lanes (gegenprobe_auto) does not touch a lane: case 3 must go red
add_executable(test_arr_auto_null_render_gegenprobe_auto_blind_mutation tests/test_arr_auto_null.cpp src/render.cpp)
target_include_directories(test_arr_auto_null_render_gegenprobe_auto_blind_mutation PRIVATE include tests)
target_compile_definitions(test_arr_auto_null_render_gegenprobe_auto_blind_mutation PRIVATE CYPHERDJ_MUTATION_RENDER_GEGENPROBE_AUTO_BLIND=1
                           CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_arr_auto_null_render_gegenprobe_auto_blind_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_arr_auto_null_render_gegenprobe_auto_blind_mutation COMMAND test_arr_auto_null_render_gegenprobe_auto_blind_mutation)
set_tests_properties(test_arr_auto_null_render_gegenprobe_auto_blind_mutation PROPERTIES WILL_FAIL TRUE)
# Automation Slice 1 T8 fallback: the render without the 16-sample hold while the live run holds: the null test must go red
add_executable(test_arr_auto_null_schritt_nur_live_mutation tests/test_arr_auto_null.cpp src/render.cpp)
target_include_directories(test_arr_auto_null_schritt_nur_live_mutation PRIVATE include tests)
target_compile_definitions(test_arr_auto_null_schritt_nur_live_mutation PRIVATE CYPHERDJ_MUTATION_ARR_AUTO_SCHRITT_NUR_LIVE=1
                           CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_arr_auto_null_schritt_nur_live_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_arr_auto_null_schritt_nur_live_mutation COMMAND test_arr_auto_null_schritt_nur_live_mutation)
set_tests_properties(test_arr_auto_null_schritt_nur_live_mutation PROPERTIES WILL_FAIL TRUE)
# Paket 1.13 Warp, Slice 1: Kosten des Moduls mit 32 gewarpten Spuren (kein Test; Zahlen in den Bericht)
add_executable(kern_kosten_arr_warp tests/kosten/kosten_arr_warp.cpp)
target_include_directories(kern_kosten_arr_warp PRIVATE tests)
target_link_libraries(kern_kosten_arr_warp PRIVATE cypherdj_kernbib)
# Paket 1.13 Warp, Slice 3a (Task 16): Kosten bei 2, 100, 865 und 4096 Markern je Clip, Tausch eingeschlossen (kein Test; Zahlen in den Bericht)
add_executable(kern_kosten_arr_warp_viele tests/kosten/kosten_arr_warp_viele.cpp)
target_include_directories(kern_kosten_arr_warp_viele PRIVATE tests)
target_link_libraries(kern_kosten_arr_warp_viele PRIVATE cypherdj_kernbib)
# Paket 1.13 Warp, Messprobe Arbeitsfaden-Last (vor Slice 2): ein Werk aus Bungee-Stimmen und Arbeitsfäden ohne Kern (kein Test; Aufruf über
# tests/deck/warp_last_lauf.sh neben ziel_lauf_boxen.py); braucht nur Bungee
if(CYPHERDJ_BUNGEE)
  add_executable(kern_kosten_warp_werk tests/kosten/kosten_warp_werk.cpp)
  target_link_libraries(kern_kosten_warp_werk PRIVATE cypherdj::bungee Threads::Threads)
endif()
# Programme des Exports (Unterordner werkzeuge, den das Einsammeln nicht erfasst): cypherdj-render, cypherdj-mitschnitt,
# cypherdj-nulltest
add_executable(cypherdj-render src/werkzeuge/render_main.cpp)
target_link_libraries(cypherdj-render PRIVATE cypherdj_kernbib)
target_compile_options(cypherdj-render PRIVATE -Wall -Wextra)
# Set recording (demo 2026-11-07): the live master of a running kern for a whole set, read only from the audio ring, to a WAV
add_executable(cypherdj-setmitschnitt src/werkzeuge/setmitschnitt_main.cpp)
target_link_libraries(cypherdj-setmitschnitt PRIVATE cypherdj_kernbib)
target_compile_options(cypherdj-setmitschnitt PRIVATE -Wall -Wextra)
add_test(NAME test_setmitschnitt_probe COMMAND python3 ${CMAKE_CURRENT_SOURCE_DIR}/pruef/setmitschnitt_probe.py $<TARGET_FILE:cypherdj-setmitschnitt>)
# Voice player (demo 2026-11-07): JACK client that stays on the kern's input pair ein_<k> and plays queued speech clips
add_executable(cypherdj-stimme src/werkzeuge/stimme_main.cpp)
target_link_libraries(cypherdj-stimme PRIVATE PkgConfig::JACK Threads::Threads)
target_include_directories(cypherdj-stimme PRIVATE include)
target_compile_options(cypherdj-stimme PRIVATE -Wall -Wextra)
add_executable(cypherdj-mitschnitt src/werkzeuge/mitschnitt_main.cpp)
target_link_libraries(cypherdj-mitschnitt PRIVATE cypherdj_kernbib)
target_compile_options(cypherdj-mitschnitt PRIVATE -Wall -Wextra)
add_executable(cypherdj-nulltest src/werkzeuge/nulltest_main.cpp)
target_link_libraries(cypherdj-nulltest PRIVATE cypherdj_kernbib)
target_compile_options(cypherdj-nulltest PRIVATE -Wall -Wextra)
# Rauchprobe der drei Programme über ihre Kommandozeile (test_export_programme startet sie aus dem Bau-Ordner)
target_compile_definitions(test_export_programme PRIVATE CYPHERDJ_BIN="$<TARGET_FILE_DIR:cypherdj-render>")
add_dependencies(test_export_programme cypherdj-render cypherdj-mitschnitt cypherdj-nulltest)
# A10 (Spec 6.29): Dauer von Freeze-Puffer anlegen und Freeze-Datei schreiben im Lade-Faden (kein Test; Zahlen in den
# Bericht von Task 7.2)
add_executable(kern_freeze_schreiben tests/kosten/freeze_schreiben.cpp)
target_link_libraries(kern_freeze_schreiben PRIVATE cypherdj_kernbib)
test_mutation(test_eingang_spitze_mutation test_eingang CYPHERDJ_MUTATION_EIN_SPITZE_NUR_L)
test_mutation(test_midi_ein_versatz_mutation test_midi_ein CYPHERDJ_MUTATION_MIDI_EIN_OHNE_VERSATZ)
test_mutation(test_kanten_ein_riegel_mutation test_kanten_ein CYPHERDJ_MUTATION_EIN_KANTEN_OHNE_RIEGEL src/kanten.cpp)
test_mutation(test_kanten_ein_ziel_mutation test_kanten_ein CYPHERDJ_MUTATION_EIN_KANTEN_ZIEL_FREI src/kanten.cpp)
test_mutation(test_kanten_ein_instanz_mutation test_kanten_ein CYPHERDJ_MUTATION_EIN_KANTEN_NUR_EIGENES src/kanten.cpp)
test_mutation(test_kern_ein_midi_mutation test_kern_ein CYPHERDJ_MUTATION_EIN_MIDI_BLOCKANFANG ${KERN_QUELLEN35})
# I08 Task 4, Review-Nachzug: /zustand/ein auf dem Draht; netz.cpp mutiert als eigenes Objekt, test_netz_ein muss scheitern
test_mutation(test_kanten_ein_trennen_mutation test_kanten_ein CYPHERDJ_MUTATION_EIN_KANTEN_KEIN_TRENNEN src/kanten.cpp)
test_mutation(test_kern_ein_leser_mutation test_kern_ein CYPHERDJ_MUTATION_EIN_MIDI_OHNE_ABFLUSS ${KERN_QUELLEN35})
test_mutation(test_kern_ein_achse_mutation test_kern_ein CYPHERDJ_MUTATION_EIN_MIDI_ALTE_ACHSE ${KERN_QUELLEN35})
# Voice channel (stimme.h): with stimme_eingang 0 the master stays bit-identical; the voice path running on pair 4 anyway must be red
test_mutation(test_kern_stimme_mutation test_kern_stimme CYPHERDJ_MUTATION_STIMME_IMMER_AN ${KERN_QUELLEN35})
test_mutation(test_kern_ein_reset_mutation test_kern_ein CYPHERDJ_MUTATION_EIN_ACHSE_OHNE_RESET ${KERN_QUELLEN35})
add_executable(test_netz_ein_mutation tests/test_netz_ein.cpp src/netz.cpp)
target_include_directories(test_netz_ein_mutation PRIVATE include tests ${DJK}/vertrag)
target_compile_definitions(test_netz_ein_mutation PRIVATE CYPHERDJ_MUTATION_EIN_ZUSTAND_VERTAUSCHT=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_ein_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_ein_mutation COMMAND test_netz_ein_mutation)
set_tests_properties(test_netz_ein_mutation PROPERTIES WILL_FAIL TRUE)

# I08 Task 6: Prüf-Client Impuls + Note im selben Frame (Messung der MIDI-Zeitstempel gegen Audio)
add_executable(cypherdj-pruef-ein pruef/ein_pruef.cpp)
target_link_libraries(cypherdj-pruef-ein PRIVATE PkgConfig::JACK)

# I08 Task 14: Messclient cypherdj-latenz (Software-Schleife und Kabelschleife; Auswertung in pruef/latenz_stat.h)
add_executable(cypherdj-latenz pruef/latenz.cpp)
target_include_directories(cypherdj-latenz PRIVATE pruef)
target_link_libraries(cypherdj-latenz PRIVATE PkgConfig::JACK)
# Nachzug R1, R2: Mutations-Gegenstücke. Die Tests (tests/test_latenz_lauf.cpp, tests/latenz_alte_datei.cmake) müssen an ihnen scheitern.
foreach(m OHNE_I OHNE_RUHE OHNE_FRIST RUHE_OHNE_FENSTER UNRUHIG_OHNE_PAUSE LAUT_BIS_FRAMES OHNE_LEER OHNE_LEER_URTEIL OHNE_JITTER OHNE_STREUUNG)
  string(TOLOWER ${m} mk)
  add_executable(test_latenz_lauf_${mk}_mutation tests/test_latenz_lauf.cpp)
  target_compile_definitions(test_latenz_lauf_${mk}_mutation PRIVATE CYPHERDJ_MUTATION_LATENZ_${m}=1)
  target_link_libraries(test_latenz_lauf_${mk}_mutation PRIVATE Threads::Threads)
  add_test(NAME test_latenz_lauf_${mk}_mutation COMMAND test_latenz_lauf_${mk}_mutation)
  set_tests_properties(test_latenz_lauf_${mk}_mutation PROPERTIES WILL_FAIL TRUE TIMEOUT 60)
endforeach()
add_test(NAME test_latenz_alte_datei COMMAND ${CMAKE_COMMAND} -DBIN=$<TARGET_FILE:cypherdj-latenz> -DDIR=${CMAKE_CURRENT_BINARY_DIR}
         -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/latenz_alte_datei.cmake)
add_executable(cypherdj-latenz-mutation-alte-datei pruef/latenz.cpp)
target_include_directories(cypherdj-latenz-mutation-alte-datei PRIVATE pruef)
target_compile_definitions(cypherdj-latenz-mutation-alte-datei PRIVATE CYPHERDJ_MUTATION_LATENZ_ALTE_DATEI=1)
target_link_libraries(cypherdj-latenz-mutation-alte-datei PRIVATE PkgConfig::JACK)
add_test(NAME test_latenz_alte_datei_mutation COMMAND ${CMAKE_COMMAND} -DBIN=$<TARGET_FILE:cypherdj-latenz-mutation-alte-datei>
         -DDIR=${CMAKE_CURRENT_BINARY_DIR} -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/latenz_alte_datei.cmake)
set_tests_properties(test_latenz_alte_datei_mutation PROPERTIES WILL_FAIL TRUE)
# beide schreiben ${DIR}/alt.json: unter ctest -j liefen sie gleichzeitig und einer riss (gemessen 2026-10-24, -j2 20 von 20 rot, auch auf main)
set_tests_properties(test_latenz_alte_datei test_latenz_alte_datei_mutation PROPERTIES RESOURCE_LOCK latenz_alt_json)
# Gesamtreview Teil A (m1, M1): Verdrahtung unter pipewire-jack (Namenskollision, unbekannter Port). Ohne JACK-Server Ende 77 = übersprungen.
find_program(PW_JACK pw-jack)
if(PW_JACK)
  add_executable(test_latenz_verdrahtung tests/latenz_verdrahtung.cpp)
  target_link_libraries(test_latenz_verdrahtung PRIVATE PkgConfig::JACK)
  add_executable(cypherdj-latenz-mutation-fester-name pruef/latenz.cpp)
  target_include_directories(cypherdj-latenz-mutation-fester-name PRIVATE pruef)
  target_compile_definitions(cypherdj-latenz-mutation-fester-name PRIVATE CYPHERDJ_MUTATION_LATENZ_FESTER_NAME=1)
  target_link_libraries(cypherdj-latenz-mutation-fester-name PRIVATE PkgConfig::JACK)
  add_test(NAME test_latenz_verdrahtung COMMAND ${PW_JACK} $<TARGET_FILE:test_latenz_verdrahtung> $<TARGET_FILE:cypherdj-latenz>)
  add_test(NAME test_latenz_verdrahtung_mutation COMMAND ${PW_JACK} $<TARGET_FILE:test_latenz_verdrahtung> $<TARGET_FILE:cypherdj-latenz-mutation-fester-name>)
  set_tests_properties(test_latenz_verdrahtung test_latenz_verdrahtung_mutation PROPERTIES SKIP_RETURN_CODE 77 TIMEOUT 60)
  set_tests_properties(test_latenz_verdrahtung_mutation PROPERTIES WILL_FAIL TRUE)
  set_tests_properties(test_latenz_verdrahtung test_latenz_verdrahtung_mutation PROPERTIES RESOURCE_LOCK jack_name_cypherdj_latenz)   # beide halten den Clientnamen; nie gleichzeitig (-j4)
endif()
add_test(NAME test_latenz_eintragen COMMAND ${CMAKE_COMMAND} -DMJS=${CMAKE_CURRENT_SOURCE_DIR}/../pruefstand/ein/latenz_eintragen.mjs
         -DDIR=${CMAKE_CURRENT_BINARY_DIR} -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/latenz_eintragen.cmake)
test_mutation(test_take_schreiber_luecke_mutation test_take_schreiber CYPHERDJ_MUTATION_REC_LUECKE_STILL src/take_schreiber.cpp)
test_mutation(test_aufnahme_start_mutation test_aufnahme CYPHERDJ_MUTATION_REC_START_BLOCKANFANG)
test_mutation(test_aufnahme_frist_mutation test_aufnahme CYPHERDJ_MUTATION_REC_FRIST_IMMER)          # M1: Frist gilt auch, während das Arrangement wartet
test_mutation(test_aufnahme_sammeln_mutation test_aufnahme CYPHERDJ_MUTATION_REC_OHNE_SAMMELN)       # m4: jeder Teilblock ein Chunk
test_mutation(test_aufnahme_aendern_mutation test_aufnahme CYPHERDJ_MUTATION_REC_AENDERN_NUR_STATUS) # m1: Wechsel schon bei phase 2
test_mutation(test_aufnahme_naht_mutation test_aufnahme CYPHERDJ_MUTATION_REC_NAHT_IGNORIERT)         # Review-Nachzug Teil B: Ende am ersten Loop-Wrap
test_mutation(test_aufnahme_faden_ende_mutation test_aufnahme_faden CYPHERDJ_MUTATION_REC_FADEN_ENDE_FEHLT src/aufnahme_faden.cpp src/take_schreiber.cpp)
test_mutation(test_aufnahme_faden_leeren_mutation test_aufnahme_faden CYPHERDJ_MUTATION_REC_FADEN_OHNE_LEEREN src/aufnahme_faden.cpp src/take_schreiber.cpp)   # Review-Nachzug T23: das Leeren in Phase 1
# 1.8 Task 24: Kern-Verdrahtung der Aufnahme (test_kern_rec). Jede Mutation ist ein Fehlerfall, an dem der Kern-Test rot werden muss.
test_mutation(test_kern_rec_tap_mutation test_kern_rec CYPHERDJ_MUTATION_REC_TAP_NACH_MIXER ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # AK4: der Abgriff nach dem Mixer ist nicht bitgleich
test_mutation(test_kern_rec_start_mutation test_kern_rec CYPHERDJ_MUTATION_REC_START_BLOCKANFANG ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # AK5: Start am Blockanfang statt am Einsatz-Sample
test_mutation(test_kern_rec_frist_mutation test_kern_rec CYPHERDJ_MUTATION_REC_FRIST_IMMER ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)
test_mutation(test_kern_rec_aendern_mutation test_kern_rec CYPHERDJ_MUTATION_REC_AENDERN_NUR_STATUS ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)
test_mutation(test_kern_rec_beat_mutation test_kern_rec CYPHERDJ_MUTATION_REC_ARR_BEAT_KERN ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)
test_mutation(test_kern_rec_naht_mutation test_kern_rec CYPHERDJ_MUTATION_REC_NAHT_IGNORIERT ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # Review-Nachzug Teil B: Ende am ersten Loop-Wrap

# Paket 1.13 Warp, Slice 2 (AK15): die Freigabe eines abgelösten Schnappschusses ohne die Frage an das Werk (WarpWerk::liest) muss den Lebensdauer-Test
# zum Absturz bringen (WILL_FAIL; das Audio liegt in Seiten, die nach der Freigabe PROT_NONE sind)
if(CYPHERDJ_BUNGEE)
  add_executable(test_warp_werk_lebensdauer_freigabe_mutation tests/test_warp_werk_lebensdauer.cpp)
  target_include_directories(test_warp_werk_lebensdauer_freigabe_mutation PRIVATE tests)
  target_compile_definitions(test_warp_werk_lebensdauer_freigabe_mutation PRIVATE CYPHERDJ_MUTATION_WARP_FREIGABE_OHNE_QUITTUNG=1)
  target_link_libraries(test_warp_werk_lebensdauer_freigabe_mutation PRIVATE cypherdj_kernbib)
  add_test(NAME test_warp_werk_lebensdauer_freigabe_mutation COMMAND test_warp_werk_lebensdauer_freigabe_mutation)
  set_tests_properties(test_warp_werk_lebensdauer_freigabe_mutation PROPERTIES WILL_FAIL TRUE)
  # die Regel selbst, im Werk mutiert: liest() fragt die Stimmen nicht (Fall 1b), das Audio wird erst nach dem Übernehmen angemeldet (Fall 1)
  foreach(m LIEST_OHNE_STIMME HALTE_NACH_GELESEN)
    string(TOLOWER ${m} mk)
    test_mutation(test_warp_werk_lebensdauer_${mk}_mutation test_warp_werk_lebensdauer CYPHERDJ_MUTATION_WARP_${m} src/warp_werk.cpp src/warp_werk_bungee.cpp src/uhr.cpp cypherdj::bungee)
  endforeach()
endif()

# S18 task 2: recording taps and /pegel for erz/5..7, pad/1..2. Each mutation is a failure case the kern tests must turn red on.
test_mutation(test_kern_rec_pad_vertauscht_mutation test_kern_rec CYPHERDJ_MUTATION_REC_PAD_VERTAUSCHT ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # pad/1 and pad/2 swapped: the empty box 2 is recorded as pad/1
test_mutation(test_kern_rec_erz6_als_5_mutation test_kern_rec CYPHERDJ_MUTATION_REC_ERZ6_ALS_5 ${KERN_QUELLEN35} src/aufnahme_faden.cpp src/take_schreiber.cpp src/arr_wiedergabe.cpp)   # erz/6 reads the tap of erz/5: not bit identical
test_mutation(test_kern_pegel_ohne_erz567_mutation test_kern_pegel CYPHERDJ_MUTATION_PEGEL_OHNE_ERZ567 ${KERN_QUELLEN35})   # the old /pegel channel set

# Baukasten S20 task 3: faults of the graph store for project tracks (WILL_FAIL). The mutated arr_wiedergabe.cpp is linked before the
# library, so it replaces the library's copy.
function(bk_lader_mutation name schalter)
  add_executable(${name} tests/test_arr_bk_lader.cpp src/arr_wiedergabe.cpp)
  target_include_directories(${name} PRIVATE include tests)
  target_compile_definitions(${name} PRIVATE ${schalter}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(${name} PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME ${name} COMMAND ${name})
  set_tests_properties(${name} PROPERTIES WILL_FAIL TRUE)
endfunction()
bk_lader_mutation(test_arr_bk_lader_teilen_mutation CYPHERDJ_MUTATION_ARR_BK_OHNE_TEILEN)        # key without sharing: case 3
bk_lader_mutation(test_arr_bk_lader_leser_mutation CYPHERDJ_MUTATION_ARR_BK_FREI_OHNE_LESER)     # free without asking the sink: case 4
bk_lader_mutation(test_arr_bk_lader_effekt_mutation CYPHERDJ_MUTATION_ARR_BK_EFFEKT_OFFEN)       # effect graph accepted: case 2
bk_lader_mutation(test_arr_bk_lader_ref_mutation CYPHERDJ_MUTATION_ARR_BK_OHNE_REF)              # no bk_gib in gib_wiedergabe: cases 3, 4

# Package 1.9 U1a: faults of the kit store for kit tracks (WILL_FAIL). Same shape as bk_lader_mutation: the mutated arr_wiedergabe.cpp is linked
# before the library, so it replaces the library's copy. The ctest names are counted by U1a T1.4 (ctest -N | grep -c _mutation).
function(kit_lader_mutation name schalter)
  add_executable(${name} tests/test_arr_kit_lader.cpp src/arr_wiedergabe.cpp)
  target_include_directories(${name} PRIVATE include tests)
  target_compile_definitions(${name} PRIVATE ${schalter}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(${name} PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME ${name} COMMAND ${name})
  set_tests_properties(${name} PROPERTIES WILL_FAIL TRUE)
endfunction()
kit_lader_mutation(test_arr_kit_lader_teilen_mutation CYPHERDJ_MUTATION_ARR_KIT_OHNE_TEILEN)       # key without sharing: case 1
kit_lader_mutation(test_arr_kit_lader_leser_mutation CYPHERDJ_MUTATION_ARR_KIT_FREI_OHNE_LESER)    # free without asking the sink: case 5
kit_lader_mutation(test_arr_kit_lader_ref_mutation CYPHERDJ_MUTATION_ARR_KIT_OHNE_REF)              # no kit_gib in gib_wiedergabe: case 7
kit_lader_mutation(test_arr_kit_lader_fehler_mutation CYPHERDJ_MUTATION_ARR_KIT_FEHLER_OHNE_GIB)    # no kit_gib on the error exits of lade_wiedergabe: case 8
test_mutation(test_arr_wiedergabe_kit_name_mutation test_arr_wiedergabe CYPHERDJ_MUTATION_ARR_KIT_NAME_UNGEPRUEFT src/arr_wiedergabe.cpp)   # kit name not checked by the parser: the bad-name refusal text
# the mutated arr_lader.cpp is linked before the library (own object, like test_arr_lader_werk_mutation): without the kit_nachholen call case 10 goes red
add_executable(test_arr_kit_lader_nachholen_mutation tests/test_arr_kit_lader.cpp src/arr_lader.cpp)
target_include_directories(test_arr_kit_lader_nachholen_mutation PRIVATE include tests)
target_compile_definitions(test_arr_kit_lader_nachholen_mutation PRIVATE CYPHERDJ_MUTATION_ARR_KIT_OHNE_NACHHOLEN=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_arr_kit_lader_nachholen_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_arr_kit_lader_nachholen_mutation COMMAND test_arr_kit_lader_nachholen_mutation)
set_tests_properties(test_arr_kit_lader_nachholen_mutation PROPERTIES WILL_FAIL TRUE)

# Baukasten S20 task 4: faults of the Baukasten sink and the device dispatch of the internal tracks (WILL_FAIL)
foreach(m VERSATZ_NULL OHNE_ZURUECKSETZEN REGLER_NUR_START WECHSEL_HART OHNE_AKTIV)
  string(TOLOWER ${m} mk)
  test_mutation(test_arr_bk_senke_${mk}_mutation test_arr_bk_senke CYPHERDJ_MUTATION_ARR_BK_${m} ${ARR_QUELLEN} src/uhr.cpp)
endforeach()
# Package 1.9 U1b T1.5: faults of the kit sink (WILL_FAIL): onset at the block start (a), youngest voice stolen (c), start without clearing (d), nutzt blind to the fade (f2)
foreach(m BLOCKANFANG RAUB_JUENGSTE START_OHNE_LEEREN NUTZT_FALSCH)
  string(TOLOWER ${m} mk)
  test_mutation(test_arr_kit_senke_${mk}_mutation test_arr_kit_senke CYPHERDJ_MUTATION_ARR_KIT_${m} ${ARR_QUELLEN} src/kit.cpp src/uhr.cpp)   # kit.cpp: the test loads kit_impuls with lade_kit
endforeach()
# Package 1.9 U6 T6.1: member slots in the sinks (WILL_FAIL): the sinks sized to the 32 track slots refuse a member slot
test_mutation(test_arr_glied_plaetze_nur_spuren_mutation test_arr_glied_plaetze CYPHERDJ_MUTATION_ARR_PLAETZE_NUR_SPUREN ${ARR_QUELLEN} src/uhr.cpp)
# Package 1.9 U6 T6.2: faults of the rack parser (WILL_FAIL): a zone taken as it is (inverted, out of range), a Surge slot used twice
test_mutation(test_arr_rack_wiedergabe_zone_mutation test_arr_rack_wiedergabe CYPHERDJ_MUTATION_ARR_RACK_ZONE_UNGEPRUEFT src/arr_wiedergabe.cpp)
test_mutation(test_arr_rack_wiedergabe_slot_mutation test_arr_rack_wiedergabe CYPHERDJ_MUTATION_ARR_RACK_SLOT_DOPPELT src/arr_wiedergabe.cpp)
# Package 1.9 U6 T6.3: faults of the rack sink (WILL_FAIL): an exclusive upper key bound (R1), a note off to every member (R4), a gain step instead of
# the ramp (R5), no Wirt lead (R6)
foreach(m ZONE_EXKLUSIV OFF_AN_ALLE GAIN_SPRUNG OHNE_VORHALT)
  string(TOLOWER ${m} mk)
  test_mutation(test_arr_rack_senke_${mk}_mutation test_arr_rack_senke CYPHERDJ_MUTATION_ARR_RACK_${m} ${ARR_QUELLEN} src/uhr.cpp)
endforeach()
test_mutation(test_arr_intern_senke_ohne_wechsel_mutation test_arr_intern_senke CYPHERDJ_MUTATION_ARR_INTERN_OHNE_WECHSEL ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_intern_senke_rb_rueckkehr_mutation test_arr_intern_senke CYPHERDJ_MUTATION_ARR_RB_BK_ALS_RUECKKEHR ${ARR_QUELLEN} src/uhr.cpp)
test_mutation(test_arr_intern_senke_ohne_auto_mutation test_arr_intern_senke CYPHERDJ_MUTATION_ARR_INTERN_OHNE_AUTO ${ARR_QUELLEN} src/uhr.cpp)   # 1.12 S2: device lane values must pass the dispatcher
test_mutation(test_kern_arr_bk_mutation test_kern_arr_bk CYPHERDJ_MUTATION_ARR_OHNE_RB_SENKE ${KERN_QUELLEN35} src/arr_wiedergabe.cpp)

# Baukasten S20 task 5: the render does not hand the graph folder to the loader (WILL_FAIL); the mutated render.cpp is linked before the library
# Package 1.9 U1b T1.7: the render does not hand the kit folder and the loader to the cache (WILL_FAIL); same shape as the bk precedent above
add_executable(test_render_kit_ohne_kit_ordner_mutation tests/test_render_kit.cpp src/render.cpp)
target_include_directories(test_render_kit_ohne_kit_ordner_mutation PRIVATE include tests)
target_compile_definitions(test_render_kit_ohne_kit_ordner_mutation PRIVATE CYPHERDJ_MUTATION_RENDER_OHNE_KIT_ORDNER=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_render_kit_ohne_kit_ordner_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_render_kit_ohne_kit_ordner_mutation COMMAND test_render_kit_ohne_kit_ordner_mutation)
set_tests_properties(test_render_kit_ohne_kit_ordner_mutation PROPERTIES WILL_FAIL TRUE)

add_executable(test_render_bk_ohne_bk_ordner_mutation tests/test_render_bk.cpp src/render.cpp)
target_include_directories(test_render_bk_ohne_bk_ordner_mutation PRIVATE include tests)
target_compile_definitions(test_render_bk_ohne_bk_ordner_mutation PRIVATE CYPHERDJ_MUTATION_RENDER_OHNE_BK_ORDNER=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_render_bk_ohne_bk_ordner_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_render_bk_ohne_bk_ordner_mutation COMMAND test_render_bk_ohne_bk_ordner_mutation)
set_tests_properties(test_render_bk_ohne_bk_ordner_mutation PROPERTIES WILL_FAIL TRUE)

# Public probe build 2026-11-07: tests that start klick_fassung.py read the interpreter from CYPHERDJ_PYTHON3, the one
# CMake found above (venv on a fresh machine, /usr/bin/python3 here), instead of a fixed /usr/bin/python3.
get_property(cdj_alle_tests DIRECTORY PROPERTY TESTS)
set_property(TEST ${cdj_alle_tests} APPEND PROPERTY ENVIRONMENT "CYPHERDJ_PYTHON3=${Python3_EXECUTABLE}")
