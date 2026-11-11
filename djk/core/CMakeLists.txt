# djk/core: der Echtzeit-Kern. Nur Strang A schreibt hier, eine Scheibe zugleich (ROADMAP §8.2).
# Quellen und Tests werden eingesammelt (CONFIGURE_DEPENDS): neue Dateien unter src/ und tests/test_*.cpp kommen beim
# nächsten Bau ohne Änderung dieser Datei hinzu. src/main.cpp ist das Programm, alles andere unter src/ die Bibliothek.
# Scheibe 08: Fremdquellen aus djk/third_party (toml++, nlohmann/json), Vertrag aus djk/contract (osc_addresses.h),
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
# 1.8 T11 controls of the timing gate; each one is a separate build folder, never part of a product or test build.
# REC_FADEN_BREMSE: the record thread sleeps 50 ms per chunk it writes, so the 512-chunk rings overflow and a take reports gaps (negative control of acceptance_rec_dauer.mjs and of the cost_rec self-check).
# REC_KOSTEN_AUFSCHLAG: Aufnahme::block busy-waits 150 us per sub-block while a run takes (positive control: the cost gate of kern_kosten_rec must turn red).
option(CYPHERDJ_REC_FADEN_BREMSE "T11 control: record thread sleeps 50 ms per chunk (gaps expected)" OFF)
option(CYPHERDJ_REC_KOSTEN_AUFSCHLAG "T11 control: 150 us busy wait in Aufnahme::block while a run takes" OFF)
if(CYPHERDJ_REC_FADEN_BREMSE)
  add_compile_definitions(REC_FADEN_BREMSE=1)
endif()
if(CYPHERDJ_REC_KOSTEN_AUFSCHLAG)
  add_compile_definitions(REC_KOSTEN_AUFSCHLAG=1)
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
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/signalbox stellwerk)
# Scheibe 35: Hand-Bibliothek (Scheibe 19, djk/core/hand): Mapping, MIDI-Übersetzer, Naht zum Stellwerk. Ohne ihre Tests.
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/hand hand)
# Befund B12 (Scheibe 25): djk/core/dsp/meters legt cypherdj_ebur128 selbst an, djk/third_party ebenso; beide zusammen
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

# Cypher Hall (Rust, djk/instruments/reverb_ffi) für fx/2, seit 2026-10-11 statt Faust zita_rev1: cargo baut die statische
# Bibliothek; sie hängt an cypherdj::dsp, damit jedes Ziel, das mixer.cpp übersetzt, sie mitbekommt.
find_program(CARGO cargo REQUIRED)
# rustc version for the golden test (test_mixer_golden.cpp): the digest depends on the compiler of the hall and compressor
# libraries. Asked in the Rust workspace so a rust-toolchain file there applies, as it does for cargo.
execute_process(COMMAND rustc --version WORKING_DIRECTORY ${DJK}/instruments OUTPUT_VARIABLE RUSTC_VERSION_ZEILE
                RESULT_VARIABLE RUSTC_VERSION_RC OUTPUT_STRIP_TRAILING_WHITESPACE)
if(RUSTC_VERSION_RC EQUAL 0 AND RUSTC_VERSION_ZEILE MATCHES "^rustc ([0-9][^ ]*)")
  set(GOLDEN_RUSTC_VERSION ${CMAKE_MATCH_1})
else()
  set(GOLDEN_RUSTC_VERSION "unknown")
endif()
set(HALL_FFI_DIR ${DJK}/instruments)
set(HALL_FFI_LIB ${HALL_FFI_DIR}/target/release/libhall_ffi.a)
# Seit 2026-10-11 trägt dieselbe Bibliothek auch Cypher Komp (komp_dsp): zwei Rust-Staticlibs kollidieren im Binary
# (und Baukasten-Graphen der Erzeuger-Ströme).
# D1 K2a: dazu die RB-338 (rb_dsp, cypher_rb_* in reverb_ffi/src/rb.rs); ohne rb_dsp hier baute eine Änderung dort nicht neu.
# Baukasten S3a: dazu baukasten_dsp mit saett_dsp und eq_dsp (cypher_bk_* in reverb_ffi/src/baukasten.rs).
file(GLOB HALL_FFI_QUELLEN CONFIGURE_DEPENDS ${HALL_FFI_DIR}/reverb_ffi/src/*.rs ${HALL_FFI_DIR}/reverb_dsp/src/*.rs
     ${HALL_FFI_DIR}/comp_dsp/src/*.rs ${HALL_FFI_DIR}/rb_dsp/src/*.rs ${HALL_FFI_DIR}/reverb_ffi/Cargo.toml
     ${HALL_FFI_DIR}/modular_dsp/src/*.rs ${HALL_FFI_DIR}/sat_dsp/src/*.rs ${HALL_FFI_DIR}/eq_dsp/src/*.rs
     ${HALL_FFI_DIR}/reverb_dsp/Cargo.toml ${HALL_FFI_DIR}/comp_dsp/Cargo.toml ${HALL_FFI_DIR}/rb_dsp/Cargo.toml
     ${HALL_FFI_DIR}/modular_dsp/Cargo.toml ${HALL_FFI_DIR}/sat_dsp/Cargo.toml ${HALL_FFI_DIR}/eq_dsp/Cargo.toml)
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
# src/stretcher_bungee.cpp gehört nicht in KERN_QUELLEN (die Mutationsziele mit eigener Quellenliste kennen Bungee nicht): nur die
# Bibliothek und die Ziele, die Bungee ausdrücklich brauchen, binden sie (mit CYPHERDJ_BUNGEE und cypherdj::bungee).
list(REMOVE_ITEM KERN_QUELLEN ${CMAKE_CURRENT_SOURCE_DIR}/src/stretcher_bungee.cpp)
# Paket 1.13 Slice 2: ebenso die Bungee-Maschine des Warp-Werks; src/warp_factory.cpp (Pool, Ringe, Fäden) kennt Bungee nicht und bleibt in KERN_QUELLEN
list(REMOVE_ITEM KERN_QUELLEN ${CMAKE_CURRENT_SOURCE_DIR}/src/warp_factory_bungee.cpp)
set(KERN_BUNGEE_QUELLE)
if(CYPHERDJ_BUNGEE)
  include(${DJK}/third_party/bungee.cmake)
  set(KERN_BUNGEE_QUELLE ${CMAKE_CURRENT_SOURCE_DIR}/src/stretcher_bungee.cpp ${CMAKE_CURRENT_SOURCE_DIR}/src/warp_factory_bungee.cpp)
endif()
add_library(cypherdj_kernbib STATIC ${KERN_QUELLEN} ${KERN_BUNGEE_QUELLE})
if(CYPHERDJ_BUNGEE)
  target_compile_definitions(cypherdj_kernbib PUBLIC CYPHERDJ_BUNGEE=1)
  target_link_libraries(cypherdj_kernbib PUBLIC cypherdj::bungee)
endif()
target_include_directories(cypherdj_kernbib PUBLIC include ${DJK}/contract)
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
# -DCYPHERDJ_MUTATION_GETEILT=OFF restores the old build (every target compiles all its sources). The libraries of the core
# mutation programs (the same list in every helper):
set(KERN_MUT_LIBS PkgConfig::JACK Threads::Threads cypherdj::toml cypherdj::dsp cypherdj::stellwerk cypherdj_dsp_messer cypherdj::json
    PkgConfig::CRYPTO cypherdj::hand PkgConfig::RUBBERBAND)  # 25, 31, 35; Keylock Slice 3: KERN_QUELLEN contains net_loop.cpp and loop_stretch.cpp
include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/mutation_geteilt.cmake)
function(kern_mutation name schalter)
  kern_mut_exe(${name} QUELLEN src/main.cpp ${KERN_QUELLEN} SCHALTER ${schalter} INCLUDES include ${DJK}/contract LIBS ${KERN_MUT_LIBS})
endfunction()
kern_mutation(cypherdj-kern-mutation CYPHERDJ_MUTATION_KLICK_BLOCKANFANG)       # Scheibe 01: Klick auf den Blockanfang
kern_mutation(cypherdj-kern-mutation-rampe CYPHERDJ_MUTATION_RAMPE_IN_SAMPLES)  # Scheibe 08: Rampe in Samples statt Beats
kern_mutation(cypherdj-kern-mutation-begin CYPHERDJ_MUTATION_ERZ_BEGIN_IGNORIERT)  # MVP 2 Scheibe 3: begin/end ignoriert
kern_mutation(cypherdj-kern-mutation-bk-rampe CYPHERDJ_MUTATION_BK_RAMPE_TOTZONE)  # S23: slow ramps on graph knobs never reach the graph (live probe track_bk_measure.py must go red)

enable_testing()
file(GLOB KERN_TESTS CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_*.cpp)
# Scheibe 25: test_mixer prüft die Zuweisungstabelle (Wege bitgleich, Blende, Crossfader, PFL/Cue) am Mixer ohne den
# Master-Limiter dahinter; den Limiter, seinen Vorhalt und den verzögerten Cue prüft test_limiter25 am Betriebs-Mixer.
list(REMOVE_ITEM KERN_TESTS ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_mixer.cpp)
# Baukasten S3b Task 2: die Attrappe definiert cypher_bk_* selbst und darf hall_ffi nicht linken (eigenes Ziel weiter unten).
list(REMOVE_ITEM KERN_TESTS ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_generator_bk_factory_mock.cpp)
if(NOT CYPHERDJ_BUNGEE)
  list(FILTER KERN_TESTS EXCLUDE REGEX "test_([a-z_]*bungee|warp_factory)")  # Tests der Bungee-Maschine und des Warp-Werks bauen nur mit CYPHERDJ_BUNGEE
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
  # 1.8 T3: the recording threads (callback, net thread swapping RecSpur, AufnahmeFaden) and the monitor of the external inputs run under TSan too; only names in this list
  # start through setarch -R and carry the failure pattern, any other test would run plain and could abort with "unexpected memory mapping" or hide TSan lines
  # mehrkern plan: the HallPool and its callers run under TSan too (test_reverb_pool, test_arr_returns, test_reverb_state)
  if(CYPHERDJ_TSAN AND (t STREQUAL "test_freeze_tsan" OR t STREQUAL "test_arr_tap" OR t STREQUAL "test_arr_tap_pool" OR t STREQUAL "test_core_arr_tap" OR t STREQUAL "test_net_arr_tap" OR t STREQUAL "test_arr_auto_tsan" OR t STREQUAL "test_reverb_pool" OR t STREQUAL "test_arr_returns" OR t STREQUAL "test_reverb_state" OR t STREQUAL "test_arr_track_path" OR t STREQUAL "test_arr_inserts_path" OR t STREQUAL "test_arr_host_stufe" OR t STREQUAL "test_arr_host_ausfall" OR t STREQUAL "test_arr_host_measurement" OR t STREQUAL "test_arr_track_phase" OR t STREQUAL "test_arr_track_pool" OR t STREQUAL "test_arr_rack_path" OR t STREQUAL "test_arr_rack_macro" OR t STREQUAL "test_arr_auto_chain" OR t STREQUAL "test_arr_auto_bk_button" OR t STREQUAL "test_core_track_time" OR t STREQUAL "test_track_state" OR t STREQUAL "test_recording_tsan" OR t STREQUAL "test_recording_thread" OR t STREQUAL "test_core_rec" OR t STREQUAL "test_arr_monitor" OR t STREQUAL "test_render_nur_key" OR t STREQUAL "test_arr_export_run" OR t STREQUAL "test_net_arr_export_run"))
    add_test(NAME ${t} COMMAND ${TSAN_START} $<TARGET_FILE:${t}>)
    set_tests_properties(${t} PROPERTIES FAIL_REGULAR_EXPRESSION "ThreadSanitizer")   # jede TSan-Zeile ist ein Befund
  else()
    add_test(NAME ${t} COMMAND ${t})
  endif()
endforeach()
# Keylock Task 1b (Prüfung F3): test_stretcher misst die Lage gegen eine nackte Rubber-Band-Instanz (Referenz „rohes R3“).
target_link_libraries(test_stretcher PRIVATE PkgConfig::RUBBERBAND)
# Keylock Task 2: test_deck_keylock misst die Lage ebenso gegen rohes R3 (keylock_mess.h).
target_link_libraries(test_deck_keylock PRIVATE PkgConfig::RUBBERBAND)
# Keylock Task 2.5: test_core_keylock_threads misst Tonhöhe und Lage mit keylock_mess.h (bindet Rubber Band ein).
target_link_libraries(test_core_keylock_threads PRIVATE PkgConfig::RUBBERBAND)
# Keylock Task 7: test_loopbox_keylock misst die Lage der Box gegen rohes R3 (keylock_mess.h).
target_link_libraries(test_loopbox_keylock PRIVATE PkgConfig::RUBBERBAND)
# Keylock Task 6a: test_deck_planned misst mit keylock_mess.h (bindet Rubber Band ein).
target_link_libraries(test_deck_planned PRIVATE PkgConfig::RUBBERBAND)
# mehrkern Task 3: the HallPool stress case must fail, not hang
set_tests_properties(test_reverb_pool PROPERTIES TIMEOUT 120)
# Task 2.5c: Speichersperre des Keylock-Baus in eigenen Prozessen (frischer Speicher), Vergleich mit Stand 2.5b
add_test(NAME test_kern_keylock_faeden_sperre COMMAND test_core_keylock_threads sperre)
add_test(NAME test_kern_keylock_faeden_sperre_alt COMMAND test_core_keylock_threads sperre_alt)
# Audit F17: ein Rückfall in den Netz-Livelock hängt den Test, statt rot zu werden; die Frist macht ihn rot.
set_tests_properties(test_net_self_subscription PROPERTIES TIMEOUT 20)

# Keylock Slice 3/4: loop_stretch.cpp und keylock_render.cpp (REC-Umrechnung) liegen in kernbib. Die test_mutation-Ziele mit
# expliziten Quellenlisten binden net*.cpp nicht ein und brauchen weder keylock_render.cpp noch loop_stretch.cpp noch
# librubberband. Task 7: die Keylock-Varianten der Boxen und ihre Tests (test_keylock_rampe, test_netz_keylock,
# test_netz_keylock_kern, test_loop_stretch, test_loop_stretch_lage) sind ausgebaut; die Box prüft test_loopbox_keylock.

# Tests gegen eine Mutation gebaut müssen scheitern (WILL_FAIL): so ist gezeigt, dass sie den Fehlerfall sehen.
# Angelegt erst, wenn die Testdatei und alle Quellen da sind (die Tasks des Plans bringen sie nacheinander).
# Argumente nach dem Schalter: Quellen; Einträge der Form PkgConfig::X sind Bibliotheken zum Binden (Keylock Task 1:
# PkgConfig::RUBBERBAND für Ziele mit src/stretcher.cpp).
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
  if(CYPHERDJ_BUNGEE AND ("src/stretcher_bungee.cpp" IN_LIST tm_quellen OR "src/arr_playback.cpp" IN_LIST tm_quellen OR "src/warp_factory.cpp" IN_LIST tm_quellen))  # nur die Ziele, die Bungee ausdrücklich einbinden;
    list(APPEND tm_defs CYPHERDJ_BUNGEE=1)   # Paket 1.13 Slice 2: der Lader fragt es nur (Maschinen-Tor für complex und tones), er bindet Bungee nicht
  endif()
  kern_mut_exe(${name} QUELLEN tests/${test}.cpp ${tm_quellen} SCHALTER ${schalter} DEFS ${tm_defs}
               INCLUDES include tests ${DJK}/contract
               LIBS PkgConfig::JACK Threads::Threads cypherdj::dsp cypherdj::stellwerk
                    cypherdj_dsp_messer cypherdj::json PkgConfig::CRYPTO cypherdj::hand ${tm_libs})  # Scheibe 25, 31, 35
  add_test(NAME ${name} COMMAND ${name} ${TM_FALL})   # TM_FALL (optional, set by the caller): run exactly this case of the test, so a red earlier case cannot mask the detector
  set_tests_properties(${name} PROPERTIES WILL_FAIL TRUE)
endfunction()
# D1 K1: Quellen des Moduls Arrangement (arrangement.h); die Ziele mit eigener Quellenliste brauchen sie, sobald der Kern
# das Modul hält (Slice 8). Wächst mit den Slices 4 bis 7.
set(ARR_QUELLEN src/arrangement.cpp src/arr_voices.cpp src/arr_output.cpp src/arr_notes.cpp src/arr_metronom.cpp
    src/arr_freeze.cpp  # Paket K3: Freeze
    src/arr_tap.cpp # 1.10 slice 7: the real-time tap of any strip
    src/arr_export_run.cpp # plan 1.11 T12: the real-time export run of the production master (the writer thread is arr_export_writer.cpp, in the library only)
    src/arr_auto.cpp    # Automation Slice 1: fader lane per sample, blend (ADR 032)
    src/arr_returns.cpp # 1.10 Slice 3: Cypher Hall of the return strips
    src/reverb_pool.cpp   # mehrkern task 4: the return Halls compute on the HallPool
    src/arr_inserts.cpp # 1.10 slice 4a: pooled compressor inserts of the strips
    src/arr_host_stufe.cpp # plan 1.11 T4: the effect-host insert stage (send, return guard, delayed dry path)
    src/arr_host_measurement.cpp # plan 1.11 T5: the round-trip measurement of an effect host
    src/arr_track_phase.cpp # mehrkern slice 3.1: the sticky plan of the track phase
    src/arr_monitor.cpp # 1.8 Slice 3: monitor of the external inputs (R10)
    src/arr_warp.cpp)   # Paket 1.13 Slice 2: Seite des Arrangements am Warp-Werk (nur die Schnittstelle warp_factory.h, kein Bungee)
list(APPEND ARR_QUELLEN src/arr_bk_sink.cpp src/arr_kit_sink.cpp src/arr_intern_sink.cpp src/arr_rb_sink.cpp src/arr_instrument_host_sink.cpp
     src/arr_rack_sink.cpp)   # 1.9 U6: instrument rack. D1 K2b: Senken (RB-338 über cypherdj::dsp -> libhall_ffi.a, Wirt-Slots)
test_mutation(test_klick_mutation test_click CYPHERDJ_MUTATION_KLICK_BLOCKANFANG src/click.cpp src/clock.cpp)
test_mutation(test_tempoplan_mutation test_tempo_plan CYPHERDJ_MUTATION_RAMPE_IN_SAMPLES src/tempo_plan.cpp src/clock.cpp)
test_mutation(test_befehle_mutation test_commands CYPHERDJ_MUTATION_TAKT_AUS_KARTE
              src/core.cpp src/generator.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/core_signalbox.cpp src/core_arr.cpp ${ARR_QUELLEN} src/mixer.cpp src/beatfx.cpp src/parts.cpp src/click.cpp src/tempo_plan.cpp
              src/clock.cpp  # Scheibe 25: core.cpp braucht Stellwerk-Anbindung, Mixer und Schatten
              src/core_deck.cpp src/core_mix.cpp src/deck.cpp src/loader.cpp src/rendition.cpp  # Scheibe 31: und die Decks
              src/core_hand.cpp src/hand_in.cpp  # Scheibe 35: Kern-Hand
              stub/stretcher_stub.cpp)  # Keylock Task 2: core_deck.cpp ruft die Fabrik (Vertrag 13)
test_mutation(test_ausgang_mutation test_output CYPHERDJ_MUTATION_OHNE_RIEGEL)
# Plan 2026-09-27 (Strudel Stufe 1), Fehlerfall: Erzeuger-Einsatz am Blockanfang statt am Sample des Beats.
test_mutation(test_erzeuger_mutation test_generator CYPHERDJ_MUTATION_ERZ_BLOCKANFANG src/generator.cpp src/kit.cpp src/clock.cpp)
# K2 Task 1.2, Fehlerfall: Kick-Auslöser am Blockanfang statt am Sample.
test_mutation(test_erzeuger_duck_mutation test_generator_duck CYPHERDJ_MUTATION_DUCK_BLOCKANFANG src/generator.cpp src/kit.cpp src/clock.cpp)
# Glanz 2.5.1 (F46), Fehlerfall: Erzeuger-Stimmen ohne Rampe an begin/end.
test_mutation(test_erzeuger_rampe_mutation test_generator CYPHERDJ_MUTATION_ERZ_OHNE_RAMPE src/generator.cpp src/kit.cpp src/clock.cpp)
# Glanz 2.5.2 (F16), Fehlerfall: Stimmenraub ohne Suche nach einer freien Stimme.
test_mutation(test_erzeuger_raub_mutation test_generator CYPHERDJ_MUTATION_ERZ_OHNE_FREIE src/generator.cpp src/kit.cpp src/clock.cpp)
# Glanz 2.4.1 (F11), Fehlerfall: Kit-Tausch schneidet klingende Stimmen hart ab.
test_mutation(test_erzeuger_tausch_mutation test_generator CYPHERDJ_MUTATION_KIT_TAUSCH_HART src/generator.cpp src/kit.cpp src/clock.cpp)
# Prüfung Slice 2.5/2.4, Fix A: zu wenige Ausklang-Plätze (Raub + Kit-Tausch zusammen brauchen 2 · ERZ_STIMMEN).
test_mutation(test_erzeuger_ausklangplaetze_mutation test_generator CYPHERDJ_MUTATION_ERZ_AUSKLANG_PLAETZE src/generator.cpp src/kit.cpp src/clock.cpp)
# Prüfung Slice 2.5/2.4, Fix B: Raub wählt die jüngste statt der ältesten Stimme.
test_mutation(test_erzeuger_raubwahl_mutation test_generator CYPHERDJ_MUTATION_ERZ_RAUB_JUENGSTE src/generator.cpp src/kit.cpp src/clock.cpp)
# Prüfung Slice 2.5/2.4, Fix B: jeder Ausklang landet auf Platz 0 und überschreibt den vorigen.
test_mutation(test_erzeuger_ausklangplatz_mutation test_generator CYPHERDJ_MUTATION_ERZ_AUSKLANG_PLATZ0 src/generator.cpp src/kit.cpp src/clock.cpp)
# Baukasten S3a Task 2: Fehlerfälle des Erzeuger-Stroms mit Graph (test_generator_bk).
test_mutation(test_erzeuger_bk_vorhalt_mutation test_generator_bk CYPHERDJ_MUTATION_BK_VORHALT src/generator.cpp src/kit.cpp src/clock.cpp)
test_mutation(test_erzeuger_bk_hart_mutation test_generator_bk CYPHERDJ_MUTATION_BK_HART src/generator.cpp src/kit.cpp src/clock.cpp)
test_mutation(test_erzeuger_bk_kit_spielt_mutation test_generator_bk CYPHERDJ_MUTATION_BK_KIT_SPIELT src/generator.cpp src/kit.cpp src/clock.cpp)
test_mutation(test_erzeuger_bk_off_blockanfang_mutation test_generator_bk CYPHERDJ_MUTATION_BK_OFF_BLOCKANFANG src/generator.cpp src/kit.cpp src/clock.cpp)
test_mutation(test_erzeuger_bk_ohne_klemme_mutation test_generator_bk CYPHERDJ_MUTATION_BK_OHNE_KLEMME src/generator.cpp src/kit.cpp src/clock.cpp)
test_mutation(test_erzeuger_bk_fade_konstant_mutation test_generator_bk CYPHERDJ_MUTATION_BK_FADE_KONSTANT src/generator.cpp src/kit.cpp src/clock.cpp)
test_mutation(test_erzeuger_bk_alle_aus_mutation test_generator_bk CYPHERDJ_MUTATION_BK_ALLE_AUS src/generator.cpp src/kit.cpp src/clock.cpp)
test_mutation(test_erzeuger_bk_zweiter_wechsel_leck_mutation test_generator_bk CYPHERDJ_MUTATION_BK_ZWEITER_WECHSEL_LECK src/generator.cpp src/kit.cpp src/clock.cpp)
# Bug t_bffc3708 (stille): /erz/fenster mit kappe = 1 beendet gehaltene Graph-Noten; die Mutation merkt die Kappe nie vor (Fall "kappe" scheitert).
test_mutation(test_erzeuger_bk_kappe_mutation test_generator_bk CYPHERDJ_MUTATION_ERZ_KAPPE_IGNORIERT src/generator.cpp src/kit.cpp src/clock.cpp)
test_mutation(test_erzeuger_bk_kappe_nicht_aufgehoben_mutation test_generator_bk CYPHERDJ_MUTATION_ERZ_KAPPE_NICHT_AUFGEHOBEN src/generator.cpp src/kit.cpp src/clock.cpp)
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
# Baukasten S3b Task 1: Fehlerfälle des Graph-Werks (test_graph_factory).
test_mutation(test_graph_werk_ohne_stehlen_mutation test_graph_factory CYPHERDJ_MUTATION_GW_OHNE_STEHLEN src/graph_factory.cpp)
test_mutation(test_graph_werk_spaet_gueltig_mutation test_graph_factory CYPHERDJ_MUTATION_GW_SPAET_GUELTIG src/graph_factory.cpp)
test_mutation(test_graph_werk_auftrag_besetzt_mutation test_graph_factory CYPHERDJ_MUTATION_GW_AUFTRAG_BESETZT src/graph_factory.cpp)
test_mutation(test_graph_werk_falsches_s_mutation test_graph_factory CYPHERDJ_MUTATION_GW_FALSCHES_S src/graph_factory.cpp)
test_mutation(test_graph_werk_kein_rueckfall_mutation test_graph_factory CYPHERDJ_MUTATION_GW_KEIN_RUECKFALL src/graph_factory.cpp)
test_mutation(test_graph_werk_verwerfen_rechnet_mutation test_graph_factory CYPHERDJ_MUTATION_GW_VERWERFEN_RECHNET src/graph_factory.cpp)
# Fall 5 fährt in ctest 5000 statt 50 000 Zyklen (CYPHERDJ_GW_ZYKLEN); ein hängender Stub (halt ohne los) hängt ctest nicht bis zum Vorgabe-Timeout.
foreach(t test_graph_factory test_graph_werk_ohne_stehlen_mutation test_graph_werk_spaet_gueltig_mutation test_graph_werk_auftrag_besetzt_mutation
          test_graph_werk_falsches_s_mutation test_graph_werk_kein_rueckfall_mutation test_graph_werk_verwerfen_rechnet_mutation)
  if(TEST ${t})
    set_tests_properties(${t} PROPERTIES ENVIRONMENT "CYPHERDJ_GW_ZYKLEN=5000" TIMEOUT 120)
  endif()
endforeach()
# Baukasten S3b Task 2: Erzeuger mit Graph-Werk. test_generator_bk_factory mit echtem Graphen (hall_ffi); die Attrappe ohne
# hall_ffi, nur mit den Quellen, die der Erzeuger braucht (Review F2 N3), und ihre Fehlerfälle.
test_mutation(test_erzeuger_bk_werk_rampe_spaet_mutation test_generator_bk_factory CYPHERDJ_MUTATION_BK_WERK_RAMPE_SPAET
              src/generator.cpp src/kit.cpp src/clock.cpp src/graph_factory.cpp)
test_mutation(test_erzeuger_bk_werk_ausklang_stumm_mutation test_generator_bk_factory CYPHERDJ_MUTATION_BK_WERK_AUSKLANG_STUMM
              src/generator.cpp src/kit.cpp src/clock.cpp src/graph_factory.cpp)
# Bug t_bffc3708 (stille) mit Werk: dieselbe Fehlerart, bk_noten wendet die vorgemerkte Kappe nicht an.
test_mutation(test_erzeuger_bk_werk_kappe_mutation test_generator_bk_factory CYPHERDJ_MUTATION_ERZ_KAPPE_IGNORIERT
              src/generator.cpp src/kit.cpp src/clock.cpp src/graph_factory.cpp)
test_mutation(test_erzeuger_bk_werk_kappe_nicht_aufgehoben_mutation test_generator_bk_factory CYPHERDJ_MUTATION_ERZ_KAPPE_NICHT_AUFGEHOBEN
              src/generator.cpp src/kit.cpp src/clock.cpp src/graph_factory.cpp)
function(test_bk_attrappe name schalter)
  kern_mut_exe(${name} QUELLEN tests/test_generator_bk_factory_mock.cpp src/generator.cpp src/kit.cpp src/clock.cpp src/graph_factory.cpp
               SCHALTER ${schalter}
               INCLUDES include tests ${DJK}/contract   # nur Köpfe (mixer.h), nichts gelinkt
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
test_bk_attrappe(test_generator_bk_factory_mock "")
test_bk_attrappe(test_erzeuger_bk_werk_spaet_verbraucht_mutation CYPHERDJ_MUTATION_BK_WERK_SPAET_VERBRAUCHT)
test_bk_attrappe(test_erzeuger_bk_werk_noten_trotz_besetzt_mutation CYPHERDJ_MUTATION_BK_WERK_NOTEN_TROTZ_BESETZT)
test_bk_attrappe(test_erzeuger_bk_werk_wechsel_sofort_mutation CYPHERDJ_MUTATION_BK_WERK_WECHSEL_SOFORT)
# Baukasten S5r Task 3: Graph-Regler. Die Attrappe sieht alle vier Fehlerfälle (nicht gemeldet, an besetztem Platz, falscher Kanal,
# getauschter Graph ohne Wert); test_generator_bk (ohne Werk) und test_core_channel_graph (Kern bis Mixer) die drei übrigen.
foreach(mut NICHT_GEMELDET TROTZ_BESETZT FALSCHER_KANAL TAUSCH_05)
  string(TOLOWER ${mut} mut_klein)
  test_bk_attrappe(test_erzeuger_bk_werk_regler_${mut_klein}_mutation CYPHERDJ_MUTATION_BK_REGLER_${mut})
endforeach()
foreach(mut NICHT_GEMELDET FALSCHER_KANAL TAUSCH_05)
  string(TOLOWER ${mut} mut_klein)
  test_mutation(test_erzeuger_bk_regler_${mut_klein}_mutation test_generator_bk CYPHERDJ_MUTATION_BK_REGLER_${mut} src/generator.cpp src/kit.cpp src/clock.cpp)
endforeach()
# Plan MVP 2 (ADR 025), Fehlerfall: Loop-Position ab dem Einsatz statt aus dem Beat (Box läuft neben dem Raster).
test_mutation(test_loopbox_mutation test_loopbox CYPHERDJ_MUTATION_LOOP_AB_START src/loopbox.cpp src/loop.cpp src/clock.cpp)
# Plan MVP 2 Scheibe 2 (ADR 025 Folgeplan), Fehlerfall: Mitschnitt-Einsatz am Blockanfang statt ab ab_sample.
test_mutation(test_loopbox_mitschnitt_mutation test_loopbox CYPHERDJ_MUTATION_MITSCHNITT_BLOCKANFANG src/loopbox.cpp src/loop.cpp src/clock.cpp)
# Plan Grid, Fehlerfall: die Box ignoriert den Raster-Versatz (spielt ungedreht).
test_mutation(test_loopbox_versatz_mutation test_loopbox CYPHERDJ_MUTATION_LOOP_OHNE_VERSATZ src/loopbox.cpp src/loop.cpp src/clock.cpp)
# Plan Tempo-Folge: Box liest bei Tempo ≠ 128 aus den Samples statt aus dem Beat (läuft neben der Uhr).
test_mutation(test_loopbox_tempo_mutation test_loopbox CYPHERDJ_MUTATION_LOOP_TEMPO_STARR src/loopbox.cpp src/loop.cpp src/clock.cpp)
# Welle 2 Slice 2.2: Fehlerfall des Blend-Bausteins (Umzielen ab dem alten Ziel statt ab dem Ist-Wert, Klasse F27).
test_mutation(test_blende_mutation test_fade CYPHERDJ_MUTATION_BLENDE_ABBRUCH)
# Welle 2 F15, Fehlerfall: Loop-Box ohne Hülle (harter Einsatz und Stopp, Ausklang bei /k/set/neu). test_loopbox muss scheitern.
test_mutation(test_loopbox_huelle_mutation test_loopbox CYPHERDJ_MUTATION_LOOP_OHNE_HUELLE src/loopbox.cpp src/loop.cpp src/clock.cpp)
# Welle 2 F13, Fehlerfall: Laden in eine laufende Box tauscht hart. test_loopbox muss scheitern.
test_mutation(test_loopbox_laden_mutation test_loopbox CYPHERDJ_MUTATION_LOOP_LADEN_HART src/loopbox.cpp src/loop.cpp src/clock.cpp)
# Keylock Task 3b: ein neuer Abonnent bekommt den Stand des Knopfs nicht (/e/regler keylock beim ersten /k/hallo): test_net_deck rot.
kern_mut_exe(test_netz_deck_knopf_mutation QUELLEN tests/test_net_deck.cpp ${KERN_QUELLEN} SCHALTER CYPHERDJ_MUTATION_KEYLOCK_HALLO_OHNE_KNOPF
             DEFS CYPHERDJ_DJK="${DJK}" INCLUDES include tests ${DJK}/contract LIBS ${KERN_MUT_LIBS})
add_test(NAME test_netz_deck_knopf_mutation COMMAND test_netz_deck_knopf_mutation)
set_tests_properties(test_netz_deck_knopf_mutation PROPERTIES WILL_FAIL TRUE)
# Plan 3 (Beat-FX), Fehlerfall: LFO-Phase ab dem ersten Block statt aus dem absoluten Beat.
test_mutation(test_beatfx_mutation test_beatfx CYPHERDJ_MUTATION_FX_LFO_AB_START src/beatfx.cpp)

# Scheibe 18, Messgerät der Abschuss-Serien (tests/restart/): JACK-Aufnehmer mit vier Kanälen am Ziel. Liegt in einem
# Unterordner, den das Einsammeln der Tests oben nicht erfasst.
add_executable(cypherdj-aufnehmer4 tests/restart/recorder4.cpp)
target_link_libraries(cypherdj-aufnehmer4 PRIVATE PkgConfig::JACK)
target_compile_options(cypherdj-aufnehmer4 PRIVATE -Wall -Wextra)

# Scheibe 18: Diagnose des Neustart-Zustands (nur lesend, INTERFACES §6.3) und die Vergleichsmessung der Kosten des
# Echtzeit-Fachs (kein Test). Beide in Unterordnern, die das Einsammeln oben nicht erfasst.
add_executable(cypherdj-zustand src/tools/state.cpp)
target_link_libraries(cypherdj-zustand PRIVATE cypherdj_kernbib)
target_compile_options(cypherdj-zustand PRIVATE -Wall -Wextra)
add_executable(neustart_kosten tests/restart/cost.cpp)
target_link_libraries(neustart_kosten PRIVATE cypherdj_kernbib)
# Scheibe 18: der Test des Selbst-Wächters muss einen Wächter erkennen, der meldet, aber nicht tötet
test_mutation(test_selbstwaechter_mutation test_self_guard CYPHERDJ_MUTATION_WAECHTER_OHNE_KILL src/self_guard.cpp)
test_mutation(test_selbstwaechter_mutation_rand test_self_guard CYPHERDJ_MUTATION_WAECHTER_GRENZE_AB_SEIT src/self_guard.cpp)  # Slice 2 MINOR-1
# Scheibe 25, Fehlerfall der Abnahme: Griff der Hand am Blockanfang statt am Versatz (09 Probe b naiv_block). Der Kern
# damit fährt hand_gewinnt rot (Abbruch-Quittung bei Sample 1 619 968 statt 1 620 000); test_core_hand gegen dieselbe
# Mutation muss scheitern.
kern_mutation(cypherdj-kern-mutation-hand CYPHERDJ_MUTATION_HAND_BLOCKANFANG)
test_mutation(test_kern_hand_mutation test_core_hand CYPHERDJ_MUTATION_HAND_BLOCKANFANG
              src/core.cpp src/generator.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/core_signalbox.cpp src/core_arr.cpp ${ARR_QUELLEN} src/mixer.cpp src/beatfx.cpp src/parts.cpp src/click.cpp src/tempo_plan.cpp src/clock.cpp
              src/core_deck.cpp src/core_mix.cpp src/deck.cpp src/loader.cpp src/rendition.cpp  # Scheibe 31
              src/core_hand.cpp src/hand_in.cpp  # Scheibe 35
              stub/stretcher_stub.cpp)  # Keylock Task 2: Fabrik ohne Rubber Band
# Scheibe 25, Fehlerfall der Abnahme „Limiter im Master“ (MVP, Lücken und Entscheide): Master ohne Limiter. test_limiter25
# gegen diese Mutation muss scheitern (heißes Signal über −1 dBTP); cypherdj-kern-mutation-limiter für die Messung an der
# Fassung (tests/limiter/).
kern_mutation(cypherdj-kern-mutation-limiter CYPHERDJ_MUTATION_OHNE_LIMITER)
test_mutation(test_limiter25_mutation test_limiter25 CYPHERDJ_MUTATION_OHNE_LIMITER src/mixer.cpp src/beatfx.cpp)
# K2 Task 1.5: Duck ohne Wirkung auf den Kanälen. test_mixer_duck (vom Glob angelegt) gegen diese Mutation muss scheitern.
test_mutation(test_mixer_duck_mutation test_mixer_duck CYPHERDJ_MUTATION_DUCK_AUS src/mixer.cpp src/beatfx.cpp)
# Sleep state of silent strips: without the ruhig() and holder checks only the zero input decides, so a strip with a colour tail or a
# noise colour move sleeps although it makes sound. test_mixer_sleep (from the glob) against this mutation must fail.
test_mutation(test_mixer_schlaf_mutation test_mixer_sleep CYPHERDJ_MUTATION_SCHLAF_OHNE_RUHIG src/mixer.cpp src/beatfx.cpp)
# K2 Task 2.2: Rückweg fx/2 ohne Hall in der Summe. test_mixer_reverb (vom Glob angelegt) gegen diese Mutation muss scheitern.
test_mutation(test_mixer_hall_mutation test_mixer_reverb CYPHERDJ_MUTATION_HALL_TOT src/mixer.cpp src/beatfx.cpp)
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
test_mutation(test_mixer_wz_nachfuehren_mutation test_mixer_wz_track CYPHERDJ_MUTATION_WZ_OHNE_NACHFUEHREN src/mixer.cpp src/beatfx.cpp)
# A3 fix round (reviews of 2026-11-03): each of these was a mutation the first version's tests let through.
test_mutation(test_mixer_utility_gate_ohne_guard_mutation test_mixer_utility CYPHERDJ_MUTATION_GATE_OHNE_GUARD src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_gate_start_zu_mutation test_mixer_gate CYPHERDJ_MUTATION_GATE_START_ZU src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_gate_kein_reset_mutation test_mixer_gate CYPHERDJ_MUTATION_GATE_KEIN_RESET src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_gate_f01_ohne_werkzeuge_mutation test_mixer_gate CYPHERDJ_MUTATION_F01_OHNE_WERKZEUGE src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_gate_wz_wert_nur_w_mutation test_mixer_gate CYPHERDJ_MUTATION_WZ_WERT_NUR_W src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_gate_util_nach_gate_mutation test_mixer_gate CYPHERDJ_MUTATION_UTIL_NACH_GATE src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_wz_felder_hold_attack_mutation test_mixer_wz_fields CYPHERDJ_MUTATION_WZ_HOLD_ATTACK_VERTAUSCHT src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_wz_felder_phaser_dc_mutation test_mixer_wz_fields CYPHERDJ_MUTATION_WZ_PHASER_DC_VERTAUSCHT src/mixer.cpp src/beatfx.cpp)
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
test_mutation(test_mixer_wz_felder_mb_grenzen_mutation test_mixer_wz_fields CYPHERDJ_MUTATION_MB_GRENZEN_VERTAUSCHT src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_wz_felder_mb_attack_release_mutation test_mixer_wz_fields CYPHERDJ_MUTATION_MB_ATTACK_RELEASE_VERTAUSCHT src/mixer.cpp src/beatfx.cpp)
# A4 M5 fix (crossover change by crossfade of two objects): the old behaviour, the dynamics not handed over, the newest target lost.
test_mutation(test_mixer_multiband_grenze_sofort_mutation test_mixer_multiband_limits CYPHERDJ_MUTATION_MB_GRENZE_SOFORT src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_dynamik_nicht_kopiert_mutation test_mixer_multiband_limits CYPHERDJ_MUTATION_MB_DYNAMIK_NICHT_KOPIERT src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_vormerken_verloren_mutation test_mixer_multiband_limits CYPHERDJ_MUTATION_MB_VORMERKEN_VERLOREN src/mixer.cpp src/beatfx.cpp)
# fix round 1: the warm-up must not restart at every new target; the guard must reset the second object too; the dynamics are carried over whole
test_mutation(test_mixer_multiband_warm_neu_start_mutation test_mixer_multiband_limits CYPHERDJ_MUTATION_MB_WARM_NEU_START src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_f01_nur_erstes_mutation test_mixer_multiband CYPHERDJ_MUTATION_MB_F01_NUR_ERSTES src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_dynamik_nur_rampen_mutation test_mixer_multiband_limits CYPHERDJ_MUTATION_MB_DYNAMIK_NUR_RAMPEN src/mixer.cpp src/beatfx.cpp)
# fix round 2: the warm-up rule (anchor, both crossovers, big steps only pending)
test_mutation(test_mixer_multiband_klass_nur_tief_mutation test_mixer_multiband_run_in CYPHERDJ_MUTATION_MB_KLASSE_NUR_TIEF src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_vergleich_letztes_ziel_mutation test_mixer_multiband_run_in CYPHERDJ_MUTATION_MB_VERGLEICH_LETZTES_ZIEL src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_gross_angewendet_mutation test_mixer_multiband_run_in CYPHERDJ_MUTATION_MB_GROSS_ANGEWENDET src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_multiband_einlauf_warm_neu_start_mutation test_mixer_multiband_run_in CYPHERDJ_MUTATION_MB_WARM_NEU_START src/mixer.cpp src/beatfx.cpp)
# Package 1.15 task A5a: the latency account. Each of these must turn test_mixer_latency_account red (WILL_FAIL):
#   the four the task names (PFL ring without + L, metronome undelayed, bus_sum_ not merged, the merge in front of the hall return), a ring
#   read one sample off, (fix round 1) the clamp removed, the same value clearing the lines, no check in front of the metronome line, the PFL ring not
#   cleared by F01, the send-graph return after the merge, a PFL ring sized for vh = 84, a PFL ring that was not enlarged (stable red only through the wrong delay; under CYPHERDJ_SANITIZE the bounds check aborts), and the F01 guard without the delay lines / without the check in front of them.
foreach(mut F01_PFL_RING_AUCH_L0 PFL_RING_VH84 KLEMME_AUS GLEICHER_WERT_LEERT METRO_OHNE_PRUEFUNG F01_OHNE_PFL_RING SEND_NACH_MERGE PFL_RING_KLEIN PFL_OHNE_L METRO_OHNE BUS_SUM_UEBERSPRUNGEN MERGE_VOR_HALL RING_PLUS_EINS F01_OHNE_RINGE F01_ERST_NACH_RING)
  string(TOLOWER ${mut} mut_klein)
  test_mutation(test_mixer_latenzkonto_${mut_klein}_mutation test_mixer_latency_account CYPHERDJ_MUTATION_LATENZ_${mut} src/mixer.cpp src/beatfx.cpp)
endforeach()
# Package 1.15 task A5b: the channel limiter. Each of these must turn test_mixer_channel_limiter red (WILL_FAIL): the limiter in front of the fader (L3, L7), no crossfade
#   (L5), lim/an 0 without the delay (the task names A5a's test_mixer_latency_account C1; it is also red here via L2/L4), the F01 guard without the limiter reset (F), the
#   ceiling/release handed over once (L6), the reduction reported with lim/an 0 (G), L without the true-peak delay (B, L4), no warm-up (L5 with L = 962).
#   Fix round 1: no leeren() on the switch-off (R), warm-up of L/2 (L5 fine), all buses on lim_[0] (I), an overshoot window a crossfade longer (U), a reduction reported in the warm-up (W).
foreach(mut VOR_FADER BLENDE_NULL F01_OHNE DECKE_EINMAL RED_BEI_AUS L_OHNE_ECHTSPITZE WARM_OHNE AUS_OHNE_VERZOEGERUNG AUS_OHNE_LEEREN WARM_HALB GETEILT FENSTER_LANG RED_WARM)
  string(TOLOWER ${mut} mut_klein)
  test_mutation(test_mixer_kanal_limiter_${mut_klein}_mutation test_mixer_channel_limiter CYPHERDJ_MUTATION_LIM_${mut} src/mixer.cpp src/beatfx.cpp)
endforeach()
test_mutation(test_mixer_latenzkonto_lim_aus_ohne_verzoegerung_mutation test_mixer_latency_account CYPHERDJ_MUTATION_LIM_AUS_OHNE_VERZOEGERUNG src/mixer.cpp src/beatfx.cpp)
# K2 Task 3.3: Kleber in der Summe abgeschaltet. test_mixer_glue (vom Glob angelegt) gegen diese Mutation muss scheitern.
test_mutation(test_mixer_kleber_mutation test_mixer_glue CYPHERDJ_MUTATION_KLEBER_AUS src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_kleber_in_summe_mutation test_mixer_glue CYPHERDJ_MUTATION_KLEBER_IN_SUMME src/mixer.cpp src/beatfx.cpp)
# K2 Umbau: Kleber beim Ausschalten sofort überspringen (Gain-Stufe). test_mixer_glue (Fall i) muss dagegen scheitern.
test_mutation(test_mixer_kleber_sofort_aus_mutation test_mixer_glue CYPHERDJ_MUTATION_KLEBER_SOFORT_AUS src/mixer.cpp src/beatfx.cpp)
# K2 Task 1.5: Kern-Verdrahtung. Der Auslöser geht ohne Sample-Versatz an den Mixer; test_core_duck muss scheitern.
test_mutation(test_kern_duck_mutation test_core_duck CYPHERDJ_MUTATION_DUCK_VERSATZ_NULL
              src/core.cpp src/generator.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/core_signalbox.cpp src/core_arr.cpp ${ARR_QUELLEN} src/mixer.cpp src/beatfx.cpp src/parts.cpp src/click.cpp src/tempo_plan.cpp src/clock.cpp
              src/core_deck.cpp src/core_mix.cpp src/deck.cpp src/loader.cpp src/rendition.cpp
              src/core_hand.cpp src/hand_in.cpp
              stub/stretcher_stub.cpp)
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
# core.cpp mutiert als eigenes Objekt vor der Bibliothek: der Linker nimmt dieses kern.o, nicht das aus cypherdj_kernbib
add_executable(test_kern_vorhoeren_mutation tests/test_core_prelisten.cpp src/core.cpp)
target_include_directories(test_kern_vorhoeren_mutation PRIVATE include tests)
target_compile_definitions(test_kern_vorhoeren_mutation PRIVATE CYPHERDJ_MUTATION_KERN_OHNE_NUR_CUE=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_kern_vorhoeren_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_kern_vorhoeren_mutation COMMAND test_kern_vorhoeren_mutation)
set_tests_properties(test_kern_vorhoeren_mutation PROPERTIES WILL_FAIL TRUE)
# Scheibe 25: Master-Limiter an einer echten Fassung (Werkzeug, kein Test; tests/limiter/measure.sh)
foreach(v IN ITEMS kern_limiter_fassung kern_limiter_fassung_ohne)
  add_executable(${v} tests/limiter/limiter_rendition.cpp src/mixer.cpp src/beatfx.cpp)
  target_include_directories(${v} PRIVATE include)
  target_link_libraries(${v} PRIVATE cypherdj::dsp cypherdj::stellwerk cypherdj_dsp_messer)
endforeach()
target_compile_definitions(kern_limiter_fassung_ohne PRIVATE CYPHERDJ_MUTATION_OHNE_LIMITER=1)
# Scheibe 25: Vergleichsmessung der Zykluskosten ohne JACK (kein Test; die Messung im Callback macht
# tests/target/kosten25.sh). Liegt in einem Unterordner, den das Einsammeln der Tests nicht erfasst.
add_executable(kern_kosten25 tests/cost/cost25.cpp)
target_link_libraries(kern_kosten25 PRIVATE cypherdj_kernbib)

# Scheibe 31: Selbsttest der Klick-Fassung (tests/deck/click_rendition.py, das Material der Deck-Tests und der Abnahme).
# Das python3 aus dem PATH (System, mit numpy) vorgeben: seit 2026-10-03 liegt ein uv-Python 3.11 ohne numpy in
# ~/.local/bin, FindPython nahm es dort als ersten Treffer, und die Python-Tests brachen am Import ab (2026-10-11).
if(NOT DEFINED Python3_EXECUTABLE)
  find_program(CYPHERDJ_PYTHON3 NAMES python3)
  if(CYPHERDJ_PYTHON3)
    set(Python3_EXECUTABLE ${CYPHERDJ_PYTHON3})
  endif()
endif()
find_package(Python3 REQUIRED COMPONENTS Interpreter)
add_test(NAME test_klick_fassung COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/deck/test_click_rendition.py)
# Keylock Task 4.1: target_run.py darf nicht blind bestehen (stille Aufnahme, abgewiesener Befehl), ohne JACK.
add_test(NAME test_ziel_lauf COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/deck/test_target_run.py)
# Scheibe 31, Fehlerfall des Drift-Messers (wie 03 Probe 4a --drift 1e-5): Lesekopf 1e-5 zu schnell. test_deck gegen die
# Mutation muss scheitern; der Kern damit ist das Gegenstück für den Drift-Lauf am Ziel.
test_mutation(test_deck_mutation test_deck CYPHERDJ_MUTATION_DECK_DRIFT src/deck.cpp src/rendition.cpp src/clock.cpp)  # Welle 3: deck.cpp liest die Karte
# Plan Grid, Fehlerfall: setze_raster verschiebt nur die Linien, nicht den Ton (der Quell-Beat unter dem Kopf springt).
test_mutation(test_deck_raster_mutation test_deck CYPHERDJ_MUTATION_RASTER_OHNE_KOPF src/deck.cpp src/rendition.cpp src/clock.cpp)  # Welle 3: deck.cpp liest die Karte
# Welle 2 F10, Fehlerfall: Start aus dem Stand ohne Einblende. test_deck gegen diese Mutation muss scheitern.
test_mutation(test_deck_ein_mutation test_deck CYPHERDJ_MUTATION_DECK_OHNE_EIN src/deck.cpp src/rendition.cpp src/clock.cpp)  # Welle 3: deck.cpp liest die Karte
# Welle 3 Task 1, Fehlerfall: Deck liest ein Frame je Sample wie bis Welle 2, das Tempo zählt nicht. test_deck_varispeed muss scheitern.
test_mutation(test_deck_varispeed_mutation test_deck_varispeed CYPHERDJ_MUTATION_DECK_VARISPEED_STARR src/deck.cpp src/rendition.cpp src/clock.cpp)
# Hörbares Ziehen (Scrub), Fehlerfall: die Leseposition springt je Block auf die Hand, keine stetige Rate. test_deck_scrub muss scheitern.
test_mutation(test_deck_scrub_mutation test_deck_scrub CYPHERDJ_MUTATION_SCRUB_OHNE_GLAETTUNG src/deck.cpp src/rendition.cpp src/clock.cpp)

# Keylock in Echtzeit, Task 1 (Plan 2026-10-06-keylock-echtzeit.md): Dehner. Der Stub (außerhalb von src/, Vertrag 13)
# liefert die Fabrik ohne Rubber Band; sein Test bindet NICHT stretcher.cpp.
add_executable(test_dehner_stub tests/stretcher_stub_check.cpp stub/stretcher_stub.cpp)
target_include_directories(test_dehner_stub PRIVATE include tests)
add_test(NAME test_dehner_stub COMMAND test_dehner_stub)
# Fehlerfälle: Regler aus (c = 0) und Faktor am Fensteranfang statt in der Mitte (Prüfer M1); beide müssen test_stretcher
# scheitern lassen (Faktor am Anfang: Tests 2, 5, 10; Regler aus: Tests 5 und 12, Ansatz in der Rampe; Task 1c; seit
# Keylock 4.6/4.6b über je Klick ±12 gegen das Soll bzw. Test 12 gegen das Ideal gleicher Klickform, nicht mehr am Mittel). Quellen:
# stretcher.cpp mit librubberband, clock.cpp für die Karte.
test_mutation(test_dehner_ohne_regler_mutation test_stretcher CYPHERDJ_MUTATION_DEHNER_OHNE_REGLER
              src/stretcher.cpp src/clock.cpp PkgConfig::RUBBERBAND)
test_mutation(test_dehner_faktor_anfang_mutation test_stretcher CYPHERDJ_MUTATION_DEHNER_FAKTOR_ANFANG
              src/stretcher.cpp src/clock.cpp PkgConfig::RUBBERBAND)
# Keylock Task 5b: die gehörte Quellposition je Sample in einem double (Stand Task 5): dehner_p_summe rot.
test_mutation(test_dehner_p_je_sample_mutation test_stretcher CYPHERDJ_MUTATION_DEHNER_P_JE_SAMPLE
              src/stretcher.cpp src/clock.cpp PkgConfig::RUBBERBAND)
# Keylock Task 6b (W2, Plan Task 6 Abschnitt 8): Fehlerfälle des Dehner-Wechsels. Rot gemessen (task6b w2/mutation_*.txt):
# WECHSEL_ZAEHLT_NUR (Atom zählt, die Quelle bleibt): W1b, dazu W2-Grenze, W3-Kontrolle, W3b Zone 3; SPAET_ANNEHMEN (auch
# hinter p_gleich_bis angenommen): W2, W3b Zone 3; WECHSEL_ALLOKIERT (Kopie mit new im Callback): W4; UEBERSCHRIEBEN_AUS
# (Überschriebene nicht gezählt): W3b Zone 1, W4, W5. Die übrigen Tests von test_stretcher bleiben dabei grün. Nur unter TSan
# sichtbar und darum nicht hier: CYPHERDJ_MUTATION_DEHNER_WECHSEL_OHNE_DREIFACH (`test_stretcher wechsel_faeden 300`, W5).
test_mutation(test_dehner_wechsel_zaehlt_nur_mutation test_stretcher CYPHERDJ_MUTATION_DEHNER_WECHSEL_ZAEHLT_NUR
              src/stretcher.cpp src/clock.cpp PkgConfig::RUBBERBAND)
test_mutation(test_dehner_wechsel_spaet_annehmen_mutation test_stretcher CYPHERDJ_MUTATION_PLAN_WECHSEL_SPAET_ANNEHMEN
              src/stretcher.cpp src/clock.cpp PkgConfig::RUBBERBAND)
test_mutation(test_dehner_wechsel_allokiert_mutation test_stretcher CYPHERDJ_MUTATION_DEHNER_WECHSEL_ALLOKIERT
              src/stretcher.cpp src/clock.cpp PkgConfig::RUBBERBAND)
test_mutation(test_dehner_wechsel_ueberschrieben_aus_mutation test_stretcher CYPHERDJ_MUTATION_DEHNER_WECHSEL_UEBERSCHRIEBEN_AUS
              src/stretcher.cpp src/clock.cpp PkgConfig::RUBBERBAND)
# Fix-Runde W2 (Q1): der Vorbereiter übernimmt die gemeldete Annahme nicht, die Erneuerung setzt mit dem alten Band an: W6 rot.
test_mutation(test_dehner_erneuerung_alte_quelle_mutation test_stretcher CYPHERDJ_MUTATION_DEHNER_ERNEUERUNG_ALTE_QUELLE
              src/stretcher.cpp src/clock.cpp PkgConfig::RUBBERBAND)
# Fix-Runde W2 (S1, Prüfung X3): wechsel_holen vor uebernehmen: der Auftrag für die gerade wartende Epoche verfehlt, W3 rot.
test_mutation(test_dehner_wechsel_vor_uebernehmen_mutation test_stretcher CYPHERDJ_MUTATION_DEHNER_WECHSEL_VOR_UEBERNEHMEN
              src/stretcher.cpp src/clock.cpp PkgConfig::RUBBERBAND)
# Fix-Runde W2 (Q3/S5): Lücken-Formel aus be2a7ef0, zählt über den Nummern-Überlauf ein Überschreiben zu viel: W7 rot.
test_mutation(test_dehner_luecke_alt_mutation test_stretcher CYPHERDJ_MUTATION_DEHNER_LUECKE_ALT
              src/stretcher.cpp src/clock.cpp PkgConfig::RUBBERBAND)
if(CYPHERDJ_BUNGEE)
  # Umbauplan Bungee S1: der Dehner mit Bungee; Fehlerfälle: Karte am Korn k+1 (Lage, Referenz), Sprung ohne reset (Referenz)
  target_link_libraries(test_stretcher_bungee PRIVATE PkgConfig::RUBBERBAND)  # keylock_mess.h bindet Rubber Band ein
  # S2: der Kern mit Bungee; Fehlerfall: niemand treibt die Dehner (alle Kern-Quellen samt stretcher_bungee.cpp, wie kern_keylock_faeden_mutation)
  target_link_libraries(test_core_keylock_bungee PRIVATE PkgConfig::RUBBERBAND)
  kern_mut_exe(test_kern_keylock_bungee_kein_antrieb_mutation   # Slice 2: warp_factory.cpp liegt in KERN_QUELLEN und braucht die Maschine
               QUELLEN tests/test_core_keylock_bungee.cpp ${KERN_QUELLEN} src/stretcher_bungee.cpp src/warp_factory_bungee.cpp
               SCHALTER CYPHERDJ_MUTATION_KEIN_ANTRIEB DEFS CYPHERDJ_BUNGEE=1 CYPHERDJ_DJK="${DJK}"
               INCLUDES include tests ${DJK}/contract LIBS ${KERN_MUT_LIBS} cypherdj::bungee)
  cdj_require_selector(tests/test_core_keylock_bungee.cpp deck)
  add_test(NAME test_kern_keylock_bungee_kein_antrieb_mutation COMMAND test_kern_keylock_bungee_kein_antrieb_mutation deck)
  set_tests_properties(test_kern_keylock_bungee_kein_antrieb_mutation PROPERTIES WILL_FAIL TRUE TIMEOUT 120)
  foreach(m BUNGEE_KORN_EINS_SPAET BUNGEE_OHNE_RESET)
    string(TOLOWER ${m} mk)
    test_mutation(test_dehner_${mk}_mutation test_stretcher_bungee CYPHERDJ_MUTATION_${m}
                  src/stretcher.cpp src/stretcher_bungee.cpp src/clock.cpp PkgConfig::RUBBERBAND cypherdj::bungee)
  endforeach()
  # Paket 1.13 Warp, Slice 2: Fehlerfälle des Warp-Werks (das Werk wird als eigenes Objekt mutiert), jede macht ihren Fall in test_warp_factory rot
  foreach(m SOLL_NACH_SCHREIBE RING_VOLL_DREHT)
    string(TOLOWER ${m} mk)
    test_mutation(test_warp_werk_${mk}_mutation test_warp_factory CYPHERDJ_MUTATION_WARP_${m} src/warp_factory.cpp src/warp_factory_bungee.cpp src/clock.cpp cypherdj::bungee)
  endforeach()
  # Paket 1.13 Warp, Slice 5: Fehlerfälle von Transpose/Detune im Werk (PITCH_VERGESSEN bricht Fall 1, HOP_FEST Fall 3)
  foreach(m PITCH_VERGESSEN HOP_FEST)
    string(TOLOWER ${m} mk)
    test_mutation(test_warp_werk_pitch_${mk}_mutation test_warp_factory_pitch CYPHERDJ_MUTATION_WARP_${m} src/warp_factory.cpp src/warp_factory_bungee.cpp src/clock.cpp cypherdj::bungee)
  endforeach()
  # Task 3 Step 6, ohne die Quelle anzufassen: die Reihenfolge der ersten Fassung (schreibe vor soll) mit dem engen Fenster. Kein Test, denn der Verlust tritt nur in einem Teil
  # der Läufe auf (ein ctest-Ziel wäre unzuverlässig): der Plan fährt das Ziel fünfmal von Hand
  add_executable(test_warp_werk_soll_nach_schreibe_eng tests/test_warp_factory.cpp src/warp_factory.cpp src/warp_factory_bungee.cpp src/clock.cpp)
  target_include_directories(test_warp_werk_soll_nach_schreibe_eng PRIVATE include tests ${DJK}/contract)
  target_compile_definitions(test_warp_werk_soll_nach_schreibe_eng PRIVATE CYPHERDJ_MUTATION_WARP_SOLL_NACH_SCHREIBE_ENG=1 CYPHERDJ_BUNGEE=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_warp_werk_soll_nach_schreibe_eng PRIVATE PkgConfig::JACK Threads::Threads cypherdj::dsp cypherdj::stellwerk cypherdj_dsp_messer cypherdj::json
                        PkgConfig::CRYPTO cypherdj::hand cypherdj::bungee)
endif()
kern_mutation(cypherdj-kern-mutation-drift CYPHERDJ_MUTATION_DECK_DRIFT)
# Scheibe 31, Fehlerfall der Abnahme: Deck-Start am Blockanfang statt am Sample des Ziel-Beats. test_core_deck gegen die
# Mutation muss scheitern (Klick und Quittung 2 am Blockanfang); der Kern damit fährt start_quell_beat rot.
kern_mutation(cypherdj-kern-mutation-start CYPHERDJ_MUTATION_START_BLOCKANFANG)
test_mutation(test_kern_deck_mutation test_core_deck CYPHERDJ_MUTATION_START_BLOCKANFANG
              src/core.cpp src/generator.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/core_signalbox.cpp src/core_arr.cpp ${ARR_QUELLEN} src/core_deck.cpp src/core_mix.cpp src/mixer.cpp src/beatfx.cpp src/parts.cpp src/click.cpp
              src/tempo_plan.cpp src/clock.cpp src/deck.cpp src/loader.cpp src/rendition.cpp src/core_hand.cpp src/hand_in.cpp
              stub/stretcher_stub.cpp)  # Keylock Task 2: Fabrik ohne Rubber Band
# Scheibe 31: Vergleichsmessung der Zykluskosten ohne JACK mit vier spielenden Decks (kein Test; die Messung im Callback
# macht tests/deck/target_run.py --art cost).
add_executable(kern_kosten31 tests/cost/cost31.cpp)
target_link_libraries(kern_kosten31 PRIVATE cypherdj_kernbib)
# Hörbares Ziehen, Fehlerfall der Messung am Master: die Position springt je Zyklus auf die Hand. test_core_deck_scrub_measurement muss scheitern.
add_executable(test_kern_deck_scrub_messung_mutation tests/test_core_deck_scrub_measurement.cpp src/deck.cpp)
target_include_directories(test_kern_deck_scrub_messung_mutation PRIVATE include tests)
target_compile_definitions(test_kern_deck_scrub_messung_mutation PRIVATE CYPHERDJ_MUTATION_SCRUB_OHNE_GLAETTUNG=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_kern_deck_scrub_messung_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_kern_deck_scrub_messung_mutation COMMAND test_kern_deck_scrub_messung_mutation)
set_tests_properties(test_kern_deck_scrub_messung_mutation PROPERTIES WILL_FAIL TRUE)
# Hörbares Ziehen, Negativ-Kontrolle: Summe über das Master-Bitmuster einer festen Deck-Folge ohne Ziehen; vor und nach dem Ziehen gleich.
add_executable(kern_deck_bitdump tests/cost/deck_bitdump.cpp)
target_link_libraries(kern_deck_bitdump PRIVATE cypherdj_kernbib)
target_compile_definitions(kern_deck_bitdump PRIVATE CYPHERDJ_DJK="${DJK}")
# Hörbares Ziehen: Vergleichsmessung der Zykluskosten ohne JACK mit und ohne Ziehen (kein Test; Zahlen in den Bericht).
add_executable(kern_kosten_scrub tests/cost/cost_scrub.cpp)
target_link_libraries(kern_kosten_scrub PRIVATE cypherdj_kernbib)
target_compile_definitions(kern_kosten_scrub PRIVATE CYPHERDJ_DJK="${DJK}")
target_compile_definitions(kern_kosten31 PRIVATE CYPHERDJ_DJK="${DJK}")
# Keylock Task 7 Step 1a (Gate G1 offline): N Dehner mit echten Arbeits-Threads und Callback-Takt, Band BoxBand (kein Test)
add_executable(kern_kosten_dehner_n tests/cost/cost_stretcher_n.cpp)
target_link_libraries(kern_kosten_dehner_n PRIVATE cypherdj_kernbib)
# Scheibe 31, ASan-Bau: Material in Decks bei Programmende ist kein Leck des Laufs (tests/lsan_decks.supp)
if(CYPHERDJ_SANITIZE)
  foreach(t test_core_deck test_core_deck_restart test_core_midi test_core_deck_hand test_core_level)  # Scheibe 35: enden mit geladenem Deck
    if(TEST ${t})
      set_tests_properties(${t} PROPERTIES ENVIRONMENT
                           "LSAN_OPTIONS=suppressions=${CMAKE_CURRENT_SOURCE_DIR}/tests/lsan_decks.supp")
    endif()
  endforeach()
endif()

# Scheibe 35: Instrument-Kontrolle der Auswertung am Ziel (tests/hand/evaluation_hand.py) an künstlichen Läufen bekannter
# Wahrheit: richtig, Folgeblock, erster Wert wirkt, 1 ms Versatz, leer, Ruhe mit und ohne Griff.
add_test(NAME test_auswertung_hand COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/hand/test_evaluation_hand.py)

# L3 (Paket 0.3): alle Namenslisten (Tasten, Deck-Aktionen, Regler) gegeneinander. Der Hand-Unterordner baut seine Tests
# nur allein (HAND_TESTS), also steht der Test auch hier; rein Text, ohne Build.
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/../contract/check_name_lists.py)
  add_test(NAME namenslisten_gegen_vertrag
           COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/../contract/check_name_lists.py"
                   --wurzel "${CMAKE_CURRENT_SOURCE_DIR}/../..")
  set_tests_properties(namenslisten_gegen_vertrag PROPERTIES SKIP_RETURN_CODE 77)   # public repo: English contract only
endif()

# 1.10 slice 4a T1: the generated insert files equal what docs/interfaces/insert_module.json produces, and its ranges equal
# presets/devices.ts (the plugin ranges). Text only, no build. The C++ side is test_insert_contract in the stellwerk project.
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/../contract/generate_insert.py)
  add_test(NAME insert_vokabular_aktuell
           COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/../contract/generate_insert.py" --pruefe)
endif()

# 1.10 slice 5 U2a (plan E20): the generated key rule files equal what docs/interfaces/schluessel_regeln.json produces. Text only, no build. The C++ side of the cells is
# test_arr_key case 10 (every cell and every case of the file against the loader).
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/../contract/generate_key.py)
  add_test(NAME schluessel_regeln_aktuell
           COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/../contract/generate_key.py" --pruefe)
endif()

# Scheibe 35, Fehlerfall der Abnahme (Plan 35 E2): das MIDI-Ereignis wirkt am Anfang des Folgeblocks statt an seinem
# Versatz (sample = s0 + n, wie 19 M01). test_core_midi gegen diese Mutation muss scheitern (Griff bei 142 848 statt
# 142 777); cypherdj-kern-mutation-folgeblock ist der Kern für den Fehlerfall am Ziel.
set(KERN_QUELLEN35_OHNE_DEHNER src/core.cpp src/generator.cpp src/kit.cpp src/loopbox.cpp src/loop.cpp src/core_signalbox.cpp src/core_arr.cpp ${ARR_QUELLEN} src/core_deck.cpp src/core_mix.cpp src/core_hand.cpp src/hand_in.cpp src/mixer.cpp src/beatfx.cpp
    src/parts.cpp src/click.cpp src/tempo_plan.cpp src/clock.cpp src/deck.cpp src/loader.cpp src/rendition.cpp)
# Keylock Task 2 (Vertrag 13): core_deck.cpp ruft die Fabrik dehner_neu; ohne Rubber Band liefert der Stub nullptr.
set(KERN_QUELLEN35 ${KERN_QUELLEN35_OHNE_DEHNER} stub/stretcher_stub.cpp)
kern_mutation(cypherdj-kern-mutation-folgeblock CYPHERDJ_MUTATION_HAND_FOLGEBLOCK)
test_mutation(test_kern_midi_mutation test_core_midi CYPHERDJ_MUTATION_HAND_FOLGEBLOCK ${KERN_QUELLEN35})
# D1 K1: erz/4 reserviert; mit dem Rückweg rueck_erz_4 wie vorher muss test_core_arr_erz4 scheitern
test_mutation(test_kern_arr_erz4_mutation test_core_arr_erz4 CYPHERDJ_MUTATION_ARR_RUECK_ERZ4 ${KERN_QUELLEN35}
              src/arr_playback.cpp)
# D1 K1 Review: ARR_ALT ohne Platz bei vollem Ereignisring (verloren wie melde); test_core_arr Fall 10 muss scheitern
test_mutation(test_kern_arr_ring_mutation test_core_arr CYPHERDJ_MUTATION_ARR_ALT_OHNE_PLATZ ${KERN_QUELLEN35}
              src/arr_playback.cpp)
# D1 K1 Review: ein wartender Start, der ohne Einsatz endet, bliebe ohne Endquittung; test_core_arr Fall 11 muss scheitern
test_mutation(test_kern_arr_quittung_mutation test_core_arr CYPHERDJ_MUTATION_ARR_START_ID_UEBERSCHRIEBEN ${KERN_QUELLEN35}
              src/arr_playback.cpp)
test_mutation(test_kern_erzeuger_mutation test_core_generator CYPHERDJ_MUTATION_ERZ_BLOCKANFANG ${KERN_QUELLEN35})
# Plan fx-wege Slice 2, Fehlerfall der Reihenfolge: FX2 liefe vor FX1. test_core_fx (Fall 8) muss dagegen scheitern.
test_mutation(test_kern_fx_reihenfolge_mutation test_core_fx CYPHERDJ_MUTATION_FX_EINHEITEN_VERTAUSCHT ${KERN_QUELLEN35})
# Ohr T17, Fehlerfall FX-Routing: der Weg wird ohne Gleiten getauscht und die Echo-Leitung sofort geleert. test_core_fx_routing
# (Fall 2, Sprung im Umschaltfenster) muss dagegen scheitern.
test_mutation(test_kern_fx_routing_hart_mutation test_core_fx_routing CYPHERDJ_MUTATION_FX_ROUTING_HART ${KERN_QUELLEN35})
# Baukasten S3c Task 5: Befehl /k/kanal/graph. test_core_channel_graph (Kern bis Mixer) muss gegen jede dieser Mutationen sauber
# scheitern (PRUEF, kein Absturz): Graph nicht gesetzt, Graph im KI-Stopp oder bei falschem Kanal nicht zurückgegeben (Leck),
# KI-Stopp ohne Riegel, abgelöste Graphen nicht abgeholt, abgeholte doppelt gemeldet (Doppel-Free im Netz-Faden),
# ein Burst über die Ablage nicht sofort abgeholt (Leck).
# S14: case 16 of test_core_channel_graph calls Kern::regler_setzen / regler_uebernehmen (core_state.cpp), which the common mutation source list does not carry
set(KERN_QUELLEN35_KG ${KERN_QUELLEN35} src/core_state.cpp src/core_deck_state.cpp)
foreach(mut NICHT_SETZEN KI_LECK KI_OFFEN BEREICH_LECK NICHT_ABHOLEN DOPPELT BURST_LECK)
  string(TOLOWER ${mut} mut_klein)
  test_mutation(test_kern_kanal_graph_${mut_klein}_mutation test_core_channel_graph CYPHERDJ_MUTATION_KANAL_GRAPH_${mut} ${KERN_QUELLEN35_KG})
endforeach()
# Baukasten S6 Task 2: fx/3, fx/4 in the core command. Only the send path is mutated: graph not set, leaked on KI stop,
# fx/<n> out-of-range leak, fx/3 <-> fx/4 swapped; test_core_channel_graph (cases 10..14) must fail against each.
foreach(mut NICHT_GESETZT KI_LECK BEREICH_LECK FALSCHER_BUS)
  string(TOLOWER ${mut} mut_klein)
  test_mutation(test_kern_kanal_graph_fx_${mut_klein}_mutation test_core_channel_graph CYPHERDJ_MUTATION_FX_GRAPH_${mut} ${KERN_QUELLEN35_KG})
endforeach()
# S14: fx/3 never hears deck/3/bk/* (case 14, case 15).
test_mutation(test_kern_kanal_graph_send_nutzt_deck_regler_mutation test_core_channel_graph CYPHERDJ_MUTATION_BK_SEND_NUTZT_DECK_REGLER ${KERN_QUELLEN35_KG})
# S14: the core ctor maps fx/3|4/bk/<n> to rows 18, 19; case 15 must fail when it skips them, shifts them or the rows are swapped.
foreach(mut KERN_OHNE_ZEILE KERN_ZEILE_FALSCH ZEILE_VERTAUSCHT OHNE_REGLER)
  string(TOLOWER ${mut} mut_klein)
  test_mutation(test_kern_kanal_graph_send_${mut_klein}_mutation test_core_channel_graph CYPHERDJ_MUTATION_BK_SEND_${mut} ${KERN_QUELLEN35_KG})
endforeach()
# S14 task 3 (pin): graph knob values that arrive by regler_setzen / regler_uebernehmen must reach the send graph (case 16).
test_mutation(test_kern_kanal_graph_bk_zustand_ohne_wert_mutation test_core_channel_graph CYPHERDJ_MUTATION_BK_ZUSTAND_OHNE_WERT ${KERN_QUELLEN35_KG})
# Baukasten S5r Task 3: die Graph-Regler bis in den Effekt-Graphen (Fall 9); nicht gemeldet, falscher Kanal, Tausch ohne Wert.
foreach(mut NICHT_GEMELDET FALSCHER_KANAL TAUSCH_05)
  string(TOLOWER ${mut} mut_klein)
  test_mutation(test_kern_kanal_graph_regler_${mut_klein}_mutation test_core_channel_graph CYPHERDJ_MUTATION_BK_REGLER_${mut} ${KERN_QUELLEN35_KG})
endforeach()
# S23 case 17: a plan of chained ramps on a graph knob must reach the graph; the failure case drops a change below 0.005 inside one block (slow ramps stand still).
test_mutation(test_kern_kanal_graph_bk_rampe_totzone_mutation test_core_channel_graph CYPHERDJ_MUTATION_BK_RAMPE_TOTZONE ${KERN_QUELLEN35_KG})
# Dasselbe im Netz: net_erz.cpp mutiert als eigenes Objekt vor der Bibliothek (Muster test_netz_arr_erz4_mutation);
# test_net_erz muss scheitern, wenn kein_eingang, die Latenz oder der Kanalbereich nicht mehr geprüft werden.
foreach(mut NETZ_EINGANG_OFFEN NETZ_LATENZ_OFFEN NETZ_BEREICH_OFFEN)
  string(TOLOWER ${mut} mut_klein)
  add_executable(test_netz_erz_kanal_graph_${mut_klein}_mutation tests/test_net_erz.cpp src/net_erz.cpp)
  target_include_directories(test_netz_erz_kanal_graph_${mut_klein}_mutation PRIVATE include tests)
  target_compile_definitions(test_netz_erz_kanal_graph_${mut_klein}_mutation PRIVATE CYPHERDJ_MUTATION_KANAL_GRAPH_${mut}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_netz_erz_kanal_graph_${mut_klein}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_netz_erz_kanal_graph_${mut_klein}_mutation COMMAND test_netz_erz_kanal_graph_${mut_klein}_mutation)
  set_tests_properties(test_netz_erz_kanal_graph_${mut_klein}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# Baukasten S10 Task 3: lade_bk übergibt die Sample-Wurzel <bk_ordner>/samples; test_net_erz muss scheitern, wenn sie nicht
# übergeben wird oder ohne /samples ankommt.
foreach(mut OHNE_WURZEL WURZEL_OHNE_SAMPLES)
  string(TOLOWER ${mut} mut_klein)
  add_executable(test_netz_erz_bk_sampler_${mut_klein}_mutation tests/test_net_erz.cpp src/net_erz.cpp)
  target_include_directories(test_netz_erz_bk_sampler_${mut_klein}_mutation PRIVATE include tests)
  target_compile_definitions(test_netz_erz_bk_sampler_${mut_klein}_mutation PRIVATE CYPHERDJ_MUTATION_BK_SAMPLER_${mut}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_netz_erz_bk_sampler_${mut_klein}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_netz_erz_bk_sampler_${mut_klein}_mutation COMMAND test_netz_erz_bk_sampler_${mut_klein}_mutation)
  set_tests_properties(test_netz_erz_bk_sampler_${mut_klein}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# Baukasten S12 task 1: `bk:` (empty name) replays the stored non-graph target; test_net_erz must fail when the stored target
# is overwritten by graph targets, the stored kanal is ignored, a missing target is answered with success, or the replay is gone.
foreach(mut LEER_VORHER_UEBERSCHRIEBEN LEER_KANAL_EINGANG LEER_OHNE_VORHER_ERFOLG LEER_OHNE_REPLAY)
  string(TOLOWER ${mut} mut_klein)
  add_executable(test_netz_erz_bk_${mut_klein}_mutation tests/test_net_erz.cpp src/net_erz.cpp)
  target_include_directories(test_netz_erz_bk_${mut_klein}_mutation PRIVATE include tests)
  target_compile_definitions(test_netz_erz_bk_${mut_klein}_mutation PRIVATE CYPHERDJ_MUTATION_BK_${mut}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_netz_erz_bk_${mut_klein}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_netz_erz_bk_${mut_klein}_mutation COMMAND test_netz_erz_bk_${mut_klein}_mutation)
  set_tests_properties(test_netz_erz_bk_${mut_klein}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# Baukasten S16: the net-thread graph mirror; test_net_graph must fail when a change applies without its quittung, a refusal
# applies, a kit/midi announce keeps the graph, frage skips empty slots, or a quittung matches by id alone.
foreach(mut OHNE_QUITTUNG AUCH_AUF_6 KIT_BLEIBT FRAGE_NUR_BELEGT OHNE_QUELLE)
  string(TOLOWER ${mut} mut_klein)
  add_executable(test_netz_graph_${mut_klein}_mutation tests/test_net_graph.cpp src/net_graph.cpp)
  target_include_directories(test_netz_graph_${mut_klein}_mutation PRIVATE include tests)
  target_compile_definitions(test_netz_graph_${mut_klein}_mutation PRIVATE CYPHERDJ_MUTATION_GRAPH_${mut}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_netz_graph_${mut_klein}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_netz_graph_${mut_klein}_mutation COMMAND test_netz_graph_${mut_klein}_mutation)
  set_tests_properties(test_netz_graph_${mut_klein}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# Kern für den Fehlerfall am Ziel (Task 9 Step 3): Erzeuger-Einsatz am Blockanfang
kern_mutation(cypherdj-kern-mutation-erz CYPHERDJ_MUTATION_ERZ_BLOCKANFANG)
# Glanz 2.7 (F19), Fehlerfall: MIDI-Ströme ohne Vorhalt (Note am Sample des Beats, Surge 11,35 ms hinter dem Kit).
test_mutation(test_kern_instrument_mutation test_core_instrument CYPHERDJ_MUTATION_MIDI_OHNE_VORHALT ${KERN_QUELLEN35})
test_mutation(test_erzeuger_midi_mutation test_generator_midi CYPHERDJ_MUTATION_MIDI_OHNE_VORHALT src/generator.cpp src/kit.cpp src/clock.cpp)
# Glanz 2.7 Prüfung R2/R3, Fehlerfall: Fenster-Ersetzen ohne gesendet_bis, ein spätes Fenster bringt schon gesendete MIDI-Noten
# doppelt (test_core_instrument K1 2 statt 1 Note-On, K2 1024 -> 256; test_generator_midi Fall 6: 14 doppelt). Seit Re-Prüfung N2
# trägt gesendet_bis den Schutz allein (das frühere MIDI-jetzt aus Sample + neuem Vorhalt ist entfernt).
test_mutation(test_kern_instrument_schutz_mutation test_core_instrument CYPHERDJ_MUTATION_MIDI_FENSTER_OHNE_SCHUTZ ${KERN_QUELLEN35})
test_mutation(test_erzeuger_midi_schutz_mutation test_generator_midi CYPHERDJ_MUTATION_MIDI_FENSTER_OHNE_SCHUTZ src/generator.cpp src/kit.cpp src/clock.cpp)
# Re-Prüfung N1, Fehlerfall: leeren() setzt gesendet_bis nicht zurück, nach /k/set/neu schweigen die MIDI-Ströme (Fall 7: 0 statt 8).
test_mutation(test_kern_instrument_leeren_mutation test_core_instrument CYPHERDJ_MUTATION_LEEREN_OHNE_GESENDET ${KERN_QUELLEN35})
# Prüfung R3, Fehlerfall am Quantum-Wechsel 256 -> 1024: Off am selben Sample wie das On.
test_mutation(test_kern_instrument_off_mutation test_core_instrument CYPHERDJ_MUTATION_MIDI_OFF_AM_ON ${KERN_QUELLEN35})
test_mutation(test_erzeuger_midi_off_mutation test_generator_midi CYPHERDJ_MUTATION_MIDI_OFF_AM_ON src/generator.cpp src/kit.cpp src/clock.cpp)
# Bug t_bffc3708 (stille), Fehlerfall: die Kappe wird nie vorgemerkt, das Note-Off der gehaltenen MIDI-Note kommt erst am Ende ihrer dauer.
test_mutation(test_erzeuger_midi_kappe_mutation test_generator_midi CYPHERDJ_MUTATION_ERZ_KAPPE_IGNORIERT src/generator.cpp src/kit.cpp src/clock.cpp)
test_mutation(test_erzeuger_midi_kappe_nicht_aufgehoben_mutation test_generator_midi CYPHERDJ_MUTATION_ERZ_KAPPE_NICHT_AUFGEHOBEN src/generator.cpp src/kit.cpp src/clock.cpp)
# Glanz 2.7 Prüfung R5, Fehlerfall: Vorhalt fest 512 statt 2 · n (test_core_instrument Fall 6, Quantum 128 und 512).
test_mutation(test_kern_instrument_fest_mutation test_core_instrument CYPHERDJ_MUTATION_MIDI_VORHALT_FEST ${KERN_QUELLEN35})
# Kern für die Gegenprobe am Prüfstand (Task 2.7.2 Step 4)
kern_mutation(cypherdj-kern-mutation-midi CYPHERDJ_MUTATION_MIDI_OHNE_VORHALT)
# Plan MVP 2: Fehlerfall Loop-Position ab dem Einsatz (Test) und falsches Raster 22 501 (Kern für den Durchstich, Task 11)
test_mutation(test_kern_loop_mutation test_core_loop CYPHERDJ_MUTATION_LOOP_AB_START ${KERN_QUELLEN35})
# Plan Tempo-Folge: dieselbe Mutation am Kern-Befehl (Box bei 130 BPM auf dem 128er-Raster).
test_mutation(test_kern_loop_tempo_mutation test_core_loop CYPHERDJ_MUTATION_LOOP_TEMPO_STARR ${KERN_QUELLEN35})
kern_mutation(cypherdj-kern-mutation-loop CYPHERDJ_MUTATION_LOOP_SPB)
# Plan MVP 2 Scheibe 2 (ADR 025 Folgeplan), Fehlerfall der Abnahme: Mitschnitt-Einsatz am Blockanfang des Blocks mit
# ab_sample statt an ab_sample selbst (Task 9 Ziel-Beleg: cypherdj-kern-mutation-mitschnitt für den Fehlerfall am Ziel).
test_mutation(test_kern_mitschnitt_mutation test_core_capture CYPHERDJ_MUTATION_MITSCHNITT_BLOCKANFANG ${KERN_QUELLEN35})
test_mutation(test_kern_mitschnitt_ring_mutation test_core_capture CYPHERDJ_MUTATION_MITSCHNITT_VERLIERBAR ${KERN_QUELLEN35})  # Scheibe 3 E4: voller Ring verliert /e/mitschnitt
kern_mutation(cypherdj-kern-mutation-mitschnitt CYPHERDJ_MUTATION_MITSCHNITT_BLOCKANFANG)

# Scheibe 35, Task 3, Fehlerfall: Kodierung des Encoders vertauscht (zweierkomplement <-> versatz64), die Raste läuft in
# die falsche Richtung. test_core_mixer gegen diese Mutation muss scheitern.
test_mutation(test_kern_mixer_mutation test_core_mixer CYPHERDJ_MUTATION_HAND_KODIERUNG ${KERN_QUELLEN35})

# Scheibe 35, Task 5, Fehlerfall: „Start sofort ohne Phase“ (Deck-Taste startet am Griff am Frame der Position, ohne
# Quantisierung und Phase). test_core_deck_hand gegen diese Mutation muss scheitern.
kern_mutation(cypherdj-kern-mutation-ohne-phase CYPHERDJ_MUTATION_HAND_OHNE_PHASE)  # der Kern für den Fehlerfall am Ziel
kern_mutation(cypherdj-kern-mutation-verbinder CYPHERDJ_MUTATION_HAND_VERBINDER_NUR_START)  # Task 7: Verbinder nur beim Start
test_mutation(test_kern_deck_hand_mutation test_core_deck_hand CYPHERDJ_MUTATION_HAND_OHNE_PHASE ${KERN_QUELLEN35})
# Welle 2 Prüfung 2.3 (M1), Fehlerfall: Hand-Start 5000 Samples zu spät, phasentreu. Mit der F10-Einblende zählt der Test
# ab dem zweiten Klick; das Einsatz-Sample (erstes Sample ≠ 0 am Ring) muss den späten Start trotzdem sehen.
test_mutation(test_kern_deck_hand_spaet_mutation test_core_deck_hand CYPHERDJ_MUTATION_HAND_START_SPAET ${KERN_QUELLEN35})
# Plan Grid, Fehlerfall am Kern: Raster-Versatz ohne Kopf (Ton bleibt, Klicks nach der Änderung weiter auf dem Beat).
test_mutation(test_kern_deck_raster_mutation test_core_deck_grid CYPHERDJ_MUTATION_RASTER_OHNE_KOPF ${KERN_QUELLEN35})

# Scheibe 35, Task 6, Fehlerfall: „Stopp nur melden“ (/e/taste geht hinaus, ki_stopp wird nicht gerufen).
# test_core_stop gegen diese Mutation muss scheitern.
test_mutation(test_kern_stopp_mutation test_core_stop CYPHERDJ_MUTATION_HAND_STOPP_MELDEN ${KERN_QUELLEN35})

# Scheibe 35, Task 8, Fehlerfall: /k/mapping quittiert, tauscht aber nicht. test_core_mapping gegen diese Mutation muss
# scheitern (CC 1/24 bleibt ohne Wirkung).
kern_mutation(cypherdj-kern-mutation-mapping CYPHERDJ_MUTATION_MAPPING_NICHT_TAUSCHEN)  # der Kern für den Fehlerfall am Ziel
test_mutation(test_kern_mapping_mutation test_core_mapping CYPHERDJ_MUTATION_MAPPING_NICHT_TAUSCHEN ${KERN_QUELLEN35})

# S19 (MIDI learn): failure cases of the learn table; every one of these tests must fail (WILL_FAIL).
# slot 1 is acknowledged but not swapped (test_core_learn case 5)
test_mutation(test_kern_lernen_tausch_mutation test_core_learn CYPHERDJ_MUTATION_LERN_NICHT_TAUSCHEN ${KERN_QUELLEN35})
# hand_in events without a slot-0 entry also reach the learn table (case 3)
test_mutation(test_kern_lernen_hand_in_mutation test_core_learn CYPHERDJ_MUTATION_LERN_AUCH_HAND_IN ${KERN_QUELLEN35})
# one allocation per translated midi_ein_1 event: the allocation guard of test_core_midi case 3 must fire
test_mutation(test_kern_midi_lern_alloc_mutation test_core_midi CYPHERDJ_MUTATION_LERN_ALLOKIERT ${KERN_QUELLEN35})
# the net thread always answers slot 0 for geraet "lernen" (test_net_learn case 7); own object as in test_netz_ein_mutation
add_executable(test_netz_lernen_slot_mutation tests/test_net_learn.cpp src/net.cpp)
target_include_directories(test_netz_lernen_slot_mutation PRIVATE include tests ${DJK}/contract)
target_compile_definitions(test_netz_lernen_slot_mutation PRIVATE CYPHERDJ_MUTATION_LERN_FALSCHER_SLOT=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_lernen_slot_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_lernen_slot_mutation COMMAND test_netz_lernen_slot_mutation)
set_tests_properties(test_netz_lernen_slot_mutation PROPERTIES WILL_FAIL TRUE)
# S19 capture: failure cases (each must fail)
test_mutation(test_kern_lernen_dauerhaft_mutation test_core_learn CYPHERDJ_MUTATION_LERN_DAUERHAFT ${KERN_QUELLEN35})      # stays armed after the report
test_mutation(test_kern_lernen_belegt_mutation test_core_learn CYPHERDJ_MUTATION_LERN_OHNE_BELEGT ${KERN_QUELLEN35})        # belegt always 0
test_mutation(test_kern_lernen_weitergereicht_mutation test_core_learn CYPHERDJ_MUTATION_LERN_WEITERGEREICHT ${KERN_QUELLEN35})  # captured CC also moves the knob
test_mutation(test_kern_lernen_frist_mutation test_core_learn CYPHERDJ_MUTATION_LERN_OHNE_FRIST ${KERN_QUELLEN35})          # no timeout
test_mutation(test_kern_lernen_nie_scharf_mutation test_core_learn CYPHERDJ_MUTATION_LERN_NIE_SCHARF ${KERN_QUELLEN35})      # acknowledged, never armed
# the net thread swaps kanal and nr on the wire (test_net_learn case 16); own object as above
add_executable(test_netz_lernen_gelernt_mutation tests/test_net_learn.cpp src/net.cpp)
target_include_directories(test_netz_lernen_gelernt_mutation PRIVATE include tests ${DJK}/contract)
target_compile_definitions(test_netz_lernen_gelernt_mutation PRIVATE CYPHERDJ_MUTATION_LERN_GELERNT_VERTAUSCHT=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_lernen_gelernt_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_lernen_gelernt_mutation COMMAND test_netz_lernen_gelernt_mutation)
set_tests_properties(test_netz_lernen_gelernt_mutation PROPERTIES WILL_FAIL TRUE)

# Scheibe 35, /pegel: der Kern für den Fehlerfall am Ziel (0 /pegel) und der Test gegen dieselbe Mutation (muss scheitern).
kern_mutation(cypherdj-kern-mutation-kein-pegel CYPHERDJ_MUTATION_KEIN_PEGEL)
test_mutation(test_kern_pegel_mutation test_core_level CYPHERDJ_MUTATION_KEIN_PEGEL ${KERN_QUELLEN35})

# Keylock Task 2: Fehlerfälle gegen test_deck_keylock. Der Test fährt auch einen Kern-Neustart (Test 8, Zustandsdatei) und
# braucht darum alle Kern-Quellen samt stretcher.cpp und Rubber Band.
function(deck_keylock_mutation name schalter)
  kern_mut_exe(${name} QUELLEN tests/test_deck_keylock.cpp ${KERN_QUELLEN} SCHALTER ${schalter} DEFS CYPHERDJ_DJK="${DJK}"
               INCLUDES include tests ${DJK}/contract LIBS ${KERN_MUT_LIBS})
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
  cdj_require_selector(tests/test_loopbox_keylock.cpp ${test})
  kern_mut_exe(${name} QUELLEN tests/test_loopbox_keylock.cpp ${KERN_QUELLEN} SCHALTER ${schalter} DEFS CYPHERDJ_DJK="${DJK}"
               INCLUDES include tests ${DJK}/contract LIBS ${KERN_MUT_LIBS})
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
# Keylock 7b.3: /zustand/box mit vertauschten Zählern -> test_core_box_keylock k4 rot.
kern_mut_exe(test_kern_box_keylock_zaehler_mutation QUELLEN tests/test_core_box_keylock.cpp ${KERN_QUELLEN}
             SCHALTER CYPHERDJ_MUTATION_BOX_ZAEHLER_VERTAUSCHT DEFS CYPHERDJ_DJK="${DJK}"
             INCLUDES include tests ${DJK}/contract LIBS ${KERN_MUT_LIBS})
cdj_require_selector(tests/test_core_box_keylock.cpp k4)
add_test(NAME test_kern_box_keylock_zaehler_mutation COMMAND test_kern_box_keylock_zaehler_mutation k4)
set_tests_properties(test_kern_box_keylock_zaehler_mutation PROPERTIES WILL_FAIL TRUE TIMEOUT 300)
# Keylock Task 2.5: Fehlerfälle gegen test_core_keylock_threads (Kern mit echten Fäden, alle Kern-Quellen samt stretcher.cpp).
# Je Ziel nur der betroffene Test (Argument), damit der rote Lauf nicht die übrigen mitfährt.
function(kern_keylock_faeden_mutation name schalter test)
  cdj_require_selector(tests/test_core_keylock_threads.cpp ${test})
  kern_mut_exe(${name} QUELLEN tests/test_core_keylock_threads.cpp ${KERN_QUELLEN} SCHALTER ${schalter} DEFS CYPHERDJ_DJK="${DJK}"
               INCLUDES include tests ${DJK}/contract LIBS ${KERN_MUT_LIBS})
  add_test(NAME ${name} COMMAND ${name} ${test})
  # 77: the selected case could not run here (startfehler as root); skipped instead of "failed as intended" without a red check.
  set_tests_properties(${name} PROPERTIES WILL_FAIL TRUE TIMEOUT 120 SKIP_RETURN_CODE 77)
endfunction()
# Pflicht aus der Nachprüfung (N3) verletzt: der Arbeits-Thread füllt nur bei spielendem Deck -> quittung rot.
kern_keylock_faeden_mutation(test_kern_keylock_faeden_nur_laufend_mutation CYPHERDJ_MUTATION_KEYLOCK_FUELLE_NUR_LAUFEND quittung)
# Ohne Wächter -> guard rot; Arbeits-Thread von Deck 1 hält nach rund 1 s an -> guard rot (Meldung im gesunden Teil).
kern_keylock_faeden_mutation(test_kern_keylock_faeden_ohne_waechter_mutation CYPHERDJ_MUTATION_KEYLOCK_OHNE_WAECHTER guard)
kern_keylock_faeden_mutation(test_kern_keylock_faeden_haelt_mutation CYPHERDJ_MUTATION_KEYLOCK_FADEN_HAELT guard)
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
# F2 /k/deck/loop ohne exakte Länge, F5 Grenzprüfung mit round statt ceil: test_core_loop_drift rot
test_mutation(test_kern_loop_drift_ohne_lx_mutation test_core_loop_drift CYPHERDJ_MUTATION_KERN_LOOP_OHNE_LX ${KERN_QUELLEN35})
test_mutation(test_kern_loop_drift_grenze_mutation test_core_loop_drift CYPHERDJ_MUTATION_KERN_LOOP_GRENZE_LF ${KERN_QUELLEN35})
# Keylock 7b.1: dasselbe am Deck (Stand Task 7): Test 32 rot.
deck_keylock_mutation(test_deck_keylock_basis_wechsel_mutation CYPHERDJ_MUTATION_KEYLOCK_BASIS_WECHSEL)
# Keylock 7c.4: Knopf aus auf der Basis friert ein bzw. lineare Blende in den Direktweg (Stand 7b): Test 32 rot.
deck_keylock_mutation(test_deck_keylock_aus_basis_einfrieren_mutation CYPHERDJ_MUTATION_KEYLOCK_AUS_BASIS_EINFRIEREN)
deck_keylock_mutation(test_deck_keylock_basis_linear_mutation CYPHERDJ_MUTATION_KEYLOCK_BASIS_LINEAR)
# Keylock Task 6a (Detailschnitt 6a, Abschnitt 8): Fehlerfälle gegen test_deck_planned, je Ziel nur der betroffene Test (Argument).
function(deck_geplant_mutation name schalter test)
  cdj_require_selector(tests/test_deck_planned.cpp ${test})
  kern_mut_exe(${name} QUELLEN tests/test_deck_planned.cpp ${KERN_QUELLEN} SCHALTER ${schalter} DEFS CYPHERDJ_DJK="${DJK}"
               INCLUDES include tests ${DJK}/contract LIBS ${KERN_MUT_LIBS})
  add_test(NAME ${name} COMMAND ${name} ${test})
  set_tests_properties(${name} PROPERTIES WILL_FAIL TRUE TIMEOUT 300)
endfunction()
# 6a-1: das herausgelöste deck_lies ohne die Naht-Blende (bestehender Schalter): die Prüfsummen des Stands vorher sehen es.
deck_geplant_mutation(test_deck_geplant_naht_hart_mutation CYPHERDJ_MUTATION_KEYLOCK_LOOP_NAHT_HART band_bitgleich)
# 6a-2/6a-3 (Detailschnitt 6a, Abschnitt 3.8 und 8): je Schalter genau sein Test rot (Gegenprobe über alle Tests: Ablage 6a).
# Stand vor 6a (kein Plan, jeder Start über die Brücke): P4a und der Kern-Weg K6a rot.
deck_geplant_mutation(test_deck_geplant_start_aus_mutation CYPHERDJ_MUTATION_PLAN_START_AUS start_stand)
deck_geplant_mutation(test_deck_geplant_kern_start_aus_mutation CYPHERDJ_MUTATION_PLAN_START_AUS core_start)
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
  cdj_require_selector(tests/test_deck_planned.cpp ${test})
  kern_mut_exe(${name} QUELLEN tests/test_deck_planned.cpp ${KERN_QUELLEN} SCHALTER CYPHERDJ_PRUEF_GEN ${ARGN}
               DEFS CYPHERDJ_DJK="${DJK}" INCLUDES include tests ${DJK}/contract LIBS ${KERN_MUT_LIBS})
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
# Effekt-Sektion 2026-10-11: ein neuer Abonnent bekommt den gemerkten Stand der Regler und Boxen nicht: test_net_deck rot.
kern_mut_exe(test_netz_deck_stand_mutation QUELLEN tests/test_net_deck.cpp ${KERN_QUELLEN} SCHALTER CYPHERDJ_MUTATION_HALLO_OHNE_STAND
             DEFS CYPHERDJ_DJK="${DJK}" INCLUDES include tests ${DJK}/contract LIBS ${KERN_MUT_LIBS})
add_test(NAME test_netz_deck_stand_mutation COMMAND test_netz_deck_stand_mutation)
set_tests_properties(test_netz_deck_stand_mutation PROPERTIES WILL_FAIL TRUE)

# 1.15 A5c: the first /k/hallo of a generation carries /e/kanal_limiter; without it test_net_channel_limiter (H1, H2) must fail.
add_executable(test_netz_kanal_limiter_mutation tests/test_net_channel_limiter.cpp src/net.cpp)   # net.cpp mutated as its own object before the library (pattern test_kern_arr_ki_mutation)
target_include_directories(test_netz_kanal_limiter_mutation PRIVATE include tests)
target_compile_definitions(test_netz_kanal_limiter_mutation PRIVATE CYPHERDJ_MUTATION_HALLO_OHNE_KANAL_LIMITER=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_kanal_limiter_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_kanal_limiter_mutation COMMAND test_netz_kanal_limiter_mutation)
set_tests_properties(test_netz_kanal_limiter_mutation PROPERTIES WILL_FAIL TRUE)

# D1 K1: Fehlerfälle des Moduls Arrangement und des Wiedergabe-Laders (WILL_FAIL: der Test muss sie sehen)
test_mutation(test_arr_transport_vorhalt_mutation test_arr_transport CYPHERDJ_MUTATION_ARR_START_OHNE_VORHALT ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_transport_naht_mutation test_arr_transport CYPHERDJ_MUTATION_ARR_NAHT_BLOCKANFANG ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_transport_klammer_mutation test_arr_transport CYPHERDJ_MUTATION_ARR_KLAMMER_OHNE_START ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_transport_hinter_kopf_mutation test_arr_transport CYPHERDJ_MUTATION_ARR_KLAMMER_HINTER_KOPF ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_transport_naht_zyklus_mutation test_arr_transport CYPHERDJ_MUTATION_ARR_KLAMMER_NAHT_ZYKLUS ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_clips_einsatz_mutation test_arr_clips CYPHERDJ_MUTATION_ARR_CLIP_BLOCKANFANG ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_clips_einstieg_mutation test_arr_clips CYPHERDJ_MUTATION_ARR_EINSTIEG_OHNE_RAMPE ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_clips_naht_mutation test_arr_clips CYPHERDJ_MUTATION_ARR_NAHT_HART ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_clips_tausch_mutation test_arr_clips CYPHERDJ_MUTATION_ARR_TAUSCH_OHNE_BINDUNG ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_mixer_mute_mutation test_arr_mixer CYPHERDJ_MUTATION_ARR_MUTE_HART ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_mixer_pan_mutation test_arr_mixer CYPHERDJ_MUTATION_ARR_PAN_LINEAR ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_gruppen_ziel_mutation test_arr_groups CYPHERDJ_MUTATION_ARR_ZIEL_IGNORIERT ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_gruppen_hart_mutation test_arr_groups CYPHERDJ_MUTATION_ARR_ZIEL_HART ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_gruppen_pm_mutation test_arr_groups CYPHERDJ_MUTATION_ARR_PM_FADER_AUS ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_gruppen_mute_mutation test_arr_groups CYPHERDJ_MUTATION_ARR_MUTE_HART ${ARR_QUELLEN} src/clock.cpp)
# 1.10 Slice 3 Task 5a: sends and return strips
test_mutation(test_arr_returns_hall_tot_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_HALL_TOT ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_returns_hall_ohne_ausklang_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_HALL_OHNE_AUSKLANG ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_returns_hall_setze_jeden_block_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_HALL_SETZE_JEDEN_BLOCK ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_returns_hall_erste_entprellt_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_HALL_ERSTE_ENTPRELLT ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_returns_hall_kein_kredit_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_HALL_KEIN_KREDIT ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_returns_hall_zufall_uhr_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_HALL_ZUFALL_UHR ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_returns_hall_state_im_snapshot_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_HALL_STATE_IM_SNAPSHOT ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_returns_hall_ohne_join_mutation test_arr_returns CYPHERDJ_MUTATION_HALL_OHNE_JOIN ${ARR_QUELLEN} src/clock.cpp)   # mehrkern task 4: returns_pool_bitgleich must go red
test_mutation(test_arr_returns_send_pre_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_SEND_PRE ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_returns_send_ohne_mute_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_SEND_OHNE_MUTE ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_returns_send_ohne_gruppen_blende_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_SEND_OHNE_GRUPPEN_BLENDE ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_returns_ret_nach_pm_fader_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_RET_NACH_PM_FADER ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_returns_ret_solo_aus_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_RET_SOLO_AUS ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_returns_ruhe_schneidet_ab_mutation test_arr_returns CYPHERDJ_MUTATION_ARR_RUHE_SCHNEIDET_AB ${ARR_QUELLEN} src/clock.cpp)
# 1.10 slice 4a T2: insert chains in the strip (test_arr_inserts; the loader case needs arr_playback.cpp). Each mutation turns its named case red (INS_GRUPPE_UEBERSPRUNGEN also case 6, which counts the group stage in its checks).
test_mutation(test_arr_inserts_nach_fader_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_NACH_FADER ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)       # case 1
test_mutation(test_arr_inserts_pre_nach_fader_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_PRE_NACH_FADER ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp) # case 3
test_mutation(test_arr_inserts_pre_ohne_mute_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_PRE_OHNE_MUTE ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 3
test_mutation(test_arr_inserts_tausch_leert_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_TAUSCH_LEERT ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)     # case 4
test_mutation(test_arr_inserts_nan_durchlass_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_NAN_DURCHLASS ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 5
test_mutation(test_arr_inserts_bypass_sprung_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_BYPASS_SPRUNG ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 2
test_mutation(test_arr_inserts_gruppe_uebersprungen_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_GRUPPE_UEBERSPRUNGEN ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 8
test_mutation(test_arr_inserts_gruppe_pre_nach_fader_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_GRUPPE_PRE_NACH_FADER ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 8
test_mutation(test_arr_inserts_ret_vor_hall_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_RET_VOR_HALL ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 9
test_mutation(test_arr_inserts_pm_nach_fader_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_PM_NACH_FADER ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 10
test_mutation(test_arr_inserts_sc_ignoriert_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_SC_IGNORIERT ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 12 sidechain_kick
test_mutation(test_arr_inserts_sc_nach_kette_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_SC_NACH_KETTE ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 12 sc_vor_kette
test_mutation(test_arr_inserts_sc_nan_durchlass_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_SC_NAN_DURCHLASS ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 12 sc_nan
test_mutation(test_arr_inserts_pre_sprung_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_PRE_SPRUNG ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 13
test_mutation(test_arr_inserts_nan_nur_proben_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_NAN_NUR_PROBEN ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 14
test_mutation(test_arr_inserts_gruppe_leer_laeuft_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_GRUPPE_LEER_LAEUFT ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 15
test_mutation(test_arr_inserts_mix0_gr_steht_mutation test_arr_inserts CYPHERDJ_MUTATION_INS_MIX0_GR_STEHT ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 15
# 1.10 slice 4b T12: eq and saturator inserts (test_arr_inserts_4b). Each mutation turns its named case red.
test_mutation(test_arr_inserts_4b_eq_band_vertauscht_mutation test_arr_inserts_4b CYPHERDJ_MUTATION_INS_EQ_BAND_VERTAUSCHT ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)       # case 2 (and the b8 binding of case 1)
test_mutation(test_arr_inserts_4b_saett_aus_nach_drive_mutation test_arr_inserts_4b CYPHERDJ_MUTATION_INS_SAETT_AUS_NACH_DRIVE ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp) # case 4
test_mutation(test_arr_inserts_4b_pool_plus_eins_mutation test_arr_inserts_4b CYPHERDJ_MUTATION_INS_POOL_PLUS_EINS ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)           # case 5
test_mutation(test_arr_inserts_4b_nan_durchlass_mutation test_arr_inserts_4b CYPHERDJ_MUTATION_INS_NAN_DURCHLASS ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)               # case 8
test_mutation(test_arr_inserts_4b_komp_hash_nach_fader_mutation test_arr_inserts_4b_comp_hash CYPHERDJ_MUTATION_INS_NACH_FADER ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # negative control: the komp-only result of 4a changes with the stage after the fader
# Master limiter insert (test_arr_inserts_lim): the stage ignores the decke row and stays at -1 dB; the -6 dB assertion of case 1 goes red.
test_mutation(test_arr_inserts_lim_decke_fest_mutation test_arr_inserts_lim CYPHERDJ_MUTATION_INS_LIM_DECKE_FEST ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 1
# arr-fx slice 1: the utility insert (test_arr_inserts_util): the stage ignores the breite row; the width assertions of case 1 go red.
test_mutation(test_arr_inserts_util_breite_fest_mutation test_arr_inserts_util CYPHERDJ_MUTATION_INS_UTIL_BREITE_FEST ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 1
# arr-bk slice 3: the bk insert (test_arr_inserts_bk): the old instance is cut at the first sample of the block of a graph swap; the jump measure of case 4 goes red (registered, not run in the arr-bk round).
test_mutation(test_arr_inserts_bk_wechsel_hart_mutation test_arr_inserts_bk CYPHERDJ_MUTATION_INS_BK_WECHSEL_HART ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 4
# plan 1.11 T4: the effect-host insert (test_arr_host_stufe). Each mutation turns its named case red.
test_mutation(test_arr_host_ohne_waechter_mutation test_arr_host_stufe CYPHERDJ_MUTATION_HOST_OHNE_WAECHTER ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 3: the return guard is gone
test_mutation(test_arr_host_ring_kurz_mutation test_arr_host_stufe CYPHERDJ_MUTATION_HOST_RING_KURZ ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)           # case 2: the dry path reads one sample too late
test_mutation(test_arr_host_latenz_null_mutation test_arr_host_stufe CYPHERDJ_MUTATION_HOST_LATENZ_NULL ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)       # case 5, 8: the compensation does not count the host latency
test_mutation(test_arr_host_pdc_ohne_blende_mutation test_arr_host_stufe CYPHERDJ_MUTATION_HOST_PDC_OHNE_BLENDE ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp) # case 6: the delay change is not faded
test_mutation(test_arr_host_pm_nicht_gefuettert_mutation test_arr_host_stufe CYPHERDJ_MUTATION_HOST_PM_NICHT_GEFUETTERT ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 6: PM_GRP and PM_RET are fed only while delayed (stage on a return chain)
test_mutation(test_arr_host_ohne_ein_ausblendung_mutation test_arr_host_stufe CYPHERDJ_MUTATION_HOST_OHNE_EIN_AUSBLENDUNG ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 6: the stage entering or leaving a strip has no blend against the undelayed input
test_mutation(test_arr_host_verschiebung_hart_mutation test_arr_host_stufe CYPHERDJ_MUTATION_HOST_VERSCHIEBUNG_HART ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 6b: a host slot moves strips inside one swap and cuts the old strip
# plan 1.11 T5: health, fade and round-trip measurement (test_arr_host_ausfall, test_arr_host_measurement)
test_mutation(test_arr_host_ohne_blende_mutation test_arr_host_ausfall CYPHERDJ_MUTATION_HOST_OHNE_BLENDE src/arr_host_stufe.cpp src/edges.cpp)   # case 1: no fade, the weight jumps (step above the limit)
test_mutation(test_arr_host_trocken_unverzoegert_mutation test_arr_host_ausfall CYPHERDJ_MUTATION_HOST_TROCKEN_UNVERZOEGERT src/arr_host_stufe.cpp src/edges.cpp)   # case 1: the fade runs against the undelayed dry signal (time jump)
test_mutation(test_arr_host_stillstand_regel_mutation test_arr_host_ausfall CYPHERDJ_MUTATION_HOST_STILLSTAND_REGEL src/arr_host_stufe.cpp src/edges.cpp)   # case 2: a stall rule in the stage
test_mutation(test_arr_host_mess_schwelle_mutation test_arr_host_measurement CYPHERDJ_MUTATION_HOST_MESS_SCHWELLE src/arr_host_measurement.cpp)   # case 3: threshold 0, a hum is taken for the return
# 1.10 slice 4b T13: latency compensation (test_arr_pdc). Each mutation turns its named case red.
test_mutation(test_arr_pdc_fehlt_mutation test_arr_pdc CYPHERDJ_MUTATION_PDC_FEHLT_TABELLE ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)           # case 1 (four paths), 2, 3, 4, 5, 7
test_mutation(test_arr_pdc_doppelt_mutation test_arr_pdc CYPHERDJ_MUTATION_PDC_DOPPELT ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)               # case 1: the send path delayed twice
test_mutation(test_arr_pdc_nur_bei_an_mutation test_arr_pdc CYPHERDJ_MUTATION_PDC_NUR_BEI_AN ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)         # case 2: the delay depends on the project flag an
test_mutation(test_arr_pdc_bypass_ohne_latenz_mutation test_arr_pdc CYPHERDJ_MUTATION_INS_BYPASS_OHNE_LATENZ ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 2: a stage that is fully off does not delay
test_mutation(test_arr_pdc_block_neu_mutation test_arr_pdc CYPHERDJ_MUTATION_PDC_BLOCK_NEU ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)           # case 6: the ring is dropped at every block
test_mutation(test_arr_pdc_metronom_mutation test_arr_pdc CYPHERDJ_MUTATION_METRONOM_PDC_FEHLT ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)       # case 7: the click ignores the latency
test_mutation(test_arr_pdc_allokation_mutation test_arr_pdc CYPHERDJ_MUTATION_PDC_ALLOKATION ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)               # case 9: the ring code allocates in the callback
# 1.10 slice 4c T15: rack macros (test_arr_rack). Each mutation turns its named case red.
test_mutation(test_arr_rack_vertauscht_mutation test_arr_rack CYPHERDJ_MUTATION_MAKRO_VERTAUSCHT ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)       # case 1: von and bis swapped
test_mutation(test_arr_rack_row_gewinnt_mutation test_arr_rack CYPHERDJ_MUTATION_MAKRO_ROW_GEWINNT ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)     # case 2: a written row wins over the macro
test_mutation(test_arr_rack_spaet_mutation test_arr_rack CYPHERDJ_MUTATION_MAKRO_SPAET ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)                   # case 3: the move acts one block late
test_mutation(test_arr_rack_limit_17_mutation test_arr_rack CYPHERDJ_MUTATION_MAKRO_LIMIT_17 ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)             # case 4: the 17th target is cut silently
test_mutation(test_arr_rack_bleibt_mutation test_arr_rack CYPHERDJ_MUTATION_MAKRO_BLEIBT ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)                 # case 5: the override stays after the rack has gone
# 1.12 slice 6: insert and rack lanes (test_arr_auto_chain). The mutation turns K1, K3 and K7 red.
test_mutation(test_arr_auto_kette_bleibt_mutation test_arr_auto_chain CYPHERDJ_MUTATION_ARR_KETTE_LANE_BLEIBT ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # a lane that ends keeps driving
# 1.9 U8 T9: macros on rack members (test_arr_rack_macro). Each mutation turns its named cases red.
test_mutation(test_arr_rack_makro_glied_row_gewinnt_mutation test_arr_rack_macro CYPHERDJ_MUTATION_MAKRO_GLIED_ROW_GEWINNT ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)       # M1 to M5: the member's snapshot value wins over the macro
test_mutation(test_arr_rack_makro_glied_falsches_glied_mutation test_arr_rack_macro CYPHERDJ_MUTATION_MAKRO_GLIED_FALSCHES_GLIED ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # M1 to M7 (M6, M7 in part): the member index is off by one
# 1.9 U8 T9 fix round 2: a mapped member starts on its mapped value (test_arr_rack_macro M9). Each mutation turns M9 red.
test_mutation(test_arr_rack_makro_start_gleitet_mutation test_arr_rack_macro CYPHERDJ_MUTATION_ARR_RB_START_GLEITET ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)           # M9: the reported value reaches the instrument only after the lock on the stored value
test_mutation(test_arr_rack_makro_start_vorab_eigen_mutation test_arr_rack_macro CYPHERDJ_MUTATION_ARR_RB_START_VORAB_EIGEN ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # M9: the instrument locks on the default value, not the reported one
test_mutation(test_arr_rack_makro_live_sprung_mutation test_arr_rack_macro CYPHERDJ_MUTATION_ARR_RB_LIVE_SPRUNG ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)               # M9 counter-check: a macro move during the playback is no longer smoothed
# 1.9 U8 T9 fix round 3: the E9 side effect of the start-value fix on a plain RB track (test_arr_rb_start_lane: render lane vs own value, live vs render). Case 1 turns red (case 2, live against render, guards the monitor pre-roll and stays green under it).
kern_mut_exe(test_arr_rb_start_lane_start_gleitet_mutation QUELLEN tests/test_arr_rb_start_lane.cpp ${KERN_QUELLEN} SCHALTER CYPHERDJ_MUTATION_ARR_RB_START_GLEITET
             DEFS CYPHERDJ_DJK="${DJK}" INCLUDES include tests ${DJK}/contract LIBS ${KERN_MUT_LIBS})
add_test(NAME test_arr_rb_start_lane_start_gleitet_mutation COMMAND test_arr_rb_start_lane_start_gleitet_mutation)
set_tests_properties(test_arr_rb_start_lane_start_gleitet_mutation PROPERTIES WILL_FAIL TRUE)
# 1.10 slice 5 U1: structural sidechain key track post, track order, key buffer zeroing (test_arr_key). Each mutation turns its named case red.
test_mutation(test_arr_schluessel_post_vor_fader_mutation test_arr_key CYPHERDJ_MUTATION_SC_POST_VOR_FADER ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)       # case 2 (AK14 core, post case), 3, 5
test_mutation(test_arr_schluessel_ordnung_fest_mutation test_arr_key CYPHERDJ_MUTATION_SC_ORDNUNG_FEST ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)           # case 4: the order is ignored
test_mutation(test_arr_schluessel_struktur_ignoriert_mutation test_arr_key CYPHERDJ_MUTATION_SC_STRUKTUR_IGNORIERT ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 2 (post at fader 0), 1, 4, 5
test_mutation(test_arr_schluessel_kein_nullen_mutation test_arr_key CYPHERDJ_MUTATION_SC_KEIN_NULLEN ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)             # cases 6, 14, 15: the buffer keeps the block before
# 1.10 slice 5 U2a: key rules as data, group and return sources, silent-source cases.
test_mutation(test_arr_schluessel_gruppe_nach_kette_mutation test_arr_key CYPHERDJ_MUTATION_SC_GRUPPE_NACH_KETTE ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # cases 11, 12: the group pre key is the chain output
test_mutation(test_arr_schluessel_tabelle_offen_mutation test_arr_key CYPHERDJ_MUTATION_SC_TABELLE_OFFEN ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)           # case 10: the loader does not consult the table
test_mutation(test_arr_schluessel_ret_pre_nach_kette_mutation test_arr_key CYPHERDJ_MUTATION_SC_RET_PRE_NACH_KETTE ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 13b: the return pre key is the chain output
# 1.10 slice 5 U2b: DJ sources and key alignment (test_arr_key cases 16 to 21)
test_mutation(test_arr_schluessel_dj_null_mutation test_arr_key CYPHERDJ_MUTATION_SC_DJ_NULL ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)               # case 16: the DJ pointers are ignored
test_mutation(test_arr_schluessel_kein_versatz_mutation test_arr_key CYPHERDJ_MUTATION_SC_KEIN_VERSATZ ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)       # cases 18, 19: no key ring
test_mutation(test_arr_schluessel_versatz_eine_stufe_mutation test_arr_key CYPHERDJ_MUTATION_SC_VERSATZ_EINE_STUFE ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)   # case 19: the delay of the nearest stage, not the path sum
# 1.10 slice 4c T15: the export carries the rack macros (test_render_rack). render.cpp as its own mutated object: rack/... is no mixer control of the render (the export
# refuses the rows with `controls`); the test itself drops the rack rows at macro 1 (the 6 dB case goes red).
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
# 1.10 T9 (AK24): the render-only key mask. arr_output.cpp as its own mutated object: the mask zeroes the key points as well, the key source adds nothing and ducks nothing;
# the ducked-bass case of test_render_nur_key (the only core property of this task) goes red.
add_executable(test_render_nur_schluessel_stumm_mutation tests/test_render_nur_key.cpp src/arr_output.cpp)
target_include_directories(test_render_nur_schluessel_stumm_mutation PRIVATE include tests)
target_compile_definitions(test_render_nur_schluessel_stumm_mutation PRIVATE CYPHERDJ_MUTATION_NUR_SCHLUESSEL_STUMM=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_render_nur_schluessel_stumm_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_render_nur_schluessel_stumm_mutation COMMAND test_render_nur_schluessel_stumm_mutation)
set_tests_properties(test_render_nur_schluessel_stumm_mutation PROPERTIES WILL_FAIL TRUE)
# 1.10 slice 4a seam S4: the page's own request through the real loader (data/wiedergabe_ketten.json). The old page key `master` for the PM chain turns case 1 red.
test_mutation(test_arr_naht_seite_pm_umbenannt_mutation test_arr_seam_page CYPHERDJ_MUTATION_NAHT_PM_UMBENANNT ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp src/kit.cpp)   # case 1
# 1.10 slice 4a seam S3: an export built without the insert rows is >= 6 dB too loud; test_render_chains (project of data/wiedergabe_ketten.json) must go red
add_executable(test_render_ketten_ohne_ins_zeilen_mutation tests/test_render_chains.cpp)
target_include_directories(test_render_ketten_ohne_ins_zeilen_mutation PRIVATE include tests)
target_compile_definitions(test_render_ketten_ohne_ins_zeilen_mutation PRIVATE CYPHERDJ_MUTATION_RENDER_OHNE_INS_ZEILEN=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_render_ketten_ohne_ins_zeilen_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_render_ketten_ohne_ins_zeilen_mutation COMMAND test_render_ketten_ohne_ins_zeilen_mutation)
set_tests_properties(test_render_ketten_ohne_ins_zeilen_mutation PROPERTIES WILL_FAIL TRUE)
# arr-fx slice 1: an export built without the insert rows does not widen; test_render_utility must go red
add_executable(test_render_utility_ohne_ins_zeilen_mutation tests/test_render_utility.cpp)
target_include_directories(test_render_utility_ohne_ins_zeilen_mutation PRIVATE include tests)
target_compile_definitions(test_render_utility_ohne_ins_zeilen_mutation PRIVATE CYPHERDJ_MUTATION_RENDER_OHNE_INS_ZEILEN=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_render_utility_ohne_ins_zeilen_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_render_utility_ohne_ins_zeilen_mutation COMMAND test_render_utility_ohne_ins_zeilen_mutation)
set_tests_properties(test_render_utility_ohne_ins_zeilen_mutation PROPERTIES WILL_FAIL TRUE)

test_mutation(test_arr_noten_vorausblick_mutation test_arr_notes CYPHERDJ_MUTATION_ARR_OHNE_VORAUSBLICK ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_noten_tausch_mutation test_arr_notes CYPHERDJ_MUTATION_ARR_TAUSCH_OHNE_NOTE_AUS ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_noten_fenster_mutation test_arr_notes CYPHERDJ_MUTATION_ARR_FENSTER_LINEAR ${ARR_QUELLEN} src/clock.cpp)
# Automation Slice 1 T5: the cursor of AutoLane is not searched anew after a backward jump (seam, start): the lane test must go red
test_mutation(test_arr_auto_lane_cursor_mutation test_arr_auto_lane CYPHERDJ_MUTATION_ARR_AUTO_CURSOR_ALT)
# Automation Slice 1 T6a/T6b: the core evaluation of the lane (test_arr_auto) goes red under each of these
test_mutation(test_arr_auto_cursor_mutation test_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_CURSOR_ALT ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_auto_beat_linear_mutation test_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_BEAT_LINEAR ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_auto_blende_hart_mutation test_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_BLENDE_HART ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_auto_grund_mutation test_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_GRUND_UEBERSCHRIEBEN ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_auto_lane_null_mutation test_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_LANE_NULL ${ARR_QUELLEN} src/clock.cpp)   # slice 2: lane 0 taken as the fader lane
# Automation slice 2 task 3: pan, mute and solo lanes in the core
test_mutation(test_arr_auto_pan_blende_hart_mutation test_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_PAN_BLENDE_HART ${ARR_QUELLEN} src/clock.cpp)   # pan stop without the 480 blend
# Slice 2 optimisation: the look-ahead inside a hold window changes nothing but the cost (test_arr_auto_lookahead, seam on/off). Each error case makes it red.
test_mutation(test_arr_auto_vorausschau_cursor_mutation test_arr_auto_lookahead CYPHERDJ_MUTATION_ARR_AUTO_VORAUS_CURSOR ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_auto_vorausschau_naht_mutation test_arr_auto_lookahead CYPHERDJ_MUTATION_ARR_AUTO_VORAUS_NAHT ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_auto_vorausschau_tol_mutation test_arr_auto_lookahead CYPHERDJ_MUTATION_ARR_AUTO_VORAUS_TOL ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_auto_ziele_mute_hart_mutation test_arr_auto_targets CYPHERDJ_MUTATION_ARR_MUTE_HART ${ARR_QUELLEN} src/clock.cpp)   # AK7: a mute lane edge without the 480 fade
test_mutation(test_arr_auto_ziele_grund_mutation test_arr_auto_targets CYPHERDJ_MUTATION_ARR_AUTO_GRUND_UEBERSCHRIEBEN ${ARR_QUELLEN} src/clock.cpp)   # base mute overwritten by the lane value
test_mutation(test_arr_auto_ziele_geraet_erstes_sample_mutation test_arr_auto_targets CYPHERDJ_MUTATION_ARR_GERAET_ERSTES_SAMPLE ${ARR_QUELLEN} src/clock.cpp)   # slice 2 task 4: the device lane value at the first running sample of the block
test_mutation(test_arr_auto_ziele_pan_blende_hart_mutation test_arr_auto_targets CYPHERDJ_MUTATION_ARR_AUTO_PAN_BLENDE_HART ${ARR_QUELLEN} src/clock.cpp)   # pan lane deleted without the blend
# 1.12 Automation slice 3 task 2: the lane override in the Arrangement (test_arr_auto_intervention); each error case makes it red
test_mutation(test_arr_auto_eingriff_ohne_blende_mutation test_arr_auto_intervention CYPHERDJ_MUTATION_ARR_AUTO_UEBER_OHNE_BLENDE ${ARR_QUELLEN} src/clock.cpp)   # the grip without the 480 source blend
test_mutation(test_arr_auto_eingriff_tausch_loescht_mutation test_arr_auto_intervention CYPHERDJ_MUTATION_ARR_AUTO_UEBER_TAUSCH_LOESCHT ${ARR_QUELLEN} src/clock.cpp)   # a snapshot swap with the lane still there clears the override
test_mutation(test_arr_auto_eingriff_im_stopp_mutation test_arr_auto_intervention CYPHERDJ_MUTATION_ARR_AUTO_UEBER_IM_STOPP ${ARR_QUELLEN} src/clock.cpp)   # D5: a grip while the transport stands overrides
test_mutation(test_arr_auto_eingriff_freigabe_im_stopp_mutation test_arr_auto_intervention CYPHERDJ_MUTATION_ARR_AUTO_FREIGABE_IM_STOPP ${ARR_QUELLEN} src/clock.cpp)   # D6: the re-enable is refused while stopped
test_mutation(test_arr_auto_eingriff_kern_setze_ohne_war_mutation test_arr_auto_intervention_core CYPHERDJ_MUTATION_ARR_AUTO_SETZE_OHNE_WAR ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # the page path sets the Stellwerk value although the lane has not played
test_mutation(test_arr_auto_eingriff_zwei_ueberschreibt_mutation test_arr_auto_intervention CYPHERDJ_MUTATION_ARR_AUTO_UEBER_ZWEI_UEBERSCHREIBT ${ARR_QUELLEN} src/clock.cpp)   # a second change in a block overwrites the first (jump)
test_mutation(test_arr_auto_eingriff_kern_pickup_immer_mutation test_arr_auto_intervention_core CYPHERDJ_MUTATION_ARR_AUTO_UEBER_PICKUP_IMMER ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # the pickup stays true while overridden: every step falls back to the lane value
test_mutation(test_arr_auto_eingriff_kern_nachreichen_griff_mutation test_arr_auto_intervention_core CYPHERDJ_MUTATION_ARR_AUTO_UEBER_NACHREICHEN_GRIFF ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # the touches of teile_nachreichen count as grips
# 1.12 Automation slice 3 task 3: /k/arr/auto in the core (test_core_arr_auto) and in the net thread (test_net_arr_auto); each error case must make it red
test_mutation(test_kern_arr_auto_cypher_mutation test_core_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_CYPHER_UEBERSTEUERT ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # D9: the core lets cypher override
test_mutation(test_kern_arr_auto_im_stopp_mutation test_core_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_UEBER_IM_STOPP ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # D5: the stopped transport takes the override from the command
test_mutation(test_kern_arr_auto_ohne_abgleich_mutation test_core_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_OHNE_ABGLEICH ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # lost events are not re-reported
test_mutation(test_kern_arr_auto_abgleich_vergisst_mutation test_core_arr_auto CYPHERDJ_MUTATION_ARR_AUTO_ABGLEICH_VERGISST ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # the re-report forgets the rest when the event ring of the core is full
add_executable(test_netz_arr_auto_cypher_mutation tests/test_net_arr_auto.cpp src/net_arr.cpp)   # D9: the net thread lets cypher override; own object as test_netz_arr_erz4_mutation
target_include_directories(test_netz_arr_auto_cypher_mutation PRIVATE include tests)
target_compile_definitions(test_netz_arr_auto_cypher_mutation PRIVATE CYPHERDJ_MUTATION_ARR_AUTO_CYPHER_UEBERSTEUERT=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_arr_auto_cypher_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_arr_auto_cypher_mutation COMMAND test_netz_arr_auto_cypher_mutation)
set_tests_properties(test_netz_arr_auto_cypher_mutation PROPERTIES WILL_FAIL TRUE)
# 1.12 Automation slice 3 task 7: /k/arr/arm and /e/auto_punkt in the core (test_core_arr_arm) and in the net thread (test_net_arr_arm); each error case must make it red
test_mutation(test_kern_arr_arm_arm_cypher_mutation test_core_arr_arm CYPHERDJ_MUTATION_ARR_ARM_CYPHER ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # any source arms (core)
test_mutation(test_kern_arr_arm_ohne_arm_mutation test_core_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_OHNE_ARM ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # points without any arm
test_mutation(test_kern_arr_arm_alle_spuren_mutation test_core_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_ALLE_SPUREN ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # one armed track arms them all
test_mutation(test_kern_arr_arm_im_stopp_mutation test_core_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_IM_STOPP ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # points while the transport stands
test_mutation(test_kern_arr_arm_ohne_drossel_mutation test_core_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_OHNE_DROSSEL ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # no 50 Hz cap
test_mutation(test_kern_arr_arm_ohne_nachzuegler_mutation test_core_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_OHNE_NACHZUEGLER ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # no trailing value, the last value of a gesture is lost
test_mutation(test_kern_arr_arm_nachzuegler_erster_mutation test_core_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_NACHZUEGLER_ERSTER ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # the trailing value is the first of the window, not the newest
test_mutation(test_kern_arr_arm_beat_jetzt_mutation test_core_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_BEAT_JETZT ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # the beat is taken at the end of the block, not at the grip sample
test_mutation(test_kern_arr_arm_beat_linear_mutation test_core_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_BEAT_LINEAR ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # the beat ignores the tempo ramp
test_mutation(test_kern_arr_arm_beat_ohne_naht_mutation test_core_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_BEAT_OHNE_NAHT ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # the beat behind the loop seam keeps the old origin
test_mutation(test_kern_arr_arm_stopp_verwirft_mutation test_core_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_STOPP_VERWIRFT ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # a held point is dropped at the stop
test_mutation(test_kern_arr_arm_arm_aus_behaelt_mutation test_core_arr_arm CYPHERDJ_MUTATION_ARR_ARM_AUS_BEHAELT ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # a disarm keeps the held point
test_mutation(test_kern_arr_arm_paarung_erster_mutation test_core_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_PAARUNG_ERSTER ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # beat of the first grip with the value at the end of the sub-block
test_mutation(test_kern_arr_arm_arm_aus_fenster_neu_mutation test_core_arr_arm CYPHERDJ_MUTATION_ARR_ARM_AUS_FENSTER_NEU ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # a disarm forgets the rate window
test_mutation(test_kern_arr_arm_voll_verwirft_mutation test_core_arr_arm CYPHERDJ_MUTATION_ARR_PUNKT_VOLL_VERWIRFT ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # a point that finds the event ring full is dropped
add_executable(test_netz_arr_arm_cypher_mutation tests/test_net_arr_arm.cpp src/net_arr.cpp)   # the net thread lets every source arm; own object as test_netz_arr_auto_cypher_mutation
target_include_directories(test_netz_arr_arm_cypher_mutation PRIVATE include tests)
target_compile_definitions(test_netz_arr_arm_cypher_mutation PRIVATE CYPHERDJ_MUTATION_ARR_ARM_CYPHER=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_arr_arm_cypher_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_arr_arm_cypher_mutation COMMAND test_netz_arr_arm_cypher_mutation)
set_tests_properties(test_netz_arr_arm_cypher_mutation PROPERTIES WILL_FAIL TRUE)
test_mutation(test_arr_metronom_takt_mutation test_arr_metronom CYPHERDJ_MUTATION_ARR_METRONOM_KERN_TAKT ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_wiedergabe_ref_mutation test_arr_playback CYPHERDJ_MUTATION_ARR_CACHE_OHNE_REF src/arr_playback.cpp)
# Paket 1.13 Warp, Slice 1: Fehlerfälle des gewarpten Weges (RE-PITCH) und des /2-Laders; jeder muss den Test rot machen (WILL_FAIL)
test_mutation(test_arr_warp_tausch_mutation test_arr_warp CYPHERDJ_MUTATION_ARR_WARP_TAUSCH_GLEICH ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_warp_naht_mutation test_arr_warp CYPHERDJ_MUTATION_ARR_NAHT_HART ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_warp_dateiende_mutation test_arr_warp CYPHERDJ_MUTATION_ARR_WARP_OHNE_DATEIENDE ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_warp_blockanfang_mutation test_arr_warp CYPHERDJ_MUTATION_ARR_WARP_BLOCKANFANG ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_warp_neustart_mutation test_arr_warp CYPHERDJ_MUTATION_ARR_WARP_NEUSTART_URSPRUNG ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_warp_ausklang_mutation test_arr_warp CYPHERDJ_MUTATION_ARR_WARP_AUSKLANG_URSPRUNG ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_warp_unveraendert_naht_mutation test_arr_warp_unchanged CYPHERDJ_MUTATION_ARR_NAHT_HART ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_warp_unveraendert_einstieg_mutation test_arr_warp_unchanged CYPHERDJ_MUTATION_ARR_EINSTIEG_OHNE_RAMPE ${ARR_QUELLEN} src/clock.cpp)
# Paket 1.13 Warp, Slice 4 (Task 5): BEATS im Callback; jeder Fehlerfall muss test_arr_warp_beats rot machen (WILL_FAIL)
test_mutation(test_arr_warp_beats_kuerzen_mutation test_arr_warp_beats CYPHERDJ_MUTATION_ARR_BEATS_OHNE_KUERZBLENDE ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_warp_beats_varispeed_mutation test_arr_warp_beats CYPHERDJ_MUTATION_ARR_BEATS_VARISPEED ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_warp_beats_luecke_mutation test_arr_warp_beats CYPHERDJ_MUTATION_ARR_BEATS_LUECKE_SPIELT ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_warp_beats_ausklang_mutation test_arr_warp_beats CYPHERDJ_MUTATION_ARR_BEATS_AUSKLANG_WARP ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_warp_beats_gleich_loop_mutation test_arr_warp_beats CYPHERDJ_MUTATION_ARR_WARP_GLEICH_OHNE_LOOP ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_warp_beats_gleich_huelle_mutation test_arr_warp_beats CYPHERDJ_MUTATION_ARR_WARP_GLEICH_OHNE_HUELLE ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_warp_beats_gleich_einheiten_mutation test_arr_warp_beats CYPHERDJ_MUTATION_ARR_WARP_GLEICH_OHNE_EINHEITEN ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_warp_beats_gleich_zahl_mutation test_arr_warp_beats CYPHERDJ_MUTATION_ARR_WARP_GLEICH_OHNE_ZAHL ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_warp_lader_v1_mutation test_arr_warp_loader CYPHERDJ_MUTATION_ARR_WARP_IN_V1 src/arr_playback.cpp)
test_mutation(test_arr_warp_lader_steigend_mutation test_arr_warp_loader CYPHERDJ_MUTATION_ARR_WARP_OHNE_STEIGEND src/arr_playback.cpp)
test_mutation(test_arr_warp_lader_grenze_mutation test_arr_warp_loader CYPHERDJ_MUTATION_ARR_WARP_OHNE_GRENZE src/arr_playback.cpp)
test_mutation(test_arr_warp_lader_pitch_grenze_mutation test_arr_warp_loader CYPHERDJ_MUTATION_ARR_WARP_PITCH_OHNE_GRENZE src/arr_playback.cpp)
test_mutation(test_arr_warp_lader_gesamt_mutation test_arr_warp_loader CYPHERDJ_MUTATION_ARR_WARP_OHNE_GESAMT src/arr_playback.cpp)
test_mutation(test_arr_warp_lader_beats_steigend_mutation test_arr_warp_loader CYPHERDJ_MUTATION_ARR_BEATS_OHNE_STEIGEND src/arr_playback.cpp)
# Paket 1.13 Warp, Slice 3a (Task 4): viele Marker. ERSTES_SEGMENT macht jede Abbildung mit mehr als zwei Markern falsch (Referenzdatei und Abspielen).
test_mutation(test_warp_abbildung_erstes_segment_mutation test_warp_mapping CYPHERDJ_MUTATION_ARR_WARP_ERSTES_SEGMENT)
# Paket 1.13 Warp, Slice 2: COMPLEX und TONES im Arrangement (test_warp_factory_arr, automatisch eingesammelt): jede Mutation macht ihren Fall rot (WILL_FAIL)
if(CYPHERDJ_BUNGEE)
  set(WARP_WERK_QUELLEN src/warp_factory.cpp src/warp_factory_bungee.cpp cypherdj::bungee)
  # AK33 F4: a gain-only edit on a sounding RE-PITCH, BEATS or plain clip ramps the gain; the old voice swap must turn test_arr_gain_swap red (WILL_FAIL).
  # The test builds a warp engine for its COMPLEX control case, so the mutation target links the engine sources
  test_mutation(test_arr_gain_tausch_neu_mutation test_arr_gain_swap CYPHERDJ_MUTATION_ARR_GAIN_TAUSCH_NEU ${ARR_QUELLEN} src/clock.cpp ${WARP_WERK_QUELLEN})
  # Nachbesserung 3 (Ereignisse im Frist-Fenster, Fälle 10 bis 13): OHNE_DECKUNG bis NAHT_VORFILTER. Nachbesserung 4 (eine Regel für Tausch und Karte, Fall 14):
  # ZWEIMAL_ANSETZEN entfällt (die Regel ist weg), TAUSCH_FREI bis UNGEHOERT kommen dazu (Fall 15). OHNE_PLATZTAUSCH, KETTE_LANG, BRUECKE_BLEIBT und
  # ENDE_ALTE_KARTE macht test_warp_factory_arr nicht rot (gemessen im dritten Beweislauf der Nachbesserung 4): sie haben nur Ziele gegen die Zufallsfolgen (unten)
  # Nachbesserung 5 (Prüfung 5): PLATZ_OHNE_KLANG, SPAET_STILL, EINSATZ_OHNE_SPAET (Fall 16), OHNE_VORRANG (Fall 7 und 10 bei 2 361), STOPP_WARTET_HART (Fall 17);
  # BRUECKE_MINUS_EINS (fable m2) fängt nur der verdichtete Generator der Zufallsfolgen (unten)
  set(WARP_WERK_MUTATIONEN OHNE_VORAUSBLICK START_OHNE_FRIST NAHT_ALLE TAUSCH_HART OHNE_BLENDE KARTE_IGNORIERT OHNE_NACHHOLEN VORFILTER
      OHNE_DECKUNG DECKUNG_ORTLOS KARTE_VOR_EINSATZ KARTE_WARTET STOPP_VOR_EINSATZ EINSTIEG_STUMM EINSTIEG_NAECHSTE EINSTIEG_DOPPELT NAHT_VORFILTER
      TAUSCH_FREI REPITCH_DECKT EINSTIEG_LUECKE GAIN_SPRUNG UEBERGANG_LOCH UNGEHOERT
      PLATZ_OHNE_KLANG SPAET_STILL EINSATZ_OHNE_SPAET OHNE_VORRANG STOPP_WARTET_HART PITCH_GLEICH)
  foreach(m ${WARP_WERK_MUTATIONEN})
    string(TOLOWER ${m} mk)
    test_mutation(test_warp_werk_arr_${mk}_mutation test_warp_factory_arr CYPHERDJ_MUTATION_ARR_WARP_WERK_${m} ${ARR_QUELLEN} src/clock.cpp ${WARP_WERK_QUELLEN})
  endforeach()
  # Slice 3a (Task 15, E-K B4.2): dieselbe Lage mit 4096 Markern je Clip, 0 Allokationen in Callback und Werk
  if(TARGET test_core_arr_warp_alloc)
    add_test(NAME test_kern_arr_warp_alloc_4096 COMMAND test_core_arr_warp_alloc)
    set_tests_properties(test_kern_arr_warp_alloc_4096 PROPERTIES ENVIRONMENT "ALLOC_MARKER=4096")
  endif()
  test_mutation(test_warp_werk_viele_erstes_segment_mutation test_warp_factory_many CYPHERDJ_MUTATION_ARR_WARP_ERSTES_SEGMENT ${ARR_QUELLEN} src/clock.cpp ${WARP_WERK_QUELLEN})
  # Nachbesserung 4: die Zufallsfolgen (test_warp_factory_sequences, synchrone Attrappe, ohne Bungee) gegen die Mutationen, die sie in 300 Folgen fangen (die übrigen
  # fängt test_warp_factory_arr); CYPHERDJ_FOLGEN setzt die Zahl der Folgen. Langlauf: Ziel warp_werk_folgen_lang (50 000 Folgen, kein ctest). DECKT_VOR_EINSATZ und
  # NACHHOLEN_UEBER_ENDE fand der erste Langlauf; die Seeds 22894 und 9601 laufen in jedem Aufruf mit
  foreach(m TAUSCH_HART KARTE_IGNORIERT OHNE_NACHHOLEN OHNE_DECKUNG KARTE_VOR_EINSATZ TAUSCH_FREI REPITCH_DECKT BRUECKE_BLEIBT EINSTIEG_LUECKE OHNE_VORAUSBLICK
            START_OHNE_FRIST VORFILTER KARTE_WARTET EINSTIEG_DOPPELT ENDE_ALTE_KARTE DECKT_VOR_EINSATZ NACHHOLEN_UEBER_ENDE
            SPAET_STILL)   # Nachbesserung 5: ein später Einsatz schweigt; die Folgen mit spät (vorher ausgenommen, jetzt gedeckt) werden rot
    string(TOLOWER ${m} mk)
    test_mutation(test_warp_werk_folgen_${mk}_mutation test_warp_factory_sequences CYPHERDJ_MUTATION_ARR_WARP_WERK_${m} ${ARR_QUELLEN} src/clock.cpp)
    if(TEST test_warp_werk_folgen_${mk}_mutation)
      set_tests_properties(test_warp_werk_folgen_${mk}_mutation PROPERTIES ENVIRONMENT CYPHERDJ_FOLGEN=300)
    endif()
  endforeach()
  # Nachbesserung 5 (Prüfung 5): der verdichtete Generator (17 bis 32 Spuren, Ereignisse über alle Spuren, gemeinsame Grenzen, Klammern auf der Grenze, Karten 2 048 bis
  # 2 700 Samples vor der Grenze) als eigener Test mit 1 000 Folgen; gegen den Stand vor der Nachbesserung 10 rote von 302 (Löcher bei Platzmangel). Die Mutationen der
  # Klasse „Platz ohne Klang“ und fable m2 (BRUECKE_MINUS_EINS: der Wächter −1 gegen negative Clip-Starts) fängt er, der Plan-Generator nicht
  # Seeds 2 001 bis 3 000: in 1 bis 2 000 liegen die bekannten roten Folgen 160 (Flanke 14) und 1260 (fable m3), siehe Kopf des Tests. Als Mutationsziel nur
  # BRUECKE_MINUS_EINS (2 rote von 1 002; m2 hat keinen Fall in test_warp_factory_arr); PLATZ_OHNE_KLANG, EINSATZ_OHNE_SPAET und STOPP_WARTET_HART fängt der verdichtete
  # Generator nur mit 1 von 1 002 (Seeds 1 bis 1 000) oder gar nicht (2 001 bis 3 000): ihre Ziele sind Fall 16 und 17
  if(TARGET test_warp_factory_sequences)
    add_test(NAME test_warp_werk_folgen_dicht COMMAND test_warp_factory_sequences 1000 2001 --dicht)
  endif()
  # Slice 5 (D7): Ereignis transpose (Tausch der Tonhöhe an Werk-Clips) mit dem Zeugen der Tonhöhe; der Standard-Generator bleibt derselbe (Gewicht 0 ohne --transpose)
  if(TARGET test_warp_factory_sequences)
    add_test(NAME test_warp_werk_folgen_transpose COMMAND test_warp_factory_sequences 600 3001 --transpose)
  endif()
  foreach(m PITCH_GLEICH)
    string(TOLOWER ${m} mk)
    test_mutation(test_warp_werk_folgen_${mk}_mutation test_warp_factory_sequences CYPHERDJ_MUTATION_ARR_WARP_WERK_${m} ${ARR_QUELLEN} src/clock.cpp)
    if(TEST test_warp_werk_folgen_${mk}_mutation)
      set_tests_properties(test_warp_werk_folgen_${mk}_mutation PROPERTIES ENVIRONMENT "CYPHERDJ_FOLGEN=300;CYPHERDJ_FOLGEN_TRANSPOSE=1;CYPHERDJ_FOLGEN_SEED0=3001")
    endif()
  endforeach()
  foreach(m BRUECKE_MINUS_EINS)
    string(TOLOWER ${m} mk)
    test_mutation(test_warp_werk_folgen_dicht_${mk}_mutation test_warp_factory_sequences CYPHERDJ_MUTATION_ARR_WARP_WERK_${m} ${ARR_QUELLEN} src/clock.cpp)
    if(TEST test_warp_werk_folgen_dicht_${mk}_mutation)
      set_tests_properties(test_warp_werk_folgen_dicht_${mk}_mutation PROPERTIES ENVIRONMENT "CYPHERDJ_FOLGEN=1000;CYPHERDJ_FOLGEN_DICHT=1;CYPHERDJ_FOLGEN_SEED0=2001")
    endif()
  endforeach()
  # OHNE_PLATZTAUSCH und KETTE_LANG fängt kein Fall von test_warp_factory_arr (gemessen im Beweislauf der Nachbesserung 4), die Zufallsfolgen erst in 2 000 Folgen
  # (erste rote Seeds 898 und 414)
  foreach(m OHNE_PLATZTAUSCH KETTE_LANG)
    string(TOLOWER ${m} mk)
    test_mutation(test_warp_werk_folgen_${mk}_mutation test_warp_factory_sequences CYPHERDJ_MUTATION_ARR_WARP_WERK_${m} ${ARR_QUELLEN} src/clock.cpp)
    if(TEST test_warp_werk_folgen_${mk}_mutation)
      set_tests_properties(test_warp_werk_folgen_${mk}_mutation PROPERTIES ENVIRONMENT CYPHERDJ_FOLGEN=2000)
    endif()
  endforeach()
  # AK15 durch das Arrangement (Tausch mit anderer Quelle): liest() ohne die Stimmen lässt den Faden ein freigegebenes Audio lesen (Absturz, rc 139)
  test_mutation(test_warp_werk_tausch_quelle_liest_ohne_stimme_mutation test_warp_factory_swap_source CYPHERDJ_MUTATION_WARP_LIEST_OHNE_STIMME
                ${ARR_QUELLEN} src/clock.cpp ${WARP_WERK_QUELLEN})
  add_custom_target(warp_werk_folgen_lang COMMAND test_warp_factory_sequences 50000 1 DEPENDS test_warp_factory_sequences USES_TERMINAL)
  # Kosten des Vorausblicks bei 4 096 Clips (kein Test; Task 5 Step 10)
  add_executable(kern_kosten_vorausblick tests/cost/cost_lookahead.cpp)
  target_include_directories(kern_kosten_vorausblick PRIVATE tests)
  target_link_libraries(kern_kosten_vorausblick PRIVATE cypherdj_kernbib)
  # Nachbesserung 5: Kosten der Deckung später Einsätze (kein Test; Task 5 Step 10)
  add_executable(kern_kosten_deckung tests/cost/cost_cover.cpp)
  target_include_directories(kern_kosten_deckung PRIVATE tests)
  target_link_libraries(kern_kosten_deckung PRIVATE cypherdj_kernbib)
endif()
# Paket 1.13 Warp, Slice 2: ohne Maschine lehnt der Lader complex und tones mit warp_maschine_fehlt ab (grün, darum WILL_FAIL aus); die Mutation nimmt sie an (rot)
test_mutation(test_arr_warp_lader_ohne_maschine test_arr_warp_loader CYPHERDJ_TEST_OHNE_MASCHINE src/arr_playback.cpp)
set_tests_properties(test_arr_warp_lader_ohne_maschine PROPERTIES WILL_FAIL FALSE)
test_mutation(test_arr_warp_lader_maschine_still_mutation test_arr_warp_loader CYPHERDJ_MUTATION_ARR_WARP_MASCHINE_STILL src/arr_playback.cpp)
test_mutation(test_arr_wiedergabe_konto_mutation test_arr_playback CYPHERDJ_MUTATION_ARR_OHNE_KONTO src/arr_playback.cpp)
test_mutation(test_arr_wiedergabe_ordner_mutation test_arr_playback CYPHERDJ_MUTATION_ARR_ORDNER_ROH src/arr_playback.cpp)
test_mutation(test_arr_wiedergabe_bereich_mutation test_arr_playback CYPHERDJ_MUTATION_ARR_GAIN_ALT src/arr_playback.cpp)
test_mutation(test_arr_wiedergabe_endlich_mutation test_arr_playback CYPHERDJ_MUTATION_ARR_OHNE_ENDLICH src/arr_playback.cpp)
test_mutation(test_arr_wiedergabe_schnappschuss_mutation test_arr_playback CYPHERDJ_MUTATION_ARR_SCHNAPPSCHUSS_OFFEN src/arr_playback.cpp)
test_mutation(test_arr_wiedergabe_audio_kopf_mutation test_arr_playback CYPHERDJ_MUTATION_ARR_AUDIO_KOPF_OFFEN src/arr_playback.cpp)
# 1.12 slice 5 U8a T8.2 / T8.4: the gain envelope of the voice (test_arr_envelope); each error case makes it red
# integration of AK33 F4 (in-place gain edit) with the gain envelope: the in-place branch must rebind the envelope cursor (test_arr_gain_swap_hk)
test_mutation(test_arr_gain_tausch_hk_bindung_mutation test_arr_gain_swap_hk CYPHERDJ_MUTATION_ARR_GAIN_HK_BINDUNG_OHNE ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_huellkurve_cursor_mutation test_arr_envelope CYPHERDJ_MUTATION_ARR_HK_CURSOR_ALT ${ARR_QUELLEN} src/clock.cpp)   # the pool slot keeps its cursor: the loop wrap reads the end of the table
test_mutation(test_arr_huellkurve_tausch_hart_mutation test_arr_envelope CYPHERDJ_MUTATION_ARR_HK_TAUSCH_HART ${ARR_QUELLEN} src/clock.cpp)   # a table change at a swap jumps instead of gliding
test_mutation(test_arr_huellkurve_ausklang_mutation test_arr_envelope CYPHERDJ_MUTATION_ARR_HK_AUSKLANG_OHNE ${ARR_QUELLEN} src/clock.cpp)   # the tail copy ignores the envelope
test_mutation(test_arr_huellkurve_blockanfang_mutation test_arr_envelope CYPHERDJ_MUTATION_ARR_WARP_BLOCKANFANG ${ARR_QUELLEN} src/clock.cpp)   # the clip beat stands on the sub-block start (steep ramp)
# 1.12 slice 5 U8b T8.3: the same checks through RE-PITCH and BEATS voices (test_arr_envelope)
test_mutation(test_arr_huellkurve_warp_ohne_mutation test_arr_envelope CYPHERDJ_MUTATION_ARR_HK_WARP_OHNE ${ARR_QUELLEN} src/clock.cpp)   # a warped voice ignores the envelope
# 1.12 slice 5 U8b T8.3: the gain envelope through the warp werk voices (test_warp_factory_envelope, built only with Bungee like every warp_factory test)
if(CYPHERDJ_BUNGEE)
  test_mutation(test_warp_werk_huellkurve_schnellpfad_mutation test_warp_factory_envelope CYPHERDJ_MUTATION_ARR_HK_WERK_SCHNELLPFAD ${ARR_QUELLEN} src/clock.cpp ${WARP_WERK_QUELLEN})   # the fast path ignores the envelope
  test_mutation(test_warp_werk_huellkurve_bindung_mutation test_warp_factory_envelope CYPHERDJ_MUTATION_ARR_HK_WERK_BINDUNG_OHNE ${ARR_QUELLEN} src/clock.cpp ${WARP_WERK_QUELLEN})   # the cursor stays on the old table at a swap
  test_mutation(test_warp_werk_huellkurve_tausch_hart_mutation test_warp_factory_envelope CYPHERDJ_MUTATION_ARR_HK_TAUSCH_HART ${ARR_QUELLEN} src/clock.cpp ${WARP_WERK_QUELLEN})   # the factor jumps at a table swap
  test_mutation(test_warp_werk_huellkurve_cursor_mutation test_warp_factory_envelope CYPHERDJ_MUTATION_ARR_HK_CURSOR_ALT ${ARR_QUELLEN} src/clock.cpp ${WARP_WERK_QUELLEN})   # the pool slot keeps its cursor
  test_mutation(test_warp_werk_huellkurve_bruecke_mutation test_warp_factory_envelope CYPHERDJ_MUTATION_ARR_HK_BRUECKE_OHNE ${ARR_QUELLEN} src/clock.cpp ${WARP_WERK_QUELLEN})   # the bridge does not keep the factor
endif()
# 1.12 slice 5 U8b T8.5: the null test with a gain envelope (test_arr_envelope_null). A bug that live and render share (a voice path that ignores the envelope) is found by case 3
# (the render without the envelope against the live run with it must be red); the mutated voice code is linked ahead of the library (the pattern of the null tests above)
foreach(m ARR_HK_WARP_OHNE:arr_voices ARR_HK_WERK_SCHNELLPFAD:arr_warp)
  string(REPLACE ":" ";" mp ${m})
  list(GET mp 0 mdef)
  list(GET mp 1 mquelle)
  string(TOLOWER ${mdef} mname)
  add_executable(test_arr_huellkurve_null_${mname}_mutation tests/test_arr_envelope_null.cpp src/${mquelle}.cpp)
  target_include_directories(test_arr_huellkurve_null_${mname}_mutation PRIVATE include tests)
  target_compile_definitions(test_arr_huellkurve_null_${mname}_mutation PRIVATE CYPHERDJ_MUTATION_${mdef}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_arr_huellkurve_null_${mname}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_arr_huellkurve_null_${mname}_mutation COMMAND test_arr_huellkurve_null_${mname}_mutation)
  set_tests_properties(test_arr_huellkurve_null_${mname}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# 1.12 slice 5 U8a T8.1: the reader of gain_hk (test_arr_auto_loader); each error case makes it red
test_mutation(test_arr_auto_lader_hk_pruefung_mutation test_arr_auto_loader CYPHERDJ_MUTATION_ARR_HK_OHNE_PRUEFUNG src/arr_playback.cpp)   # /1 takes gain_hk, no value is checked
test_mutation(test_arr_auto_lader_hk_konto_mutation test_arr_auto_loader CYPHERDJ_MUTATION_ARR_HK_NICHT_GEBUCHT src/arr_playback.cpp)   # the hk points are not in je_bereich: not booked, not locked
# 1.12 slice 5 U9 T9.1: the reader of `relativ` lanes (test_arr_auto_loader)
test_mutation(test_arr_auto_lader_rel_eindeutig_mutation test_arr_auto_loader CYPHERDJ_MUTATION_ARR_REL_OHNE_EINDEUTIG src/arr_playback.cpp)   # an absolute and a relative lane of one target count as "twice"
# 1.12 slice 5 U9 T9.2, T9.3: the value stack (test_arr_auto_stack); each error case makes it red
test_mutation(test_arr_auto_stapel_klemme_mutation test_arr_auto_stack CYPHERDJ_MUTATION_ARR_AUTO_REL_OHNE_KLEMME ${ARR_QUELLEN} src/clock.cpp)   # the stack is not clamped to the range of the target
test_mutation(test_arr_auto_stapel_blende_mutation test_arr_auto_stack CYPHERDJ_MUTATION_ARR_AUTO_REL_OHNE_BLENDE ${ARR_QUELLEN} src/clock.cpp)   # the summand is added after the 480 blend: a hard step
test_mutation(test_arr_auto_stapel_uebersteuerung_mutation test_arr_auto_stack CYPHERDJ_MUTATION_ARR_AUTO_REL_BEI_UEBERSTEUERUNG ${ARR_QUELLEN} src/clock.cpp)   # the relative lane stays on the hand value
test_mutation(test_arr_auto_stapel_cursor_mutation test_arr_auto_stack CYPHERDJ_MUTATION_ARR_AUTO_CURSOR_ALT ${ARR_QUELLEN} src/clock.cpp)   # the relative cursor is not searched anew after the loop seam
test_mutation(test_arr_auto_ziele_rel_klemme_mutation test_arr_auto_targets CYPHERDJ_MUTATION_ARR_AUTO_REL_OHNE_KLEMME ${ARR_QUELLEN} src/clock.cpp)   # device stack not clamped
test_mutation(test_arr_auto_vorausschau_rel_mutation test_arr_auto_lookahead CYPHERDJ_MUTATION_ARR_AUTO_REL_VORAUS_OHNE ${ARR_QUELLEN} src/clock.cpp)   # the look-ahead of a stack ignores the relative lane
test_mutation(test_kanten_erz4_mutation test_edges CYPHERDJ_MUTATION_ARR_KANTE_ERZ4 src/edges.cpp)
# D1 K1 (A10): das Netz wartet aufs Laden; net_arr.cpp mutiert als eigenes Objekt vor der Bibliothek (Muster
# test_kern_vorhoeren_mutation). test_net_arr_gap muss scheitern (/uhr-Lücke so lang wie das Laden).
add_executable(test_netz_arr_luecke_mutation tests/test_net_arr_gap.cpp src/net_arr.cpp)
target_include_directories(test_netz_arr_luecke_mutation PRIVATE include tests)
target_compile_definitions(test_netz_arr_luecke_mutation PRIVATE CYPHERDJ_MUTATION_ARR_NETZ_WARTET=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_arr_luecke_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_arr_luecke_mutation COMMAND test_netz_arr_luecke_mutation)
set_tests_properties(test_netz_arr_luecke_mutation PROPERTIES WILL_FAIL TRUE)
# D1 K1 Fix 9: Ergebnis bei 1 s vollem Ergebnisring verworfen (ohne Endquittung); test_arr_loader Fall 5 muss scheitern
add_executable(test_arr_lader_ergebnis_mutation tests/test_arr_loader.cpp src/arr_loader.cpp)
target_include_directories(test_arr_lader_ergebnis_mutation PRIVATE include tests)
target_compile_definitions(test_arr_lader_ergebnis_mutation PRIVATE CYPHERDJ_MUTATION_ARR_ERGEBNIS_VERWORFEN=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_arr_lader_ergebnis_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_arr_lader_ergebnis_mutation COMMAND test_arr_lader_ergebnis_mutation)
set_tests_properties(test_arr_lader_ergebnis_mutation PROPERTIES WILL_FAIL TRUE)
# D1 K1 Fix 6: der Deck-Lader bucht das Konto erst nach dem Sperren (wie vorher); test_arr_loader Fall 4 muss scheitern
add_executable(test_arr_lader_konto_mutation tests/test_arr_loader.cpp src/loader.cpp)
target_include_directories(test_arr_lader_konto_mutation PRIVATE include tests)
target_compile_definitions(test_arr_lader_konto_mutation PRIVATE CYPHERDJ_MUTATION_LADER_KONTO_SPAET=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_arr_lader_konto_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_arr_lader_konto_mutation COMMAND test_arr_lader_konto_mutation)
set_tests_properties(test_arr_lader_konto_mutation PROPERTIES WILL_FAIL TRUE)
# Paket 1.13 Warp, Slice 2: der Lade-Faden gibt einen abgelösten Schnappschuss nicht frei, solange das Warp-Werk ihn liest (arr_loader.cpp mutiert als eigenes
# Objekt vor der Bibliothek): ohne die Frage an das Werk wird Fall 6 rot
add_executable(test_arr_lader_werk_mutation tests/test_arr_loader.cpp src/arr_loader.cpp)
target_include_directories(test_arr_lader_werk_mutation PRIVATE include tests)
target_compile_definitions(test_arr_lader_werk_mutation PRIVATE CYPHERDJ_MUTATION_ARR_LADER_OHNE_WERK=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_arr_lader_werk_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_arr_lader_werk_mutation COMMAND test_arr_lader_werk_mutation)
set_tests_properties(test_arr_lader_werk_mutation PROPERTIES WILL_FAIL TRUE)
# D1 K1: /erz/strom auf erz/4 ohne Riegel; net_erz.cpp mutiert als eigenes Objekt, test_net_arr muss scheitern
add_executable(test_netz_arr_erz4_mutation tests/test_net_arr.cpp src/net_erz.cpp)
target_include_directories(test_netz_arr_erz4_mutation PRIVATE include tests)
target_compile_definitions(test_netz_arr_erz4_mutation PRIVATE CYPHERDJ_MUTATION_ARR_ERZ4_FREI=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_arr_erz4_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_arr_erz4_mutation COMMAND test_netz_arr_erz4_mutation)
set_tests_properties(test_netz_arr_erz4_mutation PROPERTIES WILL_FAIL TRUE)
# D1 K1: Hand-Zielart arr/start_stopp ohne DJ-Quant; test_core_arr_hand (Fall 3) muss scheitern
test_mutation(test_kern_arr_hand_mutation test_core_arr_hand CYPHERDJ_MUTATION_ARR_HAND_IMMER_SOFORT ${KERN_QUELLEN35}
              src/arr_playback.cpp)
# D1 K1 Fix 7: ein zweiter /k/arr/stopp überschreibt die erste id ohne Endquittung; test_core_arr Fall 11f muss scheitern
test_mutation(test_kern_arr_stopp_mutation test_core_arr CYPHERDJ_MUTATION_ARR_STOPP_ID_UEBERSCHRIEBEN ${KERN_QUELLEN35}
              src/arr_playback.cpp)
# D1 K1 Fix 10: voller Wartepuffer führt sofort aus (überholt); test_core_arr Fall 12 muss scheitern
test_mutation(test_kern_arr_warte_mutation test_core_arr CYPHERDJ_MUTATION_ARR_WARTE_VORZIEHEN ${KERN_QUELLEN35}
              src/arr_playback.cpp)
# D1 K1 Fix 4 (Spec 6.27): KI-Stopp prüft nur laden und start; test_core_arr_ai Fall 7 muss scheitern. Seit K1-Fix-2
# fährt Fall 8 das Netz mit: core_arr.cpp mutiert als eigenes Objekt vor der Bibliothek (Muster test_net_arr_gap).
add_executable(test_kern_arr_ki_mutation tests/test_core_arr_ai.cpp src/core_arr.cpp)
target_include_directories(test_kern_arr_ki_mutation PRIVATE include tests)
target_compile_definitions(test_kern_arr_ki_mutation PRIVATE CYPHERDJ_MUTATION_ARR_KI_NUR_LADEN_START=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_kern_arr_ki_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_kern_arr_ki_mutation COMMAND test_kern_arr_ki_mutation)
set_tests_properties(test_kern_arr_ki_mutation PROPERTIES WILL_FAIL TRUE)
# 1.15 A6 (mix meters): core_mix.cpp / net_loop.cpp mutated as their own object before the library (pattern test_kern_arr_ki_mutation).
#   every block instead of 10 Hz, 4864 instead of 4800 samples, every channel instead of the ones with a running tool, mid/high swapped, wire order swapped,
#   A5c: the limiter is not a criterion (a bus whose only tool is the limiter publishes nothing)
foreach(m JEDER_BLOCK ALLE_KANAELE BAND_VERTAUSCHT ABSTAND_4864 OHNE_LIMITER_KRITERIUM)
  string(TOLOWER ${m} ml)
  add_executable(test_kern_mix_zustand_${ml}_mutation tests/test_core_mix_state.cpp src/core_mix.cpp)
  target_include_directories(test_kern_mix_zustand_${ml}_mutation PRIVATE include tests)
  target_compile_definitions(test_kern_mix_zustand_${ml}_mutation PRIVATE CYPHERDJ_MUTATION_MIX_${m}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_kern_mix_zustand_${ml}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_kern_mix_zustand_${ml}_mutation COMMAND test_kern_mix_zustand_${ml}_mutation)
  set_tests_properties(test_kern_mix_zustand_${ml}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
add_executable(test_netz_mix_zustand_mutation tests/test_net_mix_state.cpp src/net_loop.cpp)
target_include_directories(test_netz_mix_zustand_mutation PRIVATE include tests ${DJK}/contract)
target_compile_definitions(test_netz_mix_zustand_mutation PRIVATE CYPHERDJ_MUTATION_MIX_FELDER_VERTAUSCHT=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_mix_zustand_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_mix_zustand_mutation COMMAND test_netz_mix_zustand_mutation)
set_tests_properties(test_netz_mix_zustand_mutation PROPERTIES WILL_FAIL TRUE)
add_executable(test_netz_ins_gr_mutation tests/test_net_ins_gr.cpp src/net_loop.cpp)
target_include_directories(test_netz_ins_gr_mutation PRIVATE include tests ${DJK}/contract)
target_compile_definitions(test_netz_ins_gr_mutation PRIVATE CYPHERDJ_MUTATION_INS_GR_NICHT_GEROUTET=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_ins_gr_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_ins_gr_mutation COMMAND test_netz_ins_gr_mutation)
set_tests_properties(test_netz_ins_gr_mutation PROPERTIES WILL_FAIL TRUE)   # 1.10 slice 4a S2: a dropped INS_GR must turn test_net_ins_gr red
# the Mixer getters (mixer.h): sign, band index, "ran in the last block" (the range guard is shown under CYPHERDJ_SANITIZE, not here)
test_mutation(test_mixer_mix_reduktion_vorzeichen_mutation test_mixer_mix_reduction CYPHERDJ_MUTATION_MIX_GATE_VORZEICHEN src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_mix_reduktion_ohne_lief_mutation test_mixer_mix_reduction CYPHERDJ_MUTATION_MIX_GATE_OHNE_LIEF src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_mix_reduktion_band_mutation test_mixer_mix_reduction CYPHERDJ_MUTATION_MIX_MB_BAND_VERSCHOBEN src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_mix_reduktion_gate_oberkante_mutation test_mixer_mix_reduction CYPHERDJ_MUTATION_MIX_GATE_OBERKANTE src/mixer.cpp src/beatfx.cpp)
test_mutation(test_mixer_mix_reduktion_mb_oberkante_mutation test_mixer_mix_reduction CYPHERDJ_MUTATION_MIX_MB_OBERKANTE src/mixer.cpp src/beatfx.cpp)
if(CYPHERDJ_SANITIZE)   # the range guards: without them UBSan/ASan abort on the out-of-bounds read (in a plain build the read may pass by luck)
  test_mutation(test_mixer_mix_reduktion_gate_guard_mutation test_mixer_mix_reduction CYPHERDJ_MUTATION_MIX_GATE_OHNE_GUARD src/mixer.cpp src/beatfx.cpp)
  test_mutation(test_mixer_mix_reduktion_mb_guard_mutation test_mixer_mix_reduction CYPHERDJ_MUTATION_MIX_MB_OHNE_GUARD src/mixer.cpp src/beatfx.cpp)
endif()
# 1.15 A7b (spectrum path): mixer.cpp / net.cpp mutated as their own object before the library (pattern test_kern_arr_ki_mutation); each must turn
# test_mixer_spectrum red: cut 0 (stale samples stay), generation never bumped, tap writes while the selector is 0, tap on the neighbour channel (mixer.cpp);
# leeren() only instead of verwerfe_bis(), no second generation read, tag from the current selection (net.cpp)
foreach(m SPEK_SCHNITT_NULL SPEK_GEN_STUMM SPEK_IMMER_SCHREIBEN SPEK_TAP_VERSCHOBEN SPEK_CUE_OHNE_ABGRIFF SPEK_OHNE_UNGERADE)
  string(TOLOWER ${m} ml)
  add_executable(test_mixer_spektrum_${ml}_mutation tests/test_mixer_spectrum.cpp src/mixer.cpp)
  target_include_directories(test_mixer_spektrum_${ml}_mutation PRIVATE include tests)
  target_compile_definitions(test_mixer_spektrum_${ml}_mutation PRIVATE CYPHERDJ_MUTATION_${m}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_mixer_spektrum_${ml}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_mixer_spektrum_${ml}_mutation COMMAND test_mixer_spektrum_${ml}_mutation)
  set_tests_properties(test_mixer_spektrum_${ml}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
foreach(m SPEKTRUM_NUR_LEEREN SPEKTRUM_OHNE_G1 SPEKTRUM_ETIKETT_AKTUELL SPEKTRUM_OHNE_TAKT SPEKTRUM_OHNE_NEULESEN)
  string(TOLOWER ${m} ml)
  add_executable(test_mixer_spektrum_${ml}_mutation tests/test_mixer_spectrum.cpp src/net.cpp)
  target_include_directories(test_mixer_spektrum_${ml}_mutation PRIVATE include tests)
  target_compile_definitions(test_mixer_spektrum_${ml}_mutation PRIVATE CYPHERDJ_MUTATION_${m}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_mixer_spektrum_${ml}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_mixer_spektrum_${ml}_mutation COMMAND test_mixer_spektrum_${ml}_mutation)
  set_tests_properties(test_mixer_spektrum_${ml}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# D1 K1 Fix-2 Punkt 2 (§4.7): das Netz prüft im KI-Stopp den Bereich vor ki_gestoppt (wie vorher); Fall 8 muss scheitern
add_executable(test_kern_arr_ki_bereich_mutation tests/test_core_arr_ai.cpp src/net_arr.cpp)
target_include_directories(test_kern_arr_ki_bereich_mutation PRIVATE include tests)
target_compile_definitions(test_kern_arr_ki_bereich_mutation PRIVATE CYPHERDJ_MUTATION_ARR_KI_NACH_BEREICH=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_kern_arr_ki_bereich_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_kern_arr_ki_bereich_mutation COMMAND test_kern_arr_ki_bereich_mutation)
set_tests_properties(test_kern_arr_ki_bereich_mutation PROPERTIES WILL_FAIL TRUE)
# D1 K1 (A10): cost of a cycle with a playing arrangement against the situation without (the numbers go into the report; only the hash cases below are ctest cases)
add_executable(kern_kosten_arr tests/cost/cost_arr.cpp)
target_link_libraries(kern_kosten_arr PRIVATE cypherdj_kernbib)
# 1.8 T11 (AK32): cost of a cycle with armed recording tracks against the same arrangement without (gate +100 us at p99.9); not a ctest case, run by hand under the real-time lock (see the header of the file)
add_executable(kern_kosten_rec tests/cost/cost_rec.cpp)
target_link_libraries(kern_kosten_rec PRIVATE cypherdj_kernbib)
# NOTE: the reference hash is bit-exact and bound to this host (DJ-Maschine, Ryzen 7800X3D, gcc and glibc as installed there): libm ifunc dispatch can differ on another CPU or glibc.
# If kosten_arr_hash fails on another machine or after a toolchain change, measure the reference again before suspecting the code. PASS_REGULAR_EXPRESSION ignores the exit
# code on purpose: the hash covers the audio, and the lane self-check may exit 2 in the control run.
# Re-measured 2026-11-10 (wirt-timing): the lead of a host slot is 2n instead of 2n + 25, so the start of the arrangement moves 25 samples earlier and every pinned hash below changed; the
# variants (pool, serial, unused, no fifo, at 256 and 128) still agree with each other, which is what these tests pin. The previous values (main bccde012 and later): arr32ins 256 pm=dc9cc27c4c3f4649
# out=dc14fb5e7fa2cd46, 128 pm=e1912e21c15a1803 out=aff09e7d1d21b7ea; arr32rack 256 pm=dc46d62c4d78220f out=c6368275c50516af, 128 pm=6eadcb3158850ccf out=fbfb37bf1999fc47.
# Output hash of the arrangement lane (KOSTEN_HASH=1): FNV-1a over the production master and the master out, 2000 warm-up + 3000 measured cycles (blocks=5000). The reference values
# are those of the probe of 2026-11-06 on main bccde012 (Hall fork-join probe, unchanged Hall path). The control mutes track 3: it passes only if a hash line was printed (the lane
# self-check may exit 2, ctest ignores the exit code with PASS_REGULAR_EXPRESSION) AND neither reference value appears, so a crash or a missing line cannot pass it.
add_test(NAME kosten_arr_hash COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 $<TARGET_FILE:kern_kosten_arr> 3000 arr32ins)
set_tests_properties(kosten_arr_hash PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32ins pm=e134482f0c43ea8b out=8962e4bdef0c6d5b blocks=5000" TIMEOUT 120)
# mehrkern task 4: the same lane with the Halls on a HallPool of 3 workers must give exactly the same hash.
# The deadline is 1 s: no take-back, no self switch-off from wake jitter (SCHED_OTHER). The single HASH line (stdout) carries everything, so no ordering of stdout and stderr is relied on:
# the reference hash, pool_jobs > 0 (Hall blocks computed ON a worker: a pool that is merely attached cannot pass), no late and no taken-back job, the pool still on.
add_test(NAME kosten_arr_hash_pool COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 KOSTEN_HALL_FAEDEN=3 KOSTEN_HALL_FRIST_US=1000000 $<TARGET_FILE:kern_kosten_arr> 3000 arr32ins)
set_tests_properties(kosten_arr_hash_pool PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32ins pm=e134482f0c43ea8b out=8962e4bdef0c6d5b blocks=5000 pool_jobs=[1-9][0-9]* hall_jobs=[1-9][0-9]* pool_spaet=0 pool_zurueck=0 pool_an=1" TIMEOUT 120)
# Control of the line above: the pool is built but never attached (KOSTEN_HALL_POOL_UNBENUTZT). The hash is the same and pool_jobs is 0, so kosten_arr_hash_pool would be red on it.
add_test(NAME kosten_arr_hash_pool_unbenutzt COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 KOSTEN_HALL_FAEDEN=3 KOSTEN_HALL_FRIST_US=1000000 KOSTEN_HALL_POOL_UNBENUTZT=1 $<TARGET_FILE:kern_kosten_arr> 3000 arr32ins)
set_tests_properties(kosten_arr_hash_pool_unbenutzt PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32ins pm=e134482f0c43ea8b out=8962e4bdef0c6d5b blocks=5000 pool_jobs=0 hall_jobs=[1-9][0-9]*" TIMEOUT 120)
add_test(NAME kosten_arr_hash_kontrolle COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 KOSTEN_ARR32_STUMM=3 $<TARGET_FILE:kern_kosten_arr> 3000 arr32ins)
set_tests_properties(kosten_arr_hash_kontrolle PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32ins pm=[0-9a-f]+ out=[0-9a-f]+ blocks=5000"
                     FAIL_REGULAR_EXPRESSION "pm=e134482f0c43ea8b;out=8962e4bdef0c6d5b" TIMEOUT 120)
target_compile_definitions(kern_kosten_arr PRIVATE CYPHERDJ_DJK="${DJK}")   # 1.9: the lane arr32kit reads the repo test kits
# mehrkern-s3 task 0: the same lane at 128 samples per block (KOSTEN_BLOCK=128), serial (no pool). blocks=5000 is still one hash step per cycle.
# The reference pair was measured on f5db257d with the lane switch of this commit; it is not the 256 pair (a run that ignored KOSTEN_BLOCK would print that one).
add_test(NAME kosten_arr_hash_128 COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 KOSTEN_BLOCK=128 $<TARGET_FILE:kern_kosten_arr> 3000 arr32ins)
set_tests_properties(kosten_arr_hash_128 PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32ins pm=002a476ac0d1b78f out=139fbb6f629b78eb blocks=5000" TIMEOUT 120)
# Negative control of the line above: track 3 muted at 128. A hash line must be printed and neither reference value may appear.
add_test(NAME kosten_arr_hash_128_kontrolle COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 KOSTEN_BLOCK=128 KOSTEN_ARR32_STUMM=3 $<TARGET_FILE:kern_kosten_arr> 3000 arr32ins)
set_tests_properties(kosten_arr_hash_128_kontrolle PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32ins pm=[0-9a-f]+ out=[0-9a-f]+ blocks=5000"
                     FAIL_REGULAR_EXPRESSION "pm=002a476ac0d1b78f;out=139fbb6f629b78eb" TIMEOUT 120)
# mehrkern slice 3.2 task 5: phase Q (the track sources) on the Hall pool, the same hashes. The positive counters are in the regex: a run that stayed serial cannot pass
# (spur_blocks_parallel and spur_einheiten_worker > 0). FIFO_TEST lets the SCHED_OTHER test pool count as FIFO; without it the phase stays serial (the control below).
# The existing four hash ctests above are unchanged.
add_test(NAME kosten_arr_hash_spur COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 KOSTEN_SPUR_POOL=1 KOSTEN_SPUR_FIFO_TEST=1 KOSTEN_HALL_FAEDEN=3 KOSTEN_HALL_FRIST_US=1000000 $<TARGET_FILE:kern_kosten_arr> 3000 arr32ins)
set_tests_properties(kosten_arr_hash_spur PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32ins pm=e134482f0c43ea8b out=8962e4bdef0c6d5b blocks=5000 [^\n]*spur_blocks_parallel=[1-9][0-9]* spur_einheiten_worker=[1-9][0-9]*" TIMEOUT 120)
add_test(NAME kosten_arr_hash_spur_128 COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 KOSTEN_BLOCK=128 KOSTEN_SPUR_POOL=1 KOSTEN_SPUR_FIFO_TEST=1 KOSTEN_HALL_FAEDEN=3 KOSTEN_HALL_FRIST_US=1000000 $<TARGET_FILE:kern_kosten_arr> 3000 arr32ins)
set_tests_properties(kosten_arr_hash_spur_128 PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32ins pm=002a476ac0d1b78f out=139fbb6f629b78eb blocks=5000 [^\n]*spur_blocks_parallel=[1-9][0-9]* spur_einheiten_worker=[1-9][0-9]*" TIMEOUT 120)
# control: the load threshold above the live load (24 live units x 256 samples = 6144): the pool exists, nothing forks, the hash is the same
add_test(NAME kosten_arr_hash_spur_unbenutzt COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 KOSTEN_SPUR_POOL=1 KOSTEN_SPUR_FIFO_TEST=1 KOSTEN_SPUR_MIN_LAST=1000000 KOSTEN_HALL_FAEDEN=3 KOSTEN_HALL_FRIST_US=1000000 $<TARGET_FILE:kern_kosten_arr> 3000 arr32ins)
set_tests_properties(kosten_arr_hash_spur_unbenutzt PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32ins pm=e134482f0c43ea8b out=8962e4bdef0c6d5b blocks=5000 [^\n]*spur_blocks_parallel=0 spur_einheiten_worker=0 spur_einheiten_caller=0 spur_seriell_weg=[0-9]+ spur_seriell_wenig=[1-9][0-9]*" TIMEOUT 120)
# control: SPUR_POOL=1 without FIFO_TEST, SCHED_OTHER workers: the phase stays serial, the hash is the same (shows that the positive regex discriminates)
add_test(NAME kosten_arr_hash_spur_ohne_fifo COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 KOSTEN_SPUR_POOL=1 KOSTEN_HALL_FAEDEN=3 KOSTEN_HALL_FRIST_US=1000000 $<TARGET_FILE:kern_kosten_arr> 3000 arr32ins)
set_tests_properties(kosten_arr_hash_spur_ohne_fifo PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32ins pm=e134482f0c43ea8b out=8962e4bdef0c6d5b blocks=5000 [^\n]*spur_blocks_parallel=0 spur_einheiten_worker=0 spur_einheiten_caller=0 spur_seriell_weg=[0-9]+ spur_seriell_wenig=0 spur_seriell_fifo=[1-9][0-9]*" TIMEOUT 120)
# mehrkern slice 3 task 6b: the arr32rack lane (8 racks of 3 RB-338 and a Kit) equals itself serial against the pool; the pool run must compute rack units on workers
add_test(NAME kosten_arr_hash_rack COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 $<TARGET_FILE:kern_kosten_arr> 3000 arr32rack)
set_tests_properties(kosten_arr_hash_rack PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32rack pm=0b489968030f994f out=0808091c3dfefaab blocks=5000" TIMEOUT 120)
add_test(NAME kosten_arr_hash_rack_spur COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 KOSTEN_SPUR_POOL=1 KOSTEN_SPUR_FIFO_TEST=1 KOSTEN_HALL_FAEDEN=3 KOSTEN_HALL_FRIST_US=1000000 $<TARGET_FILE:kern_kosten_arr> 3000 arr32rack)
set_tests_properties(kosten_arr_hash_rack_spur PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32rack pm=0b489968030f994f out=0808091c3dfefaab blocks=5000 [^\n]*spur_blocks_parallel=[1-9][0-9]* spur_einheiten_worker=[1-9][0-9]* [^\n]*spur_rack_worker=[1-9][0-9]*" TIMEOUT 120)
add_test(NAME kosten_arr_hash_rack_128 COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 KOSTEN_BLOCK=128 $<TARGET_FILE:kern_kosten_arr> 3000 arr32rack)
set_tests_properties(kosten_arr_hash_rack_128 PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32rack pm=b5de7d51b09cdb6f out=59d80112d94209ff blocks=5000" TIMEOUT 120)
add_test(NAME kosten_arr_hash_rack_spur_128 COMMAND ${CMAKE_COMMAND} -E env KOSTEN_HASH=1 KOSTEN_BLOCK=128 KOSTEN_SPUR_POOL=1 KOSTEN_SPUR_FIFO_TEST=1 KOSTEN_HALL_FAEDEN=3 KOSTEN_HALL_FRIST_US=1000000 $<TARGET_FILE:kern_kosten_arr> 3000 arr32rack)
set_tests_properties(kosten_arr_hash_rack_spur_128 PROPERTIES PASS_REGULAR_EXPRESSION "HASH lane=arr32rack pm=b5de7d51b09cdb6f out=59d80112d94209ff blocks=5000 [^\n]*spur_blocks_parallel=[1-9][0-9]* spur_einheiten_worker=[1-9][0-9]* [^\n]*spur_rack_worker=[1-9][0-9]*" TIMEOUT 120)
# KOSTEN_BLOCK is checked first thing in main(): an invalid value exits 4 before any file is created. The test needs exactly exit 4 plus the message (WILL_FAIL would also pass
# on a crash) and counts the pid-named /dev/shm/kern_kosten_arr_* directories before and after: none may be left behind.
add_test(NAME kosten_arr_block_ungueltig COMMAND sh -c "n0=$(ls -d /dev/shm/kern_kosten_arr_* 2>/dev/null | wc -l); KOSTEN_BLOCK=100 $<TARGET_FILE:kern_kosten_arr> 10 arr32ins; rc=$?; n1=$(ls -d /dev/shm/kern_kosten_arr_* 2>/dev/null | wc -l); echo \"rc=$rc dirs_before=$n0 dirs_after=$n1\"; [ $rc -eq 4 ] && [ $n1 -le $n0 ]")
set_tests_properties(kosten_arr_block_ungueltig PROPERTIES PASS_REGULAR_EXPRESSION "KOSTEN_BLOCK \"100\" is neither 128 nor 256.*rc=4 dirs_before=[0-9]+ dirs_after=[0-9]+" TIMEOUT 60)
# The pool deadline follows the block when no KOSTEN_HALL_FRIST_US is given: bloecke_us = lround(block * 1e6 / 48000) (5333 / 2667), deadline = bloecke_us / 4 = 1333 us at 256, 666 us at 128.
# The existing pool ctests all set an explicit deadline, so these are the only ones that see he.bloecke_us.
add_test(NAME kosten_arr_frist_256 COMMAND ${CMAKE_COMMAND} -E env KOSTEN_BLOCK=256 KOSTEN_HALL_FAEDEN=3 $<TARGET_FILE:kern_kosten_arr> 300 arr32ins)
set_tests_properties(kosten_arr_frist_256 PROPERTIES PASS_REGULAR_EXPRESSION "HallPool on, 3 workers[^\n]*frist_us 1333\n" TIMEOUT 120)
add_test(NAME kosten_arr_frist_128 COMMAND ${CMAKE_COMMAND} -E env KOSTEN_BLOCK=128 KOSTEN_HALL_FAEDEN=3 $<TARGET_FILE:kern_kosten_arr> 300 arr32ins)
set_tests_properties(kosten_arr_frist_128 PROPERTIES PASS_REGULAR_EXPRESSION "HallPool on, 3 workers[^\n]*frist_us 666\n" TIMEOUT 120)
# Control of the pair: an explicit KOSTEN_HALL_FRIST_US still wins at 128.
add_test(NAME kosten_arr_frist_128_fest COMMAND ${CMAKE_COMMAND} -E env KOSTEN_BLOCK=128 KOSTEN_HALL_FAEDEN=3 KOSTEN_HALL_FRIST_US=4321 $<TARGET_FILE:kern_kosten_arr> 300 arr32ins)
set_tests_properties(kosten_arr_frist_128_fest PROPERTIES PASS_REGULAR_EXPRESSION "HallPool on, 3 workers[^\n]*frist_us 4321\n" TIMEOUT 120)
# 1.10 Slice 3 Task 1: cost of Cypher Hall as a return effect (no ctest test, the numbers go into the report)
add_executable(kern_kosten_hall tests/cost/cost_reverb.cpp)
target_include_directories(kern_kosten_hall PRIVATE tests)
target_link_libraries(kern_kosten_hall PRIVATE cypherdj_kernbib)
# 1.10 slice 4b T11: cost per instance of the native insert kinds komp, eq, saett (pool sizes are decided from these numbers). The two ctest runs are the
# harness self-check: a short run must pass (it counts the instances it measured), and the build with CYPHERDJ_MUTATION_KOSTEN_INS_EINS (one instance when
# more are asked) must abort (WILL_FAIL).
add_executable(kern_kosten_ins tests/cost/cost_ins.cpp)
target_link_libraries(kern_kosten_ins PRIVATE cypherdj_kernbib)
target_compile_definitions(kern_kosten_ins PRIVATE CYPHERDJ_DJK="${DJK}")
add_test(NAME kosten_ins_selbstpruefung COMMAND ${CMAKE_COMMAND} -E env KOSTEN_INS_ANZAHL=0,1,12 KOSTEN_INS_FAELLE=komp,eq_mix,saett,utility_mono,bk_fx-echo-achtel $<TARGET_FILE:kern_kosten_ins> 300 1)
add_executable(kern_kosten_ins_mutation tests/cost/cost_ins.cpp)
target_compile_definitions(kern_kosten_ins_mutation PRIVATE CYPHERDJ_MUTATION_KOSTEN_INS_EINS=1)
target_link_libraries(kern_kosten_ins_mutation PRIVATE cypherdj_kernbib)
target_compile_definitions(kern_kosten_ins_mutation PRIVATE CYPHERDJ_DJK="${DJK}")
add_test(NAME kosten_ins_selbstpruefung_mutation COMMAND ${CMAKE_COMMAND} -E env KOSTEN_INS_ANZAHL=0,1,12 KOSTEN_INS_FAELLE=komp,eq_mix,saett,utility_mono,bk_fx-echo-achtel $<TARGET_FILE:kern_kosten_ins_mutation> 300 1)
set_tests_properties(kosten_ins_selbstpruefung_mutation PROPERTIES WILL_FAIL TRUE)
# D1 K2b: Fehlerfälle der Senken (RB-338 intern, Wirt-Slots) und ihrer Verdrahtung im Kern (WILL_FAIL)
test_mutation(test_arr_rb_senke_reihenfolge_mutation test_arr_rb_sink CYPHERDJ_MUTATION_ARR_RB_REIHENFOLGE ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_rb_senke_tausch_mutation test_arr_rb_sink CYPHERDJ_MUTATION_ARR_RB_TAUSCH_OHNE_PARAMETER ${ARR_QUELLEN}
              src/clock.cpp)
test_mutation(test_arr_rb_senke_versatz_mutation test_arr_rb_sink CYPHERDJ_MUTATION_ARR_RB_VERSATZ_NULL ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_rb_senke_zuruecksetzen_mutation test_arr_rb_sink CYPHERDJ_MUTATION_ARR_RB_OHNE_ZURUECKSETZEN ${ARR_QUELLEN}
              src/clock.cpp)
test_mutation(test_arr_rb_senke_ruhe_mutation test_arr_rb_sink CYPHERDJ_MUTATION_ARR_RB_RUHE_SOFORT ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_rb_senke_blende_mutation test_arr_rb_sink CYPHERDJ_MUTATION_ARR_RB_OHNE_BLENDE ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_rb_senke_blende_hart_mutation test_arr_rb_sink CYPHERDJ_MUTATION_ARR_RB_BLENDE_HART ${ARR_QUELLEN}
              src/clock.cpp)   # Fix F3: harter Schnitt am Anfang des Blendblocks, Fall 5 (Rampe) rot
test_mutation(test_arr_rb_senke_auto_lane_vor_vorgabe_mutation test_arr_rb_sink_auto CYPHERDJ_MUTATION_ARR_RB_LANE_VOR_VORGABE ${ARR_QUELLEN}
              src/clock.cpp)   # slice 2 task 4: the lane value applied before the defaults, case 1 red
test_mutation(test_arr_rb_senke_auto_spur_null_mutation test_arr_rb_sink_auto CYPHERDJ_MUTATION_ARR_RB_SPUR_NULL ${ARR_QUELLEN}
              src/clock.cpp)   # fix round 1: the track index filed as 0, case 9 red
test_mutation(test_arr_rb_senke_auto_rel_klemme_mutation test_arr_rb_sink_auto CYPHERDJ_MUTATION_ARR_AUTO_REL_OHNE_KLEMME ${ARR_QUELLEN}
              src/clock.cpp)   # 1.12 slice 5 U9: the summand sum is not clamped to 0..1, case 10b red
test_mutation(test_arr_rb_senke_wechsel_mutation test_arr_rb_sink CYPHERDJ_MUTATION_ARR_SPURWECHSEL_HART ${ARR_QUELLEN}
              src/clock.cpp)   # Fix F2: Spurwechsel ohne Ausblende und Zurücksetzen, Fall 6 rot
test_mutation(test_kern_arr_rb_mutation test_core_arr_rb CYPHERDJ_MUTATION_ARR_OHNE_RB_SENKE ${KERN_QUELLEN35} src/arr_playback.cpp)
test_mutation(test_kern_arr_wirt_vorhalt_mutation test_core_arr_instrument_host CYPHERDJ_MUTATION_ARR_WIRT_OHNE_VORHALT ${KERN_QUELLEN35}
              src/arr_playback.cpp)
test_mutation(test_kern_arr_wirt_leeren_mutation test_core_arr_instrument_host CYPHERDJ_MUTATION_ARR_MIDI_LEER_SPAET ${KERN_QUELLEN35}
              src/arr_playback.cpp)
test_mutation(test_kern_arr_wirt_wechsel_mutation test_core_arr_instrument_host CYPHERDJ_MUTATION_ARR_SPURWECHSEL_HART ${KERN_QUELLEN35}
              src/arr_playback.cpp)   # Fix F2: Wirt-Slot verlassen ohne CC 123 und Ausblende, Fall 6 rot
test_mutation(test_kern_arr_wirt_achse_mutation test_core_arr_instrument_host CYPHERDJ_MUTATION_ARR_A4_ACHSE_ALT ${KERN_QUELLEN35}
              src/arr_playback.cpp)   # Fix F7: offene A4-Messungen über /k/set/neu behalten, Fall 7 rot
test_mutation(test_kern_arr_wirt_nachreichen_mutation test_core_arr_instrument_host CYPHERDJ_MUTATION_ARR_MIDI_LEER_NACH_NACHREICHEN
              ${KERN_QUELLEN35} src/arr_playback.cpp)   # Fix F1: Leeren hinter arr_nachreichen(), Fall 5 rot
test_mutation(test_kern_arr_wirt_rueckweg_mutation test_core_arr_instrument_host CYPHERDJ_MUTATION_ARR_WIRT_OHNE_RUECKWEG ${KERN_QUELLEN35}
              src/arr_playback.cpp)
test_mutation(test_kern_arr_wirt_a4_mutation test_core_arr_instrument_host CYPHERDJ_MUTATION_ARR_A4_BLOCKANFANG ${KERN_QUELLEN35}
              src/arr_playback.cpp)
test_mutation(test_kanten_arr_zu_mutation test_edges CYPHERDJ_MUTATION_ARR_KANTEN_ZU src/edges.cpp)
test_mutation(test_kanten_riegel_mutation test_edges CYPHERDJ_MUTATION_KANTEN_OHNE_RIEGEL src/edges.cpp)
test_mutation(test_kanten_host_zu_mutation test_edges CYPHERDJ_MUTATION_HOST_KANTEN_ZU src/edges.cpp)   # plan 1.11 T3: arr_ins_<h>/arr_insret_<h> families not allowed
test_mutation(test_kanten_host_kern_mutation test_edges CYPHERDJ_MUTATION_HOST_KANTEN_KERN src/edges.cpp)   # plan 1.11 T4 pre-step B: another core instance accepted as the far end
test_mutation(test_midi_ausgabe_mutation test_midi_output CYPHERDJ_MUTATION_MIDI_UNSORTIERT src/edges.cpp)
# D1 K2b (Spec 6.28, A10): Messpunkt A4 über zwei Fäden; unter -DCYPHERDJ_TSAN=ON der Lauf für A10 (Ablage)
test_mutation(test_kern_arr_wirt_faden_mutation test_core_arr_instrument_host_thread CYPHERDJ_MUTATION_ARR_A4_BLOCKANFANG ${KERN_QUELLEN35}
              src/arr_playback.cpp)

# ---- Paket K3 (Spec D1 2.5, 3.1, A7): Freeze, Render, Ring-Mitschnitt, Null-Test
# Freeze-Abgriff nach dem Fader bzw. Loop-Klammer im Freeze nicht ausgesetzt: test_arr_freeze (Fall 1 bzw. 2) muss scheitern
test_mutation(test_arr_freeze_fader_mutation test_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_NACH_FADER ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_freeze_loop_mutation test_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_LOOP_BLEIBT ${ARR_QUELLEN} src/clock.cpp)
# Fix L10: start_beat des Nutzers nach dem Freeze nicht zurückgesetzt: test_arr_freeze (Fall 6) muss scheitern
test_mutation(test_arr_freeze_start_beat_mutation test_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_START_BEAT_BLEIBT ${ARR_QUELLEN}
              src/clock.cpp)
# Freeze-Rückgabe bei vollem Ereignisring verloren (Leck): test_core_arr_freeze (Fall 5) muss scheitern
test_mutation(test_kern_arr_freeze_mutation test_core_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_VERLIERBAR ${KERN_QUELLEN35}
              src/arr_playback.cpp)
# Fix 2/P2: statische Prüfung der Echtzeit-Quellen von Arrangement und Freeze (keine Sperr- und Warte-Köpfe, kein .wait,
# kein .acquire, Fix 3/Q1: kein std::atomic_wait/atomic_flag_wait samt _explicit), weil der Wächter Futex-Primitive ohne
# Kernel-Eintritt nicht sieht (alloc_intercept.h); Positiv-Kontrolle je Form im Lauf
add_test(NAME test_echtzeit_quellen COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_realtime_sources.py)
# Fix 2/P1: nur vier Warteplätze wie vor dem Fix, die nächste Rückgabe (auch die des laufenden Freeze) geht verloren:
# test_core_arr_freeze (Fall 9 a und b) muss scheitern
test_mutation(test_kern_arr_freeze_verwerfen_mutation test_core_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_RUECKGABE_VERWERFEN
              ${KERN_QUELLEN35} src/arr_playback.cpp)
# Fix 3/Q2: wartende Freeze-Rückgaben vorn eingehängt (LIFO statt ihrer Reihenfolge, core.h freeze_kopf_):
# test_core_arr_freeze (Fall 9 a und b, Reihenfolge der ARR_FREEZE-Ereignisse) muss scheitern
test_mutation(test_kern_arr_freeze_lifo_mutation test_core_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_LIFO
              ${KERN_QUELLEN35} src/arr_playback.cpp)
# Freeze überholt ein wartendes Laden (Reihenfolge hinter arr_warte_): test_core_arr_freeze (Fall 6) muss scheitern
test_mutation(test_kern_arr_freeze_ueberholt_mutation test_core_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_UEBERHOLT
              ${KERN_QUELLEN35} src/arr_playback.cpp)
# Spec 6.33: Prüfung des Tempo-Plans entfernt bzw. kein Abbruch bei Rampe: test_core_arr_freeze (Fall 7 a bzw. d) muss scheitern
test_mutation(test_kern_arr_freeze_rampe_pruefung_mutation test_core_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_OHNE_RAMPENPRUEFUNG
              ${KERN_QUELLEN35} src/arr_playback.cpp)
test_mutation(test_kern_arr_freeze_rampe_abbruch_mutation test_core_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_RAMPE_OHNE_ABBRUCH
              ${KERN_QUELLEN35} src/arr_playback.cpp)
# Fix L1: /k/set/neu lässt einen laufenden oder wartenden Freeze weiterlaufen: test_core_arr_freeze (Fall 8 a, b) muss scheitern
test_mutation(test_kern_arr_freeze_set_neu_mutation test_core_arr_freeze CYPHERDJ_MUTATION_ARR_FREEZE_SET_NEU_BLEIBT
              ${KERN_QUELLEN35} src/arr_playback.cpp)
# Abgebrochener Freeze wird trotzdem Datei: net_arr_freeze.cpp mutiert als eigenes Objekt vor der Bibliothek;
# test_net_arr_freeze (Fall 6) muss scheitern
add_executable(test_netz_arr_freeze_mutation tests/test_net_arr_freeze.cpp src/net_arr_freeze.cpp)
target_include_directories(test_netz_arr_freeze_mutation PRIVATE include tests)
target_compile_definitions(test_netz_arr_freeze_mutation PRIVATE CYPHERDJ_MUTATION_ARR_FREEZE_ABBRUCH_SCHREIBT=1
                           CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_arr_freeze_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_arr_freeze_mutation COMMAND test_netz_arr_freeze_mutation)
set_tests_properties(test_netz_arr_freeze_mutation PROPERTIES WILL_FAIL TRUE)
# Spec 6.25: eine vorhandene Freeze-Datei still ersetzt (rename statt RENAME_NOREPLACE): test_net_arr_freeze (Fall 9) rot
add_executable(test_netz_arr_freeze_ersetzt_mutation tests/test_net_arr_freeze.cpp src/arr_freeze_file.cpp)
target_include_directories(test_netz_arr_freeze_ersetzt_mutation PRIVATE include tests)
target_compile_definitions(test_netz_arr_freeze_ersetzt_mutation PRIVATE CYPHERDJ_MUTATION_ARR_FREEZE_ERSETZT=1
                           CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_arr_freeze_ersetzt_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_arr_freeze_ersetzt_mutation COMMAND test_netz_arr_freeze_ersetzt_mutation)
set_tests_properties(test_netz_arr_freeze_ersetzt_mutation PROPERTIES WILL_FAIL TRUE)
# Fix L12: Schreibfehler ohne Grund (errno verworfen): test_arr_freeze_file muss scheitern
test_mutation(test_arr_freeze_datei_errno_mutation test_arr_freeze_file CYPHERDJ_MUTATION_ARR_FREEZE_OHNE_ERRNO
              src/arr_freeze_file.cpp)
# Spec 6.29 (Fix L4: getrennt): Puffer anlegen zurück im Netz-Faden bzw. Datei schreiben zurück im Netz-Faden;
# test_net_arr_freeze_clock muss gegen jede allein scheitern (Fenster Anlegen bzw. Schreiben)
foreach(m ANLEGEN SCHREIBEN)
  string(TOLOWER ${m} klein)
  add_executable(test_netz_arr_freeze_uhr_${klein}_mutation tests/test_net_arr_freeze_clock.cpp src/net_arr_freeze.cpp)
  target_include_directories(test_netz_arr_freeze_uhr_${klein}_mutation PRIVATE include tests)
  target_compile_definitions(test_netz_arr_freeze_uhr_${klein}_mutation PRIVATE CYPHERDJ_MUTATION_ARR_FREEZE_${m}_IM_NETZ=1
                             CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_netz_arr_freeze_uhr_${klein}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_netz_arr_freeze_uhr_${klein}_mutation COMMAND test_netz_arr_freeze_uhr_${klein}_mutation)
  set_tests_properties(test_netz_arr_freeze_uhr_${klein}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# 1.10 rest AK26: the /uhr gap while the structure of a running playback is swapped (test_net_arr_swap_clock, glob-registered);
# the net thread waiting for the load that the swap contains (as in test_netz_arr_luecke_mutation) must make it red
add_executable(test_netz_arr_swap_uhr_mutation tests/test_net_arr_swap_clock.cpp src/net_arr.cpp)
target_include_directories(test_netz_arr_swap_uhr_mutation PRIVATE include tests)
target_compile_definitions(test_netz_arr_swap_uhr_mutation PRIVATE CYPHERDJ_MUTATION_ARR_NETZ_WARTET=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_arr_swap_uhr_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_arr_swap_uhr_mutation COMMAND test_netz_arr_swap_uhr_mutation)
set_tests_properties(test_netz_arr_swap_uhr_mutation PROPERTIES WILL_FAIL TRUE)
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
# K2b-Rest (a): ein Platz je Spur für die verlassene Senke (wie vor dem Re-Review): test_core_arr_instrument_host (Fall 8) muss scheitern
test_mutation(test_kern_arr_wirt_weg_mutation test_core_arr_instrument_host CYPHERDJ_MUTATION_ARR_WEG_EIN_PLATZ ${KERN_QUELLEN35}
              src/arr_playback.cpp)
# K2b-Rest (b): eine im selben Zyklus zurückgekehrte interne Spur geht durch den Zweig weg verloren: test_arr_rb_sink (Fall 7)
test_mutation(test_arr_rb_senke_zurueck_mutation test_arr_rb_sink CYPHERDJ_MUTATION_ARR_RB_ZURUECK_VERLOREN ${ARR_QUELLEN}
              src/clock.cpp)
# Render (Spec 6.20, 6.24): render.cpp bzw. core.cpp mutiert als eigenes Objekt vor der Bibliothek; test_render muss gegen
# beide scheitern (Regler-Quelle projekt ohne erz/4 neutral: still, Fall 6; der Kern hängt seine RB-338 nicht ein: die
# interne Spur schweigt, Fall 5); Fix L3: ohne Obergrenze für bis − von (Fall 1: 2048 + 1e-6 und 1e9 kein Aufruffehler);
# Fix L6: Ring-Leser ohne Marge für den Block im Flug (Fall 4: CAP − 8192 + 1 Frames angenommen); Fix L9: WAV ersetzt ein
# vorhandenes Ziel still (Fall 3 rot); Fix 2/P4: WAV verschränkt den ganzen Export in einer Kopie (Fall 8 rot)
# 1.15 A5b: the export aligned with the master limiter only, without the latency account L of the bus limiters (Fall 2 red)
# 1.10 slice 4a T6: ins/… is no mixer control of the render: the export has no inserts (Fall 12 red)
foreach(m RENDER_ERZ4_NICHT_NEUTRAL:render ARR_OHNE_RB_SENKE:core RENDER_OHNE_OBERGRENZE:render RING_OHNE_MARGE:ring_capture
          WAV_ERSETZT:wav WAV_GANZE_KOPIE:wav ARR_RENDER_OHNE_HALL_SOFORT:render RENDER_OHNE_KANAL_LATENZ:render RENDER_OHNE_INS:render
          RENDER_RACK_OHNE_SURGE_PRUEFUNG:render   # 1.9 U6 T6.4: a rack with a Surge member is not refused (case 1 red)
          RENDER_OHNE_VORHALT:render)   # 1.10 closure: the master tap is aligned without the limiter look-ahead (case 10 red, was by hand only, stand flank 8)
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
add_executable(test_kern_arr_returns_alloc_mutation tests/test_core_arr_returns_alloc.cpp src/arr_returns.cpp)
target_include_directories(test_kern_arr_returns_alloc_mutation PRIVATE include tests)
target_compile_definitions(test_kern_arr_returns_alloc_mutation PRIVATE CYPHERDJ_MUTATION_ARR_RET_ALLOC=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_kern_arr_returns_alloc_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_kern_arr_returns_alloc_mutation COMMAND test_kern_arr_returns_alloc_mutation)
set_tests_properties(test_kern_arr_returns_alloc_mutation PROPERTIES WILL_FAIL TRUE)
# 1.10 slice 4b T13/T14: the export of the production tap with latency stages (test_render_pdc, collected automatically). The export that does not skip the largest
# path latency (render.cpp as its own object before the library) must turn case 1 red; a start that does not wait for the EQ smoothing (render.cpp) and a delay ring that
# drops its history at every block (arr_output.cpp likewise) case 2.
foreach(m RENDER_OHNE_PDC_VORHALT:render RENDER_OHNE_EINSCHWINGEN:render PDC_BLOCK_NEU:arr_output)
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
# Null-Test (A7) am Offline-Kern: render.cpp bzw. null_test.cpp mutiert als eigenes Objekt vor der Bibliothek; test_null_test
# (Fall 1) muss gegen beide scheitern (Master ohne Limiter-Vorhalt ausgerichtet; Messfenster bis an die Naht)
foreach(m RENDER_OHNE_VORHALT:render NULL_OHNE_NAHTRAND:null_test)
  string(REPLACE ":" ";" mq ${m})
  list(GET mq 0 schalter)
  list(GET mq 1 quelle)
  string(TOLOWER ${schalter} klein)
  add_executable(test_nulltest_${klein}_mutation tests/test_null_test.cpp src/${quelle}.cpp)
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
add_executable(kern_kosten_arr_warp tests/cost/cost_arr_warp.cpp)
target_include_directories(kern_kosten_arr_warp PRIVATE tests)
target_link_libraries(kern_kosten_arr_warp PRIVATE cypherdj_kernbib)
# Paket 1.13 Warp, Slice 3a (Task 16): Kosten bei 2, 100, 865 und 4096 Markern je Clip, Tausch eingeschlossen (kein Test; Zahlen in den Bericht)
add_executable(kern_kosten_arr_warp_viele tests/cost/cost_arr_warp_many.cpp)
target_include_directories(kern_kosten_arr_warp_viele PRIVATE tests)
target_link_libraries(kern_kosten_arr_warp_viele PRIVATE cypherdj_kernbib)
# Paket 1.13 Warp, Messprobe Arbeitsfaden-Last (vor Slice 2): ein Werk aus Bungee-Stimmen und Arbeitsfäden ohne Kern (kein Test; Aufruf über
# tests/deck/warp_load_run.sh neben target_run_boxes.py); braucht nur Bungee
if(CYPHERDJ_BUNGEE)
  add_executable(kern_kosten_warp_werk tests/cost/cost_warp_factory.cpp)
  target_link_libraries(kern_kosten_warp_werk PRIVATE cypherdj::bungee Threads::Threads)
endif()
# Programme des Exports (Unterordner werkzeuge, den das Einsammeln nicht erfasst): cypherdj-render, cypherdj-mitschnitt,
# cypherdj-nulltest
add_executable(cypherdj-render src/tools/render_main.cpp)
target_link_libraries(cypherdj-render PRIVATE cypherdj_kernbib)
target_compile_options(cypherdj-render PRIVATE -Wall -Wextra)
# Set recording (demo 2026-11-07): the live master of a running core for a whole set, read only from the audio ring, to a WAV
add_executable(cypherdj-setmitschnitt src/tools/set_recording_main.cpp)
target_link_libraries(cypherdj-setmitschnitt PRIVATE cypherdj_kernbib)
target_compile_options(cypherdj-setmitschnitt PRIVATE -Wall -Wextra)
add_test(NAME test_setmitschnitt_probe COMMAND python3 ${CMAKE_CURRENT_SOURCE_DIR}/check/set_recording_probe.py $<TARGET_FILE:cypherdj-setmitschnitt>)
# Voice player (demo 2026-11-07): JACK client that stays on the core's input pair ein_<k> and plays queued speech clips
add_executable(cypherdj-stimme src/tools/voice_main.cpp)
target_link_libraries(cypherdj-stimme PRIVATE PkgConfig::JACK Threads::Threads)
target_include_directories(cypherdj-stimme PRIVATE include)
target_compile_options(cypherdj-stimme PRIVATE -Wall -Wextra)
add_executable(cypherdj-mitschnitt src/tools/capture_main.cpp)
target_link_libraries(cypherdj-mitschnitt PRIVATE cypherdj_kernbib)
target_compile_options(cypherdj-mitschnitt PRIVATE -Wall -Wextra)
add_executable(cypherdj-nulltest src/tools/null_test_main.cpp)
target_link_libraries(cypherdj-nulltest PRIVATE cypherdj_kernbib)
target_compile_options(cypherdj-nulltest PRIVATE -Wall -Wextra)
# Measuring tool of the production export null test (1.10 slice 2 task 23, stand flank 8): runs a render WAV through a fresh erz/4
# isolator at unity gains in blocks of 256; `acceptance_r1.mjs --teil 2` and `acceptance_r3.mjs` take it as `--iso-ref` (default: next to the build)
add_executable(iso_ref src/tools/iso_ref.cpp)
target_link_libraries(iso_ref PRIVATE cypherdj_kernbib)
target_compile_options(iso_ref PRIVATE -Wall -Wextra)
# Rauchprobe der drei Programme über ihre Kommandozeile (test_export_programme startet sie aus dem Bau-Ordner)
target_compile_definitions(test_export_programme PRIVATE CYPHERDJ_BIN="$<TARGET_FILE_DIR:cypherdj-render>")
add_dependencies(test_export_programme cypherdj-render cypherdj-mitschnitt cypherdj-nulltest)
# A10 (Spec 6.29): Dauer von Freeze-Puffer anlegen und Freeze-Datei schreiben im Lade-Faden (kein Test; Zahlen in den
# Bericht von Task 7.2)
add_executable(kern_freeze_schreiben tests/cost/freeze_write.cpp)
target_link_libraries(kern_freeze_schreiben PRIVATE cypherdj_kernbib)
test_mutation(test_eingang_spitze_mutation test_input CYPHERDJ_MUTATION_EIN_SPITZE_NUR_L)
test_mutation(test_midi_ein_versatz_mutation test_midi_in CYPHERDJ_MUTATION_MIDI_EIN_OHNE_VERSATZ)
test_mutation(test_kanten_ein_riegel_mutation test_edges_in CYPHERDJ_MUTATION_EIN_KANTEN_OHNE_RIEGEL src/edges.cpp)
test_mutation(test_kanten_ein_ziel_mutation test_edges_in CYPHERDJ_MUTATION_EIN_KANTEN_ZIEL_FREI src/edges.cpp)
test_mutation(test_kanten_ein_instanz_mutation test_edges_in CYPHERDJ_MUTATION_EIN_KANTEN_NUR_EIGENES src/edges.cpp)
test_mutation(test_kern_ein_midi_mutation test_core_in CYPHERDJ_MUTATION_EIN_MIDI_BLOCKANFANG ${KERN_QUELLEN35})
# I08 Task 4, Review-Nachzug: /zustand/ein auf dem Draht; net.cpp mutiert als eigenes Objekt, test_net_in muss scheitern
test_mutation(test_kanten_ein_trennen_mutation test_edges_in CYPHERDJ_MUTATION_EIN_KANTEN_KEIN_TRENNEN src/edges.cpp)
test_mutation(test_kern_ein_leser_mutation test_core_in CYPHERDJ_MUTATION_EIN_MIDI_OHNE_ABFLUSS ${KERN_QUELLEN35})
test_mutation(test_kern_ein_achse_mutation test_core_in CYPHERDJ_MUTATION_EIN_MIDI_ALTE_ACHSE ${KERN_QUELLEN35})
# Voice channel (voice.h): with stimme_eingang 0 the master stays bit-identical; the voice path running on pair 4 anyway must be red
test_mutation(test_kern_stimme_mutation test_core_voice CYPHERDJ_MUTATION_STIMME_IMMER_AN ${KERN_QUELLEN35})
test_mutation(test_kern_ein_reset_mutation test_core_in CYPHERDJ_MUTATION_EIN_ACHSE_OHNE_RESET ${KERN_QUELLEN35})
add_executable(test_netz_ein_mutation tests/test_net_in.cpp src/net.cpp)
target_include_directories(test_netz_ein_mutation PRIVATE include tests ${DJK}/contract)
target_compile_definitions(test_netz_ein_mutation PRIVATE CYPHERDJ_MUTATION_EIN_ZUSTAND_VERTAUSCHT=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_ein_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_netz_ein_mutation COMMAND test_netz_ein_mutation)
set_tests_properties(test_netz_ein_mutation PROPERTIES WILL_FAIL TRUE)

# I08 Task 6: Prüf-Client Impuls + Note im selben Frame (Messung der MIDI-Zeitstempel gegen Audio)
add_executable(cypherdj-pruef-ein check/in_check.cpp)
target_link_libraries(cypherdj-pruef-ein PRIVATE PkgConfig::JACK)

# I08 Task 14: Messclient cypherdj-latenz (Software-Schleife und Kabelschleife; Auswertung in check/latency_stat.h)
add_executable(cypherdj-latenz check/latency.cpp)
target_include_directories(cypherdj-latenz PRIVATE pruef)
target_link_libraries(cypherdj-latenz PRIVATE PkgConfig::JACK)
# Nachzug R1, R2: Mutations-Gegenstücke. Die Tests (tests/test_latency_run.cpp, tests/latenz_alte_datei.cmake) müssen an ihnen scheitern.
foreach(m OHNE_I OHNE_RUHE OHNE_FRIST RUHE_OHNE_FENSTER UNRUHIG_OHNE_PAUSE LAUT_BIS_FRAMES OHNE_LEER OHNE_LEER_URTEIL OHNE_JITTER OHNE_STREUUNG)
  string(TOLOWER ${m} mk)
  add_executable(test_latenz_lauf_${mk}_mutation tests/test_latency_run.cpp)
  target_compile_definitions(test_latenz_lauf_${mk}_mutation PRIVATE CYPHERDJ_MUTATION_LATENZ_${m}=1)
  target_link_libraries(test_latenz_lauf_${mk}_mutation PRIVATE Threads::Threads)
  add_test(NAME test_latenz_lauf_${mk}_mutation COMMAND test_latenz_lauf_${mk}_mutation)
  set_tests_properties(test_latenz_lauf_${mk}_mutation PROPERTIES WILL_FAIL TRUE TIMEOUT 60)
endforeach()
add_test(NAME test_latenz_alte_datei COMMAND ${CMAKE_COMMAND} -DBIN=$<TARGET_FILE:cypherdj-latenz> -DDIR=${CMAKE_CURRENT_BINARY_DIR}
         -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/latenz_alte_datei.cmake)
add_executable(cypherdj-latenz-mutation-alte-datei check/latency.cpp)
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
  add_executable(test_latenz_verdrahtung tests/latency_wiring.cpp)
  target_link_libraries(test_latenz_verdrahtung PRIVATE PkgConfig::JACK)
  add_executable(cypherdj-latenz-mutation-fester-name check/latency.cpp)
  target_include_directories(cypherdj-latenz-mutation-fester-name PRIVATE pruef)
  target_compile_definitions(cypherdj-latenz-mutation-fester-name PRIVATE CYPHERDJ_MUTATION_LATENZ_FESTER_NAME=1)
  target_link_libraries(cypherdj-latenz-mutation-fester-name PRIVATE PkgConfig::JACK)
  add_test(NAME test_latenz_verdrahtung COMMAND ${PW_JACK} $<TARGET_FILE:test_latenz_verdrahtung> $<TARGET_FILE:cypherdj-latenz>)
  add_test(NAME test_latenz_verdrahtung_mutation COMMAND ${PW_JACK} $<TARGET_FILE:test_latenz_verdrahtung> $<TARGET_FILE:cypherdj-latenz-mutation-fester-name>)
  set_tests_properties(test_latenz_verdrahtung test_latenz_verdrahtung_mutation PROPERTIES SKIP_RETURN_CODE 77 TIMEOUT 60)
  set_tests_properties(test_latenz_verdrahtung_mutation PROPERTIES WILL_FAIL TRUE)
  set_tests_properties(test_latenz_verdrahtung test_latenz_verdrahtung_mutation PROPERTIES RESOURCE_LOCK jack_name_cypherdj_latenz)   # beide halten den Clientnamen; nie gleichzeitig (-j4)
endif()
add_test(NAME test_latenz_eintragen COMMAND ${CMAKE_COMMAND} -DMJS=${CMAKE_CURRENT_SOURCE_DIR}/../testbench/input/latency_enter.mjs
         -DDIR=${CMAKE_CURRENT_BINARY_DIR} -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/latenz_eintragen.cmake)
test_mutation(test_take_schreiber_luecke_mutation test_take_writer CYPHERDJ_MUTATION_REC_LUECKE_STILL src/take_writer.cpp)
test_mutation(test_aufnahme_start_mutation test_recording CYPHERDJ_MUTATION_REC_START_BLOCKANFANG)
test_mutation(test_aufnahme_frist_mutation test_recording CYPHERDJ_MUTATION_REC_FRIST_IMMER)          # M1: Frist gilt auch, während das Arrangement wartet
test_mutation(test_aufnahme_sammeln_mutation test_recording CYPHERDJ_MUTATION_REC_OHNE_SAMMELN)       # m4: jeder Teilblock ein Chunk
test_mutation(test_aufnahme_aendern_mutation test_recording CYPHERDJ_MUTATION_REC_AENDERN_NUR_STATUS) # m1: Wechsel schon bei phase 2
test_mutation(test_aufnahme_naht_mutation test_recording CYPHERDJ_MUTATION_REC_NAHT_IGNORIERT)         # Review-Nachzug Teil B: Ende am ersten Loop-Wrap
test_mutation(test_aufnahme_faden_ende_mutation test_recording_thread CYPHERDJ_MUTATION_REC_FADEN_ENDE_FEHLT src/recording_thread.cpp src/take_writer.cpp)
test_mutation(test_aufnahme_faden_leeren_mutation test_recording_thread CYPHERDJ_MUTATION_REC_FADEN_OHNE_LEEREN src/recording_thread.cpp src/take_writer.cpp)   # Review-Nachzug T23: das Leeren in Phase 1
# 1.8 Task 24: Kern-Verdrahtung der Aufnahme (test_core_rec). Jede Mutation ist ein Fehlerfall, an dem der Kern-Test rot werden muss.
test_mutation(test_kern_rec_tap_mutation test_core_rec CYPHERDJ_MUTATION_REC_TAP_NACH_MIXER ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # AK4: der Abgriff nach dem Mixer ist nicht bitgleich
test_mutation(test_kern_rec_start_mutation test_core_rec CYPHERDJ_MUTATION_REC_START_BLOCKANFANG ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # AK5: Start am Blockanfang statt am Einsatz-Sample
test_mutation(test_kern_rec_midi_stempel_mutation test_core_rec CYPHERDJ_MUTATION_MIDI_STEMPEL_BLOCKANFANG ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # 1.8 T7a (AK22): the stamp of a MIDI event is the cycle start, not the offset in the cycle
# 1.8 T7b: live notes of the armed instrument tracks. test_arr_live (module with stand-in sinks) and test_core_live (real core, RB-338 track, PM tap) are the detectors.
test_mutation(test_arr_live_note_mutation test_arr_live CYPHERDJ_MUTATION_LIVE_NOTE_VERWORFEN ${ARR_QUELLEN} src/clock.cpp)   # the live On is never sent
test_mutation(test_arr_live_alle_aus_leer_mutation test_arr_live CYPHERDJ_MUTATION_LIVE_ALLE_AUS_LEER ${ARR_QUELLEN} src/clock.cpp)   # the held keys are not closed: a hanging note
test_mutation(test_arr_live_neue_senke_mutation test_arr_live CYPHERDJ_MUTATION_LIVE_AUS_NEUE_SENKE ${ARR_QUELLEN} src/clock.cpp)   # after a swap the Off goes to the new sink
test_mutation(test_kern_live_disarm_mutation test_core_live CYPHERDJ_MUTATION_LIVE_AUS_BEI_DISARM_FEHLT ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # disarm with a key held: no Off
test_mutation(test_kern_rec_frist_mutation test_core_rec CYPHERDJ_MUTATION_REC_FRIST_IMMER ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)
test_mutation(test_kern_rec_aendern_mutation test_core_rec CYPHERDJ_MUTATION_REC_AENDERN_NUR_STATUS ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)
test_mutation(test_kern_rec_beat_mutation test_core_rec CYPHERDJ_MUTATION_REC_ARR_BEAT_KERN ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)
test_mutation(test_kern_rec_naht_mutation test_core_rec CYPHERDJ_MUTATION_REC_NAHT_IGNORIERT ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # Review-Nachzug Teil B: Ende am ersten Loop-Wrap
test_mutation(test_kern_rec_rampe_mutation test_core_rec CYPHERDJ_MUTATION_REC_RAMPE_ERLAUBT ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # 1.8 T9 (AK26): a tempo ramp is accepted during a recording

# Paket 1.13 Warp, Slice 2 (AK15): die Freigabe eines abgelösten Schnappschusses ohne die Frage an das Werk (WarpWerk::liest) muss den Lebensdauer-Test
# zum Absturz bringen (WILL_FAIL; das Audio liegt in Seiten, die nach der Freigabe PROT_NONE sind)
if(CYPHERDJ_BUNGEE)
  add_executable(test_warp_werk_lebensdauer_freigabe_mutation tests/test_warp_factory_lifetime.cpp)
  target_include_directories(test_warp_werk_lebensdauer_freigabe_mutation PRIVATE tests)
  target_compile_definitions(test_warp_werk_lebensdauer_freigabe_mutation PRIVATE CYPHERDJ_MUTATION_WARP_FREIGABE_OHNE_QUITTUNG=1)
  target_link_libraries(test_warp_werk_lebensdauer_freigabe_mutation PRIVATE cypherdj_kernbib)
  add_test(NAME test_warp_werk_lebensdauer_freigabe_mutation COMMAND test_warp_werk_lebensdauer_freigabe_mutation)
  set_tests_properties(test_warp_werk_lebensdauer_freigabe_mutation PROPERTIES WILL_FAIL TRUE)
  # die Regel selbst, im Werk mutiert: liest() fragt die Stimmen nicht (Fall 1b), das Audio wird erst nach dem Übernehmen angemeldet (Fall 1)
  foreach(m LIEST_OHNE_STIMME HALTE_NACH_GELESEN)
    string(TOLOWER ${m} mk)
    test_mutation(test_warp_werk_lebensdauer_${mk}_mutation test_warp_factory_lifetime CYPHERDJ_MUTATION_WARP_${m} src/warp_factory.cpp src/warp_factory_bungee.cpp src/clock.cpp cypherdj::bungee)
  endforeach()
endif()

# S18 task 2: recording taps and /pegel for erz/5..7, pad/1..2. Each mutation is a failure case the core tests must turn red on.
test_mutation(test_kern_rec_pad_vertauscht_mutation test_core_rec CYPHERDJ_MUTATION_REC_PAD_VERTAUSCHT ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # pad/1 and pad/2 swapped: the empty box 2 is recorded as pad/1
test_mutation(test_kern_rec_erz6_als_5_mutation test_core_rec CYPHERDJ_MUTATION_REC_ERZ6_ALS_5 ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # erz/6 reads the tap of erz/5: not bit identical
test_mutation(test_kern_pegel_ohne_erz567_mutation test_core_level CYPHERDJ_MUTATION_PEGEL_OHNE_ERZ567 ${KERN_QUELLEN35})   # the old /pegel channel set

# Baukasten S20 task 3: faults of the graph store for project tracks (WILL_FAIL). The mutated arr_playback.cpp is linked before the
# library, so it replaces the library's copy.
function(bk_lader_mutation name schalter)
  add_executable(${name} tests/test_arr_bk_loader.cpp src/arr_playback.cpp)
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

# Package 1.9 U1a: faults of the kit store for kit tracks (WILL_FAIL). Same shape as bk_lader_mutation: the mutated arr_playback.cpp is linked
# before the library, so it replaces the library's copy. The ctest names are counted by U1a T1.4 (ctest -N | grep -c _mutation).
function(kit_lader_mutation name schalter)
  add_executable(${name} tests/test_arr_kit_loader.cpp src/arr_playback.cpp)
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
test_mutation(test_arr_wiedergabe_kit_name_mutation test_arr_playback CYPHERDJ_MUTATION_ARR_KIT_NAME_UNGEPRUEFT src/arr_playback.cpp)   # kit name not checked by the parser: the bad-name refusal text
# the mutated arr_loader.cpp is linked before the library (own object, like test_arr_lader_werk_mutation): without the kit_nachholen call case 10 goes red
add_executable(test_arr_kit_lader_nachholen_mutation tests/test_arr_kit_loader.cpp src/arr_loader.cpp)
target_include_directories(test_arr_kit_lader_nachholen_mutation PRIVATE include tests)
target_compile_definitions(test_arr_kit_lader_nachholen_mutation PRIVATE CYPHERDJ_MUTATION_ARR_KIT_OHNE_NACHHOLEN=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_arr_kit_lader_nachholen_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
add_test(NAME test_arr_kit_lader_nachholen_mutation COMMAND test_arr_kit_lader_nachholen_mutation)
set_tests_properties(test_arr_kit_lader_nachholen_mutation PROPERTIES WILL_FAIL TRUE)

# Baukasten S20 task 4: faults of the Baukasten sink and the device dispatch of the internal tracks (WILL_FAIL)
foreach(m VERSATZ_NULL OHNE_ZURUECKSETZEN REGLER_NUR_START WECHSEL_HART OHNE_AKTIV)
  string(TOLOWER ${m} mk)
  test_mutation(test_arr_bk_senke_${mk}_mutation test_arr_bk_sink CYPHERDJ_MUTATION_ARR_BK_${m} ${ARR_QUELLEN} src/clock.cpp)
endforeach()
# Package 1.9 U1b T1.5: faults of the kit sink (WILL_FAIL): onset at the block start (a), youngest voice stolen (c), start without clearing (d), nutzt blind to the fade (f2)
foreach(m BLOCKANFANG RAUB_JUENGSTE START_OHNE_LEEREN NUTZT_FALSCH)
  string(TOLOWER ${m} mk)
  test_mutation(test_arr_kit_senke_${mk}_mutation test_arr_kit_sink CYPHERDJ_MUTATION_ARR_KIT_${m} ${ARR_QUELLEN} src/kit.cpp src/clock.cpp)   # kit.cpp: the test loads kit_impuls with lade_kit
endforeach()
# Package 1.9 U6 T6.1: member slots in the sinks (WILL_FAIL): the sinks sized to the 32 track slots refuse a member slot
test_mutation(test_arr_glied_plaetze_nur_spuren_mutation test_arr_stage_slots CYPHERDJ_MUTATION_ARR_PLAETZE_NUR_SPUREN ${ARR_QUELLEN} src/clock.cpp)
# Package 1.9 U6 T6.2: faults of the rack parser (WILL_FAIL): a zone taken as it is (inverted, out of range), a Surge slot used twice
test_mutation(test_arr_rack_wiedergabe_zone_mutation test_arr_rack_playback CYPHERDJ_MUTATION_ARR_RACK_ZONE_UNGEPRUEFT src/arr_playback.cpp)
test_mutation(test_arr_rack_wiedergabe_slot_mutation test_arr_rack_playback CYPHERDJ_MUTATION_ARR_RACK_SLOT_DOPPELT src/arr_playback.cpp)
# Package 1.9 U6 T6.3: faults of the rack sink (WILL_FAIL): an exclusive upper key bound (R1), a note off to every member (R4), a gain step instead of
# the ramp (R5), no Wirt lead (R6), a member that leaves with a held note (R7: the note off is not sent; R10 the offs come after the new owner; R8 the held keys are taken from the queue state; R9 a Surge member with a new member slot loses its notes),
# R12 a moved member whose old slot is unowned loses its queued note on, R13 a leaving kit member gets no all-off (its one-shots ring on) or every member gets one (the stayer is cut), R14 the snapshot is told by its address
foreach(m ZONE_EXKLUSIV OFF_AN_ALLE GAIN_SPRUNG OHNE_VORHALT ABGANG_OHNE_OFF ABGANG_NACH_NEU ABGANG_NACH_KLINGT SURGE_OHNE_UEBERNAHME ABGANG_UMZUG_NUR_BESETZT ABGANG_KIT_NUR_OFFS ABGANG_AUS_FUER_ALLE SNAP_ZEIGER)
  string(TOLOWER ${m} mk)
  test_mutation(test_arr_rack_senke_${mk}_mutation test_arr_rack_sink CYPHERDJ_MUTATION_ARR_RACK_${m} ${ARR_QUELLEN} src/clock.cpp)
endforeach()
test_mutation(test_arr_intern_senke_ohne_wechsel_mutation test_arr_intern_sink CYPHERDJ_MUTATION_ARR_INTERN_OHNE_WECHSEL ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_intern_senke_rb_rueckkehr_mutation test_arr_intern_sink CYPHERDJ_MUTATION_ARR_RB_BK_ALS_RUECKKEHR ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_intern_senke_ohne_auto_mutation test_arr_intern_sink CYPHERDJ_MUTATION_ARR_INTERN_OHNE_AUTO ${ARR_QUELLEN} src/clock.cpp)   # 1.12 S2: device lane values must pass the dispatcher
# 1.12 slice 7: lanes on the Baukasten knobs (test_arr_auto_bk_button): the dispatcher drops the lane values (B1 to B4), the bk sink drops the summand (B4)
test_mutation(test_arr_auto_bk_knopf_ohne_auto_mutation test_arr_auto_bk_button CYPHERDJ_MUTATION_ARR_INTERN_OHNE_AUTO ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_auto_bk_knopf_ohne_summand_mutation test_arr_auto_bk_button CYPHERDJ_MUTATION_ARR_BK_OHNE_SUMMAND ${ARR_QUELLEN} src/clock.cpp)
# mehrkern slice 3 task 6b (WILL_FAIL): the rack lane unit renders its members into the sink's own scratch (test_arr_rack_path case 2), the Kit mixes into its own buffers
# (cases 2, 5), the cleanliness scan says true (cases 3 and 7), the plan check sits after each rest track again (case 8: a clean rack stays in the remainder)
test_mutation(spur_rack_scratch_gemeinsam_mutation test_arr_rack_path CYPHERDJ_MUTATION_SPUR_RACK_SCRATCH_GEMEINSAM ${ARR_QUELLEN} src/clock.cpp)
test_mutation(spur_kit_puf_gemeinsam_mutation test_arr_rack_path CYPHERDJ_MUTATION_SPUR_KIT_PUF_GEMEINSAM ${ARR_QUELLEN} src/clock.cpp)
test_mutation(spur_rack_ohne_sauber_mutation test_arr_rack_path CYPHERDJ_MUTATION_SPUR_RACK_OHNE_SAUBER ${ARR_QUELLEN} src/clock.cpp)
test_mutation(spur_rack_rest_einzeln_mutation test_arr_rack_path CYPHERDJ_MUTATION_SPUR_RACK_REST_EINZELN ${ARR_QUELLEN} src/clock.cpp)
test_mutation(spur_rack_weg_queue_bleibt_mutation test_arr_rack_path CYPHERDJ_MUTATION_SPUR_RACK_WEG_QUEUE_BLEIBT ${ARR_QUELLEN} src/clock.cpp)
test_mutation(spur_rack_abgang_in_bahn_mutation test_arr_rack_path CYPHERDJ_MUTATION_SPUR_RACK_ABGANG_IN_BAHN ${ARR_QUELLEN} src/clock.cpp)
# Two mutations only the race detector sees (TSan build only, run through setarch like the other TSan programs; the gate passes when TSan reports the race): the
# cleanliness scan of the rack sink in the serial remainder that overlaps the workers, and the Kit counters as plain integers. Named *_tsan_gate: they are not in the
# Release build, so they stay out of the count of ^spur_.*_mutation$.
if(CYPHERDJ_TSAN AND EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_arr_rack_path.cpp)
  function(rack_tsan_gate name schalter)   # further arguments: the command line of the test program (a case number)
    kern_mut_exe(${name} QUELLEN tests/test_arr_rack_path.cpp ${ARR_QUELLEN} src/clock.cpp SCHALTER ${schalter} DEFS CYPHERDJ_DJK="${DJK}"
                 INCLUDES include tests ${DJK}/contract
                 LIBS PkgConfig::JACK Threads::Threads cypherdj::dsp cypherdj::stellwerk cypherdj_dsp_messer cypherdj::json PkgConfig::CRYPTO cypherdj::hand)
    add_test(NAME ${name} COMMAND ${TSAN_START} $<TARGET_FILE:${name}> ${ARGN})
    set_tests_properties(${name} PROPERTIES PASS_REGULAR_EXPRESSION "ThreadSanitizer: reported [1-9][0-9]* warnings")
  endfunction()
  rack_tsan_gate(spur_rack_sauber_im_rest_tsan_gate CYPHERDJ_MUTATION_SPUR_RACK_SAUBER_IM_REST)
  # case 14 alone (a leaver's queued note off outlives its record, a second swap gives the slot to another rack): without the cleanliness scan a worker's rack unit
  # delivers the stale note off into the RB slot another rack's unit plays (ArrRbSenke::note) and TSan reports it; the same program without the mutation runs the case clean
  rack_tsan_gate(spur_rack_ohne_sauber_tsan_gate CYPHERDJ_MUTATION_SPUR_RACK_OHNE_SAUBER 14)
  # case 13 alone (a clean swap with the racks in lane units): abgaenge() of the new snapshot runs inside a lane unit and reads/writes what the other lanes use
  rack_tsan_gate(spur_rack_abgang_in_bahn_tsan_gate CYPHERDJ_MUTATION_SPUR_RACK_ABGANG_IN_BAHN 13)
  rack_tsan_gate(spur_rack_zaehler_plain_tsan_gate CYPHERDJ_MUTATION_SPUR_RACK_ZAEHLER_PLAIN)
endif()
# mehrkern slice 3.1 task 1: the RB scratch ignores the lane (WILL_FAIL), must turn test_arr_track_path case 2 red
test_mutation(spur_scratch_gemeinsam_mutation test_arr_track_path CYPHERDJ_MUTATION_SPUR_SCRATCH_GEMEINSAM ${ARR_QUELLEN} src/clock.cpp)
# mehrkern slice 3.1 task 2 (WILL_FAIL): the dry scratch / the PDC scratch ignore the lane (test_arr_inserts_path case 2), kette_bahn writes besitzer_ during the fork (case 4)
test_mutation(spur_dry_gemeinsam_mutation test_arr_inserts_path CYPHERDJ_MUTATION_SPUR_DRY_GEMEINSAM ${ARR_QUELLEN} src/clock.cpp)
test_mutation(spur_pdc_gemeinsam_mutation test_arr_inserts_path CYPHERDJ_MUTATION_SPUR_PDC_GEMEINSAM ${ARR_QUELLEN} src/clock.cpp)
test_mutation(spur_besitzer_gemeinsam_mutation test_arr_inserts_path CYPHERDJ_MUTATION_SPUR_BESITZER_GEMEINSAM ${ARR_QUELLEN} src/clock.cpp)
# kette_bahn reads the shared besitzer_ instead of its mirror entry (case 4, serial poison probe)
test_mutation(spur_besitzer_gelesen_mutation test_arr_inserts_path CYPHERDJ_MUTATION_SPUR_BESITZER_GELESEN ${ARR_QUELLEN} src/clock.cpp)
# mehrkern slice 3.1 task 3 (WILL_FAIL): the plan leaves one track out of every list (test_arr_track_phase cases 1 and 3)
test_mutation(spur_plan_laesst_spur_aus_mutation test_arr_track_phase CYPHERDJ_MUTATION_SPUR_PLAN_LAESST_SPUR_AUS ${ARR_QUELLEN} src/clock.cpp)
# a setter leaves the plan-valid flag set (case 5)
test_mutation(spur_flag_bleibt_mutation test_arr_track_phase CYPHERDJ_MUTATION_SPUR_FLAG_BLEIBT ${ARR_QUELLEN} src/clock.cpp)
# mehrkern slice 3.2 task 4 (WILL_FAIL): the SPUR take-back counts late unconditionally (test_reverb_pool case 9), a SPUR late event is also counted in the HALL window (case 8), warte never reports a missed limit (case 13)
test_mutation(spur_zurueck_zaehlt_spaet_mutation test_reverb_pool CYPHERDJ_MUTATION_SPUR_ZUERUECK_ZAEHLT_SPAET src/reverb_pool.cpp)
test_mutation(spur_konto_geteilt_mutation test_reverb_pool CYPHERDJ_MUTATION_SPUR_KONTO_GETEILT src/reverb_pool.cpp)
test_mutation(spur_grenze_blind_mutation test_reverb_pool CYPHERDJ_MUTATION_SPUR_GRENZE_BLIND src/reverb_pool.cpp)
# mehrkern slice 3.2 task 5 (WILL_FAIL): every worker passes lane 1 (test_arr_track_pool case 1, the per-lane unit count), and the caller's MXCSR is not handed to the workers (case 3)
set(TM_FALL 1)  # detector case
test_mutation(spur_alle_bahn_1_mutation test_arr_track_pool CYPHERDJ_MUTATION_SPUR_ALLE_BAHN_1 ${ARR_QUELLEN} src/clock.cpp)
unset(TM_FALL)
set(TM_FALL 3)  # detector case
test_mutation(spur_ohne_mxcsr_mutation test_arr_track_pool CYPHERDJ_MUTATION_SPUR_OHNE_MXCSR ${ARR_QUELLEN} src/clock.cpp)
unset(TM_FALL)
# mehrkern slice 3.2 task 5 fix (WILL_FAIL): every lane writes the set log ring 0 (case 1: the log of the first block no longer fits; the TSan build reports the shared slot)
set(TM_FALL 1)  # detector case
test_mutation(spur_protokoll_gemeinsam_mutation test_arr_track_pool CYPHERDJ_MUTATION_SPUR_PROTOKOLL_GEMEINSAM ${ARR_QUELLEN} src/clock.cpp)
unset(TM_FALL)
# mehrkern slice 3.2 task 6 (WILL_FAIL): the caller does not wait for started jobs (test_arr_track_pool case 11: the held unit is not done when the block returns)
set(TM_FALL 11)  # detector case
test_mutation(spur_ohne_join_mutation test_arr_track_pool CYPHERDJ_MUTATION_SPUR_OHNE_JOIN ${ARR_QUELLEN} src/clock.cpp)
unset(TM_FALL)
# mode auto retries after every switch-off (case 19)
set(TM_FALL 19)  # detector case
test_mutation(spur_auto_immer_neu_mutation test_arr_track_pool CYPHERDJ_MUTATION_SPUR_AUTO_IMMER_NEU ${ARR_QUELLEN} src/clock.cpp)
unset(TM_FALL)
# mehrkern 3.2 review of task 5 (WILL_FAIL): the live-load criterion by mixer gain (case 20, muted tracks); the Hall call site hands no MXCSR to the workers (test_arr_returns returns_pool_mxcsr)
set(TM_FALL 20)  # detector case
test_mutation(spur_live_nach_gain_mutation test_arr_track_pool CYPHERDJ_MUTATION_SPUR_LIVE_NACH_GAIN ${ARR_QUELLEN} src/clock.cpp)
unset(TM_FALL)
test_mutation(spur_hall_ohne_mxcsr_mutation test_arr_returns CYPHERDJ_MUTATION_HALL_OHNE_MXCSR ${ARR_QUELLEN} src/clock.cpp)
# mehrkern 3.2 review of task 6 (WILL_FAIL): the hard limit is measured from the entry into laufen() instead of the cycle start (case 21), the join wait from the entry instead of the join (case 22)
set(TM_FALL 21)  # detector case
test_mutation(spur_grenze_ab_lauf_mutation test_arr_track_pool CYPHERDJ_MUTATION_SPUR_GRENZE_AB_LAUF ${ARR_QUELLEN} src/clock.cpp)
unset(TM_FALL)
set(TM_FALL 22)  # detector case
test_mutation(spur_warte_ab_lauf_mutation test_arr_track_pool CYPHERDJ_MUTATION_SPUR_WARTE_AB_LAUF ${ARR_QUELLEN} src/clock.cpp)
unset(TM_FALL)
test_mutation(test_kern_arr_bk_mutation test_core_arr_bk CYPHERDJ_MUTATION_ARR_OHNE_RB_SENKE ${KERN_QUELLEN35} src/arr_playback.cpp)

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

# 1.8 S0: /zustand/rec carries ausgang_vorhalt and quantum. One mutation per layer: the Ereignis (Kern::rec_zustand_melden, seen by test_core_rec)
# and the wire writer (net.cpp, seen by the writer case of test_net_rec_input).
test_mutation(test_kern_rec_vorhalt_mutation test_core_rec CYPHERDJ_MUTATION_REC_VORHALT_NULL ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)
# 1.8 T2: the output delay of the report includes the delay compensation of the playback (test_core_rec, case with an EQ insert)
test_mutation(test_kern_rec_vorhalt_ohne_pdc_mutation test_core_rec CYPHERDJ_MUTATION_REC_VORHALT_OHNE_PDC ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)
add_executable(test_netz_rec_zustand_mutation tests/test_net_rec_input.cpp ${KERN_QUELLEN})
target_include_directories(test_netz_rec_zustand_mutation PRIVATE include tests ${DJK}/contract)
target_compile_definitions(test_netz_rec_zustand_mutation PRIVATE CYPHERDJ_MUTATION_REC_ZUSTAND_FELD_NULL=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_rec_zustand_mutation PRIVATE PkgConfig::JACK Threads::Threads cypherdj::toml cypherdj::dsp cypherdj::stellwerk
                      cypherdj_dsp_messer cypherdj::json PkgConfig::CRYPTO cypherdj::hand PkgConfig::RUBBERBAND)
add_test(NAME test_netz_rec_zustand_mutation COMMAND test_netz_rec_zustand_mutation)
set_tests_properties(test_netz_rec_zustand_mutation PROPERTIES WILL_FAIL TRUE)

# 1.8 S2a: external inputs as taps. One mutation per layer; every one must turn its test red (WILL_FAIL).
test_mutation(test_aufnahme_summe_mutation test_recording CYPHERDJ_MUTATION_REC_SUMME_OHNE_HALB)   # D14: the sum mode without the 0.5
test_mutation(test_aufnahme_nachlauf_mutation test_recording CYPHERDJ_MUTATION_REC_NAHT_OHNE_NACHLAUF)   # D10: the seam ends the take without the tail
test_mutation(test_kern_rec_nachlauf_mutation test_core_rec CYPHERDJ_MUTATION_REC_NAHT_OHNE_NACHLAUF ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # D10 end to end: an external track past a real seam keeps the tail
test_mutation(test_kern_rec_ein_paar_mutation test_core_rec CYPHERDJ_MUTATION_REC_EIN_PAAR_VERSETZT ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # pair k reads pair k + 1
test_mutation(test_kern_rec_alloc_mutation test_core_rec_alloc CYPHERDJ_MUTATION_REC_ALLOC_IM_BLOCK ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)   # positive control of the allocation guard
add_executable(test_netz_rec_modus_mutation tests/test_net_rec_input.cpp ${KERN_QUELLEN})   # the net thread does not store the channel mode in the RecSpur
target_include_directories(test_netz_rec_modus_mutation PRIVATE include tests ${DJK}/contract)
target_compile_definitions(test_netz_rec_modus_mutation PRIVATE CYPHERDJ_MUTATION_REC_MODUS_NICHT_GESPEICHERT=1 CYPHERDJ_DJK="${DJK}")
target_link_libraries(test_netz_rec_modus_mutation PRIVATE PkgConfig::JACK Threads::Threads cypherdj::toml cypherdj::dsp cypherdj::stellwerk
                      cypherdj_dsp_messer cypherdj::json PkgConfig::CRYPTO cypherdj::hand PkgConfig::RUBBERBAND)
add_test(NAME test_netz_rec_modus_mutation COMMAND test_netz_rec_modus_mutation)
set_tests_properties(test_netz_rec_modus_mutation PROPERTIES WILL_FAIL TRUE)

# 1.8 S3.1 (D12): the monitor of an armed track changes in place in the callback. Without the in-place branch the change while recording is refused (aufnahme_laeuft).
test_mutation(test_kern_rec_monitor_mutation test_core_rec CYPHERDJ_MUTATION_REC_MONITOR_NICHT_VOR_ORT ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)

# 1.8 S3.2 (AK15): auto behaves like ein -> the case "a clip of the track plays back" must turn red.
test_mutation(test_arr_monitor_auto_mutation test_arr_monitor CYPHERDJ_MUTATION_MONITOR_AUTO_IST_EIN ${ARR_QUELLEN} src/clock.cpp)
# 1.8 T1 (slice 3b-lite): the monitor in front of the insert chain and the PDC delay (the old position) -> the impulse cases 8 and 9 turn red.
test_mutation(test_arr_monitor_vor_kette_mutation test_arr_monitor CYPHERDJ_MUTATION_MONITOR_VOR_KETTE ${ARR_QUELLEN} src/clock.cpp)
# 1.8 T1: the monitor after the fader loop (gain, pan and mute ignored) -> case 10 turns red.
test_mutation(test_arr_monitor_nach_fader_mutation test_arr_monitor CYPHERDJ_MUTATION_MONITOR_NACH_FADER ${ARR_QUELLEN} src/clock.cpp)
# 1.8 S3.4: positive control of the allocation guard for the monitor path: a new/delete pair in monitor_addieren must turn test_core_rec_alloc red.
test_mutation(test_kern_rec_alloc_monitor_mutation test_core_rec_alloc CYPHERDJ_MUTATION_MONITOR_ALLOC ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)

# 1.8 S4a.1: golden table of Arrangement::start (2000 seeded starts). The work-clip case must be in the table: without the work's grace period the table turns red.
test_mutation(test_arr_start_golden_werk_mutation test_arr_start_golden CYPHERDJ_MUTATION_ARR_WARP_WERK_START_OHNE_FRIST ${ARR_QUELLEN} src/clock.cpp)
# 1.8 S4a.1: one count-in beat also when 0 is passed: the golden table and the count-in case of test_arr_transport must turn red.
test_mutation(test_arr_start_golden_vorzaehl_mutation test_arr_start_golden CYPHERDJ_MUTATION_VORZAEHL_IMMER_EINS ${ARR_QUELLEN} src/clock.cpp)
test_mutation(test_arr_transport_vorzaehl_mutation test_arr_transport CYPHERDJ_MUTATION_VORZAEHL_IMMER_EINS ${ARR_QUELLEN} src/clock.cpp)
# 1.8 S4a.2: the count-in follows the metronome switch -> the case "switch off, 4N clicks" must turn red.
test_mutation(test_arr_metronom_vorzaehler_mutation test_arr_metronom CYPHERDJ_MUTATION_VORZAEHLER_NUR_MIT_SCHALTER ${ARR_QUELLEN} src/clock.cpp)
# 1.8 S4a.3 (D8): a take inside a running transport begins on the bar, not at the block start; a seam on the start sample does not end it.
test_mutation(test_aufnahme_laufend_mutation test_recording CYPHERDJ_MUTATION_REC_LAUFEND_BLOCKANFANG)
test_mutation(test_aufnahme_naht_gleich_mutation test_recording CYPHERDJ_MUTATION_REC_NAHT_GLEICH_BEENDET)
# 1.8 S4a.3 end to end (test_core_rec, block "D8"): the take of a running transport begins on the bar, never at the block start, never at once, and not ended by its own seam.
test_mutation(test_kern_rec_laufend_mutation test_core_rec CYPHERDJ_MUTATION_REC_LAUFEND_BLOCKANFANG ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)
test_mutation(test_kern_rec_laufend_sofort_mutation test_core_rec CYPHERDJ_MUTATION_REC_LAUFEND_SOFORT ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)
test_mutation(test_kern_rec_naht_gleich_mutation test_core_rec CYPHERDJ_MUTATION_REC_NAHT_GLEICH_BEENDET ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)
# 1.8 S4a.4: the count-in of a recording reaches the transport start (status 1, four clicks, take at the entry).
test_mutation(test_kern_rec_vorzaehler_mutation test_core_rec CYPHERDJ_MUTATION_REC_VORZAEHLER_NICHT_GEREICHT ${KERN_QUELLEN35} src/recording_thread.cpp src/take_writer.cpp src/arr_playback.cpp)
# Public probe build 2026-11-07: tests that start click_rendition.py read the interpreter from CYPHERDJ_PYTHON3, the one
# CMake found above (venv on a fresh machine, /usr/bin/python3 here), instead of a fixed /usr/bin/python3.
get_property(cdj_alle_tests DIRECTORY PROPERTY TESTS)
set_property(TEST ${cdj_alle_tests} APPEND PROPERTY ENVIRONMENT "CYPHERDJ_PYTHON3=${Python3_EXECUTABLE}")

# 1.8 T3: the two key properties of the RecSpur handoff, proved by the one program that runs the three threads (tests/test_recording_tsan.cpp).
#  - REC_PUBLIKATION_SCHWACH (TSan build): the net thread completes the RecSpur (modus) only after the pointer went through the command queue, so the callback reads
#    it without an order; TSan must report the race. Run through setarch like the other TSan programs; the gate passes when TSan reports.
#  - REC_ALT_NICHT_ZURUECK (ASan build): the callback does not hand the unused or replaced RecSpur back, the net thread never frees it; LeakSanitizer must report it.
function(aufnahme_handoff_gate name schalter)
  kern_mut_exe(${name} QUELLEN tests/test_recording_tsan.cpp ${KERN_QUELLEN} SCHALTER ${schalter} DEFS CYPHERDJ_DJK="${DJK}"
               INCLUDES include tests ${DJK}/contract LIBS ${KERN_MUT_LIBS})
endfunction()
if(CYPHERDJ_TSAN)
  aufnahme_handoff_gate(aufnahme_publikation_schwach_tsan_gate CYPHERDJ_MUTATION_REC_PUBLIKATION_SCHWACH)
  add_test(NAME aufnahme_publikation_schwach_tsan_gate COMMAND ${TSAN_START} $<TARGET_FILE:aufnahme_publikation_schwach_tsan_gate>)
  set_tests_properties(aufnahme_publikation_schwach_tsan_gate PROPERTIES PASS_REGULAR_EXPRESSION "ThreadSanitizer: reported [1-9][0-9]* warnings")
endif()
if(CYPHERDJ_SANITIZE)
  aufnahme_handoff_gate(aufnahme_alt_nicht_zurueck_asan_gate CYPHERDJ_MUTATION_REC_ALT_NICHT_ZURUECK)
  add_test(NAME aufnahme_alt_nicht_zurueck_asan_gate COMMAND aufnahme_alt_nicht_zurueck_asan_gate)
  set_tests_properties(aufnahme_alt_nicht_zurueck_asan_gate PROPERTIES PASS_REGULAR_EXPRESSION "LeakSanitizer")
endif()
# plan 1.11 T12: the real-time export of the production master (test_arr_export_run, collected automatically; under CYPHERDJ_TSAN it runs with setarch -R: the callback thread against the
# writer thread). Each file as its own mutated object before the library. HOST_EXPORT_OHNE_VERSATZ (arr_export_run.cpp): the window is not shifted by the path latency, the clicks of
# case 2 are late by 600. HOST_RENDER_OHNE_PRUEFUNG (render.cpp): the offline render takes a host stage that is on, case 4 goes red.
foreach(m HOST_EXPORT_OHNE_VERSATZ:arr_export_run HOST_RENDER_OHNE_PRUEFUNG:render)
  string(REPLACE ":" ";" mq ${m})
  list(GET mq 0 schalter)
  list(GET mq 1 quelle)
  string(TOLOWER ${schalter} klein)
  add_executable(test_arr_export_lauf_${klein}_mutation tests/test_arr_export_run.cpp src/${quelle}.cpp)
  target_include_directories(test_arr_export_lauf_${klein}_mutation PRIVATE include tests)
  target_compile_definitions(test_arr_export_lauf_${klein}_mutation PRIVATE CYPHERDJ_MUTATION_${schalter}=1 CYPHERDJ_DJK="${DJK}")
  target_link_libraries(test_arr_export_lauf_${klein}_mutation PRIVATE cypherdj_kernbib cypherdj::json cypherdj::toml)
  add_test(NAME test_arr_export_lauf_${klein}_mutation COMMAND test_arr_export_lauf_${klein}_mutation)
  set_tests_properties(test_arr_export_lauf_${klein}_mutation PROPERTIES WILL_FAIL TRUE)
endforeach()
# 1.10 slice 7 (T5): the real-time tap /k/arr/abgriff (test_arr_tap). Each mutation turns its named cases red.
test_mutation(test_arr_abgriff_vor_fader_mutation test_arr_tap CYPHERDJ_MUTATION_ABGRIFF_VOR_FADER ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)       # cases 3 (group post level) and 4 (track pre/post): the post is taken in front of the fader
test_mutation(test_arr_abgriff_nachlauf_mutation test_arr_tap CYPHERDJ_MUTATION_ABGRIFF_NACHLAUF ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp)         # case 1 (frames): the freeze tail is added to the length
test_mutation(test_arr_abgriff_ohne_ankunft_mutation test_arr_tap CYPHERDJ_MUTATION_ABGRIFF_OHNE_ANKUNFT ${ARR_QUELLEN} src/arr_playback.cpp src/clock.cpp) # case 5 (ankunft): the window is not shifted by the path latency
