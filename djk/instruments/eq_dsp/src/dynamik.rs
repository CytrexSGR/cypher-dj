//! Dynamic EQ bands: a detector on the stage input (or an external key) drives the band's gain.
//!
//! Per dynamic band: a detection filter (Bell: band-pass at freq/Q, Low shelf: 2nd-order low-pass, High shelf:
//! 2nd-order high-pass), a peak envelope with the stage's attack/release, and a fixed 3:1 slope:
//! above: `d = max(0, L - T)`, below: `d = max(0, T - L)`, `D = sign(range) * min(|range|, d * 2/3)`.
//! Everything runs at base rate, sample by sample, without allocation.

use crate::band::{BandArt, Kanal};
use std::f64::consts::PI;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DynModus {
    Aus,
    Ueber,
    Unter,
    UeberSchluessel,
    UnterSchluessel,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Dynamik {
    pub modus: DynModus,
    pub schwelle_db: f64,
    pub bereich_db: f64,
}

impl Default for Dynamik {
    fn default() -> Self {
        Dynamik { modus: DynModus::Aus, schwelle_db: -30.0, bereich_db: 0.0 }
    }
}

impl Dynamik {
    pub fn ueber(&self) -> bool {
        matches!(self.modus, DynModus::Ueber | DynModus::UeberSchluessel)
    }
    pub fn schluessel(&self) -> bool {
        matches!(self.modus, DynModus::UeberSchluessel | DynModus::UnterSchluessel)
    }
}

pub const ATTACK_MIN_MS: f64 = 0.1;
pub const ATTACK_MAX_MS: f64 = 100.0;
pub const RELEASE_MIN_MS: f64 = 5.0;
pub const RELEASE_MAX_MS: f64 = 1000.0;
pub const ATTACK_STANDARD_MS: f64 = 5.0;
pub const RELEASE_STANDARD_MS: f64 = 80.0;
/// Fixed slope: the band moves 2 dB per 3 dB the level is past the threshold.
const STEIGUNG: f64 = 2.0 / 3.0;
const PEGEL_BODEN_DB: f64 = -120.0;

/// Does the band type take part in dynamics (others ignore `dyn`)?
pub fn art_dynamisch(a: BandArt) -> bool {
    matches!(a, BandArt::Glocke | BandArt::LowShelf | BandArt::HighShelf)
}

#[derive(Clone, Copy, Default)]
struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

#[derive(Clone, Copy, Default)]
struct Zustand {
    z1: f64,
    z2: f64,
}

impl Zustand {
    #[inline]
    fn tick(&mut self, c: &Biquad, x: f64) -> f64 {
        let y = c.b0 * x + self.z1;
        self.z1 = c.b1 * x - c.a1 * y + self.z2;
        self.z2 = c.b2 * x - c.a2 * y;
        y
    }
}

fn entwirf_detektor(art: BandArt, freq: f64, q: f64, fs: f64) -> Biquad {
    let f = freq.clamp(10.0, 0.45 * fs);
    let w0 = 2.0 * PI * f / fs;
    let (sw, cw) = w0.sin_cos();
    let (b0, b1, b2, q) = match art {
        BandArt::Glocke => {
            let q = q.clamp(0.1, 18.0);
            let al = sw / (2.0 * q);
            (al, 0.0, -al, q)
        }
        BandArt::LowShelf => ((1.0 - cw) / 2.0, 1.0 - cw, (1.0 - cw) / 2.0, std::f64::consts::FRAC_1_SQRT_2),
        _ => ((1.0 + cw) / 2.0, -(1.0 + cw), (1.0 + cw) / 2.0, std::f64::consts::FRAC_1_SQRT_2),
    };
    let al = sw / (2.0 * q);
    let a0 = 1.0 + al;
    Biquad { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: -2.0 * cw / a0, a2: (1.0 - al) / a0 }
}

/// Detector state of one band.
#[derive(Clone)]
pub struct Detektor {
    koeff: Biquad,
    /// Design key (art, freq, q) of `koeff`.
    schluessel: Option<(BandArt, f64, f64)>,
    z: [Zustand; 2],
    huell: f64,
    /// Current dynamic change in dB.
    pub d_db: f64,
    /// Signed value of the largest |D| since the last read.
    pub max_db: f64,
}

impl Default for Detektor {
    fn default() -> Self {
        Detektor { koeff: Biquad::default(), schluessel: None, z: [Zustand::default(); 2], huell: 0.0, d_db: 0.0, max_db: 0.0 }
    }
}

impl Detektor {
    /// Re-design the detection filter when the band's type/freq/Q changed (once per block, not per sample).
    pub fn vorbereite(&mut self, art: BandArt, freq: f64, q: f64, fs: f64) {
        let k = (art, freq, q);
        if self.schluessel != Some(k) {
            self.schluessel = Some(k);
            self.koeff = entwirf_detektor(art, freq, q, fs);
            self.z = [Zustand::default(); 2];
        }
    }

    pub fn ruhe(&mut self) {
        self.z = [Zustand::default(); 2];
        self.huell = 0.0;
        self.d_db = 0.0;
    }

    /// One base-rate sample of the detection signal `(l, r)`; returns the new D in dB.
    #[inline]
    pub fn schritt(&mut self, dy: &Dynamik, kanal: Kanal, l: f64, r: f64, stereo: bool, att: f64, rel: f64) -> f64 {
        let pegel = if !stereo {
            self.z[0].tick(&self.koeff, l).abs()
        } else {
            match kanal {
                Kanal::Stereo => {
                    let a = self.z[0].tick(&self.koeff, l).abs();
                    let b = self.z[1].tick(&self.koeff, r).abs();
                    a.max(b)
                }
                Kanal::Mid => self.z[0].tick(&self.koeff, 0.5 * (l + r)).abs(),
                Kanal::Side => self.z[0].tick(&self.koeff, 0.5 * (l - r)).abs(),
            }
        };
        let c = if pegel > self.huell { att } else { rel };
        self.huell += c * (pegel - self.huell);
        if self.huell < 1e-30 {
            self.huell = 0.0;
        }
        let l_db = if self.huell > 1e-6 { 20.0 * self.huell.log10() } else { PEGEL_BODEN_DB };
        let d = if dy.ueber() { (l_db - dy.schwelle_db).max(0.0) } else { (dy.schwelle_db - l_db).max(0.0) };
        let b = dy.bereich_db;
        let dd = b.signum() * b.abs().min(d * STEIGUNG);
        let dd = if b == 0.0 { 0.0 } else { dd };
        self.d_db = dd;
        if dd.abs() > self.max_db.abs() {
            self.max_db = dd;
        }
        dd
    }
}

/// One-pole coefficient for a time in ms at base rate `fs`.
pub fn koeffizient(ms: f64, fs: f64) -> f64 {
    1.0 - (-1.0 / (0.001 * ms * fs)).exp()
}
