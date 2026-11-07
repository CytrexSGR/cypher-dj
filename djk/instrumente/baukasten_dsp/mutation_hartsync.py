"""Mutation runs of the band-limited hard sync: apply one change, run the test that must catch it, print RED/GREEN, revert.

Usage (on a copy of djk/instrumente, never on the working tree another build reads):
    python3 mutation_hartsync.py /path/to/copy/of/instrumente [ID ...]
IDs are the first word of a name (H1, B2, ...); without IDs all run. Results: BERICHT-hartsync.md.
"""
import subprocess, sys, os, re
ROOT = sys.argv[1]
DSP = os.path.join(ROOT, "baukasten_dsp")
OS = "src/osz.rs"; UE = "src/uebersetzen.rs"; PR = "src/programm.rs"
STUFEN = "--test hartsync sync_fahrt_in_stufen"
REF = "--test hartsync folger_trifft_die_unabhaengige_referenz"
M = [
 ("H1 post-half of the corrections dropped", OS,
  "        self.nach = e.nach;\n", "        self.nach = 0.0 * e.nach;\n", STUFEN),
 ("H2 pre-half of the corrections dropped", OS,
  "(y + e.vor, z)", "(y + 0.0 * e.vor, z)", STUFEN),
 ("H3 reset at the start of the interval (tau ignored)", OS,
  "let tau = (hart - 1.0).min(1.0);", "let tau = (hart - 1.0).min(0.0);", "--test hartsync ruecksetzen_an_der_genauen"),
 ("H4 master announces 1 - tau instead of tau", OS,
  "/// Output `hart` of the sample just computed: 1 + τ if the phase wraps τ ∈ (0, 1] samples after it, else 0.\n    #[inline]\n    pub fn hart(&self) -> f32 { self.hart }",
  "/// Output `hart` of the sample just computed: 1 + τ if the phase wraps τ ∈ (0, 1] samples after it, else 0.\n    #[inline]\n    pub fn hart(&self) -> f32 { if self.hart >= 1.0 { 3.0 - self.hart } else { 0.0 } }",
  "--test hartsync ruecksetzen_an_der_genauen"),
 ("H5 jump height from the phase at the sample, not at the reset", OS,
  "let pr = if ende >= 1.0 { ende - 1.0 } else { ende };", "let pr = p;", REF),
 ("H6 triangle: slope change at the reset left out (no PolyBLAMP)", OS,
  "(form.steigung_ab_null() - form.steigung(pr)) * inc", "0.0 * (form.steigung_ab_null() - form.steigung(pr)) * inc", REF),
 ("H7 narrow pulse: edge crossed right after the reset not corrected", OS,
  "            form.kreuzungen(0.0, neu, tau, inc, &mut e);\n", "", "--test hartsync schmaler_puls"),
 ("H8 natural edges before the reset not corrected", OS,
  "let ende = p + tau * inc;\n            let wrap = form.kreuzungen(p, ende, 0.0, inc, &mut e);",
  "let ende = p + tau * inc;\n            let wrap = None::<f32>;", REF),
 ("H9 after a reset the post-halves are read off the phase", OS,
  "y += if self.nach_gilt { self.nach } else { form.nach_aus_phase(p, inc) };", "y += form.nach_aus_phase(p, inc);", STUFEN),
 ("B1 hard sync path also without a reset (no fallback to the old code)", OS,
  "if hart < 1.0 && !self.nach_gilt {\n            return self.saege(inc, 0.0);", "if false {\n            return self.saege(inc, 0.0);",
  "--test hartsync ohne_umlauf_des_leiters_bitgleich"),
 ("B2 old phase step rewritten (same value in exact arithmetic)", OS,
  "fn weiter(&mut self, inc: f32) {\n        let rest = 1.0 - self.phase;\n        self.phase += inc;",
  "fn weiter(&mut self, inc: f32) {\n        let rest = 1.0 - self.phase;\n        self.phase = (self.phase + 0.5 * inc) + 0.5 * inc;",
  "--test hartsync_bitgleich"),
 ("B3 the old sync input reads the new hart edge too", PR,
  "(o[i], z[i]) = osz[i].saege_hart((f[i] / sr).clamp(0.0, 0.5), h[i]);",
  "(o[i], z[i]) = osz[i].saege((f[i] / sr).clamp(0.0, 0.5), h[i]);",
  "--test hartsync folger_trifft_die_unabhaengige_referenz"),
 ("D1 very slow phase steps not treated as standing", OS,
  "let inc = if inc > 1e-20 { inc } else { 0.0 };", "let inc = if inc > 0.0 { inc } else { 0.0 };", "--lib osz::tests::kein_subnormaler"),
 ("R1 hart and sync allowed together", UE,
  "(true, false) => Ok(Some(q(\"hart\"))),", "(true, _) => Ok(Some(q(\"hart\"))),", "--test hartsync hart_nimmt_nur_kanten"),
 ("R2 a fixed hart value accepted", UE,
  "\"saege\" | \"puls\" | \"dreieck\" if k.werte.contains_key(\"hart\") =>", "\"saege\" | \"puls\" | \"dreieck\" if false && k.werte.contains_key(\"hart\") =>",
  "--test hartsync hart_nimmt_nur_kanten"),
 ("Z1 zuruecksetzen leaves the oscillators", PR,
  "Schritt::Saege { osz, .. } | Schritt::Puls { osz, .. } | Schritt::Dreieck { osz, .. } => *osz = [Osz::default(); MAX_STIMMEN],",
  "Schritt::Saege { .. } | Schritt::Puls { .. } | Schritt::Dreieck { .. } => {}",
  "--test arten zuruecksetzen_gleich_frisch_hartsync"),
 ("A1 allocation in the hard sync path", OS,
  "let mut e = Ereignisse::default();", "let mut e = Ereignisse::default();\n        std::hint::black_box(Vec::<u8>::with_capacity(1));",
  "--test keine_allokation"),
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
                msg = " / ".join(z.strip() for z in zeilen[i + 1:i + 4] if z.strip() and not z.startswith("stack"))
                break
        if "error[E" in out: msg = "COMPILE ERROR " + re.findall(r"error\[E\d+\].*", out)[0]
        print(f"{'RED  ' if rot else 'GREEN'} | {name} | {test} | {msg[:400]}", flush=True)
    finally:
        open(p, "w").write(orig)
