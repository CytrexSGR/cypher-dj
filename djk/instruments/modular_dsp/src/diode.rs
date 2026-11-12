//! Diode-ladder low-pass in the character of the TB-303 (Stinchcombe, "Analysis of the Moog Transistor Ladder and
//! Derivative Filters", 2008, diode ladder section; Zavalishin, "The Art of VA Filter Design", ch. 6), computed in f64.
//!
//! Unlike the Moog ladder (`rb_dsp::Ladder`, four equal one-poles in series) the four stages are coupled through
//! diodes: each stage loads its neighbours. The model is the chain
//!   y1' = w (x - 2 y1 + y2),  y2' = w (y1 - 2 y2 + y3),  y3' = w (y2 - 2 y3 + y4),  y4' = w (y3 - y4)
//! with the feedback x = u - k y4. The four poles sit at -0.12 / -1.0 / -2.35 / -3.53 w (not coincident), the loop
//! goes unstable at k = 18.4 (Moog: 4). Here `reso` 1 is k = 17.6, just below the oscillation threshold: the
//! resonance sings (Q about 45) but does not oscillate by itself, as on the 303.
//!
//! Discrete time: trapezoidal rule (TPT). The tridiagonal 4x4 equation of the stages is solved per sample without
//! delay (Thomas algorithm), so `g` may change every sample (filter FM, fast envelopes). Saturation sits at the input
//! (`tanh`, drive) and in the feedback branch (`k tanh(y4)`, with y4 estimated without delay). With bounded input and
//! bounded feedback the chain is stable for any `g` (trapezoidal rule of a passive chain), so the output has a fixed
//! upper bound.
//!
//! `cutoff` is the position of the resonance peak at high Q (the 303 player plays the pitch of the resonance). The
//! -3 dB corner at `reso` 0 lies at about a tenth of it (0.1008): that is the diode ladder, not a bug. The peak moves
//! down as the resonance falls. The DC gain falls with resonance to 1/(1+k) (the 303 bass loss); `bass` gives part of
//! it back.

/// Feedback at `reso` = 1; the oscillation threshold of the linear model is 18.39.
pub const K_MAX: f64 = 17.6;
/// Position of the resonance peak at k = `K_MAX` in units of the stage frequency (computed from the chain poles).
const SPITZE: f64 = 1.1765;

#[derive(Default, Clone, Copy)]
pub struct Diode {
    s: [f64; 4],
}

impl Diode {
    /// `x` input, `cutoff` in Hz, `reso` 0..1, `antrieb` in dB (input saturation), `bass` 0..1 (share of the
    /// resonance bass loss that is compensated).
    #[inline]
    pub fn prozess(&mut self, x: f32, cutoff: f32, reso: f32, antrieb: f32, bass: f32, sr: f32) -> f32 {
        let fc = (cutoff as f64).clamp(20.0, sr as f64 * 0.45);
        let g = (std::f64::consts::PI * fc / sr as f64).tan() / SPITZE;
        let k = K_MAX * (reso as f64).clamp(0.0, 1.0);
        let drive = 10f64.powf((antrieb as f64).clamp(-40.0, 60.0) / 20.0);
        let ausgleich = 1.0 + (bass as f64).clamp(0.0, 1.0) * k;
        let u = (x as f64 * drive).tanh() * ausgleich;

        // (I - g A) y = s + g e1 x'. One factorisation (Thomas), two right-hand sides: the states (pz) and the input (q).
        let o = -g;
        let n0 = 1.0 + 2.0 * g;
        let c0 = o / n0;
        let n1 = n0 - o * c0;
        let c1 = o / n1;
        let n2 = n0 - o * c1;
        let c2 = o / n2;
        let n3 = 1.0 + g - o * c2;
        let d0 = self.s[0] / n0;
        let d1 = (self.s[1] - o * d0) / n1;
        let d2 = (self.s[2] - o * d1) / n2;
        let d3 = (self.s[3] - o * d2) / n3;
        let pz3 = d3;
        let pz2 = d2 - c2 * pz3;
        let pz1 = d1 - c1 * pz2;
        let pz0 = d0 - c0 * pz1;
        let e0 = g / n0;
        let e1 = -o * e0 / n1;
        let e2 = -o * e1 / n2;
        let e3 = -o * e2 / n3;
        let q3 = e3;
        let q2 = e2 - c2 * q3;
        let q1 = e1 - c1 * q2;
        let q0 = e0 - c0 * q1;

        // y4 estimated without delay, saturated into the feedback
        let y4_schaetz = (pz3 + q3 * u) / (1.0 + k * q3);
        let xs = u - k * y4_schaetz.tanh();
        let y = [pz0 + q0 * xs, pz1 + q1 * xs, pz2 + q2 * xs, pz3 + q3 * xs];
        for i in 0..4 {
            self.s[i] = 2.0 * y[i] - self.s[i];
        }
        let aus = y[3];
        if !(aus.is_finite() && self.s.iter().all(|v| v.is_finite())) {
            *self = Diode::default();
            return 0.0;
        }
        aus as f32
    }
}
