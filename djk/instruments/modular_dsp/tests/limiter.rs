//! Limiter (Slice 4c, D1): Decke ohne Überschwinger, Latenz N − 1, leises Signal unverändert, Stereo gekoppelt,
//! Release, Zurücksetzen. Jeder Test hat eine Mutation, die ihn rot macht (mutation.py, Gruppe T1).
use baukasten_dsp::limiter::{vorlauf, Limiter};
use std::f64::consts::PI;

const SR: f32 = 48_000.0;

fn sinus(db: f64, hz: f64, n: usize) -> Vec<f32> {
    (0..n).map(|i| (10f64.powf(db / 20.0) * (2.0 * PI * hz * i as f64 / SR as f64).sin()) as f32).collect()
}

#[test]
fn dirac_auf_sinus_bleibt_unter_der_decke() {
    // Testsignal der Probe (limiter_probe.py): −15-dB-Sinus 8 kHz, ein Dirac 1,0 in der Mitte; Decke −10 dB
    let decke = 10f32.powf(-10.0 / 20.0);
    for n in [24usize, 96, 240] {
        let mut x = sinus(-15.0, 8_000.0, 4_800);
        x[2_400] = 1.0;
        let mut lim = Limiter::neu(-10.0, n, 50.0, SR);
        let spitze = x.iter().map(|&v| lim.prozess(v, v).0.abs()).fold(0.0f32, f32::max);
        println!("MESS Limiter N {n}: Spitze {spitze:.6}, Decke {decke:.6} (Probe 0,316228)");
        assert!(spitze <= decke * (1.0 + 1e-6), "N {n}: Spitze {spitze} über der Decke {decke}");
        assert!(spitze >= decke * (1.0 - 1e-5), "N {n}: der Dirac muss genau die Decke erreichen, {spitze}");
    }
}

#[test]
fn leises_signal_kommt_unveraendert_nach_der_latenz() {
    let mut lim = Limiter::neu(-1.0, vorlauf(2.0, SR), 60.0, SR);
    assert_eq!(lim.latenz(), 95, "2 ms bei 48 kHz = 96 Samples Vorlauf, Latenz 95");
    let x = sinus(-30.0, 440.0, 4_800);
    for (i, &v) in x.iter().enumerate() {
        let soll = if i >= 95 { x[i - 95] } else { 0.0 };
        assert_eq!(lim.prozess(v, -v), (soll, -soll), "Sample {i}");
    }
}

#[test]
fn stereo_gekoppelt_eine_laute_seite_senkt_beide() {
    // die laute Seite wechselt: ein Limiter, der nur eine Seite misst, fällt in je einem der beiden Fälle durch
    let g = 10f32.powf(-6.0 / 20.0);
    for (a, b) in [(1.0f32, 0.1f32), (0.1, 1.0)] {
        let mut lim = Limiter::neu(-6.0, 24, 60.0, SR);
        let mut y = (0.0, 0.0);
        for _ in 0..1_000 {
            y = lim.prozess(a, b);
        }
        assert!((y.0 - a * g).abs() < 1e-6 && (y.1 - b * g).abs() < 1e-6, "({a}, {b}): {y:?} statt ({}, {})", a * g, b * g);
    }
}

#[test]
fn release_bremst_das_wiederansteigen() {
    // ein Schlag 1,0, danach 0,1 (unter der Decke −6 dB): Samples bis die Verstärkung wieder auf 1 − 1e-3 steht
    let erholt = |rel_ms: f32| {
        let mut lim = Limiter::neu(-6.0, 24, rel_ms, SR);
        for i in 0..200_000 {
            let (y, _) = lim.prozess(if i == 0 { 1.0 } else { 0.1 }, 0.0);
            if i > 100 && (y - 0.1).abs() < 1e-4 {
                return i;
            }
        }
        usize::MAX
    };
    let (kurz, lang) = (erholt(1.0), erholt(100.0));
    println!("MESS Erholung nach dem Schlag: release 1 ms {kurz} Samples, 100 ms {lang} Samples");
    assert!((320..350).contains(&kurz), "release 1 ms (τ 48, ln 500 ≈ 6,2 τ, dazu Vorlauf): {kurz}");
    assert!((28_400..31_300).contains(&lang), "release 100 ms (τ 4800, ln 500 ≈ 6,2 τ): {lang}");
}

#[test]
fn zuruecksetzen_gleich_frisch() {
    // Vorgeschichte: sehr laut (Verstärkung ≈ 0,09 in allen Ringen). Probe: 40 leise Samples, danach Rauschen. Wer Release-Zustand,
    // Verstärkungsring, Mittelwertring oder Summe nicht zurücksetzt, liefert schon in den leisen Samples andere Werte.
    let laut = |lim: &mut Limiter| { for i in 0..20_000 { let x = if i % 2 == 0 { 8.0 } else { -8.0 }; lim.prozess(x, 0.5 * x); } };
    let probe = |lim: &mut Limiter| -> Vec<(f32, f32)> {
        (0..20_000).map(|i| { let x = if i < 40 { 0.1 } else { ((i * 7919) % 101) as f32 / 50.0 - 1.0 }; lim.prozess(x, 0.5 * x) }).collect()
    };
    let mut frisch = Limiter::neu(-3.0, 96, 30.0, SR);
    let mut benutzt = Limiter::neu(-3.0, 96, 30.0, SR);
    laut(&mut benutzt);
    benutzt.zuruecksetzen();
    assert_eq!(probe(&mut frisch), probe(&mut benutzt));
}

#[test]
fn gain_aendert_sich_hoechstens_um_ein_nter_der_tiefe_je_sample() {
    // Das gleitende Mittel ist der Grund für Box N: ohne es springt die Verstärkung in einem Sample von 1 auf die Decke.
    // Konstantes Signal 0,05 mit einem Schlag 1,0, Decke −10 dB: |Δv| ≤ (1 − Decke) / N, und der Schritt wird auch erreicht.
    let decke = 10f32.powf(-10.0 / 20.0);
    for n in [24usize, 96, 240] {
        let mut x = vec![0.05f32; 4_800];
        x[2_400] = 1.0;
        let mut lim = Limiter::neu(-10.0, n, 50.0, SR);
        let v: Vec<f32> = x.iter().enumerate().map(|(i, _)| {
            let y = lim.prozess(x[i], x[i]).0;
            if i >= n - 1 { y / x[i + 1 - n] } else { 1.0 }
        }).collect();
        let schritt = v.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
        let soll = (1.0 - decke) / n as f32;
        println!("MESS Limiter N {n}: größter Gain-Schritt {schritt:.6}, (1 − Decke)/N {soll:.6}");
        assert!(schritt <= soll * 1.001, "N {n}: Schritt {schritt} über {soll}");
        assert!(schritt >= soll * 0.95, "N {n}: der Schritt wird nicht erreicht, {schritt}");
    }
}

#[test]
fn vorlauf_rundet() {
    assert_eq!((vorlauf(2.0, SR), vorlauf(0.5, SR), vorlauf(0.7, SR), vorlauf(0.0, SR)), (96, 24, 34, 1));
}
