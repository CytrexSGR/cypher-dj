# ADR 042: loop deck cells play through a launcher in the arrangement engine

Status: decided, being built by the plan `docs/superpowers/plans/2026-11-20-loop-deck.md` (index) and its lane files. Nothing of it is merged or measured at the time of writing; the stand document `docs/architecture/stand/loop-deck.md` describes what exists and what is still open.
Decided: in the spec `docs/superpowers/specs/2026-11-20-loop-deck-design.md` (design v1, 2026-11-20), points D1 to D5 by Andreas, the rest by Cypher as defaults.
Supersedes: nothing. It replaces the module slots A and B of the LOOPS place in use (they stay in the code until a clean-up) and does not touch ADR 025 (loop boxes) or ADR 037 (loop slots on DJ channels) beyond that.
Spec: `docs/superpowers/specs/2026-11-20-loop-deck-design.md`.

## Context

Today the LOOPS place of the DJ view holds two module slots, A and B. Each slot is a loop box of the old engine (ADR 025, ADR 037) with one main loop and its stems, and plays on the DJ channel `pad/1` or `pad/2`. Andreas asked on 2026-11-20 for a loop deck that is "professional": four loops per deck instead of one, eight loop containers per track in a scene view, one mixer channel per deck, operated from the Traktor Kontrol S8. Decided by him: the building block is the cell (D1), a cell holds one main loop and no stems (D2), one channel per deck (D3), first the deck in the DJ view and the MATRIX view later (D4), slicing is taken into account (D5).

The master plan asks for one launcher (`docs/masterplan/MASTERPLAN.md`). Two engines exist that could play such cells: the legacy loop boxes and the arrangement engine of the core. The loop boxes know one loop each, have no tracks, strips or group sums, and a second launcher beside a first one would split the model of the later MATRIX view from the model of the deck.

## Decision

1. **The launcher lives in the arrangement engine, with its own voices on the core beat.** A new core part (`djk/core/src/arr_launcher.cpp`) holds a voice pool of its own and one state per deck track (playing cell, pending cell). Cells play through the same tracks, strips, group sums, keylock works (Bungee) and DJ output routing that clips use. The legacy loop boxes are not extended. A loop deck group is translated to the DJ output `nr = platz`, so deck 1 plays on `pad/1` and deck 2 on `pad/2`, next to the rules for `modul.slot` and `seq.platz` in `playback.ts`.
2. **The launcher is independent of the transport.** Its voices map position from the core beat, `(beat - ab_beat + versatz) mod beats`, never from the transport. They start and play with the arrangement transport stopped (a snapshot with the live container must be loaded) and are not ended by stop, locate, loop wrap or the region seam. The places that end or fade clip voices were listed from the code (index section 2.1): all of them iterate the clip voice pool, which the launcher does not use. The deliberate exceptions end launcher voices: a new set (`/k/set/neu`, deviation 4 of the plan), unloading the snapshot, and Stop Cypher for pending launches by Cypher.
3. **The model is `Gruppe.loopdeck` and `Spur.zellen`.** A loop deck is a top group of the live container with exactly four audio tracks of eight cells each. Launches are runtime only: not part of the project file and not part of undo. The commands are a new family, `project/commands_loopdeck.ts`, each one undo step. Each cell carries a `pfad_hinweis` besides the fields of the spec so the decode cache can rebuild its audio (deviation 1).
4. **The core owns the launch state, the page server mirrors it.** Two new core commands, `/k/arr/zelle_start` and `/k/arr/zelle_stopp`, and one state event, `/zustand/zelle` (on change and at 2 Hz). The commands address the track by its project track id as text (`spur ,s`, hashed in the core with `arr_id`) and the cell by index, never by pointer or track number, so a snapshot swap re-resolves them and a reordering of tracks does not mislead them (deviation 8). A newer launch for a track replaces the pending one, which is answered with status 7 `abgebrochen`, reason `abbruch` (deviation 9). A start on a silent track has a hard onset so that the first sample sits on `ab_beat`; the fade over `ARR_NAHT` applies to a switch and to a late start (deviation 7).
5. **The page server picks the grid point.** The launch grid (`1/4`, `1/2`, `1`, `takt`, `4takte`) is defined on the core beat alone: the page server extrapolates the core beat from the last `/uhr`, adds an 80 ms lead and rounds up to a multiple of the grid. It does not use `szenenZielBeat`, which needs a running transport. The bar is four core beats, with the caveats recorded in the stand document (deviation 5).
6. **An audio under a playing cell survives edits.** A launcher voice holds its audio through a hold counter and a deferred free in the loader thread, not through a literal reference held by the audio callback (deviation 3: the audio cache is single-threaded and unmaps at reference count zero, so the callback must not touch it). Replacing, clearing or moving a playing cell does not cut the sound; the state event then reports the track as playing audio that is no longer the cell's (`verwaist`).
7. **Six more page server routes than the spec names** (`/loopdeck/zelle`, `bewegen`, `raster`, `spur`, `leeren`, `neu`, deviation 2). The hand, the S8 and the page write without carrying a project revision, and `/proj/aendern` answers `rev_veraltet` without one.
8. **One mixer channel per deck, one filter per track.** The per-track filter is a new control row `spur/<n>/filter` played by one `DjFilter` per arrangement track, not a project insert.

## Consequences

- The MATRIX view (many tracks side by side with full strips, rows as scenes) is built later on the same model and the same launcher; the model needs no change for it except that `zellen` is allowed on more track types.
- The loop boxes, the `/modul/*` routes and the module slot code stay until a clean-up. A loop deck on `platz` n and a module in slot n exclude each other in one project; creating a deck turns the module's main loop into cell 1 of track 1 and removes the module group in the same undo step.
- Launches are not rendered: `cypherdj-render` ignores cells, and a launched take cannot be reproduced offline. All core targets are built together.
- A cell's audio is at most 60 s; the page server refuses a load that would push the distinct decoded audio of the live project over 512 MiB (`audio_budget`), so the old and the new snapshot of a full set replacement fit into the core's 1024 MiB arrangement budget during the swap.
- Bar lines of the launch grid and bar lines of the transport coincide only under the conditions of the stand document; a transport started with quant 0 or 1, a start beat that is not a multiple of 4, loop regions whose length is not a multiple of 4, and meters other than 4/4 are recorded and not fixed.
- Another core command family and another state event enter the contract; the filter row enters seven name lists that `contract/check_name_lists.py` compares.
- The track decks export their running loop into a loop deck track with `LOOP → 1 2 3 4` (`POST /loopdeck/laden`, source `von_deck`, plan task P5, requested by Andreas on 2026-11-20: "die anderen decks brauchen dann eine export L1-L4 in das neue loop deck"). SEQ and Strudel decks need a render for that and are not part of this build.

## Addendum 2026-11-20: channel strip per track

Andreas asked for the reach a Strudel stream has, per loop track and inside the deck ("ja im deck selbst, passt"). Every loop deck
track gets a three-band isolator EQ with kill, a HALL and a DELAY send and one effect slot; the deck stays one mixer channel.

1. **Kill is model state, not a control row.** `Spur.kill` marks a band; the page server writes -200 dB on the band's EQ row
   (`spur/<n>/eq/tief|mitte|hoch`) while the kill is on and the stored knob value when it goes off. The core knows only the three
   EQ rows per track, played by one `cypherdj::dsp::Isolator` per arrangement track right behind the filter, bypassed bit-exactly
   while neutral and crossfaded over `ARR_NAHT` when it leaves or enters the bypass (the band sum is an all-pass, a hard switch
   would click). Reason: three kill rows per track would cost 96 more rows the table does not have, and a kill is a state the
   page, the S8 and the hand must all see, which the model already carries.
2. **A return of the live container may sound in a DJ channel pair.** The snapshot field `returns[].ausgang` takes
   `{art: 'dj', nr}` like a group; the return's post-fader signal then adds into that pair instead of the production master sum,
   and never enters the PM chain or its delay alignment. The deck's HALL and DELAY returns (`Return.loopdeck = {platz, art}`)
   use it, so the wet signal follows the deck's mixer channel, its fader, kill and crossfader like the dry one. Reason: a return
   on the production master would keep sounding with the deck fader closed.
3. **The Baukasten stage pool stays at 8.** Up to four effect slots per deck and one delay return per deck can ask for ten
   stages; the one that does not fit is refused `kein_platz` and the page says so. Reason: a larger pool needs more control rows
   (`spur/<slot>/bk/<k>`), and after the EQ rows the control table is at 4052 of 4096, exactly at its 44-row margin.

Consequences: the next control row family needs `MAX_REGLER` raised first (due with the MATRIX view). A project has four returns;
two loop decks with both sends use all of them, and a SEQ deck in the same container then has none left. The wet return path is
not delay compensated against a latent stage elsewhere in the container (up to about 1 ms). `fx-delay-sync` is wet only and is
therefore offered on the delay return, never in the effect slot.
