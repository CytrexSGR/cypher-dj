//! Oszillatoren des Baukastens: Säge und Puls mit PolyBLEP, Dreieck mit PolyBLAMP (Spec E9), Sinus mit linearer FM
//! durch null, weißes Rauschen. Die Säge rechnet ohne Sync bitgleich wie `rb_dsp::Osz::saege` (Slice 1).
//!
//! Harter Sync: ein Eingang `sync` ≥ 1 setzt die Phase zurück. Was über 1 liegt, ist der Bruchteil des Samples seit dem
//! Rücksetzen, so wie ihn der Ausgang `zyklus` eines Leit-Oszillators liefert (1 + Bruchteil im Sample nach dem
//! Phasenüberlauf, sonst 0); ein einfacher Trigger (1,0) setzt auf den Sampleanfang. Geglättet wird nur die Hälfte nach
//! dem Sprung, die Hälfte davor liegt schon im vorigen Sample: das drückt das Aliasing, beseitigt es nicht.

/// PolyBLEP-Rest für einen Sprung um −2 am Phasenüberlauf (wie rb_dsp).
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

/// Nur die Hälfte nach dem Sprung (für Sync).
#[inline]
fn blep_nach(t: f32, dt: f32) -> f32 {
    if dt > 0.0 && t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else {
        0.0
    }
}

/// PolyBLAMP-Rest einer Knickstelle mit Steigungsänderung 1 je Sample: Integral des PolyBLEP-Rests,
/// (1 + x)³/6 vor und (1 − x)³/6 nach der Ecke, x in Samples.
#[inline]
fn blamp(t: f32, dt: f32) -> f32 {
    if dt <= 0.0 {
        0.0
    } else if t < dt {
        let x = 1.0 - t / dt;
        x * x * x / 6.0
    } else if t > 1.0 - dt {
        let x = 1.0 + (t - 1.0) / dt;
        x * x * x / 6.0
    } else {
        0.0
    }
}

#[inline]
fn bruch(x: f32) -> f32 { x - x.floor() }

/// Phase 0..1 mit Merker für den Überlauf; gemeinsam für Säge, Puls und Dreieck.
#[derive(Default, Clone, Copy)]
pub struct Osz {
    phase: f32,
    /// zyklus-Wert für das laufende Sample (1 + Bruchteil nach dem Überlauf, sonst 0)
    zyklus: f32,
}

impl Osz {
    /// Rücksetzen bei Sync. Gibt die Phase im Moment des Rücksetzens zurück (für die Sprunghöhe), sonst None.
    #[inline]
    fn sync(&mut self, sync: f32, inc: f32) -> Option<f32> {
        if sync < 1.0 {
            return None;
        }
        let d = (sync - 1.0).clamp(0.0, 1.0);
        let vorher = bruch(self.phase + (1.0 - d) * inc);
        self.phase = d * inc;
        Some(vorher)
    }

    #[inline]
    fn weiter(&mut self, inc: f32) {
        self.phase += inc;
        self.zyklus = 0.0;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
            self.zyklus = 1.0 + if inc > 0.0 { (self.phase / inc).min(0.999_999) } else { 0.0 };
        }
    }

    /// Ausgang `zyklus` des laufenden Samples (vor `weiter`).
    #[inline]
    pub fn zyklus(&self) -> f32 { self.zyklus }

    /// Säge −1..1, `inc` = Frequenz / Abtastrate (0..0,5).
    #[inline]
    pub fn saege(&mut self, inc: f32, sync: f32) -> (f32, f32) {
        let z = self.zyklus;
        let y = match self.sync(sync, inc) {
            None => 2.0 * self.phase - 1.0 - blep(self.phase, inc),
            // Sprung von 2·vorher − 1 auf −1: Höhe −2·vorher
            Some(vorher) => 2.0 * self.phase - 1.0 - vorher * blep_nach(self.phase, inc),
        };
        self.weiter(inc);
        (y, z)
    }

    /// Puls −1..1 mit Tastgrad `breite` (0,02..0,98).
    #[inline]
    pub fn puls(&mut self, inc: f32, breite: f32, sync: f32) -> (f32, f32) {
        let z = self.zyklus;
        let b = breite.clamp(0.02, 0.98);
        let gesprungen = self.sync(sync, inc);
        let t = self.phase;
        let mut y = if t < b { 1.0 } else { -1.0 };
        match gesprungen {
            None => y += blep(t, inc),
            // Sprung von −1 auf +1 nur, wenn die Phase schon hinter der fallenden Flanke stand
            Some(vorher) if vorher >= b => y += blep_nach(t, inc),
            Some(_) => {}
        }
        y -= blep(bruch(t + 1.0 - b), inc);
        self.weiter(inc);
        (y, z)
    }

    /// Dreieck −1..1 (Spitze bei Phase 0, Tal bei 0,5).
    #[inline]
    pub fn dreieck(&mut self, inc: f32, sync: f32) -> (f32, f32) {
        let z = self.zyklus;
        let gesprungen = self.sync(sync, inc);
        let t = self.phase;
        let mut y = 4.0 * (t - 0.5).abs() - 1.0;
        // Steigung je Sample ±4·inc: an der Spitze −8·inc, im Tal +8·inc
        y += 8.0 * inc * blamp(bruch(t + 0.5), inc);
        match gesprungen {
            None => y -= 8.0 * inc * blamp(t, inc),
            // Sprung auf die Spitze: Höhe 1 − Dreieck(vorher)
            Some(vorher) => y += 0.5 * (1.0 - (4.0 * (vorher - 0.5).abs() - 1.0)) * blep_nach(t, inc),
        }
        self.weiter(inc);
        (y, z)
    }
}

/// Sinus mit linearer FM: `inc` darf negativ werden (FM durch null), die Phase läuft dann rückwärts.
#[derive(Default, Clone, Copy)]
pub struct Sinus {
    phase: f32,
    zyklus: f32,
}

impl Sinus {
    #[inline]
    pub fn sample(&mut self, inc: f32, sync: f32) -> (f32, f32) {
        let z = self.zyklus;
        if sync >= 1.0 {
            self.phase = (sync - 1.0).clamp(0.0, 1.0) * inc.max(0.0);
        }
        let y = (std::f32::consts::TAU * self.phase).sin();
        self.phase += inc;
        self.zyklus = 0.0;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
            self.zyklus = 1.0 + if inc > 0.0 { (self.phase / inc).min(0.999_999) } else { 0.0 };
        } else if self.phase < 0.0 {
            self.phase += 1.0;
        }
        self.phase = self.phase.clamp(0.0, 0.999_999_9);
        (y, z)
    }
}

/// Weißes Rauschen −1..1, xorshift32 je Stimme mit eigenem Startwert (bitgleich bei gleichem Graphen).
#[derive(Clone, Copy)]
pub struct Rauschen {
    s: u32,
}

impl Rauschen {
    pub fn neu(stimme: usize) -> Self { Self { s: 0x9E37_79B9 ^ (stimme as u32 + 1).wrapping_mul(0x85EB_CA6B) } }

    #[inline]
    pub fn sample(&mut self) -> f32 {
        let mut x = self.s;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.s = x;
        x as i32 as f32 * (1.0 / 2_147_483_648.0)
    }
}
