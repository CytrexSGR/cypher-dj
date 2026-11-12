//! Wavefolder (`falter`), per voice. Not the envelope follower (`folger`).
//!
//! Signal: `u = x * g + symmetrie`, `g = 10^(antrieb / 20)`, `y = fold(u)`. The fold is a morph between two curves of period 4
//! in `u` that both reach exactly +-1 at `u = +-1`:
//!  * triangle (`form` 0): `u` up to 1, then mirrored back (`2 - u`), mirrored again at -1 and so on, any number of stages;
//!    a hard-edged, bright fold,
//!  * sine (`form` 1): `sin(pi/2 * u)`, the smooth fold of the West-coast designs; small-signal gain pi/2.
//!
//! `y = (1 - form) * tri(u) + form * sin(pi/2 * u)`; `form` may move at audio rate. At `antrieb` 0 dB, `symmetrie` 0 and `form` 0 the block is the identity
//! for |x| <= 1: a signal that stays inside the first stage passes untouched, so the knob starts from "off".
//! `symmetrie` shifts the signal inside the fold (even harmonics, and DC that follows the signal level: follow with a
//! high-pass).
//!
//! **Alias suppression.** First-order antiderivative anti-aliasing (ADAA1, Parker/Esqueda/Bilbao 2016, the same scheme as
//! `saett_dsp::Adaa1`): `y[n] = (F(u[n]) - F(u[n-1])) / (u[n] - u[n-1])` with `F` the antiderivative of the fold. Both
//! antiderivatives are closed forms and periodic (the folds have zero mean over a period), so the numerics stay clean for any
//! drive: triangle `F(t) = t^2/2` on [0,1], `2t - t^2/2 - 1` on [1,3], `(t-4)^2/2` on [3,4] with `t = u mod 4` (the fold is odd,
//! so `F` is even and periodic); sine `F(u) = 2/pi (1 - cos(pi/2 u))`. Below `EPS` step the quotient falls back to the fold of
//! the mean of the two samples. With `ueber` 1 (default) the ADAA runs at twice the rate between the half-band filters of
//! `eq_dsp::ueberabtastung` (latency `LATENZ` samples, reported to the graph); with 0 it runs at the base rate without latency
//! (the first-order scheme itself delays the neutral setting by half a sample: ADAA1 of the identity is the mean of two samples).
//! Measured numbers: `tests/falter.rs` and `GERAET-falter.md`.
//!
//! No allocation, no state that decays toward zero. A non-finite input reads 0, a non-finite control reads its neutral value
//! (`antrieb` 0 dB, `symmetrie` 0, `form` 0).
use eq_dsp::ueberabtastung::{Hoch, Runter, LATENZ as HALBBAND_LATENZ};
use std::f64::consts::PI;

/// Latency of the oversampled mode in base samples.
pub const LATENZ: usize = HALBBAND_LATENZ;
pub const ANTRIEB_MIN_DB: f32 = -40.0;
pub const ANTRIEB_MAX_DB: f32 = 40.0;
pub const SYMMETRIE_MAX: f32 = 1.0;
/// Step below which the ADAA quotient is replaced by the fold of the mean.
pub const EPS: f64 = 1e-7;

/// Triangle fold, period 4, +-1 at u = +-1.
#[inline]
pub fn dreieck(u: f64) -> f64 {
    let t = (u + 1.0).rem_euclid(4.0) - 1.0; // [-1, 3)
    if t <= 1.0 { t } else { 2.0 - t }
}

/// Antiderivative of `dreieck` with F(0) = 0; even and periodic with period 4.
#[inline]
pub fn dreieck_f1(u: f64) -> f64 {
    let t = u.rem_euclid(4.0);
    if t < 1.0 {
        0.5 * t * t
    } else if t < 3.0 {
        2.0 * t - 0.5 * t * t - 1.0
    } else {
        0.5 * (t - 4.0) * (t - 4.0)
    }
}

#[inline]
pub fn sinus(u: f64) -> f64 { (0.5 * PI * u).sin() }

/// Antiderivative of `sinus` with F(0) = 0.
#[inline]
pub fn sinus_f1(u: f64) -> f64 { (2.0 / PI) * (1.0 - (0.5 * PI * u).cos()) }

/// ADAA1 of the fold, one channel. Both curves keep their own previous antiderivative value, so `form` may move at audio
/// rate: the result is the blend of two exact first-order quotients, each bounded by 1 (a single stored value of the blended
/// antiderivative would divide a mismatch by a tiny step whenever `form` changes between two samples).
#[derive(Clone, Copy, Debug, Default)]
pub struct Adaa {
    up: f64,
    ft: f64,
    fs: f64,
}

impl Adaa {
    #[inline]
    pub fn verarbeite(&mut self, u: f64, form: f64) -> f64 {
        let (ft, fs) = (dreieck_f1(u), sinus_f1(u));
        let d = u - self.up;
        let (yt, ys) = if d.abs() > EPS {
            ((ft - self.ft) / d, (fs - self.fs) / d)
        } else {
            let m = 0.5 * (u + self.up);
            (dreieck(m), sinus(m))
        };
        self.up = u;
        self.ft = ft;
        self.fs = fs;
        (1.0 - form) * yt + form * ys
    }
}

/// One voice of the folder.
#[derive(Clone)]
pub struct Falter {
    hoch: Hoch,
    runter: Runter,
    adaa: Adaa,
}

impl Default for Falter {
    fn default() -> Self { Falter { hoch: Hoch::neu(), runter: Runter::neu(), adaa: Adaa::default() } }
}

#[inline]
fn endlich(x: f32, neutral: f32) -> f32 { if x.is_finite() { x } else { neutral } }

impl Falter {
    pub fn zuruecksetzen(&mut self) { *self = Falter::default(); }

    /// One sample. `antrieb` in dB (clamped -40..40), `symmetrie` -1..1, `form` 0..1, `ueber` true = 2x oversampled.
    #[inline]
    pub fn prozess(&mut self, x: f32, antrieb: f32, symmetrie: f32, form: f32, ueber: bool) -> f32 {
        let x = endlich(x, 0.0) as f64;
        let g = 10f64.powf(endlich(antrieb, 0.0).clamp(ANTRIEB_MIN_DB, ANTRIEB_MAX_DB) as f64 / 20.0);
        let s = endlich(symmetrie, 0.0).clamp(-SYMMETRIE_MAX, SYMMETRIE_MAX) as f64;
        let f = endlich(form, 0.0).clamp(0.0, 1.0) as f64;
        let y = if ueber {
            let [a, b] = self.hoch.verarbeite(x);
            let ya = self.adaa.verarbeite(a * g + s, f);
            let yb = self.adaa.verarbeite(b * g + s, f);
            self.runter.verarbeite([ya, yb])
        } else {
            self.adaa.verarbeite(x * g + s, f)
        };
        if y.is_finite() { y as f32 } else { 0.0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stammfunktion_ist_das_integral() {
        // F' = fold, checked with a central difference over several periods and both curves
        for k in 0..400 {
            let u = -9.013 + k as f64 * 0.0451; // off the kinks at odd integers, where a central difference is only O(h)
            let h = 1e-5;
            let d = (dreieck_f1(u + h) - dreieck_f1(u - h)) / (2.0 * h);
            assert!((d - dreieck(u)).abs() < 1e-6, "tri {u}: {d} vs {}", dreieck(u));
            let d = (sinus_f1(u + h) - sinus_f1(u - h)) / (2.0 * h);
            assert!((d - sinus(u)).abs() < 1e-6, "sin {u}");
        }
    }

    #[test]
    fn dreieck_faltet_in_stufen() {
        let w = [(0.0, 0.0), (0.5, 0.5), (1.0, 1.0), (1.5, 0.5), (2.0, 0.0), (3.0, -1.0), (3.5, -0.5), (4.0, 0.0), (-1.5, -0.5), (5.0, 1.0)];
        for (u, y) in w {
            assert!((dreieck(u) - y).abs() < 1e-12, "{u}: {}", dreieck(u));
        }
    }
}
