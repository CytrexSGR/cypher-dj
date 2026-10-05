# Softcontroller (Scheibe 19): virtueller ALSA-MIDI-Controller im Terminal, eigenes CMake-Projekt.
# Braucht die Hand-Bibliothek (djk/kern/hand, mit ihr das Stellwerk) für LED-Namen und den Belegungstest.
cmake_minimum_required(VERSION 3.21)
project(cypherdj_softcontroller CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()

set(D ${CMAKE_CURRENT_SOURCE_DIR})
set(KONFIG ${D}/../../konfig/controller CACHE PATH "Ordner der Controller-Mappings (djk/konfig/controller)")
if(NOT TARGET cypherdj::hand)
  add_subdirectory(${D}/../../kern/hand ${CMAKE_CURRENT_BINARY_DIR}/hand)
endif()

find_package(PkgConfig REQUIRED)
pkg_check_modules(ALSA REQUIRED IMPORTED_TARGET alsa)

add_executable(softcontroller softcontroller.cpp)
target_link_libraries(softcontroller cypherdj::hand PkgConfig::ALSA)
target_compile_definitions(softcontroller PRIVATE SOFTCONTROLLER_MAPPING="${KONFIG}/softcontroller.json")
target_compile_options(softcontroller PRIVATE -Wall -Wextra -Wno-missing-field-initializers)

enable_testing()
add_executable(soft_test_belegung test_belegung.cpp)
target_include_directories(soft_test_belegung PRIVATE ${D}/../../kern/hand/tests)
target_link_libraries(soft_test_belegung cypherdj::hand)
target_compile_definitions(soft_test_belegung PRIVATE SOFTCONTROLLER_MAPPING="${KONFIG}/softcontroller.json")
target_compile_options(soft_test_belegung PRIVATE -Wall -Wextra -Wno-missing-field-initializers)
add_test(NAME test_belegung COMMAND soft_test_belegung)
