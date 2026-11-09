//! Phaser (S7): a chain of first-order all-passes with one shared coefficient per channel, swept by a triangle LFO, with
//! feedback from the last stage. Port of `djk/core/src/beatfx.cpp` (case PHASER) with the parameters it hardcodes exposed.
//! Per channel and sample: `u = in + fb * rueck`, `y = c * u + z; z = u - c * y` through all stages, `rueck` = last stage,
//! out = `(1 - mix) * in + mix * u` (D5 to D8, D11). One `tan` per channel per sample; the LFO phase is f64 (R4).

const MAX_STUFEN: usize = 12;
/// below this a state value is flushed to 0 (denormal guard)
const NULL: f32 = 1e-30;
const FB_MAX: f32 = 0.95;

pub struct Phaser {
    sr: f64,
    stufen: usize,
    tief: f64,
    hoch: f64,
    /// offset of the right LFO as a fraction of a period
    breite: f64,
    phi: f64,
    z: [[f32; MAX_STUFEN]; 2],
    rueck: [f32; 2],
    fc: (f32, f32),
}

/// triangle of D6: t(0) = 0.5, rises to 1 at phi 0.25, falls to 0 at 0.75, rises again; equals beatfx `dreieck(phi + 0.25)`
#[inline]
fn dreieck(phi: f64) -> f64 {
    if phi < 0.25 {
        0.5 + 2.0 * phi
    } else if phi < 0.75 {
        1.5 - 2.0 * phi
    } else {
        2.0 * phi - 1.5
    }
}

impl Phaser {
    /// `stufen` even 2..=12 (checked by the translator); `tief < hoch` are the sweep limits in Hz
    pub fn neu(sr: f32, stufen: usize, tief: f32, hoch: f32, breite_grad: f32) -> Self {
        Phaser {
            sr: sr as f64,
            stufen: stufen.clamp(1, MAX_STUFEN),
            tief: tief as f64,
            hoch: hoch as f64,
            breite: breite_grad as f64 / 360.0,
            phi: 0.0,
            z: [[0.0; MAX_STUFEN]; 2],
            rueck: [0.0; 2],
            fc: (0.0, 0.0),
        }
    }

    /// Centre frequencies used for the last sample (left, right), for tests and display
    pub fn fc_lr(&self) -> (f32, f32) { self.fc }

    /// Largest absolute value of all state (tests: the denormal guard must leave exactly 0 after silence)
    pub fn zustand_betrag(&self) -> f32 {
        let z = self.z.iter().flatten().fold(0.0f32, |m, v| m.max(v.abs()));
        z.max(self.rueck[0].abs()).max(self.rueck[1].abs())
    }

    pub fn zuruecksetzen(&mut self) {
        self.phi = 0.0;
        self.z = [[0.0; MAX_STUFEN]; 2];
        self.rueck = [0.0; 2];
        self.fc = (0.0, 0.0);
    }

    #[inline]
    fn fc_von(&self, phi: f64, tiefe: f64) -> f64 {
        let t = dreieck(phi);
        (self.tief * (self.hoch / self.tief).powf(0.5 + tiefe * (t - 0.5))).clamp(10.0, 0.45 * self.sr)
    }

    /// One sample for both channels. `rate` in Hz (0 freezes the sweep at the middle), `tiefe` 0..1, `fb` -0.95..0.95,
    /// `mix` 0..1 (all clamped). Non-finite input becomes 0. Allocation free.
    #[inline]
    pub fn prozess(&mut self, l: f32, r: f32, rate: f32, tiefe: f32, fb: f32, mix: f32) -> (f32, f32) {
        let ein = [if l.is_finite() { l } else { 0.0 }, if r.is_finite() { r } else { 0.0 }];
        let tiefe = tiefe.clamp(0.0, 1.0) as f64;
        let fb = fb.clamp(-FB_MAX, FB_MAX);
        let mix = mix.clamp(0.0, 1.0);
        let phi = [self.phi, (self.phi + self.breite).rem_euclid(1.0)];
        let mut aus = [0.0f32; 2];
        for k in 0..2 {
            let fc = self.fc_von(phi[k], tiefe);
            let tn = (std::f64::consts::PI * fc / self.sr).tan();
            let c = ((tn - 1.0) / (tn + 1.0)) as f32;
            let mut u = ein[k] + fb * self.rueck[k];
            for s in 0..self.stufen {
                let y = c * u + self.z[k][s];
                let z = u - c * y;
                self.z[k][s] = if z.abs() < NULL { 0.0 } else { z };
                u = y;
            }
            self.rueck[k] = if u.abs() < NULL { 0.0 } else { u };
            aus[k] = (1.0 - mix) * ein[k] + mix * u;
            if k == 0 {
                self.fc.0 = fc as f32;
            } else {
                self.fc.1 = fc as f32;
            }
        }
        self.phi = (self.phi + rate.clamp(0.0, 0.5 * self.sr as f32) as f64 / self.sr).rem_euclid(1.0);
        (aus[0], aus[1])
    }
}
