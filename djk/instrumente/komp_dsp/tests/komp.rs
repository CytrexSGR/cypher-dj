//! Cypher Komp: Kennlinie (Giannoulis Gl. 4) und Block am Sinus.
use komp_dsp::{gain_computer, Einstellung, Komp};

#[test]
fn kennlinie_unter_ueber_und_im_knie() {
    // T −20, R 4, W 10
    assert_eq!(gain_computer(-40.0, -20.0, 4.0, 10.0), -40.0); // unter dem Knie: unverändert
    assert!((gain_computer(0.0, -20.0, 4.0, 10.0) - (-15.0)).abs() < 1e-9); // −20 + 20/4
    // Knie: an beiden Rändern stetig
    assert!((gain_computer(-25.0, -20.0, 4.0, 10.0) - (-25.0)).abs() < 1e-9);
    assert!((gain_computer(-15.0, -20.0, 4.0, 10.0) - (-20.0 + 5.0 / 4.0)).abs() < 1e-9);
    // Mitte des Knies: x + (1/R − 1)(W/2)²/(2W) = −20 − 0,75·25/20
    assert!((gain_computer(-20.0, -20.0, 4.0, 10.0) - (-20.0 - 0.9375)).abs() < 1e-9);
}

#[test]
fn hartes_knie_bei_w_null() {
    assert_eq!(gain_computer(-21.0, -20.0, 4.0, 0.0), -21.0);
    assert!((gain_computer(-16.0, -20.0, 4.0, 0.0) - (-19.0)).abs() < 1e-9);
}

fn sinus(db: f64, n: usize) -> Vec<f32> {
    let a = 10f64.powf(db / 20.0);
    (0..n).map(|i| (a * (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / 48000.0).sin()) as f32).collect()
}
fn spitze_db(x: &[f32]) -> f64 {
    20.0 * (x.iter().fold(0f32, |m, v| m.max(v.abs())).max(1e-9) as f64).log10()
}

#[test]
fn statische_kennlinie_am_sinus() {
    // Release lang gegen die Periode (1 ms): die Absenkung steht nach 0,5 s, gemessen wird die Spitze der letzten 0,1 s
    let e = Einstellung { schwelle_db: -20.0, ratio: 4.0, knie_db: 0.0, attack_ms: 1.0, release_ms: 200.0, makeup_db: 0.0, mix: 1.0, sc_hochpass_hz: 0.0 };
    for ein_db in [-40.0, -20.0, -10.0, 0.0] {
        let mut k = Komp::neu(48000.0);
        k.setze(&e);
        let mut l = sinus(ein_db, 48000);
        let mut r = l.clone();
        k.block(&mut l, &mut r, None);
        let soll = gain_computer(ein_db, -20.0, 4.0, 0.0);
        let ist = spitze_db(&l[43200..]);
        assert!((ist - soll).abs() < 0.3, "ein {ein_db}: {ist} statt {soll}");
    }
}

#[test]
fn makeup_hebt_um_seinen_wert() {
    let e = Einstellung { schwelle_db: -20.0, ratio: 4.0, knie_db: 0.0, attack_ms: 1.0, release_ms: 200.0, makeup_db: 6.0, mix: 1.0, sc_hochpass_hz: 0.0 };
    let mut k = Komp::neu(48000.0);
    k.setze(&e);
    let mut l = sinus(-40.0, 48000);
    let mut r = l.clone();
    k.block(&mut l, &mut r, None);
    assert!((spitze_db(&l[43200..]) - (-34.0)).abs() < 0.1);
}

#[test]
fn mix_null_ist_bitgleich_trocken() {
    let e = Einstellung { schwelle_db: -40.0, ratio: 10.0, knie_db: 6.0, attack_ms: 1.0, release_ms: 100.0, makeup_db: 6.0, mix: 0.0, sc_hochpass_hz: 0.0 };
    let mut k = Komp::neu(48000.0);
    k.setze(&e);
    let x = sinus(-6.0, 4800);
    let (mut l, mut r) = (x.clone(), x.clone());
    k.block(&mut l, &mut r, None);
    assert_eq!(l, x);
    assert_eq!(r, x);
}

#[test]
fn gr_anzeige_zeigt_die_absenkung() {
    let e = Einstellung { schwelle_db: -20.0, ratio: 4.0, knie_db: 0.0, attack_ms: 1.0, release_ms: 200.0, makeup_db: 0.0, mix: 1.0, sc_hochpass_hz: 0.0 };
    let mut k = Komp::neu(48000.0);
    k.setze(&e);
    let mut l = sinus(0.0, 48000);
    let mut r = l.clone();
    k.block(&mut l, &mut r, None);
    assert!((k.gr_db() - 15.0).abs() < 0.3, "gr {}", k.gr_db()); // 0 dB → −15 dB: 15 dB Absenkung
}
