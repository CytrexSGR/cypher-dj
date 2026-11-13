//! Cypher Labor: a dual-channel feedback processor and feedback synthesizer.
//!
//! Each channel is gain -> one-bit delay -> resonant filter -> clipping -> dry/wet mixer. The filter output of a
//! channel feeds back into its own delay input (channel feedback) and into the delay input of the other channel
//! (cross feedback). With the delay switched off the loop is a filter oscillator. One modulator (envelope or
//! cycling) drives gain, delay time and cutoff of both channels.
//!
//! What is modelled, and from which kind of evidence, is written down in `docs/presets/devices/GERAET-labor.md`.
//! Everything marked DECISION below is a modelling choice, not a measured value of any hardware.
//!
//! The whole loop runs sample by sample at twice the base rate (below 88 kHz), because the saturators sit inside
//! the feedback loop. Signals inside are in volts. No allocation in `block`.

pub mod chip;
pub mod filter;
pub mod modulator;

use chip::Chip;
use eq_dsp::ueberabtastung::{Hoch, Runter, LATENZ};
use filter::Filter;
use modulator::Modulator;

/// From this base rate on the loop runs without oversampling.
pub const OHNE_UEBERABTASTUNG_AB: f64 = 88000.0;
/// DECISION: digital full scale corresponds to the clipping level of the device (1.46 V). A signal that peaks at
/// full scale drives the clippers fully, one at -6 dBFS passes them clean.
pub const VOLT_PRO_FS: f64 = 1.46;
/// Clipping level of the gain stage and of the channel output stage (1.46 V peak = 2.5 dBu).
pub const CLIP_V: f64 = 1.46;
/// DECISION: the summing node in front of the delay saturates at the op-amp rail. This is the bounded saturator
/// that keeps every feedback path finite when the delay is off.
pub const SCHIENE_V: f64 = 4.0;
/// Input gain range in dB.
pub const GAIN_MIN_DB: f64 = -38.0;
pub const GAIN_MAX_DB: f64 = 40.0;
/// Delay time range in ms.
pub const ZEIT_MIN_MS: f64 = 46.0;
pub const ZEIT_MAX_MS: f64 = 1500.0;
/// Cutoff range in Hz.
pub const CUTOFF_MIN_HZ: f64 = 60.0;
pub const CUTOFF_MAX_HZ: f64 = 6000.0;
/// DECISION: control voltage sensitivities, chosen so that +-5 V sweep the full knob range of gain and cutoff.
pub const CV_GAIN_DB_PRO_V: f64 = 7.8;
pub const CV_CUTOFF_OKT_PRO_V: f64 = 0.664;
/// DECISION: the time CV scales the timing resistance, so it does little at the shortest delay (as the manual says).
pub const CV_ZEIT_OKT_PRO_V: f64 = 0.4;
/// DECISION: feedback knob law, loop gain = MAX * knob^2: off at 0, unity at 0.5, amplification above.
pub const FEEDBACK_MAX: f64 = 4.0;
/// Bleed between the channels (-48 dB), always present.
pub const UEBERSPRECHEN: f64 = 0.004;
/// DECISION: part tolerance of channel 2 against channel 1 (cutoff and delay time). Two analog channels are never
/// identical. Without it, two channels with the same settings lock into a fixed phase, which can be opposite phase
/// and then cancels in mono; with it they drift slowly against each other.
pub const TOLERANZ_CUTOFF: f64 = 1.004;
pub const TOLERANZ_ZEIT: f64 = 1.006;
/// Seed of the noise generator (set again by `leeren`, so a cleared device repeats bit for bit).
const SAAT: u64 = 0x9E37_79B9_7F4A_7C15;
/// Noise at the summing node in volts (uniform, about -90 dBV rms). It is what starts a self-oscillation.
pub const RAUSCHEN_V: f64 = 54e-6;

/// How the loop is run against the base rate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Ueber {
    /// At the base rate: no latency, more aliasing.
    Aus,
    /// At twice the rate between linear-phase half-band filters: the dry input stays exact, latency `LATENZ` samples.
    Linear,
    /// At twice the rate with a minimum-phase decimator: no latency to report (a group delay of about two samples).
    /// Meant for use without an input (instrument); an input is interpolated linearly on the way up.
    Minimal,
}

/// Elliptic low-pass of order 8 at the doubled rate (pass band to 0.21 of that rate, 0.05 dB ripple, 90 dB stop band from
/// 0.29), as four biquads `[b0, b1, b2, a1, a2]`. Designed with scipy.signal.ellip(8, 0.05, 90, 0.42).
const ABWAERTS: [[f64; 5]; 4] = [
    [4.596_382_762_146_092_3e-3, 8.647_591_145_045_270_5e-3, 4.596_382_762_146_092_3e-3, -9.686_470_495_301_940_9e-1, 2.802_615_652_689_302e-1],
    [1.0, 1.247_054_017_487_320_6, 1.0, -7.555_681_209_601_039_5e-1, 4.668_068_444_048_615_3e-1],
    [1.0, 7.125_957_591_189_451_3e-1, 1.0, -5.237_339_422_126_77e-1, 6.984_536_574_017_172_8e-1],
    [1.0, 4.674_098_092_791_897_4e-1, 1.0, -4.041_323_954_600_470_3e-1, 9.019_263_741_473_138e-1],
];

/// Minimum-phase decimator by two: the low-pass `ABWAERTS` at the doubled rate, every second sample kept.
#[derive(Clone, Copy, Debug, Default)]
struct Abwaerts {
    z: [[f64; 2]; 4],
}

impl Abwaerts {
    #[inline]
    fn filter(&mut self, mut x: f64) -> f64 {
        for (k, z) in ABWAERTS.iter().zip(self.z.iter_mut()) {
            let y = k[0] * x + z[0];
            z[0] = k[1] * x - k[3] * y + z[1];
            z[1] = k[2] * x - k[4] * y;
            x = y;
        }
        x
    }
    #[inline]
    fn verarbeite(&mut self, v: [f64; 2]) -> f64 {
        self.filter(v[0]);
        self.filter(v[1])
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct KanalEinstellung {
    /// Input gain, GAIN_MIN_DB..GAIN_MAX_DB.
    pub gain_db: f64,
    /// Output mixer: 0 = dry input, 1 = processed.
    pub mix: f64,
    /// Delay switch. Off: the signal passes the delay stage untouched.
    pub delay_an: bool,
    /// Delay time in ms, ZEIT_MIN_MS..ZEIT_MAX_MS.
    pub zeit_ms: f64,
    /// Filter cutoff in Hz, CUTOFF_MIN_HZ..CUTOFF_MAX_HZ.
    pub cutoff_hz: f64,
    /// Resonance 0..1, self-oscillation from 0.8 on.
    pub resonanz: f64,
    /// Filter mode: false = low-pass, true = high-pass.
    pub hp: bool,
    /// Channel feedback 0..1 (filter output into the own delay).
    pub feedback: f64,
    /// Cross feedback 0..1 (filter output of this channel into the delay of the other one).
    pub kreuz: f64,
    /// Modulator depth onto gain, time and cutoff, -1..1 (the sign picks the positive or the negative output).
    pub mod_gain: f64,
    pub mod_zeit: f64,
    pub mod_cutoff: f64,
}

impl Default for KanalEinstellung {
    fn default() -> Self {
        KanalEinstellung {
            gain_db: 0.0,
            mix: 1.0,
            delay_an: true,
            zeit_ms: 250.0,
            cutoff_hz: 1500.0,
            resonanz: 0.3,
            hp: false,
            feedback: 0.3,
            kreuz: 0.0,
            mod_gain: 0.0,
            mod_zeit: 0.0,
            mod_cutoff: 0.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Einstellung {
    pub kanal: [KanalEinstellung; 2],
    /// Master volume in dB.
    pub lautstaerke_db: f64,
    /// Modulator cycles continuously (LFO). Off: it runs once per trigger (envelope).
    pub zyklus: bool,
    /// Attack and decay time in s, each 0.005..5.
    pub attack_s: f64,
    pub decay_s: f64,
    /// Attenuator for all modulator outputs, 0..1.
    pub amount: f64,
    /// 0..1: how far a played note moves both cutoffs (1 = one octave per octave around note 60).
    pub key_track: f64,
    /// A held note opens the output, a released one closes it. Off: the output is always open.
    pub gate: bool,
    /// 0..1: a trigger also sends a short pulse into both channels (excites a resonating filter without an input).
    pub ping: f64,
    /// The right input is fed from the left one (the hardware normals input 2 to input 1).
    pub mono_ein: bool,
}

impl Default for Einstellung {
    fn default() -> Self {
        Einstellung {
            kanal: [KanalEinstellung::default(); 2],
            lautstaerke_db: -6.0,
            zyklus: false,
            attack_s: 0.005,
            decay_s: 0.3,
            amount: 1.0,
            key_track: 0.0,
            gate: false,
            ping: 0.0,
            mono_ein: false,
        }
    }
}

fn db(v: f64) -> f64 {
    10f64.powf(v / 20.0)
}

/// Bounded saturator with a diode-like knee: `x / (1 + (x/grenze)^8)^(1/8)`. Linear up to half the limit
/// (0.05 % off there), never above the limit.
#[inline]
pub fn begrenze(x: f64, grenze: f64) -> f64 {
    let r = x / grenze;
    let r2 = r * r;
    let r4 = r2 * r2;
    x / (1.0 + r4 * r4).sqrt().sqrt().sqrt()
}

/// One-pole glide towards a target.
#[derive(Clone, Copy, Debug)]
struct Gleiter {
    wert: f64,
    ziel: f64,
}

impl Gleiter {
    fn neu(v: f64) -> Self {
        Gleiter { wert: v, ziel: v }
    }
    #[inline]
    fn schritt(&mut self, a: f64) -> f64 {
        self.wert += a * (self.ziel - self.wert);
        self.wert
    }
    fn springe(&mut self) {
        self.wert = self.ziel;
    }
}

struct Kanal {
    chip: Chip,
    filter: Filter,
    gain_db: Gleiter,
    mix: Gleiter,
    zeit_ms: Gleiter,
    cutoff_log: Gleiter,
    k0: Gleiter,
    fb: Gleiter,
    kreuz: Gleiter,
    delay_an: bool,
    hp: bool,
    mod_gain: f64,
    mod_zeit: f64,
    mod_cutoff: f64,
    /// DC blocker state of the feedback tap, and its output of the previous sample (the loop delay).
    dc: f64,
    rueck: f64,
}

impl Kanal {
    fn neu(fs: f64) -> Self {
        Kanal {
            chip: Chip::neu(fs),
            filter: Filter::default(),
            gain_db: Gleiter::neu(0.0),
            mix: Gleiter::neu(1.0),
            zeit_ms: Gleiter::neu(250.0),
            cutoff_log: Gleiter::neu(1500f64.ln()),
            k0: Gleiter::neu(1.0),
            fb: Gleiter::neu(0.0),
            kreuz: Gleiter::neu(0.0),
            delay_an: true,
            hp: false,
            mod_gain: 0.0,
            mod_zeit: 0.0,
            mod_cutoff: 0.0,
            dc: 0.0,
            rueck: 0.0,
        }
    }

    fn setze(&mut self, e: &KanalEinstellung) {
        self.gain_db.ziel = e.gain_db.clamp(GAIN_MIN_DB, GAIN_MAX_DB);
        self.mix.ziel = e.mix.clamp(0.0, 1.0);
        self.zeit_ms.ziel = e.zeit_ms.clamp(ZEIT_MIN_MS, ZEIT_MAX_MS);
        self.cutoff_log.ziel = e.cutoff_hz.clamp(CUTOFF_MIN_HZ, CUTOFF_MAX_HZ).ln();
        self.k0.ziel = filter::k0_aus_resonanz(e.resonanz);
        let f = e.feedback.clamp(0.0, 1.0);
        let x = e.kreuz.clamp(0.0, 1.0);
        self.fb.ziel = FEEDBACK_MAX * f * f;
        self.kreuz.ziel = FEEDBACK_MAX * x * x;
        self.delay_an = e.delay_an;
        self.hp = e.hp;
        self.mod_gain = e.mod_gain.clamp(-1.0, 1.0);
        self.mod_zeit = e.mod_zeit.clamp(-1.0, 1.0);
        self.mod_cutoff = e.mod_cutoff.clamp(-1.0, 1.0);
    }

    fn springe(&mut self) {
        for g in [&mut self.gain_db, &mut self.mix, &mut self.zeit_ms, &mut self.cutoff_log, &mut self.k0, &mut self.fb, &mut self.kreuz] {
            g.springe();
        }
    }

    fn leeren(&mut self) {
        self.chip.leeren();
        self.filter = Filter::default();
        self.dc = 0.0;
        self.rueck = 0.0;
        self.springe();
    }
}

pub struct Labor {
    /// Rate of the loop (twice the base rate below OHNE_UEBERABTASTUNG_AB).
    fs: f64,
    ueber: Ueber,
    hoch: [Hoch; 2],
    runter: [Runter; 2],
    abwaerts: [Abwaerts; 2],
    ein_alt: [f64; 2],
    kanal: [Kanal; 2],
    modulator: Modulator,
    lautstaerke: Gleiter,
    amount: f64,
    attack_s: f64,
    decay_s: f64,
    key_track: f64,
    gate_an: bool,
    ping: f64,
    mono_ein: bool,
    /// Glide coefficients: fast (5 ms), slow (60 ms, delay time), DC blocker (20 Hz).
    a_schnell: f64,
    a_langsam: f64,
    a_dc: f64,
    /// Note state: the last played note, how many are held, the gate envelope.
    note: f64,
    gehalten: u32,
    tor: f64,
    a_tor_auf: f64,
    a_tor_zu: f64,
    /// Ping pulse (volts) and its decay per sample.
    puls: f64,
    puls_ab: f64,
    zufall: u64,
}

impl Labor {
    pub fn neu(fs_basis: f64) -> Self {
        Self::mit(fs_basis, true)
    }

    /// `ueber` false: the loop runs at the base rate, without latency and with more aliasing.
    pub fn mit(fs_basis: f64, ueber: bool) -> Self {
        Self::mit_art(fs_basis, if ueber { Ueber::Linear } else { Ueber::Aus })
    }

    /// From OHNE_UEBERABTASTUNG_AB on every mode runs at the base rate.
    pub fn mit_art(fs_basis: f64, art: Ueber) -> Self {
        let ueber = if fs_basis < OHNE_UEBERABTASTUNG_AB { art } else { Ueber::Aus };
        let fs = if ueber == Ueber::Aus { fs_basis } else { 2.0 * fs_basis };
        let pol = |sekunden: f64| 1.0 - (-1.0 / (sekunden * fs)).exp();
        let mut l = Labor {
            fs,
            ueber,
            hoch: [Hoch::neu(), Hoch::neu()],
            runter: [Runter::neu(), Runter::neu()],
            abwaerts: [Abwaerts::default(); 2],
            ein_alt: [0.0; 2],
            kanal: [Kanal::neu(fs), Kanal::neu(fs)],
            modulator: Modulator::neu(fs),
            lautstaerke: Gleiter::neu(db(-6.0)),
            amount: 1.0,
            attack_s: 0.005,
            decay_s: 0.3,
            key_track: 0.0,
            gate_an: false,
            ping: 0.0,
            mono_ein: false,
            a_schnell: pol(0.005),
            a_langsam: pol(0.060),
            a_dc: 1.0 - (-2.0 * std::f64::consts::PI * 20.0 / fs).exp(),
            note: 60.0,
            gehalten: 0,
            tor: 0.0,
            a_tor_auf: pol(0.002),
            a_tor_zu: pol(0.030),
            puls: 0.0,
            puls_ab: (-1.0 / (0.001 * fs)).exp(),
            zufall: SAAT,
        };
        l.setze(&Einstellung::default());
        l.leeren();
        l
    }

    /// Latency in base samples (report it to the host).
    pub fn latenz(&self) -> usize {
        if self.ueber == Ueber::Linear { LATENZ } else { 0 }
    }

    pub fn setze(&mut self, e: &Einstellung) {
        for k in 0..2 {
            self.kanal[k].setze(&e.kanal[k]);
        }
        self.lautstaerke.ziel = db(e.lautstaerke_db);
        self.modulator.zyklus(e.zyklus);
        self.attack_s = e.attack_s.clamp(0.005, 5.0);
        self.decay_s = e.decay_s.clamp(0.005, 5.0);
        self.amount = e.amount.clamp(0.0, 1.0);
        self.key_track = e.key_track.clamp(0.0, 1.0);
        self.gate_an = e.gate;
        self.ping = e.ping.clamp(0.0, 1.0);
        self.mono_ein = e.mono_ein;
    }

    /// Clears every state (delay memory, filters, modulator, notes) and jumps the glides to their targets.
    pub fn leeren(&mut self) {
        for k in 0..2 {
            self.hoch[k].reset();
            self.runter[k].reset();
            self.abwaerts[k] = Abwaerts::default();
            self.ein_alt[k] = 0.0;
            self.kanal[k].leeren();
        }
        self.modulator.leeren();
        self.lautstaerke.springe();
        self.gehalten = 0;
        self.note = 60.0;
        self.tor = 0.0;
        self.puls = 0.0;
        self.zufall = SAAT;
    }

    /// Starts one modulator run (the trigger switch) and the ping pulse.
    pub fn trigger(&mut self, staerke: f64) {
        self.modulator.trigger();
        self.puls += self.ping * staerke.clamp(0.0, 1.0) * SCHIENE_V;
    }

    /// A played note: moves the cutoffs by `key_track`, opens the gate and triggers.
    pub fn note_an(&mut self, note: u8, vel: f32) {
        self.note = note as f64;
        self.gehalten += 1;
        self.trigger(vel as f64);
    }

    pub fn note_aus(&mut self) {
        self.gehalten = self.gehalten.saturating_sub(1);
    }

    #[inline]
    fn rauschen(&mut self) -> f64 {
        // xorshift64
        let mut z = self.zufall;
        z ^= z << 13;
        z ^= z >> 7;
        z ^= z << 17;
        self.zufall = z;
        ((z >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0) * RAUSCHEN_V
    }

    /// One sample of the loop, input and output in volts.
    #[inline]
    fn schritt(&mut self, ein: [f64; 2]) -> [f64; 2] {
        let cv = self.modulator.schritt(self.attack_s, self.decay_s) * self.amount * 5.0;
        let ton = self.key_track * (self.note - 60.0) / 12.0;
        let puls = self.puls;
        self.puls *= self.puls_ab;
        let rueck = [self.kanal[0].rueck, self.kanal[1].rueck];
        let mut aus = [0.0; 2];
        for k in 0..2 {
            let n = self.rauschen();
            let (a_s, a_l, a_dc, fs) = (self.a_schnell, self.a_langsam, self.a_dc, self.fs);
            let kreuz_herein = self.kanal[1 - k].kreuz.schritt(a_s).max(UEBERSPRECHEN);
            let ka = &mut self.kanal[k];
            let trocken = ein[k];
            let gain = db((ka.gain_db.schritt(a_s) + cv * ka.mod_gain * CV_GAIN_DB_PRO_V).clamp(-80.0, GAIN_MAX_DB + 6.0));
            let verstaerkt = begrenze(trocken * gain, CLIP_V);
            let summe = begrenze(verstaerkt + puls + n + ka.fb.schritt(a_s) * rueck[k] + kreuz_herein * rueck[1 - k], SCHIENE_V);
            let (tol_zeit, tol_cutoff) = if k == 1 { (TOLERANZ_ZEIT, TOLERANZ_CUTOFF) } else { (1.0, 1.0) };
            let zeit = chip::zeit_mit_cv(ka.zeit_ms.schritt(a_l) * tol_zeit, cv * ka.mod_zeit * CV_ZEIT_OKT_PRO_V);
            let verzoegert = if ka.delay_an { ka.chip.verarbeite(summe, zeit) } else { summe };
            let fc = ((ka.cutoff_log.schritt(a_s) + (cv * ka.mod_cutoff * CV_CUTOFF_OKT_PRO_V + ton) * std::f64::consts::LN_2)
                .exp()
                * tol_cutoff)
                .clamp(20.0, 0.3 * fs);
            let gefiltert = ka.filter.verarbeite(verzoegert, fc, fs, ka.k0.schritt(a_s), ka.hp);
            // feedback tap: filter output through a DC blocker, used by the next sample
            ka.dc += a_dc * (gefiltert - ka.dc);
            ka.rueck = gefiltert - ka.dc;
            let nass = begrenze(gefiltert, CLIP_V);
            let m = ka.mix.schritt(a_s);
            aus[k] = trocken + m * (nass - trocken);
        }
        let ziel = if !self.gate_an || self.gehalten > 0 { 1.0 } else { 0.0 };
        self.tor += (if ziel > self.tor { self.a_tor_auf } else { self.a_tor_zu }) * (ziel - self.tor);
        let v = self.lautstaerke.schritt(self.a_schnell) * self.tor;
        [aus[0] * v, aus[1] * v]
    }

    /// Processes one block in place (left = channel 1, right = channel 2).
    pub fn block(&mut self, l: &mut [f32], r: &mut [f32]) {
        for i in 0..l.len().min(r.len()) {
            let xl = l[i] as f64 * VOLT_PRO_FS;
            let xr = if self.mono_ein { xl } else { r[i] as f64 * VOLT_PRO_FS };
            let y = match self.ueber {
                Ueber::Linear => {
                    let a = self.hoch[0].verarbeite(xl);
                    let b = self.hoch[1].verarbeite(xr);
                    let y0 = self.schritt([a[0], b[0]]);
                    let y1 = self.schritt([a[1], b[1]]);
                    [self.runter[0].verarbeite([y0[0], y1[0]]), self.runter[1].verarbeite([y0[1], y1[1]])]
                }
                Ueber::Minimal => {
                    let y0 = self.schritt([0.5 * (self.ein_alt[0] + xl), 0.5 * (self.ein_alt[1] + xr)]);
                    let y1 = self.schritt([xl, xr]);
                    self.ein_alt = [xl, xr];
                    [self.abwaerts[0].verarbeite([y0[0], y1[0]]), self.abwaerts[1].verarbeite([y0[1], y1[1]])]
                }
                Ueber::Aus => self.schritt([xl, xr]),
            };
            l[i] = (y[0] / VOLT_PRO_FS) as f32;
            r[i] = (y[1] / VOLT_PRO_FS) as f32;
        }
    }
}
