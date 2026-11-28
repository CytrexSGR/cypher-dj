//! The two short half-band stages of the pool clipper (strand 13, D7): 2x -> 4x -> 8x and back.
//!
//! Each stage is a linear-phase half-band FIR of length `2m + 1` (`m` odd), Kaiser window, designed once at construction.
//! Polyphase like `eq_dsp::ueberabtastung`: of the `2m + 1` taps only the `m + 1` even ones and the centre (0.5) are non-zero,
//! and the even ones are summed as folded pairs. An up/down pair delays by `m` samples of the stage's LOWER rate.
//!
//! Band edges: the first stage (69 taps, `eq_dsp`) passes up to 0.4535 fs and stops from 0.5465 fs of the base rate fs. The
//! content entering the second stage therefore lies below 0.5465 fs = 0.137 of its output rate (4 fs), so its images start
//! at 0.363; the third stage sees 0.068 and images from 0.432. Going down, every stage kills what would fold into the band
//! the following stages pass, so the whole chain holds the first stage's 100 dB.
//!
//! No allocation anywhere: fixed arrays sized for the largest stage, the stage length is a runtime value.

use std::f64::consts::PI;

/// Largest supported number of folded pairs (`(m + 1) / 2`).
const PAARE_MAX: usize = 8;
/// Largest supported number of even taps (`m + 1`).
const GERADE_MAX: usize = 2 * PAARE_MAX;
/// Length of the odd-phase ring of `Runter` (holds at least `(m - 1) / 2 + 2` values).
const UNGERADE_MAX: usize = PAARE_MAX + 2;

/// Second stage (2x -> 4x): `m` = 15, 31 taps, Kaiser beta 10.5 (stopband from 0.3634: about -102 dB).
pub const STUFE2_M: usize = 15;
pub const STUFE2_BETA: f64 = 10.5;
/// Third stage (4x -> 8x): `m` = 13, 27 taps, Kaiser beta 11 (stopband from 0.4317: about -110 dB).
pub const STUFE3_M: usize = 13;
pub const STUFE3_BETA: f64 = 11.0;

fn bessel_i0(x: f64) -> f64 {
    let (mut summe, mut term, mut k) = (1.0, 1.0, 1.0);
    while term > 1e-14 * summe {
        term *= (x / (2.0 * k)).powi(2);
        summe += term;
        k += 1.0;
    }
    summe
}

/// Half-band kernel: the first half of the even taps `h[2i]`, `i < (m + 1) / 2` (the second half mirrors it). The sum
/// of all even taps is 0.5, the centre is 0.5, so the DC gain is exactly 1.
#[derive(Clone, Copy, Debug)]
pub struct Kern {
    h: [f64; PAARE_MAX],
    m: usize,
}

impl Kern {
    /// `m` odd, `(m + 1) / 2 <= 8`. Panics otherwise (construction only).
    pub fn neu(m: usize, beta: f64) -> Kern {
        assert!(m % 2 == 1 && m.div_ceil(2) <= PAARE_MAX, "half-band m = {m}");
        let laenge = (2 * m) as f64;
        let mut h = [0.0; PAARE_MAX];
        for (i, hi) in h.iter_mut().take(m.div_ceil(2)).enumerate() {
            let n = 2 * i;
            let x = n as f64 - m as f64; // odd, never 0
            let sinc = (PI * x / 2.0).sin() / (PI * x);
            let r = 2.0 * n as f64 / laenge - 1.0;
            *hi = sinc * bessel_i0(beta * (1.0 - r * r).max(0.0).sqrt()) / bessel_i0(beta);
        }
        let summe: f64 = 2.0 * h.iter().sum::<f64>();
        for hi in h.iter_mut() {
            *hi *= 0.5 / summe;
        }
        Kern { h, m }
    }
    pub fn m(&self) -> usize {
        self.m
    }
    fn paare(&self) -> usize {
        self.m.div_ceil(2)
    }
    fn gerade(&self) -> usize {
        self.m + 1
    }
    /// All `2m + 1` taps (tests and the response check).
    pub fn alle_taps(&self) -> Vec<f64> {
        let g = self.gerade();
        let mut t = vec![0.0; 2 * self.m + 1];
        for i in 0..g {
            let j = if i < self.paare() { i } else { g - 1 - i };
            t[2 * i] = self.h[j];
        }
        t[self.m] = 0.5;
        t
    }
    /// Folded sum over a window `s` (`s[0]` newest, `m + 1` values).
    #[inline(always)]
    fn mac(&self, s: &[f64]) -> f64 {
        let g = self.gerade();
        let mut a = 0.0;
        for i in 0..self.paare() {
            a += self.h[i] * (s[i] + s[g - 1 - i]);
        }
        a
    }
}

/// History of the last `n` values as a doubled linear buffer, `[0]` newest (like `Verlauf2` in `eq_dsp`).
#[derive(Clone, Copy, Debug)]
struct Ring {
    buf: [f64; 2 * GERADE_MAX],
    pos: usize,
    n: usize,
}

impl Ring {
    fn neu(n: usize) -> Ring {
        Ring { buf: [0.0; 2 * GERADE_MAX], pos: 0, n }
    }
    #[inline(always)]
    fn schiebe(&mut self, v: f64) {
        self.pos = if self.pos == 0 { self.n - 1 } else { self.pos - 1 };
        self.buf[self.pos] = v;
        self.buf[self.pos + self.n] = v;
    }
    #[inline(always)]
    fn fenster(&self) -> &[f64] {
        &self.buf[self.pos..self.pos + self.n]
    }
}

/// One half-band interpolator: one sample in, two at the double rate out.
#[derive(Clone, Copy, Debug)]
pub struct Hoch {
    k: Kern,
    v: Ring,
}

impl Hoch {
    pub fn neu(k: Kern) -> Hoch {
        Hoch { k, v: Ring::neu(k.gerade()) }
    }
    pub fn reset(&mut self) {
        self.v = Ring::neu(self.k.gerade());
    }
    #[inline]
    pub fn verarbeite(&mut self, x: f64) -> [f64; 2] {
        self.v.schiebe(x);
        let w = self.v.fenster();
        [2.0 * self.k.mac(w), w[(self.k.m - 1) / 2]]
    }
}

/// One half-band decimator: two samples at the double rate in, one out.
#[derive(Clone, Copy, Debug)]
pub struct Runter {
    k: Kern,
    gerade: Ring,
    ungerade: [f64; UNGERADE_MAX],
    upos: usize,
}

impl Runter {
    pub fn neu(k: Kern) -> Runter {
        Runter { k, gerade: Ring::neu(k.gerade()), ungerade: [0.0; UNGERADE_MAX], upos: 0 }
    }
    pub fn reset(&mut self) {
        *self = Runter::neu(self.k);
    }
    #[inline]
    pub fn verarbeite(&mut self, v: [f64; 2]) -> f64 {
        self.gerade.schiebe(v[0]);
        let a = self.k.mac(self.gerade.fenster());
        self.upos = (self.upos + 1) % UNGERADE_MAX;
        self.ungerade[self.upos] = v[1];
        let d = (self.k.m - 1) / 2 + 1;
        a + 0.5 * self.ungerade[(self.upos + UNGERADE_MAX - d) % UNGERADE_MAX]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn betrag_db(t: &[f64], f: f64) -> f64 {
        let (mut re, mut im) = (0.0, 0.0);
        for (n, v) in t.iter().enumerate() {
            re += v * (2.0 * PI * f * n as f64).cos();
            im -= v * (2.0 * PI * f * n as f64).sin();
        }
        10.0 * (re * re + im * im).log10()
    }

    /// Stopband from `0.5 - durchlass` of the stage's output rate: at least 100 dB down; passband ripple below 0.001 dB.
    #[test]
    fn sperrband_mindestens_100_db() {
        for (m, beta, durchlass) in [(STUFE2_M, STUFE2_BETA, 0.5465 / 4.0), (STUFE3_M, STUFE3_BETA, 0.5465 / 8.0)] {
            let t = Kern::neu(m, beta).alle_taps();
            let sperr = (0..=2000).map(|i| 0.5 - durchlass + i as f64 / 2000.0 * durchlass).map(|f| betrag_db(&t, f)).fold(f64::MIN, f64::max);
            let welle = (0..=2000).map(|i| i as f64 / 2000.0 * durchlass).map(|f| betrag_db(&t, f).abs()).fold(0.0, f64::max);
            println!("m = {m}: stopband {sperr:.1} dB, passband ripple {welle:.6} dB");
            assert!(sperr < -100.0, "m = {m}: {sperr:.1} dB");
            assert!(welle < 1e-3, "m = {m}: {welle} dB");
        }
    }

    /// Up then down is a delay of `m` lower-rate samples (to within the ripple) for a slow sine.
    #[test]
    fn hin_und_zurueck_verzoegert_um_m() {
        for (m, beta) in [(STUFE2_M, STUFE2_BETA), (STUFE3_M, STUFE3_BETA)] {
            let k = Kern::neu(m, beta);
            let (mut h, mut r) = (Hoch::neu(k), Runter::neu(k));
            let x: Vec<f64> = (0..400).map(|n| (2.0 * PI * 0.01 * n as f64).sin()).collect();
            let y: Vec<f64> = x.iter().map(|&v| r.verarbeite(h.verarbeite(v))).collect();
            for n in 100..400 {
                assert!((y[n] - x[n - m]).abs() < 1e-4, "m = {m}, n = {n}: {} vs {}", y[n], x[n - m]);
            }
        }
    }
}
