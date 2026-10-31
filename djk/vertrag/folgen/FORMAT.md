# Golden sequences: format and runner rules (Contract 1)

Based on: `docs/architektur/SCHNITTSTELLEN.md` §19.0 (format) and §19.3 (mandatory sequences). Structure per line:
`djk/vertrag/folge.schema.json`. Checking all files: `python3 djk/vertrag/pruefe_folgen.py`. Every sequence runs against the core mock (slice 13) and against the core (runner `attrappe_leitstand.py`, slice 08).

1. **File.** `djk/vertrag/folgen/<name>.jsonl`, UTF-8, one JSON line per step. The runner works through the steps in file order.
2. **Time axis.** The first step of every sequence is `sende` with `/k/set/neu` and `sample` 0 ("immediately"). The sequence counts from the acknowledgement `gestartet` of this command in samples of the new time axis (§1.1: sample 0 is the first cycle after that). Until this acknowledgement arrives, the runner waits at most 2 s of wall-clock time, otherwise the sequence is red.
3. **`sende`** `{"t":"sende","sample":S,"osc":[adresse, typen, w1, …]}`: the runner sends the message as soon as the core clock has reached S (extrapolated from `/uhr`, §5.2). The sequence plans the lead time itself according to §3 (S lies early enough before the target beat of the command).
4. **Identifiers.** Fields named `id` or `ziel_id` (type `h`, names from `osc.json`) carry small numbers from 1 in the sequence. The runner adds a base B (its `mono_ns` at the start of the sequence, §1.4) when sending and when comparing, so that identifiers stay strictly increasing across runs.
5. **`hand`** `{"t":"hand","sample":S,"pfad":P,"midi_roh":x}`: the runner sends `/test/hand ,sfh` with `[P, x, S]` at least 2 cycles plus transport before S (§3); effective at sample S (only with `pruefmodus = true`).
6. **`erwarte`** `{"t":"erwarte","bis_sample":S,"osc":[adresse, typen, w1, …],"toleranz":x}`: a message with the same address and the same type string, whose values match, must arrive before the core clock exceeds S. Comparison per value: `null` matches everything; `i`, `h`, `s` exactly; `f`, `d` with |actual − target| ≤ `toleranz` (default 0); `"NaN"` matches only NaN, `"inf"`/`"-inf"` only infinity with this sign. Searched among all messages received since the start of the sequence that have not yet been consumed; a message fulfills at most one step. The order of the `erwarte` lines does not fix an order of the messages.
7. **`wert`** `{"t":"wert","sample":S,"pfad":P,"wert":v,"toleranz":x}`: the control P has the value v ± x at sample S (core: from `/e/regler`; mock and libraries: directly from their control table).
8. **End.** Green if all `erwarte` and `wert` steps are fulfilled and no unconsumed message `/e/protokollfehler`, `/e/invariante` or `/q` with status 4 to 8 remains (an unexpected rejection or delay makes the sequence red).
9. **`absicht`** (only for `sende`): `unbekannte_adresse` or `falsche_typen` marks a deliberately contract-violating message; `pruefe_folgen.py` checks that it really is one.
10. **`notiz`**: free text for humans, no effect. The runner ignores further fields in a line (contract rule for JSON: new optional fields are allowed); later slices may thus add e.g. `herleitung` without breaking this format. New step types (`t`) are only added with a line in this file.
11. **Quantum.** Sequences that expect `/uhr` choose block starts that apply at quantum 128 and 256 (multiples of 256 samples).
12. **Origin of the numbers.** Nobody copies expected values: `erzeuge_folgen.py` computes them with `karte.py` (formulas from §1.3), and `pruefe_folgen.py` compares `karte.py` with the golden table in §1.3.

## Additions from slice 09

Additive to points 1 to 12: no existing line changes its meaning. Structure per line: `folge.schema.json`; derivation and checking of the sequences from 09: `erzeuge_golden.py`, `pruefe_golden.py`; comparison of an observation with a sequence in code: `folgen_vergleich.py`.

13. **Runner as subscriber.** Before the first line, the runner registers with `/k/hallo` (name and port of its check instance, Z2) and repeats it every second (heartbeat, §4.1). If no `/uhr` arrives for 100 ms, it sends immediately and then every 50 ms (§16.3). A sequence never sends `/k/hallo` itself; `neustart` relies on this heartbeat.
14. **Additional fields.** Each line may carry `herleitung` (section and formula, for reading only) and `bereich` (`zeitachse`, `regler`, `ki`, `deck`, `hoerschein`, `schuss`, `erzeuger`, `invariante`, `pruefstand`, `leitstand`, `rechner`). A runner runs the sequences that `INDEX.json` names under `fuer` for its slice. If it does not build an area (the Stellwerk (interlocking) library of slice 11 without decks, listening passs and invariants), it skips the lines of that area; the sequences named for it are built so that the remaining lines give the same result for it as for the full core. `erwarte` may carry `ab_sample`: the window is then `[ab_sample, bis_sample]`, otherwise `[0, bis_sample]`. Whoever does not read `ab_sample` checks more weakly, never wrongly.
15. **Order of actions.** `sende`, `buendel`, `hand`, `aktion` and `ws_sende` are in non-decreasing sample order; the runner works them through in file order.
16. **New step types.** A runner that does not know a step type aborts red; it may skip silently only under point 14.

    | `t` | Fields | Meaning |
    |---|---|---|
    | `erwarte_nicht` | `ab_sample`, `bis_sample`, `osc`, `toleranz`? | in the window no matching message arrives (consumed or not); negative control |
    | `erlaube` | `ab_sample`, `bis_sample`, `osc`, `herleitung` | matching messages in the window are allowed (none to many) and do not count under point 8; only where the contract leaves open whether a message comes (point 22) |
    | `buendel` | `sample`, `nachrichten` | OSC bundle with time tag 1 ("immediately"), §4.8; `t_send_us` is 0 (diagnostics only) |
    | `deck_wert` | `sample`, `deck`, `feld`, `wert`, `toleranz` | `feld` from `/zustand/deck` §5.5 (`status`, `quell_beat`, `beats_bis_ende`, `faktor`); core: from `/zustand/deck` (50 Hz; linear between two reports, `status` the last report before); mock and library: from their deck model |
    | `messung` | `sample`, `name`, `wert`, `toleranz` | the test bench measures at the target (JACK recorder on its own null sink): `schleife_frames`, `stille_ms`, `rueckgabe_raster_abw_samples` |
    | `aktion` | `sample`, `was` | intervention by the test bench, today only `kern_kill9` |
    | `ws_sende`, `ws_erwarte` | `sample` or `ab_sample`, `bis_sample`; `typ`, `daten` | WebSocket to or from the Leitstand (control station) (§9); the envelope §9.1 is set by the runner; comparison as subset (expected keys must be present and match, further keys are allowed, lists have equal length) |
    | `rechner_frage`, `rechner_antwort` | `zeile` | one JSON line to the computer (§11) or its answer, comparison as subset |

17. **Computer sequences** consist only of `rechner_frage` and `rechner_antwort` and have no time axis (exception to point 2; `pruefe_folgen.py` allows them without `/k/set/neu`).
18. **Leitstand sequences.** The runner forwards the OSC lines directly to the core (or to the core mock). The Leitstand runs alongside as a subscriber; the `ws_*` lines go to the Leitstand.
19. **Identifiers in WebSocket and computer.** `id` in `rpc` and in computer lines applies as written; the base B from point 4 applies only to OSC.
20. **Tolerance.** As point 6 (default 0). The sequences from 09 carry `toleranz` in every line with floating-point values: 1e-6 for beats and BPM in acknowledgements, otherwise the value that their `herleitung` justifies.
21. **Fixtures and directory.** Every `material_id` from `/k/deck/laden` or `/k/schuss` lies under `folgen/material/<material_id>/` (JSON only; the audio data are deterministic and are generated). The runner writes the material before the sequence with `python3 djk/vertrag/erzeuge_material.py --ziel <arbeitsbestand>` into the working set (§6.4). `f0000000000000ff` is missing on purpose (`material_fehlt`). `folgen/INDEX.json` names for each sequence `von` (02 or 09), `fuer` (the slices that run it), `bereiche`, `schritt_arten` and `material`.
    The sequences presuppose the defaults from §2.1 (`ziel_lufs` −16, `hoerbar_db` −26, `tief_offen_db` −12) and `pruefmodus = true`. Every fixture except `f0000000000000c3` (−9.4 LUFS) and `f0000000000000d4` (−45 LUFS), which only uses `laden`, has `lufs_integriert` −16, thus trim 0 dB (§1.5): so the thresholds from §1.6 lie directly on the fader values of the sequences.
22. **Open readings of the contract** (finding for the main instance). Where the text allows two readings, no sequence fixes one, except as named here. Until the main instance decides, the following applies:
    a. Whether an I3 rejection additionally reports `/e/invariante hoerschein` (§5.9 knows the kind, §17 names only the acknowledgement): open, `erlaube`.
    b. Whether a rejection at the start drags the coupling group along (§4.3 "fall together"): open. Sequences that check a rejection give the rejected parts no group. (`kern_sim.mjs` from the overnight run drags them along.)
    c. An executed deck start is complete and no longer falls with a later group abort (`hand_gewinnt`).
    d. The transfer curve "skaliert" (§7.2) is not fixed: the sequences use extremes (0.0 and 1.0) and directions, never an intermediate value.
    e. A waiting part on the grabbed control falls at the grab (status 7 `hand`, ADR 023) or at its own start (status 6 `regler_beim_menschen`, §4.3): open, status free (`sub_doppelt`).
    f. Whether a plan stop waiting because of I2 reports its own `/e/invariante master_leer`: open, `erlaube`. The waiting stop remains `angenommen` (§17 I2); an acknowledgement `gestartet` is red.
    g. `/test/hand` on `<k>/xseite` (three positions): value = `round(2·midi_roh)`; `crossfader_luecke` checks that with a `wert` line before it relies on it.
    h. `/erz/quittung` counts `ungehoert` when the window is inserted (reply to the bundle), not only when it is played.
    i. Reason at status 5 (`verspaetet_ausgefuehrt`): `""` or `zu_spaet`, both permissible; at status 4 `zu_spaet`.
    j. `/k/hoerschein` carries the source `pruefstand` in the sequences (§1.4 knows no source `analyse`).
    k. A part rejected at the start reports `ist_sample` = its target sample (§17 "am Start abgelehnt").
    l. Whether `/e/frist` still comes between setting the fallback loop and reaching the loop (§5.5 "∞ im Loop"): open, no line.
    m. Whether the fallback ends already when a command arrives at the deck or only when it is executed: open, the window begins at sending (`rueckfall`).
    n. Whether I1 checks a setting with its target value (dossier 09 §5.3 V1) or with the value of its switch ramp (dossier 09, re-check NK3: plan §14.1 would then have 192 samples of sub twice at S): open. No sequence closes a bass by setting it at the same sample at which a channel becomes audible while another is fully open. The setting lies one beat earlier, as long as the channel still lies behind the closed fader (`b_rein` in `folgen_bau.py`, `hand_stoppt_a_raus`).

    **Decided 2026-09-25 (Andreas; sheet `docs/architektur/entwuerfe/2026-09-25-lesarten-09.md`):**
    b: yes, the rejection at the start drags the group along (SCHNITTSTELLEN §4.3 field 11). e: the waiting part falls at the grab, status 7 `hand` (§4.3, ADR 023). n: I1 checks via the switch ramp (§17); the rule §14.4 sets B's bass one beat before S (`herleitung.expandiere`, `expandiere_sicher.jsonl`). a, f: each reported once. i: `""`. j: source `leitstand`. l: no `/e/frist`. m: end at execution. c, d, g, h, k: as above. **Still open:** the sequences that keep b, e, n, a, f, i, l, m open with `erlaube` or status `null` are to be sharpened to `erwarte`/`erwarte_nicht` (belongs to slice 20, or before 13; until then they let both readings through).
