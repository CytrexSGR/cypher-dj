//! Channel vocoder (S11): the spectral envelope of a modulator (a voice) in 11 bands imposes itself on a carrier (a synth
//! built inside the graph). Per band: a normalized band-pass on the modulator, a peak envelope follower on its output, a
//! band-pass of the same shape on the carrier multiplied by that envelope; the bands are summed, scaled by a make-up
//! constant, and a high-passed copy of the modulator (sibilance) is added. DAFX 2nd ed. ch. 7, Pirkle PSMVocoder.
//!
//! D1 centres `fc_i = 200 * 25^(i/10)` (log spaced, 200 Hz to 5 kHz, NOT the verified SVC-350 centres), `Q = 1 / (r^(1/2) -
//! r^(-1/2))` with `r = 25^(1/10)`. D2 TPT state-variable band-pass (Zavalishin), output `k * v1` (unity gain at the centre),
//! cascaded twice for four poles. D3 follower `e = |b|` with one-pole attack and release. D5 sibilance: 2-pole Butterworth
//! high-pass at 6 kHz. All coefficients are computed in `neu` (D8); state is f64, nothing allocates while running.

pub const BAENDER: usize = 11;
const HP_HZ: f64 = 6000.0;
/// below this a state value is flushed to 0 (denormal guard)
const NULL: f64 = 1e-30;
/// defaults for a non-finite `zisch` / `mix` reaching the DSP (the block substitutes its node values first)
const ZISCH_VOR: f32 = 0.3;
const MIX_VOR: f32 = 1.0;

/// level make-up per pole count (C3): carrier noise and modulator noise of equal RMS give an output RMS of the carrier's,
/// for default attack and release. Derived with `tests/vocoder.rs::derive_makeup`, 32 seed pairs, 3 significant digits.
pub const AUSGLEICH_2: f64 = 14.2;
pub const AUSGLEICH_4: f64 = 49.9;

/// one TPT state-variable stage with precomputed coefficients, outputs `(bp * k, hp)`; k = 1/Q
#[derive(Clone, Copy, Default)]
struct Stufe {
    a1: f64,
    a2: f64,
    a3: f64,
    k: f64,
    ic1: f64,
    ic2: f64,
}

impl Stufe {
    fn neu(g: f64, k: f64) -> Self {
        let a1 = 1.0 / (1.0 + g * (g + k));
        Stufe { a1, a2: g * a1, a3: g * g * a1, k, ic1: 0.0, ic2: 0.0 }
    }
    /// (normalized band-pass `k * v1`, high-pass `x - k * v1 - v2`)
    #[inline]
    fn prozess(&mut self, x: f64) -> (f64, f64) {
        let v3 = x - self.ic2;
        let v1 = self.a1 * self.ic1 + self.a2 * v3;
        let v2 = self.ic2 + self.a2 * self.ic1 + self.a3 * v3;
        let i1 = 2.0 * v1 - self.ic1;
        let i2 = 2.0 * v2 - self.ic2;
        self.ic1 = if i1.abs() < NULL { 0.0 } else { i1 };
        self.ic2 = if i2.abs() < NULL { 0.0 } else { i2 };
        (self.k * v1, x - self.k * v1 - v2)
    }
    fn leeren(&mut self) {
        self.ic1 = 0.0;
        self.ic2 = 0.0;
    }
}

/// band-pass of one or two cascaded stages (pole 2 or 4)
#[derive(Clone, Copy, Default)]
struct Band {
    s: [Stufe; 2],
    stufen: usize,
}

impl Band {
    #[inline]
    fn prozess(&mut self, x: f64) -> f64 {
        let mut y = x;
        for i in 0..self.stufen {
            y = self.s[i].prozess(y).0;
        }
        y
    }
}

pub struct Vocoder {
    sr: f64,
    pole: usize,
    ausgleich: f64,
    mitten: [f64; BAENDER],
    k: f64,
    /// band-pass banks: modulator side and carrier side
    modulator: [Band; BAENDER],
    traeger: [Band; BAENDER],
    huelle: [f64; BAENDER],
    ca: f64,
    cr: f64,
    hp: Stufe,
    /// last sample: carrier band outputs before / after the envelope (test hooks)
    tb: [f64; BAENDER],
    bs: [f64; BAENDER],
}

#[inline]
fn endlich(x: f32) -> f64 { if x.is_finite() { x as f64 } else { 0.0 } }

impl Vocoder {
    /// `pole` 2 or 4 (the translator checks; anything below 4 is read as 2); `sr` at least 13 kHz (translator)
    pub fn neu(sr: f32, attack_ms: f32, release_ms: f32, pole: usize) -> Self {
        Self::neu_mit_ausgleich(sr, attack_ms, release_ms, pole, if pole >= 4 { AUSGLEICH_4 } else { AUSGLEICH_2 })
    }

    /// as `neu` with an explicit make-up constant (test hook: derives the constants, `derive_makeup`)
    pub fn neu_mit_ausgleich(sr: f32, attack_ms: f32, release_ms: f32, pole: usize, ausgleich: f64) -> Self {
        let sr = sr as f64;
        let r = 25f64.powf(0.1);
        let q = 1.0 / (r.sqrt() - 1.0 / r.sqrt());
        let k = 1.0 / q;
        let stufen = if pole >= 4 { 2 } else { 1 };
        let mitten = Self::mitten();
        let mut modulator = [Band::default(); BAENDER];
        let mut traeger = [Band::default(); BAENDER];
        for i in 0..BAENDER {
            let g = (std::f64::consts::PI * mitten[i] / sr).tan();
            let b = Band { s: [Stufe::neu(g, k); 2], stufen };
            modulator[i] = b;
            traeger[i] = b;
        }
        let koeff = |ms: f32| 1.0 - (-1.0 / ((ms.max(0.01) as f64) * 1e-3 * sr)).exp();
        let g_hp = (std::f64::consts::PI * HP_HZ / sr).tan();
        Vocoder {
            sr,
            pole: if pole >= 4 { 4 } else { 2 },
            ausgleich,
            mitten,
            k,
            modulator,
            traeger,
            huelle: [0.0; BAENDER],
            ca: koeff(attack_ms),
            cr: koeff(release_ms),
            hp: Stufe::neu(g_hp, std::f64::consts::SQRT_2),
            tb: [0.0; BAENDER],
            bs: [0.0; BAENDER],
        }
    }

    /// the 11 band centres in Hz (D1)
    pub fn mitten() -> [f64; BAENDER] {
        let mut m = [0.0; BAENDER];
        for (i, v) in m.iter_mut().enumerate() {
            *v = 200.0 * 25f64.powf(i as f64 / 10.0);
        }
        m
    }

    /// test hook: magnitude of the carrier filter of band `i` at `f` Hz (analytic; bilinear band-pass prewarped at the centre)
    pub fn band_gain(&self, i: usize, f: f64) -> f64 {
        let g = (std::f64::consts::PI * self.mitten[i] / self.sr).tan();
        let c = 1.0 / g;
        let w = num_exp(-2.0 * std::f64::consts::PI * f / self.sr);
        let w2 = cmul(w, w);
        let eins = (1.0, 0.0);
        let sub = |a: (f64, f64), b: (f64, f64)| (a.0 - b.0, a.1 - b.1);
        let add = |a: (f64, f64), b: (f64, f64)| (a.0 + b.0, a.1 + b.1);
        let sk = |a: (f64, f64), s: f64| (a.0 * s, a.1 * s);
        let num = sk(sub(eins, w2), self.k * c);
        let ew = sub(eins, w);
        let den = add(add(sk(cmul(ew, ew), c * c), sk(sub(eins, w2), self.k * c)), cmul(add(eins, w), add(eins, w)));
        let h = num.0.hypot(num.1) / den.0.hypot(den.1);
        h.powi((self.pole / 2) as i32)
    }

    /// test hook: the 11 products `carrier_i * e_i` of the last sample, before the sum
    pub fn band_signale(&self) -> [f64; BAENDER] { self.bs }
    /// test hook: the 11 carrier band outputs of the last sample, before the envelope
    pub fn band_traeger(&self) -> [f64; BAENDER] { self.tb }
    /// test hook: the 11 envelope follower values `e_i` of the last sample
    pub fn huellen(&self) -> [f64; BAENDER] { self.huelle }

    pub fn zuruecksetzen(&mut self) {
        for b in self.modulator.iter_mut().chain(self.traeger.iter_mut()) {
            for s in b.s.iter_mut() {
                s.leeren();
            }
        }
        self.huelle = [0.0; BAENDER];
        self.hp.leeren();
        self.tb = [0.0; BAENDER];
        self.bs = [0.0; BAENDER];
    }

    /// One sample. `traeger` carrier, `mod_l` / `mod_r` the modulator (mean of both), `zisch` 0..1 (sibilance level),
    /// `mix` 0..1 (1 = vocoded, 0 = dry modulator). Non-finite audio is read as 0 before it reaches any filter (a NaN in an
    /// SVF state never leaves it); a non-finite `zisch` / `mix` reads the defaults 0.3 / 1.
    #[inline]
    pub fn prozess(&mut self, traeger: f32, mod_l: f32, mod_r: f32, zisch: f32, mix: f32) -> f32 {
        let c = endlich(traeger);
        let m = (endlich(mod_l) + endlich(mod_r)) * 0.5;
        let zisch = (if zisch.is_finite() { zisch } else { ZISCH_VOR }).clamp(0.0, 1.0) as f64;
        let mix = (if mix.is_finite() { mix } else { MIX_VOR }).clamp(0.0, 1.0) as f64;
        let mut summe = 0.0;
        for i in 0..BAENDER {
            let b = self.modulator[i].prozess(m).abs();
            let e = self.huelle[i];
            let e = e + (if b > e { self.ca } else { self.cr }) * (b - e);
            let e = if e < NULL { 0.0 } else { e };
            self.huelle[i] = e;
            let t = self.traeger[i].prozess(c);
            self.tb[i] = t;
            self.bs[i] = t * e;
            summe += t * e;
        }
        let hoch = self.hp.prozess(m).1;
        let voc = self.ausgleich * summe + zisch * self.ausgleich * hoch;
        (mix * voc + (1.0 - mix) * m) as f32
    }
}

#[inline]
fn num_exp(phase: f64) -> (f64, f64) { (phase.cos(), phase.sin()) }
#[inline]
fn cmul(a: (f64, f64), b: (f64, f64)) -> (f64, f64) { (a.0 * b.0 - a.1 * b.1, a.0 * b.1 + a.1 * b.0) }
