"""Mutation runs of the metall block: apply one change, run the test that must catch it, print RED/GREEN, revert.

Usage (on a copy of djk/instruments, never on the working tree another build reads):
    python3 mutation_metal.py /path/to/copy/of/instrumente [ID ...]
IDs are the first word of a name (A1, C2, ...); without IDs all run. Results: REPORT-metal.md.
A mutation is a list of (old, new) replacements in one file; each old text must occur exactly once.
"""
import subprocess, sys, os, re
ROOT = sys.argv[1]
DSP = os.path.join(ROOT, "modular_dsp")
MT = "src/metall.rs"; PR = "src/programm.rs"
M = [
 ("A1 naive squares (no BLEP)", MT, [("ring[(k + j) % RING] += h * if j >= HALB { c - 1.0 } else { c };", "let _ = (h, c, k, ring.len());")], "--test metall aliasing_unter_minus_90"),
 ("A2 BLEP kernel cut-off at 0.55 sr instead of 0.48", MT, [("const BLEP_FC: f64 = 0.48;", "const BLEP_FC: f64 = 0.55;")], "--test metall aliasing_unter_minus_80_db_bei_44"),
 ("A3 BLEP table with 4 instead of 256 points per sample", MT, [("const BLEP_PUNKTE: usize = 256;", "const BLEP_PUNKTE: usize = 4;")], "--test metall aliasing_unter_minus_90"),
 ("B1 noise not balanced per band", MT, [("let abgleich = w[0] * RAUSCH_BAND[0] + w[1] * RAUSCH_BAND[1] + w[2] * RAUSCH_BAND[2];", "let abgleich = 1.0f32;")], "--test metall ton_und_rauschen"),
 ("B2 linear instead of equal-power blend", MT, [("let quelle = ton * m.cos() + rausch * m.sin();", "let q = m / std::f32::consts::FRAC_PI_2;\n        let quelle = ton * (1.0 - q) + rausch * q;")], "--test metall ton_und_rauschen"),
 ("T1 tune ignored", MT, [("self.schritt = schritte(tune, sr);", "self.schritt = schritte(1.0, sr);")], "--test metall tune_verschiebt"),
 ("V1 velocity ignored", MT, [("self.huelle = endlich(x.vel, 1.0).clamp(0.0, 1.0);", "self.huelle = 1.0;")], "--test metall anschlagstaerke"),
 ("D1 decay as time constant instead of -60 dB time", MT, [("self.a_decay = (LN_60DB / (decay as f64 * sr as f64)).exp() as f32;", "self.a_decay = (-1.0 / (decay as f64 * sr as f64)).exp() as f32;")], "--test metall decay_ist"),
 ("D2 envelope never snaps to idle (subnormals)", MT, [("if self.huelle < STILL {", "if self.huelle < 0.0 {")], "--lib metall::tests::stimme_geht_still"),
 ("S1 high band at 7 kHz instead of 10.5 kHz", MT, [("pub const BAENDER: [f64; 3] = [3_500.0, 7_000.0, 10_500.0];", "pub const BAENDER: [f64; 3] = [3_500.0, 7_000.0, 7_000.0];")], "--test metall beispiele_treffen"),
 ("S2 high-pass bypassed", MT, [("self.hoch.prozess(y, g_hp, std::f64::consts::SQRT_2).2 as f32", "{ let _ = self.hoch.prozess(y, g_hp, std::f64::consts::SQRT_2); y as f32 }")], "--test metall beispiele_treffen"),
 ("C1 hard cut instead of the exponential choke", MT, [("self.huelle *= if self.gewuergt { e.a_schnitt } else { self.a_decay };", "self.huelle *= if self.gewuergt { 0.0 } else { self.a_decay };")], "--test metall choke_"),
 ("C2 group choke off", MT, [("let schlag = e.gruppe && ein[0][..n].iter().any(|t| *t > 0.5);", "let schlag = false && e.gruppe && ein[0][..n].iter().any(|t| *t > 0.5);")], "--test metall choke_schneidet"),
 ("C3 choke input ignored", MT, [("let flanke = choke && !self.choke_alt;", "let flanke = false && choke && !self.choke_alt;")], "--test metall gruppe_0_wuergt_nicht"),
 ("C4 choke time as time constant instead of -60 dB time", MT, [("a_schnitt: (LN_60DB / (schnitt_ms as f64 * 1e-3 * sr as f64)).exp() as f32,", "a_schnitt: (-1.0 / (schnitt_ms as f64 * 1e-3 * sr as f64)).exp() as f32,")], "--test metall choke_schneidet"),
 ("C5 filters reset at the choke (gain stays smooth, audio steps)", MT, [("        } else if (flanke || wuergen) && self.huelle > 0.0 {\n            self.gewuergt = true;", "        } else if (flanke || wuergen) && self.huelle > 0.0 {\n            self.gewuergt = true;\n            self.kette.leeren();")], "--test metall choke_ohne_klick"),
 ("C6 a new trig does not clear the choke", MT, [("            self.huelle = endlich(x.vel, 1.0).clamp(0.0, 1.0);\n            self.gewuergt = false;", "            self.huelle = endlich(x.vel, 1.0).clamp(0.0, 1.0);")], "--test metall gruppe_0_wuergt_nicht"),
 ("G1 seed from the clock", MT, [("^ e.saat.wrapping_mul(0xC2B2_AE35);", "^ e.saat.wrapping_mul(0xC2B2_AE35) ^ std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);")], "--test metall gleicher_graph"),
 ("G2 zuruecksetzen leaves the voices", PR, [("Schritt::Metall { m, e, .. } => **m = std::array::from_fn(|i| MtStimme::neu(i, e)),", "Schritt::Metall { .. } => {}")], "--test arten zuruecksetzen_gleich_frisch"),
 ("R1 non-finite hp not caught and no output guard", MT, [("let hp = endlich(x.hp, 6_000.0).clamp(HP_MIN, HP_MAX);", "let hp = x.hp.clamp(HP_MIN, HP_MAX);"), ("        if !aus.is_finite() {", "        if false && !aus.is_finite() {")], "--test metall unsinnige"),
 ("R2 allocation in the audio path", MT, [("let schlag = e.gruppe && ein[0][..n].iter().any(|t| *t > 0.5);", "let schlag = e.gruppe && ein[0][..n].iter().any(|t| *t > 0.5);\n    std::hint::black_box(Vec::<u8>::with_capacity(1));")], "--test keine_allokation"),
]
nur = sys.argv[2:]
env = dict(os.environ)
for name, datei, ersetzungen, test in M:
    if nur and name.split()[0] not in nur: continue
    p = os.path.join(DSP, datei); orig = open(p).read()
    neu = orig
    for alt, ersatz in ersetzungen:
        assert neu.count(alt) == 1, (name, alt[:60], neu.count(alt))
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
