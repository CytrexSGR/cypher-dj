# Scheibe 14: Messer, Analyse-Bänder, Master-Limiter. Wird aus djk/kern/dsp/CMakeLists.txt (Scheibe 04)
# mit add_subdirectory(messer) eingebunden; baut und testet auch allein:
#   cmake -S djk/kern/dsp/messer -B djk/kern/dsp/messer/build -G Ninja
cmake_minimum_required(VERSION 3.25)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
  project(cypherdj_dsp_messer LANGUAGES C CXX)
  enable_testing()
endif()
enable_language(C)  # libebur128 ist C; das Projekt von Scheibe 04 kann nur CXX aktiviert haben

# Tests und Werkzeuge nur, wenn djk/kern/dsp (Scheibe 04) oder messer selbst das oberste Projekt ist;
# bindet Strang A (Scheibe 43) djk/kern/dsp ein, entsteht nur die Bibliothek.
option(CYPHERDJ_MESSER_TESTS "Tests und Werkzeuge von Scheibe 14 bauen" ${PROJECT_IS_TOP_LEVEL})
if(CYPHERDJ_MESSER_TESTS)
  enable_testing()
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)  # gilt für dieses Verzeichnis; Kostenmessung braucht -O3
endif()

set(CYPHERDJ_MESSER_DJK "${CMAKE_CURRENT_SOURCE_DIR}/../../.." CACHE PATH "Wurzel djk/")
set(CYPHERDJ_BAENDER_JSON "${CYPHERDJ_MESSER_DJK}/vertrag/baender.json" CACHE FILEPATH "baender.json aus Scheibe 09")
set(CYPHERDJ_EBUR128_DIR "${CYPHERDJ_MESSER_DJK}/third_party/libebur128" CACHE PATH "libebur128 aus Scheibe 02")

find_package(Python3 REQUIRED COMPONENTS Interpreter)

# --- libebur128 (MIT, Commit 67b33ab), einkompiliert --------------------------------------------
find_file(CYPHERDJ_EBUR128_C ebur128.c PATHS "${CYPHERDJ_EBUR128_DIR}/ebur128" "${CYPHERDJ_EBUR128_DIR}" NO_DEFAULT_PATH)
find_path(CYPHERDJ_EBUR128_INC ebur128.h PATHS "${CYPHERDJ_EBUR128_DIR}/ebur128" "${CYPHERDJ_EBUR128_DIR}" NO_DEFAULT_PATH)
if(NOT CYPHERDJ_EBUR128_C OR NOT CYPHERDJ_EBUR128_INC)
  message(FATAL_ERROR "libebur128 nicht gefunden unter ${CYPHERDJ_EBUR128_DIR} (Scheibe 02 legt sie nach djk/third_party/libebur128/)")
endif()
if(NOT TARGET cypherdj_ebur128)  # B12 (Scheibe 25): third_party legt dasselbe Ziel an, wenn beide im Bau sind
  add_library(cypherdj_ebur128 STATIC "${CYPHERDJ_EBUR128_C}")
  target_include_directories(cypherdj_ebur128 PUBLIC "${CYPHERDJ_EBUR128_INC}")
  set_target_properties(cypherdj_ebur128 PROPERTIES C_STANDARD 99 POSITION_INDEPENDENT_CODE ON)
endif()
target_link_libraries(cypherdj_ebur128 PUBLIC m)

# --- Bandfilter-Koeffizienten aus baender.json, zur Bauzeit ---------------------------------------
set(CYPHERDJ_MESSER_GEN "${CMAKE_CURRENT_BINARY_DIR}/erzeugt")
add_custom_command(
  OUTPUT "${CYPHERDJ_MESSER_GEN}/cypherdj/dsp/baender_koeff.h"
  COMMAND ${Python3_EXECUTABLE} "${CMAKE_CURRENT_SOURCE_DIR}/erzeuge_baender_h.py"
          "${CYPHERDJ_BAENDER_JSON}" "${CYPHERDJ_MESSER_GEN}/cypherdj/dsp/baender_koeff.h"
  DEPENDS "${CYPHERDJ_BAENDER_JSON}" "${CMAKE_CURRENT_SOURCE_DIR}/erzeuge_baender_h.py"
          "${CMAKE_CURRENT_SOURCE_DIR}/baender_json.py"
  COMMENT "baender_koeff.h aus ${CYPHERDJ_BAENDER_JSON}")
add_custom_target(cypherdj_baender_koeff DEPENDS "${CYPHERDJ_MESSER_GEN}/cypherdj/dsp/baender_koeff.h")

# --- Bibliothek (die Tasks 2, 4, 5 hängen ihre Quellen mit target_sources an) ----------------------
add_library(cypherdj_dsp_messer STATIC src/baender_koeff.cpp)
add_dependencies(cypherdj_dsp_messer cypherdj_baender_koeff)
target_include_directories(cypherdj_dsp_messer PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include")
target_include_directories(cypherdj_dsp_messer PRIVATE "${CYPHERDJ_MESSER_GEN}")
target_compile_options(cypherdj_dsp_messer PRIVATE -Wall -Wextra -Werror)
target_link_libraries(cypherdj_dsp_messer PUBLIC cypherdj_ebur128)

# --- Tests: CTest, eigener Prüf-Kopf, Allokationswächter per --wrap -------------------------------
if(CYPHERDJ_MESSER_TESTS)
  add_library(cypherdj_messer_waechter STATIC tests/alloc_waechter.cpp)
endif()
function(messer_test name)
  if(NOT CYPHERDJ_MESSER_TESTS)
    return()
  endif()
  add_executable(messer_${name} tests/${name}.cpp)
  target_include_directories(messer_${name} PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/tests")
  target_link_libraries(messer_${name} PRIVATE cypherdj_dsp_messer cypherdj_messer_waechter)
  target_link_options(messer_${name} PRIVATE -Wl,--wrap=malloc,--wrap=calloc,--wrap=realloc)
  add_test(NAME messer_${name} COMMAND messer_${name})
endfunction()
function(messer_werkzeug name)
  if(NOT CYPHERDJ_MESSER_TESTS)
    return()
  endif()
  add_executable(${name} werkzeuge/${name}.cpp)
  target_link_libraries(${name} PRIVATE cypherdj_dsp_messer)
endfunction()
messer_test(test_baender_koeff)


# Task 2: sechs Analyse-Bänder (SCHNITTSTELLEN 6.2)
messer_test(test_analyse_baender)
target_sources(cypherdj_dsp_messer PRIVATE src/analyse_baender.cpp)


# Task 3: Werkzeug für die Python-Gegenrechnung
messer_werkzeug(messer_baender_datei)


# Task 4: Pegelmesser für /pegel (SCHNITTSTELLEN 5.6)
messer_test(test_pegel_messer)
target_sources(cypherdj_dsp_messer PRIVATE src/pegel_messer.cpp)


# Task 5: Master-Limiter (SCHNITTSTELLEN 2.1 limiter_dbtp)
messer_test(test_master_limiter)
target_sources(cypherdj_dsp_messer PRIVATE src/master_limiter.cpp)


# Task 6: Werkzeug für den Limiter am MFB-Track
messer_werkzeug(messer_limiter_datei)


# Task 7: Kostenmessung unter flock
messer_werkzeug(messer_kosten)
