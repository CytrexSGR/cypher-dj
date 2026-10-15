//! Aliasing und Höhen (Entwurf „3 ja“, FMS-Pilot 2026-10-15): bandbegrenzte Säge mit 75 Perioden in N = 65536
//! (≈ 50,5 Hz bei 44,1 kHz), Drive 10 (20 dB). Gemessen wird im eingeschwungenen Block, periodisch, ohne Fenster.
//! Alias = Energie unter 16 kHz außerhalb der Vielfachen von Bin 75, bezogen auf die Energie der Harmonischen.
use eq_dsp::ueberabtastung::{Hoch, Runter, LATENZ};
use saett_dsp::{Adaa1, Einstellung, Saett};
use std::f64::consts::PI;

const FS: f64 = 44100.0;
const N: usize = 65536;
const K: usize = 75;

fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut b = n >> 1;
        while j & b != 0 {
            j ^= b;
            b >>= 1;
        }
        j |= b;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let w = -2.0 * PI / len as f64;
        for s in (0..n).step_by(len) {
            for k in 0..len / 2 {
                let (c, si) = ((w * k as f64).cos(), (w * k as f64).sin());
                let (a, b) = (s + k, s + k + len / 2);
                let (tr, ti) = (re[b] * c - im[b] * si, re[b] * si + im[b] * c);
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
        len <<= 1;
    }
}

fn saege(n: usize) -> f64 {
    // Summe der Harmonischen unter Nyquist, Amplitude 1/h, normiert auf Spitze ≈ 1
    let mut s = 0.0;
    let mut h = 1;
    while h * K < N / 2 {
        s += (2.0 * PI * (h * K * n) as f64 / N as f64).sin() / h as f64;
        h += 1;
    }
    s * 2.0 / PI
}

fn alias_db(y: &[f64]) -> f64 {
    let (mut re, mut im) = (y.to_vec(), vec![0.0; N]);
    fft(&mut re, &mut im);
    let grenze = (16000.0 / FS * N as f64) as usize;
    let (mut sig, mut ali) = (0.0, 0.0);
    for b in 1..grenze {
        let p = re[b] * re[b] + im[b] * im[b];
        if b % K == 0 { sig += p } else { ali += p }
    }
    10.0 * (ali / sig).log10()
}

/// Kette über 3N Samples, die letzten N zurück.
fn lauf(mut f: impl FnMut(f64) -> f64) -> Vec<f64> {
    let x: Vec<f64> = (0..N).map(saege).collect();
    let mut y = Vec::with_capacity(N);
    for r in 0..3 {
        for &v in &x {
            let o = f(v);
            if r == 2 {
                y.push(o);
            }
        }
    }
    y
}

const DRIVE: f64 = 10.0;

#[test]
fn adaa1_mit_2x_unter_minus_60_db() {
    let mut s = Saett::neu(FS);
    s.setze(&Einstellung { drive_db: 20.0, ausgang_db: 0.0, mix: 1.0 });
    s.leeren();
    let y = lauf(|v| {
        let (mut l, mut r) = ([v as f32], [v as f32]);
        s.block(&mut l, &mut r);
        l[0] as f64
    });
    let a = alias_db(&y);
    println!("ADAA1 2x (Saett): {a:.1} dB");
    assert!(a < -60.0, "{a:.1} dB");
}

#[test]
fn negativ_kontrolle_adaa1_1x_und_naiv_2x_reissen() {
    let mut a = Adaa1::default();
    let y1 = lauf(|v| a.verarbeite(DRIVE * v));
    let a1 = alias_db(&y1);
    let (mut h, mut r) = (Hoch::neu(), Runter::neu());
    let y2 = lauf(|v| {
        let [p, q] = h.verarbeite(DRIVE * v);
        r.verarbeite([p.tanh(), q.tanh()])
    });
    let n2 = alias_db(&y2);
    println!("ADAA1 1x: {a1:.1} dB, tanh naiv 2x: {n2:.1} dB");
    assert!(a1 > -60.0, "ADAA1 1x hält −60 dB schon: dann reicht die billigere Variante ({a1:.1} dB)");
    assert!(n2 > -60.0, "naives 2x hält −60 dB schon: dann bringt ADAA nichts ({n2:.1} dB)");
}

#[test]
fn hoehen_bleiben_bei_kleinem_pegel() {
    // 10 kHz, Amplitude 1e-3, Drive 10: lineare Zone; Pegel gegen Drive·Eingang nach der Latenz
    let mut s = Saett::neu(FS);
    s.setze(&Einstellung { drive_db: 20.0, ausgang_db: 0.0, mix: 1.0 });
    s.leeren();
    let n = 44100;
    let mut aus = Vec::with_capacity(n);
    for i in 0..n {
        let v = 1e-3 * (2.0 * PI * 10000.0 * i as f64 / FS).sin();
        let (mut l, mut r) = ([v as f32], [v as f32]);
        s.block(&mut l, &mut r);
        aus.push(l[0] as f64);
    }
    let eff = |x: &[f64]| (x.iter().map(|v| v * v).sum::<f64>() / x.len() as f64).sqrt();
    let pegel = 20.0 * (eff(&aus[n / 2..]) / (DRIVE * 1e-3 / 2f64.sqrt())).log10();
    println!("10 kHz: {pegel:.2} dB, Latenz {} Samples", s.latenz());
    assert!(pegel > -1.0, "{pegel:.2} dB");
    assert_eq!(s.latenz(), LATENZ);
}

#[test]
fn mix_null_ist_verzoegert_bitgleich() {
    let mut s = Saett::neu(FS);
    s.setze(&Einstellung { drive_db: 20.0, ausgang_db: 0.0, mix: 0.0 });
    s.leeren();
    let x: Vec<f32> = (0..2000).map(|i| ((i as f32) * 0.37).sin() * 0.9).collect();
    let (mut l, mut r) = (x.clone(), x.clone());
    s.block(&mut l, &mut r);
    for i in LATENZ..2000 {
        assert_eq!(l[i], x[i - LATENZ], "i = {i}");
    }
}
