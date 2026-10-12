//! 303-Stimme: Oszillator → Ladder → VCA. Accent = Velocity ≥ ACCENT_AB: mehr Filterhub, mehr Pegel, kurzer Abfall.
//! Slide (Task 3.2): Tonhöhe gleitet, Hüllkurven laufen weiter.
use crate::{huellkurve::{Abfall, Gate}, Ladder, Osz};

/// 120/127: Strudels Vorgabe-Velocity 0,9 (= 114) ist KEIN Akzent, `.velocity(1)` (= 127) ist einer.
pub const ACCENT_AB: f32 = 120.0 / 127.0;

#[derive(Clone, Copy)]
pub struct StimmParams {
    pub rechteck: bool,
    pub cutoff: f32,   // Hz
    pub resonanz: f32, // 0..1
    pub env_mod: f32,  // 0..1
    pub decay_s: f32,
    pub accent: f32,   // 0..1
}

impl Default for StimmParams {
    fn default() -> Self {
        Self { rechteck: false, cutoff: 800.0, resonanz: 0.3, env_mod: 0.4, decay_s: 0.6, accent: 0.6 }
    }
}

#[derive(Default)]
pub struct Stimme {
    osz: Osz,
    filter: Ladder,
    fenv: Abfall,
    gate: Gate,
    an: bool,
    note_hz: f32,
    ist_hz: f32,
    akzent: bool,
    glide: bool,
    cutoff_ist: f32,
}

fn hz(note: u8) -> f32 { 440.0 * 2f32.powf((note as f32 - 69.0) / 12.0) }

impl Stimme {
    /// Anschlag. `slide`: Tonhöhe gleitet vom Ist-Ton, keine neue Hüllkurve.
    pub fn an(&mut self, note: u8, velocity: f32, slide: bool) {
        self.note_hz = hz(note);
        if slide && self.an {
            self.glide = true;
        } else {
            self.ist_hz = self.note_hz;
            self.glide = false;
            self.akzent = velocity >= ACCENT_AB;
            self.fenv.start();
        }
        self.an = true;
    }

    pub fn aus(&mut self) { self.an = false; }

    pub fn klingt(&self) -> bool { self.an || self.gate.wert > 0.0 }

    /// Cutoff des letzten Samples in Hz (für Messungen).
    pub fn cutoff_ist(&self) -> f32 { self.cutoff_ist }

    #[inline]
    pub fn prozess(&mut self, p: &StimmParams, sr: f32) -> f32 {
        if self.glide {
            let k = 1.0 - (-1.0 / (0.06 * sr)).exp(); // 303-Glide ~60 ms
            self.ist_hz += (self.note_hz - self.ist_hz) * k;
        }
        let inc = self.ist_hz / sr;
        let roh = if p.rechteck { self.osz.rechteck(inc) } else { self.osz.saege(inc) };
        let decay = if self.akzent { 0.2 } else { p.decay_s };
        let env = self.fenv.prozess(decay, sr);
        let hub = p.env_mod * if self.akzent { 1.0 + p.accent } else { 1.0 };
        let cutoff = p.cutoff * 2f32.powf(hub * 4.0 * env);
        self.cutoff_ist = cutoff;
        let gefiltert = self.filter.prozess(roh * 0.5, cutoff, p.resonanz, sr);
        let pegel = if self.akzent { 1.0 + 0.6 * p.accent } else { 0.75 };
        let g = self.gate.prozess(self.an, sr);
        gefiltert * g * pegel
    }
}
