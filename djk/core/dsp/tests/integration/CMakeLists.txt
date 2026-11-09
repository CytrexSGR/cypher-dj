# Wie Strang A die Bibliothek einbindet (Scheibe 25): add_subdirectory und cypherdj::dsp.
cmake_minimum_required(VERSION 3.25)
project(einbindung CXX)
add_subdirectory(${DSP_QUELLE} dsp)
add_executable(einbindung main.cpp)
target_link_libraries(einbindung PRIVATE cypherdj::dsp)
