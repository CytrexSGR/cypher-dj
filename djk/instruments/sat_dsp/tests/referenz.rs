//! Reference harness for strand 12, saturator part: the old `saett_dsp` (frozen copy in `alt/saett.rs`, running on the
//! frozen halfband in `eq_dsp/tests/alt/ueberabtastung.rs`) against the live `Saett` on the same input. The EQ cases are in
//! `eq_dsp/tests/referenz.rs`; they sit apart because saett_dsp depends on eq_dsp (a dev-dependency back would be a cycle).
//!
//! Bound (plan 0.3, A1): max error <= -120 dB against the peak of the old output, sample-wise, 48 kHz, drive 12 dB, log sweep
//! 20 Hz..20 kHz at -6 dBFS and seeded white noise, 4 s, for every FIR path. Latency equal to the old one (69, 0 from
//! 88 kHz) and the impulse response argmax equal to the old one.
#![allow(dead_code)]

#[path = "../../eq_dsp/tests/alt/ueberabtastung.rs"]
mod alt_ueberabtastung;
#[path = "alt/saett.rs"]
mod alt_saett;

use saett_dsp::{Einstellung, Saett};
use std::f64::consts::PI;

const FIR_GRENZE_DB: f64 = -120.0;
const BLOCK: usize = 64;

/// FIR path selection; A1 adds `Skalar` (forced scalar path) and routes it into the new `Saett`.
#[derive(Clone, Copy, Debug)]
enum Pfad {
    Erkannt,
    Skalar,
}
const PFADE: [Pfad; 2] = [Pfad::Erkannt, Pfad::Skalar];

fn neu_saett(fs: f64, pfad: Pfad) -> Saett {
    match pfad {
        Pfad::Erkannt => Saett::neu(fs),
        Pfad::Skalar => Saett::mit_pfad(fs, eq_dsp::ueberabtastung::Pfad::Skalar),
    }
}

fn sweep(fs: f64, sek: f64, f0: f64, f1: f64) -> Vec<f32> {
    let n = (fs * sek) as usize;
    let k = (f1 / f0).ln();
    (0..n)
        .map(|i| {
            let t = i as f64 / fs;
            let phase = 2.0 * PI * f0 * sek / k * ((t / sek * k).exp() - 1.0);
            (10f64.powf(-6.0 / 20.0) * phase.sin()) as f32
        })
        .collect()
}

fn rauschen(fs: f64, sek: f64, seed: u64, amp: f64) -> Vec<f32> {
    let mut s = seed;
    (0..(fs * sek) as usize)
        .map(|_| {
            s ^= s >> 12;
            s ^= s << 25;
            s ^= s >> 27;
            let u = (s.wrapping_mul(0x2545F4914F6CDD1D) >> 11) as f64 / (1u64 << 53) as f64;
            (amp * (2.0 * u - 1.0)) as f32
        })
        .collect()
}

fn max_fehler_db(alt: &[f32], neu: &[f32]) -> f64 {
    assert_eq!(alt.len(), neu.len());
    let spitze = alt.iter().fold(0.0f64, |m, &x| m.max((x as f64).abs()));
    let fehler = alt.iter().zip(neu).fold(0.0f64, |m, (&a, &n)| m.max((a as f64 - n as f64).abs()));
    assert!(spitze > 0.0, "reference output is silent");
    20.0 * (fehler / spitze).log10()
}

fn lauf_alt(fs: f64, e: &Einstellung, l: &[f32], r: &[f32]) -> (Vec<f32>, Vec<f32>) {
    let mut s = alt_saett::Saett::neu(fs);
    s.setze(&alt_saett::Einstellung { drive_db: e.drive_db, ausgang_db: e.ausgang_db, mix: e.mix });
    s.leeren();
    blockweise(l, r, |a, b| s.block(a, b))
}

fn lauf_neu(fs: f64, pfad: Pfad, e: &Einstellung, l: &[f32], r: &[f32]) -> (Vec<f32>, Vec<f32>) {
    let mut s = neu_saett(fs, pfad);
    s.setze(e);
    s.leeren();
    blockweise(l, r, |a, b| s.block(a, b))
}

fn blockweise(l: &[f32], r: &[f32], mut f: impl FnMut(&mut [f32], &mut [f32])) -> (Vec<f32>, Vec<f32>) {
    let (mut l, mut r) = (l.to_vec(), r.to_vec());
    let mut start = 0;
    while start < l.len() {
        let ende = (start + BLOCK).min(l.len());
        f(&mut l[start..ende], &mut r[start..ende]);
        start = ende;
    }
    (l, r)
}

fn drive12() -> Einstellung {
    Einstellung { drive_db: 12.0, ausgang_db: -6.0, mix: 1.0, ..Einstellung::default() }
}

fn fir_fall(pfad: Pfad, l: &[f32], r: &[f32], was: &str) {
    let fs = 48000.0;
    let (la, ra) = lauf_alt(fs, &drive12(), l, r);
    let (ln, rn) = lauf_neu(fs, pfad, &drive12(), l, r);
    for (a, n, k) in [(&la, &ln, "L"), (&ra, &rn, "R")] {
        let e = max_fehler_db(a, n);
        assert!(e <= FIR_GRENZE_DB, "{was} {k} {pfad:?}: max error {e:.1} dB, bound {FIR_GRENZE_DB} dB");
    }
}

#[test]
fn fir_saett_sweep() {
    let s = sweep(48000.0, 4.0, 20.0, 20000.0);
    for p in PFADE {
        fir_fall(p, &s, &s, "saturator, sweep");
    }
}

#[test]
fn fir_saett_rauschen() {
    let (a, b) = (rauschen(48000.0, 4.0, 0xC0FFEE, 0.25), rauschen(48000.0, 4.0, 0xBEEF, 0.25));
    for p in PFADE {
        fir_fall(p, &a, &b, "saturator, noise");
    }
}

fn argmax(x: &[f32]) -> usize {
    let mut best = (0, 0.0f32);
    for (i, v) in x.iter().enumerate() {
        if v.abs() > best.1 {
            best = (i, v.abs());
        }
    }
    best.0
}

#[test]
fn latenz_und_impulsantwort_wie_alt() {
    for fs in [44100.0, 48000.0, 88200.0, 96000.0] {
        for p in PFADE {
            for mix in [1.0, 0.0] {
                let e = Einstellung { mix, ..drive12() };
                let mut a = alt_saett::Saett::neu(fs);
                a.setze(&alt_saett::Einstellung { drive_db: e.drive_db, ausgang_db: e.ausgang_db, mix: e.mix });
                a.leeren();
                let mut n = neu_saett(fs, p);
                n.setze(&e);
                n.leeren();
                assert_eq!(a.latenz(), n.latenz(), "latency at {fs}");
                assert_eq!(a.latenz(), if fs < 88000.0 { 69 } else { 0 }, "old latency constant at {fs}");
                let mut imp = vec![0.0f32; 1024];
                imp[0] = 0.5;
                let (ia, _) = blockweise(&imp, &imp, |l, r| a.block(l, r));
                let (inn, _) = blockweise(&imp, &imp, |l, r| n.block(l, r));
                assert_eq!(argmax(&ia), argmax(&inn), "impulse argmax at {fs}, mix {mix}, {p:?}");
            }
        }
    }
}

#[test]
fn harness_sieht_eine_abweichung() {
    // Stand-in for "one FIR tap scaled by 1.001" (the frozen taps are private): drive 0.05 dB off on the new side.
    let fs = 48000.0;
    let s = sweep(fs, 1.0, 20.0, 20000.0);
    let (la, _) = lauf_alt(fs, &drive12(), &s, &s);
    let (ln, _) = lauf_neu(fs, Pfad::Erkannt, &Einstellung { drive_db: 12.05, ..drive12() }, &s, &s);
    let e = max_fehler_db(&la, &ln);
    assert!(e > FIR_GRENZE_DB, "harness blind: {e:.1} dB");
}
