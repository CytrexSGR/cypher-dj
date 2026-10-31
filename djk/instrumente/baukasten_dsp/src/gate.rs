//! Gate (Slice 4c, D5): öffnet, wenn die Hüllkurve von max(|L|, |R|) über die Schwelle steigt, und schließt erst, wenn
//! sie `hyst` dB darunter fällt (Hysterese gegen Flattern). Geschlossen senkt es um `tiefe` dB ab. Die Verstärkung folgt
//! dem Ziel mit `attack` (öffnen) und `release` (schließen), beides EinPol. Die Hüllkurve hält Spitzen und fällt mit
//! 10 ms, damit Nulldurchgänge das Gate nicht schließen. Frisch und nach dem Zurücksetzen ist es geschlossen.

/// Abfall der Hüllkurve in ms
const HUELLE_MS: f32 = 10.0;
/// kleiner als das wird die Hüllkurve 0 (D11)
const NULL: f32 = 1e-30;

pub struct Gate {
    auf: f32,
    zu: f32,
    tief: f32,
    k_att: f32,
    k_rel: f32,
    a_huelle: f32,
    huelle: f32,
    offen: bool,
    g: f32,
}

impl Gate {
    pub fn neu(schwelle_db: f32, hyst_db: f32, tiefe_db: f32, attack_ms: f32, release_ms: f32, sr: f32) -> Self {
        let k = |ms: f32| 1.0 - (-1.0 / (ms.max(0.01) * sr / 1000.0)).exp();
        let lin = |db: f32| 10f32.powf(db / 20.0);
        let tief = lin(-tiefe_db);
        Gate { auf: lin(schwelle_db), zu: lin(schwelle_db - hyst_db), tief, k_att: k(attack_ms), k_rel: k(release_ms),
               a_huelle: (-1.0 / (HUELLE_MS * sr / 1000.0)).exp(), huelle: 0.0, offen: false, g: tief }
    }

    pub fn offen(&self) -> bool {
        self.offen
    }

    /// aktuelle Verstärkung (linear)
    pub fn verstaerkung(&self) -> f32 {
        self.g
    }

    /// aktuelle Hüllkurve (linear)
    pub fn huelle(&self) -> f32 {
        self.huelle
    }

    #[inline]
    pub fn prozess(&mut self, l: f32, r: f32) -> (f32, f32) {
        let p = l.abs().max(r.abs());
        let p = if p.is_finite() { p } else { 0.0 };
        self.huelle = p.max(self.huelle * self.a_huelle);
        if self.huelle < NULL {
            self.huelle = 0.0;
        }
        if !self.offen && self.huelle > self.auf {
            self.offen = true;
        } else if self.offen && self.huelle < self.zu {
            self.offen = false;
        }
        let ziel = if self.offen { 1.0 } else { self.tief };
        let k = if ziel > self.g { self.k_att } else { self.k_rel };
        self.g += k * (ziel - self.g);
        (l * self.g, r * self.g)
    }

    pub fn zuruecksetzen(&mut self) {
        self.huelle = 0.0;
        self.offen = false;
        self.g = self.tief;
    }
}
