//! Formant (type 39, `formant`): vowel filter, five parallel band-passes per voice.
//!
//! **Table.** The Csound formant table, voice "tenor" (Csound manual, appendix "Formant Values", `csound.com/docs/manual/
//! MiscFormants.html`, read 2026-11-11): for each vowel a, e, i, o, u the centre frequency, the amplitude in dB and the
//! bandwidth in Hz of five formants, listed by voice type (bass, tenor, alto, ...). The classic speech data are Peterson
//! and Barney, "Control methods used in a study of the vowels", J. Acoust. Soc. Am. 24 (1952); they give F1 to F3 only,
//! no bandwidths or levels, so the Csound table is used. Tenor was chosen as a neutral middle between the bass and the
//! alto sets; `versatz` moves it to any "mouth size".
//!
//! **Vowel axis.** `vokal` 0..4 (a, e, i, o, u), clamped. Between neighbours the formant frequencies and bandwidths are
//! interpolated linearly in the logarithm (equal semitone steps), the amplitude linearly in dB.
//! **Shift.** `versatz` semitones moves all five frequencies by `2^(versatz/12)` and scales the bandwidths with the
//! same factor (a smaller or larger vocal tract); frequencies stop at 0.45 sr. **Sharpness** `q` 0..1: bandwidth factor
//! `3^(1 - 2q)`: 0.5 is the table, 0 three times wider, 1 a third as wide.
//!
//! **Filters.** `svf::Stufe` (TPT state variable filter, f64). Its band-pass output `v1` has a peak gain of `1/k`, so the
//! formant is `k * bp`, unit gain at its centre, then the table amplitude. The five outputs are summed and scaled by
//! `GEWINN`; `mix` crossfades with the dry input.
//!
//! **No clicks.** The target frequencies, bandwidths and amplitudes are recomputed every 8 samples and followed by a
//! one-pole of 2 ms (in log f, log bandwidth, dB). A TPT filter keeps its state when its coefficients change, so a
//! slow move cannot click, and the smoother makes a jump of `vokal` (a to i) a 2 ms glide instead of a step in the
//! coefficients. Audio-rate `vokal` is therefore limited to about 80 Hz of bandwidth.
//!
//! **Real time.** No allocation or lock; the audio input is clamped to +-1e4; non-finite inputs fall back (`vokal` keeps
//! its last value, `versatz` 0, `q` 0.5, `mix` 1), a non-finite output resets the voice like `svf.rs`.
use crate::svf::Stufe;

/// number of formants per vowel
pub const ANZAHL: usize = 5;
/// Peak gain of the sum, a makeup so that a sawtooth through the filter is about as loud as the input (see tests/formant.rs)
pub const GEWINN: f64 = 4.0;
const SCHRITT: u32 = 8;
const GLATT_S: f64 = 0.002;

/// (frequency Hz, level dB, bandwidth Hz) of the five formants of a, e, i, o, u: Csound formant table, tenor.
pub const TENOR: [[(f64, f64, f64); ANZAHL]; 5] = [
    [(650.0, 0.0, 80.0), (1080.0, -6.0, 90.0), (2650.0, -7.0, 120.0), (2900.0, -8.0, 130.0), (3250.0, -22.0, 140.0)],
    [(400.0, 0.0, 70.0), (1700.0, -14.0, 80.0), (2600.0, -12.0, 100.0), (3200.0, -14.0, 120.0), (3580.0, -20.0, 120.0)],
    [(290.0, 0.0, 40.0), (1870.0, -15.0, 90.0), (2800.0, -18.0, 100.0), (3250.0, -20.0, 120.0), (3540.0, -30.0, 120.0)],
    [(400.0, 0.0, 70.0), (800.0, -10.0, 80.0), (2600.0, -12.0, 100.0), (2800.0, -12.0, 130.0), (3000.0, -26.0, 135.0)],
    [(350.0, 0.0, 40.0), (600.0, -20.0, 60.0), (2700.0, -17.0, 100.0), (2900.0, -14.0, 120.0), (3300.0, -26.0, 120.0)],
];

/// Target (ln f, ln bandwidth, dB) per formant for `vokal`, `versatz` (semitones) and `q`; before the 0.45 sr limit.
pub fn ziel(vokal: f64, versatz: f64, q: f64) -> [(f64, f64, f64); ANZAHL] {
    let v = vokal.clamp(0.0, 4.0);
    let i = (v.floor() as usize).min(3);
    let t = v - i as f64;
    let faktor = (versatz.clamp(-24.0, 24.0) / 12.0).exp2();
    let bw_faktor = 3f64.powf(1.0 - 2.0 * q.clamp(0.0, 1.0));
    std::array::from_fn(|n| {
        let (a, b) = (TENOR[i][n], TENOR[i + 1][n]);
        let lf = a.0.ln() + (b.0.ln() - a.0.ln()) * t;
        let lb = a.2.ln() + (b.2.ln() - a.2.ln()) * t;
        let db = a.1 + (b.1 - a.1) * t;
        (lf + faktor.ln(), lb + (faktor * bw_faktor).ln(), db)
    })
}

#[derive(Clone, Copy)]
pub struct Stimme {
    s: [Stufe; ANZAHL],
    /// smoothed (ln f, ln bandwidth, dB)
    p: [(f64, f64, f64); ANZAHL],
    /// (g, k, linear amplitude including k) in use, from `p`
    koef: [(f64, f64, f64); ANZAHL],
    erst: bool,
    zaehler: u32,
    vokal: f64,
}

impl Default for Stimme {
    fn default() -> Self { Stimme::neu() }
}

impl Stimme {
    pub fn neu() -> Self {
        Stimme { s: [Stufe::default(); ANZAHL], p: [(0.0, 0.0, 0.0); ANZAHL], koef: [(0.0, 1.0, 0.0); ANZAHL], erst: true, zaehler: 0, vokal: 0.0 }
    }

    /// One sample. `vokal` 0..4, `versatz` semitones, `q` 0..1, `mix` 0..1.
    #[inline]
    pub fn prozess(&mut self, x: f32, vokal: f32, versatz: f32, q: f32, mix: f32, sr: f32) -> f32 {
        let srf = sr as f64;
        if vokal.is_finite() {
            self.vokal = vokal as f64;
        }
        let versatz = if versatz.is_finite() { versatz as f64 } else { 0.0 };
        let q = if q.is_finite() { q as f64 } else { 0.5 };
        let mix = if mix.is_finite() { mix.clamp(0.0, 1.0) } else { 1.0 };
        if self.zaehler == 0 {
            let z = ziel(self.vokal, versatz, q);
            let c = if self.erst { 1.0 } else { 1.0 - (-(SCHRITT as f64) / (GLATT_S * srf)).exp() };
            let grenze = (0.45 * srf).ln();
            for n in 0..ANZAHL {
                let p = &mut self.p[n];
                p.0 += c * (z[n].0 - p.0);
                p.1 += c * (z[n].1 - p.1);
                p.2 += c * (z[n].2 - p.2);
                let f = p.0.min(grenze).exp();
                let bw = p.1.exp();
                let k = (bw / f).clamp(0.02, 2.0);
                self.koef[n] = ((std::f64::consts::PI * f / srf).tan(), k, 10f64.powf(p.2 / 20.0) * k);
            }
            self.erst = false;
        }
        self.zaehler = (self.zaehler + 1) % SCHRITT;
        // the input is clamped to +-1e4 (+80 dBFS): a value near f32::MAX would overflow the f32 output
        let xin = if x.is_finite() { (x as f64).clamp(-1e4, 1e4) } else { 0.0 };
        let mut summe = 0.0;
        for n in 0..ANZAHL {
            let (g, k, a) = self.koef[n];
            summe += a * self.s[n].prozess(xin, g, k).1;
        }
        let nass = summe * GEWINN;
        let aus = xin + mix as f64 * (nass - xin);
        if !aus.is_finite() {
            *self = Stimme::neu();
            return 0.0;
        }
        aus as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nan_eingaenge_bleiben_endlich() {
        let mut v = Stimme::neu();
        let (n, inf) = (f32::NAN, f32::INFINITY);
        for i in 0..4000 {
            let (x, a, b, c, d) = match i % 3 { 0 => (n, n, n, n, n), 1 => (inf, inf, inf, inf, inf), _ => (1.0, 2.5, 3.0, 0.5, 1.0) };
            assert!(v.prozess(x, a, b, c, d, 48_000.0).is_finite(), "sample {i}");
        }
    }

    #[test]
    fn ziel_trifft_die_tabelle() {
        let z = ziel(2.0, 0.0, 0.5);
        for n in 0..ANZAHL {
            assert!((z[n].0.exp() - TENOR[2][n].0).abs() < 1e-9);
            assert!((z[n].1.exp() - TENOR[2][n].2).abs() < 1e-9);
        }
        let z = ziel(3.0, 12.0, 0.5);
        assert!((z[0].0.exp() - 800.0).abs() < 1e-9);
    }
}
