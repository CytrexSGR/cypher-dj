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
fn dsp_im_beharrungszustand_gleichanteil_wird_gesperrt() {
    for r in tabelle() {
        let mut s = Saett::neu(48000.0);
        s.setze(&Einstellung { drive_db: r[0], ausgang_db: r[1], mix: r[2] });
        s.leeren();
        let mut l = vec![r[3] as f32; 20000];
        let mut rr = l.clone();
        s.block(&mut l, &mut rr);
        let letzt = *l.last().unwrap() as f64;
        // Since the DC blocker at the wet output (5 Hz) a constant input leaves only its dry share; the wet share of the
        // table row (the curve itself, checked in `tabelle_entspricht_der_formel` and the sine tests) decays to 0.
        let soll = (1.0 - r[2]) * r[3];
        assert!((letzt - soll).abs() < 0.01, "row {r:?}: DSP gives {letzt}, expected the dry share {soll}");
        assert_eq!(l.last(), rr.last());
    }
}

/// Amplitude of the fundamental (200 Hz, 240 samples per period at 48 kHz) of `v`, over whole periods.
fn grundton(v: &[f64]) -> f64 {
    let w = 2.0 * std::f64::consts::PI / 240.0;
    let (c, s) = v.iter().enumerate().fold((0.0, 0.0), |(c, s), (i, x)| (c + x * (w * i as f64).cos(), s + x * (w * i as f64).sin()));
    2.0 * (c * c + s * s).sqrt() / v.len() as f64
}

/// The wet curve of `Saett::block` against the formula, surviving the DC blocker: sines of 200 Hz (far above the 5 Hz corner) at amplitudes across the
/// curve, mix 1, settled; the fundamental of the output equals the fundamental of out * tanh(drive * sine) within 0.1 dB (a 3 % gain error is 0.26 dB).
#[test]
fn dsp_sinus_grundton_folgt_der_kennlinie() {
    let fs = 48000.0;
    let w = 2.0 * std::f64::consts::PI * 200.0 / fs;
    for &(drive, out) in &[(0.0, -6.0), (12.0, -6.0), (24.0, -12.0), (36.0, 0.0)] {
        for &amp in &[0.01, 0.05, 0.2, 0.5, 0.9] {
            let mut s = Saett::neu(fs);
            s.setze(&Einstellung { drive_db: drive, ausgang_db: out, mix: 1.0 });
            s.leeren();
            let n = 48000usize;
            let mut l: Vec<f32> = (0..n).map(|i| (amp * (w * i as f64).sin()) as f32).collect();
            let mut r = l.clone();
            s.block(&mut l, &mut r);
            let ist = grundton(&l[n / 2..].iter().map(|v| *v as f64).collect::<Vec<_>>());
            let ideal: Vec<f64> = (0..n / 2).map(|i| formel(amp * (w * i as f64).sin(), drive, out, 1.0)).collect();
            let soll = grundton(&ideal);
            let abw_db = 20.0 * (ist / soll).log10();
            assert!(abw_db.abs() < 0.1, "drive {drive}, out {out}, amp {amp}: fundamental {ist}, curve {soll} ({abw_db:.3} dB)");
        }
    }
}
