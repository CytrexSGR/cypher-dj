//! Baukasten block `remix`: the Cypher Remix (`remix_dsp`) as one stereo block, a beat-synchronous remix station with
//! four sections (pad, isolate, scene, release). Sum point like `hall`: left = sum of (x + l), right = sum of (x + r)
//! over the voices, result in voice 0. The block follows the beat of the graph.
//!
//! Every control is an input, read from voice 0 once per sample, so knobs, envelopes or an LFO can drive it.
//!
//! Scene: `szene` is bipolar, -1..1 with a neutral centre: to the right it drives the build-up effect `bau_typ` (1 BPF
//! echo, 2 echo, 3 noise, 4 spiral up, 5 reverb up), to the left the break-down effect `ab_typ` (6 HPF echo, 7 crush echo,
//! 8 LPF echo, 9 spiral down, 10 reverb down); `sub1`, `sub2` 0..1. The hardware this follows has ten buttons and a
//! control that starts at the left end; one control with two directions keeps the centre of every knob neutral, which
//! is what an insert stage starts with.
//! Isolate: `iso_typ` (1 cut/add, 2 trans/roll, 3 isolator, 4 gate/drive), `low`, `mid`, `hi` -1..1; with all three in
//! the centre the section is off.
//! Pad: `roll`, `kick`, `snare`, `clap`, `hat` (above 0.5 = on), `pad` (0..1), `touch`, `halten`, `overdub` (above 0.5 =
//! on), `pitch` (semitones), `padpegel` (0..1).
//! Release: `rel_typ` (0 brake, 1 echo, 2 back spin), `hebel` (0 and below = at rest, up to 1 = fully pulled),
//! `rel_halten` (above 0.5 = the sections stay on after a release).
//! `ein_fx`, `pad_fx` (above 0.5 = through the effect sections); `pumpen` (0..1); `pegel` (dB).
//! Ranges are those of `remix_dsp` (clamped there). A non-finite control reads its default, a non-finite input reads 0.
//!
//! The selectors (`bau_typ`, `ab_typ`, `iso_typ`, `rel_typ`) are rounded and must hold a value for 32 ms before it
//! counts: a knob that glides from one type to another passes the types in between and would start each of them.
//!
//! No latency. No allocation after construction. With everything off the block passes its input bit for bit.
use remix_dsp::{Einstellung, Remix};

/// Number of control inputs.
pub const STEUER_ZAHL: usize = 27;
/// All inputs of the block: the three audio inputs, then the controls.
pub const EIN: [&str; 3 + STEUER_ZAHL] = [
    "x", "l", "r",
    "bau_typ", "ab_typ", "szene", "sub1", "sub2",
    "iso_typ", "low", "mid", "hi",
    "roll", "kick", "snare", "clap", "hat", "pad", "touch", "halten", "overdub", "pitch", "padpegel",
    "rel_typ", "hebel", "rel_halten",
    "ein_fx", "pad_fx", "pumpen", "pegel",
];
/// Defaults of the controls (same order as `EIN` without the audio inputs).
pub const FREI: [(&str, f32); STEUER_ZAHL] = [
    ("bau_typ", 3.0), ("ab_typ", 8.0), ("szene", 0.0), ("sub1", 0.5), ("sub2", 0.0),
    ("iso_typ", 3.0), ("low", 0.0), ("mid", 0.0), ("hi", 0.0),
    ("roll", 0.0), ("kick", 0.0), ("snare", 0.0), ("clap", 0.0), ("hat", 0.0), ("pad", 0.5), ("touch", 0.0), ("halten", 0.0), ("overdub", 0.0), ("pitch", 0.0), ("padpegel", 0.7),
    ("rel_typ", 0.0), ("hebel", 0.0), ("rel_halten", 0.0),
    ("ein_fx", 1.0), ("pad_fx", 1.0), ("pumpen", 0.0), ("pegel", 0.0),
];
/// Around the centre a bipolar control is at rest; the travel outside is stretched to the full range.
pub const TOTZONE: f32 = 0.02;
/// A selector value counts after it has been held for this long.
pub const WAHL_HALT_S: f32 = 0.032;

/// A rounded selector that ignores values it only passes through.
#[derive(Clone, Copy, Debug, Default)]
struct Wahl {
    fest: u8,
    kandidat: u8,
    n: u32,
}

impl Wahl {
    #[inline]
    fn tick(&mut self, wert: f64, min: u8, max: u8, halt: u32, sofort: bool) -> u8 {
        let w = wert.round().clamp(min as f64, max as f64) as u8;
        if sofort || w == self.fest {
            self.fest = w;
            self.kandidat = w;
            self.n = 0;
        } else if w == self.kandidat {
            self.n += 1;
            if self.n >= halt {
                self.fest = w;
                self.n = 0;
            }
        } else {
            self.kandidat = w;
            self.n = 0;
        }
        self.fest
    }
}

pub struct Block {
    r: Remix,
    letzte: Option<Einstellung>,
    wahl: [Wahl; 4],
    halt: u32,
    /// The next sample is the first one after construction or a reset: selectors and glides jump to the settings.
    frisch: bool,
}

#[inline]
fn wert(c: &[f32; STEUER_ZAHL], i: usize) -> f64 {
    (if c[i].is_finite() { c[i] } else { FREI[i].1 }) as f64
}

impl Block {
    pub fn neu(sr: f32) -> Self {
        Block { r: Remix::neu(sr as f64), letzte: None, wahl: [Wahl::default(); 4], halt: (WAHL_HALT_S * sr) as u32, frisch: true }
    }

    pub fn zuruecksetzen(&mut self) {
        self.letzte = None;
        self.frisch = true;
    }

    /// One sample: the two audio inputs, the controls of this sample, the beat of this sample and the beats per sample.
    #[inline]
    pub fn prozess(&mut self, l: f32, r: f32, c: &[f32; STEUER_ZAHL], beat: f64, bps: f64) -> (f32, f32) {
        let an = |i: usize| wert(c, i) > 0.5;
        let f = |i: usize| wert(c, i) as f32;
        // a bipolar control without its rest zone, -1..1
        let ohne_tot = |v: f32| if v.abs() <= TOTZONE { 0.0 } else { v.signum() * (v.abs().min(1.0) - TOTZONE) / (1.0 - TOTZONE) };
        let (halt, frisch) = (self.halt, self.frisch);
        use remix_dsp::{isolate, release, szene};
        let bau = self.wahl[0].tick(wert(c, 0), szene::BPF_ECHO, szene::REVERB_UP, halt, frisch);
        let ab = self.wahl[1].tick(wert(c, 1), szene::HPF_ECHO, szene::REVERB_DOWN, halt, frisch);
        let richtung = ohne_tot(f(2));
        let (low, mid, hi) = (ohne_tot(f(6)), ohne_tot(f(7)), ohne_tot(f(8)));
        let iso = self.wahl[2].tick(wert(c, 5), isolate::CUT_ADD, isolate::GATE_DRIVE, halt, frisch);
        let e = Einstellung {
            szene_typ: if richtung > 0.0 { bau } else if richtung < 0.0 { ab } else { 0 },
            szene: richtung.abs(),
            sub1: f(3),
            sub2: f(4),
            iso_typ: if low == 0.0 && mid == 0.0 && hi == 0.0 { 0 } else { iso },
            low,
            mid,
            hi,
            roll: an(9),
            kick: an(10),
            snare: an(11),
            clap: an(12),
            hat: an(13),
            pad: f(14),
            beruehrt: an(15),
            halten: an(16),
            overdub: an(17),
            pitch: f(18),
            pad_pegel: f(19),
            rel_typ: self.wahl[3].tick(wert(c, 20), release::VINYL_BRAKE, release::BACK_SPIN, halt, frisch),
            hebel: f(21).max(0.0),
            rel_halten: an(22),
            ein_fx: an(23),
            pad_fx: an(24),
            pumpen: f(25),
            pegel_db: f(26),
        };
        if self.letzte != Some(e) {
            self.r.setze(&e);
            self.letzte = Some(e);
        }
        if frisch {
            self.r.leeren();
            self.frisch = false;
        }
        let (mut a, mut b) = ([if l.is_finite() { l } else { 0.0 }], [if r.is_finite() { r } else { 0.0 }]);
        self.r.block(&mut a, &mut b, beat, bps);
        (if a[0].is_finite() { a[0] } else { 0.0 }, if b[0].is_finite() { b[0] } else { 0.0 })
    }
}
