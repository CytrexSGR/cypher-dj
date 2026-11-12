//! Envelope follower (`folger`): attack and release times against a step, level for a full-scale sine, a drum-like burst
//! train, robustness. The block sits in an effect graph (`eingang.l -> folger.x -> ausgang`), driven with `setze_eingang`.
use baukasten_dsp::{folger::Folger, uebersetze, Fehler, Programm};

const SR: f32 = 48_000.0;

fn lade(werte: &str) -> Programm {
    let g = format!(
        r#"{{"format":"baukasten/2","name":"f","stimmen":1,"knoten":[{{"id":"e","art":"eingang"}},{{"id":"f","art":"folger"{werte}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"e.l","nach":"f.x"}},{{"von":"f.aus","nach":"o.x"}}]}}"#
    );
    uebersetze(&g, SR).unwrap_or_else(|e| panic!("{werte}: {e:?}"))
}

fn lauf(p: &mut Programm, n: usize, x: impl Fn(usize) -> f32) -> Vec<f32> {
    (0..n).map(|i| {
        let v = x(i);
        p.setze_eingang(v, v);
        p.sample_stereo().0
    }).collect()
}

/// index of the first sample at or above `ziel` (rising) or at or below it (falling)
fn erste(y: &[f32], ziel: f32, steigend: bool) -> usize {
    y.iter().position(|v| if steigend { *v >= ziel } else { *v <= ziel }).expect("never reached")
}

#[test]
fn attack_time_constant_against_a_step() {
    for (an_ms, soll) in [(1.0f32, 48.0f64), (10.0, 480.0), (50.0, 2400.0)] {
        let mut p = lade(&format!(r#","an":{an_ms},"ab":500"#));
        let y = lauf(&mut p, 20_000, |i| if i >= 100 { 1.0 } else { 0.0 });
        let n = erste(&y[100..], 1.0 - (-1.0f32).exp(), true) as f64 + 1.0;
        println!("MESS folger attack {an_ms} ms: 63.2 % after {n} samples (expected {soll})");
        assert!((n - soll).abs() <= 1.0 + 0.01 * soll, "an {an_ms}: {n} vs {soll}");
        assert!(y[100..].iter().all(|v| *v <= 1.0), "no overshoot");
    }
}

#[test]
fn release_time_constant_against_a_step() {
    for (ab_ms, soll) in [(10.0f32, 480.0f64), (50.0, 2400.0), (200.0, 9600.0)] {
        let mut p = lade(&format!(r#","an":0.1,"ab":{ab_ms}"#));
        let y = lauf(&mut p, 60_000, |i| if i < 5000 { 1.0 } else { 0.0 });
        assert!(y[4999] > 0.999, "settled at the full level first: {}", y[4999]);
        let n = erste(&y[5000..], (-1.0f32).exp() * y[4999], false) as f64 + 1.0;
        println!("MESS folger release {ab_ms} ms: 1/e after {n} samples (expected {soll})");
        assert!((n - soll).abs() <= 1.0 + 0.01 * soll, "ab {ab_ms}: {n} vs {soll}");
        assert!(y[5000..].windows(2).all(|w| w[1] <= w[0]), "monotonic fall");
    }
}

#[test]
fn attack_and_release_are_independent() {
    // fast attack, slow release: the rise is quick even though the fall is slow, and vice versa
    let mut p = lade(r#","an":1,"ab":300"#);
    let y = lauf(&mut p, 40_000, |i| if (1000..3000).contains(&i) { 1.0 } else { 0.0 });
    assert!(y[1000 + 240] > 0.99, "5 attack time constants: {}", y[1240]);
    assert!(y[3000 + 480] > 0.9, "fall is slow: {}", y[3480]);
    let mut q = lade(r#","an":100,"ab":1"#);
    let y = lauf(&mut q, 40_000, |i| if (1000..30_000).contains(&i) { 1.0 } else { 0.0 });
    assert!(y[1000 + 480] < 0.1, "rise is slow: {}", y[1480]);
    assert!(y[29_999] > 0.99, "{}", y[29_999]);
    assert!(y[30_000 + 240] < 0.01, "fall is quick: {}", y[30_240]);
}

#[test]
fn full_scale_sine_reads_about_one() {
    let mut worte = Vec::new();
    for f in [60.0f64, 440.0, 5000.0] {
        let mut p = lade(r#","an":1,"ab":100"#);
        let y = lauf(&mut p, 96_000, |i| (std::f64::consts::TAU * f * i as f64 / SR as f64).sin() as f32);
        let (mn, mx) = y[48_000..].iter().fold((f32::MAX, 0.0f32), |(a, b), v| (a.min(*v), b.max(*v)));
        println!("MESS folger sine {f} Hz, an 1 ms, ab 100 ms: level {mn:.4} .. {mx:.4}");
        assert!(mx <= 1.0 + 1e-6, "{mx}");
        assert!(mn >= if f < 100.0 { 0.80 } else { 0.95 }, "{f} Hz: {mn}");
        worte.push((f, mn, mx));
    }
    // half the amplitude reads half
    let mut p = lade(r#","an":1,"ab":100"#);
    let y = lauf(&mut p, 96_000, |i| 0.5 * (std::f64::consts::TAU * 1000.0 * i as f64 / SR as f64).sin() as f32);
    let m = y[48_000..].iter().cloned().fold(f32::MAX, f32::min);
    assert!((m - 0.5 * worte[1].1).abs() < 0.01 && m > 0.45, "{m}");
    // the sign does not matter
    let mut p = lade(r#","an":1,"ab":100"#);
    let a = lauf(&mut p, 5000, |_| -0.7);
    assert!((a[4999] - 0.7).abs() < 1e-3);
}

#[test]
fn drum_burst_train_opens_and_closes() {
    // a 60 Hz burst, 40 ms long with a decaying amplitude, every 250 ms; follower an 2 ms, ab 80 ms
    let mut p = lade(r#","an":2,"ab":80"#);
    let burst = |i: usize| {
        let t = (i % 12_000) as f64 / SR as f64;
        if t < 0.04 { ((-t / 0.015).exp() * (std::f64::consts::TAU * 60.0 * t).sin()) as f32 } else { 0.0 }
    };
    let y = lauf(&mut p, 120_000, burst);
    for hit in 1..9 {
        let a = hit * 12_000;
        let spitze = y[a..a + 2400].iter().cloned().fold(0.0f32, f32::max);
        let davor = y[a - 50];
        assert!(spitze > 0.35, "hit {hit}: peak {spitze}");
        assert!(davor < 0.05, "hit {hit}: closed before the hit: {davor}");
    }
    println!("MESS folger burst train: peak after the 4th hit {:.3}", y[48_000..50_400].iter().cloned().fold(0.0f32, f32::max));
}

#[test]
fn silence_gives_exact_zero_and_odd_inputs_stay_finite() {
    let mut f = Folger::default();
    f.prozess(1.0, 1.0, 1.0, SR);
    let mut y = 1.0;
    for _ in 0..2_000_000 {
        y = f.prozess(0.0, 1.0, 1.0, SR);
    }
    assert_eq!(y, 0.0, "decays to an exact 0, never to a subnormal");
    for x in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, 1e30, -1e38, f32::MAX] {
        for (an, ab) in [(0.0, 0.0), (f32::NAN, f32::NAN), (-5.0, -5.0), (1e9, 1e9), (5.0, 100.0)] {
            let mut f = Folger::default();
            for _ in 0..100 {
                let v = f.prozess(x, an, ab, SR);
                assert!(v.is_finite() && (0.0..=1e6).contains(&v), "x {x} an {an} ab {ab}: {v}");
            }
        }
    }
    // fastest settings: a step is followed within a few samples
    let mut f = Folger::default();
    let v = f.prozess(1.0, 0.0, 0.0, SR);
    assert!(v > 0.85, "an 0 is clamped to 0.01 ms (0.48 samples): {v}");
}

#[test]
fn value_checks() {
    let fehler = |w: &str| {
        let g = format!(r#"{{"format":"baukasten/2","name":"f","stimmen":1,"knoten":[{{"id":"f","art":"folger"{w}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"f.aus","nach":"o.x"}}]}}"#);
        match uebersetze(&g, SR) {
            Err(Fehler::Wert { wert, .. }) => wert,
            r => panic!("{w}: {:?}", r.map(|_| ())),
        }
    };
    assert_eq!(fehler(r#","an":-1"#), "an");
    assert_eq!(fehler(r#","ab":10001"#), "ab");
}
