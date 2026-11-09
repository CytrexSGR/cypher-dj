//! Zustandsvariables Filter in TPT-Form (Zavalishin, „The Art of VA Filter Design“, Kap. 4), gerechnet in f64
//! (Spec E17: Zustände bei tiefer Grenzfrequenz und hoher Güte). Ausgänge Tief-, Band- und Hochpass.
//! Resonanz 0..1: 0 = Butterworth (k = √2, −3 dB an der Grenzfrequenz), 1 = Güte 25 (k = 0,04).
//! 4 Pole: zwei Stufen in Reihe, je Ausgang eine eigene zweite Stufe; bei Resonanz 0 Butterworth 4. Ordnung
//! (k = 1,848 und 0,765), die Resonanz verengt nur die zweite Stufe.

#[derive(Default, Clone, Copy)]
pub struct Stufe {
    ic1: f64,
    ic2: f64,
}

impl Stufe {
    /// (tp, bp, hp) für Eingang `x`, Vorverzerrung `g` = tan(π·fc/sr), Dämpfung `k` = 1/Q.
    #[inline]
    pub fn prozess(&mut self, x: f64, g: f64, k: f64) -> (f64, f64, f64) {
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;
        let v3 = x - self.ic2;
        let v1 = a1 * self.ic1 + a2 * v3;
        let v2 = self.ic2 + a2 * self.ic1 + a3 * v3;
        self.ic1 = 2.0 * v1 - self.ic1;
        self.ic2 = 2.0 * v2 - self.ic2;
        (v2, v1, x - k * v1 - v2)
    }
}

/// Erste Stufe und je Ausgang eine zweite (tp, bp, hp) für 4 Pole.
#[derive(Default, Clone, Copy)]
pub struct Svf {
    eins: Stufe,
    zwei: [Stufe; 3],
}

const BUTTER4: (f64, f64) = (1.847_759, 0.765_367);

impl Svf {
    #[inline]
    pub fn prozess(&mut self, x: f32, cutoff: f32, reso: f32, vier: bool, sr: f32) -> (f32, f32, f32) {
        let fc = (cutoff as f64).clamp(20.0, sr as f64 * 0.45);
        let g = (std::f64::consts::PI * fc / sr as f64).tan();
        let r = (reso as f64).clamp(0.0, 1.0);
        let (tp, bp, hp) = if !vier {
            self.eins.prozess(x as f64, g, std::f64::consts::SQRT_2 * (1.0 - r) + 0.04 * r)
        } else {
            let k2 = BUTTER4.1 * (1.0 - r) + 0.04 * r;
            let (t1, b1, h1) = self.eins.prozess(x as f64, g, BUTTER4.0);
            (self.zwei[0].prozess(t1, g, k2).0, self.zwei[1].prozess(b1, g, k2).1, self.zwei[2].prozess(h1, g, k2).2)
        };
        if !(tp.is_finite() && bp.is_finite() && hp.is_finite()) {
            *self = Svf::default();
            return (0.0, 0.0, 0.0);
        }
        (tp as f32, bp as f32, hp as f32)
    }
}
