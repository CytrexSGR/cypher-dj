//! Parameterschicht der RB-338 ohne nih-plug (D1 K2a, Spec 2.4): IDs, Bereiche, Abbildung normiert 0..1 → Wert,
//! Vorgaben und Glättung, wie sie das Plugin (rb338/src/lib.rs) über nih-plug festlegt. Abschrift, weil das Plugin seine
//! Parameter selbst definiert und hier unverändert bleibt; hall_ffi/tests/rb_wie_plugin.rs prüft beide bitgleich
//! gegeneinander (IDs, Reihenfolge, Abbildung, Vorgabe, Glätter). Ändert sich ein Parameter im Plugin, wird der Test rot.
//! Rechenwege wie nih-plug (FloatRange::unnormalize, util::db_to_gain, Smoother), damit die Bits stimmen.
use crate::StimmParams;

/// Die IDs in der Reihenfolge des Plugins (`#[id = …]` in Rb338Params).
pub const IDS: [&str; 7] = ["lautstaerke", "wellenform", "cutoff", "resonanz", "env_mod", "decay", "accent"];
pub const LAUTSTAERKE: usize = 0;
pub const WELLENFORM: usize = 1;
pub const CUTOFF: usize = 2;
pub const RESONANZ: usize = 3;
pub const ENV_MOD: usize = 4;
pub const DECAY: usize = 5;
pub const ACCENT: usize = 6;

#[derive(Clone, Copy, Debug)]
pub enum Bereich {
    Linear { min: f32, max: f32 },
    Schief { min: f32, max: f32, faktor: f32 },
    /// BoolParam: Wert 1.0 über 0,5, sonst 0.0
    Schalter,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Glaettung {
    Keine,
    /// Millisekunden
    Linear(f32),
    /// Millisekunden
    Log(f32),
}

#[derive(Clone, Copy, Debug)]
pub struct Def {
    pub id: &'static str,
    pub name: &'static str,
    pub vorgabe: f32,
    pub bereich: Bereich,
    pub glaettung: Glaettung,
}

impl Def {
    /// Normiert 0..1 → Wert (nih-plug FloatRange::unnormalize, ohne Schrittweite).
    #[inline]
    pub fn wert(&self, normiert: f32) -> f32 {
        match self.bereich {
            Bereich::Schalter => if normiert > 0.5 { 1.0 } else { 0.0 },
            Bereich::Linear { min, max } => (normiert.clamp(0.0, 1.0) * (max - min)) + min,
            Bereich::Schief { min, max, faktor } => (normiert.clamp(0.0, 1.0).powf(faktor.recip()) * (max - min)) + min,
        }
    }
}

/// nih-plug util::db_to_gain
#[inline]
pub fn db_zu_faktor(db: f32) -> f32 { if db > -100.0 { 10.0f32.powf(db * 0.05) } else { 0.0 } }

/// nih-plug FloatRange::skew_factor
pub fn schief(faktor: f32) -> f32 { 2.0f32.powf(faktor) }

/// nih-plug FloatRange::gain_skew_factor
pub fn schief_pegel(min_db: f32, max_db: f32) -> f32 {
    let min = db_zu_faktor(min_db);
    let max = db_zu_faktor(max_db);
    let mitte = db_zu_faktor((max_db + min_db) / 2.0);
    0.5f32.log((mitte - min) / (max - min))
}

/// Die sieben Parameter wie in Rb338Params::default().
pub fn defs() -> [Def; 7] {
    [
        Def { id: "lautstaerke", name: "Volume", vorgabe: db_zu_faktor(-12.0),
              bereich: Bereich::Schief { min: db_zu_faktor(-48.0), max: db_zu_faktor(0.0), faktor: schief_pegel(-48.0, 0.0) },
              glaettung: Glaettung::Log(20.0) },
        Def { id: "wellenform", name: "Square", vorgabe: 0.0, bereich: Bereich::Schalter, glaettung: Glaettung::Keine },
        Def { id: "cutoff", name: "Cutoff", vorgabe: 800.0, bereich: Bereich::Schief { min: 40.0, max: 5000.0, faktor: schief(-2.0) },
              glaettung: Glaettung::Log(20.0) },
        Def { id: "resonanz", name: "Resonance", vorgabe: 0.3, bereich: Bereich::Linear { min: 0.0, max: 1.0 },
              glaettung: Glaettung::Linear(20.0) },
        Def { id: "env_mod", name: "Env Mod", vorgabe: 0.4, bereich: Bereich::Linear { min: 0.0, max: 1.0 },
              glaettung: Glaettung::Linear(20.0) },
        Def { id: "decay", name: "Decay", vorgabe: 0.6, bereich: Bereich::Schief { min: 0.2, max: 2.0, faktor: schief(-1.0) },
              glaettung: Glaettung::Keine },
        Def { id: "accent", name: "Accent", vorgabe: 0.6, bereich: Bereich::Linear { min: 0.0, max: 1.0 }, glaettung: Glaettung::Keine },
    ]
}

/// nih-plug Smoother<f32> für eine Stimme (ohne Atomics): gleiche Schrittzahl, gleiche Schrittweite, letzter Schritt
/// rastet aufs Ziel. `Keine` liefert das Ziel sofort.
#[derive(Clone, Copy, Debug)]
pub struct Glaetter {
    stil: Glaettung,
    uebrig: i32,
    schritt: f32,
    ist: f32,
    ziel: f32,
}

impl Glaetter {
    pub fn neu(stil: Glaettung) -> Self { Self { stil, uebrig: 0, schritt: 0.0, ist: 0.0, ziel: 0.0 } }

    pub fn reset(&mut self, wert: f32) {
        self.ziel = wert;
        self.ist = wert;
        self.uebrig = 0;
    }

    pub fn ziel(&self) -> f32 { self.ziel }

    pub fn setze_ziel(&mut self, sr: f32, ziel: f32) {
        self.ziel = ziel;
        let n = match self.stil {
            Glaettung::Keine => 1,
            Glaettung::Linear(ms) | Glaettung::Log(ms) => (sr * ms / 1000.0).round() as u32,
        };
        self.uebrig = n as i32;
        self.schritt = if n > 0 {
            match self.stil {
                Glaettung::Keine => 0.0,
                Glaettung::Linear(_) => (ziel - self.ist) / (n as f32),
                Glaettung::Log(_) => ((ziel / self.ist) as f64).powf((n as f64).recip()) as f32,
            }
        } else {
            0.0
        };
    }

    #[inline]
    pub fn naechster(&mut self) -> f32 {
        if self.uebrig > 0 {
            let alt = self.uebrig;
            self.uebrig -= 1;
            let neu = if alt == 1 {
                self.uebrig = 0;
                self.ziel
            } else {
                match self.stil {
                    Glaettung::Keine => self.ziel,
                    Glaettung::Linear(_) => self.ist + self.schritt,
                    Glaettung::Log(_) => self.ist * self.schritt,
                }
            };
            self.ist = neu;
            neu
        } else {
            self.ziel
        }
    }
}

/// Parameterstand einer Stimme: Werte setzen (normiert), je Sample die geglätteten Werte holen. Keine Allokation.
#[derive(Clone, Copy)]
pub struct Parameter {
    defs: [Def; 7],
    werte: [f32; 7],
    glaetter: [Glaetter; 7],
    sr: f32,
}

impl Parameter {
    /// Alle auf der Vorgabe, Glätter darauf eingerastet (wie update_smoother(reset) beim Aktivieren des Plugins).
    pub fn neu(sr: f32) -> Self {
        let defs = defs();
        let mut glaetter = [Glaetter::neu(Glaettung::Keine); 7];
        let mut werte = [0.0; 7];
        for (i, d) in defs.iter().enumerate() {
            glaetter[i] = Glaetter::neu(d.glaettung);
            glaetter[i].reset(d.vorgabe);
            werte[i] = d.vorgabe;
        }
        Self { defs, werte, glaetter, sr }
    }

    /// Nummer zur ID (Bytes ohne NUL), sonst None.
    pub fn nummer(id: &[u8]) -> Option<usize> { IDS.iter().position(|i| i.as_bytes() == id) }

    /// Normierten Wert setzen. Wie nih-plug: nur ein geänderter Wert startet den Glätter neu.
    pub fn setze(&mut self, nr: usize, normiert: f32) {
        let w = self.defs[nr].wert(normiert);
        self.setze_wert(nr, w);
    }

    fn setze_wert(&mut self, nr: usize, w: f32) {
        if w != self.werte[nr] {
            self.werte[nr] = w;
            self.glaetter[nr].setze_ziel(self.sr, w);
        }
    }

    /// Alle Parameter auf die Vorgabe des Plugins (wie setze, also geglättet bis zum nächsten `einrasten`).
    pub fn vorgaben(&mut self) {
        for nr in 0..self.defs.len() {
            self.setze_wert(nr, self.defs[nr].vorgabe);
        }
    }

    /// Alle Glätter auf ihr Ziel (Transport-Start: die Parameter stehen sofort, kein Rest einer Rampe).
    pub fn einrasten(&mut self) {
        for (g, w) in self.glaetter.iter_mut().zip(self.werte) {
            g.reset(w);
        }
    }

    /// Werte des nächsten Samples und die Lautstärke (Faktor). Ungeglättete wie im Plugin direkt (`value()`).
    #[inline]
    pub fn naechste(&mut self) -> (StimmParams, f32) {
        let p = StimmParams {
            rechteck: self.werte[WELLENFORM] > 0.5,
            cutoff: self.glaetter[CUTOFF].naechster(),
            resonanz: self.glaetter[RESONANZ].naechster(),
            env_mod: self.glaetter[ENV_MOD].naechster(),
            decay_s: self.werte[DECAY],
            accent: self.werte[ACCENT],
        };
        (p, self.glaetter[LAUTSTAERKE].naechster())
    }
}
