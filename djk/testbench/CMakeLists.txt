# djk/testbench: Werkzeuge des Chaos-Prüfstands (Scheibe 16). Der Aufnehmer aus Scheibe 01 bleibt ein eigenes Projekt
# unter recorder/ und wird getrennt gebaut.
cmake_minimum_required(VERSION 3.28)
project(cypherdj_pruefstand LANGUAGES C)
set(CMAKE_C_STANDARD 17)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()
find_package(PkgConfig REQUIRED)
pkg_check_modules(JACK REQUIRED IMPORTED_TARGET jack)
find_package(Threads REQUIRED)
add_compile_options(-Wall -Wextra)

add_executable(cypherdj-pruefquelle source/check_source.c)
target_link_libraries(cypherdj-pruefquelle PRIVATE PkgConfig::JACK m)

add_executable(cypherdj-lastgen load/load_gen.c)
target_link_libraries(cypherdj-lastgen PRIVATE Threads::Threads)

enable_testing()
add_executable(test_source source/test_source.c)
target_link_libraries(test_source PRIVATE m)
add_test(NAME quelle COMMAND test_source)
