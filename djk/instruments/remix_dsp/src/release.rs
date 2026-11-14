//! Release FX: a lever. Pulling it replaces the sound by a way out (the record slows to a stop, the last beat echoes
//! away, or the record spins back); letting go returns to the original sound. How far the lever is pulled selects one
//! of three lengths. Lengths, the speed curves and the echo decay are a DECISION of the model.

use crate::teile::{Glatt, Ring};

pub const VINYL_BRAKE: u8 = 0;
pub const ECHO: u8 = 1;
pub const BACK_SPIN: u8 = 2;

/// Lengths in beats for the three lever ranges (a slight pull is the long way out, a full pull the short one).
pub const BREMS_BEATS: [f64; 3] = [2.0, 1.0, 0.5];
pub const SPIN_BEATS: [f64; 3] = [2.0, 1.0, 0.5];
pub const ECHO_BEATS: [f64; 3] = [1.0, 0.5, 0.25];
/// Each repeat of the release echo is this much quieter (about -2.9 dB).
pub const ECHO_ABFALL: f32 = 0.72;
/// Memory in seconds: a back spin over two beats at 60 BPM reads about 5 s back.
const RING_S: f64 = 5.4;
const KANTE: f64 = 64.0;

/// The lever range of a position 0..1: 0 = at rest, 1..3 = pulled.
pub fn bereich(hebel: f32) -> usize {
    match hebel {
        h if h < 0.05 => 0,
        h if h < 0.37 => 1,
        h if h < 0.68 => 2,
        _ => 3,
    }
}

#[derive(Clone, Debug)]
pub struct Release {
    sr: f64,
    ring: [Ring; 2],
    aktiv: bool,
    typ: u8,
    bereich: usize,
    g: Glatt,
    /// Brake: playback speed. Back spin: progress 0..1.
    lauf: f64,
    /// Distance of the read head behind the newest sample.
    dist: f64,
    /// Echo: position inside the repeat and its level.
    j: f64,
    pegel: f32,
}

impl Release {
    pub fn neu(sr: f64) -> Self {
        Release {
            sr,
            ring: [Ring::neu((RING_S * sr) as usize), Ring::neu((RING_S * sr) as usize)],
            aktiv: false,
            typ: VINYL_BRAKE,
            bereich: 1,
            g: Glatt::neu(sr, 2.0),
            lauf: 0.0,
            dist: 1.0,
            j: 0.0,
            pegel: 1.0,
        }
    }

    pub fn leeren(&mut self) {
        self.ring.iter_mut().for_each(|r| r.vergiss());
        self.aktiv = false;
        self.g.setze(0.0);
    }

    pub fn wirkt(&self) -> bool {
        self.aktiv || self.g.wert > 0.0
    }

    /// One sample. Returns the output and whether the lever went back to rest on this sample.
    #[inline]
    pub fn tick(&mut self, l: f32, r: f32, typ: u8, hebel: f32, spb: f64) -> (f32, f32, bool) {
        let b = bereich(hebel);
        let mut ende = false;
        if b > 0 && !self.aktiv {
            self.aktiv = true;
            self.typ = typ.min(BACK_SPIN);
            self.lauf = if self.typ == VINYL_BRAKE { 1.0 } else { 0.0 };
            self.dist = 1.0;
            self.j = 0.0;
            self.pegel = 1.0;
        } else if b == 0 && self.aktiv {
            self.aktiv = false;
            ende = true;
        }
        if b > 0 {
            self.bereich = b;
        }
        // the echo repeats what was there before the pull, so the memory stands still while it runs
        if !(self.aktiv && self.typ == ECHO) {
            self.ring[0].schreibe(l);
            self.ring[1].schreibe(r);
        }
        let g = self.g.zu(if self.aktiv { 1.0 } else { 0.0 });
        if g == 0.0 {
            return (l, r, ende);
        }
        let max = (self.ring[0].laenge() - 2) as f64;
        let z = self.bereich - 1;
        let (yl, yr) = match self.typ {
            VINYL_BRAKE => {
                // the speed falls in a straight line to a stop
                self.lauf = (self.lauf - 1.0 / (BREMS_BEATS[z] * spb)).max(0.0);
                self.dist = (self.dist + 1.0 - self.lauf).min(max);
                let a = (self.lauf * 8.0).min(1.0) as f32;
                (self.ring[0].lies_bruch(self.dist) * a, self.ring[1].lies_bruch(self.dist) * a)
            }
            BACK_SPIN => {
                // backwards at three times the speed, slowing down, faded out over the last fifth
                self.lauf = (self.lauf + 1.0 / (SPIN_BEATS[z] * spb)).min(1.0);
                let tempo = 3.0 * (1.0 - self.lauf).powf(1.5) + 0.3;
                self.dist += 1.0 + tempo;
                let a = if self.dist >= max { 0.0 } else { ((1.0 - self.lauf) * 5.0).min(1.0) as f32 };
                (self.ring[0].lies_bruch(self.dist.min(max)) * a, self.ring[1].lies_bruch(self.dist.min(max)) * a)
            }
            _ => {
                let d = (ECHO_BEATS[z] * spb).clamp(2.0 * KANTE + 2.0, max);
                if self.j >= d {
                    self.j = 0.0;
                    self.pegel *= ECHO_ABFALL;
                }
                let kante = KANTE * self.sr / 48000.0;
                let a = (self.j / kante).min((d - self.j) / kante).min(1.0) as f32 * self.pegel;
                let dist = d - self.j;
                self.j += 1.0;
                (self.ring[0].lies_bruch(dist) * a, self.ring[1].lies_bruch(dist) * a)
            }
        };
        (l + (yl - l) * g, r + (yr - r) * g, ende)
    }
}
