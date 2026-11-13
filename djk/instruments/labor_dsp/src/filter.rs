//! Resonant two-pole filter whose resonance depends on the signal level, after the MS-20 family: the resonance
//! path loses its gain when the amplitude grows (diodes across the feedback amplifier), so the damping is a
//! function of the band-pass amplitude. Loud input pushes the resonance away, and past the self-oscillation point
//! the filter settles on a limit cycle instead of growing without bound.
//!
//! Form: state-variable filter with trapezoidal integrators (TPT), the damping solved implicitly per sample with
//! Newton steps. Damping `k(bp) = K_MAX - (K_MAX - k0) / (1 + (bp/VREF)^4)`: `k0` at small level, `K_MAX` (no
//! resonance) at large level, with the knee of a diode pair in between (the resonance holds up to about a third of
//! VREF and is gone above it). The limiter has to sit on the damping. A saturator on the signal or on the
//! integrator input does not bound a self-oscillating filter.
//!
//! DECISION: the high-pass is the one-pole resonant form of the MS-20 core (6 dB per octave below the cutoff),
//! the low-pass has 12 dB per octave.

/// Damping without resonance (Q = 0.5).
pub const K_MAX: f64 = 2.0;
/// Damping at full resonance (negative = self-oscillation).
pub const K_MIN: f64 = -0.5;
/// Resonance setting from which the filter oscillates by itself.
pub const RESONANZ_SCHWELLE: f64 = 0.8;
/// Level in volts at which the resonance path has lost half of its gain.
pub const VREF: f64 = 1.5;
const NEWTON: usize = 5;

/// Resonance 0..1 to the small-signal damping: linear from K_MAX to K_MIN, zero at RESONANZ_SCHWELLE.
pub fn k0_aus_resonanz(resonanz: f64) -> f64 {
    K_MAX - (K_MAX - K_MIN) * resonanz.clamp(0.0, 1.0)
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Filter {
    s1: f64,
    s2: f64,
}

impl Filter {
    #[inline]
    pub fn verarbeite(&mut self, x: f64, fc: f64, fs: f64, k0: f64, hp: bool) -> f64 {
        let g = (std::f64::consts::PI * fc / fs).tan();
        let gg = 1.0 / g + g;
        let rechts = x - self.s2 + self.s1 / g;
        let res = K_MAX - k0;
        // start from the linear solution, then solve gg*bp + k(bp)*bp = rechts
        let mut bp = rechts / (gg + k0);
        for _ in 0..NEWTON {
            let r = bp / VREF;
            let u = r * r * r * r;
            let q = 1.0 / (1.0 + u);
            let f = (gg + K_MAX) * bp - res * bp * q - rechts;
            let fp = gg + K_MAX - res * (1.0 - 3.0 * u) * q * q;
            bp -= f / fp;
        }
        let hpv = (bp - self.s1) / g;
        let lp = g * bp + self.s2;
        self.s1 = 2.0 * bp - self.s1;
        self.s2 = 2.0 * lp - self.s2;
        if hp { hpv + bp } else { lp }
    }
}
