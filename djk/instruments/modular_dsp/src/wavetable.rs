//! Wavetable oscillator with built-in unison (type 32, `wavetable`).
//!
//! **Tables.** Every table is computed from its harmonic spectrum when a graph is translated (no files, no samples):
//! `saege`, `rechteck` (pulse width morph), `dreieck`, `sinus`, `analog` (sine, triangle, saw, square), `vokale` (sung a e i o
//! u, formant envelopes) and `orgel` (drawbars added one by one); a node may bring its own table as `spektren` instead. A
//! table holds 1 to 256 frames (the built-in ones up to 8); `pos` morphs between
//! neighbouring frames by linear interpolation of the two frames at the same phase.
//!
//! **Band limit.** Each frame is stored as a mip map with one level per third of an octave: level `k` keeps the harmonics
//! `1..=H_k`, `H_k = floor(1024 * 2^(-k/3))`. A copy at frequency `f` plays the richest level with `H_k * f <= sr - 20 kHz`,
//! so every partial above Nyquist folds back above 20 kHz, and the partials dropped by a level switch all lie above
//! `(sr - 20 kHz) / 2^(1/3)` (22.2 kHz at 48 kHz): switching levels is inaudible and needs no crossfade.
//!
//! **Phase modulation and warp.** `pm` offsets the read phase, `warp` bends it (bend, asym, sync). Both read the table
//! faster than the copy's own step, so the level is chosen for more than that step: times the steepest slope of the warp
//! map and up to one octave on top, plus the largest recent step of `pm`; `reserve` adds whole octaves by hand. With `pm`
//! and `warp` at 0 the level choice and the read are the plain ones.
//!
//! **Interpolation.** A level of `H` harmonics is stored with `L = clamp(next_pow2(16 H), 128, 8192)` samples (at least 8
//! times oversampled, 16 times below 512 harmonics) and read with a cubic B-spline (four taps). The B-spline's passband droop `sinc^4(h / L)` is divided out
//! of every harmonic when the table is built, so the passband is exact and the spline's images sit 100 dB down (see
//! `REPORT-wavetable.md`).
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
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

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
pub const MAX_FRAMES: usize = 256;
/// Most harmonics of a custom spectrum frame (`spektren`).
pub const MAX_SPEKTREN_HARMONISCHE: usize = 256;
/// Largest absolute amplitude of one custom harmonic.
pub const MAX_SPEKTREN_AMPLITUDE: f32 = 4.0;
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

/// Checks the custom spectra of a node: 1..=`MAX_FRAMES` frames, each 1..=`MAX_SPEKTREN_HARMONISCHE` harmonics, every value
/// finite with `|a| <= MAX_SPEKTREN_AMPLITUDE`. The error is the reason, ready for the refusal text.
pub fn pruefe_spektren(spek: &[Vec<f32>]) -> Result<(), &'static str> {
    if spek.is_empty() || spek.len() > MAX_FRAMES {
        return Err("1..256 frames");
    }
    for f in spek {
        if f.is_empty() || f.len() > MAX_SPEKTREN_HARMONISCHE {
            return Err("each frame needs 1..256 harmonics");
        }
        if f.iter().any(|a| !a.is_finite() || a.abs() > MAX_SPEKTREN_AMPLITUDE) {
            return Err("harmonic amplitudes must be finite with |a| <= 4");
        }
    }
    Ok(())
}

#[inline]
fn sinc(x: f64) -> f64 { if x == 0.0 { 1.0 } else { (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x) } }

impl Tabelle {
    /// Builds table `nr` (index into `TABELLEN`, clamped). Allocates; call it at translation, never in the audio path.
    pub fn neu(nr: usize) -> Tabelle {
        let nr = nr.min(TABELLEN.len() - 1);
        let (frames, additiv, sp) = spektrum(nr);
        Self::bauen(TABELLEN[nr], frames, additiv, MAX_HARMONISCHE, &*sp)
    }

    /// Builds a table from custom harmonic spectra (node field `spektren`): frame `i` holds the amplitudes of harmonics
    /// `1..` as `a * sin(2 pi h t)`, the sign is the polarity. The frames are scaled to the RMS of the saw like the other
    /// additive tables; an all-zero frame stays silent. The caller has checked the data with `pruefe_spektren`; anything
    /// beyond the limits is cut off and a non-finite value counts as 0, so the build cannot fail. Allocates (translation only).
    pub fn aus_spektren(spek: &[Vec<f32>]) -> Tabelle {
        let frames = spek.len().clamp(1, MAX_FRAMES);
        let leer = Vec::new();
        let sp = move |i: usize, h: usize| -> Teilton {
            let a = spek.get(i).unwrap_or(&leer).get(h - 1).copied().filter(|a| a.is_finite() && h <= MAX_SPEKTREN_HARMONISCHE).unwrap_or(0.0);
            (a as f64, 0.0)
        };
        Self::bauen("spektren", frames, true, MAX_SPEKTREN_HARMONISCHE, &sp)
    }

    /// `inhalt`: no harmonic above this number is nonzero. Levels that keep all of them and have the same length hold the
    /// same samples (same input, same inverse FFT, same droop correction), so such a level is stored once and the others
    /// point at it: bit-identical to storing each, a custom table (256 harmonics) saves about half its memory.
    /// Reference build without shared levels (every level stored): what `aus_spektren` gave before the cache. For the
    /// bit-equality test and the measurement.
    #[doc(hidden)]
    pub fn aus_spektren_ohne_teilen(spek: &[Vec<f32>]) -> Tabelle {
        let frames = spek.len().clamp(1, MAX_FRAMES);
        let leer = Vec::new();
        let sp = move |i: usize, h: usize| -> Teilton {
            let a = spek.get(i).unwrap_or(&leer).get(h - 1).copied().filter(|a| a.is_finite() && h <= MAX_SPEKTREN_HARMONISCHE).unwrap_or(0.0);
            (a as f64, 0.0)
        };
        Self::bauen("spektren", frames, true, MAX_HARMONISCHE + 1, &sp)
    }

    /// Samples of level `k`, frame `i`.
    #[doc(hidden)]
    pub fn stufe_daten(&self, k: usize, i: usize) -> &[f32] {
        let s = self.stufen[k];
        let l = 1usize << s.bits;
        &self.daten[s.start + i * l..s.start + (i + 1) * l]
    }

    fn bauen(name: &'static str, frames: usize, additiv: bool, inhalt: usize, sp: &dyn Fn(usize, usize) -> Teilton) -> Tabelle {
        let mut stufen = [Stufe { start: 0, bits: 0 }; STUFEN];
        // level that stores the data of level k (k itself unless it repeats an earlier one)
        let mut quelle = [0usize; STUFEN];
        let mut summe = 0usize;
        for (k, s) in stufen.iter_mut().enumerate() {
            let l = laenge(harmonische(k));
            let voll = |k: usize| harmonische(k).min(laenge(harmonische(k)) / 2 - 1) >= inhalt;
            quelle[k] = (0..k).find(|&j| laenge(harmonische(j)) == l && voll(j) && voll(k)).unwrap_or(k);
            if quelle[k] == k {
                *s = Stufe { start: summe, bits: l.trailing_zeros() };
                summe += l * frames;
            }
        }
        for k in 0..STUFEN {
            if quelle[k] != k {
                stufen[k] = stufen[quelle[k]];
            }
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
            if quelle[k] != k {
                continue;
            }
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
        TABELLEN_GEBAUT.fetch_add(1, Ordering::Relaxed);
        Tabelle { name, frames, stufen, harm: std::array::from_fn(|k| harmonische(k) as f32), daten }
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

/// How many tables were computed (not taken from the cache) since the process started. For the tests and `messe`.
pub static TABELLEN_GEBAUT: AtomicUsize = AtomicUsize::new(0);

/// Budget of the table cache in bytes: tables beyond it are dropped from the cache, oldest use first (a program that still
/// holds one keeps it alive).
const CACHE_BYTES: usize = 384 << 20;

#[derive(PartialEq, Eq, Clone)]
enum Schluessel {
    Eingebaut(usize),
    /// bit patterns of the custom spectra
    Spektren(Vec<Vec<u32>>),
}

/// Cache of finished tables, most recently used last. A translation of a graph whose tables did not change takes them from
/// here instead of computing them again (a 256 frame table costs about 0.5 s and 40 MB), and nodes with the same table
/// share one copy.
static CACHE: Mutex<Vec<(Schluessel, Arc<Tabelle>)>> = Mutex::new(Vec::new());

fn aus_cache(key: Schluessel, bauen: impl FnOnce() -> Tabelle) -> Arc<Tabelle> {
    let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(i) = c.iter().position(|(k, _)| *k == key) {
        let e = c.remove(i);
        let t = e.1.clone();
        c.push(e);
        return t;
    }
    // built under the lock: two translations asking for the same new table compute it once
    let t = Arc::new(bauen());
    c.push((key, t.clone()));
    let mut summe: usize = c.iter().map(|(_, t)| t.bytes()).sum();
    while summe > CACHE_BYTES && c.len() > 1 {
        summe -= c[0].1.bytes();
        c.remove(0);
    }
    t
}

/// Built-in table `nr` from the cache. Translation only.
pub fn tabelle_eingebaut(nr: usize) -> Arc<Tabelle> {
    let nr = nr.min(TABELLEN.len() - 1);
    aus_cache(Schluessel::Eingebaut(nr), || Tabelle::neu(nr))
}

/// Custom table from the cache (same input bits, same table). Translation only.
pub fn tabelle_aus_spektren(spek: &[Vec<f32>]) -> Arc<Tabelle> {
    let key = Schluessel::Spektren(spek.iter().map(|f| f.iter().map(|a| a.to_bits()).collect()).collect());
    aus_cache(key, || Tabelle::aus_spektren(spek))
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
    /// 0..=3: the mip level is chosen for a phase step times `2^reserve` (head room for `pm` and `warp`)
    pub reserve: u8,
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
    /// phase offset in cycles, added to the read phase of every copy (audio rate)
    pub pm: f32,
    /// warp mode, rounded: 0 off, 1 bend, 2 asym, 3 sync
    pub warp: f32,
    /// warp depth: bend and asym -1..1, sync 0..1
    pub tiefe: f32,
    /// octave stack, rounded, read at `trig`: 0 off, 1 alternate unison, 2 octave and fifth
    pub stapel: f32,
}

/// Warp of the read phase for one sample of one voice; all copies share it. The map runs in f64 on the full 32 bit phase:
/// with f32 the phase would be cut to 24 bits, which near the edge of a saw is an audible error (and bend and asym at
/// depth 0 would not be the identity).
#[derive(Clone, Copy)]
struct Warp {
    modus: u8,
    /// bend: `s = 4^tiefe`; asym: `1 / (2 a)`; sync: the frequency ratio `1 + 7 tiefe`
    k1: f64,
    /// asym: knee `a`
    knie: f64,
    /// asym: `1 / (2 (1 - a))`
    k2: f64,
    /// largest slope of the phase map, 1..=8: the mip level is chosen for the step times this
    steil: f32,
}

impl Warp {
    const AUS: Warp = Warp { modus: 0, k1: 1.0, knie: 0.5, k2: 1.0, steil: 1.0 };

    fn neu(modus: u8, tiefe: f32) -> Warp {
        let t = tiefe as f64;
        match modus {
            1 => {
                let s = (2.0 * t.clamp(-1.0, 1.0)).exp2();
                Warp { modus, k1: s, knie: 0.5, k2: 1.0, steil: (s.max(1.0 / s) as f32).clamp(1.0, 8.0) }
            }
            2 => {
                let a = 0.5 + 0.45 * t.clamp(-1.0, 1.0);
                let (k1, k2) = (1.0 / (2.0 * a), 1.0 / (2.0 * (1.0 - a)));
                Warp { modus, k1, knie: a, k2, steil: (k1.max(k2) as f32).clamp(1.0, 8.0) }
            }
            3 => {
                let m = 1.0 + 7.0 * t.clamp(0.0, 1.0);
                Warp { modus, k1: m, knie: 0.5, k2: 1.0, steil: m as f32 }
            }
            _ => Warp::AUS,
        }
    }

    /// Mapped phase as a u32 phase and the gain of the soft edge, for the read phase `ph` (u32, one period = 2^32).
    #[inline]
    fn abbilden(&self, ph: u32) -> (u32, f32) {
        let p = ph as f64 * (1.0 / 4_294_967_296.0);
        let (q, g) = match self.modus {
            // one division: p / (p + s (1 - p)); the denominator is at least min(1, s) > 0
            1 => (p / (p + self.k1 * (1.0 - p)), 1.0),
            2 => (if p < self.knie { p * self.k1 } else { 0.5 + (p - self.knie) * self.k2 }, 1.0),
            // the ratio m is not an integer in general: the last 1/16 of the master cycle fades to zero (smoothstep, so
            // neither the level nor the slope has a step: a linear fade would put its kinks 40 dB above the alias limit)
            _ => {
                let m = p * self.k1;
                let u = ((1.0 - p) * 16.0) as f32;
                (m - m.floor(), if u < 1.0 { u * u * (3.0 - 2.0 * u) } else { 1.0 })
            }
        };
        ((q * 4_294_967_296.0) as u32, g)
    }
}

/// How long the rounded `warp` input must ask for a new mode before a sounding note takes it (the live knob smoothing
/// of 20 ms passes through the modes in between for up to about 22 ms each).
pub const MODUS_HALT_S: f32 = 0.06;
/// Decay per sample of the pm step follower (about 20 ms at 48 kHz).
const PM_ABKLING: f32 = 0.999;

/// Stack offset in semitones of copy `c` for stack mode `stapel`.
#[inline]
fn stapel_halbtoene(stapel: u8, c: usize) -> f32 {
    match stapel {
        1 => 12.0 * (c % 2) as f32,
        2 => [0.0, 12.0, 19.0][c % 3],
        _ => 0.0,
    }
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
    /// stack mode latched at the last trig (and at the first sample), and the one `faktor` was computed for
    stapel: u8,
    stapel_alt: u8,
    /// warp mode in use, the mode the rounded input asks for, and for how many samples it has asked for it
    modus: u8,
    modus_wunsch: u8,
    modus_halt: u32,
    /// last phase offset from `pm`, and the largest recent step of it in cycles per sample (decays by `PM_ABKLING`)
    pm_alt: u32,
    pm_schritt: f32,
    /// trig level of the last sample: only a rising edge restarts (audit 2026-11-18, found 2026-11-19: a held trig re-rolled every phase on every
    /// sample, the tone turned into noise; the same fix as granular.rs ecd4c4630)
    trig_vorher: bool,
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
            stapel: 0,
            stapel_alt: 0,
            modus: 0,
            modus_wunsch: 0,
            modus_halt: 0,
            pm_alt: 0,
            pm_schritt: 0.0,
            trig_vorher: false,
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
        // a rising trig counts once, a held level is no new start
        let hoch = x.trig > 0.5;
        let flanke = hoch && !self.trig_vorher;
        self.trig_vorher = hoch;
        // the stack is read at a trig (and once at the very start, so a node without a trig has it too)
        let sofort = flanke || self.frisch;
        let stapel = if sofort { endlich(x.stapel, 0.0).round().clamp(0.0, 2.0) as u8 } else { self.stapel };
        self.stapel = stapel;
        if verst != self.verst_alt || stapel != self.stapel_alt {
            self.verst_alt = verst;
            self.stapel_alt = stapel;
            for c in 0..n {
                self.faktor[c] = if stapel == 0 {
                    (lage(c, n) * verst / 1200.0).exp2()
                } else {
                    (lage(c, n) * verst / 1200.0 + stapel_halbtoene(stapel, c) / 12.0).exp2()
                };
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
        if flanke {
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
        // phase modulation and warp; with both off every copy takes the plain read below
        let pm = if x.pm == 0.0 { 0 } else { ((endlich(x.pm, 0.0) as f64).rem_euclid(1.0) * 4_294_967_296.0) as u32 };
        // The warp mode is a switch. A smoothed knob travels through the modes in between, so a sounding note takes a new
        // mode only after the rounded input has asked for it for `MODUS_HALT_S`; a trig and the first sample take it at once.
        let modus = if x.warp == 0.0 && self.modus == 0 && self.modus_halt == 0 {
            0
        } else {
            let wunsch = endlich(x.warp, 0.0).round().clamp(0.0, 3.0) as u8;
            if sofort || wunsch == self.modus {
                self.modus = wunsch;
                self.modus_wunsch = wunsch;
                self.modus_halt = 0;
            } else {
                if wunsch != self.modus_wunsch {
                    self.modus_wunsch = wunsch;
                    self.modus_halt = 0;
                }
                self.modus_halt += 1;
                if self.modus_halt as f32 >= MODUS_HALT_S * sr {
                    self.modus = wunsch;
                    self.modus_halt = 0;
                }
            }
            self.modus
        };
        let einfach = pm == 0 && modus == 0;
        let warp = if modus == 0 { Warp::AUS } else { Warp::neu(modus, endlich(x.tiefe, 0.0)) };
        // level choice: head room `reserve` (octaves) and the steepest part of the warp map (a factor of exactly 1 leaves
        // the step as it was)
        // A warp map gets up to one more octave on top of its slope (measured: with the slope alone a saw through bend 1 at
        // C4 folds at -35 dB, the map itself on a sine at -62 dB). The extra grows with the slope, so depth 0 stays neutral.
        let mehr = (1u32 << e.reserve.min(3)) as f32 * warp.steil * warp.steil.min(2.0);
        // Phase modulation moves the read phase by its own step. The level is chosen for the copy's step plus the largest
        // recent pm step (peak follower, coarse so the level is not chosen again every sample). Without pm it stays 0.
        if pm != 0 || self.pm_schritt != 0.0 {
            if sofort {
                self.pm_alt = pm;
            }
            let d = (pm.wrapping_sub(self.pm_alt) as i32).unsigned_abs() as f32 / 4_294_967_296.0;
            self.pm_alt = pm;
            let s = d.max(self.pm_schritt * PM_ABKLING);
            self.pm_schritt = if s < 1e-7 { 0.0 } else { s };
        }
        // rounded up to the next of 1, 1.5 times a power of two
        let pm_mehr = if self.pm_schritt == 0.0 { 0.0 } else { f32::from_bits(self.pm_schritt.to_bits() & 0xFFC0_0000) * 1.5 };
        let (mut l, mut r, mut m) = (0.0f32, 0.0f32, 0.0f32);
        for c in 0..n {
            let inc = (grund * self.faktor[c]).min(0.5);
            let inc_stufe = inc * mehr + pm_mehr;
            if inc_stufe != self.inc_alt[c] {
                self.inc_alt[c] = inc_stufe;
                self.stufe[c] = t.stufe(inc_stufe, sr);
            }
            let y = if einfach {
                t.lese(self.stufe[c], self.phase[c], self.pos)
            } else {
                let ph = self.phase[c].wrapping_add(pm);
                if modus == 0 {
                    t.lese(self.stufe[c], ph, self.pos)
                } else {
                    let (p, g) = warp.abbilden(ph);
                    t.lese(self.stufe[c], p, self.pos) * g
                }
            };
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

    fn probe_spektren(frames: usize, saat: f32) -> Vec<Vec<f32>> {
        (0..frames).map(|i| (1..=256).map(|h| ((i as f32 + saat) * 0.37 * h as f32).sin() / h as f32).collect()).collect()
    }

    #[test]
    fn geteilte_stufen_sind_bitgleich_und_sparen_speicher() {
        let sp = probe_spektren(5, 0.0);
        let (a, b) = (Tabelle::aus_spektren(&sp), Tabelle::aus_spektren_ohne_teilen(&sp));
        for k in 0..STUFEN {
            for i in 0..5 {
                let (x, y) = (a.stufe_daten(k, i), b.stufe_daten(k, i));
                assert_eq!(x.len(), y.len());
                assert!(x.iter().zip(y).all(|(p, q)| p.to_bits() == q.to_bits()), "level {k} frame {i}");
            }
        }
        assert!(a.bytes() * 10 < b.bytes() * 6, "{} vs {}", a.bytes(), b.bytes());
        // built-in tables share nothing (their spectra reach 1024 harmonics)
        assert_eq!(Tabelle::neu(0).bytes(), (0..STUFEN).map(|k| laenge(harmonische(k))).sum::<usize>() * 4);
    }

    #[test]
    fn cache_gibt_dieselbe_tabelle_zurueck() {
        let sp = probe_spektren(3, 7.0);
        let (a, b) = (tabelle_aus_spektren(&sp), tabelle_aus_spektren(&sp));
        assert!(Arc::ptr_eq(&a, &b));
        let mut anders = sp.clone();
        anders[1][3] += 0.25;
        assert!(!Arc::ptr_eq(&a, &tabelle_aus_spektren(&anders)));
        assert!(Arc::ptr_eq(&tabelle_eingebaut(4), &tabelle_eingebaut(4)));
        assert!(Arc::ptr_eq(&tabelle_eingebaut(99), &tabelle_eingebaut(TABELLEN.len() - 1)));
    }

    #[test]
    fn bis_256_frames() {
        assert_eq!(MAX_FRAMES, 256);
        assert!(pruefe_spektren(&probe_spektren(256, 0.0)).is_ok());
        assert!(pruefe_spektren(&probe_spektren(257, 0.0)).is_err());
        assert_eq!(Tabelle::aus_spektren(&probe_spektren(256, 1.0)).frames, 256);
    }

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
    fn gehaltener_trig_startet_nur_einmal() {
        // audit 2026-11-18: a held trig (a gate) re-rolled the phases on every sample and the saw turned into noise. Only the rising edge restarts:
        // a held trig must give the same periodic tone as a one-sample pulse (autocorrelation at one period of 100 Hz near 1).
        let t = Tabelle::neu(0);
        let e = Einstellung { kopien: 7, zufall: 1.0, glatt_ms: 0.0, saat: 3, reserve: 0 };
        let lauf = |gehalten: bool| -> Vec<f32> {
            let mut v = Stimme::neu(0, &e);
            let mut x = Eingabe { hz: 100.0, trig: 1.0, pos: 0.0, verstimmung: 10.0, breite: 0.0, pm: 0.0, warp: 0.0, tiefe: 0.0, stapel: 0.0 };
            (0..9600).map(|i| { if !gehalten && i > 0 { x.trig = 0.0; } v.prozess(&t, &e, 48_000.0, x).2 }).collect()
        };
        let ak = |s: &[f32]| -> f32 {
            let (a, b) = (&s[4800..9120], &s[5280..9600]);
            let z: f32 = a.iter().zip(b).map(|(p, q)| p * q).sum();
            z / (a.iter().map(|p| p * p).sum::<f32>().sqrt() * b.iter().map(|q| q * q).sum::<f32>().sqrt())
        };
        let (puls, gehalten) = (lauf(false), lauf(true));
        assert!(ak(&puls) > 0.9, "the pulse reference is periodic: {}", ak(&puls));
        assert!(ak(&gehalten) > 0.9, "a held trig keeps the tone: autocorrelation {}", ak(&gehalten));
        assert_eq!(puls, gehalten, "a held trig is the same as one rising edge");
    }

    #[test]
    fn positionsglaettung_rastet_ein_ohne_subnormale() {
        let t = Tabelle::neu(4);
        let e = Einstellung { kopien: 1, zufall: 1.0, glatt_ms: 10.0, saat: 0, reserve: 0 };
        let mut v = Stimme::neu(0, &e);
        let mut x = Eingabe { hz: 100.0, trig: 0.0, pos: 1.0, verstimmung: 0.0, breite: 0.0, pm: 0.0, warp: 0.0, tiefe: 0.0, stapel: 0.0 };
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
        let e = Einstellung { kopien: 1, zufall: 1.0, glatt_ms: 10.0, saat: 0, reserve: 0 };
        let mut v = Stimme::neu(0, &e);
        let mut x = Eingabe { hz: 100.0, trig: 0.0, pos: f32::NAN, verstimmung: f32::NAN, breite: f32::NAN, pm: f32::NAN, warp: f32::NAN, tiefe: f32::NAN, stapel: f32::NAN };
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
