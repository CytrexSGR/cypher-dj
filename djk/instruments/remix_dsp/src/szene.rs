//! Scene FX: one main control and two sub parameters drive one of ten effects. The first five build up, the other five
//! break down. Every curve in here is a DECISION of the model: the published documents name the controls and the
//! selectable steps, never a curve, a filter order or a feedback factor.

use crate::teile::{db, dreieck, grenze, log_weg, Glatt, Rauschen, Ring, Svf};

pub const AUS: u8 = 0;
pub const BPF_ECHO: u8 = 1;
pub const ECHO: u8 = 2;
pub const NOISE: u8 = 3;
pub const SPIRAL_UP: u8 = 4;
pub const REVERB_UP: u8 = 5;
pub const HPF_ECHO: u8 = 6;
pub const CRUSH_ECHO: u8 = 7;
pub const LPF_ECHO: u8 = 8;
pub const SPIRAL_DOWN: u8 = 9;
pub const REVERB_DOWN: u8 = 10;
pub const TYPEN: u8 = 10;

/// Echo times in beats, selected by sub parameter 1 over its travel (the middle of the knob is a half beat).
pub const RASTER: [f64; 7] = [1.0 / 16.0, 1.0 / 8.0, 1.0 / 4.0, 1.0 / 2.0, 3.0 / 4.0, 1.0, 2.0];
/// Longest echo memory in seconds (two beats at 60 BPM, with room for the glide).
const ECHO_S: f64 = 2.6;
/// Window of the pitch shifter in the spiral feedback, in seconds.
const FENSTER_S: f64 = 2048.0 / 48000.0;
/// Seeds of the two noise generators (set again by `leeren`, so a cleared device repeats bit for bit).
const SAAT: [u32; 2] = [0x1234_5671, 0x0BAD_C0DF];
/// Coefficients are recomputed every so many samples.
const TAKT: usize = 16;

/// The echo time in beats for a sub parameter 1 position.
pub fn raster(sub1: f32) -> f64 {
    RASTER[((sub1.clamp(0.0, 1.0) * RASTER.len() as f32) as usize).min(RASTER.len() - 1)]
}

#[derive(Clone, Debug)]
struct Allpass {
    ring: Ring,
    n: usize,
}

impl Allpass {
    fn neu(n: usize) -> Self {
        Allpass { ring: Ring::neu(n + 1), n }
    }
    #[inline]
    fn tick(&mut self, x: f32, g: f32) -> f32 {
        let d = self.ring.lies(self.n);
        let y = d - g * x;
        self.ring.schreibe(x + g * y);
        y
    }
    fn vergiss(&mut self) {
        self.ring.vergiss();
    }
}

/// Small feedback delay network for the two reverb scenes: eight lines, Householder mixing, damping in the loop.
#[derive(Clone, Debug)]
struct Hall {
    linie: Vec<Ring>,
    n: [usize; 8],
    lp: [f32; 8],
    g: [f32; 8],
    vor: [[Allpass; 2]; 2],
}

/// Line lengths at 44.1 kHz (mutually prime enough, 25 to 37 ms), scaled to the rate and the room.
const HALL_N: [usize; 8] = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116];
const RAUM: f64 = 1.5;

impl Hall {
    fn neu(sr: f64) -> Self {
        let n: [usize; 8] = std::array::from_fn(|i| ((HALL_N[i] as f64) * RAUM * sr / 44100.0) as usize | 1);
        let ap = |m: f64| Allpass::neu((m * sr / 44100.0) as usize);
        Hall {
            linie: n.iter().map(|&k| Ring::neu(k + 1)).collect(),
            n,
            lp: [0.0; 8],
            g: [0.0; 8],
            vor: [[ap(225.0), ap(556.0)], [ap(341.0), ap(441.0)]],
        }
    }

    fn setze_t60(&mut self, s: f64, sr: f64) {
        for i in 0..8 {
            self.g[i] = 10f64.powf(-3.0 * self.n[i] as f64 / (s * sr)) as f32;
        }
    }

    #[inline]
    fn tick(&mut self, l: f32, r: f32) -> (f32, f32) {
        let il = {
            let a = self.vor[0][0].tick(l, 0.5);
            self.vor[0][1].tick(a, 0.5)
        };
        let ir = {
            let a = self.vor[1][0].tick(r, 0.5);
            self.vor[1][1].tick(a, 0.5)
        };
        let mut o = [0.0f32; 8];
        let mut summe = 0.0f32;
        for i in 0..8 {
            o[i] = self.linie[i].lies(self.n[i]);
            summe += o[i];
        }
        summe *= 0.25;
        for i in 0..8 {
            // damping: the highs of every pass through the loop fall off (one pole near 6 kHz)
            self.lp[i] += (o[i] - summe - self.lp[i]) * 0.55;
            let ein = if i % 2 == 0 { il } else { ir };
            self.linie[i].schreibe(ein * 0.5 + self.lp[i] * self.g[i]);
        }
        ((o[0] + o[2] + o[4] + o[6]) * 0.5, (o[1] + o[3] + o[5] + o[7]) * 0.5)
    }

    fn vergiss(&mut self) {
        self.linie.iter_mut().for_each(|l| l.vergiss());
        self.vor.iter_mut().flatten().for_each(|a| a.vergiss());
        self.lp = [0.0; 8];
    }
}

#[derive(Clone, Debug)]
pub struct Szene {
    sr: f64,
    typ: u8,
    blende: Glatt,
    staerke: Glatt,
    s2: Glatt,
    echo: [Ring; 2],
    /// Current echo time in samples (glides, so a time change bends the pitch of what is in the memory).
    d: f64,
    d_ziel: f64,
    d_gleit: f64,
    filt: [Svf; 2],
    rueck_hp: [Svf; 2],
    rueck_lp: [Svf; 2],
    rausch: [Rauschen; 2],
    halt: [f32; 2],
    halt_z: f32,
    schieb: f64,
    diff: [[Allpass; 2]; 2],
    hall: Hall,
    hall_filt: [Svf; 2],
    takt: usize,
    // values of the control rate
    fb: f32,
    nass: f32,
    trocken: f32,
    ein: f32,
    misch: f32,
    lfo: f32,
    halt_n: f32,
    stufe: f32,
    verh: f64,
}

impl Szene {
    pub fn neu(sr: f64) -> Self {
        let ap = |n: f64| Allpass::neu((n * sr / 48000.0) as usize);
        Szene {
            sr,
            typ: AUS,
            blende: Glatt::neu(sr, 3.0),
            staerke: Glatt::neu(sr, 15.0),
            s2: Glatt::neu(sr, 15.0),
            echo: [Ring::neu((ECHO_S * sr) as usize), Ring::neu((ECHO_S * sr) as usize)],
            d: 0.0,
            d_ziel: 0.0,
            d_gleit: 1.0 - (-1.0 / (0.04 * sr)).exp(),
            filt: [Svf::default(); 2],
            rueck_hp: [Svf::default(); 2],
            rueck_lp: [Svf::default(); 2],
            rausch: SAAT.map(Rauschen::neu),
            halt: [0.0; 2],
            halt_z: 0.0,
            schieb: 0.0,
            diff: [[ap(337.0), ap(113.0)], [ap(331.0), ap(127.0)]],
            hall: Hall::neu(sr),
            hall_filt: [Svf::default(); 2],
            takt: 0,
            fb: 0.0,
            nass: 0.0,
            trocken: 1.0,
            ein: 0.0,
            misch: 0.0,
            lfo: 0.0,
            halt_n: 1.0,
            stufe: 0.0,
            verh: 1.0,
        }
    }

    pub fn leeren(&mut self) {
        self.typ = AUS;
        self.blende.setze(0.0);
        self.staerke.setze(0.0);
        self.s2.setze(0.0);
        self.rausch = SAAT.map(Rauschen::neu);
        self.vergiss();
    }

    fn vergiss(&mut self) {
        self.echo.iter_mut().for_each(|e| e.vergiss());
        for k in 0..2 {
            self.filt[k].leeren();
            self.rueck_hp[k].leeren();
            self.rueck_lp[k].leeren();
            self.hall_filt[k].leeren();
            self.diff[k].iter_mut().for_each(|a| a.vergiss());
        }
        self.hall.vergiss();
        self.halt = [0.0; 2];
        self.halt_z = 0.0;
        self.schieb = 0.0;
        self.d = 0.0;
        self.takt = 0;
    }

    /// Whether the section changes the signal right now.
    pub fn wirkt(&self) -> bool {
        self.typ != AUS && self.blende.wert > 0.0
    }

    /// The values that change slowly: every `TAKT` samples.
    fn stelle(&mut self, m: f64, sub1: f32, s2: f64, beat: f64, spb: f64) {
        let sr = self.sr;
        let typ = self.typ;
        let max = (self.echo[0].laenge() - 8) as f64;
        self.d_ziel = (raster(sub1) * spb).clamp(64.0, max);
        // one triangle per beat for the modulation of sub parameter 2
        self.lfo = dreieck(beat) * s2 as f32;
        let oktave = |tiefe: f64| 2f64.powf(self.lfo as f64 * tiefe);
        // most effects fade in over the first part of the travel and are fully there after it
        let auf = |anteil: f64| (m / anteil).min(1.0) as f32;
        self.trocken = 1.0;
        match typ {
            BPF_ECHO => {
                let f = log_weg(200.0, 8000.0, m) * oktave(1.0);
                self.filt.iter_mut().for_each(|s| s.setze(f, 2.0, sr));
                self.misch = auf(0.12) * 0.7;
                self.ein = auf(0.12);
                self.fb = (0.35 + 0.4 * m) as f32;
                self.nass = auf(0.12) * (0.6 + 0.4 * m) as f32;
            }
            ECHO => {
                self.ein = auf(0.25);
                self.fb = (0.45 + 0.4 * m) as f32;
                self.nass = auf(0.5);
                self.trocken = (1.0 - (m - 0.5).max(0.0)) as f32;
                let (hp, lp) = (log_weg(20.0, 1500.0, s2), log_weg(18000.0, 5000.0, s2));
                self.rueck_hp.iter_mut().for_each(|s| s.setze(hp, 0.7071, sr));
                self.rueck_lp.iter_mut().for_each(|s| s.setze(lp, 0.7071, sr));
            }
            NOISE => {
                let f = log_weg(300.0, 12000.0, m);
                self.filt.iter_mut().for_each(|s| s.setze(f, 3.0, sr));
                // sub parameter 1 is the noise level, -18 dB to +6 dB; in the middle the noise reaches about -12 dBFS rms at the top of the sweep
                let pegel = db(-18.0 + 24.0 * sub1.clamp(0.0, 1.0) as f64) * 1.6;
                let tremolo = 1.0 - s2 as f32 * (0.5 + 0.5 * dreieck(beat * 2.0));
                self.nass = auf(0.15) * pegel * tremolo;
            }
            SPIRAL_UP | SPIRAL_DOWN => {
                // the main control shortens the spiral, sub parameter 2 is the pitch step of every repeat
                self.d_ziel = (self.d_ziel * (1.0 - 0.5 * m)).clamp(FENSTER_S * sr * 0.5 + 4.0, max);
                let st = 12.0 * s2 * s2 * if typ == SPIRAL_UP { 1.0 } else { -1.0 };
                self.verh = 2f64.powf(st / 12.0);
                self.ein = auf(0.25);
                self.fb = (0.55 + 0.35 * m) as f32;
                self.nass = auf(0.4);
                self.trocken = (1.0 - (m - 0.5).max(0.0)) as f32;
            }
            REVERB_UP | REVERB_DOWN => {
                self.hall.setze_t60(log_weg(0.8, 6.0, sub1.clamp(0.0, 1.0) as f64), sr);
                self.ein = auf(0.25);
                self.nass = auf(0.5) * 1.6;
                self.trocken = (1.0 - 0.6 * (2.0 * m - 1.0).max(0.0)) as f32;
                let f = if typ == REVERB_UP { log_weg(20.0, 2000.0, s2) } else { log_weg(18000.0, 400.0, s2) };
                self.hall_filt.iter_mut().for_each(|s| s.setze(f, 0.7071, sr));
            }
            HPF_ECHO | LPF_ECHO => {
                let f = if typ == HPF_ECHO { log_weg(20.0, 8000.0, m) } else { log_weg(20000.0, 150.0, m) } * oktave(1.0);
                // the low-pass keeps the bass drum, so it gets no resonance peak on top
                let q = if typ == HPF_ECHO { 1.4 } else { 1.0 };
                self.filt.iter_mut().for_each(|s| s.setze(f, q, sr));
                self.misch = auf(0.06);
                self.ein = auf(0.25);
                self.fb = (0.3 + 0.3 * m) as f32;
                self.nass = auf(0.25) * 0.4;
            }
            CRUSH_ECHO => {
                // sample-and-hold down to about 1 kHz and word length down to about 5 bits
                self.halt_n = (1.0 + m * m * 47.0 * oktave(0.6)) as f32;
                self.stufe = 2f64.powf(-(15.0 - 10.5 * m)) as f32;
                self.misch = auf(0.06);
                self.ein = auf(0.25);
                self.fb = (0.3 + 0.3 * m) as f32;
                self.nass = auf(0.25) * 0.35;
            }
            _ => {}
        }
    }

    /// One echo pass of both channels: reads at the gliding time, writes input plus the bounded feedback.
    #[inline]
    fn echo_tick(&mut self, ein: [f32; 2], filter: bool) -> [f32; 2] {
        if self.d == 0.0 {
            self.d = self.d_ziel;
        }
        self.d += (self.d_ziel - self.d) * self.d_gleit;
        let mut aus = [0.0f32; 2];
        for k in 0..2 {
            let y = self.echo[k].lies_bruch(self.d);
            let mut rueck = y * self.fb;
            if filter {
                rueck = self.rueck_lp[k].tick(self.rueck_hp[k].tick(rueck).2).0;
            }
            self.echo[k].schreibe(ein[k] + grenze(rueck));
            aus[k] = y;
        }
        aus
    }

    /// Echo whose feedback is shifted in pitch and smeared: every repeat sits a step higher or lower.
    #[inline]
    fn spirale_tick(&mut self, ein: [f32; 2]) -> [f32; 2] {
        if self.d == 0.0 {
            self.d = self.d_ziel;
        }
        self.d += (self.d_ziel - self.d) * self.d_gleit;
        let w = FENSTER_S * self.sr;
        self.schieb = (self.schieb + (1.0 - self.verh) / w).rem_euclid(1.0);
        let (p1, p2) = (self.schieb, (self.schieb + 0.5).rem_euclid(1.0));
        let (g1, g2) = ((std::f64::consts::PI * p1).sin().powi(2) as f32, (std::f64::consts::PI * p2).sin().powi(2) as f32);
        let mut aus = [0.0f32; 2];
        for k in 0..2 {
            let y = self.echo[k].lies_bruch(self.d);
            let versetzt = self.echo[k].lies_bruch(self.d + (p1 - 0.5) * w) * g1 + self.echo[k].lies_bruch(self.d + (p2 - 0.5) * w) * g2;
            let a = self.diff[k][0].tick(versetzt * self.fb, 0.5);
            let b = self.diff[k][1].tick(a, 0.5);
            self.echo[k].schreibe(ein[k] + grenze(b));
            aus[k] = y;
        }
        aus
    }

    /// One sample. `typ` is the selected effect, `m` the main control, `sub1` and `sub2` the sub parameters (all 0..1),
    /// `beat` the beat of this sample and `spb` the samples per beat.
    #[inline]
    pub fn tick(&mut self, l: f32, r: f32, typ: u8, m: f32, sub1: f32, sub2: f32, beat: f64, spb: f64) -> (f32, f32) {
        let typ = if typ > TYPEN { AUS } else { typ };
        if typ != self.typ {
            // fade the old effect out, then start the new one from an empty state
            if self.blende.zu(0.0) == 0.0 {
                self.typ = typ;
                self.vergiss();
            }
        } else if self.typ != AUS {
            self.blende.zu(1.0);
        }
        if self.typ == AUS {
            return (l, r);
        }
        let m = self.staerke.zu(m.clamp(0.0, 1.0));
        let s2 = self.s2.zu(sub2.clamp(0.0, 1.0));
        if m == 0.0 {
            // fully counterclockwise is the original sound; what was in the memories is gone when it comes back
            if self.d != 0.0 {
                self.vergiss();
            }
            return (l, r);
        }
        if self.takt == 0 {
            self.stelle(m as f64, sub1, s2 as f64, beat, spb);
        }
        self.takt = (self.takt + 1) % TAKT;

        let x = [l, r];
        let mut y = [0.0f32; 2];
        match self.typ {
            BPF_ECHO => {
                let bp: [f32; 2] = std::array::from_fn(|k| {
                    let f = &mut self.filt[k];
                    f.tick(x[k]).1 * f.k()
                });
                let e = self.echo_tick([bp[0] * self.ein, bp[1] * self.ein], false);
                for k in 0..2 {
                    y[k] = x[k] + bp[k] * self.misch + e[k] * self.nass;
                }
            }
            ECHO => {
                let e = self.echo_tick([x[0] * self.ein, x[1] * self.ein], true);
                for k in 0..2 {
                    y[k] = x[k] * self.trocken + e[k] * self.nass;
                }
            }
            NOISE => {
                for k in 0..2 {
                    let n = self.rausch[k].tick();
                    let f = &mut self.filt[k];
                    y[k] = x[k] + f.tick(n).1 * f.k() * self.nass;
                }
            }
            SPIRAL_UP | SPIRAL_DOWN => {
                let e = self.spirale_tick([x[0] * self.ein, x[1] * self.ein]);
                for k in 0..2 {
                    y[k] = x[k] * self.trocken + e[k] * self.nass;
                }
            }
            REVERB_UP | REVERB_DOWN => {
                let (a, b) = self.hall.tick(x[0] * self.ein, x[1] * self.ein);
                let hoch = self.typ == REVERB_UP;
                let w = [a, b];
                for k in 0..2 {
                    let (lp, _, hp) = self.hall_filt[k].tick(w[k]);
                    y[k] = x[k] * self.trocken + if hoch { hp } else { lp } * self.nass;
                }
            }
            HPF_ECHO | LPF_ECHO => {
                let hoch = self.typ == HPF_ECHO;
                let f: [f32; 2] = std::array::from_fn(|k| {
                    let (lp, _, hp) = self.filt[k].tick(x[k]);
                    if hoch { hp } else { lp }
                });
                let e = self.echo_tick([f[0] * self.ein, f[1] * self.ein], false);
                for k in 0..2 {
                    y[k] = x[k] + (f[k] - x[k]) * self.misch + e[k] * self.nass;
                }
            }
            CRUSH_ECHO => {
                self.halt_z += 1.0;
                if self.halt_z >= self.halt_n {
                    self.halt_z -= self.halt_n;
                    self.halt = [(x[0] / self.stufe).round() * self.stufe, (x[1] / self.stufe).round() * self.stufe];
                }
                let c = self.halt;
                let e = self.echo_tick([c[0] * self.ein, c[1] * self.ein], false);
                for k in 0..2 {
                    y[k] = x[k] + (c[k] - x[k]) * self.misch + e[k] * self.nass;
                }
            }
            _ => y = x,
        }
        let b = self.blende.wert;
        (l + (y[0] - l) * b, r + (y[1] - r) * b)
    }
}
