//! The `sem` block (type 38): an SEM-style 12 dB/oct state-variable filter whose mode sweeps low-pass -> notch -> high-pass
//! (`form`), with a separate band-pass output. Frequency responses are measured on sine waves of amplitude 0.01 (where the
//! gentle saturation is linear), the loudness on synthetic pink noise, the rest on `sem::Sem` directly and through the
//! JSON API. Raw numbers are printed with `--nocapture` (lines starting `MESS`).
use baukasten_dsp::sem::{self, Sem};
use baukasten_dsp::{uebersetze, Fehler, Programm, ARTEN};
use std::f64::consts::PI;

const SR: f32 = 48_000.0;

fn lade(g: &str) -> Programm { uebersetze(g, SR).unwrap_or_else(|e| panic!("{e}: {g}")) }

fn db(v: f64) -> f64 { 20.0 * v.max(1e-30).log10() }

/// RMS gain in dB of output `which` (0 = aus, 1 = bp) for a steady sine `f` of amplitude 0.01.
fn gang(f: f64, cutoff: f32, reso: f32, form: f32, which: usize) -> f64 {
    let mut s = Sem::default();
    let a = 0.01f64;
    let n = (SR as usize) / 2;
    let (mut ein, mut aus) = (0.0, 0.0);
    for i in 0..n + 8_000 {
        let x = (a * (2.0 * PI * f * i as f64 / SR as f64).sin()) as f32;
        let (y, b) = s.prozess(x, cutoff, reso, form, SR);
        if i >= 8_000 {
            let y = if which == 0 { y } else { b } as f64;
            ein += (x as f64).powi(2);
            aus += y * y;
        }
    }
    db((aus / ein).sqrt())
}

/// Deterministic pink noise (Kellet's filter on xorshift white noise), unit-ish level.
fn rosa(n: usize, saat: u32) -> Vec<f32> {
    let mut z = saat | 1;
    let (mut b0, mut b1, mut b2) = (0.0f64, 0.0f64, 0.0f64);
    (0..n).map(|_| {
        z ^= z << 13;
        z ^= z >> 17;
        z ^= z << 5;
        let w = z as f64 / u32::MAX as f64 * 2.0 - 1.0;
        b0 = 0.99765 * b0 + w * 0.0990460;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        (0.05 * (b0 + b1 + b2 + w * 0.1848)) as f32
    }).collect()
}

/// Four octaves centred on `fc` (fc/4 .. 4 fc) with equal energy per octave: 64 sines, log-spaced (not harmonically
/// related), fixed pseudo-random phases. Low-pass and high-pass at `fc` see the same energy, so what the sweep shows is the
/// morph and not the tilt of the test signal.
fn oktavband(fc: f64, n: usize) -> Vec<f32> {
    let mut z = 4242u32;
    let teile: Vec<(f64, f64)> = (0..64).map(|i| {
        z ^= z << 13;
        z ^= z >> 17;
        z ^= z << 5;
        (fc / 4.0 * 16f64.powf((i as f64 + 0.37) / 64.0), z as f64 / u32::MAX as f64 * 2.0 * PI)
    }).collect();
    (0..n).map(|k| {
        let t = k as f64 / SR as f64;
        (0.01 * teile.iter().map(|(f, ph)| (2.0 * PI * f * t + ph).sin()).sum::<f64>()) as f32
    }).collect()
}

fn rms(x: &[f32]) -> f64 { (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt() }

/// Loudness in dB of pink noise through the filter at fixed `form`.
fn laut(cutoff: f32, reso: f32, form: f32, eingang: &[f32]) -> f64 {
    let mut s = Sem::default();
    let y: Vec<f32> = eingang.iter().map(|x| s.prozess(*x, cutoff, reso, form, SR).0).collect();
    db(rms(&y[9_600..]))
}

#[test]
fn tiefpass_bei_form_0() {
    let fc = 1000.0;
    let (a, b) = (gang(50.0, fc, 0.0, 0.0, 0), gang(1000.0, fc, 0.0, 0.0, 0));
    println!("MESS lp pass {a:.3} at fc {b:.3}");
    assert!(a.abs() < 0.1, "pass band {a}");
    // k = 1.5: |H(fc)| = 1/k = -3.52 dB
    assert!((b + 3.52).abs() < 0.2, "at fc {b}");
    // 12 dB per octave far above the cutoff; fc 250 Hz keeps the bilinear warping small (2 kHz -> 4 kHz)
    let (c, d) = (gang(4000.0, 250.0, 0.0, 0.0, 0), gang(2000.0, 250.0, 0.0, 0.0, 0));
    println!("MESS lp slope fc 250: 2k {d:.2} 4k {c:.2} (diff {:.2})", d - c);
    assert!((d - c - 12.0).abs() < 0.5, "slope {}", d - c);
    assert!(c < -45.0, "stop band {c}");
}

#[test]
fn hochpass_bei_form_1() {
    let fc = 4000.0;
    let (a, b, c) = (gang(18000.0, fc, 0.0, 1.0, 0), gang(4000.0, fc, 0.0, 1.0, 0), gang(250.0, fc, 0.0, 1.0, 0));
    let d = gang(500.0, fc, 0.0, 1.0, 0);
    println!("MESS hp pass {a:.3} at fc {b:.3} 250 {c:.3} 500 {d:.3}");
    assert!(a.abs() < 0.3, "pass band {a}");
    assert!((b + 3.52).abs() < 0.2, "at fc {b}");
    assert!((d - c - 12.0).abs() < 0.8, "slope {}", d - c);
}

#[test]
fn kerbe_bei_form_halb() {
    let fc = 2000.0f32;
    // position: scan 1 .. 4 kHz in 5 Hz steps, deepest point
    let (mut tief, mut wo) = (0.0f64, 0.0f64);
    for i in 0..=600 {
        let f = 1000.0 + 5.0 * i as f64;
        let g = gang(f, fc, 0.0, 0.5, 0);
        if i == 0 || g < tief { tief = g; wo = f; }
    }
    let exakt = gang(fc as f64, fc, 0.0, 0.5, 0);
    println!("MESS notch deepest scanned {tief:.1} dB at {wo} Hz, at fc {exakt:.1} dB");
    assert!((wo - 2000.0).abs() <= 5.0, "notch at {wo} Hz");
    assert!(exakt < -60.0, "depth {exakt}");
    // pass bands on both sides at unity (the gain curve is 1 at the notch)
    let soll = db(sem::pegel(0.5));
    let (lo, hi) = (gang(40.0, fc, 0.0, 0.5, 0), gang(16000.0, fc, 0.0, 0.5, 0));
    println!("MESS notch pass low {lo:.2} high {hi:.2} expected {soll:.2}");
    assert!((lo - soll).abs() < 0.2 && (hi - soll).abs() < 0.8, "pass bands {lo} {hi} vs {soll}");
    // the notch stays at fc and exact with resonance
    for r in [0.5f32, 1.0] {
        let g = gang(fc as f64, fc, r, 0.5, 0);
        assert!(g < -60.0, "reso {r}: depth {g}");
    }
}

#[test]
fn bandpass_ausgang() {
    let fc = 1000.0;
    for r in [0.0f32, 0.5, 1.0] {
        let spitze = gang(1000.0, fc, r, 0.0, 1);
        let (u, o) = (gang(250.0, fc, r, 0.0, 1), gang(4000.0, fc, r, 0.0, 1));
        println!("MESS bp reso {r}: peak {spitze:.2} 250 Hz {u:.2} 4 kHz {o:.2}");
        assert!(spitze.abs() < 0.2, "reso {r}: unity peak, got {spitze}");
        assert!(u < -3.0 && o < -3.0, "reso {r}: skirts {u} {o}");
        // independent of form: the band-pass output does not morph
        assert!((gang(1000.0, fc, r, 1.0, 1) - spitze).abs() < 0.01);
    }
    // narrower with resonance, 6 dB per octave on the skirts
    assert!(gang(1250.0, fc, 1.0, 0.0, 1) < gang(1250.0, fc, 0.0, 0.0, 1) - 6.0);
    let (a, b) = (gang(62.5, fc, 0.0, 0.0, 1), gang(125.0, fc, 0.0, 0.0, 1));
    let (c, d) = (gang(800.0, 100.0, 0.0, 0.0, 1), gang(1600.0, 100.0, 0.0, 0.0, 1));
    println!("MESS bp skirt slopes: low {:.2} dB/oct, high (fc 100) {:.2} dB/oct", b - a, c - d);
    assert!((b - a - 6.0).abs() < 0.3, "low skirt slope {}", b - a);
    assert!((c - d - 6.0).abs() < 0.3, "high skirt slope {}", c - d);
}

#[test]
fn resonanzspitze_ohne_selbstschwingung() {
    let fc = 1000.0;
    let spitze = (0..400).map(|i| gang(700.0 + i as f64 * 1.5, fc, 1.0, 0.0, 0)).fold(f64::MIN, f64::max);
    let flach = (0..400).map(|i| gang(300.0 + i as f64 * 5.0, fc, 0.0, 0.0, 0)).fold(f64::MIN, f64::max);
    println!("MESS reso peak {spitze:.2} dB (reso 1), {flach:.2} dB (reso 0)");
    // 1/k = 1/0.18 = +14.9 dB; the loop damping only bites at higher levels
    assert!((13.5..16.0).contains(&spitze), "peak {spitze}");
    assert!(flach < 0.1, "no peak at reso 0: {flach}");

    // an impulse and a loud burst at the sharpest setting die away at every cutoff and form: no self-oscillation
    for cutoff in [20.0f32, 100.0, 1000.0, 8000.0, 21000.0] {
        for form in [0.0f32, 0.5, 1.0] {
            let mut s = Sem::default();
            for i in 0..4800 {
                // a loud sine on the resonance for 0.1 s (8x full scale)
                let x = (8.0 * (2.0 * PI * cutoff as f64 * i as f64 / SR as f64).sin()) as f32;
                s.prozess(x, cutoff, 1.0, form, SR);
            }
            let mut spitze_nach = 0.0f32;
            for i in 0..192_000 {
                let (y, b) = s.prozess(0.0, cutoff, 1.0, form, SR);
                if i >= 144_000 { spitze_nach = spitze_nach.max(y.abs()).max(b.abs()); }
            }
            println!("MESS ring-out fc {cutoff} form {form}: |y| after 3 s {spitze_nach:e}");
            assert!(spitze_nach < 1e-9, "fc {cutoff} form {form}: still ringing {spitze_nach}");
        }
    }
}

#[test]
fn saettigung_ist_sanft() {
    // small signals: linear; full scale: a gentle compression, no hard clip
    let g_klein = gang(500.0, 1000.0, 0.0, 0.0, 0);
    let mut s = Sem::default();
    let (mut ein, mut aus) = (0.0f64, 0.0f64);
    for i in 0..48_000 {
        let x = (0.9 * (2.0 * PI * 50.0 * i as f64 / SR as f64).sin()) as f32;
        let (y, _) = s.prozess(x, 10_000.0, 0.0, 0.0, SR);
        if i > 4_800 { ein += (x as f64).powi(2); aus += (y as f64).powi(2); }
    }
    let g_gross = db((aus / ein).sqrt());
    println!("MESS gain small {g_klein:.3} dB, 0.9 amplitude passband {g_gross:.3} dB");
    assert!((g_klein + 0.51).abs() < 0.1, "linear gain at fc/2 (0.5 dB down): {g_klein}");
    assert!((-1.5..-0.1).contains(&g_gross), "compression at 0.9: {g_gross}");
}

#[test]
fn lautstaerke_ueber_die_fahrt() {
    // Main criterion: equal energy per octave around the cutoff (`oktavband`), so low-pass and high-pass see the same energy.
    // Over form 0 .. 1 in steps of 0.05 the loudness stays within 0.5 dB (4 dB with resonance) and moves less than 0.35 dB per step (0.7 with resonance).
    for (cutoff, reso) in [(300.0f32, 0.0f32), (1000.0, 0.0), (3000.0, 0.0), (1000.0, 0.6), (3000.0, 0.3)] {
        let ein = oktavband(cutoff as f64, 96_000);
        let werte: Vec<f64> = (0..=20).map(|i| laut(cutoff, reso, i as f32 / 20.0, &ein)).collect();
        let (lo, hi) = werte.iter().fold((f64::MAX, f64::MIN), |a, v| (a.0.min(*v), a.1.max(*v)));
        let sprung = werte.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f64::max);
        println!("MESS octave band fc {cutoff} reso {reso}: lp {:.2} dB, notch {:.2}, hp {:.2}, spread {:.2} dB, largest step {sprung:.2} dB",
                 werte[0], werte[10], werte[20], hi - lo);
        // with resonance the notch has no peak, so the sweep drops by the peak's energy there (documented in sem.rs)
        let grenze = if reso == 0.0 { 0.5 } else { 4.0 };
        assert!(hi - lo < grenze, "fc {cutoff} reso {reso}: loudness spread {} dB over the sweep", hi - lo);
        let schritt_max = if reso == 0.0 { 0.35 } else { 0.7 };
        assert!(sprung < schritt_max, "fc {cutoff} reso {reso}: step {sprung} dB between neighbouring form values");
    }
    // Information, and a looser bound: on pink noise the two ends differ by the tilt of the signal itself (a low-pass at
    // 3 kHz keeps 7 octaves of it, the high-pass 3), which no fixed gain can remove; the sweep stays continuous.
    let ein = rosa(96_000, 12345);
    for cutoff in [300.0f32, 1000.0, 3000.0] {
        let werte: Vec<f64> = (0..=20).map(|i| laut(cutoff, 0.0, i as f32 / 20.0, &ein)).collect();
        let sprung = werte.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f64::max);
        let (lo, hi) = werte.iter().fold((f64::MAX, f64::MIN), |a, v| (a.0.min(*v), a.1.max(*v)));
        println!("MESS pink noise fc {cutoff}: lp {:.2} dB, notch {:.2}, hp {:.2}, spread {:.2} dB, largest step {sprung:.2} dB", werte[0], werte[10], werte[20], hi - lo);
        assert!(sprung < 1.0, "pink fc {cutoff}: step {sprung} dB");
    }
}

#[test]
fn formwechsel_ohne_knacks() {
    // a sine through the filter; form stepped 0 -> 1 -> 0.5 at single samples (a knob moved at control rate)
    let mut s = Sem::default();
    let mut y = Vec::new();
    for i in 0..48_000 {
        let form = if i < 12_000 { 0.0 } else if i < 24_000 { 1.0 } else if i < 36_000 { 0.5 } else { 0.2 };
        let x = (0.5 * (2.0 * PI * 700.0 * i as f64 / SR as f64).sin()) as f32;
        y.push(s.prozess(x, 1500.0, 0.3, form, SR).0);
    }
    let schritt = |a: usize, b: usize| (a + 1..b).map(|i| (y[i] - y[i - 1]).abs()).fold(0.0f32, f32::max);
    let ruhig = schritt(6_000, 12_000).max(schritt(18_000, 24_000)).max(schritt(30_000, 36_000));
    for (name, t) in [("0->1", 12_000usize), ("1->0.5", 24_000), ("0.5->0.2", 36_000)] {
        let am_sprung = schritt(t - 2, t + 200);
        println!("MESS form step {name}: largest sample-to-sample change {am_sprung:.4}, steady state {ruhig:.4}");
        assert!(am_sprung < 1.5 * ruhig, "{name}: click, {am_sprung} against steady state {ruhig}");
    }
    // and a slow sweep 0 -> 1 over one second: no step bigger than the signal's own slope
    let mut s = Sem::default();
    let mut y = Vec::new();
    for i in 0..48_000 {
        let x = (0.5 * (2.0 * PI * 700.0 * i as f64 / SR as f64).sin()) as f32;
        y.push(s.prozess(x, 1500.0, 0.3, i as f32 / 48_000.0, SR).0);
    }
    let m = (1..y.len()).map(|i| (y[i] - y[i - 1]).abs()).fold(0.0f32, f32::max);
    assert!(m < 1.5 * ruhig, "sweep: {m} against {ruhig}");
}

#[test]
fn audiorate_modulation_bleibt_stabil() {
    let mut z = 7u32;
    let mut s = Sem::default();
    let mut spitze = 0.0f32;
    for i in 0..480_000 {
        z ^= z << 13;
        z ^= z >> 17;
        z ^= z << 5;
        let x = (z as f64 / u32::MAX as f64 * 2.0 - 1.0) as f32;
        let t = i as f64 / SR as f64;
        let cutoff = (2000.0 + 1900.0 * (2.0 * PI * 3000.0 * t).sin()) as f32;
        let cutoff = if i % 3 == 0 { 20.0 } else { cutoff };
        let form = (0.5 + 0.6 * (2.0 * PI * 5000.0 * t).sin()) as f32;
        let (y, b) = s.prozess(x, cutoff, 1.0, form, SR);
        assert!(y.is_finite() && b.is_finite(), "sample {i} not finite");
        spitze = spitze.max(y.abs()).max(b.abs());
    }
    println!("MESS audio-rate cutoff + form modulation, white noise at full scale, reso 1: peak {spitze:.3}");
    assert!(spitze < 20.0, "peak {spitze}");
    // cutoff alternating between its extremes every sample (worst case for a coefficient step)
    let mut s = Sem::default();
    let mut spitze = 0.0f32;
    for i in 0..96_000 {
        let x = (0.8 * (2.0 * PI * 1000.0 * i as f64 / SR as f64).sin()) as f32;
        let c = if i % 2 == 0 { 20.0 } else { 30_000.0 };
        let (y, b) = s.prozess(x, c, 1.0, (i % 2) as f32, SR);
        assert!(y.is_finite() && b.is_finite());
        spitze = spitze.max(y.abs()).max(b.abs());
    }
    println!("MESS cutoff and form alternating each sample: peak {spitze:.3}");
    assert!(spitze < 20.0, "peak {spitze}");
}

#[test]
fn extreme_eingaenge_bleiben_endlich() {
    let werte = [0.0f32, 1.0, -1.0, 1e-30, 1e30, -1e30, f32::MAX, f32::MIN, f32::INFINITY, f32::NEG_INFINITY, f32::NAN, -5.0, 1e-45];
    for &x in &werte {
        for &c in &werte {
            for &r in &[0.0f32, 1.0, f32::NAN, 1e30, -1.0] {
                for &f in &[0.0f32, 0.5, f32::NAN, f32::INFINITY, -3.0, 1e30] {
                    let mut s = Sem::default();
                    for i in 0..20 {
                        let x = if i % 2 == 0 { x } else { 0.3 };
                        let (y, b) = s.prozess(x, c, r, f, SR);
                        assert!(y.is_finite() && b.is_finite(), "x {x} cutoff {c} reso {r} form {f}: {y} {b}");
                    }
                }
            }
        }
    }
    // after a NaN the filter recovers at once: the state was reset, normal input gives normal output
    let mut s = Sem::default();
    for i in 0..1000 { s.prozess((i as f32 * 0.1).sin(), 1000.0, 0.5, 0.0, SR); }
    assert_eq!(s.prozess(f32::NAN, 1000.0, 0.5, 0.0, SR), (0.0, 0.0));
    let nach: Vec<f32> = (0..2000).map(|i| s.prozess(0.5 * (i as f32 * 0.05).sin(), 1000.0, 0.5, 0.0, SR).0).collect();
    assert!(nach.iter().all(|v| v.is_finite() && v.abs() < 2.0));
    assert!(nach[1000..].iter().any(|v| v.abs() > 0.1), "silent after recovery");
    // a huge input is clipped by the input stage, not passed on
    let mut s = Sem::default();
    let m = (0..2000).map(|_| s.prozess(1e30, 20_000.0, 0.0, 0.0, SR).0.abs()).fold(0.0f32, f32::max);
    println!("MESS 1e30 input, cutoff 20 kHz: peak {m:.3}");
    assert!(m < 4.0, "peak {m}");
}

#[test]
fn deterministisch() {
    let ein = rosa(20_000, 99);
    let lauf = || {
        let mut s = Sem::default();
        ein.iter().enumerate().map(|(i, x)| s.prozess(*x, 500.0 + (i % 700) as f32, 0.8, (i % 1000) as f32 / 1000.0, SR)).collect::<Vec<_>>()
    };
    let (a, b) = (lauf(), lauf());
    assert!(a.iter().zip(&b).all(|(p, q)| p.0.to_bits() == q.0.to_bits() && p.1.to_bits() == q.1.to_bits()));
    assert!(a.iter().any(|v| v.0 != 0.0));
}

// ---------------------------------------------------------------------------------------------------------------------
// Through the JSON API

fn graph(werte: &str, knoten: &str, kanten: &str, stimmen: usize) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"sem","stimmen":{stimmen},"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"f","art":"sem"{werte}}},{{"id":"o","art":"ausgang"}}{knoten}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"s.aus","nach":"f.x"}}{kanten}]}}"#
    )
}

#[test]
fn art_und_werte() {
    let i = ARTEN.iter().position(|a| a.art == "sem").expect("ARTEN has no sem");
    assert!(i >= 38, "sem was appended after saite (type 38 on this branch), found at {i}");
    assert_eq!(ARTEN[11].art, "svf", "existing type numbers must not move");
    let a = &ARTEN[i];
    assert_eq!(a.ein, &["x", "cutoff", "reso", "form"]);
    assert_eq!(a.aus, &["aus", "bp"]);
    let f = |w: &str| uebersetze(&graph(w, "", r#",{"von":"f.aus","nach":"o.x"}"#, 1), SR);
    assert!(f("").is_ok());
    assert!(f(r#","reso":1,"form":1,"cutoff":20"#).is_ok());
    assert!(matches!(f(r#","reso":1.5"#), Err(Fehler::Wert { ref wert, .. }) if wert == "reso"));
    assert!(matches!(f(r#","form":-0.1"#), Err(Fehler::Wert { ref wert, .. }) if wert == "form"));
    assert!(matches!(f(r#","form":1.1"#), Err(Fehler::Wert { ref wert, .. }) if wert == "form"));
    assert!(matches!(f(r#","tief":1"#), Err(Fehler::UnbekannterWert { .. })));
}

#[test]
fn im_graph_beide_ausgaenge_und_form_als_eingang() {
    // aus and bp are different signals; form as a wired input (a knob) moves the sound
    let mk = |form: f32| {
        let g = graph(r#","cutoff":800,"reso":0.5"#, r#",{"id":"k","art":"konst","wert":FORM}"#.replace("FORM", &form.to_string()).as_str(),
                      r#",{"von":"k.aus","nach":"f.form"},{"von":"f.aus","nach":"o.l"},{"von":"f.bp","nach":"o.r"}"#, 1);
        let mut p = lade(&g);
        p.note_an(45, 0.8);
        (0..24_000).map(|_| p.sample_stereo()).skip(4_800).collect::<Vec<_>>()
    };
    let (lp, hp) = (mk(0.0), mk(1.0));
    let e = |v: &[(f32, f32)], s: usize| (v.iter().map(|x| (if s == 0 { x.0 } else { x.1 } as f64).powi(2)).sum::<f64>() / v.len() as f64).sqrt();
    println!("MESS graph saw 110 Hz fc 800: aus rms form 0 {:.4}, form 1 {:.4}, bp {:.4}", e(&lp, 0), e(&hp, 0), e(&lp, 1));
    assert!(e(&lp, 0) > 0.01 && e(&hp, 0) > 0.01 && e(&lp, 1) > 0.01);
    assert!(lp.iter().zip(&hp).any(|(a, b)| (a.0 - b.0).abs() > 0.05), "form changes nothing");
    assert!(lp.iter().any(|a| (a.0 - a.1).abs() > 0.05), "aus and bp are the same signal");
    // bp does not depend on form
    assert!(lp.iter().zip(&hp).all(|(a, b)| a.1.to_bits() == b.1.to_bits()), "bp moves with form");
}

#[test]
fn im_graph_audiorate_quellen() {
    // cutoff and form from audio-rate sines, 8 voices, reso 1: finite, bounded, and no rescue by the program
    let g = graph(r#","reso":1"#,
        r#",{"id":"m1","art":"sinus","hz":3100},{"id":"m2","art":"mul","b":1800},{"id":"m3","art":"add","b":2000},{"id":"m4","art":"sinus","hz":4700},{"id":"m5","art":"mul","b":0.5},{"id":"m6","art":"add","b":0.5}"#,
        r#",{"von":"m1.aus","nach":"m2.a"},{"von":"m2.aus","nach":"m3.a"},{"von":"m3.aus","nach":"f.cutoff"},{"von":"m4.aus","nach":"m5.a"},{"von":"m5.aus","nach":"m6.a"},{"von":"m6.aus","nach":"f.form"},{"von":"f.aus","nach":"o.x"}"#, 8);
    let mut p = lade(&g);
    for n in 0..8u8 { p.note_an(36 + 5 * n, 1.0); }
    let y: Vec<f32> = (0..96_000).map(|_| p.sample()).collect();
    assert_eq!(p.rettungen, 0);
    assert!(y.iter().all(|v| v.is_finite()));
    assert!(y.iter().any(|v| v.abs() > 0.05));
}
