//! Sägezahn und Rechteck mit PolyBLEP (bandbegrenzte Kanten, kein Aliasing-Kreischen in hohen Lagen).

#[derive(Default, Clone, Copy)]
pub struct Osz {
    phase: f32,
}

#[inline]
fn blep(t: f32, dt: f32) -> f32 {
    if dt <= 0.0 {
        0.0
    } else if t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + x + x + 1.0
    } else {
        0.0
    }
}

impl Osz {
    /// Ein Sample Sägezahn (−1..1). `inc` = Frequenz / Abtastrate.
    #[inline]
    pub fn saege(&mut self, inc: f32) -> f32 {
        let t = self.phase;
        let y = 2.0 * t - 1.0 - blep(t, inc);
        self.weiter(inc);
        y
    }

    /// Ein Sample Rechteck (−1..1, Tastgrad 50 %).
    #[inline]
    pub fn rechteck(&mut self, inc: f32) -> f32 {
        let t = self.phase;
        let mut y = if t < 0.5 { 1.0 } else { -1.0 };
        y += blep(t, inc);
        let mut t2 = t + 0.5;
        if t2 >= 1.0 { t2 -= 1.0; }
        y -= blep(t2, inc);
        self.weiter(inc);
        y
    }

    #[inline]
    fn weiter(&mut self, inc: f32) {
        self.phase += inc;
        if self.phase >= 1.0 { self.phase -= 1.0; }
    }
}
