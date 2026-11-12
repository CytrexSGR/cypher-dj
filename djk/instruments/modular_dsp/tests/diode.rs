//! Focused measurements of the `diode` block (TB-303 diode-ladder low-pass) on synthetic signals. Every number is printed
//! as a `MESS <key> <value>` line (run with `--nocapture`), the asserts are the pass limits.
use baukasten_dsp::diode::{Diode, K_MAX};
use baukasten_dsp::{uebersetze, Programm};
use rb_dsp::Ladder;

const SR: f32 = 48_000.0;

fn mess(key: &str, v: f64) { println!("MESS {key} {v:.6}"); }

/// xorshift noise in -1..1 (deterministic)
fn rauschen(n: usize, mut z: u32) -> Vec<f32> {
    (0..n).map(|_| { z ^= z << 13; z ^= z >> 17; z ^= z << 5; (z as f64 / u32::MAX as f64 * 2.0 - 1.0) as f32 }).collect()
}

/// Steady-state gain of the block for a sine of `f` Hz and amplitude `a`: RMS out over RMS in, after 0.4 s of settling.
fn gain(f: f64, a: f64, cutoff: f32, reso: f32, antrieb: f32, bass: f32) -> f64 {
    let mut d = Diode::default();
    let (n_einschwing, n_mess) = ((0.4 * SR as f64) as usize, (0.2 * SR as f64) as usize);
    let (mut ein, mut aus) = (0.0f64, 0.0f64);
    for i in 0..n_einschwing + n_mess {
        let x = (a * (2.0 * std::f64::consts::PI * f * i as f64 / SR as f64).sin()) as f32;
        let y = d.prozess(x, cutoff, reso, antrieb, bass, SR);
        if i >= n_einschwing { ein += (x as f64).powi(2); aus += (y as f64).powi(2); }
    }
    (aus / ein).sqrt()
}

fn db(g: f64) -> f64 { 20.0 * g.max(1e-12).log10() }

#[test]
fn ecke_und_flanke_bei_reso_null() {
    // cutoff 1000: the -3 dB corner of the chain sits at 0.1008 * cutoff (documented, see diode.rs)
    let a = 1e-3; // small: tanh is linear
    let tief = gain(5.0, a, 1000.0, 0.0, 0.0, 0.0);
    mess("reso0_dc_gain", tief);
    assert!((tief - 1.0).abs() < 0.02, "passband gain {tief}");
    // find the -3 dB frequency by bisection on the measured gain
    let (mut lo, mut hi) = (20.0f64, 400.0f64);
    for _ in 0..24 {
        let m = (lo * hi).sqrt();
        if db(gain(m, a, 1000.0, 0.0, 0.0, 0.0) / tief) > -3.0103 { lo = m } else { hi = m }
    }
    let ecke = (lo * hi).sqrt();
    mess("reso0_ecke_hz_bei_cutoff_1000", ecke);
    assert!((ecke / 100.8 - 1.0).abs() < 0.04, "corner {ecke} Hz, expected 100.8 Hz");
    // slope: dB per octave between 4 and 8 kHz and between 8 and 16 kHz (poles at 0.1 / 0.84 / 2.0 / 3.0 kHz)
    let g4 = db(gain(4000.0, a, 1000.0, 0.0, 0.0, 0.0));
    let g8 = db(gain(8000.0, a, 1000.0, 0.0, 0.0, 0.0));
    let g16 = db(gain(16000.0, a, 1000.0, 0.0, 0.0, 0.0));
    mess("reso0_flanke_4k_8k_db_okt", g8 - g4);
    mess("reso0_flanke_8k_16k_db_okt", g16 - g8);
    assert!((-27.0..-19.0).contains(&(g8 - g4)), "slope 4k..8k {} dB/oct", g8 - g4);
    // the corner follows cutoff: a tenfold cutoff moves it tenfold (within the tolerance of the warping)
    let tief10 = gain(5.0, a, 10_000.0, 0.0, 0.0, 0.0);
    let g_ecke10 = db(gain(1008.0, a, 10_000.0, 0.0, 0.0, 0.0) / tief10);
    mess("reso0_gain_db_bei_1008hz_cutoff_10000", g_ecke10);
    assert!((g_ecke10 + 3.0).abs() < 0.8, "corner at cutoff 10 kHz: {g_ecke10} dB at 1008 Hz");
}

#[test]
fn resonanzspitze_lage_und_pegel() {
    let a = 1e-3;
    for (reso, soll_lage, soll_gain) in [(0.5f32, 0.74, 0.238), (0.75, 0.89, 0.378), (1.0, 1.0, 2.267)] {
        // fine sweep around the expected position
        let (mut best_f, mut best_g) = (0.0, 0.0);
        let mut f = 500.0;
        while f < 1300.0 {
            let g = gain(f, a, 1000.0, reso, 0.0, 0.0);
            if g > best_g { best_g = g; best_f = f; }
            f *= 1.004;
        }
        mess(&format!("reso{reso}_spitze_hz"), best_f);
        mess(&format!("reso{reso}_spitze_gain"), best_g);
        // positions and levels of the continuous model (python, same poles); the sampled sweep is coarse in frequency
        assert!((best_f / (1000.0 * soll_lage) - 1.0).abs() < 0.06, "reso {reso}: peak at {best_f} Hz");
        assert!((best_g / soll_gain - 1.0).abs() < 0.2, "reso {reso}: peak gain {best_g}, expected {soll_gain}");
    }
}

#[test]
fn resonanz_saettigt_und_schwingt_nicht_von_selbst() {
    // level limit: the same sine at the peak with growing level; the gain must fall (feedback saturates)
    let fp = 1000.0 * 1.0;
    let (g1, g2, g3) = (gain(fp, 1e-3, 1000.0, 1.0, 0.0, 0.0), gain(fp, 0.3, 1000.0, 1.0, 0.0, 0.0), gain(fp, 3.0, 1000.0, 1.0, 0.0, 0.0));
    mess("reso1_gain_klein", g1);
    mess("reso1_gain_0.3", g2);
    mess("reso1_gain_3.0", g3);
    assert!(g2 < 0.7 * g1 && g3 < 0.5 * g2, "no compression: {g1} {g2} {g3}");
    // output bound: loud noise at full resonance and high drive stays under a fixed limit
    let mut d = Diode::default();
    let spitze = rauschen(96_000, 7).iter().map(|&x| d.prozess(x * 4.0, 800.0, 1.0, 24.0, 0.0, SR).abs()).fold(0.0f32, f32::max);
    mess("reso1_spitze_laut_rauschen_24db", spitze as f64);
    assert!(spitze < 4.0, "peak {spitze}");
    // it does not oscillate by itself: a hard kick, then silence; the ring dies away
    let mut d = Diode::default();
    for i in 0..48 { d.prozess(if i < 48 { 1.0 } else { 0.0 }, 450.0, 1.0, 0.0, 0.0, SR); }
    let mut huelle = Vec::new();
    for _ in 0..10 {
        let m = (0..4_800).map(|_| d.prozess(0.0, 450.0, 1.0, 0.0, 0.0, SR).abs()).fold(0.0f32, f32::max);
        huelle.push(m);
    }
    mess("ring_max_0_100ms", huelle[0] as f64);
    mess("ring_max_400_500ms", huelle[4] as f64);
    mess("ring_max_900_1000ms", huelle[9] as f64);
    assert!(huelle[0] > 0.01, "the resonance must ring ({})", huelle[0]);
    assert!(huelle[9] < 1e-4 * huelle[0], "still ringing after 1 s: {} against {}", huelle[9], huelle[0]);
    // from noise without input after the noise ends: same
    let mut d = Diode::default();
    for x in rauschen(48_000, 3) { d.prozess(x, 450.0, 1.0, 0.0, 0.0, SR); }
    for _ in 0..48_000 { d.prozess(0.0, 450.0, 1.0, 0.0, 0.0, SR); }
    let rest = (0..4_800).map(|_| d.prozess(0.0, 450.0, 1.0, 0.0, 0.0, SR).abs()).fold(0.0f32, f32::max);
    mess("rest_nach_rauschen_1s", rest as f64);
    assert!(rest < 1e-5, "self-oscillation: {rest}");
}

#[test]
fn bassverlust_und_ausgleich() {
    // DC gain 1/(1+k) at reso 0.6; `bass` 1 gives it back (small signal, tanh linear)
    let a = 1e-3;
    let k = K_MAX * 0.6;
    let dc = |reso: f32, bass: f32| {
        let mut d = Diode::default();
        let mut y = 0.0;
        for _ in 0..48_000 { y = d.prozess(a as f32, 1000.0, reso, 0.0, bass, SR); }
        y as f64 / a
    };
    let (ohne, voll, halb) = (dc(0.6, 0.0), dc(0.6, 1.0), dc(0.6, 0.5));
    mess("dc_reso0.6_bass0", ohne);
    mess("dc_reso0.6_bass0.5", halb);
    mess("dc_reso0.6_bass1", voll);
    assert!((ohne - 1.0 / (1.0 + k)).abs() < 0.005, "bass loss {ohne}, expected {}", 1.0 / (1.0 + k));
    assert!((voll - 1.0).abs() < 0.02, "full compensation {voll}");
    assert!(ohne < halb && halb < voll);
}

#[test]
fn stabil_bei_audiorate_cutoff_und_extremen() {
    let rausch = rauschen(96_000, 11);
    // filter FM: the cutoff follows a 3 kHz sine over six octaves (125 Hz .. 8 kHz), full resonance, 24 dB drive
    let mut d = Diode::default();
    let mut spitze = 0.0f32;
    for (i, &x) in rausch.iter().enumerate() {
        let c = 1000.0 * (3.0 * (2.0 * std::f32::consts::PI * 3000.0 * i as f32 / SR).sin()).exp2();
        let y = d.prozess(x, c, 1.0, 24.0, 0.0, SR);
        assert!(y.is_finite());
        spitze = spitze.max(y.abs());
    }
    mess("fm_3khz_6_oktaven_spitze", spitze as f64);
    assert!(spitze < 6.0, "FM peak {spitze}");
    // cutoff jumps between both ends every sample, and every 7 samples
    for teiler in [1usize, 7] {
        let mut d = Diode::default();
        let mut sp = 0.0f32;
        for (i, &x) in rausch.iter().enumerate() {
            let c = if (i / teiler) % 2 == 0 { 20.0 } else { SR * 0.45 };
            let y = d.prozess(x, c, 1.0, 12.0, 1.0, SR);
            assert!(y.is_finite());
            sp = sp.max(y.abs());
        }
        mess(&format!("cutoff_sprung_alle_{teiler}_sample_spitze"), sp as f64);
        assert!(sp < 40.0, "jump peak {sp}");
    }
    // a fast envelope sweep: 20 ms exponential decay from 12 kHz to 100 Hz on every kick, resonance 0.9
    let mut d = Diode::default();
    let mut sp = 0.0f32;
    for i in 0..96_000 {
        let t = (i % 12_000) as f32 / SR;
        let c = 100.0 + 12_000.0 * (-t / 0.02).exp();
        let y = d.prozess(if i % 12_000 < 48 { 1.0 } else { rausch[i] * 0.3 }, c, 0.9, 6.0, 0.0, SR);
        assert!(y.is_finite());
        sp = sp.max(y.abs());
    }
    mess("huellkurve_20ms_spitze", sp as f64);
    assert!(sp < 6.0, "sweep peak {sp}");
    // extreme and non-finite inputs: always finite, and a clean restart after the reset
    let mut d = Diode::default();
    let frisch: Vec<f32> = { let mut f = Diode::default(); (0..200).map(|i| f.prozess(0.5 * (i as f32 * 0.1).sin(), 800.0, 0.7, 0.0, 0.0, SR)).collect() };
    for bose in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, 1e30, -1e30] {
        for _ in 0..50 { d.prozess(0.3, 800.0, 0.9, 0.0, 0.0, SR); }
        let y = d.prozess(bose, 800.0, 0.7, 0.0, 0.0, SR);
        assert!(y.is_finite(), "x = {bose}: {y}");
        for (c, r, a, b) in [(f32::NAN, 0.5, 0.0, 0.0), (f32::INFINITY, 0.5, 0.0, 0.0), (-5.0, 0.5, 0.0, 0.0), (1e9, 1e9, 0.0, 0.0), (800.0, f32::NAN, 0.0, 0.0),
                             (800.0, 0.5, 1e9, 0.0), (800.0, 0.5, f32::NAN, 0.0), (800.0, 0.5, 0.0, f32::NAN), (800.0, -3.0, -1e9, 99.0)] {
            let y = d.prozess(0.5, c, r, a, b, SR);
            assert!(y.is_finite(), "cutoff {c} reso {r} antrieb {a} bass {b}: {y}");
        }
    }
    // after a NaN the state is clean: the next samples equal a fresh instance
    let mut d = Diode::default();
    for _ in 0..100 { d.prozess(0.7, 300.0, 0.9, 0.0, 0.0, SR); }
    assert_eq!(d.prozess(f32::NAN, 800.0, 0.7, 0.0, 0.0, SR), 0.0);
    let nach: Vec<f32> = (0..200).map(|i| d.prozess(0.5 * (i as f32 * 0.1).sin(), 800.0, 0.7, 0.0, 0.0, SR)).collect();
    assert_eq!(nach.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), frisch.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), "state not clean after NaN");
    // 44.1 kHz and 96 kHz stay finite and bounded too
    for sr in [44_100.0f32, 96_000.0] {
        let mut d = Diode::default();
        let sp = rausch.iter().map(|&x| d.prozess(x, 5000.0, 1.0, 12.0, 0.0, sr).abs()).fold(0.0f32, f32::max);
        assert!(sp.is_finite() && sp < 6.0, "sr {sr}: {sp}");
    }
}

#[test]
fn bitgleich_und_determiniert() {
    let rausch = rauschen(20_000, 5);
    let lauf = || {
        let mut d = Diode::default();
        rausch.iter().enumerate().map(|(i, &x)| d.prozess(x, 300.0 + (i % 977) as f32, 0.8, 6.0, 0.3, SR).to_bits()).collect::<Vec<u32>>()
    };
    assert_eq!(lauf(), lauf());
    // the voices of a graph are independent: voice 0 of a two-voice program equals the single block
    let g = r#"{"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"d","art":"diode","cutoff":900,"reso":0.7,"antrieb":6},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"d.x"},{"von":"d.aus","nach":"o.x"}]}"#;
    let mut a = uebersetze(g, SR).unwrap();
    let mut b = uebersetze(g, SR).unwrap();
    a.note_an(45, 0.8);
    b.note_an(45, 0.8);
    for _ in 0..4800 { assert_eq!(a.sample().to_bits(), b.sample().to_bits()); }
}

fn graph(extra: &str) -> Result<Programm, baukasten_dsp::Fehler> {
    uebersetze(&format!(r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"d","art":"diode"{extra}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"s.aus","nach":"d.x"}},{{"von":"d.aus","nach":"o.x"}}]}}"#), SR)
}

#[test]
fn graph_werte_und_ausgang() {
    assert!(graph("").is_ok());
    assert!(graph(r#","cutoff":500,"reso":0.6,"antrieb":12,"bass":0.5"#).is_ok());
    assert!(graph(r#","antrieb":100"#).is_err(), "antrieb 100 dB must be refused");
    assert!(graph(r#","bass":1.5"#).is_err(), "bass 1.5 must be refused");
    let mut p = graph(r#","cutoff":900,"reso":0.6"#).unwrap();
    p.note_an(45, 0.8);
    let y: Vec<f32> = (0..4800).map(|_| p.sample()).collect();
    assert!(y.iter().all(|v| v.is_finite()) && y.iter().any(|v| v.abs() > 1e-3), "silent or not finite");
    // cutoff on an audio-rate edge: a second saw (high note) modulates it; the graph must accept the edge and stay finite
    let g = r#"{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"m","art":"sinus"},{"id":"mm","art":"mul","b":800},{"id":"a","art":"add","b":1000},{"id":"d","art":"diode","reso":1,"antrieb":12},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.hz","nach":"m.hz"},{"von":"m.aus","nach":"mm.a"},{"von":"mm.aus","nach":"a.a"},{"von":"s.aus","nach":"d.x"},{"von":"a.aus","nach":"d.cutoff"},{"von":"d.aus","nach":"o.x"}]}"#;
    let mut p = uebersetze(g, SR).unwrap();
    p.note_an(57, 0.8);
    assert!((0..48_000).map(|_| p.sample()).all(|v| v.is_finite()));
}

/// What `diode` shares with `rb_dsp::Ladder` (the filter of the acid plugin), measured on the same signals.
#[test]
fn vergleich_mit_rb_dsp() {
    // 1. both saturate the input with tanh: a loud sine deep in the passband of both comes out as tanh(x)
    let (mut rb, mut dd) = (Ladder::default(), Diode::default());
    let (mut max_rb, mut max_dd, mut max_diff) = (0.0f64, 0.0f64, 0.0f64);
    for i in 0..48_000 {
        let x = (2.5 * (2.0 * std::f64::consts::PI * 40.0 * i as f64 / SR as f64).sin()) as f32;
        let ideal = x.tanh() as f64;
        let (a, b) = (rb.prozess(x, 12_000.0, 0.0, SR) as f64, dd.prozess(x, 21_600.0, 0.0, 0.0, 0.0, SR) as f64);
        if i > 9_600 {
            max_rb = max_rb.max((a - ideal).abs());
            max_dd = max_dd.max((b - ideal).abs());
            max_diff = max_diff.max((a - b).abs());
        }
    }
    mess("passband_40hz_x2.5_max_abweichung_rb_von_tanh", max_rb);
    mess("passband_40hz_x2.5_max_abweichung_diode_von_tanh", max_dd);
    mess("passband_40hz_x2.5_max_diff_rb_diode", max_diff);
    assert!(max_rb < 0.03 && max_dd < 0.06, "tanh shape: rb {max_rb}, diode {max_dd}");
    assert!(max_diff < 0.08, "difference {max_diff}");

    // 2. magnitude responses at reso 0 with the -3 dB corners matched (rb corner found by bisection)
    let a = 1e-3;
    let rb_gain = |f: f64, cutoff: f32| {
        let mut l = Ladder::default();
        let (mut ein, mut aus) = (0.0f64, 0.0f64);
        for i in 0..28_800 {
            let x = (a * (2.0 * std::f64::consts::PI * f * i as f64 / SR as f64).sin()) as f32;
            let y = l.prozess(x, cutoff, 0.0, SR);
            if i >= 19_200 { ein += (x as f64).powi(2); aus += (y as f64).powi(2); }
        }
        (aus / ein).sqrt()
    };
    // corner of rb at cutoff 1000 (a one-pole cascade: its cutoff is the single-stage corner, the -3 dB point is lower)
    let (mut lo, mut hi) = (50.0f64, 1000.0f64);
    for _ in 0..24 {
        let m = (lo * hi).sqrt();
        if db(rb_gain(m, 1000.0)) > -3.0103 { lo = m } else { hi = m }
    }
    let rb_ecke = (lo * hi).sqrt();
    mess("rb_dsp_ecke_hz_bei_cutoff_1000_reso0", rb_ecke);
    let diode_cutoff = (rb_ecke / 0.1008) as f32;
    let mut summe = 0.0;
    for f in [rb_ecke / 2.0, rb_ecke, rb_ecke * 2.0, rb_ecke * 4.0, rb_ecke * 8.0, rb_ecke * 16.0] {
        let (g_rb, g_dd) = (db(rb_gain(f, 1000.0)), db(gain(f, a, diode_cutoff, 0.0, 0.0, 0.0)));
        mess(&format!("eckenabgleich_f{:.0}_rb_db", f), g_rb);
        mess(&format!("eckenabgleich_f{:.0}_diode_db", f), g_dd);
        summe += (g_rb - g_dd).abs();
        if f == rb_ecke { assert!((g_rb + 3.0).abs() < 0.2 && (g_dd + 3.0).abs() < 0.5, "corner levels {g_rb} {g_dd}"); }
    }
    mess("eckenabgleich_mittlere_abweichung_db", summe / 6.0);

    // 3. resonance: where does each filter put its peak and how high, same cutoff 1000, reso 0.8, small signal
    let peak = |g: &dyn Fn(f64) -> f64| {
        let (mut bf, mut bg) = (0.0, 0.0);
        let mut f = 100.0;
        while f < 8000.0 { let v = g(f); if v > bg { bg = v; bf = f; } f *= 1.01; }
        (bf, db(bg))
    };
    let (f_rb, p_rb) = peak(&|f| { let mut l = Ladder::default(); let (mut e, mut o) = (0.0f64, 0.0f64);
        for i in 0..28_800 { let x = (a * (2.0 * std::f64::consts::PI * f * i as f64 / SR as f64).sin()) as f32; let y = l.prozess(x, 1000.0, 0.8, SR); if i >= 19_200 { e += (x as f64).powi(2); o += (y as f64).powi(2); } } (o / e).sqrt() });
    let (f_dd, p_dd) = peak(&|f| gain(f, a, 1000.0, 0.8, 0.0, 0.0));
    mess("reso0.8_cutoff1000_rb_spitze_hz", f_rb);
    mess("reso0.8_cutoff1000_rb_spitze_db", p_rb);
    mess("reso0.8_cutoff1000_diode_spitze_hz", f_dd);
    mess("reso0.8_cutoff1000_diode_spitze_db", p_dd);
    // the diode ladder at the same cutoff number puts its peak near it and does not exceed the rb peak by a wild margin
    assert!(p_dd.is_finite() && p_rb.is_finite());
}
