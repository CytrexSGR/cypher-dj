# cypherdj_dsp: Kanalzug-DSP als Bibliothek (Scheibe 04). Baut und testet allein:
#   cmake -S djk/kern/dsp -B djk/kern/dsp/build -G Ninja && ninja -C djk/kern/dsp/build && (cd djk/kern/dsp/build && ctest)
# Strang A bindet sie mit add_subdirectory ein und linkt cypherdj::dsp (Tests nur, wenn allein gebaut).
cmake_minimum_required(VERSION 3.25)
project(cypherdj_dsp VERSION 1.0 LANGUAGES CXX)

if(PROJECT_IS_TOP_LEVEL AND NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

option(CYPHERDJ_DSP_TESTS "Tests und Werkzeuge bauen" ${PROJECT_IS_TOP_LEVEL})
option(CYPHERDJ_DSP_SANITIZE "ASan und UBSan für Bibliothek und Tests" OFF)

# Jede Quelldatei unter src/ gehört zur Bibliothek (die Tasks legen sie nach und nach an).
file(GLOB DSP_QUELLEN CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp)

function(dsp_bibliothek name)
  add_library(${name} STATIC ${DSP_QUELLEN})
  target_include_directories(${name} PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
  target_compile_features(${name} PUBLIC cxx_std_20)
  target_compile_options(${name} PRIVATE -Wall -Wextra -Wpedantic -Werror)
  if(CYPHERDJ_DSP_SANITIZE)
    target_compile_options(${name} PUBLIC -fsanitize=address,undefined -fno-sanitize-recover=undefined -fno-omit-frame-pointer)
    target_link_options(${name} PUBLIC -fsanitize=address,undefined)
  endif()
endfunction()

dsp_bibliothek(cypherdj_dsp)
add_library(cypherdj::dsp ALIAS cypherdj_dsp)

# Scheibe 14: Messer, Analyse-Bänder, Master-Limiter (vor jedem return(), damit Strang A sie mitbekommt)
add_subdirectory(messer)

if(NOT CYPHERDJ_DSP_TESTS)
  return()
endif()

enable_testing()
# Das python3 aus dem PATH (System, mit numpy) vorgeben: seit 2026-10-03 liegt ein uv-Python 3.11 ohne numpy in
# ~/.local/bin, FindPython nahm es dort als ersten Treffer, und die Python-Tests brachen am Import ab (2026-10-11).
if(NOT DEFINED Python3_EXECUTABLE)
  find_program(CYPHERDJ_PYTHON3 NAMES python3)
  if(CYPHERDJ_PYTHON3)
    set(Python3_EXECUTABLE ${CYPHERDJ_PYTHON3})
  endif()
endif()
find_package(Python3 REQUIRED COMPONENTS Interpreter)

function(dsp_test name)
  add_executable(${name} tests/${name}.cpp ${ARGN})
  target_link_libraries(${name} PRIVATE cypherdj_dsp)
  target_compile_options(${name} PRIVATE -Wall -Wextra)
  add_test(NAME ${name} COMMAND ${name})
endfunction()

# --- Task 1: Werte und Regler ---
dsp_test(test_werte)
dsp_test(test_regler)

# --- Task 2: Reglertabelle gegen den Vertragstext ---
add_executable(regler_liste werkzeuge/regler_liste.cpp)
target_link_libraries(regler_liste PRIVATE cypherdj_dsp)
add_test(NAME regler_gegen_vertrag
         COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/regler_gegen_vertrag.py
                 $<TARGET_FILE:regler_liste> ${CMAKE_CURRENT_SOURCE_DIR}/../../../docs/architecture/INTERFACES.md)

# --- Task 3: Bahnen ---
dsp_test(test_bahn)

# --- Task 4: LR8-Isolator ---
dsp_test(test_isolator)

# --- Task 5: DJ-Filter ---
dsp_test(test_djfilter)
dsp_test(test_colorfx)

# --- Nachtrag 04 (A27 Weg a): Filter-Güte als Konfig-Wert, mit Mutationsbau „Güte fest“ ---
dsp_test(test_djfilter_guete)
dsp_bibliothek(cypherdj_dsp_mut_guete_fest)
target_compile_definitions(cypherdj_dsp_mut_guete_fest PRIVATE CYPHERDJ_DSP_MUTATION_GUETE_FEST)
add_executable(test_djfilter_guete_mut tests/test_djfilter_guete.cpp)
target_link_libraries(test_djfilter_guete_mut PRIVATE cypherdj_dsp_mut_guete_fest)
add_test(NAME test_djfilter_guete_mutation COMMAND test_djfilter_guete_mut 1)
# Mutationsbau „ohne Cache-Invalidierung“: setze_guete verwirft den Koeffizienten-Cache nicht (Befund 1)
dsp_bibliothek(cypherdj_dsp_mut_ohne_cache)
target_compile_definitions(cypherdj_dsp_mut_ohne_cache PRIVATE CYPHERDJ_DSP_MUTATION_OHNE_CACHE_INVALIDIERUNG)
add_executable(test_djfilter_guete_mut_cache tests/test_djfilter_guete.cpp)
target_link_libraries(test_djfilter_guete_mut_cache PRIVATE cypherdj_dsp_mut_ohne_cache)
add_test(NAME test_djfilter_guete_mutation_cache COMMAND test_djfilter_guete_mut_cache 1)

# --- Task 6: Kanalzug ---
dsp_test(test_kanalzug)

# --- Ohr Task 16: Kanalzug vor/nach dem Abgriff teilen (additiv), beide Wege bitgleich ---
dsp_test(test_kanalzug_teilung)

# --- Task 7: Denormal-Schutz, mit Mutationsbau ohne FTZ ---
dsp_test(test_denormal)
dsp_bibliothek(cypherdj_dsp_mut_ohne_ftz)
target_compile_definitions(cypherdj_dsp_mut_ohne_ftz PRIVATE CYPHERDJ_DSP_MUTATION_OHNE_FTZ)
add_executable(test_denormal_mut tests/test_denormal.cpp)
target_link_libraries(test_denormal_mut PRIVATE cypherdj_dsp_mut_ohne_ftz)
add_test(NAME test_denormal_mutation COMMAND test_denormal_mut 1)

# --- Task 8: Knack-Metrik, mit Mutationsbau „Kill hart“ ---
dsp_bibliothek(cypherdj_dsp_mut_kill_hart)
target_compile_definitions(cypherdj_dsp_mut_kill_hart PRIVATE CYPHERDJ_DSP_MUTATION_KILL_HART)
add_executable(render werkzeuge/render.cpp)
target_link_libraries(render PRIVATE cypherdj_dsp)
add_executable(render_mut_kill_hart werkzeuge/render.cpp)
target_link_libraries(render_mut_kill_hart PRIVATE cypherdj_dsp_mut_kill_hart)
add_test(NAME knack
         COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/knack.py
                 $<TARGET_FILE:render> $<TARGET_FILE:render_mut_kill_hart> ${CMAKE_CURRENT_BINARY_DIR}/knack)

# --- Task 9: Allokations- und Sperrwächter, mit Mutationsbau „allokiert“ (nicht im ASan-Bau: ASan ersetzt malloc) ---
if(NOT CYPHERDJ_DSP_SANITIZE)
  dsp_test(test_waechter tests/waechter.cpp)
  target_link_libraries(test_waechter PRIVATE ${CMAKE_DL_LIBS})
  set_tests_properties(test_waechter PROPERTIES TIMEOUT 600)
  dsp_bibliothek(cypherdj_dsp_mut_allokation)
  target_compile_definitions(cypherdj_dsp_mut_allokation PRIVATE CYPHERDJ_DSP_MUTATION_ALLOKATION)
  add_executable(test_waechter_mut tests/test_waechter.cpp tests/waechter.cpp)
  target_link_libraries(test_waechter_mut PRIVATE cypherdj_dsp_mut_allokation ${CMAKE_DL_LIBS})
  add_test(NAME test_waechter_mutation COMMAND test_waechter_mut 1)
endif()

# --- Task 10: Naht (Signaturen eingefroren, jeder Kopf allein übersetzbar) und Einbindung als Unterprojekt ---
set(DSP_KOEPFE werte regler bahn biquad isolator djfilter colorfx denormal kanalzug)
set(KOPF_TUS "")
foreach(k ${DSP_KOEPFE})
  file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/kopf_${k}.cpp "#include <cypherdj/dsp/${k}.h>\n")
  list(APPEND KOPF_TUS ${CMAKE_CURRENT_BINARY_DIR}/kopf_${k}.cpp)
endforeach()
dsp_test(test_naht ${KOPF_TUS})
add_test(NAME einbindung
         COMMAND ${CMAKE_COMMAND} -DQUELLE=${CMAKE_CURRENT_SOURCE_DIR} -DBAU=${CMAKE_CURRENT_BINARY_DIR}/einbindung
                 -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/einbindung/pruefe.cmake)

# --- Task 11: Kosten je Kanal und Block (Werkzeuge, kein Test: gemessen wird unter flock) ---
add_executable(kosten werkzeuge/kosten.cpp)
target_link_libraries(kosten PRIVATE cypherdj_dsp)
set(FAUST_LR8_ORDNER ${CMAKE_CURRENT_SOURCE_DIR}/../../../proben/04-mixer-effekte/build)
if(EXISTS ${FAUST_LR8_ORDNER}/gen_iso_lr8_double.h AND EXISTS /usr/include/faust/dsp/dsp.h)
  add_executable(kosten_faust_lr8 werkzeuge/kosten_faust_lr8.cpp)
  target_include_directories(kosten_faust_lr8 PRIVATE ${FAUST_LR8_ORDNER})
  target_compile_options(kosten_faust_lr8 PRIVATE -O2 -w)
endif()

# --- Paket 1.15: Gate (with mutation build "gate hart": gain without ramp, the click check must see it) ---
dsp_test(test_gate)
dsp_bibliothek(cypherdj_dsp_mut_gate_hart)
target_compile_definitions(cypherdj_dsp_mut_gate_hart PRIVATE CYPHERDJ_DSP_MUTATION_GATE_HART)
add_executable(test_gate_mut tests/test_gate.cpp)
target_link_libraries(test_gate_mut PRIVATE cypherdj_dsp_mut_gate_hart)
add_test(NAME test_gate_mutation COMMAND test_gate_mut 1)
dsp_bibliothek(cypherdj_dsp_mut_gate_inf)
target_compile_definitions(cypherdj_dsp_mut_gate_inf PRIVATE CYPHERDJ_DSP_MUTATION_GATE_INF_KLEBT)
add_executable(test_gate_mut_inf tests/test_gate.cpp)
target_link_libraries(test_gate_mut_inf PRIVATE cypherdj_dsp_mut_gate_inf)
add_test(NAME test_gate_mutation_inf COMMAND test_gate_mut_inf 2)
set_tests_properties(test_gate_mutation_inf PROPERTIES WILL_FAIL TRUE)

# --- Paket 1.15: Utility (with mutation build "utility hart": matrix without ramp, the click check must see it) ---
dsp_test(test_utility)
dsp_bibliothek(cypherdj_dsp_mut_utility_hart)
target_compile_definitions(cypherdj_dsp_mut_utility_hart PRIVATE CYPHERDJ_DSP_MUTATION_UTILITY_HART)
add_executable(test_utility_mut tests/test_utility.cpp)
target_link_libraries(test_utility_mut PRIVATE cypherdj_dsp_mut_utility_hart)
add_test(NAME test_utility_mutation COMMAND test_utility_mut 1)
if(NOT CYPHERDJ_DSP_SANITIZE)  # allocation watcher for gate and utility (not with ASan, which replaces malloc)
  dsp_test(test_mix_waechter tests/waechter.cpp)
  target_link_libraries(test_mix_waechter PRIVATE ${CMAKE_DL_LIBS})
endif()

# --- Paket 1.15: Multiband-Kompressor (multiband.h) ---
# Test, header compiles on its own, two mutation builds (each MUST turn its named check red), real-time watcher.
file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/kopf_multiband.cpp "#include <cypherdj/dsp/multiband.h>\n")
dsp_test(test_multiband ${CMAKE_CURRENT_BINARY_DIR}/kopf_multiband.cpp)
dsp_test(test_multiband_uebernahme)   # 1.15 A4: uebernehme_dynamik for the crossover change by crossfade
dsp_test(test_multiband_rampe)         # 1.15 A4 fix round: setze_band with an unchanged value does not re-arm the band ramp
dsp_bibliothek(cypherdj_dsp_mut_mb_rampe_neu)
target_compile_definitions(cypherdj_dsp_mut_mb_rampe_neu PRIVATE CYPHERDJ_DSP_MUTATION_MB_RAMPE_NEU)
add_executable(test_multiband_rampe_mut tests/test_multiband_rampe.cpp)
target_link_libraries(test_multiband_rampe_mut PRIVATE cypherdj_dsp_mut_mb_rampe_neu)
add_test(NAME test_multiband_rampe_mutation COMMAND test_multiband_rampe_mut)   # error case: setze_band re-arms the ramp on every call
set_tests_properties(test_multiband_rampe_mutation PROPERTIES WILL_FAIL TRUE)
dsp_test(test_multiband_ausgleich)     # mb-ausgleich fix: a compressed band keeps its level (automatic make-up)
dsp_bibliothek(cypherdj_dsp_mut_mb_ohne_ausgleich)
target_compile_definitions(cypherdj_dsp_mut_mb_ohne_ausgleich PRIVATE CYPHERDJ_DSP_MUTATION_MB_OHNE_AUSGLEICH)
add_executable(test_multiband_ausgleich_mut tests/test_multiband_ausgleich.cpp)
target_link_libraries(test_multiband_ausgleich_mut PRIVATE cypherdj_dsp_mut_mb_ohne_ausgleich)
add_test(NAME test_multiband_ausgleich_mutation COMMAND test_multiband_ausgleich_mut)   # error case: no automatic make-up
set_tests_properties(test_multiband_ausgleich_mutation PROPERTIES WILL_FAIL TRUE)
dsp_bibliothek(cypherdj_dsp_mut_mb_ohne_allpass)
target_compile_definitions(cypherdj_dsp_mut_mb_ohne_allpass PRIVATE CYPHERDJ_DSP_MUTATION_MB_OHNE_ALLPASS)
add_executable(test_multiband_mut_allpass tests/test_multiband.cpp)
target_link_libraries(test_multiband_mut_allpass PRIVATE cypherdj_dsp_mut_mb_ohne_allpass)
add_test(NAME test_multiband_mutation_allpass COMMAND test_multiband_mut_allpass allpass)
dsp_bibliothek(cypherdj_dsp_mut_mb_ungekoppelt)
target_compile_definitions(cypherdj_dsp_mut_mb_ungekoppelt PRIVATE CYPHERDJ_DSP_MUTATION_MB_UNGEKOPPELT)
add_executable(test_multiband_mut_kopplung tests/test_multiband.cpp)
target_link_libraries(test_multiband_mut_kopplung PRIVATE cypherdj_dsp_mut_mb_ungekoppelt)
add_test(NAME test_multiband_mutation_kopplung COMMAND test_multiband_mut_kopplung kopplung)
if(NOT CYPHERDJ_DSP_SANITIZE)
  dsp_test(test_multiband_echtzeit tests/waechter.cpp)
  target_link_libraries(test_multiband_echtzeit PRIVATE ${CMAKE_DL_LIBS})
endif()

# --- Paket 1.15: Kanal-Limiter und Spektrum-Analysator (Mix-Werkzeuge, Teil C) ---
# Limiter with two mutation builds that the test must catch: without lookahead delay, sample peaks only.
dsp_test(test_kanal_limiter)
dsp_bibliothek(cypherdj_dsp_mut_limiter_ohne_vorhalt)
target_compile_definitions(cypherdj_dsp_mut_limiter_ohne_vorhalt PRIVATE CYPHERDJ_DSP_MUTATION_LIMITER_OHNE_VORHALT)
add_executable(test_kanal_limiter_mut_vorhalt tests/test_kanal_limiter.cpp)
target_link_libraries(test_kanal_limiter_mut_vorhalt PRIVATE cypherdj_dsp_mut_limiter_ohne_vorhalt)
add_test(NAME test_kanal_limiter_mutation_vorhalt COMMAND test_kanal_limiter_mut_vorhalt vorhalt)
dsp_bibliothek(cypherdj_dsp_mut_limiter_ohne_echtspitze)
target_compile_definitions(cypherdj_dsp_mut_limiter_ohne_echtspitze PRIVATE CYPHERDJ_DSP_MUTATION_LIMITER_OHNE_ECHTSPITZE)
add_executable(test_kanal_limiter_mut_echtspitze tests/test_kanal_limiter.cpp)
target_link_libraries(test_kanal_limiter_mut_echtspitze PRIVATE cypherdj_dsp_mut_limiter_ohne_echtspitze)
add_test(NAME test_kanal_limiter_mutation_echtspitze COMMAND test_kanal_limiter_mut_echtspitze echtspitze)
# Spectrum analyser with a mutation build (rectangular window instead of Hann) that the leakage check must catch.
dsp_test(test_spektrum)
find_package(Threads REQUIRED)
target_link_libraries(test_spektrum PRIVATE Threads::Threads)
dsp_bibliothek(cypherdj_dsp_mut_spektrum_ohne_fenster)
target_compile_definitions(cypherdj_dsp_mut_spektrum_ohne_fenster PRIVATE CYPHERDJ_DSP_MUTATION_SPEKTRUM_OHNE_FENSTER)
add_executable(test_spektrum_mut_ohne_fenster tests/test_spektrum.cpp)
target_link_libraries(test_spektrum_mut_ohne_fenster PRIVATE cypherdj_dsp_mut_spektrum_ohne_fenster Threads::Threads)
add_test(NAME test_spektrum_mutation_ohne_fenster COMMAND test_spektrum_mut_ohne_fenster ohne_fenster)
dsp_test(test_spektrum_wechsel)
foreach(m ohne_leeren ohne_lese schnitt_ignoriert)
  string(TOUPPER ${m} M)
  dsp_bibliothek(cypherdj_dsp_mut_spektrum_${m})
  target_compile_definitions(cypherdj_dsp_mut_spektrum_${m} PRIVATE CYPHERDJ_DSP_MUTATION_SPEKTRUM_${M})
  add_executable(test_spektrum_wechsel_mut_${m} tests/test_spektrum_wechsel.cpp)
  target_link_libraries(test_spektrum_wechsel_mut_${m} PRIVATE cypherdj_dsp_mut_spektrum_${m})
  add_test(NAME test_spektrum_wechsel_mutation_${m} COMMAND test_spektrum_wechsel_mut_${m} ${m})
endforeach()
# Real-time discipline of both modules (allocation and lock watchdog; not with ASan, which replaces malloc).
if(NOT CYPHERDJ_DSP_SANITIZE)
  dsp_test(test_mixwerkzeuge_echtzeit tests/waechter.cpp)
  target_link_libraries(test_mixwerkzeuge_echtzeit PRIVATE ${CMAKE_DL_LIBS})
endif()

# --- Haertung (cloud) ---
# Hardening tests (property, fuzz, block size, sample rate, denormal, clicks, reset), see BERICHT-haertung.md.
# Every test also runs against a deliberately broken variant ("<test>_mutation", argument 1, must detect it):
# either an existing mutation library above, or a copy of one source file with a single replacement, written to
# the build tree at configure time. If the replacement anchor is gone (source changed), the mutation test fails
# with a message instead of silently disappearing. Known bugs: "<test>_befund_<name>", DISABLED (see the report).
set(HAERTUNG_MUT_ORDNER ${CMAKE_CURRENT_BINARY_DIR}/haertung_mut)

# haertung_mutation(<var> <name> <source relative to this dir> <old text> <new text>): writes the mutated copy and
# sets <var> to its path, or to "" if <old text> does not occur exactly once.
function(haertung_mutation var name quelle alt neu)
  file(READ ${CMAKE_CURRENT_SOURCE_DIR}/${quelle} inhalt)
  string(FIND "${inhalt}" "${alt}" pos)
  string(FIND "${inhalt}" "${alt}" pos_letzte REVERSE)
  if(pos EQUAL -1 OR NOT pos EQUAL pos_letzte)
    message(WARNING "Haertung: mutation anchor for ${name} not found exactly once in ${quelle}")
    set(${var} "" PARENT_SCOPE)
    return()
  endif()
  string(REPLACE "${alt}" "${neu}" inhalt "${inhalt}")
  get_filename_component(datei ${quelle} NAME)
  set(pfad ${HAERTUNG_MUT_ORDNER}/${name}/${datei})
  file(WRITE ${pfad}.neu "${inhalt}")
  file(COPY_FILE ${pfad}.neu ${pfad} ONLY_IF_DIFFERENT)
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/${quelle})
  set(${var} ${pfad} PARENT_SCOPE)
endfunction()

# haertung_test(<name> [QUELLEN <extra sources>] [LIBS <libs>]): the normal test, linked against cypherdj_dsp.
function(haertung_test name)
  cmake_parse_arguments(H "" "" "QUELLEN;LIBS" ${ARGN})
  add_executable(${name} tests/${name}.cpp ${H_QUELLEN})
  target_link_libraries(${name} PRIVATE ${H_LIBS} cypherdj_dsp)
  target_compile_options(${name} PRIVATE -Wall -Wextra)
  add_test(NAME ${name} COMMAND ${name})
endfunction()

# haertung_mut_test(<name> <suffix> [QUELLEN <mutated sources>] [LIBS <libs>]): the same test against a broken
# variant, argument 1. An empty QUELLEN list with no LIBS means the anchor was not found: the test fails.
function(haertung_mut_test name suffix)
  cmake_parse_arguments(H "" "" "QUELLEN;LIBS" ${ARGN})
  set(ziel ${name}_mut_${suffix})
  if(NOT H_QUELLEN AND NOT H_LIBS)
    add_test(NAME ${name}_mutation_${suffix} COMMAND ${CMAKE_COMMAND} -E false)  # anchor gone: see configure warning
    return()
  endif()
  add_executable(${ziel} tests/${name}.cpp ${H_QUELLEN})
  target_link_libraries(${ziel} PRIVATE ${H_LIBS} cypherdj_dsp)
  target_compile_options(${ziel} PRIVATE -Wall -Wextra)
  add_test(NAME ${name}_mutation_${suffix} COMMAND ${ziel} 1)
endfunction()

# biquad: high-pass b1 slightly off
haertung_test(test_haertung_biquad)
haertung_mutation(m biquad_hp_b1 src/biquad.cpp "c.b1 = -2.0 * norm;" "c.b1 = -1.999 * norm;")
haertung_mut_test(test_haertung_biquad hp_b1 QUELLEN ${m})

# isolator: high band without the 246 Hz phase-alignment high-pass
haertung_test(test_haertung_isolator)
haertung_mutation(m isolator_hoch src/isolator.cpp "const double h = k.hp_tief_hoch.schritt(b);" "const double h = b;")
haertung_mut_test(test_haertung_isolator hoch_ohne_abgleich QUELLEN ${m})

# djfilter: the two existing mutation libraries of Nachtrag 04
haertung_test(test_haertung_djfilter)
haertung_mut_test(test_haertung_djfilter guete_fest LIBS cypherdj_dsp_mut_guete_fest)
haertung_mut_test(test_haertung_djfilter ohne_cache LIBS cypherdj_dsp_mut_ohne_cache)

# colorfx: DUB ECHO feedback above 1 at param 1
haertung_test(test_haertung_colorfx)
haertung_mutation(m colorfx_fb src/colorfx.cpp "const double fb = 0.35 + 0.55 * p_;" "const double fb = 0.35 + 0.75 * p_;")
haertung_mut_test(test_haertung_colorfx rueckkopplung QUELLEN ${m})
# former known bugs (BERICHT-haertung.md, BERICHT-fixes.md): B1, B2, B3 fixed, now normal tests
foreach(b bloecke leeren parameter)
  add_test(NAME test_haertung_colorfx_befund_${b} COMMAND test_haertung_colorfx befund_colorfx_${b})
endforeach()

# regler: path lookup accepts prefixes
haertung_test(test_haertung_regler)
haertung_mutation(m regler_praefix src/regler.cpp "if (kReglerInfo[i].pfad == teilpfad)" "if (teilpfad.starts_with(kReglerInfo[i].pfad))")
haertung_mut_test(test_haertung_regler praefix QUELLEN ${m})

# bahn: existing mutation library "Kill hart" (switches jump)
haertung_test(test_haertung_bahn)
haertung_mut_test(test_haertung_bahn kill_hart LIBS cypherdj_dsp_mut_kill_hart)

# kanalzug: existing mutation libraries "ohne FTZ" and "Kill hart"; former bug B1 seen from the strip (fixed)
haertung_test(test_haertung_kanalzug)
haertung_mut_test(test_haertung_kanalzug ohne_ftz LIBS cypherdj_dsp_mut_ohne_ftz)
haertung_mut_test(test_haertung_kanalzug kill_hart LIBS cypherdj_dsp_mut_kill_hart)
add_test(NAME test_haertung_kanalzug_befund_color_bloecke COMMAND test_haertung_kanalzug befund_kanalzug_color_bloecke)

# messer (Scheibe 14): the module source is compiled into the test itself, so that -DCYPHERDJ_DSP_SANITIZE=ON
# (propagated from cypherdj_dsp) instruments it too; cypherdj_dsp_messer supplies the rest (baender.json data).
# analyse_baender: denormal flush threshold raised to an audible level
haertung_test(test_haertung_analyse_baender QUELLEN messer/src/analyse_baender.cpp LIBS cypherdj_dsp_messer)
haertung_mutation(m analyse_flush messer/src/analyse_baender.cpp "if (std::fabs(v) < 1e-30) v = 0.0;
  for (auto& sek : kz_)" "if (std::fabs(v) < 1e-3) v = 0.0;
  for (auto& sek : kz_)")
if(m)
  haertung_mut_test(test_haertung_analyse_baender flush QUELLEN ${m} LIBS cypherdj_dsp_messer)
else()
  haertung_mut_test(test_haertung_analyse_baender flush)
endif()
# former known bug B4 (fixed), now a normal test
add_test(NAME test_haertung_analyse_baender_befund_subnormal COMMAND test_haertung_analyse_baender befund_analyse_subnormal)

# master_limiter: gain without the moving average
haertung_test(test_haertung_master_limiter QUELLEN messer/src/master_limiter.cpp LIBS cypherdj_dsp_messer)
haertung_mutation(m limiter_mittel messer/src/master_limiter.cpp "return static_cast<float>(mittel_summe_ / (anstieg_ + 1));" "return static_cast<float>(h_rel_);")
if(m)
  haertung_mut_test(test_haertung_master_limiter ohne_mittel QUELLEN ${m} LIBS cypherdj_dsp_messer)
else()
  haertung_mut_test(test_haertung_master_limiter ohne_mittel)
endif()
# former known bug B5 (fixed), now a normal test
add_test(NAME test_haertung_master_limiter_befund_einstellung COMMAND test_haertung_master_limiter befund_limiter_einstellung)
# former known bug B6 (fixed), now a normal test
add_test(NAME test_haertung_master_limiter_befund_riesig COMMAND test_haertung_master_limiter befund_limiter_riesig)
