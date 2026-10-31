# Cypher-DJ: Architecture

*As of 2026-09-23, 03:30, synthesis of the architecture night. Basis: `00-anforderungen.md` (A1 to A26),
dossiers 01 to 06 and 08 to 10 under `dossiers/`, the interim measurements of the workshop under
`proben/07-werkstatt-zerleger/` (dossier 07 still missing), `tests/stretch-bench/ERGEBNIS.md`, the three
research reports of 2026-09-22, the three drafts under `entwuerfe/` and the three judges' evaluations. The
contract between the building blocks is in `SCHNITTSTELLEN.md`, each key decision as an ADR under `adr/`.*

*Rating per statement: **measured** (figure from a test run this night, place named), **sourced**
(source read), **calculated** (derived from measured figures), **assumption**, **unmeasured** (target value
or assumption that only a measurement can carry). Re-checks (NP, "Nachprüfung") exist for **01**, 02, 08, 09
and 10 and take precedence there (NP with number; the re-check of 01 has been pending since 03:29 and was
incorporated after the critique round). **03, 04, 05 and 06 are unchecked** and treated as such. All real-time
figures from this night were produced under external load of 19 to 70 on 16 cores on a null sink that itself
is clocked by the system clock (02 NP K6, 10 NP K8): they count as **provisional**. The critique round of
2026-09-23 (30 findings) is incorporated; what it changed and what was rejected is in the last section,
"Critique and corrections (2026-09-23)".*

---

## Summary for Andreas

1. The heart is its own program without browser and without window: a small core in C++ that alone keeps
   the beat. Everything else runs as a separate service alongside it; if one dies, the music keeps playing.
2. There is exactly one clock, the sample counter in the core. All others, me included, speak in beats,
   never in milliseconds.
3. Your hands go per MIDI straight into the core and always win: on the same sample, only at the control
   you grab.
4. I choose (which track, which style, which moment); the code calculates the transition, checks it
   beforehand and runs it sample-exact. How much I may do on my own, you set on the controller; start is
   "only suggest", and a stop key takes everything from me at once.
5. Never unheard: I measure every new piece, every new pattern and every new single hit at a silent tap
   before my plan opens it, also behind a closed crossfader; if I jump to a point on a deck that is already
   sounding, and that point I have not measured, it is always a suggestion to you. You pre-listen on your
   headphones; the "Listen to Cypher" key puts my suggestion on your cue.
6. At 128 BPM every deck plays a file rendered in advance at 128 with no stretcher. Rubber Band R3 only
   kicks in when the tempo deviates; if the set stays elsewhere for longer, the workshop re-renders (your A12).
7. Fresh AI songs pass through a workshop (tempo map, warp to the grid, stems, fingerprint) and land in the
   crate (Kiste) without a restart. Honest figure: a 3-minute song takes 14 to 22 minutes today on the GPU
   machine, so we order some tracks in advance.
8. If the core crashes, a Notbahn (fallback path) keeps the last bar playing smoothly until it is back on
   the grid, after about 40 ms plus loading time.
9. The first shared sound comes at a fixed 128 BPM, with a song that finishes during the set; tempo ramps
   with keylock come after that.
10. None of this has been checked on the real interface or with your ear. First come measurements and a
    listening session with you, then the expensive parts.

---

## 1. Where this version came from

**The basis is the draft "AI co-play first"** (`entwuerfe/entwurf-ki.md`). It has the highest weighted total
with all three judges (70.75 / 69 / 68.25 against Robust (robustness first) 67.5 / 68.25 / 66.75 and Spiel
(play) 62 / 64.75 / 64.25). It delivers the core goal A1/A2/A13 earliest, meets A4 most literally (measuring
tap separate from the cue) and labels the LLM figures most honestly. From the other two drafts comes what
all three judges unanimously recommend:

- **From "robustness first" the core and operations part:** no third-party code in the core process,
  Notbahn with crossfade, watchdog only on real-time progress, clock "continuous inside, re-anchored
  outside", chaos test bench with its own null sink per run as acceptance for each slice, commitments as
  numbers, measurement list with a tipping column, immutable inventory, loading from the crate even without the
  control centre;
- **From "playability first" the deck and hand part:** no stretcher in the listening path at factor 1, latency
  budget from the grab to the sound as an acceptance quantity, roll behind the keylock (after measurement M6),
  controller assignment with a bass-swap key and a style macro, grid by hand (nudge, tap), holder also for
  discrete deck grips, the "Listen to Cypher" key.

Where the judges contradict each other (which draft is the basis, order of the slices), ADR 021 decides, with
evidence. All other contradictions are listed in section 12.

**New compared with all three drafts** (partly noted by the judges, partly checked today):
- According to skill `cypher-musik`, generation does not run on the DJ machine but on the GPU machine (ComfyUI
  instance `GPU-Maschine:8288`, GB10 with shared memory), and there it costs today 4.7 to 7.2 s of compute per
  second of music, measured under external load; model loading takes 65 to 80 s warm, 284 s cold (sourced:
  skill `cypher-musik`, section "Die Zahlen, mit denen du planst" ("The numbers you plan with"), where it is
  listed as an operational finding, not re-measured today). A rented L40S manages 1.35-times real time (skill
  `cypher-musik-mietgpu`, line 8). This makes the graphics memory question on the DJ machine (12 282 MiB, up
  to 11 218 occupied by others, 10 §3a) only a question of stem separation, and "live generation" means
  ordering with minutes of lead time (ADR 022).
- `c_drift.log` now has an eighth MiniMax song: `sofa-abend.mp3` with a median of 906.3 ms/min, 60-s maximum
  1236.6 ms/min, pulse clarity 0.06 (measured, log state 02:59). The metric is the median of the absolute
  values of 60-s slopes from 8-s phase windows (`c_drift.py`, function `miss`); at pulse clarity below 0.1 it
  cannot separate measurement noise from real drift, and a control with a rigid grid and weak pulse is
  missing (calculated and read from the code, assumption about the size). Consequence for the architecture:
  the tempo map of generated songs can be roughly wrong, hence gates in the workshop, measurement at the
  output after the warp, tap and nudge by hand (ADR 011, M13).
- The 10 valid tool calls from 09 NP K11 ran at 7 to 23 thousand tokens of context (`llm_x_mcp_sonnet_low*_ergebnis.json`,
  field `cache_gelesen`); at 259 266 tokens only the text answer was measured (0 of 5 valid). The choice at
  1.307 to 1.437 s was likewise measured only as text (`llm_x_wahl_sonnet_low_ergebnis.json`: `init_tools`
  empty). Both are unmeasured as a tool call (M15).

---

## 2. Process picture

```
 ZEIT-      PROZESS (systemd-User-Unit unter cypherdj.target)              RT    STIRBT ODER HÄNGT ER, DANN ...
 HORIZONT
 ─────────  ────────────────────────────────────────────────────────────  ────  ──────────────────────────────────
 vor/nach   Hauptinstanz Cypher (Opus, CLI, Gedächtnis): Rollenprompt,     nein  nichts im Set
 dem Set      Lernmodell, Nachbereitung, A/B-Paare rendern lassen
 Phrasen    cypherdj-spieler: Treiber + warme Sonnet-Sitzung               nein  Frist-Wächter im Kern, Andreas spielt
 (8-32 T)     ▲ Zug-Anfrage (WS)    │ MCP-Werkzeuge (stdio)                         allein weiter
              │                     ▼
            cypherdj-mcp (Node, Kind der Sitzung) ─ WS ─┐                   nein  Cypher blind, Musik läuft
 Takte      cypherdj-leitstand (Node/TS) ◄──────────────┘                   nein  keine neuen Pläne; angenommene Teile
 (1-16 T)     Annahme, Verriegelung, Hörschein-Register, Kopplung,                laufen im Kern zu Ende
              Autonomie, Zug-Takt, Lage, Kiste, Journal, WS-Hub
            ├ cypherdj-rechner (Python): Passung, Kandidaten,              nein  keine Kandidaten: Cypher darf nur
            │   Spielart-Regel, Vorhersage, Lernmodell                            ausblenden, nicht einblenden
            ├ cypherdj-analyse (Python): Takt-Bericht, Hörschein           nein  keine Hörscheine: nichts Neues wird
            │   (liest Hüllkurven aus /dev/shm)                                   durch Pläne hörbar, Hand frei
            ├ cypherdj-werkstatt (Python) + Jobs (Nice 19, batch)          nein  kein neues Material, Set läuft
            │   Tempo-Karte, Warp, Stems (CPU bei 256; GPU nach Frage 4), Fingerabdruck,
            │   Tore, Nachrendern; Generierung per HTTP an `GPU-Maschine:8288`
            │   später: cypherdj-zerleger (zweite Sonnet-Sitzung, A13)
            ├ cypherdj-erzeuger@strudel (Node, später)                     nein  Muster bis zum Horizont, dann Stille
            └ Ansage-Zeile (Terminal, liest WS), später Oberfläche          nein  nichts Hörbares
                   │ OSC/UDP 127.0.0.1:47100, Befehle mit Ziel-Beat
                   ▼   ▲ /q, /uhr, /zustand, /takt, /e/* (OSC an Abonnenten)
 Zyklus     cypherdj-kern (C++20, JACK-Client unter pw-jack, FIFO 83)      JA    Notbahn spielt weiter, systemd
 (256 =       ═══ DIE EINE UHR: int64-Sample-Zähler + Tempo-Karte ═══           startet neu, Kern setzt aus
 5,33 ms)     Stellwerk-RT (Regler, Halter, Rampen, Invarianten,                 /dev/shm auf dem Raster fort
              Frist-Wächter), Decks (Band, Direktweg, Schatten-Stretcher
              in Arbeits-Threads), Kanalzüge, Mixer, Cue, Mess-Abgriff,
              Messer, Lader (mmap+mlock), MIDI ein und aus
               │ /dev/shm/cypherdj/bus (Master+Cue)   ▲ node.async-Rückwege (später)
               ▼                                      │
            cypherdj-notbahn (C, klein)                JA    Stille bis Neustart: darum winzig
              1 Block versetzt, Blende, Schleife ≤ 8 Takte, Riegel
               ▼
            Interface: 1/2 Saal, 3/4 Kopfhörer ──► cypherdj-aufnahme (C)   JA    Aufnahme fehlt, Ton nicht
            später: cypherdj-klang@sunvox, cypherdj-wirt@<gruppe>         JA    nur ihr Anteil fehlt (M7)
                    (eigene JACK-Clients, Rückweg node.async + Puls)
                    cypherdj-link (Brücke, liest /uhr)                    nein  Außenwelt verliert Sync
 Sample     ANDREAS' HAND: USB-MIDI → ALSA → PipeWire-Midi-Bridge → JACK-MIDI mit Sample-Versatz → Kern
```

The characters and paths in detail: `SCHNITTSTELLEN.md` §2 (transports, ports, paths). The "own app" in the
sense of A25 is this assembly of processes, started with `systemctl --user start cypherdj.target`; a user
interface comes later as another, read-only process (ADR 001, 019).

### 2.1 Processes

| Unit | Technology | RT | Task | Evidence for the cut |
|---|---|---|---|---|
| `cypherdj-kern` | C++20, libjack (pipewire-jack 1.6.8), librubberband 3.3.0, Bungee 2.4.30 (second engine), libebur128 (source, MIT), nlohmann/json and toml++ as single headers, Faust-C++ at build time; no `dlopen` | yes | clock, Stellwerk-RT (interlocking, real time), decks, mixer, cue, measurement tap, meters, loader, MIDI | 01 §3.2 (callback 0.77 µs mean, 6.9 µs max, 0 dropouts in 5 min at 128 and 256; **rated after 01 NP point 2 and K9: the platform serves an almost empty callback reliably, core load only shows in the R3 runs**), 01 test e1/e2, 10 §5 |
| `cypherdj-notbahn` | C, under 200 lines (template `proben/10-robustheit-betrieb/src/notbahn.c`), ports and release as call parameters of the unit, no configuration file | yes | last mile, fade, loop from own history with bar length from the ring, lock against unrequested sound | 10 test c, NP N1/N2 |
| `cypherdj-leitstand` | Node 22.23 / TypeScript, `ws` 8.21.3 | no | acceptance, interlocking, listening-certificate register, coupling, autonomy, move cadence, crate, journal | 09 §3.3, NP K1/K2 |
| `cypherdj-spieler` | Node driver + `claude -p --input-format stream-json`, Sonnet, `MAX_THINKING_TOKENS=0` | no | Cypher in the set | 09 §3.2, NP K6/K7 |
| `cypherdj-mcp` | Node, `@modelcontextprotocol/sdk` 1.30.0, child of the player session | no | tools for Cypher | 09 §3.5 |
| `cypherdj-rechner` | Python 3.12 (NumPy, SciPy, torch, scikit-learn; `fa.py`) | no | fit, candidates, play-style rule, prediction | 08 §3.3, NP K1/K2 |
| `cypherdj-analyse` | Python 3.12 (template `probe_c_live.py`), later C++ | no | bar report, listening pass | 08 §3.3.6, 4.f (Python block p99 15.2 ms: not in the callback) |
| `cypherdj-werkstatt` + `cypherdj-werkstatt-job@` | Python (new venv with `--system-site-packages` on the system's CUDA torch 2.10.0, plus demucs 4.0.1, beat_this 1.1.0, Essentia 2.1b6; the test venv has only torch 2.5.1+cpu, measured), rubberband library and CLI, ffmpeg | no | import up to inventory, re-rendering, correction versions, trigger generation | 07 logs, 08 NP K5, 10 §5 |
| `cypherdj-aufnahme` | C (template `proben/01-audio-kern/a-cpp-jack/aufnehmer.cpp`) | yes | master and cue at the Notbahn outputs | 01 §4.4 (pw-record loses blocks, JACK recorder 0) |
| `cypherdj-zerleger` (slice 6) | second Sonnet session with workshop tools | no | A13: splitting as a role, judges loops, names, warnings | A13 verbatim |
| `cypherdj-erzeuger@strudel` (slice 7) | Node, `@strudel/core`/`mini` 1.2.6 only `queryArc`, worker without rights | no | patterns to windows with beat stamp | 06 test a |
| `cypherdj-klang@sunvox` (slice 7) | C++ around `sunvox.so` 2.1.4d, `node.async` | yes | synth sound from core events | 06 test b, ADR 010 |
| `cypherdj-wirt@<gruppe>` (slice 8) | Carla 2.5.8 as a library, own `HOME`, Xvfb, `node.async` | yes | instruments, send effects | 05 §4.5, 10 NP N9, ADR 009 |
| `cypherdj-link` (later) | C++, Ableton Link SDK 4.0 | no | tempo and phase to the outside | 02 §3.3, ADR 004 |

---

## 3. Building blocks with technology and evidence

### 3.1 Core

**Technology:** C++20, JACK API under `pw-jack`, one real-time callback (SCHED_FIFO 83, assigned by PipeWire,
01 §3.2) plus work threads for the stretchers (lower real-time priority, `ulimit -r` 95, 10 §3a) plus
non-real-time threads (UDP receive, send thread, loader, LUFS thread, state writer, watchdog ping). No allocation, no lock, no I/O, no `dlopen` in the callback; checked by an allocation and lock guard in test operation and long-running load tests in the chaos test bench (ADR 002, 016). The core connects its
ports itself with JACK names (under `pw-jack` the null sink is called `cypher-stumm-probe`, 01 §3.2 trap).

**Contains:**
- **Clock** (§4): own sample counter plus a limited tempo map, anchor in `/dev/shm`.
- **Stellwerk-RT:** control table with holder (`frei`, `mensch`, `plan:<id>`), ramps and setting in beats,
  discrete deck parts, hand arbiter (scaled, relative, first value only position, dead zone 3/128),
  runtime invariants I1 to I4 and deadline guard (ADR 023). Template `proben/09-ki-steuerung/stellwerk.mjs`
  with 12 tests plus the attack cases from 09 NP (`angriff.mjs`) as regression. The JS prototype cost on
  average about 2 µs of algorithm per block, but in the worst block 7.053 µs (JS runtime, 09 NP b3): hence
  C++.
- **Decks 1 to 4** (ADR 007, 020): band before the stretcher following the Mixxx pattern (loop, band roll with shadow,
  beat jump, hot cues, every command with a target beat; 03 §3.2, test 4d: band 0.0 frames deviation, R3 kicks after
  roll −0.00 samples). Three listening paths: **direct** (set tempo equals base of the file, bit-exact, no stretcher),
  **shadow stretcher** (R3, warm, takes over on deviation with a 20 ms cosine fade), **roll buffer** behind
  the keylock (slice 5, after M6). Stems are mixed before the stretcher (at most one stretcher per
  deck); if the version has stems, the stem sum sounds, otherwise the base file (switched only at loading).
  Phase control per deck against `sample_at` on the stretcher path (02 NP K3/N5). Stretcher (provisional, see ADR 006 addendum 2026-09-23): at most 2 R3 per
  work thread (01 NP K1: 8 R3 with two phases in pull mode 377 overruns in 60 s), created and run through
  once in the loading thread (01 NP K3).
- **Channel strips** for decks, generator channels, pads and four group buses: trim (from `ziel_lufs`), LR8 isolator
  246/2484 Hz with kill (second-order ramps), TPT filter on a control, PFL tap and measurement tap after the filter
  before the fader, fader, crossfader assignment, four sends after the fader, target master or bus (assignment table,
  A17; ADR 008, `SCHNITTSTELLEN.md` §1.5).
- **Master and cue:** sum, FX buses (beat-synchronous echo as a hybrid from the clock, reverb as a Faust block),
  master limiter with lookahead, cue delayed by the same lookahead, headphone mix and split as in Mixxx.
- **Meters:** per channel peak, true peak, LUFS M/S (libebur128, meets the EBU target to 0.007 LU, 04 §4.7),
  three band levels from the isolator for display; envelopes of the **six analysis bands** (sub to high, 08 §3.3.1)
  with 1 kHz into a ring in `/dev/shm` for the analysis (`SCHNITTSTELLEN.md` §6.2; the earlier version delivered only
  the three isolator bands, from which the six bands of bar report and listening pass cannot be computed).
- **Loader** (non-real-time): fade material from the working inventory `/dev/shm/cypherdj/material/` in via `mmap` and
  `mlock`, check (rate, channels, length, NaN, checksum), hand the pointer to the callback, release only after return.
  Cost 0.050 to 0.056 ms per MiB, 3 GiB 156 to 161 ms (10 NP N8). Budget
  locked below 4 GiB with unloading (10 test d: 4200 MiB fails; NP K7 `MCL_FUTURE` trap).
- **MIDI:** hand input (JACK MIDI with sample offset), LED return path, later outputs to sound host,
  plugin host and devices (MIDI clock).

**Evidence for the overall form:** 01 §3.9 and §6.1 (one real-time core with satellites; control dies: 51 of 51
beats continued exactly, e2); 10 §5 (unit cut). **A:** A1, A4, A5, A6, A9 to A12, A14, A15, A17, A20,
A21, A23, A25. **Status:** individual parts measured as tests, the core as a whole is still to be built.

### 3.2 Notbahn (the fallback path)

Its own C process; reads the master and cue ring of the core from `/dev/shm/cypherdj/bus` one block
offset and passes it to the interface. If the core's write counter stands still (crash or hang), it loops
the last bar, **with a fade at the seam** (default: one further block, together two blocks of latency),
at most 8 bars, then fades out over 2 bars and reports. NaN/DC/clip lock as the last stage. It reads the
bar length from the ring header (`takt_frames`, `takt_anfang_w`, written by the core each cycle), the
loop plays them from its own history of at least 384.000 frames; the template took a fixed
`--bpm 128` and would have lost the grid at any other set base. Ports as call parameters of the unit, only after the
lock against unrequested sound (`SCHNITTSTELLEN.md` §6.1, §8).
**Evidence:** shared-memory Notbahn 0 ms silence in 5 of 5 crashes and 4 of 4 hangs, NP 5 of 5 and 2 of
2; edge Notbahn on hang 181 to 216 ms silence (10 test c, NP); hard seam 13 of 14 takeovers
with a jump, with real music 47 % audibly bright, with a 128-sample fade 11 % (10 NP N1/N2, offline); latency of the
ring exactly one block (255.88 against 127.83 samples). **Unmeasured:** fade online (M2). **A:** A1, A3,
A20. ADR 016.

### 3.3 Control stand (Leitstand)

Node/TypeScript. Accepts plans and choices, locks them (form, too late, control with the human,
overlap, listening pass, autonomy), assigns couplings (bass-swap pair, "A out" to "B in"), keeps the
listening-certificate register, sends move requests to Cypher, holds the crate and the set journal, distributes the
bar state via WebSocket. **Evidence:** 09 §3.3 (six guiding principles, 12 tests, mutations turn red), NP K1
(0 of 105 LLM plans couple), K2, K5, K16 (one plan form). **A:** A1, A4, A6, A7, A15, A16. ADR 013, 023.

### 3.4 Cypher in the set: player, MCP, planner

- **Player:** Claude Sonnet in a warm session per set, lean role prompt, `MAX_THINKING_TOKENS=0`,
  warm-up turn before the set. Called by the bar (turn request 8 bars before the earliest start and on events),
  never the other way round. **Choice instead of plan:** Cypher answers with `waehle{material, spielart, start_takt,
  hoerschein, absicht}` from candidates that the planner has prepared (`hoerschein` = audition permit); free plans (`plan_einreichen`) are
  the exception.
- **Planner (Rechner):** turns the playing style (parameter set) into the plan parts according to exactly the measured rule of thumb
  (`SCHNITTSTELLEN.md` §14.4), lets them be predicted via cross-energies of the real mixer filters, checks against the
  sub limit; the optimizer remains an option until Andreas' A/B verdict lets it win.
- **Evidence:** choice as text 1.307 to 1.437 s, 5 of 5 valid (09 NP K7); free plan via the tool only
  after 4.5 to 8.7 s at the control room (NP K6), response deadline of the contract 4 bars (7.5 s at 128); the rule of thumb halves
  the sub compared with the optimizer (0.082 against 0.135 at limit 0.10), but in the other bands it exceeds the
  limits (low 0.402 at limit 0,20, low-mid 0.951; "hard" low 0.355 at 0.35; 08 NP K1): therefore only the
  sub limit locks, the low limits warn until M20; realistic prediction error with keylock 0.038 overlap,
  0.41 LU (08 NP K2). **Unmeasured:** choice as a tool call, turn time and cost over two hours (M15).
- **A:** A1, A7, A8, A15, A16. ADR 013, 012.

### 3.5 Analysis

Block-rate DSP (bands, envelopes, LUFS) sits in the core; the bar-end evaluation runs in `cypherdj-analyse`
(Python), which reads the envelopes from `/dev/shm/cypherdj/huellen`. Per bar: bands per channel, overlap per
band, **offset per deck against its reference** (checks the execution) **and hits deck against deck** (checks
the grid, because the reference offset does not see a wrong grid), loudness, bar, phrase, deadline.
From this, the **listening pass** of a pre-listened channel after 4 bars of measurement, afterwards **renewed after every bar**, as long
as the channel runs in sync (otherwise in normal flow it would expire exactly at the start, §5.1). The listening pass binds the channel and
**content** (material and version, shot or pattern), and for decks the measured source beat range; I3 thus checks
new content on already open channels too (`SCHNITTSTELLEN.md` §17). Deck against deck is
mandatory for generated material. The six bands come from the envelope ring; the reference `huelle_1khz.npy` is computed with the same filters.
**Evidence:** 08 §3.3.6, probe 4c
(built-in offset of 20 ms arrived as 20.0 to 21.9 ms), 4.f (bar evaluation max 34.8 ms, NP 20.6 ms: above
the block budget, so a separate process), NP K4 (after grid correction MFB median 10.4 ms too early, 66 % of the
hits in the flam range; the reference offset does not see this). **Unmeasured:** listening pass thresholds (M18).
**A:** A4, A15, A20. ADR 012.

### 3.6 Werkstatt (workshop), generation, inventory

- **Werkstatt (workshop)** (Python, `Nice=19`, `CPUSchedulingPolicy=batch`, `IOSchedulingClass=idle`, few threads):
  chain per song: decode, −12 dB headroom, beat grid, tempo map and **bar one** of the source (beat_this, second
  tool Essentia or low-band energy), half or double tempo choice, R3 warp via timemap onto the rigid grid
  of the set base (library or `rubberband -3 --timemap`, float) with tuning correction to 440 Hz in the same run,
  stems (in the set on the CPU only at quantum 256 with Nice 19; on the DJ machine GPU only after Andreas' answer to question 4
  and M9; at 128 never on the CPU), fingerprint in beat time, cross-energies, reference envelopes (six bands)
  from what sounds, structure, hotcue suggestions at phrases from bar one, single hits, **gates** (grid residue of
  **independently measured** hits after warp, pulse clarity ≥ 0.1 without exception, stretch factor ±15 %, bar one,
  headroom), atomically as a **version** into the inventory, `material_fertig`. Queue with priority: 1 re-rendering
  of loaded decks onto a new set base and correction versions, 2 ingesting fresh songs, 3 reserve.
- **Generation:** order `erzeuge` to the ComfyUI instance of the GPU machine (MiniMax Music 3), result via HTTP
  to the DJ machine, then the workshop. With a lead time of minutes (ADR 022).
- **Inventory:** one folder per material, keyed by content hash, with `original.*` and `material.json` (written once),
  `korrekturen.jsonl` (the only appendable file) and per render one immutable **version**
  `fassungen/<bpm·1000>_r<n>/` (raw float32, 48 kHz, stereo, interleaved; stems, shots, `fassung.json`,
  fingerprint, cross-energies, reference envelopes). The core never decodes. **Working inventory** and **crate (Kiste)** in
  `/dev/shm/cypherdj/` (ADR 015). The loudness is set by the core on loading as trim = `ziel_lufs` − LUFS of the version
  (default −16 LUFS, trim up to +24 dB): the ten MiniMax songs lie at −13.6 to −15.5 LUFS, the club track MFB at
  −7.5 LUFS (measured 2026-09-23, offline and silent with `ffmpeg -af ebur128=peak=true` on `samples/bestand/*.mp3` and
  `stems/mfbass/orig.mp3`, all eleven values; peaks of the MiniMax songs up to +0.6 dBFS); with −12 dB headroom and +12 dB trim no target above
  about −15.5 LUFS would have been reachable for all.
- **Evidence:** 07 `b_timemap.log` (drifting click: residue 0.19 ms RMS with timemap, 45.26 ms without; R2 1.94 ms;
  **classified: timemap mechanics with known ground truth**, the timemap comes from the true hit times of a
  synthetic click; via the tempo map from beat_this on MiniMax songs it says nothing, M13 measures that),
  `b_strecken.log` (R3 holds 110.000 Hz, only factor 134/128; 15-s loop 0.64 to 3.21 s under load), `c_drift.log`
  (MiniMax pulse clarity 0.03 to 0,24, 8 of 10 below 0.1; source BPM 89.905 to 180.709; drift figure 9.6 to
  183.1 ms/min (minimum corrected 2026-09-23 after dossier 07) and 906.3 ms/min at `sofa-abend`), `pip_torch.log` (torch, demucs, beat_this, Essentia installed in the venv;
  torch there only 2.5.1+cpu, beat_this and Demucs never run with real weights, measured 2026-09-23); 08 NP K5 (command line clips at
  ±1.0 even with `--ignore-clipping`, MFB up to +5.09 dBFS: −12 dB headroom), 08 NP "Was fehlt" 6 (fingerprint
  of an 8-minute song 54.14 s plus cross-energies 21.14 s on one core), 10 NP N6 (HTDemucs on the CPU:
  55 % of the 128 period, 15 % at 256; random weights, 8 threads), 10 probe b L2 (16 × R3 offline next to the
  measurement client: 0 gaps at 128). **Unmeasured:** grid and bar one on real MiniMax songs after warp (M13), end to
  end and BPM fidelity of MiniMax (M14), keylock at stretch factors beyond ±5 % and tuning correction (M19), stems on
  the DJ machine GPU next to the core including graphics memory of the real chain (PyTorch Demucs according to research roughly 7 GB,
  undated; foreign use this night 7 786 to 10 832 of 12 282 MiB) and job start and end (M9).
  **A:** A2, A10, A12, A13, A16, A19. ADR 011, 015, 022.

### 3.7 Recording and journal

`cypherdj-aufnahme` records master and cue **at the Notbahn (fallback path) outputs** (that is, what really sounds,
including Notbahn loops) and writes which core sample is the first frame. The control room writes
the set journal (JSONL on the sample clock: every command with receipt, every manual action, every plan with
reasons, every listening pass, every turn request with response time, every verdict). **Evidence:** 01 §4.4 (JACK recorder
0 losses, `pw-record` 4 blocks), 09 §3.8, NP K12 (0.59 MB per hour for bar lines with 4 controls).
**A:** A1, A16. ADR 008, 015.

### 3.8 Controller

USB-MIDI class device → ALSA → PipeWire MIDI bridge → JACK MIDI input of the core, no detour via Node.
Mapping as a file; first value per control only as position; dead zone 3/128; scaled for pots and faders,
relative for endless encoders; buttons for accept, discard, "Cypher, proposal", "Cypher listen", stop,
release, verdict, autonomy level, bass swap, playing-style macro, shift plus tap for bar one; LEDs for
holder, listening pass, proposal,
deadline countdown, Notbahn. Loading from the crate also with a dead control room. **Evidence:** 09 probe c and NP (5.326 ms
at 256, spread 0.060 ms, 300 of 300, software sender), NP K3 (jump 0.3675 at unknown position), K4
(one noise step breaks off the AI run); `hidapi` missing on the DJ machine (09 §3.7). **Unmeasured:** Andreas'
device (M17). **A:** A1, A5, A7, A14, A26. ADR 014.

### 3.9 Later: generators, hosts, link

- **Generators** (A21, A22): Strudel core as `queryArc` in its own unit, window "replace" with a beat stamp
  two bars ahead directly to the core (06 probe a: 295 of 295 frame-exact; node 6 s sluggish: exact up to the horizon,
  then silence instead of a surge); score sheet as shared text (06 probe c); SunVox in its own
  sound host (ADR 010). Every generator is a full channel in the core, whose fader starts at −200 dB and rises only
  with an listening pass (09 NP K10); a new pattern on an open channel plays only with an listening pass for this
  pattern (I3c), new patterns are pre-listened on a closed channel.
- **Plugin host** (A18): Carla as a library in its own unit, return path `node.async` with a pulse port, notes and
  CC as JACK MIDI with sample offset from the core (05 §4.4: 0 to 3 samples; OSC 1.67 to 37.58 ms); every
  slot is measured through by click on loading (05 §4.2). Only after M7 in the mix (ADR 009).
- **Link and MIDI clock** (A20 outward): core leads, Link in a bridge unit, MIDI clock from the core;
  JACK transport never (ADR 004).

---

## 4. The one clock and the time base

**Where:** in the real-time callback of the core. The clock is its own `int64` sample counter (sum of `nframes`)
plus a tempo map made of segments (constant or linear in time; S-shaped corners only after V1). Beat, bar, phrase
and deadline are functions of it:

```
beat(s)   = b0 + (bpm0·dt + k·dt²/2) / 60              dt = (s − s0)/48000,  k = (bpm1 − bpm0)/T
sample(b) = s0 + 48000 · 120·(b − b0) / (bpm0 + sqrt(bpm0² + 120·k·(b − b0)))
```

(02 §3.1, `kern/uhrkern.cpp` lines 72 to 88; forward and back conversion to 5.7·10⁻¹⁴ beats, 02 check d; an
independent Python implementation hit the bar clicks of the C++ core on the sample in five runs of 101 out of 101
each, 02 NP). The sample clock is supplied by the interface's crystal as the driver of the graph; musical time comes
solely from the core's counter.

**What is not a clock:** the frame time of the driver (it jumped by −2 978 880 305 frames on a driver change,
02 check b), the JACK transport (it flips on a driver change, 02 check b, k_trans1), Link as a source (tempo in whole
µs per beat, 50-ms send throttle, takeover 0.15 to 50.25 ms, 02 check a and NP N3), Strudel's `cps` (it falls with
the browser, 02 §3.1 E), wall clock and OSC timestamps (they play late events "immediately", OSC 1.0).

**Rules at the clock** (ADR 004):
1. **Inside steady, outside re-anchored.** A dropped cycle shifts the music against the wall clock by one block;
   inside, nobody notices, because everything phase-locked lies in one process. Outward (Link, MIDI clock), every
   detected dropout and driver change re-anchors and resets the HostTimeFilter, otherwise it sits up to 2.8 ms off
   and needs 2.67 s (02 NP N6).
2. **Restart continues from the anchor.** The anchor `{anker_sample, anker_mono_ns, Tempo-Karte}` lies in the state
   in `/dev/shm`; the new core computes where it would be without a crash (mini core: grid after restart at most
   0.2 samples, NP up to 0,95, 10 check c).
3. **Map bounded and honest.** Past segments fall away; a rejected change is reported (02 NP N4: the check map ran
   full after 15 control changes and still reported success). Andreas' tempo control is **one** hand segment that is
   overwritten each cycle; every encoder detent runs it as a ramp over 1 beat (rule 4).
4. **No tempo jumps on audible keylock decks**, only ramps (minimum duration 1 beat), **not even by hand**: Andreas'
   tempo encoder sets 0.01-BPM detents, each one is run as a ramp over 1 beat, and the phase control changes the
   factor per block by at most 10 ppm (`SCHNITTSTELLEN.md` §1.3, §7.3 point 7). Reason: a native R3 node needed 95 ms
   after a factor jump until the pitch was back within 10 ct, **and delivered 128 zero samples** (ERGEBNIS §2.6);
   whether small factor changes also produce zero samples is unmeasured (M4). Ramp corners leave a residue of
   −107.3 dBFS in the delay, with S-corners −144.5 dBFS (04 §4.5); S-corners come as a later segment type, V1 stays
   linear (residue below the 16-bit step).
5. **Phase control per deck** on the stretcher path: compare the delivered source position against `sample_at` and
   readjust the factor by a few ppm; planned ramps require the factor to be set one engine delay ahead (02 NP N5:
   without a control in the ramp up to 1.92 ms behind, then 1.4 ms permanently, at 132 BPM 8.1 ppm drift; with a
   lead-in afterwards 3.5 to 12.3 samples). On the direct path there is nothing to control (03 check 4a: null machine
   0.000 ms drift in 30 min).

**Time base of commands** (ADR 005): musical time is the beat (`f64`, quarter note, beat 0 = set start, 1 bar = 4
beats, 1 phrase = 8 bars). All processes except the hand send beats; the hand comes as MIDI with sample offset and
takes effect one period after the grab, at the right sample. Beats pay off because the core resolves tempo changes
**after sending**: 0 samples versus up to 554 samples (11.5 ms) for commands that were in transit during
rescheduling (02 NP N1). The promise "exact or reported" held even at the edge (24 of 24, 02 NP N2). Lateness is
handled **per command type**: music events and AI plan parts are discarded and reported; state commands (fader to
zero, kill, stop) run in the next cycle with a 10-ms ramp and are reported; deck grabs go to the next reachable grid
point (02 NP K11). Lead time per level and all formats: `SCHNITTSTELLEN.md` §1, §3.

---

## 5. Data flows

| Flow | Path | Timing | Evidence |
|---|---|---|---|
| Hand → core | Controller → Midi bridge → JACK-MIDI `cypherdj-kern:hand_in`, sample offset | per event, one period | 09 check c, NP |
| Control station (Leitstand), generator → core | OSC/UDP `127.0.0.1:47100`, commands with target beat, lock-free ring into the callback | send to takeover median 2.9 ms, max 8.1 ms | 02 check b, NP |
| Core → all | OSC/UDP to subscribers: `/q` receipt, `/uhr` per cycle, `/zustand/*` 50 Hz, `/takt` per bar, `/e/*` events | as named | 01 §5, 06 `/uhr` (estimation error at most 0.024 ms) |
| Core → analysis | envelope ring `/dev/shm/cypherdj/huellen`, 1 kHz per channel | continuous | 08 §3.3.6 |
| Analysis → control station → core | bar report, listening pass (Hörschein, WS), then `/k/hoerschein` | per bar; certificate after 4 bars, then renewed per bar | 08 check 4c, 09 test 8 |
| Control station ↔ Cypher | WS ↔ `cypherdj-mcp` ↔ stdio ↔ Sonnet session | per turn | 09 §3.5 |
| Control station ↔ Rechner (planner) | Unix socket, JSON lines | per request | draft |
| Workshop ↔ GPU machine | HTTP to ComfyUI `:8288` (MiniMax), result by HTTP fetch | per job, minutes | skill `cypher-musik` |
| Workshop → inventory → core | files atomic (temporary, `rename`), `material_fertig` via the control station, copy into the working inventory, core loader `mmap`+`mlock` | seconds | 10 NP N8 |
| Core → Notbahn (the fallback path) → interface | ring `/dev/shm/cypherdj/bus` (master, cue), Notbahn to interface 1/2 and 3/4 | per cycle, +1 block (+1 for the fade) | 10 check c |
| Notbahn → recording | JACK edges to the Notbahn outputs | per cycle | 01 §4.4 |
| Core ↔ hosts (later) | sends as JACK audio, notes/CC as JACK-MIDI with offset; return path `node.async` + pulse port | per cycle, +1 block | 05 §5, 10 NP N9 |

### 5.1 One transition, bar by bar (128 BPM, 1 bar = 1.875 s)

F is the deadline: the bar at which deck A is empty or something has to happen (A7). Example style "safe"
(16 bars, 08 §3.3.4), earliest start S = F−16.

| Bar | Who | What | Status |
|---|---|---|---|
| F−40 | Control station, Rechner | Deadline recognized from the structure of A; the Rechner delivers up to three candidates from the crate with fit and prediction per style | fit measured (08 §3.3.2); candidate compute time unmeasured (planner "safe" 0.891 s, 08 NP 4.f) |
| F−36 | Control station → core | load candidate 1 into a free deck (fader −200 dB) | fade-in 0.05 ms per MiB (10 NP N8) |
| F−35 | Control station → core | preview: B starts in sync **at its entry point** (`einstieg_quell_beat` of the candidate), measurement tap only; loading thus 1 bar before measurement start as in `SCHNITTSTELLEN.md` §3 | entry point from structure and bar one, set |
| F−31 | Analysis → control station → core | listening pass after 4 bars: offset against reference, deck against deck, LUFS, level against the running deck, bands; then **renewal after every bar**, valid up to 16 bars after the last measured bar | measurement duration set, unmeasured |
| F−24 | Control station → player | turn request with position, candidates, listening pass, prediction, reply deadline in beats | 8 bars before S (09 §3.2) |
| F−24 + ≈1 T | Player → control station | `waehle` | measured as text 1.307 to 1.437 s, as a tool unmeasured (M15) |
| F−23 | Control station + Rechner | choice expanded to plan parts, coupled, prediction checked against limits; at level 1 as a suggestion: LED blinks, announcement line "T 113: Nightshift in, safe 16 T, bass swap T 121" | 09 NP K1, K7 |
| until S−1 | Andreas | accept or reject; "Listen to Cypher" puts B on its cue | reaction time unmeasured |
| S | Core | B starts anew at the entry point (deck part `start`), B fader ramp starts at the actual value; second check of the listening pass (I3a: content, tempo, `beat ≤ gueltig_bis_beat`, source position within the measured range) | 09 principles 4, 6 |
| S+7 to S+8 | Core | bass swap as an opposing EQ ramp over one bar (rule §14.4 in the contract); invariant I1 "sub never doubled" | 09 NP K1, 08 NP K1 |
| S+11 to F | Core | A out together with deck stop in one group; invariant I2 "master never empty": fade-out and stop wait if B was locked or is not running | 09 NP K2 |
| at any time | Andreas' hand | grab: only this control and its group go to him, at the same sample | 09 check b |
| F−8 without a taking-over plan | Core | deadline guard (only if A is the only audible channel): loop over the last full 4 bars of A, report `rueckfall` | mechanics 03 §4d, fallback unmeasured |

Time pressure is thus a quantity: with "hard" (4 bars) the turn request moves to F−12; below F−8 only the fallback
loop or Andreas' hand remains (A7).

### 5.2 A fresh song, from order to deck

1. Cypher (tool `erzeuge`) or Andreas orders; the control room gives the workshop an order with
   style, target BPM close to the set base, duration, text (prompt form per skill `cypher-musik`). Whether MiniMax hits the target BPM
   is unmeasured (M14); the ten existing songs lie at 89.9 to 180.7 BPM, and the gate
   `streckfaktor` (±15 %) would let only three of them through (calculated).
2. The workshop sends the order to ComfyUI on the GPU machine; duration there today 4.7 to 7.2 s per second
   of music plus 65 to 80 s model loading (operational finding, skill `cypher-musik`), so for a 3-minute song
   14 to 22 min computing plus loading, together roughly 15 to 23 min (calculated).
3. File to the DJ machine, workshop chain up to the gates; duration unmeasured, calculated 1 to 5 min for 3 minutes
   of audio (R3 offline 5- to 23-fold real time per core according to 07 `b_strecken.log`, fingerprint plus
   cross-energies roughly 30 s according to 08 NP "Was fehlt" 6, stems on the GPU unmeasured).
4. `material_fertig` to the control room; gates passed → crate and candidate for Cypher; gate torn → offered only to
   Andreas, with a warning.
5. Continue as in 5.1.

End-to-end measurement: M14.

---

## 6. Latency from the touch to the sound

| Link | Quantum 128 | Quantum 256 | Classification |
|---|---|---|---|
| USB polling of the controller | ≈ 1 ms | ≈ 1 ms | guess (interpretation per 09 §4.6) |
| MIDI bridge to event sample in the core | 2.67 ms | 5.33 ms | 256 measured (5.32 / 5.326 ms, 09 probe c, NP), 128 calculated |
| Core ring to Notbahn (fallback path) | + 2.67 ms | + 5.33 ms | measured at 128 (10 probe c: 127.83 → 255.88 samples) |
| Crossfade of the Notbahn against the click | + 2.67 ms | + 5.33 ms | calculated (10 NP K1) |
| Output buffer of the interface to the converter | ≥ 2.67 ms | ≥ 5.33 ms | unmeasured (A26) |
| **Total fader, EQ, kill, filter, band grabs on the direct path** | **≥ 11.7 ms** (without crossfade ≥ 9.0) | **≥ 22.3 ms** (without crossfade ≥ 17.0) | calculated, lower bound |
| additionally band grabs on the stretcher path (hotcue, beat jump, loop by hand) | + working lead + band lead R3 | + 21.3 ms (4 blocks) + 80.9 ms | calculated from 03 probe 4a (3884.9 frames), lead unmeasured (M3); together roughly 125 ms at 256 |
| additionally tempo by hand on the stretcher path | + working lead + engine delay | + 21.3 ms + 42.7 ms | calculated from 02 probe c (delay 2048 samples) |

Consequences: in the normal case (direct path) every touch takes effect one period after the MIDI event in the core; up to the
ear it is, at 256 with a soft Notbahn (fallback path), calculated at least 22.3 ms. Quantized band grabs on the
stretcher path land exactly when their target beat is at least the lead away (at 128 BPM one
beat is 469 ms); only "immediately" lands roughly 125 ms later there. Whether a second, pre-filled stretcher instance
("jump machine") is needed, M2b decides after the listening session (ADR 020). Lever, if Andreas finds it sluggish:
quantum 128, if M1 supports it, or Notbahn without crossfade (then it only clicks in the crash case). This
is question 3 in §13.

---

## 7. Failure behavior and commitments as numbers

| It dies or hangs | Consequence | Status |
|---|---|---|
| Core dies (`kill -9`) | Notbahn loops the last bar (with crossfade), systemd restarts (`RestartSec=0`), core reads anchor, deck, controls and pending commands from `/dev/shm`, fades material in and continues on the grid; the Notbahn returns with a crossfade | mini core measured: first block after 38.7 ms (NP 39.9), 0 ms silence, grid ≤ 0.95 samples (10 probe c, NP); material fade-in +0.05 ms per MiB (NP N8); stretcher restart unmeasured, but a fresh R3 costs 4.6 to 6.4 ms in the first block unless it is run through once beforehand in the load thread (01 NP K3): mandatory in the restart path; subscribers are in the state, `/e/neustart` goes out to them immediately (`SCHNITTSTELLEN.md` §4.1) |
| Core hangs | watchdog (200 ms, `WATCHDOG=1` only on real-time progress, SIGKILL), then as above | watchdog struck after 190.7 to 214.5 ms, 0 ms silence via the shared-memory Notbahn (10 probe c) |
| Notbahn dies | silence until its restart (same unit rules); hence as small as possible | unmeasured |
| Control room dies | core plays, accepted parts run to their end in the core, hand works, controller loads from the crate; no new plans | pattern measured (01 probe e2: 51 of 51 hits), crate without control room is a guess |
| Player or MCP dies | as above; deadline guard prevents silence | deadline guard unmeasured |
| Planner, analysis dies | no candidates, no listening passs: plans may not make anything audible (I3); hand free | draft |
| Workshop, generation dies | no new material; order is repeated | draft |
| Sound or plugin host dies or hangs | only its return path drops out, the core fades it out after the steady pulse | 10 NP N9 measured for the core, for a real host unmeasured (M7); contradiction 05 §4.5 against 10 NP N3 open |
| PipeWire dies | everything silent; core dies with it and is restarted by systemd, anchor in monotonic time | unmeasured (needs Andreas' yes, interrupts his desktop sound) |

**Commitments as numbers** (acceptance limits, measured on the target via the chaos test bench: JACK recorder on the
monitor ports of a **separate** null sink per run, because the shared sink is written to by several probes,
06 risk 1: 16 790 foreign clicks in 66 s; values without a measurement basis are target values):

| Commitment | Limit | Basis |
|---|---|---|
| Core dies | at most 1 block of silence (click) per crash in 20 of 20, Notbahn alongside (ADR 016 addendum 2026-09-25); before that, Notbahn in series: 0 ms silence, seam with crossfade without a treble jump above 6 dB in at least 18 of 20 | M2b alongside 9 of 9 each exactly one block (slice 06); in series 10 probe c (5 of 5), NP N2 offline 11 %; listening sample at the listening session (46) decides whether it goes back in series |
| Core hangs | at most ~100 ms silence in 10 of 10 via the self-guard in the core (separate process, `--waechter-ms 100`), systemd watchdog as second line | 18 (2026-09-26): self-guard 96.0 ms in 10 of 10, grid 0; systemd alone 170.7 to 384.0 ms (6 of 10 above 250 ms); alongside with edge without guard 2997 ms (16). False trigger with a standing graph open (M11, 48) |
| Core audible again | at most 250 ms including material, grid at most 1 sample | 40 ms + 0.05 ms per MiB (10 probe c, NP N8) |
| Control room, player, MCP, planner, analysis, workshop die | 0 frame gaps, hand works, running parts run to their end | pattern 01 probe e2 |
| Host hangs or dies | 0 frame gaps in the core, return path faded out after at most 2 blocks | unmeasured (M7) |
| Workshop computes in the set | core wakeup below 30 % of the period, 0 gaps, at 256 (CPU stems only at 256, Nice 19; at 128 never) | HTDemucs on the CPU at 256: 15 % (10 NP N6, random weights, 8 threads) |
| Core callback | p99.9 below 20 % of the period (1.07 ms at 256), maximum below 50 % | unmeasured |
| Deck lead (stretcher path) | fill level never below 1 block, every underrun counted | unmeasured (M3) |
| Endurance run | 2 h at 256 on the interface: 0 frame gaps, 0 deck underruns | unmeasured; so far 10 min (10 probe b) |

The JACK xrun callback is blind under pipewire-jack for overruns of the client's own (01 §4.2, 10 probe b:
0 callbacks at 22 and 44 gaps respectively; source `pipewire-jack.c` lines 2070 to 2073); the core counts frame gaps
and skipped periods itself, and the wakeup measure alone is no good as an early warning (10 NP K4).

---

## 8. What is built and what is integrated

### 8.1 In-house build (effort in session days: one session, one working day; estimate, not calibrated to past throughput)

| Building block | Template from this night | Effort | Slice |
|---|---|---|---|
| **V0 contract as code** (before K1 and L1, one owner): probe templates and result files into the repo (without WAV, venv, vendor, raw recordings; exception for evidence logs, because the root `.gitignore` excludes `*.log`), `djk/third_party/` (libebur128 commit 67b33ab, nlohmann/json, toml++), `djk/vertrag/osc.json` with generated `osc_adressen.h`/`.ts`, JSON schemas, `baender.json`, golden sequences, `/test/hand`, ring dummy | `proben/02-uhr-sync-planer/kern/uhrkern.cpp` (OSC), `absender.mjs`, `proben/09-ki-steuerung/nachpruefung/angriff.mjs` | 0.5 | 1 |
| Core skeleton: JACK client, clock with limited tempo map, OSC in and out, rings, receipts, state in `/dev/shm`, telemetry with gap counter, `sd_notify` | `proben/02-uhr-sync-planer/kern/uhrkern.cpp` (497 lines), `proben/01-audio-kern/a-cpp-jack/klick_kern.cpp`, `proben/10-robustheit-betrieb/src/minikern.c` | 2 | 1 |
| Notbahn (fallback path) with crossfade, ceiling, lock; units and `cypherdj.target` | `proben/10-robustheit-betrieb/src/notbahn.c`, `bus.h`, `absturz/` | 1 | 1 |
| Deck direct path: band (loop, band roll, jump, hotcue), stem mix, shot player | `proben/03-deck-engine/deckprobe.cpp` | 2 | 1 |
| Loader, working inventory, crate | `proben/10-robustheit-betrieb/nachpruefung/src/mlock_datei.c` | 1 | 3 |
| Channel strip, mixer, cue, meter tap, meter, envelope ring, limiter, sends, mix-form echo | `proben/04-mixer-effekte/dsp/`, `harness.cpp`, `hybrid_delay.cpp`, `meter_probe.c` | 3 | 1 to 2 |
| Stellwerk (interlocking) RT in C++ with invariants and deadline guard | `proben/09-ki-steuerung/stellwerk.mjs`, `stellwerk.test.mjs`, `nachpruefung/angriff.mjs` | 2.5 | 2 |
| Controller: mapping, takeover, LEDs, buttons, crate browser | `proben/09-ki-steuerung/hand_latenz.c` | 1.5 | 3 |
| Deck stretcher path: shadow stretcher (R3, Bungee behind an interface) in work threads, phase control, crossfade, file swap, roll buffer | `deckprobe.cpp`, `proben/02-uhr-sync-planer/nachpruefung/src/rb_rampe.cpp` | 3 | 5 |
| Control room: WS, acceptance, locking, listening pass register, coupling, autonomy, proposal, move cadence, crate, journal, **core dummy** for parallel building | `stellwerk.mjs` (non-real-time part), `proben/09-ki-steuerung/llm_warm.py` | 3 | 1 to 2 |
| Player driver, `cypherdj-mcp`, announcement line | `proben/09-ki-steuerung/nachpruefung/stellwerk_mcp.py`, `llm_warm_x.py` | 1.5 | 1 to 2 |
| Planner: fit, candidates, playing-style rule "safe"/"hard", prediction | `proben/08-analyse-passung/fa.py`, `probe_b_uebergang.py` | 2 | 2 |
| Analysis: bar report, offset against reference, deck against deck, listening pass | `proben/08-analyse-passung/probe_c_live.py`, `nachpruefung/kick_je_schlag.py` | 1.5 | 2 |
| Workshop chain up to `material_fertig`, gates, connection to the GPU machine | `proben/07-werkstatt-zerleger/c_drift.py`, `b_timemap.py`, `b_strecken.py`, `fa.py` | 3.5 | 1, 4 |
| Splitter role, re-render queue | none | 1.5 | 5, 6 |
| Recorder unit | `proben/01-audio-kern/a-cpp-jack/aufnehmer.cpp` | 0.5 | 4 |
| Chaos test bench: separate sink per run, recorder at the target, seam meter, load (memory, HTDemucs, workshop), kill and hang, endurance run, report | `proben/10-robustheit-betrieb/src/`, `nachpruefung/src/sprung.c`, `demucs_last.py`, `proben/01-audio-kern/a-cpp-jack/analyse_klick.py` | 1.5 | 1 |
| Generator unit Strudel, score sheet, worker | `proben/06-erzeuger-muster/uhr/sender.mjs`, `spielzettel/zettel.mjs` | 1.5 | 7 |
| Sound host SunVox | `proben/06-erzeuger-muster/sv/sv_probe.c` | 1 | 7 |
| Plugin host Carla | `proben/05-plugins-instrumente/carla_host.py`, `sonde.c` | 1.5 | 8 |
| Link bridge, MIDI clock | `proben/02-uhr-sync-planer/link-probe/linkpeer.cpp`, `nachpruefung/src/linkfilter.cpp`, `kern/uhrkern.cpp` | 1.5 | 9 |
| **Total** | | **roughly 37** | |

Critical path to the first shared sound (slices 0 to 4, three sessions in parallel): roughly 16.5
session days (V0 comes before it), calculated from the table; estimate.

### 8.2 Finished and integrated

| Building block | Role | License | Status on the DJ machine (checked today) |
|---|---|---|---|
| PipeWire 1.6.8, pipewire-jack, MIDI bridge | graph, driver, real-time threads, MIDI | MIT | running (10 §3a) |
| libjack (jackd2 1.9.21) | client API | LGPL-2.1+ | `pkg-config jack` 1.9.21 |
| Rubber Band 3.3.0 (library and CLI) | keylock live and offline, `--timemap` | GPL-2.0-or-later (the core becomes internally GPL, with no consequences) | `pkg-config rubberband` 3.3.0, `/usr/bin/rubberband` |
| Bungee 2.4.30 | second live engine | MPL-2.0 | built by hand under `proben/03-deck-engine/vendor/bungee` (commit 8cb6977; needs CMake ≥ 3.30, locally 3.28, 03 §3.1; excluded from git via `.gitignore`); in slice 5 as a pinned clone with a build script under `djk/third_party/bungee/` |
| libebur128 | LUFS, true peak | MIT | no development package; source under `proben/04-mixer-effekte/vendor/libebur128` (commit 67b33ab, excluded from git there via `.gitignore`); V0 copies it to `djk/third_party/` and compiles it in |
| nlohmann/json, toml++ | JSON (`kiste.json`, mapping, `fassung.json`) and TOML (`kern.toml`) in the core | MIT, MIT | **missing** (`pkg-config` and `/usr/include` show no hits, measured 2026-09-23); as pinned single headers under `djk/third_party/` (V0). sd_notify and OSC the core writes itself, like `minikern.c` and `uhrkern.cpp` (liblo and libsystemd-dev are missing too); tests with CTest and our own assert header (gtest and catch2 are missing) |
| Faust 2.70.3 | generates C++ for isolator, filter, reverb, limiter | libraries per function (04 §3.2) | `faust --version` 2.70.3 |
| libsndfile 1.2.2, libsamplerate 0.2.2, FFTW 3.3.10, ALSA 1.2.11 | tools, test bench | LGPL, BSD, GPL, LGPL | `pkg-config` available |
| lilv 0.24.22 | LV2 in the host (later) | ISC | available |
| g++ 13.3, CMake 3.28.3, Ninja 1.11.1, Node 22.23.2, Python 3.12.3 | build | free | available |
| systemd 255 (user manager) | supervision, watchdog, limits | LGPL-2.1+ | available, `DefaultLimitRTPRIO=95`, `DefaultLimitMEMLOCK=4294967296` (10 §3a) |
| `ws` 8.21.3, `@modelcontextprotocol/sdk` 1.30.0 | control station (Leitstand), MCP | MIT | npm (09 §3.9) |
| Claude Code CLI 2.1.280 | player, splitter | proprietary | available |
| torch, demucs 4.0.1, beat_this 1.1.0, Essentia 2.1b6, NumPy, SciPy, scikit-learn | workshop, planner, analysis | BSD, MIT, MIT, AGPL-3.0 (test tool only), BSD | the venv `proben/07-werkstatt-zerleger/venv` has only torch 2.5.1+cpu (`torch.version.cuda` None), no `websockets`, no `pytest`; the system has torch 2.10.0+cu128, websockets 16.0, pytest 8.4.2, but neither demucs nor beat_this (measured 2026-09-23). W1 creates a new venv with `--system-site-packages`; the weights of beat_this and Demucs are nowhere yet (`~/.cache/torch` is missing), the first run downloads them from the network |
| ComfyUI with MiniMax Music 3 on the GPU machine (`:8288`) | generation | service | running according to skill `cypher-musik`; not touched here |
| later: Ableton Link SDK 4.0, `@strudel/core`/`mini` 1.2.6, SunVox library 2.1.4d, Carla 2.5.8, LSP, x42, Surge XT, Airwindows | sync, generators, sound, plugins | GPL-2.0+, AGPL-3.0+, MIT, GPL, LGPL/GPL/MIT | cloned or built in the proben folders |

### 8.3 Layout in the repo (proposal for the plans)

New code lives under `~/cypher-dj/djk/` (the repo's main directory is occupied by the browser state):
`djk/kern/` (C++, CMake), `djk/notbahn/`, `djk/aufnahme/`, `djk/leitstand/` (TS), `djk/mcp/`, `djk/spieler/`,
`djk/rechner/`, `djk/analyse/`, `djk/werkstatt/`, `djk/pruefstand/`, `djk/units/` (systemd units),
`djk/konfig/` (default configuration per `SCHNITTSTELLEN.md` §2.1, controller mappings), `djk/vertrag/`
(machine-readable parts of `SCHNITTSTELLEN.md`; only V0 writes there: `osc.json`, generated `osc_adressen.h`/`.ts`,
JSON schemas, `baender.json`, golden sequences, mocks), `djk/third_party/` (pinned third-party sources with provenance).
Inventory under `~/cypher-dj/bestand/` and set journals under `~/cypher-dj/sets/djk/` (both not versioned).

---

## 9. Measurement list, slices, cut list

### 9.1 Measurement list (IDs are binding; ADRs and plans refer to them)

| No. | Measurement | Setup, control | Overturned by | Needs |
|---|---|---|---|---|
| M1 | **Interface** as driver: gaps at 128 and 256 (60 min each, with and without workshop), sample clock drift against system clock, HostTimeFilter under USB jitter, grab to sound (loopback cable), master against cue | xrun meter (`proben/10`), JACK recorder; failure case artificial callback load (10 K1b), negative control quiet | quantum, fade, kernel headroom | device, Andreas' go-ahead |
| M2 | **Notbahn (fallback path) seam online** with real music: without fade, 1 block fade; M2b: Notbahn in parallel on the driver (if a hung core, does it deliver silence or old blocks?) | seam meter `nachpruefung/src/sprung.c` plus high-tone measure from 10 NP N2; failure case hard seam, negative control quiet run 0 jumps | fade yes/no, 1 or 2 blocks | silent |
| M3 | **Deck real time:** R3 in worker threads as JACK client **in pull mode with a fixed output amount per block** (deck semantics; the push mode from 01 §4.5 does not count, 01 NP K1), 1, 2 and 4 R3 per thread compared, R3 short as an option, 30 min, lead 2/4/8 blocks, 4 decks, under memory and HTDemucs load, own null sink; additionally the start per 01 NP K3 (creating and one pull cycle with `retrieve` in the loader thread) **measured in the callback**, and the cost of the six analysis bands per channel | underrun counter, frame gaps, fill level, first block after start; failure case R3 directly in the callback (03 §4e: 16 blocks over budget) and 8 R3 in one thread (01 NP N4: 377 overruns in 60 s), negative control 0 R3 | lead size, stretcher per thread, stretcher budget, R3 short, switch to Bungee | silent |
| M4 | **Tempo ramps and small factor changes native** with phase control: pitch (tone scan) and phase during and after 128 → 132; **encoder sequence in 0.01 BPM steps** (as ramps over 1 beat and, as failure case, as jumps), **ppm readjustment of the phase control**, each with **null samples at the target counted**; native single node with 50 ms lead against double node on pitch; Bungee tone scan of the harmonic bass tones and ear tool | `02 nachpruefung/src/rb_rampe.cpp`, tools from `tests/stretch-bench`; positive control without engine −79.31 ct; failure case factor jump without lead (ERGEBNIS §2.6: 128 null samples); negative control constant factor | control design, minimum ramp duration, hand ramp, single or double node, R3 against Bungee | silent |
| M5 | **Listening path switch:** fade direct ↔ shadow stretcher and file swap after re-rendering (click, position, comb filter) | click metric from 04, position via kick onset (03 §4a method); negative control without switch | direct-path concept (fallback: R3 always in the listening path) | silent |
| M6 | **Roll behind the keylock** versus tape roll: grid fidelity in the ramp, return congruent | comparison with 03 §4d | roll type | silent |
| M7 | **Host decoupling** via `node.async`: crash, bridge hang, hang in the process; what a dead return path delivers; whether the heartbeat detects it; clarifies 05 §4.5 against 10 NP N3 | setup 05 check 4.5 with `PIPEWIRE_PROPS='{ node.async = true }'` | whether plugins and SunVox may be in the mix | silent |
| M8 | **Loading during play:** load and lock 3 GiB, page faults in the callback, 4 GiB limit with unloading | loader in the core, gap count | working set size | silent |
| M9 | **GPU in the set:** graphics memory of the **real** chain (PyTorch Demucs 4.0.1 with real weights; research cites about 7 GB, undated) and a Demucs job on the DJ machine's GPU next to the core at 256, **start and end** (memory clock change, 10 NP K6); the earlier figure "training did not disturb" came from idle training (10 NP: 7% instead of 96%) | xrun meter, `nvidia-smi` per second; failure case job start under load, negative control GPU quiet | whether stem jobs are allowed on the GPU in the set | free GPU, Andreas' answer to question 4 |
| M10 | **Quiet machine:** repeat all real-time numbers of this night without foreign load | batch scripts of the proben folders | size of all reserves | quiet |
| M11 | **Watchdog policy:** crash loop with `RestartSteps`; false watchdog death when a return path hangs | deliberately broken core | watchdog time, message "core hangs" versus "core waits" (10 NP K5) | silent |
| M12 | **Link bridge** versus Link in the core | template `linkfilter.cpp` | where Link sits | later |
| M13 | **Grid and bar one of the MiniMax songs:** beat_this and Essentia on all songs from `c_drift.log` (also `sofa-abend`), remainder after timemap at the output **with an independent instrument** (low-band hits from `fa.py`; additionally a click after the warp against the rigid grid), **downbeat hits** (beat_this against a second method and against a bar one set by hand) | failure case without timemap, negative control mfbass (3.3 ms/min), positive control synthetic drift (`b_timemap`: 0.19 ms RMS, mechanics only), **new** control rigid grid with weak pulse | warp-to-grid idea, gate thresholds `raster`, `klarheit`, `eins` | offline |
| M14 | **Generation end to end:** `erzeuge` until `material_fertig`, GPU machine free and busy, core telemetry at 256 included; **BPM fidelity** of MiniMax against the target BPM in the prompt (exact and as a range) | timestamp per step; BPM from beat_this against prompt | crate lead time, prompt form, gate `streckfaktor` | GPU machine (shared) |
| M15 | **Choice as a tool call** and set simulation without sound: first 30 min (120 turns), then extrapolate; context **≥ 100 000 tokens** (how late in the set), plus turn and repair turn after `verriegelt` | p50, p95, max until tool call, format errors, context size, cost; falsification criterion: p95(turn) + p95(repair turn) ≤ 4 bars (response deadline of the contract); failure case network disconnect, fallback must catch | move cadence, response deadline, cost | quota |
| M16 | **Stretcher on the stem sum** versus each stem: sound and effect timing of stem mute | ear tool, tone scan | stem deck form | silent, then ear |
| M17 | **Controller on the device:** jitter, initial position, USB latency, LED return path, MIDI or HID | software sender as comparison (09 check c) | mapping, dead zone | device |
| M18 | **Listening session** (sound, with Andreas' yes): R3 versus Bungee, rule of thumb versus optimizer (`proben/08-analyse-passung/out/uebergang/sicher_saat.wav` versus `sicher_optimiert.wav`), Notbahn loop and seam, listening-permit thresholds, feel of latency | A/B, pairwise | sound decisions | Andreas |
| M19 | **Keylock at large stretch factors and pitch correction:** tone scan and ear tool of the workbench at factors 0,7, 0,8, 1,2, 1.4 on real MiniMax songs (offline, R3 with timemap), plus the pitch correction ±10/±35 cent on the tone scan | tools from `tests/stretch-bench`; positive control resample without keylock; negative control factor 1.0 | gate `streckfaktor`, tuning alignment automatic or suggestion only | offline, silent |
| M20 | **Recheck the rule of thumb against the contract limits:** rule §14.4 (contract) with `probe_b_robust.py` on the pair Message/MFB and on two MiniMax pairs, variants "A-low lowered earlier" and "kill instead of EQ" | all six bands, with and without keylock; negative control the measured rule of thumb (low 0.402 must come back) | whether `grenze_tief` may lock, set low-band limits anew | offline |

### 9.2 Slices (the ROADMAP turns these into plans; rationale in ADR 021)

| Slice | Content | Acceptance (each with failure case and negative control, on the target) |
|---|---|---|
| **0 Preconditions** (parallel, silent) | M3, M13, M15 (30 min), M19, M20, M2 offline and online, M10 when quiet, M14 when the GPU machine is free; M1 as soon as device and yes are available | Measurement reports with number and tipping decision |
| **1 V0, then three workpieces in parallel** | **V0** (one owner, about half a day): templates into the repo, `djk/third_party/`, `djk/vertrag/` (`osc.json`, generated headers, schemas, `baender.json`, golden sequences, `/test/hand`, ring dummy; `SCHNITTSTELLEN.md` §19.0) · **K1** core scaffold, clock, commands, state, fallback path (Notbahn) with fade and bar fields, two decks on the direct path, channel strip with fader/trim/LR8/kill as assignment table, units, chaos test rig v1 · **L1** control desk (Leitstand), `cypherdj-mcp`, player driver, announcement line against a **core dummy** that speaks the contract · **W1** workshop chain v1 on existing songs **without stems** (tempo map, bar one, timemap, headroom, fingerprint, cross energies, gates, versions, `material_fertig`) | **V0:** `osc.json` green against the contract text, every golden sequence present as a file. **K1:** 20 × `kill -9`, 10 hangs, 0 ms silence, grid ≤ 1 sample, seam measured; golden sequences green; **load profile P1** as a script in the test rig (memory streaming `lastgen` 16 × 64 MiB plus `demucs_last.py` with 8 threads, nice 19), 60 min at quantum 256: at most 1 frame gap; with exactly 1 gap a second run with 0; external load (`uptime`, `nvidia-smi`) before and after each run in the report, run registered via the wave coordination; if the external load (1-minute mean) is above 4, the run counts as provisional and comes back in M10 (one zero in 675 000 cycles is no finding on its own, 10 NP K2) · **L1:** all golden sequences green against the dummy; `kill -9` on the control desk in the middle of `teil_rampe`: the dummy runs to the end, the new control desk takes over the state via `/q/stand`; player: warm-up move under 30 s, `lage` as tool call 5 of 5 well-formed; `cypherdj-mcp`: every tool from §10 once well-formed and once with a form error (`form`) · **W1:** chain on the controls from `c_drift.log` (NULL `konst134` residual near 0, POSITIVE `drift_synth`, REFERENCE `mfbass`) and all MiniMax songs; gates with the independent hit instrument, result per gate in the report; `material.json` and `fassung.json` schema-valid; a correction produces `r2` next to `r1`, `r1` stays byte-identical |
| **2 Cypher chooses, the code computes, silent** | Stellwerk (interlocking) RT with invariants (I3 with content and section) and deadline watchdog; planner ("safe", "hard" per rule §14.4 in the contract); analysis with listening check (Hörschein) and renewal per bar; `waehle` with entry, coupling, move cadence; meter, measurement tap, envelope ring with six bands | Cases 09 NP K1 (0 bars of sub doubled), K2 (master never empty), K3 (no jump), K4 (dead zone), K5 (overlap rejected); player silent: fallback instead of silence; prediction against core output ≤ 0.04 overlap, ≤ 0.41 LU (08 NP K2) |
| **3 Hand and ear** | Controller with mapping, takeover, LEDs, buttons, crate (Kiste) browser; loader during play; interface with cue 3/4 (M1); Andreas plays two decks alone; **listening session M18** | M1, M8, M17; grab until sound measured; loading 3 GiB without gap |
| **4 First shared sound** (128 fixed, direct path) | Autonomy level 1 with proposal, "hear Cypher", accept, reject, stop, verdict; journal, recording; a MiniMax song ordered at set start arrives during the set through the workshop into the crate and is integrated | Andreas plays A, Cypher proposes B, Andreas accepts and intervenes; `kill -9` on control desk, player and core in the middle of the transition; 30 min endurance run on the interface with the workshop running |
| **5 Tempo and keylock live** | Shadow stretcher (R3, Bungee), ramps, phase control, hand tempo, re-rendering with file swap, roll buffer | M4, M5, M6, M16 |
| **6 Workshop in the set** | Splitter session (A13), queue with priority, stems on GPU in the set, tap grid and nudge as correction per section | M9, M14 under set load |
| **7 Own track** | Generator Strudel, play sheet, sound host SunVox, autonomy level 2 | M7 for the sound host |
| **8 Plugins** | Plugin host Carla, fail-safe insert | M7 |
| **9 Outside world, surface, learning** | Link bridge, MIDI clock, surface, learning model between sets | M12 |

### 9.3 Cut list (what goes first when a slice overruns)

- Slice 1: chaos test rig first only `kill -9` and SIGSTOP, hangs in the callback later; W1 without stems (specification, not only when overrun); buses and `fx/3`/`fx/4` empty (not the assignment table).
- Slice 2: planner delivers one instead of three candidates; only the "safe" style. **Not cuttable:** deck-against-deck in the listening check (mandatory for generated material), because the offset against the reference does not see a wrong grid (08 NP K4); without it the listening-check requirement for MiniMax songs would be an empty shell.
- Slice 3: split headphones instead of cue 3/4 if the interface has only two outputs; LEDs only for holder and proposal.
- Slice 4: the song is ordered before the set instead of during it (then A2 is only carried "in advance", noted in the journal); verdict buttons later.
- Never cut: invariants I1 to I3 (with content, section and deck-against-deck), deadline watchdog, listening-check requirement, stop button, fallback path (Notbahn), lock against unrequested sound.

---

## 10. Mapping A1 to A26

| A | Requirement (short) | Carried by | Status |
|---|---|---|---|
| A1 | play live together | Stellwerk RT (hand first, holder), control desk (Leitstand), player (choice, proposal), autonomy levels, stop, controller, journal; ADR 013, 014, 023 | pattern measured (09 check b, c), core version still to build (slices 2 to 4) |
| A2 | generate songs in parallel, split them in the set and integrate | generation on the GPU machine, workshop, inventory, crate, loader without restart; ADR 011, 022 | **partial:** "during the set" means about 15 to 30 min lead time (generation 14 to 22 min computing plus 1 to 1.5 min loading on the GPU machine, operating value; workshop 1 to 5 min, calculated); end to end unmeasured (M14); slice 4 |
| A3 | first get the technology clean | slice 0, measurement list, chaos test rig as acceptance; ADR 016, 021 | tools measured (01, 10) |
| A4 | nothing unchecked onto the master | measurement tap and listening check (sync, deck against deck, level against the running deck) with content, section and renewal per bar, cue 3/4, invariant I3 for **new content** (opening behind crossfader and bus, shot, pattern, Cypher's jump), autonomy positive list, channels of new sources start at −200 dB; ADR 008, 013, 023 | meter measured (04 §4.7, 08 check 4c); thresholds unmeasured (M18); cue on device unmeasured (M1); I3 in the new form a draft (golden sequences `i3_gruende`, `crossfader_luecke`) |
| A5 | EQ per deck for swapping | LR8 isolator with kill and second-order ramps, bass swap button; ADR 008 | measured offline (04 §4.1: mid kill 74.6 dB; §4.2) |
| A6 | fade in while fading out | ramps in beats, play style rule, coupling through the control desk; ADR 012, 023 | measured (08 check 4b, 09 check b) |
| A7 | play styles by time pressure | play style as parameter set, deadline from the clock, length encoder, move request relative to the deadline, deadline watchdog; ADR 012, 013 | "safe", "hard" measured; fallback unmeasured |
| A8 | genre classification | play style table per genre as starting values; ADR 012 | **open:** genre values are guesswork (08 §3.3.4), "pumping" is technically not decided (specification 0 dB until Andreas explains it) |
| A9 | base 128, live to the set tempo | tempo map, shadow stretcher, phase control; ADR 004, 006, 020 | clock measured (02); deck in real time unmeasured (M3, M4); **slice 5**, until then fixed 128 |
| A10 | keylock for everything | base files, stems and single hits offline with R3; live R3 on deviation; half/double tempo choice and gate `streckfaktor`; ADR 006 | **measured offline only for factors up to about 5 % away from 1** (03 §4c: 0.95522 and 1.04121; 07 `b_strecken`: 134/128; ERGEBNIS §1: 128/134; 08 §4.e up to +28 % only band and crest, no pitch); **above that unmeasured** (M19), MiniMax songs need 0.71 to 1.42 |
| A11 | beat-synced effects | mixed-form echo from the clock, echo off, beat repeat (roll buffer), reverb; ADR 008 | echo measured (04 §4.3 to 4.5), beat repeat and LFO unmeasured |
| A12 | once offline to the base, live only the deviation, re-rendering | direct path, shadow stretcher, re-rendering with priority 1, file swap; ADR 020 | direct path is a construction; switch unmeasured (M5); re-rendering time calculated |
| A13 | splitting in the set as a Sonnet role (stems, loops, single hits, tempo, **bar one**, key, **text**), reloading without restart | workshop chain with bar one (`erste_eins_quell_beat`, gate `eins`, manual correction switch plus tap), text from the prompt, splitter session, `material_fertig`, versions, loader via `mmap`; ADR 011, 015 | loader measured (10 NP N8); bar one unmeasured (M13); text only from the prompt, not recognized; role unmeasured (slice 6; until then the chain computes without Sonnet) |
| A14 | loop, roll, beat jump, hot cues quantized | deck band after the Mixxx pattern, commands with target beat, manual quantize, roll buffer, holder for discrete grabs; ADR 007 | measured offline (03 §4d); hand latency on the stretcher path about 125 ms calculated |
| A15 | live analysis per bar | meter in the core, analysis unit, bar state; ADR 012 | measured offline (08 check 4c) |
| A16 | fingerprint, fit, plan, learning from verdicts | `fa.py`, planner, play style rule, journal, verdict buttons, A/B after the set, learning by watching; ADR 012, 013 | measured offline (08); learning simulated (08 NP K6: optimistic bound) |
| A17 | modular core with a lot of routing (buses, sends) | mixer as assignment table: every channel to master or one of four group buses with full channel strip, four sends to `fx/1` to `fx/4`, return paths of the hosts `node.async`; freely wirable inserts from slice 8; ADR 008, 009, `SCHNITTSTELLEN.md` §1.5 | draft; whether Andreas wants more (matrix, subgroups) is question 5 in §13 |
| A18 | plugins | plugin host (Carla) with return path `node.async`; ADR 009 | partly measured (05); decoupling M7; slice 8 |
| A19 | GPU where it helps | stems in the workshop (DJ machine, only after question 4 and M9), generation (GPU machine), never in the block clock; ADR 011, 022 | **measured only under sustained load:** training did not disturb the CPU chain (10 check b R1, 96 %; in the re-check training was resting, 7 %); start and end of a GPU job, i.e. exactly one stem job, and the graphics memory of the real chain unmeasured (M9, 10 NP K6) |
| A20 | everything in step with the bar | one clock, beats, phase control, latency lead per path; ADR 004, 005 | measured (02) except deck controls (M4) and interface (M1) |
| A21 | instruments and generators on equal footing | generator channels with full channel strip in the core, beat stamp, sound host; ADR 010 | measured (06); slice 7 |
| A22 | Strudel for patterns to events | generator unit with `queryArc`; ADR 017 | measured (06 check a) |
| A23 | own build allowed, bring free ones forward | C++ core from free libraries, §8.2; ADR 002 | decision, callback measured (01) |
| A24 | surface secondary | LEDs, announcement line, play sheet as text; surface later as its own process; ADR 019 | decision |
| A25 | away from the browser | service bundle without browser in the audio path; ADR 001, 018 | measured (01 check b3: 669 dropouts in 60 s with empty worklet, 0 without; in the re-check 1 539, load-dependent, qualitatively confirmed, 01 NP) |
| A26 | hardware for pre-listening, NI interface, Renoise | question 1 in §13; Renoise no (06 §3.1); ADR 003 | **open:** device unknown, M1 outstanding |

---

## 11. ADR index

| No. | File | Decision in one sentence | Status |
|---|---|---|---|
| 001 | `adr/001-prozessform-app.md` | Real-time core plus satellites as systemd user units; "the app" is this composite | accepted |
| 002 | `adr/002-kern-sprache.md` | C++20, Notbahn (the fallback path) in C, real-time discipline enforced by mechanics | accepted |
| 003 | `adr/003-audio-anschluss.md` | JACK API under pw-jack, quantum 256 as default, one interface only for the DJ nodes | provisional, M1 pending |
| 004 | `adr/004-uhr-und-link.md` | Sample counter plus tempo map in the core, continuous inside, re-anchored outside, Link as a later bridge | accepted (Link: provisional, M12) |
| 005 | `adr/005-zeitbasis-beats.md` | Beats as f64 on the core clock, lateness per command type | accepted |
| 006 | `adr/006-keylock-engine.md` | Rubber Band R3 offline and live (at most 2 per work thread, start with pass-through), Bungee second choice, double nodes postponed, never R2/SoundTouch/Signalsmith | provisional, M3/M4/M18/M19 pending |
| 007 | `adr/007-deck-grammatik.md` | Own build following the Mixxx pattern with a target beat per command, hand quantize per listening path | accepted |
| 008 | `adr/008-mixer-und-vorhoeren.md` | Mixer in the core, LR8, Cue 3/4, measurement tap separate from the cue, recording at the Notbahn | accepted (cue on the device: provisional, M1) |
| 009 | `adr/009-plugins-ausserhalb.md` | no `dlopen` in the core; plugins in the host with return path `node.async` | provisional, M7 pending |
| 010 | `adr/010-erzeuger.md` | Strudel as its own unit, SunVox in the sound host, generator channels of equal rank in the core | provisional, M7 pending |
| 011 | `adr/011-werkstatt-und-nachladen.md` | Werkstatt (workshop) chain with gates and a priority queue, reload via `mmap` without restart | provisional, M13/M14 pending |
| 012 | `adr/012-fingerabdruck-und-passung.md` | Fingerprint in beat time, fit as a calculation, playing style as a rule, optimizer only after A/B | accepted |
| 013 | `adr/013-ki-schicht.md` | Choice instead of plan, warm Sonnet session, move cadence, autonomy levels, stop | provisional, M15 pending |
| 014 | `adr/014-controller.md` | USB-MIDI directly into the core, mapping as a file, takeover scaled/relative | provisional, M17 pending |
| 015 | `adr/015-bestandsformat.md` | Folders by content hash with immutable versions per render, `korrekturen.jsonl` as the only appendable file, raw float32, working set and crate in `/dev/shm` | accepted (versions binding before W1) |
| 016 | `adr/016-robustheit-notbahn.md` | Units with watchdog, Notbahn via shared memory with a crossfade, chaos test bench as acceptance | provisional, M2/M11 pending |
| 017 | `adr/017-strudel-rolle.md` | Strudel only as a function from pattern to events | accepted |
| 018 | `adr/018-browser-abschied.md` | Browser leaves the audio path; the conductor page is a transition | accepted |
| 019 | `adr/019-oberflaeche-spaeter.md` | Surface later as a read-only process; until then LEDs and an announcement line | accepted |
| 020 | `adr/020-hoerwege-im-deck.md` | No stretcher in the listening path at factor 1, one warm shadow stretcher, re-rendering | provisional, M5 pending |
| 021 | `adr/021-grundlage-und-scheiben.md` | AI draft as the basis; measurements and a listening session before the expensive slices; shared tone at fixed 128 first | accepted |
| 022 | `adr/022-generierung-mit-vorlauf.md` | Generation on the GPU machine with minutes of lead time, crate as queue | provisional, M14 pending |
| 023 | `adr/023-stellwerk-und-invarianten.md` | Intake in the Leitstand, execution, invariants I1 to I4 (I3: new content only with listening pass; audible only when the deck runs), and deadline watchdog in the core | accepted |
| 024 | `adr/024-kit-im-kern.md` | `/erz/strom` gets the target form `kit:<name>`: the core plays `klang[note]` of a kit (single shots) sample-accurately into the input of a generator channel, without return path | accepted |
| 025 | `adr/025-loop-boxen.md` | Two loop boxes in the core on `pad/1` and `pad/2`: a loop is N bars at 128 BPM, phase-locked to the core clock, start and stop on the next bar one, beat FX in the box | accepted |
| 026 | `adr/026-loops-folgen-der-uhr.md` | Loops stay stored at 128 BPM and follow the core clock via varispeed (Catmull-Rom); REC records at any fixed tempo; Andreas sets the tempo at the side | accepted |
| 027 | `adr/027-keylock-fuer-loop-boxen.md` | Keylock for loop boxes: one variant per box at resting tempo, rendered in advance with R3 offline in the network process; direct path at 128 preferred; REC at ≠ 128 with R3 instead of resampling | implemented in branch `keylock`, listening test pending |
| 028 | `adr/028-decks-folgen-dem-tempo.md` | Decks follow the live tempo: varispeed immediately (read head from the master beat), pitch via version swap | varispeed accepted; version swap (decision 4) superseded by ADR 029 |
| 029 | `adr/029-keylock-echtzeit.md` | One keylock button for all sources: R3 in work threads with a lookahead ring (Dehner), render-and-swap removed | implemented for decks and loop on the deck (code on main, status 2026-10-08); loop boxes come with task 7; listening test pending; operational core unchanged per ADR |

---

## 12. Contradictions and how they were decided

| Point | Option 1 | Option 2 | Decision | Evidence, ADR |
|---|---|---|---|---|
| Basis of the synthesis | Judge 1: AI; Judge 2: Play; Judge 3: Robust | | AI as the basis; the takeover lists of all three judges are congruent (core and operation from Robust, deck and hand from Play) | weighted sums of all three judges; ADR 021 |
| Order of the slices | AI: whole AI loop silent first | Play: Andreas' hands first; Robust: robustness first | Slice 0 measurements, then three work pieces in parallel, hand and listening session before the shared tone, shared tone at fixed 128 before live keylock | judges' weakness lists; ADR 021 |
| Stretcher at factor 1 | Robust: R3 always in the listening path | Play: direct path without stretcher | Direct path, one warm shadow stretcher | 03 §4c (R3 at 1.0: artifacts −63.7 dB), RESULT §2.5 (pre-echo +4.5/+7.5 dB, kick rise 9.07 instead of 3.09 ms, offline on the WASM path), A12 verbatim; ADR 020 |
| Quantum | Play: 128 as playing target | Robust, AI: 256 | 256 as default, 128 after M1 | 10 NP N6 (55 % against 15 %), NP K2; ADR 003 |
| Notbahn | Robust, AI: blend, two blocks | Play: `node.async`, parallel as a hypothesis | Shared-memory ring with a crossfade; without blend and in parallel, measured in M2/M2b | 10 NP N1/N2, test c; ADR 016 |
| Clock after dropout | Play, 01 §4.2: close the gaps from frame time | Robust, 02 NP: continuous inside, re-anchor outside | continuous inside, re-anchored outside | 02 test b (frame time jumps), NP N6; ADR 004 |
| SunVox, Link, CLAP/LV2 in the core | 06 §1, 05 §1, AI, Play: in the core | Robust, 01 §6.1: no third-party code in the core | no `dlopen` in the core; SunVox in the sound host, Link as bridge, plugins in the host; statically compiled-in, checked source code (Faust, Airwindows under MIT) counts as own code | 05 §4.5 (hang in the process > 6 s without a cycle), 10 NP N9; ADR 009, 010, 004 |
| Third-party code only in parallel on sends | 10 §5 | 10 NP K5, A18/A21 | return paths into the mixer, decoupled via `node.async` with a pulse | 10 NP N9, K5; ADR 009 |
| Who writes transition plans | 09: the LLM writes plan parts | 06: transition as command; 09 NP K7 | Cypher chooses, the computer plans | 09 NP K1, K7, K9; ADR 013 |
| Planner | 08: optimizer | 08 NP K1: rule of thumb | playing style as a rule, the prediction is checked; optimizer after A/B | 08 NP K1, K2; ADR 012 |
| Too late | 02, 09 guiding principle 5: discard; 03 §3.4: next grid step | 02 NP K11 | per command type | 02 NP N2, K11; ADR 005 |
| Hand quantize | 02 §5.2: `/quant` next grid point | 02 NP K10: immediately phase-true, like Mixxx | both: hand immediately phase-true (direct path) or next reachable grid point (stretcher path); AI always with target beat | 02 NP K9, K10; ADR 007 |
| Stems | 03 §1: one stretcher per stem | all drafts: stretcher on the stem sum | direct path mixes stems without stretcher (free, immediate); on the stretcher path one stretcher on the sum; M16 checks sound and latency | 01 §4.5 (16 stretchers do not fit into one thread); ADR 020 |
| Pre-listening and AI measurement | Robust: same tap | AI: separate measurement tap | separate, at the same point; "listen to Cypher" deliberately puts Cypher's proposal on Andreas' cue | A4 verbatim; ADR 008 |
| Recording | AI, Play: ring in the core | Robust: unit at the Notbahn outputs | unit at the Notbahn outputs | 01 §4.4; ADR 008 |
| Live analysis | AI, Play: bar-end thread in the core | Robust: outside the core | block DSP in the core, bar end in `cypherdj-analyse` | 08 §4.f; ADR 012 |
| Plugin hang | 05 §4.5: a hang in the process freezes the driver cycle | 10 NP N3: a parallel hang does not hold it | unresolved, M7 decides; until then no plugins in the mix | ADR 009 |
| Stems in the set on the CPU | ADR 003: never; ADR 011 and §3.6: never at 128 | §7 promise and 10 NP N6: at 256 with 15 % of the period | one rule: at 256 allowed as a job with nice 19, never at 128; GPU only after question 4 and M9 | 10 NP N6, K3; ADR 003, 011 |
| Tuning alignment | ADR 012: automatic via keylock pitch | direct path without stretcher, no pitch control in the contract | offline at import, per track, to 440 Hz in the warp run; none live | ADR 012, 020 |
| Scope of I3 | Contract: only "inaudible becomes audible" | Summary and A4: "never unheard" | I3 for new content: opening via trim and fader, shot, pattern, Cypher's jump | A4 verbatim; ADR 023 |
| Autonomy level 1 | Contract: only anything that makes things audible becomes a proposal | ADR 013: positive list | positive list applies, contract aligned | A4; ADR 013 |

---

## 13. Open questions for Andreas (with a default to nod through)

1. **Which interface becomes the timing master?** Default: an interface with at least four outputs (master 1/2,
   headphones 3/4), only for the DJ services; your desktop sound stays on the onboard output. If your NI device
   has only two outputs, you start with split headphones (left cue, right master) until a new one is there. For
   the measurement series M1 I plug a cable from output to input, speakers off.
2. **How much may I do alone at the start?** Default: level 1. I suggest you accept by key, and everything,
   even just one EQ move on your deck; alone I may only load, pre-listen, order songs and fade out my own
   track. A control you have touched comes back to me via a release gesture or after 8 bars of rest. The stop
   key takes everything from me at once.
3. **Listening session before the expensive parts?** Default: about 30 minutes after slice 3, you with
   headphones: R3 against Bungee, simple transition rule against optimizer, Notbahn loop, and how the latency
   feels (soft Notbahn at 256 calculated 22 ms from grab to converter, without crossfade 17 ms with a click only
   in the crash case). Until then R3, the rule and the soft Notbahn apply.
   **Notbahn answered 2026-09-25** (A: "ok, alongside", on the M2 figures): the Notbahn runs alongside the core,
   point, no added latency, click only in the crash case (ADR 016 addendum). The listening session for R3, the
   rule and the latency feel remains.
4. **May the DJ machine's GPU be free during a set?** Stems of fresh songs need it (PyTorch Demucs according to
   research roughly 7 GB of graphics memory, unmeasured); this night, other services occupied 7.6 to 10.6 GiB
   of 12. Default: no GPU stems during a set; fresh songs get stems on the CPU (only at quantum 256, throttled)
   or come into the crate without stems. If you want training paused during a set, say so; then I measure the
   start and end of a stem job next to the core beforehand (M9).
5. **How much routing do you want?** Default for V1: each channel to the master or one of four group buses,
   four sends per channel (echo, reverb, two for plugin effects from slice 8). If you want more (free matrix,
   buses into buses, inserts at any point), say so before slice 1; the mixer is built as a table anyway.

Further decisions with a default, which you can flip at any time, are in the ADRs: external Link devices may not
change our tempo (ADR 004), "pumping" is 0 dB until you explain it (ADR 012), every incoming track is tuned to
440 Hz at import, only when it is within 35 cents and two tools agree; live there is no pitch control (ADR 012);
every channel sounds at fader 0 dB with -16 LUFS (`ziel_lufs`, set unheard); your tempo encoder runs each detent
as a ramp over one beat (ADR 004); beat jump in the loop moves the loop along with it (ADR 007); the Notbahn
fades out after 8 bars (ADR 016).

---

### Andreas' answers (2026-09-23 ~08:15, CLI, verbatim: "1 ok 2 ok 3 listening session only later in the evening 4 feels like a restriction whose reason I don't know 5 ok")

1. **Interface:** accepted (at least four outputs; until then split headphones).
2. **Degree of freedom at the start:** accepted (level 1, only suggest, acceptance by key, stop key).
3. **Listening session:** in the evening, not during the day. Plans schedule listening sessions (M18 and every
   acceptance with sound) for an evening slot that Andreas names; until then the defaults apply (R3, rule, soft
   Notbahn).
4. **GPU in the set:** default NOT accepted, the reason was unknown to him. Counter-proposal from Cypher (answer
   pending): GPU stems in the set allowed as soon as M9 shows that a stem job next to the core produces no
   dropouts; during a set the GPU belongs to the set, other jobs pause. Until the answer, the plans treat M9 as
   a gate, not as a ban.
5. **Routing:** accepted (four group buses, four sends per channel).

## 14. Sources

- `docs/architektur/00-anforderungen.md` (A1 to A26, §9)
- Dossiers: `01-audio-kern.md` §3.2 to 3.9, 4.2 to 4.9, 5, 6, re-check (points 1 to 6, N1 to N6, K1 to K9) ·
  `02-uhr-sync-planer.md` §3, tests a to e, 5, re-check N1 to N6, K1 to K13 · `03-deck-engine.md` §3, 4a to 4f, 5, 6 ·
  `04-mixer-effekte.md` §3, 4.1 to 4.8, 5 · `05-plugins-instrumente.md` §3, 4.1 to 4.5, 5, 6 ·
  `06-erzeuger-muster.md` §3, 4.1 to 4.3, 5, 6 · `08-analyse-passung.md` §3.3, 4.a to 4.f, 5, re-check K1 to K8,
  "Was fehlt" ("What is missing") · `09-ki-steuerung.md` §3, 4.1 to 4.6, 5, re-check K1 to K16, "Was fehlt" ·
  `10-robustheit-betrieb.md` §3a, 3c, 4a to 4d, 5, 6, re-check K1 to K10, N1 to N9
- Workshop interim status: `proben/07-werkstatt-zerleger/c_drift.log` (state 02:59, 11 lines; at the critique
  round 03:46, 16 lines with three YuE2 songs), `c_drift.py`, `b_timemap.log`/`.json`/`.py` (docstring: synthetic
  source, truth known), `b_strecken.log`/`.py` (factor 134/128), `pip_torch.log`
- `proben/08-analyse-passung/probe_b_uebergang.py` lines 149 to 163 (corridors), 219 to 228 (`saat`, the rule of
  thumb), 241 to 252 (styles), 263 to 271 (curve shape); `proben/10-robustheit-betrieb/src/notbahn.c` lines 24,
  77, 90, 96; `minikern.c` line 56 (`sd_notify`)
- Own checks of the critique round (2026-09-23, 04:15 to 05:00, offline, silent): `git ls-files proben` → 0 and
  `git check-ignore` (vendor, `*.log`); `pkg-config` for liblo, libsystemd, nlohmann_json, tomlplusplus, gtest,
  catch2 (missing; control check found rubberband, jack, sndfile); workshop venv (`torch 2.5.1+cpu None`, no
  `websockets`, no `pytest`), system (`torch 2.10.0+cu128`, websockets 16.0, pytest 8.4.2, no demucs),
  `~/.cache/torch` missing, `beat_this` `CHECKPOINT_URL`; `node -e "require('node:sqlite')"` (runs,
  ExperimentalWarning); `nvidia-smi` 7 786 of 12 282 MiB; `ffmpeg -af ebur128=peak=true` on ten MiniMax songs and
  MFB; golden values §1.3 recalculated; Bungee commit 8cb6977, libebur128 commit 67b33ab (MIT)
- `tests/stretch-bench/ERGEBNIS.md` §1, 2.1 to 2.6, 4, 8
- `docs/recherche/2026-09-22-modulares-live-system.md` §3c, 3d, §5; `2026-09-22-loopen-springen.md`;
  `2026-09-22-tracker.md`
- Drafts: `entwuerfe/entwurf-ki.md`, `entwurf-robust.md`, `entwurf-spiel.md`; judges' evaluations (commissioned
  by the synthesis)
- LLM raw data: `proben/09-ki-steuerung/nachpruefung/llm_x_wahl_sonnet_low_ergebnis.json`,
  `llm_x_mcp_sonnet_low_ergebnis.json`, `llm_x_mcp_sonnet_low_denken0_ergebnis.json`,
  `llm_x_text_sonnet_low_pad450000_ergebnis.json` (re-read today)
- Skills (operational findings, not measured today): skill `cypher-musik` (internal), section "Die Zahlen, mit
  denen du planst" ("The numbers you plan with"); skill `cypher-musik-mietgpu` (internal) line 8
- Tool status of the DJ machine, queried today: `pkg-config --modversion` for rubberband, jack, sndfile,
  samplerate, fftw3, lilv-0, alsa, aubio; `libebur128` without development package; `g++`, `cmake`, `ninja`,
  `faust`, `node`, `python3`, `systemctl --user --version`

---

## Critique and corrections (2026-09-23)

*Gap critique of this version, 30 findings (3 blocking, 27 important), incorporated on 2026-09-23 between 04:15
and 05:00. Each finding was checked against its source before incorporation (column "Re-checked"); none was
wrong. No finding was rejected in full; three proposals were accepted only in part (column "Decision", with
reasons). Not executed, because the brief of this round forbids it (no commit, nothing installed, no services):
commit of the test material, new venv, header copies; they stand as tasks in V0 and W1. New measurement IDs:
M19, M20.*

| No. | Finding (weight) | Re-checked | Decision | Where |
|---|---|---|---|---|
| 1 | Autonomy level 1 differs between contract and ADR 013: the contract lets EQ, stem, send, jump, loop through on Andreas' audible deck without acceptance (blocking) | SCHNITTSTELLEN §10 old, read against ADR 013 line 38 f. | **incorporated:** positive list in the contract (every submission becomes a suggestion; alone only load, pre-listen, generate, cancel own plans, own track quieter), golden sequence `autonomie_1_eq` | SCHNITTSTELLEN §10, §19.3; ADR 013 decision 4; §12, §13 question 2 |
| 2 | "Never unheard" only for "unheard becomes heard": one-shot hit on an open pad, pattern on an open generator, Cypher's jump, fader behind a closed crossfader (blocking) | §1.6, §4.5, §4.6, §17 old; 09 line 487 | **incorporated:** I3 = "new content only with a listening pass" (I3a opening via trim and fader, independent of crossfader, bus, master; I3b pad; I3c pattern; I3d Cypher's jump only to a measured target or after acceptance); the listening pass (Hörschein) binds `inhalt` and the source range; new OSC types now defined; summary point 5 made honest | SCHNITTSTELLEN §1.6, §4.4 to §4.8, §16.2, §17, §19.3; ADR 007, 010, 023; summary 5, §3.5, §10 A4, §12 |
| 3 | The header lists 01 as unchecked, although the re-check takes precedence: ADR 006 with "8 offset, 120 µs", ADR 002 with a refuted Rust argument, core evidence only platform, start rule insufficient, 235-fold and 669 superseded | 01 lines 600 ff., K1, K3, K5, K7, K9 read | **incorporated:** header corrected; ADR 006 at most 2 R3 per work thread, start by running through (K3), K2 and K4 as consequences; ADR 002 re-justified (reference implementations C/C++, memory safety weighed, ASan/UBSan as mechanism); core evidence classified; ADR 018 and 001 with 2.5-fold and 1 539 | header, §2.1, §3.1, §7; ADR 001, 002, 006, 016, 018, 020 |
| 4 | Double node with purely timing evidence discarded; null samples concealed; rule "no jumps" is broken by the own encoder (0.01 BPM) and the phase control | ERGEBNIS lines 180, 185 to 187; SCHNITTSTELLEN line 502 old | **incorporated:** double node "deferred, not refuted"; 128 null samples named; hand segment runs each detent as a ramp over 1 beat, phase control at most 10 ppm per block (set); M4 measures small factor changes with null samples at the target and a negative control | §4 rules 3 and 4, M4; SCHNITTSTELLEN §1.3, §7.3 point 7; ADR 004, 006 |
| 5 | "A10 measured offline" holds only within ±5 %; MiniMax needs 0.71 to 1.42 (stretch factor); BPM fidelity of MiniMax unmeasured | c_drift.log (89.905 to 180.709 BPM), ERGEBNIS line 11, 03 §4c, `b_strecken.py`, skill line 59 | **incorporated:** A10 "measured up to about 5 %, unmeasured above that"; half/double tempo choice; gate `streckfaktor` ±15 % (set; of ten songs it lets three through, calculated); new measurement M19 in slice 0 (before W1); M14 with BPM fidelity | §3.6, §5.2, §10 A10, M14, M19; SCHNITTSTELLEN §12.3; ADR 006, 011, 022 |
| 6 | "Sync known in advance" for generated songs hollowed out: strike list allows listening pass without deck against deck, timemap evidence only synthetic, gates check with the tool that set the map, clarity exception | `b_timemap.py` docstring, 08 line 612, c_drift (8 of 10 below 0.1) | **incorporated:** deck against deck not strikable and mandatory for MiniMax; evidence classified as "timemap mechanism with known truth"; grid gate with an independent onset instrument (`fa.py`) and a minimum count; exception in gate `klarheit` removed | §3.6, §9.3, M13; SCHNITTSTELLEN §12.3, §14.5; ADR 006, 011 |
| 7 | Rule of thumb cited only with the sub line; low-end values 0.402 and 0.355 break the contract limits, the planner would have locked both styles | 08 line 644 read | **incorporated:** all bands cited; only `grenze_sub` locks, low-end limits warn until M20 (`grenzen_tief_verriegeln = false`); M20 recalculates the rule against the limits | §3.4, M20; SCHNITTSTELLEN §2.1, §11, §14.4; ADR 012, 013 |
| 8 | Response deadline 4 bars in the contract, ADR 013 calculates with 8 and only tips over 8; turn times of 7.5 to 15 s lapse unnoticed | SCHNITTSTELLEN line 171; ADR 013 lines 67, 83; 09 NP K6; `llm_x_wahl…json` `cache_gelesen` up to 7 410 | **incorporated:** tipping criterion tied to the contract deadline (p95 turn + repair turn ≤ 4 bars); M15 with tool choice and context ≥ 100 000 tokens; withdrawal of the request to F−28 as an exit | §3.4, M15; SCHNITTSTELLEN §3; ADR 013 |
| 9 | Stems in the set depend on an unsecured GPU; three different CPU rules; A19 "measured" while training is idle; question to Andreas missing | research lines 320, 321, 338 f., 581; 10 lines 452, 540; `nvidia-smi` 7 786 of 12 282 MiB | **incorporated:** one rule (CPU stems only at 256 with Nice 19, never at 128; GPU only after question 4 and M9); TensorRT figure marked as not applicable; A19 "only under sustained load"; M9 with VRAM of the real chain and job start/end; question 4 | §3.6, §7, §10 A19, §12, §13 question 4, M9; SCHNITTSTELLEN §2.1, §12.3; ADR 003, 011 |
| 10 | Bar one and text from A13 quietly struck out; hot cues, phrases, bass swap and fallback count from the first beat | search for "Takt-Eins, downbeat": only ADR 004 and 011 (positive test) | **incorporated:** `erste_eins_quell_beat` (beat_this downbeat plus a second method), bars and phrases from there, fallback loop on bar one, gate `eins`, manual correction Shift plus tap (kind `eins`), M13 with downbeat hits; text taken from the prompt, noted as such | §3.6, §10 A13, M13; SCHNITTSTELLEN §1.1, §7.3 point 11, §12.3, §13.2, §13.3, §17; ADR 007, 011 |
| 11 | Immutable folders do not fit with `korrigieren`, `nachrendern` and `korrekturen.jsonl` | ADR 015 line 17; SCHNITTSTELLEN lines 643, 655 old; ADR 021 line 72 | **incorporated**, in a different form from the proposal: each render gets its own version **folder** `fassungen/<bpm·1000>_r<n>/` with `fassung.json` (instead of a file suffix), because stems, one-shots, fingerprint, cross energies and reference also belong to each version; `material.json` is only the source; `korrekturen.jsonl` the only appendable file; loading and the listening pass bind the version | §3.6, §11; SCHNITTSTELLEN §4.4, §4.5, §5.5, §5.9, §6.4, §6.5, §12, §13; ADR 007, 011, 015 |
| 12 | Notbahn knows neither tempo nor bar length; ring (65 536 frames) shorter than one bar | `notbahn.c` lines 24, 77, 96; SCHNITTSTELLEN line 406 | **incorporated:** `takt_frames` and `takt_anfang_w` in the ring header, own history ≥ 384 000 frames, golden sequences `notbahn_124` and `notbahn_rampe`; deviation in ramps calculated (about 7 ms per pass) | §3.2; SCHNITTSTELLEN §6.1, §19.3; ADR 016 |
| 13 | A17 "lots of routing" quietly reinterpreted as a fixed DJ mixer | 00-anforderungen line 116; SCHNITTSTELLEN §1.5 old | **incorporated:** mixer as an assignment table, four group buses with full channel strip, four sends (`fx/3`, `fx/4` for hosts), inserts from slice 8; direction as question 5 to Andreas with a default | §3.1, §10 A17, §13 question 5, §9.3; SCHNITTSTELLEN §1.5, §1.6; ADR 008, 009 |
| 14 | Key matching via the keylock pitch has no path (direct path without stretcher, no pitch control) | ADR 012 line 23; SCHNITTSTELLEN §4.4 old | **incorporated**, with a changed default: offline at import, in the warp run, each piece to 440 Hz (corresponds to 08 question 1 "incoming tracks"), not pairwise live; live there is no pitch path; M19 measures the pitch of the correction | §12, §13; SCHNITTSTELLEN §12.3, §13.2; ADR 012, 006 |
| 15 | Envelope ring delivers three isolator bands; bar report and listening pass need six; `huelle_1khz.npy` undefined (blocking) | SCHNITTSTELLEN §6.2, §14.5, §14.8 old; 08 §3.3.1, §3.3.6, §4.0 | **incorporated** (six-band variant): record of 64 bytes with `band[6]`, filters as `baender.json` shared by core and workshop; `huelle_1khz.npy` [6, N] with the same filters and the same 48-sample RMS, index = frame/48; onset smoothing because of 08 §4.0 failure case 1 in the plan of slice 2 | §3.1, §3.5; SCHNITTSTELLEN §6.2, §13.1, §14.8; ADR 008, 012 |
| 16 | All reference sources and two build dependencies sit unversioned under `proben/` | `git ls-files proben` → 0; `git check-ignore` vendor and `*.log` | **incorporated as task V0** (not executed: this round commits nothing): commit test material without WAV, venv, vendor, exception for evidence logs; libebur128 (67b33ab) to `djk/third_party/`, Bungee (8cb6977) in slice 5 | §8.1, §8.2, §8.3, §9.2; SCHNITTSTELLEN §19.0, §19.4; ADR 021 |
| 17 | `djk/vertrag/` without owner and source; golden list has gaps; `hand_gewinnt` cannot run against the dummy; no ring counterpart | SCHNITTSTELLEN §19 old; golden values recalculated (all correct) | **incorporated:** work item V0 with one owner, `osc.json` as sole source, format of the golden sequences, `/test/hand`, ring dummy; golden list extended by 20 sequences | §8.1, §9.2; SCHNITTSTELLEN header, §19.0 to §19.3; ADR 021 |
| 18 | Notbahn without tempo and bar one; TOML in C without parser | `notbahn.c`; `pkg-config tomlplusplus` missing | **incorporated** (tempo as no. 12; fade-out on bar one); ports as call parameters from `ExecStart`, the Notbahn reads no file | §3.2, §2.1; SCHNITTSTELLEN §2, §6.1, §8; ADR 016 |
| 19 | Build dependencies are insufficient (JSON, TOML, sd_notify, OSC, tests; venv without websockets and pytest; `node:sqlite` experimental; no configuration schema) | `pkg-config`, `/usr/include`, venv and system imports, `node -e` checked by ourselves | **incorporated:** single headers for JSON and TOML, sd_notify and OSC written by us from templates, CTest with own assert header; new workshop venv with `--system-site-packages`; `node:sqlite` stays (it runs), return path `index.json`; schema for all keys. Not adopted: apt packages (single headers need no system change) | §2.1, §8.2; SCHNITTSTELLEN §2.1, §13.4, §19.4 |
| 20 | "audible" without "deck is running"; deck parts without plan and group: a stopped B counts as audible, A's stop still runs despite a hand move, end in silence | SCHNITTSTELLEN §1.6, §4.4, §14.1, §17 old | **incorporated:** audible requires a running deck; deck parts with `plan`, `gruppe`, `hoerschein` (new types); I2 also for plan stops; only an executed stop by Andreas blocks the deadline watchdog; golden sequences `b_verriegelt_a_laeuft_aus`, `hand_stoppt_a_raus` | §5.1; SCHNITTSTELLEN §1.6, §4.4, §14.1, §16.1, §17, §19.3; ADR 023 |
| 21 | Subscribers missing in the restart state, `/e/neustart` goes to nobody; re-registration unregulated | SCHNITTSTELLEN §4.1, §6.3, §16.3 old | **incorporated:** subscribers in the state, `/e/neustart` immediately and after each registration, `/q/stand` per open command, `/k/hallo` after 100 ms without `/uhr` and then every 50 ms; golden sequence `neustart` | §7; SCHNITTSTELLEN §4.1, §5.1, §5.9, §6.3, §16.3; ADR 016 |
| 22 | In the normal sequence the listening pass expires exactly at the start (F−32 + 64 beats = S, I3 requires `<`); §3 and §5.1 contradict each other | recalculated | **incorporated:** renewal after every bar (same `hs_id` replaces), I3 with `≤`, §5.1 aligned with §3; golden sequence `hoerschein_rand` | §3.5, §5.1; SCHNITTSTELLEN §3, §4.5, §14.5, §17 |
| 23 | Where B stands in the material when fading in is nowhere specified | SCHNITTSTELLEN §10, §11, §14 old | **incorporated:** `einstieg_quell_beat` in candidate, choice and plan; pre-listen starts at the entry point, the plan restarts B at S at the entry point (deck part `start`), I3a checks the source position; golden sequence `einstieg` | §5.1; SCHNITTSTELLEN §10, §11, §14.1, §14.2, §14.6, §19.3 |
| 24 | Open whether the stem sum or the base file sounds | search in SCHNITTSTELLEN, ARCHITEKTUR, ADR 007/020 | **incorporated:** with stems the stem sum sounds, without the base file; switched only on load (`mit_stems`); `stem/*` without stems → `keine_stems`; reference and cross energies from what sounds; memory per deck | §3.1; SCHNITTSTELLEN §1.5, §4.4, §13.1, §16.2; ADR 020 |
| 25 | No target LUFS, trim up to +12 dB: generated songs cannot reach a target above about −15.5 LUFS | all eleven values re-measured ourselves with `ffmpeg ebur128` (−13.6 to −15.5; MFB −7.5) | **incorporated**, with one deviation: `ziel_lufs` −16 as a default to nod through, trim up to +24 dB, limiter −1 dBTP; the trim is calculated **by the core on load** from `ziel_lufs` and the LUFS of the version (not the workshop), so a changed default needs no re-render | §3.6, §13; SCHNITTSTELLEN §1.5, §2.1, §13.2; ADR 006, 008 |
| 26 | §14.4 does not describe the measured rule of thumb; example plan deviates (kill instead of EQ, A down to −200) | `probe_b_uebergang.py` lines 219 to 228, 241 to 252 and curve shape lines 263 to 271 read | **incorporated:** §14.4 as complete rule with anchor values per bar (1-based), example plan §14.1 exactly according to it; `a_eq_hoch_ab_takt` for "hard" was wrong (2 instead of 4) and is dropped; deviations count as "measured" only after recalculation; golden sequence `expandiere_sicher` | §3.4, §5.1; SCHNITTSTELLEN §11, §14.1, §14.4; ADR 012 |
| 27 | Workshop chain on the DJ machine not ready to run (venv only CPU torch, no weights, GPU occupied, CPU rule contradictory, grid gate before M13 not buildable) | venv and system imports, `~/.cache/torch`, `CHECKPOINT_URL`, `nvidia-smi` checked ourselves | **incorporated:** W1 without stems, new venv, weights fetched in advance with a size check (over 1 GB only with Andreas' yes), CPU rule as no. 9, grid gate with a named instrument. **Partly rejected:** as detector not beat_this on the warped result (it set the map, no. 6) but the `fa.py` onsets; the gate remains a block for Cypher (A4), a warning for Andreas | §2.1, §3.6, §8.2, §9.2 W1; SCHNITTSTELLEN §12.3, §19.4; ADR 011 |
| 28 | Acceptance tests of slice 1 not measurable (no load profile, no external-load rule, L1 without test list, player and MCP without acceptance, W1 depends on M13) | 10 NP K2 (2 in 405 136 cycles), worksheet 01:25 | **incorporated:** load profile P1 as a script, limit "at most 1 gap, then a repeat with 0", external load in the report, above 4 provisional (M10); L1 mandatory cases; player and MCP with acceptance; W1 tied to the checks from c_drift instead of the M13 verdict | §9.2; ADR 021 |
| 29 | Notbahn and later building blocks connect ports themselves, without an interlock against unrequested sound | `notbahn.c` line 90; 00-anforderungen §9 | **incorporated:** positive list (`stumm`, `cypherdj-pruef-*`), real interface only with `--ton-frei` or `ton_frei` after Andreas' release, test units only transient; never removed | §3.2, §9.3; SCHNITTSTELLEN §8, §19.5; ADR 016 |
| 30 | Re-check 01 listed as missing; M3 measures in the wrong mode, start recipe incomplete, Rust justification refuted | as no. 3 | **incorporated** (together with no. 3): M3 in pull mode with 1, 2 and 4 R3 per thread and start rule in the callback; ADR 006 start rule; ADR 002 re-justified | M3, §3.1; ADR 002, 006, 020 |
