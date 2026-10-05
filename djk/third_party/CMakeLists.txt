# Gepinnte Fremdquellen (SCHNITTSTELLEN.md §19.4), Herkunft in herkunft.json.
# Einbinden: add_subdirectory(<pfad>/djk/third_party third_party), dann target_link_libraries(<ziel> PRIVATE
# cypherdj::ebur128 cypherdj::json cypherdj::toml). Allein bauen und testen:
#   cmake -S djk/third_party -B djk/third_party/build -G Ninja && cmake --build djk/third_party/build
#   ctest --test-dir djk/third_party/build --output-on-failure
cmake_minimum_required(VERSION 3.25)
project(cypherdj_third_party LANGUAGES C CXX)

add_library(cypherdj_ebur128 STATIC libebur128/ebur128/ebur128.c)
target_include_directories(cypherdj_ebur128 PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/libebur128/ebur128)
target_include_directories(cypherdj_ebur128 SYSTEM PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/libebur128/ebur128/queue)
target_link_libraries(cypherdj_ebur128 PUBLIC m)
set_target_properties(cypherdj_ebur128 PROPERTIES C_STANDARD 99 POSITION_INDEPENDENT_CODE ON)
add_library(cypherdj::ebur128 ALIAS cypherdj_ebur128)

add_library(cypherdj_json INTERFACE)
target_include_directories(cypherdj_json SYSTEM INTERFACE ${CMAKE_CURRENT_SOURCE_DIR})
add_library(cypherdj::json ALIAS cypherdj_json)

add_library(cypherdj_toml INTERFACE)
target_include_directories(cypherdj_toml SYSTEM INTERFACE ${CMAKE_CURRENT_SOURCE_DIR})
add_library(cypherdj::toml ALIAS cypherdj_toml)

if(PROJECT_IS_TOP_LEVEL)
  enable_testing()
  add_executable(ebu_r128 tests/ebu_r128.c)
  target_link_libraries(ebu_r128 PRIVATE cypherdj::ebur128)
  set_target_properties(ebu_r128 PROPERTIES C_STANDARD 99)
  # EBU Tech 3341 Fall 1 und 2 (Stereo-Sinus 1 kHz, 20 s): I auf ±0,01 LU (Dossier 04 §4.7: 0,007)
  add_test(NAME ebu_fall1_minus23 COMMAND ebu_r128 -23 -23 0.01 standard)
  add_test(NAME ebu_fall2_minus33 COMMAND ebu_r128 -33 -33 0.01 standard)
  # Kern-Modus mit Histogramm (ohne malloc im Echtzeit-Faden, Dossier 04 NP K3): Klassenbreite 0,1 LU, gemessen
  # -22,950 LUFS (0,05 LU daneben), darum hier die EBU-Grenze ±0,1 statt ±0,01
  add_test(NAME ebu_fall1_histogramm COMMAND ebu_r128 -23 -23 0.1 histogramm)
  # Fehlerfall: 0,05 dB zu leise muss die Grenze reißen, sonst misst der Test nichts
  add_test(NAME ebu_fehlerfall_005db COMMAND ebu_r128 -23.05 -23 0.01 standard)
  set_tests_properties(ebu_fehlerfall_005db PROPERTIES WILL_FAIL TRUE)
  # Negativ-Kontrolle: Stille liegt unter dem absoluten Gate, I = -inf
  add_test(NAME ebu_stille COMMAND ebu_r128 stille)

  add_executable(kopf_test tests/kopf_test.cpp)
  target_link_libraries(kopf_test PRIVATE cypherdj::json cypherdj::toml)
  target_compile_features(kopf_test PRIVATE cxx_std_20)
  add_test(NAME kopf_json_toml COMMAND kopf_test)
endif()
