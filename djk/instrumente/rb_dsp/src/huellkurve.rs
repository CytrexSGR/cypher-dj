//! Hüllkurven der 303-Stimme: Abfall (Filter, Neustart bei Anschlag) und Gate (Lautstärke, 3 ms an, 8 ms aus).

#[derive(Default, Clone, Copy)]
pub struct Abfall { pub wert: f32 }

impl Abfall {
    #[inline] pub fn start(&mut self) { self.wert = 1.0; }
    /// `zeit_s` = Zeit bis −60 dB.
    #[inline]
    pub fn prozess(&mut self, zeit_s: f32, sr: f32) -> f32 {
        let k = (-6.907_755 / (zeit_s.max(0.01) * sr)).exp();
        self.wert *= k;
        self.wert
    }
}

#[derive(Default, Clone, Copy)]
pub struct Gate { pub wert: f32 }

impl Gate {
    #[inline]
    pub fn prozess(&mut self, an: bool, sr: f32) -> f32 {
        let (ziel, zeit) = if an { (1.0, 0.003) } else { (0.0, 0.008) };
        let k = 1.0 - (-1.0 / (zeit * sr)).exp();
        self.wert += (ziel - self.wert) * k;
        if self.wert < 1e-7 { self.wert = 0.0; }
        self.wert
    }
}
