//! Multi-operator FM synthesis (type 35, `fm`): six sine operators per voice, sixteen algorithms (routings), one ADSR per
//! operator, feedback on the top operator of the algorithm.
//!
//! **Operators.** Operator `o` (1..6) runs at `hz * verh_o * 2^(fein_o / 1200)`. Its unit output is `u_o = env_o * sin(phi_o
//! + m_o)`, where `m_o` is the phase modulation in radians from its modulators. As a modulator, operator `j` adds
//! `I_j * u_j` to its targets, with the peak index `I_j = pegel_j * INDEX_MAX * index * velocity factor` (the classic phase
//! modulation form of "FM"). As a carrier, it adds `pegel_o * u_o` to the output; the carrier sum is divided by the number
//! of carriers of the algorithm, so `|aus| <= 1` for every setting.
//!
//! **Algorithms.** `ALGORITHMEN` lists the routings. A modulator always has a higher number than its target, so one pass
//! from operator 6 down to 1 computes a sample without delay; only the feedback reads earlier samples. Algorithms 0..7
//! use operators 1..4 (the values of 5 and 6 are ignored), 8..15 use all six.
//!
//! **Feedback.** The top operator of each algorithm (4 or 6, it has no modulators) modulates itself with
//! `beta * (u[n-1] + u[n-2]) / 2`, `beta = rueck * FB_MAX`. Averaging the last two samples suppresses the period-2
//! oscillation ("hunting") of the plain one-sample loop: measured, the plain loop breaks into noise at beta 1.3, the
//! averaged one stays periodic up to beta 1.5 (`BERICHT-fm.md`).
//!
//! **Alias guard.** Nothing is oversampled; instead the guard keeps every operator's spectrum below `G = max(sr - 20 kHz,
//! sr / 2)`, so whatever folds at Nyquist lands above 20 kHz:
//! - an operator whose own frequency reaches `sr / 2` is muted;
//! - the feedback is limited per pitch to `FB_GRENZE`, measured so the feedback operator alone keeps its alias energy below
//!   20 kHz under -90 dB; when the feedback operator modulates, also so that its -80 dB tail (`FB_SCHWANZ`) stays below
//!   `G / 2`;
//! - the modulation is estimated per operator from the top down: `tempo`, the highest instantaneous frequency of its output
//!   (`f + sum I_j * tempo_j`, an exact bound), and its reach `f + sum reichweite(I_j) * tempo_j` plus the modulators'
//!   tails where an index above 1 lifts them. `reichweite(I)` bounds the highest sideband order of a sine modulator with
//!   index `I` whose tail holds -80 dB (checked against Bessel functions in a unit test). Every reach must stay below `G`.
//! - If it does not, the modulation indices of the offending tree (`baeume`: operators linked directly or through others,
//!   e.g. one pair of a three-pair algorithm) are scaled down together: the guard finds by bisection the largest index
//!   product `q = index * velocity factor` that passes, at the top of a pitch band of +-2 % (`BAND`), and clamps `q` to it.
//!   Inside a tree it acts like turning the `index` knob down, never like cutting a single link. The guard uses the peak indices
//!   (envelopes at 1), so it does not move with the envelopes; it runs again only when the pitch leaves its band or the
//!   feedback input changes.
//!
//! **Real time.** `Stimme::prozess` does not allocate, lock or panic. Inputs are checked for being finite and clamped.
//! Envelopes snap to their target below 1e-6 (no subnormals); the sine is an odd polynomial on a u32 phase.

/// Operators per voice.
pub const OPERATOREN: usize = 6;
/// Peak modulation index (radians) of a modulator at `pegel` 1 and `index` 1.
pub const INDEX_MAX: f32 = 4.0 * std::f32::consts::PI;
/// Largest value of the `index` input (scales every modulator).
pub const INDEX_FAKTOR_MAX: f32 = 2.0;
/// Feedback (radians of phase per unit output) at `rueck` 1.
pub const FB_MAX: f32 = 1.5;
/// Highest frequency that must stay free of aliases.
pub const ALIAS_FREI_HZ: f32 = 20_000.0;
/// Largest operator ratio.
pub const VERH_MAX: f32 = 32.0;
/// Smallest operator ratio.
pub const VERH_MIN: f32 = 1.0 / 32.0;
/// Largest fine detune in cent.
pub const FEIN_MAX: f32 = 100.0;

/// A routing: `mods[i]` has bit `j` set when operator `j + 1` modulates operator `i + 1` (always `j > i`); `traeger` has
/// bit `i` set for every carrier; `rueck` is the operator (0-based) with feedback; `ops` is 4 or 6.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Algorithmus {
    pub name: &'static str,
    pub ops: usize,
    pub mods: [u8; OPERATOREN],
    pub traeger: u8,
    pub rueck: usize,
}

const fn b(ops: &[usize]) -> u8 {
    let mut m = 0u8;
    let mut i = 0;
    while i < ops.len() {
        m |= 1 << (ops[i] - 1);
        i += 1;
    }
    m
}

/// The sixteen algorithms (index = value `algo`). Notation: `a>b` means operator a modulates operator b.
pub const ALGORITHMEN: [Algorithmus; 16] = [
    // 4-operator algorithms
    Algorithmus { name: "4>3>2>1", ops: 4, mods: [b(&[2]), b(&[3]), b(&[4]), 0, 0, 0], traeger: b(&[1]), rueck: 3 },
    Algorithmus { name: "(4+3)>2>1", ops: 4, mods: [b(&[2]), b(&[3, 4]), 0, 0, 0, 0], traeger: b(&[1]), rueck: 3 },
    Algorithmus { name: "4>3>1, 2>1", ops: 4, mods: [b(&[2, 3]), 0, b(&[4]), 0, 0, 0], traeger: b(&[1]), rueck: 3 },
    Algorithmus { name: "2>1, 4>3", ops: 4, mods: [b(&[2]), 0, b(&[4]), 0, 0, 0], traeger: b(&[1, 3]), rueck: 3 },
    Algorithmus { name: "(4+3+2)>1", ops: 4, mods: [b(&[2, 3, 4]), 0, 0, 0, 0, 0], traeger: b(&[1]), rueck: 3 },
    Algorithmus { name: "4>(3,2,1)", ops: 4, mods: [b(&[4]), b(&[4]), b(&[4]), 0, 0, 0], traeger: b(&[1, 2, 3]), rueck: 3 },
    Algorithmus { name: "4>3>2, 1", ops: 4, mods: [0, b(&[3]), b(&[4]), 0, 0, 0], traeger: b(&[1, 2]), rueck: 3 },
    Algorithmus { name: "1, 2, 3, 4", ops: 4, mods: [0; OPERATOREN], traeger: b(&[1, 2, 3, 4]), rueck: 3 },
    // 6-operator algorithms
    Algorithmus { name: "6>5>4>3>2>1", ops: 6, mods: [b(&[2]), b(&[3]), b(&[4]), b(&[5]), b(&[6]), 0], traeger: b(&[1]), rueck: 5 },
    Algorithmus { name: "3>2>1, 6>5>4", ops: 6, mods: [b(&[2]), b(&[3]), 0, b(&[5]), b(&[6]), 0], traeger: b(&[1, 4]), rueck: 5 },
    Algorithmus { name: "2>1, 4>3, 6>5", ops: 6, mods: [b(&[2]), 0, b(&[4]), 0, b(&[6]), 0], traeger: b(&[1, 3, 5]), rueck: 5 },
    Algorithmus { name: "2>1, 6>5>4>3", ops: 6, mods: [b(&[2]), 0, b(&[4]), b(&[5]), b(&[6]), 0], traeger: b(&[1, 3]), rueck: 5 },
    Algorithmus { name: "2>1, (6+5+4)>3", ops: 6, mods: [b(&[2]), 0, b(&[4, 5, 6]), 0, 0, 0], traeger: b(&[1, 3]), rueck: 5 },
    Algorithmus { name: "2>1, 6>(5,4,3)", ops: 6, mods: [b(&[2]), 0, b(&[6]), b(&[6]), b(&[6]), 0], traeger: b(&[1, 3, 4, 5]), rueck: 5 },
    Algorithmus { name: "6>5>4, 3, 2, 1", ops: 6, mods: [0, 0, 0, b(&[5]), b(&[6]), 0], traeger: b(&[1, 2, 3, 4]), rueck: 5 },
    Algorithmus { name: "1, 2, 3, 4, 5, 6", ops: 6, mods: [0; OPERATOREN], traeger: b(&[1, 2, 3, 4, 5, 6]), rueck: 5 },
];

/// Upper bound of the highest significant sideband order of a sine modulator with index `i` (radians): beyond it the
/// sideband power is below -80 dB of the total. Three lines fitted above the Bessel tail (unit test
/// `reichweite_liegt_ueber_dem_besselschwanz`); below 1e-4 the first sideband is itself under -86 dB.
#[inline]
pub fn reichweite(i: f32) -> f32 {
    if !(i >= 1e-4) {
        return 0.0;
    }
    (1.0 + 40.0 * i).min(2.0 + 8.0 * i).min(5.5 + 1.3 * i)
}

/// Largest index whose `reichweite` is at most `r` (0 below 1).
#[inline]
pub fn reichweite_umkehr(r: f32) -> f32 {
    if !(r >= 1.0) {
        return 0.0;
    }
    ((r - 1.0) / 40.0).max((r - 2.0) / 8.0).max((r - 5.5) / 1.3)
}

/// Largest feedback (radians) per pitch, measured at 48 kHz on the feedback operator alone so that its alias energy below
/// 20 kHz stays under -90 dB. Grid: 16 Hz * 2^(k/2), k = 0..20 (16 Hz .. 16.4 kHz); read with linear interpolation over
/// log2 of the pitch, as a fraction of the sample rate (the recursion only sees `f / sr`).
pub const FB_GRENZE: [f32; 21] = [
    1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.48, 1.43, 1.37, 1.29, 1.19, 1.08, 0.94, 0.75, 0.55, 0.34, 0.17, 0.08, 0.02, 0.0,
];

/// Feedback limit for an operator with phase step `inc` (fraction of a period per sample).
#[inline]
pub fn fb_grenze(inc: f32) -> f32 {
    let f48 = inc * 48_000.0;
    if !(f48 > 16.0) {
        return FB_GRENZE[0];
    }
    let x = 2.0 * (f48 / 16.0).log2();
    if x >= (FB_GRENZE.len() - 1) as f32 {
        return FB_GRENZE[FB_GRENZE.len() - 1];
    }
    let k = x as usize;
    let t = x - k as f32;
    FB_GRENZE[k] + (FB_GRENZE[k + 1] - FB_GRENZE[k]) * t
}

/// Highest instantaneous frequency (Hz) of the feedback operator's output at pitch `f` and feedback `beta`. Up to beta 0.9
/// the continuous loop `y = sin(phi + beta y)` bounds it by `f / (1 - beta)`; above, the wave gets a smoothed step a few
/// samples wide (it turns saw-like), measured at 48 kHz as up to 2.2 kHz at 20 Hz and 3.4 kHz at 400 Hz for beta 1.5;
/// `4000 Hz * (beta - 0.9)` covers it (`BERICHT-fm.md`).
#[inline]
pub fn fb_tempo(f: f32, beta: f32) -> f32 { f / (1.0 - beta.min(0.9)) + 4000.0 * (beta - 0.9).max(0.0) }

/// Frequency above which the feedback operator holds less than -80 dB of its power, in multiples of its pitch, for beta
/// 0, 0.1, .. 1.5. Measured at 23 Hz; the multiple falls with the pitch (`BERICHT-fm.md`).
pub const FB_SCHWANZ: [f32; 16] = [1.0, 4.0, 6.0, 7.0, 10.0, 13.0, 18.0, 27.0, 44.0, 79.0, 142.0, 234.0, 348.0, 480.0, 629.0, 776.0];

/// `FB_SCHWANZ` at `beta`, linear between the grid points (the curve is convex, so this lies above it).
#[inline]
pub fn fb_schwanz(beta: f32) -> f32 {
    let x = (beta.max(0.0) * 10.0).min((FB_SCHWANZ.len() - 1) as f32);
    let k = (x as usize).min(FB_SCHWANZ.len() - 2);
    FB_SCHWANZ[k] + (FB_SCHWANZ[k + 1] - FB_SCHWANZ[k]) * (x - k as f32)
}

/// Largest beta whose `fb_schwanz` is at most `k` multiples.
#[inline]
pub fn fb_schwanz_umkehr(k: f32) -> f32 {
    if !(k > FB_SCHWANZ[0]) {
        return 0.0;
    }
    for n in 1..FB_SCHWANZ.len() {
        if FB_SCHWANZ[n] >= k {
            return 0.1 * ((n - 1) as f32 + (k - FB_SCHWANZ[n - 1]) / (FB_SCHWANZ[n] - FB_SCHWANZ[n - 1]));
        }
    }
    FB_MAX
}

/// `sin(2 pi p / 2^32)`: odd Taylor polynomial to x^11 on a quarter wave (error below 6e-8).
#[inline]
pub fn sinus(p: u32) -> f32 {
    // half turns in [-1, 1)
    let h = (p as i32) as f32 * (1.0 / 2_147_483_648.0);
    let h = if h > 0.5 { 1.0 - h } else if h < -0.5 { -1.0 - h } else { h };
    let x = std::f32::consts::PI * h;
    let x2 = x * x;
    x * (1.0 + x2 * (-1.0 / 6.0 + x2 * (1.0 / 120.0 + x2 * (-1.0 / 5040.0 + x2 * (1.0 / 362_880.0 + x2 * (-1.0 / 39_916_800.0))))))
}

/// Radians to u32 phase units (wrapping).
#[inline]
fn phase_von(rad: f32) -> u32 { ((rad * (4_294_967_296.0 / std::f32::consts::TAU)) as i64) as u32 }

#[inline]
fn endlich(x: f32, sonst: f32) -> f32 { if x.is_finite() { x } else { sonst } }

/// Fixed values of an `fm` node.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Einstellung {
    /// index into `ALGORITHMEN`
    pub algo: usize,
    /// frequency factor per operator: ratio times fine detune
    pub faktor: [f32; OPERATOREN],
    /// level per operator 0..1 (carrier: output level; modulator: index / INDEX_MAX)
    pub pegel: [f32; OPERATOREN],
    /// attack, decay, sustain, release per operator (seconds, seconds to -60 dB, level, seconds to -60 dB)
    pub adsr: [[f32; 4]; OPERATOREN],
    /// 0..1: how much a low velocity lowers the modulator indices
    pub anschlag: f32,
    /// a trig restarts the operator phases and clears the feedback
    pub sync: bool,
}

/// The per-operator values of a node, `o<n>_<name>`, and their defaults. `ARTEN` overrides `o1_pegel` with 1, so a bare
/// node plays a sine and the other operators are silent.
pub const OP_WERTE: [(&str, f32); 7] = [("verh", 1.0), ("fein", 0.0), ("pegel", 0.0), ("a", 0.001), ("d", 1.0), ("s", 1.0), ("r", 0.1)];

/// Checks the fixed values of an `fm` node (`w` reads a value or its default). Returns the first bad value and its rule.
pub fn pruefe(w: &dyn Fn(&str) -> f32) -> Option<(String, &'static str)> {
    let ganz = |v: f32, bis: f32| v.fract() == 0.0 && (0.0..=bis).contains(&v);
    if !ganz(w("algo"), (ALGORITHMEN.len() - 1) as f32) {
        return Some(("algo".into(), "integer 0..15"));
    }
    if !ganz(w("sync"), 1.0) {
        return Some(("sync".into(), "0 or 1"));
    }
    for (n, grund, ok) in [
        ("anschlag", "0..1", (0.0..=1.0).contains(&w("anschlag"))),
        ("index", "0..2", (0.0..=INDEX_FAKTOR_MAX).contains(&w("index"))),
        ("rueck", "0..1", (0.0..=1.0).contains(&w("rueck"))),
        ("zeit", "0.05..20", (0.05..=20.0).contains(&w("zeit"))),
        ("vel", "0..1", (0.0..=1.0).contains(&w("vel"))),
    ] {
        if !ok {
            return Some((n.into(), grund));
        }
    }
    for o in 1..=OPERATOREN {
        let v = |n: &str| w(&format!("o{o}_{n}"));
        for (n, grund, ok) in [
            ("verh", "1/32..32", (VERH_MIN..=VERH_MAX).contains(&v("verh"))),
            ("fein", "-100..100 cent", (-FEIN_MAX..=FEIN_MAX).contains(&v("fein"))),
            ("pegel", "0..1", (0.0..=1.0).contains(&v("pegel"))),
            ("a", "0..20 s", (0.0..=20.0).contains(&v("a"))),
            ("d", "0.001..60 s", (0.001..=60.0).contains(&v("d"))),
            ("s", "0..1", (0.0..=1.0).contains(&v("s"))),
            ("r", "0.001..60 s", (0.001..=60.0).contains(&v("r"))),
        ] {
            if !ok {
                return Some((format!("o{o}_{n}"), grund));
            }
        }
    }
    None
}

impl Einstellung {
    /// The setting of a node whose values `pruefe` accepted.
    pub fn aus_werten(w: &dyn Fn(&str) -> f32) -> Einstellung {
        let v = |o: usize, n: &str| w(&format!("o{}_{n}", o + 1));
        Einstellung {
            algo: w("algo") as usize,
            faktor: std::array::from_fn(|o| v(o, "verh") * (v(o, "fein") / 1200.0).exp2()),
            pegel: std::array::from_fn(|o| v(o, "pegel")),
            adsr: std::array::from_fn(|o| [v(o, "a"), v(o, "d"), v(o, "s"), v(o, "r")]),
            anschlag: w("anschlag"),
            sync: w("sync") == 1.0,
        }
    }
}

/// Inputs of one sample.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Eingabe {
    pub hz: f32,
    pub gate: f32,
    pub trig: f32,
    pub vel: f32,
    /// factor on every modulator index, 0..2
    pub index: f32,
    /// feedback 0..1
    pub rueck: f32,
    /// factor on every decay and release time, 0.05..20
    pub zeit: f32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
enum Phase {
    #[default]
    Ruhe,
    Attack,
    Decay,
    Release,
}

/// Envelope of one operator: attack linear from the current value, decay and release exponential (time to -60 dB), like
/// `adsr.rs`; it snaps to its target below 1e-6, so a decay to sustain 0 never runs into subnormals.
#[derive(Clone, Copy, Debug, Default)]
struct Huelle {
    phase: Phase,
    wert: f32,
}

/// Per-voice coefficients of one envelope, valid for `Stimme::zeit_alt`.
#[derive(Clone, Copy, Debug, Default)]
struct Koeff {
    a: f32,
    d: f32,
    r: f32,
}

impl Huelle {
    #[inline]
    fn prozess(&mut self, start: bool, gate: bool, k: &Koeff, s: f32) -> f32 {
        if start {
            self.phase = Phase::Attack;
        }
        if !gate && matches!(self.phase, Phase::Attack | Phase::Decay) {
            self.phase = Phase::Release;
        }
        match self.phase {
            Phase::Ruhe => self.wert = 0.0,
            Phase::Attack => {
                self.wert += k.a;
                if self.wert >= 1.0 {
                    self.wert = 1.0;
                    self.phase = Phase::Decay;
                }
            }
            Phase::Decay => {
                let neu = s + (self.wert - s) * k.d;
                // snap when the rest is tiny (no subnormals toward 0) or when f32 rounding swallows the step
                self.wert = if neu == self.wert || (neu - s).abs() < 1e-6 { s } else { neu };
            }
            Phase::Release => {
                self.wert *= k.r;
                if self.wert < 1e-6 {
                    self.wert = 0.0;
                    self.phase = Phase::Ruhe;
                }
            }
        }
        self.wert
    }
}

/// Headroom of the guard's pitch band: the scale found for `hz` holds for every pitch up to `hz * BAND` and is found again
/// only when the pitch leaves `hz / BAND ..= hz * BAND` (vibrato and glides do not run the search every sample).
pub const BAND: f32 = 1.02;
/// Steps of the feedback input the guard distinguishes.
pub const RUECK_STUFEN: f32 = 64.0;

/// The modulation trees of an algorithm: for every operator the set (bit mask) of operators it is linked with, directly or
/// through others. The guard limits each tree on its own, so a high-ratio pair does not dull an independent one.
pub fn baeume(a: &Algorithmus) -> [u8; OPERATOREN] {
    let mut m: [u8; OPERATOREN] = std::array::from_fn(|i| 1 << i);
    // links run only upward, so two passes join every chain
    for _ in 0..2 {
        for i in 0..a.ops {
            for j in i + 1..a.ops {
                if a.mods[i] & (1 << j) != 0 {
                    let v = m[i] | m[j];
                    for k in 0..a.ops {
                        if v & (1 << k) != 0 {
                            m[k] |= v;
                        }
                    }
                }
            }
        }
    }
    m
}

/// Does the setting pass the alias guard at pitch `hz`, index products `q` per operator (index input times velocity
/// factor, the operator's tree limit applied) and feedback `beta`? Every operator's spectrum must end below `g` (module doc): its own pitch, the spread of its modulators
/// (`reichweite(I) * tempo`) and, where a modulator's index lifts it (I > 1), that modulator's tail.
fn besteht(e: &Einstellung, a: &Algorithmus, sr: f32, hz: f32, q: &[f32; OPERATOREN], beta: f32) -> bool {
    let g = (sr - ALIAS_FREI_HZ).max(0.5 * sr);
    // per operator: highest instantaneous frequency of its output (Hz; the frequency scale it modulates with) and the
    // frequency above which its spectrum holds less than -80 dB (its tail)
    let mut tempo = [0.0f32; OPERATOREN];
    let mut schwanz = [0.0f32; OPERATOREN];
    for i in (0..a.ops).rev() {
        let f = hz * e.faktor[i];
        if !(f < 0.5 * sr) {
            continue; // muted
        }
        if i == a.rueck {
            tempo[i] = fb_tempo(f, beta);
            schwanz[i] = f * fb_schwanz(beta);
            continue;
        }
        let (mut t, mut w, mut s) = (f, f, f);
        for j in i + 1..a.ops {
            let ij = e.pegel[j] * INDEX_MAX * q[j];
            if a.mods[i] & (1 << j) == 0 || tempo[j] == 0.0 || !(ij > 0.0) {
                continue;
            }
            // phase modulation by I * u_j shifts the instantaneous frequency by at most I times that of u_j
            t += ij * tempo[j];
            // the modulator's tail (below -80 dB) is lifted by the index: counted from I = 1, fully from I = 3
            let r = reichweite(ij) * tempo[j] + (0.5 * (ij - 1.0)).clamp(0.0, 1.0) * (schwanz[j] - tempo[j]);
            w += r;
            s += r;
        }
        if w > g {
            return false;
        }
        tempo[i] = t;
        schwanz[i] = s;
    }
    true
}

/// State of one voice.
#[derive(Clone, Copy, Debug)]
pub struct Stimme {
    phase: [u32; OPERATOREN],
    inc: [u32; OPERATOREN],
    /// operator below Nyquist (otherwise muted)
    aktiv: [bool; OPERATOREN],
    huelle: [Huelle; OPERATOREN],
    koeff: [Koeff; OPERATOREN],
    /// largest index product (index input times velocity factor) the guard allows in the current pitch band, per operator
    /// (equal within a tree)
    q_max: [f32; OPERATOREN],
    /// index product of the last sample per operator, after the guard
    q: [f32; OPERATOREN],
    /// effective feedback (radians) and its limit at the current pitch
    beta: f32,
    beta_grenze: f32,
    /// last two unit outputs of the feedback operator
    fb: [f32; 2],
    gate_vorher: bool,
    /// pitch band and feedback the guard was run for
    hz_unten: f32,
    hz_oben: f32,
    /// the feedback input rounded up to 1/64, as the guard used it
    rueck_stufe: f32,
    hz_alt: f32,
    zeit_alt: f32,
}

impl Stimme {
    pub fn neu() -> Stimme {
        Stimme {
            phase: [0; OPERATOREN],
            inc: [0; OPERATOREN],
            aktiv: [false; OPERATOREN],
            huelle: [Huelle::default(); OPERATOREN],
            koeff: [Koeff::default(); OPERATOREN],
            q_max: [0.0; OPERATOREN],
            q: [0.0; OPERATOREN],
            beta: 0.0,
            beta_grenze: 0.0,
            fb: [0.0; 2],
            gate_vorher: false,
            hz_unten: f32::NAN,
            hz_oben: f32::NAN,
            rueck_stufe: f32::NAN,
            hz_alt: f32::NAN,
            zeit_alt: f32::NAN,
        }
    }

    /// Effective peak index of the link from operator `j` to operator `i` (0-based) in the last sample, 0 without a link.
    pub fn index_von(&self, e: &Einstellung, i: usize, j: usize) -> f32 {
        let a = &ALGORITHMEN[e.algo.min(ALGORITHMEN.len() - 1)];
        if i < OPERATOREN && j < a.ops && a.mods[i] & (1 << j) != 0 && self.aktiv[j] { e.pegel[j] * INDEX_MAX * self.q[j] } else { 0.0 }
    }

    /// Effective feedback in radians.
    pub fn rueckkopplung(&self) -> f32 { self.beta }

    /// Largest index product the guard allows at the current pitch for the tree of operator `o` (0-based).
    pub fn index_grenze(&self, o: usize) -> f32 { self.q_max[o.min(OPERATOREN - 1)] }

    fn koeffizienten(&mut self, e: &Einstellung, sr: f32, zeit: f32) {
        for (k, z) in self.koeff.iter_mut().zip(&e.adsr) {
            *k = Koeff {
                a: 1.0 / (z[0].max(0.0005) * sr),
                d: (-6.907_755 / ((z[1] * zeit).max(0.001) * sr)).exp(),
                r: (-6.907_755 / ((z[3] * zeit).max(0.001) * sr)).exp(),
            };
        }
    }

    /// Phase steps, feedback limit and the guard's index limit for pitch `hz` and feedback `rueck`, the latter rounded up to
    /// the next 1/64 (so a moving feedback input runs the search at most 64 times over its range) (module doc).
    fn grenzen(&mut self, e: &Einstellung, sr: f32, hz: f32, rueck: f32) {
        let rueck = (rueck * RUECK_STUFEN).ceil() / RUECK_STUFEN;
        let a = &ALGORITHMEN[e.algo.min(ALGORITHMEN.len() - 1)];
        for i in 0..a.ops {
            let inc = hz * e.faktor[i] / sr;
            self.aktiv[i] = inc < 0.5;
            self.inc[i] = if self.aktiv[i] { (inc as f64 * 4_294_967_296.0) as u32 } else { 0 };
        }
        // the guard runs at the top of the band, so it holds for every pitch in it
        let oben = hz * BAND;
        let f = oben * e.faktor[a.rueck];
        let mut grenze = fb_grenze(f / sr);
        // a feedback operator that modulates keeps its tail in the lower half of the band, so its targets keep room
        if (0..a.ops).any(|t| a.mods[t] & (1 << a.rueck) != 0) && e.pegel[a.rueck] > 0.0 {
            grenze = grenze.min(fb_schwanz_umkehr(0.5 * (sr - ALIAS_FREI_HZ).max(0.5 * sr) / f));
        }
        self.beta_grenze = if self.aktiv[a.rueck] { grenze } else { 0.0 };
        let beta = (rueck * FB_MAX).min(self.beta_grenze);
        // each tree on its own, the others without modulation (trees share no links, so they do not interact)
        let baum = baeume(a);
        self.q_max = [0.0; OPERATOREN];
        let mut erledigt = 0u8;
        for o in 0..a.ops {
            if erledigt & (1 << o) != 0 {
                continue;
            }
            erledigt |= baum[o];
            let mit = |q: f32| -> [f32; OPERATOREN] { std::array::from_fn(|j| if baum[o] & (1 << j) != 0 { q } else { 0.0 }) };
            let q_max = if besteht(e, a, sr, oben, &mit(INDEX_FAKTOR_MAX), beta) {
                INDEX_FAKTOR_MAX
            } else {
                // the guard passes at q = 0 (no modulation); bisection on the largest passing q
                let (mut lo, mut hi) = (0.0f32, INDEX_FAKTOR_MAX);
                for _ in 0..14 {
                    let mitte = 0.5 * (lo + hi);
                    if besteht(e, a, sr, oben, &mit(mitte), beta) { lo = mitte } else { hi = mitte }
                }
                lo
            };
            for j in 0..a.ops {
                if baum[o] & (1 << j) != 0 {
                    self.q_max[j] = q_max;
                }
            }
        }
        self.hz_unten = hz / BAND;
        self.hz_oben = hz * BAND;
        self.rueck_stufe = rueck;
    }

    /// One sample of the voice: the carrier sum divided by the number of carriers.
    #[inline]
    pub fn prozess(&mut self, e: &Einstellung, sr: f32, x: Eingabe) -> f32 {
        let a = &ALGORITHMEN[e.algo.min(ALGORITHMEN.len() - 1)];
        let hz = endlich(x.hz, 0.0).clamp(0.0, 0.5 * sr);
        let index = endlich(x.index, 1.0).clamp(0.0, INDEX_FAKTOR_MAX);
        let rueck = endlich(x.rueck, 0.0).clamp(0.0, 1.0);
        let vel = endlich(x.vel, 1.0).clamp(0.0, 1.0);
        let zeit = endlich(x.zeit, 1.0).clamp(0.05, 20.0);
        if !(hz >= self.hz_unten && hz <= self.hz_oben) || !(rueck <= self.rueck_stufe && rueck > self.rueck_stufe - 1.0 / RUECK_STUFEN) {
            self.grenzen(e, sr, hz, rueck);
            self.hz_alt = hz;
        } else if hz != self.hz_alt {
            // inside the band only the phase steps follow the pitch
            for i in 0..a.ops {
                let inc = hz * e.faktor[i] / sr;
                self.inc[i] = if self.aktiv[i] { (inc as f64 * 4_294_967_296.0) as u32 } else { 0 };
            }
            self.hz_alt = hz;
        }
        if zeit != self.zeit_alt {
            self.zeit_alt = zeit;
            self.koeffizienten(e, sr, zeit);
        }
        let q = index * (1.0 - e.anschlag * (1.0 - vel));
        for (qo, max) in self.q.iter_mut().zip(&self.q_max) {
            *qo = q.min(*max);
        }
        self.beta = (rueck * FB_MAX).min(self.beta_grenze);
        let trig = x.trig > 0.5;
        let gate = endlich(x.gate, 0.0) > 0.5;
        let start = trig || (gate && !self.gate_vorher);
        self.gate_vorher = gate;
        if trig && e.sync {
            self.phase = [0; OPERATOREN];
            self.fb = [0.0; 2];
        }
        let mut u = [0.0f32; OPERATOREN];
        let mut summe = 0.0f32;
        for i in (0..a.ops).rev() {
            let env = self.huelle[i].prozess(start, gate, &self.koeff[i], e.adsr[i][2]);
            if !self.aktiv[i] {
                continue;
            }
            let mut m = 0.0f32;
            let mut maske = a.mods[i];
            while maske != 0 {
                let j = maske.trailing_zeros() as usize;
                maske &= maske - 1;
                m += e.pegel[j] * u[j];
            }
            // a target and its modulators share a tree, so the target's limit applies to all of them
            m *= INDEX_MAX * self.q[i];
            if i == a.rueck {
                m += self.beta * 0.5 * (self.fb[0] + self.fb[1]);
            }
            u[i] = env * sinus(self.phase[i].wrapping_add(phase_von(m)));
            if i == a.rueck {
                self.fb = [u[i], self.fb[0]];
            }
            self.phase[i] = self.phase[i].wrapping_add(self.inc[i]);
            if a.traeger & (1 << i) != 0 {
                summe += e.pegel[i] * u[i];
            }
        }
        summe * (1.0 / a.traeger.count_ones() as f32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// J_n(x) by the trapezoid rule on the integral form (exact to rounding for this periodic integrand).
    fn bessel(n: i32, x: f64) -> f64 {
        let m = 2000;
        let mut s = 0.0;
        for k in 0..=m {
            let t = std::f64::consts::PI * k as f64 / m as f64;
            let w = if k == 0 || k == m { 0.5 } else { 1.0 };
            s += w * (n as f64 * t - x * t.sin()).cos();
        }
        s / m as f64
    }

    #[test]
    fn reichweite_liegt_ueber_dem_besselschwanz() {
        // for every index the sideband power beyond floor(reichweite) is below -80 dB of the total
        let mut i = 1e-4f64;
        while i < INDEX_MAX as f64 * INDEX_FAKTOR_MAX as f64 * 1.05 {
            let k = reichweite(i as f32).floor() as i32;
            let schwanz: f64 = (k + 1..k + 80).map(|n| bessel(n, i).powi(2)).sum();
            assert!(schwanz < 1e-8, "index {i}: reach {k}, tail power {schwanz:e}");
            i *= 1.03;
        }
        // below 1e-4 the whole first sideband is below -86 dB
        assert!(bessel(1, 1e-4).powi(2) < 2.6e-9);
    }

    #[test]
    fn umkehr_passt_zur_reichweite() {
        let mut r = 0.5f32;
        while r < 60.0 {
            let i = reichweite_umkehr(r);
            assert!(reichweite(i) <= r * (1.0 + 1e-5), "r {r}: index {i} reaches {}", reichweite(i));
            assert!(reichweite(i * 1.01 + 1e-3) > r, "r {r}: index {i} is not the largest");
            r *= 1.05;
        }
    }

    #[test]
    fn sinus_ist_genau() {
        let mut schlimmst = 0.0f64;
        for k in 0..100_000u64 {
            let p = (k * 42_949u64 + 7) as u32;
            let soll = (p as f64 / 4_294_967_296.0 * std::f64::consts::TAU).sin();
            schlimmst = schlimmst.max((sinus(p) as f64 - soll).abs());
        }
        assert!(schlimmst < 3e-7, "sine error {schlimmst:e}");
    }

    #[test]
    fn algorithmen_sind_wohlgeformt() {
        for (n, a) in ALGORITHMEN.iter().enumerate() {
            assert!(a.ops == 4 || a.ops == 6, "{n}");
            assert!(a.traeger != 0 && a.traeger >> a.ops == 0, "{n}: carriers");
            assert_eq!(a.rueck, a.ops - 1, "{n}: feedback on the top operator");
            assert_eq!(a.mods[a.rueck], 0, "{n}: the feedback operator has no modulators");
            for i in 0..OPERATOREN {
                // modulators sit above their target, inside the algorithm
                assert_eq!(a.mods[i] & ((1u8 << (i + 1)) - 1), 0, "{n}: op {} modulated from below", i + 1);
                assert_eq!(a.mods[i] >> a.ops, 0, "{n}");
                if i < a.ops {
                    // every operator is heard: a carrier, or modulates someone
                    let moduliert = (0..OPERATOREN).any(|t| a.mods[t] & (1 << i) != 0);
                    assert!(a.traeger & (1 << i) != 0 || moduliert, "{n}: op {} is dead", i + 1);
                }
            }
        }
    }

    #[test]
    fn baeume_der_algorithmen() {
        let m = |ops: &[usize]| ops.iter().fold(0u8, |m, o| m | 1 << (o - 1));
        assert_eq!(baeume(&ALGORITHMEN[0])[..4], [m(&[1, 2, 3, 4]); 4]);
        let b = baeume(&ALGORITHMEN[10]);
        assert_eq!(b[..6], [m(&[1, 2]), m(&[1, 2]), m(&[3, 4]), m(&[3, 4]), m(&[5, 6]), m(&[5, 6])]);
        let b = baeume(&ALGORITHMEN[13]);
        assert_eq!(b[..6], [m(&[1, 2]), m(&[1, 2]), m(&[3, 4, 5, 6]), m(&[3, 4, 5, 6]), m(&[3, 4, 5, 6]), m(&[3, 4, 5, 6])]);
        let b = baeume(&ALGORITHMEN[15]);
        assert_eq!(b[..6], [m(&[1]), m(&[2]), m(&[3]), m(&[4]), m(&[5]), m(&[6])]);
        for a in &ALGORITHMEN {
            let b = baeume(a);
            for i in 0..OPERATOREN {
                assert_ne!(b[i] & (1 << i), 0);
                for j in 0..OPERATOREN {
                    if a.mods[i] & (1 << j) != 0 {
                        assert_eq!(b[i], b[j], "{}: linked operators in different trees", a.name);
                    }
                }
            }
        }
    }

    #[test]
    fn huelle_rastet_ein_ohne_subnormale() {
        let k = Koeff { a: 1.0, d: (-6.907_755f32 / (0.01 * 48_000.0)).exp(), r: (-6.907_755f32 / (0.01 * 48_000.0)).exp() };
        for s in [0.0f32, 0.3, 1.0] {
            let mut h = Huelle::default();
            h.prozess(true, true, &k, s);
            for _ in 0..48_000 {
                h.prozess(false, true, &k, s);
            }
            assert_eq!(h.wert, s, "decay must snap to sustain {s}");
            for _ in 0..48_000 {
                h.prozess(false, false, &k, s);
            }
            assert_eq!(h.wert, 0.0, "release must snap to 0");
            assert_eq!(h.phase, Phase::Ruhe);
        }
    }

    #[test]
    fn fb_schwanz_umkehr_passt() {
        let mut k = 1.5f32;
        while k < 3000.0 {
            let b = fb_schwanz_umkehr(k);
            assert!(fb_schwanz(b) <= k * 1.0001 && b <= FB_MAX, "k {k}: beta {b}");
            assert!(b >= FB_MAX || fb_schwanz(b + 0.01) > k, "k {k}: beta {b} is not the largest");
            k *= 1.1;
        }
        assert_eq!(fb_schwanz_umkehr(f32::NAN), 0.0);
    }

    #[test]
    fn fb_grenze_faellt_mit_der_tonhoehe() {
        assert_eq!(fb_grenze(10.0 / 48_000.0), FB_MAX);
        assert_eq!(fb_grenze(0.0), FB_MAX);
        assert_eq!(fb_grenze(f32::NAN), FB_MAX);
        assert_eq!(fb_grenze(0.5), 0.0);
        let mut f = 16.0f32;
        let mut vorher = FB_MAX;
        while f < 20_000.0 {
            let g = fb_grenze(f / 48_000.0);
            assert!(g <= vorher + 1e-6 && (0.0..=FB_MAX).contains(&g), "{f} Hz: {g}");
            vorher = g;
            f *= 1.05;
        }
    }
}
