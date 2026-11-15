//! Linkwitz-Riley crossover, 2 or 3 bands (Zavalishin, "The Art of VA Filter Design", chapter 10). Each split is two
//! Butterworth 2nd-order state-variable stages in series (k = sqrt 2), so low and high are in phase, -6 dB at the corner and
//! 24 dB/oct, and low + high is an all-pass of magnitude 1. The first stage of a split is shared by both outputs (it yields tp
//! and hp), a second stage per output follows. Three bands: the high output of split 1 is split again at fc2; the low band runs
//! through the sum of the fc2 split (the all-pass the mid and high bands carry), otherwise the sum would dip near the corners.
//! `fc2` below `fc1` is clamped to `fc1`: the mid band is then the narrow band-pass LP4 * HP4 at fc1, not silence.
//! States in f64; a non-finite value resets the block and returns zeros.
use crate::svf::Stufe;

const K: f64 = std::f64::consts::SQRT_2;

/// One LR4 split: shared first stage, one second stage per output.
#[derive(Default, Clone, Copy)]
struct Teilung {
    eins: Stufe,
    lo: Stufe,
    hi: Stufe,
}

impl Teilung {
    #[inline]
    fn prozess(&mut self, x: f64, g: f64) -> (f64, f64) {
        let (tp, _, hp) = self.eins.prozess(x, g, K);
        let aus = (self.lo.prozess(tp, g, K).0, self.hi.prozess(hp, g, K).2);
        self.eins.flush();
        self.lo.flush();
        self.hi.flush();
        aus
    }

    fn zustaende(&self) -> [f64; 6] {
        let (a, b, c) = (self.eins.zustand(), self.lo.zustand(), self.hi.zustand());
        [a[0], a[1], b[0], b[1], c[0], c[1]]
    }
}

#[derive(Default, Clone, Copy)]
pub struct Kreuz {
    erste: Teilung,
    zweite: Teilung,
    ausgleich: Teilung,
}

#[inline]
fn vorverzerrung(fc: f64, sr: f64) -> f64 { (std::f64::consts::PI * fc.clamp(20.0, sr * 0.45) / sr).tan() }

impl Kreuz {
    /// (lo, mid, hi); `baender` 2 leaves `mid` at exactly 0.0 and ignores `fc2`.
    #[inline]
    pub fn prozess(&mut self, x: f32, fc1: f32, fc2: f32, baender: u8, sr: f32) -> (f32, f32, f32) {
        let sr = sr as f64;
        let (lo, mid, hi) = if baender >= 3 {
            let fc1 = (fc1 as f64).clamp(20.0, sr * 0.45);
            let fc2 = (fc2 as f64).max(fc1);
            let (g1, g2) = (vorverzerrung(fc1, sr), vorverzerrung(fc2, sr));
            let (tief, hoch) = self.erste.prozess(x as f64, g1);
            let (mitte, oben) = self.zweite.prozess(hoch, g2);
            let (a, b) = self.ausgleich.prozess(tief, g2);
            (a + b, mitte, oben)
        } else {
            let (tief, hoch) = self.erste.prozess(x as f64, vorverzerrung(fc1 as f64, sr));
            (tief, 0.0, hoch)
        };
        if !(lo.is_finite() && mid.is_finite() && hi.is_finite()) {
            *self = Kreuz::default();
            return (0.0, 0.0, 0.0);
        }
        (lo as f32, mid as f32, hi as f32)
    }

    /// All integrator states (for the silence test).
    pub fn zustaende(&self) -> [f64; 18] {
        let mut z = [0.0; 18];
        for (i, t) in [&self.erste, &self.zweite, &self.ausgleich].into_iter().enumerate() {
            z[i * 6..i * 6 + 6].copy_from_slice(&t.zustaende());
        }
        z
    }
}
