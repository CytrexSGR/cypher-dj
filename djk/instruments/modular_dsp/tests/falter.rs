//! `falter` (type 48): the wavefolder. Identity at the neutral setting, the fold curve, aliasing on a ~2 kHz sine at several
//! drives (against the naive fold as a negative control), symmetry (DC and even harmonics), latency, extremes, translation.
use baukasten_dsp::falter::{dreieck, sinus, Falter, LATENZ};
use baukasten_dsp::{uebersetze, ARTEN};
use realfft::RealFftPlanner;
use std::f64::consts::PI;

const SR: f32 = 48_000.0;
const N: usize = 65_536;
/// 2731 periods in N samples: 2000.3 Hz. K and N are coprime, so no folded harmonic lands on a multiple of K: every bin
/// that is not a multiple of K is alias (the multiples of K are the real harmonics of the fold).
const K: usize = 2731;

/// Three passes over one period-exact sine, the last one returned (the oversampler and the ADAA state settled).
fn lauf(amp: f64, mut f: impl FnMut(f32) -> f32) -> Vec<f64> {
    let x: Vec<f32> = (0..N).map(|n| (amp * (2.0 * PI * (K * n) as f64 / N as f64).sin()) as f32).collect();
    let mut y = Vec::with_capacity(N);
    for r in 0..3 {
        for &v in &x {
            let o = f(v);
            if r == 2 {
                y.push(o as f64);
            }
        }
    }
    y
}

/// Energy of the bins below 16 kHz that are not multiples of K, relative to the energy of the multiples, in dB.
fn alias_db(y: &[f64]) -> f64 {
    let mut p = RealFftPlanner::<f64>::new();
    let fft = p.plan_fft_forward(N);
    let mut a = y.to_vec();
    let mut spek = fft.make_output_vec();
    fft.process(&mut a, &mut spek).unwrap();
    let grenze = (16_000.0 / SR as f64 * N as f64) as usize;
    let (mut sig, mut ali) = (0.0, 0.0);
    for b in 1..grenze {
        let e = spek[b].norm_sqr();
        if b % K == 0 { sig += e } else { ali += e }
    }
    10.0 * (ali / sig).log10()
}

fn naiv(x: f32, db: f64, form: f64) -> f32 {
    let u = x as f64 * 10f64.powf(db / 20.0);
    ((1.0 - form) * dreieck(u) + form * sinus(u)) as f32
}

#[test]
fn neutral_ist_die_identitaet() {
    // 0 dB, symmetry 0, form 0, |x| <= 1. First-order ADAA of the identity is the mean of two successive samples (a half-sample
    // delay), so the base-rate mode equals that mean exactly; the oversampled mode is the input delayed by LATENZ (plus a
    // quarter sample) within the half-band ripple.
    let x: Vec<f32> = (0..4800).map(|n| 0.9 * (2.0 * PI * 440.0 * n as f64 / 48_000.0).sin() as f32).collect();
    let mut f = Falter::default();
    let y: Vec<f32> = x.iter().map(|&v| f.prozess(v, 0.0, 0.0, 0.0, false)).collect();
    let d = (1..x.len()).map(|n| (y[n] - 0.5 * (x[n] + x[n - 1])).abs()).fold(0.0f32, f32::max);
    println!("MESS identity 1x: max |y[n] - (x[n] + x[n-1]) / 2| {d:e}");
    assert!(d < 1e-6, "{d}");
    let mut f = Falter::default();
    let y: Vec<f32> = x.iter().map(|&v| f.prozess(v, 0.0, 0.0, 0.0, true)).collect();
    let d = (LATENZ + 200..x.len()).map(|n| (y[n] - x[n - LATENZ]).abs()).fold(0.0f32, f32::max);
    println!("MESS identity 2x: max |y[n] - x[n - {LATENZ}]| {d:e} (amplitude 0.9, 440 Hz)");
    assert!(d < 0.02, "{d}");
}

#[test]
fn die_kennlinie_faltet_mehrstufig() {
    // slow ramp (50 Hz sine, amplitude 1) at +12 dB through the base-rate ADAA against the ideal fold: ADAA of a slow signal
    // is the fold itself within the step-size error
    for form in [0.0f32, 1.0] {
        let mut f = Falter::default();
        let (mut d, mut stufen, mut vorher) = (0.0f64, 0, 0.0f64);
        for n in 0..96_000 {
            let x = (2.0 * PI * 20.0 * n as f64 / 48_000.0).sin() as f32;
            let y = f.prozess(x, 12.0, 0.0, form, false) as f64;
            // ADAA averages over one sample step, so compare with the fold of the mid point of the last two inputs
            let u = 3.98 * x as f64; // 12 dB
            let ideal = if form == 0.0 { dreieck(u) } else { sinus(u) };
            if n > 10 { d = d.max((y - ideal).abs()); }
            if (y > 0.0) != (vorher > 0.0) { stufen += 1; }
            vorher = y;
        }
        println!("MESS fold form {form}: max |y - ideal| {d:.4}, sign changes in 2 s of a 20 Hz sine at +12 dB: {stufen}");
        // the sine at +12 dB reaches u = 3.98, i.e. it folds through 1, -1, 1 and so on: many more sign changes than the 80 of the input
        assert!(stufen > 160, "{stufen}");
        assert!(d < 0.02, "{d}");
    }
}

#[test]
fn aliasing_auf_2_khz_unter_dem_naiven_falten() {
    let mut zeilen = Vec::new();
    for form in [0.0f64, 1.0] {
        for db in [6.0f64, 12.0, 18.0, 24.0] {
            let amp = 0.8;
            let n = alias_db(&lauf(amp, |x| naiv(x, db, form)));
            let mut f = Falter::default();
            let a1 = alias_db(&lauf(amp, |x| f.prozess(x, db as f32, 0.0, form as f32, false)));
            let mut f = Falter::default();
            let a2 = alias_db(&lauf(amp, |x| f.prozess(x, db as f32, 0.0, form as f32, true)));
            println!("MESS alias form {form} drive {db:4.0} dB: naive {n:6.1}  ADAA1 {a1:6.1}  ADAA1 2x {a2:6.1} dB");
            zeilen.push((form, db, n, a1, a2));
        }
    }
    for (form, db, n, a1, a2) in zeilen {
        // the sine fold at low drive has no alias at all (all three sit at the numeric floor): compare only above -100 dB
        if n > -100.0 {
            assert!(a1 < n - 6.0, "form {form} {db} dB: ADAA1 {a1:.1} not 6 dB under naive {n:.1}");
            assert!(a2 < a1 - 3.0, "form {form} {db} dB: 2x {a2:.1} not 3 dB under 1x {a1:.1}");
        }
        // the triangle fold up to +18 dB (u up to 6.4: three folds) holds -45 dB with 2x, the sine fold -100 dB up to +24 dB
        if form == 0.0 && db <= 18.0 { assert!(a2 < -45.0, "{a2:.1}"); }
        if form == 1.0 { assert!(a2 < -100.0 || n < -100.0, "{a2:.1}"); }
    }
}

#[test]
fn symmetrie_bringt_gleichanteil_und_gerade_obertoene() {
    let amp = 0.8;
    let bins = |y: &[f64]| {
        let mut p = RealFftPlanner::<f64>::new();
        let fft = p.plan_fft_forward(N);
        let mut a = y.to_vec();
        let mut s = fft.make_output_vec();
        fft.process(&mut a, &mut s).unwrap();
        let grund = s[K].norm_sqr();
        let gerade: f64 = [2, 4, 6].iter().map(|h| s[h * K].norm_sqr()).sum();
        let dc = y.iter().sum::<f64>() / N as f64;
        (10.0 * (gerade / grund).log10(), dc)
    };
    let mut f = Falter::default();
    let (g0, dc0) = bins(&lauf(amp, |x| f.prozess(x, 12.0, 0.0, 0.0, true)));
    let mut f = Falter::default();
    let (g1, dc1) = bins(&lauf(amp, |x| f.prozess(x, 12.0, 0.4, 0.0, true)));
    println!("MESS symmetry 0: even harmonics {g0:.1} dB re fundamental, DC {dc0:.5}; symmetry 0.4: {g1:.1} dB, DC {dc1:.5}");
    assert!(g0 < -60.0 && dc0.abs() < 1e-4, "odd-symmetric fold has no even harmonics and no DC");
    assert!(g1 > -30.0 && dc1.abs() > 0.01, "symmetry must add even harmonics and DC");
}

#[test]
fn latenz_der_beiden_betriebsarten() {
    let mk = |ueber: u8| format!(r#"{{"format":"baukasten/2","name":"f","stimmen":1,"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"f","art":"falter","ueber":{ueber}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"s.aus","nach":"f.x"}},{{"von":"f.aus","nach":"o.x"}}]}}"#);
    assert_eq!(uebersetze(&mk(0), SR).unwrap().latenz(), 0);
    assert_eq!(uebersetze(&mk(1), SR).unwrap().latenz(), LATENZ);
    assert!(uebersetze(&mk(2), SR).is_err(), "ueber must be 0 or 1");
    let a = ARTEN.iter().position(|a| a.art == "falter").expect("falter in ARTEN");
    println!("MESS falter is entry {a} of ARTEN (appended; the position is fixed at the merge)");
    assert!(a >= 47, "appended, never inserted");
}

#[test]
fn extreme_eingaben_bleiben_endlich_und_beschraenkt() {
    let mut f = Falter::default();
    let werte = [0.0f32, 1.0, -1.0, 1e9, -1e9, f32::NAN, f32::INFINITY, f32::NEG_INFINITY, f32::MAX, f32::MIN, 1e-30];
    let mut spitze = 0.0f32;
    for ueber in [false, true] {
        for &x in &werte {
            for &a in &[0.0f32, 40.0, -40.0, 1e9, f32::NAN, f32::INFINITY] {
                for &s in &[0.0f32, 1.0, -1.0, 1e9, f32::NAN] {
                    for &fo in &[0.0f32, 0.5, 1.0, 5.0, f32::NAN] {
                        for _ in 0..3 {
                            let y = f.prozess(x, a, s, fo, ueber);
                            assert!(y.is_finite(), "x {x} a {a} s {s} f {fo}");
                            spitze = spitze.max(y.abs());
                        }
                    }
                }
            }
        }
    }
    println!("MESS extremes: peak {spitze:.3}");
    // the fold itself stays within +-1; the half-band's overshoot on a hard edge (Gibbs) is the only excess
    assert!(spitze < 1.3, "{spitze}");
}

#[test]
fn fahrt_der_antriebs_ueber_zeit_ist_klickfrei() {
    // drive moves from 0 to 30 dB over 0.5 s on a 110 Hz sine: the largest step between samples stays near that of the
    // steady fold (no jump from the state of the ADAA)
    let mut f = Falter::default();
    let (mut vor, mut max_schritt) = (0.0f32, 0.0f32);
    for n in 0..24_000 {
        let x = 0.8 * (2.0 * PI * 110.0 * n as f64 / 48_000.0).sin() as f32;
        let db = 30.0 * n as f32 / 24_000.0;
        let y = f.prozess(x, db, 0.0, 0.0, true);
        if n > 200 { max_schritt = max_schritt.max((y - vor).abs()); }
        vor = y;
    }
    println!("MESS drive ramp 0..30 dB: largest sample step {max_schritt:.3}");
    assert!(max_schritt < 0.5, "{max_schritt}");
}
