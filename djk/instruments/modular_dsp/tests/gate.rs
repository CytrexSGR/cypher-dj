//! Gate (Slice 4c, D5): Schwelle, Hysterese, Tiefe, attack/release, Zurücksetzen. Jeder Test hat eine Mutation (T2).
use baukasten_dsp::gate::Gate;
use std::f64::consts::PI;

const SR: f32 = 48_000.0;

/// 1-kHz-Sinus mit Spitze `db` dBFS
fn sinus(db: f64, n: usize) -> Vec<f32> {
    (0..n).map(|i| (10f64.powf(db / 20.0) * (2.0 * PI * 1_000.0 * i as f64 / SR as f64).sin()) as f32).collect()
}

fn lauf(g: &mut Gate, x: &[f32]) -> Vec<f32> {
    x.iter().map(|&v| g.prozess(v, v).0).collect()
}

/// Verhältnis der Spitzen über die letzten 4800 Samples
fn verhaeltnis(x: &[f32], y: &[f32]) -> f32 {
    let s = |v: &[f32]| v[v.len() - 4_800..].iter().fold(0.0f32, |m, a| m.max(a.abs()));
    s(y) / s(x)
}

#[test]
fn oeffnet_ueber_der_schwelle_und_bleibt_darunter_zu() {
    for (db, offen) in [(-49.0, true), (-51.0, false), (-20.0, true), (-70.0, false)] {
        let mut g = Gate::neu(-50.0, 6.0, 80.0, 1.0, 100.0, SR);
        let x = sinus(db, 48_000);
        let v = verhaeltnis(&x, &lauf(&mut g, &x));
        println!("MESS Gate bei {db} dB: offen {}, Verhältnis {v:.3e}", g.offen());
        assert_eq!(g.offen(), offen, "{db} dB");
        let (soll, tol) = if offen { (1.0, 1e-3) } else { (1e-4, 1e-6) };
        assert!((v - soll).abs() < tol, "{db} dB: Verhältnis {v} statt {soll}");
    }
}

#[test]
fn hysterese_haelt_offen_bis_unter_schwelle_minus_hyst() {
    let mut g = Gate::neu(-50.0, 6.0, 80.0, 1.0, 100.0, SR);
    lauf(&mut g, &sinus(-40.0, 24_000));
    assert!(g.offen(), "−40 dB öffnet");
    lauf(&mut g, &sinus(-53.0, 48_000));
    assert!(g.offen(), "−53 dB liegt über −56 dB: bleibt offen");
    lauf(&mut g, &sinus(-57.0, 48_000));
    assert!(!g.offen(), "−57 dB liegt unter −56 dB: schließt");
}

#[test]
fn attack_und_release_sind_zeitkonstanten() {
    // Gleichsignal 0,5 öffnet sofort; nach 480 Schritten (attack 10 ms) steht die Verstärkung bei 1 − (1 − tief)/e
    let mut g = Gate::neu(-50.0, 6.0, 80.0, 10.0, 200.0, SR);
    let y: Vec<f32> = (0..48_000).map(|_| g.prozess(0.5, 0.5).0).collect();
    let att = y[479] / 0.5;
    // Stille: die Hüllkurve fällt mit 10 ms von 0,5 unter −56 dB (≈ 480·ln(315) = 2762 Samples), dann release 200 ms
    let (mut zu, mut rel) = (None, 0.0f32);
    for i in 0..96_000 {
        g.prozess(0.0, 0.0);
        if zu.is_none() && !g.offen() {
            zu = Some(i);
        }
        if zu.map_or(false, |t| i == t + 9_599) {
            rel = g.verstaerkung();
            break;
        }
    }
    let zu = zu.expect("Gate schließt in Stille");
    println!("MESS Gate: nach attack {att:.4}, schließt nach {zu} Samples Stille, nach release {rel:.4}");
    assert!((att - 0.6322).abs() < 1e-3, "attack: {att}");
    assert!((2_700..2_830).contains(&zu), "schließt bei {zu}");
    assert!((rel - 0.3679).abs() < 1e-3, "release: {rel}");
}

#[test]
fn zuruecksetzen_gleich_frisch() {
    // Vorgeschichte endet offen und laut. Probe: Gleichwert −54 dBFS vom ersten Sample an, in der Hysterese-Zone (zwischen −56 und −50): ein frisches Gate
    // bleibt zu; ein Gate, das offen, mit Hüllkurve oder mit Verstärkung 1 stehenbleibt, liefert andere Werte.
    let lauf = |g: &mut Gate, x: &[f32]| -> Vec<(f32, f32)> { x.iter().map(|&v| g.prozess(v, -v)).collect() };
    let (laut, probe) = (sinus(-20.0, 24_000), vec![10f32.powf(-54.0 / 20.0); 24_000]);
    let mut frisch = Gate::neu(-50.0, 6.0, 60.0, 2.0, 50.0, SR);
    let mut benutzt = Gate::neu(-50.0, 6.0, 60.0, 2.0, 50.0, SR);
    lauf(&mut benutzt, &laut);
    assert!(benutzt.offen(), "die Vorgeschichte muss offen enden");
    benutzt.zuruecksetzen();
    assert_eq!(lauf(&mut frisch, &probe), lauf(&mut benutzt, &probe));
    assert!(!frisch.offen(), "die Probe liegt in der Hysterese-Zone und darf ein frisches Gate nicht öffnen");
}

#[test]
fn stereo_gekoppelt_und_beide_seiten_geformt() {
    // offen: die laute Seite öffnet beide, in beiden Anordnungen; zu: beide Seiten werden abgesenkt (tiefe 80 dB = 1e-4)
    for (a, b) in [(0.5f32, 0.0f32), (0.0, 0.5)] {
        let mut g = Gate::neu(-50.0, 6.0, 80.0, 1.0, 100.0, SR);
        let mut y = (0.0, 0.0);
        for _ in 0..4_800 {
            y = g.prozess(a, b);
        }
        assert!(g.offen() && (y.0 - a).abs() < 1e-3 && (y.1 - b).abs() < 1e-3, "({a}, {b}): {y:?}");
    }
    let mut g = Gate::neu(-50.0, 6.0, 80.0, 1.0, 100.0, SR);
    let mut y = (0.0, 0.0);
    for _ in 0..4_800 {
        y = g.prozess(0.001, 0.0005);
    }
    assert!(!g.offen() && y.0 < 2e-7 && y.1 < 1e-7, "zu: {y:?}");
}

#[test]
fn unendlich_oeffnet_nicht_fuer_immer() {
    let mut g = Gate::neu(-50.0, 6.0, 80.0, 1.0, 100.0, SR);
    g.prozess(f32::INFINITY, 0.0);
    for _ in 0..48_000 {
        g.prozess(0.0, 0.0);
    }
    assert!(!g.offen() && g.huelle() == 0.0, "offen {}, Hüllkurve {}", g.offen(), g.huelle());
}

#[test]
fn stille_laesst_keine_denormale_huellkurve() {
    let mut g = Gate::neu(-50.0, 6.0, 80.0, 1.0, 100.0, SR);
    g.prozess(1.0, 1.0);
    for _ in 0..48_000 {
        g.prozess(0.0, 0.0);
    }
    assert_eq!(g.huelle(), 0.0, "nach 1 s Stille ist die Hüllkurve exakt 0 (D11)");
}
