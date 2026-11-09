"""Mutation runs of the wavetable block: apply one change, run the test that must catch it, print RED/GREEN, revert.

Usage (on a copy of djk/instruments, never on the working tree another build reads):
    python3 mutation_wavetable.py /path/to/copy/of/instrumente [ID ...]
IDs are the first word of a name (M1, P2, ...); without IDs all run. Results: REPORT-wavetable.md.
"""
import subprocess, sys, os, re
ROOT = sys.argv[1]
DSP = os.path.join(ROOT, "modular_dsp")
WT = "src/wavetable.rs"; PR = "src/programm.rs"
M = [
 ("M1 mip selection off (always level 0)", WT, "if k > 0 && self.harm[k - 1] * f <= grenze { k - 1 } else { k }", "{ let _ = k; 0 }", "--test wavetable saege_aliasing"),
 ("M2 linear instead of cubic B-spline read", WT, "(u * u * u * y0 + (3.0 * t3 - 6.0 * t2 + 4.0) * y1 + (-3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0) * y2 + t3 * y3) * (1.0 / 6.0)", "{ let _ = (u, t3, y0, y3); y1 + (y2 - y1) * t }", "--test wavetable saege_aliasing"),
 ("M3 no B-spline droop compensation", WT, "let a = a * skala[i] / sinc(h as f64 / l as f64).powi(4);", "let a = a * skala[i] / sinc(0.0);", "--lib wavetable::tests::saege_tabelle"),
 ("P1 detune in 1/1000 octave instead of cent", WT, "self.faktor[c] = (lage(c, n) * verst / 1200.0).exp2();", "self.faktor[c] = (lage(c, n) * verst / 1000.0).exp2();", "--test wavetable unison_kopien"),
 ("P2 16-bit phase increment", WT, "self.phase[c] = self.phase[c].wrapping_add((inc as f64 * 4_294_967_296.0) as u32);", "self.phase[c] = self.phase[c].wrapping_add((inc as f64 * 4_294_967_296.0) as u32 & 0xFFFF_0000);", "--test wavetable tonhoehe"),
 ("G1 position not smoothed", WT, "if self.frisch || e.glatt_ms <= 0.0 {", "if true {", "--test wavetable morph_ohne_sprung"),
 ("G2 nearest frame instead of interpolation", WT, "let m = x - i as f32;", "let m = 0.0f32 * (x - i as f32);", "--test wavetable morph_ohne_sprung"),
 ("G3 trig does not put the smoother on the target", WT, "self.neue_phasen(e);\n            self.frisch = true;", "self.neue_phasen(e);", "--test wavetable neue_note"),
 ("L1 no gain compensation", WT, "let g = 1.0 / (n as f32).sqrt();", "let g = 1.0f32;", "--test wavetable unison_lautheit"),
 ("L2 gain 1/n (amplitude, not power)", WT, "let g = 1.0 / (n as f32).sqrt();", "let g = 1.0 / n as f32;", "--test wavetable unison_lautheit"),
 ("L3 linear pan instead of equal power", WT, "self.gl[c] = std::f32::consts::SQRT_2 * w.cos();\n                self.gr[c] = std::f32::consts::SQRT_2 * w.sin();", "self.gl[c] = 2.0 - 2.0 * w / std::f32::consts::FRAC_PI_2;\n                self.gr[c] = 2.0 * w / std::f32::consts::FRAC_PI_2;", "--test wavetable unison_lautheit"),
 ("D1 same start phases on every note", WT, "let z = e.zufall.clamp(0.0, 1.0) as f64;", "let z = e.zufall.clamp(0.0, 1.0) as f64;\n        self.zufall = 0x2545_F491;", "--test wavetable jede_note"),
 ("D2 seed from the clock", WT, "^ e.saat.wrapping_mul(0xC2B2_AE35);", "^ e.saat.wrapping_mul(0xC2B2_AE35) ^ std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);", "--test wavetable gleicher_graph"),
 ("D3 zuruecksetzen leaves the voices", PR, "Schritt::Wavetable { w, e, .. } => **w = std::array::from_fn(|i| WtStimme::neu(i, e)),", "Schritt::Wavetable { .. } => {}", "--test arten zuruecksetzen_gleich_frisch"),
 ("R1 non-finite pos not caught", WT, "let ziel = endlich(x.pos, 0.0).clamp(0.0, 1.0)", "let ziel = x.pos.clamp(0.0, 1.0)", "--lib wavetable::tests::nan_position"),
 ("R2 smoother does not snap (subnormals)", WT, "self.pos = if neu == self.pos || (ziel - neu).abs() < 1e-6 { ziel } else { neu };", "self.pos = neu;", "--lib wavetable::tests::positionsglaettung"),
 ("A1 allocation in the audio path", WT, "let g = 1.0 / (n as f32).sqrt();", "let g = 1.0 / (n as f32).sqrt();\n        std::hint::black_box(Vec::<u8>::with_capacity(1));", "--test keine_allokation"),
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
        grund = [l.strip() for l in out.splitlines() if "panicked" in l or l.strip().startswith(("left", "right")) or "assertion" in l]
        msg = ""
        for i, l in enumerate(out.splitlines()):
            if "panicked at" in l:
                msg = out.splitlines()[i + 1].strip() if i + 1 < len(out.splitlines()) else ""
                break
        if "error[E" in out: msg = "COMPILE ERROR " + re.findall(r"error\[E\d+\].*", out)[0]
        print(f"{'RED  ' if rot else 'GREEN'} | {name} | {test} | {msg[:300]}", flush=True)
    finally:
        open(p, "w").write(orig)
