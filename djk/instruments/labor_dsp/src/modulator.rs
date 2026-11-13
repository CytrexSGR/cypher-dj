//! The modulator: one attack and one decay stage, run once per trigger (envelope) or in a loop (cycle). Output 0..1.
//!
//! Duration and shape are separate: a sample counter sets how long a stage lasts, a fixed curve sets its form.
//! The attack charges towards a target above 1 and ends when it crosses 1 (the "logarithmic" rise of an analog
//! envelope), the decay falls exponentially and ends at 0. A trigger during a run restarts the attack from the
//! present value, like a capacitor that is charged again.

/// Curvature of both stages (how many time constants fit into one stage).
const FORM: f64 = 4.0;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Stufe {
    Aus,
    Attack,
    Decay,
}

pub struct Modulator {
    fs: f64,
    stufe: Stufe,
    /// Samples spent in the stage, and the value the stage started from.
    n: f64,
    start: f64,
    wert: f64,
    zyklus: bool,
    norm: f64,
}

impl Modulator {
    pub fn neu(fs: f64) -> Self {
        Modulator { fs, stufe: Stufe::Aus, n: 0.0, start: 0.0, wert: 0.0, zyklus: false, norm: 1.0 / (1.0 - (-FORM).exp()) }
    }

    pub fn leeren(&mut self) {
        self.stufe = Stufe::Aus;
        self.n = 0.0;
        self.start = 0.0;
        self.wert = 0.0;
    }

    pub fn zyklus(&mut self, an: bool) {
        self.zyklus = an;
    }

    pub fn trigger(&mut self) {
        self.stufe = Stufe::Attack;
        self.n = 0.0;
        self.start = self.wert;
    }

    /// One sample; `attack_s` and `decay_s` are the lengths of the two stages.
    #[inline]
    pub fn schritt(&mut self, attack_s: f64, decay_s: f64) -> f64 {
        if self.stufe == Stufe::Aus {
            if !self.zyklus {
                return self.wert;
            }
            self.trigger();
        }
        self.n += 1.0;
        match self.stufe {
            Stufe::Attack => {
                let t = self.n / (attack_s * self.fs);
                if t >= 1.0 {
                    self.wert = 1.0;
                    self.stufe = Stufe::Decay;
                    self.n = 0.0;
                } else {
                    self.wert = self.start + (1.0 - self.start) * (1.0 - (-FORM * t).exp()) * self.norm;
                }
            }
            Stufe::Decay => {
                let t = self.n / (decay_s * self.fs);
                if t >= 1.0 {
                    self.wert = 0.0;
                    self.stufe = Stufe::Aus;
                    self.n = 0.0;
                } else {
                    self.wert = ((-FORM * t).exp() - (-FORM).exp()) * self.norm;
                }
            }
            Stufe::Aus => {}
        }
        self.wert
    }
}
