//! 4-Pol-Tiefpass als Ladder in TPT-Form (Zavalishin, „The Art of VA Filter Design", Kap. 5), tanh am Eingang.
//! W1-Näherung an den 303-Charakter; der Diodenleiter-Klang wird in W2 nach Andreas' Ohr nachgestellt.

#[derive(Default, Clone, Copy)]
pub struct Ladder {
    s: [f32; 4],
}

impl Ladder {
    /// `reso` 0..1 (1 = Selbstoszillation), `cutoff` in Hz.
    #[inline]
    pub fn prozess(&mut self, x: f32, cutoff: f32, reso: f32, sr: f32) -> f32 {
        let fc = cutoff.clamp(20.0, sr * 0.45);
        let g = (std::f32::consts::PI * fc / sr).tan();
        let gg = g / (1.0 + g);
        let k = 4.0 * reso.clamp(0.0, 1.0);
        // Rückkopplungsschätzung aus den Zuständen (geschlossene Form der linearen Kaskade)
        let g2 = gg * gg;
        let sigma = gg * g2 * self.s[0] / (1.0 + g) + g2 * self.s[1] / (1.0 + g) + gg * self.s[2] / (1.0 + g) + self.s[3] / (1.0 + g);
        let u = ((x - k * sigma) / (1.0 + k * g2 * g2)).tanh();
        let mut v = u;
        for s in self.s.iter_mut() {
            let w = gg * (v - *s);
            let y = w + *s;
            *s = y + w;
            v = y;
        }
        if !v.is_finite() { self.s = [0.0; 4]; return 0.0; }
        v
    }
}
