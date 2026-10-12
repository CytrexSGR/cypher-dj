//! Doppelte Abtastrate mit linearphasigem Halbband-FIR (Kaiser-Fenster, ~100 dB Sperrdämpfung).
//!
//! Durchlass bis 0,4535·fs (20 kHz bei 44,1 kHz), Sperrband ab 0,5465·fs. Polyphasig: von den
//! 139 Taps sind nur die 70 geraden plus die Mitte ungleich null. Hin und zurück zusammen
//! verzögern um `LATENZ` Basis-Samples.

use std::f64::consts::PI;

/// Mittelindex des Halbbands (ungerade). Länge = 2·MITTE + 1.
const MITTE: usize = 69;
/// Anzahl der geraden Taps h[0], h[2], …, h[2·MITTE] (alle ≠ 0, beide Seiten der Mitte).
const GERADE: usize = MITTE + 1; // 70
/// Gesamtlatenz Hin + Zurück in Basis-Samples.
pub const LATENZ: usize = MITTE;

fn bessel_i0(x: f64) -> f64 {
    let (mut summe, mut term, mut k) = (1.0, 1.0, 1.0);
    while term > 1e-14 * summe {
        term *= (x / (2.0 * k)).powi(2);
        summe += term;
        k += 1.0;
    }
    summe
}

/// Gerade Taps h[2j], j = 0..GERADE (symmetrisch um MITTE).
fn gerade_taps() -> [f64; GERADE] {
    let beta = 0.1102 * (100.0 - 8.7);
    let laenge = (2 * MITTE) as f64;
    let mut h = [0.0; GERADE];
    for (j, hj) in h.iter_mut().enumerate() {
        let n = 2 * j;
        let x = n as f64 - MITTE as f64; // ungerade, ≠ 0
        let sinc = (PI * x / 2.0).sin() / (PI * x / 2.0);
        let r = 2.0 * n as f64 / laenge - 1.0;
        let fenster = bessel_i0(beta * (1.0 - r * r).max(0.0).sqrt()) / bessel_i0(beta);
        *hj = 0.5 * sinc * fenster;
    }
    // Gleichanteil exakt 1 je Phase: Σ gerade Taps = 0,5
    let summe: f64 = h.iter().sum();
    for hj in h.iter_mut() {
        *hj *= 0.5 / summe;
    }
    h
}

/// Ringpuffer fester Länge.
#[derive(Clone)]
struct Verlauf<const N: usize> {
    x: [f64; N],
    pos: usize,
}

impl<const N: usize> Verlauf<N> {
    fn neu() -> Self {
        Verlauf { x: [0.0; N], pos: 0 }
    }
    fn schiebe(&mut self, v: f64) {
        self.pos = (self.pos + 1) % N;
        self.x[self.pos] = v;
    }
    /// Wert vor `d` Schritten (0 = neuester).
    fn vor(&self, d: usize) -> f64 {
        self.x[(self.pos + N - d) % N]
    }
}

#[derive(Clone)]
pub struct Hoch {
    h: [f64; GERADE],
    v: Verlauf<GERADE>,
}

impl Hoch {
    pub fn neu() -> Self {
        Hoch { h: gerade_taps(), v: Verlauf::neu() }
    }
    pub fn reset(&mut self) {
        self.v = Verlauf::neu();
    }
    /// Ein Basis-Sample rein, zwei Samples mit doppelter Rate raus.
    pub fn verarbeite(&mut self, x: f64) -> [f64; 2] {
        self.v.schiebe(x);
        let mut a = 0.0;
        for j in 0..GERADE {
            a += self.h[j] * self.v.vor(j);
        }
        [2.0 * a, self.v.vor(MITTE / 2)]
    }
}

#[derive(Clone)]
pub struct Runter {
    h: [f64; GERADE],
    gerade: Verlauf<GERADE>,
    ungerade: Verlauf<{ MITTE / 2 + 2 }>,
}

impl Runter {
    pub fn neu() -> Self {
        Runter { h: gerade_taps(), gerade: Verlauf::neu(), ungerade: Verlauf::neu() }
    }
    pub fn reset(&mut self) {
        self.gerade = Verlauf::neu();
        self.ungerade = Verlauf::neu();
    }
    /// Zwei Samples mit doppelter Rate rein, ein Basis-Sample raus.
    pub fn verarbeite(&mut self, v: [f64; 2]) -> f64 {
        self.gerade.schiebe(v[0]);
        self.ungerade.schiebe(v[1]);
        let mut a = 0.0;
        for j in 0..GERADE {
            a += self.h[j] * self.gerade.vor(j);
        }
        a + 0.5 * self.ungerade.vor(MITTE / 2 + 1)
    }
}
