# djk/fallback: letzte Meile zwischen Kern und Ausgang (Scheibe 01: Durchreichen und Riegel; Scheibe 10: Schleife).
cmake_minimum_required(VERSION 3.28)
project(cypherdj_notbahn LANGUAGES C)

set(CMAKE_C_STANDARD 11)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()
find_package(PkgConfig REQUIRED)
pkg_check_modules(JACK REQUIRED IMPORTED_TARGET jack)

enable_testing()
add_executable(test_latch tests/test_latch.c)
target_include_directories(test_latch PRIVATE src ${CMAKE_CURRENT_SOURCE_DIR}/../core/include)
add_test(NAME riegel COMMAND test_latch)

# Scheibe 10: Prüf-Kern, schreibt Klicks in den Ring und daneben an die Prüf-Senke
add_executable(ring_writer tests/ring_writer.c)
target_include_directories(ring_writer PRIVATE src ${CMAKE_CURRENT_SOURCE_DIR}/../core/include)
target_link_libraries(ring_writer PRIVATE PkgConfig::JACK m)
target_compile_options(ring_writer PRIVATE -Wall -Wextra -Werror)

if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/src/fallback.c)
  add_executable(cypherdj-notbahn src/fallback.c)
  target_include_directories(cypherdj-notbahn PRIVATE src ${CMAKE_CURRENT_SOURCE_DIR}/../core/include)
  target_link_libraries(cypherdj-notbahn PRIVATE PkgConfig::JACK m)
  target_compile_options(cypherdj-notbahn PRIVATE -Wall -Wextra)
  # ARCHITECTURE §2.1: die Notbahn bleibt unter 200 Zeilen C
  add_test(NAME unter_200_zeilen COMMAND sh -c "test $(wc -l < ${CMAKE_CURRENT_SOURCE_DIR}/src/fallback.c) -lt 200")
endif()
