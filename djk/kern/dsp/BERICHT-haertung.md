# Hardening of cypherdj_dsp: report (cloud session, 2026-11-02)

Scope: the existing modules `biquad`, `isolator`, `djfilter`, `colorfx`, `kanalzug`, `regler`, `bahn` and from
`messer/` the modules `analyse_baender` and `master_limiter`. Only new test files were added
(`tests/haertung.h`, `tests/test_haertung_<modul>.cpp`) and one block at the end of `CMakeLists.txt`
(`# --- Haertung (cloud) ---`). No source, header or existing test was changed.

## Result in short

- 9 new test programs, 9 normal tests, 11 mutation tests, 7 disabled known-bug tests (ctest now holds 43 runnable
  tests plus the 7 disabled ones; 20 + 7 of them are new).
- Every test file has at least one check that fails on a deliberately broken variant; all 11 mutation runs detect
  their mutation automatically in every ctest run (not only once by hand).
- **6 bugs found** (B1 to B6, below), each with a disabled reproducer and a proposed minimal fix. All six fixes were
  applied in a scratch copy and verified: every disabled reproducer then passes, and every existing and new test
  still passes. None of the fixes is applied here.
- Sanitizer run (`-DCYPHERDJ_DSP_SANITIZE=ON`, ASan + UBSan): 40 of 41 tests pass, no sanitizer report. The one
  failure is the pre-existing `regler_gegen_vertrag` (fails in the normal build too, see "Outside the scope").
- Warnings: the new tests build without any warning under `-Wall -Wextra`.

## How to run

```
cmake -S djk/kern/dsp -B djk/kern/dsp/build -G Ninja && ninja -C djk/kern/dsp/build
(cd djk/kern/dsp/build && ctest -R haertung)                 # normal and mutation tests
(cd djk/kern/dsp/build && ./test_haertung_colorfx befund_colorfx_bloecke)   # one known-bug reproducer
cmake -S djk/kern/dsp -B djk/kern/dsp/build-san -G Ninja -DCYPHERDJ_DSP_SANITIZE=ON && ninja -C djk/kern/dsp/build-san
(cd djk/kern/dsp/build-san && ctest)
```

A test program takes one optional argument: none = normal run; `1` = mutation run (passes only if at least one
check marked `PRUEF_M` fails); `befund_<name>` = runs only the reproducer of known bug `<name>`.

## Mechanism for "fails on a broken variant"

Two kinds of mutation, both registered as ctest tests `<test>_mutation_<name>` and run with argument `1`:

1. The existing mutation libraries of the suite (`cypherdj_dsp_mut_guete_fest`, `_ohne_cache`, `_ohne_ftz`,
   `_kill_hart`), linked in place of `cypherdj_dsp`.
2. Configure-time source mutation: `haertung_mutation()` reads one source file, replaces exactly one text anchor and
   writes the mutated copy into the build tree (`build/haertung_mut/<name>/`); the test is compiled with that copy
   (it overrides the object from the static library). If the anchor no longer occurs exactly once (the source was
   changed), configure prints a warning and the mutation test fails (`cmake -E false`) instead of disappearing.

In-file negative controls in addition: `test_haertung_biquad` runs its `leeren()` check against a broken stand-in
(clears only `z1`) in every normal run; `test_haertung_kanalzug` checks that jumps without ramp lie at least 10 dB
above its click bound.

| Test | Mutation (ctest name suffix) | Detecting check | Normal | Mutated |
|---|---|---|---|---|
| biquad | `hp_b1`: high-pass `b1 = -1.999·norm` | DC gain, LR8 all-pass sum | \|H_hp(0)\| 0, all-pass error 2.6e-10 | 2.3e5, 1.2e11 |
| isolator | `hoch_ohne_abgleich`: high band without the 246 Hz alignment | all-pass flatness | 4.8e-7 dB | 0.31 dB |
| djfilter | `guete_fest` (existing library) | \|H(fc)\| = Q | 5.3e-8 dB | Q has no effect |
| djfilter | `ohne_cache` (existing library) | setze_guete on a running filter = fresh | 0 | 0.261 |
| colorfx | `rueckkopplung`: DUB ECHO feedback 0.35 + 0.75·p | fuzz bound, tail decay | peak 5.0, tail -150 dB | 77.5, +646 dB |
| regler | `praefix`: lookup by prefix | path fuzz (200 000 strings) | 0 wrong | 58 566 wrong |
| bahn | `kill_hart` (existing library) | switch step bound | 0.00679 per sample | 1.0 |
| kanalzug | `ohne_ftz` (existing library) | no subnormal after 30 s silence | 0 | 418 794 |
| kanalzug | `kill_hart` (existing library) | kill click below the 16-bit step | -97.2 dBFS | -32.7 dBFS |
| analyse_baender | `flush`: denormal flush at 1e-3 instead of 1e-30 | block-size independence | 0 | 0.229 |
| master_limiter | `ohne_mittel`: gain without the moving average | gain step <= 1/(anstieg+1) | 0.92 of the bound | 300x the bound |

## Tests added

All tests use a fixed-seed generator (xorshift64*, `haertung::Zufall`), so every run is identical. Block sizes are
always 1, 7, 64 and `kMaxFrames` (1024; the limiter also 4096). Rates are 44.1, 48 and 96 kHz where the module takes a
rate. The click metric is the one of `tests/knack.py` in C++ (4th-order Butterworth high-pass at 5 kHz, zero phase,
peak in ±50 ms, stimulus 780 Hz at -6 dBFS; threshold the 16-bit step -96.33 dBFS).

| File | Checks | Runtime (Release) |
|---|---|---|
| `test_haertung_biquad.cpp` | 6000 coefficient sets (fc 1 Hz..0.49 fs, q 0.3..10, 3 rates, limits first): finite, poles inside the unit circle, DC/Nyquist gains; LR8 low + high = all-pass within 1e-6; full-scale noise and square: finite, peak < 4; block sizes bit-identical; `leeren()` bit-identical to fresh (with negative control); no subnormal state under `DenormalSchutz` over 60 s silence | 0.3 s |
| `test_haertung_isolator.cpp` | all-pass at unity gains within 0.001 dB (20 Hz..0.45 fs, 3 rates); band sum = output; random per-sample gains 0..2: finite, bounded; block sizes and in place bit-identical; `leeren()`; no subnormal output or band sample over 30 s silence | 1.0 s |
| `test_haertung_djfilter.cpp` | fuzz over q (incl. NaN, -1, 100), k per sample / walk / stops / flips, 3 rates: finite, peak < 50; k = 0 bit-exact dry; \|H(fc)\| = Q for both sides, 3 rates; block sizes; `leeren()` keeps q; `setze_guete` on a running filter; denormals; Q change during playback bounded | 0.7 s |
| `test_haertung_colorfx.cpp` | fuzz over all arts, params (incl. NaN, -1, 2), beat lengths (-1..1e6), knob patterns, 3 rates: finite, peak < 50; tail decay at param 1; dead zone bit-exact; bit-exact dry and `faehrt()` false after the tail; block sizes with the knob held; `leeren()` (arts without B2); denormals with the knob held and centred; parameter-jump clicks | 9 s |
| `test_haertung_regler.cpp` | table invariants; path round trip; 200 000-string path fuzz; `werte.h` at and beyond the limits (`db_zu_linear` exact 0/1, strictly increasing; `rampe_db_wert` finite, inside the ends, monotone; clamps for ±inf) | 0.1 s |
| `test_haertung_bahn.cpp` | 6 million values from fuzzed setze/rampe/verlauf/setze_sofort on every controller, 3 rates (incl. NaN, ±inf, out of range): inside the range; switch ramp duration = llround(ms·fs)+1 samples; step bounds (S-curve 1.5·Δ/n, smoother (1-p)·Δ, the one stumm step <= 0.0011 linear); monotone; block sizes with events bit-identical; `verlauf` semantics; reset; smoother settles exactly, never subnormal | 4 s |
| `test_haertung_kanalzug.cpp` | fuzzed event lists on every controller plus Color FX and Q changes, random block sizes, 3 rates, all sends: finite, peak < 1e3; split calls bit-identical (DJ filter, every Color FX art with the knob held); ramp duration per rate; no subnormal in main, sends, tap, bands over 30 s silence (3 rates × 6 arts × 2 sides); clicks for 15 controller events plus 2 positive controls; NaN recovery via `zustaende_leeren`; `zuruecksetzen` | 13 s |
| `test_haertung_analyse_baender.cpp` | fuzzed input (noise, square, impulses, step, 1e-30) and block sizes: finite, >= 0, exact window peak, record structure; window alignment for 200 start samples incl. int64 limits; block sizes bit-identical (loud) and within 1e-6 (decay); record-array overflow (-1, nothing written behind `max_aus`); `zuruecksetzen`; all records exactly 0 after 30 s silence | 0.8 s |
| `test_haertung_master_limiter.cpp` | 60 fuzzed settings (incl. out of range) with input -40..+40 dBFS and NaN, ±inf, 1e9, subnormals: finite, every sample <= ceiling; delay = `vorhalt_samples()`, fallbacks; bit-exact transparency below the ceiling and again after a burst; block sizes; `zuruecksetzen`; exact zeros after silence; gain step <= 1/(anstieg+1) at level jumps | 2.3 s |

The analysis bands and the limiter are fixed to 48 kHz (coefficients from `baender.json`; the limiter's
interpolator, grid reserve and release use 48000), so their files do not run the rate checks; parameter-jump checks
apply to the limiter (level jumps) but not to the analysis bands (no parameters).

## Coverage

Line coverage with gcov/gcovr (Debug, `--coverage -O1`), module sources only:

| Source | Hardening tests alone | Existing suite alone |
|---|---|---|
| `src/bahn.cpp` | 97 % | 98 % |
| `src/biquad.cpp` | 100 % | 100 % |
| `src/colorfx.cpp` | 99 % | 99 % |
| `src/djfilter.cpp` | 100 % | 100 % |
| `src/isolator.cpp` | 100 % | 100 % |
| `src/kanalzug.cpp` | 97 % | 88 % |
| `src/regler.cpp` | 100 % | 100 % |
| `messer/src/analyse_baender.cpp` | 100 % | 100 % |
| `messer/src/master_limiter.cpp` | 100 % | 98 % |
| **total** | **99 % (694 of 699 lines)** | 98 % (686 of 699) |

The uncovered lines are the `#ifdef` mutation branches (`kanalzug.cpp` 65-66, `bahn.cpp` 52), an unreachable
`return` after a full `switch` (`bahn.cpp` 103) and a constructor line counted twice by gcov (`colorfx.cpp` 53). The
existing suite already reached almost every line, so line coverage says little here; the value of the new tests is in
the properties (ranges, limits, segmentations, rates, resets), which is where B1 to B6 were found.

## Bugs found

Severity: medium = breaks a stated contract or a safety guarantee in reachable use; low = edge case or
config-only.

### B1 (medium): Color FX makes split Kanalzug calls non-identical when the knob crosses the dead zone

Contract (`kanalzug.h`): "Zwei Teilaufrufe liefern bitgleich dasselbe wie ein Aufruf ohne Ereignis". With any Color
FX art and the COLOR knob moving through the centre, the output depends on where the blocks are split.
Cause: `ColorFx::verarbeite` decides "active or dry" once per block (any sample with |k| > 0.05 or a tail running
makes the whole block active; a fully dry block calls `leeren()`), and SPACE / DUB ECHO count their tail down by the
block length (`fahne_ = max(0, fahne_ - n)`), not per sample.

Reproducer: `test_haertung_colorfx befund_colorfx_bloecke` (ColorFx alone, 48 kHz, noise ±0.5 for 2 s, k = sin over
1.5 periods, param 0.6, 9000 samples per beat) and `test_haertung_kanalzug befund_kanalzug_color_bloecke` (Kanalzug,
48 kHz, noise ±0.5 for 1 s, `setze(filter, ±0.6)` alternating every 4800 samples). Largest deviation between block
size 1 and 7 / 64 / 1024:

| Art | ColorFx alone | Kanalzug |
|---|---|---|
| SPACE | 2.57e-5 (-91.8 dBFS) | 2.24e-4 (-73.0 dBFS) |
| DUB ECHO | 2.28e-5 (-92.8 dBFS) | 2.02e-4 (-73.9 dBFS) |
| SWEEP | 9.70e-5 (-80.3 dBFS) | 6.18e-4 (-64.2 dBFS) |
| NOISE | 0.249 (-12.1 dBFS) | 0.292 (-10.7 dBFS) |
| CRUSH | 7.83e-4 (-62.1 dBFS) | 3.23e-3 (-49.8 dBFS) |

(NOISE: a different noise sequence, since dry samples inside an active block advance the generator.) Practical
effect: renders and live output differ with the block size, sample-accurate events change the sound around them,
and tests that rely on the split contract cannot cover Color FX.

Proposed fix (verified): decide per sample; each art processes an active run and returns at the first dry sample;
the tail counter counts per sample.

```diff
--- a/djk/kern/dsp/include/cypherdj/dsp/colorfx.h
+++ b/djk/kern/dsp/include/cypherdj/dsp/colorfx.h
@@ -44,9 +44,9 @@ public:
 private:
-    void space(float* l, float* r, int n, const double* k);
-    void dub_echo(float* l, float* r, int n, const double* k);
-    void sweep(float* l, float* r, int n, const double* k);
-    void noise(float* l, float* r, int n, const double* k);
-    void crush(float* l, float* r, int n, const double* k);
+    int space(float* l, float* r, int n, const double* k);  // samples processed
+    int dub_echo(float* l, float* r, int n, const double* k);  // samples processed
+    int sweep(float* l, float* r, int n, const double* k);  // samples processed
+    int noise(float* l, float* r, int n, const double* k);  // samples processed
+    int crush(float* l, float* r, int n, const double* k);  // samples processed
--- a/djk/kern/dsp/src/colorfx.cpp
+++ b/djk/kern/dsp/src/colorfx.cpp
@@ void ColorFx::verarbeite(float* l, float* r, int n, const double* k) {
     if (art_ == ColorArt::filter) return;
-    bool aktiv = fahne_ > 0;
-    for (int i = 0; i < n && !aktiv; ++i) aktiv = std::fabs(k[i]) > kTotzone;
-    if (!aktiv) {   // bitgleich trocken; der nächste Einstieg beginnt mit leeren Zuständen
-        if (!ruht_) leeren();
-        return;
-    }
-    ruht_ = false;
-    switch (art_) {
-        case ColorArt::space: space(l, r, n, k); break;
-        case ColorArt::dub_echo: dub_echo(l, r, n, k); break;
-        case ColorArt::sweep: sweep(l, r, n, k); break;
-        case ColorArt::noise: noise(l, r, n, k); break;
-        case ColorArt::crush: crush(l, r, n, k); break;
-        case ColorArt::filter: break;
+    // Decided per sample, so that split calls are bit-identical: a sample with the knob in the dead zone and no tail
+    // running is dry (states cleared once); each art processes an active run and stops at the first dry sample.
+    int i = 0;
+    while (i < n) {
+        if (fahne_ <= 0 && std::fabs(k[i]) <= kTotzone) {
+            if (!ruht_) leeren();
+            ++i;
+            continue;
+        }
+        ruht_ = false;
+        float* li = l + i;
+        float* ri = r + i;
+        const double* ki = k + i;
+        switch (art_) {
+            case ColorArt::space: i += space(li, ri, n - i, ki); break;
+            case ColorArt::dub_echo: i += dub_echo(li, ri, n - i, ki); break;
+            case ColorArt::sweep: i += sweep(li, ri, n - i, ki); break;
+            case ColorArt::noise: i += noise(li, ri, n - i, ki); break;
+            case ColorArt::crush: i += crush(li, ri, n - i, ki); break;
+            case ColorArt::filter: return;
+        }
     }
 }
@@ SPACE (the same three changes in DUB ECHO, at its `fahne_ = ...(wiederholungen + 1) * ziel` line)
-void ColorFx::space(float* l, float* r, int n, const double* k) {
+int ColorFx::space(float* l, float* r, int n, const double* k) {
@@
             fahne_ = static_cast<int>(t60 * 1.2 * fs_);
+        } else if (fahne_ <= 0) {
+            return i;
+        } else {
+            --fahne_;
         }
@@
-    fahne_ = std::max(0, fahne_ - n);
+    return n;
 }
@@ SWEEP, NOISE and CRUSH: return type int, and in the sample loop right after `const double a = anteil(k[i]);`
+        if (a <= 0.0) return i;
@@ and at the end of each of the three functions
+    return n;
```

Consequence of the fix: a dry sample inside a block now clears the states like a dry block did before, and the tail
lasts exactly its nominal length after the last active sample. Existing tests (`test_colorfx`, `test_kanalzug*`)
pass unchanged with the fix.

### B2 (low): `ColorFx::leeren()` does not restore a fresh state

`leeren()` ("Alle Zustände leer") keeps the last side `seite_` and the NOISE generator `rng_`. After
`Kanalzug::zuruecksetzen()` or `zustaende_leeren()` the strip therefore does not sound like a fresh one: renders are
not reproducible after a reset, and SPACE / DUB ECHO run their side filter with the old side's coefficients for the
first dead-zone samples of a block.

Reproducer: `test_haertung_colorfx befund_colorfx_leeren` (48 kHz, 20 000 samples full-scale noise with the knob held
on the right, `leeren()`, then noise ±0.5 with k ramping from 0 to -1 over 2000 samples). Deviation from a fresh
object: SPACE 4.43e-5 (-87.1 dBFS), DUB ECHO 6.15e-4 (-64.2 dBFS), NOISE 0.048 (-26.4 dBFS); SWEEP and CRUSH 0.

Proposed fix (verified, independent of B1):

```diff
--- a/djk/kern/dsp/src/colorfx.cpp
+++ b/djk/kern/dsp/src/colorfx.cpp
@@ void ColorFx::leeren() {
     space_gefuellt_ = 0;
     fahne_ = 0;
+    seite_ = -1;
+    rng_[0] = 0x9E3779B9u;
+    rng_[1] = 0x7F4A7C15u;
     ruht_ = true;
 }
```

(Each entry into NOISE then starts the same noise sequence; if that is unwanted, reset the generator only in an
explicit reset instead of in `leeren()`.)

### B3 (low): SPACE clicks on every PARAMETER change

`ColorFx::space` computes the four FDN feedback gains from PARAMETER once per call; a `setze()` with a new
PARAMETER switches them at once, a step in every delay line.

Reproducer: `test_haertung_colorfx befund_colorfx_parameter` (780 Hz at -6 dBFS, knob held at ±0.8, PARAMETER
changed at 3 s). HF peak (click metric) around the change, against about -137 dBFS before it:

| Change | 44.1 kHz | 48 kHz | 96 kHz |
|---|---|---|---|
| 0 → 1, k -0.8 / +0.8 | -51.4 / -70.8 dBFS | -45.2 / -46.1 dBFS | -54.0 / -55.4 dBFS |
| 0.5 → 0.55, k -0.8 / +0.8 | -75.8 / -84.0 dBFS | -74.1 / -77.4 dBFS | -83.7 / -88.9 dBFS |

Even a small step of 0.05 lies 8 to 22 dB above the 16-bit step. Proposed fix (verified: worst -123.6 dBFS after it,
below the 16-bit step in every case): let the gains glide.

```diff
--- a/djk/kern/dsp/include/cypherdj/dsp/colorfx.h
+++ b/djk/kern/dsp/include/cypherdj/dsp/colorfx.h
@@ private:
     int space_gefuellt_ = 0;
+    double fdn_g_[kLeitungen] = {};  // feedback gains, gliding towards the PARAMETER target
+    bool fdn_g_gesetzt_ = false;
 };
--- a/djk/kern/dsp/src/colorfx.cpp
+++ b/djk/kern/dsp/src/colorfx.cpp
@@ void ColorFx::leeren() {
     space_gefuellt_ = 0;
+    fdn_g_gesetzt_ = false;
     fahne_ = 0;
@@ ColorFx::space(float* l, float* r, int n, const double* k) {
     const double t60 = 0.8 + 3.2 * p_;
-    double g[kLeitungen];
-    for (int i = 0; i < kLeitungen; ++i) g[i] = std::pow(10.0, -3.0 * fdn_len_[i] / (t60 * fs_));
+    double g_ziel[kLeitungen];
+    for (int i = 0; i < kLeitungen; ++i) g_ziel[i] = std::pow(10.0, -3.0 * fdn_len_[i] / (t60 * fs_));
+    if (!fdn_g_gesetzt_) {   // first sample after leeren(): start on the target
+        for (int i = 0; i < kLeitungen; ++i) fdn_g_[i] = g_ziel[i];
+        fdn_g_gesetzt_ = true;
+    }
+    const double g_gleit = einpol(0.05, fs_);   // PARAMETER changes glide (50 ms), no step in the feedback
@@
         for (int j = 0; j < kLeitungen; ++j) {
-            fdn_[j][static_cast<std::size_t>(fdn_pos_[j])] = static_cast<float>(g[j] * h[j] + ein[j & 1]);
+            fdn_g_[j] += (g_ziel[j] - fdn_g_[j]) * g_gleit;
+            fdn_[j][static_cast<std::size_t>(fdn_pos_[j])] = static_cast<float>(fdn_g_[j] * h[j] + ein[j & 1]);
```

### B4 (low): analysis-band records carry subnormal floats

During the decay after a signal stops, `k_leistung` (a power, so it falls twice as fast in dB) and in a few windows
also `band[]` are written as subnormal float32 values; the state flush (`< 1e-30`) runs only at the end of each call
and does not cover the written values. The analyser itself stays fast; every consumer that computes with these
values without flush-to-zero pays the denormal penalty.

Reproducer: `test_haertung_analyse_baender befund_analyse_subnormal` (1 s full-scale noise, then 30 s silence, blocks
of 1024): 35 records with a subnormal `k_leistung`, 6 with a subnormal band value. Proposed fix (verified):

```diff
--- a/djk/kern/dsp/messer/src/analyse_baender.cpp
+++ b/djk/kern/dsp/messer/src/analyse_baender.cpp
@@ int AnalyseBaender::verarbeite(const float* l, const float* r, int n, HuellenWer
       if (geschrieben < max_aus) {
         HuellenWerte& h = aus[geschrieben++];
-        for (int b = 0; b < kBaender; ++b) h.band[b] = static_cast<float>(std::sqrt(summe_band_[b] / (2 * kFenster)));
-        h.k_leistung = static_cast<float>(summe_k_ / kFenster);
+        // values below 1e-30 (-600 dB amplitude, -300 dB power) are written as 0: no subnormal float leaves here
+        for (int b = 0; b < kBaender; ++b) {
+          const double v = std::sqrt(summe_band_[b] / (2 * kFenster));
+          h.band[b] = v < 1e-30 ? 0.0f : static_cast<float>(v);
+        }
+        const double kl = summe_k_ / kFenster;
+        h.k_leistung = kl < 1e-30 ? 0.0f : static_cast<float>(kl);
```

Check before applying: the bit comparison with the Python reference (`messer/pruefung/bitgleich.py`) must apply the
same rule, or it will differ in these decay windows.

### B5 (low, config): limiter settings `abklingen_ms` and `decke_dbtp` are not validated

`anstieg` and `halten` are clamped or fall back to the default; `abklingen_ms` and `decke_dbtp` are used as given.
Reproducer: `test_haertung_master_limiter befund_limiter_einstellung` (3 s noise at ±4 = +12 dBFS):

| Setting | Output peak | Expected |
|---|---|---|
| `abklingen_ms = -50` | 7.67e24 (+497.7 dBFS): the gain runs away | <= -1 dBFS |
| `abklingen_ms = NaN` | 4.0 (+12.0 dBFS): nothing limited | <= -1 dBFS |
| `decke_dbtp = NaN` | 4.0 (+12.0 dBFS): nothing limited | <= -1 dBFS |
| `abklingen_ms = 0` | -1.92 dBFS (instant release) | fine |

Proposed fix (verified: -2.79 dBFS in all three cases):

```diff
--- a/djk/kern/dsp/messer/src/master_limiter.cpp
+++ b/djk/kern/dsp/messer/src/master_limiter.cpp
@@ MasterLimiter::MasterLimiter(const LimiterEinstellung& e) {
-  decke_ = static_cast<float>(std::pow(10.0, (e.decke_dbtp - kRundungsReserveDb - gitter_db) / 20.0));
+  const float decke_dbtp = std::isnan(e.decke_dbtp) ? -1.0f : e.decke_dbtp;  // like anstieg/halten: back to default
+  decke_ = static_cast<float>(std::pow(10.0, (decke_dbtp - kRundungsReserveDb - gitter_db) / 20.0));
@@
-  abkling_koeff_ = 1.0 - std::exp(-1.0 / (static_cast<double>(e.abklingen_ms) * 0.001 * 48000.0));
+  const float abklingen_ms = e.abklingen_ms >= 0.0f ? e.abklingen_ms : 50.0f;  // NaN and negative: default
+  abkling_koeff_ = 1.0 - std::exp(-1.0 / (static_cast<double>(abklingen_ms) * 0.001 * 48000.0));
```

### B6 (low, safety): the limiter ceiling breaks for input samples far above full scale

The moving average of the gain is a running double sum (`mittel_summe_ += neu - alt`) over `anstieg + 1` values.
When a single input sample needs a gain far below the rounding step of that sum, the sum cancels and the gain comes
out wrong, also negative (inverted output). NaN and Inf already count as 0, but a finite huge value (an exploding
upstream stage) passes the last safety stage above the ceiling.

Reproducer: `test_haertung_master_limiter befund_limiter_riesig` (noise at ±0.05 or ±0.1, one spike on L):

| Settings | Spike | Output peak | Sample at the spike |
|---|---|---|---|
| defaults (anstieg 64, ceiling -1) | 1e16 (+320 dBFS) | -13.6 dBFS | -0.209 (inverted) |
| defaults | 1e18 (+360 dBFS) up to FLT_MAX | **+30.1 dBFS** | -31.9 (inverted) |
| anstieg 1000, ceiling -20 | 1e12 (+240 dBFS) | -19.3 dBFS (0.7 dB over) | +0.108 |
| anstieg 1000, ceiling -20 | 1e15 (+300 dBFS) | -18.5 dBFS (1.5 dB over) | -0.119 (inverted) |

Up to 1e9 (+180 dBFS) the fuzz finds no violation with any setting. Proposed fix (verified: every case at or below the
internal ceiling, -1.13 / -20.13 dBFS; output for |x| <= 1e6 bit-identical to now):

```diff
--- a/djk/kern/dsp/messer/src/master_limiter.cpp
+++ b/djk/kern/dsp/messer/src/master_limiter.cpp
@@
 static constexpr double kB_Beta = 6.0;
+static constexpr float kGrenze = 1e6f;
@@ void MasterLimiter::verarbeite(float* l, float* r, int n) {
-    const float xl = std::isfinite(l[i]) ? l[i] : 0.0f;
-    const float xr = std::isfinite(r[i]) ? r[i] : 0.0f;
+    // NaN/Inf count as 0; beyond +-1e6 (+120 dBFS) clamped, so that the needed gain stays far above the rounding of
+    // the moving-average sum (otherwise the ceiling breaks from about +230 dBFS, B6)
+    const float xl = std::isfinite(l[i]) ? std::fmax(-kGrenze, std::fmin(kGrenze, l[i])) : 0.0f;
+    const float xr = std::isfinite(r[i]) ? std::fmax(-kGrenze, std::fmin(kGrenze, r[i])) : 0.0f;
```

## Observations (no bug, documented in the tests)

- **Kill click margin is small:** kill/mitte on and off reach -97.2 dBFS at the 04 stimulus, 0.9 dB below the 16-bit
  step (worst of the three rates). The bound is asserted; any change to the kill ramp should keep an eye on it.
- **Other controllers over their full range** (10 ms S-ramps, 20 ms filter smoother) stay below the stated bound of
  -60 dBFS but not below the 16-bit step: trim +24 → -24 -76.9 dBFS, filter -1 → +1 -69.3 dBFS, EQ -26 → +6
  -89.8 dBFS, fades to stumm -73.1 dBFS (the known B7 of `berichte/04-kanalzug-dsp.md`, -60 dB step to stumm). Jumps
  without ramp reach -38.7 dBFS (fader) and -41.7 dBFS (filter), so the -60 dBFS bound still separates ramps from
  jumps. The 16-bit step is required only for the kill ramp (F1); for the others it is a decision for M18.
- **DJ filter Q changed during playback** (`setze_guete` 0.707 → 4 at k = 0.5): the resonance is excited, peak 0.771
  against 0.670 settled, click -19.7 dBFS. Fine for a config value read at start; if `filter_guete` ever becomes live,
  it needs a ramp.
- **DUB ECHO beat change:** the one-pole glide of the delay changes the read speed at once (×3.3 for beat/2): a kink,
  HF peak -28.4 dBFS (left side) and -46.0 dBFS (right). Intended tape-like glide; a second-order glide would soften it.
- **Bare `Biquad`/`Lr8` without `DenormalSchutz`** reach subnormal states (88 million state samples over 60 s × 3
  rates); with the guard 0. The library relies on the guard in `Kanalzug`; any other user (14 builds its own biquads
  in `analyse_baender` and flushes them itself) has to set it.
- **NaN input latches** the Kanalzug filter states until `zustaende_leeren()` (as documented, Audit F01); the reset
  then gives a bit-exact fresh state.
- **`trim_aus_lufs(x, NaN)` returns NaN** (std::clamp passes NaN); harmless because `setze_sofort` drops NaN, but a
  caller that stores the value elsewhere gets NaN. A silent track (-inf LUFS) correctly gives +24 dB.
- **Limiter release with `abklingen_ms = 0`** is an instant release, not an error (coefficient 1).

## Outside the scope

- `regler_gegen_vertrag` fails before and after this work (normal and sanitizer build): `docs/architecture/INTERFACES.md`
  §1.5 now lists the kill ramps with 8.0 ms (library 5.0 ms) and a path `bk/<n>` that the library does not have. This
  is a drift between contract text and library, not touched here.
- Under the sanitizer build `test_waechter` and its mutation are not built (by design of the existing CMake: ASan
  replaces malloc), so the sanitizer suite has 41 tests instead of 43.

## Notes on the rules of this task

- Branch: the task named `cloud/haertung-dsp`; this session is bound to the branch `claude/dsp-test-hardening-o2zv2e`,
  where the work is pushed.
- Comments, test output and this report are English (repository rule `CLAUDE.md`, 2026-10-31: new code comments and
  log texts in English); identifiers follow the existing German scheme (`pruefe_*`, `befund_*`, `lauf`, `Zufall`).
- The messer tests are registered from the hardening block of the top-level `CMakeLists.txt` (the only CMake file this
  task may change). They compile the module source (`messer/src/analyse_baender.cpp`, `master_limiter.cpp`) into the
  test itself, so the sanitizer flags of `cypherdj_dsp` reach that code too; `cypherdj_dsp_messer` provides the rest.
- One problem in a new test was caught by the mutation runs during writing: an out-of-bounds read of `k` in
  `test_haertung_djfilter` hid the cache mutation; fixed before the first commit of that file (the sanitizer build
  would also have caught it).
