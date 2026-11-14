//! Pad section: a roll of the input and four synthesized drum voices, both driven by one touch position in the beat
//! grid. A touch repeats what is selected at the interval the position names; a pattern of four beats can be recorded.
//!
//! The drum voices are our own synthesis (a swept sine, two triangles with noise, noise bursts, filtered noise); they
//! are not samples of any device.

use crate::teile::{Aufnahme, Glatt, Rauschen, Svf};

/// Touch positions left to right: the interval in beats.
pub const ZONEN: [f64; 5] = [0.125, 0.25, 0.5, 1.0, 2.0];
pub const KICK: usize = 0;
pub const SNARE: usize = 1;
pub const CLAP: usize = 2;
pub const HAT: usize = 3;
/// Steps of the recorded pattern: sixteenths over four beats.
pub const SCHRITTE: usize = 16;
const KANTE: f64 = 64.0;
/// Noise seeds of the four voices (set again by `leeren`, so a cleared device repeats bit for bit).
const SAAT: [u32; 4] = [0x51ED_270B, 0x2545_F491, 0x9E37_79B9, 0x7F4A_7C15];

/// The interval in beats of a touch position 0..1.
pub fn zone(pad: f32) -> f64 {
    ZONEN[((pad.clamp(0.0, 1.0) * ZONEN.len() as f32) as usize).min(ZONEN.len() - 1)]
}

/// One drum voice. `t` counts samples since the hit; `u32::MAX` = silent.
#[derive(Clone, Copy, Debug)]
struct Stimme {
    t: u32,
    phase: [f64; 2],
    filt: Svf,
    rausch: Rauschen,
    verh: f64,
}

impl Stimme {
    fn neu(saat: u32) -> Self {
        Stimme { t: u32::MAX, phase: [0.0; 2], filt: Svf::default(), rausch: Rauschen::neu(saat), verh: 1.0 }
    }

    /// Starts the voice; `filter` is (Hz, Q) of its noise filter at this pitch.
    fn los(&mut self, verh: f64, filter: (f64, f64), sr: f64) {
        self.t = 0;
        self.phase = [0.0; 2];
        self.filt.setze(filter.0, filter.1, sr);
        self.filt.leeren();
        self.verh = verh;
    }

    /// Advances the time; None when the voice is silent. `ende_s` is where the voice is considered over.
    #[inline]
    fn zeit(&mut self, sr: f64, ende_s: f64) -> Option<f64> {
        if self.t == u32::MAX {
            return None;
        }
        let s = self.t as f64 / sr;
        if s > ende_s {
            self.t = u32::MAX;
            return None;
        }
        self.t += 1;
        Some(s)
    }

    #[inline]
    fn sinus(&mut self, i: usize, hz: f64, sr: f64) -> f32 {
        self.phase[i] = (self.phase[i] + hz / sr).rem_euclid(1.0);
        (self.phase[i] * std::f64::consts::TAU).sin() as f32
    }

    #[inline]
    fn dreieck(&mut self, i: usize, hz: f64, sr: f64) -> f32 {
        self.phase[i] = (self.phase[i] + hz / sr).rem_euclid(1.0);
        crate::teile::dreieck(self.phase[i])
    }
}

#[derive(Clone, Debug)]
pub struct Pad {
    sr: f64,
    stimme: [Stimme; 4],
    an_alt: [bool; 4],
    beruehrt_alt: bool,
    riegel: bool,
    gitter: [i64; 4],
    roll: [Aufnahme; 2],
    roll_an: bool,
    roll_pos: usize,
    roll_g: Glatt,
    muster: [u8; SCHRITTE],
    schritt: i64,
    sperre: [i64; 4],
    overdub_alt: bool,
}

/// What the pad section hands to the device for one sample.
#[derive(Clone, Copy, Debug, Default)]
pub struct PadAus {
    /// The roll of the input, and how much of the input it replaces (0 = no roll running).
    pub roll: [f32; 2],
    pub roll_g: f32,
    /// The drum voices (mono, before the pad level).
    pub trommel: f32,
}

/// Settings of the pad section for one sample.
#[derive(Clone, Copy, Debug)]
pub struct PadEin {
    pub roll: bool,
    pub an: [bool; 4],
    pub pad: f32,
    pub beruehrt: bool,
    pub halten: bool,
    pub overdub: bool,
    /// Semitones, -12..12.
    pub pitch: f32,
}

impl Pad {
    pub fn neu(sr: f64) -> Self {
        Pad {
            sr,
            stimme: SAAT.map(Stimme::neu),
            an_alt: [false; 4],
            beruehrt_alt: false,
            riegel: false,
            gitter: [i64::MIN; 4],
            // two beats at 60 BPM, twice for a roll pitched up an octave
            roll: [Aufnahme::neu((4.0 * sr) as usize), Aufnahme::neu((4.0 * sr) as usize)],
            roll_an: false,
            roll_pos: 0,
            roll_g: Glatt::neu(sr, 2.0),
            muster: [0; SCHRITTE],
            schritt: i64::MIN,
            sperre: [i64::MIN; 4],
            overdub_alt: false,
        }
    }

    pub fn leeren(&mut self) {
        self.stimme = SAAT.map(Stimme::neu);
        self.an_alt = [false; 4];
        self.beruehrt_alt = false;
        self.riegel = false;
        self.gitter = [i64::MIN; 4];
        self.roll.iter_mut().for_each(|r| r.leeren());
        self.roll_an = false;
        self.roll_pos = 0;
        self.roll_g.setze(0.0);
        self.muster = [0; SCHRITTE];
        self.schritt = i64::MIN;
        self.sperre = [i64::MIN; 4];
        self.overdub_alt = false;
    }

    /// Starts voice `s` at the pitch ratio `verh`.
    fn los(&mut self, s: usize, verh: f64) {
        let filter = match s {
            SNARE => (4500.0, 0.7),
            CLAP => (2000.0 * verh, 2.2),
            HAT => ((8000.0 * verh).min(16000.0), 1.0),
            _ => (1000.0, 0.7),
        };
        self.stimme[s].los(verh, filter, self.sr);
    }

    /// Whether the section makes or changes sound right now.
    pub fn wirkt(&self) -> bool {
        self.roll_an || self.roll_g.wert > 0.0 || self.stimme.iter().any(|s| s.t != u32::MAX)
    }

    fn schlag(&mut self, s: usize, verh: f64, overdub: bool, beat: f64) {
        self.los(s, verh);
        if overdub {
            // the hit lands on the nearest sixteenth of the pattern; that step must not play it a second time
            let q = (beat * 4.0).round() as i64;
            self.muster[q.rem_euclid(SCHRITTE as i64) as usize] |= 1 << s;
            self.sperre[s] = q;
        }
    }

    /// One sample of the four voices, summed.
    #[inline]
    fn stimmen(&mut self) -> f32 {
        let sr = self.sr;
        let mut y = 0.0f32;
        // kick: a sine that falls from about 220 Hz to 48 Hz in a few ten milliseconds, with a short click
        let v = &mut self.stimme[KICK];
        if let Some(s) = v.zeit(sr, 0.9) {
            let hz = (48.0 + 170.0 * (-s / 0.028).exp()) * v.verh;
            let ton = v.sinus(0, hz, sr) * (-s / 0.16).exp() as f32;
            let klick = v.rausch.tick() * 0.15 * (-s / 0.001).exp() as f32;
            y += ((ton + klick) * 1.4).tanh() * 0.9;
        }
        // snare: two triangles a fifth and more apart with a short pitch drop, and noise for the snares
        let v = &mut self.stimme[SNARE];
        if let Some(s) = v.zeit(sr, 0.7) {
            let fall = 1.0 + 0.5 * (-s / 0.01).exp();
            let ton = (v.dreieck(0, 180.0 * fall * v.verh, sr) + 0.6 * v.dreieck(1, 330.0 * fall * v.verh, sr)) * (-s / 0.06).exp() as f32;
            let n = v.rausch.tick();
            let teppich = v.filt.tick(n).1 * (-s / 0.12).exp() as f32;
            y += ton * 0.45 + teppich * 0.5;
        }
        // clap: three noise bursts 10 ms apart, then a tail, through a band-pass around 2 kHz
        let v = &mut self.stimme[CLAP];
        if let Some(s) = v.zeit(sr, 0.6) {
            let h = if s < 0.03 { (-(s % 0.01) / 0.003).exp() } else { (-(s - 0.03) / 0.075).exp() };
            let n = v.rausch.tick();
            y += v.filt.tick(n).1 * v.filt.k() * h as f32 * 1.1;
        }
        // hi-hat: high-passed noise, short
        let v = &mut self.stimme[HAT];
        if let Some(s) = v.zeit(sr, 0.25) {
            let n = v.rausch.tick();
            y += v.filt.tick(n).2 * (-s / 0.028).exp() as f32 * 0.45;
        }
        y
    }

    /// One sample. `l`, `r` is the input the roll records.
    #[inline]
    pub fn tick(&mut self, l: f32, r: f32, e: &PadEin, beat: f64, spb: f64) -> PadAus {
        let verh = 2f64.powf(e.pitch.clamp(-12.0, 12.0) as f64 / 12.0);
        // hold keeps the last touch until hold is switched off
        if e.beruehrt {
            self.riegel = true;
        }
        if !e.halten {
            self.riegel = false;
        }
        let aktiv = e.beruehrt || (e.halten && self.riegel);
        let frisch = aktiv && !self.beruehrt_alt;
        self.beruehrt_alt = aktiv;
        let intervall = zone(e.pad);

        if !e.overdub && self.overdub_alt {
            self.muster = [0; SCHRITTE];
        }
        self.overdub_alt = e.overdub;

        for s in 0..4 {
            // a voice switched on sounds at once
            if e.an[s] && !self.an_alt[s] {
                self.schlag(s, verh, e.overdub, beat);
            }
            self.an_alt[s] = e.an[s];
            // a touch repeats the selected voices on the grid of the touched interval
            if aktiv && e.an[s] {
                let g = (beat / intervall).floor() as i64;
                if frisch {
                    // a touch just after a grid point still plays that point, a later one waits for the next
                    let spaet = (beat / intervall).rem_euclid(1.0) < 0.25;
                    self.gitter[s] = if spaet { g - 1 } else { g };
                }
                if g != self.gitter[s] {
                    self.gitter[s] = g;
                    self.schlag(s, verh, e.overdub, beat);
                }
            }
        }
        // the recorded pattern
        if e.overdub {
            let a = (beat * 4.0).floor() as i64;
            if a != self.schritt {
                self.schritt = a;
                let bits = self.muster[a.rem_euclid(SCHRITTE as i64) as usize];
                for s in 0..4 {
                    if bits & (1 << s) != 0 && self.sperre[s] != a {
                        self.los(s, verh);
                    }
                }
            }
        }

        // roll of the input
        let roll = e.roll && aktiv;
        if roll && !self.roll_an {
            self.roll.iter_mut().for_each(|a| a.starte());
            self.roll_pos = 0;
        }
        self.roll_an = roll;
        let g = self.roll_g.zu(if roll { 1.0 } else { 0.0 });
        let mut aus = PadAus { roll: [l, r], roll_g: g, trommel: self.stimmen() };
        if roll {
            self.roll[0].nimm(l);
            self.roll[1].nimm(r);
            let kante = KANTE * self.sr / 48000.0;
            let voll = (intervall * spb).clamp(2.0 * kante + 2.0, 2.0 * self.sr);
            let pos = self.roll_pos as f64;
            self.roll_pos += 1;
            let i = pos.rem_euclid(voll);
            let fenster = (i / kante).min((voll - i) / kante).min(1.0) as f32;
            let live = pos < voll || i * verh >= self.roll[0].n as f64;
            if live {
                aus.roll = [l * fenster, r * fenster];
            } else {
                aus.roll = [self.roll[0].lies(i * verh) * fenster, self.roll[1].lies(i * verh) * fenster];
            }
        }
        aus
    }
}
