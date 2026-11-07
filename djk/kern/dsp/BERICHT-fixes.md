# Fixes for the hardening findings: report (cloud session, 2026-11-02)

Scope: the six DSP bugs B1 to B6 of `djk/kern/dsp/BERICHT-haertung.md` and the fourteen UI bugs 1 to 14 of
`djk/oberflaeche/tests/fixtures/haertung/BERICHT.md`. Base: `main` with `origin/claude/dsp-test-hardening-o2zv2e` and
`origin/claude/oberflaeche-test-hardening-t305j2` merged. Branch: the task named `cloud/haertung-fixes`; this session
is bound to `claude/haertung-fixes-14urs7`, where the work is pushed.

Every fix is its own commit (message names the bug). For every bug the evidence test was turned into a normal test
(ctest entry without `DISABLED TRUE`, node:test without `{ todo }`) and run once on the code before the fix (fails) and
once after it (passes). Only the modules named in the two reports and their tests were changed (plus the hardening
block of `djk/kern/dsp/CMakeLists.txt`, which registers those tests). No file outside the allowed list was needed,
so nothing is left open for that reason.

## Summary

| Bug | Module | Applied | Deviation from the proposal |
|---|---|---|---|
| B1 | `colorfx` | yes | NaN knob value stays dry (proposal would output NaN) |
| B2 | `colorfx` | yes | NOISE generator is reset only by the public `leeren()`, not on every return to the centre |
| B3 | `colorfx` | yes | none (gliding gains are cleared in the internal clear) |
| B4 | `messer/analyse_baender` | yes | none; the report's warning about `bitgleich.py` does not apply (see B4) |
| B5 | `messer/master_limiter` | yes | an infinite ceiling also falls back to the default (`isfinite` instead of `isnan`) |
| B6 | `messer/master_limiter` | yes | none |
| 1 | `mediathek.ts` | yes | native `LIKE` kept for ASCII queries, ASCII prefilter before `klein()` (300 ms budget) |
| 2 | `katalog.ts` | yes | detected by SQLite result code, not by message; all query methods |
| 3 | `katalog.ts` | yes | none |
| 4 | `katalog.ts` | yes | full whitespace set of JS `trim()`, not only tab to CR and NBSP |
| 5 | `sammlung.ts` | yes | each posten must also be an object with a string id |
| 6 | `sammlung.ts` | yes | retry the rename on ENOTEMPTY/EEXIST instead of an `existsSync` pre-check |
| 7 | `sammlung.ts` | yes | none |
| 8 | `sammlung.ts` | yes | none |
| 9 | `sammlung.ts` | yes | none |
| 10 | `welle_cache.ts` | yes | none |
| 11 | `welle_cache.ts` | yes | `datei` follows the `arbeitsbestand.ts` path rule (subfolders allowed), not "bare file name only" |
| 12 | `welle_cache.ts` | yes | none |
| 13 | `suchtext.ts` | yes | none |
| 14 | `mediathek.ts` | yes | none |

## Audible changes (for the product owner)

Only B1 and B3 change what is heard, and only in the situations below. Everything else is bit-identical; this was
checked by rendering the same scenes with the old and the new `colorfx.cpp` (48 kHz, 8 s of noise plus a 220 Hz sine,
blocks of 256, every art) and comparing sample by sample:

| Scene | SPACE | DUB ECHO | SWEEP | NOISE | CRUSH |
|---|---|---|---|---|---|
| knob held out of the centre (moving between -0.4 and -0.8) | identical | identical | identical | identical | identical |
| knob held, PARAMETER 0.6 → 0.9 at 2 s | **B3: differs from 2.03 s** | identical | identical | identical | identical |
| knob sweeping through the centre twice (sine, 4 s period) | **B1** -101 dBFS | **B1** -97 dBFS | **B1** -91 dBFS | **B1** other noise | **B1** -63 dBFS |
| knob out for 1 s, then in the centre (tail) | **B1** tail 128 samples longer | identical | identical | identical | identical |

What to listen for:

1. **B1, COLOR knob passing through the centre.** The effect now switches off and clears its state exactly at the sample
   where the knob enters the dead zone (|k| ≤ 0.05) and the tail has run out, and switches on exactly where it leaves
   it. Before, this happened per audio block (up to 1024 samples, about 21 ms at 48 kHz), so it depended on the block
   size. The new output is the same for every block size, and it equals the old output at block size 1 (checked:
   bit-identical in all scenes except the SPACE tail, which is one sample longer). The differences against the old
   output at block size 256 are tiny for SPACE, DUB ECHO and SWEEP (-91 to -101 dBFS). CRUSH differs by up to -63 dBFS
   (the sample-and-hold phase restarts at the exact centre sample). NOISE plays a different but equivalent noise sequence
   (peak difference -12 dBFS, the generator advanced differently, not a level change). Listen: a fast COLOR sweep
   through the centre with CRUSH and NOISE. Expected: no audible difference, at most a slightly different grain of the
   crush at re-entry.
2. **B1, SPACE tail length.** The tail of SPACE (and DUB ECHO) now ends exactly its nominal length after the last
   active sample (1.2 × T60). Before, it lost up to one block at its start and gained the rest of the block at its end.
   In the test scene the cut-off came 128 samples (2.7 ms) later, at about -72 dB below the reverb level, as before.
   Expected: not audible.
3. **B3, SPACE PARAMETER changes.** A PARAMETER change while SPACE is active now glides the reverb feedback over about
   50 ms (one pole, time constant 50 ms) instead of stepping it. The click around the change drops from up to
   -45.2 dBFS to at most -112.4 dBFS (HF metric of `tests/knack.py`, 16-bit step -96.3 dBFS). The reverb tail during the
   glide is slightly shorter than with the step, so the output differs from the old one after the change: -46 dBFS in
   the first 0.25 s, -62 dBFS after 1 s, -80 dBFS after 2 s (it decays with the reverb). With a fixed PARAMETER the sound
   is bit-identical. Listen: turn PARAMETER quickly while SPACE runs with the knob held. Expected: the click is gone,
   the change of the reverb length is smooth.
4. **B2** does not change the sound while playing: the NOISE generator and the last side are reset only by an explicit
   reset (`Kanalzug::zuruecksetzen()` / `zustaende_leeren()` → `ColorFx::leeren()`), so renders after a reset are
   reproducible. Renders without a reset are bit-identical to the state after B1 (checked).
5. **B5, B6 (limiter)** change nothing for valid settings and input up to ±1e6 (+120 dBFS): a 10 s render with levels
   from -40 to +120 dBFS and two settings is bit-identical before and after (control: with spikes up to +360 dBFS the
   two renders do differ, so the comparison is not trivially equal).
6. **B4** changes only analysis values below 1e-30 (-600 dB amplitude), which are now written as 0.

## DSP bugs

Before/after outputs: run `./test_haertung_<module> befund_<name>` in the build folder, or `ctest -R befund`.

### B1: Color FX decided active/dry per block

- Fix (`src/colorfx.cpp`, `include/cypherdj/dsp/colorfx.h`): `verarbeite()` decides per sample. A sample with the knob in
  the dead zone and no tail running is dry and clears the states once. Each art processes an active run and returns
  the number of samples at the first dry sample. The tail counts down per sample.
- Review of the proposal: correct, and minimal for the contract "split calls are bit-identical". One change: the dry test
  is written `!(|k| > dead zone)` and the arts stop at `!(a > 0)`. The proposal's `|k| <= dead zone` treats a NaN knob
  value as active and would output NaN, while the old code treated an all-NaN block as dry.
- Before: `test_haertung_colorfx befund_colorfx_bloecke` fails, max deviation block 1 vs 7/64/1024: SPACE 2.57e-5,
  DUB ECHO 2.28e-5, SWEEP 9.70e-5, NOISE 0.249, CRUSH 7.83e-4. `test_haertung_kanalzug befund_kanalzug_color_bloecke`
  fails (2.0e-4 to 0.292). After: both pass, deviation 0 for every art.

### B2: `ColorFx::leeren()` did not restore a fresh state

- Fix: the public `leeren()` also resets `seite_` and the NOISE generator. The automatic clear (knob back in the centre)
  and the clear on an art change use a new private `leeren_intern()` that keeps the generator running.
- Review of the proposal: the proposal reset the generator in `leeren()`. Together with B1, `leeren()` runs at every
  return to the centre, so NOISE would have restarted the identical noise sequence at every entry. That is a sound
  change without a bug behind it, so it is avoided. With B1 applied, `seite_` is always set again on the first active
  sample, so resetting it is only needed for the public reset.
- Before: `befund_colorfx_leeren` fails (SPACE 4.43e-5, DUB ECHO 6.15e-4, NOISE 0.048). After: 0 for every art.

### B3: SPACE clicked on every PARAMETER change

- Fix as proposed: the four FDN feedback gains glide towards the target (one pole, 50 ms); after a clear they start on
  the target.
- Review: correct and minimal. With the gains on target the update adds exactly 0, so a fixed PARAMETER gives
  bit-identical output (checked).
- Before: `befund_colorfx_parameter` fails, HF peak around the change up to -45.2 dBFS (48 kHz, 0 → 1, k -0.8), -74.1
  to -88.9 dBFS for 0.5 → 0.55. After: passes, worst -112.4 dBFS (48 kHz, 0 → 1, k -0.8); 0.5 → 0.55 at most
  -135.7 dBFS (the level before the change is about -137 dBFS).

### B4: analysis-band records carried subnormal floats

- Fix as proposed (`messer/src/analyse_baender.cpp`): band and `k_leistung` values below 1e-30 are written as 0.
- Review: the report asked to check the bit comparison `messer/pruefung/bitgleich.py` first. That script checks the
  limiter, not the bands. The band reference `messer/pruefung/referenz_baender.py` compares with an absolute tolerance
  of 1e-11 for values below 1e-6, so values below 1e-30 written as 0 stay within it. No change to the reference needed.
- Before: `befund_analyse_subnormal` fails (35 records with a subnormal `k_leistung`, 6 with a subnormal band value).
  After: 0 and 0.

### B5: limiter settings `decke_dbtp` and `abklingen_ms` not validated (safety)

- Fix (`messer/src/master_limiter.cpp`): a non-finite `decke_dbtp` falls back to -1 dBTP; a NaN or negative
  `abklingen_ms` falls back to 50 ms.
- Review: the proposal used `isnan` for the ceiling. `decke_dbtp = +inf` switches limiting off just like NaN (output
  +12 dBFS for +12 dBFS input), so `isfinite` is used, and this case was added to the evidence test. A finite ceiling
  above 0 dBTP is still taken as given (a deliberate configuration, not an invalid value); `abklingen_ms = +inf` gives
  a gain that never returns (output stays below the ceiling, so safe, only quiet).
- Before: `befund_limiter_einstellung` fails: `abklingen_ms = -50` peak +497.7 dBFS, `abklingen_ms = NaN` +12.0 dBFS,
  `decke_dbtp = NaN` +12.0 dBFS, `decke_dbtp = +inf` +12.0 dBFS. After: all four -2.79 dBFS (ceiling -1 dBTP).

### B6: limiter ceiling broke for huge finite input (safety)

- Fix as proposed: finite input beyond ±1e6 (+120 dBFS) is clamped before detection and delay; NaN/Inf still count as 0.
- Review: the cause is the cancellation in the running double sum of the moving average; no exact summation can hold
  both 1 and a gain of 1e-38. Clamping the input is the smallest safe fix. The output at a clamped spike is the ceiling
  either way. Output for |x| ≤ 1e6 is bit-identical (checked, see above).
- Before: `befund_limiter_riesig` fails: spike 1e18 to FLT_MAX gives +30.08 dBFS output, inverted (-31.9 at the spike);
  anstieg 1000 / ceiling -20 gives -19.32 and -18.49 dBFS (0.7 and 1.5 dB over). After: every case -1.13 dBFS
  (ceiling -1) or -20.13 dBFS (ceiling -20), never inverted.

## UI bugs

Before/after: each test was run alone with `node --test --test-name-pattern=<name> tests/haertung_<module>.test.mjs`,
first with the todo removed on the old code (`not ok`), then with the fix (`ok`). All fourteen go from `not ok` to
`ok`. The mutation checks of the five files still reject their broken copies (for bug 1 the escaping of the new
prefilter reuses `maskiere()`, so the existing mutation anchor occurs exactly once and covers it too).

| Bug | Before (test on old code) | After |
|---|---|---|
| 1 | `über` finds nothing; `klaenge('Über')` misses pack `Übersteuert` | found |
| 2 | raw `Error: database disk image is malformed` | `KatalogFehler` 503 `katalog_kaputt` |
| 3 | raw `Error: disk I/O error` | 503 `katalog_kaputt` |
| 4 | three extra blank facet values | one value `''`, n = 4 |
| 5 | raw `TypeError` | `SammlungFehler` 409 `json_kaputt` |
| 6 | raw `ENOTEMPTY` on the second delete | 50 lists in the trash |
| 7 | `bar` | `baer` |
| 8 | 400 `slug_ungueltig` | valid slug |
| 9 | stored note ends in a lone `\ud83d` | well-formed |
| 10 | 504 `waveform timed out` (TimeoutOverflowWarning) | waveform computed |
| 11 | raw `TypeError` for `null` | 404 `fassung_fehlt` for all three |
| 12 | empty file served | recalculated |
| 13 | 2 terms | 1 term |
| 14 | limit 1 | limit 50 |

Notes per bug (where the fix differs from the proposal or needed a check):

- **1 (mediathek search).** The proposal put the JS function `klein()` on every compared row. Measured on a synthetic
  mediathek (81 000 objects, 201 000 title/artist/mix rows, this container): `klein()` alone costs +140 to +340 ms per
  query, on top of a native scan of 110 to 230 ms. That would break the 300 ms budget the report warned about. Now:
  - a query of ASCII only keeps the native `LIKE` (same result and speed as before);
  - any other query runs a native `LIKE` on the ASCII parts of the query first (`grüße` → `%gr%e%`), then `klein()`
    on what is left, which is a superset.

  Candidate query, old → new (median of 9): `köln` 125 → 118 ms, `grüße` 168 → 154 ms, `über` 114 → 305 ms and `öl`
  127 → 350 ms. The last two have 27 000 matching rows in the synthetic data, against 0 or 152 before the fix. `love`
  (ASCII) uses the same SQL as before. Please re-measure `suche()` with an umlaut query on the real mediathek. Known
  limit: the ASCII fast path, like before, does not fold the Kelvin sign U+212A or U+0130. `camelot` stays on `lower()`
  because its values are ASCII.
- **2 (corrupt catalog page).** Detected by the SQLite result code (`errcode` 11 SQLITE_CORRUPT, 26 SQLITE_NOTADB). The
  proposal used the message pattern `/malformed|not a database/`, checked before the FTS branch. That pattern also
  matches an FTS "malformed MATCH expression", which must stay 400. The mapping is applied in every query method
  (`seite`, `baum`, `eintrag`, `eintragMid`, `eintragVonMid`), not only `seite` and `baum`.
- **4 (facet whitespace).** The trim set is exactly the whitespace of JS `String.prototype.trim` (checked over the whole
  BMP: nothing missing, nothing extra), so tree, filter and any JS-side trimming agree.
- **5 (set.json shape).** Each posten must also be an object with a string `id`. `legeHinzu()` reads `p.id.slice()` of
  every entry, so `posten: [null]` crashed the same way. Files written by the server always fulfil this.
- **6 (double delete).** Retrying the rename on ENOTEMPTY/EEXIST (`<slug>-<ms>-2`, `-3`, …) is atomic and therefore
  also safe against a second process. An `existsSync` pre-check is not.
- **7 (NFD slug).** Only new lists are affected; existing list folders keep their slug.
- **11 (fassung.json).** The report asked to confirm the `sha256` format against the writer before applying.
  Confirmed: `werkstatt/werkstatt/kette.py` writes `hashlib` `hexdigest()`, and `vertrag/schemas/defs.schema.json`
  fixes `sha256` to `^[0-9a-f]{64}$`. For `datei` the contract only says "non-empty string", and `arbeitsbestand.ts
  pruefePfad` accepts relative paths with subfolders for the same file. So `datei` follows that rule (relative, no
  empty, `.` or `..` segment, no backslash or NUL), instead of the proposal's "bare file name only", which would have
  refused paths the copier accepts.
- **12 (empty cache file).** Every file written by `welle.py` starts with the 16-byte `DJKW` header, so no valid
  waveform is empty.

## Suite results

### DSP

`cmake -S djk/kern/dsp -B djk/kern/dsp/build -G Ninja && ninja -C djk/kern/dsp/build && (cd djk/kern/dsp/build && ctest)`:
50 tests, 49 pass, 0 disabled (7 disabled before). The one failure is the pre-existing `regler_gegen_vertrag`
(contract text vs library drift, see `BERICHT-haertung.md`, "Outside the scope"; it fails before and after these
fixes). Environment note: `knack` needs `scipy`, which was missing in the container; it was installed with pip (no
repository change) and then passes.

Sanitizer build (`-DCYPHERDJ_DSP_SANITIZE=ON`, ASan + UBSan): 48 tests (without `test_waechter` and its mutation, by
design of the existing CMake), 47 pass, no sanitizer report in the log. The one failure is again `regler_gegen_vertrag`.
All seven former known-bug tests run and pass under the sanitizers.

### UI

UI_RESULT

## Rules of this task

- Changed files: `djk/kern/dsp/src/colorfx.cpp`, `djk/kern/dsp/include/cypherdj/dsp/colorfx.h`,
  `djk/kern/dsp/messer/src/analyse_baender.cpp`, `djk/kern/dsp/messer/src/master_limiter.cpp`, the hardening block
  of `djk/kern/dsp/CMakeLists.txt` (removing `DISABLED`), the hardening test files (comments, one added limiter case),
  `djk/oberflaeche/{katalog,sammlung,mediathek,welle_cache,suchtext}.ts` and `djk/oberflaeche/tests/haertung_*.test.mjs`
  (removing `todo`). Nothing under `djk/kern/include`, `djk/kern/src`, `djk/vertrag`, `server.ts`, `http/`, `bereiche/`,
  `projekt/`, `oeffentlich/produktion/`, `attrappe_kern/`, `pruef/`, `djk/hand/` or `docs/` was changed.
- Comments, commit messages and this report are English (`CLAUDE.md`); identifiers stay in the existing German scheme
  (`leeren_intern`, `enthaelt`, `LEERRAUM`, `kaputt`).
