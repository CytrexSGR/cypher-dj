# Shared build of the mutation targets ("fast build").
#
# Problem (measured 2026-11-05 on b1-integration): a full core build compiles 17175 objects in 46 min, 16353 of them belong to the
# mutation targets. Every target recompiled its whole source list (about 70 files) although its switch occurs in exactly one or two
# of them.
#
# Solution: kern_mut_exe() compiles ONE object per (source, compile signature) in an OBJECT library and links it into every
# mutation target with the same signature. A target compiles itself, with its real flags including the switch, only the translation
# units the switch touches. Signature = include paths, definitions without the switches, libraries (everything that determines the
# flags of a unit apart from the switch). The resulting program contains the same units with the same flags as before; only the
# untouched ones are shared.
#
# Which units does a switch touch? A unit is touched if its preprocessed output with -D<switch>=1 differs from the one without. This
# is NOT determined by preprocessing at configure time (704 targets times 70 units, too expensive) but by a safe superset: the
# identifier occurs in the text of the source or of a file in its include closure. A switch can only change the output if its
# identifier is in the token stream; if it is nowhere in the closure, the output is identical.
#   - Closure: all #include "..." and #include <...>, recursively. Resolved against the directory of the including file and against
#     an index of ALL project headers (suffix match, every match counts, so more than the compiler takes). Conditionals (#if) are
#     not evaluated: includes inside them count as well.
#   - Comments and string literals count (superset: at most one unit too many, never one too few).
#   - Not placeable means touched. A switch that does not match ^CYPHERDJ_[A-Za-z0-9_]+$, a #include "..." without a match, a
#     #include MACRO: the target then compiles that unit itself (the old way).
#   - Unresolved #include <...> are system headers (jack, openssl, rubberband, libstdc++) and carry no project switch. A macro include
#     inside the vendored djk/third_party is not counted (toml++ has one behind a macro that no flag of ours sets).
# So that the result cannot go stale after an edit, the configuration depends on every file it read (CMAKE_CONFIGURE_DEPENDS): a
# change to a source or to a header of a closure triggers a new configure and a new classification.
# Proof for all targets: messungen/2026-11-05-bau-schnell/aequivalenz.sh (g++ -E with and without the switch, set comparison).
#
# Off: -DCYPHERDJ_MUTATION_GETEILT=OFF builds as before (every target with all its sources).
# -DCYPHERDJ_MUTATION_GETEILT_PANNE=<target>:<source as written in the call> is the negative control of the proof (see cmake/README.md).
option(CYPHERDJ_MUTATION_GETEILT "Mutation targets share the objects their switch does not touch (fast build)" ON)
set(CYPHERDJ_MUTATION_GETEILT_PANNE "" CACHE STRING "Negative control only: <target>:<source> is wrongly treated as untouched")

# ---- Index of the project headers ---------------------------------------------------------------------------------------------------
set(_KMG_KOPF_WURZELN
    ${DJK}/core/include ${DJK}/core/tests ${DJK}/core/src ${DJK}/core/stub ${DJK}/core/check
    ${DJK}/core/dsp/include ${DJK}/core/dsp/meters/include ${DJK}/core/signalbox/include ${DJK}/core/hand/include
    ${DJK}/contract ${DJK}/third_party/nlohmann ${DJK}/third_party/toml++ ${DJK}/third_party/bungee/bungee
    ${DJK}/third_party/bungee/src ${DJK}/third_party/libebur128/ebur128)
set(_KMG_KOPF_MUSTER)
foreach(w ${_KMG_KOPF_WURZELN})
  foreach(e h hpp hh hxx inc inl ipp tcc def)
    list(APPEND _KMG_KOPF_MUSTER ${w}/*.${e})
  endforeach()
endforeach()
file(GLOB_RECURSE _KMG_KOEPFE CONFIGURE_DEPENDS ${_KMG_KOPF_MUSTER})
foreach(k ${_KMG_KOEPFE})
  get_filename_component(_b ${k} NAME)
  set_property(GLOBAL APPEND PROPERTY "KMG_IDX:${_b}" "${k}")
endforeach()
set(_KMG_PROTOKOLL ${CMAKE_BINARY_DIR}/mutation_geteilt.tsv)
file(WRITE ${_KMG_PROTOKOLL} "ziel\tquelle\tart\tobjekt\n")
set(_KMG_ZAEHL_EIGEN 0)
set(_KMG_ZAEHL_GETEILT 0)
set(_KMG_ZAEHL_ZIELE 0)

# Direct evaluation of one file: resolved includes, CYPHERDJ_* tokens, "not placeable" flag. Once per file.
function(_kmg_direkt datei)
  get_property(fertig GLOBAL PROPERTY "KMG_U:${datei}" SET)
  if(fertig)
    return()
  endif()
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${datei}")
  file(READ "${datei}" inhalt)
  string(REGEX MATCHALL "[A-Za-z0-9_]*CYPHERDJ_[A-Za-z0-9_]*" tok "${inhalt}")
  list(REMOVE_DUPLICATES tok)
  string(REGEX MATCHALL "(^|\n)[ \t]*#[ \t]*(include|include_next|import)[^\n;]*" zeilen "${inhalt}")
  get_filename_component(verz "${datei}" DIRECTORY)
  set(incs)
  set(unpl 0)
  foreach(z ${zeilen})
    if(z MATCHES "#[ \t]*(include|include_next|import)[ \t]*\"([^\"]+)\"")
      set(name "${CMAKE_MATCH_2}")
      set(anf 1)
    elseif(z MATCHES "#[ \t]*(include|include_next|import)[ \t]*<([^>]+)>")
      set(name "${CMAKE_MATCH_2}")
      set(anf 0)
    else()
      # #include MACRO: cannot be resolved. Vendored third-party headers are exempt (toml++ has "#include TOML_CONFIG_HEADER" behind
      # a user-defined macro that no flag of ours sets); a macro include in project code stays "not placeable".
      if(NOT datei MATCHES "/third_party/")
        set(unpl 1)
        if(KMG_DEBUG)
          message(STATUS "KMG unplaceable macro include in ${datei}: ${z}")
        endif()
      endif()
      continue()
    endif()
    set(treffer)
    if(anf AND EXISTS "${verz}/${name}")
      get_filename_component(r "${verz}/${name}" REALPATH)
      list(APPEND treffer "${r}")
    endif()
    # suffix match in the index (leading ./ and ../ stripped)
    set(n "${name}")
    while(n MATCHES "^\\.\\.?/(.*)$")
      set(n "${CMAKE_MATCH_1}")
    endwhile()
    get_filename_component(b "${n}" NAME)
    get_property(kand GLOBAL PROPERTY "KMG_IDX:${b}")
    string(LENGTH "/${n}" ln)
    foreach(p ${kand})
      string(LENGTH "${p}" lp)
      if(lp GREATER_EQUAL ln)
        math(EXPR ab "${lp} - ${ln}")
        string(SUBSTRING "${p}" ${ab} -1 ende)
        if(ende STREQUAL "/${n}")
          get_filename_component(r "${p}" REALPATH)
          list(APPEND treffer "${r}")
        endif()
      endif()
    endforeach()
    list(REMOVE_DUPLICATES treffer)
    if(NOT treffer AND anf)
      set(unpl 1)   # #include "..." without a match: not placeable
      if(KMG_DEBUG)
        message(STATUS "KMG unplaceable include \"${name}\" in ${datei}")
      endif()
    endif()
    list(APPEND incs ${treffer})
  endforeach()
  list(REMOVE_DUPLICATES incs)
  set_property(GLOBAL PROPERTY "KMG_I:${datei}" "${incs}")
  set_property(GLOBAL PROPERTY "KMG_T:${datei}" "${tok}")
  set_property(GLOBAL PROPERTY "KMG_U:${datei}" "${unpl}")
endfunction()

# Closure of a source: union of tokens and the "not placeable" flag, once per source.
function(_kmg_huelle quelle out_tok out_unpl)
  get_property(bekannt GLOBAL PROPERTY "KMG_HU:${quelle}" SET)
  if(NOT bekannt)
    set(todo "${quelle}")
    set(gesehen)
    set(toks)
    set(unpl 0)
    while(todo)
      list(POP_FRONT todo f)
      if(f IN_LIST gesehen)
        continue()
      endif()
      list(APPEND gesehen "${f}")
      _kmg_direkt("${f}")
      get_property(i GLOBAL PROPERTY "KMG_I:${f}")
      get_property(t GLOBAL PROPERTY "KMG_T:${f}")
      get_property(u GLOBAL PROPERTY "KMG_U:${f}")
      list(APPEND toks ${t})
      list(APPEND todo ${i})
      if(u)
        set(unpl 1)
      endif()
    endwhile()
    list(REMOVE_DUPLICATES toks)
    set_property(GLOBAL PROPERTY "KMG_HT:${quelle}" "${toks}")
    set_property(GLOBAL PROPERTY "KMG_HU:${quelle}" "${unpl}")
  endif()
  get_property(t GLOBAL PROPERTY "KMG_HT:${quelle}")
  get_property(u GLOBAL PROPERTY "KMG_HU:${quelle}")
  set(${out_tok} "${t}" PARENT_SCOPE)
  set(${out_unpl} "${u}" PARENT_SCOPE)
endfunction()

# Does one of the switches touch this source? (superset, see the header)
function(_kmg_beruehrt quelle schalter out)
  set(${out} 0 PARENT_SCOPE)
  foreach(s ${schalter})
    if(NOT s MATCHES "^CYPHERDJ_[A-Za-z0-9_]+$")
      set(${out} 1 PARENT_SCOPE)
      return()
    endif()
  endforeach()
  if(NOT schalter)
    return()
  endif()
  _kmg_huelle("${quelle}" toks unpl)
  if(unpl)
    set(${out} 1 PARENT_SCOPE)
    return()
  endif()
  foreach(s ${schalter})
    if(s IN_LIST toks)
      set(${out} 1 PARENT_SCOPE)
      return()
    endif()
  endforeach()
endfunction()

# Executable mutation target.
#   QUELLEN   all translation units (test file or main.cpp included), relative to CMAKE_CURRENT_SOURCE_DIR or absolute
#   SCHALTER  switches defined as <name>=1 (empty: no switch)
#   DEFS      other definitions for all units (e.g. CYPHERDJ_DJK="...", CYPHERDJ_BUNGEE=1)
#   INCLUDES  include paths for all units
#   LIBS      libraries to link; their usage requirements also apply to the shared objects
function(kern_mut_exe name)
  cmake_parse_arguments(M "" "" "QUELLEN;SCHALTER;DEFS;INCLUDES;LIBS" ${ARGN})
  list(APPEND M_DEFS ${KMG_DEFS_${name}})   # additions announced before the call (see the final check below)
  list(REMOVE_DUPLICATES M_QUELLEN)
  if(NOT CYPHERDJ_MUTATION_GETEILT)
    add_executable(${name} ${M_QUELLEN})
  else()
    set(eigene)
    set(geteilte)
    # signature: everything that determines the flags of a unit apart from the switch
    set(d ${M_DEFS})
    list(SORT d)
    set(l ${M_LIBS})
    list(SORT l)
    string(JOIN "|" sig_inc ${M_INCLUDES})
    string(JOIN "|" sig_def ${d})
    string(JOIN "|" sig_lib ${l})
    set(sig "${sig_inc}#${sig_def}#${sig_lib}")
    get_property(bekannt GLOBAL PROPERTY "KMG_SIG:${sig}" SET)
    if(NOT bekannt)
      get_property(zahl GLOBAL PROPERTY KMG_SIGZAHL)
      if(NOT zahl)
        set(zahl 0)
      endif()
      set_property(GLOBAL PROPERTY "KMG_SIG:${sig}" ${zahl})
      math(EXPR zahl "${zahl} + 1")
      set_property(GLOBAL PROPERTY KMG_SIGZAHL ${zahl})
    endif()
    get_property(si GLOBAL PROPERTY "KMG_SIG:${sig}")
    foreach(q ${M_QUELLEN})
      if(IS_ABSOLUTE "${q}")
        set(abs "${q}")
      else()
        set(abs "${CMAKE_CURRENT_SOURCE_DIR}/${q}")
      endif()
      get_filename_component(abs "${abs}" REALPATH)
      _kmg_beruehrt("${abs}" "${M_SCHALTER}" beruehrt)
      # negative control of the proof (never set in normal use): "<target>:<path suffix>" makes that unit wrongly shared, so the
      # mutation test must turn wrongly green and aequivalenz.sh must report a MISS
      if(CYPHERDJ_MUTATION_GETEILT_PANNE STREQUAL "${name}:${q}")
        set(beruehrt 0)
      endif()
      if(beruehrt)
        list(APPEND eigene "${q}")
        file(APPEND ${_KMG_PROTOKOLL} "${name}\t${q}\teigen\t-\n")
        math(EXPR _KMG_ZAEHL_EIGEN "${_KMG_ZAEHL_EIGEN} + 1")
      else()
        file(RELATIVE_PATH rel "${CMAKE_CURRENT_SOURCE_DIR}" "${abs}")
        string(MAKE_C_IDENTIFIER "kmg${si}_${rel}" obj)
        if(NOT TARGET ${obj})
          add_library(${obj} OBJECT "${q}")
          target_include_directories(${obj} PRIVATE ${M_INCLUDES})
          if(M_DEFS)
            target_compile_definitions(${obj} PRIVATE ${M_DEFS})
          endif()
          if(M_LIBS)
            target_link_libraries(${obj} PRIVATE ${M_LIBS})
          endif()
        endif()
        list(APPEND geteilte "$<TARGET_OBJECTS:${obj}>")
        file(APPEND ${_KMG_PROTOKOLL} "${name}\t${q}\tgeteilt\t${obj}\n")
        math(EXPR _KMG_ZAEHL_GETEILT "${_KMG_ZAEHL_GETEILT} + 1")
      endif()
    endforeach()
    add_executable(${name} ${eigene} ${geteilte})
    set_target_properties(${name} PROPERTIES LINKER_LANGUAGE CXX)
    math(EXPR _KMG_ZAEHL_ZIELE "${_KMG_ZAEHL_ZIELE} + 1")
    set(_KMG_ZAEHL_EIGEN ${_KMG_ZAEHL_EIGEN} PARENT_SCOPE)
    set(_KMG_ZAEHL_GETEILT ${_KMG_ZAEHL_GETEILT} PARENT_SCOPE)
    set(_KMG_ZAEHL_ZIELE ${_KMG_ZAEHL_ZIELE} PARENT_SCOPE)
  endif()
  target_include_directories(${name} PRIVATE ${M_INCLUDES})
  set(alle_defs ${M_DEFS})
  foreach(s ${M_SCHALTER})
    list(APPEND alle_defs ${s}=1)
  endforeach()
  if(alle_defs)
    target_compile_definitions(${name} PRIVATE ${alle_defs})
  endif()
  if(M_LIBS)
    target_link_libraries(${name} PRIVATE ${M_LIBS})
  endif()
  # Baseline for the final check: whatever is added to this target later reaches only the units the target compiles itself, never
  # the shared objects.
  if(CYPHERDJ_MUTATION_GETEILT)
    foreach(eig COMPILE_DEFINITIONS INCLUDE_DIRECTORIES COMPILE_OPTIONS COMPILE_FLAGS LINK_LIBRARIES)
      get_target_property(wert ${name} ${eig})
      if(wert MATCHES "NOTFOUND$")
        set(wert "")
      endif()
      set_property(GLOBAL PROPERTY "KMG_E:${name}:${eig}" "${wert}")
    endforeach()
    set_property(GLOBAL APPEND PROPERTY KMG_ZIELE ${name})
  endif()
endfunction()

# Final check (deferred to the end of the directory): a shared-mode mutation target must not have been changed after its creation.
# A target_compile_definitions() or target_include_directories() on it would change only the units it compiles itself, not the shared
# objects, so the program would differ from the old per-target build. Found by the proof for the golden mixer targets (2026-11-05).
# Pass such additions through kern_mut_exe (variable KMG_DEFS_<target> for definitions) instead.
function(_kmg_pruefe)
  get_property(ziele GLOBAL PROPERTY KMG_ZIELE)
  foreach(z ${ziele})
    foreach(eig COMPILE_DEFINITIONS INCLUDE_DIRECTORIES COMPILE_OPTIONS COMPILE_FLAGS LINK_LIBRARIES)
      get_target_property(jetzt ${z} ${eig})
      if(jetzt MATCHES "NOTFOUND$")
        set(jetzt "")
      endif()
      get_property(vorher GLOBAL PROPERTY "KMG_E:${z}:${eig}")
      if(NOT "${jetzt}" STREQUAL "${vorher}")
        message(FATAL_ERROR "mutation target ${z} was changed after kern_mut_exe (${eig}):\n  at creation: ${vorher}\n  now:         ${jetzt}\n"
                "Its shared objects would not see the change. Pass it through the helper (cmake/README.md) or build with "
                "-DCYPHERDJ_MUTATION_GETEILT=OFF.")
      endif()
    endforeach()
  endforeach()
endfunction()
cmake_language(DEFER DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR} CALL _kmg_pruefe)

# A mutation test that names a test case (argument) must name one that exists in the test source. An unknown case runs nothing and
# the program exits 0, which a WILL_FAIL test reports as "failed as intended" (and a plain test as passed): the check is void and
# nobody sees it. This happened in the public export (2026-11-09): the export renames German words, "guard" and "core" in the CMake
# call became "guard" and "core", the string in the test source did not, three mutation tests ran nothing. Checked at configure time:
# the selector must occur as a string literal in the source.
function(cdj_require_selector source selector)
  file(READ "${CMAKE_CURRENT_SOURCE_DIR}/${source}" _cdj_src)
  string(FIND "${_cdj_src}" "\"${selector}\"" _cdj_pos)
  if(_cdj_pos EQUAL -1)
    message(FATAL_ERROR "test case \"${selector}\" does not occur as a string literal in ${source}: "
                        "a test that selects an unknown case runs nothing and passes for the wrong reason")
  endif()
endfunction()
