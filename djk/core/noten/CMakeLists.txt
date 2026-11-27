# cdj_noten: core library of the note editor (pitch curve, notes, render) and the program cypherdj-noten (contract: djk/contract/notes.md).
# Works as a top-level project (cmake -S djk/core/noten -B djk/core/noten/build -G Ninja) and as a subdirectory of djk/core, where the
# program lands in the core build folder beside cypherdj-render. Sources and tests are collected by glob (CONFIGURE_DEPENDS):
#   src/*.cpp without src/cli*.cpp -> static library cdj_noten; src/cli*.cpp -> program cypherdj-noten; tests/test_noten_*.cpp -> one test each.
# No other target is linked: no new run-time library in the .deb. Tests named test_noten_zeit_* and test_noten_grenzen_* measure run time and
# limits; they get the label `ruhig` (kept out of the loaded core suite: alles.sh -LE 'langsam|pipewire|ruhig') and a long timeout.
# This file is never edited by the later tasks: they add files, the globs pick them up.
cmake_minimum_required(VERSION 3.28)
project(cdj_noten LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(PROJECT_IS_TOP_LEVEL)
  if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
  endif()
  enable_testing()
endif()

set(NOTEN_DIR ${CMAKE_CURRENT_SOURCE_DIR})
set(NOTEN_THIRD_PARTY ${CMAKE_CURRENT_SOURCE_DIR}/../../third_party)
set(NOTEN_KERN_TESTS ${CMAKE_CURRENT_SOURCE_DIR}/../tests)

file(GLOB NOTEN_QUELLEN CONFIGURE_DEPENDS ${NOTEN_DIR}/src/*.cpp)
file(GLOB NOTEN_CLI_QUELLEN CONFIGURE_DEPENDS ${NOTEN_DIR}/src/cli*.cpp)
list(REMOVE_ITEM NOTEN_QUELLEN ${NOTEN_CLI_QUELLEN})

add_library(cdj_noten STATIC ${NOTEN_QUELLEN})
target_include_directories(cdj_noten PUBLIC ${NOTEN_DIR}/include ${NOTEN_DIR}/src)
target_include_directories(cdj_noten SYSTEM PUBLIC ${NOTEN_THIRD_PARTY})
target_compile_options(cdj_noten PRIVATE -Wall -Wextra)

add_executable(cypherdj-noten ${NOTEN_CLI_QUELLEN})
target_link_libraries(cypherdj-noten PRIVATE cdj_noten)
target_compile_options(cypherdj-noten PRIVATE -Wall -Wextra)
set_target_properties(cypherdj-noten PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})

file(GLOB NOTEN_TESTS CONFIGURE_DEPENDS ${NOTEN_DIR}/tests/test_noten_*.cpp)
foreach(quelle ${NOTEN_TESTS})
  get_filename_component(name ${quelle} NAME_WE)
  add_executable(${name} ${quelle})
  target_link_libraries(${name} PRIVATE cdj_noten)
  target_include_directories(${name} PRIVATE ${NOTEN_DIR}/tests ${NOTEN_KERN_TESTS})
  target_compile_options(${name} PRIVATE -Wall -Wextra)
  target_compile_definitions(${name} PRIVATE
    NOTEN_DATEN="${NOTEN_DIR}/tests/daten"
    CONTRACT="${NOTEN_DIR}/../../contract"
    NOTEN_PROGRAMM="$<TARGET_FILE:cypherdj-noten>")
  add_dependencies(${name} cypherdj-noten)
  add_test(NAME ${name} COMMAND ${name})
  if(name MATCHES "^test_noten_(zeit|grenzen)_")
    set_tests_properties(${name} PROPERTIES LABELS ruhig TIMEOUT 300)
  endif()
endforeach()
