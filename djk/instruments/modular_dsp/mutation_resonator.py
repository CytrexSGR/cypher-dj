"""Mutation runs of the resonator block: apply one change, run the test that must catch it, print RED/GREEN, revert.

Usage (on a copy of djk/instruments, never on the working tree another build reads):
    python3 mutation_resonator.py /path/to/copy/of/instrumente [ID ...]
IDs are the first word of a name (F1, D2, ...); without IDs all run. Each mutation is a list of (old, new) replacements in
one file; every old text must occur exactly once. Results: REPORT-resonator.md.
"""
import subprocess, sys, os, re
ROOT = sys.argv[1]
DSP = os.path.join(ROOT, "modular_dsp")
RS = "src/resonator.rs"; PR = "src/programm.rs"
M = [
 ("F1 mode frequency 1e-5 high (0.017 cent)", RS, [("let w = 2.0 * PI * f / sr;", "let w = 2.0 * PI * f / sr * (1.0 + 1e-5);")], "--test resonator koeffizienten"),
 ("F2 mode frequency 1e-4 high (0.17 cent)", RS, [("let w = 2.0 * PI * f / sr;", "let w = 2.0 * PI * f / sr * (1.0 + 1e-4);")], "--test resonator modenfrequenzen"),
 ("F3 bell tierce 1.193 instead of 1.183", RS, [("[0.5, 1.0, 1.183, 1.506,", "[0.5, 1.0, 1.193, 1.506,")], "--test resonator verhaeltnisse"),
 ("F4 Bessel integral with 12 points", RS, [("const N: usize = 128;", "const N: usize = 12;")], "--test resonator verhaeltnisse"),
 ("F5 bar ratios beta^2.02", RS, [("verh[m] = (b / staebe[0]).powi(2);", "verh[m] = (b / staebe[0]).powf(2.02);")], "--test resonator verhaeltnisse"),
 ("I1 inharmonicity without anchor", RS, [("self.anker[m] * (self.verh[m] / self.anker[m]).powf(i)", "self.verh[m].powf(i)")], "--test resonator inharmonie"),
 ("D1 decay independent of the mode frequency", RS, [("(T60_KONST / (eta * f)).clamp", "(T60_KONST / (eta * f1)).clamp")], "--test resonator abklingzeit"),
 ("D2 T60 5 % long", RS, [("(T60_KONST / (eta * f)).clamp", "(1.05 * T60_KONST / (eta * f)).clamp")], "--test resonator abklingzeit"),
 ("D3 material over 3 decades instead of 4", RS, [("10f64.powf(-ETA_DEKADEN * material as f64)", "10f64.powf(-3.0 * material as f64)")], "--test resonator koeffizienten"),
 ("S1 no 30 s clamp of T60", RS, [(".clamp(T60_MIN, T60_MAX)", ".clamp(T60_MIN, 1e12)")], "--test resonator stabil"),
 ("S2 no T60 clamp and no |z| guard", RS, [(".clamp(T60_MIN, T60_MAX)", ".clamp(T60_MIN, 1e12)"), ("if betrag >= 1.0 {", "if betrag >= 2.0 {")], "--test resonator stabil"),
 ("S3 no flush of decayed modes", RS, [("if self.re[m].abs() + self.im[m].abs() < RUHE {", "if false {")], "--lib resonator::tests::keine_subnormalen"),
 ("S4 non-finite material not caught", RS, [("endlich(x.material, 0.5).clamp(0.0, 1.0),", "x.material.clamp(0.0, 1.0),")], "--lib resonator::tests::nan_eingaenge"),
 ("S5 non-finite position not caught", RS, [("endlich(x.position, 0.3).clamp(0.0, 1.0),", "x.position.clamp(0.0, 1.0),")], "--lib resonator::tests::nan_eingaenge"),
 ("P1 strike position ignored", RS, [("satz.form(m, pos) as f64", "satz.form(m, 0.5 + 0.0 * pos) as f64")], "--test resonator anschlagposition"),
 ("B1 brightness ignored", RS, [("/ (1.0 + (f / fc).powi(2));", "/ (1.0 + 0.0 * (f / fc).powi(2));")], "--test resonator helligkeit"),
 ("G1 strike gains not normalised", RS, [("(1.0 / summe.sqrt()) as f32", "1.0f32")], "--lib resonator::tests::verstaerkungen"),
 ("N1 noise burst not normalised to unit energy", RS, [("st * (3.0 * (1.0 - self.burst_d * self.burst_d)).sqrt()", "st * 0.3")], "--test resonator rauschanregung"),
 ("X1 input gain sqrt(1 - r) instead of 1 - r", RS, [("self.gx[m] = 2.0 * g * eins_minus_r[m];", "self.gx[m] = 2.0 * g * eins_minus_r[m].sqrt();")], "--test resonator audioeingang"),
 ("T1 trig level instead of rising edge", RS, [("let schlag = trig > 0.5 && self.trig_alt <= 0.5;", "let schlag = trig > 0.5;")], "--test resonator nur_steigende_flanke"),
 ("T2 strike waits for the control step", RS, [("if (schlag || self.zaehler == 0) && p != self.alt {", "if self.zaehler == 0 && p != self.alt {")], "--test resonator neuer_anschlag"),
 ("R1 zuruecksetzen leaves the voices", PR, [("Schritt::Resonator { v, e, .. } => **v = std::array::from_fn(|i| RsStimme::neu(i, e)),", "Schritt::Resonator { .. } => {}")], "--test arten zuruecksetzen_gleich_frisch"),
 ("A1 allocation in the audio path", RS, [("let mut y = 0.0f32;", "let mut y = 0.0f32;\n        std::hint::black_box(Vec::<u8>::with_capacity(1));")], "--test keine_allokation"),
]
nur = sys.argv[2:]
env = dict(os.environ)
for name, datei, paare, test in M:
    if nur and name.split()[0] not in nur: continue
    p = os.path.join(DSP, datei); orig = open(p).read()
    neu = orig
    for alt, ersatz in paare:
        assert neu.count(alt) == 1, (name, alt, neu.count(alt))
        neu = neu.replace(alt, ersatz)
    open(p, "w").write(neu)
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
