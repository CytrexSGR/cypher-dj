#!/usr/bin/env bash
# Runs the instruments workspace tests for alles.sh (suite instruments): usage alles_cargo.sh <instruments dir> <parallel crates> <build jobs>
#   1. build every test binary once: ONE `cargo test --workspace --no-run --message-format=json`, whose artifact lines name every test
#      executable and its package (a per-target `cargo test -p X --test Y` would compile again: other feature unification, and the parallel
#      cargos would queue on the build directory lock)
#   2. run those executables directly, side by side, with the package dir as cwd (the way cargo runs them) and a few test threads; the output of
#      one binary stays together in the log; the doc tests run once as `cargo test --workspace --doc`, as one more job of the pool
#   3. run the timing-asserting tests alone with one test thread, after the parallel pass (their budgets are a share of real time): their two binaries
#      are executed directly again
#   alles_cargo.sh --rerun <instruments dir> <spec file>: the flaky retry. Every line of the spec file is `dir|executable|test name`; the executables are
#   run again (no build), one at a time, one test thread, only those names (--exact). Same output format. Exit 0 only if every one passed.
#   A binary that cannot start, dies by a signal or prints no "test result:" line makes the run red (never 0 tests).
# Prints the usual cargo output, so alles_report.py reads it like a plain `cargo test --workspace`. Exit 0 only if every step passed.
SYSROOT_LIB="$(rustc --print sysroot)/lib"
# runs one executable like cargo does: package dir as cwd, CARGO_MANIFEST_DIR, the library path of the deps
fuehre_aus() { local d=$1 exe=$2; shift 2
  ( cd "$d" && CARGO_MANIFEST_DIR="$d" LD_LIBRARY_PATH="$(dirname "$exe"):$SYSROOT_LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" "$exe" "$@" ); }
if [ "${1:-}" = "--rerun" ]; then
  [ -n "${2:-}" ] && [ -f "${3:-}" ] || { echo "usage: alles_cargo.sh --rerun <instruments dir> <spec file>" >&2; exit 2; }
  cd "$2" || exit 2
  rc=0
  while IFS='|' read -r d exe; do
    namen=(); while IFS='|' read -r d2 exe2 name; do [ "$exe2" = "$exe" ] && namen+=("$name"); done < "$3"
    echo "     Running $exe  [cwd=$d]"
    fuehre_aus "$d" "$exe" --test-threads=1 --exact "${namen[@]}" > "${TMPDIR:-/tmp}/rerun.$$.log" 2>&1; r=$?
    cat "${TMPDIR:-/tmp}/rerun.$$.log"
    { [ $r = 0 ] && grep -q "^test result: " "${TMPDIR:-/tmp}/rerun.$$.log"; } || { echo "alles_cargo: rerun of $exe failed or printed no result (exit $r)"; rc=1; }
    rm -f "${TMPDIR:-/tmp}/rerun.$$.log"
  done < <(cut -d'|' -f1,2 "$3" | sort -u)
  exit $rc
fi
cd "$1" || exit 2
PAR=${2:-4}; BAU=${3:-4}
export CARGO_NET_OFFLINE=true
# tests whose assertion is a time budget: they must not share the machine with the rest of the pass
ZEIT=(kosten_je_stimme sechzehn_treffer_gleichzeitig_weit_unter_echtzeit)
ZEIT_PAKET=baukasten_dsp; ZEIT_BINARIES=(drum_synth trommeln)   # where they live (modular_dsp/tests/drum_synth.rs, trommeln.rs)

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
cargo test --workspace --no-run --jobs "$BAU" --message-format=json > "$TMP/artefakte.json" || { echo "alles_cargo: the build of the test binaries failed" >&2; exit 1; }
# one job per test executable (every tests/*.rs binary, the lib's unit tests, each bin's unit tests): the biggest crate has one binary of 3 minutes
# but 15 minutes of binaries in all, so a job per crate would be bounded by the crate, not by the longest binary. Format: index|package|name|dir|exe
JOBS_LISTE=$(python3 - "$TMP/artefakte.json" <<'PY'
import sys, json, os
zuerst = ["beispiele_konvention", "bk_zuruecksetzen_alle", "synth_poly", "synth_neuro", "bass_banddrive", "synth_mono"]   # longest first, the pool fills the gaps
jobs, gesehen = [], set()
for z in open(sys.argv[1]):
    if not z.startswith("{"):
        continue
    m = json.loads(z)
    if m.get("reason") != "compiler-artifact" or not m.get("profile", {}).get("test") or not m.get("executable"):
        continue
    exe = m["executable"]
    if exe in gesehen:
        continue
    gesehen.add(exe)
    pid = m["package_id"]
    frag = pid.rsplit("#", 1)[-1]
    paket = frag.split("@")[0] if "@" in frag else pid.rsplit("#", 1)[0].rstrip("/").rsplit("/", 1)[-1]
    jobs.append((paket, m["target"]["name"], os.path.dirname(m["manifest_path"]), exe))
jobs.sort(key=lambda j: (zuerst.index(j[1]) if j[1] in zuerst else len(zuerst), j[0], j[1]))
for i, (pk, n, d, exe) in enumerate(jobs):
    print(f"{i}|{pk}|{n}|{d}|{exe}")
PY
) || exit 1
[ -n "$JOBS_LISTE" ] || { echo "alles_cargo: the build named no test executable" >&2; exit 1; }
ZEIT_LAUF=()   # the executables of the timing tests, found by package and name
while IFS='|' read -r i pk n d exe; do
  for b in "${ZEIT_BINARIES[@]}"; do [ "$pk" = "$ZEIT_PAKET" ] && [ "$n" = "$b" ] && ZEIT_LAUF+=("$d|$exe"); done
done <<< "$JOBS_LISTE"
[ "${#ZEIT_LAUF[@]}" = "${#ZEIT_BINARIES[@]}" ] || { echo "alles_cargo: the timing test binaries (${ZEIT_BINARIES[*]}) were not built" >&2; exit 1; }

skip=(); for t in "${ZEIT[@]}"; do skip+=(--skip "$t"); done
lauf() { local n=$1 d=$2 exe=$3 r
  echo "     Running $exe  [cwd=$d]" > "$TMP/$n.log"
  RUST_TEST_THREADS=${TESTFAEDEN:-4} fuehre_aus "$d" "$exe" "${skip[@]}" >> "$TMP/$n.log" 2>&1; r=$?
  if [ $r = 0 ] && ! grep -q "^test result: " "$TMP/$n.log"; then echo "alles_cargo: $exe printed no 'test result:' line, counted as failed" >> "$TMP/$n.log"; r=1; fi
  echo $r > "$TMP/$n.rc"; }
doc() {
  RUST_TEST_THREADS=${TESTFAEDEN:-4} cargo test --workspace --doc --no-fail-fast --jobs 1 -- "${skip[@]}" > "$TMP/doc.log" 2>&1; echo $? > "$TMP/doc.rc"; }
rc=0
# the doc tests go first: they compile per test, the slowest part besides the biggest binaries
doc &
while IFS='|' read -r i pk n d exe; do
  while [ "$(jobs -rp | wc -l)" -ge "$PAR" ]; do wait -n; done
  lauf "$i" "$d" "$exe" &
done <<< "$JOBS_LISTE"
wait
while IFS='|' read -r i pk n d exe; do cat "$TMP/$i.log"; [ "$(cat "$TMP/$i.rc")" = 0 ] || rc=1; done <<< "$JOBS_LISTE"
cat "$TMP/doc.log"; [ "$(cat "$TMP/doc.rc")" = 0 ] || rc=1

# the timing tests: only their test binaries, only these names, one test thread
for e in "${ZEIT_LAUF[@]}"; do
  echo "     Running ${e#*|} (timing tests)  [cwd=${e%%|*}]"
  fuehre_aus "${e%%|*}" "${e#*|}" --test-threads=1 "${ZEIT[@]}" > "$TMP/zeit.log" 2>&1; r=$?
  cat "$TMP/zeit.log"
  { [ $r = 0 ] && grep -q "^test result: " "$TMP/zeit.log"; } || { echo "alles_cargo: timing test run failed or printed no result (exit $r)" ; rc=1; }
done
exit $rc
