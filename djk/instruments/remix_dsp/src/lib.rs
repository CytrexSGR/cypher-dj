//! Cypher Remix: a beat-synchronous remix station for a DJ signal.
//!
//! Four sections in a row: the pad section (a roll of the input and four drum voices) feeds, together with the input,
//! the isolate section (three bands), the scene section (ten build-up and break-down effects) and the release section
//! (a lever that ends everything with a brake, an echo or a back spin). Two source switches decide whether the input
//! and the pad sounds run through the three effect sections or around them.
//!
//! The device is modelled from public documents about a class of hardware (operating instructions with the signal
//! flow, the effect types and the selectable parameter steps). Those documents name no curve, no filter order, no
//! feedback factor and no timing; every such value in this crate is a decision of the model and is marked DECISION
//! or described in `docs/presets/devices/GERAET-remix.md`. No code, sample or preset of any device is used.
//!
//! With every section off and the input switch on, the output is the input bit for bit. No latency. No allocation
//! after construction.

pub mod isolate;
pub mod pad;
pub mod release;
pub mod szene;
pub mod teile;

use isolate::Isolate;
use pad::{Pad, PadEin};
use release::Release;
use szene::Szene;
use teile::{db, Glatt};

/// Everything that can be set. Switches are booleans, selectors small integers, the rest continuous.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Einstellung {
    /// Scene effect, 0 = off, 1..10 as in `szene` (1..5 build up, 6..10 break down).
    pub szene_typ: u8,
    /// Main control of the scene effect, 0..1 (0 = original sound).
    pub szene: f32,
    /// Sub parameter 1 (echo time over the beat grid, noise level, reverb time), 0..1.
    pub sub1: f32,
    /// Sub parameter 2 (modulation depth, filter, pitch step), 0..1.
    pub sub2: f32,
    /// Isolate effect, 0 = off, 1..4 as in `isolate` (cut/add, trans/roll, isolator, gate/drive).
    pub iso_typ: u8,
    /// LOW, MID, HI: -1..1 with 0 as the neutral centre.
    pub low: f32,
    pub mid: f32,
    pub hi: f32,
    /// Pad section: the roll and the four voices that a touch plays.
    pub roll: bool,
    pub kick: bool,
    pub snare: bool,
    pub clap: bool,
    pub hat: bool,
    /// Touch position 0..1 (left = an eighth of a beat, right = two beats).
    pub pad: f32,
    pub beruehrt: bool,
    /// Keeps the last touch until switched off.
    pub halten: bool,
    /// Records the hits into a pattern of four beats while on; off deletes the pattern.
    pub overdub: bool,
    /// Pitch of the voices and of the roll in semitones, -12..12.
    pub pitch: f32,
    /// Level of the voices (0..1); with a roll, the balance between the track and the roll.
    pub pad_pegel: f32,
    /// Release effect: 0 vinyl brake, 1 echo, 2 back spin.
    pub rel_typ: u8,
    /// Lever, 0 = at rest, up to 1 = fully pulled.
    pub hebel: f32,
    /// After a release the sections stay on (true) or stay silent until their control is reset (false).
    pub rel_halten: bool,
    /// The input runs through the effect sections (true) or around them.
    pub ein_fx: bool,
    /// The pad sounds run through the effect sections (true) or around them.
    pub pad_fx: bool,
    /// Beat-synchronous ducking of everything the scene effect adds, 0..1 (our addition).
    pub pumpen: f32,
    /// Output level in dB.
    pub pegel_db: f32,
}

impl Default for Einstellung {
    fn default() -> Self {
        Einstellung {
            szene_typ: 0,
            szene: 0.0,
            sub1: 0.5,
            sub2: 0.0,
            iso_typ: 0,
            low: 0.0,
            mid: 0.0,
            hi: 0.0,
            roll: false,
            kick: false,
            snare: false,
            clap: false,
            hat: false,
            pad: 0.5,
            beruehrt: false,
            halten: false,
            overdub: false,
            pitch: 0.0,
            pad_pegel: 0.7,
            rel_typ: 0,
            hebel: 0.0,
            rel_halten: false,
            ein_fx: true,
            pad_fx: true,
            pumpen: 0.0,
            pegel_db: 0.0,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Remix {
    sr: f64,
    e: Einstellung,
    pad: Pad,
    iso: Isolate,
    szene: Szene,
    rel: Release,
    g_ein: Glatt,
    g_pad: Glatt,
    g_trommel: Glatt,
    g_aus: Glatt,
    pumpen: Glatt,
    /// After a release without hold: the section stays silent until its control is reset.
    sperre_szene: bool,
    sperre_iso: bool,
    sperre_pad: bool,
    szene_typ_alt: u8,
    iso_typ_alt: u8,
}

impl Remix {
    pub fn neu(sr: f64) -> Self {
        let mut r = Remix {
            sr,
            e: Einstellung::default(),
            pad: Pad::neu(sr),
            iso: Isolate::neu(sr),
            szene: Szene::neu(sr),
            rel: Release::neu(sr),
            g_ein: Glatt::neu(sr, 3.0),
            g_pad: Glatt::neu(sr, 3.0),
            g_trommel: Glatt::neu(sr, 10.0),
            g_aus: Glatt::neu(sr, 10.0),
            pumpen: Glatt::neu(sr, 10.0),
            sperre_szene: false,
            sperre_iso: false,
            sperre_pad: false,
            szene_typ_alt: 0,
            iso_typ_alt: 0,
        };
        r.sprung();
        r
    }

    pub fn rate(&self) -> f64 {
        self.sr
    }

    /// Latency in samples: none.
    pub fn latenz(&self) -> usize {
        0
    }

    pub fn setze(&mut self, e: &Einstellung) {
        self.e = *e;
    }

    pub fn einstellung(&self) -> Einstellung {
        self.e
    }

    /// The glides jump to the current settings.
    fn sprung(&mut self) {
        self.g_ein.setze(if self.e.ein_fx { 1.0 } else { 0.0 });
        self.g_pad.setze(if self.e.pad_fx { 1.0 } else { 0.0 });
        self.g_trommel.setze(Self::trommel_pegel(self.e.pad_pegel));
        self.g_aus.setze(db(self.e.pegel_db.clamp(-120.0, 12.0) as f64));
        self.pumpen.setze(self.e.pumpen.clamp(0.0, 1.0));
    }

    /// DECISION: the level control of the voices is quadratic, full = -2 dB.
    fn trommel_pegel(p: f32) -> f32 {
        let p = p.clamp(0.0, 1.0);
        p * p * 0.8
    }

    /// Empties every memory and voice; the next sample starts like a new device.
    pub fn leeren(&mut self) {
        self.pad.leeren();
        self.iso.leeren();
        self.szene.leeren();
        self.rel.leeren();
        self.sperre_szene = false;
        self.sperre_iso = false;
        self.sperre_pad = false;
        self.szene_typ_alt = self.e.szene_typ;
        self.iso_typ_alt = self.e.iso_typ;
        self.sprung();
    }

    /// One block in place. `beat0` is the beat of the first sample, `bps` the beats per sample (bpm / 60 / rate).
    pub fn block(&mut self, l: &mut [f32], r: &mut [f32], beat0: f64, bps: f64) {
        let bps = if bps.is_finite() && bps > 0.0 { bps } else { 128.0 / 60.0 / self.sr };
        let spb = 1.0 / bps;
        let e = self.e;
        let pe = PadEin {
            roll: e.roll,
            an: [e.kick, e.snare, e.clap, e.hat],
            pad: e.pad,
            beruehrt: e.beruehrt,
            halten: e.halten,
            overdub: e.overdub,
            pitch: e.pitch,
        };
        // a locked section opens again when its effect is selected anew or its control is back at rest
        if e.szene_typ != self.szene_typ_alt || e.szene <= 0.0 {
            self.sperre_szene = false;
        }
        if e.iso_typ != self.iso_typ_alt || (e.low == 0.0 && e.mid == 0.0 && e.hi == 0.0) {
            self.sperre_iso = false;
        }
        if !e.beruehrt && !e.halten {
            self.sperre_pad = false;
        }
        self.szene_typ_alt = e.szene_typ;
        self.iso_typ_alt = e.iso_typ;
        let balance = (2.0 * e.pad_pegel).clamp(0.0, 1.0);
        let ziel_aus = db(e.pegel_db.clamp(-120.0, 12.0) as f64);
        let ziel_trommel = Self::trommel_pegel(e.pad_pegel);

        for i in 0..l.len().min(r.len()) {
            let beat = beat0 + i as f64 * bps;
            let (xl, xr) = (l[i], r[i]);
            let pad_ein = if self.sperre_pad { PadEin { beruehrt: false, halten: false, ..pe } } else { pe };
            let p = self.pad.tick(xl, xr, &pad_ein, beat, spb);
            // the roll takes the place of the track by the balance
            let (ql, qr) = if p.roll_g > 0.0 {
                let a = p.roll_g * balance;
                (xl + (p.roll[0] - xl) * a, xr + (p.roll[1] - xr) * a)
            } else {
                (xl, xr)
            };
            let t = p.trommel * self.g_trommel.zu(ziel_trommel);
            let ge = self.g_ein.zu(if e.ein_fx { 1.0 } else { 0.0 });
            let gp = self.g_pad.zu(if e.pad_fx { 1.0 } else { 0.0 });
            // into the effect sections, and around them
            let (mut kl, mut kr) = (ql * ge, qr * ge);
            let (mut nl, mut nr) = (ql * (1.0 - ge), qr * (1.0 - ge));
            if t != 0.0 {
                kl += t * gp;
                kr += t * gp;
                nl += t * (1.0 - gp);
                nr += t * (1.0 - gp);
            }
            let iso_typ = if self.sperre_iso { 0 } else { e.iso_typ };
            let (il, ir) = self.iso.tick(kl, kr, iso_typ, [e.low, e.mid, e.hi], beat, spb);
            let szene_typ = if self.sperre_szene { 0 } else { e.szene_typ };
            let (mut sl, mut sr_) = self.szene.tick(il, ir, szene_typ, e.szene, e.sub1, e.sub2, beat, spb);
            let pu = self.pumpen.zu(e.pumpen.clamp(0.0, 1.0));
            if pu > 0.0 && self.szene.wirkt() {
                // what the scene adds ducks on every beat and comes back over the first 60 % of it
                let weg = (1.0 - beat.rem_euclid(1.0) / 0.6).max(0.0) as f32;
                let g = 1.0 - pu * weg * weg;
                sl = il + (sl - il) * g;
                sr_ = ir + (sr_ - ir) * g;
            }
            let (al, ar, ende) = self.rel.tick(sl, sr_, e.rel_typ, e.hebel, spb);
            if ende && !e.rel_halten {
                self.sperre_szene = e.szene_typ != 0 && e.szene > 0.0;
                self.sperre_iso = e.iso_typ != 0 && !(e.low == 0.0 && e.mid == 0.0 && e.hi == 0.0);
                self.sperre_pad = e.beruehrt || e.halten;
            }
            let g = self.g_aus.zu(ziel_aus);
            l[i] = (al + nl) * g;
            r[i] = (ar + nr) * g;
        }
    }
}
