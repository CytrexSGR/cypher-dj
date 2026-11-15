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

// ---- golden table of the transfer curve (page: djk/ui/tests/face_comp.test.mjs reads the same CSV) ----------------------------------------------
// Columns: x_db,schwelle_db,ratio,knie_db,makeup_db,mix,y_db. y_db is the steady-state output level for an input level x_db:
// x + 20 log10(mix 10^((makeup - (x - gain_computer)) / 20) + 1 - mix), the block of Komp::block at rest.
const KENNLINIE_CSV: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/data/kennlinie.csv");

fn ausgang_db(x: f64, t: f64, r: f64, w: f64, makeup: f64, mix: f64) -> f64 {
    let abs = x - gain_computer(x, t, r, w);
    x + 20.0 * (mix * 10f64.powf((makeup - abs) / 20.0) + 1.0 - mix).log10()
}

#[test]
fn kennlinie_golden_tabelle() {
    let text = std::fs::read_to_string(KENNLINIE_CSV).expect("tests/data/kennlinie.csv not found: run kennlinie_golden_schreiben");
    let mut zeilen = text.lines();
    assert_eq!(zeilen.next(), Some("x_db,schwelle_db,ratio,knie_db,makeup_db,mix,y_db"));
    let mut n = 0;
    for z in zeilen {
        let v: Vec<f64> = z.split(',').map(|s| s.parse().expect("number")).collect();
        assert_eq!(v.len(), 7, "{z}");
        let (x, t, r, w, mk, mix, y) = (v[0], v[1], v[2], v[3], v[4], v[5], v[6]);
        // (a) the table equals the DSP's gain computer plus the mix formula
        assert!((ausgang_db(x, t, r, w, mk, mix) - y).abs() < 1e-9, "row {z}");
        // (b) the block itself reaches the same level on a sine (attack 1 ms, release 200 ms, 1 s, peak of the last 0.1 s)
        if x >= -50.0 {
            let e = Einstellung { schwelle_db: t, ratio: r, knie_db: w, attack_ms: 1.0, release_ms: 200.0, makeup_db: mk, mix, sc_hochpass_hz: 0.0 };
            let mut k = Komp::neu(48000.0);
            k.setze(&e);
            let mut l = sinus(x, 48000);
            let mut rr = l.clone();
            k.block(&mut l, &mut rr, None);
            let ist = spitze_db(&l[43200..]);
            assert!((ist - y).abs() < 0.3, "row {z}: block {ist} instead of {y}");
        }
        n += 1;
    }
    assert!(n >= 24, "only {n} rows");
}

/// Writes the table from the DSP functions: `cargo test -p komp_dsp --test komp kennlinie_golden_schreiben -- --ignored`. Never edited by hand.
#[test]
#[ignore]
fn kennlinie_golden_schreiben() {
    // (x, threshold, ratio, knee, makeup, mix)
    let mut fall: Vec<(f64, f64, f64, f64, f64, f64)> = Vec::new();
    for x in [-40.0, -26.0, -25.0, -20.0, -15.0, -14.0, -10.0, 0.0] { fall.push((x, -20.0, 4.0, 10.0, 0.0, 1.0)); }   // below, at t-w/2, centre, t+w/2, above
    for x in [-30.0, -20.0, -10.0, 0.0] { fall.push((x, -20.0, 4.0, 0.0, 0.0, 1.0)); }                               // hard knee
    for x in [-30.0, -10.0] { fall.push((x, -20.0, 1.0, 6.0, 0.0, 1.0)); }                                           // ratio 1
    for x in [-17.0, -10.0, 0.0] { fall.push((x, -20.0, 20.0, 6.0, 0.0, 1.0)); }                                     // ratio 20
    for x in [-30.0, -10.0] { fall.push((x, -30.0, 10.0, 6.0, 6.0, 0.0)); }                                          // mix 0: y = x
    for x in [-40.0, -10.0, -60.0] { fall.push((x, -30.0, 10.0, 0.0, 12.0, 0.4)); }                                   // makeup 12 with mix 0.4
    for x in [-60.0, -21.0, -18.0, -15.0, 0.0] { fall.push((x, -18.0, 4.0, 6.0, 0.0, 1.0)); }                         // defaults, both ends
    let mut s = String::from("x_db,schwelle_db,ratio,knie_db,makeup_db,mix,y_db\n");
    for (x, t, r, w, mk, mix) in fall { s += &format!("{x},{t},{r},{w},{mk},{mix},{}\n", ausgang_db(x, t, r, w, mk, mix)); }
    std::fs::create_dir_all(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/data")).unwrap();
    std::fs::write(KENNLINIE_CSV, s).unwrap();
}
