# ADR 038: SEQ decks on deck channels (the DJ output of the arrangement grows to six channels)

Superseded by ADR 043 (containers as the console unit): the DJ-channel numbering, the place channel and the fixed module slots of this decision are replaced by the four containers and their one input each. The text below is kept as the record.

Status: built on branch `seq-deck-kern` (plan 2026-11-14 `seq-deck-s1`, task 4). The page server derivation for a group with a `seq` document (`playback.ts`) is part of the same task; the SEQ document itself is task 1, the commands task 3, the place on the page task 7. Not yet merged into main, not yet heard on the studio instance; Andreas' listening acceptance is open.
Decided: by Cypher as defaults in the spec `docs/superpowers/specs/2026-11-14-seq-deck-design.md` section 6 (decision D11) and the plan `docs/superpowers/plans/2026-11-14-seq-deck-s1.md`; Andreas may override. Origin: Andreas, 2026-11-14 (a step sequencer as a fourth place type next to deck, loop and Strudel).
Supersedes: nothing. It widens the output kind `dj` of ADR 037 from two channels to six; the production master, nested groups (ADR 036) and the loop slots work as before.
Predecessors: ADR 037 (the output kind `dj`, decisions 1, 2, 3 and 8 are generalised here), ADR 033 (routing, production master), ADR 036 (nested groups: a DJ output sits on a top group only).
Interface text: `docs/architecture/INTERFACES.md` section 4.11 (playback `live` and the group output `dj`) and section 20 (change log 2026-11-14).
Spec: `docs/superpowers/specs/2026-11-14-seq-deck-design.md` section 6.

## Context

A SEQ deck is a top group of the live container, built like a loop module: one instrument track per voice, each with a MIDI clip rendered from the sequencer document. It sits in a place of the DJ view (place 1 to 4, `Gruppe.seq.platz`) and has to be heard through the channel strip of its place, like every other thing in that place: trim, EQ, kill, filter, fader, crossfader side, PFL and the three FX sends. A group without an output of its own plays into the production master, which the kernel adds into `erz/4`. All SEQ decks would then share one strip with the whole production, and the place would have no strip in the DJ view.

The strip of a place is there already: `deck/N` is the channel of the place N, and the page shows its mixer strip whether a deck is loaded or not. ADR 037 solved the same problem for the loop slots with an output kind `dj` that adds a group's signal in front of the strip of `pad/1` or `pad/2`. The same mechanism reaches the strip of `deck/N`; only the channel table and its bounds are wider.

## Decision

1. **The output kind `dj` grows from `nr` 1..2 to 1..6.** `nr` 1 and 2 are `pad/1` and `pad/2` as before (slot A and slot B). `nr` 3..6 are `deck/1`..`deck/4`: a SEQ deck in place N has `nr` N + 2. The loader refuses `nr` outside 1 to 6, `dj` without the head flag `live`, and two groups with the same `nr` (reason `format`, as in ADR 037 decision 1). A playback that uses only `nr` 1 and 2, and every playback without `live`, is read and played exactly as before.
2. **Derived, not stored (ADR 037 decision 2, widened).** The project file gets no output field. `djk/ui/project/playback.ts` gives a top group of a live project that holds a `seq` document the output `{art: 'dj', nr: seq.platz + 2}`; a top group with a module slot keeps `nr` 1 (A) or 2 (B). A group with neither, or a nested group, has master or `gruppe` as before. Reason: the output cannot drift out of step with the place.
3. **Real-time exit (ADR 037 decision 3, widened).** `Arrangement::block` keeps its signature. `dj_ausgang()` takes six stereo pairs (index = `nr` - 1; the constant `Arrangement::DJ_KANAELE` is 6). The kernel owns six pairs of `MAX_BLOCK` floats, sized at construction, and a table `dj_kanal_` of six mixer indices (`pad/1`, `pad/2`, `deck/1`..`deck/4`, from `Mixer::kanal_index`). Per sub-block it asks `dj_kanal_aktiv(nr)` once before `block()`, zeroes and hands only the pairs a group of the snapshot leads into, and adds each handed pair into the channel input `erz_l_`/`erz_r_` of its channel. No allocation, no lock and no loop of unbounded length in the callback: the loops run over six fixed entries and a channel nobody feeds is not touched, so a playback without a DJ output differs from before only by the scan of six channels instead of two per sub-block (six `dj_kanal_aktiv` answers, each a loop over the 16 groups of the snapshot).
4. **The add stays after `decks_block`.** `decks_block` writes the deck audio into the channel inputs `deck/1..4` earlier in the same sub-block (`core_signalbox.cpp:678`); the DJ add sits behind the loop boxes and the streams (`:788-802`) and uses `+=`. A SEQ deck therefore sums with a deck that plays on the same channel instead of replacing it or being replaced by it, and both pass the same strip.
5. **A DJ output is a pointer to a pair, and a missing pair means the master (ADR 037 decision 8, unchanged).** A caller that never calls `dj_ausgang()`, or the offline switch, sends the group to the production master. For `nr` 3..6 as for 1 and 2.
6. **The hold `dj_rest_` works per channel number, unchanged.** A swap that takes the DJ output from a group keeps its channel number for 960 samples, so the fade of its tracks runs into the pair of that channel. The number is stored as the channel number 1..6; nothing in the hold knew a limit of 2.
7. **Offline treats every DJ channel as master (ADR 037 decision 5, widened).** `cypherdj-render` sets the offline switch, and a group on `nr` 3..6 then sums into the master and the production master tap like a group on `nr` 1. Export, loudness, merge and bounce hear a SEQ deck. A deck channel has no deck playing in a render, so there is nothing to add to.
8. **Mutation target `CYPHERDJ_MUTATION_ARR_DJ_NUR_PAD`:** a `nr` above 2 falls to the master. It makes `test_arr_dj_kanal` red (cases 13, 14, 15); it is named in the CMake test list next to the three mutations of ADR 037.

## What a deck strip does differently from the spec's wish, accepted

The strip of `deck/N` is a deck strip, and three things differ from a strip made for the SEQ deck (spec section 6; verified in `core_signalbox.cpp`):

1. **No recorder tap.** The recorder taps are `erz/1..3`, `erz/5..7`, `pad/1` and `pad/2` (`REC_MIXER`). A SEQ deck cannot be recorded into the loop library from its own channel. The master recorder can record it.
2. **The envelope ring follows the channel, not only the deck.** The envelope ring of a deck channel (the page waveform source and the ear behind the hand tool `hoeren`, `GET /hoeren`) was fed only while a track was loaded on that deck (`huellen_block`, `belegt[c] = decks_->deck[c].geladen()` for `c < 4`), so a SEQ deck on an empty deck could be heard and metered but not measured by the ear. Since the fix of 2026-11-15 `belegt[c]` is also true while a group leads into the channel (`dj_gereicht_[2 + c]`, the same condition as the level report below), and the page server accepts a place with a SEQ deck as "loaded" for `/hoeren` (`hoerLage`, `ear.ts`). The `quell_beat` of the ring record stays NaN without a loaded deck. Test: case 17 of `test_arr_dj_kanal`.
3. **The deck's own audio and the SEQ deck share the strip.** A deck loaded and started on `deck/N` while a SEQ deck sits in place N plays on the same fader (decision 4). The page will hide the deck of a SEQ place (task 7, not built yet), after which only the hand tools reach it. The gates of the spec (`kanal_offen`, `deck_laeuft`, `seq_belegt`) narrow the ways to get there, and the remaining one is a known gap of slice 1.

4. **A sidechain key on `deck/N` does not hear the SEQ group.** `dj_schluessel` hands the inputs `deck/1..4` to the stages before `block()`, and the group is added into the channel input after it, so a compressor keyed on `deck/N` hears the deck's own audio only, not the SEQ voices of that channel. A key on the production sum or on `erz/4` is not affected by this (a DJ group is not in it either).

## Level reporting

`/pegel` for `deck/N` is emitted while a track is loaded on that deck or a group of the playback leads into that channel (`Kern::pegel_melden`; before, a loaded track was the only condition, so a SEQ deck on an empty deck was audible but its strip meter and the `pegel` hand tool stayed empty). The second condition is `dj_gereicht_[N + 1]`, the answer `dj_kanal_aktiv` gave before `block()` in the last sub-block of the cycle; it includes the held tail of a group that was just cleared. `pegel_melden` runs in the audio callback right after `audio()`, so this is a plain member read on the audio thread, with no lock and no access to the arrangement from another thread. A deck channel with neither condition still reports nothing, as before (the peak is read and discarded).

## Rejected channels

- **`erz/4`** (the production sum): no strip in the DJ view, and all SEQ decks on one fader.
- **`erz/5..7`**: played by the Baukasten streams of the Strudel place, and they take part in the recorder taps as the Strudel instruments.
- **A new channel**: the strip of the place is already there and is the one Andreas reaches for.

## Consequences

- **Formats.** Playback `cypherdj-arr/2`: the group `ausgang` kind `dj` takes `nr` 1 to 6. No new OSC address, no new reason (`format`), version stays 1. An older core refuses `nr` above 2 with `format` (`ausgang.nr ... DJ-Kanal`): core and render program are built and started together, as with ADR 036 and ADR 037. The project file is unchanged.
- **Agent texts and tools.** None in this task. The SEQ commands and their gates follow in tasks 3 and 5.
- **Cost.** Four more float pairs of `MAX_BLOCK` (8192) in the kernel: 4 x 2 x 8192 x 4 bytes = 256 KiB, and four more pointer pairs in the arrangement. The kernel zeroes and adds a pair only when a group leads into the channel.
- **Listening.** How a SEQ voice sounds through the strip of its deck channel (EQ, kill, filter, fader, crossfader side) is Andreas' to judge in the acceptance listening.
- **Open.** The measurement on the test instance (a SEQ deck in place 1 audible on `deck/1` only, with the loop slots A and B and another deck playing at the same time; `cb_max` within 1431 us) is task 8, not in this ADR.
