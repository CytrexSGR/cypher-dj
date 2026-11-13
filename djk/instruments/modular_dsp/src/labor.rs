//! Baukasten block `labor`: the Cypher Labor (`labor_dsp`) as one stereo block, a dual-channel feedback processor and
//! feedback synthesizer. Sum point like `hall`: left = sum of (x + l), right = sum of (x + r) over the voices, result in
//! voice 0. Left is channel 1, right is channel 2 of the device.
//!
//! Every control is an input, read from voice 0 once per sample, so knobs, envelopes, an LFO or `note.hz` can drive it:
//! per channel `gain` (dB), `mix`, `delay` (above 0.5 = on), `zeit` (ms), `cutoff` (Hz), `reso`, `hp` (above 0.5 =
//! high-pass), `fb`, `kreuz`, `modgain`, `modzeit`, `modcutoff`; once `zyklus` (above 0.5 = the modulator cycles), `trig`
//! (a rising edge through 0.5 starts the modulator and the ping), `attack` and `decay` (s), `amount`, `ping`, `pegel` (dB).
//! Ranges are those of `labor_dsp` (clamped there). A non-finite control reads its default, a non-finite input reads 0.
//! The fixed value `ueber`: 0 runs the loop at the base rate, 1 at twice the rate between linear-phase filters (the dry input
//! stays exact, latency reported to the graph: for effects), 2 at twice the rate with a minimum-phase decimator (no latency:
//! for instruments, which a project track only takes without latency).
//!
//! No allocation after construction. The device is bounded by its own saturators, so the block never trips the watchdog.
use labor_dsp::{Einstellung, KanalEinstellung, Labor, Ueber};

/// Controls per channel, in the order of the inputs.
pub const JE_KANAL: usize = 12;
/// Number of control inputs.
pub const STEUER_ZAHL: usize = 2 * JE_KANAL + 7;
/// All inputs of the block: the three audio inputs, then the controls.
pub const EIN: [&str; 3 + STEUER_ZAHL] = [
    "x", "l", "r",
    "gain1", "mix1", "delay1", "zeit1", "cutoff1", "reso1", "hp1", "fb1", "kreuz1", "modgain1", "modzeit1", "modcutoff1",
    "gain2", "mix2", "delay2", "zeit2", "cutoff2", "reso2", "hp2", "fb2", "kreuz2", "modgain2", "modzeit2", "modcutoff2",
    "zyklus", "trig", "attack", "decay", "amount", "ping", "pegel",
];
/// Defaults of the controls (same order as `EIN` without the audio inputs), then the fixed value `ueber`.
pub const FREI: [(&str, f32); STEUER_ZAHL + 1] = [
    ("gain1", 0.0), ("mix1", 1.0), ("delay1", 1.0), ("zeit1", 250.0), ("cutoff1", 1500.0), ("reso1", 0.3), ("hp1", 0.0), ("fb1", 0.3), ("kreuz1", 0.0), ("modgain1", 0.0), ("modzeit1", 0.0), ("modcutoff1", 0.0),
    ("gain2", 0.0), ("mix2", 1.0), ("delay2", 1.0), ("zeit2", 250.0), ("cutoff2", 1500.0), ("reso2", 0.3), ("hp2", 0.0), ("fb2", 0.3), ("kreuz2", 0.0), ("modgain2", 0.0), ("modzeit2", 0.0), ("modcutoff2", 0.0),
    ("zyklus", 0.0), ("trig", 0.0), ("attack", 0.005), ("decay", 0.3), ("amount", 1.0), ("ping", 0.0), ("pegel", -6.0),
    ("ueber", 1.0),
];

/// The loop mode of the fixed value `ueber` (0, 1 or 2; checked at translation).
pub fn art(ueber: f32) -> Ueber {
    match ueber as i32 {
        0 => Ueber::Aus,
        2 => Ueber::Minimal,
        _ => Ueber::Linear,
    }
}

/// Latency of the block in samples.
pub fn latenz(sr: f32, ueber: f32) -> usize {
    Labor::mit_art(sr as f64, art(ueber)).latenz()
}

pub struct Block {
    lab: Labor,
    letzte: Option<Einstellung>,
    trig_alt: bool,
    /// The next sample is the first one after construction or a reset: the glides jump to the settings.
    frisch: bool,
}

#[inline]
fn wert(c: &[f32; STEUER_ZAHL], i: usize) -> f64 {
    (if c[i].is_finite() { c[i] } else { FREI[i].1 }) as f64
}

fn kanal(c: &[f32; STEUER_ZAHL], o: usize) -> KanalEinstellung {
    KanalEinstellung {
        gain_db: wert(c, o),
        mix: wert(c, o + 1),
        delay_an: wert(c, o + 2) > 0.5,
        zeit_ms: wert(c, o + 3),
        cutoff_hz: wert(c, o + 4),
        resonanz: wert(c, o + 5),
        hp: wert(c, o + 6) > 0.5,
        feedback: wert(c, o + 7),
        kreuz: wert(c, o + 8),
        mod_gain: wert(c, o + 9),
        mod_zeit: wert(c, o + 10),
        mod_cutoff: wert(c, o + 11),
    }
}

impl Block {
    pub fn neu(sr: f32, ueber: f32) -> Self {
        Block { lab: Labor::mit_art(sr as f64, art(ueber)), letzte: None, trig_alt: false, frisch: true }
    }

    pub fn zuruecksetzen(&mut self) {
        self.lab.leeren();
        self.letzte = None;
        self.trig_alt = false;
        self.frisch = true;
    }

    /// One sample: the two audio inputs and the controls of this sample.
    #[inline]
    pub fn prozess(&mut self, l: f32, r: f32, c: &[f32; STEUER_ZAHL]) -> (f32, f32) {
        let g = 2 * JE_KANAL;
        let e = Einstellung {
            kanal: [kanal(c, 0), kanal(c, JE_KANAL)],
            zyklus: wert(c, g) > 0.5,
            attack_s: wert(c, g + 2),
            decay_s: wert(c, g + 3),
            amount: wert(c, g + 4),
            ping: wert(c, g + 5),
            lautstaerke_db: wert(c, g + 6).clamp(-120.0, 12.0),
            key_track: 0.0,
            gate: false,
            mono_ein: false,
        };
        if self.letzte != Some(e) {
            self.lab.setze(&e);
            self.letzte = Some(e);
        }
        if self.frisch {
            self.lab.leeren();
            self.frisch = false;
        }
        let trig = wert(c, g + 1) > 0.5;
        if trig && !self.trig_alt {
            self.lab.trigger(1.0);
        }
        self.trig_alt = trig;
        let (mut a, mut b) = ([if l.is_finite() { l } else { 0.0 }], [if r.is_finite() { r } else { 0.0 }]);
        self.lab.block(&mut a, &mut b);
        (if a[0].is_finite() { a[0] } else { 0.0 }, if b[0].is_finite() { b[0] } else { 0.0 })
    }
}
