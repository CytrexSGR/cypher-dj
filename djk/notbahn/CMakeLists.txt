# djk/notbahn: letzte Meile zwischen Kern und Ausgang (Scheibe 01: Durchreichen und Riegel; Scheibe 10: Schleife).
cmake_minimum_required(VERSION 3.28)
project(cypherdj_notbahn LANGUAGES C)

set(CMAKE_C_STANDARD 11)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()
find_package(PkgConfig REQUIRED)
pkg_check_modules(JACK REQUIRED IMPORTED_TARGET jack)

enable_testing()
add_executable(test_riegel tests/test_riegel.c)
target_include_directories(test_riegel PRIVATE src ${CMAKE_CURRENT_SOURCE_DIR}/../kern/include)
add_test(NAME riegel COMMAND test_riegel)

# Scheibe 10: Prüf-Kern, schreibt Klicks in den Ring und daneben an die Prüf-Senke
add_executable(ring_schreiber tests/ring_schreiber.c)
target_include_directories(ring_schreiber PRIVATE src ${CMAKE_CURRENT_SOURCE_DIR}/../kern/include)
target_link_libraries(ring_schreiber PRIVATE PkgConfig::JACK m)
target_compile_options(ring_schreiber PRIVATE -Wall -Wextra -Werror)

if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/src/notbahn.c)
  add_executable(cypherdj-notbahn src/notbahn.c)
  target_include_directories(cypherdj-notbahn PRIVATE src ${CMAKE_CURRENT_SOURCE_DIR}/../kern/include)
  target_link_libraries(cypherdj-notbahn PRIVATE PkgConfig::JACK m)
  target_compile_options(cypherdj-notbahn PRIVATE -Wall -Wextra)
  # ARCHITEKTUR §2.1: die Notbahn bleibt unter 200 Zeilen C
  add_test(NAME unter_200_zeilen COMMAND sh -c "test $(wc -l < ${CMAKE_CURRENT_SOURCE_DIR}/src/notbahn.c) -lt 200")
endif()
