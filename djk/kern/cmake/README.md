# Shared build of the mutation targets

`djk/kern/CMakeLists.txt` builds about 700 mutation programs (failure cases of the acceptances: the same sources with one
`-DCYPHERDJ_MUTATION_...=1`, the test must go red). Before 2026-11-05 every one of them recompiled its whole source list
(about 70 files), although its switch occurs in one or two of them: 16353 of 17175 objects of a full kern build, 46 minutes.

## What happens now

`kern_mut_exe()` (`mutation_geteilt.cmake`) is used by every helper that builds a mutation program (`kern_mutation`,
`test_mutation`, `test_bk_attrappe`, `deck_keylock_mutation`, `box_keylock_mutation`, `kern_keylock_faeden_mutation`,
`deck_geplant_mutation`, `deck_geplant_pruef`) and by the few direct calls that carry `${KERN_QUELLEN}`. The call
signatures of the helpers did not change, so existing calls and calls added by other branches work unedited.

- A source the switch cannot touch is compiled **once per flag signature** (include paths, definitions without the switch,
  libraries) into an OBJECT library `kmg<signature>_<path>` and linked into every mutation target with that signature.
- A source the switch can touch is compiled by the target itself, with its real flags including `-D<switch>=1`, as before.
- The result links the same units with the same flags as the old per-target build.
- A full kern build compiles 2317 objects instead of 16170 (measured on the configured trees, `ninja -t commands`).

## How "can touch" is decided (automatic, also for future switches)

A switch can only change the preprocessed output of a unit if its identifier occurs in the unit or in a file of its include
closure. At configure time the closure is scanned textually (`#include "..."`/`<...>`, recursive, resolved against the including
directory and an index of all project headers, every suffix match counts, `#if` is not evaluated, comments count). This is a
superset of "preprocessed output differs with and without the switch". What the scan cannot place is treated as touched, so
the target compiles the unit itself (the old way): a switch name that does not match `CYPHERDJ_[A-Za-z0-9_]+`, a
`#include "..."` without a match, a `#include MACRO` in project code. Unresolved `#include <...>` are system headers.

The configuration depends on every file the scan read (`CMAKE_CONFIGURE_DEPENDS`), so an edit to a source or to a header in
its closure re-runs CMake and re-classifies. The cost is about 4 s of configure time.

Adding a mutation target needs nothing new: call the usual helper. A switch used in a header is found through the closure.

## Proof

`messungen/2026-11-05-bau-schnell/aequivalenz.sh OLD_BUILD NEW_BUILD OLD_SRC NEW_SRC` takes the configured trees of the same
commit built the old way (this file and the `include(...)` removed) and the new way. For every executable target it checks the
source set, the exact compile command of every unit, and runs `g++ -E` with the old command (switch on) and the new shared
command (switch off) on every shared unit. A miss is a shared unit whose output differs.

## Switches

- `-DCYPHERDJ_MUTATION_GETEILT=OFF`: old build, every target compiles all its sources.
- ccache: if `ccache` is on the PATH, `CMakeLists.txt` uses it as compiler launcher automatically; it is never required.

## Not covered

The small direct `add_executable` blocks with one or two sources (`test_netz_*_mutation`, `bk_lader_mutation`, ...) link
`cypherdj_kernbib` and compile the mutated unit as their own object in front of the library. They compile 1 to 4 units each and
stay as they were. The mutation targets of `dsp/`, `stellwerk/`, `hand/` and `dsp/messer/` do not exist in the kern build
(their tests are built only when those directories are built alone).
