//! Frequency shifter (type 55): every partial moves by the same number of Hz, so harmonic sounds turn inharmonic (a ring
//! modulator that keeps one sideband). A Hilbert pair of two all-pass chains (Olli Niemitalo's design: four second order
//! sections in z^-2 per chain, chain 1 delayed by one sample, 90 degrees apart within about 0.7 degrees from 50 Hz to 24 kHz at
//! 48 kHz, so the unwanted sideband sits at least 40 dB down) gives the analytic signal; it is multiplied by a quadrature
//! oscillator of `hz` and the real part is taken, once with each sign: `auf` is shifted up by `hz`, `ab` down by `hz`.
//! The coefficients are fixed for 48 kHz and used unchanged at other rates (the corner frequencies scale with the rate). State
//! in f64 per voice; states below 1e-20 are flushed to 0, so silence in is exactly silence out. A non-finite input resets the
//! voice. No latency in the graph sense (the group delay of the all-pass chains is a phase effect of the shifter itself).

/// shift limit in Hz
pub const MAX_HZ: f32 = 2000.0;

const A1: [f64; 4] = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737];
const A2: [f64; 4] = [0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278];
const BODEN: f64 = 1e-20;

/// One chain of four sections y[n] = a^2 (x[n] + y[n-2]) - x[n-2]: history (x1, x2, y1, y2) per section.
#[derive(Default, Clone, Copy)]
struct Kette {
    h: [[f64; 4]; 4],
}

impl Kette {
    #[inline]
    fn prozess(&mut self, mut x: f64, a: &[f64; 4]) -> f64 {
        for (s, a) in self.h.iter_mut().zip(a) {
            let a2 = a * a;
            let y = a2 * (x + s[3]) - s[1];
            *s = [x, s[0], y, s[2]];
            for v in s.iter_mut() {
                if v.abs() < BODEN { *v = 0.0; }
            }
            x = y;
        }
        x
    }
    fn gesund(&self) -> bool { self.h.iter().flatten().all(|v| v.is_finite()) }
}

#[derive(Default, Clone, Copy)]
pub struct Schieber {
    k1: Kette,
    k2: Kette,
    i_verz: f64,
    phase: f64,
}

impl Schieber {
    /// One sample: (`auf`, `ab`). `hz` is clamped to -2000..2000 (non-finite counts as 0).
    #[inline]
    pub fn prozess(&mut self, x: f32, hz: f32, sr: f32) -> (f32, f32) {
        if !x.is_finite() {
            *self = Schieber::default();
            return (0.0, 0.0);
        }
        let hz = if hz.is_finite() { hz.clamp(-MAX_HZ, MAX_HZ) } else { 0.0 } as f64;
        let i = self.i_verz;
        self.i_verz = self.k1.prozess(x as f64, &A1);
        if self.i_verz.abs() < BODEN { self.i_verz = 0.0; }
        let q = self.k2.prozess(x as f64, &A2);
        self.phase += hz / sr as f64;
        self.phase -= self.phase.floor();
        let (s, c) = (std::f64::consts::TAU * self.phase).sin_cos();
        let (auf, ab) = (i * c + q * s, i * c - q * s);
        if !(auf.is_finite() && ab.is_finite() && self.k1.gesund() && self.k2.gesund()) {
            *self = Schieber::default();
            return (0.0, 0.0);
        }
        (auf as f32, ab as f32)
    }

    /// largest state magnitude (for the silence test)
    pub fn zustand(&self) -> Vec<f64> {
        self.k1.h.iter().chain(self.k2.h.iter()).flatten().copied().chain([self.i_verz]).collect()
    }
}
