# CI and the gate: what to do before you push

The gate (`djk/tools/alles.sh`) runs on one runner, one job at a time. A red round costs about 30 minutes,
and many red rounds were not bugs but stale pins: a golden file or an expected count that nobody re-pinned.

## Before you push

    djk/tools/pins_follow_up.sh

It rewrites every golden file and pinned count that can be regenerated without a core build (about 30 s) and ends with a `git diff --stat` of
what changed. Read that diff: it is the behaviour change you are about to publish. Commit it with your change. Goldens that need a core build are
listed in the output with the command that rewrites them.

`djk/tools/pins_follow_up.sh --pruefen` compares only and exits 1 naming each drifted pin. CI runs it right after the export sieve, so drift
shows up in the first two minutes of a job instead of after the gate. In a gate log, failing tests whose message starts with `[pin]` are drift
(`djk/tools/ci/zeige_error.sh` prints how many); the fix is always the same command.

Counts that tests pin (commands, hand tools, routes) live in `djk/tests/zaehlstaende.json`; `djk/tools/zaehlstaende.mjs` computes them from the code.
The router table is pinned once, in `djk/ui/tests/support/routen_golden.json`. A new golden test honours `CYPHERDJ_PINS_SCHREIBEN=1`
(see `djk/ui/tests/support/pins.mjs`), fails with a message from `pinText(...)`, and is added to `pins_follow_up.sh`.

## File size ceiling

The export sieve step also fails a source file over 1000 lines (tests and generated files excepted). Files already over are listed with a reason in
`djk/tools/grosse_dateien.txt`; a listed file must not grow and leaves the list when it drops under 1000.

## Pre-push hook

`.githooks/pre-push` runs the export sieve (with the size ceiling) and `djk/tools/pins_follow_up.sh --pruefen` before a branch push,
about two minutes. Enable it once per clone: `git config core.hooksPath .githooks` (all worktrees of the clone share it).

## After a red run, and stopping a job

A red quick run leaves a red marker `~/cypherdj-ci/rot/<sha>` (the basis it measured against and the base suites that failed). The next quick run of the branch
measures against the newest ancestor with a green or a red marker (`ci/gruene_basis.sh`): after a red one it runs what the branch changed since then plus
those whole suites (`alles.sh --betroffen <sha> --auch <suites>`), so a one-file fix after a red run does not run the gate again. A gate file changed since
the red run still escalates to the whole gate. The green marker of such a run is `basis=delta`, so the full job on main does not skip on it.

`djk/tools/ci/abbrechen.sh`, run on the runner host, stops a running job completely: the step's shell, `ruhig_pakete.sh` (its step runs with `always()` after a red
pool), `im_container.sh` and `alles.sh`, then every container `cdjci-<pid>`; leftovers get KILL after 5 s. It prints what it stopped and exits 1 only if something survived.
