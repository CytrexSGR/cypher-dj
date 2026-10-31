//! Messfunktionen der Klang-Leitplanken (Slice 2b, 4a), von leitplanken.rs und leitplanken_hall.rs genutzt.
#![allow(dead_code)]
use baukasten_dsp::{uebersetze, Programm, REGLER};

const SR: f32 = 48_000.0;

/// Pegel in dBFS (Effektivwert über beide Seiten)
pub fn db(x: &[(f32, f32)]) -> f32 {
    let q: f64 = x.iter().map(|(l, r)| (*l as f64).powi(2) + (*r as f64).powi(2)).sum::<f64>() / (2 * x.len()) as f64;
    10.0 * q.max(1e-20).log10() as f32
}

pub fn spitze(x: &[(f32, f32)]) -> f32 { x.iter().fold(0.0, |m, (l, r)| m.max(l.abs()).max(r.abs())) }

/// Spektral-Flachheit 1–8 kHz der linken Seite: geometrisches durch arithmetisches Mittel der Leistung, Hann-Fenster
/// über 8192 Samples, DFT nur über die Bins des Bands. Ein Einzelton hat dort Obertöne mit Lücken dazwischen (nahe 0),
/// Rauschen füllt die Lücken (gegen 1).
pub fn flachheit(x: &[(f32, f32)]) -> f64 {
    let n = 8192;
    let pi2 = 2.0 * std::f64::consts::PI;
    let w: Vec<f64> = (0..n).map(|i| x[i].0 as f64 * (0.5 - 0.5 * (pi2 * i as f64 / n as f64).cos())).collect();
    let p: Vec<f64> = (1000 * n / 48_000..8000 * n / 48_000)
        .map(|k| {
            let dw = -pi2 * k as f64 / n as f64;
            let (c, s) = (dw.cos(), dw.sin());
            let (mut re, mut im, mut cr, mut ci) = (0.0, 0.0, 1.0f64, 0.0f64);
            for v in &w {
                re += v * cr;
                im += v * ci;
                (cr, ci) = (cr * c - ci * s, cr * s + ci * c);
            }
            (re * re + im * im).max(1e-30)
        })
        .collect();
    let geo = (p.iter().map(|v| v.ln()).sum::<f64>() / p.len() as f64).exp();
    geo / (p.iter().sum::<f64>() / p.len() as f64)
}

/// Korrelation links/rechts (Pearson ohne Mittelwert, wie analyse.py)
pub fn korrelation(x: &[(f32, f32)]) -> f64 {
    let (mut lr, mut ll, mut rr) = (0.0f64, 0.0f64, 0.0f64);
    for (l, r) in x {
        let (l, r) = (*l as f64, *r as f64);
        lr += l * r;
        ll += l * l;
        rr += r * r;
    }
    lr / (ll * rr).sqrt().max(1e-30)
}

/// Spektraler Schwerpunkt der linken Seite in Hz: Hann über 8192 Samples, DFT über 50–10 000 Hz (die Töne des
/// Akkords liegen darunter, die Obertöne bestimmen die Helligkeit)
pub fn schwerpunkt(x: &[(f32, f32)]) -> f64 {
    let n = 8192;
    let pi2 = 2.0 * std::f64::consts::PI;
    let w: Vec<f64> = (0..n).map(|i| x[i].0 as f64 * (0.5 - 0.5 * (pi2 * i as f64 / n as f64).cos())).collect();
    let (mut sf, mut s) = (0.0f64, 0.0f64);
    for k in (50 * n / 48_000)..(10_000 * n / 48_000) {
        let dw = -pi2 * k as f64 / n as f64;
        let (c, sn) = (dw.cos(), dw.sin());
        let (mut re, mut im, mut cr, mut ci) = (0.0, 0.0, 1.0f64, 0.0f64);
        for v in &w {
            re += v * cr;
            im += v * ci;
            (cr, ci) = (cr * c - ci * sn, cr * sn + ci * c);
        }
        let p = re * re + im * im;
        sf += p * k as f64 * 48_000.0 / n as f64;
        s += p;
    }
    sf / s.max(1e-30)
}

/// Noten mit Velocity 0,8, alle Knobs auf 0,5 außer `regler`, 2 s; zurück kommt die zweite Sekunde (nach dem Attack bei
/// Knob 4 auf 0,5)
pub fn spiele_graph(graph: &str, noten: &[u8], regler: &[(usize, f32)]) -> Vec<(f32, f32)> {
    let mut p: Programm = uebersetze(graph, SR).unwrap();
    for nr in 1..=REGLER {
        p.setze_regler(nr, 0.5);
    }
    for (nr, w) in regler {
        p.setze_regler(*nr, *w);
    }
    for &n in noten {
        p.note_an(n, 0.8);
    }
    let x: Vec<(f32, f32)> = (0..96_000).map(|_| p.sample_stereo()).collect();
    assert_eq!(p.rettungen, 0);
    x[48_000..].to_vec()
}
