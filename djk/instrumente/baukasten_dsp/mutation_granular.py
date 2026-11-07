"""Mutation runs of the granular block: apply one change, run the test that must catch it, print RED/GREEN, revert.

Usage (on a copy of djk/instrumente, never on the working tree another build reads):
    python3 mutation_granular.py /path/to/copy/of/instrumente [ID ...]
IDs are the first word of a name (C1, P2, ...); without IDs all run. Results: BERICHT-granular.md.
"""
import subprocess, sys, os, re
ROOT = sys.argv[1]
DSP = os.path.join(ROOT, "baukasten_dsp")
GR = "src/granular.rs"; PR = "src/programm.rs"
M = [
 # grain count against density
 ("C1 start clock drops its remainder", GR, "self.takt -= self.ziel;", "self.takt = 0.0;", "--lib granular::tests::kornzahl_folgt"),
 ("C2 interval in ms instead of samples", GR, "self.takt += dichte as f64 / sr as f64;", "self.takt += dichte as f64 / 1000.0;", "--test granular kornzahl_folgt_der_dichte"),
 ("C3 spread not mean-preserving (0..1 instead of -1..1)", GR, "self.ziel = 1.0 + (e.streuung.clamp(0.0, 1.0) * bipolar(self.zahl())) as f64;", "self.ziel = 1.0 + (e.streuung.clamp(0.0, 1.0) * (0.5 + 0.5 * bipolar(self.zahl()))) as f64;", "--test granular kornzahl_mit_streuung"),
 ("C4 trig does not start a grain", GR, "if x.trig > 0.5 {\n            self.takt = self.ziel;\n        }", "", "--test granular kornzahl_mit_streuung"),
 # pitch
 ("P1 grain pitch in f32 phase step with 16 bits", GR, "g.inc = (inc * 4_294_967_296.0) as u32;", "g.inc = (inc * 4_294_967_296.0) as u32 & 0xFFFF_0000;", "--test granular tonhoehe_je_korn_auf_hundertstel_cent_wavetable"),
 ("P2 buffer rate ignores grund", GR, "let r = (hz / e.grund as f64 * verhaeltnis).clamp(0.0, MAX_RATE);", "let r = (hz / 261.6256 * verhaeltnis).clamp(0.0, MAX_RATE);", "--test granular tonhoehe_je_korn_auf_hundertstel_cent_puffer"),
 ("P3 buffer read linear instead of Hermite", GR, "((c3 * f + c2) * f + c1) * f + y1", "{ let _ = (c1, c2, c3); y1 + (y2 - y1) * f }", "--lib granular::tests::hermite_zwischen"),
 ("P4 pitch jitter in semitones/10 instead of cent", GR, "+ (endlich(x.ton_zufall, 0.0).clamp(0.0, MAX_TON_ZUFALL) * u_ton) as f64;", "+ (endlich(x.ton_zufall, 0.0).clamp(0.0, MAX_TON_ZUFALL) * u_ton) as f64 * 10.0;", "--test granular tonhoehen_zufall"),
 ("P5 tonhoehe in 1/10 octave instead of semitones", GR, "MAX_TONHOEHE) as f64 * 100.0", "MAX_TONHOEHE) as f64 * 120.0", "--test granular tonhoehe_je_korn_auf_hundertstel_cent_wavetable"),
 # clicks
 ("W1 rectangular window", GR, "return m.rampe(a * self.inv_rand);", "return 1.0;", "--test granular keine_klicks"),
 ("W2 window on a 0.08 pedestal (Hamming)", GR, "if b < self.rand { m.rampe(b * self.inv_rand) } else { 1.0 }", "if b < self.rand { 0.08 + 0.92 * m.rampe(b * self.inv_rand) } else { 1.0 }", "--test granular keine_klicks"),
 ("W3 full pool steals the oldest grain", GR, "let Some(g) = self.k.iter_mut().find(|g| g.rest == 0) else {\n            self.verworfen += 1;\n            return;\n        };", "let g = match self.k.iter().position(|g| g.rest == 0) { Some(i) => &mut self.k[i], None => { self.verworfen += 1; self.k.iter_mut().max_by_key(|g| g.alter).unwrap() } };", "--test granular keine_klicks"),
 ("W4 no seam clamp (grains overtake the write head)", GR, "(ABSTAND + ((r - 1.0) * l).max(0.0), n - ABSTAND - ((1.0 - r) * l).max(0.0))", "(ABSTAND, n - ABSTAND)", "--test granular keine_klicks"),
 ("W5 no minimum edge of 1 ms", GR, ".max((RAND_MIN_S * sr).min(halb)).min(halb);", ".max(1.0).min(halb);", "--test granular keine_klicks"),
 ("W6 frozen buffer uses the live seam clamp", GR, "(ABSTAND + r * l, n - ABSTAND)", "(ABSTAND + ((r - 1.0) * l).max(0.0), n - ABSTAND)", "--test granular keine_klicks"),
 # position and freeze
 ("F1 position from the oldest sample instead of the newest", GR, "g.lese = m.kopf as f64 - 1.0 - d0;", "g.lese = m.kopf as f64 - 1.0 - (n - d0);", "--test granular position_waehlt"),
 ("F4 position scaled to the whole buffer before it is filled", GR, "let n = if m.quelle == 1 { m.nutzbar.min(m.kopf as f64) } else { m.nutzbar };", "let n = m.nutzbar;", "--test granular position_vor_dem_fuellen"),
 ("F2 freeze does not stop recording", GR, "if self.quelle == 0 || frieren {", "if self.quelle == 0 {", "--test granular frieren_haelt_den_puffer"),
 ("F3 wavetable freeze does not hold the position", GR, "let pos = if frieren && m.quelle == 0 { self.pos_halt } else { pos_ein };", "let pos = pos_ein;", "--test granular frieren_haelt_die_wavetable"),
 # determinism
 ("D1 seed from the clock", GR, "^ e.saat.wrapping_mul(0xC2B2_AE35);", "^ e.saat.wrapping_mul(0xC2B2_AE35) ^ std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);", "--test granular gleiche_saat"),
 ("D2 seed ignored", GR, "let s = 0x9E37_79B9u32 ^ (stimme as u32 + 1).wrapping_mul(0x85EB_CA6B) ^ e.saat.wrapping_mul(0xC2B2_AE35);", "let s = 0x9E37_79B9u32 ^ (stimme as u32 + 1).wrapping_mul(0x85EB_CA6B);", "--test granular gleiche_saat"),
 ("D3 zuruecksetzen leaves the recorded buffer", GR, "self.puffer.iter_mut().for_each(|v| *v = 0.0);", "", "--test arten zuruecksetzen_gleich_frisch"),
 ("D5 zuruecksetzen does not reseed the noise", GR, "self.rauschen = self.rauschen_start;", "", "--test granular zuruecksetzen_gleich_frisch_alle"),
 ("D6 zuruecksetzen leaves the write head", GR, "        self.kopf = 0;\n", "", "--test granular zuruecksetzen_gleich_frisch_alle"),
 ("D4 zuruecksetzen leaves the voices", PR, "**g = std::array::from_fn(|i| GrStimme::neu(i, e));", "let _ = (g, e);", "--test arten zuruecksetzen_gleich_frisch"),
 # robustness and real time
 ("R1 non-finite x recorded", GR, "let x = endlich(x, 0.0).clamp(-8.0, 8.0);", "let x = x.clamp(-8.0, 8.0);", "--test granular unsinnige"),
 ("R2 subnormals recorded", GR, "if x.abs() < 1e-30 { 0.0 } else { x }", "x", "--lib granular::tests::rauschen_und_puffer"),
 ("R3 grains without a note (hz 0)", GR, "if x.gate > 0.5 && x.hz > 0.0 && x.hz.is_finite() && dichte > 0.0 {", "if x.gate > 0.5 && dichte > 0.0 {", "--test granular ohne_note_still"),
 ("A1 allocation in the audio path", GR, "let (mut l, mut r) = (0.0f32, 0.0f32);\n        if let Some(t) = &m.tabelle {", "let (mut l, mut r) = (0.0f32, 0.0f32);\n        std::hint::black_box(Vec::<u8>::with_capacity(1));\n        if let Some(t) = &m.tabelle {", "--test keine_allokation"),
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
