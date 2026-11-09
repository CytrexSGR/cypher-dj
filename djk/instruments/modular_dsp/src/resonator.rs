//! Modal resonator bank (type 34, `resonator`): up to 32 tuned two-pole resonators per voice.
//!
//! **Mode sets.** Every set is computed from published physics when a graph is translated (no files, no samples). A set
//! gives, per mode, the frequency ratio to the pitch mode (ratio 1) and the mode shape over the strike position; the
//! decay of every mode follows from the material's loss factor. Sources are listed per set below and in
//! `REPORT-resonator.md`.
//!
//! | `satz` | name | ratios | strike position (p = 0 edge .. 1 centre) |
//! |---|---|---|---|
//! | 0 | stab | uniform free-free bar, Euler-Bernoulli: (beta_n / beta_1)^2, cos(x) cosh(x) = 1 | free-free shapes at x = p/2 |
//! | 1 | marimba | tuned bar 1 : 4 : 10, higher modes on the uniform bar spacing above mode 3 | as stab |
//! | 2 | glocke | tuned church bell, 12 partials (hum 0.5, prime 1, tierce 1.183, ...) | shell factor tan^(m-2)(theta/2) |
//! | 3 | glas | thin ring / wine glass, n(n^2 - 1) / sqrt(n^2 + 1), n = 2..33 | as glocke |
//! | 4 | holzblock | thick wooden free-free block, Rayleigh-Timoshenko correction for shear and rotary inertia | as stab |
//! | 5 | membran | ideal circular membrane, Bessel zeros j_mn / j_01 (conga, tom) | J_m(j_mn r) at r = 0.9 (1 - p) |
//! | 6 | platte | simply supported rectangular plate, m^2 + (a n)^2 with a = 1.3 | 2 sin(m pi x) sin(n pi y) |
//!
//! **Decay.** A constant loss factor `eta` (hysteretic damping, the usual model for wood, metal and glass) gives every mode
//! the decay time `T60 = 3 ln(10) / (pi eta f) = 2.198 / (eta f)`: higher modes die faster, in proportion to their
//! frequency. The `material` knob sets `eta = 0.1 * 10^(-4 material)` (0.1 felt-damped .. 1e-5 bell bronze), and T60 is
//! clamped to 1 ms .. 30 s (and at least 10 samples).
//!
//! **Excitation.** A rising `trig` strikes the bank with an impulse (`anregung` 0) or a decaying noise burst of `burst` ms
//! (`anregung` 1) of strength `staerke`; the audio input `x` drives the bank all the time. Each mode's input gain is its
//! mode shape at the strike position times the mallet roll-off `1 / (1 + (f / fc)^2)` (`helligkeit` sets fc from 50 Hz to
//! 25.6 kHz); the gains are normalised to unit energy, so the knobs change the timbre, not the level. The audio input is
//! scaled by `2 (1 - r)` per mode: a sine at a mode frequency comes out with the same amplitude as that mode's strike.
//!
//! **Resonator.** Each mode is a complex one-pole `z = r e^(i w)` (the coupled form of a two-pole resonator): the state is
//! rotated by `z` every sample and the output is its imaginary part, so a strike starts in sine phase (no click) and the
//! frequency is exact to f32 rounding of `r cos w` and `r sin w` at any pitch (a direct-form biquad loses several cent at
//! 40 Hz in f32). `|z| < 1` is enforced on the rounded coefficients, so the bank is stable at every setting.
//!
//! **Control rate.** Pitch (`hz`, `groesse`, `inharmonie`), `material`, `helligkeit` and `position` are read every
//! sample but the coefficients are rebuilt only every `STEUER` samples when one of them changed, and at once on a strike.
//!
//! **Real time.** `Stimme::prozess` does not allocate, lock or panic. Every `STEUER` samples, modes whose state is below
//! 1e-20 are set to zero; with `r >= 0.5` (T60 >= 10 samples) no state can reach the subnormal range in between. A voice
//! whose modes are all zero, with no burst running and no input, skips the bank.

use std::f64::consts::PI;

/// Most modes per voice.
pub const MAX_MODEN: usize = 32;
/// Names of the mode sets, index = value `satz`.
pub const SAETZE: [&str; 7] = ["stab", "marimba", "glocke", "glas", "holzblock", "membran", "platte"];
/// Points of a mode shape table over the strike position 0..1.
pub const STUETZ: usize = 257;
/// Samples between coefficient updates.
pub const STEUER: u32 = 32;
/// Loss factor at `material` 0, and the decades it falls over the knob.
pub const ETA_MAX: f64 = 0.1;
pub const ETA_DEKADEN: f64 = 4.0;
/// T60 = T60_KONST / (eta f): 3 ln(10) / pi.
pub const T60_KONST: f64 = 3.0 * std::f64::consts::LN_10 / PI;
pub const T60_MIN: f64 = 0.001;
pub const T60_MAX: f64 = 30.0;
/// Shortest decay in samples: r = 10^(-3 / 10) >= 0.5.
pub const T60_MIN_SAMPLES: f64 = 10.0;
/// Mallet roll-off: fc = HELL_MIN_HZ * 2^(HELL_OKTAVEN * helligkeit).
pub const HELL_MIN_HZ: f64 = 50.0;
pub const HELL_OKTAVEN: f64 = 9.0;
/// Modes outside F_MIN_HZ .. NYQUIST_ANTEIL * sr are switched off.
pub const F_MIN_HZ: f64 = 10.0;
pub const NYQUIST_ANTEIL: f64 = 0.45;
/// Mode states below this are set to zero (every STEUER samples).
pub const RUHE: f32 = 1e-20;
/// Input samples below this count as silence.
pub const EINGANG_RUHE: f32 = 1e-10;
/// Ranges of the knobs.
pub const GROESSE_MIN: f32 = 0.25;
pub const GROESSE_MAX: f32 = 4.0;
pub const INHARMONIE_MAX: f32 = 2.0;
pub const STAERKE_MAX: f32 = 10.0;
pub const BURST_MIN_MS: f32 = 0.5;
pub const BURST_MAX_MS: f32 = 50.0;

/// Uniform free-free bar: the n-th root (n >= 1) of cos(x) cosh(x) = 1, i.e. cos(x) = 1 / cosh(x), in (n pi, (n + 1) pi).
pub fn stab_beta(n: usize) -> f64 {
    let f = |x: f64| x.cos() - 1.0 / x.cosh();
    let (mut a, mut b) = (n as f64 * PI, (n as f64 + 1.0) * PI);
    let fa = f(a);
    for _ in 0..100 {
        let m = 0.5 * (a + b);
        if (f(m) > 0.0) == (fa > 0.0) { a = m } else { b = m }
    }
    0.5 * (a + b)
}

/// Free-free bar mode shape with root `beta` at x (0..1), not normalised. Written so that it stays exact for large beta:
/// cosh u + cos u - s (sinh u + sin u) = cos u - s sin u + ((1 - s) e^u + (1 + s) e^-u) / 2.
fn stab_form(beta: f64, x: f64) -> f64 {
    let u = beta * x;
    let d = 1.0 - (-2.0 * beta).exp() - 2.0 * (-beta).exp() * beta.sin(); // (sinh b - sin b) * 2 e^-b
    let s = 2.0 * ((beta.cosh() - beta.cos()) * (-beta).exp()) / d; // sigma
    let eins_minus_s = (beta.cos() - beta.sin() - (-beta).exp()) * 2.0 * (u - beta).exp() / d; // (1 - sigma) e^u
    u.cos() - s * u.sin() + 0.5 * (eins_minus_s + (1.0 + s) * (-u).exp())
}

/// Bessel function J_m(x) by the trapezoid rule on its periodic integral (1 / 2 pi) int cos(m t - x sin t) dt, which
/// converges exponentially (exact to rounding while x + m stays well below the 128 points; here x <= 20, m <= 15).
pub fn bessel_j(m: usize, x: f64) -> f64 {
    const N: usize = 128;
    (0..N).map(|k| {
        let t = 2.0 * PI * k as f64 / N as f64;
        (m as f64 * t - x * t.sin()).cos()
    }).sum::<f64>() / N as f64
}

/// The zeros j_mn of J_m below `bis`, by scanning and bisection.
fn bessel_nullen(m: usize, bis: f64) -> Vec<f64> {
    let mut v = Vec::new();
    let schritt = 0.05;
    let mut a = m as f64 + 0.01;
    let mut fa = bessel_j(m, a);
    while a < bis {
        let b = a + schritt;
        let fb = bessel_j(m, b);
        if (fa > 0.0) != (fb > 0.0) {
            let (mut lo, mut hi, flo) = (a, b, fa);
            for _ in 0..60 {
                let mid = 0.5 * (lo + hi);
                if (bessel_j(m, mid) > 0.0) == (flo > 0.0) { lo = mid } else { hi = mid }
            }
            v.push(0.5 * (lo + hi));
        }
        a = b;
        fa = fb;
    }
    v
}

/// Tuned church bell (12 partials relative to the prime): hum, prime, tierce, quint, nominal, deciem, undeciem, duodeciem,
/// upper octave and the next three, after Rossing & Perrin (1987), as reproduced in Fletcher & Rossing (1998), Table 21.1.
pub const GLOCKE: [f64; 12] = [0.5, 1.0, 1.183, 1.506, 2.0, 2.514, 2.662, 3.011, 4.166, 5.433, 6.796, 8.215];
/// Circumferential order m (number of nodal meridians / 2) of the bell partials, from their usual (m, n) labels.
const GLOCKE_ORDNUNG: [i32; 12] = [2, 2, 3, 3, 4, 4, 2, 5, 6, 7, 8, 9];
/// Marimba bar tuning of the first three modes (Fletcher & Rossing 1998, section 19.3; Rossing 2000, ch. 6).
pub const MARIMBA: [f64; 3] = [1.0, 4.0, 10.0];
/// Thick wooden block: height over length, and E / (kappa G) for maple along the grain (E_L / G_LR about 9, Wood Handbook
/// FPL-GTR-190 table 5-1; shear coefficient kappa = 5/6 for a rectangular section).
pub const HOLZ_H_L: f64 = 0.25;
pub const HOLZ_E_KG: f64 = 9.0 / (5.0 / 6.0);
/// Rectangular plate: Lx / Ly.
pub const PLATTE_SEITEN: f64 = 1.3;

/// Ratio of mode `n` (1-based) of the thin ring: n = 2.. gives n (n^2 - 1) / sqrt(n^2 + 1), relative to n = 2.
pub fn ring(n: usize) -> f64 {
    let f = |n: f64| n * (n * n - 1.0) / (n * n + 1.0).sqrt();
    f(n as f64) / f(2.0)
}

/// Timoshenko-corrected free-free bar mode (Rayleigh-Timoshenko approximation): frequency proportional to
/// beta^2 / sqrt(1 + beta^2 rho^2 (1 + E / kappa G)), rho = radius of gyration over length.
pub fn holz(beta: f64) -> f64 {
    let rho = HOLZ_H_L / 12f64.sqrt();
    beta * beta / (1.0 + beta * beta * rho * rho * (1.0 + HOLZ_E_KG)).sqrt()
}

/// A mode set: ratios, harmonic anchors (for `inharmonie`) and the shape table. Shared read-only by all voices of a node.
pub struct Satz {
    pub name: &'static str,
    /// modes in this set (12 for the bell, 32 for the others)
    pub n: usize,
    verh: [f64; MAX_MODEN],
    anker: [f64; MAX_MODEN],
    /// mode m at position k / (STUETZ - 1): form[m * STUETZ + k]
    form: Box<[f32]>,
}

/// Nearest harmonic (or subharmonic 1/k below 1) of a ratio: the target of `inharmonie` 0.
fn anker(r: f64) -> f64 { if r >= 1.0 { r.round().max(1.0) } else { 1.0 / (1.0 / r).round() } }

impl Satz {
    /// Builds set `nr` (index into `SAETZE`, clamped). Allocates; call it at translation, never in the audio path.
    pub fn neu(nr: usize) -> Satz {
        let nr = nr.min(SAETZE.len() - 1);
        let mut verh = [0.0f64; MAX_MODEN];
        let staebe: Vec<f64> = (1..=MAX_MODEN).map(stab_beta).collect();
        let membran = if nr == 5 { membran_moden() } else { Vec::new() };
        // shape of mode m at position p, unnormalised; normalised below to unit mean square over the body
        let mut form: Vec<Box<dyn Fn(f64) -> f64>> = Vec::new();
        let stab_formen = |form: &mut Vec<Box<dyn Fn(f64) -> f64>>| {
            for &b in &staebe {
                form.push(Box::new(move |p: f64| stab_form(b, 0.5 * p)));
            }
        };
        // shells: (m, n) modes decay toward the pole like tan^m(theta / 2) (Rayleigh's inextensional modes of a
        // hemispherical shell); theta runs from the rim (pi / 2, p = 0) up to 0.4 * pi / 2 (p = 1), relative to m = 2
        let schale = |m: i32| -> Box<dyn Fn(f64) -> f64> {
            Box::new(move |p: f64| (0.25 * PI * (1.0 - 0.6 * p)).tan().powi(m - 2))
        };
        let n = match nr {
            0 => {
                for (m, b) in staebe.iter().enumerate() {
                    verh[m] = (b / staebe[0]).powi(2);
                }
                stab_formen(&mut form);
                MAX_MODEN
            }
            1 => {
                for m in 0..MAX_MODEN {
                    verh[m] = if m < 3 { MARIMBA[m] } else { MARIMBA[2] * (staebe[m] / staebe[2]).powi(2) };
                }
                stab_formen(&mut form);
                MAX_MODEN
            }
            2 => {
                verh[..GLOCKE.len()].copy_from_slice(&GLOCKE);
                for &m in &GLOCKE_ORDNUNG {
                    form.push(schale(m));
                }
                GLOCKE.len()
            }
            3 => {
                for m in 0..MAX_MODEN {
                    verh[m] = ring(m + 2);
                    form.push(schale(m as i32 + 2));
                }
                MAX_MODEN
            }
            4 => {
                for (m, b) in staebe.iter().enumerate() {
                    verh[m] = holz(*b) / holz(staebe[0]);
                }
                stab_formen(&mut form);
                MAX_MODEN
            }
            5 => {
                for (i, &(j, m)) in membran.iter().enumerate() {
                    verh[i] = j / membran[0].0;
                    form.push(Box::new(move |p: f64| bessel_j(m, j * 0.9 * (1.0 - p))));
                }
                membran.len()
            }
            _ => {
                let mut moden: Vec<(f64, usize, usize)> = (1..=40).flat_map(|m| (1..=40).map(move |k| {
                    ((m * m) as f64 + (PLATTE_SEITEN * k as f64).powi(2), m, k)
                })).collect();
                moden.sort_by(|a, b| a.0.total_cmp(&b.0));
                for (i, &(f, m, k)) in moden.iter().take(MAX_MODEN).enumerate() {
                    verh[i] = f / moden[0].0;
                    form.push(Box::new(move |p: f64| 2.0 * (PI * m as f64 * (0.08 + 0.42 * p)).sin() * (PI * k as f64 * (0.13 + 0.37 * p)).sin()));
                }
                MAX_MODEN
            }
        };
        // normalisation of the shapes: unit mean square over the body, so that the gains of different modes compare
        let skala: Vec<f64> = (0..n).map(|m| match nr {
            // bars: mean of phi^2 over the length (x = 0..1; the table covers half of it, the shapes are (anti)symmetric)
            0 | 1 | 4 => {
                let q = 4000;
                let ms = (0..q).map(|i| stab_form(staebe[m], (i as f64 + 0.5) / q as f64).powi(2)).sum::<f64>() / q as f64;
                1.0 / ms.sqrt()
            }
            // membrane: mean square of J_m(j r) cos(m theta) over the unit disc is J_{m+1}(j)^2 (m = 0) or half of it
            5 => {
                let (j, mm) = membran[m];
                let ms = bessel_j(mm + 1, j).powi(2) * if mm == 0 { 1.0 } else { 0.5 };
                1.0 / ms.sqrt()
            }
            // plate: 2 sin sin has unit mean square; shells: relative factors only
            _ => 1.0,
        }).collect();
        let mut tabelle = vec![0.0f32; MAX_MODEN * STUETZ].into_boxed_slice();
        for m in 0..n {
            for k in 0..STUETZ {
                tabelle[m * STUETZ + k] = (form[m](k as f64 / (STUETZ - 1) as f64) * skala[m]) as f32;
            }
        }
        Satz { name: SAETZE[nr], n, verh, anker: std::array::from_fn(|m| if m < n { anker(verh[m]) } else { 0.0 }), form: tabelle }
    }

    /// Frequency ratio of mode `m` to the pitch mode, at `inharmonie` i: anchor * (ratio / anchor)^i (1 = the physical
    /// ratio, 0 = the nearest harmonic, 2 = twice the deviation in cent).
    #[inline]
    pub fn verhaeltnis(&self, m: usize, i: f64) -> f64 {
        if m >= self.n { return 0.0; }
        if i == 1.0 { self.verh[m] } else { self.anker[m] * (self.verh[m] / self.anker[m]).powf(i) }
    }

    /// Mode shape of mode `m` at strike position p (0..1), linear between the table points.
    #[inline]
    pub fn form(&self, m: usize, p: f32) -> f32 {
        let x = p.clamp(0.0, 1.0) * (STUETZ - 1) as f32;
        let i = (x as usize).min(STUETZ - 2);
        let t = x - i as f32;
        let z = &self.form[(m.min(MAX_MODEN - 1)) * STUETZ..];
        z[i] + (z[i + 1] - z[i]) * t
    }
}

/// (j_mn, m) of the 32 lowest membrane modes, ascending. All zeros below 20 of the orders 0..15 hold them (the 32nd is
/// j_3,4 = 16.22; j_16,1 = 21.1 lies above 20).
pub fn membran_moden() -> Vec<(f64, usize)> {
    let mut moden: Vec<(f64, usize)> = (0..16).flat_map(|m| bessel_nullen(m, 20.0).into_iter().map(move |j| (j, m))).collect();
    moden.sort_by(|a, b| a.0.total_cmp(&b.0));
    moden.truncate(MAX_MODEN);
    moden
}

/// Fixed values of a resonator node.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Einstellung {
    /// modes used, 1..=32 (at most the set's own count)
    pub moden: usize,
    /// 0 impulse, 1 noise burst
    pub anregung: u8,
    /// length of the noise burst to -60 dB, ms
    pub burst_ms: f32,
    /// seed of the burst noise
    pub saat: u32,
}

/// Inputs of one sample.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Eingabe {
    /// pitch of the ratio-1 mode (before `groesse`)
    pub hz: f32,
    /// a rising edge above 0.5 strikes
    pub trig: f32,
    /// strike strength 0..10
    pub staerke: f32,
    /// audio input
    pub x: f32,
    /// 0..1: loss factor 0.1 .. 1e-5
    pub material: f32,
    /// 0..1: mallet roll-off 50 Hz .. 25.6 kHz
    pub helligkeit: f32,
    /// 0.25..4: frequencies divided by it
    pub groesse: f32,
    /// 0..1: strike position, edge .. centre
    pub position: f32,
    /// 0..2: 1 physical, 0 harmonic
    pub inharmonie: f32,
}

/// State of one voice: all its modes, structure of arrays so the mode loop vectorises.
#[derive(Clone, Copy, Debug)]
pub struct Stimme {
    re: [f32; MAX_MODEN],
    im: [f32; MAX_MODEN],
    /// r cos w, r sin w
    c: [f32; MAX_MODEN],
    s: [f32; MAX_MODEN],
    /// strike gain and audio input gain
    gs: [f32; MAX_MODEN],
    gx: [f32; MAX_MODEN],
    /// hz, material, helligkeit, groesse, position, inharmonie of the last coefficient update
    alt: [f32; 6],
    zaehler: u32,
    trig_alt: f32,
    burst: f32,
    burst_d: f32,
    burst_rest: u32,
    zufall: u32,
    aktiv: bool,
}

#[inline]
fn endlich(x: f32, sonst: f32) -> f32 { if x.is_finite() { x } else { sonst } }

impl Stimme {
    /// Fresh, silent voice `stimme` of a node with seed `saat`.
    pub fn neu(stimme: usize, e: &Einstellung) -> Stimme {
        let s = 0x9E37_79B9u32 ^ (stimme as u32 + 1).wrapping_mul(0x85EB_CA6B) ^ e.saat.wrapping_mul(0xC2B2_AE35);
        Stimme {
            re: [0.0; MAX_MODEN],
            im: [0.0; MAX_MODEN],
            c: [0.0; MAX_MODEN],
            s: [0.0; MAX_MODEN],
            gs: [0.0; MAX_MODEN],
            gx: [0.0; MAX_MODEN],
            alt: [f32::NAN; 6],
            zaehler: 0,
            trig_alt: 0.0,
            burst: 0.0,
            burst_d: 0.0,
            burst_rest: 0,
            zufall: if s == 0 { 0x2545_F491 } else { s },
            aktiv: false,
        }
    }

    #[inline]
    fn rauschen(&mut self) -> f32 {
        let mut x = self.zufall;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.zufall = x;
        x as i32 as f32 * (1.0 / 2_147_483_648.0)
    }

    /// Rebuilds coefficients and gains of the first `n` modes for the parameters `p` (cleaned, see `prozess`).
    fn koeffizienten(&mut self, satz: &Satz, n: usize, sr: f32, p: [f32; 6]) {
        let [hz, material, hell, groesse, pos, inh] = p;
        let sr = sr as f64;
        let f1 = hz as f64 / groesse as f64;
        let eta = ETA_MAX * 10f64.powf(-ETA_DEKADEN * material as f64);
        let fc = HELL_MIN_HZ * 2f64.powf(HELL_OKTAVEN * hell as f64);
        let mut roh = [0.0f32; MAX_MODEN];
        let mut eins_minus_r = [0.0f32; MAX_MODEN];
        let mut summe = 0.0f64;
        for m in 0..n {
            let f = f1 * satz.verhaeltnis(m, inh as f64);
            if !(f >= F_MIN_HZ && f < NYQUIST_ANTEIL * sr) {
                self.c[m] = 0.0;
                self.s[m] = 0.0;
                continue;
            }
            let t60 = (T60_KONST / (eta * f)).clamp(T60_MIN, T60_MAX).max(T60_MIN_SAMPLES / sr);
            let r = (-3.0 * std::f64::consts::LN_10 / (t60 * sr)).exp();
            let w = 2.0 * PI * f / sr;
            let (mut c, mut s) = ((r * w.cos()) as f32, (r * w.sin()) as f32);
            // f32 rounding must not lift |z| to 1 (with T60 <= 30 s, 1 - r >= 1.2e-6 up to 192 kHz, far above the rounding)
            let betrag = ((c as f64).powi(2) + (s as f64).powi(2)).sqrt();
            if betrag >= 1.0 {
                let k = (1.0 - 1e-6) / betrag;
                c = (c as f64 * k) as f32;
                s = (s as f64 * k) as f32;
            }
            self.c[m] = c;
            self.s[m] = s;
            eins_minus_r[m] = (1.0 - r) as f32;
            let g = satz.form(m, pos) as f64 / (1.0 + (f / fc).powi(2));
            roh[m] = g as f32;
            summe += g * g;
        }
        let norm = if summe > 1e-24 { (1.0 / summe.sqrt()) as f32 } else { 0.0 };
        for m in 0..n {
            let g = roh[m] * norm;
            let g = if g.abs() < 1e-6 { 0.0 } else { g };
            self.gs[m] = g;
            self.gx[m] = 2.0 * g * eins_minus_r[m];
        }
    }

    /// Mode `m` as built: (frequency Hz, T60 s, strike gain) from the coefficients that run (for tests and the report).
    pub fn modus(&self, m: usize, sr: f32) -> (f64, f64, f32) {
        let (c, s) = (self.c[m] as f64, self.s[m] as f64);
        let r = (c * c + s * s).sqrt();
        let f = s.atan2(c) * sr as f64 / (2.0 * PI);
        let t60 = if r > 0.0 { -3.0 * std::f64::consts::LN_10 / (r.ln() * sr as f64) } else { 0.0 };
        (f, t60, self.gs[m])
    }

    /// Largest |z| of all modes (stability check).
    pub fn groesster_pol(&self) -> f64 {
        (0..MAX_MODEN).map(|m| ((self.c[m] as f64).powi(2) + (self.s[m] as f64).powi(2)).sqrt()).fold(0.0, f64::max)
    }

    /// The mode states (re, im), for the subnormal check.
    pub fn zustaende(&self) -> impl Iterator<Item = f32> + '_ { self.re.iter().chain(self.im.iter()).copied() }

    /// True while the bank is running (not all modes zero).
    pub fn aktiv(&self) -> bool { self.aktiv }

    /// One sample.
    #[inline]
    pub fn prozess(&mut self, satz: &Satz, e: &Einstellung, sr: f32, x: Eingabe) -> f32 {
        let n = e.moden.clamp(1, MAX_MODEN).min(satz.n);
        let trig = endlich(x.trig, 0.0);
        let schlag = trig > 0.5 && self.trig_alt <= 0.5;
        self.trig_alt = trig;
        let p = [
            endlich(x.hz, 0.0).max(0.0),
            endlich(x.material, 0.5).clamp(0.0, 1.0),
            endlich(x.helligkeit, 0.5).clamp(0.0, 1.0),
            endlich(x.groesse, 1.0).clamp(GROESSE_MIN, GROESSE_MAX),
            endlich(x.position, 0.3).clamp(0.0, 1.0),
            endlich(x.inharmonie, 1.0).clamp(0.0, INHARMONIE_MAX),
        ];
        if (schlag || self.zaehler == 0) && p != self.alt {
            self.alt = p;
            self.koeffizienten(satz, n, sr, p);
        }
        let mut a = 0.0f32;
        if schlag {
            let st = endlich(x.staerke, 1.0).clamp(0.0, STAERKE_MAX);
            // a strike too weak to hear would only start states near the subnormal range
            let st = if st < 1e-6 { 0.0 } else { st };
            if e.anregung == 0 {
                a = st;
            } else {
                // noise of unit energy: uniform noise has mean square 1/3, the envelope d^k sums to 1 / (1 - d^2)
                let laenge = (e.burst_ms.clamp(BURST_MIN_MS, BURST_MAX_MS) * 0.001 * sr).round().max(1.0);
                self.burst_d = 10f32.powf(-3.0 / laenge);
                self.burst = st * (3.0 * (1.0 - self.burst_d * self.burst_d)).sqrt();
                self.burst_rest = laenge as u32;
            }
            self.aktiv = true;
        }
        if self.burst_rest > 0 {
            a += self.burst * self.rauschen();
            self.burst *= self.burst_d;
            self.burst_rest -= 1;
        }
        let xin = endlich(x.x, 0.0).clamp(-100.0, 100.0);
        let xin = if xin.abs() < EINGANG_RUHE { 0.0 } else { xin };
        if xin != 0.0 {
            self.aktiv = true;
        }
        self.zaehler = (self.zaehler + 1) % STEUER;
        if !self.aktiv {
            return 0.0;
        }
        // in lanes of 8 with one accumulator per lane, so the loop vectorises (a single f32 sum would serialise it);
        // modes from n up to the lane end have zero coefficients and stay zero
        let mut y = 0.0f32;
        let mut summe = [0.0f32; 8];
        for k in (0..(n + 7) & !7).step_by(8) {
            for (j, s) in summe.iter_mut().enumerate() {
                let m = k + j;
                let (r, i) = (self.re[m], self.im[m]);
                self.re[m] = self.c[m] * r - self.s[m] * i + self.gs[m] * a + self.gx[m] * xin;
                self.im[m] = self.s[m] * r + self.c[m] * i;
                *s += self.im[m];
            }
        }
        for s in summe {
            y += s;
        }
        if self.zaehler == 0 {
            // decayed modes to zero: no subnormals, and an idle voice costs nothing
            let mut laeuft = false;
            for m in 0..n {
                if self.re[m].abs() + self.im[m].abs() < RUHE {
                    self.re[m] = 0.0;
                    self.im[m] = 0.0;
                } else {
                    laeuft = true;
                }
            }
            if !laeuft && self.burst_rest == 0 && xin == 0.0 {
                self.aktiv = false;
            }
        }
        y
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn eingabe(hz: f32) -> Eingabe {
        Eingabe { hz, trig: 0.0, staerke: 1.0, x: 0.0, material: 0.5, helligkeit: 0.5, groesse: 1.0, position: 0.3, inharmonie: 1.0 }
    }

    #[test]
    fn stabwurzeln_wie_veroeffentlicht() {
        // beta_n L of the free-free bar (Fletcher & Rossing 1998, eq. 2.64 and table; also every vibration handbook)
        for (n, soll) in [(1, 4.730_040_7), (2, 7.853_204_6), (3, 10.995_607_8), (4, 14.137_165_5), (5, 17.278_759_6)] {
            assert!((stab_beta(n) - soll).abs() < 1e-6, "beta_{n} = {} vs {soll}", stab_beta(n));
        }
    }

    #[test]
    fn besselnullen_wie_abramowitz_stegun() {
        // Abramowitz & Stegun table 9.5
        for (m, k, soll) in [(0, 0, 2.404_825_6), (0, 1, 5.520_078_1), (0, 2, 8.653_727_9), (1, 0, 3.831_705_97), (1, 1, 7.015_586_7),
                             (2, 0, 5.135_622_3), (2, 1, 8.417_244_1), (3, 0, 6.380_161_9), (4, 0, 7.588_342_4), (5, 0, 8.771_483_8)] {
            let j = bessel_nullen(m, 20.0)[k];
            assert!((j - soll).abs() < 1e-6, "j_{m},{} = {j} vs {soll}", k + 1);
        }
    }

    #[test]
    fn stabformen_haben_einheitliches_mittel_und_freie_enden() {
        // mean square over the length is 1 after normalisation, and a free end moves twice the rms (|phi(0)| = 2)
        let s = Satz::neu(0);
        for m in 0..MAX_MODEN {
            assert!((s.form(m, 0.0).abs() - 2.0).abs() < 1e-3, "mode {m}: end value {}", s.form(m, 0.0));
        }
        let q = 4000;
        let ms = (0..q).map(|i| stab_form(stab_beta(31), (i as f64 + 0.5) / q as f64).powi(2)).sum::<f64>() / q as f64;
        assert!(ms.is_finite() && ms > 0.5 && ms < 2.0, "mode 31 unnormalised mean square {ms}");
    }

    #[test]
    fn verstaerkungen_haben_einheitsenergie() {
        for nr in 0..SAETZE.len() {
            let satz = Satz::neu(nr);
            let e = Einstellung { moden: 32, anregung: 0, burst_ms: 5.0, saat: 0 };
            let mut v = Stimme::neu(0, &e);
            for pos in [0.0, 0.3, 0.77, 1.0] {
                let mut x = eingabe(220.0);
                x.position = pos;
                x.trig = 1.0;
                v.trig_alt = 0.0;
                v.prozess(&satz, &e, SR, x);
                let energie: f32 = v.gs.iter().map(|g| g * g).sum();
                assert!((energie - 1.0).abs() < 1e-3, "{} pos {pos}: sum of gs^2 = {energie}", satz.name);
            }
        }
    }

    #[test]
    fn keine_subnormalen_und_ruhe_nach_dem_abklingen() {
        // every state value is 0 or a normal float, sample by sample, until the voice goes idle; the shortest and the
        // longest decays, high and low pitch
        for nr in 0..SAETZE.len() {
            let satz = Satz::neu(nr);
            for (hz, material) in [(2000.0f32, 0.0f32), (60.0, 0.0), (300.0, 0.3)] {
                let e = Einstellung { moden: 32, anregung: 0, burst_ms: 5.0, saat: 0 };
                let mut v = Stimme::neu(0, &e);
                let mut x = eingabe(hz);
                x.material = material;
                x.helligkeit = 1.0;
                x.trig = 1.0;
                let mut still = None;
                for i in 0..20 * 48_000 {
                    v.prozess(&satz, &e, SR, x);
                    x.trig = 0.0;
                    if let Some(z) = v.zustaende().find(|z| *z != 0.0 && z.abs() < f32::MIN_POSITIVE) {
                        panic!("{} {hz} Hz material {material}: subnormal state {z:e} at sample {i}", satz.name);
                    }
                    if !v.aktiv() {
                        still = Some(i);
                        break;
                    }
                }
                assert!(still.is_some(), "{} {hz} Hz material {material}: voice never went idle", satz.name);
            }
        }
    }

    #[test]
    fn nan_eingaenge_vergiften_nichts() {
        let satz = Satz::neu(2);
        let e = Einstellung { moden: 32, anregung: 1, burst_ms: 5.0, saat: 0 };
        let mut v = Stimme::neu(0, &e);
        let n = f32::NAN;
        let x = Eingabe { hz: n, trig: n, staerke: n, x: n, material: n, helligkeit: n, groesse: n, position: n, inharmonie: n };
        for _ in 0..100 {
            assert!(v.prozess(&satz, &e, SR, x).is_finite());
        }
        // NaN knobs while a strike and the audio input run: every knob falls back to its default
        let mut y = Eingabe { hz: 440.0, trig: 1.0, staerke: 1.0, x: 0.5, ..x };
        for i in 0..4800 {
            let a = v.prozess(&satz, &e, SR, y);
            assert!(a.is_finite(), "sample {i}: {a}");
            y.trig = 0.0;
        }
        let mut x = eingabe(440.0);
        x.trig = 1.0;
        let y: Vec<f32> = (0..4800).map(|i| { if i == 1 { x.trig = 0.0 } v.prozess(&satz, &e, SR, x) }).collect();
        assert!(y.iter().all(|v| v.is_finite()) && y.iter().any(|v| v.abs() > 0.01), "the voice must play after the NaN inputs");
    }
}
