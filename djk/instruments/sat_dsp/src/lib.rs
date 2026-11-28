//! Cypher Sättigung: tanh-Kennlinie mit Antiderivative Antialiasing erster Ordnung (ADAA1, Bilbao, Esqueda,
//! Parker, Välimäki 2017), gerechnet bei doppelter Abtastrate (Halbband aus `eq_dsp::ueberabtastung`).
//!
//! Warum 2x zusätzlich zu ADAA: Bilbao et al. messen ADAA nur zusammen mit Überabtastung, weil ADAA1 selbst
//! wie ein Mittelwertfilter über ein Sample wirkt und bei 1x die Höhen bedämpft und das Aliasing nicht
//! weit genug drückt (FMS-Pilot 2026-10-15: Säge 50 Hz, Drive 10: 1x −49,8 dB, 2x unter −60 dB; Urteil
//! Andreas „3 ja“). Ab 88 kHz Basisrate entfällt die Überabtastung wie im EQ.
//!
//! Grenzfall x[n] ≈ x[n−1]: unter |Δ| = EPS Rückfall auf tanh des Mittelwerts (Gl. 17 der Arbeit), F1
//! überlaufsicher als |x| + ln1p(e^(−2|x|)) − ln 2 (Urteil „4 ok“). EPS = 1e-5 ist gemessen, nicht der
//! Literatur entnommen; gilt für f64, nicht für f32.
//! Ohne Allokation im Block.
//!
//! Pool object (strand 13, D7, `Saett::neu_pool`): Soft and Hard run at 8x (the 69-tap half-band to 2x, then the two short
//! stages of `stufen` to 4x and 8x), Tanh keeps the 2x path and is delayed so every curve has the latency `LATENZ_POOL`.
//! `Saett::neu` (the VST) is unchanged: 2x for every curve, latency 69.

pub mod stufen;

use eq_dsp::ueberabtastung::{Hoch, Pfad, Runter, LATENZ};

/// Ab dieser Basisrate wird nicht mehr überabgetastet (wie `eq_dsp::OHNE_UEBERABTASTUNG_AB`).
pub const OHNE_UEBERABTASTUNG_AB: f64 = 88000.0;
/// Unter diesem |x − x_vorher| rechnet ADAA1 mit tanh des Mittelwerts statt mit dem Differenzenquotienten.
pub const EPS: f64 = 1e-5;
/// Delay (in 4x samples) that pads the two short stages to a whole number of base samples.
const PAD4: usize = (4 - (2 * stufen::STUFE2_M + stufen::STUFE3_M) % 4) % 4;
/// Latency of the pool object in base samples below 88 kHz, the same for every curve: the 69-tap pair plus the second pair
/// (`m` samples at 2x) plus the third pair (`m` samples at 4x) plus the pad.
pub const LATENZ_POOL: usize = LATENZ + (2 * stufen::STUFE2_M + stufen::STUFE3_M + PAD4) / 4;
/// Delay of the tanh path of the pool object in 2x samples (so its latency is `LATENZ_POOL` too).
const TANH_VERZ2: usize = 2 * (LATENZ_POOL - LATENZ);
/// History of the first stage's 2x output per channel: the tanh delay and the replay that primes the 8x path.
const VERLAUF2: usize = 64;
/// 2x samples replayed through the 8x path when it starts (longer than the memory of its FIR chain, about 47).
const NACHLAUF2: usize = 56;
/// Länge der Trocken-Verzögerung (größte Latenz, die vorkommt).
const TROCKEN_MAX: usize = LATENZ_POOL + 1;

/// Corner of the DC blocker at the output of the wet path (Hz).
pub const DC_ECKE_HZ: f64 = 5.0;
/// A state below this magnitude becomes exactly 0 (denormal-safe even without the caller's FTZ).
const DC_NULL_UNTER: f64 = 1e-30;

/// First-order DC blocker, one channel: y[n] = x[n] - x[n-1] + r y[n-1]. No allocation; `r` comes from the sample rate
/// (computed in `Saett::neu`, never in the block).
#[derive(Clone, Copy, Debug, Default)]
struct DcSperre {
    xp: f64,
    yp: f64,
}

impl DcSperre {
    #[inline]
    fn verarbeite(&mut self, x: f64, r: f64) -> f64 {
        let mut y = x - self.xp + r * self.yp;
        if y.abs() < DC_NULL_UNTER {
            y = 0.0;
        }
        self.xp = x;
        self.yp = y;
        y
    }
}

/// Stammfunktion von tanh: ln cosh x, ohne Überlauf für große |x|.
pub fn f1(x: f64) -> f64 {
    let a = x.abs();
    a + (-2.0 * a).exp().ln_1p() - std::f64::consts::LN_2
}

/// ADAA1 für tanh, ein Kanal.
#[derive(Clone, Copy, Debug)]
pub struct Adaa1 {
    xp: f64,
    f1p: f64,
}

impl Default for Adaa1 {
    fn default() -> Self {
        Adaa1 { xp: 0.0, f1p: f1(0.0) }
    }
}

impl Adaa1 {
    #[inline]
    pub fn verarbeite(&mut self, x: f64) -> f64 {
        let fx = f1(x);
        let d = x - self.xp;
        let y = if d.abs() > EPS { (fx - self.f1p) / d } else { (0.5 * (x + self.xp)).tanh() };
        self.xp = x;
        self.f1p = fx;
        y
    }
    pub fn reset(&mut self) {
        *self = Adaa1::default();
    }
}

/// Clip curve of the wet path (strand 5, D2): `y = c * f(v / c)`, `c` the ceiling.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Kurve {
    /// tanh (the original saturation)
    #[default]
    Tanh,
    /// soft clip: `1.5u - 0.5u^3` up to |u| = 1, then flat
    Weich,
    /// hard clip: `clamp(u, -1, 1)`
    Hart,
}

/// Soft clip curve.
#[inline]
pub fn weich(u: f64) -> f64 {
    if u.abs() <= 1.0 { u * (1.5 - 0.5 * u * u) } else { u.signum() }
}

/// Antiderivative of `weich`.
#[inline]
pub fn weich_f1(u: f64) -> f64 {
    let a = u.abs();
    if a <= 1.0 { a * a * (0.75 - 0.125 * a * a) } else { a - 0.375 }
}

/// Hard clip curve.
#[inline]
pub fn hart(u: f64) -> f64 {
    u.clamp(-1.0, 1.0)
}

/// Antiderivative of `hart`.
#[inline]
pub fn hart_f1(u: f64) -> f64 {
    let a = u.abs();
    if a <= 1.0 { 0.5 * a * a } else { a - 0.5 }
}

/// Knee width `k` of the hard curve for a knee in dB (strand 13, D8): `min(0.75, 1 - 10^(-knie/20))`, 0 for 0 dB.
pub fn knie_breite(knie_db: f64) -> f64 {
    if knie_db <= 0.0 { 0.0 } else { (1.0 - db(-knie_db)).min(0.75) }
}

/// Hard curve with a knee of width `k` > 0: linear up to `1 - k`, a parabola up to `1 + k`, then flat (odd, C1).
#[inline]
pub fn hart_knie(u: f64, k: f64) -> f64 {
    let a = u.abs();
    let y = if a <= 1.0 - k {
        a
    } else if a < 1.0 + k {
        let t = a - (1.0 - k);
        a - t * t / (4.0 * k)
    } else {
        1.0
    };
    y.copysign(u)
}

/// Antiderivative of `hart_knie` (even).
#[inline]
pub fn hart_knie_f1(u: f64, k: f64) -> f64 {
    let a = u.abs();
    if a <= 1.0 - k {
        0.5 * a * a
    } else if a < 1.0 + k {
        let t = a - (1.0 - k);
        0.5 * a * a - t * t * t / (12.0 * k)
    } else {
        let e = 1.0 + k;
        0.5 * e * e - 2.0 * k * k / 3.0 + (a - e)
    }
}

/// ADAA1 of the knee curve.
#[inline]
fn adaa_knie(u: f64, up: f64, k: f64) -> f64 {
    let d = u - up;
    if d.abs() > EPS { (hart_knie_f1(u, k) - hart_knie_f1(up, k)) / d } else { hart_knie(0.5 * (u + up), k) }
}

/// ADAA1 of the polynomial curves from the previous input `up` to `u` (both already divided by the ceiling).
#[inline]
fn adaa_poly(u: f64, up: f64, f: fn(f64) -> f64, ff: fn(f64) -> f64) -> f64 {
    let d = u - up;
    if d.abs() > EPS { (ff(u) - ff(up)) / d } else { f(0.5 * (u + up)) }
}

/// Per channel ADAA state for all curves: the previous raw input and, for tanh, the cached antiderivative of it.
#[derive(Clone, Copy, Debug)]
struct Kanal {
    vp: f64,
    f1p: f64,
    /// `f1p` belongs to `vp / c` of the last call (false after a sample that did not evaluate tanh)
    f1_ok: bool,
}

impl Default for Kanal {
    fn default() -> Self {
        Kanal { vp: 0.0, f1p: f1(0.0), f1_ok: true }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Einstellung {
    /// Verstärkung vor der Kennlinie, dB
    pub drive_db: f64,
    /// Pegel nach der Kennlinie, dB
    pub ausgang_db: f64,
    /// 0 = trocken (um die Latenz verzögert, sonst bitgleich), 1 = voll gesättigt
    pub mix: f64,
    /// clip curve (default tanh)
    pub kurve: Kurve,
    /// ceiling in dBFS, clamped to -24..0 (default 0 = the curve ends at 1)
    pub decke_db: f64,
    /// knee of the hard curve in dB, clamped to 0..12 (default 0 = the plain hard clip); the other curves ignore it
    pub knie_db: f64,
}

impl Default for Einstellung {
    fn default() -> Self {
        Einstellung { drive_db: 12.0, ausgang_db: -6.0, mix: 1.0, kurve: Kurve::Tanh, decke_db: 0.0, knie_db: 0.0 }
    }
}

/// Lowest ceiling in dBFS.
pub const DECKE_MIN_DB: f64 = -24.0;
/// Largest knee in dB.
pub const KNIE_MAX_DB: f64 = 12.0;
/// Length of the cross-fade when the curve changes (s).
const UEBERBLENDEN_S: f64 = 0.010;

fn db(v: f64) -> f64 {
    10f64.powf(v / 20.0)
}

/// One (possibly oversampled) sample through the curve: `c * f(v / c)` with ADAA1, on the ADAA state `ch`. `w` is the weight
/// of the curve `neu` while cross-fading from `alt` (1 when not fading); `knie` the knee width of the hard curve.
#[inline]
#[allow(clippy::too_many_arguments)]
fn kurve_schritt_mit(ch: &mut Kanal, v: f64, c: f64, neu: Kurve, alt: Kurve, w: f64, knie: f64, ueber_max: &mut f64) -> f64 {
    let u = v / c;
    let up = ch.vp / c;
    let r = v.abs() / c;
    if r > *ueber_max {
        *ueber_max = r;
    }
    let fading = w < 1.0;
    let mut tanh_benutzt = false;
    let mut eval = |kv: Kurve, ch: &mut Kanal| -> f64 {
        match kv {
            Kurve::Tanh => {
                tanh_benutzt = true;
                let fx = f1(u);
                let fp = if ch.f1_ok { ch.f1p } else { f1(up) };
                let d = u - up;
                let y = if d.abs() > EPS { (fx - fp) / d } else { (0.5 * (u + up)).tanh() };
                ch.f1p = fx;
                y
            }
            Kurve::Weich => adaa_poly(u, up, weich, weich_f1),
            Kurve::Hart => {
                if knie == 0.0 {
                    adaa_poly(u, up, hart, hart_f1)
                } else {
                    adaa_knie(u, up, knie)
                }
            }
        }
    };
    let y = if fading {
        let ya = eval(alt, ch);
        let yn = eval(neu, ch);
        (1.0 - w) * ya + w * yn
    } else {
        eval(neu, ch)
    };
    ch.f1_ok = tanh_benutzt;
    ch.vp = v;
    c * y
}

/// The 8x part of the pool object for one channel: 2x -> 4x -> 8x, curve, and back to 2x.
#[derive(Clone, Copy, Debug)]
struct Acht {
    hoch2: stufen::Hoch,
    hoch3: stufen::Hoch,
    runter3: stufen::Runter,
    runter2: stufen::Runter,
    // pad delay in the 4x domain (`PAD4` samples)
    pad: [f64; 4],
    ppos: usize,
    kanal: Kanal,
}

impl Acht {
    fn neu() -> Acht {
        let k2 = stufen::Kern::neu(stufen::STUFE2_M, stufen::STUFE2_BETA);
        let k3 = stufen::Kern::neu(stufen::STUFE3_M, stufen::STUFE3_BETA);
        Acht {
            hoch2: stufen::Hoch::neu(k2),
            hoch3: stufen::Hoch::neu(k3),
            runter3: stufen::Runter::neu(k3),
            runter2: stufen::Runter::neu(k2),
            pad: [0.0; 4],
            ppos: 0,
            kanal: Kanal::default(),
        }
    }
    fn reset(&mut self) {
        self.hoch2.reset();
        self.hoch3.reset();
        self.runter3.reset();
        self.runter2.reset();
        self.pad = [0.0; 4];
        self.ppos = 0;
        self.kanal = Kanal::default();
    }
    #[inline]
    fn verzoegere(&mut self, x: f64) -> f64 {
        if PAD4 == 0 {
            return x;
        }
        self.ppos = (self.ppos + 1) % 4;
        self.pad[self.ppos] = x;
        self.pad[(self.ppos + 4 - PAD4) % 4]
    }
    /// One 2x sample through the 8x chain.
    #[inline]
    #[allow(clippy::too_many_arguments)]
    fn verarbeite(&mut self, s: f64, c: f64, neu: Kurve, alt: Kurve, w: f64, knie: f64, ueber_max: &mut f64) -> f64 {
        let p = self.hoch2.verarbeite(s);
        let mut z = [0.0; 2];
        for (j, zj) in z.iter_mut().enumerate() {
            let q = self.verzoegere(p[j]);
            let r = self.hoch3.verarbeite(q);
            let y0 = kurve_schritt_mit(&mut self.kanal, r[0], c, neu, alt, w, knie, ueber_max);
            let y1 = kurve_schritt_mit(&mut self.kanal, r[1], c, neu, alt, w, knie, ueber_max);
            *zj = self.runter3.verarbeite([y0, y1]);
        }
        self.runter2.verarbeite(z)
    }
}

/// Pool-only state (`Saett::neu_pool`): the 8x chains and the history of the first stage's 2x output.
struct Pool {
    acht: [Acht; 2],
    // the 8x chain of this channel ran in the previous sample (else it is primed before it is used again)
    acht_lief: [bool; 2],
    verlauf: [[f64; VERLAUF2]; 2],
    vpos: [usize; 2],
}

impl Pool {
    fn neu() -> Pool {
        Pool { acht: [Acht::neu(); 2], acht_lief: [false; 2], verlauf: [[0.0; VERLAUF2]; 2], vpos: [0; 2] }
    }
    fn leeren(&mut self) {
        for a in self.acht.iter_mut() {
            a.reset();
        }
        self.acht_lief = [false; 2];
        self.verlauf = [[0.0; VERLAUF2]; 2];
        self.vpos = [0; 2];
    }
    #[inline]
    fn schiebe(&mut self, k: usize, x: f64) {
        self.vpos[k] = (self.vpos[k] + 1) % VERLAUF2;
        self.verlauf[k][self.vpos[k]] = x;
    }
    /// The 2x value of channel `k` `alter` samples ago (0 = newest).
    #[inline]
    fn vor(&self, k: usize, alter: usize) -> f64 {
        self.verlauf[k][(self.vpos[k] + VERLAUF2 - alter) % VERLAUF2]
    }
}

pub struct Saett {
    ueber: bool,
    hoch: [Hoch; 2],
    runter: [Runter; 2],
    kanal: [Kanal; 2],
    kurve: Kurve,
    kurve_von: Kurve,
    // Samples left of the cross-fade from `kurve_von` to `kurve` (0 = not fading) and its length.
    blend_n: usize,
    blend_len: usize,
    // Ceiling as a linear factor, smoothed like drive.
    decke: f64,
    decke_ziel: f64,
    // Knee width of the hard curve (`knie_breite`), smoothed like the ceiling; exactly 0 = the plain hard clip.
    knie: f64,
    knie_ziel: f64,
    // Largest |v| / c over the oversampled samples since the last `clip_db` (only values above 1 count).
    ueber_max: f64,
    // DC blocker at the end of the wet path (at high drive the curve turns sub-bass and input DC into an offset that
    // stays); the dry path is untouched, so mix 0 stays bit-equal.
    dc: [DcSperre; 2],
    dc_r: f64,
    // Gleitende Regler (ein Pol, ~10 ms), damit Drive-Änderungen nicht knacken
    drive: f64,
    drive_ziel: f64,
    ausgang: f64,
    ausgang_ziel: f64,
    mix: f64,
    mix_ziel: f64,
    alpha: f64,
    trocken: [[f64; TROCKEN_MAX]; 2],
    tpos: usize,
    // Some: the pool object (8x clip path), None: the VST object of `neu`.
    pool: Option<Box<Pool>>,
}

impl Saett {
    pub fn neu(fs: f64) -> Self {
        Self::mit_pfad(fs, Pfad::erkannt())
    }

    /// Like `neu`, with the oversampler's FIR path forced (tests; `Pfad::Skalar` runs everywhere).
    pub fn mit_pfad(fs: f64, pfad: Pfad) -> Self {
        let mut s = Saett {
            ueber: fs < OHNE_UEBERABTASTUNG_AB,
            hoch: [Hoch::mit_pfad(pfad), Hoch::mit_pfad(pfad)],
            runter: [Runter::mit_pfad(pfad), Runter::mit_pfad(pfad)],
            kanal: [Kanal::default(); 2],
            kurve: Kurve::Tanh,
            kurve_von: Kurve::Tanh,
            blend_n: 0,
            blend_len: ((UEBERBLENDEN_S * fs) as usize).max(1),
            decke: 1.0,
            decke_ziel: 1.0,
            knie: 0.0,
            knie_ziel: 0.0,
            ueber_max: 0.0,
            dc: [DcSperre::default(); 2],
            dc_r: (-2.0 * std::f64::consts::PI * DC_ECKE_HZ / fs).exp(),
            drive: 1.0,
            drive_ziel: 1.0,
            ausgang: 1.0,
            ausgang_ziel: 1.0,
            mix: 1.0,
            mix_ziel: 1.0,
            alpha: 1.0 - (-1.0 / (0.010 * fs)).exp(),
            trocken: [[0.0; TROCKEN_MAX]; 2],
            tpos: 0,
            pool: None,
        };
        s.setze(&Einstellung::default());
        s.drive = s.drive_ziel;
        s.ausgang = s.ausgang_ziel;
        s.mix = s.mix_ziel;
        s.decke = s.decke_ziel;
        s.knie = s.knie_ziel;
        s
    }

    /// The pool object (native insert of the arrangement, strand 13 D7): Soft and Hard clip at 8x, Tanh keeps the 2x
    /// character of `neu` delayed by `LATENZ_POOL - 69`, so the latency is `LATENZ_POOL` for every curve (0 from 88 kHz,
    /// where it behaves like `neu`). Allocates (construction only).
    pub fn neu_pool(fs: f64) -> Self {
        Self::pool_mit_pfad(fs, Pfad::erkannt())
    }

    /// Like `neu_pool`, with the first stage's FIR path forced.
    pub fn pool_mit_pfad(fs: f64, pfad: Pfad) -> Self {
        let mut s = Self::mit_pfad(fs, pfad);
        if s.ueber {
            s.pool = Some(Box::new(Pool::neu()));
        }
        s
    }

    /// Latenz in Basis-Samples (dem Host melden).
    pub fn latenz(&self) -> usize {
        match (self.ueber, self.pool.is_some()) {
            (false, _) => 0,
            (true, false) => LATENZ,
            (true, true) => LATENZ_POOL,
        }
    }

    pub fn setze(&mut self, e: &Einstellung) {
        self.drive_ziel = db(e.drive_db);
        self.ausgang_ziel = db(e.ausgang_db);
        self.mix_ziel = e.mix.clamp(0.0, 1.0);
        self.setze_form(e.kurve, e.decke_db);
        self.setze_knie(e.knie_db);
    }

    /// Curve and ceiling only. A new curve is cross-faded over 10 ms; a non-finite ceiling is ignored.
    pub fn setze_form(&mut self, kurve: Kurve, decke_db: f64) {
        if decke_db.is_finite() {
            self.decke_ziel = db(decke_db.clamp(DECKE_MIN_DB, 0.0));
        }
        if kurve != self.kurve {
            self.kurve_von = self.kurve;
            self.kurve = kurve;
            self.blend_n = self.blend_len;
        }
    }

    /// Knee of the hard curve in dB (strand 13, D8), clamped to 0..12, smoothed like the ceiling; non-finite is ignored.
    /// 0 is the plain hard clip (the same code as before the knee existed).
    pub fn setze_knie(&mut self, knie_db: f64) {
        if knie_db.is_finite() {
            self.knie_ziel = knie_breite(knie_db.clamp(0.0, KNIE_MAX_DB));
        }
    }

    /// How far the driven signal went over the ceiling since the last call, in dB (largest `20 log10(|v| / c)` over the
    /// oversampled samples with `|v| > c`), 0 if never. Reads and resets.
    pub fn clip_db(&mut self) -> f32 {
        let m = std::mem::replace(&mut self.ueber_max, 0.0);
        if m > 1.0 { (20.0 * m.log10()) as f32 } else { 0.0 }
    }

    pub fn leeren(&mut self) {
        for k in 0..2 {
            self.hoch[k].reset();
            self.runter[k].reset();
            self.kanal[k] = Kanal::default();
            self.dc[k] = DcSperre::default();
        }
        if let Some(p) = self.pool.as_mut() {
            p.leeren();
        }
        self.trocken = [[0.0; TROCKEN_MAX]; 2];
        self.tpos = 0;
        self.drive = self.drive_ziel;
        self.ausgang = self.ausgang_ziel;
        self.mix = self.mix_ziel;
        self.decke = self.decke_ziel;
        self.knie = self.knie_ziel;
        self.blend_n = 0;
        self.kurve_von = self.kurve;
        self.ueber_max = 0.0;
    }

    /// One (possibly oversampled) sample of channel `k` through the curve: `c * f(v / c)` with ADAA1. `w` is the weight of
    /// the new curve while cross-fading (1 when not fading).
    #[inline]
    fn kurve_schritt(&mut self, k: usize, v: f64, w: f64) -> f64 {
        kurve_schritt_mit(&mut self.kanal[k], v, self.decke, self.kurve, self.kurve_von, w, self.knie, &mut self.ueber_max)
    }

    /// Ein Basis-Sample eines Kanals durch die nasse Kette (ohne Mix und Ausgang).
    #[inline]
    fn nass(&mut self, k: usize, x: f64, w: f64) -> f64 {
        let v = x * self.drive;
        if self.ueber {
            let [a, b] = self.hoch[k].verarbeite(v);
            let y = if self.pool.is_some() {
                self.nass_pool(k, a, b, w)
            } else {
                [self.kurve_schritt(k, a, w), self.kurve_schritt(k, b, w)]
            };
            self.runter[k].verarbeite(y)
        } else {
            self.kurve_schritt(k, v, w)
        }
    }

    /// The pool object's curve stage for the two 2x samples `a`, `b` of channel `k`: Tanh on the delayed 2x samples, Soft
    /// and Hard through the 8x chain. While the curve changes between Tanh and the others both paths run and their 2x
    /// outputs are cross-faded (weight constant over the two samples of one base sample).
    #[inline]
    fn nass_pool(&mut self, k: usize, a: f64, b: f64, w: f64) -> [f64; 2] {
        let fading = w < 1.0;
        let (neu, alt) = (self.kurve, self.kurve_von);
        let (c, knie) = (self.decke, self.knie);
        // weight of the tanh path; the 8x path gets the rest
        let mut wt = if neu == Kurve::Tanh { w } else { 0.0 };
        if fading && alt == Kurve::Tanh {
            wt += 1.0 - w;
        }
        let w8 = 1.0 - wt;
        // curves of the 8x path: a fade between Soft and Hard stays inside it
        let (n8, a8, wi) = match (neu, alt) {
            (Kurve::Tanh, x) => (x, x, 1.0),
            (x, Kurve::Tanh) => (x, x, 1.0),
            (x, y) if fading => (x, y, w),
            (x, _) => (x, x, 1.0),
        };
        let mut ueber_max = self.ueber_max;
        let p = self.pool.as_mut().expect("pool object");
        p.schiebe(k, a);
        p.schiebe(k, b);
        let yt = if wt > 0.0 {
            let (ta, tb) = (p.vor(k, TANH_VERZ2 + 1), p.vor(k, TANH_VERZ2));
            let ch = &mut self.kanal[k];
            [
                kurve_schritt_mit(ch, ta, c, Kurve::Tanh, Kurve::Tanh, 1.0, knie, &mut ueber_max),
                kurve_schritt_mit(ch, tb, c, Kurve::Tanh, Kurve::Tanh, 1.0, knie, &mut ueber_max),
            ]
        } else {
            // keep the tanh ADAA state current at no cost: the next tanh sample sees the right previous input
            let ch = &mut self.kanal[k];
            ch.vp = p.vor(k, TANH_VERZ2);
            ch.f1_ok = false;
            [0.0; 2]
        };
        let y8 = if w8 > 0.0 {
            if !p.acht_lief[k] {
                // prime the chain: replay the recent 2x history so its state is what it would be had it always run
                let mut stumm = 0.0;
                p.acht[k].reset();
                for alter in (2..NACHLAUF2 + 2).rev() {
                    let s = p.vor(k, alter);
                    p.acht[k].verarbeite(s, c, n8, a8, wi, knie, &mut stumm);
                }
            }
            let acht = &mut p.acht[k];
            [acht.verarbeite(a, c, n8, a8, wi, knie, &mut ueber_max), acht.verarbeite(b, c, n8, a8, wi, knie, &mut ueber_max)]
        } else {
            [0.0; 2]
        };
        p.acht_lief[k] = w8 > 0.0;
        self.ueber_max = ueber_max;
        if w8 == 0.0 {
            yt
        } else if wt == 0.0 {
            y8
        } else {
            [wt * yt[0] + w8 * y8[0], wt * yt[1] + w8 * y8[1]]
        }
    }

    pub fn block(&mut self, l: &mut [f32], r: &mut [f32]) {
        let lat = self.latenz();
        for i in 0..l.len().min(r.len()) {
            self.drive += self.alpha * (self.drive_ziel - self.drive);
            self.ausgang += self.alpha * (self.ausgang_ziel - self.ausgang);
            self.mix += self.alpha * (self.mix_ziel - self.mix);
            self.decke += self.alpha * (self.decke_ziel - self.decke);
            if self.knie != self.knie_ziel {
                self.knie += self.alpha * (self.knie_ziel - self.knie);
                if (self.knie - self.knie_ziel).abs() < 1e-9 {
                    self.knie = self.knie_ziel;
                }
            }
            let w = if self.blend_n > 0 {
                let w = 1.0 - self.blend_n as f64 / self.blend_len as f64;
                self.blend_n -= 1;
                w
            } else {
                1.0
            };
            self.tpos = (self.tpos + 1) % TROCKEN_MAX;
            let lies = (self.tpos + TROCKEN_MAX - lat) % TROCKEN_MAX;
            for (k, s) in [(0usize, &mut l[i]), (1, &mut r[i])] {
                let x = *s as f64;
                self.trocken[k][self.tpos] = x;
                let t = self.trocken[k][lies];
                let n = self.nass(k, x, w) * self.ausgang;
                let n = self.dc[k].verarbeite(n, self.dc_r);
                *s = (t + self.mix * (n - t)) as f32;
            }
        }
    }
}
