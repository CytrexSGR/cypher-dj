//! The static transfer curve that the saturator face draws. Golden table `tests/data/saett_kennlinie.csv` (header `drive_db,out_db,mix,x,y`), read by this
//! test and by the page test `djk/ui/tests/face_sat.test.mjs`. The table is generated from this file (`schreibe_tabelle`, ignored), never typed by hand.
//! The formula is the one in `lib.rs`: wet path tanh(drive * x) scaled by the output gain, mixed against the dry path.
use saett_dsp::{Einstellung, Saett};
use std::fmt::Write as _;

const DATEI: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/data/saett_kennlinie.csv");

fn db(v: f64) -> f64 {
    10f64.powf(v / 20.0)
}

/// Steady-state output for a constant input x.
fn formel(x: f64, drive_db: f64, out_db: f64, mix: f64) -> f64 {
    x + mix * (db(out_db) * (db(drive_db) * x).tanh() - x)
}

fn zeilen() -> Vec<[f64; 5]> {
    let mut z = Vec::new();
    for &d in &[0.0, 12.0, 36.0] {
        for &o in &[-24.0, -6.0, 12.0] {
            for &m in &[0.0, 0.5, 1.0] {
                for &x in &[-1.0, -0.5, -0.1, 0.0, 0.1, 0.5, 1.0] {
                    z.push([d, o, m, x, formel(x, d, o, m)]);
                }
            }
        }
    }
    z
}

#[test]
#[ignore = "writes the golden table; run once with --ignored"]
fn schreibe_tabelle() {
    let mut s = String::from("drive_db,out_db,mix,x,y\n");
    for r in zeilen() {
        writeln!(s, "{},{},{},{},{:.12}", r[0], r[1], r[2], r[3], r[4]).unwrap();
    }
    std::fs::write(DATEI, s).unwrap();
}

fn tabelle() -> Vec<[f64; 5]> {
    let text = std::fs::read_to_string(DATEI).expect("golden table");
    let mut it = text.lines();
    assert_eq!(it.next().unwrap(), "drive_db,out_db,mix,x,y");
    it.filter(|l| !l.is_empty())
        .map(|l| {
            let v: Vec<f64> = l.split(',').map(|t| t.parse().unwrap()).collect();
            [v[0], v[1], v[2], v[3], v[4]]
        })
        .collect()
}

#[test]
fn tabelle_entspricht_der_formel() {
    let t = tabelle();
    assert!(t.len() >= 20, "only {} rows", t.len());
    for r in &t {
        assert!((formel(r[3], r[0], r[1], r[2]) - r[4]).abs() < 1e-9, "row {r:?}");
    }
}

#[test]
fn dsp_im_beharrungszustand_folgt_der_tabelle() {
    for r in tabelle() {
        let mut s = Saett::neu(48000.0);
        s.setze(&Einstellung { drive_db: r[0], ausgang_db: r[1], mix: r[2] });
        s.leeren();
        let mut l = vec![r[3] as f32; 20000];
        let mut rr = l.clone();
        s.block(&mut l, &mut rr);
        let letzt = *l.last().unwrap() as f64;
        assert!((letzt - r[4]).abs() < 0.01, "row {r:?}: DSP gives {letzt}");
        assert_eq!(l.last(), rr.last());
    }
}
