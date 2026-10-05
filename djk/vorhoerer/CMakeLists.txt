# djk/vorhoerer: nativer Vorhörer (Stand: docs/architektur/stand/vorhoerer.md). Oberflächen zeigen nur an, der Ton kommt
# von hier. Die Messmutante (Rücksprung am Blockanfang) wird mitgebaut und nur von tests/messung.py benutzt.
cmake_minimum_required(VERSION 3.28)
project(cypherdj_vorhoerer LANGUAGES C)

set(CMAKE_C_STANDARD 11)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()
find_package(PkgConfig REQUIRED)
pkg_check_modules(JACK REQUIRED IMPORTED_TARGET jack)
find_package(Threads REQUIRED)

set(KOPF src ${CMAKE_CURRENT_SOURCE_DIR}/../kern/include)
add_executable(cypherdj-vorhoerer src/vorhoerer.c)
add_executable(cypherdj-vorhoerer-mutante src/vorhoerer.c)
target_compile_definitions(cypherdj-vorhoerer-mutante PRIVATE VORHOERER_MUTANTE_BLOCK)
foreach(z cypherdj-vorhoerer cypherdj-vorhoerer-mutante)
  target_include_directories(${z} PRIVATE ${KOPF})
  target_link_libraries(${z} PRIVATE PkgConfig::JACK Threads::Threads m)
  target_compile_options(${z} PRIVATE -Wall -Wextra -Werror -Wno-format-truncation) # Fehlertexte dürfen gekürzt werden
endforeach()

enable_testing()
add_executable(test_osc tests/test_osc.c)
target_include_directories(test_osc PRIVATE ${KOPF})
target_compile_options(test_osc PRIVATE -Wall -Wextra -Werror -UNDEBUG)
add_test(NAME osc COMMAND test_osc)
add_test(NAME riegel COMMAND sh ${CMAKE_CURRENT_SOURCE_DIR}/tests/riegel.sh $<TARGET_FILE:cypherdj-vorhoerer>)
