//! Wavetable oscillator with built-in unison (type 32, `wavetable`).
//!
//! **Tables.** Every table is computed from its harmonic spectrum when a graph is translated (no files, no samples):
//! `saege`, `rechteck` (pulse width morph), `dreieck`, `sinus`, `analog` (sine, triangle, saw, square), `vokale` (sung a e i o
//! u, formant envelopes) and `orgel` (drawbars added one by one). A table holds 1 to 8 frames; `pos` morphs between
//! neighbouring frames by linear interpolation of the two frames at the same phase.
//!
//! **Band limit.** Each frame is stored as a mip map with one level per third of an octave: level `k` keeps the harmonics
//! `1..=H_k`, `H_k = floor(1024 * 2^(-k/3))`. A copy at frequency `f` plays the richest level with `H_k * f <= sr - 20 kHz`,
//! so every partial above Nyquist folds back above 20 kHz, and the partials dropped by a level switch all lie above
//! `(sr - 20 kHz) / 2^(1/3)` (22.2 kHz at 48 kHz): switching levels is inaudible and needs no crossfade.
//!
//! **Interpolation.** A level of `H` harmonics is stored with `L = clamp(next_pow2(16 H), 128, 8192)` samples (at least 8
//! times oversampled, 16 times below 512 harmonics) and read with a cubic B-spline (four taps). The B-spline's passband droop `sinc^4(h / L)` is divided out
//! of every harmonic when the table is built, so the passband is exact and the spline's images sit 100 dB down (see
//! `BERICHT-wavetable.md`).
//!
//! **Unison.** 1 to 7 copies per voice, spread linearly over `-verstimmung ..= +verstimmung` cent and over the stereo
//! field (`breite`, equal-power pan). The sum is scaled by `1 / sqrt(kopien)`, so detuned copies with independent phases
//! keep the loudness of one copy. A rising `trig` restarts every copy at a random phase (`zufall` scales it, 0 = all at
//! phase 0); the random numbers come from a xorshift32 per voice, seeded by `saat` and the voice number, so a graph
//! always plays the same.
//!
//! **Real time.** `Stimme::prozess` does not allocate, lock or panic (all table indices are masked), and keeps no state
//! that decays toward zero except the position smoother, which snaps to its target (no subnormals).
use realfft::num_complex::Complex;
use realfft::RealFftPlanner;

/// Highest number of unison copies per voice.
pub const MAX_KOPIEN: usize = 7;
/// Largest detune of the outermost copy in cent.
pub const MAX_VERSTIMMUNG: f32 = 50.0;
/// Harmonics of the richest level (enough to reach 20 kHz down to 19.5 Hz).
pub const MAX_HARMONISCHE: usize = 1024;
/// Levels per octave.
pub const STUFEN_JE_OKTAVE: f32 = 3.0;
/// Number of mip levels: down to a single harmonic (k = 28 gives floor(1024 * 2^(-28/3)) = 1).
pub const STUFEN: usize = 29;
/// Highest frequency that must stay free of aliases.
pub const ALIAS_FREI_HZ: f32 = 20_000.0;
/// Most frames per table.
pub const MAX_FRAMES: usize = 8;
/// Names of the tables, index = value `tabelle`.
pub const TABELLEN: [&str; 7] = ["saege", "rechteck", "dreieck", "sinus", "analog", "vokale", "orgel"];

/// Harmonics of level `k`.
pub fn harmonische(k: usize) -> usize {
    ((MAX_HARMONISCHE as f64) * 2f64.powf(-(k as f64) / STUFEN_JE_OKTAVE as f64)).floor().max(1.0) as usize
}

/// Stored samples of a level with `h` harmonics: a power of two, 16 times oversampled, at least 128 and at most 8192 (so
/// the richest levels, 645 harmonics and more, are 8 to 12.7 times oversampled).
pub fn laenge(h: usize) -> usize { (16 * h).next_power_of_two().clamp(128, 8192) }

#[derive(Clone, Copy, Debug)]
struct Stufe {
    /// offset of frame 0 in `daten`; frame `i` starts at `start + i * laenge`
    start: usize,
    /// log2 of the length
    bits: u32,
}

/// A table: `frames` frames, each as `STUFEN` levels. Shared read-only by all voices of a node.
pub struct Tabelle {
    pub name: &'static str,
    pub frames: usize,
    stufen: [Stufe; STUFEN],
    /// harmonics of each level, as f32 for the level choice
    harm: [f32; STUFEN],
    daten: Box<[f32]>,
}

/// One harmonic: amplitude and phase of `a * sin(2 pi h t + phase)`.
type Teilton = (f64, f64);

fn saege(h: usize) -> Teilton { (2.0 / (std::f64::consts::PI * h as f64), 0.0) }
fn rechteck(h: usize) -> Teilton { if h % 2 == 1 { (4.0 / (std::f64::consts::PI * h as f64), 0.0) } else { (0.0, 0.0) } }
fn dreieck(h: usize) -> Teilton {
    if h % 2 == 1 {
        let s = if (h / 2) % 2 == 0 { 1.0 } else { -1.0 };
        (s * 8.0 / (std::f64::consts::PI * std::f64::consts::PI * (h * h) as f64), 0.0)
    } else {
        (0.0, 0.0)
    }
}
fn sinus(h: usize) -> Teilton { if h == 1 { (1.0, 0.0) } else { (0.0, 0.0) } }

/// Pulse of width `w` (0..1) centred on phase 1/4, DC removed: the phase of each harmonic does not depend on `w`, so
/// neighbouring frames morph without phase smear. At w = 0.5 it is the square.
fn puls(w: f64, h: usize) -> Teilton {
    let hf = h as f64;
    // y = sum 4/(pi h) sin(pi h w) cos(2 pi h (t - 1/4)) = sum 4/(pi h) sin(pi h w) sin(2 pi h t + pi/2 - pi h / 2)
    (4.0 / (std::f64::consts::PI * hf) * (std::f64::consts::PI * hf * w).sin(), std::f64::consts::FRAC_PI_2 * (1.0 - hf))
}

/// Formants (Hz, level dB, bandwidth Hz) of a bass choir, after the common five-formant vowel table.
const VOKALE: [[(f64, f64, f64); 5]; 5] = [
    [(600.0, 0.0, 60.0), (1040.0, -7.0, 70.0), (2250.0, -9.0, 110.0), (2450.0, -9.0, 120.0), (2750.0, -20.0, 130.0)], // a
    [(400.0, 0.0, 40.0), (1620.0, -12.0, 80.0), (2400.0, -9.0, 100.0), (2800.0, -12.0, 120.0), (3100.0, -18.0, 120.0)], // e
    [(250.0, 0.0, 60.0), (1750.0, -30.0, 90.0), (2600.0, -16.0, 100.0), (3050.0, -22.0, 120.0), (3340.0, -28.0, 120.0)], // i
    [(400.0, 0.0, 40.0), (750.0, -11.0, 80.0), (2400.0, -21.0, 100.0), (2600.0, -20.0, 120.0), (2900.0, -40.0, 120.0)], // o
    [(350.0, 0.0, 40.0), (600.0, -20.0, 80.0), (2400.0, -32.0, 100.0), (2675.0, -28.0, 120.0), (2950.0, -36.0, 120.0)], // u
];
/// The frequency harmonic 1 stands for when the vowel spectra are drawn (C3); like every wavetable, the formants move with
/// the played pitch.
const VOKAL_GRUND_HZ: f64 = 130.81;

/// Sung vowel: a source falling 6 dB per octave under the sum of five resonance curves. Schroeder phases keep the crest
/// factor low (a smooth, choir-like wave instead of a pulse train).
fn vokal(v: usize, h: usize) -> Teilton {
    let f = h as f64 * VOKAL_GRUND_HZ;
    let huelle: f64 = VOKALE[v].iter().map(|&(fc, db, bw)| 10f64.powf(db / 20.0) / (1.0 + ((f - fc) / (0.5 * bw)).powi(2)).sqrt()).sum();
    (huelle / h as f64, std::f64::consts::PI * (h * h) as f64 / 32.0)
}

/// Drawbar harmonics (16', 8', 5 1/3', 4', 2 2/3', 2', 1 3/5', 1 1/3', 1' over the 16' fundamental) and their levels.
const ZUGRIEGEL: [(usize, f64); 9] = [(1, 1.0), (2, 0.8), (3, 0.6), (4, 0.5), (6, 0.4), (8, 0.35), (10, 0.3), (12, 0.25), (16, 0.2)];

/// Organ: frame `i` (0..8) pulls drawbars 1..=i + 2.
fn orgel(i: usize, h: usize) -> Teilton {
    ZUGRIEGEL.iter().take(i + 2).find(|(n, _)| *n == h).map(|(_, a)| (*a, 0.0)).unwrap_or((0.0, 0.0))
}

/// Spectrum of table `nr`, frame `i`, harmonic `h`; and the number of frames. Additive tables (vowels, organ) are scaled
/// to the RMS of the saw afterwards (`auf_saege_rms`), the classic waves keep their textbook amplitude.
fn spektrum(nr: usize) -> (usize, bool, Box<dyn Fn(usize, usize) -> Teilton>) {
    match nr {
        0 => (1, false, Box::new(|_, h| saege(h))),
        1 => (8, false, Box::new(|i, h| puls(0.5 - 0.45 * i as f64 / 7.0, h))),
        2 => (1, false, Box::new(|_, h| dreieck(h))),
        3 => (1, false, Box::new(|_, h| sinus(h))),
        4 => (4, false, Box::new(|i, h| [sinus, dreieck, saege, rechteck][i](h))),
        5 => (5, true, Box::new(vokal)),
        _ => (8, true, Box::new(orgel)),
    }
}

#[inline]
fn sinc(x: f64) -> f64 { if x == 0.0 { 1.0 } else { (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x) } }

impl Tabelle {
    /// Builds table `nr` (index into `TABELLEN`, clamped). Allocates; call it at translation, never in the audio path.
    pub fn neu(nr: usize) -> Tabelle {
        let nr = nr.min(TABELLEN.len() - 1);
        let (frames, additiv, sp) = spektrum(nr);
        let mut stufen = [Stufe { start: 0, bits: 0 }; STUFEN];
        let mut summe = 0usize;
        for (k, s) in stufen.iter_mut().enumerate() {
            let l = laenge(harmonische(k));
            *s = Stufe { start: summe, bits: l.trailing_zeros() };
            summe += l * frames;
        }
        // scale of each frame: 1, or RMS of the saw over RMS of the frame (sum of a^2 / 2 over the full spectrum)
        let saege_rms2: f64 = (1..=MAX_HARMONISCHE).map(|h| saege(h).0.powi(2) / 2.0).sum();
        let skala: Vec<f64> = (0..frames).map(|i| {
            if !additiv { return 1.0; }
            let e: f64 = (1..=MAX_HARMONISCHE).map(|h| sp(i, h).0.powi(2) / 2.0).sum();
            if e > 0.0 { (saege_rms2 / e).sqrt() } else { 0.0 }
        }).collect();
        let mut daten = vec![0.0f32; summe].into_boxed_slice();
        let mut planer = RealFftPlanner::<f64>::new();
        for (k, s) in stufen.iter().enumerate() {
            let l = 1usize << s.bits;
            let hmax = harmonische(k).min(l / 2 - 1);
            let inv = planer.plan_fft_inverse(l);
            let mut spek = inv.make_input_vec();
            let mut aus = inv.make_output_vec();
            for i in 0..frames {
                spek.iter_mut().for_each(|c| *c = Complex::new(0.0, 0.0));
                for h in 1..=hmax {
                    let (a, ph) = sp(i, h);
                    // a sin(2 pi h n / L + ph) = Re(-i a e^{i ph} e^{2 pi i h n / L}); c2r adds bin h twice (h and L - h).
                    // Dividing by sinc^4 undoes the passband droop of the cubic B-spline read.
                    let a = a * skala[i] / sinc(h as f64 / l as f64).powi(4);
                    spek[h] = Complex::new(0.5 * a * ph.sin(), -0.5 * a * ph.cos());
                }
                inv.process(&mut spek, &mut aus).expect("fixed sizes");
                let ziel = &mut daten[s.start + i * l..s.start + (i + 1) * l];
                for (z, v) in ziel.iter_mut().zip(&aus) {
                    *z = *v as f32;
                }
            }
        }
        Tabelle { name: TABELLEN[nr], frames, stufen, harm: std::array::from_fn(|k| harmonische(k) as f32), daten }
    }

    /// Level for a phase increment `inc` (fraction of a period per sample, 0..0.5) at sample rate `sr`: the richest level
    /// whose top harmonic stays at or below `sr - 20 kHz` (at least Nyquist).
    #[inline]
    pub fn stufe(&self, inc: f32, sr: f32) -> usize {
        let f = inc * sr;
        let grenze = (sr - ALIAS_FREI_HZ).max(0.5 * sr);
        if !(f > 0.0) {
            return 0;
        }
        // H_k <= 1024 * 2^(-k/3) <= grenze / f  <=>  k >= 3 log2(1024 f / grenze): a safe first guess; the floor in H_k can
        // make the next richer level fit as well, one step back takes it
        let k = (STUFEN_JE_OKTAVE * (MAX_HARMONISCHE as f32 * f / grenze).log2()).ceil();
        let k = if k <= 0.0 { 0 } else { (k as usize).min(STUFEN - 1) };
        if k > 0 && self.harm[k - 1] * f <= grenze { k - 1 } else { k }
    }

    /// Value at phase `phase` (u32, one period = 2^32) of level `k`, morph position `x` in frames (0..frames - 1).
    #[inline]
    pub fn lese(&self, k: usize, phase: u32, x: f32) -> f32 {
        let s = self.stufen[k.min(STUFEN - 1)];
        let l = 1usize << s.bits;
        let maske = l - 1;
        let n = (phase >> (32 - s.bits)) as usize;
        let t = ((phase << s.bits) >> 8) as f32 * (1.0 / 16_777_216.0);
        let x = x.clamp(0.0, (self.frames - 1) as f32);
        let i = (x as usize).min(self.frames - 1);
        let m = x - i as f32;
        let f0 = s.start + i * l;
        let d = &self.daten;
        let tap = |j: usize| -> f32 {
            let a = d[f0 + ((n + j) & maske)];
            if m > 0.0 && i + 1 < self.frames {
                a + (d[f0 + l + ((n + j) & maske)] - a) * m
            } else {
                a
            }
        };
        // cubic B-spline weights for the taps n - 1, n, n + 1, n + 2
        let (y0, y1, y2, y3) = (tap(maske), tap(0), tap(1), tap(2));
        let t2 = t * t;
        let t3 = t2 * t;
        let u = 1.0 - t;
        (u * u * u * y0 + (3.0 * t3 - 6.0 * t2 + 4.0) * y1 + (-3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0) * y2 + t3 * y3) * (1.0 / 6.0)
    }

    /// Bytes held by the table data.
    pub fn bytes(&self) -> usize { self.daten.len() * 4 }
}

/// Fixed values of a wavetable node.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Einstellung {
    /// 1..=7
    pub kopien: usize,
    /// 0..1: how far apart the random start phases are (0 = all copies start at phase 0)
    pub zufall: f32,
    /// smoothing time of `pos` in ms (0 = none)
    pub glatt_ms: f32,
    /// seed of the start phases
    pub saat: u32,
}

/// Inputs of one sample.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Eingabe {
    pub hz: f32,
    pub trig: f32,
    /// morph position 0..1 over the frames
    pub pos: f32,
    /// cent of the outermost copy, 0..50
    pub verstimmung: f32,
    /// stereo spread 0..1
    pub breite: f32,
}

/// State of one voice: all its copies.
#[derive(Clone, Copy, Debug)]
pub struct Stimme {
    phase: [u32; MAX_KOPIEN],
    /// detune ratio and pan gains per copy, valid for `verst_alt` and `breite_alt`
    faktor: [f32; MAX_KOPIEN],
    gl: [f32; MAX_KOPIEN],
    gr: [f32; MAX_KOPIEN],
    verst_alt: f32,
    breite_alt: f32,
    /// phase step and mip level per copy: the level is chosen again only when the step changes
    inc_alt: [f32; MAX_KOPIEN],
    stufe: [usize; MAX_KOPIEN],
    /// smoothed position in frames
    pos: f32,
    frisch: bool,
    zufall: u32,
}

/// Spread of copy `c` of `n` over -1..=1 (0 for a single copy).
#[inline]
fn lage(c: usize, n: usize) -> f32 { if n <= 1 { 0.0 } else { 2.0 * c as f32 / (n - 1) as f32 - 1.0 } }

#[inline]
fn endlich(x: f32, sonst: f32) -> f32 { if x.is_finite() { x } else { sonst } }

impl Stimme {
    /// Fresh voice `stimme` of a node with seed `saat`: copies at their random start phases (also without a trig).
    pub fn neu(stimme: usize, e: &Einstellung) -> Stimme {
        let s = 0x9E37_79B9u32 ^ (stimme as u32 + 1).wrapping_mul(0x85EB_CA6B) ^ e.saat.wrapping_mul(0xC2B2_AE35);
        let mut v = Stimme {
            phase: [0; MAX_KOPIEN],
            faktor: [1.0; MAX_KOPIEN],
            gl: [1.0; MAX_KOPIEN],
            gr: [1.0; MAX_KOPIEN],
            verst_alt: f32::NAN,
            breite_alt: f32::NAN,
            inc_alt: [-1.0; MAX_KOPIEN],
            stufe: [0; MAX_KOPIEN],
            pos: 0.0,
            frisch: true,
            zufall: if s == 0 { 0x2545_F491 } else { s },
        };
        v.neue_phasen(e);
        v
    }

    #[inline]
    fn zahl(&mut self) -> u32 {
        let mut x = self.zufall;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.zufall = x;
        x
    }

    #[inline]
    fn neue_phasen(&mut self, e: &Einstellung) {
        let z = e.zufall.clamp(0.0, 1.0) as f64;
        for c in 0..MAX_KOPIEN {
            let r = self.zahl();
            self.phase[c] = (r as f64 * z) as u32;
        }
    }

    /// One sample: (left, right, mono). Mono is the sum without pan.
    #[inline]
    pub fn prozess(&mut self, t: &Tabelle, e: &Einstellung, sr: f32, x: Eingabe) -> (f32, f32, f32) {
        let n = e.kopien.clamp(1, MAX_KOPIEN);
        let verst = endlich(x.verstimmung, 0.0).clamp(0.0, MAX_VERSTIMMUNG);
        if verst != self.verst_alt {
            self.verst_alt = verst;
            for c in 0..n {
                self.faktor[c] = (lage(c, n) * verst / 1200.0).exp2();
            }
        }
        let breite = endlich(x.breite, 0.0).clamp(0.0, 1.0);
        if breite != self.breite_alt {
            self.breite_alt = breite;
            for c in 0..n {
                // equal power, centre = 1 on both sides
                let w = std::f32::consts::FRAC_PI_4 * (1.0 + lage(c, n) * breite);
                self.gl[c] = std::f32::consts::SQRT_2 * w.cos();
                self.gr[c] = std::f32::consts::SQRT_2 * w.sin();
            }
        }
        let ziel = endlich(x.pos, 0.0).clamp(0.0, 1.0) * (t.frames - 1) as f32;
        if x.trig > 0.5 {
            self.neue_phasen(e);
            self.frisch = true;
        }
        if self.frisch || e.glatt_ms <= 0.0 {
            // a new note starts at the target, it does not morph from where the last note stopped
            self.pos = ziel;
            self.frisch = false;
        } else if self.pos != ziel {
            let k = 1.0 - (-1000.0 / (e.glatt_ms * sr)).exp();
            let neu = self.pos + (ziel - self.pos) * k;
            // snap when the rest is tiny (no subnormals toward 0) or when f32 rounding swallows the step (near 3.0 the
            // step stalls about 6e-5 frames short of the target)
            self.pos = if neu == self.pos || (ziel - neu).abs() < 1e-6 { ziel } else { neu };
        }
        let grund = (endlich(x.hz, 0.0) / sr).clamp(0.0, 0.5);
        let (mut l, mut r, mut m) = (0.0f32, 0.0f32, 0.0f32);
        for c in 0..n {
            let inc = (grund * self.faktor[c]).min(0.5);
            if inc != self.inc_alt[c] {
                self.inc_alt[c] = inc;
                self.stufe[c] = t.stufe(inc, sr);
            }
            let y = t.lese(self.stufe[c], self.phase[c], self.pos);
            self.phase[c] = self.phase[c].wrapping_add((inc as f64 * 4_294_967_296.0) as u32);
            l += y * self.gl[c];
            r += y * self.gr[c];
            m += y;
        }
        let g = 1.0 / (n as f32).sqrt();
        (l * g, r * g, m * g)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stufen_haben_die_versprochenen_harmonischen() {
        assert_eq!(harmonische(0), 1024);
        assert_eq!(harmonische(3), 512);
        assert_eq!(harmonische(STUFEN - 1), 1);
        assert!(harmonische(STUFEN - 2) >= 1);
        for k in 0..STUFEN {
            assert!(laenge(harmonische(k)) >= 8 * harmonische(k), "level {k} not 8x oversampled");
        }
    }

    #[test]
    fn stufenwahl_haelt_die_aliasgrenze() {
        // for every frequency the chosen level's top harmonic stays below sr - 20 kHz, and the next richer level would not
        let sr = 48_000.0;
        let t = Tabelle::neu(3);
        let mut f = 10.0f32;
        while f < 24_000.0 {
            let k = t.stufe(f / sr, sr);
            let h = harmonische(k) as f32;
            if k < STUFEN - 1 {
                assert!(h * f <= 28_000.0, "f {f}: level {k} has {h} harmonics up to {} Hz", h * f);
            }
            if k > 0 {
                assert!(harmonische(k - 1) as f32 * f > 28_000.0, "f {f}: level {k} is poorer than needed");
            }
            f *= 1.01;
        }
    }

    #[test]
    fn saege_tabelle_trifft_die_formel() {
        // level 20 has 10 harmonics, 128 samples; the spline read at the sample points must give the band-limited saw
        let t = Tabelle::neu(0);
        let k = 20;
        let h = harmonische(k);
        for j in 0..64 {
            let ph = j as f64 / 64.0;
            let soll: f64 = (1..=h).map(|n| 2.0 / (std::f64::consts::PI * n as f64) * (2.0 * std::f64::consts::PI * n as f64 * ph).sin()).sum();
            let ist = t.lese(k, (ph * 4_294_967_296.0) as u32, 0.0) as f64;
            assert!((ist - soll).abs() < 1e-4, "phase {ph}: {ist} vs {soll}");
        }
    }

    #[test]
    fn positionsglaettung_rastet_ein_ohne_subnormale() {
        let t = Tabelle::neu(4);
        let e = Einstellung { kopien: 1, zufall: 1.0, glatt_ms: 10.0, saat: 0 };
        let mut v = Stimme::neu(0, &e);
        let mut x = Eingabe { hz: 100.0, trig: 0.0, pos: 1.0, verstimmung: 0.0, breite: 0.0 };
        v.prozess(&t, &e, 48_000.0, x);
        x.pos = 0.0;
        for _ in 0..48_000 {
            v.prozess(&t, &e, 48_000.0, x);
        }
        assert_eq!(v.pos, 0.0, "the smoother must snap to its target");
    }

    #[test]
    fn nan_position_haengt_den_glaetter_nicht_auf() {
        // a NaN on `pos` must not poison the smoother: once the input is finite again, the position follows it
        let t = Tabelle::neu(4);
        let e = Einstellung { kopien: 1, zufall: 1.0, glatt_ms: 10.0, saat: 0 };
        let mut v = Stimme::neu(0, &e);
        let mut x = Eingabe { hz: 100.0, trig: 0.0, pos: f32::NAN, verstimmung: f32::NAN, breite: f32::NAN };
        for _ in 0..100 {
            assert!(v.prozess(&t, &e, 48_000.0, x).0.is_finite());
        }
        x.pos = 1.0;
        for _ in 0..48_000 {
            v.prozess(&t, &e, 48_000.0, x);
        }
        assert_eq!(v.pos, (t.frames - 1) as f32, "the position must reach the last frame after the NaN");
    }

    #[test]
    fn tabellen_sind_endlich_und_begrenzt() {
        for nr in 0..TABELLEN.len() {
            let t = Tabelle::neu(nr);
            assert!(t.daten.iter().all(|v| v.is_finite()), "{}", t.name);
            let spitze = t.daten.iter().fold(0.0f32, |m, v| m.max(v.abs()));
            println!("MESS table {} frames {} bytes {} peak {spitze:.3}", t.name, t.frames, t.bytes());
            assert!(spitze < 3.0, "{}: peak {spitze}", t.name);
        }
    }
}
