//! Physical string model (type 37, `saite`): a single-delay-loop digital waveguide (extended Karplus-Strong).
//!
//! **Loop.** `v[n] = A(L(v[n - N])) + c[n]`: an integer delay line of `N` samples, a one-pole loss filter
//! `L(z) = b0 / (1 + a z^-1)` and a first-order allpass `A(z) = (eta + z^-1) / (1 + eta z^-1)` for the fractional part of
//! the delay. `c` is the excitation after the pick-position comb. The output is `v` (the sample written into the line),
//! optionally through the body filter. An allpass was chosen over Lagrange interpolation because its gain is 1 at every
//! frequency, so the fractional delay does not change the decay.
//!
//! **Damping.** The pole `a` (0 ..= -1) comes from the damping knob, designed after Valimaki et al. from the loop gains
//! that give `ausklang` at DC and `ausklang * 10^(-3 daempfung)` at Nyquist.
//!
//! **Pitch and decay are exact (pole placement).** The loop's pole of the fundamental is placed at `z* = rho e^{j w0}`,
//! `w0 = 2 pi f0 / sr`, `rho = 10^(-3 / (sr T60))`, by solving `G(z*) z*^-N = 1`: `N` is the integer part of one period
//! minus the loss filter's phase delay at `z*`, `eta` makes the phase 0 (a quadratic in `eta`, the root next to the
//! unit-circle solution `sin(w0 (1 - D) / 2) / sin(w0 (1 + D) / 2)`, `D` the fractional rest), and `b0` makes the
//! magnitude 1. The fundamental then rings at `f0` and loses 60 dB in `T60` to rounding, also where a strong low-pass
//! bends the phase (a unit-circle design is off by up to 0.17 cent there, the textbook `(1 - D) / (1 + D)` by 6 cent at
//! 4186 Hz).
//!
//! **DC.** Everything that enters the loop passes the pick-position comb, which has a zero at DC. A step on `x` still
//! leaves a pulse of `M` samples after the comb, whose area would charge the loop's DC mode; a DC blocker on the
//! excitation, `(1 + r) / 2 (1 - z^-1) / (1 - r z^-1)` with its corner at `f0 / 8`, makes the area 0. It sits outside the
//! loop on purpose: inside, its phase lead varies with frequency and detuned partial 2 by -11.5 cent (measured at
//! 220 Hz), and a fixed corner capped long decays at high notes.
//!
//! **Limits that keep it stable.** The loss filter's DC gain `b0 / (1 + a)` is the loop's largest gain (the
//! low-pass falls with frequency, the allpass is 1). It must stay at or below `G_MAX` (stable) and at or below
//! `g0^DC_EXPONENT`, `g0` the fundamental's gain per period: the loop's DC mode then dies at least half as fast as the
//! fundamental in dB. When the damping asks for more (a high note with a long decay), `a` is reduced by bisection until the
//! limits hold: the damping is limited, the decay and the pitch are not.
//!
//! **Exciters** (`anreger`): 0 `rauschen` (one period of white noise through a one-pole low-pass set by `hell`: classic
//! Karplus-Strong), 1 `zupfen` (a raised-cosine pulse whose width falls from half a period to 1/128 period as `hell`
//! rises), 2 `hammer` (a sin^3 force pulse, contact time 4 ms .. 0.5 ms by `hell`, shorter at higher velocity, as felt
//! hammers do), 3 `keiner` (only the input `x`). The internal exciter and `x` both pass the pick-position comb
//! `1 - z^-M`, `M = lage * sr / f0` (fractional, linear between two taps): harmonics that have a node at the pick point
//! are missing, and the comb has a zero at DC (see **DC**).
//!
//! **Body** (`koerper`): 0 none, 1 guitar, 2 harp, 3 piano soundboard: five resonances (band-pass biquads, zero gain at
//! DC) plus a direct share, mixed in by `koerper_mix`.
//!
//! **Real time.** The buffers are allocated in `Stimme::neu` (translation). `prozess` does not allocate, lock or panic:
//! every index is masked, every input is checked for being finite and clamped, every written value is clamped to
//! +-`GRENZE` and values below `NULL` are flushed to 0 (no subnormals while a note dies away; a body band is flushed
//! as a whole, see `prozess`). The loop design runs only when pitch, decay or damping change; while only the pitch
//! moves (vibrato, glide, within 2 %) the loss pole is kept and only delay, allpass and gain follow (`nachfuehren`),
//! every 8th sample while it moves; when it holds, the next design is exact again.

/// Lowest pitch; lower `hz` is clamped (the delay line is sized for it at translation).
pub const MIN_HZ: f64 = 20.0;
/// Highest pitch as a fraction of the sample rate (sr / 8: 6 kHz at 48 kHz, at least 8 samples per period).
pub const MAX_HZ_ANTEIL: f64 = 0.125;
/// Decay time range (T60 of the fundamental) in seconds.
pub const AUSKLANG_MIN: f32 = 0.01;
pub const AUSKLANG_MAX: f32 = 60.0;
/// Pick position range as a fraction of the string length, measured from the bridge.
pub const LAGE_MIN: f32 = 0.02;
pub const LAGE_MAX: f32 = 0.5;
/// Largest loop gain at DC. Below 1, so even a value that slips past the comb dies away.
pub const G_MAX: f64 = 1.0 - 1e-6;
/// Every value written into the loop is clamped to this (+12 dBFS); with loop gain < 1 the state stays bounded.
pub const GRENZE: f32 = 4.0;
/// Smaller values become 0 (no subnormals).
pub const NULL: f32 = 1e-20;
/// Level of the internal exciters at velocity 1.
pub const PEGEL: f32 = 0.5;
/// Names of the exciters, index = value `anreger`.
pub const ANREGER: [&str; 4] = ["rauschen", "zupfen", "hammer", "keiner"];
/// Names of the bodies, index = value `koerper`.
pub const KOERPER: [&str; 4] = ["keiner", "gitarre", "harfe", "klavier"];
/// Resonances per body.
pub const MODEN: usize = 5;

/// The loss filter's DC gain may be at most the per-period gain of the fundamental to this power: the loop's DC mode
/// then loses at least half as many dB per period as the fundamental, so no DC residue outlives a note.
pub const DC_EXPONENT: f64 = 0.5;
/// Corner of the DC blocker on the excitation, as a fraction of the fundamental.
pub const DC_ANTEIL: f64 = 0.125;

/// Loop design for one pitch, decay and damping.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Schleife {
    /// integer delay in samples (>= 1)
    pub n: usize,
    /// allpass coefficient
    pub eta: f64,
    /// loss filter `b0 / (1 + a z^-1)`
    pub b0: f64,
    pub a: f64,
    /// pole the damping asked for (before the feasibility limit)
    pub a_soll: f64,
    /// pole of the DC blocker on the excitation (outside the loop), `(1 + r) / 2 (1 - z^-1) / (1 - r z^-1)`
    pub r: f64,
    /// fundamental after clamping, and the radius per sample of its loop pole, `10^(-3 / (sr T60))`
    pub f0: f64,
    pub radius: f64,
}

type K = realfft::num_complex::Complex<f64>;

/// Phase delay (samples), group delay (samples) and magnitude of `1 / (1 - p z^-1)` at `w` rad/sample.
#[inline]
fn pol(p: f64, w: f64) -> (f64, f64, f64) {
    let (c, s) = (w.cos(), w.sin());
    let (re, im) = (1.0 - p * c, p * s);
    // arg H = -arg(1 - p e^{-jw}) = -atan2(p sin w, 1 - p cos w); phase delay = -arg H / w
    (im.atan2(re) / w, (p * c - p * p) / (1.0 - 2.0 * p * c + p * p), 1.0 / re.hypot(im))
}

/// Phase delay and group delay of the allpass `(eta + z^-1) / (1 + eta z^-1)` at `w`.
#[inline]
fn allpass(eta: f64, w: f64) -> (f64, f64) {
    ((w - 2.0 * (eta * w.sin()).atan2(1.0 + eta * w.cos())) / w, (1.0 - eta * eta) / (1.0 + 2.0 * eta * w.cos() + eta * eta))
}

impl Schleife {
    /// The loop `G(z) z^-N` at a point `z` of the complex plane.
    pub fn bei_z(&self, z: K) -> K {
        let u = z.inv();
        K::new(self.b0, 0.0) / (1.0 + self.a * u) * (self.eta + u) / (1.0 + self.eta * u) * u.powu(self.n as u32)
    }

    /// Phase delay (samples), group delay (samples) and gain of the loop on the unit circle at `w` rad/sample.
    pub fn bei(&self, w: f64) -> (f64, f64, f64) {
        let (lp, lg, lm) = pol(-self.a, w);
        let (ap, ag) = allpass(self.eta, w);
        (self.n as f64 + lp + ap, self.n as f64 + lg + ag, self.b0 * lm)
    }

    /// T60 (seconds) of the loop mode near `w` (first order in the pole radius: the mode shrinks by the loop gain once
    /// per loop group delay). Exact for the fundamental only by construction of `entwurf`; used for the upper partials.
    pub fn t60_bei(&self, w: f64, sr: f64) -> f64 {
        let (_, tg, g) = self.bei(w);
        -3.0 * tg / (sr * g.log10())
    }
}

/// Values of one design that do not depend on the loss pole.
struct Vorbereitung {
    f0: f64,
    d: f64,
    w: f64,
    radius: f64,
    g0: f64,
    a_soll: f64,
    zs: K,
    u: K,
    r: f64,
}

impl Vorbereitung {
    fn neu(f0: f64, sr: f64, t60: f64, daempfung: f64) -> Vorbereitung {
        let f0 = if f0.is_finite() { f0.clamp(MIN_HZ, MAX_HZ_ANTEIL * sr) } else { MIN_HZ };
        let t60 = if t60.is_finite() { t60.clamp(AUSKLANG_MIN as f64, AUSKLANG_MAX as f64) } else { 2.0 };
        let daempfung = if daempfung.is_finite() { daempfung.clamp(0.0, 1.0) } else { 0.5 };
        let w = std::f64::consts::TAU * f0 / sr;
        let radius = 10f64.powf(-3.0 / (sr * t60));
        let g0 = 10f64.powf(-3.0 / (f0 * t60));
        let g_pi = 10f64.powf(-3.0 / (f0 * t60 * 10f64.powf(-3.0 * daempfung)));
        let zs = K::from_polar(radius, w);
        Vorbereitung {
            f0,
            d: sr / f0,
            w,
            radius,
            g0,
            // one-pole design from the loop gains at DC and Nyquist (Valimaki): a = (g_pi - g0) / (g_pi + g0)
            a_soll: (g_pi - g0) / (g_pi + g0),
            zs,
            u: zs.inv(),
            r: (-std::f64::consts::TAU * DC_ANTEIL * f0 / sr).exp(),
        }
    }

    fn mass(&self, a: f64) -> Option<Schleife> {
        let (d, w, u, zs, f0, radius, r, a_soll) = (self.d, self.w, self.u, self.zs, self.f0, self.radius, self.r, self.a_soll);
        // integer part from the loss filter's phase at z* (off the unit circle a strong low-pass turns the phase much
        // more than on it); the allpass takes the rest, 0.5 ..< 1.5 samples
        let rest = d + (1.0 / (1.0 + a * u)).arg() / w;
        if rest < 1.5 {
            return None;
        }
        let n = (rest - 0.5).floor() as usize;
        let delta = rest - n as f64;
        let eta0 = (w * (1.0 - delta) / 2.0).sin() / (w * (1.0 + delta) / 2.0).sin();
        // phase the allpass must bring at z*: arg A(z*) = theta
        let q = u.powu(n as u32) / (1.0 + a * u);
        let e = K::from_polar(1.0, -q.arg());
        // (eta + u)(1 + eta conj(u)) = conj(u) eta^2 + (1 + |u|^2) eta + u must point along e^{j theta}:
        // Im(e^{-j theta} P(eta)) = 0, a quadratic in eta
        let ec = e.conj();
        let (k2, k1, k0) = ((ec * u.conj()).im, (ec * (1.0 + u.norm_sqr())).im, (ec * u).im);
        let p = |eta: f64| ec * (u.conj() * eta * eta + (1.0 + u.norm_sqr()) * eta + u);
        let wurzeln = if k2.abs() < 1e-300 {
            [-k0 / k1, f64::NAN]
        } else {
            let disk = k1 * k1 - 4.0 * k2 * k0;
            if disk < 0.0 {
                return None;
            }
            let s = disk.sqrt();
            [(-k1 + s) / (2.0 * k2), (-k1 - s) / (2.0 * k2)]
        };
        // of the two roots, the one near the unit-circle solution eta0
        let eta = wurzeln.into_iter().filter(|x| x.is_finite() && x.abs() < 1.0 && p(*x).re > 0.0)
            .min_by(|x, y| (x - eta0).abs().total_cmp(&(y - eta0).abs()))?;
        let mut s = Schleife { n, eta, b0: 1.0, a, a_soll, r, f0, radius };
        s.b0 = 1.0 / s.bei_z(zs).norm();
        Some(s)
    }

    /// Feasible: the loss filter's DC gain (the loop's largest gain: the low-pass falls with frequency, the allpass is 1)
    /// stays below G_MAX and below g0^DC_EXPONENT, so the loop is stable and its DC mode dies with the note.
    fn geht(&self, s: &Option<Schleife>) -> bool {
        let dc_grenze = G_MAX.min(self.g0.powf(DC_EXPONENT));
        s.map_or(false, |s| s.b0 / (1.0 + s.a) <= dc_grenze)
    }
}

/// Designs the loop for pitch `f0` (clamped to `MIN_HZ ..= sr / 8`), decay `t60` (s) and damping `daempfung` (0..1).
///
/// The loop pole of the fundamental is placed exactly at `z* = radius e^{j w0}`, `radius = 10^(-3 / (sr T60))`: the
/// allpass coefficient makes `arg(G(z*) z*^-N) = 0` (a quadratic in `eta`), `b0` makes `|G(z*) z*^-N| = 1`. So the
/// fundamental rings at `f0` and loses 60 dB in `T60`, to rounding, whatever the loss filter does to the phase.
pub fn entwurf(f0: f64, sr: f64, t60: f64, daempfung: f64) -> Schleife {
    let v = Vorbereitung::neu(f0, sr, t60, daempfung);
    let s = v.mass(v.a_soll);
    if v.geht(&s) {
        return s.unwrap();
    }
    // the feasible set is an interval from a = 0 (no low-pass) toward a_soll: bisect for the strongest feasible damping
    let (mut gut, mut schlecht) = (0.0f64, v.a_soll);
    for _ in 0..40 {
        let m = 0.5 * (gut + schlecht);
        if v.geht(&v.mass(m)) { gut = m } else { schlecht = m }
    }
    // 1 % margin on 1 + a (slightly less damping), so that `nachfuehren` keeps this pole while the pitch moves a little
    let mit_rand = (-1.0 + (1.0 + gut) * RAND).min(0.0);
    let s = v.mass(mit_rand);
    let gut = if v.geht(&s) { mit_rand } else { gut };
    // a = 0 is the plain delay with the allpass, always solvable (d >= 8); its gain only passes G_MAX for decays near the
    // 60 s top at high notes: then it is capped and the decay gets shorter
    let mut s = v.mass(gut).unwrap_or(Schleife { n: (v.d - 1.0).floor() as usize, eta: 0.0, b0: 0.0, a: 0.0, a_soll: v.a_soll, r: v.r, f0: v.f0, radius: v.radius });
    if s.b0 / (1.0 + s.a) > G_MAX {
        s.b0 = G_MAX * (1.0 + s.a);
    }
    s
}

/// Margin on `1 + a` after the bisection.
const RAND: f64 = 1.01;
/// `Stimme` keeps the loss pole of the last full design while only the pitch moves, by at most this ratio.
pub const NACHFUEHREN: f64 = 0.02;
/// While the pitch moves, `Stimme` follows it every this many samples (0.17 ms at 48 kHz).
pub const NACHFUEHR_TAKT: u32 = 8;

/// The design for a new pitch with the loss pole `a` of an earlier design (same decay and damping): only `N`, `eta`
/// and `b0` change. `None` when `a` does not meet the limits at this pitch; then a full `entwurf` is needed. This is the
/// cheap path for vibrato and glides (no bisection).
pub fn nachfuehren(f0: f64, sr: f64, t60: f64, daempfung: f64, a: f64) -> Option<Schleife> {
    let v = Vorbereitung::neu(f0, sr, t60, daempfung);
    let s = v.mass(a.max(v.a_soll));
    if v.geht(&s) { s } else { None }
}

/// Band-pass biquad (RBJ, 0 dB peak), coefficients `b0, b2 = -b0, a1, a2` (b1 = 0).
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Band {
    b0: f64,
    a1: f64,
    a2: f64,
    g: f64,
}

/// Body resonances (Hz, Q, gain) and the direct share. Plausible mode sets, not measurements of an instrument.
fn moden(koerper: usize) -> ([(f64, f64, f64); MODEN], f64) {
    match koerper {
        // guitar: Helmholtz air mode near 100 Hz, top plate near 200 and 400 Hz, upper plate modes
        1 => ([(100.0, 14.0, 1.4), (205.0, 18.0, 1.0), (400.0, 12.0, 0.6), (1050.0, 6.0, 0.35), (2600.0, 3.0, 0.25)], 0.35),
        // harp: a long soundboard, broad low modes
        2 => ([(140.0, 8.0, 0.9), (290.0, 10.0, 0.8), (560.0, 8.0, 0.6), (1200.0, 5.0, 0.4), (2400.0, 3.0, 0.25)], 0.5),
        // piano soundboard: dense, low-Q modes
        3 => ([(95.0, 6.0, 0.6), (190.0, 7.0, 0.6), (420.0, 6.0, 0.6), (900.0, 5.0, 0.5), (2100.0, 4.0, 0.35)], 0.6),
        _ => ([(1000.0, 1.0, 0.0); MODEN], 1.0),
    }
}

/// Fixed values of a string node, computed at translation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Einstellung {
    /// index into `ANREGER`
    pub anreger: usize,
    /// index into `KOERPER`
    pub koerper: usize,
    pub saat: u32,
    baender: [Band; MODEN],
    direkt: f64,
}

impl Einstellung {
    pub fn neu(anreger: usize, koerper: usize, saat: u32, sr: f32) -> Einstellung {
        let koerper = koerper.min(KOERPER.len() - 1);
        let (m, direkt) = moden(koerper);
        let baender = std::array::from_fn(|i| {
            let (f, q, g) = m[i];
            let w = std::f64::consts::TAU * f.min(0.45 * sr as f64) / sr as f64;
            let alpha = w.sin() / (2.0 * q);
            let a0 = 1.0 + alpha;
            Band { b0: alpha / a0, a1: -2.0 * w.cos() / a0, a2: (1.0 - alpha) / a0, g }
        });
        Einstellung { anreger: anreger.min(ANREGER.len() - 1), koerper, saat, baender, direkt }
    }
}

/// Inputs of one sample.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Eingabe {
    /// external excitation, added before the pick-position comb
    pub x: f32,
    pub hz: f32,
    /// > 0.5 starts the internal exciter
    pub trig: f32,
    /// velocity 0..1: level of the internal exciter, and contact time of the hammer
    pub vel: f32,
    /// T60 of the fundamental in seconds
    pub ausklang: f32,
    /// 0..1, extra loss of the upper partials
    pub daempfung: f32,
    /// 0..1, brightness of the exciter
    pub hell: f32,
    /// pick position 0.02..0.5
    pub lage: f32,
    /// body mix 0..1
    pub koerper_mix: f32,
}

#[inline]
fn endlich(x: f32, sonst: f32) -> f32 { if x.is_finite() { x } else { sonst } }

#[inline]
fn null(x: f64) -> f64 { if x.abs() < NULL as f64 { 0.0 } else { x } }

/// State of one voice.
pub struct Stimme {
    buf: Box<[f32]>,
    maske: usize,
    pos: usize,
    /// delay line of the pick-position comb
    kamm: Box<[f32]>,
    kmaske: usize,
    kpos: usize,
    s: Schleife,
    /// pitch, decay and damping the design `s` belongs to (NaN = none yet), and the pitch of the last full design
    alt: (f32, f32, f32),
    f0_entwurf: f32,
    /// samples to wait before the pitch is followed again
    warte: u32,
    /// loss filter output, allpass input and output of the last sample; DC blocker input and output (excitation)
    lz: f64,
    dx: f64,
    dy: f64,
    ax: f64,
    ay: f64,
    /// exciter: kind, sample count, length, pulse width, level, low-pass coefficient and state
    art: usize,
    en: u32,
    elaenge: u32,
    ebreite: f32,
    epegel: f32,
    ek: f32,
    elp: f32,
    zufall: u32,
    /// body band-pass states (transposed direct form II, f64: high-Q f32 resonators hold limit cycles near 1e-18)
    kz: [[f64; 2]; MODEN],
}

/// Delay line length for sample rate `sr`: a power of two that holds the period of `MIN_HZ` plus margin.
pub fn puffer_laenge(sr: f32) -> usize { ((sr as f64 / MIN_HZ).ceil() as usize + 8).next_power_of_two() }

impl Stimme {
    /// Voice `stimme` of a node; allocates the delay lines (call at translation).
    pub fn neu(stimme: usize, e: &Einstellung, sr: f32) -> Stimme {
        let l = puffer_laenge(sr);
        let k = (l / 2).max(2);
        let mut v = Stimme {
            buf: vec![0.0; l].into_boxed_slice(),
            maske: l - 1,
            pos: 0,
            kamm: vec![0.0; k].into_boxed_slice(),
            kmaske: k - 1,
            kpos: 0,
            s: entwurf(MIN_HZ, sr as f64, 2.0, 0.5),
            alt: (f32::NAN, f32::NAN, f32::NAN),
            f0_entwurf: f32::NAN,
            warte: 0,
            lz: 0.0,
            dx: 0.0,
            dy: 0.0,
            ax: 0.0,
            ay: 0.0,
            art: 0,
            en: 0,
            elaenge: 0,
            ebreite: 1.0,
            epegel: 0.0,
            ek: 1.0,
            elp: 0.0,
            zufall: 1,
            kz: [[0.0; 2]; MODEN],
        };
        v.zuruecksetzen(stimme, e);
        v
    }

    /// Back to the state after `neu`, without allocating.
    pub fn zuruecksetzen(&mut self, stimme: usize, e: &Einstellung) {
        self.buf.iter_mut().for_each(|x| *x = 0.0);
        self.kamm.iter_mut().for_each(|x| *x = 0.0);
        self.pos = 0;
        self.kpos = 0;
        self.alt = (f32::NAN, f32::NAN, f32::NAN);
        self.f0_entwurf = f32::NAN;
        self.warte = 0;
        self.lz = 0.0;
        self.dx = 0.0;
        self.dy = 0.0;
        self.ax = 0.0;
        self.ay = 0.0;
        self.art = e.anreger;
        self.en = 0;
        self.elaenge = 0;
        self.ebreite = 1.0;
        self.epegel = 0.0;
        self.ek = 1.0;
        self.elp = 0.0;
        let s = 0x9E37_79B9u32 ^ (stimme as u32 + 1).wrapping_mul(0x85EB_CA6B) ^ e.saat.wrapping_mul(0xC2B2_AE35);
        self.zufall = if s == 0 { 0x2545_F491 } else { s };
        self.kz = [[0.0; 2]; MODEN];
    }

    /// Current loop design (for tests).
    pub fn schleife(&self) -> Schleife { self.s }

    /// True when every state of the voice is exactly 0 (for the subnormal test).
    pub fn still(&self) -> bool {
        self.buf.iter().all(|x| *x == 0.0) && self.lz == 0.0 && self.dx == 0.0 && self.dy == 0.0 && self.ax == 0.0 && self.ay == 0.0 && self.kz.iter().flatten().all(|x| *x == 0.0)
    }

    #[inline]
    fn rauschen(&mut self) -> f32 {
        let mut x = self.zufall;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.zufall = x;
        (x as f32 * (1.0 / 2_147_483_648.0)) - 1.0
    }

    /// Starts the internal exciter for the current loop (`d` = period in samples).
    fn anschlag(&mut self, e: &Einstellung, sr: f32, d: f32, vel: f32, hell: f32) {
        self.art = e.anreger;
        self.en = 0;
        self.epegel = PEGEL * vel;
        self.elp = 0.0;
        match e.anreger {
            0 => {
                // one period of noise; low-pass from the fundamental (hell 0) up to no filter (hell 1)
                self.elaenge = d.round().max(1.0) as u32;
                let f0 = sr / d;
                let fc = f0 * (0.45 * sr / f0).max(1.0).powf(hell);
                self.ek = if hell >= 1.0 { 1.0 } else { 1.0 - (-std::f32::consts::TAU * fc / sr).exp() };
            }
            1 => {
                // pulse width half a period (hell 0, a soft finger) down to 1/128 period (hell 1, a hard plectrum)
                self.ebreite = (0.5 * d * (-6.0 * hell).exp2()).max(1.0);
                self.elaenge = self.ebreite.ceil() as u32;
            }
            2 => {
                // felt hammer: contact 4 ms (hell 0) .. 0.5 ms (hell 1), shorter for a harder strike
                let tc = 0.004 * (-3.0 * hell).exp2() / (0.5 + vel);
                self.ebreite = (tc * sr).max(1.0);
                self.elaenge = self.ebreite.ceil() as u32;
                // a pulse longer than a period adds up over several periods: keep the level per period
                self.epegel *= (d / self.ebreite).min(1.0);
            }
            _ => self.elaenge = 0,
        }
    }

    /// One sample of the internal exciter (0 when it is done).
    #[inline]
    fn erreger(&mut self) -> f32 {
        if self.en >= self.elaenge {
            return 0.0;
        }
        let t = (self.en as f32 + 0.5) / self.ebreite;
        self.en += 1;
        match self.art {
            0 => {
                let r = self.rauschen();
                self.elp += (r - self.elp) * self.ek;
                self.epegel * self.elp
            }
            1 => {
                let s = (std::f32::consts::PI * t).sin();
                self.epegel * s * s
            }
            2 => {
                let s = (std::f32::consts::PI * t).sin();
                self.epegel * s * s * s
            }
            _ => 0.0,
        }
    }

    /// One sample.
    #[inline]
    pub fn prozess(&mut self, e: &Einstellung, sr: f32, x: Eingabe) -> f32 {
        let f0 = endlich(x.hz, 0.0).clamp(MIN_HZ as f32, MAX_HZ_ANTEIL as f32 * sr);
        let t60 = endlich(x.ausklang, 2.0).clamp(AUSKLANG_MIN, AUSKLANG_MAX);
        let daempfung = endlich(x.daempfung, 0.5).clamp(0.0, 1.0);
        if (f0, t60, daempfung) != self.alt {
            // only the pitch moved, and not far from the last full design: keep its loss pole (vibrato, glide), and follow
            // the pitch every NACHFUEHR_TAKT samples while it moves; once it holds, the next design is exact again
            let nur_tonhoehe = t60 == self.alt.1 && daempfung == self.alt.2 && ((f0 / self.f0_entwurf) as f64 - 1.0).abs() < NACHFUEHREN;
            if nur_tonhoehe && self.warte > 0 {
                self.warte -= 1;
            } else {
                let s = if nur_tonhoehe { nachfuehren(f0 as f64, sr as f64, t60 as f64, daempfung as f64, self.s.a) } else { None };
                self.s = s.unwrap_or_else(|| {
                    self.f0_entwurf = f0;
                    entwurf(f0 as f64, sr as f64, t60 as f64, daempfung as f64)
                });
                self.alt = (f0, t60, daempfung);
                self.warte = if nur_tonhoehe { NACHFUEHR_TAKT - 1 } else { 0 };
            }
        }
        let d = sr / f0;
        if x.trig > 0.5 {
            let vel = endlich(x.vel, 1.0).clamp(0.0, 1.0);
            let hell = endlich(x.hell, 0.5).clamp(0.0, 1.0);
            self.anschlag(e, sr, d, vel, hell);
        }
        // excitation through the pick-position comb 1 - z^-M (zero at DC)
        let q = self.erreger() + endlich(x.x, 0.0).clamp(-GRENZE, GRENZE);
        let lage = endlich(x.lage, 0.13).clamp(LAGE_MIN, LAGE_MAX);
        // fractional comb delay, linear between two taps: the notches sit on the harmonics, not next to them
        let m = (lage * d).clamp(1.0, (self.kmaske - 1) as f32);
        let (mi, mf) = (m as usize, m.fract());
        self.kpos = (self.kpos + 1) & self.kmaske;
        self.kamm[self.kpos] = q;
        let k0 = self.kamm[self.kpos.wrapping_sub(mi) & self.kmaske];
        let k1 = self.kamm[self.kpos.wrapping_sub(mi + 1) & self.kmaske];
        let c = q - (k0 + (k1 - k0) * mf);
        // DC blocker on the excitation: a step on x leaves a pulse of M samples after the comb; without this its area
        // would charge the loop's DC mode, which dies only with the note
        let c = c as f64;
        let ch = null(0.5 * (1.0 + self.s.r) * (c - self.dx) + self.s.r * self.dy);
        self.dx = c;
        self.dy = ch;
        let c = ch as f32;
        // the loop: line, loss filter, fractional-delay allpass
        self.pos = (self.pos + 1) & self.maske;
        let r = self.buf[self.pos.wrapping_sub(self.s.n) & self.maske] as f64;
        let lv = null(self.s.b0 * r - self.s.a * self.lz);
        let ap = null(self.s.eta * lv + self.ax - self.s.eta * self.ay);
        self.lz = lv;
        self.ax = lv;
        self.ay = ap;
        let v = ap as f32 + c;
        let v = if v.is_finite() { v.clamp(-GRENZE, GRENZE) } else { 0.0 };
        let v = if v.abs() < NULL { 0.0 } else { v };
        self.buf[self.pos] = v;
        if e.koerper == 0 {
            return v;
        }
        // body: direct share plus band-pass resonances, mixed in by koerper_mix
        let vd = v as f64;
        let mut k = e.direkt * vd;
        for (b, z) in e.baender.iter().zip(self.kz.iter_mut()) {
            let y = b.b0 * vd + z[0];
            let z0 = -b.a1 * y + z[1];
            let z1 = -b.b0 * vd - b.a2 * y;
            // flush both states together: flushing one alone near a zero crossing feeds a high-Q band (measured: a 100 Hz
            // band held about 5e-18 for seconds without input)
            *z = if z0.abs() + z1.abs() < NULL as f64 { [0.0; 2] } else { [z0, z1] };
            k += b.g * y;
        }
        let mix = endlich(x.koerper_mix, 0.5).clamp(0.0, 1.0);
        v + mix * (k as f32 - v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raster() -> Vec<(f64, f64, f64, f64)> {
        let mut v = Vec::new();
        for sr in [44_100.0, 48_000.0, 96_000.0, 192_000.0] {
            for f0 in [10.0, 20.0, 27.5, 55.0, 110.0, 440.0, 1760.0, 4186.0, 6000.0, 30_000.0] {
                for t60 in [0.001, 0.01, 0.1, 1.0, 10.0, 60.0, 1e9] {
                    for dmp in [0.0, 0.25, 0.5, 0.75, 1.0] {
                        v.push((sr, f0, t60, dmp));
                    }
                }
            }
        }
        v
    }

    #[test]
    fn schleife_trifft_periode_und_ausklang_bei_jedem_knopf() {
        for (sr, f0, t60, dmp) in raster() {
            let s = entwurf(f0, sr, t60, dmp);
            let w = std::f64::consts::TAU * s.f0 / sr;
            let soll = t60.clamp(AUSKLANG_MIN as f64, AUSKLANG_MAX as f64);
            assert_eq!(s.radius, 10f64.powf(-3.0 / (sr * soll)));
            assert!(s.n >= 1 && s.eta.abs() < 1.0, "{sr} {f0} {t60} {dmp}: n {} eta {}", s.n, s.eta);
            // the allpass works in its good range: a fractional delay of about 0.5 ..< 1.5 samples, eta near
            // -0.2 ..= 1/3 (an eta near -1 would be a long, strongly dispersive delay at low frequencies)
            if s.f0 * soll >= 4.0 {
                assert!((-0.3..=0.45).contains(&s.eta), "{sr} {f0} {t60} {dmp}: eta {} outside the allpass's good range", s.eta);
            }
            assert!(s.a <= 0.0 && s.a > -1.0, "loss pole {}", s.a);
            // stability: the loop gain is below 1 at every frequency (the one-pole low-pass is largest at DC)
            assert!(s.b0 / (1.0 + s.a) <= G_MAX + 1e-15, "DC gain {}", s.b0 / (1.0 + s.a));
            assert!(s.n + 2 < puffer_laenge(sr as f32), "line too short");
            // the fundamental's pole sits at radius e^{j w0}: pitch and T60 exact (except where G_MAX caps the gain)
            if s.b0 / (1.0 + s.a) < G_MAX {
                let g = s.bei_z(K::from_polar(s.radius, w));
                assert!((g - 1.0).norm() < 1e-9, "{sr} {f0} {t60} {dmp}: loop at z* is {g}");
            }
            // and it is the fundamental's pole (k = 1): on the unit circle the loop is about one period long. Not exact: a
            // strong low-pass turns the phase off the circle (at 20 Hz, T60 1 s, damping 0.5 by 5.6 of 2205 samples)
            let (tau, _, _) = s.bei(w);
            assert!(s.f0 * soll < 4.0 || (tau - sr / s.f0).abs() < 0.05 * sr / s.f0, "{sr} {f0} {t60} {dmp}: loop delay {tau} vs {}", sr / s.f0);
        }
    }

    #[test]
    fn nachfuehren_haelt_tonhoehe_und_ausklang() {
        // the cheap path for a moving pitch places the pole exactly as the full design does, or says it cannot
        let mut genutzt = 0;
        for (sr, f0, t60, dmp) in raster() {
            let s = entwurf(f0, sr, t60, dmp);
            for r in [0.98, 0.995, 1.001, 1.01, 1.02] {
                let f = (s.f0 * r).min(MAX_HZ_ANTEIL * sr);
                if let Some(n) = nachfuehren(f, sr, t60, dmp, s.a) {
                    genutzt += 1;
                    assert_eq!(n.a, s.a.max(n.a_soll));
                    assert!(n.b0 / (1.0 + n.a) <= G_MAX, "unstable");
                    let g = n.bei_z(K::from_polar(n.radius, std::f64::consts::TAU * n.f0 / sr));
                    assert!((g - 1.0).norm() < 1e-9, "{sr} {f} {t60} {dmp}: loop at z* is {g}");
                }
            }
        }
        assert!(genutzt > 1000, "positive control: the cheap path was used only {genutzt} times");
    }

    #[test]
    fn daempfung_wird_nur_begrenzt_wenn_noetig() {
        // mid notes, normal decay: the damping is designed as asked
        let s = entwurf(220.0, 48_000.0, 2.0, 0.5);
        assert_eq!(s.a, s.a_soll);
        // a high note with a long decay and full damping cannot have that low-pass in the loop
        let s = entwurf(4186.0, 48_000.0, 20.0, 1.0);
        assert!(s.a > s.a_soll && s.b0 / (1.0 + s.a) <= G_MAX, "{s:?}");
    }

    fn eingabe(hz: f32, trig: f32) -> Eingabe {
        Eingabe { x: 0.0, hz, trig, vel: 1.0, ausklang: 0.1, daempfung: 0.5, hell: 0.5, lage: 0.13, koerper_mix: 1.0 }
    }

    #[test]
    fn verklungene_saite_ist_genau_null_ohne_subnormale() {
        for anreger in 0..ANREGER.len() {
            let e = Einstellung::neu(anreger, 1, 0, 48_000.0);
            let mut v = Stimme::neu(0, &e, 48_000.0);
            let mut x = eingabe(110.0, 1.0);
            x.x = 0.3;
            v.prozess(&e, 48_000.0, x);
            x.trig = 0.0;
            x.x = 0.0;
            for _ in 0..10 * 48_000 {
                v.prozess(&e, 48_000.0, x);
            }
            assert!(v.still(), "{}: state not flushed to 0 after 10 s at T60 0.1 s", ANREGER[anreger]);
        }
    }

    #[test]
    fn unsinnige_eingaenge_bleiben_endlich() {
        let e = Einstellung::neu(2, 3, 0, 48_000.0);
        let mut v = Stimme::neu(0, &e, 48_000.0);
        for (i, w) in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, 1e30, -1e30, 0.0, 1.0].iter().cycle().take(7 * 49).enumerate() {
            let x = Eingabe { x: *w, hz: *w, trig: *w, vel: *w, ausklang: *w, daempfung: *w, hell: *w, lage: *w, koerper_mix: *w };
            for _ in 0..(50 + i % 13) {
                assert!(v.prozess(&e, 48_000.0, x).abs() <= 2.0 * GRENZE);
            }
        }
    }
}
