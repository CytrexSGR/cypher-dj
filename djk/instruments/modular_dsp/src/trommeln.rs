//! Drum kit (type 47, `trommeln`): the whole TR-909 or TR-808 kit in one block. The MIDI note number picks the drum, so one
//! graph (one stream) plays the kit; every voice computes only the drum it was struck with, idle voices cost a branch.
//!
//! **Why one block.** A stream carries exactly one graph. Built from the basic blocks, every voice would compute every drum
//! (a kick, a snare, a clap ... per voice) and the note could only gate them with extra nodes. Here the voice holds one drum
//! at a time, chosen at the strike, and the block also owns what the hardware shares between the drums: the hat choke group,
//! the bus drive and the DJ filter. The block is a *sum point* like `hall`: the result is in voice 0 (`aus`), the other voices
//! carry 0, the graph needs no summing node. Computation: one 909/808 drum is a few oscillators, an envelope and a
//! filter; the metallic drums use the oscillator bank of `metall.rs`.
//!
//! **Note map (GM drum map).** 35 and below kick (808: 35 = Boom, the long bass drum), 36 kick, 37 rim, 38 snare, 39 clap,
//! 40 snare (tighter, +2 st), 41 / 43 low tom, 45 / 47 mid tom, 48 / 50 high tom (the second note of each pair +3 st), 42
//! closed hat, 44 pedal hat (short, darker), 46 open hat, 49 crash, 51 ride, 53 ride bell, 55 splash, 57 crash 2, 59 ride 2,
//! 56 cowbell (808 only; on the 909 the note plays the splash), 75 and above clave (808 only; on the 909 silent). A note the
//! table does not list plays the next listed note below it (52 ride, 54 ride bell, 58 crash 2, 60..74 ride 2).
//!
//! **Inputs.** `trig`, `vel`, `hz` come from a `note` node (the note number is read back from `hz`). Everything else is a
//! parameter, in plain units (Hz, ms to -60 dB, semitones, 0..1), read **at the strike** and kept for that hit, so a knob
//! changes the next hit, not the one ringing. Exceptions, read every sample (smoothed over 8 ms): `pegel`, `drive`,
//! `filter`, `reso` of the bus. Fixed values `modell` (0 = TR-909, 1 = TR-808), `schnitt` (choke time, ms) and `saat` (noise seed).
//!
//! **Drums** (see `GERAET-trommeln.md` for the measured values): kick = sine with an exponential pitch glide in semitones
//! (`kick_punch` up, time constant `kick_pdecay`; a big punch with a long time is a zap or a laser), amplitude decay to -60 dB in
//! `kick_decay`, a tanh stage that squares the loud start (909 punch), and a noise click. Snare = two sines (ratio 1.83) with
//! a short pitch drop plus high-passed noise (`snare_snappy` = noise level, `snare_tone` = noise colour) and a crack burst.
//! Clap = band-passed noise through four envelope bursts (three short ones `clap_spread` apart, then the tail). Rim = two
//! sines (ratio 3.6) and a click. Toms = sine with a pitch glide. Hats and cymbals = the six inharmonic squares of the
//! 808 cymbal circuit (`metall::Bank`) mixed with noise and filtered like `metall`. Cowbell (808) = squares at 540 and 800 Hz
//! through a band-pass, two-stage envelope. Clave (808) = two decaying sines.
//!
//! **Choke.** A strike of the closed or the pedal hat (or any new hat) cuts the open hat ringing in another voice: its envelope
//! falls to -60 dB within `schnitt` ms on an exponential curve, so the gain never steps.
//!
//! **Click safety.** A strike on a voice that still rings (the same drum again, or a stolen voice) does not restart from zero:
//! the last output sample is carried over and fades with a 1 ms time constant, so there is no step in the signal. Kicks,
//! toms and the attack of every tonal drum start from zero amplitude with a 0.5 ms ramp.
//!
//! **Real time.** No allocation, lock or panic in `prozess_stimmen`; every input is checked for being finite and clamped; an idle
//! voice computes nothing and holds no state that decays into subnormals; the bus clears its filters after half a second of
//! silence.
use crate::metall::{blep_tabelle, gewichte, schritte as metall_schritte, Bank, Kette, BAENDER, RAUSCH_BAND};
use crate::programm::{Spur, MAX_STIMMEN};
use crate::svf::Stufe;
use saett_dsp::Adaa1;

/// Inputs before the parameters: `trig`, `vel`, `hz`.
pub const KOPF: usize = 3;

/// Parameter table: name, default, min, max. Order = the inputs after `trig`, `vel`, `hz` (`EIN`).
pub const PARAMETER: [(&str, f32, f32, f32); 38] = [
    // bus
    ("pegel", 1.0, 0.0, 2.0),
    ("drive", 0.5, 0.0, 1.0),
    ("filter", 0.5, 0.0, 1.0),
    ("reso", 0.3, 0.0, 1.0),
    // kick
    ("kick_tune", 54.0, 25.0, 200.0),
    ("kick_decay", 380.0, 30.0, 3000.0),
    ("kick_punch", 24.0, 0.0, 60.0),
    ("kick_pdecay", 14.0, 2.0, 400.0),
    ("kick_click", 0.5, 0.0, 1.0),
    ("kick_drive", 0.5, 0.0, 1.0),
    // snare
    ("snare_tune", 190.0, 80.0, 400.0),
    ("snare_decay", 220.0, 40.0, 1500.0),
    ("snare_snappy", 0.5, 0.0, 1.0),
    ("snare_tone", 0.5, 0.0, 1.0),
    // clap
    ("clap_decay", 280.0, 40.0, 1500.0),
    ("clap_tone", 0.5, 0.0, 1.0),
    ("clap_spread", 0.5, 0.0, 1.0),
    // rim
    ("rim_tune", 480.0, 200.0, 1500.0),
    ("rim_decay", 50.0, 15.0, 400.0),
    // toms
    ("tomlo_tune", 85.0, 40.0, 300.0),
    ("tommid_tune", 128.0, 60.0, 400.0),
    ("tomhi_tune", 190.0, 80.0, 500.0),
    ("tom_decay", 420.0, 60.0, 2500.0),
    ("tom_punch", 14.0, 0.0, 36.0),
    // hats
    ("hat_tune", 1.0, 0.5, 2.0),
    ("hat_tone", 0.5, 0.0, 1.0),
    ("hat_noise", 0.3, 0.0, 1.0),
    ("ch_decay", 55.0, 8.0, 400.0),
    ("oh_decay", 380.0, 60.0, 3000.0),
    // cymbals
    ("crash_tune", 1.0, 0.5, 2.0),
    ("crash_decay", 1800.0, 300.0, 8000.0),
    ("ride_tune", 1.0, 0.5, 2.0),
    ("ride_decay", 1300.0, 200.0, 6000.0),
    // 808 extras
    ("cow_tune", 1.0, 0.5, 2.0),
    ("cow_decay", 320.0, 40.0, 1500.0),
    ("boom_tune", 41.0, 25.0, 80.0),
    ("boom_decay", 2200.0, 300.0, 6000.0),
    ("clave_tune", 2500.0, 1200.0, 5000.0),
];

/// Number of inputs (`trig`, `vel`, `hz` and the parameters).
pub const NEIN: usize = KOPF + PARAMETER.len();

/// Input names in the order of `PARAMETER` after `trig`, `vel`, `hz`; `uebersetzen::ARTEN` lists the same names.
pub const EIN: [&str; NEIN] = [
    "trig", "vel", "hz", "pegel", "drive", "filter", "reso", "kick_tune", "kick_decay", "kick_punch", "kick_pdecay", "kick_click", "kick_drive",
    "snare_tune", "snare_decay", "snare_snappy", "snare_tone", "clap_decay", "clap_tone", "clap_spread", "rim_tune", "rim_decay", "tomlo_tune",
    "tommid_tune", "tomhi_tune", "tom_decay", "tom_punch", "hat_tune", "hat_tone", "hat_noise", "ch_decay", "oh_decay", "crash_tune", "crash_decay",
    "ride_tune", "ride_decay", "cow_tune", "cow_decay", "boom_tune", "boom_decay", "clave_tune",
];

// indices into the input list
const I_PEGEL: usize = 3;
const I_DRIVE: usize = 4;
const I_FILTER: usize = 5;
const I_RESO: usize = 6;
const I_KICK_TUNE: usize = 7;
const I_KICK_DECAY: usize = 8;
const I_KICK_PUNCH: usize = 9;
const I_KICK_PDECAY: usize = 10;
const I_KICK_CLICK: usize = 11;
const I_KICK_DRIVE: usize = 12;
const I_SNARE_TUNE: usize = 13;
const I_SNARE_DECAY: usize = 14;
const I_SNARE_SNAPPY: usize = 15;
const I_SNARE_TONE: usize = 16;
const I_CLAP_DECAY: usize = 17;
const I_CLAP_TONE: usize = 18;
const I_CLAP_SPREAD: usize = 19;
const I_RIM_TUNE: usize = 20;
const I_RIM_DECAY: usize = 21;
const I_TOMLO: usize = 22;
const I_TOMMID: usize = 23;
const I_TOMHI: usize = 24;
const I_TOM_DECAY: usize = 25;
const I_TOM_PUNCH: usize = 26;
const I_HAT_TUNE: usize = 27;
const I_HAT_TONE: usize = 28;
const I_HAT_NOISE: usize = 29;
const I_CH_DECAY: usize = 30;
const I_OH_DECAY: usize = 31;
const I_CRASH_TUNE: usize = 32;
const I_CRASH_DECAY: usize = 33;
const I_RIDE_TUNE: usize = 34;
const I_RIDE_DECAY: usize = 35;
const I_COW_TUNE: usize = 36;
const I_COW_DECAY: usize = 37;
const I_BOOM_TUNE: usize = 38;
const I_BOOM_DECAY: usize = 39;
const I_CLAVE_TUNE: usize = 40;

/// Choke time bounds in ms.
pub const SCHNITT_MIN: f32 = 1.0;
pub const SCHNITT_MAX: f32 = 100.0;

/// Output level of each drum at `vel` 1 and the default parameters (calibrated, `tests/trommeln.rs`).
const PEGEL_KICK: f32 = 0.85;
const PEGEL_BOOM: f32 = 0.70;
const PEGEL_SNARE: f32 = 0.80;
const PEGEL_CLAP: f32 = 1.10;
const PEGEL_RIM: f32 = 0.40;
const PEGEL_TOM: f32 = 0.75;
/// hats: 909 / 808 (the 808 bank sits lower in the high-pass and carries more energy)
const PEGEL_HAT: [f32; 2] = [4.2, 3.0];
const PEGEL_CRASH: f32 = 2.3;
const PEGEL_RIDE: f32 = 1.75;
const PEGEL_COW: f32 = 0.50;
const PEGEL_CLAVE: f32 = 0.45;

const LN_60DB: f64 = -6.907_755_278_982_137;
const TAU: f64 = std::f64::consts::TAU;
/// Below this envelope value a drum is finished.
const STILL: f32 = 1e-4;

/// Per-sample factor of an exponential that falls by 60 dB in `ms`.
fn t60(ms: f32, sr: f32) -> f32 { (LN_60DB / (ms.max(0.05) as f64 * 1e-3 * sr as f64)).exp() as f32 }

/// Per-sample factor of an exponential with time constant `ms`.
fn tau(ms: f32, sr: f32) -> f32 { (-1.0 / (ms.max(0.01) as f64 * 1e-3 * sr as f64)).exp() as f32 }

/// Pre-warped gain of a TPT stage at `hz`.
fn g_von(hz: f64, sr: f32) -> f64 { (std::f64::consts::PI * hz.clamp(20.0, 0.45 * sr as f64) / sr as f64).tan() }

#[inline]
fn endlich(x: f32, sonst: f32) -> f32 { if x.is_finite() { x } else { sonst } }

/// Which drum a voice plays.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Art {
    Still,
    Kick,
    Boom,
    Snare,
    Clap,
    Rim,
    Tom,
    HatZu,
    HatPedal,
    HatOffen,
    Crash,
    Ride,
    Cow,
    Clave,
}

/// A drum chosen by a note: the drum, its tune offset in semitones, a decay factor and, for toms, which of the three.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Wahl {
    pub art: Art,
    pub st: f32,
    pub dauer: f32,
    pub tom: u8,
}

const fn w(art: Art, st: f32, dauer: f32) -> Wahl { Wahl { art, st, dauer, tom: 0 } }
const fn tom(nr: u8, st: f32) -> Wahl { Wahl { art: Art::Tom, st, dauer: 1.0, tom: nr } }

/// The drum a MIDI note plays (`modell` 0 = 909, 1 = 808); `None` = silent.
pub fn waehle(note: i32, modell: u8) -> Option<Wahl> {
    let m808 = modell == 1;
    Some(match note {
        i32::MIN..=34 => w(Art::Kick, 0.0, 1.0),
        35 if m808 => w(Art::Boom, 0.0, 1.0),
        35 | 36 => w(Art::Kick, 0.0, 1.0),
        37 => w(Art::Rim, 0.0, 1.0),
        38 => w(Art::Snare, 0.0, 1.0),
        39 => w(Art::Clap, 0.0, 1.0),
        40 => w(Art::Snare, 2.0, 0.8),
        41 => tom(0, 0.0),
        42 => w(Art::HatZu, 0.0, 1.0),
        43 => tom(0, 4.0),
        44 => w(Art::HatPedal, 0.0, 1.0),
        45 => tom(1, 0.0),
        46 => w(Art::HatOffen, 0.0, 1.0),
        47 => tom(1, 3.0),
        48 => tom(2, 0.0),
        49 => w(Art::Crash, 0.0, 1.0),
        50 => tom(2, 3.0),
        51 | 52 => w(Art::Ride, 0.0, 1.0),
        53 | 54 => w(Art::Ride, 5.0, 0.6),
        55 => w(Art::Crash, 5.0, 0.4),
        56 if m808 => w(Art::Cow, 0.0, 1.0),
        56 => w(Art::Crash, 5.0, 0.4),
        57 | 58 => w(Art::Crash, 2.0, 0.9),
        59..=74 => w(Art::Ride, 2.0, 0.9),
        75..=i32::MAX if m808 => w(Art::Clave, 0.0, 1.0),
        _ => return None,
    })
}

/// MIDI note number from the frequency a `note` node delivers (inverse of `programm::hz`); -1 for a silent or odd value.
pub fn note_aus_hz(hz: f32) -> i32 {
    if hz.is_finite() && hz > 1.0 { (69.0 + 12.0 * (hz as f64 / 440.0).log2()).round() as i32 } else { -1 }
}

/// Fixed values of the node.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Einstellung {
    /// 0 = TR-909, 1 = TR-808
    pub modell: u8,
    pub schnitt_ms: f32,
    pub saat: u32,
    /// per-sample factor of the choke
    a_schnitt: f32,
    /// per-sample factor of the carried-over residual (1 ms)
    a_rest: f32,
    /// per-sample smoothing of the bus controls (8 ms)
    k_bus: f32,
    g_band: [f64; 3],
    blep: &'static [f32],
}

impl Einstellung {
    pub fn neu(modell: u8, schnitt_ms: f32, saat: u32, sr: f32) -> Einstellung {
        let schnitt_ms = schnitt_ms.clamp(SCHNITT_MIN, SCHNITT_MAX);
        Einstellung {
            modell,
            schnitt_ms,
            saat,
            a_schnitt: t60(schnitt_ms, sr),
            a_rest: tau(1.0, sr),
            k_bus: 1.0 - tau(8.0, sr),
            g_band: std::array::from_fn(|j| g_von(BAENDER[j], sr)),
            blep: blep_tabelle(),
        }
    }
}

/// Reads a parameter (index into `EIN`), non-finite = default, clamped to its range.
fn par(p: &dyn Fn(usize) -> f32, i: usize) -> f32 {
    let (_, vorgabe, lo, hi) = PARAMETER[i - KOPF];
    endlich(p(i), vorgabe).clamp(lo, hi)
}

fn blep(t: f64, dt: f64) -> f64 {
    if t < dt {
        let x = t / dt;
        2.0 * x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + 2.0 * x + 1.0
    } else {
        0.0
    }
}

/// Band-limited square (two-point polyBLEP), phase 0..1, `dt` = phase step.
fn rechteck(ph: f64, dt: f64) -> f32 {
    let naiv = if ph < 0.5 { 1.0 } else { -1.0 };
    (naiv + blep(ph, dt) - blep((ph + 0.5).fract(), dt)) as f32
}

/// State of one voice.
#[derive(Clone, Copy)]
pub struct Stimme {
    art: Art,
    /// samples since the strike
    n: u32,
    lvl: f32,
    zufall: u32,
    ph: [f64; 3],
    fq: [f64; 3],
    env: [f32; 5],
    dec: [f32; 5],
    par: [f32; 6],
    st: [Stufe; 4],
    g: [f64; 4],
    k: [f64; 4],
    // metallic drums
    bank: Bank,
    kette: Kette,
    schritt: [u32; 6],
    w: [f32; 3],
    abgleich: f32,
    mcos: f32,
    msin: f32,
    g_hp: f64,
    gewuergt: bool,
    // click safety
    rest: f32,
    letzt: f32,
}

impl Stimme {
    pub fn neu(stimme: usize, e: &Einstellung) -> Stimme {
        let s = 0x9E37_79B9u32 ^ (stimme as u32 + 1).wrapping_mul(0x85EB_CA6B) ^ e.saat.wrapping_mul(0xC2B2_AE35);
        Stimme {
            art: Art::Still,
            n: 0,
            lvl: 0.0,
            zufall: if s == 0 { 0x2545_F491 } else { s },
            ph: [0.0; 3],
            fq: [0.0; 3],
            env: [0.0; 5],
            dec: [0.0; 5],
            par: [0.0; 6],
            st: [Stufe::default(); 4],
            g: [0.0; 4],
            k: [1.0; 4],
            bank: Bank::neu([0; 6]),
            kette: Kette::default(),
            schritt: [0; 6],
            w: [0.0; 3],
            abgleich: 0.0,
            mcos: 1.0,
            msin: 0.0,
            g_hp: 0.1,
            gewuergt: false,
            rest: 0.0,
            letzt: 0.0,
        }
    }

    pub fn art(&self) -> Art { self.art }

    #[inline]
    fn zahl(&mut self) -> u32 {
        let mut x = self.zufall;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.zufall = x;
        x
    }

    /// White noise -1..1.
    #[inline]
    fn rausch(&mut self) -> f32 { (self.zahl() >> 8) as f32 * (2.0 / 16_777_216.0) - 1.0 }

    /// Cuts the voice: the envelope falls to -60 dB within `schnitt` ms.
    pub fn wuergen(&mut self) {
        if matches!(self.art, Art::HatOffen) {
            self.gewuergt = true;
        }
    }

    fn leeren(&mut self) {
        self.art = Art::Still;
        self.st = [Stufe::default(); 4];
        self.kette.leeren();
        self.bank.leeren();
        self.gewuergt = false;
    }

    /// A strike: sets up the drum `w` for velocity `vel`, reading the parameters through `p` (index into `EIN`).
    pub fn anschlag(&mut self, w: Wahl, vel: f32, e: &Einstellung, sr: f32, p: &dyn Fn(usize) -> f32) {
        // click safety: a ringing voice hands its last output sample over, it fades out in about 1 ms
        self.rest = if self.art != Art::Still { self.letzt } else { 0.0 };
        self.st = [Stufe::default(); 4];
        self.kette.leeren();
        self.bank.leeren();
        self.gewuergt = false;
        self.art = w.art;
        self.n = 0;
        self.lvl = endlich(vel, 0.0).clamp(0.0, 1.0);
        self.ph = [0.0; 3];
        self.env = [0.0; 5];
        self.par = [0.0; 6];
        let m808 = e.modell == 1;
        let tm = 2f64.powf(w.st as f64 / 12.0);
        match w.art {
            Art::Kick | Art::Boom => {
                let boom = w.art == Art::Boom;
                let (tune, dec, punch, pdec, klick, drv) = if boom {
                    (par(p, I_BOOM_TUNE) as f64, par(p, I_BOOM_DECAY), 5.0, 40.0, 0.15, 0.5)
                } else {
                    (par(p, I_KICK_TUNE) as f64 * tm, par(p, I_KICK_DECAY) * w.dauer, par(p, I_KICK_PUNCH), par(p, I_KICK_PDECAY), par(p, I_KICK_CLICK), par(p, I_KICK_DRIVE))
                };
                self.fq[0] = tune;
                self.par[0] = punch;
                self.env[0] = 1.0;
                self.dec[0] = t60(dec, sr);
                self.env[1] = 1.0;
                self.dec[1] = tau(pdec, sr);
                self.env[2] = 1.0;
                self.dec[2] = tau(if m808 { 2.2 } else { 1.2 }, sr);
                self.par[2] = klick * if m808 { 0.45 } else { 0.9 };
                let gain = 1.0 + 5.0 * drv.powf(1.5);
                self.par[3] = gain;
                self.par[4] = 1.0 / gain.tanh();
                self.g[0] = g_von(if m808 { 1_500.0 } else { 3_200.0 }, sr);
                self.k[0] = 1.0 / 0.8;
            }
            Art::Snare => {
                let tune = par(p, I_SNARE_TUNE) as f64 * tm;
                let dec = par(p, I_SNARE_DECAY) * w.dauer;
                let (snappy, ton) = (par(p, I_SNARE_SNAPPY), par(p, I_SNARE_TONE));
                self.fq[0] = tune;
                self.fq[1] = tune * 1.83;
                self.par[0] = if m808 { 2.5 } else { 8.0 };
                self.env[1] = 1.0;
                self.dec[1] = tau(if m808 { 5.0 } else { 7.0 }, sr);
                let ton_t60 = if m808 { (dec * 0.4).max(50.0) } else { (dec * 0.55).max(60.0) };
                self.env[0] = 1.0;
                self.dec[0] = t60(ton_t60, sr);
                self.env[2] = 1.0;
                self.dec[2] = t60(ton_t60 * 0.7, sr);
                self.env[3] = 1.0;
                self.dec[3] = t60(dec, sr);
                self.env[4] = 1.0;
                self.dec[4] = tau(1.5, sr);
                let fc = if m808 { 1_400.0 * 5f64.powf(ton as f64) } else { 600.0 * 8f64.powf(ton as f64) };
                self.g[0] = g_von(fc, sr);
                self.k[0] = std::f64::consts::SQRT_2;
                self.g[1] = g_von(if m808 { 8_000.0 } else { 6_000.0 }, sr);
                self.k[1] = std::f64::consts::SQRT_2;
                self.par[2] = 0.7;
                self.par[3] = 0.1 + 0.9 * snappy;
            }
            Art::Clap => {
                let dec = par(p, I_CLAP_DECAY);
                let (ton, spread) = (par(p, I_CLAP_TONE), par(p, I_CLAP_SPREAD));
                self.par[0] = ((6.0 + 10.0 * spread) * 1e-3 * sr) as f32;
                self.dec[0] = tau(3.0, sr);
                self.dec[1] = t60(dec, sr);
                self.g[0] = g_von(450.0, sr);
                self.k[0] = std::f64::consts::SQRT_2;
                self.g[1] = g_von(700.0 * 4f64.powf(ton as f64), sr);
                self.k[1] = if m808 { 0.7 } else { 0.85 };
                self.g[2] = g_von(3_000.0, sr);
                self.k[2] = std::f64::consts::SQRT_2;
            }
            Art::Rim => {
                let f1 = par(p, I_RIM_TUNE) as f64 * tm;
                let dec = par(p, I_RIM_DECAY);
                self.fq[0] = f1;
                self.fq[1] = f1 * 3.6;
                self.env[0] = 1.0;
                self.dec[0] = t60(dec, sr);
                self.env[1] = 1.0;
                self.dec[1] = t60(dec * 0.5, sr);
                self.env[2] = 1.0;
                self.dec[2] = tau(0.4, sr);
                self.g[0] = g_von(3_500.0, sr);
                self.k[0] = std::f64::consts::SQRT_2;
            }
            Art::Tom => {
                let (i, d) = match w.tom { 0 => (I_TOMLO, 1.0), 1 => (I_TOMMID, 0.85), _ => (I_TOMHI, 0.7) };
                self.fq[0] = par(p, i) as f64 * tm;
                self.par[0] = par(p, I_TOM_PUNCH);
                self.env[1] = 1.0;
                self.dec[1] = tau(if m808 { 30.0 } else { 20.0 }, sr);
                self.env[0] = 1.0;
                self.dec[0] = t60(par(p, I_TOM_DECAY) * d * w.dauer, sr);
                self.env[2] = 1.0;
                self.dec[2] = tau(2.5, sr);
                self.par[2] = if m808 { 0.08 } else { 0.3 };
                self.g[0] = g_von(1_800.0, sr);
                self.k[0] = 1.0 / 0.8;
            }
            Art::HatZu | Art::HatPedal | Art::HatOffen => {
                let (tune, ton, rausch) = (par(p, I_HAT_TUNE) as f64, par(p, I_HAT_TONE), par(p, I_HAT_NOISE));
                let (dec, tune) = match w.art {
                    Art::HatZu => (par(p, I_CH_DECAY), tune),
                    Art::HatPedal => (par(p, I_CH_DECAY) * 1.4, tune * 0.9),
                    _ => (par(p, I_OH_DECAY), tune),
                };
                let (hp, tune) = if m808 { (4_500.0 + 3_000.0 * ton as f64, tune) } else { (5_500.0 + 3_500.0 * ton as f64, tune * 1.12) };
                self.metall(tune as f32, ton, rausch, hp, sr);
                self.env[0] = 1.0;
                self.dec[0] = t60(dec, sr);
            }
            Art::Crash => {
                let tune = par(p, I_CRASH_TUNE) as f64 * tm * 0.9;
                self.metall(tune as f32, 0.5, 0.45, 3_000.0, sr);
                let dec = par(p, I_CRASH_DECAY) * w.dauer;
                self.env[0] = 0.45;
                self.dec[0] = t60(450.0 * w.dauer, sr);
                self.env[1] = 0.55;
                self.dec[1] = t60(dec, sr);
            }
            Art::Ride => {
                let tune = par(p, I_RIDE_TUNE) as f64 * tm * 1.3;
                self.metall(tune as f32, 0.3, 0.12, 4_200.0, sr);
                let dec = par(p, I_RIDE_DECAY) * w.dauer;
                self.env[0] = 0.5;
                self.dec[0] = t60(350.0 * w.dauer, sr);
                self.env[1] = 0.5;
                self.dec[1] = t60(dec, sr);
                // a resonant ping on top of the wash
                self.g[3] = g_von(5_200.0, sr);
                self.k[3] = 0.14;
            }
            Art::Cow => {
                let t = par(p, I_COW_TUNE) as f64;
                self.fq[0] = 540.0 * t;
                self.fq[1] = 800.0 * t;
                self.env[0] = 1.0;
                self.dec[0] = tau(12.0, sr);
                self.env[1] = 1.0;
                self.dec[1] = t60(par(p, I_COW_DECAY), sr);
                self.g[0] = g_von(2_400.0 * t, sr);
                self.k[0] = 1.1;
                self.g[1] = g_von(400.0, sr);
                self.k[1] = std::f64::consts::SQRT_2;
            }
            Art::Clave => {
                let f = par(p, I_CLAVE_TUNE) as f64;
                self.fq[0] = f;
                self.fq[1] = f * 1.52;
                self.env[0] = 1.0;
                self.dec[0] = t60(55.0, sr);
                self.env[1] = 1.0;
                self.dec[1] = t60(30.0, sr);
                self.env[2] = 1.0;
                self.dec[2] = tau(0.3, sr);
                self.g[0] = g_von(5_000.0, sr);
                self.k[0] = std::f64::consts::SQRT_2;
            }
            Art::Still => {}
        }
    }

    /// Sets up the oscillator bank, the weights and the noise mix of a metallic drum.
    fn metall(&mut self, tune: f32, farbe: f32, rauschen: f32, hp: f64, sr: f32) {
        let phase = std::array::from_fn(|_| self.zahl());
        self.bank = Bank::neu(phase);
        self.schritt = metall_schritte(tune.clamp(0.5, 2.0), sr);
        self.w = gewichte(farbe);
        self.abgleich = self.w[0] * RAUSCH_BAND[0] + self.w[1] * RAUSCH_BAND[1] + self.w[2] * RAUSCH_BAND[2];
        let m = rauschen.clamp(0.0, 1.0) * std::f32::consts::FRAC_PI_2;
        self.mcos = m.cos();
        self.msin = m.sin();
        self.g_hp = g_von(hp, sr);
    }

    /// One sample of the metallic bank through the three band-passes and the high-pass.
    #[inline]
    fn metall_sample(&mut self, e: &Einstellung) -> f32 {
        let ton = self.bank.naechstes(&self.schritt, e.blep);
        let rausch = self.rausch() * self.abgleich;
        let quelle = ton * self.mcos + rausch * self.msin;
        self.kette.prozess(quelle, &self.w, &e.g_band, self.g_hp)
    }

    /// One sample of the voice (level and carried-over residual included).
    #[inline]
    pub fn prozess(&mut self, e: &Einstellung, sr: f32) -> f32 {
        if self.art == Art::Still {
            if self.rest == 0.0 {
                return 0.0;
            }
            let o = self.rest;
            self.rest = if o.abs() < 1e-7 { 0.0 } else { o * e.a_rest };
            self.letzt = 0.0;
            return o;
        }
        let m808 = e.modell == 1;
        let roh = match self.art {
            Art::Kick => self.kick(sr, m808) * PEGEL_KICK,
            Art::Boom => self.kick(sr, m808) * PEGEL_BOOM,
            Art::Snare => self.snare(sr, m808) * PEGEL_SNARE,
            Art::Clap => self.clap() * PEGEL_CLAP,
            Art::Rim => self.rim(sr) * PEGEL_RIM,
            Art::Tom => self.tom(sr) * PEGEL_TOM,
            Art::HatZu | Art::HatPedal | Art::HatOffen => self.hat(e) * PEGEL_HAT[m808 as usize],
            Art::Crash => self.becken(e) * PEGEL_CRASH,
            Art::Ride => self.becken(e) * PEGEL_RIDE,
            Art::Cow => self.cow(sr) * PEGEL_COW,
            Art::Clave => self.clave(sr) * PEGEL_CLAVE,
            Art::Still => 0.0,
        };
        self.n = self.n.saturating_add(1);
        let o = roh * self.lvl + self.rest;
        self.rest = if self.rest.abs() < 1e-7 { 0.0 } else { self.rest * e.a_rest };
        if !o.is_finite() {
            self.leeren();
            self.rest = 0.0;
            self.letzt = 0.0;
            return 0.0;
        }
        self.letzt = o;
        o
    }

    fn kick(&mut self, sr: f32, m808: bool) -> f32 {
        let rampe = (self.n as f32 * (1.0 / (0.0005 * sr))).min(1.0);
        let f = self.fq[0] * ((self.par[0] * self.env[1]) as f64 / 12.0).exp2();
        self.ph[0] = (self.ph[0] + f / sr as f64).fract();
        let s = (TAU * self.ph[0]).sin() as f32;
        let koerper = s * self.env[0] * rampe;
        let y = (self.par[3] * koerper).tanh() * self.par[4];
        let r = self.rausch() * self.env[2];
        let (_, bp, _) = self.st[0].prozess(r as f64, self.g[0], self.k[0]);
        let klick = bp as f32 * self.k[0] as f32 * self.par[2];
        self.env[0] *= self.dec[0];
        self.env[1] *= self.dec[1];
        self.env[2] *= self.dec[2];
        if self.env[0] * self.par[3] < STILL && self.env[2] < STILL {
            self.leeren();
        }
        let _ = m808;
        y + klick
    }

    fn snare(&mut self, sr: f32, m808: bool) -> f32 {
        let rampe = (self.n as f32 * (1.0 / (0.0003 * sr))).min(1.0);
        let pe = self.env[1];
        let schieb = ((self.par[0] * pe) as f64 / 12.0).exp2();
        self.ph[0] = (self.ph[0] + self.fq[0] * schieb / sr as f64).fract();
        self.ph[1] = (self.ph[1] + self.fq[1] * schieb / sr as f64).fract();
        let t1 = (TAU * self.ph[0]).sin() as f32 * self.env[0];
        let t2 = (TAU * self.ph[1]).sin() as f32 * self.env[2];
        let ton = (0.62 * t1 + 0.38 * t2) * rampe;
        let r = self.rausch();
        let (_, _, hp) = self.st[0].prozess(r as f64, self.g[0], self.k[0]);
        let (band, _, _) = self.st[1].prozess(hp, self.g[1], self.k[1]);
        let rausch = band as f32 * (self.env[3] + 0.5 * self.env[4]);
        let y = self.par[2] * ton + self.par[3] * rausch;
        for i in 0..5 {
            self.env[i] *= self.dec[i];
        }
        if self.env[3] < STILL && self.env[0] < STILL {
            self.leeren();
        }
        let _ = m808;
        let gain = 1.3f32;
        (gain * y).tanh() * (1.0 / gain.tanh())
    }

    fn clap(&mut self) -> f32 {
        let raster = self.par[0] as u32;
        if raster > 0 && self.n % raster == 0 {
            match self.n / raster {
                0..=2 => self.env[0] = 1.0,
                3 => self.env[1] = 1.0,
                _ => {}
            }
        }
        let r = self.rausch() as f64;
        let (_, _, h) = self.st[0].prozess(r, self.g[0], self.k[0]);
        let (_, b, _) = self.st[1].prozess(h, self.g[1], self.k[1]);
        let (_, _, luft) = self.st[2].prozess(r, self.g[2], self.k[2]);
        let koerper = b as f32 * self.k[1] as f32 * 1.6 + luft as f32 * 0.04;
        let huelle = self.env[0] * 0.8 + self.env[1];
        self.env[0] *= self.dec[0];
        self.env[1] *= self.dec[1];
        if self.n > 3 * raster && self.env[1] < STILL {
            self.leeren();
        }
        koerper * huelle
    }

    fn rim(&mut self, sr: f32) -> f32 {
        let rampe = (self.n as f32 * (1.0 / (0.0002 * sr))).min(1.0);
        self.ph[0] = (self.ph[0] + self.fq[0] / sr as f64).fract();
        self.ph[1] = (self.ph[1] + self.fq[1] / sr as f64).fract();
        let a = (TAU * self.ph[0]).sin() as f32 * self.env[0];
        let b = (TAU * self.ph[1]).sin() as f32 * self.env[1];
        let r = self.rausch();
        let (_, _, hp) = self.st[0].prozess(r as f64, self.g[0], self.k[0]);
        let klick = hp as f32 * self.env[2];
        let y = (0.7 * a + 0.8 * b) * rampe + 0.7 * klick;
        self.env[0] *= self.dec[0];
        self.env[1] *= self.dec[1];
        self.env[2] *= self.dec[2];
        if self.env[0] < STILL {
            self.leeren();
        }
        let gain = 2.0f32;
        (gain * y).tanh() * (1.0 / gain.tanh())
    }

    fn tom(&mut self, sr: f32) -> f32 {
        let rampe = (self.n as f32 * (1.0 / (0.0005 * sr))).min(1.0);
        let f = self.fq[0] * ((self.par[0] * self.env[1]) as f64 / 12.0).exp2();
        self.ph[0] = (self.ph[0] + f / sr as f64).fract();
        let s = (TAU * self.ph[0]).sin() as f32 * self.env[0] * rampe;
        let r = self.rausch() * self.env[2];
        let (_, bp, _) = self.st[0].prozess(r as f64, self.g[0], self.k[0]);
        let klick = bp as f32 * self.k[0] as f32 * self.par[2];
        self.env[0] *= self.dec[0];
        self.env[1] *= self.dec[1];
        self.env[2] *= self.dec[2];
        if self.env[0] < STILL {
            self.leeren();
        }
        let gain = 1.4f32;
        (gain * s).tanh() * (1.0 / gain.tanh()) + klick
    }

    fn hat(&mut self, e: &Einstellung) -> f32 {
        let y = self.metall_sample(e);
        let aus = y * self.env[0];
        self.env[0] *= if self.gewuergt { e.a_schnitt } else { self.dec[0] };
        if self.env[0] < 1e-5 {
            self.leeren();
        }
        aus
    }

    fn becken(&mut self, e: &Einstellung) -> f32 {
        let rampe = (self.n as f32 * (1.0 / 24.0)).min(1.0);
        let y = self.metall_sample(e);
        let mut aus = y;
        if self.art == Art::Ride {
            let (_, bp, _) = self.st[3].prozess(y as f64, self.g[3], self.k[3]);
            aus += 0.9 * bp as f32 * self.k[3] as f32;
        }
        let h = self.env[0] + self.env[1];
        self.env[0] *= self.dec[0];
        self.env[1] *= self.dec[1];
        if self.env[1] < 1e-5 {
            self.leeren();
        }
        aus * h * rampe
    }

    fn cow(&mut self, sr: f32) -> f32 {
        let rampe = (self.n as f32 * (1.0 / (0.0002 * sr))).min(1.0);
        let mut quad = 0.0f32;
        for i in 0..2 {
            let dt = self.fq[i] / sr as f64;
            self.ph[i] = (self.ph[i] + dt).fract();
            quad += rechteck(self.ph[i], dt);
        }
        let quad = quad * 0.5;
        let (_, _, hp) = self.st[1].prozess(quad as f64, self.g[1], self.k[1]);
        let (_, bp, _) = self.st[0].prozess(hp, self.g[0], self.k[0]);
        let y = (hp as f32 * 0.45 + bp as f32 * self.k[0] as f32 * 0.9) * (0.65 * self.env[0] + 0.35 * self.env[1]) * rampe;
        self.env[0] *= self.dec[0];
        self.env[1] *= self.dec[1];
        if self.env[1] < STILL {
            self.leeren();
        }
        y
    }

    fn clave(&mut self, sr: f32) -> f32 {
        let rampe = (self.n as f32 * (1.0 / (0.0002 * sr))).min(1.0);
        let fall = 1.0 + 0.06 * (-(self.n as f64) / (0.002 * sr as f64)).exp();
        self.ph[0] = (self.ph[0] + self.fq[0] * fall / sr as f64).fract();
        self.ph[1] = (self.ph[1] + self.fq[1] * fall / sr as f64).fract();
        let a = (TAU * self.ph[0]).sin() as f32 * self.env[0];
        let b = (TAU * self.ph[1]).sin() as f32 * self.env[1];
        let r = self.rausch();
        let (_, _, hp) = self.st[0].prozess(r as f64, self.g[0], self.k[0]);
        let y = (a + 0.3 * b) * rampe + 0.25 * hp as f32 * self.env[2];
        self.env[0] *= self.dec[0];
        self.env[1] *= self.dec[1];
        self.env[2] *= self.dec[2];
        if self.env[0] < STILL {
            self.leeren();
        }
        let gain = 1.5f32;
        (gain * y).tanh() * (1.0 / gain.tanh())
    }
}

/// Safety ceiling: linear up to 0.8, then a tanh knee towards 0.98, so the output never clips.
#[inline]
fn weich(y: f32) -> f32 {
    let a = y.abs();
    if a <= 0.8 { y } else { (0.8 + 0.18 * ((a - 0.8) * (1.0 / 0.18)).tanh()).copysign(y) }
}

/// The bus: drive (tanh with first-order anti-aliasing), then a DJ filter (position < 0.5 closes a low-pass, > 0.5 a high-pass,
/// 0.5 = open, bypassed), then the output level.
#[derive(Clone, Copy)]
pub struct Bus {
    adaa: Adaa1,
    lp: Stufe,
    hp: Stufe,
    /// smoothed controls
    drive: f32,
    filter: f32,
    reso: f32,
    pegel: f32,
    fertig: bool,
    still_n: u32,
    /// DC blocker (one-pole high-pass at 10 Hz) state
    dc_x: f64,
    dc_y: f64,
}

/// Position range around 0.5 in which the filter is bypassed.
const FILTER_TOT: f32 = 0.02;
/// Drive stage reference level: the output at an input of `X0` stays at `X0` for every drive.
const X0: f64 = 0.5;

impl Bus {
    pub fn neu() -> Bus {
        Bus { adaa: Adaa1::default(), lp: Stufe::default(), hp: Stufe::default(), drive: 0.5, filter: 0.5, reso: 0.3, pegel: 1.0, fertig: false, still_n: 0, dc_x: 0.0, dc_y: 0.0 }
    }

    /// Drive 0..1 to the pre-gain: 0..18 dB, quadratic (0.5 = 4.5 dB).
    pub fn vorverstaerkung(drive: f32) -> f64 { 10f64.powf(18.0 * (drive.clamp(0.0, 1.0) as f64).powi(2) / 20.0) }

    /// Low-pass cut-off (Hz) and high-pass cut-off (Hz) for a filter position; `None` = that side is open.
    pub fn grenzen(pos: f32) -> (Option<f64>, Option<f64>) {
        let d = pos.clamp(0.0, 1.0) - 0.5;
        if d.abs() < FILTER_TOT {
            (None, None)
        } else if d < 0.0 {
            (Some(20_000.0 * (80.0f64 / 20_000.0).powf(-2.0 * d as f64)), None)
        } else {
            (None, Some(20.0 * 300f64.powf(2.0 * d as f64)))
        }
    }

    /// One sample: `x` the sum of the voices, the four controls as set at the inputs.
    #[inline]
    pub fn prozess(&mut self, x: f32, e: &Einstellung, sr: f32, drive: f32, filter: f32, reso: f32, pegel: f32) -> f32 {
        let k = e.k_bus;
        if !self.fertig {
            // first sample: take the controls over without gliding from the default
            (self.drive, self.filter, self.reso, self.pegel) = (drive, filter, reso, pegel);
            self.fertig = true;
        } else {
            self.drive += (drive - self.drive) * k;
            self.filter += (filter - self.filter) * k;
            self.reso += (reso - self.reso) * k;
            self.pegel += (pegel - self.pegel) * k;
        }
        if x == 0.0 {
            self.still_n = self.still_n.saturating_add(1);
            if self.still_n == (sr * 0.5) as u32 {
                self.adaa.reset();
                self.lp = Stufe::default();
                self.hp = Stufe::default();
                self.dc_x = 0.0;
                self.dc_y = 0.0;
            }
            if self.still_n > (sr * 0.5) as u32 {
                return 0.0;
            }
        } else {
            self.still_n = 0;
        }
        let a = Bus::vorverstaerkung(self.drive);
        let y = if a > 1.0001 || self.drive > 0.0 {
            self.adaa.verarbeite(a * x as f64) / (a * X0).tanh() * X0
        } else {
            x as f64
        };
        let r = self.reso.clamp(0.0, 1.0) as f64;
        let kk = std::f64::consts::SQRT_2 * (1.0 - r) + 0.04 * r;
        let (tief, hoch) = Bus::grenzen(self.filter);
        let mut y = y;
        match (tief, hoch) {
            (Some(fc), _) => y = self.lp.prozess(y, g_von(fc, sr), kk).0,
            (_, Some(fc)) => y = self.hp.prozess(y, g_von(fc, sr), kk).2,
            _ => {
                self.lp = Stufe::default();
                self.hp = Stufe::default();
            }
        }
        // DC blocker: a short low sine burst has a mean, and the kit has no business adding one
        let ausgang = y - self.dc_x + (1.0 - 2.0 * std::f64::consts::PI * 10.0 / sr as f64) * self.dc_y;
        self.dc_x = y;
        self.dc_y = ausgang;
        weich((ausgang * self.pegel as f64) as f32)
    }

    pub fn zuruecksetzen(&mut self) { *self = Bus::neu(); }
}

/// The kit: sixteen voices and the bus.
pub struct Kit {
    pub v: [Stimme; MAX_STIMMEN],
    pub bus: Bus,
}

impl Kit {
    pub fn neu(e: &Einstellung) -> Kit { Kit { v: std::array::from_fn(|i| Stimme::neu(i, e)), bus: Bus::neu() } }

    pub fn zuruecksetzen(&mut self, e: &Einstellung) {
        self.v = std::array::from_fn(|i| Stimme::neu(i, e));
        self.bus.zuruecksetzen();
    }
}

/// One sample of the kit over `n` voices. `lies(k, i)` reads input `k` (index into `EIN`) of voice `i`. Returns the summed,
/// driven and filtered output for voice 0 (the other voices carry 0).
#[inline]
pub fn prozess_stimmen(kit: &mut Kit, e: &Einstellung, sr: f32, n: usize, trig: &Spur, vel: &Spur, hz: &Spur, lies: &dyn Fn(usize, usize) -> f32) -> Spur {
    let n = n.min(MAX_STIMMEN);
    let mut hut = false;
    let mut neu: [Option<Wahl>; MAX_STIMMEN] = [None; MAX_STIMMEN];
    for i in 0..n {
        if trig[i] > 0.5 {
            neu[i] = waehle(note_aus_hz(hz[i]), e.modell);
            if let Some(w) = neu[i] {
                hut |= matches!(w.art, Art::HatZu | Art::HatPedal | Art::HatOffen);
            }
        }
    }
    for i in 0..n {
        if let Some(w) = neu[i] {
            kit.v[i].anschlag(w, vel[i], e, sr, &|k| lies(k, i));
        }
    }
    if hut {
        // a hat strike chokes every open hat that was not struck in this sample
        for i in 0..n {
            let frisch = matches!(neu[i], Some(w) if w.art == Art::HatOffen);
            if !frisch {
                kit.v[i].wuergen();
            }
        }
    }
    let mut summe = 0.0f32;
    for i in 0..n {
        summe += kit.v[i].prozess(e, sr);
    }
    let rd = |k: usize| {
        let (_, vorgabe, lo, hi) = PARAMETER[k - KOPF];
        endlich(lies(k, 0), vorgabe).clamp(lo, hi)
    };
    let y = kit.bus.prozess(summe, e, sr, rd(I_DRIVE), rd(I_FILTER), rd(I_RESO), rd(I_PEGEL));
    let mut aus = [0.0; MAX_STIMMEN];
    aus[0] = y;
    aus
}

/// Checks the fixed values of a node; `w(name)` reads a value. `None` = fine.
pub fn pruefe(w: &dyn Fn(&str) -> f32) -> Option<(String, &'static str)> {
    if w("modell") != 0.0 && w("modell") != 1.0 {
        return Some(("modell".into(), "0 (TR-909) or 1 (TR-808)"));
    }
    if !(SCHNITT_MIN..=SCHNITT_MAX).contains(&w("schnitt")) {
        return Some(("schnitt".into(), "1..100 ms to -60 dB"));
    }
    let s = w("saat");
    if !(s.fract() == 0.0 && (0.0..=65_535.0).contains(&s)) {
        return Some(("saat".into(), "integer 0..65535"));
    }
    for (name, _, lo, hi) in PARAMETER.iter() {
        if !(*lo..=*hi).contains(&w(name)) {
            return Some(((*name).into(), "outside its range (see trommeln.rs PARAMETER)"));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eingangsnamen_passen_zur_tabelle() {
        assert_eq!(EIN[0], "trig");
        assert_eq!(EIN[1], "vel");
        assert_eq!(EIN[2], "hz");
        for (i, (name, vorgabe, lo, hi)) in PARAMETER.iter().enumerate() {
            assert_eq!(EIN[KOPF + i], *name, "input {}", KOPF + i);
            assert!(lo < hi && (lo..=hi).contains(&vorgabe), "{name}: default {vorgabe} outside {lo}..{hi}");
        }
        for (i, n) in [(I_PEGEL, "pegel"), (I_DRIVE, "drive"), (I_FILTER, "filter"), (I_RESO, "reso"), (I_KICK_TUNE, "kick_tune"), (I_KICK_DRIVE, "kick_drive"),
                       (I_SNARE_TONE, "snare_tone"), (I_CLAP_SPREAD, "clap_spread"), (I_RIM_DECAY, "rim_decay"), (I_TOM_PUNCH, "tom_punch"),
                       (I_OH_DECAY, "oh_decay"), (I_RIDE_DECAY, "ride_decay"), (I_BOOM_DECAY, "boom_decay"), (I_CLAVE_TUNE, "clave_tune"),
                       (I_TOMLO, "tomlo_tune"), (I_TOMMID, "tommid_tune"), (I_TOMHI, "tomhi_tune"), (I_HAT_NOISE, "hat_noise"), (I_COW_DECAY, "cow_decay"),
                       (I_CRASH_TUNE, "crash_tune"), (I_CH_DECAY, "ch_decay"), (I_SNARE_SNAPPY, "snare_snappy"), (I_KICK_CLICK, "kick_click"),
                       (I_KICK_PDECAY, "kick_pdecay"), (I_KICK_PUNCH, "kick_punch"), (I_KICK_DECAY, "kick_decay"), (I_SNARE_TUNE, "snare_tune"),
                       (I_SNARE_DECAY, "snare_decay"), (I_CLAP_DECAY, "clap_decay"), (I_CLAP_TONE, "clap_tone"), (I_RIM_TUNE, "rim_tune"),
                       (I_TOM_DECAY, "tom_decay"), (I_HAT_TUNE, "hat_tune"), (I_HAT_TONE, "hat_tone"), (I_CRASH_DECAY, "crash_decay"),
                       (I_RIDE_TUNE, "ride_tune"), (I_COW_TUNE, "cow_tune"), (I_BOOM_TUNE, "boom_tune")] {
            assert_eq!(EIN[i], n);
        }
    }

    #[test]
    fn notenbelegung() {
        assert_eq!(waehle(36, 0).unwrap().art, Art::Kick);
        assert_eq!(waehle(35, 0).unwrap().art, Art::Kick);
        assert_eq!(waehle(35, 1).unwrap().art, Art::Boom);
        assert_eq!(waehle(0, 0).unwrap().art, Art::Kick);
        assert_eq!(waehle(42, 0).unwrap().art, Art::HatZu);
        assert_eq!(waehle(46, 1).unwrap().art, Art::HatOffen);
        assert_eq!(waehle(52, 0).unwrap().art, Art::Ride);
        assert_eq!(waehle(56, 1).unwrap().art, Art::Cow);
        assert_eq!(waehle(56, 0).unwrap().art, Art::Crash);
        assert_eq!(waehle(75, 1).unwrap().art, Art::Clave);
        assert_eq!(waehle(100, 1).unwrap().art, Art::Clave);
        assert!(waehle(75, 0).is_none());
        assert!(waehle(127, 0).is_none());
        for n in 0..=74 {
            assert!(waehle(n, 0).is_some() && waehle(n, 1).is_some(), "note {n}");
        }
    }

    #[test]
    fn note_aus_hz_ist_die_umkehrung() {
        for n in 0..=127 {
            let hz = 440.0 * 2f32.powf((n as f32 - 69.0) / 12.0);
            assert_eq!(note_aus_hz(hz), n, "{n}");
        }
        assert_eq!(note_aus_hz(0.0), -1);
        assert_eq!(note_aus_hz(f32::NAN), -1);
    }

    #[test]
    fn filtergrenzen() {
        assert_eq!(Bus::grenzen(0.5), (None, None));
        let (t, h) = Bus::grenzen(0.0);
        assert!((t.unwrap() - 80.0).abs() < 1e-6 && h.is_none());
        let (t, h) = Bus::grenzen(1.0);
        assert!(t.is_none() && (h.unwrap() - 6_000.0).abs() < 1e-6);
    }
}
