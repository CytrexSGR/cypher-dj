"""Mutation runs of the string block: apply one change, run the test that must catch it, print RED/GREEN, revert.

Usage (on a copy of djk/instrumente, never on the working tree another build reads):
    python3 mutation_saite.py /path/to/copy/of/instrumente [ID ...]
IDs are the first word of a name (P1, T2, ...); without IDs all run. Results: BERICHT-saite.md.
A mutation is a list of (file, old, new) replacements; each old text must occur exactly once.
"""
import subprocess, sys, os, re
ROOT = sys.argv[1]
DSP = os.path.join(ROOT, "baukasten_dsp")
SA = "src/saite.rs"; PR = "src/programm.rs"
M = [
 ("P1 textbook allpass coefficient (1 - D) / (1 + D)", [(SA, ".min_by(|x, y| (x - eta0).abs().total_cmp(&(y - eta0).abs()))?;", ".min_by(|x, y| (x - eta0).abs().total_cmp(&(y - eta0).abs())).map(|_| (1.0 - delta) / (1.0 + delta))?;")], "--test saite tonhoehe"),
 ("P2 tuning on the unit circle (phase delay of L and allpass coefficient at w0, not at the pole)", [(SA, "let rest = d + (1.0 / (1.0 + a * u)).arg() / w;", "let rest = d - pol(-a, w).0 + 0.0 * (1.0 / (1.0 + a * u)).arg();"),
                                                                                                  (SA, ".min_by(|x, y| (x - eta0).abs().total_cmp(&(y - eta0).abs()))?;", ".min_by(|x, y| (x - eta0).abs().total_cmp(&(y - eta0).abs())).map(|_| eta0)?;")], "--test saite tonhoehe"),
 ("P2b allpass coefficient on the unit circle only", [(SA, ".min_by(|x, y| (x - eta0).abs().total_cmp(&(y - eta0).abs()))?;", ".min_by(|x, y| (x - eta0).abs().total_cmp(&(y - eta0).abs())).map(|_| eta0)?;")], "--test saite tonhoehe"),
 ("P3 no fractional delay (allpass off)", [(SA, ".min_by(|x, y| (x - eta0).abs().total_cmp(&(y - eta0).abs()))?;", ".min_by(|x, y| (x - eta0).abs().total_cmp(&(y - eta0).abs())).map(|_| 0.0)?;")], "--test saite tonhoehe"),
 ("P4 integer delay ignores the loss filter's phase", [(SA, "let rest = d + (1.0 / (1.0 + a * u)).arg() / w;", "let rest = d + 0.0 * (1.0 / (1.0 + a * u)).arg() / w;")], "--lib saite::tests::schleife_trifft"),
 ("N1 cheap path keeps the old delay and allpass", [(SA, "let s = if nur_tonhoehe { nachfuehren(f0 as f64, sr as f64, t60 as f64, daempfung as f64, self.s.a) } else { None };", "let s = if nur_tonhoehe { Some(self.s) } else { None };")], "--test saite tonhoehe_folgt"),
 ("T1 decay from the unit-circle gain per period (no pole placement)", [(SA, "s.b0 = 1.0 / s.bei_z(zs).norm();", "s.b0 = 1.0 / s.bei_z(zs).norm();\n        s.b0 = self.g0 / s.bei(w).2 * s.b0;")], "--test saite ausklang"),
 ("T2 decay radius with ln instead of log10", [(SA, "let radius = 10f64.powf(-3.0 / (sr * t60));", "let radius = (-3.0 / (sr * t60)).exp();")], "--test saite ausklang"),
 ("D1 damping pole with the wrong sign", [(SA, "a_soll: (g_pi - g0) / (g_pi + g0),", "a_soll: (g0 - g_pi) / (g_pi + g0),")], "--test saite daempfung"),
 ("D2 damping limit off (infeasible designs pass)", [(SA, "    if v.geht(&s) {\n        return s.unwrap();", "    if s.is_some() {\n        return s.unwrap();")], "--test saite stabil"),
 ("L1 DC limit off (only G_MAX)", [(SA, "let dc_grenze = G_MAX.min(self.g0.powf(DC_EXPONENT));", "let dc_grenze = G_MAX;")], "--lib saite::tests::verklungene"),
 ("C1 no DC blocker on the excitation", [(SA, "        let c = ch as f32;", "        let c = c as f32 + 0.0 * ch as f32;")], "--test saite konstante"),
 ("K1 pick-position comb off", [(SA, "let c = q - (k0 + (k1 - k0) * mf);", "let c = q + 0.0 * (k0 + (k1 - k0) * mf);")], "--test saite anschlag_in_der_mitte"),
 ("K2 integer comb delay", [(SA, "let (mi, mf) = (m as usize, m.fract());", "let (mi, mf) = (m.round() as usize, 0.0);")], "--test saite anschlag_in_der_mitte"),
 ("S1 no subnormal flush in the loop", [(SA, "fn null(x: f64) -> f64 { if x.abs() < NULL as f64 { 0.0 } else { x } }", "fn null(x: f64) -> f64 { x }"),
                                         (SA, "let v = if v.abs() < NULL { 0.0 } else { v };", "let v = v;")], "--lib saite::tests::verklungene"),
 ("S2 body states flushed one by one", [(SA, "*z = if z0.abs() + z1.abs() < NULL as f64 { [0.0; 2] } else { [z0, z1] };", "*z = [null(z0), null(z1)];")], "--lib saite::tests::verklungene"),
 ("G1 written value not clamped", [(SA, "let v = if v.is_finite() { v.clamp(-GRENZE, GRENZE) } else { 0.0 };", "let v = if v.is_finite() { v } else { 0.0 };")], "--test saite stabil"),
 ("R1 non-finite x and loop value not caught", [(SA, "let q = self.erreger() + endlich(x.x, 0.0).clamp(-GRENZE, GRENZE);", "let q = self.erreger() + x.x.clamp(-GRENZE, GRENZE);"),
                                                 (SA, "let v = if v.is_finite() { v.clamp(-GRENZE, GRENZE) } else { 0.0 };", "let v = v.clamp(-GRENZE, GRENZE);")], "--test saite unsinnige"),
 ("H1 hammer contact independent of velocity", [(SA, "let tc = 0.004 * (-3.0 * hell).exp2() / (0.5 + vel);", "let tc = 0.004 * (-3.0 * hell).exp2() / 1.5;")], "--test saite harter"),
 ("B1 noise burst ignores brightness", [(SA, "self.ek = if hell >= 1.0 { 1.0 } else { 1.0 - (-std::f32::consts::TAU * fc / sr).exp() };", "self.ek = if hell >= 1.0 { 1.0 } else { 1.0 + 0.0 * fc };")], "--test saite hell_macht"),
 ("Z1 zuruecksetzen leaves the delay line", [(SA, "        self.buf.iter_mut().for_each(|x| *x = 0.0);\n", "")], "--test arten zuruecksetzen_gleich_frisch"),
 ("Z2 zuruecksetzen leaves the noise generator", [(SA, "        self.zufall = if s == 0 { 0x2545_F491 } else { s };\n        self.kz", "        if self.zufall == 1 { self.zufall = if s == 0 { 0x2545_F491 } else { s }; }\n        self.kz")], "--test arten zuruecksetzen_gleich_frisch"),
 ("Z3 no reset arm in programm.rs", [(PR, "Schritt::Saite { s, e, .. } => s.iter_mut().enumerate().for_each(|(i, v)| v.zuruecksetzen(i, e)),", "Schritt::Saite { .. } => {}")], "--test arten zuruecksetzen_gleich_frisch"),
 ("V1 seed ignored", [(SA, "let s = 0x9E37_79B9u32 ^ (stimme as u32 + 1).wrapping_mul(0x85EB_CA6B) ^ e.saat.wrapping_mul(0xC2B2_AE35);", "let s = 0x9E37_79B9u32 ^ (stimme as u32 + 1).wrapping_mul(0x85EB_CA6B) ^ e.saat.wrapping_mul(0);")], "--test saite gleicher_graph"),
 ("A1 allocation in the audio path", [(SA, "        let d = sr / f0;\n        if x.trig > 0.5 {", "        let d = sr / f0;\n        std::hint::black_box(Vec::<u8>::with_capacity(1));\n        if x.trig > 0.5 {")], "--test keine_allokation"),
]
nur = sys.argv[2:]
env = dict(os.environ)
for name, aenderungen, test in M:
    if nur and name.split()[0] not in nur: continue
    orig = {}
    for datei, alt, neu in aenderungen:
        p = os.path.join(DSP, datei)
        if p not in orig: orig[p] = open(p).read()
        s = open(p).read()
        assert s.count(alt) == 1, (name, alt, s.count(alt))
        open(p, "w").write(s.replace(alt, neu))
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
        for p, s in orig.items():
            open(p, "w").write(s)
