//! ADSR-Hüllkurve je Stimme: Attack linear, Decay und Release exponentiell (einpolig, Zeit bis −60 dB).
//! Ein Anschlag (`trig`) oder eine steigende Gate-Flanke startet den Attack beim aktuellen Wert, nicht bei null:
//! eine geklaute Stimme springt nicht auf null und knackt deshalb nicht. Ist das Gate aus, geht jede Phase außer Ruhe in
//! den Release, auch wenn Anschlag und Loslassen ins selbe Sample fallen (sonst hinge die Hüllkurve auf Sustain).

#[derive(Clone, Copy, Default, Debug, PartialEq)]
enum Phase {
    #[default]
    Ruhe,
    Attack,
    Decay,
    Release,
}

#[derive(Clone, Copy, Debug)]
pub struct AdsrZeiten {
    /// Sekunden von 0 bis 1
    pub a: f32,
    /// Sekunden bis −60 dB Richtung Sustain
    pub d: f32,
    /// Pegel 0..1
    pub s: f32,
    /// Sekunden bis −60 dB
    pub r: f32,
}

#[derive(Clone, Copy, Default, Debug)]
pub struct Adsr {
    phase: Phase,
    pub wert: f32,
    gate_vorher: bool,
}

impl Adsr {
    #[inline]
    pub fn prozess(&mut self, gate: bool, trig: bool, z: &AdsrZeiten, sr: f32) -> f32 {
        if trig || (gate && !self.gate_vorher) {
            self.phase = Phase::Attack;
        }
        if !gate && matches!(self.phase, Phase::Attack | Phase::Decay) {
            self.phase = Phase::Release;
        }
        self.gate_vorher = gate;
        match self.phase {
            Phase::Ruhe => self.wert = 0.0,
            Phase::Attack => {
                self.wert += 1.0 / (z.a.max(0.0005) * sr);
                if self.wert >= 1.0 {
                    self.wert = 1.0;
                    self.phase = Phase::Decay;
                }
            }
            Phase::Decay => {
                let s = z.s.clamp(0.0, 1.0);
                let k = (-6.907_755 / (z.d.max(0.001) * sr)).exp();
                self.wert = s + (self.wert - s) * k;
            }
            Phase::Release => {
                let k = (-6.907_755 / (z.r.max(0.001) * sr)).exp();
                self.wert *= k;
                if self.wert < 1e-6 {
                    self.wert = 0.0;
                    self.phase = Phase::Ruhe;
                }
            }
        }
        self.wert
    }
}
