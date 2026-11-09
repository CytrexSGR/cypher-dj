//! ADAA1-Grenzfall x[n] ≈ x[n−1] (Entwurf „4 ok“, FMS-Pilot 2026-10-15): Rückfall unter EPS = 1e-5 auf tanh
//! des Mittelwerts. Referenz ist der exakte ADAA1-Wert = Mittelwert von tanh über [x_vorher, x], per
//! Gauß-Legendre (8 Punkte) gerechnet; damit hängt die Referenz nicht am Differenzenquotienten selbst.
use saett_dsp::{f1, Adaa1, EPS};

fn mittel_tanh(a: f64, b: f64) -> f64 {
    if a == b {
        return a.tanh();
    }
    const X: [f64; 4] = [0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363];
    const W: [f64; 4] = [0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];
    let (m, h) = (0.5 * (a + b), 0.5 * (b - a));
    let mut s = 0.0;
    for i in 0..4 {
        s += W[i] * ((m + h * X[i]).tanh() + (m - h * X[i]).tanh());
    }
    0.5 * s
}

fn schritt(xp: f64, x: f64) -> f64 {
    let mut a = Adaa1::default();
    a.verarbeite(xp);
    a.verarbeite(x)
}

#[test]
fn f1_ist_ln_cosh_und_laeuft_nicht_ueber() {
    for x in [-3.0f64, -0.5, 0.0, 0.7, 4.0] {
        assert!((f1(x) - x.cosh().ln()).abs() < 1e-14, "x = {x}");
    }
    // ln(cosh 800) läuft in der naiven Form über (cosh = inf), F1 nicht
    assert!(800f64.cosh().is_infinite(), "Positivkontrolle: die naive Form läuft über");
    assert!((f1(800.0) - (800.0 - std::f64::consts::LN_2)).abs() < 1e-9);
}

#[test]
fn gleichspannung_kein_nan() {
    // Δ = 0 exakt: der Quotient wäre 0/0
    let mut a = Adaa1::default();
    let mut y = 0.0;
    for _ in 0..10 {
        y = a.verarbeite(9.0);
    }
    assert!(y.is_finite());
    assert_eq!(y, 9f64.tanh());
}

#[test]
fn rampen_nahe_null() {
    for x in [0.3, 3.0, 9.0] {
        for d in [1e-4, 1e-6, 1e-8] {
            let f = (schritt(x - d, x) - mittel_tanh(x - d, x)).abs();
            assert!(f < 1e-9, "x = {x}, Δ = {d}: Fehler {f:e}");
        }
    }
}

#[test]
fn gitter_ueber_x_und_delta() {
    // Bricht-Fall des Entwurfs: irgendwo über x ∈ [−12, 12], Δ ∈ [1e-9, 1e-1] ein Fehler über 1e-9
    let mut schlimmster = (0.0f64, 0.0, 0.0);
    for i in 0..=480 {
        let x = -12.0 + i as f64 * 0.05;
        for e in 0..=80 {
            let d = 10f64.powf(-9.0 + e as f64 * 0.1);
            for s in [d, -d] {
                let f = (schritt(x - s, x) - mittel_tanh(x - s, x)).abs();
                if f > schlimmster.0 {
                    schlimmster = (f, x, s);
                }
            }
        }
    }
    println!("schlimmster Fehler {:e} bei x = {}, Δ = {:e}", schlimmster.0, schlimmster.1, schlimmster.2);
    assert!(schlimmster.0 < 1e-9, "{schlimmster:?}");
}

#[test]
fn negativ_kontrolle_quotientenpfad() {
    // Δ = 0,1 liegt weit über EPS: der Quotient wird genommen und ist dort genau
    assert!(0.1 > EPS);
    for x in [0.3, 3.0, 9.0] {
        let f = (schritt(x - 0.1, x) - mittel_tanh(x - 0.1, x)).abs();
        println!("Quotientenpfad x = {x}: Fehler {f:e}");
        assert!(f < 1e-13, "x = {x}: {f:e}");
    }
}
