"""Mutation runs of the fm block: apply one change, run the test that must catch it, print RED/GREEN, revert.

Usage (on a copy of djk/instruments, never on the working tree another build reads):
    python3 mutation_fm.py /path/to/copy/of/instrumente [ID ...]
IDs are the first word of a name (P1, S2, ...); without IDs all run. Results: REPORT-fm.md.
"""
import subprocess, sys, os, re
ROOT = sys.argv[1]
DSP = os.path.join(ROOT, "modular_dsp")
FM = "src/fm.rs"; PR = "src/programm.rs"
M = [
 # pitch
 ("P1 fine detune in 1/1000 octave instead of cent", FM, 'v(o, "verh") * (v(o, "fein") / 1200.0).exp2()', 'v(o, "verh") * (v(o, "fein") / 1000.0).exp2()', "--test fm tonhoehe"),
 ("P2 16-bit phase step", FM, "self.inc[i] = if self.aktiv[i] { (inc as f64 * 4_294_967_296.0) as u32 } else { 0 };\n        }\n        // the guard", "self.inc[i] = if self.aktiv[i] { (inc as f64 * 4_294_967_296.0) as u32 & 0xFFFF_0000 } else { 0 };\n        }\n        // the guard", "--test fm tonhoehe"),
 # sidebands and index
 ("S1 modulation read as turns instead of radians", FM, "((rad * (4_294_967_296.0 / std::f32::consts::TAU)) as i64) as u32", "((rad * 4_294_967_296.0) as i64) as u32", "--test fm seitenbaender"),
 ("S2 INDEX_MAX 12 instead of 4 pi (-4.5 %)", FM, "pub const INDEX_MAX: f32 = 4.0 * std::f32::consts::PI;", "pub const INDEX_MAX: f32 = 12.0;", "--test fm seitenbaender"),
 ("S3 sine polynomial cut after x^7", FM, "x * (1.0 + x2 * (-1.0 / 6.0 + x2 * (1.0 / 120.0 + x2 * (-1.0 / 5040.0 + x2 * (1.0 / 362_880.0 + x2 * (-1.0 / 39_916_800.0))))))", "x * (1.0 + x2 * (-1.0 / 6.0 + x2 * (1.0 / 120.0 + x2 * (-1.0 / 5040.0))))", "--test fm seitenbaender"),
 ("S4 velocity ignored", FM, "let q = index * (1.0 - e.anschlag * (1.0 - vel));", "let q = index * (1.0 - e.anschlag * 0.0 * vel);", "--test fm index_eingang"),
 # feedback
 ("F1 feedback from the last sample only (no averaging)", FM, "m += self.beta * 0.5 * (self.fb[0] + self.fb[1]);", "m += self.beta * self.fb[0];", "--test fm rueckkopplung_bleibt"),
 ("F2 feedback up to 2.5 rad, past the stable range", FM, "self.beta = (rueck * FB_MAX).min(self.beta_grenze);", "self.beta = rueck * 2.5;", "--test fm rueckkopplung_bleibt"),
 ("F3 no feedback limit per pitch", FM, "let mut grenze = fb_grenze(f / sr);", "let mut grenze = FB_MAX;", "--test fm rueckkopplung_allein"),
 # alias guard
 ("A1 guard off", FM, "        if w > g {\n            return false;", "        if false && w > g {\n            return false;", "--test fm alle_algorithmen"),
 ("A2 modulator tails not counted", FM, "(0.5 * (ij - 1.0)).clamp(0.0, 1.0) * (schwanz[j] - tempo[j])", "0.0 * (schwanz[j] - tempo[j])", "--test fm alle_algorithmen"),
 ("A3 feedback operator taken as a sine", FM, "tempo[i] = fb_tempo(f, beta);", "tempo[i] = f;", "--test fm alle_algorithmen"),
 ("A4 no tail limit on a modulating feedback operator", FM, "grenze = grenze.min(fb_schwanz_umkehr(0.5 * (sr - ALIAS_FREI_HZ).max(0.5 * sr) / f));", "let _ = fb_schwanz_umkehr;", "--test fm alle_algorithmen"),
 ("A5 operators above Nyquist not muted", FM, "self.aktiv[i] = inc < 0.5;", "self.aktiv[i] = true;", "--test fm alle_algorithmen"),
 ("A6 reach bound too low (1 + 20 I)", FM, "(1.0 + 40.0 * i).min(2.0 + 8.0 * i).min(5.5 + 1.3 * i)", "(1.0 + 20.0 * i).min(2.0 + 8.0 * i).min(5.5 + 1.3 * i)", "--lib fm::tests::reichweite"),
 # envelopes
 ("E1 decay time to -40 dB instead of -60 dB", FM, "d: (-6.907_755 / ((z[1] * zeit).max(0.001) * sr)).exp(),", "d: (-4.605_17 / ((z[1] * zeit).max(0.001) * sr)).exp(),", "--test fm jeder_operator"),
 ("E2 zeit does not scale the decay", FM, "d: (-6.907_755 / ((z[1] * zeit).max(0.001) * sr)).exp(),", "d: (-6.907_755 / ((z[1] * 1.0).max(0.001) * sr)).exp(),", "--test fm jeder_operator"),
 ("E3 every operator follows operator 1's envelope", FM, "let env = self.huelle[i].prozess(start, gate, &self.koeff[i], e.adsr[i][2]);", "let env = self.huelle[i].prozess(start, gate, &self.koeff[0], e.adsr[0][2]);", "--test fm jeder_operator"),
 ("E4 envelope does not snap (subnormals)", FM, "self.wert = if neu == self.wert || (neu - s).abs() < 1e-6 { s } else { neu };", "self.wert = neu;", "--lib fm::tests::huelle"),
 ("E5 release without the end at 0", FM, "                if self.wert < 1e-6 {\n                    self.wert = 0.0;", "                if self.wert < 0.0 {\n                    self.wert = 0.0;", "--test fm gate_aus"),
 # routing and output
 ("R1 modulation reads the target instead of the modulator", FM, "m += e.pegel[j] * u[j];", "m += e.pegel[j] * u[i];", "--test fm modulatoren_wirken"),
 ("R2 carrier sum not divided by the number of carriers", FM, "summe * (1.0 / a.traeger.count_ones() as f32)", "summe", "--test fm nur_traeger"),
 ("A7 one limit for the whole voice instead of per tree", FM, "let baum = baeume(a);", "let baum = [(1u8 << a.ops) - 1; OPERATOREN];", "--test fm baeume_werden_getrennt_begrenzt"),
 ("R3 algorithm 3 without carrier 3", FM, 'traeger: b(&[1, 3]), rueck: 3 },', 'traeger: b(&[1]), rueck: 3 },', "--lib fm::tests::algorithmen"),
 # determinism, reset, real time
 ("D1 no phase restart on trig (sync ignored)", FM, "            self.phase = [0; OPERATOREN];\n            self.fb = [0.0; 2];", "            self.fb = [0.0; 2];", "--test fm gleicher_graph"),
 ("D2 zuruecksetzen leaves the voices", PR, "Schritt::Fm { v, .. } => **v = [crate::fm::Stimme::neu(); MAX_STIMMEN],", "Schritt::Fm { .. } => {}", "--test arten zuruecksetzen_gleich_frisch"),
 ("K1 allocation in the audio path", FM, "self.beta = (rueck * FB_MAX).min(self.beta_grenze);", "self.beta = (rueck * FB_MAX).min(self.beta_grenze);\n        std::hint::black_box(Vec::<u8>::with_capacity(1));", "--test keine_allokation"),
]
nur = sys.argv[2:]
env = dict(os.environ)
for name, datei, alt, neu, test in M:
    if nur and name.split()[0] not in nur: continue
    p = os.path.join(DSP, datei); orig = open(p).read()
    assert orig.count(alt) == 1, (name, orig.count(alt))
    open(p, "w").write(orig.replace(alt, neu))
    try:
        r = subprocess.run(f"cargo test --release -p baukasten_dsp {test} -- --nocapture", shell=True, cwd=ROOT, env=env, capture_output=True, text=True)
        out = r.stdout + r.stderr
        rot = r.returncode != 0
        msg = ""
        zeilen = out.splitlines()
        for i, l in enumerate(zeilen):
            if "panicked at" in l:
                msg = zeilen[i + 1].strip() if i + 1 < len(zeilen) else ""
                break
        if "error[E" in out: msg = "COMPILE ERROR " + re.findall(r"error\[E\d+\].*", out)[0]
        print(f"{'RED  ' if rot else 'GREEN'} | {name} | {test} | {msg[:300]}", flush=True)
    finally:
        open(p, "w").write(orig)
