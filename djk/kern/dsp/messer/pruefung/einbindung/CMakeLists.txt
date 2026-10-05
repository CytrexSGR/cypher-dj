# Naht-Prüfung von Scheibe 14: so bindet Strang A (Scheibe 43) djk/kern/dsp ein. Es entstehen nur die
# Bibliotheken; ein Test- oder Werkzeug-Ziel von 14 wäre hier ein Fehler.
cmake_minimum_required(VERSION 3.25)
project(messer_einbindung LANGUAGES CXX)
add_subdirectory("${DSP_DIR}" dsp)
if(TARGET messer_test_baender_koeff OR TARGET messer_kosten)
  message(FATAL_ERROR "Tests oder Werkzeuge von Scheibe 14 im Kern-Bau")
endif()
add_executable(einbindung main.cpp)
target_link_libraries(einbindung PRIVATE cypherdj_dsp_messer)
