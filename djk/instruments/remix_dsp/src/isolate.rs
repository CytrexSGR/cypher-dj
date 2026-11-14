//! Isolate FX: the signal is split into low, mid and high, and each band has one control with a neutral centre. To the
//! left a control takes something away, to the right it adds something. Four effects share the three controls.
//!
//! The split is a fourth-order Linkwitz-Riley crossover; the three bands sum to an all-pass of the input, so a section
//! that is on with centred controls changes the phase only. Crossover points and every curve are a DECISION of the model.

use crate::teile::{db, log_weg, Aufnahme, Glatt, Ring, Svf, Weiche};

pub const AUS: u8 = 0;
pub const CUT_ADD: u8 = 1;
pub const TRANS_ROLL: u8 = 2;
pub const ISOLATOR: u8 = 3;
pub const GATE_DRIVE: u8 = 4;
pub const TYPEN: u8 = 4;

/// DECISION: crossover points of the three bands.
pub const TRENN_TIEF_HZ: f64 = 300.0;
pub const TRENN_HOCH_HZ: f64 = 4000.0;
/// DECISION: boost of the isolator at the right end.
pub const ISOLATOR_MAX_DB: f64 = 6.0;
/// Around the centre a control of TRANS/ROLL does nothing.
pub const TOTZONE: f32 = 0.05;
/// Levels of the four delay taps of ADD (an eighth of a beat apart).
const TAPS: [f32; 4] = [0.8, 0.6, 0.42, 0.3];
/// Fade at both ends of a roll cycle, in samples at 48 kHz.
const KANTE: f64 = 64.0;
const TAKT: usize = 16;

/// The cycle of TRANS in beats for a control position left of the centre (-1..0).
pub fn trans_zyklus(k: f32) -> f64 {
    match -k {
        a if a < 0.37 => 1.0,
        a if a < 0.68 => 0.5,
        _ => 0.25,
    }
}

/// The cycle of ROLL in beats for a control position right of the centre (0..1).
pub fn roll_zyklus(k: f32) -> f64 {
    match k {
        a if a < 0.29 => 1.0,
        a if a < 0.53 => 0.5,
        a if a < 0.77 => 0.25,
        _ => 0.125,
    }
}

#[derive(Clone, Debug)]
pub struct Isolate {
    sr: f64,
    typ: u8,
    blende: Glatt,
    w1: [Weiche; 2],
    w2: [Weiche; 2],
    komp: [Weiche; 2],
    k: [Glatt; 3],
    // CUT: bass drum detector and the manual filters
    schnell: f32,
    langsam: f32,
    kick_halt: usize,
    kick: Glatt,
    cut_hp: [Svf; 2],
    cut_lp: [Svf; 2],
    // ADD: delay memory per band and channel
    add: Vec<Ring>,
    // TRANS: gate per band; ROLL: recording per band and channel
    tor: [Glatt; 3],
    roll: Vec<Aufnahme>,
    roll_an: [bool; 3],
    roll_pos: [usize; 3],
    // GATE
    huelle: [f32; 3],
    offen: [bool; 3],
    takt: usize,
    verst: [f32; 3],
}

impl Isolate {
    pub fn neu(sr: f64) -> Self {
        let mut s = Isolate {
            sr,
            typ: AUS,
            blende: Glatt::neu(sr, 3.0),
            w1: [Weiche::default(); 2],
            w2: [Weiche::default(); 2],
            komp: [Weiche::default(); 2],
            k: [Glatt::neu(sr, 8.0); 3],
            schnell: 0.0,
            langsam: 0.0,
            kick_halt: 0,
            kick: Glatt::neu(sr, 2.0),
            cut_hp: [Svf::default(); 2],
            cut_lp: [Svf::default(); 2],
            // four taps of an eighth of a beat at 60 BPM are half a second
            add: (0..6).map(|_| Ring::neu((0.6 * sr) as usize)).collect(),
            tor: [Glatt::neu(sr, 1.5); 3],
            // one beat at 60 BPM
            roll: (0..6).map(|_| Aufnahme::neu(sr as usize)).collect(),
            roll_an: [false; 3],
            roll_pos: [0; 3],
            huelle: [0.0; 3],
            offen: [true; 3],
            takt: 0,
            verst: [1.0; 3],
        };
        for c in 0..2 {
            s.w1[c].setze(TRENN_TIEF_HZ, sr);
            s.w2[c].setze(TRENN_HOCH_HZ, sr);
            s.komp[c].setze(TRENN_HOCH_HZ, sr);
        }
        s.tor.iter_mut().for_each(|t| t.setze(1.0));
        s
    }

    pub fn leeren(&mut self) {
        self.typ = AUS;
        self.blende.setze(0.0);
        self.vergiss();
    }

    fn vergiss(&mut self) {
        for c in 0..2 {
            self.w1[c].leeren();
            self.w2[c].leeren();
            self.komp[c].leeren();
            self.cut_hp[c].leeren();
            self.cut_lp[c].leeren();
        }
        self.k.iter_mut().for_each(|k| k.setze(0.0));
        self.schnell = 0.0;
        self.langsam = 0.0;
        self.kick_halt = 0;
        self.kick.setze(0.0);
        self.add.iter_mut().for_each(|r| r.vergiss());
        self.tor.iter_mut().for_each(|t| t.setze(1.0));
        self.roll.iter_mut().for_each(|r| r.leeren());
        self.roll_an = [false; 3];
        self.roll_pos = [0; 3];
        self.huelle = [0.0; 3];
        self.offen = [true; 3];
        self.takt = 0;
    }

    pub fn wirkt(&self) -> bool {
        self.typ != AUS && self.blende.wert > 0.0
    }

    /// One sample; `regler` are LOW, MID and HI in -1..1 with 0 as the neutral centre.
    #[inline]
    pub fn tick(&mut self, l: f32, r: f32, typ: u8, regler: [f32; 3], beat: f64, spb: f64) -> (f32, f32) {
        let typ = if typ > TYPEN { AUS } else { typ };
        if typ != self.typ {
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
        let k: [f32; 3] = std::array::from_fn(|b| self.k[b].zu(regler[b].clamp(-1.0, 1.0)));
        let x = [l, r];
        // band[b][c]
        let mut band = [[0.0f32; 2]; 3];
        for c in 0..2 {
            let (tief, rest) = self.w1[c].tick(x[c]);
            let (mitte, hoch) = self.w2[c].tick(rest);
            let (a, b) = self.komp[c].tick(tief);
            band[0][c] = a + b;
            band[1][c] = mitte;
            band[2][c] = hoch;
        }
        let neu = self.takt == 0;
        self.takt = (self.takt + 1) % TAKT;
        let mut y = [0.0f32; 2];
        match self.typ {
            ISOLATOR => {
                if neu {
                    for b in 0..3 {
                        self.verst[b] = if k[b] < 0.0 { (1.0 + k[b]) * (1.0 + k[b]) } else { db(ISOLATOR_MAX_DB * k[b] as f64) };
                    }
                }
                for c in 0..2 {
                    y[c] = band[0][c] * self.verst[0] + band[1][c] * self.verst[1] + band[2][c] * self.verst[2];
                }
            }
            CUT_ADD => {
                // bass drum: the fast envelope of the low band jumps ahead of the slow one
                let p = (band[0][0] + band[0][1]).abs() * 0.5;
                self.schnell = if p > self.schnell { p } else { self.schnell + (p - self.schnell) * (1.0 / (0.03 * self.sr as f32)) };
                self.langsam += (p - self.langsam) * (1.0 / (0.15 * self.sr as f32));
                if self.schnell > 1.8 * self.langsam + 0.003 {
                    self.kick_halt = (0.12 * self.sr) as usize;
                }
                let kg = self.kick.zu(if self.kick_halt > 0 { 1.0 } else { 0.0 });
                self.kick_halt = self.kick_halt.saturating_sub(1);
                let (ab, hp_t, lp_t) = ((-k[0]).max(0.0), (-k[1]).max(0.0), (-k[2]).max(0.0));
                if neu {
                    let (fh, fl) = (log_weg(20.0, 4000.0, hp_t as f64), log_weg(20000.0, 250.0, lp_t as f64));
                    for c in 0..2 {
                        self.cut_hp[c].setze(fh, 1.2, self.sr);
                        self.cut_lp[c].setze(fl, 1.2, self.sr);
                    }
                }
                let eighth = spb / 8.0;
                for c in 0..2 {
                    let trommel = band[0][c] * kg;
                    let rest = band[0][c] - trommel + band[1][c] + band[2][c];
                    // the manual filters work on everything but the bass drum
                    let h = self.cut_hp[c].tick(rest).2;
                    let a = rest + (h - rest) * (hp_t * 20.0).min(1.0);
                    let t = self.cut_lp[c].tick(a).0;
                    let gefiltert = a + (t - a) * (lp_t * 20.0).min(1.0);
                    let mut dazu = 0.0f32;
                    for b in 0..3 {
                        let ring = &mut self.add[b * 2 + c];
                        ring.schreibe(band[b][c]);
                        if k[b] > 0.0 {
                            for (j, g) in TAPS.iter().enumerate() {
                                dazu += ring.lies_bruch(eighth * (j + 1) as f64) * g * k[b];
                            }
                        }
                    }
                    y[c] = trommel * (1.0 - ab) * (1.0 - ab) + gefiltert + dazu;
                }
            }
            TRANS_ROLL => {
                let kante = KANTE * self.sr / 48000.0;
                for b in 0..3 {
                    let trans = k[b] < -TOTZONE;
                    let roll = k[b] > TOTZONE;
                    let offen = !trans || (beat / trans_zyklus(k[b])).rem_euclid(1.0) < 0.5;
                    let g = self.tor[b].zu(if offen { 1.0 } else { 0.0 });
                    if roll && !self.roll_an[b] {
                        self.roll[b * 2].starte();
                        self.roll[b * 2 + 1].starte();
                        self.roll_pos[b] = 0;
                    }
                    self.roll_an[b] = roll;
                    if roll {
                        let kap = self.roll[b * 2].n.max(1);
                        let voll = (roll_zyklus(k[b]) * spb).max(2.0 * kante + 2.0);
                        let pos = self.roll_pos[b];
                        self.roll_pos[b] += 1;
                        for c in 0..2 {
                            self.roll[b * 2 + c].nimm(band[b][c]);
                        }
                        let i = (pos as f64).rem_euclid(voll);
                        let fenster = (i / kante).min((voll - i) / kante).min(1.0) as f32;
                        for c in 0..2 {
                            // the first cycle is the live band, from then on the recording repeats
                            let s = if (pos as f64) < voll || i >= kap as f64 { band[b][c] } else { self.roll[b * 2 + c].lies(i) };
                            y[c] += s * fenster;
                        }
                    } else {
                        for c in 0..2 {
                            y[c] += band[b][c] * g;
                        }
                    }
                }
            }
            GATE_DRIVE => {
                for b in 0..3 {
                    let p = band[b][0].abs().max(band[b][1].abs());
                    self.huelle[b] = if p > self.huelle[b] { p } else { self.huelle[b] + (p - self.huelle[b]) * (1.0 / (0.05 * self.sr as f32)) };
                    if k[b] < 0.0 {
                        // the threshold rises from -60 dBFS to -6 dBFS; 3 dB of hysteresis
                        let schwelle = db(-60.0 + 54.0 * (-k[b]) as f64);
                        if self.huelle[b] > schwelle {
                            self.offen[b] = true;
                        } else if self.huelle[b] < schwelle * 0.7 {
                            self.offen[b] = false;
                        }
                    } else {
                        self.offen[b] = true;
                    }
                    let g = self.tor[b].zu(if self.offen[b] { 1.0 } else { 0.0 });
                    if k[b] > 0.0 {
                        // up to 30 dB into a tanh, level roughly held; the first tenth of the travel fades the stage in
                        let v = db(30.0 * k[b] as f64);
                        let aus = 1.0 / v.sqrt();
                        let misch = (k[b] * 10.0).min(1.0);
                        for c in 0..2 {
                            let s = band[b][c];
                            y[c] += s + ((s * v).tanh() * aus - s) * misch;
                        }
                    } else {
                        for c in 0..2 {
                            y[c] += band[b][c] * g;
                        }
                    }
                }
            }
            _ => y = x,
        }
        let b = self.blende.wert;
        (l + (y[0] - l) * b, r + (y[1] - r) * b)
    }
}
