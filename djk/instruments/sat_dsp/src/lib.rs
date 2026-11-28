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

use eq_dsp::ueberabtastung::{Hoch, Pfad, Runter, LATENZ};

/// Ab dieser Basisrate wird nicht mehr überabgetastet (wie `eq_dsp::OHNE_UEBERABTASTUNG_AB`).
pub const OHNE_UEBERABTASTUNG_AB: f64 = 88000.0;
/// Unter diesem |x − x_vorher| rechnet ADAA1 mit tanh des Mittelwerts statt mit dem Differenzenquotienten.
pub const EPS: f64 = 1e-5;
/// Länge der Trocken-Verzögerung (größte Latenz, die vorkommt).
const TROCKEN_MAX: usize = LATENZ + 1;

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
}

impl Default for Einstellung {
    fn default() -> Self {
        Einstellung { drive_db: 12.0, ausgang_db: -6.0, mix: 1.0, kurve: Kurve::Tanh, decke_db: 0.0 }
    }
}

/// Lowest ceiling in dBFS.
pub const DECKE_MIN_DB: f64 = -24.0;
/// Length of the cross-fade when the curve changes (s).
const UEBERBLENDEN_S: f64 = 0.010;

fn db(v: f64) -> f64 {
    10f64.powf(v / 20.0)
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
        };
        s.setze(&Einstellung::default());
        s.drive = s.drive_ziel;
        s.ausgang = s.ausgang_ziel;
        s.mix = s.mix_ziel;
        s.decke = s.decke_ziel;
        s
    }

    /// Latenz in Basis-Samples (dem Host melden).
    pub fn latenz(&self) -> usize {
        if self.ueber { LATENZ } else { 0 }
    }

    pub fn setze(&mut self, e: &Einstellung) {
        self.drive_ziel = db(e.drive_db);
        self.ausgang_ziel = db(e.ausgang_db);
        self.mix_ziel = e.mix.clamp(0.0, 1.0);
        self.setze_form(e.kurve, e.decke_db);
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
        self.trocken = [[0.0; TROCKEN_MAX]; 2];
        self.tpos = 0;
        self.drive = self.drive_ziel;
        self.ausgang = self.ausgang_ziel;
        self.mix = self.mix_ziel;
        self.decke = self.decke_ziel;
        self.blend_n = 0;
        self.kurve_von = self.kurve;
        self.ueber_max = 0.0;
    }

    /// One (possibly oversampled) sample of channel `k` through the curve: `c * f(v / c)` with ADAA1. `w` is the weight of
    /// the new curve while cross-fading (1 when not fading).
    #[inline]
    fn kurve_schritt(&mut self, k: usize, v: f64, w: f64) -> f64 {
        let c = self.decke;
        let u = v / c;
        let ch = &mut self.kanal[k];
        let up = ch.vp / c;
        let r = v.abs() / c;
        if r > self.ueber_max {
            self.ueber_max = r;
        }
        let fading = w < 1.0;
        let (neu, alt) = (self.kurve, self.kurve_von);
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
                Kurve::Hart => adaa_poly(u, up, hart, hart_f1),
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

    /// Ein Basis-Sample eines Kanals durch die nasse Kette (ohne Mix und Ausgang).
    #[inline]
    fn nass(&mut self, k: usize, x: f64, w: f64) -> f64 {
        let v = x * self.drive;
        if self.ueber {
            let [a, b] = self.hoch[k].verarbeite(v);
            let y = [self.kurve_schritt(k, a, w), self.kurve_schritt(k, b, w)];
            self.runter[k].verarbeite(y)
        } else {
            self.kurve_schritt(k, v, w)
        }
    }

    pub fn block(&mut self, l: &mut [f32], r: &mut [f32]) {
        let lat = self.latenz();
        for i in 0..l.len().min(r.len()) {
            self.drive += self.alpha * (self.drive_ziel - self.drive);
            self.ausgang += self.alpha * (self.ausgang_ziel - self.ausgang);
            self.mix += self.alpha * (self.mix_ziel - self.mix);
            self.decke += self.alpha * (self.decke_ziel - self.decke);
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
