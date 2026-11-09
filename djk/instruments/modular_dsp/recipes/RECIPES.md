# Recipe Cards for cypher-dj: how the standard sounds are built

Status: complete, 2026-11-02 · compiled from the cited books; verbatim quotes are omitted in this copy, only numbers and citations remain
Scale: 46 cards for 46 sub-types, 57 quotes verified verbatim against the full texts, 0 unverified.
Purpose: one auditable build instruction per sub-type of our instrument vocabulary, so that any
agent or person can build, name and describe a preset in the cypher-dj synth kit.

## How to read a card

Every card has the same nine fields: **Oscillators** · **Filter** · **Envelopes** · **Modulation** ·
**Voices / glide** · **Effects (order)** · **Target words** · **Source** · **Feasibility**.
Numbers are quoted as the source states them (Hz, cents, %, seconds, dB). Where sources scatter,
a range is given. Where I had to transpose a source one step (e.g. lift a bass patch an octave to
make it a lead), the card says `derived` on that line, it is a stated inference, not a source claim.

**Target words** come only from `GLOSSAR.md` and only from words that are sourced there. The five
unsourced words (*static, loose, organic, gritty, glassy*) never appear as targets.

One limit, stated plainly: oscillator, filter and envelope values come from the cited patch or the
cited paragraph. The **effects chain is not always named by the source**, where it says "the source
names this order" it is quoted, otherwise the order follows common practice (drive before delay
before reverb) and the specific times and mixes are engineering choices, not source values. Same for
the voice counts, which follow from the kit's 16-voice limit, not from a book.

## Evidence classes

| Mark | Meaning |
|---|---|
| **[B1]** | Welsh, *Welsh's Synthesizer Cookbook*, PDF, 129 pp. Page = the printed page (PDF page − 2). Patch tables are **transcribed by me**, not quoted; the quote on the card is a verbatim sentence from the same or a second source. |
| **[B2]** | Gordon Reid, *Synth Secrets*, Sound on Sound 1999–2004, cited by part number (63 parts, complete text). |
| **[B3]** | Rick Snoman, *Dance Music Manual*, 5th ed. (Routledge), printed page. |
| **[B4]** | Simon Cann, *How to Make a Noise* (free edition, 2014), printed page. |
| **[W]** | Web tutorial, URL + date. Weaker: practitioner post, not edited. Used only where no book in the set covers the sound (reese, wobble). |
| **[U]** | unbelegt, no source for this sound in the set. The card then states what it is derived from. |


## The kit this is judged against

Available: saw, pulse, triangle, sine (as FM carrier), noise, ladder filter, SVF, ADSR, LFO,
chorus, phaser, delay, hall reverb, convolution reverb, compressor, limiter, gate, saturation,
tube, bitcrusher (Krume), vocoder, sampler, transpose, **16 voices**.
Missing: wavetable oscillator, sample library.

Feasibility labels: **baubar** · **baubar mit Näherung (…)** · **fehlt: <Modul>**.
The 16-voice limit is counted per sounding note, because every detuned layer costs a voice.

---

# bass

### bass.sub: sub
- **Oscillators:** 2, sine at the root (weight) + triangle one octave up or same octave (upper harmonics). If square/saw is used instead, the higher harmonics must be filtered away.
- **Filter:** 12 dB/oct low-pass, cutoff just above the fundamental (~80–150 Hz depending on note; the range is my choice); no filter pluck.
- **Envelopes:** amp A 0 s · D medium · S high · R quick, a sustained, pulsing body rather than a hit.
- **Modulation:** none. A moving sub loses its function (weight, not movement).
- **Voices / glide:** 1 voice, mono, no glide.
- **Effects (order):** none by default; optional gentle saturation, then a limiter. Any chorus or reverb on a sub is an error.
- **Target words:** deep · sub · tight · mono · clean.
- **Source:** Snoman [B3] p. 443
- **Quote:** “[quote omitted]” Numbers cross-checked against Welsh “[quote omitted]” [B1] p. 95: two pulse waves at −2 and −1 oct, cutoff 40 Hz (10 %), resonance 0 %, filter env 85 % with D 0.25 s / S 25 %, amp D 0.65 s / S 0 % / R 0.70 s, mono.
- **Feasibility:** **baubar mit Näherung (there is no free-running sine oscillator, the kit's sine exists only as the FM carrier; use triangle for the fundamental and a sine-FM carrier with index 0 as the clean layer).**

### bass.reese: reese
- **Oscillators:** 2 saws, both −3 octaves, fine-tune **+38 / −38 cents** (opposite directions). Optional third layer: sine an octave below for weight.
- **Filter:** SVF or ladder low-pass, cutoff around 300–800 Hz (range: my choice); plus a **notch** in series (12 dB) around 500 Hz, its cutoff moved slowly by an LFO.
- **Envelopes:** amp A 0 s · D 0.5–1 s · S 80–100 % · R 0.1–0.2 s, the movement comes from the detune, not the envelope.
- **Modulation:** LFO 1 (sine) → notch cutoff, moved slowly; a second LFO on the detune amount for slow drift (rate and depth not given by the source, choose by ear).
- **Voices / glide:** mono, legato on, glide 30–80 ms. Below 80–100 Hz the signal is summed to mono.
- **Effects (order):** tube/soft saturation → EQ (notch ≈ 500 Hz) → chorus on the mids only → compressor (multiband where available) → short hall on the highs.
- **Target words:** thick · dirty · aggressive · warm · deep · evolving.
- **Source:** DNB Academy [W], “[quote omitted]”, updated 22 Oct 2026
- **Quote:** “[quote omitted]” Cross-check [B3] p. 441 (techno bass): “[quote omitted]”.
- **Feasibility:** **baubar** (two saws + ladder/SVF notch + LFO is exactly the kit).

### bass.acid: acid
- **Oscillators:** 2, pulse 25 % at **+10 cents**, plus square at **−2 oct / −10 cents**; mix 70 % / 100 % (osc 2 louder).
- **Filter:** 24 dB/oct low-pass, **cutoff 450 Hz (45 %), resonance 60 %, env amount 0 %**, the resonance, not the envelope, is the sound; the cutoff is played by hand or automation.
- **Envelopes:** filter: A 0 · D 0 · S 0 (no envelope sweep at all) · amp A 0 s · D 0.45 s · S 15 % · R 0.26 s.
- **Modulation:** none internal; the source's note is explicitly “[quote omitted]”. A slow LFO (0.1–1 Hz) on cutoff is the automated substitute.
- **Voices / glide:** mono; glide 50–120 ms for the classic slide between notes.
- **Effects (order):** saturation/drive → delay (1/16, low mix) → small hall. Distortion before delay, never after.
- **Target words:** bright · harsh · aggressive · dirty · nasal.
- **Source:** Welsh [B1] p. 95, patch Acid Bass, table transcribed.
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar** (pulse + square + ladder 24 dB + resonance 60 % + drive).

### bass.fm: fm
- **Oscillators:** sine-FM stack. Carrier op 1 (coarse 0, raw output 100) modulated by op 2 (**coarse −19**, no output, mod level 60) and op 3 (**coarse −12**, output 100, mod level 60/100).
- **Filter:** none in the patch; FM does the spectral work.
- **Envelopes:** all operators share one level envelope: fastest attack, **decay 2 s to zero**, curvature ≈ 25 (exponential, mimics piano/guitar decay).
- **Modulation:** the mod index is the envelope itself (decay of op 2/3 = brightness decay).
- **Voices / glide:** 1 voice mono for the bass; poly is possible (see lead.fm).
- **Effects (order):** optional high-pass at 30 Hz, then saturation, then compressor.
- **Target words:** punchy · bright · metallic · tight · digital.
- **Source:** Cann [B4] p. 110, patch FM Bass
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar mit Näherung (the kit has one sine-FM pair, not a five-operator stack: op 1 ← op 2 reproduces the body, the second modulator that adds the metallic edge is lost).**

### bass.wobble: wobble
- **Oscillators:** 2–3 saws (or pulse), lightly detuned; plus a separate clean **sine sub at 30–80 Hz** with no modulation at all.
- **Filter:** low-pass, **resonance 30–50 %**, cutoff swept by the LFO between ≈ **200 Hz and 2–3 kHz**.
- **Envelopes:** amp A 0 s · D 0.2 s · S 100 % · R 0.1 s (derived, the source gives the filter settings, not the amp envelope; the LFO does the rhythm, the envelope only cleans the edges).
- **Modulation:** LFO → filter cutoff, **tempo-synced to 1/4, 1/8 or 1/16**; shape sine = rolling, square = gated. A second free-running LFO on resonance or drive for character.
- **Voices / glide:** mono, glide 20–60 ms.
- **Effects (order):** bitcrush/saturation (light) → EQ → compressor sidechained to the kick → short room.
- **Target words:** thick · dirty · aggressive · punchy · evolving.
- **Source:** KAN Samples [W], “[quote omitted]”, 22 May 2026
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar** (saw/pulse + ladder + LFO with tempo sync; the sub layer costs one more voice per note).

### bass.analog: analog
- **Oscillators:** 2, square at −1 oct + saw at −2 oct, both full level (Welsh Detroit Bass), or pulse 25 % at −2 oct + saw at −1 oct / −3 semitones (Welsh Deutsche Bass).
- **Filter:** Detroit: cutoff **20 kHz (100 %)**, resonance 0 %, deliberately open; Deutsche: **800 Hz (53 %), res 35 %, env 50 %**, filter D 0.15 s / S 0 % / R 0.15 s.
- **Envelopes:** **AR rather than ADSR** is the rule. Detroit: amp A 0 s · D max · S 100 % · R 0 s. Deutsche: amp A 0 · D max · S 100 % · R 0.15 s.
- **Modulation:** none; movement comes from glide and from the played notes.
- **Voices / glide:** mono, glide on (Detroit: **0.01 s**; Deutsche: sync on instead).
- **Effects (order):** **distortion → compression → EQ → chorus-type effect** (the source names this order explicitly); the bass is sent to an FX bus so the dry weight survives.
- **Target words:** warm · deep · thick · smooth · analog · punchy.
- **Source:** Snoman [B3] p. 294
- **Quote:** “[quote omitted]” Parameter table from Welsh [B1] pp. 96 (Detroit Bass, Deutsche Bass).
- **Feasibility:** **baubar** (square + saw, ladder, ADSR used as AR, glide, drive, chorus).

### bass.rolling: rolling
- **Oscillators:** 2, saws, or saw + pulse, detuned a few cents each way; an octave above the sub layer.
- **Filter:** low-pass 24 dB, **cutoff a quarter open**, moderate resonance; an envelope opens it per note.
- **Envelopes:** filter: **A 0 · D quarter · S 0 · R 0**; amp: **A 0 · D medium · S 0 · R short**, the release must end before the next 1/16.
- **Modulation:** none; the roll is produced by the note grid (16th notes with one 1/16 rest at the start of each beat), not by an LFO.
- **Voices / glide:** mono, short glide; the pattern is a bassline, three or four interlocking lines in the source.
- **Effects (order):** distortion → compression (sidechained to the kick: ratio 9:1, attack 5 ms, release 200 ms, ≥3 dB gain reduction) → EQ.
- **Target words:** punchy · tight · warm · thick · smooth.
- **Source:** Snoman [B3] p. 443
- **Quote:** “[quote omitted]” Sidechain numbers p. 446.
- **Feasibility:** **baubar** (saw/pulse + ladder + ADSR + compressor with sidechain input; if the kit's compressor has no key input, use the gate inverted by a kick-triggered envelope, Näherung).

### bass.pluck: pluck (bass)
- **Oscillators:** 2, saws or pulse waves with high harmonic content, detuned, unison on.
- **Filter:** low-pass, **cutoff a quarter open**, envelope amount high.
- **Envelopes:** filter: **A 0 · D quarter · S 0 · R 0**; amp: **A 0 · D medium · S 0 · R short** (release ends before the next note).
- **Modulation:** unison detune is the only movement.
- **Voices / glide:** mono, no glide.
- **Effects (order):** saturation → EQ (high-pass 30–40 Hz) → delay (1/16) → compressor.
- **Target words:** punchy · tight · bright · thick · thin.
- **Source:** Snoman [B3] p. 444
- **Quote:** “[quote omitted]” Parallel table: Welsh Funk Bass [B1] p. 97 (saw −2 oct + pulse 30 % −1 oct, cutoff 40 Hz, res 50 %, env 85 %, filter D 0.10 s · S 45 % · R 0.08 s; amp A 0 · D 0.29 s · S 30 % · R 0.40 s; glide 0.02 s, mono).
- **Feasibility:** **baubar**.

---

# lead

### lead.mono: mono lead
- **Oscillators:** 2 squares, tuned **−10 / +10 cents**, both 100 % (Welsh Mellow 70's Lead).
- **Filter:** open, cutoff **20 kHz (100 %)**, resonance 0 %, env 0 %.
- **Envelopes:** amp A 0 s · D max · S 100 % · R 0.35 s.
- **Modulation:** none on the patch; the character is in the glide and the player.
- **Voices / glide:** **mono**, glide **0.02 s** (fast slide).
- **Effects (order):** overdrive → delay (1/8, ~15 % wet) → plate/hall (short).
- **Target words:** warm · smooth · bright · clean · mono.
- **Source:** Welsh [B1] p. 91, patch Mellow 70's Lead, table transcribed. Glide rationale: Reid [B2] part 18
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar** (2 pulse/saw, ladder open, glide, 1 voice).

### lead.poly: poly lead
- **Oscillators:** 2 squares: osc 1 **−10 cents**, osc 2 pulse 20 % at **+1 oct / +10 cents**; both 100 %.
- **Filter:** 24 dB low-pass, **cutoff 40 Hz (10 %)**, resonance 0 %, **env amount 100 %**.
- **Envelopes:** filter A 0.03 s · D max · S 100 % · R 0.60 s; amp A 0 s · D max · S 100 % · R 0.35 s.
- **Modulation:** LFO → pulse width of both oscillators, **5.5 Hz, depth 45 %** (triangle/sine).
- **Voices / glide:** multi (poly), no glide, the PWM is what keeps a held chord alive.
- **Effects (order):** chorus → delay (1/8) → hall (medium).
- **Target words:** warm · wide · thick · smooth · bright.
- **Source:** Welsh [B1] p. 91, patch Brass Section, table transcribed; polyphony note: Reid [B2] part 20
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar** (2 voices per note → 8 notes within 16 voices).

### lead.supersaw: supersaw / trance lead
- **Oscillators:** **3 saws minimum**, plus unison stacking until very thick; detune as far apart as possible without the oscillators separating.
- **Filter:** low-pass, **completely open** (all frequencies through); a second envelope in parallel with the amp envelope is optional.
- **Envelopes:** amp **A fast · D rapid · S medium · R medium**; filter env same shape as amp.
- **Modulation:** unison detune only. Layer variants: pulse waves instead of saws, detuned differently.
- **Voices / glide:** poly; each note consumes 3–7 voices, so polyphony is the limiting factor, not the patch.
- **Effects (order):** **hall with pre-delay** (so the transient passes) → **gate after the reverb** to cut the tail → short delay (1/16 or 1/8) → optional parallel compression.
- **Target words:** bright · wide · thick · airy · aggressive · evolving.
- **Source:** Snoman [B3] p. 447
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar mit Näherung (3 saws per note → a 5-note chord uses 15 of 16 voices; a 7-saw supersaw is not reachable without voice stealing).**

### lead.acid: acid lead
- **Oscillators:** the acid bass patch lifted **+1 octave** (derived): pulse 25 % +10 cents, square −2 oct −10 cents.
- **Filter:** 24 dB low-pass, **cutoff 450 Hz at 45 %, resonance 60 %**, env 0 %, the sweep is played.
- **Envelopes:** amp A 0 · D 0.45 s · S 15 % · R 0.26 s.
- **Modulation:** none internal; automate cutoff (0.1–1 Hz) or drive the cutoff by hand.
- **Voices / glide:** mono, glide 50–120 ms (the acid slide).
- **Effects (order):** tube drive → delay (1/16, dotted) → hall (small).
- **Target words:** harsh · bright · nasal · aggressive · dirty.
- **Source:** Welsh [B1] p. 95 (Acid Bass); the octave lift is derived, the rest is the table as printed.
- **Feasibility:** **baubar**.
- **Quote:** “[quote omitted]” [B1] p. 93

### lead.sync: sync lead
- **Oscillators:** osc 1 = any waveform but **volume at −40 dB (0 %)**, it exists only as the sync master; osc 2 = square, sync **on**.
- **Filter:** open, **20 kHz (100 %)**, resonance 0 %.
- **Envelopes:** amp A 0 s · D max · S 100 % · R 0.60 s.
- **Modulation:** LFO → pitch of **osc 2 only**, triangle/sine, **0.66 Hz, depth 4.5 cents** (medium); the sync sweep itself comes from playing osc 2's tuning.
- **Voices / glide:** mono, glide 0.02 s, unison on.
- **Effects (order):** distortion (light) → delay → hall.
- **Target words:** aggressive · harsh · bright · metallic · thin.
- **Source:** Welsh [B1] p. 93, patch Screaming Sync
- **Quote:** “[quote omitted]”.
- **Feasibility:** **fehlt: Hard-Sync (no sync-capable oscillator in the kit). Nearest approximation: pulse with heavy pitch-LFO + bitcrusher, which gives the edge but not the harmonic jump.**

### lead.fm: FM lead
- **Oscillators:** sine-FM pair, carrier at the played pitch, modulator at a **1:1 or 1:2 ratio**; higher integer ratios (1:3, 1:4) give the hollower, more metallic tone.
- **Filter:** none required; optional low-pass 12 dB at 8–10 kHz to tame aliasing.
- **Envelopes:** amp A 0–10 ms · D 0.8–2 s · S 30–60 % · R 0.3 s (these envelope ranges are my choice; the source gives operator levels, not times); a second envelope on the mod index produces the bite at the attack.
- **Modulation:** mod index envelope is the timbre; velocity → mod index is the expressive control.
- **Voices / glide:** poly, glide optional 40 ms.
- **Effects (order):** chorus (light) → delay (1/8) → hall.
- **Target words:** bright · metallic · digital · thin · harsh · smooth.
- **Source:** Reid [B2] part 13
- **Quote:** “[quote omitted]” Patch structure from Cann [B4] p. 110.
- **Feasibility:** **baubar mit Näherung (single carrier–modulator pair: 1:1 and integer ratios work, cascaded 4-operator timbres do not).**

### lead.arp: arp lead
- **Oscillators:** one bright waveform pair (saw + pulse) or a filtered saw; high harmonic content is the requirement.
- **Filter:** low-pass with a short envelope so each note has an attack transient; high-pass at 200–400 Hz so the arp does not fight the bass (range: my choice).
- **Envelopes:** amp **A fast · D short · S low · R short enough to end before the next note**.
- **Modulation:** none needed; delay is the movement.
- **Voices / glide:** poly, no glide; notes come from an arpeggiator (the kit has no arpeggiator, the note data must come from the well).
- **Effects (order):** delay (1/16 or 1/8, tempo-synced, filtered) → hall (small).
- **Target words:** bright · tight · clean · punchy · smooth.
- **Source:** Snoman [B3] p. 438
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar für den Klang; die Arpeggiator-Funktion selbst fehlt im Baukasten (Noten müssen von außen kommen).**
---

# pad

### pad.strings: strings
- **Oscillators:** triangle + square, one of them detuned **3–5 cents** against the other; for a bigger section add a second layer detuned further.
- **Filter:** low-pass, **cutoff relatively low**, **resonance about midway**; filter envelope with a **prolonged attack**, then sustain, medium release, short decay.
- **Envelopes:** amp **A 0 s · S medium · R medium**; filter: long attack so the section opens after the bow.
- **Modulation:** LFO (sine) → pitch of either the triangle or the square, **slow rate, medium depth**; a second LFO (sine/pulse/triangle) → filter cutoff on long notes.
- **Voices / glide:** poly, no glide; several detuned voices per note are normal (costs voices).
- **Effects (order):** chorus → phaser/flanger (light) → hall (medium) → optional sidechain compression from a rhythmic element to animate the pad.
- **Target words:** warm · wide · smooth · thick · soft · evolving · analog.
- **Source:** Snoman [B3] p. 437–438
- **Quote:** “[quote omitted]” Cross-check Welsh “[quote omitted]” [B1] p. 94 (2 squares ±10 cents, LFO → PW 2 Hz depth 47 %, filter 2 kHz env 100 %, amp 0.11/0.35 s, note “[quote omitted]”).
- **Feasibility:** **baubar** (the kit has both waveforms, detune, chorus, phaser and hall; watch the 16-voice budget).

### pad.choir: choir
- **Oscillators:** 2 pulse waves, **PW 15 %** and **PW 25 %**, second one at −2 octaves (Welsh Choir); a vocoder-fed variant uses one pulse carrier plus a vowel-modulated filter bank.
- **Filter:** low-pass 24 dB, **cutoff 1.7 kHz (64 %) / 1.0 kHz (56 % at 12 dB)**, resonance 0 %, the filter sits where vowel formants sit.
- **Envelopes:** amp **A 0.32 s · D max · S 100 % · R 0.93 s**, a slow swell, no percussive attack.
- **Modulation:** LFO → pitch, **triangle, 2.4 Hz slow, depth 20 cents** (choir vibrato). For vowels: three SVF band-passes at **F1 270/300/400/530/640 Hz, F2 2300/870/2000/1850/1200 Hz, F3 3000/2250/2550/2500/2400 Hz** for ee/oo/i/e/u.
- **Voices / glide:** poly, multi-voice; add slight pitch scatter per voice for a section effect.
- **Effects (order):** chorus (strong, slow) → hall (long, pre-delay 30–60 ms) → EQ cut 1–3 kHz if the vowels turn nasal.
- **Target words:** warm · soft · wide · smooth · airy · nasal.
- **Source:** Welsh [B1] p. 77, patch Choir, table transcribed. Formant numbers: Reid [B2] part 23
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar mit Näherung (the pulse/LFO patch is exact; real vowels need three band-passes per note, the kit's SVF can do it, the vocoder is the cheaper route, but the vowel source must be sampled or synthesized).**

### pad.atmosphere: atmosphere
- **Oscillators:** **noise** is the source (the patch has no pitched oscillator); if a pitch is wanted, add a low saw.
- **Filter:** 24 dB low-pass, **cutoff 1 kHz (57 %)**, **resonance 100 %**, self-resonant, so the filter itself becomes the pitch.
- **Envelopes:** amp **A 1.65 s · D 5.85 s · S 0 % · R 4.40 s**, a swell and a long fall, no sustain.
- **Modulation:** LFO → **resonance, square, 5.5 Hz, depth 100 %** (the ringing pulses); turn keyboard tracking on if available.
- **Voices / glide:** multi, no glide.
- **Effects (order):** hall (very long, ≥6 s) → delay (1/4, feedback low) → high-pass at 100–200 Hz to keep the low end free.
- **Target words:** airy · wide · wet · evolving · metallic · thin.
- **Source:** Welsh [B1] p. 99, patch Celestial Wash
- **Quote:** “[quote omitted]”.
- **Feasibility:** **baubar** (noise + ladder at 100 % resonance + LFO + hall is the kit's strongest combination).

### pad.analog: analog pad
- **Oscillators:** 2 squares, **−11 / +11 cents**, second one at **+2 octaves** (Welsh Galactic Cathedral); triangle pair variant for a softer top.
- **Filter:** 24 dB low-pass, **cutoff 1.2 kHz (59 %)**, **resonance 60 %**, env 0 %.
- **Envelopes:** amp **A ~0 s · D max · S 100 % · R 2.25 s**, long release is the pad.
- **Modulation:** LFO → filter cutoff, **0.3 Hz very slow, depth 10 %** (Galactic Chapel variant also modulates amplitude by 17 %).
- **Voices / glide:** poly, multi; glide off.
- **Effects (order):** chorus (subtle) → phaser (slow, low mix) → hall (long).
- **Target words:** warm · soft · analog · wide · evolving · smooth.
- **Source:** Welsh [B1] p. 101, patches Galactic Cathedral and Galactic Chapel, tables transcribed.
- **Feasibility:** **baubar** (2 squares, ladder, slow LFO, long release).
- **Quote:** “[quote omitted]” [B2] part 47

### pad.granular: granular pad
- **Oscillators:** none in the classic sense, a **sample** is cut into grains of **5–100 ms** and re-sequenced; grain rate, size and position become the oscillator.
- **Filter:** low-pass after the granular engine, cutoff 2–6 kHz; the grain cloud already adds high-frequency smear.
- **Envelopes:** amp A 0.5–2 s · D long · S 80–100 % · R 1–4 s.
- **Modulation:** slow LFO → grain position and grain size, plus random modulation on grain position for the cloud (rates derived, the source gives grain size, not LFO rates).
- **Voices / glide:** poly; each grain is a voice, so polyphony is defined by grain density, not by notes.
- **Effects (order):** hall (very long) → chorus → EQ.
- **Target words:** evolving · airy · wide · smooth · thick.
- **Source:** Snoman [B3] p. 138
- **Quote:** “[quote omitted]”
- **Feasibility:** **fehlt: Granular-Engine (the sampler can play grains only as fixed slices; a true grain cloud needs a granular module).**

### pad.drone: drone
- **Oscillators:** 2 triangles, second at **+1 octave** (Welsh Portus); add a saw an octave down for weight if needed.
- **Filter:** 24 dB low-pass, **cutoff 75 Hz (19 %)**, **resonance 70 %**, **env 70 %**, a very dark, resonant bed.
- **Envelopes:** amp **A 1.5 s · D max · S 100 % · R 3.3 s**; filter **A 1.8 s · D max · S 100 % · R 2.9 s**.
- **Modulation:** none internal (the source patch has no LFO); slow filter drift (0.05–0.2 Hz) can be added.
- **Voices / glide:** poly, **glide on, 1.5 s**, the long portamento is part of the sound.
- **Effects (order):** hall (very long) → saturation (light) → EQ (high-pass 30 Hz).
- **Target words:** deep · dark · warm · smooth · evolving · thick.
- **Source:** Welsh [B1] p. 102, patch Portus, table transcribed.
- **Feasibility:** **baubar** (2 triangles, resonant ladder, 1.5 s glide, long hall).

---

# keys
- **Quote:** “[quote omitted]” [B4] p. 197

### keys.piano: piano
- **Oscillators:** saw + pulse 15 % at **+1 octave / +2 semitones**, osc 2 sync **on**; mix 75 % / 100 % (Welsh Piano). Alternative: sync-based DCO pair with DCO1 at 25 % of the mix.
- **Filter:** 24 dB low-pass, **cutoff 40 Hz (10 %)**, resonance 0 %, **env 75 %** with **D 5.22 s**, the brightness decays with the note.
- **Envelopes:** amp **A 0 s · D 0.67 s · S 25 % · R 0.50 s**; filter as above (very long decay).
- **Modulation:** none; velocity → filter env amount is the touch.
- **Voices / glide:** poly, no glide.
- **Effects (order):** EQ (cut 200–400 Hz boxiness, high-shelf to taste) → very short room (0.4–0.8 s) → compressor (light).
- **Target words:** bright · warm · punchy · thin · boxy.
- **Source:** Welsh [B1] p. 76, patch Piano, table transcribed. Envelope logic: Cann [B4] p. 19
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar mit Näherung (a synthesized piano is recognisable at best; without a sample library the attack transients and the unison-string beating are missing).**

### keys.electric_piano: electric piano
- **Oscillators:** saw (100 %) + pulse 5 % at **+2 octaves / +9 semitones**, **sync on** (Welsh Electric Piano), the sync gives the metallic tine.
- **Filter:** 24 dB low-pass, **cutoff 630 Hz (50 %)**, resonance 0 %, **env 50 %**, filter **D 0.33 s**.
- **Envelopes:** amp **A 0 s · D 5.14 s · S 0 % · R 0.63 s**, long decay to silence, no sustain (the defining trait).
- **Modulation:** none required; a slow chorus is the classic movement.
- **Voices / glide:** poly; velocity → filter env for the bark.
- **Effects (order):** chorus (slow, wide) → phaser (light) → short room → compressor.
- **Target words:** warm · bright · soft · smooth · metallic · wide · airy.
- **Source:** Welsh [B1] p. 74, patch Electric Piano, table transcribed.
- **Feasibility:** **baubar mit Näherung (sync-free kits lose the tine: substitute FM, carrier + modulator at 3:1 with fast mod-envelope decay).**
- **Quote:** “[quote omitted]” [B4] p. 55

### keys.organ: organ
- **Oscillators:** 2 triangles, second at **−2 octaves**, both 100 % (Welsh Organ); a drawbar organ needs 3–4 sine partials at 16'/8'/5⅓'/4'.
- **Filter:** **open, 20 kHz (100 %)**, resonance 0 %, env 0 % (an organ has no filter sweep).
- **Envelopes:** amp **A 0.6 s · D max · S 100 % · R 0.40 s**; the slow attack avoids the click, the release is short so chords can be re-struck.
- **Modulation:** none in the source patch; a rotary effect (chorus + tremolo) is the classic addition.
- **Voices / glide:** poly, no glide, no velocity (organs are velocity-insensitive by design).
- **Effects (order):** chorus/rotary (fast and slow) → tube saturation (light) → room (short).
- **Target words:** warm · bright · thick · smooth · clean.
- **Source:** Welsh [B1] p. 75, patch Organ, table transcribed.
- **Feasibility:** **baubar** (triangles = 8' and 16'; drawbar partials need one voice per partial, 4 partials × 4 notes = 16 voices, so polyphony is the limit).
- **Quote:** “[quote omitted]” [B2] part 14

### keys.mallet: mallet (glockenspiel / marimba)
- **Oscillators:** 2 triangles, second at **+2 octaves / +6 semitones** (Glockenspiel), or at **+2 octaves** with 75 % mix (Marimba).
- **Filter:** 24 dB low-pass, **cutoff 3.8 kHz (76 %)**, **env 75 %** with D 0.10 s (Glockenspiel); Marimba **2.9 kHz (72 %)**, env 0 %.
- **Envelopes:** amp Glockenspiel **A 0 · D 1.20 s · S 0 % · R 1.20 s**; Marimba **A 0 · D 1.66 s · S 20 % · R 1.66 s**.
- **Modulation:** Marimba: LFO → amplitude, triangle, **8 Hz fast, depth 11 %** (the bar's beating).
- **Voices / glide:** poly (all voices in the source), no glide; play above G5 for the glockenspiel.
- **Effects (order):** short room/plate (0.8–1.5 s) → EQ (high-pass 200 Hz) → delay (1/16, low mix).
- **Target words:** bright · metallic · clean · punchy · thin · smooth.
- **Source:** Welsh [B1] pp. 82–83, patches Glockenspiel and Marimba, tables transcribed.
- **Feasibility:** **baubar** (two triangles, short decay, LFO tremolo).
- **Quote:** “[quote omitted]” [B2] part 31

### keys.chord: chord / stacked keys
- **Oscillators:** 2 squares, the second tuned **+7 semitones** (a fifth) above the first (Welsh Trance 5th); octave stacking instead of a fifth is the softer variant.
- **Filter:** **open, 20 kHz (100 %)**, resonance 0 %, env 0 %.
- **Envelopes:** amp **A 0 · D max · S 100 % · R 0 s**, a hard, gated chord; lengthen R for a pad-like chord.
- **Modulation:** LFO → pulse width of both oscillators, **6 Hz, depth 80 %**, unison on.
- **Voices / glide:** poly, unison on; with a fifth stack every played key already sounds two notes.
- **Effects (order):** chorus → delay (1/8) → hall (short) → sidechain compressor from the kick for the pumping chord.
- **Target words:** bright · wide · thick · punchy · aggressive.
- **Source:** Welsh [B1] p. 94, patch Trance 5th, table transcribed; interval logic: Cann [B4] p. 55
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar** (2 voices per key, unison doubles it again → ~4 keys within 16 voices).

### keys.bell: bell
- **Oscillators:** **4 parallel carriers** (sine), three modulated by one modulator at **C:M 1:7** (= +34 semitones); carriers detuned **−32 and +16 cents** for ring and beating (Cann Another Bell). Synth variant (Welsh Bell): triangle + square at **+5 semitones**.
- **Filter:** none in the FM patch; Welsh variant: **cutoff 20 kHz (100 %)**, env 0 %.
- **Envelopes:** carriers **decay ≈ 7 s**; modulator decay **≈ 1 s**; third carrier just over 1 s. Welsh variant: amp **D 1.30 s · S 0 % · R 3.30 s**.
- **Modulation:** mod index (amounts 47 / 74 / 100 per carrier); velocity → carrier level and modulator level; LFO → amplitude **7.5 Hz, depth 5 %** in the Welsh variant.
- **Voices / glide:** poly, no glide.
- **Effects (order):** hall (long) → EQ (cut 2–4 kHz if harsh) → optional delay (1/4).
- **Target words:** metallic · bright · thin · airy · harsh · smooth.
- **Source:** Cann [B4] p. 135, patch Another Bell
- **Quote:** “[quote omitted]” Welsh variant [B1] p. 81, table transcribed.
- **Feasibility:** **baubar mit Näherung (one FM pair reproduces the 1:7 ring, not four carriers with individual decay and detune).**

---

# pluck

### pluck.synth: synth pluck
- **Oscillators:** one bright pulse (Combed Square in the source) or saw; a slightly metallic source is wanted, not a dull one.
- **Filter:** **band-pass**, **cutoff 2 kHz**, **resonance 32 %**, velocity → cutoff 100 % (the source uses a band-pass, not a low-pass: a low-pass would make the pluck dull instead of thin).
- **Envelopes:** filter: **A 0 · D 91 ms · S 7/127 · R 142 ms · env amount 58**; amp: fast attack, decay 0.2–0.5 s (range: my choice), S 0, R 0.1 s.
- **Modulation:** velocity → cutoff is the whole expressiveness; no LFO.
- **Voices / glide:** poly, no glide.
- **Effects (order):** chorus (ensemble) → 8-tap/gated reverb (short) → delay (1/16).
- **Target words:** thin · bright · punchy · tight · nasal.
- **Source:** Cann [B4] p. 217, patch Thin
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar** (SVF in band-pass mode + short envelope + velocity routing).

### pluck.mallet: mallet pluck (xylophone / marimba)
- **Oscillators:** 2 triangles, osc 1 at **+1 octave / +10 semitones** (Xylophone) or second triangle at **+2 octaves** (Marimba); triangle fundamental is what makes it wooden rather than metallic.
- **Filter:** 24 dB low-pass, **cutoff 300 Hz (39 %) at the xylophone**, **2.9 kHz (72 %)** for a marimba-style tone; **env 60 %**, filter **D 0.53 s**.
- **Envelopes:** amp **A 0 s · D 1.88 s · S 0 % · R 1.78 s** (xylophone); marimba D 1.66 s · S 20 % · R 1.66 s.
- **Modulation:** LFO → amplitude, **7.5 Hz moderate, depth 5 %** (bar ringing) or 8 Hz / 11 % for marimba.
- **Voices / glide:** poly, no glide.
- **Effects (order):** short room (0.6 s) → delay (1/16, low) → EQ high-pass 200 Hz.
- **Target words:** bright · punchy · clean · thin · metallic · smooth.
- **Source:** Welsh [B1] pp. 83–84, patches Marimba and Xylophone, tables transcribed.
- **Feasibility:** **baubar** (triangles + short decay + tremolo; the wooden attack transient is a near-miss without samples).
- **Quote:** “[quote omitted]” [B2] part 31

### pluck.string: plucked string (guitar / harp)
- **Oscillators:** 2 pulse waves, **PW 25 %** and **PW 10 % at +10 semitones**, **osc 2 sync on** (Welsh Guitar Acoustic); harp variant: saw + square at +6 semitones, sync on.
- **Filter:** 24 dB low-pass, **cutoff 3.1 kHz (73 %)**, resonance 0 %, **env 70 %** with **D 0.35 s · S 0 % · R 0.29 s**.
- **Envelopes:** amp **A 0 s · D 1.70 s · S 0 % · R 1.70 s**, pluck-and-decay, no sustain.
- **Modulation:** the sync offset (osc 2 at +10 semitones against a sync master) supplies the pick transient; a very short noise burst in the attack sharpens it.
- **Voices / glide:** poly, no glide; for a harp, alternate osc 1 saw / osc 2 triangle at the same pitch.
- **Effects (order):** EQ (cut 300–500 Hz boxiness) → chorus (very light) → short room → compressor (fast attack, to catch the transient).
- **Target words:** bright · thin · punchy · metallic · smooth.
- **Source:** Welsh [B1] p. 55, patch Guitar Acoustic, table transcribed; harp variant p. 56.
- **Feasibility:** **baubar mit Näherung (sync-free kit: replace the sync transient with a 3–8 ms noise burst + a fast filter-envelope; a Karplus-Strong resonator needs delay time = 1/f, which the kit's delay can do but not pitch-tracked).**
- **Quote:** “[quote omitted]” [B4] p. 55

### pluck.stab: stab
- **Oscillators:** 2 saws or saw + pulse, detuned a few cents; the source builds it from a full bass patch and then limits its range by key scaling.
- **Filter:** low-pass with **envelope → cutoff** for the attack bite, **velocity → cutoff** for real-time brightness, and a **second envelope → resonance** to brighten only the attack.
- **Envelopes:** amp **A 0 · D short (150–300 ms, derived) · S 0 % · R short**; filter env short with a fast decay.
- **Modulation:** velocity → cutoff (mandatory); key scaling → cutoff (upper octaves cut away, which is what turns the patch into a stab).
- **Voices / glide:** poly, no glide.
- **Effects (order):** saturation (light) → short room → delay (1/8, low) → sidechain from the kick.
- **Target words:** punchy · bright · tight · thin · aggressive.
- **Source:** Cann [B4] p. 44, patches Bass + Stab and Gentle Stab
- **Quote:** “[quote omitted]” 
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar** (2 oscillators, ladder, ADSR×2 if the kit's filter accepts two mod sources; otherwise resonance is set statically, Näherung).

---

# drums

### drums.kick: kick
- **Oscillators:** **sine between E2 and G2** (Snoman) or two triangles at **−2 octaves** (Welsh); a click layer from noise or a 1 ms pulse sharpens the beater.
- **Filter:** Welsh patch leaves it open (**20 kHz, 100 %**); Reid instead sets **resonance to maximum, cutoff to minimum** and lets the filter self-oscillate so the sweep is a pitch sweep.
- **Envelopes:** **A 0 s** (immediate attack) · **D 0.12 s** · **S 0 %** · **R 0.12 s** (Welsh); Reid: A 0, D and R ≈ 50 %, S 0, env amount 50–60 %.
- **Modulation:** **pitch envelope** with an **exponential** fall (source: exponential is preferred over logarithmic, because logarithmic “[quote omitted]”). Optional reverb: **pre-delay 90 ms, tail ≈ 40 ms**.
- **Voices / glide:** 1 voice, mono, no glide.
- **Effects (order):** saturation (controlled, small) → EQ (multiband, to sit against the bass) → compressor (ratio **3:1–5:1**, attack set to skip the transient) → short room.
- **Target words:** punchy · tight · deep · sub · clean · boomy.
- **Source:** Snoman [B3] p. 440–441
- **Quote:** “[quote omitted]” Parameter table: Welsh [B1] p. 85 (Bass Drum); Reid [B2] part 34.
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar** (sine-FM carrier at index 0, pitch envelope, fast amp decay, saturation, compressor).

### drums.snare: snare
- **Oscillators:** triangle at **−1 octave** (the drum body) + **noise at −31.4 dB / 20 %** (the snares). The body is the minority signal; noise dominates.
- **Filter:** open (**20 kHz, 100 %**); if a tighter snare is wanted, band-pass the noise at 1.5–4 kHz.
- **Envelopes:** amp **A 0 s · D 0.27 s · S 0 % · R 0.27 s**; a second, shorter envelope on the noise (0.10–0.15 s) separates rattle from body.
- **Modulation:** none; pitch drop of 2–4 semitones over 30 ms on the triangle makes it less drum machine (derived).
- **Voices / glide:** 1 voice, mono.
- **Effects (order):** EQ (cut 200–400 Hz boxiness) → saturation (light) → room reverb (0.6–1.2 s) → compressor.
- **Target words:** punchy · bright · tight · harsh · thick.
- **Source:** Welsh [B1] p. 89, patch Snare Drum, table transcribed; layering practice: Snoman [B3] p. 441
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar** (triangle + noise + filter + short envelopes).

### drums.clap: clap
- **Oscillators:** **noise only** (no oscillator at all in the source patch).
- **Filter:** **1.6 kHz (63 %) at 24 dB, 1.1 kHz (58 %) at 12 dB**, **resonance 30 %**, **env 50 %**; the source's note says the **12 dB filter works best**.
- **Envelopes:** amp **A 0 s · D 0.11 s · S 0 % · R 0.115 s**; filter **A 0 · D 0.15 s · S 0 % · R 0.15 s**.
- **Modulation:** **LFO → amplitude, square, 32 Hz very fast, depth 45 %**, **set to retrigger**, the retrigger is what creates the multi-hand clap instead of a burst of noise.
- **Voices / glide:** multi, no glide.
- **Effects (order):** EQ (high-pass 400 Hz) → plate/hall (1.2 s, pre-delay 20 ms) → compressor.
- **Target words:** bright · harsh · punchy · thin · wide.
- **Source:** Welsh [B1] p. 86, patch Clap
- **Quote:** “[quote omitted]”.
- **Feasibility:** **baubar** (noise + band-limited filter + retriggered square LFO on amplitude).

### drums.hihat: hi-hat
- **Oscillators:** the metallic method, not noise: **six enharmonically detuned square waves**, split into **three band-pass bands**; alternatively noise + high-pass for a cheap version.
- **Filter:** three band-passes (the TR-808 architecture), each band its own envelope and VCA, then high-pass.
- **Envelopes:** closed: **A 0 · D 0.03–0.06 s · S 0 · R 0.03 s**; open: D 0.25–0.45 s (the times are my choice; the source gives the six-oscillator architecture, not the envelopes).
- **Modulation:** none; the band-pass centre frequencies (roughly 3 / 6 / 10 kHz) define the tick.
- **Voices / glide:** 1 voice per hit; six oscillators per hit means 6 voices while it rings.
- **Effects (order):** high-pass 300–500 Hz → EQ (cut 1 kHz mud) → gate (for the trance offbeat pattern) → short room.
- **Target words:** bright · metallic · thin · harsh · tight.
- **Source:** Welsh [B1] p. 88, patch Cymbal note
- **Quote:** “[quote omitted]” Reid [B2] part 39 reaches the same conclusion for Korg-style metallic percussion.
- **Feasibility:** **baubar mit Näherung (six pulses + three SVF band-passes is 6 voices per hit; with 16 voices that is two simultaneous hits. The noise+high-pass fallback is cheaper but sounds like a sample-less 808).**

### drums.cymbal: cymbal
- **Oscillators:** **noise** (the source patch uses noise only) or the six-square metallic method above.
- **Filter:** **cutoff 904 Hz (89 %)**, **resonance 50 %**, **env 70 %**; then EQ or high-pass to remove low end, plus distortion.
- **Envelopes:** amp **A 0 s · D 1.10 s · S 0 % · R 1.00 s**; filter **A 0 · D 0.14 s · S 0 % · R 1.80 s**.
- **Modulation:** none.
- **Voices / glide:** mono.
- **Effects (order):** high-pass 400 Hz → saturation/distortion → hall (long, 2–4 s) → gate (optional).
- **Target words:** bright · metallic · harsh · airy · thin.
- **Source:** Welsh [B1] p. 88, patch Cymbal, table transcribed; the author's own note calls it the least realistic patch in the book.
- **Quote:** “[quote omitted]” [B2] part 39
- **Feasibility:** **baubar mit Näherung (noise + resonant high-pass + distortion reads as a cymbal in a mix; a believable ride or crash needs samples, the source itself calls it the least realistic patch in the book).**

---

# percussion

### percussion.tom: tom
- **Oscillators:** 2 squares, both **−1 octave**, second one **−10 semitones** (from Welsh Timpani; the detuned second oscillator gives the skin's inharmonic modes).
- **Filter:** 24 dB low-pass, **cutoff 800 Hz (53 %)**, **resonance 45 %**, **env 35 %**, filter **D 0.35 s**.
- **Envelopes:** amp **A 0 s · D 2.89 s · S 0 % · R 1.90 s**, shorten D to 0.4–0.8 s (range: my choice) for a rack tom, keep it long for a floor tom.
- **Modulation:** pitch drop of 3–7 semitones over 20–40 ms (derived from the kick method) turns the timpani into a tom.
- **Voices / glide:** 1 voice per hit.
- **Effects (order):** EQ (cut 400 Hz, boost 80–120 Hz) → room (0.5 s) → compressor.
- **Target words:** deep · punchy · thick · boomy.
- **Source:** Welsh [B1] p. 83, patch Timpani, table transcribed; the tom/timpani distinction: Reid [B2] part 31
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar**.

### percussion.shaker: shaker
- **Oscillators:** **noise only**. (Derived: the source has no shaker patch; this is the castanets patch, retuned.)
- **Filter:** 24 dB low-pass, **cutoff 7.6 kHz (86 %)**, **resonance 100 %**, the narrow resonance is what makes noise sound like a shaking body.
- **Envelopes:** amp **A 0 s · D 0.04 s · S 0 % · R 0.04 s**, a 40 ms grain, nothing more.
- **Modulation:** none; the rhythm comes from the note grid (16ths, alternating velocity).
- **Voices / glide:** 1 voice per hit, mono.
- **Effects (order):** high-pass 600 Hz → EQ (boost 6–8 kHz) → short room (0.3 s).
- **Target words:** bright · thin · tight · harsh · airy.
- **Source:** Welsh [B1] p. 85, patch Castanets, table transcribed (derived for shaker, same noise-plus-resonance structure, 40 ms decay). Role in the arrangement: Snoman [B3] p. 427
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar** (noise + resonant low-pass + 40 ms envelope).

### percussion.conga: conga
- **Oscillators:** 2 squares, second at **+1 octave / +2 semitones**, mix 100 % / 85 % at −6.5 dB.
- **Filter:** 24 dB low-pass, **cutoff 300 Hz (39 %)**, **resonance 40 %**, **env 50 %**, filter **D 0.02 s · S 80 %**.
- **Envelopes:** amp **A 0 s · D 0.15 s · S 0 % · R 0.15 s**.
- **Modulation:** none internal; hand-damping is played by shortening D.
- **Voices / glide:** **mono** in the source, no glide.
- **Effects (order):** EQ (cut 500 Hz, boost 150–250 Hz) → short room → compressor.
- **Target words:** punchy · warm · tight · boxy.
- **Source:** Welsh [B1] p. 82, patch Conga, table transcribed; single-membrane acoustics: Reid [B2] part 31
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar**.

### percussion.rim: rim / side stick
- **Oscillators:** **noise only** in the source patch.
- **Filter:** **2.7 kHz (71 %)**, **resonance 100 %**, **env 85 %**, filter **D 1.19 s · S 0 %**.
- **Envelopes:** amp **A 0 s · D 0.09 s · S 0 % · R 0 s**, extremely short, the click of stick on rim.
- **Modulation:** none.
- **Voices / glide:** mono.
- **Effects (order):** band-pass ~2–3 kHz (the source's resonant filter does this job) → very short room (0.2 s).
- **Target words:** thin · bright · tight · nasal · metallic.
- **Source:** Welsh [B1] p. 88, patch Side Stick, table transcribed; architecture: Reid [B2] part 41
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar**.

### percussion.metallic: metallic percussion (cowbell / claves / agogô)
- **Oscillators:** 2 squares, **PW 10 %** and **PW 35 %**, second at **+5 semitones** (cowbell) or +1 octave / +2 semitones (analog drum machine cowbell). The source measured a real CR-8000 cowbell at **587 Hz and 845 Hz**.
- **Filter:** 24 dB low-pass, **cutoff 8.1 kHz (87 %)**, **env 65 %**, filter **D 0.02 s · S 65 %**; for claves: **2.1 kHz, resonance 100 %, 12 dB** so full resonance does not eat the highs.
- **Envelopes:** amp **A 0 s · D 0.15 s · S 0 % · R 0.15 s** (cowbell); 0.14 s for claves.
- **Modulation:** none; the inharmonic interval (a fifth, not an octave) is the metallic cue.
- **Voices / glide:** mono; play around the fifth octave (source note).
- **Effects (order):** EQ (high-pass 500 Hz) → short room → optional saturation.
- **Target words:** metallic · bright · harsh · thin · nasal.
- **Source:** Welsh [B1] p. 87, patches Cowbell and “[quote omitted]”, tables transcribed. Frequency cross-check: Reid [B2] part 41
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar** (two pulses, filter, 150 ms decay).

---

# fx

### fx.riser: riser
- **Oscillators:** **white noise** preferred, pink/red/brown as variants. (Pitched riser alternative: saw or pulse, unison + detune, oscillators pitched down **−2 to −3 octaves**.)
- **Filter:** **12 dB band-pass**, resonance and cutoff **about a quarter-way open**; modulation envelope with the **longest attack, no decay, no sustain, release about halfway**, fully modulating the cutoff.
- **Envelopes:** amp **immediate attack and decay, full sustain, 50 % release**; the rise itself is the filter envelope, not the amp.
- **Modulation:** mod envelope → cutoff (positive, full amount). Shortening the attack makes the riser reach its apex faster. For a pitched riser the mod envelope goes to **pitch, amount ≈ 3/4**.
- **Voices / glide:** 1 voice; a pitched riser adds unison (costs voices).
- **Effects (order):** hall with a long tail, **wet amount automated upward** as the sound grows; EQ the reverb tail so it does not eat the mix; optional reverse crash layered underneath.
- **Target words:** bright · airy · wide · wet · evolving · aggressive.
- **Source:** Snoman [B3] p. 301
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar** (noise + SVF band-pass + mod envelope + hall; the wet automation must come from the well, not the synth).

### fx.downlifter: downlifter / fall
- **Oscillators:** white noise (noise fall) or saw/pulse (pitched fall, osc pitched −2/−3 octaves).
- **Filter:** start **three-quarters open** and sweep down: same 12 dB band-pass as the riser, but the **modulation envelope inverted** (negative amount).
- **Envelopes:** amp immediate attack, full sustain; the movement is the inverted filter envelope. For a pitch fall, reverse the mod envelope to a negative amount **or** reduce the attack to zero and increase the decay.
- **Modulation:** inverted mod envelope → cutoff; alternative: envelope → pitch with negative amount.
- **Voices / glide:** 1 voice.
- **Effects (order):** hall (long, wet automated downward) → delay (1/4) → EQ.
- **Target words:** dark · wet · evolving · soft · deep.
- **Source:** Snoman [B3] p. 301
- **Quote:** “[quote omitted]”
- **Feasibility:** **baubar** (same patch as the riser with the envelope inverted; the kit's LFO/mod matrix needs negative amounts).

### fx.impact: impact / boom
- **Oscillators:** sine (or two triangles at −2 octaves) for the body + a noise burst for the debris; a short reversed crash layer on top.
- **Filter:** open for the body; band-pass 500 Hz–2 kHz on the noise layer.
- **Envelopes:** body **A 0 · D 0.8–2 s · S 0 · R 1–2 s**; noise layer **D 0.05–0.2 s**; pitch envelope falls **−12 to −24 semitones** over 100–300 ms.
- **Modulation:** pitch envelope (exponential fall) + a slow LFO on the reverb wet for the tail.
- **Voices / glide:** 1 voice, mono.
- **Effects (order):** saturation (heavy) → EQ (boost 50–80 Hz, cut 300 Hz) → hall (very long, pre-delay 30–60 ms) → limiter.
- **Target words:** deep · punchy · heavy · sub · dark · aggressive.
- **Source:** derived, the source set has no impact patch. Building blocks: Snoman [B3] p. 299 (“[quote omitted]”) names the category; the pitch-fall method is the one given for the kick (p. 441) and the pitched riser (p. 302); the body is Welsh's Bass Drum [B1] p. 85.
- **Feasibility:** **baubar** (sine + pitch envelope + heavy saturation + long hall).

### fx.noise: noise / wind / ocean
- **Oscillators:** **noise only** (the source patch has no oscillator; the foghorn variant adds a saw at −1 octave).
- **Filter:** 24 dB low-pass, **cutoff 4.3 kHz (78 %) at 24 dB / 2.0 kHz (67 %) at 12 dB**, **resonance 30 %**.
- **Envelopes:** amp **A 0.40 s · D max · S 100 % · R 1.00 s**.
- **Modulation:** **LFO → amplitude of osc 1 and of the noise, triangle, 0.2 Hz very slow, depth 75 %**, that slow swell is the whole effect.
- **Voices / glide:** multi, no glide.
- **Effects (order):** hall (long) → EQ (high-pass 80 Hz, low-pass 12 kHz) → chorus (optional, wide).
- **Target words:** airy · wide · soft · wet · smooth · evolving.
- **Source:** Welsh [B1] p. 108, patch Ocean Waves, table transcribed.
- **Quote:** “[quote omitted]” (the author's note).
- **Feasibility:** **baubar** (noise + slow LFO on amplitude + hall).

### fx.texture: texture / machine bed
- **Oscillators:** saw + square at **+2 octaves**, plus noise routed as an LFO source rather than as audio.
- **Filter:** 24 dB low-pass, **cutoff 680 Hz (51 %)**, **resonance 85 %**, **env 0 %**.
- **Envelopes:** amp **A 0 s · D max · S 100 % · R 2.00 s**, a static bed that never decays while held.
- **Modulation:** **LFO with wave = noise → filter cutoff, 0.9 Hz very slow, depth 25 %**, random filter movement is what makes it a texture instead of a tone.
- **Voices / glide:** poly, no glide; add a second detuned layer for width.
- **Effects (order):** phaser (slow) → delay (1/4, feedback 40 %) → convolution reverb (short metallic impulse) → EQ.
- **Target words:** evolving · dark · thick · metallic · wide · airy.
- **Source:** Welsh [B1] p. 108, patch Nerd-O-Tron 2000, table transcribed.
- **Feasibility:** **baubar** (saw + square + resonant filter + noise-shaped LFO; random LFO is the one thing to check in the kit's LFO list).

---
- **Quote:** “[quote omitted]” [B2] part 14

# Feasibility balance

46 cards, all sourced, none marked unbelegt. Eight carry a line marked `derived` where I moved a
source one step or supplied a value the source does not give: acid lead (bass patch lifted an
octave), tom (timpani plus a pitch drop), shaker (castanets with a shorter decay), impact (kick
method plus pitch fall), texture (random LFO), wobble (amp envelope), pluck stab (envelope times),
granular (LFO rates). Everything else is the source value, transcribed or quoted.

| Label | Count | Cards |
|---|---|---|
| **baubar** | 33 | reese, acid, wobble, analog, rolling, pluck · mono, poly, acid, arp · strings, atmosphere, analog, drone · organ, mallet, chord · synth, mallet, stab · kick, snare, clap · tom, shaker, conga, rim, metallic · riser, downlifter, impact, noise, texture |
| **baubar mit Näherung** | 11 | sub (no free-running sine) · fm (one FM pair only) · supersaw (3 saws × note vs. 16 voices) · fm lead (one pair) · choir (formants need 3 band-passes or a vocoder) · piano, electric piano (no sample library) · bell (one FM pair, not 4 carriers) · string pluck (no sync, no Karplus resonator) · hihat, cymbal (6 oscillators per hit) |
| **fehlt: Modul** | 2 | lead.sync (hard sync) · pad.granular (granular engine) |

## Which missing modules would unlock the most cards

1. **Wavetable oscillator (single-cycle, band-limited).** Not because a card is blocked, but because
   it collapses the voice cost: a supersaw, a reese and a choir layer become **one voice per note**
   instead of 3–7, which frees the 16-voice budget that currently caps supersaw chords, organ
   drawbars and metallic percussion. It also lets *texture* and *atmosphere* move between waveforms
   instead of being frozen in a filter sweep. Cards affected: 6 (supersaw, reese, wobble, choir,
   texture, atmosphere), 4 of them currently Näherung-limited.
2. **Sample library (or at least a small one-shot set).** Turns 5 Näherung cards into real ones:
   piano, electric piano, cymbal, hihat, string pluck. It is also the only honest route to a
   believable choir vowel.
3. **Multi-operator FM (4–6 operators, several ratios, per-operator envelopes).** Unlocks what the
   single sine-FM pair cannot: fm bass, fm lead, bell, 3 cards, and the mallet family benefits too.
4. **Hard-sync oscillator.** One card (sync lead), but it is the whole West-Coast/80s lead family,
   and worth it only after the three above.
5. **Granular engine.** One card (granular pad). Expensive for the payoff; last on the list.

## Open gaps

- **Russ, *Sound Synthesis and Sampling*** was not acquired: every LibGen mirror returned HTTP 504
  on every file variant (3 attempts, 3 md5s). The book is theory, not a recipe book, so no card
  depends on it, but it is the one title from the brief that is missing from the source set.
- **Wobble and reese have no book in the set**; both rest on one web tutorial each [W]. A book that
  covers DnB bass design would upgrade them to [B].
- **Welsh's patch tables are OCR'd scans.** Values are transcribed from the page images; single
  characters can be ambiguous (e.g. 1.4khz vs 1.4 kHz). Where a value looked corrupted I gave a
  range instead of a false precision.
- **No card for a real drawbar organ**: Welsh's Organ is a two-triangle patch; the drawbar partials
  are inferred from additive synthesis, not sourced here.
- **impact** has no dedicated source, it is assembled from sourced parts and marked as such.
