# Bungee (MPL-2.0, Commit 8cb6977) als statische Bibliothek cypherdj::bungee. Wird vom Kern nur mit -DCYPHERDJ_BUNGEE=ON
# eingebunden (djk/kern/CMakeLists.txt): include(<pfad>/djk/third_party/bungee.cmake). Flags wie der Bungee-Bau selbst
# (bungee/CMakeLists.txt: -fwrapv, eigen_assert, pffft mit -ffast-math -fno-finite-math-only).
set(BUNGEE_T ${CMAKE_CURRENT_LIST_DIR}/bungee)
file(GLOB BUNGEE_QUELLEN CONFIGURE_DEPENDS ${BUNGEE_T}/src/*.cpp)
add_library(cypherdj_pffft STATIC ${BUNGEE_T}/submodules/pffft/pffft.c ${BUNGEE_T}/submodules/pffft/fftpack.c)
target_compile_options(cypherdj_pffft PRIVATE -ffast-math -fno-finite-math-only -fno-exceptions -w)
set_target_properties(cypherdj_pffft PROPERTIES C_STANDARD 99 POSITION_INDEPENDENT_CODE ON)
add_library(cypherdj_bungee STATIC ${BUNGEE_QUELLEN})
target_include_directories(cypherdj_bungee PRIVATE ${BUNGEE_T}/submodules/eigen ${BUNGEE_T}/submodules ${BUNGEE_T})
target_include_directories(cypherdj_bungee SYSTEM PUBLIC ${BUNGEE_T})  # <bungee/Bungee.h>
target_compile_definitions(cypherdj_bungee PRIVATE BUNGEE_VISIBILITY= BUNGEE_SELF_TEST=0 eigen_assert=BUNGEE_ASSERT1
                           EIGEN_DONT_PARALLELIZE=1)
set_source_files_properties(${BUNGEE_T}/src/version.cpp PROPERTIES COMPILE_DEFINITIONS BUNGEE_VERSION="git-8cb6977")
target_compile_options(cypherdj_bungee PRIVATE -fwrapv -w)  # Fremdquelle: keine Warnungen aus ihr
target_link_libraries(cypherdj_bungee PRIVATE cypherdj_pffft)
set_target_properties(cypherdj_bungee PROPERTIES POSITION_INDEPENDENT_CODE ON)
add_library(cypherdj::bungee ALIAS cypherdj_bungee)
