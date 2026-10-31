//! LFO je Stimme, −1..1, Rate in Hz. Formen: 0 Sinus, 1 Dreieck, 2 Säge steigend, 3 Rechteck, 4 Zufall (neuer Wert je
//! Periode). Nicht bandbegrenzt, gedacht für langsame Modulation. Ohne `neustart` laufen alle Stimmen phasengleich
//! (gleicher Start, gleiche Rate); mit `neustart` = 1 beginnt die Periode bei jedem Anschlag der Stimme neu.
//! Taktsynchron mit dem Wert `takt` (Beats je Periode, S3c): die Phase kommt dann aus dem Host-Beat (`Programm::setze_takt`).
use crate::osz::Rauschen;

#[derive(Clone, Copy)]
pub struct Lfo {
    phase: f32,
    halt: f32,
    zufall: Rauschen,
}

impl Lfo {
    pub fn neu(stimme: usize) -> Self {
        let mut zufall = Rauschen::neu(stimme + 101);
        Self { phase: 0.0, halt: zufall.sample(), zufall }
    }

    #[inline]
    fn welle(&self, t: f32, form: u8) -> f32 {
        match form {
            0 => (std::f32::consts::TAU * t).sin(),
            1 => 1.0 - 4.0 * (t - 0.5).abs(),
            2 => 2.0 * t - 1.0,
            3 => if t < 0.5 { 1.0 } else { -1.0 },
            _ => self.halt,
        }
    }

    #[inline]
    pub fn sample(&mut self, rate_hz: f32, form: u8, neu: bool, sr: f32) -> f32 {
        if neu {
            self.phase = 0.0;
        }
        let y = self.welle(self.phase, form);
        self.phase += (rate_hz / sr).clamp(0.0, 0.5);
        if self.phase >= 1.0 {
            self.phase -= 1.0;
            self.halt = self.zufall.sample();
        }
        y
    }

    /// Taktsynchron (S3c, D8): Phase 0..1 vom Host-Beat; Zufall zieht beim Umlauf (Phase fällt) einen neuen Wert
    #[inline]
    pub fn bei_phase(&mut self, t: f32, form: u8) -> f32 {
        if t < self.phase {
            self.halt = self.zufall.sample();
        }
        self.phase = t;
        self.welle(t, form)
    }
}
