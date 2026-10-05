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
                 $<TARGET_FILE:regler_liste> ${CMAKE_CURRENT_SOURCE_DIR}/../../../docs/architektur/SCHNITTSTELLEN.md)

# --- Task 3: Bahnen ---
dsp_test(test_bahn)

# --- Task 4: LR8-Isolator ---
dsp_test(test_isolator)

# --- Task 5: DJ-Filter ---
dsp_test(test_djfilter)

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
set(DSP_KOEPFE werte regler bahn biquad isolator djfilter denormal kanalzug)
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
