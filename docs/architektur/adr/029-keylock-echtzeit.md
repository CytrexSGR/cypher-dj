# ADR 029: Real-time keylock for all sources (one button, R3 in a work thread)

Status: implemented in branch `keylock-4` for decks and loop on the deck (tasks 1 to 5b, acceptance on target 4.2 and 4.3 on test instance g, 2026-10-08); loop boxes with task 7 (own branch, acceptance on target on test instance h 08.10., section
loop boxes). **Listening test outstanding** (task 4 step 4, Andreas;
material under `~/messungen/2026-10-07-keylock-echtzeit/task-04/hoerprobe/`). Not merged, operational core unchanged.
Partially supersedes: ADR 028 decision 4 (version swap for the pitch, expanded) and ADR 027 for everything except the
variant rendering of the loop boxes (which task 7 replaces; until then ADR 027 decisions 1 to 5 apply to the boxes).
Plan: `docs/superpowers/plans/2026-10-06-keylock-echtzeit.md` (version 4 and 4.1, overnight run, sawtooth finding).

Trigger: Andreas 06.10. ~21:25 CLI: "every dj software has a button that keeps the pitch the same over everything", "but rendering and swapping is really cumbersome?"; 07.10. ~05:45 CLI: "wtf, we discussed yesterday that we build a keylock for all sources and stop stretching every audio up and down".

## Context

Until now the decks kept the pitch only through a version swap: the workshop rendered a version at the target tempo,
the page swapped it onto a bar one (ADR 028 decision 4); until the swap and during every ramp, varispeed ran. The
loop boxes play a pre-rendered variant per resting tempo (ADR 027), and in ramps their pitch glides. R3 directly in the
audio callback was rejected by ADR 006 (p99.9 3.8 ms, maximum 14.7 ms per 256 block at a 5.33 ms budget). M3 measured R3 in
work threads with a lead-in ring: 4 decks, 5 min under load, 0 underruns, callback maximum 214 to 300 µs
(`messungen/M03-deck-echtzeit/laeufe/r3_je1_v{2,4,8}/`). M4 delivered the phase control (factor every 43 blocks, |c| ≤ 100
ppm, factor never 1.0) and the factor rule (map tempo in the middle of the next window plus lead).

## Decision

1. **One button, global.** Control `keylock` (switch, default 1, no deck argument, SCHNITTSTELLEN §1.5) for decks,
   loop on the deck and, from task 7, loop boxes. Off means varispeed (ADR 028 decision 1). `kern.toml keylock = false`
   builds no stretcher (§2.1). Page and control station show the button, the display follows the listening path (task 3, 3b).
2. **Stretcher (Dehner): R3 in work threads with a lead-in ring** (`dehner.h/.cpp`). Source-agnostic: band and base come through
   `DehnerQuelle`; the stretcher knows no deck. One work thread per source (SCHED_FIFO, JACK priority − 5, error path to
   SCHED_OTHER reported), one preparer for all, one watchdog reports a thread that does not acknowledge within 500 ms (task 2.5).
   The thread also fills while the deck stands still and during keylock (otherwise loading and unloading wait without limit, measured 21.3 s,
   version 4.1 point 2). Building after the first cycle in its own thread, only the stretcher memory is locked (2.5b, 2.5c).
   Factor and control per M4, counted in samples (`DEHNER_REGEL_TAKT` = 43 · 256); band start correction `dehner_versatz()`
   for decks 0 (decision 8, since keylock 4.6; until c06b2b8 a table over the factor 0.75 to 1.35, calibrated on the Hann click).
3. **Reading through the `StreckLeser`** (`streck_quelle.h`, since 633362d): approach, bridge, epoch, fades and seam at one
   place; the deck uses it, the loop box uses it in task 7 (no copy of the deck logic).
4. **Every event sets in at the sample.** Start, jump, ramp, restart, button on: approach with target sample
   `s_h = s + ANSATZ_FRIST` (4096 samples, 85 ms); until then the deck plays the varispeed bridge. The ring has not yet settled from `s_h`, the fade bridge → ring (960 samples) begins at `s_h + STRECK_EINSCHWING` (1408, measured on the click, version 4.1 point 1). Audible from about 115 ms after the event. On the base (factor 1) the direct path plays, bit-exact (R3 at factor 1 is not transparent, ADR 020), **for a source that sets in there, without the ring sounding.** Restricted with 7b.1 (08.10., decision of the main instance): if the map comes to the base while the ring sounds (ramp X → 128), the ring stays audible until the next event (start, stop, jump, load, grid, button);
   that freezes as always and sets in anew, then the direct path. Reason: R3 does not hold the phase of stationary tones, the linear
   960 fade ring → direct path partly cancelled (box sine 416 Hz smallest peak 0.27 instead of 0.5, ≈ −5.3 dB; deck
   213 Hz −12.6 dB, 1000 Hz −8.4 dB). Thus the ADR 020 statement "return to the base ends in the direct path" applies to the
   keylock only from the next event. The shadow computes in any case with 1 ± 10⁻⁶, the load stays the same.
5. **Render-and-swap dismantled** (task 3, 65f3587): `deck_keylock.ts`, `keylockTakt`, `rendereFassung`, `keylockRampe`,
   field `keylock` in `/lage`. `/k/deck/basis_tausch` and `werkstatt.fassung` remain as tools (ADR 028 status).
6. **Loop on the deck in the keylock** (task 5, 5b): the ring wraps in the thread like the deck, seam without rounding drift, the
   grid ends the ring loop.
7. **Loop boxes in task 7** (detailed cut `~/messungen/2026-10-07-keylock-echtzeit/task-07a/task7-final.md`): box as
   `DehnerQuelle` via the `StreckLeser`, variant path (`rendere_keylock`, `KlBox`, `START_HALTE_TAKTE`) removed. Until then the
   button on the boxes only acts as "no new variants" (§1.5). REC conversion when writing stays offline (ADR 027
   decision 6, version 4 point 4).
8. **Deck offset 0** (keylock 4.6, Andreas 08.10. ~08:45 CLI on the recommendation "table for the decks to 0": "ok yes"). Measured on three real drum loops (mfb, msgintro, boul) at 96, 110, 132, 140, 150, 172 BPM against the varispeed reference
   (`~/messungen/2026-10-07-keylock-echtzeit/task-04/drums2/BERICHT.md`): without correction closer to the beat in 18 of 18 cases
   (envelope onset 17 of 18), range −40 … +3 instead of −74 … +96 samples, mean magnitude 12.2 instead of 45.0. A table calibrated on drums was not covered (the two measurement methods contradict each other in their size). The Hann click has since lain by the R3-specific position next to the target (−96 at 96 BPM to +41 at 172.8, `task-01-fix/f3_versatz_roh.txt`); the core tests report its mean and check each click ±12 against raw R3 and, where it holds, against the target; the control in the ramp is checked by `test_dehner` test 12 with the mean ±3 against the ideal of the same click shape (4.6b), the decision itself test 13 (`dehner_versatz` = 0, Hann click 96 BPM at −96.2; red with the old table).

## Evidence

MEASURED, where not noted otherwise. Acceptance on target: test instance g (own ports, own null sink, tone guard, real-time lock), core from `keylock-4`, measuring tool `djk/kern/tests/deck/ziel_lauf.py` (4.1 277ec2e, 51190a4; 4.2 a90a7b4; 4.3
ba4f679). Raw data `~/messungen/2026-10-07-keylock-echtzeit/task-04/` (result per run under `laeufe/<lauf>/ergebnis.json`).

| What | Value | Limit | Source |
|---|---|---|---|
| Position per click, ramp 128 → 132 over 32 beats, keylock on | in the ramp max \|·\| 7.26 samples, afterwards 8.17; against the varispeed run max 8.07 | ±12 | `t42kla-…/ergebnis.json`, reference `t42-klick-aus-…` |
| Position on the base before the ramp (direct path) | 0.00 at 15 clicks | 0 | same file, `lage_basis` |
| Position, mean (click version, not Hann) | ramp −2.16, after the ramp −4.17 | reported | same file; with 4.6 identical click by click (approach at 128, correction there −0.004), `task-04/v46/laeufe/g46-keylock-klick-*` |
| Pitch, pure sine 1000 Hz, each 100 ms | max \|·\| 0.01 ct in 288 windows (ramp and after), 0 null runs | ±2 ct, 0 | `t42-sinusrein-an-…` |
| Failure case keylock off (control `keylock` 0 via `teil()`) | after the ramp +53.27 ct in all 140 windows (target 1200·log2(132/128) = 53.27); ring audible 0.0 | red, as required | `t42-sinusrein-aus-…`, `t42-klick-aus-…` |
| Real time, 4 decks in keylock, 300 s, 10 ramps between 130 and 136 | per deck `keylock_unterlauf` 0, `keylock_aufgegeben` 0, ring audible 100 % of 14.955 messages; `frame_luecken` 0; `cb_max_us` 1031 (p99.9 848, p50 558) | 0, 0, ≤ 2500 µs | `t43-echtzeit4-…`; load: loadavg 60 s before the start max 0.05, in the run vmstat idle min 75 %, r max 6 |
| Drum loop, position of the transients against the varispeed reference, with table (until c06b2b8) | 96 BPM +87.9 (span 94.7); 110 +44.7 (45.5); 128 0.00 (direct path); 132 −7.3 (10.4); 140 −18.9 (19.8); 150 −38.2 (50.2); 172 −58.9 (64.8) samples | reported, no limit in the plan | `t42-drums-tabelle.txt`, counter-check envelope `t42-drums-gegenprobe-huelle.txt` |
| same, three sources, with and without table | without: −40 … +3, mean magnitude 12.2; with: −74 … +96, 45.0; without closer in 18 of 18 | decision 8 | `drums2/tabelle.txt`, `drums2/vergleich.txt` |
| Counter-check 4.6 on target (mfb, core with offset 0) | 96 −7.5, 132 −2.1, 172 −26.8; pure sine in the ramp max 0.01 ct | as the test copy | `task-04/v46/laeufe/g46-*` (load 2.4 to 6.3, gate < 8) |
| Real threads against synchronous at the click | max deviation 0.0 samples over 88 clicks | – | `saegezahn/rohdaten.json` `kern_thread_vs_sync` |
| Settling | click shape disturbed up to 1280, from 1408 correlation ≥ 0.985 (with the old table); since offset 0 (4.6) from 1408 min 0.9804, limit in the test ≥ 0.95 | – | plan version 4.1 point 1, `task-02*/`; `test_deck_keylock` test14, `task-04/v46/test_deck_keylock_b.txt` |

Tests in the core (selection): `test_dehner` (task 1), `test_deck_keylock` (task 2, 5, 5b: position against raw R3, pitch, bridge,
base bit-exact, jump, stop, restart, loop), `test_kern_keylock_faeden` (2.5, 3: rampe, quittung, waechter, stopp,
prio, startfehler, spaet, neustart, knopf, loop), each with mutations that turn red.

## Discarded

| Route | Why not | Source |
|---|---|---|
| R3 in the audio callback | p99.9 3.8 ms, maximum 14.7 ms per 256 block | ADR 006 |
| Render-and-swap per tempo (ADR 028 decision 4) | Andreas: "very cumbersome"; pitch drifts until the swap and in every ramp | plan "Auftrag" |
| Button per deck (`deck/<n>/keylock`, version 3.1) | missed "one button that holds the pitch constant across everything" | plan version 4 |
| Keep variant rendering for the loop boxes | "no longer computing every audio up and down"; replaced in task 7 | plan version 4 point 3 |
| Fix the sawtooth in the Dehner (keylock stretcher instance) | cause is R3 itself (a bare R3 instance shows the same period); controller, offset, chain, threads and measurement each excluded with one run | plan "Finding: sawtooth" |

## Limits

1. **Sawtooth from R3.** The click position moves in a sawtooth, period roughly 7.75 beats at 132 BPM, span grows
   with |f − 1| (raw R3: 1.0125 3,8, 1.03125 11,8, 1.2 42.1 samples, `saegezahn/rohdaten.json`). At the target, after the
   ramp to 132: span 7.96 samples (0.17 ms). The carrying alignment measure is therefore per click against raw R3
   (core tests), or at the target against ideal and varispeed reference, not an absolute mean.
2. **Absolute alignment depends on the material.** With the table (up to c06b2b8, measured on the Hann click) the drum loop mfb lay at +88
   (96 BPM) to −59 (172 BPM). Since 4.6 (offset 0, decision 8) cross-checked at the target (`task-04/v46/laeufe/g46-drums-mfb-*`):
   96 BPM −7,5, 132 −2,1, 172 −26.8 samples, the same as the runs of the test copy without table (drums2: −7,5, −2,1, −26.8).
   Fast tempi remain early (all three sources at 172: −22 to −40). The Hann click now lies near the target (point 8).
3. **Mean after a ramp.** Click version after the ramp 128 → 132: mean −4.17; with the approach directly at 132 −1.99
   (finding: sawtooth). The offset applies fixed per approach at f0; a ramp afterwards does not re-approach (explanation derived, not
   measured).
4. **Stem handles** take effect in keylock after 102.5 ms (test 18 checks < 150 ms), version 4.1 point 4.
5. **Loop length with an uneven fpb** (base 124, 126, 130, 125.3 …) is rounded to whole frames: ring and deck wrap alike,
   but run together against the beat grid (up to ±0.47 frames per pass). Open, wave-2 loop model (E9), not keylock
   (`task-05b/p5_looplaenge_rundung.txt`).
6. **Crosstalk in the sine test.** With sine on the left and click on the right in the same material, the click disturbs the sine (R3 sums the
   channels): 1 of 288 windows 17.4 ct, a 10 ms piece 182 ct, phase before and after the same
   (`t42-sinus-an-…`). Pure sine 0.01 ct. Not yet checked. Since 4.6 the disturbance also hits one measurement window in
   `test_kern_keylock_faeden` (button, loop) (17.40 ct); there, windows with a click next to them count separately
   (labelled), the pitch without a click is checked by the tests with pure sine.
7. **Open:** ramp with threads versus synchronous at the click in the ramp; task 6 (planned events without a kink) only on Andreas'
   yes; sound (listening test).

## Consequences

- The pitch holds in ramps (0.01 ct at the target), not only after a swap. An event costs 85 ms of varispeed bridge and
  roughly 30 ms of settling before the ring sounds.
- Load: one R3 per deck in its own thread; with 4 decks in keylock at the target, callback maximum 1031 µs over 5 min.
- The loop boxes remain on ADR 027 until task 7; only then does "one button for all sources" fully apply. **Status of task 7 (branch
  `worktree-agent-a15c04f71e446464a`, not merged):** implemented, see section loop boxes.

## Loop boxes (task 7, 08.10.2026)

Each box has its own Dehner on a fixed slot (`KEYLOCK_QUELLEN = 6`: slots 1 to 4 the decks, 5 and 6 the boxes,
`dehner[DECKS + b]`; 8 threads, of which 7 SCHED_FIFO), band via `BoxBand` (loop wrapped, `box_anker`), loan at start and load (R-B1), return at stop;
the tail of a loop comes from the ring. The variant rendering (ADR 027 decisions 1 to 3 and 5) has been removed:
no variant, no waiting on load (up to 4 s), no holding until bar one (F14); `KeylockRender` now only computes the
REC conversion (ADR 027 decisions 4 and 6 apply). Offset 0 as for the decks (decision 8, extended to the box from
the main instance with "one keylock for all sources"); the extension of the table from task 7 step 2 is discarded.
Deviation from contract 4: if all 4 slots of a box's loan are lent out (`BOX_KEYLOCK_BAENDER`, without receipt from the
working thread), the box does not wait: it plays this loop in varispeed (`kein_platz` counts) and restarts only at the next
event (start, load, grid, button), not as soon as a slot is free (check task 7 m3: 2000 blocks = 10.7 s
without event in varispeed, only a grid restarts; test `leihe_voll`). `FREI_MAX 16` is the release ring of replaced loops
(E-m9), not the loan; if it overflows, `frei_verloren` counts (should be 0). New tone meter `tests/stretch-bench/keylock_ton_fenster.py` (100 ms
per window, step 50 ms; calibration: error ≤ 0.003 ct, hard cut 115 ms measured as 200 ms wrong sound; the old
`keylock_ton.py` did not see the same cut, median 0.00 ct).

Evidence (raw data `~/messungen/2026-10-07-keylock-echtzeit/task-07/`):
- Load (gate G1, `g1_1a_tabelle.txt`, `g1_1b_tabelle.txt`): offline N = 4, 5, 6, 8 sources, 60 s each: 0 underruns, render max
  ≤ 1504 µs; at the target 9 runs of 5 min each (100, 170, 128 BPM, ramp, boxes on/empty/silent), all limits green, cb_max 1031 to
  2346 µs; instrument check with a disturber red as intended.
  (Status before the merge of 4.6 and before 7b; the runs of 7b at the target: `task-07b/`, section below.)
- Tone (`step9_ergebnis.txt`): fixed 135 and 128, ramps 128 → 132 and 130 → 140: max 0.10 ct, no window outside ±2 ct.
  Against the old path (`step7_vergleich.txt`): old up to 11 ct for up to 6 s after the entry, 128 bit-identical.
- Real time 4 decks + 2 boxes, 5 min, 30 box events: cb_max 1207 µs, 0 underruns, 0 given up, ring_voll 0.
- 7b at the target (`task-07b/p5_ziel_ergebnis.txt`, test instance h): 128 BPM bit-identical to the old path (0 of 270 000); REC at 135
  with playback run through the Dehner, whose pitch at the target was **not measured** (the click measure is weak: at +2.5 ct,
  failure case button off +22.8 ct instead of +92), carried by K3 offline (±2 ct); first drum hit 80/96/100 BPM keylock against varispeed
  −0.50 / +0.13 / +0.35 dB.

Limits of the boxes:
1. **Bridge.** Loading into a sounding box and starting less than roughly 115 ms before the one sound 100 to 150 ms in varispeed
   (+78 to +92 ct at 135 BPM) before the ring takes over. The old path had the right pitch there, but the new loop only
   after up to roughly 5 s (Q1, listening test).
2. **Alignment.** Click loop 135 BPM at the target: mean +5,4, max 13 samples (12 clicks). Real drums (`step9_drums.txt`, mfb):
   keylock − varispeed −5.3 / −3.6 / −35.6 samples at 96 / 132 / 172 BPM, only 4 to 7 hits per tempo; in direction and size like
   the deck (−7.5 / −2.1 / −26.8). **Start from silence** (7b.2): slowly the ring lies early (Hann click 100 BPM −104, 80 BPM
   −217, 60 BPM −420 samples); up to 7b.2 the box opened only at the entry and cut the first click (100 BPM −11.2 dB,
   80 BPM −25.5 dB). Now the band delivers silence before the entry and the box hears the ring from E − 768: first click against the settled
   −0.12 … +0.29 dB, correlation ≥ 0,9992, alignment ≤ 2 samples against raw R3 (60 to 130 BPM, T4a). Real
   drums (mfb, offline, `task-07b/drums/drums_einsatz.txt`): first hit keylock against varispeed −0.68 … +0.12 dB (before
   −0.03 … +0.55). Price: the sine entry is for R3 a hard start of the tone; the first 100 ms window lies up to −4.5 ct
   (60 BPM), from 50 ms ≤ 0.57 ct.
2b. **Reach of the alignment** (7b.7): per click the box lies at 0.00 samples against an equally fed raw R3 from 60 to
   200 BPM (T5, offset 0 and 5000, limit ±2; `task-07b/p7_t5.txt`); the deck is measured against equally fed R3 only at 130 to
   200 BPM (`hoch-bpm/deck_echt.txt`), below that it is inferred from "the same code" (DERIVED). The earlier deviation
   above 180 BPM (190: 94 samples) was a measurement artifact: the reference fed R3 in fixed 256 blocks, the Dehner per
   `getSamplesRequired()`, and R3 is sensitive to block size at f ≈ 1.48 (`hoch-bpm/`). In absolute terms the Hann click lies slowly
   early: 60 BPM mean −389, max 474 samples (9.9 ms), 75 BPM −232, 100 BPM −90; fast late: 170 +35, 200 +42. The alignment of
   real drums is unmeasured below 96 BPM (alignment at the target only 96/132/172; at 80 to 100 only the energy of the first hit,
   offline and at the target, point 2).
3. **Return to the base** (ramp X → 128, decks and boxes). Up to 7b.1 the ring faded there linearly into the direct path and
   partly cancelled out (box sine 416 Hz, 140 → 128: smallest peak 0.2719 instead of 0,5, one window −13.99 ct; deck 140 → 128:
   213 Hz −12.6 dB, 1000 Hz −8.4 dB, noise −2.7 dB; `task-07-pruefung/qualitaet/proben/probe_deck.txt`). Since 7b.1 the
   ring stays audible (decision 4): box 130/140/150 → 128 smallest peak 0.4990 to 0,4997, every window ±2 ct (T10);
   deck 130/140/150 → 128 level ≥ −0.04 dB, max 0.019 ct (test 32; `task-07b/p1_*`). **Since 7c.4 (decision of the
   main instance, 08.10.):** (a) button off on the base while the ring is held: the ring stays audible (at factor 1 it sounds like
   the direct path); it ends only at the next event or when the tempo leaves the base (then normally into the
   varispeed path). Before this (re-check 7b C) the button collapsed there: sine 416 −4.92 dB, noise −3.81 dB in the deepest
   240 window; now −0.17 / −0.44 dB (box T19), deck −0.00 / −0.53 dB (test 32). (b) every freeze on the base (ring
   or fade slot → direct path) fades equally loud (sin/cos) instead of linearly: noise box grid −2.31 → −0.23 dB, deck jump
   −2.64 → −0.58 dB. **Limit remains:** a standing sine in antiphase still collapses further at the event (box grid sine 416
   −5.09 → −2.18 dB; deck jump sine 1000 −7.99 → −5.19 dB, 213 Hz −9.69 dB; test 32 and T19, `task-07c/p4_*`). The fade tests
   against the ideal linear transition (≤ 0.02) do not concern (b): they all lie outside the base.
4. **Box counters** (underrun, given up, ring_voll, kein_platz per box): since 7b.3 and 7c.3 respectively in `/zustand/box ,iiiiii`
   (SCHNITTSTELLEN §5.5b, additive, 50 Hz per box with a loop; test K4 in `test_kern_box_keylock` over the network, kein_platz with
   value 2, mutation `BOX_ZAEHLER_VERTAUSCHT` red; ring_voll only as a guard, always 0 in the test; `ziel_lauf_boxen.py` evaluates them in the
   gate). `frei_verloren` remains only as an access function.
5. **Not heard:** sound live against the offline render; material `task-07/hoerprobe/` (1 to 5).
