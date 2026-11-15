//! Phase rotator: first order all-pass H(z) = (c + z^-1)/(1 + c z^-1) with c = (t - 1)/(t + 1), t = tan(pi fc/fs). Phase 0 at DC,
//! -90 degrees at fc, -180 degrees at Nyquist; c = 0 at fs/4 (a one sample delay). Order 2 runs two sections in series (fc, fc2).
//! Built as the trapezoidal (TPT) low-pass `2 lp - x`, which stays stable when the coefficient changes every sample.
//! State in f64 per section; non-finite input or state resets the block and returns 0.0 (as `Svf::prozess`).

#[derive(Default, Clone, Copy)]
pub struct Allpass {
    s: [f64; 2],
}

/// below this the state is flushed to exactly 0 (about -400 dB), so silence never ends in subnormal floats
const BODEN: f64 = 1e-20;

impl Allpass {
    #[inline]
    fn stufe(s: &mut f64, x: f64, fc: f64, sr: f64) -> f64 {
        let fc = fc.clamp(20.0, sr * 0.45);
        let g = (std::f64::consts::PI * fc / sr).tan();
        let gg = g / (1.0 + g);
        let v = (x - *s) * gg;
        let lp = v + *s;
        *s = lp + v;
        if s.abs() < BODEN { *s = 0.0; }
        2.0 * lp - x
    }

    #[inline]
    pub fn prozess(&mut self, x: f32, fc: f32, fc2: f32, ordnung: u8, sr: f32) -> f32 {
        let sr = sr as f64;
        let mut y = Self::stufe(&mut self.s[0], x as f64, fc as f64, sr);
        if ordnung >= 2 {
            y = Self::stufe(&mut self.s[1], y, fc2 as f64, sr);
        }
        if !(y.is_finite() && self.s[0].is_finite() && self.s[1].is_finite()) {
            *self = Allpass::default();
            return 0.0;
        }
        y as f32
    }

    /// the two section states (for the silence test)
    pub fn zustand(&self) -> [f64; 2] { self.s }
}
