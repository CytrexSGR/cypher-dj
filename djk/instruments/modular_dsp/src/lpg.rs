//! Low-pass gate in the Buchla 292 tradition: a filter whose resistance is set by a vactrol (a lamp that lights a photoresistor),
//! so the gate opens fast and closes slowly and a short pulse gives the plucked, struck sound. The model follows "A Digital Model
//! of the Buchla Lowpass-Gate" (Parker and D'Angelo, DAFx-13); nothing here is copied from it, the constants are cited by their
//! role. State per voice in f64, no allocation, no latency.
//!
//! Audio path (the paper's circuit, section 2). Two capacitor nodes C1 and C2 around the control-dependent resistance Rf, the
//! load resistance Ralpha, and in low-pass mode a third capacitor C3 in a feedback path with gain `a`. The three modes are the
//! paper's component sets: 0 low-pass (C3 = 4.7 nF, Ralpha = 5 MOhm), 1 both (C3 = 0, Ralpha = 5 MOhm), 2 VCA (C3 = 0, Ralpha =
//! 5 kOhm); C1 = 1 nF and C2 = 220 pF throughout. The circuit is discretised with the topology-preserving method of section
//! 2.2.2: trapezoidal integrators for the two capacitor nodes and a trapezoidal differentiator for C3, the delay-free loops solved
//! in closed form each sample (one linear equation for the C2 node). That keeps all three states through changes of Rf, which is
//! what makes audio-rate control and mode switches safe.
//!
//! Control path. The paper models the control circuit (a shelving filter, a logarithmic amplifier and a zener) from control
//! voltage to LED current to Rf = A / If^1.4 + B with A = 3.464 and B = 1136.2 Ohm, If limited to 10 uA .. 40 mA, and then a
//! heuristic vactrol memory. Simplified here:
//!  - `cv` (plus `versatz`, clamped to 0..1.5) is the target light level directly; the control circuit is replaced by the
//!    static map If = 40 mA * min(level, 1)^2. The square gives a usable range: at VCA mode cv 0.5 is about -3 dB, cv 0.2 about
//!    -18 dB and cv 0.05 about -50 dB (measured in tests/lpg.rs). The paper's 10 uA floor is dropped: Rf is clamped to 1 GOhm
//!    instead, which closes the gate (below about -100 dB in every mode) and lets it close completely, see below.
//!  - The vactrol memory is the paper's switched first-order low-pass with a level-dependent decay. Attack: time constant 1 ms
//!    (the paper uses 12 ms for the model; at 12 ms the 10..90 % rise of the output could not be under 10 ms, so the constant is
//!    ours, close to the datasheet turn-on time). Decay: time constant 0.15 s * `abkling` / (1 + 4 * level) (the paper has 250 ms; ours is shorter so that the output of every mode falls by 20 dB within 300 ms, see tests/lpg.rs), so a lit vactrol
//!    lets go faster than a nearly dark one, as in the datasheet curves the paper cites. The level may go up to 1.5: above 1 the
//!    resistance no longer drops but the decay starts from further up and takes longer to leave the saturated range.
//!  - Closing: when the level and its target are both below 1e-3 the level is set to 0 and the filter states are cleared; the
//!    output is then exactly 0 and nothing denormal can drift. The audio there is already far below -100 dB.
//!
//! Resonance (`reso`, low-pass mode only): the paper's feedback gain `a`, normalised with its stability limit a_max (eq. 11):
//! a = 1 + 0.95 * reso * (a_max - 1). At reso 0 the gain is 1 (the paper's circuit without the added feedback amplifier);
//! 0.95 keeps the poles inside the unit circle for any Rf.
//!
//! Further simplifications: no oversampling (the paper recommends 2x against the warping of the trapezoidal rule; the poles of
//! the open filter in VCA mode lie far above 10 kHz, so the audio band stays flat), no non-linearities (section 2.3 is
//! optional). Gain: in VCA mode the output is multiplied by (Ralpha + 2 Rf_min) / Ralpha (+4 dB, the paper's loudness
//! normalisation between the modes), so cv 1 is unity gain in every mode.

const C1: f64 = 1e-9;
const C2: f64 = 220e-12;
const C3_LP: f64 = 4.7e-9;
const R_ALPHA_FILTER: f64 = 5e6;
const R_ALPHA_VCA: f64 = 5e3;
/// vactrol: Rf = RF_A / level^2.8 + RF_B, the paper's A / If^1.4 + B with If = 40 mA * level^2
const RF_A: f64 = 314.9;
const RF_B: f64 = 1136.212;
const RF_MIN: f64 = RF_A + RF_B;
const RF_MAX: f64 = 1e9;
const TAU_AN: f64 = 0.001;
const TAU_AB: f64 = 0.15;
const PEGEL_MAX: f64 = 1.5;
const GESCHLOSSEN: f64 = 1e-3;
const KLEIN: f64 = 1e-25;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lpg {
    sx: f64,
    so: f64,
    sd: f64,
    pegel: f64,
    /// last level the resistance was computed for, and that resistance
    rf_pegel: f64,
    rf: f64,
}

impl Default for Lpg {
    fn default() -> Self { Lpg { sx: 0.0, so: 0.0, sd: 0.0, pegel: 0.0, rf_pegel: -1.0, rf: RF_MAX } }
}

#[inline]
fn endlich(v: f32, vorgabe: f64) -> f64 { if v.is_finite() { v as f64 } else { vorgabe } }

impl Lpg {
    /// The vactrol level now (0 closed .. 1.5), for tests and the cost of nothing else.
    pub fn pegel(&self) -> f64 { self.pegel }

    #[inline]
    pub fn prozess(&mut self, x: f32, cv: f32, modus: f32, abkling: f32, reso: f32, versatz: f32, sr: f32) -> f32 {
        let sr = sr as f64;
        let x = endlich(x, 0.0);
        let ziel = (endlich(cv, 0.0) + endlich(versatz, 0.0)).clamp(0.0, PEGEL_MAX);
        let abkling = endlich(abkling, 1.0).clamp(0.1, 10.0);
        let reso = endlich(reso, 0.0).clamp(0.0, 1.0);
        let modus = endlich(modus, 1.0).round().clamp(0.0, 2.0) as u8;

        // vactrol memory: fast attack, level-dependent slow decay
        if ziel > self.pegel {
            self.pegel += (ziel - self.pegel) * (1.0 / (TAU_AN * sr));
        } else {
            let k = (1.0 + 4.0 * self.pegel) / (TAU_AB * abkling * sr);
            self.pegel += (ziel - self.pegel) * k.min(1.0);
        }
        if self.pegel < GESCHLOSSEN && ziel < GESCHLOSSEN {
            // closed: exact silence, all states cleared
            self.pegel = 0.0;
            self.sx = 0.0;
            self.so = 0.0;
            self.sd = 0.0;
            return 0.0;
        }

        // resistance of the vactrol
        if self.pegel != self.rf_pegel {
            self.rf_pegel = self.pegel;
            let u = self.pegel.min(1.0);
            self.rf = (RF_A / u.powf(2.8) + RF_B).min(RF_MAX);
        }
        let rf = self.rf;

        let (c3, r_alpha) = match modus {
            0 => (C3_LP, R_ALPHA_FILTER),
            1 => (0.0, R_ALPHA_FILTER),
            _ => (0.0, R_ALPHA_VCA),
        };
        let t = 2.0 * sr;
        // coefficients of the paper's equations (5) and (6)
        let a1 = 1.0 / (C1 * rf);
        let a2 = -(1.0 / C1) * (1.0 / rf + 1.0 / r_alpha);
        let b1 = 1.0 / (C2 * rf);
        let b2 = -2.0 * b1;
        let b3 = b1;
        let b4 = c3 / C2;
        let (d1, d2) = if c3 > 0.0 {
            let amax = (2.0 * C1 + (C2 + c3) * (1.0 + rf / r_alpha)) / c3;
            (1.0 + 0.95 * reso * (amax - 1.0), -1.0)
        } else {
            (1.0, -1.0)
        };

        // closed-form solution of the delay-free loops (trapezoidal rule, T = 2 fs)
        let den0 = 1.0 - a2 / t;
        let k0 = self.so / den0;
        let k1 = a1 / (t * den0);
        let m = b3 / t + b4 * d1;
        let nenner = 1.0 - b2 / t - b4 * d2 - m * k1;
        let zaehler = self.sx + b1 * x / t + b4 * self.sd / t + m * k0;
        let yx = zaehler / nenner;
        let yo = k0 + k1 * yx;
        let u_diff = d1 * yo + d2 * yx;
        let yd = self.sd + t * u_diff;
        let ux = b1 * x + b2 * yx + b3 * yo + b4 * yd;
        let uo = a1 * yx + a2 * yo;
        self.sx += 2.0 * ux / t;
        self.so += 2.0 * uo / t;
        self.sd = if c3 > 0.0 { -self.sd - 2.0 * t * u_diff } else { 0.0 };
        if self.sx.abs() < KLEIN { self.sx = 0.0; }
        if self.so.abs() < KLEIN { self.so = 0.0; }
        if self.sd.abs() < KLEIN { self.sd = 0.0; }
        let aus = if modus == 2 { yo * (R_ALPHA_VCA + 2.0 * RF_MIN) / R_ALPHA_VCA } else { yo };
        if aus.is_finite() { aus as f32 } else { self.sx = 0.0; self.so = 0.0; self.sd = 0.0; 0.0 }
    }
}
