//! Triode DSP (S8 task 1): Koren model, load line, tables, ADAA1, high-pass. Binding numbers: plan S8 with the review
//! corrections C1..C8 (reference values from the reviewer's Python model).
use baukasten_dsp::roehre::{g_ref, gitter, koren_ip, Roehre, RoehrenTabelle};

const SR: f32 = 48_000.0;

/// amplitude of the DFT bin `k` of `x` (coherent signals: `k` periods in `x.len()`), Goertzel
fn bin_amp(x: &[f32], k: usize) -> f64 {
    let n = x.len();
    let w = 2.0 * std::f64::consts::PI * k as f64 / n as f64;
    let c = 2.0 * w.cos();
    let (mut s1, mut s2) = (0.0f64, 0.0f64);
    for v in x {
        let s = *v as f64 + c * s1 - s2;
        s2 = s1;
        s1 = s;
    }
    ((s1 * s1 + s2 * s2 - c * s1 * s2).max(0.0)).sqrt() * 2.0 / n as f64
}

fn bin_leistung(x: &[f32], k: usize) -> f64 {
    let a = bin_amp(x, k);
    a * a
}

fn db(v: f64) -> f64 { 20.0 * v.log10() }

fn sinus(f: f64, amp: f32, n: usize) -> Vec<f32> {
    (0..n).map(|i| amp * (2.0 * std::f64::consts::PI * f * i as f64 / SR as f64).sin() as f32).collect()
}

fn rms(x: &[f32]) -> f64 { (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt() }

fn lauf(t: &RoehrenTabelle, x: &[f32], antrieb: f32) -> Vec<f32> {
    let mut r = Roehre::default();
    x.iter().map(|v| r.prozess(t, *v, antrieb, SR)).collect()
}

#[test]
fn koren_reference_point() {
    let ip = koren_ip(-2.0, 250.0);
    assert!((ip - 9.518e-4).abs() < 1e-7, "Ip = {ip:e}");
}

#[test]
fn load_line_reference() {
    let t = RoehrenTabelle::neu(-1.5);
    assert!((t.vq() - 186.92).abs() < 0.02, "vq {}", t.vq());
    assert!((t.g() - 55.85).abs() < 0.05, "g {}", t.g());
    assert!((t.vp_von_vg(-3.0) - 243.39).abs() < 0.05, "Vp(-3) {}", t.vp_von_vg(-3.0));
    assert!((t.vp_von_vg(0.0) - 89.18).abs() < 0.05, "Vp(0) {}", t.vp_von_vg(0.0));
    // all nine points of the plan (Vg -5 .. 0.5)
    for (vg, vp) in [(-5.0, 249.99), (-4.0, 249.64), (-3.0, 243.39), (-2.0, 212.34), (-1.5, 186.92), (-1.0, 156.99), (-0.5, 123.94), (0.0, 89.18), (0.5, 54.79)] {
        assert!((t.vp_von_vg(vg) - vp).abs() < 0.05, "Vp({vg}) = {}", t.vp_von_vg(vg));
    }
}

#[test]
fn table_matches_load_line() {
    // the table is linearly interpolated: it has to follow the exact load line to well under a percent of its swing
    let t = RoehrenTabelle::neu(-1.5);
    for u in [-3.0, -1.0, -0.2, 0.0, 0.1, 0.5, 1.0, 2.0] {
        let v = gitter(-1.5 + u);
        let soll = (t.vq() - t.vp_von_vg(v)) / (g_ref() * 0.25);
        assert!((t.fu(u) - soll).abs() < 2e-3, "u {u}: table {} exact {soll}", t.fu(u));
    }
    // quiescent point maps to 0
    assert!(t.fu(0.0).abs() < 2e-3, "f(rest) = {}", t.fu(0.0));
    // the antiderivative really integrates f: central difference of ff reproduces f between table points
    for v in [-9.1234, -3.001, -1.5, -0.7777, 0.123] {
        let h = 1e-5;
        let d = (t.ff(v + h) - t.ff(v - h)) / (2.0 * h);
        assert!((d - t.f(v)).abs() < 1e-3, "v {v}: ff' {d} f {}", t.f(v));
    }
    // and across many table cells: ff(b) - ff(a) equals the integral of f (midpoint rule, step 1e-4 V)
    let (a, b) = (-6.0, 0.4);
    let n = ((b - a) / 1e-4) as usize;
    let integral: f64 = (0..n).map(|i| t.f(a + (i as f64 + 0.5) * 1e-4) * 1e-4).sum();
    let diff = t.ff(a + n as f64 * 1e-4) - t.ff(a);
    assert!((diff - integral).abs() < 1e-3, "ff difference {diff} vs integral {integral}");
}

#[test]
fn small_signal_unity() {
    let t = RoehrenTabelle::neu(-1.5);
    let x = sinus(1000.0, 0.001, 48_000);
    let y = lauf(&t, &x, 0.0);
    let (xs, ys) = (&x[9600..], &y[9600..]);
    let ratio = rms(ys) / rms(xs);
    let corr = xs.iter().zip(ys).map(|(a, b)| *a as f64 * *b as f64).sum::<f64>() / (xs.len() as f64 * rms(xs) * rms(ys));
    println!("MESS small signal: ratio {ratio:.4} (model 0.9972), corr {corr:.4}");
    assert!((ratio - 1.0).abs() < 0.02, "ratio {ratio}");
    assert!(corr > 0.99, "phase inverted or distorted: corr {corr}");
}

#[test]
fn asymmetric_even_harmonics() {
    // 200 Hz = 240 samples per period; skip 40 periods, measure 160 periods (coherent)
    let t = RoehrenTabelle::neu(-1.5);
    let x = sinus(200.0, 1.0, 48_000);
    let y = lauf(&t, &x, 24.0);
    let y = &y[9600..];
    assert_eq!(y.len() % 240, 0);
    let periods = y.len() / 240;
    let (h1, h2, h3) = (bin_amp(y, periods), bin_amp(y, 2 * periods), bin_amp(y, 3 * periods));
    println!("MESS +24 dB 200 Hz: H2 {:.1} dB (model -18.9), H3 {:.1} dB (model -12.7)", db(h2 / h1), db(h3 / h1));
    assert!(db(h2 / h1) >= -22.0, "2nd harmonic {:.1} dB", db(h2 / h1));
    // upper bound (not in the plan): without the soft grid limit the 2nd harmonic rises to -14.4 dB (model)
    assert!(db(h2 / h1) <= -16.0, "2nd harmonic {:.1} dB: grid conduction missing?", db(h2 / h1));
}

#[test]
fn positive_side_softer() {
    let t = RoehrenTabelle::neu(-1.5);
    let (p, n) = (t.fu(3.0), t.fu(-3.0));
    println!("MESS f(+3 V) {p:.3}, f(-3 V) {n:.3}");
    assert!((p + n).abs() > 0.1 * p.abs(), "transfer is odd: {p} {n}");
}

#[test]
fn grid_conduction_applied() {
    // constant input, high-pass bypassed: ADAA falls back to f at the (constant) grid voltage
    let t = RoehrenTabelle::neu(-1.5);
    let konstant = |u: f64| {
        let mut r = Roehre::default();
        let mut y = 0.0;
        for _ in 0..8 { y = r.prozess_ohne_hp(&t, (u / 0.25) as f32, 0.0); }
        y as f64
    };
    let exakt = |u: f64| (t.vq() - t.vp_von_vg(gitter(-1.5 + u))) / (g_ref() * 0.25);
    let ohne_gitter = |u: f64| (t.vq() - t.vp_von_vg((-1.5 + u).min(0.5))) / (g_ref() * 0.25);
    // C6: +3 V -> f(g(3)) ~ 9.45
    let y3 = konstant(3.0);
    println!("MESS u=+3 V: block {y3:.3} exact f(g) {:.3} (model 9.452)", exakt(3.0));
    assert!((y3 / exakt(3.0) - 1.0).abs() < 0.01 && (y3 - 9.45).abs() < 0.1, "u 3: {y3}");
    // u = 2 V sits where the soft limit and a hard limit differ clearly: v = 0.5 -> g = 0.38
    let y2 = konstant(2.0);
    println!("MESS u=+2 V: block {y2:.3} soft limit {:.3} hard limit {:.3}", exakt(2.0), ohne_gitter(2.0));
    assert!((y2 / exakt(2.0) - 1.0).abs() < 0.01, "u 2: {y2} vs {}", exakt(2.0));
    assert!((ohne_gitter(2.0) / y2 - 1.0).abs() > 0.03, "test is blind: soft and hard limit agree");
}

/// folded harmonics (k * f0 above Nyquist mapped back), k = 1..600, minus the true harmonics below Nyquist
fn alias_energie(y: &[f32], bin0: usize) -> f64 {
    let n = y.len();
    let mut echt = std::collections::BTreeSet::new();
    let mut alias = std::collections::BTreeSet::new();
    for k in 1..600usize {
        let b = (k * bin0) % n;
        let b = if b > n / 2 { n - b } else { b };
        if k * bin0 < n / 2 { echt.insert(b); } else { alias.insert(b); }
    }
    alias.iter().filter(|b| !echt.contains(b)).map(|b| bin_leistung(y, *b)).sum()
}

#[test]
fn adaa_reduces_aliasing() {
    // C1: coherent f0 = 5871 * 48000 / 65536 = 4300.05 Hz, all aliases land on folded harmonics, no window needed
    let n = 65_536usize;
    let f0 = 5871.0 * 48_000.0 / n as f64;
    let t = RoehrenTabelle::neu(-1.5);
    let x = sinus(f0, 1.0, 2 * n);
    let gain = 10f64.powf(30.0 / 20.0) * 0.25;
    let mut r = Roehre::default();
    let adaa: Vec<f32> = x.iter().map(|v| r.prozess_ohne_hp(&t, *v, 30.0)).collect();
    // naive lookup of the same curve (written here)
    let naiv: Vec<f32> = x.iter().map(|v| t.f(gitter(-1.5 + *v as f64 * gain)) as f32).collect();
    let (ea, en) = (alias_energie(&adaa[n..], 5871), alias_energie(&naiv[n..], 5871));
    let verbesserung = 10.0 * (en / ea).log10();
    println!("MESS alias energy: adaa {ea:.3e} naive {en:.3e} -> {verbesserung:.1} dB (model 8.6)");
    assert!(verbesserung >= 6.0, "ADAA only {verbesserung:.1} dB below naive");
}

#[test]
fn dc_removed() {
    let t = RoehrenTabelle::neu(-1.5);
    let x = sinus(100.0, 1.0, 48_000);
    let y = lauf(&t, &x, 30.0);
    let mittel = y[24_000..].iter().map(|v| *v as f64).sum::<f64>() / 24_000.0;
    // Gegenprobe: the raw curve has a large DC (model 2.2)
    let mut r = Roehre::default();
    let roh: Vec<f32> = x.iter().map(|v| r.prozess_ohne_hp(&t, *v, 30.0)).collect();
    let roh_mittel = roh[24_000..].iter().map(|v| *v as f64).sum::<f64>() / 24_000.0;
    println!("MESS mean: with HP {mittel:.2e}, raw {roh_mittel:.3}");
    assert!(mittel.abs() < 1e-3, "mean {mittel}");
    assert!(roh_mittel.abs() > 1.0, "test is blind: raw curve has no DC ({roh_mittel})");
}

#[test]
fn adaa_fallback_equal_inputs() {
    // C8: constant 0.3 -> every sample takes the |u - up| = 0 path; the output equals a one-pole high-pass
    // (a = exp(-2 pi 10 / sr), y[n] = a (y[n-1] + x[n] - x[n-1])) applied to the constant f(0.3 * 0.25 V)
    let t = RoehrenTabelle::neu(-1.5);
    let mut r = Roehre::default();
    let c = t.fu(0.3 * 0.25);
    let a = (-2.0 * std::f64::consts::PI * 10.0 / SR as f64).exp();
    let (mut hy, mut hx) = (0.0f64, 0.0f64);
    for n in 0..100 {
        let y = r.prozess(&t, 0.3, 0.0, SR);
        assert!(y.is_finite());
        hy = a * (hy + c - hx);
        hx = c;
        assert!((y as f64 - hy).abs() < 1e-6, "sample {n}: {y} vs {hy}");
    }
    assert!(c.abs() > 0.1, "test is blind: constant maps to {c}");
}

#[test]
fn reset() {
    let t = RoehrenTabelle::neu(-1.5);
    let mut a = Roehre::default();
    for i in 0..5000 { a.prozess(&t, 0.8 * (i as f32 * 0.05).sin(), 20.0, SR); }
    a.zuruecksetzen();
    let mut b = Roehre::default();
    let imp: Vec<f32> = (0..300).map(|i| if i == 3 { 1.0 } else { 0.0 }).collect();
    let (ya, yb): (Vec<f32>, Vec<f32>) = (imp.iter().map(|x| a.prozess(&t, *x, 12.0, SR)).collect(), imp.iter().map(|x| b.prozess(&t, *x, 12.0, SR)).collect());
    assert_eq!(ya.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), yb.iter().map(|v| v.to_bits()).collect::<Vec<_>>());
    assert!(ya.iter().any(|v| *v != 0.0));
}

#[test]
fn guards_nan_and_antrieb_range() {
    let t = RoehrenTabelle::neu(-1.5);
    // a non-finite input acts exactly like the replacement value (0 for x, 0 dB for antrieb) for the whole run: the
    // state must not be poisoned (sample 201 and later stay bit-identical)
    let lauf_mit = |x_in: f32, a_in: f32| {
        let mut r = Roehre::default();
        (0..400).map(|i| {
            let (x, a) = if i == 200 { (x_in, a_in) } else { (0.5 * (i as f32 * 0.1).sin(), 12.0) };
            r.prozess(&t, x, a, SR).to_bits()
        }).collect::<Vec<u32>>()
    };
    let ref_x = lauf_mit(0.0, 12.0);
    for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        let y = lauf_mit(bad, 12.0);
        assert!(y.iter().all(|b| f32::from_bits(*b).is_finite()));
        assert_eq!(y, ref_x, "x = {bad} must act like 0");
    }
    let ref_a = lauf_mit(0.3, 0.0);
    for bad in [f32::NAN, f32::INFINITY] {
        assert_eq!(lauf_mit(0.3, bad), ref_a, "antrieb = {bad} must act like 0 dB");
    }
    // antrieb is clamped to +-40 dB: 80 dB and 40 dB give identical output, -90 and -40 too
    let sig = sinus(300.0, 0.7, 2000);
    assert_eq!(lauf(&t, &sig, 80.0), lauf(&t, &sig, 40.0));
    assert_eq!(lauf(&t, &sig, -90.0), lauf(&t, &sig, -40.0));
    assert_ne!(lauf(&t, &sig, 30.0), lauf(&t, &sig, 40.0));
}
